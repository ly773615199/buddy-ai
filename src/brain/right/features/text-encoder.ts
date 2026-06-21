/**
 * ByteEncoder V2 — 字节级文本编码器（升级版）
 *
 * 纯 TypeScript，零 npm 依赖
 * 将自然语言文本映射到 384 维语义向量
 *
 * V2 升级：
 * - 参数量: 145K → ~2M
 * - 输出维度: 128 → 384
 * - Encoder 层数: 2 → 4
 * - 注意力头数: 4 → 6
 * - FFN 维度: 256 → 768
 * - 字节嵌入: 32 → 64
 * - 新增: RoPE 位置编码
 * - 新增: AttentionPooling（替代 mean pooling）
 * - 新增: LearnedMerge（可训练合并门控）
 */

import {
  Tensor, zeros, randn, xavierUniform,
  matmul, add, layerNorm, softmax, reshape, sigmoid,
  isInferenceMode, backward as autogradBackward,
} from '../nn/tensor.js';
import { MultiHeadAttention } from '../nn/attention.js';
import { FeedForward } from '../nn/ffn.js';

// ==================== 配置 ====================

export interface TextEncoderConfig {
  byteEmbedDim: number;           // 默认 64
  outputDim: number;              // 默认 384
  numLayers: number;              // 默认 4
  numHeads: number;               // 默认 6
  ffnDim: number;                 // 默认 768
  mergeEntropyThreshold: number;  // 默认 1.5
  maxSeqLen: number;              // 默认 1024
}

const DEFAULT_CONFIG: TextEncoderConfig = {
  byteEmbedDim: 64,
  outputDim: 384,
  numLayers: 4,
  numHeads: 6,
  ffnDim: 768,
  mergeEntropyThreshold: 1.5,
  maxSeqLen: 1024,
};

// ==================== ByteEmbedding ====================

/**
 * 字节查表嵌入层
 * 256 个字节值 → embedDim 维向量
 */
export class ByteEmbedding {
  weight: Tensor; // [256, embedDim]
  embedDim: number;

  constructor(embedDim: number) {
    this.embedDim = embedDim;
    // Xavier 初始化
    const limit = Math.sqrt(6 / (256 + embedDim));
    const data = new Float32Array(256 * embedDim);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * limit;
    }
    this.weight = new Tensor(data, [256, embedDim]);
  }

  /**
   * 前向：将字节序列映射为嵌入向量序列
   * @param bytes Uint8Array 或 number[]
   * @returns Tensor [S, embedDim]
   */
  forward(bytes: Uint8Array | number[]): Tensor {
    const S = bytes.length;
    const D = this.embedDim;
    const data = new Float32Array(S * D);
    const w = this.weight.data;

    for (let s = 0; s < S; s++) {
      const byteVal = bytes[s] & 0xFF;
      const srcOff = byteVal * D;
      const dstOff = s * D;
      for (let d = 0; d < D; d++) {
        data[dstOff + d] = w[srcOff + d];
      }
    }

    return new Tensor(data, [S, D]);
  }

  parameters(): Tensor[] {
    return [this.weight];
  }

  countParams(): number {
    return 256 * this.embedDim;
  }
}

// ==================== EntropyEstimator ====================

