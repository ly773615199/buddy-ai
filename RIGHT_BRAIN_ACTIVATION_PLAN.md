# 右脑激活计划 — 完整利用三脑架构的直觉学习脑

> 现状：右脑 7 个已实现能力闲置，利用率 ~40%
> 目标：全部接入主决策链，利用率 → 90%+
> 预估总工期：5 个 Phase，约 2-3 周

---

## 总览：问题与方案

```
当前决策链（单向，右脑只做预测）：
  小脑感知 → 右脑预测 → 左脑规则 → 执行 → 事后反馈

目标决策链（闭环，右脑全程参与）：
  小脑感知 → 右脑感知融合 → 右脑直觉预测 → 右脑审议 → 左脑规则 → 执行
       ↑                                                          ↓
       └──────────── 右脑世界模型学习 ← 工具快照收集 ←────────────┘
```

---

## Phase 1: 审议委员会（核心重构）

> **2026-05-12 重构**：原 `deliberate()` 信号阈值方案经代码验证，4 个信号源在正常场景下几乎无法触发
>（PID 参数保守、onUserMessage 不更新 confusion/confidence、NN 未训练时 hit=false）。
> 升级为结构化审议委员会 (DeliberationCouncil)。

**目标**：当用户任务模糊时，通过讨论帮助用户发现自己想要什么，再执行。

**两种审议模式**：

| | 澄清模式 (Clarify) | 头脑风暴模式 (Brainstorm) |
|---|---|---|
| 前提 | 用户知道答案，只是没说清楚 | 用户自己也在探索 |
| 方式 | 追问缺失参数 | 提供选项方案 + 讨论权衡 |
| 输出 | 精确参数 → 直接执行 | 方向共识 → 迭代细化 |
| 触发 | 信息缺失但方向明确 | 方向本身不确定 |
| 例子 | "保存到哪个文件？" | "齐白石的虾有两种路线：A. 晚年写意 B. 早期工细，你倾向哪个？" |

**审议公式**：
```
审议决策 = 定议题(含模式判断) → 分角色 → 自动查资料 → 多轮辩论(生成方案) → 风险校验 → 合议投票 → 出决策 + 拆执行 + 全程存档
```

**理论依据**：
- MPDF (arXiv 2509.03817) — 元策略审议框架
- MAC (arXiv:2512.13154) — 主动澄清决策
- 多智能体辩论 (LLM Debate, Du et al. 2023)
- 设计思维中的 HMW (How Might We) — 把问题转化为可探索的方向

### 1.0 现有代码诊断：为什么 deliberate() 不工作

**问题 1：信号源无法触发**

| 信号源 | 触发条件 | 实际情况 |
|--------|----------|----------|
| 小脑 request_clarify | PID `cognitiveOut < -30` | kp=0.4, confusion 上限 100, PID 输出最多 -20, 永远不触发 |
| 右脑 qualityEstimate | `intuition.hit && quality < 0.5` | NN 未训练时 hit=false; 关键词规则命中时 quality 通常 > 0.5 |
| 困惑度+自信度 | `confusion > 60 && confidence < 40` | onUserMessage() 不更新 confusion/confidence; 需连续 5+ 次工具错误 |
| 预算耗尽 | `budget <= 0` | 默认 hourlyBudget=Infinity, 永远不触发 |

**问题 2：能力割裂**

```
ClarificationEngine (clarifier.ts)  ← 能检测模糊，但在 message-processor.ts 中独立运行，与三脑无关
deliberate() (brain.ts)             ← 4 信号源，PID 阈值，几乎不触发
executeDebate() (agent.ts)          ← 并行调 LLM + 裁决，没有议题分解和风险校验
```

**结论**：不是缺能力，而是能力没有串联。需要一个统一的审议流程把它们串联起来。

### 1.1 审议委员会架构

**新增目录**: `src/brain/deliberation/`

```
src/brain/deliberation/
├── council.ts           # 审议委员会主控 — 串联全流程
├── topic-analyzer.ts    # 议题分析（定议题）— 合并 ClarificationEngine
├── role-assigner.ts     # 角色分配（分角色）— 动态专家视角
├── research-gatherer.ts # 资料收集（自动查资料）— 文件上下文 + 经验 + 项目结构
├── debate-engine.ts     # 辩论引擎（多轮辩论审议）— 多角色多轮 + 共识检测
├── risk-validator.ts    # 风险校验 — 不可逆操作 / 信息缺失 / 低置信度
├── vote-aggregator.ts   # 合议投票 — 加权投票 + 共识达成
├── archive.ts           # 全程存档 — 审议过程持久化
├── types.ts             # 共享类型
└── index.ts             # 导出
```

**信号流**：

```
用户输入
  ↓
[审议委员会: DeliberationCouncil]
  ├── Step 1: 定议题 + 模式判断 (TopicAnalyzer)
  │     ├── 快速层: 复用 ClarificationEngine 模式匹配 (< 1ms)
  │     └── 深度层: LLM 议题分解 (仅模糊度高时触发)
  │     → Topic { ambiguityScore, subQuestions, missingInfo, readyToExecute, mode }
  │
  │     模糊度 < 0.3 → 快速放行 proceed (零额外开销)
  │     模糊度 ≥ 0.3 → 判断审议模式 ↓
  │
  │     ┌─────────────────────────────────────────────────┐
  │     │ 模式判断逻辑：                                   │
  │     │ - subQuestions 全是 required 且都有明确答案      │
  │     │   → 澄清模式 (追问参数)                         │
  │     │ - 方向不确定 / 多个可行方案 / 用户可能不知道答案 │
  │     │   → 头脑风暴模式 (生成选项方案)                  │
  │     └─────────────────────────────────────────────────┘
  │
  ├── Step 2: 分角色 (RoleAssigner)
  │     ├── 澄清模式: 用户代言人(追问) / 风险分析师 / 执行方案师
  │     └── 头脑风暴模式: 创意提案者 / 方案对比师 / 用户代言人 / 风险分析师
  │     → DeliberationRole[]
  │
  ├── Step 3: 自动查资料 (ResearchGatherer)
  │     ├── 文件上下文: 从输入提取路径，读取相关文件
  │     ├── 项目结构: 涉及代码操作时获取目录摘要
  │     ├── 经验匹配: 从 DecisionMemory 找相似历史
  │     └── 上下文注入: 小脑 BodyState + 右脑 IntuitionSignal
  │     → ResearchResult
  │
  ├── Step 4: 多轮辩论审议 (DebateEngine)  ← 核心
  │     ├── 澄清模式: 角色讨论"缺什么信息"，输出精确追问
  │     ├── 头脑风暴模式: 角色各自提出方案，讨论权衡，生成选项
  │     │     └── 例: "方案A: SVG写意虾(寥寥数笔) / 方案B: SVG工笔虾(细节丰富)"
  │     ├── 角色之间能看到彼此的观点并回应
  │     ├── 共识度 ≥ 0.8 → 提前退出 (最多 3 轮)
  │     └── 每轮输出: DebateRound { statements[], consensus, proposals[] }
  │     → DebateResult { rounds, finalVote, consensusMethod, proposals[] }
  │
  ├── Step 5: 风险校验 (RiskValidator)
  │     ├── 不可逆操作检查 (写/删/部署)
  │     ├── 信息缺失检查 (missingInfo > 0 且 vote=proceed → 强制 refine)
  │     └── 低置信度检查 (confidence < 0.4)
  │     → RiskAssessment { level, risks[], canProceed }
  │
  ├── Step 6: 合议投票 (VoteAggregator)
  │     ├── 加权投票 (用户代言人权重更高)
  │     └── 共识达成方式: unanimous / majority / chair_override
  │     → { action: proceed | refine | brainstorm, confidence, reasoning, proposals[] }
  │
  └── Step 7: 全程存档 (Archive)
        └── 审议过程持久化，供后续复盘和学习
        → DeliberationArchive
```

