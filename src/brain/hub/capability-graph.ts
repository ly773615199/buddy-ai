/**
 * CapabilityGraph — 能力变化图谱查询接口
 *
 * 提供资源能力的时间线、趋势、漂移事件、状态历史查询。
 * 不做存储，从 UnifiedResourceHub 实时聚合。
 */

import type {
  ResourceType,
  LifecycleState,
  UnifiedResource,
  CapabilitySnapshot,
  DriftAlert,
  DriftSeverity,
} from './types.js';
import { UnifiedResourceHub } from './unified-resource-hub.js';

export interface ResourceOverview {
  total: number;
  byState: Record<LifecycleState, number>;
  byType: Record<ResourceType, number>;
  recentDrifts: DriftAlert[];
  healthDistribution: { healthy: number; degraded: number; unhealthy: number };
}

export interface StateTransition {
  from: LifecycleState;
  to: LifecycleState;
  at: number;
  reason?: string;
}

export interface CapabilityTrend {
  timestamp: number;
  value: boolean | number | string;
  source: string;
}

export class CapabilityGraph {
  private hub: UnifiedResourceHub;

  constructor(hub: UnifiedResourceHub) {
    this.hub = hub;
  }

  /**
   * 获取资源的能力变化时间线
   */
  getTimeline(resourceId: string, from?: number, to?: number): CapabilitySnapshot[] {
    const r = this.hub.get(resourceId);
    if (!r) return [];

    let timeline = r.capabilityTimeline;
    if (from) timeline = timeline.filter(s => s.timestamp >= from);
    if (to) timeline = timeline.filter(s => s.timestamp <= to);
    return timeline;
  }

  /**
   * 获取某维度的变化趋势
   */
  getTrend(resourceId: string, dimension: string): CapabilityTrend[] {
    const r = this.hub.get(resourceId);
    if (!r) return [];

    return r.capabilityTimeline
      .map(snap => {
        const cap = snap.capabilities[dimension];
        if (!cap) return null;
        return { timestamp: snap.timestamp, value: cap.value, source: snap.source };
      })
      .filter(Boolean) as CapabilityTrend[];
  }

  /**
   * 获取漂移事件
   */
  getDriftAlerts(resourceId: string, severity?: DriftSeverity): DriftAlert[] {
    return this.hub.getDriftAlerts(resourceId, severity);
  }

  /**
   * 获取状态转换历史
   */
  getStateHistory(resourceId: string): StateTransition[] {
    return this.hub.getResourceHistory(resourceId).map(e => ({
      from: e.from,
      to: e.to,
      at: e.timestamp,
      reason: e.reason,
    }));
  }

  /**
   * 全局概览
   */
  getOverview(): ResourceOverview {
    return this.hub.getHealthSummary();
  }

  /**
   * 获取资源的完整能力画像（当前值 + 元信息）
   */
  getCapabilityProfile(resourceId: string): Record<string, {
    value: boolean | number | string;
    verified: boolean;
    lastVerifiedAt: number;
    driftScore: number;
  }> | null {
    const r = this.hub.get(resourceId);
    if (!r) return null;

    const profile: Record<string, any> = {};
    for (const [dim, cap] of Object.entries(r.capabilities)) {
      profile[dim] = {
        value: cap.value,
        verified: cap.verified,
        lastVerifiedAt: cap.lastVerifiedAt,
        driftScore: this.hub.getDriftAlerts(resourceId)
          .filter(a => a.dimension === dim)
          .reduce((max, a) => Math.max(max, a.driftScore), 0),
      };
    }
    return profile;
  }

  /**
   * 对比两个资源的能力
   */
  compareCapabilities(id1: string, id2: string): {
    common: string[];
    onlyInFirst: string[];
    onlyInSecond: string[];
    differences: Array<{ dimension: string; value1: any; value2: any }>;
  } | null {
    const r1 = this.hub.get(id1);
    const r2 = this.hub.get(id2);
    if (!r1 || !r2) return null;

    const dims1 = new Set(Object.keys(r1.capabilities));
    const dims2 = new Set(Object.keys(r2.capabilities));
    const common = [...dims1].filter(d => dims2.has(d));
    const onlyInFirst = [...dims1].filter(d => !dims2.has(d));
    const onlyInSecond = [...dims2].filter(d => !dims1.has(d));
    const differences = common
      .filter(d => r1.capabilities[d].value !== r2.capabilities[d].value)
      .map(d => ({
        dimension: d,
        value1: r1.capabilities[d].value,
        value2: r2.capabilities[d].value,
      }));

    return { common, onlyInFirst, onlyInSecond, differences };
  }
}
