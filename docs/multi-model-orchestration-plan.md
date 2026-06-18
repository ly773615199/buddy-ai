# 三脑 × DAG × 资源图谱 融合执行方案

> 目标：让超大型任务（需要多模型协作）在现有三脑架构上自然运行，
> 而不是绕过它。核心改动是 **3 个接口扩展 + 2 个管线增强 + 1 个反馈闭环**。

---

## 一、改动总览

```
改动 1: SkeletonStep 增加 capabilityRequirement 字段       [orchestrate/types.ts]
改动 2: SkillResolver 增加执行单元匹配                      [skills/skill-resolver.ts]
改动 3: TaskExecutor 支持 per-step 模型注入                  [orchestrate/executor.ts]
改动 4: DAG 管线增加能力匹配层（Step 2.5）                   [core/dag-pipeline.ts]
改动 5: UnifiedResourceHub.recommend() 增加组合亲和度        [brain/hub/unified-resource-hub.ts]
改动 6: 三脑反馈闭环 — 执行结果回流 ResourceHub              [core/agent.ts]
```

每个改动独立可测，按顺序实施。

---

## 二、逐项详细设计

### 改动 1: SkeletonStep 增加 capabilityRequirement

**文件**: `src/orchestrate/types.ts`

**现状**: `SkeletonStep` 只有 `suggestedCategory`（工具类别），不携带能力需求。

**改动**:

```ts
// types.ts — 新增接口

/** 步骤级能力需求 — 描述该步骤需要什么样的执行单元 */
export interface StepCapabilityRequirement {
  /** 该步骤需要的任务类型（用于 UnifiedResourceHub.recommend） */
  taskType: 'chat' | 'tools' | 'reasoning' | 'embedding' | 'background';
  /** 偏好的模型类别（可选，不填则不限） */
  preferredCategories?: string[];
  /** 最低能力要求（可选） */
  minCapabilities?: Record<string, number>;
  /** 是否需要工具调用能力 */
  requiresToolCalling?: boolean;
  /** 是否需要视觉能力 */
  requiresVision?: boolean;
  /** 成本上限（可选） */
  maxCostPer1k?: number;
  /** 延迟容忍度 */
  latencyTolerance?: 'low' | 'medium' | 'high';
  /** 是否允许复用前序步骤的执行单元（节省模型切换开销） */
  reusePreviousModel?: boolean;
}

// SkeletonStep 增加字段
export interface SkeletonStep {
  id: string;
  name: string;
  intent: string;
  deps: string[];
  suggestedCategory?: string;
  retry?: RetryConfig;
  timeoutMs?: number;
  // ── 新增 ──
  capabilityRequirement?: StepCapabilityRequirement;
}
```

**影响范围**: 仅类型扩展，不破坏现有代码。`planSkeleton()` 的 LLM prompt 需要增加输出 `capabilityRequirement` 的指引。

**planner.ts prompt 改动** (在 `buildSkeletonSystemPrompt` 中追加):

```
每个步骤可选填 capabilityRequirement（不填则由系统自动推断）：
- taskType: 'reasoning' | 'chat' | 'tools' | 'embedding'
- preferredCategories: 模型类别列表
- requiresToolCalling: 是否需要工具调用
- reusePreviousModel: 是否允许复用前序模型
```

---

### 改动 2: SkillResolver 增加执行单元匹配

**文件**: `src/skills/skill-resolver.ts`

**现状**: `resolve()` 只做"步骤 → 工具+参数"的映射，不涉及模型选择。
模型在 `TaskExecutor` 执行时才由 `ToolExecutionMiddleware` 统一使用当前默认模型。

**改动**: 在 `resolve()` 完成后，增加一个 `matchExecutors()` 方法，
为每个 resolved task 匹配最合适的执行单元（模型）。

