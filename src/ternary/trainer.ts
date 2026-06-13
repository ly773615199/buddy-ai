/**
 * 三进制增量训练器
 *
 * 核心流程：
 * 1. 加载训练数据（QA 对、判断力样本）
 * 2. 前向传播 → 计算 loss
 * 3. 反向传播 → 估算梯度
 * 4. t-SignSGD 更新权重
 * 5. 评估 → 决定是否保留更新
 *
 * 设计原则：
 * - 增量：只训练新知识，不重训旧数据
 * - 安全：训练后验证，loss 上升则回滚
 * - 高效：纯 CPU，夜间后台运行
 */

import type { TernaryModel, TernaryLayer, TernaryModelMeta, GrowthStage } from './format.js';
import { TernaryOptimizer, estimateGradient, changeRate, type LayerGradients, type OptimizerConfig } from './optimizer.js';
import { loraForward, softmax } from './compute.js';
import { TernaryTokenizer } from './tokenizer.js';

// ── 训练数据格式 ──

export interface TrainingSample {
  /** 输入 token IDs */
  inputIds: number[];
  /** 目标 token IDs */
  targetIds: number[];
  /** 样本类型 */
  type: 'qa' | 'judgment' | 'correction' | 'instruct';
  /** 来源领域 */
  domain: string;
  /** 质量评分 (0-1) */
  quality: number;
  /** 时间戳 */
  timestamp: number;
}

export interface TrainingDataset {
  samples: TrainingSample[];
  domain: string;
  version: string;
}

// ── 训练配置 ──

export interface TrainerConfig {
  /** 每轮训练的最大样本数 */
  batchSize: number;
  /** 最大训练轮数 */
  maxEpochs: number;
  /** 早停：验证 loss 连续 N 轮不降则停止 */
  patience: number;
  /** 验证集比例 */
  valSplit: number;
  /** 最低质量阈值 (低于此值的样本丢弃) */
  minQuality: number;
  /** 优化器配置 */
  optimizer: Partial<OptimizerConfig>;
}

const DEFAULT_TRAINER_CONFIG: TrainerConfig = {
  batchSize: 32,
  maxEpochs: 10,
  patience: 3,
  valSplit: 0.1,
  minQuality: 0.5,
  optimizer: {},
};

// ── 训练结果 ──

export interface TrainResult {
  /** 是否成功 */
  success: boolean;
  /** 训练前 loss */
  initialLoss: number;
  /** 训练后 loss */
  finalLoss: number;
  /** loss 变化率 */
  lossChange: number;
  /** 训练步数 */
  steps: number;
  /** 训练耗时 (ms) */
  elapsedMs: number;
  /** 各层权重变化率 */
  layerChangeRates: Record<number, number>;
  /** 是否已回滚 (loss 上升) */
  rolledBack: boolean;
  /** 错误信息 */
  error?: string;
}

// ── Checkpoint ──

export interface TrainerCheckpoint {
  model: { meta: TernaryModelMeta; layers: { layerIndex: number; A: number[]; B: number[] }[] };
  optimizer: ReturnType<TernaryOptimizer['serialize']>;
  trainedSampleIds: string[];
  timestamp: number;
}

// ════════════════════════════════════════════════════════
// 增量训练器
// ════════════════════════════════════════════════════════

export class TernaryTrainer {
  private config: TrainerConfig;
  private optimizer: TernaryOptimizer;
  private tokenizer: TernaryTokenizer;
  private trainedSampleHashes: Set<string> = new Set();

  constructor(config?: Partial<TrainerConfig>) {
    this.config = { ...DEFAULT_TRAINER_CONFIG, ...config };
    this.optimizer = new TernaryOptimizer(this.config.optimizer);
    this.tokenizer = new TernaryTokenizer();
  }

