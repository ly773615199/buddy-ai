/**
 * Embedding 层 — 查表嵌入
 *
 * forward: token_ids → vectors
 * backward: 梯度 scatter 到权重矩阵
 */

import { Tensor, zeros, randn, isInferenceMode } from './tensor.js';

export class Embedding {
  weight: Tensor; // [vocabSize, embedDim]
  vocabSize: number;
  embedDim: number;

  constructor(vocabSize: number, embedDim: number) {
    this.vocabSize = vocabSize;
    this.embedDim = embedDim;
    // Xavier 初始化
    const limit = Math.sqrt(6 / (vocabSize + embedDim));
    this.weight = randn([vocabSize, embedDim], limit);
  }

  /**
   * 前向：token_ids [seqLen] → [seqLen, embedDim]
   */
  forward(tokenIds: number[]): Tensor {
    const seqLen = tokenIds.length;
    const out = zeros([seqLen, this.embedDim]);
    for (let i = 0; i < seqLen; i++) {
      const id = tokenIds[i];
      if (id < 0 || id >= this.vocabSize) continue;
      const srcOff = id * this.embedDim;
      const dstOff = i * this.embedDim;
      for (let d = 0; d < this.embedDim; d++) {
        out.data[dstOff + d] = this.weight.data[srcOff + d];
      }
    }
    // 缓存 tokenIds 用于反向
    if (!isInferenceMode()) {
      out._ctx = { op: 'embedding', saved: [tokenIds], parents: [this.weight] };
    }
    return out;
  }

  /**
   * 批量前向：token_ids [B, S] → [B, S, embedDim]
   */
  forwardBatch(batchTokenIds: number[][]): Tensor {
    const B = batchTokenIds.length;
    const S = batchTokenIds[0].length;
    const out = zeros([B, S, this.embedDim]);
    for (let b = 0; b < B; b++) {
      const ids = batchTokenIds[b];
      for (let i = 0; i < S; i++) {
        const id = ids[i];
        if (id < 0 || id >= this.vocabSize) continue;
        const srcOff = id * this.embedDim;
        const dstOff = (b * S + i) * this.embedDim;
        for (let d = 0; d < this.embedDim; d++) {
          out.data[dstOff + d] = this.weight.data[srcOff + d];
        }
      }
    }
    // 扁平化 tokenIds 用于反向
    if (!isInferenceMode()) {
      const flatIds: number[] = [];
      for (const ids of batchTokenIds) flatIds.push(...ids);
      out._ctx = { op: 'embedding', saved: [flatIds], parents: [this.weight] };
    }
    return out;
  }

  parameters(): Tensor[] {
    return [this.weight];
  }
}

/** Embedding 反向：梯度 scatter 到权重 */
export function backwardEmbedding(t: Tensor): void {
  if (!t._ctx || t._ctx.op !== 'embedding' || !t.grad) return;
  const tokenIds = t._ctx.saved[0] as number[];
  const weight = t._ctx.parents[0];
  const embedDim = t.shape[t.shape.length - 1];

  if (!weight.grad) weight.grad = new Float32Array(weight.size);
  for (let i = 0; i < tokenIds.length; i++) {
    const id = tokenIds[i];
    if (id < 0 || id >= weight.shape[0]) continue;
    const srcOff = i * embedDim;
    const dstOff = id * embedDim;
    for (let d = 0; d < embedDim; d++) {
      weight.grad[dstOff + d] += t.grad[srcOff + d];
    }
  }
}
