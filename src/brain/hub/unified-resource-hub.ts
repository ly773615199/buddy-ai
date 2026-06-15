/**
 * UnifiedResourceHub — 统一资源画像系统（v2）
 *
 * 替代旧 ResourceHub，新增：
 * - 生命周期状态机（LifecycleManager）
 * - 能力漂移检测（DriftDetector）
 * - 统一能力画像（CapabilitySnapshot 融合）
 * - 全资源类型支持（model/tool/knowledge/platform/tts/expert/skill）
 * - 边际价值审计接口
 *
 * 保留旧 ResourceHub 的 register/getActive/recommend/recordOutcome 接口，
 * 通过 ResourceHubAdapter 向后兼容。
 */

import type {
  ResourceType,
  LifecycleState,
  UnifiedResource,
  ResourceStats,
  ResourceDefinition,
  CapabilitySnapshot,
  CapabilityValue,
  DriftAlert,
  MarginalContribution,
  AuditDecision,
  AuditReport,
  ResourceProber,
} from './types.js';
import { LifecycleManager, type LifecycleEventHandler } from './lifecycle-manager.js';
import { DriftDetector } from './drift-detector.js';

export type ResourceOutcome = {
  success: boolean;
  latencyMs: number;
  cost?: number;
  taskType?: string;
  domain?: string;
};

export class UnifiedResourceHub {
  private resources: Map<string, UnifiedResource> = new Map();
  private lifecycle: LifecycleManager;
  private driftDetector: DriftDetector;

  constructor(options?: {
    driftWindowSize?: number;
    driftWarningThreshold?: number;
    driftCriticalThreshold?: number;
  }) {
    this.lifecycle = new LifecycleManager();
    this.driftDetector = new DriftDetector({
      windowSize: options?.driftWindowSize,
      warningThreshold: options?.driftWarningThreshold,
      criticalThreshold: options?.driftCriticalThreshold,
    });
  }

  // ==================== 生命周期事件订阅 ====================

  onLifecycleEvent(handler: LifecycleEventHandler): () => void {
    return this.lifecycle.on(handler);
  }

  // ==================== 注册 ====================

  /**
   * 注册新资源 → 进入 discovered 状态
   */
  register(def: ResourceDefinition): UnifiedResource {
    const existing = this.resources.get(def.id);
    if (existing) {
      // 已存在，更新 name 和 metadata
      existing.name = def.name;
      if (def.metadata) Object.assign(existing.metadata, def.metadata);
      return existing;
    }

    const resource: UnifiedResource = {
      id: def.id,
      type: def.type,
      name: def.name,
      state: 'discovered',
      capabilities: {},
      capabilityTimeline: [],
      driftAlerts: [],
      stats: {
        totalCalls: 0,
        successes: 0,
        failures: 0,
        avgLatencyMs: 0,
        totalCost: 0,
        lastUsedAt: 0,
        byTaskType: {},
        byDomain: {},
      },
      healthScore: 50,
      consecutiveProbeFailures: 0,
      consecutiveExecFailures: 0,
      marginalContribution: null,
      createdAt: Date.now(),
      lastStateChange: Date.now(),
      lastProbeAt: 0,
      metadata: def.metadata ?? {},
    };

    this.resources.set(resource.id, resource);
    return resource;
  }

  unregister(id: string): void {
    this.driftDetector.clear(id);
    this.resources.delete(id);
  }

  // ==================== 探测结果处理 ====================

  /**
   * 探测结果回调 → 更新能力 + 漂移检测 + 状态转换
   */
  onProbeResult(resourceId: string, snapshot: CapabilitySnapshot): void {
    const r = this.resources.get(resourceId);
    if (!r) return;

    // 1. 记录能力快照到时间线
    r.capabilityTimeline.push(snapshot);
    if (r.capabilityTimeline.length > 50) r.capabilityTimeline.shift();

    // 2. 漂移检测
    const alerts = this.driftDetector.detectSnapshot(resourceId, snapshot);
    if (alerts.length > 0) {
      r.driftAlerts.push(...alerts);
      // 保留最近 50 条告警
      if (r.driftAlerts.length > 50) r.driftAlerts.splice(0, r.driftAlerts.length - 50);
    }

    // 3. 合并能力（probe > runtime > static）
    this.mergeCapabilities(r, snapshot);

    // 4. 状态转换
    if (snapshot.error) {
      this.lifecycle.onProbeFailed(r, snapshot.error);
    } else {
      this.lifecycle.onProbeSucceeded(r);
    }
  }

