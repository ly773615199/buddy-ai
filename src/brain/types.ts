/**
 * 三脑架构 — 共享类型定义
 *
 * 左脑（理性决策）、右脑（直觉学习）、小脑（本体感知）共用的类型
 */

// ==================== 三脑信号 ====================

/** 左脑输出的执行计划 */
export interface ExecutionPlan {
  mode: 'local_only' | 'single' | 'parallel' | 'cascade' | 'sequential' | 'debate' | 'deliberate' | 'clarify' | 'brainstorm' | 'direct';
  reason: string;
  selectedNodes: OrchestrationNode[];
  confidence: number;
  /** 来源：'rule' | 'scheduler' | 'intuition' | 'deliberation' */
  source: string;
  /** 审议元动作：proceed=放行, refine=需丰富信息, concede=信心不足交给 LLM, brainstorm=生成方案让用户选择 */
  metaAction?: 'proceed' | 'refine' | 'concede' | 'brainstorm';
  /** 审议细化策略 */
  refineStrategy?: 'ask_user' | 'multi_llm' | 'tool_check' | 'llm_only' | 'local_only';
  /** Step 14: 直接执行工具 — 跳过 LLM，直接调用工具返回结果 */
  directTool?: { name: string; args: Record<string, unknown> };
}

/** 右脑输出的直觉信号 */
export interface IntuitionSignal {
  /** 意图分类 */
  intent: { category: string; confidence: number };
  /** 原型匹配结果（PrototypeMemory 双通道） */
  protoMatch?: {
    prototype: { id: string; label: string };
    distance: number;
    confidence: number;
    isNovel: boolean;
  };
  /** 推荐工具子集 */
  suggestedTools: string[];
  /** 质量预判（经验匹配的预估质量） */
  qualityEstimate: number;
  /** 直觉模型是否命中（false 表示 fallback 到规则） */
  hit: boolean;
}

/** 右脑 NN 输出的原始决策 */
export interface IntuitionDecision {
  intent: { category: string; confidence: number };
  tools: Array<{ name: string; probability: number }>;
  quality: number;
  confidence: number;
  latencyMs: number;
}

/** 小脑输出的稳态调节动作 */
export interface HomeostasisAction {
  type: 'adjust_prompt' | 'adjust_model' | 'trigger_dream' | 'reduce_tools'
      | 'request_clarify' | 'slow_response' | 'inject_mood' | 'no_action';
  reason: string;
  priority: number;  // 1-10
  params?: Record<string, unknown>;
}

// ==================== 本体状态 ====================

/** 本体状态（小脑维护的全局状态） */
export interface BodyState {
  // 生理层
  energy: number;            // 0-100 精力
  temperature: number;       // 0-100 活跃度
  load: number;              // 0-100 系统负载
  hunger: number;            // 0-100 交互饥渴度

  // 情绪层（Plutchik 8 维）
  emotion: EmotionVector;

  // 欲望层（6 维）
  desires: DesireVector;

  // 认知层
  focusLevel: number;        // 0-100 专注度
  confidenceLevel: number;   // 0-100 自信度
  confusionLevel: number;    // 0-100 困惑度

  // 社交层
  intimacyLevel: number;     // 0-100 亲密度
  socialNeed: number;        // 0-100 社交需求

  // 环境层
  hour: number;              // 0-23
  isUserActive: boolean;
  lastInteractionMs: number;
  systemHealth: 'good' | 'degraded' | 'critical';
}

export interface EmotionVector {
  joy: number; sadness: number; anger: number; fear: number;
  surprise: number; disgust: number; trust: number; anticipation: number;
}

export interface DesireVector {
  hunger: number; curiosity: number; social: number;
  safety: number; expression: number; rest: number;
}

// ==================== 本体事件 ====================

/** 本体事件（感知融合的输出） */
export interface BodyEvent {
  type: 'user_message' | 'tool_result' | 'heartbeat' | 'environment' | 'system' | 'dream' | 'timeout';
  timestamp: number;
  data: Record<string, unknown>;
}

// ==================== 决策上下文 ====================

/** 决策上下文 */
export interface DecisionContext {
  input: string;
  signal: TaskSignal;
  resources: ResourceState;
  intuition?: IntuitionSignal;
  bodyState?: BodyState;
}