**输出决策**：

```
action = proceed   → 直接执行（信息充足）
action = refine    → 追问缺失参数（澄清模式输出）
action = brainstorm → 呈现方案选项让用户选择（头脑风暴模式输出）
```

### 1.2 类型定义

**文件**: `src/brain/deliberation/types.ts`

```typescript
// ==================== 议题 ====================

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
  vote: 'proceed' | 'refine' | 'concede';
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
```

### 1.3 议题分析器 (TopicAnalyzer)

**文件**: `src/brain/deliberation/topic-analyzer.ts`

```typescript
import { ClarificationEngine } from '../../core/clarifier.js';
import type { Topic, SubQuestion } from './types.js';

/**
 * 议题分析 — 把模糊输入分解为可审议的子议题 + 判断审议模式
 *
 * 两层策略：
 * - 快速层: 复用 ClarificationEngine 模式匹配 (< 1ms)
 * - 深度层: LLM 议题分解 (仅模糊度高时触发)
 *
 * 两种模式：
 * - clarify: 用户知道答案但没说 → 追问参数
 * - brainstorm: 用户自己也在探索 → 生成方案选项
 */
export class TopicAnalyzer {
  private clarifier: ClarificationEngine;
  private llmCall: ((messages: Array<{ role: string; content: string }>) => Promise<string>) | null = null;

  constructor() {
    this.clarifier = new ClarificationEngine();
  }

  setLLMCaller(caller: (messages: Array<{ role: string; content: string }>) => Promise<string>): void {
    this.llmCall = caller;
  }

  async analyze(input: string, signal: TaskSignal): Promise<Topic> {
    const topicId = `topic-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // 1. 快速模式匹配
    const quick = this.clarifier.assess(input);

    if (!quick.shouldClarify) {
      return {
        id: topicId,
        originalInput: input,
        coreQuestion: input,
        subQuestions: [],
        ambiguityScore: 0.1,
        missingInfo: [],
        readyToExecute: true,
        mode: 'clarify',
      };
    }

    // 2. 模糊度高 → 构建子议题
    const subQuestions = this.buildSubQuestions(input, quick);

    // 3. LLM 深度分析：议题分解 + 模式判断
    let llmResult: { subQuestions: SubQuestion[]; mode: 'clarify' | 'brainstorm' } = { subQuestions: [], mode: 'clarify' };
    if (this.llmCall) {
      llmResult = await this.deepAnalyze(input, subQuestions);
    }

    const allSubQuestions = [...subQuestions, ...llmResult.subQuestions];
    const missingInfo = quick.ambiguousAspects;

    // 4. 模式判断：如果 LLM 没判断，用启发式
    const mode = llmResult.mode ?? this.detectMode(input, allSubQuestions);

    return {
      id: topicId,
      originalInput: input,
      coreQuestion: input,
      subQuestions: allSubQuestions,
      ambiguityScore: Math.min(1, missingInfo.length / 4),
      missingInfo,
      readyToExecute: allSubQuestions.filter(q => q.required).length === 0,
      mode,
    };
  }

  /**
   * 模式判断启发式：
   * - 有明确参数缺失（文件路径、收件人、部署目标）→ clarify
   * - 方向性模糊（优化、改进、画一个、做点什么）→ brainstorm
   * - 创意/艺术/设计类任务 → brainstorm
   * - 技术任务但缺少具体参数 → clarify
   */
  private detectMode(input: string, subQuestions: SubQuestion[]): 'clarify' | 'brainstorm' {
    const brainstormPatterns = /画|设计|创作|创意|优化|改进|美化|风格|方案|思路|想法|怎么做|如何实现|有没有/i;
    const clarifyPatterns = /保存|发送|部署|路径|文件名|哪个|哪一|几|多少|给谁/i;

    const hasBrainstormSignal = brainstormPatterns.test(input);
    const hasClarifySignal = clarifyPatterns.test(input);

    // 创意类任务默认头脑风暴
    if (hasBrainstormSignal && !hasClarifySignal) return 'brainstorm';

    // 子议题中有选项型问题 → 头脑风暴
    const hasOptionQuestions = subQuestions.some(q =>
      q.question.includes('还是') || q.question.includes('哪种') || q.question.includes('A.') || q.question.includes('方案'),
    );
    if (hasOptionQuestions) return 'brainstorm';

    // 有明确参数缺失 → 澄清
    if (hasClarifySignal) return 'clarify';

    // 默认：模糊度高时走头脑风暴（帮用户探索）
    return 'brainstorm';
  }

  private buildSubQuestions(input: string, quick: any): SubQuestion[] {
    // ... 同前 ...
  }

  /**
   * LLM 深度分析 — 同时做议题分解和模式判断
   */
  private async deepAnalyze(input: string, existingSubs: SubQuestion[]): Promise<{ subQuestions: SubQuestion[]; mode: 'clarify' | 'brainstorm' }> {
    if (!this.llmCall) return { subQuestions: [], mode: 'clarify' };

    const prompt = `分析以下用户输入，判断审议模式并生成子议题。

用户输入: "${input}"

审议模式定义：
- clarify（澄清模式）：用户知道自己要什么，只是缺少具体参数。例如"帮我写个文件"缺文件名。
- brainstorm（头脑风暴模式）：用户方向不确定，需要探索不同方案。例如"帮我优化这个系统"不知道优化什么。

请以 JSON 格式回复:
{
  "mode": "clarify 或 brainstorm",
  "reasoning": "判断理由",
  "subQuestions": [
    {
      "question": "子问题",
      "required": true/false,
      "source": "llm分析",
      "options": [
        {
          "label": "方案A名称",
          "description": "方案描述",
          "pros": ["优势1", "优势2"],
          "cons": ["劣势1"]
        }
      ]
    }
  ]
}

注意：
- brainstorm 模式的子问题必须附带 options（候选方案），每个选项有 pros/cons
- clarify 模式的子问题不需要 options，只需追问
- 每个子问题说明 required（是否执行的必要条件）`;

    try {
      const response = await this.llmCall([{ role: 'user', content: prompt }]);
      const parsed = JSON.parse(response);
      return {
        subQuestions: (parsed.subQuestions ?? []).map((q: any, i: number) => ({
          id: `sq-llm-${i}`,
          question: q.question,
          required: q.required ?? true,
          source: 'llm分析',
          options: q.options ?? undefined,
        })),
        mode: parsed.mode === 'brainstorm' ? 'brainstorm' : 'clarify',
      };
    } catch {
      return { subQuestions: [], mode: 'clarify' };
    }
  }
}
```

### 1.4 角色分配器 (RoleAssigner)

**文件**: `src/brain/deliberation/role-assigner.ts`

```typescript
import type { DeliberationRole, Topic } from './types.js';
import type { TaskSignal } from '../types.js';

/** 基础角色 */
const BASE_ROLES: DeliberationRole[] = [
  {
    id: 'user-advocate',
    name: '用户代言人',
    perspective: 'user_advocate',
    weight: 1.5,  // 权重更高
    prompt: `你是用户代言人。你的职责是：
1. 确保理解了用户的真实意图
2. 如果信息不足，提出精确的追问
3. 不放过任何模糊之处
4. 投票时优先考虑用户体验`,
  },
  {
    id: 'risk-analyst',
    name: '风险分析师',
    perspective: 'risk_analyst',
    weight: 1.2,
    prompt: `你是风险分析师。你的职责是：
1. 评估执行方案的风险
2. 指出可能的失败路径和副作用
3. 对不可逆操作保持高度警惕
4. 投票时优先考虑安全`,
  },
  {
    id: 'executor',
    name: '执行方案师',
    perspective: 'efficiency',
    weight: 1.0,
    prompt: `你是执行方案师。你的职责是：
1. 设计最优的执行路径
2. 考虑效率、成本和可行性
3. 拆解复杂任务为可执行步骤
4. 投票时优先考虑可行性`,
  },
];

