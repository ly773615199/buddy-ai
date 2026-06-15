/**
 * Unified Resource Hub — 统一资源管理系统
 *
 * 导出所有组件，供 subsystems.ts / rest-api.ts 等接入使用。
 */

// 核心类型
export * from './types.js';

// 核心组件
export { LifecycleManager } from './lifecycle-manager.js';
export { DriftDetector } from './drift-detector.js';
export { UnifiedResourceHub, type ResourceOutcome } from './unified-resource-hub.js';
export { ResourceHubAdapter, type LegacyResourceProfile } from './resource-hub-adapter.js';
export { BatchProbeScheduler, type SchedulerConfig } from './batch-probe-scheduler.js';
export { MarginalAuditor } from './marginal-auditor.js';
export { CapabilityGraph } from './capability-graph.js';
export { UnifiedResourceBridge } from './unified-resource-bridge.js';

// 探测器
export {
  createDefaultProbers,
  ModelProber,
  MCPToolProber,
  HTTPToolProber,
  KnowledgeSourceProber,
  PlatformProber,
  TTSProber,
  LocalExpertProber,
  SkillProber,
} from './probers/index.js';

import { UnifiedResourceHub } from './unified-resource-hub.js';
import { ResourceHubAdapter } from './resource-hub-adapter.js';
import { BatchProbeScheduler } from './batch-probe-scheduler.js';
import { MarginalAuditor } from './marginal-auditor.js';
import { CapabilityGraph } from './capability-graph.js';
import { createDefaultProbers } from './probers/index.js';

/**
 * 创建完整的统一资源管理系统
 *
 * 一行代码接入：
 * ```ts
 * const system = createResourceSystem();
 * system.adapter.register({ id: 'model/xxx', type: 'model', name: 'xxx', status: 'active', healthScore: 80, lastHealthCheck: Date.now() });
 * system.scheduler.start();
 * ```
 */
export function createResourceSystem(options?: {
  driftWindowSize?: number;
  driftWarningThreshold?: number;
  driftCriticalThreshold?: number;
  schedulerConcurrency?: number;
  schedulerAutoRefresh?: boolean;
}) {
  const hub = new UnifiedResourceHub({
    driftWindowSize: options?.driftWindowSize,
    driftWarningThreshold: options?.driftWarningThreshold,
    driftCriticalThreshold: options?.driftCriticalThreshold,
  });

  const adapter = new ResourceHubAdapter(hub);
  const probers = createDefaultProbers();
  const scheduler = new BatchProbeScheduler(hub, probers, {
    concurrency: options?.schedulerConcurrency,
    autoRefresh: options?.schedulerAutoRefresh,
  });
  const auditor = new MarginalAuditor(hub);
  auditor.startAutoAudit(); // O3: 启动自动定时审计
  const graph = new CapabilityGraph(hub);

  return { hub, adapter, scheduler, auditor, graph, probers };
}
