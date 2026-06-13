/**
 * ByteEncoder — 字节级文本编码器
 *
 * 纯 TypeScript，零 npm 依赖
 * 将自然语言文本映射到 128 维语义向量
 *
 * 组件：
 * - ByteEmbedding(256, 32): 字节查表嵌入
 * - EntropyEstimator: 基于字节频率的局部熵估算
 * - DynamicMerge: 熵驱动动态合并（高熵保留，低熵合并）
 * - Projection(32→128): 线性投影
 * - EncoderBlock×2: 复用 attention.ts + ffn.ts (d=128, h=4, ffn=256)
 *
 * 参数量: ~145K
 */

import {
  Tensor, zeros, randn, xavierUniform,
  matmul, add, layerNorm, softmax, reshape,
  isInferenceMode,
} from '../nn/tensor.js';
import { MultiHeadAttention } from '../nn/attention.js';
import { FeedForward } from '../nn/ffn.js';

// ==================== 配置 ====================

export interface TextEncoderConfig {
  byteEmbedDim: number;           // 默认 32
  outputDim: number;              // 默认 128
  numLayers: number;              // 默认 2
  numHeads: number;               // 默认 4
  ffnDim: number;                 // 默认 256
  mergeEntropyThreshold: number;  // 默认 1.5
  maxSeqLen: number;              // 默认 512
}

const DEFAULT_CONFIG: TextEncoderConfig = {
  byteEmbedDim: 32,
  outputDim: 128,
  numLayers: 2,
  numHeads: 4,
  ffnDim: 256,
  mergeEntropyThreshold: 1.5,
  maxSeqLen: 512,
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

/**
 * 基于字节频率的局部熵估算
 * 在滑动窗口内计算 Shannon 熵，用于驱动动态合并
 *
 * 纯计算，无参数
 */

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
 * 使用左右各 windowRadius 字节的滑动窗口
 *
 * @returns Float32Array[S] 每个位置的熵值
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

// ==================== DynamicMerge ====================

/**
 * 熵驱动的动态合并
 *
 * 高熵位置（信息量大，如"部署"、"deploy"）→ 保留独立 token
 * 低熵位置（信息量小，如"的"、"the"）→ 与相邻合并为 1 个 patch
 *
 * 受 BLT (Meta 2024) + MrT5 (Stanford 2024) 启发
 * 不是固定窗口 Conv1D，是逐字节判断
 *
 * @returns 合并后的 patch 边界索引数组
 *   例: [0, 3, 5] 表示 bytes[0:3] 为 patch 0, bytes[3:5] 为 patch 1
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
      // 高熵：保留为独立 patch
      boundaries.push(i + 1);
      i++;
    } else {
      // 低熵：向后合并，直到遇到高熵或结束
      let j = i + 1;
      while (j < S && entropy[j] < threshold && (j - i) < 8) {
        j++;
      }
      boundaries.push(j);
      i = j;
    }

    // 限制 patch 数量
    if (boundaries.length - 1 >= maxPatches) {
      // 剩余全部合并为最后一个 patch
      boundaries[boundaries.length - 1] = S;
      break;
    }
  }

  // 确保最后一个边界是 S
  if (boundaries[boundaries.length - 1] !== S) {
    boundaries.push(S);
  }

  return boundaries;
}

/**
 * 对合并后的 patches 做平均池化
 *
 * @param embedded [S, D] 嵌入后的字节序列
 * @param boundaries patch 边界索引
 * @returns [numPatches, D] 池化后的 patch 表示
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
    // 平均
    for (let d = 0; d < D; d++) {
      data[dstOff + d] /= len;
    }
  }

  return new Tensor(data, [numPatches, D]);
}

// ==================== TextEncoder ====================

export class TextEncoder {
  private config: TextEncoderConfig;
  private byteEmbedding: ByteEmbedding;
  private projection: { w: Tensor; b: Tensor };
  private encoderBlocks: Array<{ attn: MultiHeadAttention; ffn: FeedForward }> = [];
  private layerNorm: { weight: Tensor; bias: Tensor };

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
    // fill weight with 1
    for (let i = 0; i < outputDim; i++) this.layerNorm.weight.data[i] = 1;
  }

  /**
   * 前向：文本 → 合并后的 patch 序列 [S', outputDim]
   *
   * 流程：
   * 1. 文本 → UTF-8 字节
   * 2. 字节嵌入 [S, byteEmbedDim]
   * 3. 熵估算 + 动态合并 → boundaries
   * 4. 池化 patches [S', byteEmbedDim]
   * 5. 投影 [S', outputDim]
   * 6. EncoderBlock×2 (self-attention + FFN)
   * 7. LayerNorm
   */
  forward(text: string): Tensor {
    // 1. UTF-8 字节
    const encoder = new TextEncoder_API();
    const bytes = encoder.encode(text);

    // 2. 字节嵌入
    const embedded = this.byteEmbedding.forward(bytes);

    // 3. 熵估算 + 动态合并
    const entropy = estimateEntropy(bytes, 2);
    const boundaries = dynamicMerge(bytes, entropy, this.config.mergeEntropyThreshold, this.config.maxSeqLen);

    // 4. 池化 patches
    let patches = poolPatches(embedded, boundaries);

    // 5. 投影: [S', byteEmbedDim] → [S', outputDim]
    patches = this.project(patches);

    // 6. Encoder blocks
    for (const block of this.encoderBlocks) {
      patches = block.attn.forward(patches);
      patches = block.ffn.forward(patches);
    }

    // 7. 最终 LayerNorm
    patches = layerNorm(patches, this.layerNorm.weight, this.layerNorm.bias);

    return patches;
  }

  /**
   * 前向 + 池化：文本 → 单向量 [1, outputDim]
   * 对 forward() 输出做 mean pooling
   */
  forwardPooled(text: string): Tensor {
    const seq = this.forward(text);
    return this.meanPool(seq);
  }

  /**
   * 投影层前向: [S, byteEmbedDim] → [S, outputDim]
   */
  private project(x: Tensor): Tensor {
    // matmul: [S, byteEmbedDim] × [byteEmbedDim, outputDim] = [S, outputDim]
    const out = matmul(x, this.projection.w);
    // 加偏置
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

  /**
   * Mean pooling: [S, D] → [1, D]
   */
  private meanPool(x: Tensor): Tensor {
    const S = x.shape[0];
    const D = x.shape[1];
    const data = new Float32Array(D);

    for (let s = 0; s < S; s++) {
      const off = s * D;
      for (let d = 0; d < D; d++) {
        data[d] += x.data[off + d];
      }
    }
    for (let d = 0; d < D; d++) {
      data[d] /= S || 1;
    }

    return new Tensor(data, [1, D]);
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

    // 使用 Uint8Array 作为底层 buffer，避免 Float32/Int32 偏移冲突
    // Header: 7 floats (config) + 1 int (paramCount) + per-param: 1 int (rank) + rank ints (dims)
    const headerFloats = 7;
    const headerInts = 1 + params.length + params.reduce((s, p) => s + p.shape.length, 0);
    const headerBytes = headerFloats * 4 + headerInts * 4;
    const weightBytes = totalFloats * 4;
    const buf = new ArrayBuffer(headerBytes + weightBytes);
    const u8 = new Uint8Array(buf);

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
