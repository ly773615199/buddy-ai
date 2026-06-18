/**
 * MarginalAuditor — 边际价值审计器
 *
 * 基于 SLIM 论文的 leave-one-out 思想：
 * 通过比较"有该资源时的任务成功率"与"无该资源时的同类任务成功率"，
 * 计算资源的边际贡献，决定 retain / retire / expand。
 *
 * 数据源：UnifiedResourceHub 的 stats.byTaskType
 */

import type { MarginalContribution, AuditDecision } from './types.js';
import { UnifiedResourceHub } from './unified-resource-hub.js';

export class MarginalAuditor {
  private hub: UnifiedResourceHub;
  private readonly alpha: number;       // EMA 衰减系数
  private readonly retainThreshold: number;
  private readonly retireThreshold: number;
  private readonly minSamples: number;
  private auditTimer: ReturnType<typeof setInterval> | null = null;
  private readonly auditIntervalMs: number;
  private readonly taskTypes: string[];

  constructor(hub: UnifiedResourceHub, options?: {
    alpha?: number;
    retainThreshold?: number;
    retireThreshold?: number;
    minSamples?: number;
    auditIntervalMs?: number;
    taskTypes?: string[];
  }) {
    this.hub = hub;
    this.alpha = options?.alpha ?? 0.3;
    this.retainThreshold = options?.retainThreshold ?? 0.05;
    this.retireThreshold = options?.retireThreshold ?? -0.05;
    this.minSamples = options?.minSamples ?? 10;
    this.auditIntervalMs = options?.auditIntervalMs ?? 60 * 60 * 1000; // 默认 1 小时
    this.taskTypes = options?.taskTypes ?? ['chat', 'tools', 'embedding'];
  }

  /**
   * 启动自动定时审计
   */
  startAutoAudit(): void {
    if (this.auditTimer) return; // 已启动
    this.auditTimer = setInterval(() => {
      try {
        for (const taskType of this.taskTypes) {
          this.runAndApply(taskType);
        }
      } catch (err) {
        console.warn('[MarginalAuditor] 自动审计异常:', (err as Error).message);
      }
    }, this.auditIntervalMs);
    console.log(`[MarginalAuditor] 自动审计已启动，间隔 ${this.auditIntervalMs / 1000}s，任务类型: ${this.taskTypes.join(', ')}`);
  }

  /**
   * 停止自动审计
   */
  stopAutoAudit(): void {
    if (this.auditTimer) {
      clearInterval(this.auditTimer);
      this.auditTimer = null;
      console.log('[MarginalAuditor] 自动审计已停止');
    }
  }

  /**
   * 自动审计是否运行中
   */
  isAutoAuditRunning(): boolean {
    return this.auditTimer !== null;
  }

  /**
   * 估算单个资源的边际贡献
   *
   * 方法：
   * 1. 找到该资源在某任务类型上的成功率
   * 2. 找到同类资源在同一任务类型上的平均成功率
   * 3. 边际贡献 = 该资源成功率 - 同类平均成功率
   */
  estimateContribution(resourceId: string, taskType?: string): MarginalContribution | null {
    const resource = this.hub.get(resourceId);
    if (!resource) return null;

    const stats = resource.stats;
    const totalAttempts = stats.byTaskType[taskType ?? '']?.attempts ?? stats.totalCalls;
    if (totalAttempts < this.minSamples) {
      return null; // 样本不足
    }

    // 该资源的成功率
    const resourceStats = taskType
      ? stats.byTaskType[taskType]
      : { attempts: stats.totalCalls, successes: stats.successes };
    const perfWith = resourceStats.attempts > 0
      ? resourceStats.successes / resourceStats.attempts
      : 0.5;

    // 同类资源的平均成功率（排除自身），包含 active + degraded
    const sameType = this.hub.getAll().filter(r =>
      r.type === resource.type && r.id !== resourceId &&
      (r.state === 'active' || r.state === 'degraded')
    );
    let perfWithout = 0.5; // 默认基线
    if (sameType.length > 0) {
      const totalSucc = sameType.reduce((sum, r) => {
        const s = taskType ? r.stats.byTaskType[taskType] : undefined;
        return sum + (s ? s.successes : (taskType ? 0 : r.stats.successes));
      }, 0);
      const totalAtt = sameType.reduce((sum, r) => {
        const s = taskType ? r.stats.byTaskType[taskType] : undefined;
        return sum + (s ? s.attempts : (taskType ? 0 : r.stats.totalCalls));
      }, 0);
      perfWithout = totalAtt > 0 ? totalSucc / totalAtt : 0.5;
    }

    const delta = perfWith - perfWithout;

    // EMA 平滑
    const existing = resource.marginalContribution;
    const smoothedDelta = existing
      ? this.alpha * delta + (1 - this.alpha) * existing.smoothedDelta
      : delta;

    const mc: MarginalContribution = {
      resourceId,
      performanceWith: perfWith,
      performanceWithout: perfWithout,
      delta,
      smoothedDelta,
      sampleCount: totalAttempts,
      lastAuditedAt: Date.now(),
    };

    // 写回 Hub
    this.hub.updateMarginalContribution(resourceId, mc);

    return mc;
  }

