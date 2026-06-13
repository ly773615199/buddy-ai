/**
 * Multi-Head Self-Attention
 *
 * 输入: [S, dModel] 或 [B, S, dModel]
 * 输出: [S, dModel] 或 [B, S, dModel]
 *
 * 内部：Q/K/V 投影 → 分头 → 缩放点积 → softmax → 加权求和 → 合并 → 输出投影
 * 支持 batch > 1（batch=1 时行为与旧版完全一致）
 */

import {
  Tensor, zeros, randn, xavierUniform,
  matmul, batchMatmul, matmulAddBias, matmulAddBias3, add, softmax, scale, layerNorm,
  scaledDotProductScores, attentionWeightedSum,
  reshape, transposeLast2, cat,
  maskedSoftmax, causalMask, isInferenceMode,
} from './tensor.js';

export class MultiHeadAttention {
  // 投影权重 [dModel, dModel]
  wq: Tensor;
  wk: Tensor;
  wv: Tensor;
  wo: Tensor;
  // 投影偏置 [dModel]
  bq: Tensor;
  bk: Tensor;
  bv: Tensor;
  bo: Tensor;
  // LayerNorm
  lnWeight: Tensor;
  lnBias: Tensor;

  dModel: number;
  numHeads: number;
  headDim: number;

  constructor(dModel: number, numHeads: number) {
    this.dModel = dModel;
    this.numHeads = numHeads;
    this.headDim = Math.floor(dModel / numHeads);

    this.wq = xavierUniform(dModel, dModel);
    this.wk = xavierUniform(dModel, dModel);
    this.wv = xavierUniform(dModel, dModel);
    this.wo = xavierUniform(dModel, dModel);

    this.bq = zeros([dModel]);
    this.bk = zeros([dModel]);
    this.bv = zeros([dModel]);
    this.bo = zeros([dModel]);

    this.lnWeight = zeros([dModel]); lnFill(this.lnWeight);
    this.lnBias = zeros([dModel]);
  }

  /**
   * 前向（带 residual connection）
   *
   * 支持两种输入格式：
   * - [S, dModel] — batch=1（向后兼容）
   * - [B, S, dModel] — batch>1
   *
   * 输出格式与输入一致
   */
  forward(x: Tensor, useCausalMask = true): Tensor {
    const isBatch = x.shape.length === 3;
    const B = isBatch ? x.shape[0] : 1;
    const S = isBatch ? x.shape[1] : x.shape[0];
    const H = this.numHeads;
    const D = this.headDim;

    // 展平为 [B*S, dModel] 做 LayerNorm + 投影
    const flatShape = [B * S, this.dModel];
    const flat = isBatch ? reshape(x, flatShape) : x;

    // LayerNorm (Pre-LN)
    const normed = layerNorm(flat, this.lnWeight, this.lnBias);

    // Q/K/V 投影: [B*S, dModel] × [dModel, dModel] → [B*S, dModel]
    let q: Tensor, k: Tensor, v: Tensor;
    if (isInferenceMode()) {
      q = matmulAddBias(normed, this.wq, this.bq);
      k = matmulAddBias(normed, this.wk, this.bk);
      v = matmulAddBias(normed, this.wv, this.bv);
    } else {
      q = add(batchMatmul(normed, this.wq), this.bq);
      k = add(batchMatmul(normed, this.wk), this.bk);
      v = add(batchMatmul(normed, this.wv), this.bv);
    }

    // 分头：[B*S, dModel] → [B, S, H, D]
    const qh = reshape(q, [B, S, H, D]);
    const kh = reshape(k, [B, S, H, D]);
    const vh = reshape(v, [B, S, H, D]);

    // 转置为 [B, H, S, D]
    const qht = transpose4D(qh);
    const kht = transpose4D(kh);
    const vht = transpose4D(vh);

    // 缩放点积分数: [B, H, S, S]
    let scores = scaledDotProductScores(qht, kht);

    // Causal mask
    if (useCausalMask) {
      const mask = causalMask(S);
      scores = addMask(scores, mask, H);
    }

    // Softmax: [B, H, S, S]
    const weights = softmax(scores);

    // 加权求和: [B, H, S, D]
    const context = attentionWeightedSum(weights, vht);

    // 合并头：[B, H, S, D] → [B*S, dModel]
    const merged = mergeHeads(context, B, S, H, D);

    // 输出投影: [B*S, dModel]
    let out: Tensor;
    if (isInferenceMode()) {
      out = matmulAddBias(merged, this.wo, this.bo);
    } else {
      out = add(batchMatmul(merged, this.wo), this.bo);
    }

    // Residual connection
    const result = add(out, flat);

    // 恢复原始形状
    if (isBatch) {
      return reshape(result, [B, S, this.dModel]);
    }
    return result;
  }

  parameters(): Tensor[] {
    return [this.wq, this.wk, this.wv, this.wo, this.bq, this.bk, this.bv, this.bo, this.lnWeight, this.lnBias];
  }
}

/** 填充为 1 */
function lnFill(t: Tensor): void {
  for (let i = 0; i < t.size; i++) t.data[i] = 1;
}

/** [B, S, H, D] → [B, H, S, D] */
function transpose4D(a: Tensor): Tensor {
  const [B, S, H, D] = a.shape;
  const out = zeros([B, H, S, D]);
  for (let b = 0; b < B; b++) {
    for (let s = 0; s < S; s++) {
      for (let h = 0; h < H; h++) {
        for (let d = 0; d < D; d++) {
          out.data[((b * H + h) * S + s) * D + d] =
            a.data[((b * S + s) * H + h) * D + d];
        }
      }
    }
  }
  if (!isInferenceMode()) {
    out._ctx = { op: 'transpose', saved: [], parents: [a] };
  }
  return out;
}

/** [B, H, S, S] + [S, S] 广播 → [B, H, S, S] */
function addMask(scores: Tensor, mask: Tensor, H: number): Tensor {
  const [B, _H, S, S2] = scores.shape;
  const out = zeros([B, _H, S, S2]);
  for (let b = 0; b < B; b++) {
    for (let h = 0; h < _H; h++) {
      for (let i = 0; i < S; i++) {
        for (let j = 0; j < S2; j++) {
          out.data[((b * _H + h) * S + i) * S2 + j] =
            scores.data[((b * _H + h) * S + i) * S2 + j] + mask.data[i * S2 + j];
        }
      }
    }
  }
  if (!isInferenceMode()) {
    out._ctx = { op: 'add', saved: [], parents: [scores, mask] };
  }
  return out;
}

/** [B, H, S, D] → [B*S, dModel] */
function mergeHeads(a: Tensor, B: number, S: number, H: number, D: number): Tensor {
  const dModel = H * D;
  const out = zeros([B * S, dModel]);
  for (let b = 0; b < B; b++) {
    for (let s = 0; s < S; s++) {
      for (let h = 0; h < H; h++) {
        for (let d = 0; d < D; d++) {
          out.data[(b * S + s) * dModel + h * D + d] =
            a.data[((b * H + h) * S + s) * D + d];
        }
      }
    }
  }
  if (!isInferenceMode()) {
    out._ctx = { op: 'transpose', saved: [], parents: [a] };
  }
  return out;
}