  /**
   * 直接标记资源状态（兼容旧代码）
   */
  markState(resourceId: string, state: LifecycleState, reason?: string): void {
    const r = this.resources.get(resourceId);
    if (!r) return;
    this.lifecycle.transition(r, state, reason);
  }

  // ==================== 执行反馈 ====================

  /**
   * 执行结果反馈 → 更新统计 + 健康度 + 状态
   */
  recordOutcome(resourceId: string, outcome: ResourceOutcome): void {
    const r = this.resources.get(resourceId);
    if (!r) return;

    const s = r.stats;
    s.totalCalls++;
    if (outcome.success) s.successes++;
    else s.failures++;
    s.avgLatencyMs = (s.avgLatencyMs * (s.totalCalls - 1) + outcome.latencyMs) / s.totalCalls;
    s.totalCost += outcome.cost ?? 0;
    s.lastUsedAt = Date.now();

    // 按任务类型统计
    if (outcome.taskType) {
      const tt = s.byTaskType[outcome.taskType] ?? { attempts: 0, successes: 0 };
      tt.attempts++;
      if (outcome.success) tt.successes++;
      s.byTaskType[outcome.taskType] = tt;
    }
    // 按领域统计
    if (outcome.domain) {
      const dd = s.byDomain[outcome.domain] ?? { attempts: 0, successes: 0 };
      dd.attempts++;
      if (outcome.success) dd.successes++;
      s.byDomain[outcome.domain] = dd;
    }

    // 健康度重算
    this.recalculateHealth(r);

    // 状态转换
    if (outcome.success) {
      this.lifecycle.onExecutionSucceeded(r);
    } else {
      this.lifecycle.onExecutionFailed(r);
    }
  }

  // ==================== 查询 ====================

  get(id: string): UnifiedResource | undefined {
    return this.resources.get(id);
  }

  getAll(): UnifiedResource[] {
    return [...this.resources.values()];
  }

  /**
   * 获取可用资源（active 或 degraded）
   */
  getActive(type?: ResourceType): UnifiedResource[] {
    const results: UnifiedResource[] = [];
    for (const r of this.resources.values()) {
      if (r.state === 'active' || r.state === 'degraded') {
        if (!type || r.type === type) {
          results.push(r);
        }
      }
    }
    return results;
  }

