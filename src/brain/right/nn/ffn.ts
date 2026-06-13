/**
 * Feed-Forward Network (FFN)
 *
 * 两层 MLP + GELU 激活
 * dModel → ffnDim → dModel
 * 带 Pre-LayerNorm + Residual
 *
 * 支持 batch > 1：[S, dModel] 或 [B, S, dModel]
 */

import {
  Tensor, zeros, xavierUniform,
  matmul, batchMatmul, matmulAddBias, matmulAddBiasGelu,
  add, gelu, layerNorm, reshape,
  isInferenceMode,
} from './tensor.js';

export class FeedForward {
  // 第一层
  w1: Tensor; // [dModel, ffnDim]
  b1: Tensor; // [ffnDim]
  // 第二层
  w2: Tensor; // [ffnDim, dModel]
  b2: Tensor; // [dModel]
  // LayerNorm
  lnWeight: Tensor;
  lnBias: Tensor;

  dModel: number;
  ffnDim: number;

  constructor(dModel: number, ffnDim: number) {
    this.dModel = dModel;
    this.ffnDim = ffnDim;

    this.w1 = xavierUniform(dModel, ffnDim);
    this.b1 = zeros([ffnDim]);
    this.w2 = xavierUniform(ffnDim, dModel);
    this.b2 = zeros([dModel]);

    this.lnWeight = zeros([dModel]); fillOnes(this.lnWeight);
    this.lnBias = zeros([dModel]);
  }

  /**
   * 前向（带 residual）
   *
   * 支持两种输入格式：
   * - [S, dModel] — batch=1（向后兼容）
   * - [B, S, dModel] — batch>1
   */
  forward(x: Tensor): Tensor {
    const isBatch = x.shape.length === 3;

    if (!isBatch) {
      // batch=1 路径（向后兼容，零开销）
      const normed = layerNorm(x, this.lnWeight, this.lnBias);
      if (isInferenceMode()) {
        // 融合 matmul+bias+gelu，消除 1 个中间 Tensor
        const h = matmulAddBiasGelu(normed, this.w1, this.b1);
        const out = matmulAddBias(h, this.w2, this.b2);
        return add(out, x);
      }
      const h = gelu(add(matmul(normed, this.w1), this.b1));
      const out = add(matmul(h, this.w2), this.b2);
      return add(out, x);
    }

    // batch>1 路径
    const [B, S, D] = x.shape;
    const flat = reshape(x, [B * S, D]);

    const normed = layerNorm(flat, this.lnWeight, this.lnBias);
    const h = gelu(add(batchMatmul(normed, this.w1), this.b1));
    const out = add(batchMatmul(h, this.w2), this.b2);
    const result = add(out, flat);

    return reshape(result, [B, S, D]);
  }

  parameters(): Tensor[] {
    return [this.w1, this.b1, this.w2, this.b2, this.lnWeight, this.lnBias];
  }
}

function fillOnes(t: Tensor): void {
  for (let i = 0; i < t.size; i++) t.data[i] = 1;
}
