/**
 * SimCSE 预训循环 — 对比学习训练 TextEncoder
 *
 * 流程：
 * 1. 同一文本两次前向（不同 dropout mask → 不同表示）
 * 2. 计算 InfoNCE 损失
 * 3. 反向传播更新权重
 *
 * 训练后 TextEncoder 能输出有语义区分度的向量。
 */

import { TextEncoder, type TextEncoderConfig, type TextEncoderCache } from '../features/text-encoder.js';
import type { Tensor } from '../nn/tensor.js';
import { AdamW, type AdamWConfig } from './adamw.js';
import { infoNCELoss, infoNCEGradient, cosineSimilarity } from './contrastive-loss.js';
import type { TrainingSample, Dataset } from './dataloader.js';
import { BatchIterator } from './dataloader.js';

export interface SimCSEConfig {
  /** TextEncoder 配置 */
  encoder: Partial<TextEncoderConfig>;
  /** AdamW 配置 */
  optimizer: Partial<AdamWConfig>;
  /** 训练配置 */
  training: {
    batchSize: number;
    epochs: number;
    temperature: number;       // InfoNCE 温度，默认 0.05
    dropoutRate: number;       // SimCSE dropout 率，默认 0.1
    logInterval: number;       // 每 N 步打印日志
    saveInterval: number;      // 每 N 步保存模型
    evalInterval: number;      // 每 N 步评估
  };
}

const DEFAULT_SIMCSE_CONFIG: SimCSEConfig = {
  encoder: {
    byteEmbedDim: 64,
    outputDim: 384,
    numLayers: 4,
    numHeads: 6,
    ffnDim: 768,
  },
  optimizer: {
    learningRate: 3e-4,
    beta1: 0.9,
    beta2: 0.999,
    weightDecay: 0.01,
    schedule: 'cosine',
    scheduleParams: {
      warmupSteps: 1000,
      totalSteps: 100000,
      minLr: 1e-6,
    },
  },
  training: {
    batchSize: 32,
    epochs: 10,
    temperature: 0.05,
    dropoutRate: 0.1,
    logInterval: 10,
    saveInterval: 500,
    evalInterval: 100,
  },
};

export interface TrainStepResult {
  step: number;
  loss: number;
  lr: number;
  gradNorm: number;
}

export interface TrainEpochResult {
  epoch: number;
  avgLoss: number;
  steps: number;
  duration: number;
}

/**
 * SimCSE 训练器
 */
export class SimCSETrainer {
  private encoder: TextEncoder;
  private optimizer: AdamW;
  private config: SimCSEConfig;
  private step = 0;
  private losses: number[] = [];

  constructor(config?: Partial<SimCSEConfig>) {
    this.config = { ...DEFAULT_SIMCSE_CONFIG, ...config };
    this.encoder = new TextEncoder(this.config.encoder);
    this.optimizer = new AdamW(this.config.optimizer);
  }

  /**
   * 获取编码器引用
   */
  getEncoder(): TextEncoder {
    return this.encoder;
  }

  /**
   * 单步训练：SimCSE
   *
   * 1. 对 batch 中每个文本做两次前向（不同随机种子 → 不同 dropout mask）
   * 2. 得到 z1[i], z2[i] 作为正样本对
   * 3. 计算 InfoNCE 损失
   * 4. 反向传播
   */
  trainStep(batch: TrainingSample[]): TrainStepResult {
    const texts = batch.map(s => s.text);
    const N = texts.length;

    // SimCSE: 同一文本两次前向，每次 forward+backward 立即配对
    // 避免 _cached 被后续 forward 覆盖
    const z1: Float32Array[] = [];
    const z2: Float32Array[] = [];
    const seqCache1: Array<{ seq: Tensor; cache: TextEncoderCache }> = [];
    const seqCache2: Array<{ seq: Tensor; cache: TextEncoderCache }> = [];

    for (const text of texts) {
      // 第一次前向（独立缓存）
      const { result: s1, cache: c1 } = this.encoder.forwardWithCache(text);
      const p1 = this.encoder.attentionPoolingForward(s1);
      z1.push(new Float32Array(p1.data));
      seqCache1.push({ seq: s1, cache: c1 });

      // 第二次前向（独立缓存）
      const { result: s2, cache: c2 } = this.encoder.forwardWithCache(text);
      const p2 = this.encoder.attentionPoolingForward(s2);
      z2.push(new Float32Array(p2.data));
      seqCache2.push({ seq: s2, cache: c2 });
    }

    // InfoNCE 损失和梯度
    const loss = infoNCELoss(z1, z2, this.config.training.temperature);
    const [gradZ1, gradZ2] = infoNCEGradient(z1, z2, this.config.training.temperature);

    // 反向传播：逐样本 backward
    for (let i = 0; i < N; i++) {
      this.encoder.backward(gradZ1[i], seqCache1[i].seq, seqCache1[i].cache);
      this.encoder.backward(gradZ2[i], seqCache2[i].seq, seqCache2[i].cache);
    }

    // AdamW 更新
    const params = this.encoder.parameters();
    this.optimizer.step_(params);

    // 清零梯度
    for (const param of params) {
      if (param.grad) param.grad.fill(0);
    }

    this.step++;
    this.losses.push(loss);

    // 计算梯度范数（近似）
    let gradNorm = 0;
    for (const gz of gradZ1) {
      for (let i = 0; i < gz.length; i++) {
        gradNorm += gz[i] * gz[i];
      }
    }
    gradNorm = Math.sqrt(gradNorm / N);

    return {
      step: this.step,
      loss,
      lr: this.getCurrentLr(),
      gradNorm,
    };
  }

