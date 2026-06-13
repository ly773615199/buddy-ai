# 编排-执行分离 + 三脑管控 实施计划

> 版本: v1.0
> 日期: 2026-05-13
> 目标: 让 Buddy 的任务完成能力从"LLM 自由发挥"进化为"三脑管控下的精准执行"

---

## 0. 设计哲学

**核心原则：编排管战略，Skill 管战术，三脑管纪律。**

```
编排层 (宏观)  = 将军："打三场仗，先攻A，再围B，C可以同时打"
Skill层 (微观) = 士兵："A这场仗具体怎么打，每一步怎么走"
三脑 (纪律)    = 军法处："这个计划合理吗？执行中有没有违规？结果达标吗？"
```

**三层分离，各司其职：**

| 层 | 职责 | 输入 | 输出 | 管控者 |
|----|------|------|------|--------|
| 编排层 | 任务拆解 + 依赖管理 + 资源分配 | 用户意图 + 上下文 | DAG（步骤拓扑） | 左脑规则引擎 |
| Skill层 | 工具选择 + 参数填充 + 步骤执行 | DAG task + 经验知识 | 执行结果 | 小脑执行监控 |
| 三脑层 | 全程管控 + 质量评估 + 闭环学习 | 各层信号 | 管控决策 | 右脑 + 审议 |

---

## 1. 架构改造：执行管线重构

### 1.1 当前问题

```
当前执行流（混在一起）：
  用户输入 → 三脑决策 → DAG Planner(LLM自由拆解+选工具+填参数) → TaskExecutor → 结果
                                                    ↑
                                          所有职责混在一层，幻觉无约束
```

### 1.2 目标执行流

```
用户输入
  │
  ▼
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  感知层（已有，不改动）
  cognitive + memory + knowledge + perception
  职责：收集上下文、检索记忆、检测领域
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ▼
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  决策层（已有，不改动）
  三脑：小脑感知 → 右脑直觉 → 审议 → 左脑规则
  输出：OrchestrationPlan (mode, useDAG, nodes)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ▼
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ★ Gate-0: 经验路由前置（新增）
  intelligence/experience-router
  高置信度经验命中 → 跳过编排，直接精准执行 → 返回
  未命中 → 继续
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ▼
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ★ 编排层（改造：只管步骤拓扑，不管工具细节）
  orchestrate/planner
  职责：拆解步骤、定义依赖、分配并行组
  不做：不选具体工具、不填参数（交给 Skill 层）
  输出：DAG skeleton（只有步骤名和依赖关系）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ▼
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ★ Gate-1: 左脑规划门控（新增）
  brain/left/rule-engine 扩展
  检查：步骤数 vs 复杂度、领域合理性、资源充足性
  不通过 → 降级 single / 重新编排
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ▼
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ★ Skill 绑定层（新增：连接 DAG task → 具体工具+参数）
  skills/skill-resolver（新建）
  职责：为 DAG 每个 task 匹配最佳工具 + 填充参数
  来源：① 经验图谱中的已验证路径
       ② 能力包中的领域知识
       ③ SkillManager 中的可用工具
       ④ 以上都没有 → LLM 生成（降级）
  输出：完整可执行的 TaskDAG
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ▼
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ★ Gate-2: 工具-意图验证（新增）
  左脑规则引擎
  检查：每个 task 的工具是否在允许集合内
  不通过 → 移除该 task / 替换工具
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ▼
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ★ 执行层（改造：小脑全程监控）
  orchestrate/executor
  每个 task 执行 → 小脑感知事件 → 稳态调节
  连续失败 ≥ 2 → 熔断 → 降级
  超时 → 跳过
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ▼
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ★ 反思层（新增：结果评估 + 闭环学习）
  brain/cerebellum/quality-assessor + intelligence + project
  ① 质量自评（四维：完整/准确/简洁/可用）
  ② 幻觉检测（工具成功但结果无关）
  ③ 经验编译（成功路径 → ExperienceUnit）
  ④ 教训提取（失败路径 → Lesson）
  ⑤ 信号汇聚（→ 右脑训练循环）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 2. 模块改造详细设计

### 2.1 Gate-0: 经验路由前置

**文件**: `src/core/agent.ts` — `orchestrate()` 方法

**改动**: 在三脑决策之前，先查经验图谱

```typescript
// agent.ts — orchestrate() 方法开头插入

