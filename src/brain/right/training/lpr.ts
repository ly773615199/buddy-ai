/**
 * Layerwise Proximal Replay (LPR) — 防遗忘机制
 *
 * 基于 ICML 2024 论文
 * 在每个参数的 loss 上加近端项：λ * ||w - w_snapshot||²
 * 防止学习新知识时遗忘旧知识
 */

import type { Tensor } from '../nn/tensor.js';

export class LPR {
  private lambda: number;
  private snapshot: Map<Tensor, Float32Array> = new Map();
  private snapshotInterval: number;
  private stepsSinceSnapshot = 0;

  constructor(lambda = 0.1, snapshotInterval = 100) {
    this.lambda = lambda;
    this.snapshotInterval = snapshotInterval;
  }

  /** 保存当前权重快照 */
  takeSnapshot(params: Tensor[]): void {
    this.snapshot.clear();
    for (const p of params) {
      this.snapshot.set(p, new Float32Array(p.data));
    }
  }

  /** 将 LPR 正则项梯度加到参数梯度上 */
  applyGradients(params: Tensor[]): void {
    if (this.snapshot.size === 0) return;

    for (const p of params) {
      const snapData = this.snapshot.get(p);
      if (!snapData) continue;

      if (!p.grad) p.grad = new Float32Array(p.size);
      for (let i = 0; i < p.size; i++) {
        // LPR 正则梯度：λ * 2 * (w - w_snapshot)
        p.grad[i] += this.lambda * 2 * (p.data[i] - snapData[i]);
      }
    }
  }

  /** 计算 LPR 惩罚值（用于监控） */
  computePenalty(params: Tensor[]): number {
    if (this.snapshot.size === 0) return 0;

    let penalty = 0;
    for (const p of params) {
      const snapData = this.snapshot.get(p);
      if (!snapData) continue;

      for (let i = 0; i < p.size; i++) {
        const diff = p.data[i] - snapData[i];
        penalty += diff * diff;
      }
    }
    return this.lambda * penalty;
  }

  /** 步进，返回是否需要更新快照 */
  step(params: Tensor[]): boolean {
    this.stepsSinceSnapshot++;
    if (this.stepsSinceSnapshot >= this.snapshotInterval) {
      this.takeSnapshot(params);
      this.stepsSinceSnapshot = 0;
      return true;
    }
    return false;
  }
}