  /**
   * 增量训练入口
   *
   * @param model 当前模型
   * @param dataset 新的训练数据
   * @returns 训练结果（含是否回滚信息）
   */
  train(model: TernaryModel, dataset: TrainingDataset): TrainResult {
    const startTime = performance.now();

    try {
      // 1. 过滤 + 去重
      const samples = this.filterSamples(dataset.samples);

      if (samples.length === 0) {
        return {
          success: false,
          initialLoss: 0,
          finalLoss: 0,
          lossChange: 0,
          steps: 0,
          elapsedMs: 0,
          layerChangeRates: {},
          rolledBack: false,
          error: 'No valid training samples after filtering',
        };
      }

      // 2. 分割训练/验证集
      const { trainSet, valSet } = this.splitDataset(samples);

      // 3. 初始化优化器 latent 权重
      this.initOptimizer(model);

      // 4. 计算初始 loss
      const initialLoss = this.evaluate(model, valSet);

      // 5. 训练循环
      let bestLoss = initialLoss;
      let patienceCount = 0;
      let totalSteps = 0;

      // 备份原始权重（用于回滚）
      const backup = this.backupWeights(model);

      for (let epoch = 0; epoch < this.config.maxEpochs; epoch++) {
        // 打乱训练集
        const shuffled = this.shuffle(trainSet);

        // Mini-batch 训练
        for (let i = 0; i < shuffled.length; i += this.config.batchSize) {
          const batch = shuffled.slice(i, i + this.config.batchSize);
          this.trainBatch(model, batch);
          totalSteps++;
        }

        // 验证
        const valLoss = this.evaluate(model, valSet);

        // 早停检查
        if (valLoss < bestLoss) {
          bestLoss = valLoss;
          patienceCount = 0;
        } else {
          patienceCount++;
          if (patienceCount >= this.config.patience) {
            break;
          }
        }
      }

      // 6. 安全检查：loss 是否上升太多
      const finalLoss = this.evaluate(model, valSet);
      const lossChange = (initialLoss - finalLoss) / (initialLoss + 1e-8);
      let rolledBack = false;

      if (lossChange < -0.1) {
        // loss 上升超过 10%，回滚
        this.restoreWeights(model, backup);
        rolledBack = true;
      }

      // 7. 计算各层变化率
      const layerChangeRates: Record<number, number> = {};
      for (const layer of model.layers) {
        const old = backup.get(layer.layerIndex);
        if (old) {
          layerChangeRates[layer.layerIndex] = changeRate(old.A, layer.A);
        }
      }

      // 8. 记录已训练样本
      for (const s of samples) {
        this.trainedSampleHashes.add(this.sampleHash(s));
      }

      // 更新模型元数据
      model.meta.trainSteps += totalSteps;
      model.meta.lastUpdated = Date.now();

      return {
        success: !rolledBack,
        initialLoss,
        finalLoss: rolledBack ? initialLoss : finalLoss,
        lossChange: rolledBack ? 0 : lossChange,
        steps: totalSteps,
        elapsedMs: Math.round(performance.now() - startTime),
        layerChangeRates,
        rolledBack,
      };
    } catch (err) {
      return {
        success: false,
        initialLoss: 0,
        finalLoss: 0,
        lossChange: 0,
        steps: 0,
        elapsedMs: Math.round(performance.now() - startTime),
        layerChangeRates: {},
        rolledBack: false,
        error: String(err),
      };
    }
  }

  /**
   * 获取已训练样本数量
   */
  get trainedCount(): number {
    return this.trainedSampleHashes.size;
  }

  /**
   * 重置训练状态
   */
  reset(): void {
    this.trainedSampleHashes.clear();
    this.optimizer.reset();
  }

  // ── 内部方法 ──

  /**
   * 过滤低质量 + 去重样本
   */
  private filterSamples(samples: TrainingSample[]): TrainingSample[] {
    const seen = new Set<string>();
    return samples.filter(s => {
      if (s.quality < this.config.minQuality) return false;
      const hash = this.sampleHash(s);
      if (this.trainedSampleHashes.has(hash) || seen.has(hash)) return false;
      seen.add(hash);
      return true;
    });
  }

  /**
   * 分割训练/验证集
   */
  private splitDataset(samples: TrainingSample[]): { trainSet: TrainingSample[]; valSet: TrainingSample[] } {
    const shuffled = this.shuffle(samples);
    const splitIdx = Math.max(1, Math.floor(shuffled.length * this.config.valSplit));
    return {
      valSet: shuffled.slice(0, splitIdx),
      trainSet: shuffled.slice(splitIdx),
    };
  }

  /**
   * 初始化优化器 latent 权重
   */
  private initOptimizer(model: TernaryModel): void {
    const { inFeatures, rank, outFeatures } = model.meta;
    for (const layer of model.layers) {
      if (!this.optimizer.getLatentWeights(layer.layerIndex)) {
        this.optimizer.initLatentWeights(layer, inFeatures, rank, outFeatures);
      }
    }
  }

  /**
   * 单 batch 训练
   */
  private trainBatch(model: TernaryModel, batch: TrainingSample[]): void {
    const { inFeatures, rank, outFeatures } = model.meta;

    for (const layer of model.layers) {
      // 估算梯度
      const gradA = this.estimateLayerGradient(model, layer, batch, 'A');
      const gradB = this.estimateLayerGradient(model, layer, batch, 'B');

      // 优化器更新
      const updated = this.optimizer.step(layer, { gradA, gradB }, inFeatures, rank, outFeatures);

      // 应用更新
      layer.A = updated.A;
      layer.B = updated.B;
    }
  }

