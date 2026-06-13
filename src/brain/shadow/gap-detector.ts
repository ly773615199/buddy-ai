/**
 * 缺口检测器 — 检测能力缺口
 *
 * 连续失败 + 低置信度 = 需要进化的缺口
 * 不是所有失败都值得进化，只关注"系统应该会但不会"的任务
 */

import type { TaskSignal, DecisionOutcome } from '../types.js';
import type { CapabilityGap, FailureRecord, GapPriority } from './types.js';

export class GapDetector {
  private gaps: Map<string, CapabilityGap> = new Map();
  private _minFailures: number;
  private _maxConfidence: number;

  constructor(options?: { minFailures?: number; maxConfidence?: number }) {
    this._minFailures = options?.minFailures ?? 3;
    this._maxConfidence = options?.maxConfidence ?? 0.3;
  }

  // ── 参数 setter（供 SelfModifier 写回） ──

  /** 设置最小连续失败数才触发缺口 */
  setMinFailures(value: number): void {
    this._minFailures = Math.max(1, value);
  }

  /** 获取当前最小失败数 */
  getMinFailures(): number {
    return this._minFailures;
  }

  /** 设置最大置信度阈值 */
  setMaxConfidence(value: number): void {
    this._maxConfidence = Math.max(0.1, Math.min(1.0, value));
  }

  /** 获取当前最大置信度阈值 */
  getMaxConfidence(): number {
    return this._maxConfidence;
  }

  /**
   * 观测一次决策结果
   *
   * 成功 → 重置该 fingerprint 的缺口计数
   * 失败 → 累计失败记录，更新优先级
   */
  observe(signal: TaskSignal, outcome: DecisionOutcome, confidence: number): void {
    const fp = this.fingerprint(signal);
    let gap = this.gaps.get(fp);

    if (outcome.success) {
      if (gap) {
        gap.failureCount = 0;
        gap.failures = [];
      }
      return;
    }

    if (!gap) {
      gap = {
        id: `gap-${fp}-${Date.now()}`,
        fingerprint: fp,
        description: this.describeGap(signal),
        failures: [],
        firstDetectedAt: Date.now(),
        failureCount: 0,
        avgConfidence: 0,
        relatedSamples: 0,
        priority: 'low',
      };
      this.gaps.set(fp, gap);
    }

    const record: FailureRecord = {
      timestamp: Date.now(),
      error: outcome.toolsUsed?.join(',') ?? 'unknown',
      confidence,
    };

    gap.failures.push(record);
    gap.failureCount++;
    gap.avgConfidence = (gap.avgConfidence * (gap.failureCount - 1) + confidence) / gap.failureCount;
    gap.priority = this.calcPriority(gap);
  }

  /**
   * 获取需要进化的缺口（按优先级排序）
   *
   * 过滤条件：连续失败 >= minFailures 且平均置信度 < maxConfidence
   */
  getActionableGaps(): CapabilityGap[] {
    return [...this.gaps.values()]
      .filter(g => g.failureCount >= this._minFailures && g.avgConfidence < this._maxConfidence)
      .sort((a, b) => this.priorityWeight(b.priority) - this.priorityWeight(a.priority));
  }

  /**
   * 获取所有缺口（含未达到阈值的）
   */
  getAllGaps(): CapabilityGap[] {
    return [...this.gaps.values()];
  }

  /**
   * 获取指定 fingerprint 的缺口
   */
  getGap(fingerprint: string): CapabilityGap | undefined {
    return this.gaps.get(fingerprint);
  }

  /**
   * 清除已解决的缺口（failureCount == 0）
   */
  pruneResolved(): number {
    let pruned = 0;
    for (const [fp, gap] of this.gaps) {
      if (gap.failureCount === 0) {
        this.gaps.delete(fp);
        pruned++;
      }
    }
    return pruned;
  }

  /**
   * 获取统计信息
   */
  getStats(): { totalGaps: number; actionableGaps: number; byPriority: Record<GapPriority, number> } {
    const all = [...this.gaps.values()];
    const actionable = all.filter(g => g.failureCount >= this._minFailures && g.avgConfidence < this._maxConfidence);

    return {
      totalGaps: all.length,
      actionableGaps: actionable.length,
      byPriority: {
        low: all.filter(g => g.priority === 'low').length,
        medium: all.filter(g => g.priority === 'medium').length,
        high: all.filter(g => g.priority === 'high').length,
        critical: all.filter(g => g.priority === 'critical').length,
      },
    };
  }

  // ── 内部方法 ──

  /**
   * 从 signal 生成 fingerprint
   * 复用 DecisionMemory 的格式：domains|complexity|taskType
   */
  fingerprint(signal: TaskSignal): string {
    return `${signal.domains.sort().join(',')}|${signal.complexity}|${signal.taskType}`;
  }

  /**
   * 计算优先级
   */
  private calcPriority(gap: CapabilityGap): GapPriority {
    if (gap.failureCount >= 10 && gap.avgConfidence < 0.1) return 'critical';
    if (gap.failureCount >= 5 && gap.avgConfidence < 0.2) return 'high';
    if (gap.failureCount >= 3) return 'medium';
    return 'low';
  }

  private priorityWeight(p: GapPriority): number {
    return { critical: 4, high: 3, medium: 2, low: 1 }[p];
  }

  private describeGap(signal: TaskSignal): string {
    return `domains=[${signal.domains.join(',')}], complexity=${signal.complexity}, type=${signal.taskType}`;
  }
}