```ts
// skill-resolver.ts — 新增方法

import type { UnifiedResourceHub } from '../brain/hub/unified-resource-hub.js';
import type { StepCapabilityRequirement } from '../orchestrate/types.js';

/** 执行单元匹配结果 */
export interface ExecutorMatch {
  taskId: string;
  resourceId: string;      // UnifiedResourceHub 中的资源 id
  resourceName: string;
  score: number;           // 匹配分数
  source: 'capability' | 'reuse' | 'fallback';
}

export class SkillResolver {
  // ... 现有代码 ...

  /** 注入资源中心（在 subsystems 初始化时注入） */
  private resourceHub: UnifiedResourceHub | null = null;

  setResourceHub(hub: UnifiedResourceHub): void {
    this.resourceHub = hub;
  }

  /**
   * 为 DAG 中每个任务匹配执行单元
   *
   * 逻辑：
   * 1. 有 capabilityRequirement → 用 UnifiedResourceHub.recommend() 匹配
   * 2. reusePreviousModel=true → 复用前序步骤的匹配结果
   * 3. 无需求 → 使用默认模型（不注入）
   */
  matchExecutors(
    dag: TaskDAG,
    skeleton: DAGSkeleton,
  ): Map<string, ExecutorMatch> {
    const matches = new Map<string, ExecutorMatch>();
    if (!this.resourceHub) return matches;

    // 按拓扑序处理，支持 reusePreviousModel
    const stepMap = new Map(skeleton.steps.map(s => [s.id, s]));

    for (const task of dag.tasks.values()) {
      const step = stepMap.get(task.id);
      const req = step?.capabilityRequirement;
      if (!req) continue;

      // 检查是否复用前序模型
      if (req.reusePreviousModel && task.deps.length > 0) {
        const depMatch = matches.get(task.deps[0]);
        if (depMatch) {
          matches.set(task.id, {
            taskId: task.id,
            resourceId: depMatch.resourceId,
            resourceName: depMatch.resourceName,
            score: depMatch.score,
            source: 'reuse',
          });
          continue;
        }
      }

      // 通过 UnifiedResourceHub.recommend() 匹配
      const candidates = this.resourceHub.recommend(
        req.taskType,
        undefined, // domain
        undefined, // type
        {
          requiresToolCalling: req.requiresToolCalling,
          requiresVision: req.requiresVision,
          maxCostPer1k: req.maxCostPer1k,
          latencyTolerance: req.latencyTolerance,
        },
      );

      if (candidates.length > 0) {
        const best = candidates[0];
        matches.set(task.id, {
          taskId: task.id,
          resourceId: best.id,
          resourceName: best.name,
          score: 0, // recommend 内部已排序，第一个即最优
          source: 'capability',
        });
      }
    }

    return matches;
  }
}
```

---

### 改动 3: TaskExecutor 支持 per-step 模型注入

**文件**: `src/orchestrate/executor.ts`

**现状**: `executeSingleTask()` 通过 `ToolExecutionMiddleware.execute()` 执行，
所有步骤使用同一个默认模型。

**改动**: `Task` 类型增加可选的 `executorMatch` 字段，
`executeSingleTask` 在执行前检查是否有指定的执行单元。

```ts
// types.ts — Task 增加字段
export interface Task {
  // ... 现有字段 ...
  // ── 新增 ──
  /** 匹配到的执行单元（由 SkillResolver.matchExecutors 填充） */
  executorResourceId?: string;
}

// executor.ts — executeSingleTask 改动
private async executeSingleTask(
  dag: TaskDAG,
  task: Task,
  onEvent: EventCallback,
  timeoutMs: number,
): Promise<void> {
  task.status = 'running';
  task.startedAt = Date.now();
  onEvent({ type: 'orch_task_start', dagId: dag.id, taskId: task.id });

  const resolvedArgs = this.resolveArgs(task.args, dag);

  // ── 新增：per-step 模型注入 ──
  // 如果任务指定了 executorResourceId，临时切换执行上下文的模型
  const modelOverride = task.executorResourceId ?? undefined;

  const result = await this.middleware.execute({
    toolName: task.tool,
    args: resolvedArgs,
    source: 'dag',
    timeoutMs,
    modelOverride,  // 新增：传入模型覆盖
  });

  // ... 后续不变 ...
}
```

**ToolExecutionMiddleware 改动** (`src/tools/execution-middleware.ts`):

```ts
interface ExecuteOptions {
  toolName: string;
  args: Record<string, unknown>;
  source: string;
  timeoutMs: number;
  modelOverride?: string;  // 新增
}

async execute(options: ExecuteOptions): Promise<ExecuteResult> {
  // 如果有 modelOverride，临时设置 LLM 的模型
  if (options.modelOverride && this.llmAdapter) {
    const prevModel = this.llmAdapter.getCurrentModel();
    this.llmAdapter.setModel(options.modelOverride);
    try {
      return await this.doExecute(options);
    } finally {
      this.llmAdapter.setModel(prevModel); // 恢复
    }
  }
  return this.doExecute(options);
}
```

---

### 改动 4: DAG 管线增加能力匹配层

**文件**: `src/core/dag-pipeline.ts`

**现状**: 管线是 4 步：
```
planSkeleton → Gate-1 → SkillResolver.resolve() → Gate-2
```

**改动**: 在 Step 3 和 Step 4 之间插入 **Step 3.5: 能力匹配**。

