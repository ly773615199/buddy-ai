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
  isInferenceMode,
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
    let patches = poolPatches(embedded, boundaries);

    // 5. 投影: [S', byteEmbedDim] → [S', outputDim]
    patches = this.project(patches);

    // 6. RoPE 位置编码
    const seqLen = patches.shape[0];
    const positions = Array.from({ length: seqLen }, (_, i) => i);
    patches = applyRoPE(patches, positions);

    // 7. Encoder blocks
    for (const block of this.encoderBlocks) {
      patches = block.attn.forward(patches);
      patches = block.ffn.forward(patches);
    }

    // 8. 最终 LayerNorm
    patches = layerNorm(patches, this.layerNorm.weight, this.layerNorm.bias);

    return patches;
  }

  /**
   * 前向 + 池化：文本 → 单向量 [1, outputDim]
   * V2: 使用 AttentionPooling 替代 mean pooling
   */
  forwardPooled(text: string): Tensor {
    const seq = this.forward(text);
    return this.attentionPooling.forward(seq);
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