/** 决策结果 */
export interface DecisionOutcome {
  success: boolean;
  latencyMs: number;
  costEstimate: number;
  userFeedback?: 'good' | 'bad';
  toolsUsed: string[];
}

// ==================== 编排相关（兼容旧类型） ====================

export interface OrchestrationNode {
  id: string;
  type: 'experience' | 'local_expert' | 'pool' | 'cloud_node';
  skillId?: string;
  novelty?: number;
  routePath?: string;
  /** 统一模型池：具体模型的 provider 和 model */
  provider?: string;
  model?: string;
  /** Provider 凭据（由 UnifiedScheduler 从 ModelPool 注入） */
  apiKey?: string;
  baseUrl?: string;
  /** 模型能力（由 ModelRouter 从 ModelProfile 转换，透传到 LLMAdapter） */
  capabilities?: import('../core/provider-adapter.js').ProviderCapabilities;
}

export interface TaskSignal {
  domains: string[];
  complexity: 'simple' | 'medium' | 'complex';
  taskType: 'chat' | 'tools' | 'reasoning' | 'background' | 'domain';
  shouldUseDAG: boolean;
  dagReason: string;
  intentConfidence: number;
  /** 用户原始输入（供 ModelRouter 构建需求） */
  content?: string;
}

export interface ResourceState {
  budgetRemaining: number;
  availableNodeCount: number;
  localCoverageRatio: number;
  localConfidence: number;
  userCorrectionCount: number;
  experienceHit: unknown | null;
  /** 工具健康度摘要（来自 SkillGrowth） */
  toolHealth?: ToolHealthSummary;
}

// ==================== 失败分析（Phase 1.1） ====================

/** 失败分类 */
export type FailureCategory =
  | 'prompt_issue'
  | 'tool_failure'
  | 'model_weakness'
  | 'resource_mismatch'
  | 'unknown';

/** 建议的重试策略 */
export type RetryStrategy =
  | 'switch_model'
  | 'switch_tools'
  | 'decompose_task'
  | 'inject_knowledge'
  | 'simplify'
  | 'same_path';

/** 结构化失败分析 */
export interface FailureAnalysis {
  category: FailureCategory;
  detail: string;
  suggestedStrategy: RetryStrategy;
  failedModelId?: string;
  failedTools?: string[];
  qualityScore: number;
}

/** 工具健康度摘要 — 注入调度器辅助决策 */
export interface ToolHealthSummary {
  /** 正在考虑的工具名 → 健康评分 (0-100) */
  scores: Record<string, number>;
  /** 不可靠的工具列表（成功率 < 50%） */
  unreliableTools: string[];
  /** 慢工具列表（平均耗时 > 5s） */
  slowTools: string[];
  /** 最近 1 小时工具调用总失败数 */
  recentFailures: number;
}

// ==================== 右脑相关 ====================

/** 直觉任务类型 */
export type IntuitionTask = 'intent_classify' | 'tool_select' | 'quality_assess';

/** 直觉结果 */
export interface IntuitionResult {
  task: IntuitionTask;
  prediction: string | string[] | number;
  confidence: number;
  latencyMs: number;
  modelId: string;
}

/** 调度结果 */
export interface ScheduleResult {
  node: OrchestrationNode;
  layer: 1 | 2 | 3;
  reason: string;
  outputTokenLimit: number;
}

/** 训练样本 */
export interface TrainingSample {
  features: Float32Array;
  labelIntent: number;       // 意图类别 index
  labelTools: number[];      // 工具选择（多标签）
  labelQuality: number;      // 质量 0-1
  outcome: boolean;          // 最终成功/失败
  timestamp: number;
  weight: number;            // Decision-Attention 权重
  /** 样本难度 0-1（课程学习用，低=简单，高=困难） */
  difficulty?: number;
  /** 空间坐标标签 [x, y, z, w, h, d]（归一化 0-1，可选） */
  labelSpatial?: number[];
  /** 场景拓扑标签（节点类别 index，可选） */
  labelScene?: number;
}