async orchestrate(content: string): Promise<OrchestrationPlan> {
  const signal = this.collectSignals(content);
  const resources = this.collectResourceState(content, signal);

  // ── Gate-0: 经验路由前置 ──
  const expEngine = this.sys.intelligence;
  if (expEngine) {
    const toolNames = new Set(this.sys.tools.list().map(t => t.name));
    const expResult = await expEngine.process(
      content, signal.domains, undefined, toolNames,
    );

    // 高置信度经验直达：跳过编排，直接返回结果
    if (expResult.decision.path === 'exp_direct' && expResult.result?.success) {
      return {
        content: expResult.result.reply ?? '',
        mode: 'single',
        reason: `经验直达: ${expResult.decision.skill?.name} (置信度 ${expResult.decision.confidence?.toFixed(2)})`,
        domains: signal.domains,
        complexity: signal.complexity,
        selectedNodes: [{
          id: `exp/${expResult.decision.skill?.id}`,
          type: 'experience',
          skillId: expResult.decision.skill?.id,
          routePath: 'exp_direct',
        }],
        useDAG: false,
        routeDecision: expResult.decision,
        meta: { ... },
      };
    }

    // 中置信度：经验作为 hint 注入后续流程
    resources.experienceHit = expResult.decision;
  }

  // ── 原有三脑决策流程 ──
  // ...
}
```

**三脑参与**:
- **右脑**: 提供 `qualityEstimate`（质量预判），低于 0.3 时强制跳过经验走 LLM
- **左脑**: 记录经验命中/未命中，更新决策统计
- **小脑**: 经验执行成功 → `confidenceLevel += 5`

**涉及文件**:
- `src/core/agent.ts` — ~30 行改动
- `src/intelligence/experience-router.ts` — 无需改动（已有）

---

### 2.2 编排层改造：只管步骤拓扑

**文件**: `src/orchestrate/planner.ts`

**改动**: 将 planner 的职责从"生成完整可执行 DAG"改为"生成步骤骨架"

#### 2.2.1 新增 DAG Skeleton 类型

```typescript
// src/orchestrate/types.ts — 新增

/** DAG 骨架：只有步骤名和依赖，不含具体工具和参数 */
export interface DAGSkeleton {
  id: string;
  description: string;
  steps: SkeletonStep[];
  edges: ConditionEdge[];
  parallelGroups: string[][];
  complexity: 'simple' | 'medium' | 'complex';
  detectedDomains: string[];
}

export interface SkeletonStep {
  id: string;
  name: string;              // 人类可读的步骤描述
  intent: string;            // 这一步要达成什么（供 Skill 层匹配）
  deps: string[];
  suggestedCategory?: string; // 建议的工具类别（如 'code_analysis'）
  retry?: RetryConfig;
  timeoutMs?: number;
}
```

#### 2.2.2 Planner Prompt 改造

```typescript
// src/orchestrate/planner.ts — buildSystemPrompt() 改造

private buildSystemPrompt(): string {
  return `你是一个任务步骤规划器。用户会给你一个任务描述，你需要将其分解为执行步骤。

**你的职责**：
- 拆解步骤，定义依赖关系
- 标注每个步骤的意图（intent）和建议工具类别（suggestedCategory）
- 不要指定具体工具名和参数（那是执行层的事）

**输出格式（严格 JSON）**：
\`\`\`json
{
  "steps": [
    {
      "id": "s1",
      "name": "人类可读的步骤名",
      "intent": "这一步要达成什么",
      "suggestedCategory": "code_analysis",
      "deps": [],
      "retry": {"max": 2, "delayMs": 1000},
      "timeoutMs": 15000
    }
  ],
  "edges": [...],
  "parallelGroups": [...]
}
\`\`\`

**规则**：
1. 简单任务（< 30字、无并行标记）→ 1 步即可，不要拆分
2. 中等任务 → 最多 3 步
3. 复杂任务 → 最多 5 步
4. suggestedCategory 可选值：code_analysis / web_search / file_ops / git / voice / chat / system
5. 不要编造步骤，每一步都必须对完成任务有直接贡献
6. 如果任务可以用 1 次工具调用完成，就不要拆成多步`;
}
```

#### 2.2.3 移除 Planner 中的工具选择职责

```typescript
// planner.ts — buildUserPrompt() 简化

private buildUserPrompt(intent: string): string {
  // 不再注入工具列表（工具选择交给 Skill 绑定层）
  return `## 用户意图
${intent}

请规划执行步骤，输出严格 JSON。`;
}
```

**三脑参与**:
- **左脑**: 规划门控（Gate-1）验证步骤数 vs 复杂度
- **右脑**: 提供 `suggestedTools`（直觉推荐工具子集），注入 planner 上下文

**涉及文件**:
- `src/orchestrate/planner.ts` — ~100 行改动
- `src/orchestrate/types.ts` — ~30 行新增
- `src/orchestrate/dag.ts` — 适配新类型

---

### 2.3 Gate-1: 左脑规划门控

**文件**: `src/brain/left/rule-engine.ts` — 新增规则

```typescript
// brain/left/rule-engine.ts — 新增 DAG 骨架验证规则

/**
 * 验证 DAG 骨架的合理性
 * 在 planner 生成骨架后、Skill 绑定前调用
 */
