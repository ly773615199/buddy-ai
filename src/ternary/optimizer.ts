/**
 * t-SignSGD 优化器 — 三进制增量训练核心
 *
 * 算法原理：
 * 1. 维护全精度 "latent" 权重 (Float32)
 * 2. 每步用 SignSGD 更新 latent: w = w - lr * sign(grad)
 * 3. 三值化: W_t = clip(round(w / scale), -1, 1)
 * 4. 缩放因子: scale = mean(|w|) per output channel
 *
 * 这样梯度信息保留在 latent 中，三进制权重只存 {-1, 0, 1}。
 */

import type { TernaryLayer } from './format.js';

// ── 优化器配置 ──

export interface OptimizerConfig {
  /** 学习率 */
  learningRate: number;
  /** 三值化阈值 (权重绝对值低于此值 → 0) */
  threshold: number;
  /** 权重衰减 */
  weightDecay: number;
  /** 梯度裁剪上限 */
  gradClip: number;
  /** 是否使用动量 */
  useMomentum: boolean;
  /** 动量系数 */
  momentumBeta: number;
}

const DEFAULT_OPTIMIZER_CONFIG: OptimizerConfig = {
  learningRate: 0.01,
  threshold: 0.05,
  weightDecay: 0.0001,
  gradClip: 1.0,
  useMomentum: true,
  momentumBeta: 0.9,
};

// ── Latent 权重状态 ──

export interface LatentWeights {
  /** 全精度 A 矩阵 (inFeatures × rank) */
  latentA: Float32Array;
  /** 全精度 B 矩阵 (rank × outFeatures) */
  latentB: Float32Array;
  /** A 矩阵动量 (可选) */
  momentumA?: Float32Array;
  /** B 矩阵动量 (可选) */
  momentumB?: Float32Array;
}

// ── 梯度 ──

export interface LayerGradients {
  /** A 矩阵梯度 */
  gradA: Float32Array;
  /** B 矩阵梯度 */
  gradB: Float32Array;
}

// ── 训练统计 ──

export interface OptimizerStats {
  /** 当前步数 */
  step: number;
  /** 当前学习率 */
  learningRate: number;
  /** A 矩阵三值化比例 (|w| > threshold 的占比) */
  ternaryRatioA: number;
  /** B 矩阵三值化比例 */
  ternaryRatioB: number;
  /** 梯度范数 */
  gradNorm: number;
}

// ════════════════════════════════════════════════════════
// t-SignSGD 优化器
// ════════════════════════════════════════════════════════

export class TernaryOptimizer {
  private config: OptimizerConfig;
  private stepCount = 0;
  private layerStates: Map<number, LatentWeights> = new Map();

  constructor(config?: Partial<OptimizerConfig>) {
    this.config = { ...DEFAULT_OPTIMIZER_CONFIG, ...config };
  }

  /**
   * 初始化 latent 权重（从三进制层展开）
   *
   * 三进制权重 {-1, 0, 1} → Float32 × scale
   */
  initLatentWeights(layer: TernaryLayer, inFeatures: number, rank: number, outFeatures: number): LatentWeights {
    const latentA = new Float32Array(inFeatures * rank);
    const latentB = new Float32Array(rank * outFeatures);

    // 从三进制权重还原（乘以初始 scale）
    const scaleA = this.computeScale(layer.A, inFeatures, rank);
    const scaleB = this.computeScale(layer.B, rank, outFeatures);

    for (let i = 0; i < latentA.length; i++) {
      latentA[i] = layer.A[i] * scaleA;
    }
    for (let i = 0; i < latentB.length; i++) {
      latentB[i] = layer.B[i] * scaleB;
    }

    const state: LatentWeights = {
      latentA,
      latentB,
    };

    if (this.config.useMomentum) {
      state.momentumA = new Float32Array(inFeatures * rank);
      state.momentumB = new Float32Array(rank * outFeatures);
    }

    this.layerStates.set(layer.layerIndex, state);
    return state;
  }