/** 动态角色映射 */
const DYNAMIC_ROLES: Record<string, DeliberationRole> = {
  code_operations: {
    id: 'code-reviewer',
    name: '代码审查员',
    perspective: 'domain_expert',
    weight: 1.0,
    prompt: '你是代码审查员。关注代码质量、可维护性、潜在 bug。对代码变更保持审慎。',
  },
  file_operations: {
    id: 'file-guardian',
    name: '文件守护者',
    perspective: 'security',
    weight: 1.1,
    prompt: '你是文件守护者。关注文件操作的安全性：是否覆盖重要文件、是否有备份、路径是否正确。',
  },
  system_operations: {
    id: 'sys-admin',
    name: '系统管理员',
    perspective: 'security',
    weight: 1.2,
    prompt: '你是系统管理员。关注命令安全性、权限、副作用。对破坏性操作（rm, kill, shutdown）高度警惕。',
  },
  web_operations: {
    id: 'web-scout',
    name: '网络侦察员',
    perspective: 'domain_expert',
    weight: 0.8,
    prompt: '你是网络侦察员。关注 URL 安全性、信息来源可靠性、网络请求的必要性。',
  },
};

export class RoleAssigner {
  selectRoles(topic: Topic, signal: TaskSignal): DeliberationRole[] {
    // 头脑风暴模式：增加创意角色
    if (topic.mode === 'brainstorm') {
      return this.selectBrainstormRoles(topic, signal);
    }

    // 澄清模式：标准角色
    const roles = [...BASE_ROLES];

    // 根据任务领域追加动态角色
    for (const domain of signal.domains) {
      const dynamic = DYNAMIC_ROLES[domain];
      if (dynamic && !roles.find(r => r.id === dynamic.id)) {
        roles.push(dynamic);
      }
    }

    // 关键写操作追加安全角色
    if (/部署|deploy|发布|publish|删除|delete|rm\s/i.test(topic.coreQuestion)) {
      if (!roles.find(r => r.id === 'deploy-guardian')) {
        roles.push({
          id: 'deploy-guardian',
          name: '部署审查员',
          perspective: 'security',
          weight: 1.5,
          prompt: '你是部署审查员。对部署/发布/删除操作，必须确认目标环境、回滚方案、影响范围。宁可多问不可冒进。',
        });
      }
    }

    return roles;
  }

  /**
   * 头脑风暴模式角色选择
   *
   * 增加"创意提案者"角色，减少"安全审查"权重（创意阶段不需要过度审查）
   */
  private selectBrainstormRoles(topic: Topic, signal: TaskSignal): DeliberationRole[] {
    const roles: DeliberationRole[] = [
      {
        id: 'user-advocate',
        name: '用户代言人',
        perspective: 'user_advocate',
        weight: 1.5,
        prompt: `你是用户代言人。你的职责是：
1. 从用户角度思考：什么方案最符合用户的期望？
2. 如果用户可能不知道自己要什么，提出有引导性的问题
3. 关注用户体验和最终效果
4. 投票时优先考虑用户满意度`,
      },
      {
        id: 'creative-proposer',
        name: '创意提案者',
        perspective: 'domain_expert',
        weight: 1.3,
        prompt: `你是创意提案者。你的职责是：
1. 提出 2-3 个不同方向的方案
2. 每个方案要有：标题、描述、具体实现思路、预期效果
3. 方案之间要有差异化（不要三个方案本质一样）
4. 可以天马行空，但要有可行性
5. 参考用户提到的风格/参考物来设计方案`,
      },
      {
        id: 'comparator',
        name: '方案对比师',
        perspective: 'efficiency',
        weight: 1.0,
        prompt: `你是方案对比师。你的职责是：
1. 对比不同方案的优劣势
2. 从可行性、效果、成本、风险四个维度评估
3. 帮助用户理解每个方案的取舍
4. 如果方案太多，筛选出最值得考虑的 top 3`,
      },
      {
        id: 'risk-analyst',
        name: '风险分析师',
        perspective: 'risk_analyst',
        weight: 0.8,  // 创意阶段降低风险权重
        prompt: '你是风险分析师。创意阶段主要关注"这个方案能不能实现"和"效果是否可控"，不做过度的安全审查。',
      },
    ];

    return roles;
  }
}
```

### 1.5 资料收集器 (ResearchGatherer)

**文件**: `src/brain/deliberation/research-gatherer.ts`

```typescript
import type { Topic, ResearchResult } from './types.js';
import type { BodyState, IntuitionSignal } from '../types.js';

export class ResearchGatherer {
  private readFile: ((path: string) => Promise<string>) | null = null;
  private listDir: ((path: string) => Promise<string[]>) | null = null;

  setFileOps(readFile: (path: string) => Promise<string>, listDir: (path: string) => Promise<string[]>): void {
    this.readFile = readFile;
    this.listDir = listDir;
  }

  async gather(
    topic: Topic,
    input: string,
    bodyState: BodyState,
    intuition?: IntuitionSignal,
  ): Promise<ResearchResult> {
    const result: ResearchResult = {};

    // 1. 文件上下文
    const paths = input.match(/[\w/\\.-]+\.\w+/g) ?? [];
    if (paths.length > 0 && this.readFile) {
      const contents = await Promise.allSettled(
        paths.slice(0, 3).map(p => this.readFile!(p))
      );
      const successful = contents
        .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
        .map(r => r.value.slice(0, 2000));
      if (successful.length > 0) {
        result.fileContext = successful.join('\n---\n');
      }
    }

    // 2. 项目结构（涉及代码操作时）
    if (/代码|code|src|模块|module|重构|refactor/i.test(input) && this.listDir) {
      try {
        const entries = await this.listDir('.');
        result.projectStructure = entries.slice(0, 30).join('\n');
      } catch { /* 静默失败 */ }
    }

    // 3. 脑内上下文
    result.brainContext = { bodyState, intuition };

    return result;
  }
}
```

### 1.6 辩论引擎 (DebateEngine) — 核心

**文件**: `src/brain/deliberation/debate-engine.ts`

```typescript
import type { Topic, DeliberationRole, ResearchResult, DebateRound, RoleStatement, DebateResult, Proposal } from './types.js';

/**
 * 辩论引擎 — 多角色多轮辩论
 *
 * 两种模式：
 * - 澄清模式: 角色讨论"缺什么信息"，输出精确追问
 * - 头脑风暴模式: 角色各自提出方案，讨论权衡，生成选项
 *
 * 关键设计：
 * - 每轮辩论中，角色可以看到其他角色的观点并回应
 * - 共识度 ≥ 0.8 提前退出（最多 3 轮）
 * - 并行调用 LLM（所有角色同时发言）
 * - 头脑风暴模式下，每轮自动提取方案提案
 */
export class DebateEngine {
  private llmCall: ((messages: Array<{ role: string; content: string }>) => Promise<string>) | null = null;
  private verbose: boolean;

  constructor(verbose = false) {
    this.verbose = verbose;
  }

  setLLMCaller(caller: (messages: Array<{ role: string; content: string }>) => Promise<string>): void {
    this.llmCall = caller;
  }