validateDAGSkeleton(
  skeleton: DAGSkeleton,
  signal: TaskSignal,
  resources: ResourceState,
): GateResult {
  const violations: GateViolation[] = [];

  // ── 规则 1: 简单任务不应拆分 ──
  if (signal.complexity === 'simple' && skeleton.steps.length > 1) {
    violations.push({
      rule: 'over-split-simple',
      severity: 'block',
      description: `简单任务被拆分为 ${skeleton.steps.length} 步`,
      action: 'downgrade_to_single',
    });
  }

  // ── 规则 2: 步骤数上限 ──
  const maxSteps = { simple: 1, medium: 3, complex: 5 };
  const limit = maxSteps[signal.complexity];
  if (skeleton.steps.length > limit) {
    violations.push({
      rule: 'too-many-steps',
      severity: 'warn',
      description: `${signal.complexity} 任务最多 ${limit} 步，实际 ${skeleton.steps.length} 步`,
      action: 'replan',
    });
  }

  // ── 规则 3: 领域一致性 ──
  const allowedCategories = getAllowedCategories(signal.domains);
  for (const step of skeleton.steps) {
    if (step.suggestedCategory && !allowedCategories.has(step.suggestedCategory)) {
      violations.push({
        rule: 'domain-mismatch',
        severity: 'block',
        description: `步骤 "${step.name}" 的类别 "${step.suggestedCategory}" 与任务领域 [${signal.domains}] 不匹配`,
        action: 'remove_step',
      });
    }
  }

  // ── 规则 4: 依赖环检测 ──
  if (hasCycle(skeleton.steps)) {
    violations.push({
      rule: 'dependency-cycle',
      severity: 'block',
      description: '步骤依赖存在循环',
      action: 'replan',
    });
  }

  // ── 规则 5: 资源充足性 ──
  if (resources.budgetRemaining < skeleton.steps.length * 0.01) {
    violations.push({
      rule: 'budget-insufficient',
      severity: 'warn',
      description: '预算可能不足',
      action: 'reduce_steps',
    });
  }

  const blocks = violations.filter(v => v.severity === 'block');
  if (blocks.length > 0) {
    return { passed: false, violations, action: blocks[0].action };
  }
  return { passed: true, violations: [], action: 'proceed' };
}

/** 领域 → 允许的工具类别映射 */
function getAllowedCategories(domains: string[]): Set<string> {
  const map: Record<string, string[]> = {
    code: ['code_analysis', 'file_ops', 'system'],
    web: ['web_search', 'file_ops'],
    git: ['git', 'file_ops', 'system'],
    voice: ['voice'],
    chat: ['chat'],
  };
  const result = new Set<string>();
  for (const d of domains) {
    for (const c of (map[d] ?? [])) result.add(c);
  }
  // file_ops 和 system 总是允许
  result.add('file_ops');
  result.add('system');
  return result;
}
```

**三脑参与**:
- **左脑规则引擎**: 执行所有验证规则
- **小脑**: 提供 `bodyState`（精力/负载），影响规则判断
- **右脑**: 提供 `intuition.qualityEstimate`，低质量预判时收紧规则

**涉及文件**:
- `src/brain/left/rule-engine.ts` — ~120 行新增
- `src/brain/types.ts` — 新增 `GateResult`、`GateViolation` 类型

---

### 2.4 Skill 绑定层（核心新增）

**新文件**: `src/skills/skill-resolver.ts`

这是连接"编排步骤"和"具体工具"的桥梁。

```typescript
/**
 * SkillResolver — 步骤 → 工具+参数 的解析器
 *
 * 职责：为 DAG 骨架的每个 step 匹配最佳工具 + 填充参数
 *
 * 解析优先级（从高到低）：
 * 1. 经验图谱：已验证的工具+参数组合（置信度 > 0.7）
 * 2. 能力包：领域知识中的工具推荐
 * 3. SkillManager：匹配 suggestedCategory 的可用工具
 * 4. LLM 生成：降级，让 LLM 选工具+填参数（有约束）
 */

import type { DAGSkeleton, SkeletonStep, TaskDAG, Task } from '../orchestrate/types.js';
import type { ExperienceRouter } from '../intelligence/experience-router.js';
import type { ExperienceUnit } from '../intelligence/types.js';
import type { ExperiencePackageManager, ExperienceScheduler } from './package.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolRetriever } from '../tools/tool-retriever.js';
import type { SkillManager } from './skill-manager.js';

export interface ResolvedTask {
  tool: string;
  args: Record<string, unknown>;
  source: 'experience' | 'package' | 'skill' | 'llm' | 'builtin';
  confidence: number;
}

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

export class SkillResolver {
  constructor(
    private experienceRouter: ExperienceRouter,
    private packageManager: ExperiencePackageManager,
    private packageScheduler: ExperienceScheduler,
    private toolRegistry: ToolRegistry,
    private toolRetriever: ToolRetriever,
    private skillManager: SkillManager,
    private llmCaller: ((messages: Array<{role: string; content: string}>) => Promise<string>) | null,
  ) {}