  /**
   * 单步优化
   *
   * 1. 梯度裁剪
   * 2. 动量更新 (可选)
   * 3. SignSGD: w = w - lr * sign(grad)
   * 4. 权重衰减
   * 5. 三值化: 更新三进制权重
   *
   * @returns 更新后的三进制层
   */
  step(layer: TernaryLayer, gradients: LayerGradients, inFeatures: number, rank: number, outFeatures: number): TernaryLayer {
    let state = this.layerStates.get(layer.layerIndex);
    if (!state) {
      state = this.initLatentWeights(layer, inFeatures, rank, outFeatures);
    }

    const lr = this.config.learningRate;
    const wd = this.config.weightDecay;
    const beta = this.config.momentumBeta;

    // 1. 梯度裁剪
    const clippedA = this.clipGradients(gradients.gradA, this.config.gradClip);
    const clippedB = this.clipGradients(gradients.gradB, this.config.gradClip);

    // 2-3. 更新 A
    this.signSGDUpdate(state.latentA, clippedA, state.momentumA, lr, wd, beta);

    // 2-3. 更新 B
    this.signSGDUpdate(state.latentB, clippedB, state.momentumB, lr, wd, beta);

    // 4. 三值化
    const newA = this.ternarize(state.latentA, inFeatures, rank);
    const newB = this.ternarize(state.latentB, rank, outFeatures);

    this.stepCount++;

    return {
      layerIndex: layer.layerIndex,
      A: newA,
      B: newB,
      scales: layer.scales,
      offsets: layer.offsets,
    };
  }

  /**
   * 获取 latent 权重
   */
  getLatentWeights(layerIndex: number): LatentWeights | undefined {
    return this.layerStates.get(layerIndex);
  }

  /**
   * 获取当前步数
   */
  getStep(): number {
    return this.stepCount;
  }

  /**
   * 获取当前学习率（支持衰减）
   */
  get learningRate(): number {
    return this.config.learningRate;
  }

  /**
   * 重置优化器状态
   */
  reset(): void {
    this.layerStates.clear();
    this.stepCount = 0;
  }

  /**
   * 序列化优化器状态（用于 checkpoint）
   */
  serialize(): OptimizerCheckpoint {
    const layers: Record<string, { latentA: number[]; latentB: number[] }> = {};
    for (const [idx, state] of this.layerStates) {
      layers[String(idx)] = {
        latentA: Array.from(state.latentA),
        latentB: Array.from(state.latentB),
      };
    }
    return {
      step: this.stepCount,
      config: this.config,
      layers,
    };
  }

  /**
   * 从 checkpoint 恢复
   */
  restore(checkpoint: OptimizerCheckpoint): void {
    this.stepCount = checkpoint.step;
    this.config = { ...this.config, ...checkpoint.config };
    this.layerStates.clear();

    for (const [idxStr, data] of Object.entries(checkpoint.layers)) {
      const idx = Number(idxStr);
      const state: LatentWeights = {
        latentA: new Float32Array(data.latentA),
        latentB: new Float32Array(data.latentB),
      };
      if (this.config.useMomentum) {
        state.momentumA = new Float32Array(data.latentA.length);
        state.momentumB = new Float32Array(data.latentB.length);
      }
      this.layerStates.set(idx, state);
    }
  }

  // ── 内部方法 ──

  /**
   * SignSGD 更新: w = w - lr * (sign(grad) + wd * w)
   */
  private signSGDUpdate(
    weights: Float32Array,
    gradients: Float32Array,
    momentum: Float32Array | undefined,
    lr: number,
    wd: number,
    beta: number,
  ): void {
    for (let i = 0; i < weights.length; i++) {
      let g = gradients[i];

      // 动量
      if (momentum) {
        momentum[i] = beta * momentum[i] + (1 - beta) * g;
        g = momentum[i];
      }

      // SignSGD + 权重衰减
      const sign = g > 0 ? 1 : g < 0 ? -1 : 0;
      weights[i] -= lr * (sign + wd * weights[i]);
    }
  }

