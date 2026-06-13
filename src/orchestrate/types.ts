/**
 * 多任务编排引擎类型定义 — v2
 * 基于 LLMCompiler (Kim 2023) DAG 模式
 * 支持：条件分支 / 重试 / 超时 / 并行
 */

/** 单个可执行任务 */
export interface Task {
  id: string;
  name: string;               // 人类可读名
  tool: string;                // 工具名
  args: Record<string, unknown>; // 工具参数
  deps: string[];              // 依赖的任务 ID
  status: TaskStatus;
  result?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  /** 重试配置 */
  retry?: RetryConfig;
  /** 单任务超时（ms），0 或不填 = 全局默认 */
  timeoutMs?: number;
  /** 输出变量名，供后续任务通过 ${taskId.output} 引用 */
  outputVar?: string;
}

export type TaskStatus = 'pending' | 'ready' | 'running' | 'done' | 'failed' | 'skipped' | 'retrying';

/** 重试配置 */
export interface RetryConfig {
  max: number;               // 最大重试次数
  delayMs: number;           // 首次重试间隔
  backoff?: 'fixed' | 'exponential'; // 退避策略，默认 exponential
  maxDelayMs?: number;       // 最大间隔，默认 30000
  retryOn?: string[];        // 仅在错误消息包含这些关键词时重试（空=全部重试）
}

/** 条件边 */
export interface ConditionEdge {
  from: string;
  to: string;
  condition: EdgeCondition;
  /** output_equals / output_contains 的目标值 */
  targetValue?: string;
  /** 自定义条件函数名（可选，预留） */
  customFn?: string;
}

export type EdgeCondition =
  | 'success'           // 源任务成功时走此边
  | 'failure'           // 源任务失败时走此边
  | 'always'            // 无论成败都走此边
  | 'output_equals'     // 源任务输出等于 value 时
  | 'output_contains';  // 源任务输出包含 value 时

/** 条件边的条件值 */
export interface EdgeConditionValue {
  value?: string;        // 用于 output_equals / output_contains
}

/** 任务 DAG */
export interface TaskDAG {
  id: string;
  description: string;         // 原始用户意图
  tasks: Map<string, Task>;
  /** 条件边（覆盖默认的 deps 依赖关系） */
  edges: ConditionEdge[];
  /** 可并行执行的任务组 */
  parallelGroups: string[][];
  createdAt: number;
  status: 'planning' | 'executing' | 'done' | 'failed';
  /** 全局默认超时（ms） */
  defaultTimeoutMs: number;
  /** 全局默认重试 */
  defaultRetry?: RetryConfig;
}

/** 编排结果 */
export interface OrchestrateResult {
  dagId: string;
  success: boolean;
  summary: string;             // 汇总后的自然语言描述
  taskResults: Array<{
    id: string;
    name: string;
    success: boolean;
    result: string;
    retries: number;           // 重试次数
    durationMs: number;        // 任务耗时
  }>;
  totalMs: number;
  parallelismGain: number;     // 并行加速比
}

/** 编排引擎事件（推送到前端） */
export type OrchestrateEvent =
  | { type: 'orch_start'; dagId: string; description: string; taskCount: number }
  | { type: 'orch_task_ready'; dagId: string; taskId: string; taskName: string }
  | { type: 'orch_task_start'; dagId: string; taskId: string }
  | { type: 'orch_task_done'; dagId: string; taskId: string; result: string }
  | { type: 'orch_task_fail'; dagId: string; taskId: string; error: string }
  | { type: 'orch_task_retry'; dagId: string; taskId: string; attempt: number; maxRetry: number; delayMs: number }
  | { type: 'orch_task_skipped'; dagId: string; taskId: string; reason: string }
  | { type: 'orch_task_timeout'; dagId: string; taskId: string; timeoutMs: number }
  | { type: 'orch_progress'; dagId: string; done: number; total: number }
  | { type: 'orch_done'; dagId: string; summary: string; totalMs: number }
  | { type: 'orch_fail'; dagId: string; error: string };

/** 规划器输出 */
export interface PlanOutput {
  tasks: Array<{
    id: string;
    name: string;
    tool: string;
    args: Record<string, unknown>;
    deps: string[];
    retry?: RetryConfig;
    timeoutMs?: number;
  }>;
  edges?: ConditionEdge[];
  parallelGroups?: string[][];
}

/** DAG 工作流持久化定义 */
export interface DAGWorkflowDef {
  id: string;
  name: string;
  description: string;
  category: 'dev' | 'ops' | 'data' | 'daily' | 'custom';
  dag: {
    tasks: Array<{
      id: string;
      name: string;
      tool: string;
      args: Record<string, unknown>;
      deps: string[];
      retry?: RetryConfig;
      timeoutMs?: number;
    }>;
    edges?: ConditionEdge[];
    parallelGroups?: string[][];
    defaultTimeoutMs?: number;
  };
  createdAt: number;
  updatedAt: number;
  /** 执行次数 */
  runCount: number;
  /** 最后执行时间 */
  lastRunAt?: number;
}

// ==================== Phase 2: DAG Skeleton（编排/执行分离） ====================

/** DAG 骨架：只有步骤名和依赖，不含具体工具和参数
 *  编排层只管拓扑，Skill 绑定层负责填充工具+参数 */
export interface DAGSkeleton {
  id: string;
  description: string;
  steps: SkeletonStep[];
  edges: ConditionEdge[];
  parallelGroups: string[][];
  complexity: 'simple' | 'medium' | 'complex';
  detectedDomains: string[];
}

/** 骨架步骤：只描述意图，不含具体工具 */
export interface SkeletonStep {
  id: string;
  name: string;              // 人类可读的步骤描述
  intent: string;            // 这一步要达成什么（供 Skill 层匹配）
  deps: string[];
  suggestedCategory?: string; // 建议的工具类别（如 'code_analysis'）
  retry?: RetryConfig;
  timeoutMs?: number;
}

/** SkillResolver 解析结果 */
export interface ResolvedTask {
  tool: string;
  args: Record<string, unknown>;
  source: 'experience' | 'package' | 'skill' | 'llm' | 'builtin';
  confidence: number;
}

/** SkillResolver 完整输出 */
export interface ResolveResult {
  dag: TaskDAG;               // 完整可执行的 DAG
  resolutionLog: Array<{
    stepId: string;
    stepName: string;
    resolvedTool: string;
    source: string;
    confidence: number;
  }>;
  unresolvedSteps: string[];  // 无法解析的步骤（需要 LLM 降级）
}

/** Gate 门控结果 */
export interface GateResult {
  passed: boolean;
  violations: GateViolation[];
  action: 'proceed' | 'downgrade_to_single' | 'replan' | 'remove_step' | 'remove_task' | 'skip_task' | 'reduce_steps' | 'remove_violations';
}

/** Gate 违规项 */
export interface GateViolation {
  rule: string;
  severity: 'block' | 'warn';
  description: string;
  action: string;
  taskId?: string;
}