  /**
   * 将 DAG 骨架解析为完整可执行的 TaskDAG
   */
  async resolve(
    skeleton: DAGSkeleton,
    originalIntent: string,
  ): Promise<ResolveResult> {
    const resolutionLog: ResolveResult['resolutionLog'] = [];
    const unresolvedSteps: string[] = [];
    const resolvedTasks = new Map<string, Task>();

    for (const step of skeleton.steps) {
      const resolved = await this.resolveStep(step, originalIntent, skeleton.detectedDomains);
      resolvedTasks.set(step.id, {
        id: step.id,
        name: step.name,
        tool: resolved.tool,
        args: resolved.args,
        deps: step.deps,
        status: 'pending',
        retry: step.retry,
        timeoutMs: step.timeoutMs,
      });
      resolutionLog.push({
        stepId: step.id,
        stepName: step.name,
        resolvedTool: resolved.tool,
        source: resolved.source,
        confidence: resolved.confidence,
      });
      if (resolved.source === 'llm') {
        unresolvedSteps.push(step.id);
      }
    }

    const dag: TaskDAG = {
      id: skeleton.id,
      description: skeleton.description,
      tasks: resolvedTasks,
      edges: skeleton.edges,
      parallelGroups: skeleton.parallelGroups,
      createdAt: Date.now(),
      status: 'planning',
      defaultTimeoutMs: 30000,
    };

    return { dag, resolutionLog, unresolvedSteps };
  }

  /**
   * 解析单个步骤
   */
  private async resolveStep(
    step: SkeletonStep,
    intent: string,
    domains: string[],
  ): Promise<ResolvedTask> {
    // ── 优先级 1: 经验图谱匹配 ──
    const expMatch = this.findExperienceMatch(step, domains);
    if (expMatch) {
      return {
        tool: expMatch.tool,
        args: expMatch.args,
        source: 'experience',
        confidence: expMatch.confidence,
      };
    }

    // ── 优先级 2: 能力包推荐 ──
    const pkgMatch = this.findPackageMatch(step, domains);
    if (pkgMatch) {
      return pkgMatch;
    }

    // ── 优先级 3: 工具语义检索 ──
    const toolMatch = this.findToolMatch(step);
    if (toolMatch) {
      return toolMatch;
    }

    // ── 优先级 4: LLM 降级生成 ──
    if (this.llmCaller) {
      const llmResult = await this.llmResolveStep(step, intent, domains);
      return llmResult;
    }

    // ── 兜底: exec 工具 ──
    return {
      tool: 'exec',
      args: { command: `echo "无法解析步骤: ${step.name}"` },
      source: 'builtin',
      confidence: 0.1,
    };
  }

  /**
   * 从经验图谱中匹配已验证的工具+参数
   */
  private findExperienceMatch(
    step: SkeletonStep,
    domains: string[],
  ): { tool: string; args: Record<string, unknown>; confidence: number } | null {
    // 用 step.intent + domains 查询经验图谱
    const candidates = this.experienceRouter.graph.match(step.intent, domains);
    if (candidates.length === 0) return null;

    // 找到包含当前步骤类别的经验
    for (const exp of candidates) {
      if (exp.stats.confidence < 0.7) continue;
      // 在经验步骤中找匹配的工具调用
      for (const expStep of exp.steps) {
        if (this.isToolCategoryMatch(expStep.tool, step.suggestedCategory)) {
          return {
            tool: expStep.tool,
            args: expStep.args as Record<string, unknown>,
            confidence: exp.stats.confidence,
          };
        }
      }
    }
    return null;
  }

  /**
   * 从能力包中获取工具推荐
   */
  private findPackageMatch(
    step: SkeletonStep,
    domains: string[],
  ): ResolvedTask | null {
    const domainMatches = domains.map(d => ({ domain: d, confidence: 0.8, keywords: [d] }));
    const scheduling = this.packageScheduler.schedule(domainMatches, step.intent);

    if (!scheduling.hasPackage) return null;

    // 从包的 promptTemplate 中提取工具推荐
    // （包知识已注入 prompt，但这里做显式匹配）
    const pkg = this.packageManager.findByDomain(domains[0]);
    if (!pkg) return null;

    // 包知识中的工具推荐是隐式的，需要通过工具检索来显式化
    return null; // 暂不直接返回，交给工具检索
  }

  /**
   * 从工具注册表中语义匹配
   */
  private findToolMatch(step: SkeletonStep): ResolvedTask | null {
    const query = `${step.name} ${step.intent} ${step.suggestedCategory ?? ''}`;
    const scored = this.toolRetriever.retrieve(query, [step.suggestedCategory ?? '']);

    if (scored.length === 0 || scored[0].score < 0.2) return null;

    const bestTool = scored[0];
    return {
      tool: bestTool.name,
      args: {}, // 参数需要 LLM 填充或经验提供
      source: 'skill',
      confidence: bestTool.score,
    };
  }

