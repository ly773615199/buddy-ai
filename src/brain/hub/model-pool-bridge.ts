/**
 * ModelPoolResourceBridge — ModelPool ↔ ResourceHub 双向同步桥
 *
 * 职责:
 * 1. ModelPool → ResourceHub: 模型激活/去激活/发现时同步
 * 2. ResourceHub → ModelPool: 执行反馈回流到 ModelPool stats
 * 3. 启动时全量同步
 */

import type { ResourceHub, ResourceOutcome } from './resource-hub.js';

/** ModelPool 接口（避免循环依赖） */
interface ModelPoolLike {
  profileCount: number;
  getAllProfiles(): Array<{
    id: string;
    displayName?: string;
    active: boolean;
    tier?: string;
    costPer1kInput?: number;
    accessStatus?: string;
    failureStreak?: number;
    stats?: { totalCalls: number; successes: number; avgLatencyMs: number };
  }>;
  recordFeedback?(profileId: string, taskType: string, success: boolean, latencyMs: number, cost?: number, qualityScore?: number): void;
}

export class ModelPoolResourceBridge {
  private pool: ModelPoolLike;
  private hub: ResourceHub;

  constructor(pool: ModelPoolLike, hub: ResourceHub) {
    this.pool = pool;
    this.hub = hub;
  }

  /**
   * 启动时全量同步 — 把 ModelPool 中所有模型注册到 ResourceHub
   * 同步 accessStatus、failureStreak、stats 到 ResourceHub 健康度
   */
  fullSync(): number {
    const profiles = this.pool.getAllProfiles();
    let synced = 0;

    for (const profile of profiles) {
      // 从 accessStatus 推导 ResourceHub status
      let status: 'active' | 'degraded' | 'unavailable' | 'unknown' = 'unknown';
      if (!profile.active) {
        status = 'unavailable';
      } else if (profile.accessStatus === 'denied' || profile.accessStatus === 'broken') {
        status = 'unavailable';
      } else if (profile.failureStreak && profile.failureStreak >= 2) {
        status = 'degraded';
      } else {
        status = 'active';
      }

      // 从 stats 推导 healthScore
      let healthScore = 100;
      if (profile.stats && profile.stats.totalCalls > 0) {
        const successRate = profile.stats.successes / profile.stats.totalCalls;
        healthScore = Math.round(successRate * 80 + 20); // 20 基线 + 80 按成功率
        if (profile.failureStreak && profile.failureStreak >= 3) {
          healthScore = Math.min(healthScore, 30);
        }
      }

      this.hub.register({
        id: `model/${profile.id}`,
        type: 'model',
        name: profile.displayName ?? profile.id,
        status,
        healthScore,
        lastHealthCheck: Date.now(),
      });
      synced++;
    }

    return synced;
  }

  /**
   * 监听模型激活事件
   */
  onModelActivated(profileId: string): void {
    this.hub.updateStatus(`model/${profileId}`, 'active');
  }

  /**
   * 监听模型去激活事件
   */
  onModelDeactivated(profileId: string): void {
    this.hub.updateStatus(`model/${profileId}`, 'unavailable');
  }

  /**
   * 监听新模型发现
   */
  onModelDiscovered(profileId: string, displayName?: string): void {
    this.hub.register({
      id: `model/${profileId}`,
      type: 'model',
      name: displayName ?? profileId,
      status: 'active',
      healthScore: 100,
      lastHealthCheck: Date.now(),
    });
  }

  /**
   * 执行反馈回流 — 从 ResourceHub 同步到 ModelPool
   */
  syncFeedbackToPool(profileId: string, outcome: ResourceOutcome, taskType?: string): void {
    if (this.pool.recordFeedback) {
      this.pool.recordFeedback(
        profileId,
        taskType ?? 'chat',
        outcome.success,
        outcome.latencyMs,
        outcome.cost,
      );
    }
  }
}