  /**
   * 审计决策
   */
  audit(mc: MarginalContribution): AuditDecision {
    if (mc.sampleCount < this.minSamples) return 'observe';
    if (mc.smoothedDelta >= this.retainThreshold) return 'retain';
    if (mc.smoothedDelta < this.retireThreshold) return 'retire';
    return 'observe';
  }

  /**
   * 批量审计所有 active/degraded 资源
   */
  auditAll(taskType?: string): Array<{
    resourceId: string;
    contribution: MarginalContribution | null;
    decision: AuditDecision;
  }> {
    const resources = this.hub.getActive();
    return resources.map(r => {
      const mc = this.estimateContribution(r.id, taskType);
      const decision = mc ? this.audit(mc) : 'observe';
      return { resourceId: r.id, contribution: mc, decision };
    });
  }

  /**
   * 审计 DAG 中资源组合的边际贡献
   *
   * 方法：将 DAG 中使用的资源组合视为一个整体，比较组合中每个资源
   * 在 DAG 任务类型上的实际表现 vs 该资源在全局同类任务上的表现。
   * 如果组合中某资源表现显著低于其全局水平，说明该组合不适配。
   *
   * @param dagId DAG ID（用于日志）
   * @param steps DAG 步骤执行结果 [{stepId, resourceId, taskType, success, latencyMs}]
   */
  auditDAGCombination(
    dagId: string,
    steps: Array<{
      stepId: string;
      resourceId: string;
      taskType: string;
      success: boolean;
      latencyMs: number;
    }>,
  ): void {
    if (steps.length === 0) return;

    // 1. 回写每个步骤的执行结果到 ResourceHub
    for (const step of steps) {
      this.hub.recordOutcome(step.resourceId, {
        success: step.success,
        latencyMs: step.latencyMs,
        taskType: step.taskType,
      });
    }

    // 2. 计算 DAG 级组合边际贡献
    // 将 DAG 中使用的资源 ID 去重
    const uniqueResources = [...new Set(steps.map(s => s.resourceId))];

    for (const resourceId of uniqueResources) {
      // 该资源在 DAG 中的步骤
      const resourceSteps = steps.filter(s => s.resourceId === resourceId);
      if (resourceSteps.length === 0) continue;

      // 该资源在 DAG 中的成功率
      const dagSuccesses = resourceSteps.filter(s => s.success).length;
      const dagRate = dagSuccesses / resourceSteps.length;

      // 该资源的全局成功率
      const resource = this.hub.get(resourceId);
      if (!resource) continue;
      const globalRate = resource.stats.totalCalls > 0
        ? resource.stats.successes / resource.stats.totalCalls
        : 0.5;

      // 组合边际贡献 = DAG 内成功率 - 全局成功率
      const delta = dagRate - globalRate;

      // EMA 平滑
      const existing = resource.marginalContribution;
      const smoothedDelta = existing
        ? this.alpha * delta + (1 - this.alpha) * existing.smoothedDelta
        : delta;

      const mc: MarginalContribution = {
        resourceId,
        performanceWith: dagRate,
        performanceWithout: globalRate,
        delta,
        smoothedDelta,
        sampleCount: resourceSteps.length,
        lastAuditedAt: Date.now(),
      };

      this.hub.updateMarginalContribution(resourceId, mc);

      // 3. 审计决策
      const decision = this.audit(mc);
      if (decision === 'retire') {
        this.hub.applyAuditDecision(resourceId, 'retire',
          `DAG 组合审计: 边际贡献 ${smoothedDelta.toFixed(3)} (dag=${dagId})`);
      }
    }

    console.log(`[MarginalAuditor] DAG ${dagId} 组合审计完成: ${uniqueResources.length} 个资源, ${steps.length} 个步骤`);
  }

  /**
   * 执行审计并应用决策
   */
  runAndApply(taskType?: string): {
    retained: string[];
    retired: string[];
    observed: string[];
  } {
    const results = this.auditAll(taskType);
    const retained: string[] = [];
    const retired: string[] = [];
    const observed: string[] = [];

    for (const { resourceId, decision, contribution } of results) {
      switch (decision) {
        case 'retain':
          retained.push(resourceId);
          if (this.hub.get(resourceId)?.state === 'deprecated') {
            this.hub.applyAuditDecision(resourceId, 'retain', '边际贡献恢复');
          }
          break;
        case 'retire':
          retired.push(resourceId);
          this.hub.applyAuditDecision(resourceId, 'retire',
            `边际贡献 ${contribution?.smoothedDelta.toFixed(3)}`);
          break;
        case 'observe':
          observed.push(resourceId);
          break;
      }
    }

    return { retained, retired, observed };
  }
}
