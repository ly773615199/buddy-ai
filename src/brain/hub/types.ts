/**
 * 统一资源生命周期类型定义
 *
 * 所有资源类型共用同一套生命周期状态机和能力画像结构。
 */

// ==================== 资源类型 ====================

export type ResourceType =
  | 'model'           // LLM 模型
  | 'tool'            // 工具（MCP / HTTP / builtin / custom）
  | 'knowledge_source' // 知识源（本地 / 网络 / 飞书）
  | 'platform'        // 平台适配器（Telegram / Discord / 飞书 / 企微等）
  | 'tts'             // TTS 语音服务
  | 'local_expert'    // 本地专家（三进制模型）
  | 'skill';          // 技能包

// ==================== 生命周期状态 ====================

export type LifecycleState =
  | 'discovered'   // 刚发现，未验证
  | 'active'       // 正常服务中
  | 'degraded'     // 能力下降或部分失败
  | 'deprecated'   // 长期低价值，不再参与调度
  | 'deceased'     // 已消亡，保留历史
  | 'rejected';    // 首次验证失败

/** 合法状态转换表 */
export const LIFECYCLE_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  discovered:  ['active', 'rejected'],
  active:      ['degraded', 'deprecated'],
  degraded:    ['active', 'deprecated'],
  deprecated:  ['deceased', 'active'],   // 可复活
  deceased:    [],                        // 终态
  rejected:    ['discovered'],            // 可重试
};

// ==================== 能力快照 ====================

export interface CapabilitySnapshot {
  timestamp: number;
  source: 'probe' | 'runtime' | 'manual' | 'litellm' | 'hf' | 'static';
  capabilities: Record<string, CapabilityValue>;
  confidence: number;        // 0-1
  latencyMs: number;
  error?: string;
}

export interface CapabilityValue {
  value: boolean | number | string;
  verified: boolean;         // 是否经过实测
  lastVerifiedAt: number;
  sourcePriority: number;    // 来源优先级（用于合并决策）
}

// ==================== 漂移检测 ====================

export type DriftSeverity = 'info' | 'warning' | 'critical';

export interface DriftAlert {
  dimension: string;
  driftScore: number;        // 0-1
  timestamp: number;
  severity: DriftSeverity;
  message: string;
}

// ==================== 统一资源 ====================

export interface UnifiedResource {
  id: string;
  type: ResourceType;
  name: string;
  state: LifecycleState;

  // 能力画像
  capabilities: Record<string, CapabilityValue>;
  capabilityTimeline: CapabilitySnapshot[];
  driftAlerts: DriftAlert[];

  // 运行统计
  stats: ResourceStats;

  // 健康度
  healthScore: number;       // 0-100
  consecutiveProbeFailures: number;
  consecutiveExecFailures: number;

  // 边际贡献（审计后填充）
  marginalContribution: MarginalContribution | null;

  // 时间戳
  createdAt: number;
  lastStateChange: number;
  lastProbeAt: number;

  // 元数据（资源特有信息）
  metadata: Record<string, unknown>;
}

export interface ResourceStats {
  totalCalls: number;
  successes: number;
  failures: number;
  avgLatencyMs: number;
  totalCost: number;
  lastUsedAt: number;
  // 按任务类型分维度统计
  byTaskType: Record<string, { attempts: number; successes: number }>;
  // 按领域分维度统计
  byDomain: Record<string, { attempts: number; successes: number }>;
}

// ==================== 边际贡献 ====================

export interface MarginalContribution {
  resourceId: string;
  performanceWith: number;
  performanceWithout: number;
  delta: number;
  smoothedDelta: number;     // EMA 平滑
  sampleCount: number;
  lastAuditedAt: number;
}

export type AuditDecision = 'retain' | 'retire' | 'expand' | 'observe';

// ==================== 探测器接口 ====================

export interface ResourceProber {
  resourceType: ResourceType;
  probe(resource: UnifiedResource): Promise<CapabilitySnapshot>;
  probeIntervalMs: number;
  probeTimeoutMs: number;
}

// ==================== 状态转换事件 ====================

export interface LifecycleTransitionEvent {
  resourceId: string;
  resourceType: ResourceType;
  from: LifecycleState;
  to: LifecycleState;
  timestamp: number;
  reason?: string;
}

// ==================== 审计报告 ====================

export interface AuditReport {
  timestamp: number;
  retained: string[];
  retired: string[];
  expanded: string[];
  observed: string[];
  totalAudited: number;
}

// ==================== 资源注册定义 ====================

export interface ResourceDefinition {
  id: string;
  type: ResourceType;
  name: string;
  metadata?: Record<string, unknown>;
}