/** 计算单个窗口的 Shannon 熵 */
function windowEntropy(bytes: Uint8Array | number[], start: number, end: number): number {
  const freq = new Float32Array(256);
  const len = end - start;
  if (len <= 0) return 0;

  for (let i = start; i < end; i++) {
    freq[bytes[i] & 0xFF]++;
  }

  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    if (freq[i] > 0) {
      const p = freq[i] / len;
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

/**
 * 估算每个字节位置的局部熵
 */
export function estimateEntropy(bytes: Uint8Array | number[], windowRadius = 2): Float32Array {
  const S = bytes.length;
  const entropy = new Float32Array(S);

  for (let i = 0; i < S; i++) {
    const start = Math.max(0, i - windowRadius);
    const end = Math.min(S, i + windowRadius + 1);
    entropy[i] = windowEntropy(bytes, start, end);
  }

  return entropy;
}

// ==================== RoPE 位置编码 ====================

/**
 * Rotary Position Embedding (RoPE)
 *
 * 对 Q/K 向量施加旋转位置编码，使注意力感知 token 位置关系。
 * 每对相邻维度 (2i, 2i+1) 使用不同频率旋转。
 *
 * @param x [S, D] 输入张量
 * @param positions [S] 位置索引
 * @returns [S, D] 旋转后的张量
 */
export function applyRoPE(x: Tensor, positions: number[]): Tensor {
  const S = x.shape[0];
  const D = x.shape[1];
  const out = new Float32Array(S * D);
  const src = x.data;
  const halfD = D / 2;

  for (let s = 0; s < S; s++) {
    const pos = positions[s];
    const rowOff = s * D;

    for (let i = 0; i < halfD; i++) {
      const theta = pos / Math.pow(10000, (2 * i) / D);
      const cosVal = Math.cos(theta);
      const sinVal = Math.sin(theta);

      const x1 = src[rowOff + 2 * i];
      const x2 = src[rowOff + 2 * i + 1];

      out[rowOff + 2 * i] = x1 * cosVal - x2 * sinVal;
      out[rowOff + 2 * i + 1] = x1 * sinVal + x2 * cosVal;
    }
  }

  return new Tensor(out, [S, D]);
}

/**
 * 批量 RoPE：[B, S, D] 输入
 */
export function applyRoPEBatch(x: Tensor, positions: number[]): Tensor {
  if (x.shape.length === 2) return applyRoPE(x, positions);

  const [B, S, D] = x.shape;
  const out = new Float32Array(B * S * D);
  const src = x.data;
  const halfD = D / 2;

  for (let b = 0; b < B; b++) {
    for (let s = 0; s < S; s++) {
      const pos = positions[s];
      const rowOff = (b * S + s) * D;

      for (let i = 0; i < halfD; i++) {
        const theta = pos / Math.pow(10000, (2 * i) / D);
        const cosVal = Math.cos(theta);
        const sinVal = Math.sin(theta);

        const x1 = src[rowOff + 2 * i];
        const x2 = src[rowOff + 2 * i + 1];

        out[rowOff + 2 * i] = x1 * cosVal - x2 * sinVal;
        out[rowOff + 2 * i + 1] = x1 * sinVal + x2 * cosVal;
      }
    }
  }

  return new Tensor(out, [B, S, D]);
}

// ==================== LearnedMerge ====================

/**
 * 可训练的动态合并门控
 *
 * 结合字节嵌入和局部熵，学习哪些字节应该合并、哪些应该保留。
 * 门控分数 = sigmoid(W · embed + b) + entropy_weight
 *
 * 比固定熵阈值更灵活：高信息量但低熵的字节（如中文单字）也能被保留。
 */
export class LearnedMerge {
  /** 门控权重 [byteEmbedDim, 1] */
  gateWeight: Tensor;
  /** 门控偏置 [1] */
  gateBias: Tensor;
  /** 熵混合权重（可学习标量） */
  entropyWeight: Tensor;
  /** 熵偏移（可学习标量） */
  entropyBias: Tensor;
  embedDim: number;

  constructor(embedDim: number) {
    this.embedDim = embedDim;
    // 初始化：gateWeight 用小随机值
    const wData = new Float32Array(embedDim);
    for (let i = 0; i < embedDim; i++) {
      wData[i] = (Math.random() - 0.5) * 0.02;
    }
    this.gateWeight = new Tensor(wData, [embedDim, 1]);
    this.gateBias = new Tensor(new Float32Array([0.5]), [1]); // 初始偏置 0.5，倾向保留
    this.entropyWeight = new Tensor(new Float32Array([0.3]), [1]); // 初始熵权重
    this.entropyBias = new Tensor(new Float32Array([0.0]), [1]);
  }

  /**
   * 判断每个字节位置是否应该保留（不合并）
   *
   * @param embeddings [S, byteEmbedDim] 字节嵌入
   * @param entropy [S] 局部熵值
   * @returns boolean[] true=保留，false=合并
   */
  shouldKeep(embeddings: Tensor, entropy: Float32Array): boolean[] {
    const S = embeddings.shape[0];
    const D = this.embedDim;
    const result = new Array<boolean>(S);
    const w = this.gateWeight.data;
    const b = this.gateBias.data[0];
    const ew = this.entropyWeight.data[0];
    const eb = this.entropyBias.data[0];

    for (let s = 0; s < S; s++) {
      // 门控分数 = sigmoid(w · embed + b)
      let dot = 0;
      const off = s * D;
      for (let d = 0; d < D; d++) {
        dot += embeddings.data[off + d] * w[d];
      }
      const gateScore = 1 / (1 + Math.exp(-(dot + b)));

      // 混合信号 = gateScore + ew * entropy + eb
      const mixed = gateScore + ew * entropy[s] + eb;
      const finalScore = 1 / (1 + Math.exp(-mixed));

      result[s] = finalScore > 0.5;
    }

    return result;
  }

  /**
   * 计算合并边界（与 dynamicMerge 兼容的接口）
   */
  computeMergeBoundaries(
    embeddings: Tensor,
    entropy: Float32Array,
    maxPatches: number,
  ): number[] {
    const S = embeddings.shape[0];
    if (S === 0) return [0];

    const keepFlags = this.shouldKeep(embeddings, entropy);
    const boundaries: number[] = [0];

    let i = 0;
    while (i < S) {
      if (keepFlags[i]) {
        // 保留为独立 patch
        boundaries.push(i + 1);
        i++;
      } else {
        // 向后合并，直到遇到保留标记或结束
        let j = i + 1;
        while (j < S && !keepFlags[j] && (j - i) < 8) {
          j++;
        }
        boundaries.push(j);
        i = j;
      }

      if (boundaries.length - 1 >= maxPatches) {
        boundaries[boundaries.length - 1] = S;
        break;
      }
    }

    if (boundaries[boundaries.length - 1] !== S) {
      boundaries.push(S);
    }

    return boundaries;
  }

  parameters(): Tensor[] {
    return [this.gateWeight, this.gateBias, this.entropyWeight, this.entropyBias];
  }

  countParams(): number {
    return this.embedDim + 3; // gateWeight + 3 scalars
  }
}

// ==================== DynamicMerge (保留兼容) ====================

/**
 * 熵驱动的动态合并（静态版本，LearnedMerge 的降级方案）
 */
export function dynamicMerge(
  bytes: Uint8Array | number[],
  entropy: Float32Array,
  threshold: number,
  maxPatches: number,
): number[] {
  const S = bytes.length;
  if (S === 0) return [0];

  const boundaries: number[] = [0];
  let i = 0;

  while (i < S) {
    if (entropy[i] >= threshold) {
      boundaries.push(i + 1);
      i++;
    } else {
      let j = i + 1;
      while (j < S && entropy[j] < threshold && (j - i) < 8) {
        j++;
      }
      boundaries.push(j);
      i = j;
    }

    if (boundaries.length - 1 >= maxPatches) {
      boundaries[boundaries.length - 1] = S;
      break;
    }
  }

  if (boundaries[boundaries.length - 1] !== S) {
    boundaries.push(S);
  }

  return boundaries;
}

// ==================== 反向传播函数 ====================

/**
 * ByteEmbedding 反向：梯度 scatter 到 weight
 * gradOutput: [S, embedDim]
 * byteIds: [S] 原始字节值
 */
export function byteEmbeddingBackward(
  gradOutput: Float32Array,
  byteIds: number[],
  weight: Tensor,
  embedDim: number,
): void {
  if (!weight.grad) weight.grad = new Float32Array(weight.size);
  for (let s = 0; s < byteIds.length; s++) {
    const byteVal = byteIds[s] & 0xFF;
    const srcOff = s * embedDim;
    const dstOff = byteVal * embedDim;
    for (let d = 0; d < embedDim; d++) {
      weight.grad[dstOff + d] += gradOutput[srcOff + d];
    }
  }
}

/**
 * poolPatches 反向：梯度均分回原始位置
 * gradOutput: [numPatches, D]
 * boundaries: patch 边界
 * originalLen: 原始序列长度
 * D: 嵌入维度
 */
export function poolPatchesBackward(
  gradOutput: Float32Array,
  boundaries: number[],
  originalLen: number,
  D: number,
): Float32Array {
  const grad = new Float32Array(originalLen * D);
  const numPatches = boundaries.length - 1;
  for (let p = 0; p < numPatches; p++) {
    const start = boundaries[p];
    const end = boundaries[p + 1];
    const len = end - start;
    if (len <= 0) continue;
    const gradOff = p * D;
    for (let s = start; s < end; s++) {
      const gOff = s * D;
      for (let d = 0; d < D; d++) {
        grad[gOff + d] += gradOutput[gradOff + d] / len;
      }
    }
  }
  return grad;
}

/**
 * applyRoPE 反向：逆旋转
 * gradOutput: [S, D]
 * positions: [S]
 * D: 维度
 */
export function applyRoPEBackward(
  gradOutput: Float32Array,
  positions: number[],
  D: number,
): Float32Array {
  const S = positions.length;
  const grad = new Float32Array(S * D);
  const halfD = D / 2;
  for (let s = 0; s < S; s++) {
    const pos = positions[s];
    const rowOff = s * D;
    for (let i = 0; i < halfD; i++) {
      const theta = pos / Math.pow(10000, (2 * i) / D);
      const cosVal = Math.cos(theta);
      const sinVal = Math.sin(theta);
      const g1 = gradOutput[rowOff + 2 * i];
      const g2 = gradOutput[rowOff + 2 * i + 1];
      grad[rowOff + 2 * i] = g1 * cosVal + g2 * sinVal;
      grad[rowOff + 2 * i + 1] = -g1 * sinVal + g2 * cosVal;
    }
  }
  return grad;
}

/**
 * AttentionPooling 反向
 * gradOutput: [1, dModel] 来自下游
 * x: [S, dModel] 原始输入
 * 返回: gradX [S, dModel]
 * 同时更新 query, keyWeight, keyBias, temperature 的梯度
 */
export function attentionPoolingBackward(
  gradOutput: Float32Array,
  x: Tensor,
  queryData: Float32Array,
  keyWeightData: Float32Array,
  keyBiasData: Float32Array,
  tempValue: number,
  dModel: number,
  query: Tensor,
  keyWeight: Tensor,
  keyBias: Tensor,
  temperature: Tensor,
): Float32Array {
  const S = x.shape[0];

  // 重算 attention weights
  const scores = new Float32Array(S);
  for (let s = 0; s < S; s++) {
    let dot = 0;
    const off = s * dModel;
    for (let d = 0; d < dModel; d++) {
      let kv = keyBiasData[d];
      for (let k = 0; k < dModel; k++) {
        kv += x.data[off + k] * keyWeightData[k * dModel + d];
      }
      dot += queryData[d] * kv;
    }
    scores[s] = dot / tempValue;
  }
  let maxS = -Infinity;
  for (let s = 0; s < S; s++) { if (scores[s] > maxS) maxS = scores[s]; }
  let sumS = 0;
  for (let s = 0; s < S; s++) { scores[s] = Math.exp(scores[s] - maxS); sumS += scores[s]; }
  for (let s = 0; s < S; s++) { scores[s] /= sumS; }
  const weights = scores;

  // gradX = weights^T @ gradOutput (broadcast)
  const gradX = new Float32Array(S * dModel);
  for (let s = 0; s < S; s++) {
    const off = s * dModel;
    for (let d = 0; d < dModel; d++) {
      gradX[off + d] = weights[s] * gradOutput[d];
    }
  }

  // gradScores = sum_d(gradOutput[d] * x[s,d])
  const gradScores = new Float32Array(S);
  for (let s = 0; s < S; s++) {
    let dot = 0;
    const off = s * dModel;
    for (let d = 0; d < dModel; d++) {
      dot += gradOutput[d] * x.data[off + d];
    }
    gradScores[s] = dot / tempValue;
  }

  // softmax backward → gradRawScores
  const gradRawScores = new Float32Array(S);
  let sumGradWeights = 0;
  for (let s = 0; s < S; s++) { sumGradWeights += gradScores[s] * weights[s]; }
  for (let s = 0; s < S; s++) {
    gradRawScores[s] = weights[s] * (gradScores[s] - sumGradWeights);
  }

  // gradTemp
  let gradTemp = 0;
  for (let s = 0; s < S; s++) { gradTemp += gradRawScores[s] * (-scores[s] / tempValue); }
  if (!temperature.grad) temperature.grad = new Float32Array(1);
  temperature.grad[0] += gradTemp;

  // 计算 keysWithBias 和 gradKeysWithBias
  const keysWithBias = new Float32Array(S * dModel);
  for (let s = 0; s < S; s++) {
    const off = s * dModel;
    for (let d = 0; d < dModel; d++) {
      let kv = keyBiasData[d];
      for (let k = 0; k < dModel; k++) {
        kv += x.data[off + k] * keyWeightData[k * dModel + d];
      }
      keysWithBias[off + d] = kv;
    }
  }

  // gradQuery = sum_s(gradRawScores[s] * keysWithBias[s])
  if (!query.grad) query.grad = new Float32Array(dModel);
  for (let d = 0; d < dModel; d++) {
    let sum = 0;
    for (let s = 0; s < S; s++) { sum += gradRawScores[s] * keysWithBias[s * dModel + d]; }
    query.grad[d] += sum;
  }

  // gradKeys = gradRawScores[s] * query
  // gradKeyWeight += x[s,k]^T * gradKeys[s,d]
  // gradKeyBias += gradKeys[s,d]
  // gradX += gradKeys * keyWeight^T
  if (!keyWeight.grad) keyWeight.grad = new Float32Array(dModel * dModel);
  if (!keyBias.grad) keyBias.grad = new Float32Array(dModel);
  for (let s = 0; s < S; s++) {
    const off = s * dModel;
    for (let d = 0; d < dModel; d++) {
      const gkd = gradRawScores[s] * queryData[d];
      keyBias.grad[d] += gkd;
      for (let k = 0; k < dModel; k++) {
        keyWeight.grad[k * dModel + d] += x.data[off + k] * gkd;
        gradX[off + k] += gkd * keyWeightData[k * dModel + d];
      }
    }
  }

  return gradX;
}

/**
 * 直接执行单个 tensor 的 backward op（不初始化梯度）
 * 与 tensor.ts 的 _backwardOp 逻辑相同，但跳过 grad fill
 */
function _backwardOpDirect(t: Tensor): void {
  const ctx = t._ctx!;
  const g = t.grad!;

  function _accumulateGrad(parent: Tensor, pg: Float32Array): void {
    if (!parent.grad) {
      parent.grad = new Float32Array(pg);
    } else {
      for (let i = 0; i < pg.length; i++) parent.grad[i] += pg[i];
    }
  }

  switch (ctx.op) {
    case 'matmul': {
      const [a, b] = ctx.parents;
      const [M, K] = a.shape;
      const N = b.shape[1];
      const ga = new Float32Array(a.size);
      const gb = new Float32Array(b.size);
      for (let i = 0; i < M; i++) {
        for (let k = 0; k < K; k++) {
          let sum = 0;
          for (let j = 0; j < N; j++) {
            sum += g[i * N + j] * b.data[k * N + j];
            gb[k * N + j] += g[i * N + j] * a.data[i * K + k];
          }
          ga[i * K + k] = sum;
        }
      }
      _accumulateGrad(a, ga);
      _accumulateGrad(b, gb);
      break;
    }
    case 'add': {
      const [a, b] = ctx.parents;
      _accumulateGrad(a, g);
      if (a.shape.length === 2 && b.shape.length === 1) {
        const gb = new Float32Array(b.size);
        const [M, N] = a.shape;
        for (let i = 0; i < M; i++) for (let j = 0; j < N; j++) gb[j] += g[i * N + j];
        _accumulateGrad(b, gb);
      } else {
        _accumulateGrad(b, g);
      }
      break;
    }
    case 'gelu': {
      const a = ctx.parents[0];
      const ga = new Float32Array(a.size);
      const sqrt2OverPi = 0.7978845608;
      const coeff = 0.044715;
      for (let i = 0; i < a.size; i++) {
        const x = a.data[i];
        const inner = sqrt2OverPi * (x + coeff * x * x * x);
        const tanhInner = Math.tanh(inner);
        const sech2 = 1 - tanhInner * tanhInner;
        const derivative = 0.5 * (1 + tanhInner) + 0.5 * x * sech2 * sqrt2OverPi * (1 + 3 * coeff * x * x);
        ga[i] = g[i] * derivative;
      }
      _accumulateGrad(a, ga);
      break;
    }
    case 'softmax': {
      const a = ctx.parents[0];
      const out = softmax(a);
      const ga = new Float32Array(a.size);
      if (a.shape.length === 2) {
        const [rows, cols] = a.shape;
        for (let i = 0; i < rows; i++) {
          for (let j = 0; j < cols; j++) {
            let sum = 0;
            for (let k = 0; k < cols; k++) {
              const s = out.data[i * cols + k];
              sum += g[i * cols + k] * s * ((j === k ? 1 : 0) - out.data[i * cols + j]);
            }
            ga[i * cols + j] = sum;
          }
        }
      }
      _accumulateGrad(a, ga);
      break;
    }
    case 'layerNorm': {
      const eps = ctx.saved[0] as number;
      const [a, weight, bias] = ctx.parents;
      const lastDim = a.shape[a.shape.length - 1];
      const outerSize = a.size / lastDim;
      const ga = new Float32Array(a.size);
      const gw = new Float32Array(weight.size);
      const gb = new Float32Array(bias.size);
      for (let i = 0; i < outerSize; i++) {
        const off = i * lastDim;
        let mean = 0;
        for (let j = 0; j < lastDim; j++) mean += a.data[off + j];
        mean /= lastDim;
        let variance = 0;
        for (let j = 0; j < lastDim; j++) { const d = a.data[off + j] - mean; variance += d * d; }
        variance /= lastDim;
        const invStd = 1 / Math.sqrt(variance + eps);
        const xNorm = new Float32Array(lastDim);
        for (let j = 0; j < lastDim; j++) xNorm[j] = (a.data[off + j] - mean) * invStd;
        for (let j = 0; j < lastDim; j++) {
          gw[j] += g[off + j] * xNorm[j];
          gb[j] += g[off + j];
        }
        let dotGxNorm = 0, dotGw = 0;
        for (let j = 0; j < lastDim; j++) {
          dotGxNorm += g[off + j] * weight.data[j] * xNorm[j];
          dotGw += g[off + j] * weight.data[j];
        }
        for (let j = 0; j < lastDim; j++) {
          ga[off + j] = invStd * weight.data[j] * (g[off + j] - dotGw / lastDim - xNorm[j] * dotGxNorm / lastDim);
        }
      }
      _accumulateGrad(a, ga);
      _accumulateGrad(weight, gw);
      _accumulateGrad(bias, gb);
      break;
    }
    case 'scores': {
      const s = ctx.saved[0] as number;
      const [q, k] = ctx.parents;
      const [B, H, S, D] = q.shape;
      const gq = new Float32Array(q.size);
      const gk = new Float32Array(k.size);
      for (let b = 0; b < B; b++) {
        for (let h = 0; h < H; h++) {
          for (let i = 0; i < S; i++) {
            for (let j = 0; j < S; j++) {
              const gij = g[((b * H + h) * S + i) * S + j] * s;
              for (let d = 0; d < D; d++) {
                gq[((b * H + h) * S + i) * D + d] += gij * k.data[((b * H + h) * S + j) * D + d];
                gk[((b * H + h) * S + j) * D + d] += gij * q.data[((b * H + h) * S + i) * D + d];
              }
            }
          }
        }
      }
      _accumulateGrad(q, gq);
      _accumulateGrad(k, gk);
      break;
    }
    case 'weightedSum': {
      const [w, v] = ctx.parents;
      const [B, H, S, S2] = w.shape;
      const D = v.shape[3];
      const gw = new Float32Array(w.size);
      const gv = new Float32Array(v.size);
      for (let b = 0; b < B; b++) {
        for (let h = 0; h < H; h++) {
          for (let i = 0; i < S; i++) {
            for (let d = 0; d < D; d++) {
              const gid = g[((b * H + h) * S + i) * D + d];
              for (let j = 0; j < S2; j++) {
                gw[((b * H + h) * S + i) * S2 + j] += gid * v.data[((b * H + h) * S + j) * D + d];
                gv[((b * H + h) * S + j) * D + d] += gid * w.data[((b * H + h) * S + i) * S2 + j];
              }
            }
          }
        }
      }
      _accumulateGrad(w, gw);
      _accumulateGrad(v, gv);
      break;
    }
    case 'view':
    case 'transpose':
    case 'contiguous': {
      const a = ctx.parents[0];
      _accumulateGrad(a, g);
      break;
    }
    case 'poolLast': {
      const a = ctx.parents[0];
      const seqLen = ctx.saved[0] as number;
      const dModel = a.shape[1];
      if (!a.grad) a.grad = new Float32Array(a.size);
      const off = (seqLen - 1) * dModel;
      for (let i = 0; i < dModel; i++) a.grad[off + i] += g[i];
      break;
    }
    case 'cat': {
      const dim = ctx.saved[0] as number;
      let offset = 0;
      for (const p of ctx.parents) {
        const pSize = p.size;
        const pg = g.slice(offset, offset + pSize);
        _accumulateGrad(p, pg);
        offset += pSize;
      }
      break;
    }
  }
}

/**
 * 对合并后的 patches 做平均池化
 */
export function poolPatches(embedded: Tensor, boundaries: number[]): Tensor {
  const S = embedded.shape[0];
  const D = embedded.shape[1];
  const numPatches = boundaries.length - 1;
  const data = new Float32Array(numPatches * D);
  const src = embedded.data;

  for (let p = 0; p < numPatches; p++) {
    const start = boundaries[p];
    const end = boundaries[p + 1];
    const len = end - start;
    if (len <= 0) continue;

    const dstOff = p * D;
    for (let s = start; s < end; s++) {
      const srcOff = s * D;
      for (let d = 0; d < D; d++) {
        data[dstOff + d] += src[srcOff + d];
      }
    }
    for (let d = 0; d < D; d++) {
      data[dstOff + d] /= len;
    }
  }

  return new Tensor(data, [numPatches, D]);
}

// ==================== AttentionPooling ====================

/**
 * 注意力池化 — 替代 mean pooling
 *
 * 学习哪些 token 更重要，用可学习的 query 向量做注意力加权。
 * 比 mean pooling 更智能：能区分关键信息和噪声。
 *
 * [S, D] → [1, D]
 */
export class AttentionPooling {
  /** 可学习的查询向量 [1, D] */
  query: Tensor;
  /** Key 投影 [D, D] */
  keyWeight: Tensor;
  /** Key 偏置 [D] */
  keyBias: Tensor;
  /** 温度参数（可学习） */
  temperature: Tensor;
  dModel: number;

  constructor(dModel: number) {
    this.dModel = dModel;

    // query 初始化为小随机值
    const qData = new Float32Array(dModel);
    for (let i = 0; i < dModel; i++) {
      qData[i] = (Math.random() - 0.5) * 0.02;
    }
    this.query = new Tensor(qData, [1, dModel]);
    this.keyWeight = xavierUniform(dModel, dModel);
    this.keyBias = zeros([dModel]);
    // 温度 = sqrt(dModel)，类似 scaled dot-product
    this.temperature = new Tensor(new Float32Array([Math.sqrt(dModel)]), [1]);
  }

  /**
   * 前向：[S, D] → [1, D]
   */
  forward(x: Tensor): Tensor {
    const S = x.shape[0];
    const D = this.dModel;

    // keys = x @ keyWeight + keyBias: [S, D]
    const keys = matmul(x, this.keyWeight);
    const keysWithBias = add(keys, this.keyBias);

    // scores = query @ keys^T / temperature: [1, S]
    const qData = this.query.data;
    const scores = new Float32Array(S);
    const temp = this.temperature.data[0];

    for (let s = 0; s < S; s++) {
      let dot = 0;
      const off = s * D;
      for (let d = 0; d < D; d++) {
        dot += qData[d] * keysWithBias.data[off + d];
      }
      scores[s] = dot / temp;
    }

    // softmax
    let max = -Infinity;
    for (let s = 0; s < S; s++) {
      if (scores[s] > max) max = scores[s];
    }
    let sum = 0;
    for (let s = 0; s < S; s++) {
      scores[s] = Math.exp(scores[s] - max);
      sum += scores[s];
    }
    for (let s = 0; s < S; s++) {
      scores[s] /= sum;
    }

    // 加权求和: [1, D]
    const outData = new Float32Array(D);
    for (let s = 0; s < S; s++) {
      const off = s * D;
      for (let d = 0; d < D; d++) {
        outData[d] += scores[s] * x.data[off + d];
      }
    }

    return new Tensor(outData, [1, D]);
  }

  parameters(): Tensor[] {
    return [this.query, this.keyWeight, this.keyBias, this.temperature];
  }

  countParams(): number {
    return this.dModel + this.dModel * this.dModel + this.dModel + 1;
  }
}

/** forward 缓存的中间值 */
export interface TextEncoderCache {
  bytes: Uint8Array | number[];
  byteEmbedOut: Tensor;
  entropy: Float32Array;
  boundaries: number[];
  pooledOut: Tensor;
  projected: Tensor;
  positions: number[];
  ropeApplied: Tensor;
  encoderOut: Tensor;
}

// ==================== 辅助函数 ====================

/** L2 归一化：将向量缩放到单位球面 */
function l2Normalize(t: Tensor): Tensor {
  const data = new Float32Array(t.size);
  let norm = 0;
  for (let i = 0; i < t.size; i++) norm += t.data[i] * t.data[i];
  norm = Math.sqrt(norm);
  if (norm < 1e-8) return t; // 避免除零
  for (let i = 0; i < t.size; i++) data[i] = t.data[i] / norm;
  const out = new Tensor(data, t.shape);
  // 保留计算图（训练时需要反向）
  if (t._ctx) out._ctx = t._ctx;
  return out;
}

/** 给张量加高斯噪声（训练时用） */
function addGaussianNoise(t: Tensor, scale: number): Tensor {
  const data = new Float32Array(t.size);
  for (let i = 0; i < t.size; i++) {
    // Box-Muller 变换生成高斯噪声
    const u1 = Math.random() || 1e-10;
    const u2 = Math.random();
    const noise = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * scale;
    data[i] = t.data[i] + noise;
  }
  const out = new Tensor(data, t.shape);
  if (t._ctx) out._ctx = t._ctx;
  return out;
}

// ==================== TextEncoder ====================

export class TextEncoder {
  private config: TextEncoderConfig;
  private byteEmbedding: ByteEmbedding;
  private projection: { w: Tensor; b: Tensor };
  private encoderBlocks: Array<{ attn: MultiHeadAttention; ffn: FeedForward }> = [];
  private layerNorm: { weight: Tensor; bias: Tensor };
  /** V2: 可训练合并门控 */
  private learnedMerge: LearnedMerge;
  /** V2: 注意力池化（替代 mean pooling） */
  private attentionPooling: AttentionPooling;

  /** 训练时缓存的中间值（绑定到每次 forward 调用） */
  private _cached: TextEncoderCache | null = null;

  constructor(config?: Partial<TextEncoderConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const { byteEmbedDim, outputDim, numLayers, numHeads, ffnDim } = this.config;

    // 1. 字节嵌入
    this.byteEmbedding = new ByteEmbedding(byteEmbedDim);

    // 2. 投影层: byteEmbedDim → outputDim
    this.projection = {
      w: xavierUniform(byteEmbedDim, outputDim),
      b: zeros([outputDim]),
    };

    // 3. Encoder blocks
    for (let i = 0; i < numLayers; i++) {
      this.encoderBlocks.push({
        attn: new MultiHeadAttention(outputDim, numHeads),
        ffn: new FeedForward(outputDim, ffnDim),
      });
    }

    // 4. 最终 LayerNorm
    this.layerNorm = {
      weight: zeros([outputDim]),
      bias: zeros([outputDim]),
    };
    for (let i = 0; i < outputDim; i++) this.layerNorm.weight.data[i] = 1;

    // 5. V2: 可训练合并门控
    this.learnedMerge = new LearnedMerge(byteEmbedDim);

    // 6. V2: 注意力池化
    this.attentionPooling = new AttentionPooling(outputDim);
  }

  /**
   * 前向：文本 → 合并后的 patch 序列 [S', outputDim]
   *
   * V2 流程：
   * 1. 文本 → UTF-8 字节
   * 2. 字节嵌入 [S, byteEmbedDim]
   * 3. 熵估算 + LearnedMerge 合并 → boundaries
   * 4. 池化 patches [S', byteEmbedDim]
   * 5. 投影 [S', outputDim]
   * 6. RoPE 位置编码
   * 7. EncoderBlock×4 (self-attention + FFN)
   * 8. LayerNorm
   */
  forward(text: string): Tensor {
    // 1. UTF-8 字节
    const encoder = new TextEncoder_API();
    const bytes = encoder.encode(text);

    // 2. 字节嵌入
    const embedded = this.byteEmbedding.forward(bytes);

    // 3. 熵估算 + LearnedMerge（可训练合并）
    const entropy = estimateEntropy(bytes, 2);
    const boundaries = this.learnedMerge.computeMergeBoundaries(
      embedded, entropy, this.config.maxSeqLen,
    );

    // 4. 池化 patches
    let pooled = poolPatches(embedded, boundaries);

    // 5. 投影: [S', byteEmbedDim] → [S', outputDim]
    let projected = this.project(pooled);

    // 6. RoPE 位置编码
    const seqLen = projected.shape[0];
    const positions = Array.from({ length: seqLen }, (_, i) => i);
    let ropeApplied = applyRoPE(projected, positions);

    // 7. Encoder blocks
    let encoderOut = ropeApplied;
    for (const block of this.encoderBlocks) {
      encoderOut = block.attn.forward(encoderOut);
      encoderOut = block.ffn.forward(encoderOut);
    }

    // 8. 最终 LayerNorm
    let result = layerNorm(encoderOut, this.layerNorm.weight, this.layerNorm.bias);

    // 训练时缓存中间值
    if (!isInferenceMode()) {
      this._cached = {
        bytes,
        byteEmbedOut: embedded,
        entropy,
        boundaries,
        pooledOut: pooled,
        projected,
        positions,
        ropeApplied,
        encoderOut,
      };
    }

    return result;
  }

  /**
   * 训练用前向：返回结果 + 缓存（不存到 this._cached）
   * 每次调用产生独立的缓存，不会互相覆盖
   */
  forwardWithCache(text: string): { result: Tensor; cache: TextEncoderCache } {
    const encoder = new TextEncoder_API();
    const bytes = encoder.encode(text);
    const embedded = this.byteEmbedding.forward(bytes);
    const entropy = estimateEntropy(bytes, 2);
    const boundaries = this.learnedMerge.computeMergeBoundaries(
      embedded, entropy, this.config.maxSeqLen,
    );
    let pooled = poolPatches(embedded, boundaries);
    let projected = this.project(pooled);
    const seqLen = projected.shape[0];
    const positions = Array.from({ length: seqLen }, (_, i) => i);
    let ropeApplied = applyRoPE(projected, positions);
    let encoderOut = ropeApplied;
    for (const block of this.encoderBlocks) {
      encoderOut = block.attn.forward(encoderOut);
      encoderOut = block.ffn.forward(encoderOut);
    }
    let result = layerNorm(encoderOut, this.layerNorm.weight, this.layerNorm.bias);

    const cache: TextEncoderCache = {
      bytes, byteEmbedOut: embedded, entropy, boundaries,
      pooledOut: pooled, projected, positions, ropeApplied, encoderOut,
    };
    return { result, cache };
  }

  /**
   * 前向 + 池化：文本 → 单向量 [1, outputDim]
   * V2: 使用 AttentionPooling 替代 mean pooling
   * 输出 L2 归一化，防止向量范数坍塌
   */
  forwardPooled(text: string): Tensor {
    const seq = this.forward(text);
    const pooled = this.attentionPooling.forward(seq);
    return l2Normalize(pooled);
  }

  /**
   * 训练用前向 + 池化 + 噪声注入
   * SimCSE 需要同一文本的两次前向产生不同表示
   * 在 encoder 输出上加高斯噪声，模拟 dropout 效果
   */
  forwardPooledNoisy(text: string, noiseScale = 0.1): Tensor {
    const { result: seq, cache } = this.forwardWithCache(text);
    // 给 encoder 输出加噪声（在 pooling 之前）
    const noisySeq = addGaussianNoise(seq, noiseScale);
    const pooled = this.attentionPooling.forward(noisySeq);
    return l2Normalize(pooled);
  }

  /** 单独做注意力池化（训练时用，不触发新的 forward 缓存） */
  attentionPoolingForward(seq: Tensor): Tensor {
    return this.attentionPooling.forward(seq);
  }

  /**
   * 反向传播：从 pooled 输出的梯度，传播到所有可训练参数
   *
   * 流程：gradOutput → AttentionPooling.backward → LayerNorm.backward
   *       → EncoderBlocks.backward (autograd) → RoPE.backward
   *       → Projection.backward → poolPatches.backward → ByteEmbedding.backward
   *
   * @param gradOutput [1, outputDim] 来自 InfoNCE 的梯度
   * @param encoderOutput [S, outputDim] forward() 返回的 encoder 输出（LN 后、pooling 前）
   * @param cache forwardWithCache 返回的缓存
   */
  backward(gradOutput: Float32Array, encoderOutput: Tensor, cache: TextEncoderCache): void {
    const { byteEmbedOut: embedded, boundaries, positions, bytes } = cache;
    const { outputDim, byteEmbedDim } = this.config;
    const seqLen = positions.length;
    if (seqLen === 0) return;

    // 1. AttentionPooling backward → grad 到 encoder 最终输出
    const gradSeq = attentionPoolingBackward(
      gradOutput,
      encoderOutput,
      this.attentionPooling.query.data,
      this.attentionPooling.keyWeight.data,
      this.attentionPooling.keyBias.data,
      this.attentionPooling.temperature.data[0],
      outputDim,
      this.attentionPooling.query,
      this.attentionPooling.keyWeight,
      this.attentionPooling.keyBias,
      this.attentionPooling.temperature,
    );

    // 2. 最终 LayerNorm backward
    const gradAfterLN = new Float32Array(seqLen * outputDim);
    gradAfterLN.set(gradSeq);

    // 手动计算 LayerNorm backward
    const lnIn = cache.encoderOut;
    const lnW = this.layerNorm.weight;
    const lnB = this.layerNorm.bias;
    const eps = 1e-5;
    for (let i = 0; i < seqLen; i++) {
      const off = i * outputDim;
      let mean = 0;
      for (let j = 0; j < outputDim; j++) mean += lnIn.data[off + j];
      mean /= outputDim;
      let variance = 0;
      for (let j = 0; j < outputDim; j++) {
        const diff = lnIn.data[off + j] - mean;
        variance += diff * diff;
      }
      variance /= outputDim;
      const invStd = 1 / Math.sqrt(variance + eps);

      const xNorm = new Float32Array(outputDim);
      for (let j = 0; j < outputDim; j++) {
        xNorm[j] = (lnIn.data[off + j] - mean) * invStd;
      }

      if (!lnW.grad) lnW.grad = new Float32Array(lnW.size);
      if (!lnB.grad) lnB.grad = new Float32Array(lnB.size);
      for (let j = 0; j < outputDim; j++) {
        lnW.grad[j] += gradAfterLN[off + j] * xNorm[j];
        lnB.grad[j] += gradAfterLN[off + j];
      }

      let dotGxNorm = 0;
      for (let j = 0; j < outputDim; j++) {
        dotGxNorm += gradAfterLN[off + j] * lnW.data[j] * xNorm[j];
      }
      let dotGw = 0;
      for (let j = 0; j < outputDim; j++) {
        dotGw += gradAfterLN[off + j] * lnW.data[j];
      }
      for (let j = 0; j < outputDim; j++) {
        gradAfterLN[off + j] = invStd * lnW.data[j] * (
          gradAfterLN[off + j] - dotGw / outputDim - xNorm[j] * dotGxNorm / outputDim
        );
      }
    }

    // 3. Encoder blocks backward（手动沿计算图传播）
    // 从 lnIn (encoder blocks 最后输出) 开始，反向穿过每个 block
    let gradAccum = new Float32Array(gradAfterLN);

    // 反向遍历 encoder blocks（每块: attn(LN(x)) + x → ffn(LN(y)) + y）
    for (let blockIdx = this.encoderBlocks.length - 1; blockIdx >= 0; blockIdx--) {
      const block = this.encoderBlocks[blockIdx];
      // 对每个 block，输入是 ropeApplied（blockIdx==0）或上一个 block 的输出
      // 输出是下一个 block 的输入（或 lnIn）
      // 我们需要知道每个 block 的输入和输出
      // 但由于我们没有缓存每个 block 的中间值，这里用 autograd
    }

    // 用 autograd 从 encoderOut (lnIn) 反向传播
    // 问题：backward() 会 fill(1)，但我们已有梯度
    // 解决：手动遍历计算图
    {
      const visited = new Set<Tensor>();
      const order: Tensor[] = [];
      const queue: Tensor[] = [lnIn];
      while (queue.length > 0) {
        const t = queue.shift()!;
        if (visited.has(t)) continue;
        visited.add(t);
        order.push(t);
        if (t._ctx) {
          for (const p of t._ctx.parents) {
            if (!visited.has(p)) queue.push(p);
          }
        }
      }
      // 设置 lnIn 的梯度（不覆盖）
      if (!lnIn.grad) lnIn.grad = new Float32Array(lnIn.size);
      for (let i = 0; i < gradAccum.length; i++) lnIn.grad[i] += gradAccum[i];
      // 反向执行
      for (const t of order) {
        if (!t._ctx || !t.grad) continue;
        _backwardOpDirect(t);
      }
    }

    // ropeApplied 的梯度来自 encoder blocks 的输入梯度
    const ropeApplied = cache.ropeApplied;
    const gradAfterRope = ropeApplied.grad
      ? new Float32Array(ropeApplied.grad)
      : new Float32Array(seqLen * outputDim);

    // 4. RoPE backward（逆旋转）
    const gradAfterProjection = applyRoPEBackward(gradAfterRope, positions, outputDim);

    // 5. Projection backward
    const projected = cache.projected;
    const gradW = new Float32Array(byteEmbedDim * outputDim);
    const gradB = new Float32Array(outputDim);
    for (let s = 0; s < seqLen; s++) {
      const gOff = s * outputDim;
      for (let d = 0; d < outputDim; d++) {
        const g = gradAfterProjection[gOff + d];
        gradB[d] += g;
        for (let k = 0; k < byteEmbedDim; k++) {
          gradW[k * outputDim + d] += cache.pooledOut.data[s * byteEmbedDim + k] * g;
        }
      }
    }
    if (!this.projection.w.grad) this.projection.w.grad = new Float32Array(this.projection.w.size);
    if (!this.projection.b.grad) this.projection.b.grad = new Float32Array(this.projection.b.size);
    for (let i = 0; i < this.projection.w.size; i++) this.projection.w.grad[i] += gradW[i];
    for (let i = 0; i < this.projection.b.size; i++) this.projection.b.grad[i] += gradB[i];

    // gradPooledOut = gradAfterProjection @ projection.w^T
    const gradPooledOut = new Float32Array(seqLen * byteEmbedDim);
    for (let s = 0; s < seqLen; s++) {
      for (let k = 0; k < byteEmbedDim; k++) {
        let sum = 0;
        for (let d = 0; d < outputDim; d++) {
          sum += gradAfterProjection[s * outputDim + d] * this.projection.w.data[k * outputDim + d];
        }
        gradPooledOut[s * byteEmbedDim + k] = sum;
      }
    }

    // 6. poolPatches backward
    const gradEmbedded = poolPatchesBackward(
      gradPooledOut, boundaries, embedded.shape[0], byteEmbedDim,
    );

    // 7. ByteEmbedding backward
    byteEmbeddingBackward(
      gradEmbedded,
      Array.from(bytes),
      this.byteEmbedding.weight,
      byteEmbedDim,
    );
  }

  /**
   * 投影层前向: [S, byteEmbedDim] → [S, outputDim]
   */
  private project(x: Tensor): Tensor {
    const out = matmul(x, this.projection.w);
    const S = out.shape[0];
    const D = out.shape[1];
    for (let s = 0; s < S; s++) {
      const off = s * D;
      for (let d = 0; d < D; d++) {
        out.data[off + d] += this.projection.b.data[d];
      }
    }
    return out;
  }

  /** 获取所有可训练参数 */
  parameters(): Tensor[] {
    const params: Tensor[] = [
      ...this.byteEmbedding.parameters(),
      this.projection.w,
      this.projection.b,
    ];
    for (const block of this.encoderBlocks) {
      params.push(...block.attn.parameters());
      params.push(...block.ffn.parameters());
    }
    params.push(this.layerNorm.weight, this.layerNorm.bias);
    // V2 新增参数
    params.push(...this.learnedMerge.parameters());
    params.push(...this.attentionPooling.parameters());
    return params;
  }

  /** 参数计数 */
  countParams(): number {
    return this.parameters().reduce((sum, t) => sum + t.size, 0);
  }

  /** 序列化为 ArrayBuffer */
  serialize(): ArrayBuffer {
    const params = this.parameters();
    let totalFloats = 0;
    for (const p of params) totalFloats += p.size;

    // Header: 7 floats (config) + 1 int (paramCount) + per-param: 1 int (rank) + rank ints (dims)
    const headerFloats = 7;
    const headerInts = 1 + params.length + params.reduce((s, p) => s + p.shape.length, 0);
    const headerBytes = headerFloats * 4 + headerInts * 4;
    const weightBytes = totalFloats * 4;
    const buf = new ArrayBuffer(headerBytes + weightBytes);

    // 写入 config (7 floats)
    const f32 = new Float32Array(buf);
    let fOff = 0;
    f32[fOff++] = this.config.byteEmbedDim;
    f32[fOff++] = this.config.outputDim;
    f32[fOff++] = this.config.numLayers;
    f32[fOff++] = this.config.numHeads;
    f32[fOff++] = this.config.ffnDim;
    f32[fOff++] = this.config.mergeEntropyThreshold;
    f32[fOff++] = this.config.maxSeqLen;

    // 写入 param count + shapes (ints)
    const i32 = new Int32Array(buf, headerFloats * 4);
    let iOff = 0;
    i32[iOff++] = params.length;
    for (const p of params) {
      i32[iOff++] = p.shape.length;
      for (const dim of p.shape) i32[iOff++] = dim;
    }

    // 写入 weights
    let byteOff = headerBytes;
    for (const p of params) {
      const fView = new Float32Array(buf, byteOff, p.size);
      fView.set(p.data);
      byteOff += p.size * 4;
    }

    return buf;
  }

  /** 从 ArrayBuffer 反序列化 */
  static deserialize(data: ArrayBuffer): TextEncoder {
    const f32 = new Float32Array(data);
    let fOff = 0;

    // 读取 config
    const config: TextEncoderConfig = {
      byteEmbedDim: f32[fOff++],
      outputDim: f32[fOff++],
      numLayers: f32[fOff++],
      numHeads: f32[fOff++],
      ffnDim: f32[fOff++],
      mergeEntropyThreshold: f32[fOff++],
      maxSeqLen: f32[fOff++],
    };

    const encoder = new TextEncoder(config);

    // 读取 param count + shapes
    const i32 = new Int32Array(data, fOff * 4);
    let iOff = 0;
    const paramCount = i32[iOff++];
    const shapes: number[][] = [];
    for (let i = 0; i < paramCount; i++) {
      const rank = i32[iOff++];
      const shape: number[] = [];
      for (let r = 0; r < rank; r++) shape.push(i32[iOff++]);
      shapes.push(shape);
    }

    // 读取 weights
    const params = encoder.parameters();
    let byteOff = (fOff * 4) + (iOff * 4);
    for (let i = 0; i < paramCount && i < params.length; i++) {
      const p = params[i];
      const src = new Float32Array(data, byteOff, p.size);
      p.data.set(src);
      byteOff += p.size * 4;
    }

    return encoder;
  }
}

// 重命名避免与全局 TextEncoder API 冲突
const TextEncoder_API = globalThis.TextEncoder;