  /**
   * LLM 降级：在约束下生成工具+参数
   */
  private async llmResolveStep(
    step: SkeletonStep,
    intent: string,
    domains: string[],
  ): Promise<ResolvedTask> {
    // 只提供该领域允许的工具子集
    const allowedTools = this.getAllowedTools(domains);
    const toolList = allowedTools
      .map(t => `- ${t.name}: ${t.description}`)
      .join('\n');

    const prompt = `你需要为以下执行步骤选择工具并填充参数。

步骤: ${step.name}
意图: ${step.intent}
建议类别: ${step.suggestedCategory ?? '无'}

可用工具（只能从这些中选）:
${toolList}

输出严格 JSON:
{"tool": "工具名", "args": {"参数名": "参数值"}}`;

    try {
      const raw = await this.llmCaller!([{ role: 'user', content: prompt }]);
      const parsed = JSON.parse(raw.trim().replace(/```json?\s*([\s\S]*?)```/, '$1').trim());
      return {
        tool: parsed.tool,
        args: parsed.args ?? {},
        source: 'llm',
        confidence: 0.5,
      };
    } catch {
      return {
        tool: allowedTools[0]?.name ?? 'exec',
        args: {},
        source: 'llm',
        confidence: 0.2,
      };
    }
  }

  /** 获取领域允许的工具子集 */
  private getAllowedTools(domains: string[]): Array<{ name: string; description: string }> {
    const categoryMap: Record<string, string[]> = {
      code: ['analyze_file', 'find_references', 'exec', 'read_file', 'list_files', 'search_files'],
      web: ['search_web', 'fetch_url', 'browser'],
      git: ['git_status', 'git_log', 'git_diff', 'exec'],
      voice: ['tts_speak'],
    };
    const allowedNames = new Set<string>();
    for (const d of domains) {
      for (const name of (categoryMap[d] ?? [])) allowedNames.add(name);
    }
    // 总是允许基础工具
    for (const name of ['read_file', 'exec', 'get_time']) allowedNames.add(name);

    return this.toolRegistry.list()
      .filter(t => allowedNames.has(t.name))
      .map(t => ({ name: t.name, description: t.description }));
  }

  /** 工具类别匹配 */
  private isToolCategoryMatch(toolName: string, category?: string): boolean {
    if (!category) return true;
    const toolToCategory: Record<string, string> = {
      analyze_file: 'code_analysis', find_references: 'code_analysis',
      exec: 'system', read_file: 'file_ops', write_file: 'file_ops',
      search_web: 'web_search', fetch_url: 'web_search',
      git_status: 'git', git_log: 'git', git_diff: 'git',
      tts_speak: 'voice',
    };
    return (toolToCategory[toolName] ?? 'unknown') === category;
  }
}
```

**三脑参与**:
- **右脑**: 提供 `suggestedTools`（直觉推荐），作为 Skill 绑定的参考
- **左脑**: 记录每个 step 的解析来源和置信度，供决策统计
- **小脑**: 工具健康度（`collectToolHealth()`）影响工具选择——不健康的工具降权

**涉及文件**:
- `src/skills/skill-resolver.ts` — ~300 行新建
- `src/core/subsystems.ts` — 初始化 SkillResolver 并注入依赖

---

### 2.5 Gate-2: 工具-意图验证

**文件**: `src/brain/left/rule-engine.ts` — 新增规则

```typescript
// 在 Skill 绑定完成后、执行前调用

