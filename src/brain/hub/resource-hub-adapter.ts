/**
 * ResourceHubAdapter — 向后兼容适配器
 *
 * 将旧 ResourceHub 接口委托给 UnifiedResourceHub，
 * 使现有代码（signal-collector / plan-executor / rest-api）无需修改。
 */

import type { ResourceType, ResourceDefinition } from './types.js';
import { UnifiedResourceHub, type ResourceOutcome } from './unified-resource-hub.js';

/** 旧 ResourceProfile 接口（兼容） */
export interface LegacyResourceProfile {
  id: string;
  type: 'model' | 'tool' | 'expert' | 'knowledge_source';
  name: string;
  stats: {
    totalCalls: number;
    successCount: number;
    failureCount: number;
    avgLatencyMs: number;
    totalCost: number;
    lastUsedAt: number;
  };
  strengths: {
    taskTypes: Record<string, { attempts: number; successes: number }>;
    domains: Record<string, { attempts: number; successes: number }>;
  };
  status: 'active' | 'degraded' | 'unavailable' | 'unknown';
  healthScore: number;
  lastHealthCheck: number;
}

export class ResourceHubAdapter {
  constructor(private hub: UnifiedResourceHub) {}

  /**
   * 旧接口：注册资源
   */
  register(resource: Omit<LegacyResourceProfile, 'stats' | 'strengths'>): void {
    const typeMap: Record<string, ResourceType> = {
      model: 'model',
      tool: 'tool',
      expert: 'local_expert',
      knowledge_source: 'knowledge_source',
    };
    const stateMap: Record<string, 'active' | 'degraded' | 'rejected' | 'discovered'> = {
      active: 'active',
      degraded: 'degraded',
      unavailable: 'rejected',   // 先 rejected，由审计决定是否 deprecated
      unknown: 'discovered',
    };

    const def: ResourceDefinition = {
      id: resource.id,
      type: typeMap[resource.type] ?? 'tool',
      name: resource.name,
    };

    const r = this.hub.register(def);

    // 如果旧代码传了状态，应用到新系统
    const targetState = stateMap[resource.status];
    if (targetState && targetState !== 'discovered') {
      this.hub.markState(resource.id, targetState);
    }
  }

  unregister(id: string): void {
    this.hub.unregister(id);
  }

  /**
   * 旧接口：获取可用资源
   */
  getActive(type?: LegacyResourceProfile['type']): LegacyResourceProfile[] {
    const typeMap: Record<string, ResourceType> = {
      model: 'model',
      tool: 'tool',
      expert: 'local_expert',
      knowledge_source: 'knowledge_source',
    };
    const mappedType = type ? typeMap[type] : undefined;
    const resources = this.hub.getActive(mappedType);

    return resources.map(r => ({
      id: r.id,
      type: this.mapTypeBack(r.type),
      name: r.name,
      stats: {
        totalCalls: r.stats.totalCalls,
        successCount: r.stats.successes,
        failureCount: r.stats.failures,
        avgLatencyMs: r.stats.avgLatencyMs,
        totalCost: r.stats.totalCost,
        lastUsedAt: r.stats.lastUsedAt,
      },
      strengths: {
        taskTypes: r.stats.byTaskType,
        domains: r.stats.byDomain,
      },
      status: this.mapStateBack(r.state),
      healthScore: r.healthScore,
      lastHealthCheck: r.lastProbeAt,
    }));
  }

  getById(id: string): LegacyResourceProfile | undefined {
    const r = this.hub.get(id);
    if (!r) return undefined;
    return {
      id: r.id,
      type: this.mapTypeBack(r.type),
      name: r.name,
      stats: {
        totalCalls: r.stats.totalCalls,
        successCount: r.stats.successes,
        failureCount: r.stats.failures,
        avgLatencyMs: r.stats.avgLatencyMs,
        totalCost: r.stats.totalCost,
        lastUsedAt: r.stats.lastUsedAt,
      },
      strengths: {
        taskTypes: r.stats.byTaskType,
        domains: r.stats.byDomain,
      },
      status: this.mapStateBack(r.state),
      healthScore: r.healthScore,
      lastHealthCheck: r.lastProbeAt,
    };
  }

  recommend(taskType: string, domain?: string): LegacyResourceProfile[] {
    return this.hub.recommend(taskType, domain).map(r => ({
      id: r.id,
      type: this.mapTypeBack(r.type),
      name: r.name,
      stats: {
        totalCalls: r.stats.totalCalls,
        successCount: r.stats.successes,
        failureCount: r.stats.failures,
        avgLatencyMs: r.stats.avgLatencyMs,
        totalCost: r.stats.totalCost,
        lastUsedAt: r.stats.lastUsedAt,
      },
      strengths: {
        taskTypes: r.stats.byTaskType,
        domains: r.stats.byDomain,
      },
      status: this.mapStateBack(r.state),
      healthScore: r.healthScore,
      lastHealthCheck: r.lastProbeAt,
    }));
  }

  recordOutcome(id: string, outcome: ResourceOutcome): void {
    this.hub.recordOutcome(id, outcome);
  }

  updateStatus(id: string, status: LegacyResourceProfile['status']): void {
    const stateMap: Record<string, 'active' | 'degraded' | 'rejected'> = {
      active: 'active',
      degraded: 'degraded',
      unavailable: 'rejected',
    };
    const target = stateMap[status];
    if (target) this.hub.markState(id, target);
  }

  getHealthSummary() {
    const summary = this.hub.getHealthSummary();
    return {
      total: summary.total,
      active: summary.byState.active,
      degraded: summary.byState.degraded,
      unavailable: summary.byState.rejected + summary.byState.deprecated + summary.byState.deceased,
    };
  }

  getAll(): LegacyResourceProfile[] {
    return this.hub.getAll().map(r => ({
      id: r.id,
      type: this.mapTypeBack(r.type),
      name: r.name,
      stats: {
        totalCalls: r.stats.totalCalls,
        successCount: r.stats.successes,
        failureCount: r.stats.failures,
        avgLatencyMs: r.stats.avgLatencyMs,
        totalCost: r.stats.totalCost,
        lastUsedAt: r.stats.lastUsedAt,
      },
      strengths: {
        taskTypes: r.stats.byTaskType,
        domains: r.stats.byDomain,
      },
      status: this.mapStateBack(r.state),
      healthScore: r.healthScore,
      lastHealthCheck: r.lastProbeAt,
    }));
  }

  /** 获取底层 UnifiedResourceHub（新代码用） */
  getUnifiedHub(): UnifiedResourceHub {
    return this.hub;
  }

  // ==================== 类型映射 ====================

  private mapTypeBack(type: ResourceType): LegacyResourceProfile['type'] {
    const map: Record<ResourceType, LegacyResourceProfile['type']> = {
      model: 'model',
      tool: 'tool',
      knowledge_source: 'knowledge_source',
      platform: 'tool',       // 旧类型无 platform，降级为 tool
      tts: 'tool',            // 旧类型无 tts，降级为 tool
      local_expert: 'expert',
      skill: 'tool',          // 旧类型无 skill，降级为 tool
    };
    return map[type] ?? 'tool';
  }

  private mapStateBack(state: string): LegacyResourceProfile['status'] {
    const map: Record<string, LegacyResourceProfile['status']> = {
      active: 'active',
      degraded: 'degraded',
      discovered: 'unknown',
      deprecated: 'unavailable',
      deceased: 'unavailable',
      rejected: 'unavailable',
    };
    return map[state] ?? 'unknown';
  }
}
