/**
 * 信号汇聚层 — 类型定义
 *
 * 将外围模块（FeedbackLearner / BuddyLearn / ReasoningChainStore / ExperienceEvolver）
 * 的输出统一转换为 TrainingSample，接入右脑训练循环。
 */

import type { TrainingSample } from '../types.js';

/** 外部信号来源 */
export type SignalSource = 'feedback' | 'knowledge' | 'reasoning' | 'evolution';

/** 优先级加权后的训练样本 */
export interface PrioritizedSample {
  sample: TrainingSample;
  source: SignalSource;
  priority: number;       // 最终权重乘数
  ingestedAt: number;
  dedupeKey?: string;     // 去重 key
}

/** Sink 接口 — 每个外部模块实现一个 Sink */
export interface SignalSink {
  /** 信号来源标识 */
  readonly source: SignalSource;
  /** 优先级乘数（纠正=3, 知识=2, 推理=1.5, 进化=1） */
  readonly priorityMultiplier: number;
  /** 将外部信号转为 TrainingSample 数组 */
  convert(input: unknown): TrainingSample[];
}

/** 汇聚层配置 */
export interface ConvergenceConfig {
  /** 是否启用汇聚层 */
  enabled: boolean;
  /** 各 Sink 的优先级乘数 */
  priorities: {
    feedback: number;     // 默认 3.0
    knowledge: number;    // 默认 2.0
    reasoning: number;    // 默认 1.5
    evolution: number;    // 默认 1.0
  };
  /** 去重窗口（ms），同一 dedupeKey 在此时间内不重复注入 */
  dedupeWindowMs: number;  // 默认 60000 (1min)
  /** 每批次最大样本数 */
  maxBatchSize: number;    // 默认 32
  /** 是否开启详细日志 */
  verbose: boolean;
}

export const DEFAULT_CONVERGENCE_CONFIG: ConvergenceConfig = {
  enabled: true,
  priorities: {
    feedback: 3.0,
    knowledge: 2.0,
    reasoning: 1.5,
    evolution: 1.0,
  },
  dedupeWindowMs: 60_000,
  maxBatchSize: 32,
  verbose: false,
};

/** 汇聚层统计 */
export interface ConvergenceStats {
  totalIngested: number;
  bySource: Record<SignalSource, number>;
  dedupedCount: number;
  lastIngestAt: number;
}