  /**
   * 训练一个 epoch
   */
  trainEpoch(dataset: Dataset, onStep?: (result: TrainStepResult) => void): TrainEpochResult {
    const startTime = Date.now();
    const iterator = new BatchIterator(
      dataset.getSamples(),
      this.config.training.batchSize,
      true,
    );

    let epochLoss = 0;
    let steps = 0;

    while (iterator.hasNext()) {
      const batch = iterator.next();
      if (!batch) break;

      const result = this.trainStep(batch);
      epochLoss += result.loss;
      steps++;

      if (onStep) onStep(result);
    }

    return {
      epoch: 0,
      avgLoss: steps > 0 ? epochLoss / steps : 0,
      steps,
      duration: Date.now() - startTime,
    };
  }

  /**
   * 完整训练循环
   */
  async train(
    dataset: Dataset,
    callbacks?: {
      onEpoch?: (result: TrainEpochResult) => void;
      onStep?: (result: TrainStepResult) => void;
      onSave?: (encoder: TextEncoder, step: number) => void;
      onEval?: (similarity: number, step: number) => void;
    },
  ): Promise<void> {
    const { epochs, logInterval, saveInterval, evalInterval } = this.config.training;

    // 准备评估集（固定的一组文本对）
    const evalPairs = this.createEvalPairs(dataset);

    for (let epoch = 0; epoch < epochs; epoch++) {
      const result = this.trainEpoch(dataset, (stepResult) => {
        if (stepResult.step % logInterval === 0) {
          console.log(
            `[SimCSE] Step ${stepResult.step} | Loss: ${stepResult.loss.toFixed(4)} | ` +
            `LR: ${stepResult.lr.toExponential(2)} | GradNorm: ${stepResult.gradNorm.toFixed(4)}`
          );
        }

        if (callbacks?.onStep) callbacks.onStep(stepResult);

        if (stepResult.step % saveInterval === 0 && callbacks?.onSave) {
          callbacks.onSave(this.encoder, stepResult.step);
        }

        if (stepResult.step % evalInterval === 0 && callbacks?.onEval) {
          const sim = this.evaluate(evalPairs);
          callbacks.onEval(sim, stepResult.step);
        }
      });

      console.log(
        `[SimCSE] Epoch ${epoch + 1}/${epochs} | AvgLoss: ${result.avgLoss.toFixed(4)} | ` +
        `Steps: ${result.steps} | Duration: ${(result.duration / 1000).toFixed(1)}s`
      );

      if (callbacks?.onEpoch) callbacks.onEpoch(result);
    }
  }

  /**
   * 评估：计算语义相似度（Spearman 相关系数的简化版本）
   */
  evaluate(evalPairs: Array<[string, string, number]>): number {
    if (evalPairs.length === 0) return 0;

    const predicted: number[] = [];
    const actual: number[] = [];

    for (const [text1, text2, label] of evalPairs) {
      const z1 = this.encoder.forwardPooled(text1);
      const z2 = this.encoder.forwardPooled(text2);
      const sim = cosineSimilarity(new Float32Array(z1.data), new Float32Array(z2.data));
      predicted.push(sim);
      actual.push(label);
    }

    // 简化的 Spearman 相关系数
    return this.spearmanCorrelation(predicted, actual);
  }

  /**
   * 创建评估文本对
   */
  private createEvalPairs(dataset: Dataset): Array<[string, string, number]> {
    const samples = dataset.getSamples();
    const pairs: Array<[string, string, number]> = [];
    const count = Math.min(20, Math.floor(samples.length / 2));

    for (let i = 0; i < count; i++) {
      const idx1 = i * 2;
      const idx2 = i * 2 + 1;
      if (idx2 >= samples.length) break;

      // 相似对（同一来源的相邻样本）
      pairs.push([samples[idx1].text, samples[idx2].text, 0.8]);

      // 不相似对（随机配对）
      const randIdx = Math.floor(Math.random() * samples.length);
      if (randIdx !== idx1) {
        pairs.push([samples[idx1].text, samples[randIdx].text, 0.2]);
      }
    }

    return pairs;
  }

  /**
   * Spearman 秩相关系数
   */
  private spearmanCorrelation(x: number[], y: number[]): number {
    const n = x.length;
    if (n < 2) return 0;

    const rankX = this.getRanks(x);
    const rankY = this.getRanks(y);

    let sumD2 = 0;
    for (let i = 0; i < n; i++) {
      const d = rankX[i] - rankY[i];
      sumD2 += d * d;
    }

    return 1 - (6 * sumD2) / (n * (n * n - 1));
  }

  private getRanks(arr: number[]): number[] {
    const indexed = arr.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => a.v - b.v);
    const ranks = new Array(arr.length);
    for (let r = 0; r < indexed.length; r++) {
      ranks[indexed[r].i] = r + 1;
    }
    return ranks;
  }

  private getCurrentLr(): number {
    // 通过 optimizer 的内部状态获取当前 LR
    // 简化实现：直接计算
    const { learningRate, schedule, scheduleParams } = this.config.optimizer;
    const { warmupSteps = 0, totalSteps = 100000, minLr = 1e-6 } = scheduleParams ?? {};

    if (this.step <= (warmupSteps ?? 0)) {
      return (learningRate ?? 3e-4) * (this.step / Math.max(warmupSteps ?? 1, 1));
    }

    if (schedule === 'cosine') {
      const progress = (this.step - (warmupSteps ?? 0)) / Math.max((totalSteps ?? 100000) - (warmupSteps ?? 0), 1);
      return (minLr ?? 1e-6) + ((learningRate ?? 3e-4) - (minLr ?? 1e-6)) * 0.5 * (1 + Math.cos(Math.PI * Math.min(progress, 1)));
    }

    return learningRate ?? 3e-4;
  }
}
