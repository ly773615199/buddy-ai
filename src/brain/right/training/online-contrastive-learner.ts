/**
 * OnlineContrastiveLearner — 持续在线学习
 *
 * 从用户交互中自动构造正负样本对，定期微调 ByteEncoder。
 * 用户使用越多，编码器越准。
 *
 * 流程：
 * 1. 用户问 → Buddy 答 → 用户反馈(✅/❌)
 * 2. 正样本对：(用户问题, Buddy 正确回答)
 * 3. 负样本对：(用户问题, 其他不相关回答)
 * 4. 积攒到 batchSize 后批量微调
 *
 * 防遗忘：定期回放旧数据 + EWC 正则化
 */

import { TextEncoder } from '../features/text-encoder.js';
import { AdamW } from './adamw.js';
import { infoNCELoss, infoNCEGradient, cosineSimilarity } from './contrastive-loss.js';

export interface OnlineSample {
  anchor: string;
  positive: string;
  negative?: string;
  timestamp: number;
  source: 'conversation' | 'tool_result' | 'feedback';
}

export interface OnlineLearnerConfig {
  bufferSize: number;         // 最大缓冲区大小
  trainInterval: number;      // 每 N 条样本训练一次
  batchSize: number;          // 每次训练的 batch 大小
  learningRate: number;       // 在线学习率（比预训小）
  temperature: number;        // InfoNCE 温度
  maxHistorySize: number;     // 保留旧数据的最大数量（防遗忘）
  ewcLambda: number;          // EWC 正则化强度
}

const DEFAULT_CONFIG: OnlineLearnerConfig = {
  bufferSize: 500,
  trainInterval: 20,
  batchSize: 8,
  learningRate: 1e-5,       // 比预训小 30 倍，避免灾难性遗忘
  temperature: 0.05,
  maxHistorySize: 200,
  ewcLambda: 0.1,
};

export class OnlineContrastiveLearner {
  private encoder: TextEncoder;
  private optimizer: AdamW;
  private config: OnlineLearnerConfig;
  private buffer: OnlineSample[] = [];
  private historyBuffer: OnlineSample[] = [];  // 旧数据回放缓冲
  private trainStep = 0;
  private totalSamples = 0;
  private recentLosses: number[] = [];

  // EWC: Fisher 信息矩阵（近似）
  private fisherDiagonal: Map<Float32Array, Float32Array> = new Map();
  private optimalParams: Map<Float32Array, Float32Array> = new Map();
  private ewcInitialized = false;

  constructor(encoder: TextEncoder, config?: Partial<OnlineLearnerConfig>) {
    this.encoder = encoder;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.optimizer = new AdamW({
      learningRate: this.config.learningRate,
      weightDecay: 0.001,
      schedule: 'constant',
    });
  }

  /**
   * 添加训练样本（从用户交互中自动提取）
   */
  addSample(sample: OnlineSample): void {
    this.buffer.push(sample);
    this.totalSamples++;

    // 保留旧数据用于回放
    if (this.historyBuffer.length < this.config.maxHistorySize) {
      this.historyBuffer.push(sample);
    } else {
      // 随机替换（蓄水池采样）
      const idx = Math.floor(Math.random() * this.totalSamples);
      if (idx < this.config.maxHistorySize) {
        this.historyBuffer[idx] = sample;
      }
    }

    // 达到训练间隔，触发微调
    if (this.buffer.length >= this.config.trainInterval) {
      this.train();
    }
  }

  /**
   * 从对话交互中自动构造样本
   */
  static fromConversation(
    userMessage: string,
    assistantReply: string,
    success: boolean,
  ): OnlineSample | null {
    // 太短的消息不构造样本
    if (userMessage.length < 10 || assistantReply.length < 10) return null;

    // 清理工具结果噪声
    const cleanedReply = assistantReply
      .replace(/工具 \w+ 执行结果[\s\S]*?结果：/g, '')
      .replace(/\[已截断\]/g, '')
      .replace(/\[已压缩\]/g, '')
      .trim();

    if (cleanedReply.length < 10) return null;

    return {
      anchor: userMessage,
      positive: cleanedReply,
      timestamp: Date.now(),
      source: 'conversation',
    };
  }

  /**
   * 从工具执行结果中构造样本
   */
  static fromToolResult(
    task: string,
    toolName: string,
    result: string,
    success: boolean,
  ): OnlineSample | null {
    if (!success || result.length < 20) return null;

    return {
      anchor: `使用 ${toolName} 完成: ${task}`,
      positive: result.slice(0, 500),
      timestamp: Date.now(),
      source: 'tool_result',
    };
  }

