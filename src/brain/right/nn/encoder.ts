/**
 * Encoder Block
 *
 * Multi-Head Self-Attention + Feed-Forward
 * 每个 block = Attention + FFN（都用 Pre-LN + Residual）
 *
 * 支持 batch > 1：[S, dModel] 或 [B, S, dModel]
 */

import { Tensor } from './tensor.js';
import { MultiHeadAttention } from './attention.js';
import { FeedForward } from './ffn.js';

export class EncoderBlock {
  attention: MultiHeadAttention;
  ffn: FeedForward;

  constructor(dModel: number, numHeads: number, ffnDim: number) {
    this.attention = new MultiHeadAttention(dModel, numHeads);
    this.ffn = new FeedForward(dModel, ffnDim);
  }

  /**
   * 前向
   *
   * 支持两种输入格式：
   * - [S, dModel] — batch=1（向后兼容）
   * - [B, S, dModel] — batch>1
   */
  forward(x: Tensor, useCausalMask = true): Tensor {
    const attnOut = this.attention.forward(x, useCausalMask);
    return this.ffn.forward(attnOut);
  }

  parameters(): Tensor[] {
    return [...this.attention.parameters(), ...this.ffn.parameters()];
  }
}
