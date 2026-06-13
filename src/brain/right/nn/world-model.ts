/**
 * 世界模型 — World Model (Mental Simulation)
 *
 * 基于 World Models (2018) / DreamerV3 (2023) 思路：
 * - 潜空间预测：给定当前状态 + 动作 → 预测下一状态
 * - 不生成像素，只预测结构化变化（坐标偏移、拓扑变化）
 * - 多步想象：z → z' → z'' → ...
 *
 * 纯 MLP 实现，CPU 推理 < 5ms
 */

// ==================== 类型 ====================

/** 潜空间状态 */
export interface LatentState {
  /** 状态向量 */
  vector: Float32Array;
  /** 维度 */
  dim: number;
}

/** 动作编码 */
export interface ActionEncoding {
  /** 动作类型 ID */
  actionType: number;
  /** 动作参数 */
  params: Float32Array;
}

/** 预测结果 */
export interface PredictionResult {
  /** 预测的下一状态 */
  nextLatent: Float32Array;
  /** 预测的空间变化 (dx, dy, dz, dw, dh, dd) */
  spatialDelta: Float32Array;
  /** 预测的拓扑变化概率 */
  topologyChangeProb: number;
  /** 预测置信度 */
  confidence: number;
  /** 推理延迟 */
  latencyMs: number;
}

/** World Model 配置 */
export interface WorldModelConfig {
  /** 潜空间维度 */
  latentDim: number;
  /** 动作编码维度 */
  actionDim: number;
  /** 隐藏层维度 */
  hiddenDim: number;
  /** 预测步长 */
  predictionSteps: number;
}

const DEFAULT_CONFIG: WorldModelConfig = {
  latentDim: 64,
  actionDim: 16,
  hiddenDim: 128,
  predictionSteps: 3,
};

// ==================== WorldModel ====================

export class WorldModel {
  private config: WorldModelConfig;

  // 状态转移网络权重
  private wTransition1: Float32Array; // [latentDim + actionDim, hiddenDim]
  private bTransition1: Float32Array; // [hiddenDim]
  private wTransition2: Float32Array; // [hiddenDim, latentDim]
  private bTransition2: Float32Array; // [latentDim]

  // 空间预测头
  private wSpatial: Float32Array; // [latentDim, 6]
  private bSpatial: Float32Array; // [6]

  // 拓扑预测头
  private wTopology: Float32Array; // [latentDim, 1]
  private bTopology: Float32Array; // [1]

  constructor(config?: Partial<WorldModelConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const { latentDim, actionDim, hiddenDim } = this.config;
    const inputDim = latentDim + actionDim;

    // Xavier 初始化
    this.wTransition1 = this.randn(inputDim, hiddenDim, Math.sqrt(2 / (inputDim + hiddenDim)));
    this.bTransition1 = new Float32Array(hiddenDim);
    this.wTransition2 = this.randn(hiddenDim, latentDim, Math.sqrt(2 / (hiddenDim + latentDim)));
    this.bTransition2 = new Float32Array(latentDim);

    this.wSpatial = this.randn(latentDim, 6, Math.sqrt(2 / (latentDim + 6)));
    this.bSpatial = new Float32Array(6);
    this.wTopology = this.randn(latentDim, 1, Math.sqrt(2 / (latentDim + 1)));
    this.bTopology = new Float32Array(1);
  }

  // ==================== 预测 ====================

  /**
   * 单步预测：当前状态 + 动作 → 下一状态
   */
  predict(currentLatent: Float32Array, action: ActionEncoding): PredictionResult {
    const t0 = performance.now();
    const { latentDim, actionDim, hiddenDim } = this.config;

    // 拼接输入
    const input = new Float32Array(latentDim + actionDim);
    input.set(currentLatent);
    input.set(action.params, latentDim);

    // 状态转移网络：input → hidden → latent delta
    const hidden = new Float32Array(hiddenDim);
    for (let j = 0; j < hiddenDim; j++) {
      let sum = this.bTransition1[j];
      for (let i = 0; i < input.length; i++) {
        sum += input[i] * this.wTransition1[i * hiddenDim + j];
      }
      hidden[j] = Math.max(0, sum); // ReLU
    }

    const latentDelta = new Float32Array(latentDim);
    for (let j = 0; j < latentDim; j++) {
      let sum = this.bTransition2[j];
      for (let i = 0; i < hiddenDim; i++) {
        sum += hidden[i] * this.wTransition2[i * latentDim + j];
      }
      latentDelta[j] = sum;
    }

    // 下一状态 = 当前状态 + delta（残差连接）
    const nextLatent = new Float32Array(latentDim);
    for (let i = 0; i < latentDim; i++) {
      nextLatent[i] = currentLatent[i] + latentDelta[i];
    }

    // 空间预测头
    const spatialDelta = new Float32Array(6);
    for (let j = 0; j < 6; j++) {
      let sum = this.bSpatial[j];
      for (let i = 0; i < latentDim; i++) {
        sum += nextLatent[i] * this.wSpatial[i * 6 + j];
      }
      spatialDelta[j] = Math.tanh(sum) * 0.1; // 限制偏移范围
    }

    // 拓扑预测头
    let topologyLogit = this.bTopology[0];
    for (let i = 0; i < latentDim; i++) {
      topologyLogit += nextLatent[i] * this.wTopology[i];
    }
    const topologyChangeProb = 1 / (1 + Math.exp(-topologyLogit)); // sigmoid

    // 置信度：基于 latent delta 的范数
    let deltaNorm = 0;
    for (let i = 0; i < latentDim; i++) deltaNorm += latentDelta[i] * latentDelta[i];
    const confidence = Math.min(1, 1 / (1 + Math.sqrt(deltaNorm)));

    return {
      nextLatent,
      spatialDelta,
      topologyChangeProb,
      confidence,
      latencyMs: performance.now() - t0,
    };
  }