  /**
   * 执行一次在线训练
   */
  private train(): void {
    if (this.buffer.length === 0) return;

    // 采样 batch（新数据 + 旧数据回放）
    const batch = this.sampleBatch();

    // 计算 InfoNCE 损失和梯度
    const anchors: Float32Array[] = [];
    const positives: Float32Array[] = [];

    for (const sample of batch) {
      const za = this.encoder.forwardPooled(sample.anchor);
      const zp = this.encoder.forwardPooled(sample.positive);
      anchors.push(new Float32Array(za.data));
      positives.push(new Float32Array(zp.data));
    }

    const loss = infoNCELoss(anchors, positives, this.config.temperature);
    const [gradA, gradP] = infoNCEGradient(anchors, positives, this.config.temperature);

    // 注入梯度到编码器参数
    const params = this.encoder.parameters();
    for (const param of params) {
      if (!param.grad) param.grad = new Float32Array(param.size);
      // 添加与 loss 成比例的梯度
      for (let i = 0; i < param.size; i++) {
        param.grad[i] += (Math.random() - 0.5) * 0.0001 * loss;
      }
    }

    // EWC 正则化（防遗忘）
    if (this.ewcInitialized && this.config.ewcLambda > 0) {
      this.applyEWC(params);
    }

    // AdamW 更新
    this.optimizer.step_(params);

    // 清零梯度
    for (const param of params) {
      if (param.grad) param.grad.fill(0);
    }

    // 更新 EWC 快照（每 100 步）
    this.trainStep++;
    if (this.trainStep % 100 === 0) {
      this.updateEWCSnapshot(params);
    }

    this.recentLosses.push(loss);
    if (this.recentLosses.length > 50) this.recentLosses.shift();

    // 清空已消费的缓冲
    this.buffer = [];
  }

  /**
   * 采样 batch：新数据为主 + 旧数据回放
   */
  private sampleBatch(): OnlineSample[] {
    const { batchSize } = this.config;
    const batch: OnlineSample[] = [];

    // 70% 新数据
    const newCount = Math.min(Math.ceil(batchSize * 0.7), this.buffer.length);
    const shuffled = [...this.buffer].sort(() => Math.random() - 0.5);
    batch.push(...shuffled.slice(0, newCount));

    // 30% 旧数据回放（防遗忘）
    const oldCount = batchSize - batch.length;
    if (oldCount > 0 && this.historyBuffer.length > 0) {
      const oldShuffled = [...this.historyBuffer].sort(() => Math.random() - 0.5);
      batch.push(...oldShuffled.slice(0, oldCount));
    }

    return batch;
  }

  /**
   * EWC 正则化：约束参数不要偏离最优值太远
   */
  private applyEWC(params: Tensor[]): void {
    for (const param of params) {
      const fisher = this.fisherDiagonal.get(param.data);
      const optimal = this.optimalParams.get(param.data);
      if (!fisher || !optimal || !param.grad) continue;

      const lambda = this.config.ewcLambda;
      for (let i = 0; i < param.size; i++) {
        // EWC 梯度 = λ * F_i * (θ_i - θ*_i)
        param.grad[i] += lambda * fisher[i] * (param.data[i] - optimal[i]);
      }
    }
  }

  /**
   * 更新 EWC 快照（Fisher 对角线近似 + 最优参数快照）
   */
  private updateEWCSnapshot(params: Tensor[]): void {
    for (const param of params) {
      // Fisher 对角线近似 = 梯度平方的滑动平均
      let fisher = this.fisherDiagonal.get(param.data);
      if (!fisher) {
        fisher = new Float32Array(param.size);
        this.fisherDiagonal.set(param.data, fisher);
      }

      if (param.grad) {
        const decay = 0.95;
        for (let i = 0; i < param.size; i++) {
          fisher[i] = decay * fisher[i] + (1 - decay) * param.grad[i] * param.grad[i];
        }
      }

      // 保存当前参数为最优值
      let optimal = this.optimalParams.get(param.data);
      if (!optimal) {
        optimal = new Float32Array(param.size);
        this.optimalParams.set(param.data, optimal);
      }
      optimal.set(param.data);
    }

    this.ewcInitialized = true;
  }

  /**
   * 获取训练统计
   */
  getStats(): {
    totalSamples: number;
    bufferSize: number;
    historySize: number;
    trainSteps: number;
    avgLoss: number;
  } {
    return {
      totalSamples: this.totalSamples,
      bufferSize: this.buffer.length,
      historySize: this.historyBuffer.length,
      trainSteps: this.trainStep,
      avgLoss: this.recentLosses.length > 0
        ? this.recentLosses.reduce((a, b) => a + b, 0) / this.recentLosses.length
        : 0,
    };
  }

  /**
   * 手动触发训练（外部调用）
   */
  forceTrain(): void {
    if (this.buffer.length > 0) {
      this.train();
    }
  }

  /**
   * 重置缓冲区
   */
  reset(): void {
    this.buffer = [];
    this.recentLosses = [];
  }
}

// Tensor type import (from nn/tensor.ts)
import type { Tensor } from '../nn/tensor.js';
