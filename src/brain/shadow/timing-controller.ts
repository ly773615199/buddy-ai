/**
 * 迭代时机控制器 — 判断何时适合执行进化
 *
 * 原则：系统不稳定时不进化，负载高时不进化，样本不足时不进化
 * 五重检查：负载 + 样本量 + 稳定性 + 进化间隔 + 时间窗口
 */

import type { BodyState } from '../types.js';
import type { TimingConfig, TimingDecision } from './types.js';

const DEFAULT_CONFIG: TimingConfig = {
  maxLoad: 50,
  minSamples: 100,
  maxLossVolatility: 0.01,
  minIntervalMs: 24 * 60 * 60 * 1000,
  preferredWindowStart: 0,
  preferredWindowEnd: 6,
};

export class TimingController {
  private config: TimingConfig;
  private lastEvolutionTime: number = 0;

  constructor(config?: Partial<TimingConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── 参数 setter（供 SelfModifier 写回） ──

  /** 设置最大负载阈值 */
  setMaxLoad(value: number): void {
    this.config.maxLoad = Math.max(10, Math.min(100, value));
  }

  /** 获取当前最大负载阈值 */
  getMaxLoad(): number {
    return this.config.maxLoad;
  }

  /** 设置最小样本数 */
  setMinSamples(value: number): void {
    this.config.minSamples = Math.max(10, value);
  }

  /** 获取当前最小样本数 */
  getMinSamples(): number {
    return this.config.minSamples;
  }

  /** 设置最大 loss 波动阈值 */
  setMaxLossVolatility(value: number): void {
    this.config.maxLossVolatility = Math.max(0.001, Math.min(0.1, value));
  }

  /** 获取当前最大 loss 波动阈值 */
  getMaxLossVolatility(): number {
    return this.config.maxLossVolatility;
  }

  /** 设置最小进化间隔 */
  setMinIntervalMs(value: number): void {
    this.config.minIntervalMs = Math.max(3600000, value); // 最小 1h
  }

  /** 获取当前最小进化间隔 */
  getMinIntervalMs(): number {
    return this.config.minIntervalMs;
  }

  /**
   * 判断当前是否适合执行进化
   */
  shouldEvolve(bodyState: BodyState, relatedSamples: number, recentLosses: number[]): TimingDecision {
    const now = Date.now();
    const hour = new Date().getHours();

    // 条件 1: 系统负载
    const loadPassed = bodyState.load < this.config.maxLoad;

    // 条件 2: 样本量
    const samplesPassed = relatedSamples >= this.config.minSamples;

    // 条件 3: 稳定性（loss 波动）
    const volatility = this.calcVolatility(recentLosses);
    const stabilityPassed = volatility < this.config.maxLossVolatility;

    // 条件 4: 进化间隔
    const sinceLast = now - this.lastEvolutionTime;
    const intervalPassed = sinceLast >= this.config.minIntervalMs;

    // 条件 5: 时间窗口（软约束）
    const inWindow = hour >= this.config.preferredWindowStart && hour < this.config.preferredWindowEnd;

    const conditions = {
      load: { current: bodyState.load, threshold: this.config.maxLoad, passed: loadPassed },
      samples: { current: relatedSamples, threshold: this.config.minSamples, passed: samplesPassed },
      stability: { current: volatility, threshold: this.config.maxLossVolatility, passed: stabilityPassed },
      interval: { current: sinceLast, threshold: this.config.minIntervalMs, passed: intervalPassed, sinceLastMs: sinceLast, minMs: this.config.minIntervalMs },
      timeWindow: { current: hour, threshold: this.config.preferredWindowStart, passed: inWindow, currentHour: hour, inWindow },
    };

    const hardPassed = loadPassed && samplesPassed && stabilityPassed && intervalPassed;
    const score = this.calcScore(conditions);

    return {
      allowed: hardPassed,
      reason: hardPassed ? '所有条件满足，可以执行进化' : this.describeFailure(conditions),
      conditions,
      score,
    };
  }

  /**
   * 记录进化完成时间
   */
  recordEvolution(): void {
    this.lastEvolutionTime = Date.now();
  }

  /**
   * 获取上次进化时间
   */
  getLastEvolutionTime(): number {
    return this.lastEvolutionTime;
  }

  /**
   * 计算 loss 波动（变异系数 = 标准差 / 均值）
   */
  private calcVolatility(losses: number[]): number {
    if (losses.length < 5) return Infinity;
    const mean = losses.reduce((a, b) => a + b, 0) / losses.length;
    if (mean === 0) return 0;
    const variance = losses.reduce((s, l) => s + (l - mean) ** 2, 0) / losses.length;
    return Math.sqrt(variance) / mean;
  }

  /**
   * 计算综合分数
   */
  private calcScore(conditions: TimingDecision['conditions']): number {
    let score = 0;
    if (conditions.load.passed) score += 0.3;
    if (conditions.samples.passed) score += 0.25;
    if (conditions.stability.passed) score += 0.25;
    if (conditions.interval.passed) score += 0.1;
    if (conditions.timeWindow.passed) score += 0.1;
    return score;
  }

  /**
   * 描述失败原因
   */
  private describeFailure(conditions: TimingDecision['conditions']): string {
    const failures: string[] = [];
    if (!conditions.load.passed) failures.push(`负载过高(${conditions.load.current} > ${conditions.load.threshold})`);
    if (!conditions.samples.passed) failures.push(`样本不足(${conditions.samples.current} < ${conditions.samples.threshold})`);
    if (!conditions.stability.passed) failures.push(`loss不稳定(${conditions.stability.current.toFixed(4)} > ${conditions.stability.threshold})`);
    if (!conditions.interval.passed) failures.push(`距上次进化太近(${Math.round(conditions.interval.sinceLastMs / 3600000)}h < ${Math.round(conditions.interval.minMs / 3600000)}h)`);
    return `进化条件不满足: ${failures.join(', ')}`;
  }
}