  /**
   * 推荐资源 — 按任务类型和领域匹配，综合评分排序
   */
  recommend(taskType: string, domain?: string, type?: ResourceType): UnifiedResource[] {
    const candidates = this.getActive(type);

    const scored = candidates.map(r => {
      let score = 0;

      // 任务类型匹配
      const typeStats = r.stats.byTaskType[taskType];
      if (typeStats && typeStats.attempts > 0) {
        score += (typeStats.successes / typeStats.attempts) * 50;
      }

      // 领域匹配
      if (domain) {
        const domainStats = r.stats.byDomain[domain];
        if (domainStats && domainStats.attempts > 0) {
          score += (domainStats.successes / domainStats.attempts) * 30;
        }
      }

      // 健康度
      score += r.healthScore * 0.2;

      return { resource: r, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => s.resource);
  }

  /**
   * 按状态分组查询
   */
  getByState(state: LifecycleState, type?: ResourceType): UnifiedResource[] {
    return [...this.resources.values()].filter(r =>
      r.state === state && (!type || r.type === type)
    );
  }

  /**
   * 健康概览
   */
  getHealthSummary(): {
    total: number;
    byState: Record<LifecycleState, number>;
    byType: Record<ResourceType, number>;
    recentDrifts: DriftAlert[];
    healthDistribution: { healthy: number; degraded: number; unhealthy: number };
  } {
    const byState: Record<LifecycleState, number> = {
      discovered: 0, active: 0, degraded: 0, deprecated: 0, deceased: 0, rejected: 0,
    };
    const byType: Record<ResourceType, number> = {
      model: 0, tool: 0, knowledge_source: 0, platform: 0, tts: 0, local_expert: 0, skill: 0,
    };
    let healthy = 0, degraded = 0, unhealthy = 0;
    const recentDrifts: DriftAlert[] = [];

    for (const r of this.resources.values()) {
      byState[r.state]++;
      byType[r.type]++;

      if (r.healthScore >= 70) healthy++;
      else if (r.healthScore >= 30) degraded++;
      else unhealthy++;

      recentDrifts.push(...r.driftAlerts.filter(a => a.timestamp > Date.now() - 3600_000));
    }

    // 最近漂移按时间排序，取前 20
    recentDrifts.sort((a, b) => b.timestamp - a.timestamp);
    recentDrifts.splice(20);

    return {
      total: this.resources.size,
      byState,
      byType,
      recentDrifts,
      healthDistribution: { healthy, degraded, unhealthy },
    };
  }

  // ==================== 能力查询 ====================

  /**
   * 获取资源当前能力值
   */
  getCapability(resourceId: string, dimension: string): CapabilityValue | undefined {
    return this.resources.get(resourceId)?.capabilities[dimension];
  }

  /**
   * 获取资源能力变化时间线
   */
  getCapabilityTimeline(resourceId: string, dimension?: string): Array<{
    timestamp: number;
    value: boolean | number | string;
    source: string;
  }> {
    const r = this.resources.get(resourceId);
    if (!r) return [];

    return r.capabilityTimeline
      .map(snap => {
        if (dimension) {
          const cap = snap.capabilities[dimension];
          if (!cap) return null;
          return { timestamp: snap.timestamp, value: cap.value, source: snap.source };
        }
        // 无指定维度，返回所有维度的第一个
        const first = Object.values(snap.capabilities)[0];
        if (!first) return null;
        return { timestamp: snap.timestamp, value: first.value, source: snap.source };
      })
      .filter(Boolean) as Array<{ timestamp: number; value: boolean | number | string; source: string }>;
  }

  /**
   * 获取资源漂移告警
   */
  getDriftAlerts(resourceId: string, severity?: string): DriftAlert[] {
    const r = this.resources.get(resourceId);
    if (!r) return [];
    if (severity) return r.driftAlerts.filter(a => a.severity === severity);
    return r.driftAlerts;
  }

  /**
   * P1-2: 运行时更新资源能力
   * 高优先级来源覆盖低优先级（probe > runtime > static）
   */
  updateCapability(resourceId: string, dimension: string, value: CapabilityValue): void {
    const r = this.resources.get(resourceId);
    if (!r) return;
    const existing = r.capabilities[dimension];
    // 高优先级来源覆盖低优先级
    if (!existing || value.sourcePriority >= existing.sourcePriority) {
      r.capabilities[dimension] = value;
      // 触发漂移检测
      const alert = this.driftDetector.detect(resourceId, dimension, value.value);
      if (alert) {
        r.driftAlerts.push(alert);
        if (r.driftAlerts.length > 50) r.driftAlerts.splice(0, r.driftAlerts.length - 50);
      }
    }
  }

  // ==================== 边际价值审计 ====================

  /**
   * 更新资源的边际贡献（由外部 MarginalAuditor 调用）
   */
  updateMarginalContribution(resourceId: string, mc: MarginalContribution): void {
    const r = this.resources.get(resourceId);
    if (!r) return;
    r.marginalContribution = mc;
  }

  /**
   * 执行审计决策
   */
  applyAuditDecision(resourceId: string, decision: AuditDecision, reason: string): void {
    const r = this.resources.get(resourceId);
    if (!r) return;

    switch (decision) {
      case 'retain':
        if (r.state === 'deprecated') {
          this.lifecycle.onAuditRevive(r);
        }
        break;
      case 'retire':
        this.lifecycle.onAuditRetire(r, reason);
        break;
      case 'expand':
        // 扩展：触发重新探测
        r.lastProbeAt = 0; // 强制下次探测
        break;
      case 'observe':
        // 继续观察，不做操作
        break;
    }
  }

  /**
   * 批量审计
   */
  runAudit(): AuditReport {
    const report: AuditReport = {
      timestamp: Date.now(),
      retained: [],
      retired: [],
      expanded: [],
      observed: [],
      totalAudited: 0,
    };

    for (const r of this.resources.values()) {
      if (r.state !== 'active' && r.state !== 'degraded') continue;
      report.totalAudited++;

      const mc = r.marginalContribution;
      if (!mc || mc.sampleCount < 10) {
        report.observed.push(r.id);
        continue;
      }

      if (mc.smoothedDelta >= 0.05) {
        report.retained.push(r.id);
      } else if (mc.smoothedDelta < -0.05) {
        this.lifecycle.onAuditRetire(r, `边际贡献 ${mc.smoothedDelta.toFixed(3)}`);
        report.retired.push(r.id);
      } else {
        report.observed.push(r.id);
      }
    }

    return report;
  }

  // ==================== 能力合并 ====================

  /**
   * 合并探测快照到资源当前能力
   * 优先级：probe > runtime > litellm > hf > static
   */
  private mergeCapabilities(resource: UnifiedResource, snapshot: CapabilitySnapshot): void {
    const sourcePriority: Record<string, number> = {
      probe: 5, runtime: 4, litellm: 3, hf: 2, static: 1, manual: 6,
    };
    const newSourcePriority = sourcePriority[snapshot.source] ?? 0;

    for (const [dim, newVal] of Object.entries(snapshot.capabilities)) {
      const existing = resource.capabilities[dim];

      if (!existing || newSourcePriority >= existing.sourcePriority) {
        resource.capabilities[dim] = {
          value: newVal.value,
          verified: newVal.verified,
          lastVerifiedAt: snapshot.timestamp,
          sourcePriority: newSourcePriority,
        };
      }
    }
  }

  // ==================== 健康度 ====================

  private recalculateHealth(r: UnifiedResource): void {
    const s = r.stats;
    if (s.totalCalls === 0) {
      r.healthScore = 50;
      return;
    }

    const successRate = s.successes / s.totalCalls;
    const recency = Math.min(1, (Date.now() - s.lastUsedAt) / (24 * 60 * 60 * 1000));

    // 健康度 = 成功率 * 70% + 近期使用 * 20% + 基线 10%
    r.healthScore = Math.round(
      successRate * 70 +
      (1 - recency) * 20 +
      10
    );
  }

  // ==================== 生命周期查询 ====================

  getRecentTransitions(limit = 20) {
    return this.lifecycle.getRecentTransitions(limit);
  }

  getResourceHistory(resourceId: string) {
    return this.lifecycle.getResourceHistory(resourceId);
  }

  canTransition(from: LifecycleState, to: LifecycleState): boolean {
    return this.lifecycle.canTransition(from, to);
  }

  // ==================== 存量迁移 ====================

  /**
   * 从旧 ResourceProfile 迁移到 UnifiedResource
   * （用于存量数据升级，不破坏现有流程）
   */
  migrateFromLegacy(legacy: {
    id: string;
    type: 'model' | 'tool' | 'expert' | 'knowledge_source';
    name: string;
    status: 'active' | 'degraded' | 'unavailable' | 'unknown';
    healthScore: number;
    lastHealthCheck: number;
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
  }): UnifiedResource {
    // 映射旧状态到新状态
    const stateMap: Record<string, LifecycleState> = {
      active: 'active',
      degraded: 'degraded',
      unavailable: 'deprecated',
      unknown: 'discovered',
    };
    // 映射旧类型到新类型
    const typeMap: Record<string, ResourceType> = {
      model: 'model',
      tool: 'tool',
      expert: 'local_expert',
      knowledge_source: 'knowledge_source',
    };

    const resource: UnifiedResource = {
      id: legacy.id,
      type: typeMap[legacy.type] ?? 'tool',
      name: legacy.name,
      state: stateMap[legacy.status] ?? 'discovered',
      capabilities: {},
      capabilityTimeline: [],
      driftAlerts: [],
      stats: {
        totalCalls: legacy.stats.totalCalls,
        successes: legacy.stats.successCount,
        failures: legacy.stats.failureCount,
        avgLatencyMs: legacy.stats.avgLatencyMs,
        totalCost: legacy.stats.totalCost,
        lastUsedAt: legacy.stats.lastUsedAt,
        byTaskType: JSON.parse(JSON.stringify(legacy.strengths.taskTypes)),
        byDomain: JSON.parse(JSON.stringify(legacy.strengths.domains)),
      },
      healthScore: legacy.healthScore,
      consecutiveProbeFailures: 0,
      consecutiveExecFailures: 0,
      marginalContribution: null,
      createdAt: Date.now(),
      lastStateChange: Date.now(),
      lastProbeAt: legacy.lastHealthCheck,
      metadata: {},
    };

    this.resources.set(resource.id, resource);
    return resource;
  }
}