validateResolvedDAG(
  dag: TaskDAG,
  signal: TaskSignal,
  registry: ToolRegistry,
): GateResult {
  const violations: GateViolation[] = [];

  for (const [taskId, task] of dag.tasks) {
    // ── 规则 1: 工具存在性 ──
    const tool = registry.get(task.tool);
    if (!tool) {
      violations.push({
        rule: 'tool-not-found',
        severity: 'block',
        description: `任务 "${task.name}" 引用不存在的工具 "${task.tool}"`,
        action: 'remove_task',
        taskId,
      });
      continue;
    }

    // ── 规则 2: 工具-意图一致性 ──
    const allowedCategories = this.getAllowedCategories(signal.domains);
    const toolCategory = this.getToolCategory(task.tool);
    if (toolCategory && !allowedCategories.has(toolCategory)) {
      violations.push({
        rule: 'tool-intent-mismatch',
        severity: 'block',
        description: `任务 "${task.name}" 使用工具 "${task.tool}" (${toolCategory})，但任务领域 [${signal.domains}] 不需要此工具类别`,
        action: 'remove_task',
        taskId,
      });
    }

    // ── 规则 3: 工具健康度 ──
    const health = this.getToolHealth(task.tool);
    if (health && health.reliability < 30) {
      violations.push({
        rule: 'tool-unreliable',
        severity: 'warn',
        description: `工具 "${task.tool}" 可靠度过低 (${health.reliability}%)`,
        action: 'warn',
        taskId,
      });
    }
  }

  // ── 规则 4: 移除任务后的依赖完整性 ──
  const removedIds = new Set(
    violations.filter(v => v.action === 'remove_task').map(v => v.taskId!)
  );
  if (removedIds.size > 0) {
    const orphans = this.findOrphanedTasks(dag, removedIds);
    for (const orphan of orphans) {
      violations.push({
        rule: 'orphaned-task',
        severity: 'warn',
        description: `任务 "${orphan.name}" 的依赖被移除，将被跳过`,
        action: 'skip_task',
        taskId: orphan.id,
      });
    }
  }

  const blocks = violations.filter(v => v.severity === 'block');
  return {
    passed: blocks.length === 0,
    violations,
    action: blocks.length > 0 ? 'remove_violations' : 'proceed',
  };
}
```

**涉及文件**:
- `src/brain/left/rule-engine.ts` — ~80 行新增

---

### 2.6 执行层改造：小脑全程监控

**文件**: `src/orchestrate/executor.ts` — 扩展监控

```typescript
// executor.ts — 新增 ExecutionMonitor

export interface ExecutionMonitor {
  onTaskStart(taskId: string, taskName: string): MonitorAction;
  onTaskDone(taskId: string, result: string): MonitorAction;
  onTaskFail(taskId: string, error: string): MonitorAction;
  onTaskTimeout(taskId: string, timeoutMs: number): MonitorAction;
  shouldAbort(): { abort: boolean; reason: string };
}

export class CerebellumExecutionMonitor implements ExecutionMonitor {
  private consecutiveFailures = 0;
  private readonly MAX_CONSECUTIVE_FAILURES = 2;
  private taskLog: Array<{ id: string; status: string; ts: number }> = [];

  constructor(
    private cerebellum: import('../brain/cerebellum/index.js').Cerebellum,
    private verbose: boolean = false,
  ) {}

  onTaskStart(taskId: string, taskName: string): MonitorAction {
    this.taskLog.push({ id: taskId, status: 'start', ts: Date.now() });
    return { action: 'continue' };
  }

  onTaskDone(taskId: string, result: string): MonitorAction {
    this.consecutiveFailures = 0;
    this.taskLog.push({ id: taskId, status: 'done', ts: Date.now() });

    // 小脑感知事件：成功
    this.cerebellum.regulate({
      type: 'tool_result',
      timestamp: Date.now(),
      data: { success: true, taskId },
    });

    return { action: 'continue' };
  }

  onTaskFail(taskId: string, error: string): MonitorAction {
    this.consecutiveFailures++;
    this.taskLog.push({ id: taskId, status: 'failed', ts: Date.now() });

    // 小脑感知事件：失败
    this.cerebellum.regulate({
      type: 'tool_result',
      timestamp: Date.now(),
      data: { success: false, taskId, error },
    });

    // 连续失败熔断
    if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
      if (this.verbose) {
        console.log(`[Monitor] 连续 ${this.consecutiveFailures} 个任务失败，触发熔断`);
      }
      return {
        action: 'abort',
        reason: `连续 ${this.consecutiveFailures} 个任务失败`,
        fallback: 'single_llm',
      };
    }

    return { action: 'continue_with_warning' };
  }

  onTaskTimeout(taskId: string, timeoutMs: number): MonitorAction {
    this.taskLog.push({ id: taskId, status: 'timeout', ts: Date.now() });
    return {
      action: 'skip',
      reason: `任务超时 (${timeoutMs}ms)`,
    };
  }

  shouldAbort(): { abort: boolean; reason: string } {
    const bodyState = this.cerebellum.getBodyState();

    // 系统过载时中止
    if (bodyState.load > 90) {
      return { abort: true, reason: `系统过载 (${bodyState.load}%)` };
    }

    // 精力极低时中止
    if (bodyState.energy < 10) {
      return { abort: true, reason: `精力极低 (${bodyState.energy})` };
    }

    return { abort: false, reason: '' };
  }
}
```

**executor.ts 集成**:

```typescript
// executor.ts — execute() 方法改造

