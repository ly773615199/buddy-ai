# 多模型协作方案 — 补充执行计划（第二轮）

> 基于第一轮实施后的差距分析，补全 6 个缺口。

---

## 已完成（第一轮）

| # | 改动 | 状态 |
|---|------|------|
| 1 | `StepCapabilityRequirement` 类型 | ✅ |
| 2 | `ExecutorMatch` 类型 | ✅ |
| 3 | `recommendCombination()` | ✅ |
| 4 | `matchExecutors()` | ✅ |
| 5 | DAG 管线 Step 3.5 | ✅ |
| 6 | per-step executorResourceId 透传 | ✅ |
| 7 | 执行结果回流 ResourceHub | ✅ |
| 8 | waitForResourceSystem 竞态修复 | ✅ |

---

## 缺口分析

### 缺口 1: 能力推断 — capabilityRequirement 为空时怎么办

**现状**: `capabilityRequirement` 是可选字段。LLM 生成的 `planSkeleton` 大概率不填它。
`matchExecutors` 遇到没有 `capabilityRequirement` 的步骤直接跳过，等于没匹配。

**修复**: 在 `matchExecutors` 中增加 `inferCapabilityRequirement()` 方法，
从 `suggestedCategory` + `intent` + `deps` 自动推断。

```ts
// skill-resolver.ts — 新增

private inferCapabilityRequirement(
  step: SkeletonStep,
): StepCapabilityRequirement | null {
  const cat = step.suggestedCategory;
  if (!cat) return null;

  // suggestedCategory → taskType 映射
  const CATEGORY_TASK_MAP: Record<string, StepCapabilityRequirement> = {
    code_analysis:  { taskType: 'tools', requiresToolCalling: true },
    file_ops:       { taskType: 'tools', requiresToolCalling: true },
    web_search:     { taskType: 'tools', requiresToolCalling: true },
    git:            { taskType: 'tools', requiresToolCalling: true },
    voice:          { taskType: 'chat' },
    chat:           { taskType: 'chat' },
    system:         { taskType: 'tools', requiresToolCalling: true },
  };

  return CATEGORY_TASK_MAP[cat] ?? null;
}
```

**调用点**: `matchExecutors` 中，当 `step.capabilityRequirement` 为空时调用。

---

### 缺口 2: 匹配失败无回退

**现状**: `matchExecutors` 返回空 map 时，Step 3.5 静默跳过，
步骤使用默认模型执行，可能失败。

**修复**: 在 `dag-pipeline.ts` Step 3.5 中，对未匹配到执行单元的步骤
尝试 `recommend()` 降级匹配（放宽约束），仍然失败则标记为 `fallback`。

```ts
// dag-pipeline.ts — Step 3.5 增强

for (const task of resolved.dag.tasks.values()) {
  if (task.executorResourceId) continue; // 已匹配

  const step = stepMap.get(task.id);
  const req = step?.capabilityRequirement;
  if (!req) continue;

  // 降级匹配：放宽 constraints 重试
  const fallback = unifiedHub.recommend(req.taskType);
  if (fallback.length > 0) {
    task.executorResourceId = fallback[0].id;
    // 记录为 fallback 匹配
  }
}
```

---

### 缺口 3: Thompson Sampling 未接入

**现状**: `recommend()` 用的是 `byTaskType` 的简单成功率统计 (0-40 分)。
ModelPool 中 Thompson Sampling 学到的亲和度数据没有被使用。

**修复**: 在 `recommend()` 评分中增加 Thompson Sampling 亲和度维度。

```ts
// unified-resource-hub.ts — recommend() 增加维度

// 8. Thompson Sampling 亲和度 (0-15)
// 从 ModelPool 的 bandit 亲和度中读取
const affinity = this.getAffinityScore(r.id, taskType);
score += affinity * 15;
```

需要从 ModelPool 读取亲和度数据。ModelPool 的 `select()` 内部已经用了
Thompson Sampling，但亲和度数据没有暴露给外部。

**方案**: ModelPool 增加 `getAffinityScore(modelId, taskType)` 公开方法。

---

### 缺口 4: 并行步骤资源冲突

**现状**: 两个并行步骤（在同一 `parallelGroup` 中）可能匹配到同一个资源。
如果该资源是单并发的 API（如某个有速率限制的模型），会导致执行失败。

**修复**: `matchExecutors` 增加冲突检测。对并行步骤，
优先分配不同资源；如果只有一个资源可用，标记为 `shared`。