  async debate(
    topic: Topic,
    research: ResearchResult,
    roles: DeliberationRole[],
  ): Promise<DebateResult> {
    const rounds: DebateRound[] = [];
    const allProposals: Proposal[] = [];
    const maxRounds = topic.mode === 'brainstorm' ? 3 : 2;
    let previousStatements: RoleStatement[] = [];

    for (let round = 0; round < maxRounds; round++) {
      // 并行让所有角色发言
      const statements = await Promise.all(
        roles.map(role => this.getStatement(role, topic, research, previousStatements, round))
      );

      // 计算共识度
      const consensus = this.calcConsensus(statements);

      rounds.push({ round, statements, consensus });

      // 头脑风暴模式：提取本轮产生的方案提案
      if (topic.mode === 'brainstorm') {
        const roundProposals = this.extractProposals(statements, round);
        allProposals.push(...roundProposals);
      }

      if (this.verbose) {
        console.log(`[DebateEngine] 第 ${round + 1} 轮: 共识度=${consensus.toFixed(2)}, 投票=${statements.map(s => s.vote).join('/')}, 方案=${allProposals.length}`);
      }

      // 共识度足够高 → 提前退出
      if (consensus >= 0.8) break;

      previousStatements = statements;
    }

    // 合议投票
    const finalVote = this.aggregateVotes(rounds, roles);

    // 头脑风暴模式：如果共识是 brainstorm，用方案评分排序
    if (topic.mode === 'brainstorm' && allProposals.length > 0) {
      this.scoreProposals(allProposals, roles, rounds);
      allProposals.sort((a, b) => b.score - a.score);
    }

    return {
      rounds,
      finalVote,
      consensusMethod: this.getConsensusMethod(rounds),
      unresolvedDisagreements: this.findDisagreements(rounds),
      proposals: allProposals,
    };
  }

  private async getStatement(
    role: DeliberationRole,
    topic: Topic,
    research: ResearchResult,
    previousRounds: RoleStatement[],
    round: number,
  ): Promise<RoleStatement> {
    if (!this.llmCall) {
      return {
        roleId: role.id,
        roleName: role.name,
        position: '信息不足，无法判断',
        responses: [],
        vote: 'refine',
        confidence: 0.3,
        reasoning: '无 LLM 调用能力',
      };
    }

    const contextParts = [
      `## 议题\n${topic.coreQuestion}`,
      `## 审议模式: ${topic.mode === 'brainstorm' ? '头脑风暴' : '澄清追问'}`,
      topic.subQuestions.length > 0
        ? `\n## 需要确认的子问题\n${topic.subQuestions.map(q => {
            const opts = q.options?.length
              ? `\n  候选方案: ${q.options.map(o => `\n    - ${o.label}: ${o.description} (优: ${o.pros.join(',')} 劣: ${o.cons.join(',')})`).join('')}`
              : '';
            return `- ${q.question} (${q.required ? '必要' : '可选'})${opts}`;
          }).join('\n')}`
        : '',
      topic.missingInfo.length > 0
        ? `\n## 缺失信息\n${topic.missingInfo.join(', ')}`
        : '',
      research.fileContext
        ? `\n## 相关文件\n${research.fileContext.slice(0, 1000)}`
        : '',
      research.experience
        ? `\n## 历史经验\n${research.experience.slice(0, 500)}`
        : '',
      previousRounds.length > 0
        ? `\n## 其他角色上一轮观点\n${previousRounds.map(s => `**${s.roleName}**: ${s.position} [投票: ${s.vote}]`).join('\n')}`
        : '',
    ].filter(Boolean).join('\n');

    // 头脑风暴模式和澄清模式使用不同的 prompt
    const brainstormPrompt = topic.mode === 'brainstorm' ? `
你的角色是方案提案者。请针对这个议题，提出你认为可行的方案。
每个方案要有：标题、描述、优势、劣势。
你也可以对其他角色的方案发表评价（支持/中立/反对 + 理由）。
如果已有多轮讨论，请基于前面的观点调整你的方案或提出新方案。` : '';

    const prompt = `${role.prompt}
${brainstormPrompt}

${contextParts}

---

这是第 ${round + 1} 轮审议。

请以 JSON 格式回复:
{
  "position": "你的核心观点（一句话）",
  "responses": ["对其他角色观点的回应"],
  "vote": "proceed|refine|brainstorm",
  "confidence": 0.0-1.0,
  "reasoning": "你的推理过程"${topic.mode === 'brainstorm' ? `,
  "proposals": [
    {
      "title": "方案标题",
      "description": "方案描述",
      "pros": ["优势1", "优势2"],
      "cons": ["劣势1"]
    }
  ]` : ''}
}

注意：
- proceed = 信息充足，可以执行
- refine = 信息不足，需要追问用户
- brainstorm = 方向不确定，需要生成方案让用户选择`;

    try {
      const response = await this.llmCall([{ role: 'user', content: prompt }]);
      const parsed = JSON.parse(response);
      return {
        roleId: role.id,
        roleName: role.name,
        position: parsed.position ?? '无观点',
        responses: parsed.responses ?? [],
        vote: parsed.vote ?? 'refine',
        confidence: parsed.confidence ?? 0.5,
        reasoning: parsed.reasoning ?? '',
      };
    } catch {
      return {
        roleId: role.id,
        roleName: role.name,
        position: '解析失败',
        responses: [],
        vote: 'refine',
        confidence: 0.2,
        reasoning: 'LLM 响应解析失败',
      };
    }
  }

  /**
   * 从角色发言中提取方案提案（头脑风暴模式）
   */
  private extractProposals(statements: RoleStatement[], round: number): Proposal[] {
    const proposals: Proposal[] = [];

    for (const stmt of statements) {
      // 从 LLM 响应中提取 proposals（需要在 getStatement 中传递）
      const stmtProposals = (stmt as any).proposals ?? [];
      for (const p of stmtProposals) {
        proposals.push({
          id: `prop-${round}-${proposals.length}`,
          title: p.title ?? '未命名方案',
          description: p.description ?? '',
          proposedBy: stmt.roleId,
          pros: p.pros ?? [],
          cons: p.cons ?? [],
          support: [],
          score: 0,
        });
      }
    }

    return proposals;
  }

  /**
   * 为方案评分 — 基于其他角色的支持度
   */
  private scoreProposals(proposals: Proposal[], roles: DeliberationRole[], rounds: DebateRound[]): void {
    for (const proposal of proposals) {
      // 基础分：提出者的权重
      const proposerRole = roles.find(r => r.id === proposal.proposedBy);
      let score = (proposerRole?.weight ?? 1.0) * 0.3;

      // 加分：其他角色的支持
      for (const support of proposal.support) {
        const role = roles.find(r => r.id === support.roleId);
        const weight = role?.weight ?? 1.0;
        if (support.stance === 'support') score += 0.3 * weight;
        else if (support.stance === 'oppose') score -= 0.2 * weight;
      }

      // 加分：优势多于劣势
      score += (proposal.pros.length - proposal.cons.length) * 0.05;

      proposal.score = Math.max(0, Math.min(1, score));
    }
  }

  private calcConsensus(statements: RoleStatement[]): number {
    if (statements.length <= 1) return 1;
    const votes = statements.map(s => s.vote);
    const unique = new Set(votes);
    if (unique.size === 1) return 1.0;
    const counts = new Map<string, number>();
    for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);
    const maxCount = Math.max(...counts.values());
    return maxCount / votes.length;
  }

  private aggregateVotes(rounds: DebateRound[], roles: DeliberationRole[]): DebateResult['finalVote'] {
    const lastRound = rounds[rounds.length - 1];
    const scores: Record<string, number> = { proceed: 0, refine: 0, brainstorm: 0 };

    for (const stmt of lastRound.statements) {
      const role = roles.find(r => r.id === stmt.roleId);
      const weight = role?.weight ?? 1.0;
      scores[stmt.vote] += stmt.confidence * weight;
    }

    const total = scores.proceed + scores.refine + scores.brainstorm;
    const winner = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
    const confidence = total > 0 ? scores[winner] / total : 0;

    const reasoning = lastRound.statements
      .filter(s => s.vote === winner)
      .map(s => `${s.roleName}: ${s.reasoning}`)
      .join('; ');

    return { action: winner as any, confidence, reasoning };
  }

  private getConsensusMethod(rounds: DebateRound[]): DebateResult['consensusMethod'] {
    const last = rounds[rounds.length - 1];
    if (last.consensus >= 1.0) return 'unanimous';
    if (last.consensus >= 0.67) return 'majority';
    return 'chair_override';
  }

  private findDisagreements(rounds: DebateRound[]): string[] {
    const last = rounds[rounds.length - 1];
    return last.statements
      .filter(s => s.vote !== last.statements[0].vote)
      .map(s => `${s.roleName}: ${s.position}`);
  }
}
```

### 1.7 风险校验器 (RiskValidator)

**文件**: `src/brain/deliberation/risk-validator.ts`

```typescript
import type { Topic, DebateResult, RiskAssessment } from './types.js';

