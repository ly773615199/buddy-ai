/**
 * LifecycleManager — 统一资源生命周期状态机
 *
 * 管理所有资源从 discovered → active → degraded → deprecated → deceased 的状态转换。
 * 每次转换触发副作用事件，供外部系统（ModelPool / Scheduler / ResourceHub）响应。
 */

import {
  type LifecycleState,
  type ResourceType,
  type UnifiedResource,
  type LifecycleTransitionEvent,
  LIFECYCLE_TRANSITIONS,
} from './types.js';

export type LifecycleEventHandler = (event: LifecycleTransitionEvent) => void;

export class LifecycleManager {
  private handlers: LifecycleEventHandler[] = [];
  private transitionLog: LifecycleTransitionEvent[] = [];
  private readonly MAX_LOG = 200;

  // ==================== 事件订阅 ====================

  on(handler: LifecycleEventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter(h => h !== handler);
    };
  }

  // ==================== 状态转换 ====================

  /**
   * 尝试转换资源状态
   * @returns true=成功, false=非法转换
   */
  transition(resource: UnifiedResource, target: LifecycleState, reason?: string): boolean {
    const allowed = LIFECYCLE_TRANSITIONS[resource.state];
    if (!allowed.includes(target)) {
      console.warn(`[Lifecycle] 非法转换: ${resource.state} → ${target} (${resource.id})`);
      return false;
    }

    const from = resource.state;
    resource.state = target;
    resource.lastStateChange = Date.now();

    const event: LifecycleTransitionEvent = {
      resourceId: resource.id,
      resourceType: resource.type,
      from,
      to: target,
      timestamp: Date.now(),
      reason,
    };

    // 记录日志
    this.transitionLog.unshift(event);
    if (this.transitionLog.length > this.MAX_LOG) {
      this.transitionLog.length = this.MAX_LOG;
    }

    // 通知所有订阅者
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (e: any) {
        console.warn(`[Lifecycle] 事件处理器异常: ${e.message}`);
      }
    }

    return true;
  }

  // ==================== 探测结果驱动的状态转换 ====================

  /**
   * 探测成功 → 根据当前状态决定转换
   */
  onProbeSucceeded(resource: UnifiedResource): void {
    resource.consecutiveProbeFailures = 0;
    resource.lastProbeAt = Date.now();

    switch (resource.state) {
      case 'discovered':
        this.transition(resource, 'active', '首次探测通过');
        break;
      case 'degraded':
        this.transition(resource, 'active', '探测恢复');
        break;
      case 'deprecated':
        // deprecated 不自动复活，需要审计确认
        break;
      case 'rejected':
        this.transition(resource, 'discovered', '重新探测通过');
        break;
    }
  }

  /**
   * 探测失败 → 根据当前状态决定转换
   */
  onProbeFailed(resource: UnifiedResource, error?: string): void {
    resource.consecutiveProbeFailures++;
    resource.lastProbeAt = Date.now();

    switch (resource.state) {
      case 'discovered':
        this.transition(resource, 'rejected', `首次探测失败: ${error}`);
        break;
      case 'active':
        if (resource.consecutiveProbeFailures >= 3) {
          this.transition(resource, 'degraded', `连续 ${resource.consecutiveProbeFailures} 次探测失败`);
        }
        break;
      case 'degraded':
        if (resource.consecutiveProbeFailures >= 5) {
          this.transition(resource, 'deprecated', `连续 ${resource.consecutiveProbeFailures} 次探测失败`);
        }
        break;
    }
  }

  /**
   * 执行反馈失败 → 更新连续失败计数
   */
  onExecutionFailed(resource: UnifiedResource): void {
    resource.consecutiveExecFailures++;

    if (resource.state === 'active' && resource.consecutiveExecFailures >= 3) {
      this.transition(resource, 'degraded', `执行连续 ${resource.consecutiveExecFailures} 次失败`);
    }
  }

  /**
   * 执行反馈成功 → 重置连续失败计数
   */
  onExecutionSucceeded(resource: UnifiedResource): void {
    resource.consecutiveExecFailures = 0;

    if (resource.state === 'degraded') {
      this.transition(resource, 'active', '执行恢复成功');
    }
  }

  /**
   * 审计淘汰 → 标记为 deprecated
   */
  onAuditRetire(resource: UnifiedResource, reason: string): void {
    if (resource.state === 'active' || resource.state === 'degraded') {
      this.transition(resource, 'deprecated', `审计淘汰: ${reason}`);
    }
  }

  /**
   * 审计复活 → 从 deprecated 恢复到 active
   */
  onAuditRevive(resource: UnifiedResource): void {
    if (resource.state === 'deprecated') {
      this.transition(resource, 'active', '审计确认仍有价值');
    }
  }

  /**
   * 清理资源 → 从 deprecated 进入 deceased
   */
  onCleanup(resource: UnifiedResource): void {
    if (resource.state === 'deprecated') {
      this.transition(resource, 'deceased', '资源清理');
    }
  }

  // ==================== 查询 ====================

  /** 获取最近的状态转换日志 */
  getRecentTransitions(limit = 20): LifecycleTransitionEvent[] {
    return this.transitionLog.slice(0, limit);
  }

  /** 获取某资源的转换历史 */
  getResourceHistory(resourceId: string): LifecycleTransitionEvent[] {
    return this.transitionLog.filter(e => e.resourceId === resourceId);
  }

  /** 检查转换是否合法 */
  canTransition(from: LifecycleState, to: LifecycleState): boolean {
    return LIFECYCLE_TRANSITIONS[from].includes(to);
  }
}
