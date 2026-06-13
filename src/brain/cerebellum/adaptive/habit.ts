/**
 * 肌肉记忆 — HabitMemory
 *
 * 统计高频决策 pattern，命中时跳过完整链路：
 * - fingerprint(signal) → 缓存 ExecutionPlan
 * - 固化条件：hitCount ≥ 5 && successRate ≥ 0.8
 * - 淘汰机制：7 天未用 / successRate < 0.6
 * - LRU 淘汰：maxEntries = 200
 *
 * 查表 O(1)，< 0.1ms
 */

import type { TaskSignal, ExecutionPlan } from '../../types.js';

// ==================== 类型 ====================

export interface HabitEntry {
  /** signal fingerprint */
  fingerprint: string;
  /** 缓存的决策 */
  action: ExecutionPlan;
  /** 命中次数 */
  hitCount: number;
  /** 成功率（滑动平均） */
  successRate: number;
  /** 平均延迟（ms） */
  avgLatencyMs: number;
  /** 最后使用时间 */
  lastUsed: number;
  /** 创建时间 */
  createdAt: number;
  /** 是否已固化（达到固化条件后变为 true） */
  solidified: boolean;
}

export interface HabitConfig {
  /** 最大缓存条目数 */
  maxEntries: number;
  /** 固化最小命中次数 */
  minHitsToSolidify: number;
  /** 固化最小成功率 */
  minSuccessRateToSolidify: number;
  /** 淘汰：未使用天数 */
  maxIdleDays: number;
  /** 淘汰：成功率下限 */
  minSuccessRate: number;
  /** 成功率滑动平均衰减因子 */
  successDecay: number;
}

const DEFAULT_CONFIG: HabitConfig = {
  maxEntries: 200,
  minHitsToSolidify: 5,
  minSuccessRateToSolidify: 0.8,
  maxIdleDays: 7,
  minSuccessRate: 0.6,
  successDecay: 0.9,
};

// ==================== HabitMemory ====================

export class HabitMemory {
  private cache: Map<string, HabitEntry> = new Map();
  private config: HabitConfig;
  private verbose: boolean;

  // 统计
  private totalLookups = 0;
  private totalHits = 0;
  private totalRecords = 0;

  constructor(config?: Partial<HabitConfig>, verbose = false) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.verbose = verbose;
  }

  // ==================== 查询 ====================

  /**
   * 查表：命中固化条目 → 直接返回 ExecutionPlan
   *
   * 命中条件：
   * 1. fingerprint 匹配
   * 2. solidified = true（hitCount ≥ minHits && successRate ≥ minRate）
   *
   * @returns ExecutionPlan 或 null（未命中）
   */
  lookup(signal: TaskSignal): ExecutionPlan | null {
    this.totalLookups++;
    const fp = this.fingerprint(signal);
    const entry = this.cache.get(fp);

    if (!entry) return null;
    if (!entry.solidified) return null;

    // 命中：更新统计
    entry.hitCount++;
    entry.lastUsed = Date.now();
    this.totalHits++;

    if (this.verbose && this.totalHits % 50 === 0) {
      console.log(`[HabitMemory] 命中率: ${(this.totalHits / this.totalLookups * 100).toFixed(1)}%`);
    }

    return entry.action;
  }

  // ==================== 写入 ====================

  /**
   * 记录一次决策结果
   *
   * - 新 fingerprint → 创建条目
   * - 已有 → 更新成功率（滑动平均）+ 计数器
   * - 达到固化条件 → solidified = true
   */
  record(signal: TaskSignal, plan: ExecutionPlan, success: boolean, latencyMs = 0): void {
    this.totalRecords++;
    const fp = this.fingerprint(signal);
    let entry = this.cache.get(fp);

    if (!entry) {
      // 新条目
      entry = {
        fingerprint: fp,
        action: plan,
        hitCount: 1,
        successRate: success ? 1.0 : 0.0,
        avgLatencyMs: latencyMs,
        lastUsed: Date.now(),
        createdAt: Date.now(),
        solidified: false,
      };
      this.cache.set(fp, entry);

      // LRU 淘汰
      if (this.cache.size > this.config.maxEntries) {
        this.evictOldest();
      }
      return;
    }

    // 已有条目：滑动平均更新成功率
    entry.successRate = entry.successRate * this.config.successDecay
                      + (success ? 1 : 0) * (1 - this.config.successDecay);
    entry.hitCount++;
    entry.lastUsed = Date.now();
    entry.action = plan; // 覆盖为最新决策

    // 延迟滑动平均
    if (latencyMs > 0) {
      entry.avgLatencyMs = entry.avgLatencyMs * 0.9 + latencyMs * 0.1;
    }

    // 检查固化条件
    if (!entry.solidified
        && entry.hitCount >= this.config.minHitsToSolidify
        && entry.successRate >= this.config.minSuccessRateToSolidify) {
      entry.solidified = true;
      if (this.verbose) {
        console.log(`[HabitMemory] 固化: ${fp.slice(0, 30)} (hits=${entry.hitCount}, rate=${entry.successRate.toFixed(2)})`);
      }
    }
  }

  // ==================== 维护 ====================

  /**
   * 淘汰过期条目
   *
   * 移除条件：
   * 1. 超过 maxIdleDays 未使用
   * 2. successRate < minSuccessRate（已固化但成功率下降）
   *
   * @returns 淘汰数量
   */
  prune(): number {
    const now = Date.now();
    const maxIdleMs = this.config.maxIdleDays * 24 * 60 * 60 * 1000;
    let pruned = 0;

    for (const [fp, entry] of this.cache) {
      const idle = now - entry.lastUsed;
      const staleRate = entry.solidified && entry.successRate < this.config.minSuccessRate;

      if (idle > maxIdleMs || staleRate) {
        this.cache.delete(fp);
        pruned++;
      }
    }

    if (this.verbose && pruned > 0) {
      console.log(`[HabitMemory] 淘汰 ${pruned} 条，剩余 ${this.cache.size}`);
    }
    return pruned;
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
    this.totalLookups = 0;
    this.totalHits = 0;
    this.totalRecords = 0;
  }

  // ==================== 查询 ====================

  /**
   * 获取缓存大小
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * 获取已固化条目数
   */
  get solidifiedCount(): number {
    let count = 0;
    for (const entry of this.cache.values()) {
      if (entry.solidified) count++;
    }
    return count;
  }

  /**
   * 获取命中率
   */
  get hitRate(): number {
    return this.totalLookups > 0 ? this.totalHits / this.totalLookups : 0;
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalEntries: number;
    solidifiedEntries: number;
    totalLookups: number;
    totalHits: number;
    hitRate: number;
    totalRecords: number;
  } {
    return {
      totalEntries: this.cache.size,
      solidifiedEntries: this.solidifiedCount,
      totalLookups: this.totalLookups,
      totalHits: this.totalHits,
      hitRate: this.hitRate,
      totalRecords: this.totalRecords,
    };
  }

  /**
   * 获取所有条目（调试用）
   */
  getEntries(): HabitEntry[] {
    return [...this.cache.values()];
  }

  // ==================== 内部 ====================

  /**
   * 生成 signal fingerprint
   *
   * hash(domains + complexity + taskType)
   * 同一 fingerprint 的信号会命中同一缓存
   */
  fingerprint(signal: TaskSignal): string {
    const domains = [...signal.domains].sort().join(',');
    return `${domains}|${signal.complexity}|${signal.taskType}`;
  }

  /**
   * LRU 淘汰：移除最久未用的条目
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [fp, entry] of this.cache) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = fp;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}
