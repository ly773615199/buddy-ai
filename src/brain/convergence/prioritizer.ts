/**
 * 信号优先级排序 + 去重
 */

import type { TrainingSample } from '../types.js';
import type { PrioritizedSample, SignalSource, ConvergenceConfig } from './types.js';

export class SignalPrioritizer {
  private config: ConvergenceConfig;
  private recentKeys = new Map<string, number>(); // dedupeKey → timestamp

  constructor(config: ConvergenceConfig) {
    this.config = config;
  }

  /**
   * 将带来源的样本转为优先级样本，应用去重
   */
  prioritize(samples: TrainingSample[], source: SignalSource): PrioritizedSample[] {
    const multiplier = this.config.priorities[source] ?? 1.0;
    const result: PrioritizedSample[] = [];

    for (const sample of samples) {
      const dedupeKey = this.buildDedupeKey(sample, source);

      // 去重检查
      if (dedupeKey && this.isDuplicate(dedupeKey)) {
        continue;
      }

      // 应用优先级权重
      const prioritized: PrioritizedSample = {
        sample: {
          ...sample,
          weight: sample.weight * multiplier,
        },
        source,
        priority: multiplier,
        ingestedAt: Date.now(),
        dedupeKey,
      };

      result.push(prioritized);

      // 记录去重 key
      if (dedupeKey) {
        this.recentKeys.set(dedupeKey, Date.now());
      }
    }

    // 清理过期的去重 key
    this.cleanupDedupeKeys();

    return result;
  }

  /**
   * 按优先级排序（高优先级在前）
   */
  sort(prioritized: PrioritizedSample[]): PrioritizedSample[] {
    return prioritized.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 限制批次大小
   */
  limitBatch(samples: PrioritizedSample[]): PrioritizedSample[] {
    if (samples.length <= this.config.maxBatchSize) return samples;
    // 已按优先级排序，取前 N 个
    return samples.slice(0, this.config.maxBatchSize);
  }

  /**
   * 构建去重 key
   * 基于样本的意图标签 + 工具标签 + 来源，避免同一信号重复注入
   */
  private buildDedupeKey(sample: TrainingSample, source: SignalSource): string {
    const intent = sample.labelIntent;
    const tools = sample.labelTools.join(',');
    return `${source}:${intent}:${tools}`;
  }

  /**
   * 检查是否在去重窗口内
   */
  private isDuplicate(key: string): boolean {
    const lastTime = this.recentKeys.get(key);
    if (!lastTime) return false;
    return (Date.now() - lastTime) < this.config.dedupeWindowMs;
  }

  /**
   * 清理过期的去重 key
   */
  private cleanupDedupeKeys(): void {
    const now = Date.now();
    for (const [key, time] of this.recentKeys) {
      if (now - time > this.config.dedupeWindowMs * 2) {
        this.recentKeys.delete(key);
      }
    }
  }

  /** 获取统计 */
  getDedupeCacheSize(): number {
    return this.recentKeys.size;
  }
}