/** NN 模型配置 */
export interface NNConfig {
  vocabSize: number;         // 词汇表大小（默认 4096，含多模态 token）
  embedDim: number;          // embedding 维度（默认 128）
  hiddenDim: number;         // 隐藏层维度（默认 256）
  numHeads: number;          // attention 头数（默认 4）
  numLayers: number;         // encoder 层数（默认 4）
  numIntents: number;        // 意图类别数（默认 8）
  numTools: number;          // 工具数量（默认 32）
  ffnDim: number;            // FFN 中间维度（默认 512）
  dropout: number;           // dropout 率（默认 0，推理时不用）
  numSpatialBins: number;    // 空间坐标 bins（默认 6）
  numSceneNodes: number;     // 场景节点数（默认 32）
}

/** 在线学习配置 */
export interface OnlineLearnConfig {
  learningRate: number;      // 学习率（默认 0.001）
  batchSize: number;         // 批大小（默认 8）
  replayBufferSize: number;  // 回放缓冲容量（默认 1000）
  lprLambda: number;         // LPR 近端项系数（默认 0.1）
  lprSnapshotInterval: number; // 权重快照间隔（默认 100 步）
  updateInterval: number;    // 更新间隔（默认每次交互后）
  /** 安全阀：仅观察模式，只记录 loss 不更新权重（默认 false） */
  observeOnly?: boolean;
  /** 安全阀：观察轮数，达到后自动切换到真实更新（默认 0 = 不自动切换） */
  observeRounds?: number;
  /** 安全阀：loss 收敛阈值，连续 N 轮 loss 变化小于此值视为收敛（默认 0.01） */
  convergenceThreshold?: number;
  /** 安全阀：收敛连续计数阈值，连续多少轮低于阈值才视为真正收敛（默认 10） */
  convergencePatience?: number;
}

/** 蒸馏配置 */
export interface DistillConfig {
  temperature: number;       // 蒸馏温度（默认 2.0）
  alphaSignal: number;       // signal span loss 权重（默认 0.4）
  alphaContext: number;      // context span loss 权重（默认 0.3）
  alphaAction: number;       // action span loss 权重（默认 0.3）
  minTeacherSamples: number; // 最少教师样本数（默认 50）
  distillIntervalMs: number; // 蒸馏间隔（默认 1 小时）
}

// ==================== 左脑相关 ====================

/** 规则定义 */
export interface Rule {
  id: string;
  name: string;
  priority: number;
  condition: (signal: TaskSignal, resources: ResourceState,
              intuition?: IntuitionSignal, body?: BodyState) => boolean;
  action: (signal: TaskSignal, resources: ResourceState) => ExecutionPlan;
  source: 'builtin' | 'learned' | 'user';
  stats: { hits: number; successes: number; lastUsed: number; };
  createdAt: number;
}

/** 决策记录 */
export interface DecisionRecord {
  input: string;
  signal: TaskSignal;
  plan: ExecutionPlan;
  outcome?: DecisionOutcome;
  latencyMs: number;
  timestamp: number;
}

/** 蒸馏报告 */
export interface DistillReport {
  newRules: number;
  prunedRules: number;
  negations: number;
  clusters: number;
  totalRecords: number;
  durationMs: number;
}

// ==================== Phase 4: 反馈闭环 ====================

/** 反馈结果 */
export interface FeedbackResult {
  action: 'success' | 'redecide' | 'escalate';
  /** 重新决策时的新计划 */
  newPlan?: ExecutionPlan;
  /** 反思内容 */
  reflection?: string;
  /** 升级到用户时的诊断报告 */
  diagnostic?: DiagnosticReport;
  /** 输出质量分数 0-1（Module 1: OutputQualityAssessor） */
  qualityScore?: number;
}

/** 结构化诊断报告 */
export interface DiagnosticReport {
  category: 'no_provider' | 'auth_expired' | 'no_native_tools' | 'all_models_weak' | 'token_limit' | 'unknown';
  message: string;
  detail: string;
  suggestions: Array<{
    action: 'add_provider' | 'update_key' | 'reduce_tools' | 'switch_model' | 'retry';
    label: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
  }>;
  attempted: string[];
  failedReasons: string[];
  mood: 'frustrated' | 'confused' | 'tired';
}