const WRITE_PATTERNS = /写|创建|删除|部署|新建|覆盖|write|create|delete|deploy|overwrite|remove/i;
const DESTRUCTIVE_PATTERNS = /rm\s+-rf|drop\s+table|format|mkfs|dd\s+if=/i;

export class RiskValidator {
  validate(topic: Topic, debate: DebateResult): RiskAssessment {
    const risks: RiskAssessment['risks'] = [];

    // 1. 不可逆操作检查
    if (WRITE_PATTERNS.test(topic.coreQuestion)) {
      risks.push({
        description: '涉及文件写入/删除操作',
        severity: 'medium',
        mitigation: '执行前确认目标文件和操作内容',
      });
    }
    if (DESTRUCTIVE_PATTERNS.test(topic.coreQuestion)) {
      risks.push({
        description: '检测到破坏性操作模式',
        severity: 'high',
        mitigation: '必须用户明确确认',
      });
    }

    // 2. 信息缺失检查
    if (topic.missingInfo.length > 0 && debate.finalVote.action === 'proceed') {
      risks.push({
        description: `缺失关键信息: ${topic.missingInfo.join(', ')}`,
        severity: 'high',
        mitigation: '先向用户确认缺失信息',
      });
      // 强制改为 refine
      debate.finalVote.action = 'refine';
    }

    // 3. 低置信度检查
    if (debate.finalVote.confidence < 0.4) {
      risks.push({
        description: '审议置信度过低',
        severity: 'medium',
        mitigation: '建议用户补充信息后重试',
      });
    }

    // 4. 子议题未解决检查
    const unresolved = topic.subQuestions.filter(q => q.required);
    if (unresolved.length > 0 && debate.finalVote.action === 'proceed') {
      risks.push({
        description: `有 ${unresolved.length} 个必要子议题未解决`,
        severity: 'high',
        mitigation: '先回答子议题再执行',
      });
      debate.finalVote.action = 'refine';
    }

    return {
      level: risks.some(r => r.severity === 'high') ? 'high'
        : risks.some(r => r.severity === 'medium') ? 'medium'
        : 'low',
      risks,
      canProceed: !risks.some(r => r.severity === 'high'),
      userConfirmations: risks.filter(r => r.severity === 'high').map(r => r.mitigation),
    };
  }
}
```

### 1.8 主控 (DeliberationCouncil)

**文件**: `src/brain/deliberation/council.ts`

```typescript
import { TopicAnalyzer } from './topic-analyzer.js';
import { RoleAssigner } from './role-assigner.js';
import { ResearchGatherer } from './research-gatherer.js';
import { DebateEngine } from './debate-engine.js';
import { RiskValidator } from './risk-validator.js';
import type { DeliberationResult, DeliberationArchive } from './types.js';
import type { TaskSignal, ResourceState, BodyState, IntuitionSignal } from '../types.js';

export class DeliberationCouncil {
  private topicAnalyzer: TopicAnalyzer;
  private roleAssigner: RoleAssigner;
  private researchGatherer: ResearchGatherer;
  private debateEngine: DebateEngine;
  private riskValidator: RiskValidator;
  private archiveStore: Map<string, DeliberationArchive> = new Map();
  private verbose: boolean;

  constructor(verbose = false) {
    this.verbose = verbose;
    this.topicAnalyzer = new TopicAnalyzer();
    this.roleAssigner = new RoleAssigner();
    this.researchGatherer = new ResearchGatherer();
    this.debateEngine = new DebateEngine(verbose);
    this.riskValidator = new RiskValidator();
  }

  /** 注入 LLM 调用器 */
  setLLMCaller(caller: (messages: Array<{ role: string; content: string }>) => Promise<string>): void {
    this.topicAnalyzer.setLLMCaller(caller);
    this.debateEngine.setLLMCaller(caller);
  }

  /** 注入文件操作 */
  setFileOps(readFile: (path: string) => Promise<string>, listDir: (path: string) => Promise<string[]>): void {
    this.researchGatherer.setFileOps(readFile, listDir);
  }