  /**
   * 三值化: latent weights → {-1, 0, 1}
   *
   * 按行分组 (每行 = 一个输出通道)，计算 per-channel scale
   */
  private ternarize(latent: Float32Array, rows: number, cols: number): Int8Array {
    const result = new Int8Array(latent.length);

    for (let r = 0; r < rows; r++) {
      const offset = r * cols;

      // 计算该行的 scale (平均绝对值)
      let absSum = 0;
      for (let c = 0; c < cols; c++) {
        absSum += Math.abs(latent[offset + c]);
      }
      const scale = absSum / cols;

      if (scale < 1e-8) {
        // 全零行
        continue;
      }

      // 三值化
      for (let c = 0; c < cols; c++) {
        const normalized = latent[offset + c] / scale;
        if (normalized > this.config.threshold) {
          result[offset + c] = 1;
        } else if (normalized < -this.config.threshold) {
          result[offset + c] = -1;
        } else {
          result[offset + c] = 0;
        }
      }
    }

    return result;
  }

  /**
   * 计算 per-channel scale
   */
  private computeScale(weights: Int8Array, rows: number, cols: number): number {
    let totalAbs = 0;
    for (let i = 0; i < weights.length; i++) {
      totalAbs += Math.abs(weights[i]);
    }
    return weights.length > 0 ? totalAbs / weights.length : 1.0;
  }

  /**
   * 梯度裁剪 (按范数)
   */
  private clipGradients(grad: Float32Array, maxNorm: number): Float32Array {
    // 计算 L2 范数
    let norm = 0;
    for (let i = 0; i < grad.length; i++) {
      norm += grad[i] * grad[i];
    }
    norm = Math.sqrt(norm);

    if (norm <= maxNorm) {
      return grad;
    }

    // 缩放
    const scale = maxNorm / norm;
    const clipped = new Float32Array(grad.length);
    for (let i = 0; i < grad.length; i++) {
      clipped[i] = grad[i] * scale;
    }
    return clipped;
  }
}

// ── Checkpoint 格式 ──

export interface OptimizerCheckpoint {
  step: number;
  config: OptimizerConfig;
  layers: Record<string, { latentA: number[]; latentB: number[] }>;
}

// ── 工具函数 ──

/**
 * 从训练 loss 计算近似梯度（有限差分法）
 *
 * 用于没有自动微分的场景：通过 perturb 权重，观察 loss 变化。
 */
export function estimateGradient(
  weights: Int8Array,
  lossFn: (w: Int8Array) => number,
  epsilon = 1,
): Float32Array {
  const grad = new Float32Array(weights.length);
  const baseLoss = lossFn(weights);

  // 对每个权重扰动 ±epsilon
  // 优化：只采样一部分权重，降低计算量
  const sampleRate = Math.min(1.0, 1000 / weights.length);

  for (let i = 0; i < weights.length; i++) {
    if (Math.random() > sampleRate) {
      grad[i] = 0;
      continue;
    }

    const original = weights[i];

    // +epsilon
    weights[i] = Math.min(1, original + epsilon) as -1 | 0 | 1;
    const lossUp = lossFn(weights);

    // -epsilon
    weights[i] = Math.max(-1, original - epsilon) as -1 | 0 | 1;
    const lossDown = lossFn(weights);

    // 恢复
    weights[i] = original;

    // 中心差分
    grad[i] = (lossUp - lossDown) / (2 * epsilon);
  }

  // 用采样梯度的均值填充未采样位置
  let sampledSum = 0, sampledCount = 0;
  for (let i = 0; i < grad.length; i++) {
    if (grad[i] !== 0) {
      sampledSum += grad[i];
      sampledCount++;
    }
  }
  const avgGrad = sampledCount > 0 ? sampledSum / sampledCount : 0;
  for (let i = 0; i < grad.length; i++) {
    if (grad[i] === 0) grad[i] = avgGrad;
  }

  return grad;
}

/**
 * 计算两个三进制权重之间的 Hamming 距离
 */
export function hammingDistance(a: Int8Array, b: Int8Array): number {
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) dist++;
  }
  return dist;
}

/**
 * 计算权重变化率（有多少比例的权重发生了翻转）
 */
export function changeRate(oldWeights: Int8Array, newWeights: Int8Array): number {
  if (oldWeights.length === 0) return 0;
  return hammingDistance(oldWeights, newWeights) / oldWeights.length;
}