async execute(
  dag: TaskDAG,
  onEvent: EventCallback,
  maxParallel: number = 4,
  monitor?: ExecutionMonitor,  // 新增参数
): Promise<OrchestrateResult> {
  // ... 现有逻辑 ...

  while (!isDAGComplete(dag)) {
    // ── 新增：监控检查 ──
    if (monitor) {
      const abortCheck = monitor.shouldAbort();
      if (abortCheck.abort) {
        dag.status = 'failed';
        return { success: false, summary: abortCheck.reason, ... };
      }
    }

    const ready = getReadyTasksWithConditions(dag);
    // ... 现有逻辑 ...

    for (const task of batch) {
      // ── 新增：任务开始监控 ──
      monitor?.onTaskStart(task.id, task.name);
    }

    // 执行任务...
    // ── 新增：任务完成/失败监控 ──
    if (result.status === 'fulfilled') {
      const action = monitor?.onTaskDone(task.id, task.result ?? '');
      // ...
    } else {
      const action = monitor?.onTaskFail(task.id, task.error ?? '');
      if (action?.action === 'abort') {
        // 触发熔断
        break;
      }
    }
  }
}
```

**三脑参与**:
- **小脑**: 实时感知执行状态，触发稳态调节
- **小脑 HomeostasisRegulator**: 任务失败 → `energy -= 5`, `confusionLevel += 10`
- **小脑 BodyState**: 影响后续决策（低精力时降级模型）

**涉及文件**:
- `src/orchestrate/executor.ts` — ~100 行改动
- `src/brain/cerebellum/index.ts` — 导出 BodyState 查询接口

---

### 2.7 反思层：结果评估 + 闭环学习

**文件**: `src/core/agent.ts` — `executeByPlan()` 后新增反思

```typescript
// agent.ts — executeByPlan() 返回后

async handleMessage(content: string): Promise<ExecutionResult> {
  const plan = await this.orchestrate(content);
  const result = await this.executeByPlan(plan);

  // ── 反思层（新增）──
  if (plan.routeDecision || plan.dag) {
    await this.reflect(plan, result, signal);
  }

  return result;
}

private async reflect(
  plan: OrchestrationPlan,
  result: ExecutionResult,
  signal: TaskSignal,
): Promise<void> {
  // ① 质量自评
  const quality = this.sys.qualityAssessor?.assess({
    userRequest: plan.content,
    taskType: signal.taskType,
    output: result.text,
    executionSuccess: result.toolCalls.every(t => t.success),
    latencyMs: result.durationMs,
    toolResults: result.toolCalls.map(t => t.result),
  });

  // ② 经验编译（成功路径 → ExperienceUnit）
  if (result.toolCalls.length > 0 && result.toolCalls.every(t => t.success)) {
    const snapshot = {
      userMessage: plan.content,
      assistantMessage: result.text,
      toolCalls: result.toolCalls.map(t => ({
        name: t.name,
        args: t.args,
        result: t.result,
      })),
      wasSuccessful: true,
      domains: signal.domains,
    };
    await this.sys.intelligence?.learn(snapshot);
  }

  // ③ 教训提取（失败路径 → Lesson）
  if (result.toolCalls.some(t => !t.success)) {
    const failedCalls = result.toolCalls.filter(t => !t.success);
    for (const failed of failedCalls) {
      this.sys.lessonSystem?.extractFromFailure(
        'current',
        { name: failed.name, error: failed.result, tool: failed.name, args: failed.args },
        plan.content,
      );
    }
  }

  // ④ 幻觉检测
  if (plan.dag) {
    const hallucinations = this.detectHallucinations(plan.dag, result, signal);
    if (hallucinations.length > 0) {
      // 注入反面教材到经验图谱
      await this.injectHallucinationWarning(hallucinations, signal);
    }
  }

  // ⑤ 三脑反馈
  await this.sys.threeBrain?.feedback(
    signal,
    resources,
    plan,
    { success: result.toolCalls.every(t => t.success), latencyMs: result.durationMs },
    signal.domains.join(','),
    result.toolCalls.map(t => t.name),
  );
}

/** 幻觉检测：工具成功但结果与任务无关 */
private detectHallucinations(
  dag: TaskDAG,
  result: ExecutionResult,
  signal: TaskSignal,
): string[] {
  const hallucinations: string[] = [];
  const domainTools = this.getAllowedToolNames(signal.domains);

  for (const call of result.toolCalls) {
    if (!call.success) continue;

    // 工具不在领域允许集合内 → 幻觉
    if (!domainTools.has(call.name)) {
      hallucinations.push(call.name);
    }

    // 结果为空或极短 → 可能是幻觉调用
    if (!call.result || call.result.length < 10) {
      hallucinations.push(call.name);
    }
  }

  return hallucinations;
}
```

**三脑参与**:
- **右脑**: 质量自评结果注入 Thompson Sampling 权重
- **左脑**: 记录决策结果，更新规则统计
- **小脑**: 执行结果事件更新 BodyState
- **影子大脑**: 缺口检测 + 进化触发

**涉及文件**:
- `src/core/agent.ts` — ~100 行新增
- `src/brain/cerebellum/quality-assessor.ts` — 无需改动（已有）
- `src/intelligence/experience-compiler.ts` — 无需改动（已有）

---

### 2.8 Project 工具注册

**文件**: `src/core/subsystems.ts`

```typescript
// subsystems.ts — 初始化时注册 project 工具