```ts
export async function resolveDAGPipeline(
  sys: Subsystems,
  content: string,
  signal: TaskSignal,
  resources: ResourceState,
  verbose: boolean,
): Promise<DAGPipelineResult> {
  // ... Step 1: planSkeleton (不变) ...
  // ... Step 2: Gate-1 (不变) ...
  // ... Step 3: SkillResolver.resolve() (不变) ...

  // ── Step 3.5: 能力匹配 — 为每个任务匹配执行单元 ──
  if (sys.skillResolver && sys.unifiedResourceHub) {
    sys.skillResolver.setResourceHub(sys.unifiedResourceHub);
    const executorMatches = sys.skillResolver.matchExecutors(resolved.dag, skeleton);

    // 将匹配结果注入到 Task.executorResourceId
    for (const [taskId, match] of executorMatches) {
      const task = resolved.dag.tasks.get(taskId);
      if (task) {
        task.executorResourceId = match.resourceId;
      }
    }

    if (verbose) {
      const matched = [...executorMatches.values()].filter(m => m.source === 'capability').length;
      const reused = [...executorMatches.values()].filter(m => m.source === 'reuse').length;
      console.log(`  [能力匹配] ${matched} 步匹配到执行单元, ${reused} 步复用前序模型`);
    }
  }

  // ... Step 4: Gate-2 (不变) ...
}
```

**subsystems.ts 注入** (在初始化 SkillResolver 时):

```ts
// 已有: this.skillResolver = new SkillResolver(...)
// 新增:
if (this.unifiedResourceHub) {
  this.skillResolver.setResourceHub(this.unifiedResourceHub);
}
```

---

### 改动 5: UnifiedResourceHub.recommend() 增加组合亲和度

**文件**: `src/brain/hub/unified-resource-hub.ts`

**现状**: `recommend()` 对每个资源独立评分，不考虑"资源组合"的效果。

**改动**: 增加一个 `recommendCombination()` 方法，为 DAG 中多个步骤联合推荐执行单元组合。

```ts
/**
 * 为 DAG 中多个步骤联合推荐执行单元组合
 *
 * 考虑因素：
 * 1. 每个步骤的独立匹配分数
 * 2. 模型切换成本（不同 provider 的切换比同 provider 切换更贵）
 * 3. 前序步骤的输出格式对后续步骤的兼容性
 */
recommendCombination(
  requirements: Array<{
    stepId: string;
    taskType: string;
    deps: string[];
    context?: Record<string, unknown>;
  }>,
): Map<string, string> {  // stepId → resourceId
  const assignment = new Map<string, string>();
  const usedModels = new Set<string>();

  // 按拓扑序处理
  const sorted = this.topologicalSort(requirements);

  for (const req of sorted) {
    const candidates = this.recommend(req.taskType);

    if (candidates.length === 0) continue;

    // 评分：独立匹配分 + 复用加分
    const scored = candidates.map(c => {
      let score = 0;

      // 独立匹配分（recommend 内部已排序，用 index 近似）
      const idx = candidates.indexOf(c);
      score += (candidates.length - idx) * 10;

      // 复用加分：如果前序步骤用了同一个模型，+15（减少切换开销）
      for (const depId of req.deps) {
        if (assignment.get(depId) === c.id) {
          score += 15;
          break;
        }
      }

      return { resource: c, score };
    });

    scored.sort((a, b) => b.score - a.score);
    assignment.set(req.stepId, scored[0].resource.id);
  }

  return assignment;
}
```

---

### 改动 6: 三脑反馈闭环 — 执行结果回流 ResourceHub

**文件**: `src/core/agent.ts`

**现状**: DAG 执行完成后，结果只记录在 `OrchestrateResult` 中，
不反馈到 `UnifiedResourceHub`。资源画像无法从 DAG 执行中学习。

**改动**: 在 DAG 执行完成后，将每个步骤的结果反馈到 ResourceHub。

```ts
// agent.ts — 在 executeByPlan 或 resolveDAGPipeline 之后

private feedDAGResultsToResourceHub(
  dag: TaskDAG,
  executorMatches: Map<string, ExecutorMatch>,
): void {
  if (!this.sys.unifiedResourceHub) return;

  for (const task of dag.tasks.values()) {
    const match = executorMatches.get(task.id);
    if (!match) continue;

    this.sys.unifiedResourceHub.recordOutcome(match.resourceId, {
      success: task.status === 'done',
      latencyMs: (task.finishedAt ?? 0) - (task.startedAt ?? 0),
      taskType: task.tool,  // 用工具名近似任务类型
    });
  }
}
```

**同时更新 MarginalAuditor**：让它能按 DAG 级别审计资源组合的边际贡献。

