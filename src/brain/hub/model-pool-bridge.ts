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
  }>;
  recordFeedback?(profileId: string, taskType: string, success: boolean, latencyMs: number, cost?: number): void;
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
   */
  fullSync(): number {
    const profiles = this.pool.getAllProfiles();
    let synced = 0;

    for (const profile of profiles) {
      this.hub.register({
        id: `model/${profile.id}`,
        type: 'model',
        name: profile.displayName ?? profile.id,
        status: profile.active ? 'active' : 'unavailable',
        healthScore: 100,
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