  /**
   * 估算单层梯度
   *
   * 简化实现：基于 loss 变化的有限差分。
   * 生产环境由蒸馏流程提供真实梯度。
   */
  private estimateLayerGradient(
    model: TernaryModel,
    layer: TernaryLayer,
    batch: TrainingSample[],
    matrix: 'A' | 'B',
  ): Float32Array {
    const weights = matrix === 'A' ? layer.A : layer.B;
    const grad = new Float32Array(weights.length);

    // 计算当前 batch loss
    const baseLoss = this.computeBatchLoss(model, batch);

    // 采样扰动（只扰动一部分权重以降低计算量）
    const sampleCount = Math.min(weights.length, 64);
    const indices: number[] = [];
    for (let i = 0; i < sampleCount; i++) {
      indices.push(Math.floor(Math.random() * weights.length));
    }

    const epsilon = 1;
    for (const idx of indices) {
      const original = weights[idx];

      // +epsilon
      weights[idx] = Math.min(1, original + epsilon) as -1 | 0 | 1;
      const lossUp = this.computeBatchLoss(model, batch);

      // -epsilon
      weights[idx] = Math.max(-1, original - epsilon) as -1 | 0 | 1;
      const lossDown = this.computeBatchLoss(model, batch);

      // 恢复
      weights[idx] = original;

      grad[idx] = (lossUp - lossDown) / (2 * epsilon);
    }

    // 填充未采样位置
    let sum = 0, count = 0;
    for (let i = 0; i < grad.length; i++) {
      if (grad[i] !== 0) { sum += grad[i]; count++; }
    }
    const avg = count > 0 ? sum / count : 0;
    for (let i = 0; i < grad.length; i++) {
      if (grad[i] === 0) grad[i] = avg * 0.01; // 未采样的给很小的梯度
    }

    return grad;
  }

  /**
   * 计算 batch loss（简化交叉熵）
   */
  private computeBatchLoss(model: TernaryModel, batch: TrainingSample[]): number {
    let totalLoss = 0;
    const { inFeatures, rank, outFeatures } = model.meta;

    for (const sample of batch.slice(0, 4)) { // 限制样本数加速
      // 前向传播
      let hidden = new Float32Array(inFeatures);

      // 简化 embedding
      const tokenId = sample.inputIds[sample.inputIds.length - 1] || 0;
      this.tokenEmbed(tokenId, hidden);

      for (const layer of model.layers) {
        const loraOut = loraForward(layer.A, layer.B, hidden, inFeatures, rank, outFeatures);
        const result = new Float32Array(inFeatures);
        for (let i = 0; i < inFeatures; i++) {
          result[i] = hidden[i] + loraOut[i] * 0.1;
        }
        // 简化 layernorm
        let mean = 0;
        for (let i = 0; i < inFeatures; i++) mean += result[i];
        mean /= inFeatures;
        let var_ = 0;
        for (let i = 0; i < inFeatures; i++) { const d = result[i] - mean; var_ += d * d; }
        var_ /= inFeatures;
        const invStd = 1 / Math.sqrt(var_ + 1e-5);
        for (let i = 0; i < inFeatures; i++) {
          hidden[i] = (result[i] - mean) * invStd;
        }
      }

      // 计算 logits → loss
      const logits = softmax(hidden.subarray(0, Math.min(inFeatures, 32000)));
      const targetId = sample.targetIds[0] || 0;
      const targetProb = Math.max(logits[targetId] || 1e-10, 1e-10);
      totalLoss += -Math.log(targetProb);
    }

    return totalLoss / Math.min(batch.length, 4);
  }

  /**
   * 验证集评估
   */
  private evaluate(model: TernaryModel, valSet: TrainingSample[]): number {
    if (valSet.length === 0) return 0;
    return this.computeBatchLoss(model, valSet);
  }

  /**
   * Token 嵌入（与 engine.ts 一致）
   */
  private tokenEmbed(tokenId: number, output: Float32Array): void {
    let seed = tokenId * 2654435761;
    for (let i = 0; i < output.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      output[i] = ((seed / 0x7fffffff) - 0.5) * 0.02;
    }
  }

  /**
   * 备份权重
   */
  private backupWeights(model: TernaryModel): Map<number, { A: Int8Array; B: Int8Array }> {
    const backup = new Map<number, { A: Int8Array; B: Int8Array }>();
    for (const layer of model.layers) {
      backup.set(layer.layerIndex, {
        A: new Int8Array(layer.A),
        B: new Int8Array(layer.B),
      });
    }
    return backup;
  }

  /**
   * 恢复权重
   */
  private restoreWeights(model: TernaryModel, backup: Map<number, { A: Int8Array; B: Int8Array }>): void {
    for (const layer of model.layers) {
      const saved = backup.get(layer.layerIndex);
      if (saved) {
        layer.A = saved.A;
        layer.B = saved.B;
      }
    }
  }

  /**
   * 样本哈希（用于去重）
   */
  private sampleHash(sample: TrainingSample): string {
    const key = `${sample.type}:${sample.inputIds.join(',')}:${sample.targetIds.join(',')}`;
    return key;
  }

  /**
   * Fisher-Yates 洗牌
   */
  private shuffle<T>(arr: T[]): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}