```ts
// marginal-auditor.ts — 新增方法

/**
 * 审计 DAG 中资源组合的边际贡献
 *
 * 方法：比较"使用推荐组合"vs"使用默认模型"的成功率差异
 */
auditDAGCombination(
  dagId: string,
  steps: Array<{ stepId: string; resourceId: string; success: boolean }>,
): void {
  // 记录组合执行结果，供后续 recommendCombination 使用
  for (const step of steps) {
    const resource = this.hub.get(step.resourceId);
    if (!resource) continue;

    // 更新 byTaskType 统计（已有逻辑会自动计算边际贡献）
    this.hub.recordOutcome(step.resourceId, {
      success: step.success,
      latencyMs: 0,
      taskType: step.stepId,  // 用 stepId 作为任务类型标识
    });
  }
}
```

---

## 三、实施顺序与依赖关系

```
Phase 1（类型扩展，无功能影响）:
  改动 1: types.ts 增加 StepCapabilityRequirement
  改动 5: UnifiedResourceHub.recommendCombination()

Phase 2（能力匹配核心）:
  改动 2: SkillResolver.matchExecutors()
  改动 4: DAG 管线增加 Step 3.5

Phase 3（执行层适配）:
  改动 3: TaskExecutor per-step 模型注入
  改动 6: 反馈闭环

Phase 4（端到端验证）:
  新增测试: 多步骤 DAG 每步使用不同模型
  新增测试: reusePreviousModel 复用逻辑
  新增测试: 反馈闭环 → MarginalAuditor 审计
```

---

## 四、一个端到端示例

**用户输入**: "分析这个项目的代码质量，生成报告，然后给出改进建议"

**三脑决策**:
```
小脑: bodyState {energy: 80, load: 30} → 资源充裕
右脑: intent {category: 'analysis', confidence: 0.85}
审议: action=proceed
左脑: 法则 2（多领域 + complex）→ mode='dag'
```

**DAG 骨架** (planSkeleton 输出):
```json
{
  "steps": [
    {
      "id": "s1", "name": "代码扫描",
      "intent": "扫描项目结构，收集代码指标",
      "suggestedCategory": "code_analysis",
      "capabilityRequirement": {
        "taskType": "tools",
        "requiresToolCalling": true,
        "reusePreviousModel": true
      }
    },
    {
      "id": "s2", "name": "质量分析",
      "intent": "分析代码质量，识别问题",
      "suggestedCategory": "code_analysis",
      "deps": ["s1"],
      "capabilityRequirement": {
        "taskType": "reasoning",
        "minCapabilities": {"reasoning": 0.7}
      }
    },
    {
      "id": "s3", "name": "生成报告",
      "intent": "生成可读的质量报告",
      "deps": ["s2"],
      "capabilityRequirement": {
        "taskType": "chat",
        "reusePreviousModel": true
      }
    },
    {
      "id": "s4", "name": "改进建议",
      "intent": "基于分析结果给出具体改进建议",
      "deps": ["s2"],
      "capabilityRequirement": {
        "taskType": "reasoning",
        "minCapabilities": {"reasoning": 0.8}
      }
    }
  ],
  "parallelGroups": [["s3", "s4"]]
}
```

**能力匹配** (matchExecutors 输出):
```
s1 代码扫描 → Model A (chat, toolCalling ✅) [capability]
s2 质量分析 → Model B (reasoning 0.9) [capability]
s3 生成报告 → Model A [reuse from s1]
s4 改进建议 → Model B [reuse from s2]
```

**执行**:
```
s1 (Model A) → 扫描完成
  ↓
s2 (Model B) → 分析完成
  ↓ 并行
s3 (Model A) → 报告生成    s4 (Model B) → 建议生成
```

**反馈**:
```
ResourceHub.recordOutcome(Model A, {success: true, taskType: 'tools'})
ResourceHub.recordOutcome(Model B, {success: true, taskType: 'reasoning'})
MarginalAuditor: Model A 在 tools 任务上的边际贡献 +0.12
MarginalAuditor: Model B 在 reasoning 任务上的边际贡献 +0.18
```

---

## 五、风险与缓解

| 风险 | 缓解 |
|------|------|
| LLM 不输出 capabilityRequirement | planner.ts prompt 增加指引 + 推断逻辑（从 suggestedCategory 推断 taskType） |
| 匹配到的模型不可用 | LifecycleManager 过滤掉非 active 状态的资源 |
| 模型切换开销大 | reusePreviousModel 优先复用 + 同 provider 优先 |
| recommendCombination 组合爆炸 | 拓扑序贪心，不做全排列 |
| 回流数据噪声 | MarginalAuditor 的 EMA 平滑 + 最小样本量门槛 |
