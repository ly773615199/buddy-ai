/**
 * 经验效果量化 — 追踪 token 节省、成功率、响应时间
 *
 * 用数据证明"用得越久 LLM 调用越少"
 */

import type { ExperienceUnit } from './types.js';

export interface MetricSnapshot {
  timestamp: number;
  /** 总交互次数 */
  totalInteractions: number;
  /** 通过经验直接执行的次数（零 LLM） */
  expDirectCount: number;
  /** 通过经验+LLM验证的次数 */
  expVerifiedCount: number;
  /** 纯 LLM 处理的次数 */
  llmOnlyCount: number;
  /** LLM 调用节省率 (0-1) */
  llmSavingsRate: number;
  /** 经验执行成功率 */
  expSuccessRate: number;
  /** 平均经验执行时间 (ms) */
  avgExpExecutionMs: number;
  /** 平均 LLM 响应时间 (ms) */
  avgLlmResponseMs: number;
  /** 估算节省的 token 数 */
  estimatedTokenSavings: number;
}

export interface ExperienceMetrics {
  expId: string;
  name: string;
  abstractionLevel: string;
  confidence: number;
  successCount: number;
  failCount: number;
  successRate: number;
  avgExecutionMs: number;
  lastUsed: number;
  age: number;         // 存在时长（小时）
}

export class MetricsCollector {
  private snapshots: MetricSnapshot[] = [];
  private counters = {
    totalInteractions: 0,
    expDirectCount: 0,
    expVerifiedCount: 0,
    llmOnlyCount: 0,
    totalExpExecutions: 0,
    successfulExpExecutions: 0,
    totalExpMs: 0,
    totalLlmMs: 0,
    llmCallCount: 0,
    estimatedTokenSavings: 0,
  };
  private readonly MAX_SNAPSHOTS = 1000;

  // token 估算参数
  private readonly AVG_LLM_TOKENS_PER_CALL = 2000;  // 每次 LLM 调用平均 token 数
  private readonly AVG_EXP_TOKENS_SAVED = 1500;      // 经验执行节省的 token 数

  // ── 计数器 ──

  recordInteraction(path: 'exp_direct' | 'exp_verified' | 'llm_with_hint' | 'llm' | 'llm_only'): void {
    this.counters.totalInteractions++;

    switch (path) {
      case 'exp_direct':
        this.counters.expDirectCount++;
        this.counters.estimatedTokenSavings += this.AVG_EXP_TOKENS_SAVED;
        break;
      case 'exp_verified':
        this.counters.expVerifiedCount++;
        this.counters.estimatedTokenSavings += Math.floor(this.AVG_EXP_TOKENS_SAVED * 0.3);
        break;
      case 'llm_only':
      case 'llm':
      case 'llm_with_hint':
        this.counters.llmOnlyCount++;
        break;
    }
  }

  recordExpExecution(success: boolean, durationMs: number): void {
    this.counters.totalExpExecutions++;
    if (success) this.counters.successfulExpExecutions++;
    this.counters.totalExpMs += durationMs;
  }

  recordLlmCall(durationMs: number): void {
    this.counters.llmCallCount++;
    this.counters.totalLlmMs += durationMs;
  }

  // ── 快照 ──

  takeSnapshot(): MetricSnapshot {
    const c = this.counters;
    const total = Math.max(1, c.totalInteractions);

    const snapshot: MetricSnapshot = {
      timestamp: Date.now(),
      totalInteractions: c.totalInteractions,
      expDirectCount: c.expDirectCount,
      expVerifiedCount: c.expVerifiedCount,
      llmOnlyCount: c.llmOnlyCount,
      llmSavingsRate: (c.expDirectCount + c.expVerifiedCount) / total,
      expSuccessRate: c.totalExpExecutions > 0
        ? c.successfulExpExecutions / c.totalExpExecutions
        : 0,
      avgExpExecutionMs: c.totalExpExecutions > 0
        ? c.totalExpMs / c.totalExpExecutions
        : 0,
      avgLlmResponseMs: c.llmCallCount > 0
        ? c.totalLlmMs / c.llmCallCount
        : 0,
      estimatedTokenSavings: c.expDirectCount * this.AVG_EXP_TOKENS_SAVED
        + c.expVerifiedCount * Math.floor(this.AVG_EXP_TOKENS_SAVED * 0.3),
    };

    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.MAX_SNAPSHOTS) {
      this.snapshots = this.snapshots.slice(-this.MAX_SNAPSHOTS);
    }

    return snapshot;
  }

  // ── 查询 ──

  getLatestSnapshot(): MetricSnapshot | null {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
  }

  getSnapshots(count = 10): MetricSnapshot[] {
    return this.snapshots.slice(-count);
  }

  getCounters() {
    return { ...this.counters };
  }

  // ── 经验分析 ──

  /**
   * 从经验图谱生成各经验的效果报告
   */
  analyzeExperiences(experiences: ExperienceUnit[]): ExperienceMetrics[] {
    const now = Date.now();
    return experiences
      .map(exp => ({
        expId: exp.id,
        name: exp.name,
        abstractionLevel: exp.abstractionLevel,
        confidence: exp.stats.confidence,
        successCount: exp.stats.successCount,
        failCount: exp.stats.failCount,
        successRate: (exp.stats.successCount + exp.stats.failCount) > 0
          ? exp.stats.successCount / (exp.stats.successCount + exp.stats.failCount)
          : 0,
        avgExecutionMs: exp.stats.avgExecutionMs,
        lastUsed: exp.stats.lastUsed,
        age: (now - exp.stats.createdAt) / 3600000,
      }))
      .sort((a, b) => b.confidence - a.confidence);
  }

  // ── 报告 ──

  /**
   * 生成文字摘要报告
   */
  generateReport(): string {
    const s = this.takeSnapshot();
    const lines = [
      '📊 经验系统效果报告',
      '─────────────────',
      `总交互: ${s.totalInteractions}`,
      `  零LLM执行: ${s.expDirectCount} (${(s.expDirectCount / Math.max(1, s.totalInteractions) * 100).toFixed(1)}%)`,
      `  经验+验证: ${s.expVerifiedCount} (${(s.expVerifiedCount / Math.max(1, s.totalInteractions) * 100).toFixed(1)}%)`,
      `  纯LLM: ${s.llmOnlyCount} (${(s.llmOnlyCount / Math.max(1, s.totalInteractions) * 100).toFixed(1)}%)`,
      '',
      `LLM节省率: ${(s.llmSavingsRate * 100).toFixed(1)}%`,
      `经验成功率: ${(s.expSuccessRate * 100).toFixed(1)}%`,
      `经验平均耗时: ${s.avgExpExecutionMs.toFixed(0)}ms`,
      `LLM平均耗时: ${s.avgLlmResponseMs.toFixed(0)}ms`,
      `估算Token节省: ~${s.estimatedTokenSavings.toLocaleString()}`,
    ];
    return lines.join('\n');
  }

  /**
   * 重置所有计数器
   */
  reset(): void {
    this.counters = {
      totalInteractions: 0, expDirectCount: 0, expVerifiedCount: 0,
      llmOnlyCount: 0, totalExpExecutions: 0, successfulExpExecutions: 0,
      totalExpMs: 0, totalLlmMs: 0, llmCallCount: 0, estimatedTokenSavings: 0,
    };
    this.snapshots = [];
  }
}