import { PROJECT_TOOLS_ALL } from '../project/tools.js';

// 在 initTools() 或合适位置：
this.tools.registerMany(PROJECT_TOOLS_ALL);
console.log(`[Tools] 已注册 ${PROJECT_TOOLS_ALL.length} 个项目管理工具`);
```

**涉及文件**:
- `src/core/subsystems.ts` — ~3 行新增

---

## 3. 三脑管控全景图

```
                    三脑管控点分布
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Gate-0: 经验路由前置
  右脑: qualityEstimate < 0.3 → 强制跳过经验走 LLM
  左脑: 记录经验命中统计

编排层: DAG 骨架生成
  右脑: suggestedTools（直觉推荐工具子集）
  左脑: Planner prompt 约束（步骤数上限、领域围栏）

Gate-1: 左脑规划门控
  左脑规则引擎:
    - 简单任务不应拆分
    - 步骤数上限
    - 领域一致性
    - 依赖环检测
    - 资源充足性
  小脑: BodyState 影响规则阈值

Skill 绑定层
  右脑: suggestedTools 优先匹配
  左脑: 记录解析来源和置信度
  小脑: 工具健康度影响选择

Gate-2: 工具-意图验证
  左脑规则引擎:
    - 工具存在性
    - 工具-意图一致性（category fence）
    - 工具健康度
    - 依赖完整性

执行层: TaskExecutor
  小脑 ExecutionMonitor:
    - 每任务感知事件
    - 连续失败熔断（≥ 2）
    - 系统过载中止（load > 90）
    - 精力极低中止（energy < 10）
  小脑 HomeostasisRegulator:
    - PID 负反馈调节
    - 失败 → energy/confidence 变化

反思层: 结果评估
  右脑 QualityAssessor:
    - 四维质量评分
    - Thompson Sampling 权重调整
  左脑 DecisionRecorder:
    - 决策记录 + 结果统计
  经验编译:
    - 成功 → ExperienceUnit
    - 失败 → Lesson
  信号汇聚:
    - 所有信号 → 右脑训练循环
```

---

## 4. 实施路线

### Phase 1: 最小可用（1-2 天）

| # | 任务 | 文件 | 行数 | 效果 |
|---|------|------|------|------|
| 1 | 注册 PROJECT_TOOLS_ALL | subsystems.ts | +3 | 项目管理工具可见 |
| 2 | Gate-0: 经验路由前置 | agent.ts | +30 | 高置信度任务零幻觉 |
| 3 | Planner prompt 约束 | planner.ts | ~30 改 | 步骤数上限 + 领域围栏 |

### Phase 2: 核心分层（3-5 天）

| # | 任务 | 文件 | 行数 | 效果 |
|---|------|------|------|------|
| 4 | DAG Skeleton 类型 | types.ts | +30 | 编排/执行类型分离 |
| 5 | SkillResolver | skill-resolver.ts | +300 | 步骤→工具的桥梁 |
| 6 | Gate-1: 左脑规划门控 | rule-engine.ts | +120 | 步骤合理性验证 |
| 7 | Gate-2: 工具-意图验证 | rule-engine.ts | +80 | 工具选择合理性验证 |

### Phase 3: 监控闭环（2-3 天）

| # | 任务 | 文件 | 行数 | 效果 |
|---|------|------|------|------|
| 8 | CerebellumExecutionMonitor | executor.ts | +100 | 执行全程监控 |
| 9 | 反思层集成 | agent.ts | +100 | 质量自评+经验编译+教训提取 |
| 10 | 幻觉检测+反面教材注入 | agent.ts | +50 | 持续减少幻觉 |

### Phase 4: 知识注入（2-3 天）

| # | 任务 | 文件 | 行数 | 效果 |
|---|------|------|------|------|
| 11 | 领域知识包注入 Planner prompt | planner.ts + scheduler.ts | +50 | 经验指导规划 |
| 12 | 执行→经验闭环打通 | agent.ts | +20 | DAG 成功自动编译经验 |
| 13 | 教训→经验编译打通 | lesson-system.ts | +20 | 失败自动学习 |

---

## 5. 预期效果

| 指标 | 当前 | Phase 1 后 | Phase 2 后 | Phase 3 后 |
|------|------|-----------|-----------|-----------|
| 工具选择准确率 | ~60% | ~75% | ~90% | ~95% |
| 步骤拆分合理性 | 低 | 中 | 高 | 高 |
| 幻觉率 | 高 | 中 | 低 | 极低 |
| 执行失败自恢复 | 无 | 无 | 有 | 有 |
| 经验图谱增长率 | 慢 | 慢 | 快 | 快 |
| 三脑管控覆盖 | 决策层 | 决策层 | 决策+规划 | 全程 |
