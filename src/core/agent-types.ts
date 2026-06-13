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
}
