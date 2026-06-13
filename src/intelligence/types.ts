/**
 * 经验模型引擎 — 类型定义
 */

// ── 技能步骤 ──

export interface ExperienceStep {
  tool: string;                              // 工具名
  args: Record<string, unknown>;             // 工具参数
  condition?: string;                        // 前置条件（引用前序步骤输出变量名）
  outputVar?: string;                        // 存储输出到变量
  description?: string;                      // 可读描述
}

// ── 回复模板 ──

export interface ReplyTemplate {
  sharp: string;
  warm: string;
  chaotic: string;
  default: string;
}

// ── 可验证条件 ──

export interface ExperienceVerifier {
  type: 'output_contains' | 'file_exists' | 'command_success' | 'custom';
  target?: string;                           // 目标变量名或文件路径
  criteria: string;                          // 验证条件
}

// ── 技能函数 ──

export interface ExperienceUnit {
  id: string;
  name: string;
  description: string;

  /** 经验抽象层级（Phase 4.1） */
  abstractionLevel: 'concrete' | 'workflow' | 'strategy';

  trigger: {
    intent: string;                          // 意图分类
    keywords: string[];                      // 关键词
    contextTags: string[];                   // 上下文标签
    patterns: string[];                      // 正则模式（字符串形式）
  };

  steps: ExperienceStep[];
  replyTemplate: ReplyTemplate;
  verifier?: ExperienceVerifier;

  stats: {
    successCount: number;
    failCount: number;
    confidence: number;                      // 0-1
    avgExecutionMs: number;
    lastUsed: number;
    createdAt: number;
    extractedFrom: string[];
    consolidatedAt: number;
    evolved: boolean;
  };

  /** Phase 6: LLM 推理逻辑 — 理解"为什么这么做" */
  reasoning?: string;

  /** DAG 模式（从对话中提取的并行/重试/条件分支模式） */
  dagPattern?: DAGPattern;
}

// ── DAG 模式（从对话编译提取） ──

export interface DAGPattern {
  tasks: Array<{
    id: string;
    name: string;
    tool: string;
    args: Record<string, unknown>;
    deps: string[];
    retry?: { max: number; delayMs: number; backoff?: 'linear' | 'exponential' };
  }>;
  parallelGroups?: string[][];
  edges?: Array<{
    from: string;
    to: string;
    condition?: string;
  }>;
}

// ── 图谱边 ──

export type EdgeType = 'requires' | 'enhances' | 'alternative';

export interface ExperienceEdge {
  from: string;                              // 源经验 ID
  to: string;                                // 目标经验 ID
  type: EdgeType;
  weight: number;                            // 关联强度 0-1
}

// ── 路由决策 ──

export type RoutePath = 'exp_direct' | 'exp_verified' | 'llm_with_hint' | 'llm' | 'llm_only';

export interface RouteDecision {
  path: RoutePath;
  skill?: ExperienceUnit;
  reason?: string;
  confidence?: number;
  novelty?: number;         // 新颖度 0-1，越高越没见过
}

// ── 执行结果 ──

export interface ExperienceExecutionResult {
  success: boolean;
  outputs: Record<string, string>;           // 步骤输出变量
  reply: string;
  skillId: string;
  executionMs: number;
  failedStep?: number;
  error?: string;
}

// ── 对话快照（用于编译） ──

export interface ConversationSnapshot {
  id: string;
  userMessage: string;
  assistantReply: string;
  toolCalls: Array<{
    name: string;
    args: Record<string, unknown>;
    result: string;
  }>;
  timestamp: number;
  wasSuccessful: boolean;
}

// ── GEP 兼容导出格式 ──

export interface GEPExperienceGene {
  id: string;
  name: string;
  description: string;
  trigger: {
    intent: string;
    keywords: string[];
    patterns: string[];
  };
  steps: Array<{
    tool: string;
    args: Record<string, unknown>;
    description?: string;
  }>;
  confidence: number;
  metadata: {
    successCount: number;
    failCount: number;
    avgExecutionMs: number;
    createdAt: number;
    lastUsed: number;
  };
}

export interface GEPCapsule {
  id: string;
  name: string;
  genes: string[];                // 包含的 gene ID 列组
  strategy: 'sequential' | 'parallel' | 'conditional';
  description: string;
}

export interface GEPExportData {
  format: 'gep';
  version: string;
  genes: GEPExperienceGene[];
  capsules: GEPCapsule[];
  events: Array<{
    type: string;
    expUnitId: string;
    detail: string;
    timestamp?: number;
  }>;
  exportedAt: number;
  source: string;
}
