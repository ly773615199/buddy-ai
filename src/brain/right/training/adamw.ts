/**
 * AdamW 优化器 — 自适应学习率 + 解耦权重衰减
 *
 * AdamW = Adam + decoupled weight decay
 * 比 SGD 收敛更快、泛化更好，是 Transformer 预训的标准优化器。
 *
 * 更新规则：
 *   m_t = β1 * m_{t-1} + (1 - β1) * g_t          （一阶矩）
 *   v_t = β2 * v_{t-1} + (1 - β2) * g_t²          （二阶矩）
 *   m̂_t = m_t / (1 - β1^t)                         （偏差校正）
 *   v̂_t = v_t / (1 - β2^t)                         （偏差校正）
 *   θ_t = θ_{t-1} - lr * (m̂_t / (√v̂_t + ε) + λ * θ_{t-1})  （解耦权重衰减）
 */

import type { Tensor } from '../nn/tensor.js';

export interface AdamWConfig {
  learningRate: number;
  beta1: number;        // 一阶矩衰减率，默认 0.9
  beta2: number;        // 二阶矩衰减率，默认 0.999
  epsilon: number;      // 数值稳定性，默认 1e-8
  weightDecay: number;  // 解耦权重衰减系数，默认 0.01
  maxGradNorm: number;  // 梯度裁剪阈值，0=不裁剪
  schedule: 'constant' | 'cosine' | 'linear';
  scheduleParams: {
    warmupSteps?: number;
    totalSteps?: number;
    minLr?: number;
  };
}

const DEFAULT_CONFIG: AdamWConfig = {
  learningRate: 3e-4,
  beta1: 0.9,
  beta2: 0.999,
  epsilon: 1e-8,
  weightDecay: 0.01,
  maxGradNorm: 1.0,
  schedule: 'cosine',
  scheduleParams: {
    warmupSteps: 1000,
    totalSteps: 100000,
    minLr: 1e-6,
  },
};

export class AdamW {
  private config: AdamWConfig;
  private step = 0;
  /** 每个参数的优化器状态 */
  private states = new Map<Float32Array, {
    m: Float32Array;  // 一阶矩
    v: Float32Array;  // 二阶矩
  }>();

  constructor(config?: Partial<AdamWConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 执行一步优化
   * @param params 可训练参数列表
   */
  step_(params: Tensor[]): void {
    this.step++;

    // 梯度裁剪
    if (this.config.maxGradNorm > 0) {
      this.clipGradients(params, this.config.maxGradNorm);
    }

    // 计算当前学习率（含 warmup + schedule）
    const lr = this.getCurrentLr();
    const { beta1, beta2, epsilon, weightDecay } = this.config;
    const biasCorrection1 = 1 - Math.pow(beta1, this.step);
    const biasCorrection2 = 1 - Math.pow(beta2, this.step);

    for (const param of params) {
      if (!param.grad) continue;

      const grad = param.grad;
      const data = param.data;
      const size = data.length;

      // 获取或初始化状态
      let state = this.states.get(param.data);
      if (!state) {
        state = {
          m: new Float32Array(size),
          v: new Float32Array(size),
        };
        this.states.set(param.data, state);
      }

      const { m, v } = state;

      for (let i = 0; i < size; i++) {
        const g = grad[i];

        // 更新一阶矩和二阶矩
        m[i] = beta1 * m[i] + (1 - beta1) * g;
        v[i] = beta2 * v[i] + (1 - beta2) * g * g;

        // 偏差校正
        const mHat = m[i] / biasCorrection1;
        const vHat = v[i] / biasCorrection2;

        // Adam 更新 + 解耦权重衰减
        data[i] -= lr * (mHat / (Math.sqrt(vHat) + epsilon) + weightDecay * data[i]);
      }
    }
  }

  /**
   * 获取当前学习率（含 warmup + cosine schedule）
   */
  private getCurrentLr(): number {
    const { learningRate, schedule, scheduleParams } = this.config;
    const { warmupSteps = 0, totalSteps = 100000, minLr = 1e-6 } = scheduleParams;

    if (this.step <= warmupSteps) {
      // 线性 warmup
      return learningRate * (this.step / Math.max(warmupSteps, 1));
    }

    switch (schedule) {
      case 'constant':
        return learningRate;

      case 'cosine': {
        // 余弦退火
        const progress = (this.step - warmupSteps) / Math.max(totalSteps - warmupSteps, 1);
        const clamped = Math.min(progress, 1);
        return minLr + (learningRate - minLr) * 0.5 * (1 + Math.cos(Math.PI * clamped));
      }

      case 'linear': {
        // 线性衰减
        const progress = (this.step - warmupSteps) / Math.max(totalSteps - warmupSteps, 1);
        const clamped = Math.min(progress, 1);
        return Math.max(minLr, learningRate * (1 - clamped));
      }

      default:
        return learningRate;
    }
  }

  /**
   * 梯度裁剪：全局 L2 范数裁剪
   */
  private clipGradients(params: Tensor[], maxNorm: number): void {
    // 计算全局梯度范数
    let totalNormSq = 0;
    for (const param of params) {
      if (!param.grad) continue;
      for (let i = 0; i < param.grad.length; i++) {
        totalNormSq += param.grad[i] * param.grad[i];
      }
    }
    const totalNorm = Math.sqrt(totalNormSq);

    if (totalNorm > maxNorm) {
      const scale = maxNorm / totalNorm;
      for (const param of params) {
        if (!param.grad) continue;
        for (let i = 0; i < param.grad.length; i++) {
          param.grad[i] *= scale;
        }
      }
    }
  }

  /** 获取当前步数 */
  getStep(): number {
    return this.step;
  }

  /** 重置状态 */
  reset(): void {
    this.step = 0;
    this.states.clear();
  }
}