```ts
// skill-resolver.ts — matchExecutors 增强

// 检测并行冲突
const parallelGroups = dag.parallelGroups;
for (const group of parallelGroups) {
  const groupMatches = group
    .map(id => matches.get(id))
    .filter((m): m is ExecutorMatch => !!m);

  // 同组中相同 resourceId 的步骤
  const resourceCounts = new Map<string, string[]>();
  for (const m of groupMatches) {
    const existing = resourceCounts.get(m.resourceId) ?? [];
    existing.push(m.taskId);
    resourceCounts.set(m.resourceId, existing);
  }

  // 冲突处理：对重复的步骤尝试分配其他资源
  for (const [resourceId, taskIds] of resourceCounts) {
    if (taskIds.length <= 1) continue;
    // 第一个保持，其他尝试重新分配
    for (let i = 1; i < taskIds.length; i++) {
      const step = stepMap.get(taskIds[i]);
      const req = step?.capabilityRequirement;
      if (!req) continue;
      const altCandidates = this.resourceHub.recommend(req.taskType)
        .filter(r => r.id !== resourceId);
      if (altCandidates.length > 0) {
        matches.set(taskIds[i], {
          taskId: taskIds[i],
          resourceId: altCandidates[0].id,
          resourceName: altCandidates[0].name,
          score: 0,
          source: 'capability',
        });
      }
    }
  }
}
```

---

### 缺口 5: 规划器无资源感知

**现状**: `planSkeleton` 不知道系统有哪些可用资源，可能生成无法执行的步骤
（如生成一个需要 embedding 模型的步骤，但系统没有 embedding 模型）。

**修复**: 在 `planSkeleton` 的 prompt 中注入当前可用资源摘要。

```ts
// planner.ts — planSkeleton() 增强

// 构建资源摘要注入 prompt
const resourceSummary = this.buildResourceSummary();
const userPrompt = this.buildSkeletonUserPrompt(
  userIntent, contextTags, domainKnowledge, resourceSummary,
);

private buildResourceSummary(): string {
  if (!this.resourceHub) return '';
  const active = this.resourceHub.getActive();
  if (active.length === 0) return '';

  const byType = new Map<string, string[]>();
  for (const r of active) {
    const list = byType.get(r.type) ?? [];
    list.push(r.name);
    byType.set(r.type, list);
  }

  let summary = '\n\n## 可用资源\n';
  for (const [type, names] of byType) {
    summary += `- ${type}: ${names.join(', ')}\n`;
  }
  summary += '\n请基于可用资源规划步骤，不要规划需要不存在资源的步骤。';
  return summary;
}
```

---

### 缺口 6: 反馈粒度太粗

**现状**: `plan-executor.ts` 回流时只传了 `success` 和 `latencyMs`，
没有传 `taskType`，导致 `ResourceHub.stats.byTaskType` 统计不准确。

**修复**: 从 DAG 步骤的 `capabilityRequirement` 中提取 `taskType` 传入。

```ts
// plan-executor.ts — 回流增强

if (task.executorResourceId) {
  // 从 skeleton 的 capabilityRequirement 中提取 taskType
  const step = plan.dagSkeleton?.steps.find(s => s.id === task.id);
  const taskType = step?.capabilityRequirement?.taskType ?? task.tool;

  recordResourceOutcome(ctx.sys, task.executorResourceId, tr.success, tr.durationMs, undefined, taskType);
}
```

---

## 实施顺序

```
Phase A（推断 + 回退，立即生效）:
  缺口 1: inferCapabilityRequirement()
  缺口 2: 匹配失败降级重试
  缺口 6: 反馈粒度修正

Phase B（亲和度 + 冲突，需要 ModelPool 改动）:
  缺口 3: Thompson Sampling 亲和度接入
  缺口 4: 并行步骤资源冲突检测

Phase C（资源感知规划，需要 LLM prompt 调优）:
  缺口 5: 规划器注入资源摘要
```

---

## 预期效果

修复前：
```
planSkeleton → 步骤无 capabilityRequirement → matchExecutors 跳过 → 全用默认模型
```

修复后：
```
planSkeleton(资源感知) → 步骤有 requirement(自动推断) → matchExecutors 匹配
  → 并行步骤冲突检测 → Thompson 亲和度加权 → 执行 → 精确回流 byTaskType
```
