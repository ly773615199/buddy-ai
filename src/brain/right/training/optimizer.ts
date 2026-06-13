/**
 * 优化器 — SGD with momentum + learning rate scheduling
 *
 * 支持：
 * - 基础 SGD
 * - 动量（Momentum）
 * - 学习率衰减（指数 / 余弦退火）
 * - 梯度裁剪
 */

import type { Tensor } from '../nn/tensor.js';

export interface OptimizerConfig {
  learningRate: number;
  momentum: number;          // 动量系数（0 = 无动量）
  weightDecay: number;       // L2 正则化系数
  maxGradNorm: number;       // 梯度裁剪阈值（0 = 不裁剪）
  schedule: 'constant' | 'exponential' | 'cosine';
  scheduleParams: {
    decayRate?: number;      // 指数衰减率
    decaySteps?: number;     // 每隔多少步衰减
    minLr?: number;          // 最低学习率
    totalSteps?: number;     // 余弦退火总步数
  };
}

const DEFAULT_CONFIG: OptimizerConfig = {
  learningRate: 0.001,
  momentum: 0.9,
  weightDecay: 0,
  maxGradNorm: 1.0,
  schedule: 'exponential',
  scheduleParams: {
    decayRate: 0.9999,
    decaySteps: 1,
    minLr: 1e-5,
  },
};

export class SGD {
  private config: OptimizerConfig;
  private step = 0;
  private currentLr: number;
  private velocity: Map<Tensor, Float32Array> = new Map();

  constructor(config?: Partial<OptimizerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentLr = this.config.learningRate;
  }

  /**
   * 执行一步参数更新
   *
   * 1. 梯度裁剪
   * 2. 动量更新
   * 3. 权重衰减
   * 4. 参数更新
   */
  step_update(params: Tensor[]): void {
    this.step++;

    // 全局梯度裁剪
    if (this.config.maxGradNorm > 0) {
      this._clipGradients(params);
    }

    // 更新学习率
    this.currentLr = this._scheduleLr();

    for (const p of params) {
      if (!p.grad) continue;

      // 获取或初始化速度
      if (!this.velocity.has(p)) {
        this.velocity.set(p, new Float32Array(p.size));
      }
      const v = this.velocity.get(p)!;

      for (let i = 0; i < p.size; i++) {
        let g = p.grad[i];

        // L2 正则化
        if (this.config.weightDecay > 0) {
          g += this.config.weightDecay * p.data[i];
        }

        // 动量更新
        if (this.config.momentum > 0) {
          v[i] = this.config.momentum * v[i] + g;
          p.data[i] -= this.currentLr * v[i];
        } else {
          p.data[i] -= this.currentLr * g;
        }
      }
    }
  }

  /** 获取当前学习率 */
  get lr(): number {
    return this.currentLr;
  }

  /** 获取当前步数 */
  get totalSteps(): number {
    return this.step;
  }

  /** 重置步数（用于新的训练阶段） */
  resetSteps(): void {
    this.step = 0;
  }

  /** 清除动量状态 */
  clearVelocity(): void {
    this.velocity.clear();
  }

  // ── 内部 ──

  /** 学习率调度 */
  private _scheduleLr(): number {
    const cfg = this.config.scheduleParams;

    switch (this.config.schedule) {
      case 'constant':
        return this.config.learningRate;

      case 'exponential': {
        const rate = cfg.decayRate ?? 0.9999;
        const steps = cfg.decaySteps ?? 1;
        const minLr = cfg.minLr ?? 1e-5;
        const lr = this.config.learningRate * Math.pow(rate, this.step / steps);
        return Math.max(lr, minLr);
      }

      case 'cosine': {
        const total = cfg.totalSteps ?? 10000;
        const minLr = cfg.minLr ?? 1e-5;
        const progress = Math.min(this.step / total, 1);
        const lr = minLr + 0.5 * (this.config.learningRate - minLr) * (1 + Math.cos(Math.PI * progress));
        return lr;
      }

      default:
        return this.config.learningRate;
    }
  }

  /** 全局梯度裁剪（按范数） */
  private _clipGradients(params: Tensor[]): void {
    // 计算全局梯度范数
    let totalNormSq = 0;
    for (const p of params) {
      if (!p.grad) continue;
      for (let i = 0; i < p.size; i++) {
        totalNormSq += p.grad[i] * p.grad[i];
      }
    }
    const totalNorm = Math.sqrt(totalNormSq);

    if (totalNorm > this.config.maxGradNorm) {
      const scale = this.config.maxGradNorm / totalNorm;
      for (const p of params) {
        if (!p.grad) continue;
        for (let i = 0; i < p.size; i++) {
          p.grad[i] *= scale;
        }
      }
    }
  }
}
