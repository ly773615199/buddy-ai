/**
 * 影子大脑 — 类型定义
 *
 * Phase 9.1: 核心接口
 */

import type { TaskSignal, ResourceState, DecisionOutcome, BodyState, Rule, NNConfig } from '../types.js';
export type { TaskSignal, ResourceState, DecisionOutcome, BodyState, Rule, NNConfig };

// ==================== 能力缺口 ====================

export interface FailureRecord {
  timestamp: number;
  error: string;
  confidence: number;
}

export type GapPriority = 'low' | 'medium' | 'high' | 'critical';

export interface CapabilityGap {
  id: string;
  fingerprint: string;
  description: string;
  failures: FailureRecord[];
  firstDetectedAt: number;
  failureCount: number;
  avgConfidence: number;
  relatedSamples: number;
  priority: GapPriority;
}

// ==================== 进化方案 ====================

export type EvolutionLevel = 'L1' | 'L2' | 'L3' | 'L4';
export type EvolutionType = 'new_rule' | 'new_intent' | 'new_tool_combo' | 'nn_expand' | 'module_add';
export type ProposalTarget = 'left' | 'right' | 'cerebellum';
export type ProposalAction = 'add' | 'modify' | 'expand';

export interface ProposalChange {
  target: ProposalTarget;
  action: ProposalAction;
  details: unknown;
}

export interface EvolutionProposal {
  id: string;
  level: EvolutionLevel;
  type: EvolutionType;
  description: string;
  gap: CapabilityGap;
  changes: ProposalChange[];
  expectedImpact: string;
  createdAt: number;
}

// ==================== 时机控制 ====================

export interface TimingConfig {
  maxLoad: number;
  minSamples: number;
  maxLossVolatility: number;
  minIntervalMs: number;
  preferredWindowStart: number;
  preferredWindowEnd: number;
}

export interface TimingCondition {
  current: number;
  threshold: number;
  passed: boolean;
}

export interface TimingDecision {
  allowed: boolean;
  reason: string;
  conditions: {
    load: TimingCondition;
    samples: TimingCondition;
    stability: TimingCondition;
    interval: TimingCondition & { sinceLastMs: number; minMs: number };
    timeWindow: TimingCondition & { currentHour: number; inWindow: boolean };
  };
  score: number;
}

// ==================== 进化锁 ====================

export interface LockResult {
  lockName: string;
  passed: boolean;
  score: number;
  details: string;
  metrics?: Record<string, number>;
}

export interface EvolutionValidation {
  allPassed: boolean;
  locks: LockResult[];
  summary: string;
  timestamp: number;
}

// ==================== 状态管理 ====================

export interface EvolutionSnapshot {
  version: number;
  timestamp: number;
  leftRules: Array<{ id: string; name: string; priority: number; source: string; stats: { hits: number; successes: number; lastUsed: number } }>;
  nnConfig: NNConfig;
  nnParamCount: number;
  metrics: {
    successRate: number;
    avgLatencyMs: number;
    gdi: number;
    capabilityCount: number;
  };
}

export interface EvolutionLogEntry {
  version: number;
  timestamp: number;
  proposal: EvolutionProposal;
  validation: EvolutionValidation;
  result: 'applied' | 'rejected' | 'rolled_back';
  metricsBefore: Record<string, number>;
  metricsAfter: Record<string, number>;
  durationMs: number;
}

export type CapabilityStatus = 'mastered' | 'learning' | 'gap' | 'evolving';

export interface CapabilityEntry {
  fingerprint: string;
  description: string;
  status: CapabilityStatus;
  successRate: number;
  lastUpdated: number;
}

export interface CapabilityMap {
  capabilities: CapabilityEntry[];
  totalCapabilities: number;
  masteredCount: number;
  gapCount: number;
  evolvingCount: number;
}

// ==================== A/B 测试 ====================

export type ABTestGroup = 'shadow' | 'production';

export interface ABTestResult {
  group: ABTestGroup;
  success: boolean;
  latencyMs: number;
  cost: number;
}

// ==================== 配置 ====================

export interface ShadowBrainConfig {
  llm: { call: (prompt: string) => Promise<string> };
  dataDir: string;
  timing?: Partial<TimingConfig>;
  verbose?: boolean;
}

// ==================== 大脑数据接口（解耦 ThreeBrain） ====================

/**
 * 影子大脑从 ThreeBrain 读取数据的接口
 * ThreeBrain 实现此接口，影子大脑不直接依赖 ThreeBrain
 */
export interface BrainProvider {
  /** 获取左脑所有规则 */
  getRules(): Rule[];
  /** 添加学习到的规则（L1 进化方案合入） */
  addLearnedRule(rule: Rule): void;
  /** 添加发明的工具规则（ToolInventor 合入，可选） */
  addInventedTool?(rule: Rule): void;
  /** 获取右脑实例（L2 意图扩展写回用，可选） */
  getRightBrain?(): { expandIntentHead(intents: Array<{ label: string; description: string }>): Promise<void> } | null;
  /** 获取经验进化器（autoEvolve/hypothesize 用，可选） */
  getExperienceEvolver?(): { autoEvolve(): Promise<any[]>; hypothesize(): Promise<any[]> } | null;
  /** 获取 NN 配置 */
  getNNConfig(): NNConfig;
  /** 获取 NN 参数量 */
  getNNParamCount(): number;
  /** 获取 NN 权重快照（每个 Tensor 的 Float32Array） */
  getNNWeights(): Float32Array[];
  /** 获取决策记录指纹分布（用于 GDI 结构漂移） */
  getDecisionDistribution(): number[];
  /** 获取最近的训练 loss */
  getRecentLosses(): number[];
  /** 获取决策记忆中的样本（用于进化上下文） */
  getDecisionSamples(): Array<{ labelIntent: number; fingerprint: string }>;
  /** 获取决策记忆的聚类统计（用于缺口相关样本数） */
  getClusterStats(fingerprint: string): { count: number; successRate: number } | null;
  /** 运行回归测试（返回失败数） */
  runRegressionTests(): Promise<number>;
}

/**
 * 可选扩展 — 支持影子副本测试的 BrainProvider
 *
 * 实现此接口后，SwarmManager 可做真实推理验证（第二阶段）
 * 未实现时，SwarmManager 降级为离线 A/B 模拟（第一阶段）
 */
export interface ShadowCapableBrainProvider extends BrainProvider {
  /** 深拷贝当前三脑状态（用于影子副本） */
  cloneBrainState(): {
    rules: Rule[];
    nnWeights: Float32Array[];
    nnConfig: NNConfig;
    decisionDistribution: number[];
  };
  /** 用指定状态运行一次决策推理（不修改线上状态） */
  replayDecision(
    state: { rules: Rule[]; nnWeights: Float32Array[]; nnConfig: NNConfig },
    signal: TaskSignal,
    resources: ResourceState,
  ): Promise<{ success: boolean; latencyMs: number }>;
}

/** 类型守卫：判断 BrainProvider 是否支持影子副本 */
export function isShadowCapable(bp: BrainProvider): bp is ShadowCapableBrainProvider {
  return typeof (bp as any).cloneBrainState === 'function'
    && typeof (bp as any).replayDecision === 'function';
}

// ==================== 进化上下文 ====================

export interface EvolutionContext {
  existingRules: Rule[];
  currentIntentCount: number;
  nnConfig: NNConfig;
  samples: Array<{ labelIntent: number; fingerprint: string }>;
}
