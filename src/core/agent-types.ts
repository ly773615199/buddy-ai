/**
 * Agent 核心类型定义
 *
 * 从 agent.ts 提取，供编排/执行/反思各模块共用。
 * 与 brain/types.ts 中的同名类型保持结构一致（单源真理由 brain/types.ts 管理）。
 */

// ==================== 信号观察器 ====================

export interface SignalObserverEvent {
  /** 事件阶段 */
  phase: 'signal' | 'resource' | 'decision' | 'execution' | 'outcome';
  /** 追踪 ID（关联整条决策链路） */
  traceId: string;
  /** 时间戳 */
  timestamp: number;
  /** 阶段详情 */
  data: Record<string, unknown>;
}

export type SignalObserver = (event: SignalObserverEvent) => void;

// ==================== 编排信号 + 资源状态 ====================

/** Stage 1 输出：纯语义信号，不依赖资源状态，可独立测试 */
export interface TaskSignal {
  domains: string[];
  complexity: 'simple' | 'medium' | 'complex';
  taskType: 'chat' | 'tools' | 'reasoning' | 'background' | 'domain';
  shouldUseDAG: boolean;
  dagReason: string;
  intentConfidence: number;
  /** 用户原始输入（供 ModelRouter 构建需求） */
  content?: string;
  /** 任务关键性 — 由三脑在感知阶段评估，驱动模型选择和 cascade 策略 */
  criticality?: 'low' | 'normal' | 'high';
}

/** Stage 2 输入：运行时资源状态 */
export interface ResourceState {
  budgetRemaining: number;
  availableNodeCount: number;
  localCoverageRatio: number;
  localConfidence: number;
  userCorrectionCount: number;
  experienceHit: import('../intelligence/types.js').RouteDecision | null;
  /** 工具健康度摘要（来自 SkillGrowth） */
  toolHealth?: import('../brain/types.js').ToolHealthSummary;
  /** 非模型资源画像（来自 UnifiedResourceBridge） */
  resourceSnapshot?: {
    /** 可用工具数 */
    toolCount: number;
    /** 可用知识源数 */
    knowledgeSourceCount: number;
    /** 已注册平台数 */
    platformCount: number;
    /** 可用 TTS 后端数 */
    ttsCount: number;
    /** 可用本地专家数 */
    expertCount: number;
    /** 已安装技能数 */
    skillCount: number;
    /** 总资源数 */
    totalResources: number;
    /** 健康度分布 */
    healthDistribution: { healthy: number; degraded: number; unhealthy: number };
  };
}

// ==================== 失败分析（Phase 1.1: 失败感知重试） ====================

/** 失败分类 */
export type FailureCategory =
  | 'prompt_issue'       // prompt 不当导致输出质量差
  | 'tool_failure'       // 工具执行失败
  | 'model_weakness'     // 模型能力不足
  | 'resource_mismatch'  // 资源选择不匹配
  | 'unknown';           // 未知原因

/** 建议的重试策略 */
export type RetryStrategy =
  | 'switch_model'       // 换模型
  | 'switch_tools'       // 换工具
  | 'decompose_task'     // 分解任务
  | 'inject_knowledge'   // 注入额外知识
  | 'simplify'           // 简化任务
  | 'same_path';         // 走同样路径（无更好选择）

/** 结构化失败分析 */
export interface FailureAnalysis {
  category: FailureCategory;
  detail: string;
  suggestedStrategy: RetryStrategy;
  failedModelId?: string;
  failedTools?: string[];
  qualityScore: number;
}
