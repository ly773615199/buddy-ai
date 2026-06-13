/**
 * 信号汇聚层 — 打通外围通道 → 右脑训练循环
 *
 * 将 FeedbackLearner / BuddyLearn / ReasoningChainStore / ExperienceEvolver
 * 的输出统一转换为 TrainingSample，按优先级写入 ReplayBuffer。
 *
 * 设计原则：
 * - 不改已有模块，只加桥接
 * - 统一信号格式（TrainingSample）
 * - 优先级分层（纠正 > 知识 > 推理 > 进化）
 * - 可选接入，不影响核心决策流
 */

import type { TrainingSample } from '../types.js';
import type { ConvergenceConfig, ConvergenceStats, SignalSource, PrioritizedSample } from './types.js';
import { DEFAULT_CONVERGENCE_CONFIG } from './types.js';
import { SignalPrioritizer } from './prioritizer.js';
import { FeedbackSink, type FeedbackSignal } from './feedback-sink.js';
import { KnowledgeSink, type KnowledgeSignal } from './knowledge-sink.js';
import { ReasoningSink, type ReasoningSignal } from './reasoning-sink.js';
import { EvolutionSink, type EvolutionSignal } from './evolution-sink.js';

export class SignalConvergenceLayer {
  private config: ConvergenceConfig;
  private prioritizer: SignalPrioritizer;
  private verbose: boolean;

  // 四个 Sink
  private feedbackSink: FeedbackSink;
  private knowledgeSink: KnowledgeSink;
  private reasoningSink: ReasoningSink;
  private evolutionSink: EvolutionSink;

  // 写入回调（注入 ReplayBuffer.push）
  private onSample: ((sample: TrainingSample) => void) | null = null;

  // 统计
  private stats: ConvergenceStats = {
    totalIngested: 0,
    bySource: { feedback: 0, knowledge: 0, reasoning: 0, evolution: 0 },
    dedupedCount: 0,
    lastIngestAt: 0,
  };

  constructor(config?: Partial<ConvergenceConfig>) {
    this.config = { ...DEFAULT_CONVERGENCE_CONFIG, ...config };
    this.verbose = this.config.verbose;
    this.prioritizer = new SignalPrioritizer(this.config);

    this.feedbackSink = new FeedbackSink();
    this.knowledgeSink = new KnowledgeSink();
    this.reasoningSink = new ReasoningSink();
    this.evolutionSink = new EvolutionSink();
  }

  /**
   * 注册样本写入回调
   * 调用方传入 ReplayBuffer.push.bind(buffer)
   */
  setOnSample(callback: (sample: TrainingSample) => void): void {
    this.onSample = callback;
  }

  /**
   * 摄入用户纠正信号
   */
  ingestFeedback(signal: FeedbackSignal): number {
    if (!this.config.enabled) return 0;
    return this.ingest(signal, this.feedbackSink);
  }

  /**
   * 摄入知识信号
   */
  ingestKnowledge(signal: KnowledgeSignal): number {
    if (!this.config.enabled) return 0;
    return this.ingest(signal, this.knowledgeSink);
  }

  /**
   * 摄入推理链信号
   */
  ingestReasoning(signal: ReasoningSignal): number {
    if (!this.config.enabled) return 0;
    return this.ingest(signal, this.reasoningSink);
  }

  /**
   * 摄入进化信号
   */
  ingestEvolution(signal: EvolutionSignal): number {
    if (!this.config.enabled) return 0;
    return this.ingest(signal, this.evolutionSink);
  }

  /**
   * 批量摄入（从 DecisionMemory 反事实生成等场景）
   */
  ingestBatch(samples: TrainingSample[], source: SignalSource): number {
    if (!this.config.enabled) return 0;

    const prioritized = this.prioritizer.prioritize(samples, source);
    const sorted = this.prioritizer.sort(prioritized);
    const limited = this.prioritizer.limitBatch(sorted);

    let count = 0;
    for (const p of limited) {
      this.onSample?.(p.sample);
      count++;
    }

    this.stats.totalIngested += count;
    this.stats.bySource[source] += count;
    this.stats.lastIngestAt = Date.now();

    if (this.verbose && count > 0) {
      console.log(`[Convergence] 批量摄入 ${source}: ${count} 样本`);
    }

    return count;
  }

  /**
   * 获取统计
   */
  getStats(): ConvergenceStats {
    return { ...this.stats };
  }

  /**
   * 获取配置
   */
  getConfig(): ConvergenceConfig {
    return { ...this.config };
  }

  /**
   * 启用/禁用
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  // ── 内部 ──

  private ingest(signal: unknown, sink: { source: SignalSource; convert: (input: unknown) => TrainingSample[] }): number {
    const samples = sink.convert(signal);
    if (samples.length === 0) return 0;

    const prioritized = this.prioritizer.prioritize(samples, sink.source);
    const sorted = this.prioritizer.sort(prioritized);
    const limited = this.prioritizer.limitBatch(sorted);

    const beforeDedupe = limited.length;
    let count = 0;
    for (const p of limited) {
      this.onSample?.(p.sample);
      count++;
    }

    this.stats.totalIngested += count;
    this.stats.bySource[sink.source] += count;
    this.stats.dedupedCount += beforeDedupe - count;
    this.stats.lastIngestAt = Date.now();

    if (this.verbose && count > 0) {
      console.log(`[Convergence] 摄入 ${sink.source}: ${count} 样本`);
    }

    return count;
  }
}