  /**
   * 多步想象：从当前状态出发，执行多步动作序列
   *
   * z → z' → z'' → ...
   * 返回每一步的预测结果
   */
  imagine(
    initialLatent: Float32Array,
    actions: ActionEncoding[],
    maxSteps?: number,
  ): PredictionResult[] {
    const steps = maxSteps ?? this.config.predictionSteps;
    const results: PredictionResult[] = [];
    let current = initialLatent;

    for (let i = 0; i < steps && i < actions.length; i++) {
      const result = this.predict(current, actions[i]);
      results.push(result);
      current = result.nextLatent;
    }

    return results;
  }

  /**
   * 从编码状态构建 latent vector
   *
   * 简化实现：将 token 序列均值池化为 latent
   */
  encodeState(tokens: number[]): Float32Array {
    const { latentDim } = this.config;
    const latent = new Float32Array(latentDim);

    if (tokens.length === 0) return latent;

    // 简单哈希编码：每个 token 贡献到 latent 的不同维度
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const dim = token % latentDim;
      latent[dim] += 1 / tokens.length;
    }

    // L2 归一化
    let norm = 0;
    for (let i = 0; i < latentDim; i++) norm += latent[i] * latent[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < latentDim; i++) latent[i] /= norm;

    return latent;
  }

  /**
   * 编码动作为 ActionEncoding
   */
  encodeAction(actionType: number, params: number[] = []): ActionEncoding {
    const { actionDim } = this.config;
    const encoded = new Float32Array(actionDim);
    encoded[0] = actionType;
    for (let i = 0; i < Math.min(params.length, actionDim - 1); i++) {
      encoded[i + 1] = params[i];
    }
    return { actionType, params: encoded };
  }

  // ==================== 训练 ====================

  /**
   * 单步训练：前向 + 反向 + 权重更新
   * MSE loss on (nextLatent, spatialDelta) + BCE on topologyChange
   */
  trainStep(
    currentLatent: Float32Array,
    action: ActionEncoding,
    targetNextLatent: Float32Array,
    targetSpatialDelta: Float32Array,
    topologyLabel: number,
    lr = 0.001,
  ): number {
    const { latentDim, actionDim, hiddenDim } = this.config;
    const inputDim = latentDim + actionDim;

    // ── 前向传播（复用 predict 的计算，保存中间值） ──
    const input = new Float32Array(inputDim);
    input.set(currentLatent);
    input.set(action.params, latentDim);

    const hiddenPre = new Float32Array(hiddenDim);
    for (let j = 0; j < hiddenDim; j++) {
      let sum = this.bTransition1[j];
      for (let i = 0; i < inputDim; i++) sum += input[i] * this.wTransition1[i * hiddenDim + j];
      hiddenPre[j] = sum;
    }
    const hidden = new Float32Array(hiddenDim);
    for (let j = 0; j < hiddenDim; j++) hidden[j] = Math.max(0, hiddenPre[j]); // ReLU

    const latentDelta = new Float32Array(latentDim);
    for (let j = 0; j < latentDim; j++) {
      let sum = this.bTransition2[j];
      for (let i = 0; i < hiddenDim; i++) sum += hidden[i] * this.wTransition2[i * latentDim + j];
      latentDelta[j] = sum;
    }

    const predNext = new Float32Array(latentDim);
    for (let i = 0; i < latentDim; i++) predNext[i] = currentLatent[i] + latentDelta[i];

    const predSpatial = new Float32Array(6);
    for (let j = 0; j < 6; j++) {
      let sum = this.bSpatial[j];
      for (let i = 0; i < latentDim; i++) sum += predNext[i] * this.wSpatial[i * 6 + j];
      predSpatial[j] = Math.tanh(sum) * 0.1;
    }

    let topologyLogit = this.bTopology[0];
    for (let i = 0; i < latentDim; i++) topologyLogit += predNext[i] * this.wTopology[i];
    const predTopology = 1 / (1 + Math.exp(-topologyLogit));

    // ── 损失 ──
    let loss = 0;
    // MSE on nextLatent
    for (let i = 0; i < latentDim; i++) {
      const diff = predNext[i] - targetNextLatent[i];
      loss += diff * diff;
    }
    // MSE on spatialDelta
    for (let i = 0; i < 6; i++) {
      const diff = predSpatial[i] - targetSpatialDelta[i];
      loss += diff * diff;
    }
    // BCE on topology
    const t = Math.max(1e-7, Math.min(1 - 1e-7, predTopology));
    loss -= topologyLabel * Math.log(t) + (1 - topologyLabel) * Math.log(1 - t);

    // ── 反向传播 ──
    // dL/d(predNext)
    const dPredNext = new Float32Array(latentDim);
    for (let i = 0; i < latentDim; i++) dPredNext[i] = 2 * (predNext[i] - targetNextLatent[i]);

    // dL/d(spatial) → through tanh * 0.1
    const dSpatial = new Float32Array(6);
    for (let i = 0; i < 6; i++) {
      const diff = 2 * (predSpatial[i] - targetSpatialDelta[i]);
      const tanhVal = predSpatial[i] / 0.1;
      dSpatial[i] = diff * 0.1 * (1 - tanhVal * tanhVal);
    }
    // accumulate into dPredNext via wSpatial
    for (let i = 0; i < latentDim; i++) {
      for (let j = 0; j < 6; j++) {
        dPredNext[i] += dSpatial[j] * this.wSpatial[i * 6 + j];
      }
    }

    // dL/d(topology logit)
    const dTopologyLogit = predTopology - topologyLabel;
    // accumulate into dPredNext via wTopology
    for (let i = 0; i < latentDim; i++) {
      dPredNext[i] += dTopologyLogit * this.wTopology[i];
    }

    // dL/d(latentDelta) = dPredNext (residual connection)
    const dLatentDelta = dPredNext;

    // Update wSpatial, bSpatial
    for (let i = 0; i < latentDim; i++) {
      for (let j = 0; j < 6; j++) {
        this.wSpatial[i * 6 + j] -= lr * dSpatial[j] * predNext[i];
      }
    }
    for (let j = 0; j < 6; j++) this.bSpatial[j] -= lr * dSpatial[j];

    // Update wTopology, bTopology
    for (let i = 0; i < latentDim; i++) {
      this.wTopology[i] -= lr * dTopologyLogit * predNext[i];
    }
    this.bTopology[0] -= lr * dTopologyLogit;

    // dL/d(hidden) via wTransition2
    const dHidden = new Float32Array(hiddenDim);
    for (let i = 0; i < hiddenDim; i++) {
      for (let j = 0; j < latentDim; j++) {
        dHidden[i] += dLatentDelta[j] * this.wTransition2[i * latentDim + j];
      }
      // ReLU gradient
      if (hiddenPre[i] <= 0) dHidden[i] = 0;
    }

    // Update wTransition2, bTransition2
    for (let i = 0; i < hiddenDim; i++) {
      for (let j = 0; j < latentDim; j++) {
        this.wTransition2[i * latentDim + j] -= lr * dLatentDelta[j] * hidden[i];
      }
    }
    for (let j = 0; j < latentDim; j++) this.bTransition2[j] -= lr * dLatentDelta[j];

    // Update wTransition1, bTransition1
    for (let i = 0; i < inputDim; i++) {
      for (let j = 0; j < hiddenDim; j++) {
        this.wTransition1[i * hiddenDim + j] -= lr * dHidden[j] * input[i];
      }
    }
    for (let j = 0; j < hiddenDim; j++) this.bTransition1[j] -= lr * dHidden[j];

    return loss;
  }

  /**
   * 批量训练：从样本列表随机采样训练
   */
  trainBatch(
    samples: Array<{
      currentLatent: Float32Array;
      action: ActionEncoding;
      targetNextLatent: Float32Array;
      targetSpatialDelta: Float32Array;
      topologyLabel: number;
    }>,
    batchSize = 16,
    lr = 0.001,
  ): { loss: number; trained: number } {
    const batch = samples.length <= batchSize
      ? samples
      : this.randomSample(samples, batchSize);

    let totalLoss = 0;
    for (const s of batch) {
      totalLoss += this.trainStep(
        s.currentLatent, s.action, s.targetNextLatent,
        s.targetSpatialDelta, s.topologyLabel, lr,
      );
    }

    return { loss: totalLoss / batch.length, trained: batch.length };
  }

  /** 获取配置 */
  getConfig(): WorldModelConfig {
    return { ...this.config };
  }

  private randomSample<T>(arr: T[], n: number): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result.slice(0, n);
  }

  // ==================== 内部 ====================

  private randn(rows: number, cols: number, scale: number): Float32Array {
    const data = new Float32Array(rows * cols);
    for (let i = 0; i < data.length; i += 2) {
      const u1 = Math.random() || 1e-10;
      const u2 = Math.random();
      const r = Math.sqrt(-2 * Math.log(u1));
      data[i] = r * Math.cos(2 * Math.PI * u2) * scale;
      if (i + 1 < data.length) data[i + 1] = r * Math.sin(2 * Math.PI * u2) * scale;
    }
    return data;
  }
}