  /**
   * 审议主流程
   */
  async deliberate(
    input: string,
    signal: TaskSignal,
    resources: ResourceState,
    bodyState: BodyState,
    intuition?: IntuitionSignal,
  ): Promise<DeliberationResult> {
    const t0 = performance.now();

    // Step 1: 定议题
    const topic = await this.topicAnalyzer.analyze(input, signal);

    // 快速通道：模糊度低 → 直接放行
    if (topic.readyToExecute && topic.ambiguityScore < 0.3) {
      return {
        action: 'proceed',
        confidence: 0.9,
        reasoning: '议题清晰，无需审议',
        topic,
        risk: { level: 'low', risks: [], canProceed: true, userConfirmations: [] },
        archiveId: 'fast-path',
        durationMs: performance.now() - t0,
      };
    }

    if (this.verbose) {
      console.log(`[DeliberationCouncil] 议题模糊度=${topic.ambiguityScore.toFixed(2)}, 子议题=${topic.subQuestions.length}, 缺失=${topic.missingInfo.join(', ')}`);
    }

    // Step 2: 分角色
    const roles = this.roleAssigner.selectRoles(topic, signal);

    // Step 3: 自动查资料
    const research = await this.researchGatherer.gather(topic, input, bodyState, intuition);

    // Step 4: 多轮辩论审议
    const debate = await this.debateEngine.debate(topic, research, roles);

    // Step 5: 风险校验
    const risk = this.riskValidator.validate(topic, debate);

    // Step 6: 合议投票（已在 debate 中完成）
    const decision = debate.finalVote;

    // Step 7: 全程存档
    const archiveId = `delib-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.archiveStore.set(archiveId, {
      id: archiveId,
      timestamp: Date.now(),
      input,
      topic,
      roles,
      research,
      debate,
      risk,
      decision,
      durationMs: performance.now() - t0,
    });

    const durationMs = performance.now() - t0;

    if (this.verbose) {
      console.log(`[DeliberationCouncil] 决策: ${decision.action} (conf=${decision.confidence.toFixed(2)}), 风险=${risk.level}, 耗时=${durationMs.toFixed(0)}ms, 轮次=${debate.rounds.length}`);
    }

    return {
      action: decision.action,
      confidence: decision.confidence,
      reasoning: decision.reasoning,
      topic,
      risk,
      archiveId,
      durationMs,
      clarificationQuestion: decision.action === 'refine'
        ? this.buildClarification(topic, debate)
        : undefined,
      proposals: decision.action === 'brainstorm'
        ? debate.proposals
        : undefined,
      executionBreakdown: decision.action === 'proceed'
        ? this.breakdownExecution(topic)
        : undefined,
    };
  }

  /** 获取存档 */
  getArchive(id: string): DeliberationArchive | undefined {
    return this.archiveStore.get(id);
  }

  /**
   * 构建追问问题（澄清模式）
   */
  private buildClarification(topic: any, debate: any): string {
    const questions = topic.subQuestions
      .filter((q: any) => q.required)
      .map((q: any) => `• ${q.question}`);

    if (questions.length > 0) {
      return `我需要更多信息来处理这个请求：\n${questions.join('\n')}`;
    }

    return `我不太确定你的具体意图。能补充一下细节吗？\n${topic.missingInfo.join('、')}`;
  }

  /**
   * 构建方案呈现（头脑风暴模式）
   *
   * 输出格式：不是干巴巴的参数列表，而是带描述的选项卡片
   */
  private buildProposalsPresentation(proposals: Proposal[]): string {
    if (proposals.length === 0) return '';

    const cards = proposals.slice(0, 3).map((p, i) => {
      const prosStr = p.pros.length > 0 ? `✅ ${p.pros.join('、')}` : '';
      const consStr = p.cons.length > 0 ? `⚠️ ${p.cons.join('、')}` : '';
      return [
        `**${String.fromCharCode(65 + i)}. ${p.title}**`,
        p.description,
        prosStr,
        consStr,
      ].filter(Boolean).join('\n');
    });

    return `关于这个问题，我有几个想法：\n\n${cards.join('\n\n')}\n\n你觉得哪个方向更符合你的想法？或者你有其他思路？`;
  }

  /** 拆解执行计划 */
  private breakdownExecution(topic: any): any {
    return {
      steps: [{ id: 'step-1', description: topic.coreQuestion, tool: 'auto', dependencies: [] }],
      estimatedDuration: '待评估',
    };
  }
}
```

### 1.9 整合到三脑架构

**文件**: `src/brain/brain.ts`

```typescript
// 新增 import
import { DeliberationCouncil } from './deliberation/index.js';

// ThreeBrain 类新增成员
private deliberationCouncil: DeliberationCouncil;

// 构造函数中
this.deliberationCouncil = new DeliberationCouncil(this.verbose);

// decide() 方法改造：
// Step 2.5: 审议委员会（替代原 deliberate()）
const deliberation = await this.deliberationCouncil.deliberate(
  input, signal, resources, bodyState, intuition,
);

if (deliberation.action !== 'proceed') {
  const plan: ExecutionPlan = {
    mode: deliberation.action === 'refine' ? 'clarify'
      : deliberation.action === 'brainstorm' ? 'brainstorm'
      : 'single',
    reason: `审议: ${deliberation.reasoning}`,
    selectedNodes: [],
    confidence: deliberation.confidence,
    source: 'deliberation',
    metaAction: deliberation.action,
  };
  return { plan, intuition, bodyState, homeostasisActions, latencyMs: performance.now() - t0, deliberationResult: deliberation };
}
```

**文件**: `src/core/agent.ts`

```typescript
// orchestrateWithThreeBrain() 中，审议结果处理改造：
if (decision.plan.metaAction === 'refine') {
  // 澄清模式：审议委员会已生成精确的追问问题
  return {
    content,
    mode: 'clarify',
    reason: decision.plan.reason,
    domains: signal.domains,
    complexity: signal.complexity,
    selectedNodes: [],
    useDAG: false,
    routeDecision: undefined,
    meta: {
      ...decision.plan,
      clarificationQuestion: (decision as any).deliberationResult?.clarificationQuestion,
      deliberationArchive: (decision as any).deliberationResult?.archiveId,
    },
  };
}

if (decision.plan.metaAction === 'brainstorm') {
  // 头脑风暴模式：呈现方案选项让用户选择
  const proposals = (decision as any).deliberationResult?.proposals ?? [];
  const presentation = this.deliberationCouncil.buildProposalsPresentation(proposals);

  return {
    content: presentation || '我有几个方向想和你讨论，能再描述一下你的期望吗？',
    mode: 'brainstorm',
    reason: decision.plan.reason,
    domains: signal.domains,
    complexity: signal.complexity,
    selectedNodes: [],
    useDAG: false,
    routeDecision: undefined,
    meta: {
      ...decision.plan,
      proposals,
      deliberationArchive: (decision as any).deliberationResult?.archiveId,
    },
  };
}
```

### 1.10 性能控制

| 场景 | 处理方式 | 目标延迟 |
|------|----------|----------|
| 模糊度 < 0.3（清晰任务） | 快速放行，不启动审议 | < 5ms |
| 模糊度 0.3-0.5（轻度模糊） | 单轮辩论 + 风险校验 | < 500ms |
| 模糊度 > 0.5（高度模糊） | 多轮辩论 + 资料收集 | < 2s |
| 关键写操作 | 强制风险校验 | < 200ms |

**关键优化**：
- 模糊度 < 0.3 时直接 `proceed`，零额外开销
- 角色发言并行调用 LLM（不是串行）
- 最多 3 轮辩论，共识度 ≥ 0.8 提前退出
- 资料收集只读相关文件，不做全项目扫描

### 1.11 验收标准

**澄清模式**：
- [ ] "帮我写个文件" → 追问"写到哪里？文件名是什么？内容是什么？"
- [ ] "部署到服务器" → 追问"哪个服务器？什么环境？"
- [ ] "删除 src/temp.ts" → 风险校验检测到写操作，要求确认后执行

**头脑风暴模式**：
- [ ] "帮我画一幅齐白石风格的虾" → 3 角色辩论 → 输出方案选项（SVG写意/像素画/...）让用户选择
- [ ] "优化这个系统" → 辩论产出"性能优化 / 架构重构 / 功能精简"三个方向供用户选择
- [ ] "帮我设计个方案" → 角色各自提出方案，讨论权衡后呈现 top 3

**快速通道**：
- [ ] "你好" → 模糊度 < 0.3，快速放行，零额外开销
- [ ] "读取 src/index.ts" → 路径明确，操作明确，直接 proceed

**存档与性能**：
- [ ] 审议过程完整存档，可通过 archiveId 回溯
- [ ] 审议延迟：清晰任务 < 5ms，模糊任务 < 2s
- [ ] 头脑风暴模式输出的方案带有 pros/cons 和评分

---

## Phase 2: 多模态感知接入

**目标**：让右脑看到空间结构和视觉信息，而不只是文字。

**理论依据**：CoordConv (NeurIPS 2018) + ViT Patch Embedding (ICLR 2021)

### 2.1 小脑 SensorFusion → 右脑 predict() 的多模态桥接

**文件**: `src/brain/brain.ts` — `decide()` 方法 Step 2

**当前**: `this.right.predict(input, signal, resources, bodyState)` — 无多模态

**改为**:
```typescript
// Step 2: 右脑 — 直觉预测（含多模态）
const multimodal = this.buildMultimodalContext(input, signal);
let intuition = await this.right.predict(input, signal, resources, bodyState, multimodal);
```

**新增方法**:
```typescript
/**
 * 从当前上下文构建多模态输入
 *
 * 数据源：
 * - 感知融合的实体关系 → sceneGraph
 * - 文件路径的空间关系 → spatial
 * - 屏幕截图（如有）→ image
 */
private buildMultimodalContext(
  input: string,
  signal: TaskSignal,
): { spatial?: SpatialEncodeInput; sceneGraph?: SceneGraph } | undefined {
  // 1. 从 EntityRegistry 构建 sceneGraph
  const entities = this.right.entityRegistry.getAll();
  if (entities.length > 0) {
    const sceneGraph = this.entitiesToSceneGraph(entities);
    return { sceneGraph };
  }

  // 2. 从文件路径构建空间关系
  const paths = input.match(/[\w/\\.-]+\.\w+/g) ?? [];
  if (paths.length >= 2) {
    const spatial = this.pathsToSpatial(paths);
    return { spatial };
  }

  return undefined;
}

/** EntityRegistry 实体 → SceneGraph */
private entitiesToSceneGraph(entities: any[]): SceneGraph {
  return {
    nodes: entities.slice(0, 32).map(e => ({
      id: e.id,
      category: e.type ?? 'unknown',
      attributes: e.attributes ?? {},
      importance: e.importance ?? 0.5,
    })),
    edges: entities.flatMap(e =>
      (e.edges ?? []).map((edge: any) => ({
        source: e.id,
        target: edge.target,
        relation: edge.relation ?? 'related_to',
        confidence: edge.confidence ?? 0.5,
      }))
    ).slice(0, 64),
  };
}

/** 文件路径 → 空间编码输入 */
private pathsToSpatial(paths: string[]): SpatialEncodeInput {
  // 路径深度 → 纵向坐标，路径相似度 → 横向坐标
  return {
    points2D: paths.map((p, i) => ({
      x: i / paths.length,
      y: (p.split('/').length) / 10,  // 深度归一化
    })),
    relations: [],  // 自动推断
  };
}
```

### 2.2 截图感知接入（可选，需要屏幕 RPA 数据）

**文件**: `src/brain/brain.ts` — 新增方法

```typescript
/**
 * 注入屏幕截图到右脑（供 Screen RPA 场景调用）
 */
async injectScreenPerception(screenshot: RawImage): Promise<void> {
  const multimodal = { image: screenshot };
  // 下一次 predict 会自动使用
  this._pendingMultimodal = multimodal;
}
```

**验收标准**：
- [ ] 用户说"把 src/utils 和 src/core 合并" → 右脑感知到两个目录的空间关系，给出更准确的意图分类
- [ ] 有 EntityRegistry 实体时 → sceneGraph 自动注入，意图分类准确率提升
- [ ] 无多模态数据时 → 退化为纯文本，无额外开销

---

## Phase 3: 工具执行学习闭环

**目标**：让右脑世界模型从真实工具执行中学习因果关系。

**理论依据**：Model-Based RL — 世界模型通过 (state, action, next_state) 三元组学习环境动力学

### 3.1 接入 RuntimeCollector

**文件**: `src/core/agent.ts` — `setupToolInterception()` 方法

**当前**: 工具执行前后没有快照收集

**改为**:
```typescript
// 在 Subsystems 初始化时
import { RuntimeCollector, EntityRegistry } from '../brain/right/scene/index.js';

// agent.ts 构造函数中
private runtimeCollector: RuntimeCollector | null = null;

constructor(...) {
  // ... 现有初始化 ...

  // 3.1 初始化 RuntimeCollector
  if (this.sys.threeBrain) {
    const registry = this.sys.threeBrain.right.entityRegistry;
    this.runtimeCollector = new RuntimeCollector(registry, {
      maxBufferSize: 200,
      autoFlushThreshold: 100,
      collectFailures: true,
      minExecutionMs: 10,
    });

    // 缓冲区满时自动写入世界模型训练
    this.runtimeCollector.onFlush(async (samples) => {
      const rightBrain = this.sys.threeBrain!.right;
      for (const sample of samples) {
        rightBrain.ingestExternalSample({
          labelIntent: 0,
          labelTools: sample.executionResult.success ? [sample.sample.action.type] : [],
          labelQuality: sample.executionResult.success ? 0.8 : 0.2,
          outcome: sample.executionResult.success,
        });
      }
      if (this.verbose) {
        console.log(`[RuntimeCollector] 写入 ${samples.length} 个训练样本到右脑`);
      }
    });
  }
}
```

**工具执行拦截扩展** — 在 `setupToolInterception()` 的 `beforeToolExecute` 和执行后添加快照:

```typescript
// beforeToolExecute 中（已有拦截逻辑，在 allowed: true 之前）
if (this.runtimeCollector) {
  const snapshot = this.runtimeCollector.captureBefore({
    type: toolName,
    params: new Float32Array(Object.values(args).filter(v => typeof v === 'number')),
  });
  // 存到 pending snapshots map
  this.pendingSnapshots.set(toolName, snapshot);
}

// 工具执行完成后（在 postprocessResult 或 executeByPlan 的工具回调中）
if (this.runtimeCollector && this.pendingSnapshots.has(toolName)) {
  const before = this.pendingSnapshots.get(toolName)!;
  this.runtimeCollector.captureAfter(before, {
    type: toolName,
    params: new Float32Array([]),
  }, {
    success: !result.startsWith('['),
    latencyMs: Date.now() - before.timestamp,
    output: result.slice(0, 200),
  });
  this.pendingSnapshots.delete(toolName);
}
```

### 3.2 接入 KnowledgeBridge

**文件**: `src/core/subsystems.ts` — 知识提取完成后的桥接

```typescript
// 在 KnowledgeExtractor 提取完成后
import { KnowledgeBridge } from '../brain/right/scene/knowledge-bridge.js';

// 初始化 KnowledgeBridge
this.knowledgeBridge = new KnowledgeBridge({
  minConfidence: 0.3,
  maxBatchSize: 20,
  inferRelations: true,
});

// 知识提取完成后的回调
this.extractor.onKnowledgeExtracted(async (knowledge) => {
  const samples = this.knowledgeBridge.convert(knowledge);
  if (samples.length > 0) {
    const rightBrain = this.threeBrain?.right;
    if (rightBrain) {
      for (const sample of samples) {
        rightBrain.ingestExternalSample(sample);
      }
    }
  }
});
```

**验收标准**：
- [ ] 工具执行 10 次后 → RuntimeCollector 自动写入训练样本
- [ ] 知识提取完成后 → KnowledgeBridge 自动转换为世界模型训练样本
- [ ] 世界模型的 `predict()` 准确率随时间提升（通过 `getLearnStats()` 监控）
- [ ] 工具执行失败时 → 失败样本也被收集（`collectFailures: true`）

---

## Phase 4: Early Exit + predictDetailed 接入

**目标**：利用已有能力优化推理延迟和工具选择精度。

### 4.1 Early Exit 接入

**文件**: `src/brain/right/index.ts` — `predict()` 方法

**当前**: 始终调用 `this.model.forward(tokenIds)` — 完整前向传播

**改为**:
```typescript
async predict(
  input: string, signal: TaskSignal, resources: ResourceState, body?: BodyState,
  multimodal?: { spatial?: SpatialEncodeInput; image?: RawImage; sceneGraph?: SceneGraph },
): Promise<IntuitionSignal> {
  const encodeInput: EncodeInput = { signal, resources, body };
  if (multimodal) {
    encodeInput.spatial = multimodal.spatial;
    encodeInput.image = multimodal.image;
    encodeInput.sceneGraph = multimodal.sceneGraph;
  }
  const tokenIds = encodeFeatures(encodeInput);

  // 简单任务用 early exit，复杂任务用完整前向
  const isSimple = signal.complexity === 'simple' || input.length < 30;
  const output = isSimple
    ? this.model.forwardInference(tokenIds)  // early exit，~40% 更快
    : this.model.forward(tokenIds);           // 完整前向

  this.predictCount++;
  return decodeSignal(output);
}
```

### 4.2 predictDetailed 接入调度器

**文件**: `src/brain/left/scheduler.ts` — Thompson Sampling 选择

**当前**: `thompsonSelect()` 从 `intuition.suggestedTools` 中选，没有概率信息

**改为**:
```typescript
// 在 UnifiedScheduler.schedule() 中，Layer 3 Thompson Sampling 之前
if (intuition?.hit && this.config.useThompsonSampling) {
  // 用 predictDetailed 获取工具概率分布
  const detailed = await this.rightBrain.predictDetailed(signal, resources, body);
  if (detailed.tools.length > 0) {
    // 用概率加权的 Thompson Sampling
    return this.thompsonSelectWithProbs(signal, resources, detailed.tools, body);
  }
}
```

```typescript
private thompsonSelectWithProbs(
  signal: TaskSignal,
  resources: ResourceState,
  toolProbs: Array<{ name: string; probability: number }>,
  body?: BodyState,
): ExecutionPlan {
  const fp = this.fingerprint(signal);
  const toolScores: Array<{ tool: string; sample: number }> = [];

  for (const tool of toolProbs.slice(0, 5)) {
    const key = `${fp}|${tool.name}`;
    const hist = this.tsHistory.get(key) ?? { attempts: 0, weightedSuccesses: 0 };

    // Thompson Sampling + 右脑概率先验
    const alpha = hist.weightedSuccesses + 1 + tool.probability * 5;  // 概率加权
    const beta = hist.attempts - hist.weightedSuccesses + 1;
    const sample = betaSample(alpha, beta) * this.config.explorationFactor;

    toolScores.push({ tool: tool.name, sample });
  }

  toolScores.sort((a, b) => b.sample - a.sample);
  const best = toolScores[0];

  return this.selectViaRouter('llm_with_hint', signal, body,
    `Thompson+Prob: ${best.tool} (sample=${best.sample.toFixed(3)}, prob=${toolProbs.find(t => t.name === best.tool)?.probability.toFixed(2)})`);
}
```

**验收标准**：
- [ ] 简单任务（<30 字符）→ 用 `forwardInference()`，延迟降低 ~40%
- [ ] 复杂任务 → 用完整 `forward()`，质量不变
- [ ] Thompson Sampling 有概率先验 → 工具选择准确率提升
- [ ] `forwardInference()` 返回的置信度与 `forward()` 一致（无 early exit 时）

---

## Phase 5: 动态意图扩展 + 防遗忘加固

**目标**：右脑能自适应扩展能力边界，同时防止灾难性遗忘。

### 5.1 主链路主动触发 expandIntentHead

**文件**: `src/core/agent.ts` — `postprocessResult()` 方法

**当前**: 只有影子大脑的 `EvolutionEngine` 会触发 `expandIntentHead`

**改为**:
```typescript
// postprocessResult() 中，在 autoTriggerTraining 之后

/**
 * 自动意图扩展 — 当分类器频繁 miss 时触发
 *
 * 条件：
 * - 最近 50 次交互中，classifyFromText 的 confidence < 0.3 超过 10 次
 * - 且当前意图类别数 < 16（上限保护）
 */
private autoExpandIntents(): void {
  const right = this.sys.threeBrain?.right;
  if (!right) return;

  const stats = right.getLearnStats();
  const config = right.getNNConfig();

  // 检查是否有大量低置信度分类
  const recentLowConf = this.decisionTrace
    .slice(-50)
    .filter(t => t.success === null || t.success === false)
    .length;

  if (recentLowConf >= 10 && config.numIntents < 16) {
    // 分析最近的低置信度输入，提取新模式
    const newIntents = this.analyzeNewIntentPatterns();
    if (newIntents.length > 0) {
      right.expandIntentHead(newIntents).catch(err => {
        if (this.verbose) console.warn('[Agent] 意图扩展失败:', err.message);
      });
    }
  }
}

private analyzeNewIntentPatterns(): Array<{ label: string; description: string }> {
  // 从最近的低置信度交互中提取未覆盖的意图模式
  const recent = this.decisionTrace.slice(-50);
  const lowConfInputs = recent
    .filter(t => t.success === null)
    .map(t => t.input);

  // 聚类分析（简化版：检查关键词频率）
  const patterns: Map<string, number> = new Map();
  for (const input of lowConfInputs) {
    const words = input.match(/[\u4e00-\u9fa5]{2,}|[a-z]{3,}/gi) ?? [];
    for (const word of words) {
      patterns.set(word, (patterns.get(word) ?? 0) + 1);
    }
  }

  // 找出高频但未被覆盖的模式
  const frequent = [...patterns.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  if (frequent.length === 0) return [];

  return [{
    label: `auto_${Date.now()}`,
    description: `自动扩展: 高频未覆盖模式 ${frequent.map(([w]) => w).join(', ')}`,
  }];
}
```

### 5.2 LPR 防遗忘加固

**文件**: `src/brain/right/training/online-learner.ts`

**检查点**: 确保 LPR 在每次 `update()` 时生效

```typescript
// OnlineLearner.update() 中
async update(): Promise<{ loss: number; lr: number }> {
  // ... 现有逻辑 ...

  // 确保 LPR 正则项被应用
  if (this.lpr) {
    this.lpr.applyGradients(this.model.parameters());
  }

  // ... 梯度更新 ...
}
```

**验收标准**：
- [ ] 意图分类连续低置信度 → 自动触发 `expandIntentHead`
- [ ] 新意图类别扩展后 → 在线学习自动覆盖新类别
- [ ] LPR 正则项在每次 update 时生效 → 权重漂移监控 < 阈值
- [ ] 扩展意图数不超过 16（上限保护）

---

## 依赖关系与执行顺序

```
Phase 1 (审议委员会)      ← 最高优先级，核心重构
  ├── Phase 2 (多模态)    ← Phase 1 完成后，审议委员会可利用多模态信号做更精准的议题分析
  ├── Phase 3 (学习闭环)  ← 独立于 Phase 2，可并行；审议存档可作为训练样本
  └── Phase 4 (Early Exit) ← 独立，低风险优化
       └── Phase 5 (意图扩展) ← 依赖 Phase 4 的 predictDetailed
```

**推荐执行顺序**: 1 → 3 → 4 → 2 → 5

理由：
- Phase 1（审议委员会）是核心重构，解决左脑粗暴决策问题，优先级最高
- Phase 3（学习闭环）独立且价值高——世界模型能从真实执行中学习，审议存档可作为高质量训练样本
- Phase 4（Early Exit）改动小、风险低、收益明确
- Phase 2（多模态）需要 SensorFusion 桥接，改动较大
- Phase 5（意图扩展）依赖前面的基础设施稳定后再做

---

## 风险评估

| Phase | 风险 | 缓解措施 |
|-------|------|---------|
| 1 审议委员会 | 审议延迟过高（模糊任务 > 2s） | 模糊度 < 0.3 快速放行；角色并行发言；最多 3 轮 |
| 1 审议委员会 | 过度审议（简单任务也走完整流程） | TopicAnalyzer 快速层优先；LLM 调用仅在模糊度高时触发 |
| 1 审议委员会 | LLM 成本增加 | 仅模糊任务触发；角色并行而非串行；最多 3 轮 × 5 角色 = 15 次调用上限 |
| 2 多模态 | sceneGraph 构建开销 | 限制节点数 ≤32、边数 ≤64；无实体时跳过 |
| 3 学习闭环 | RuntimeCollector 内存泄漏 | `maxBufferSize: 200` + autoFlush |
| 4 Early Exit | 简单任务误判为复杂 | `input.length < 30` 双重检查 |
| 5 意图扩展 | 意图类别爆炸 | 硬上限 16；只在连续 10 次低置信度后触发 |

---

## 监控指标

每个 Phase 完成后，通过以下指标验证效果：

```typescript
// 1. 审议触发率（Phase 1）
const deliberationRate = traces.filter(t => t.source === 'deliberation').length / traces.length;
// 目标：5-15%（太高=过度审议，太低=没生效）

// 2. 多模态注入率（Phase 2）
const multimodalRate = traces.filter(t => t.hasMultimodal).length / traces.length;
// 目标：> 20%（有实体/路径时自动注入）

// 3. 世界模型准确率（Phase 3）
const worldModelAccuracy = rightBrain.getLearnStats().predictionAccuracy;
// 目标：随训练样本增加，准确率 > 60%

// 4. Early Exit 节省延迟（Phase 4）
const avgLatencySimple = traces.filter(t => t.complexity === 'simple').reduce(...);
// 目标：简单任务延迟降低 30%+

// 5. 意图覆盖率（Phase 5）
const intentCoverage = 1 - (lowConfCount / totalCount);
// 目标：低置信度比例 < 10%
```
