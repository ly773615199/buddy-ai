/**
 * 审议委员会 — 共享类型定义
 *
 * Phase 1: 右脑激活计划 — 结构化审议替代信号阈值
 */

// ==================== 议题 ====================

/** 议题分析结果 */
export interface Topic {
  id: string;
  /** 用户原始输入 */
  originalInput: string;
  /** 核心问题 */
  coreQuestion: string;
  /** 子议题：需要先弄清楚的子问题 */
  subQuestions: SubQuestion[];
  /** 模糊度 0-1 */
  ambiguityScore: number;
  /** 缺失信息清单 */
  missingInfo: string[];
  /** 是否足够清晰，可以执行 */
  readyToExecute: boolean;
  /** 审议模式：澄清(追问参数) vs 头脑风暴(生成方案) */
  mode: 'clarify' | 'brainstorm';
}

export interface SubQuestion {
  id: string;
  question: string;
  /** 是否是执行的必要条件 */
  required: boolean;
  /** 来源 */
  source: 'vague_word' | 'path歧义' | 'conflict' | 'missing_param' | 'llm分析';
  /** 头脑风暴模式：这个问题的候选答案 */
  options?: Array<{ label: string; description: string; pros: string[]; cons: string[] }>;
}

// ==================== 角色 ====================

export interface DeliberationRole {
  id: string;
  name: string;
  perspective: 'user_advocate' | 'risk_analyst' | 'efficiency' | 'security' | 'domain_expert';
  /** 用于 LLM 的 system prompt */
  prompt: string;
  /** 投票权重 (默认 1.0) */
  weight: number;
}

// ==================== 辩论 ====================

export interface DebateRound {
  round: number;
  statements: RoleStatement[];
  /** 本轮共识度 0-1 */
  consensus: number;
}

export interface RoleStatement {
  roleId: string;
  roleName: string;
  /** 核心观点 */
  position: string;
  /** 对其他角色的回应 */
  responses: string[];
  /** 投票 */
  vote: 'proceed' | 'refine' | 'brainstorm';
  /** 置信度 */
  confidence: number;
  /** 理由 */
  reasoning: string;
}

export interface DebateResult {
  rounds: DebateRound[];
  finalVote: { action: 'proceed' | 'refine' | 'brainstorm'; confidence: number; reasoning: string };
  consensusMethod: 'unanimous' | 'majority' | 'chair_override';
  unresolvedDisagreements: string[];
  /** 头脑风暴模式：辩论中产生的方案提案 */
  proposals: Proposal[];
}

/** 方案提案 — 辩论引擎在头脑风暴模式下产出 */
export interface Proposal {
  id: string;
  /** 方案标题 */
  title: string;
  /** 方案描述 */
  description: string;
  /** 提出者角色 */
  proposedBy: string;
  /** 优势 */
  pros: string[];
  /** 劣势 */
  cons: string[];
  /** 其他角色的支持度 */
  support: Array<{ roleId: string; stance: 'support' | 'neutral' | 'oppose'; reason: string }>;
  /** 综合评分 0-1 */
  score: number;
}

// ==================== 资料 ====================

export interface ResearchResult {
  fileContext?: string;
  projectStructure?: string;
  experience?: string;
  /** 小脑/右脑注入的上下文 */
  brainContext?: {
    bodyState: import('../types.js').BodyState;
    intuition?: import('../types.js').IntuitionSignal;
  };
}

// ==================== 风险 ====================

export interface RiskAssessment {
  level: 'low' | 'medium' | 'high' | 'critical';
  risks: Array<{
    description: string;
    severity: 'low' | 'medium' | 'high';
    mitigation: string;
  }>;
  canProceed: boolean;
  userConfirmations: string[];
}

// ==================== 存档 ====================

export interface DeliberationArchive {
  id: string;
  timestamp: number;
  input: string;
  topic: Topic;
  roles: DeliberationRole[];
  research: ResearchResult;
  debate: DebateResult;
  risk: RiskAssessment;
  decision: { action: string; confidence: number; reasoning: string };
  durationMs: number;
}

// ==================== 审议结果 ====================

export interface DeliberationResult {
  /** 最终决策 */
  action: 'proceed' | 'refine' | 'brainstorm';
  confidence: number;
  reasoning: string;
  /** 议题分析 */
  topic: Topic;
  /** 风险评估 */
  risk: RiskAssessment;
  /** 存档 ID */
  archiveId: string;
  /** 审议耗时 */
  durationMs: number;
  /** refine 时：精确的追问问题 */
  clarificationQuestion?: string;
  /** brainstorm 时：方案选项列表 */
  proposals?: Proposal[];
  /** proceed 时：拆解的执行计划 */
  executionBreakdown?: ExecutionBreakdown;
}

export interface ExecutionBreakdown {
  steps: Array<{
    id: string;
    description: string;
    tool: string;
    dependencies: string[];
  }>;
  estimatedDuration: string;
}
