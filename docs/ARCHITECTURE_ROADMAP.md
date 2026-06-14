# Buddy 架构改造路线图

> 日期: 2026-06-14
> 状态: 分析完成，待实施
> 基于: 全链路代码审计 + 网络研究

---

## 一、现状诊断总览

### 已完成的修复（本次会话）

| Commit | 修复内容 | 文件数 |
|---|---|---|
| `d267636` | 资源画像能力链路：新端点入池 + derived 能力 + enrichment 补全 | 5 |
| `2e3bdad` | 三脑决策全链路：taskType 统一 + ResourceHub fallback + 探索奖励 | 8 |

### 系统能力评分

| 维度 | 评分 | 说明 |
|---|---|---|
| 意图理解 | ⭐⭐⭐☆☆ | 关键词 + TextEncoder + 原型匹配，但只有 ~8 类粗分类 |
| 资源选择 | ⭐⭐⭐☆☆ | Thompson Sampling + 三级漏斗，但是「选一个」不是「组合」 |
| 失败恢复 | ⭐⭐☆☆☆ | 有 reflect + retry，但重试走同样流程，没有换路 |
| 上下文管理 | ⭐⭐⭐⭐☆ | PromptBudgetManager 分层优先级，已达工程最佳实践 |
| 记忆检索 | ⭐⭐☆☆☆ | FTS5 关键词匹配，缺语义理解 |
| 跨会话任务 | ⭐☆☆☆☆ | ProjectStore 有表结构但未集成，ExecutionSession 不持久化 |
| 经验积累 | ⭐⭐⭐☆☆ | ExperienceGraph 有框架，但与三脑决策耦合不深 |
| 多模型协作 | ⭐⭐☆☆☆ | 有 cascade routing，但只是换更强模型，不是协作 |

---

## 二、问题清单（按优先级排序）

### P0 — 阻塞核心功能

| # | 问题 | 影响 | 修复复杂度 |
|---|---|---|---|
| 1 | **任务无法跨会话恢复** | 用户关闭会话后，进行中的任务丢失 | 中 |
| 2 | **失败重试不换路** | reflect retry 走同样流程，大概率同样失败 | 中 |
| 3 | **记忆只有关键词匹配** | 语义相关的记忆检索不到 | 中 |

### P1 — 显著影响体验

| # | 问题 | 影响 | 修复复杂度 |
|---|---|---|---|
| 4 | **规则引擎跳过调度逻辑** | 高优先级规则命中后不考虑负载/精力/工具健康 | 低 |
| 5 | **新模型 derived 未补全时跳过过滤** | embedding 模型可能混入 chat 候选池 | 已修复(异步补全) |
| 6 | **上下文没有「任务进度」注入** | 多轮对话中用户不知道任务执行到哪了 | 低 |
| 7 | **ResourceHub 健康度不反映真实状态** | accessStatus/failureStreak 不同步 | 已修复 |

### P2 — 限制高级能力

| # | 问题 | 影响 | 修复复杂度 |
|---|---|---|---|
| 8 | **没有多路径探索** | 选一条路走到黑 | 高 |
| 9 | **没有任务分解** | 复杂任务丢给单模型单次调用 | 高 |
| 10 | **经验系统与三脑耦合不深** | 经验命中后不注入调度决策 | 中 |
| 11 | **教训不跨会话** | reflect 提取的教训不持久化 | 中 |
| 12 | **Thompson Sampling 冷启动** | 新模型被低估 | 已修复(UCB 探索) |

---

## 三、改造路线图

### Phase 1: 失败感知路由 + 任务记忆（1-2 周）

**目标**: 失败时换路走，任务可跨会话恢复

#### 1.1 失败感知重试（最小改动，最大收益）

**核心思想**: reflect retry 时注入「失败上下文」，让决策系统换路

**改动文件**:
- `core/reflector.ts` — 返回结构化失败原因
- `core/ws-handler.ts` — retry 时构造 failureContext
- `brain/left/scheduler.ts` — 接受 failureContext 调整策略
- `core/model-router.ts` — 排除失败模型

**实现**:

```typescript
// reflector.ts — 返回结构化失败分析
interface FailureAnalysis {
  category: 'prompt_issue' | 'tool_failure' | 'model_weakness' | 'resource_mismatch' | 'unknown';
  detail: string;
  suggestedStrategy: 'switch_model' | 'switch_tools' | 'decompose_task' | 'inject_knowledge' | 'simplify';
  failedModelId?: string;
  failedTools?: string[];
}

// ws-handler.ts — retry 时注入失败上下文
const analysis = analyzeFailure(reflectResult, result);
if (analysis.category === 'model_weakness') {
  // 排除失败模型，让 Thompson Sampling 选别的
  router.excludeForRetry(analysis.failedModelId);
}
if (analysis.category === 'tool_failure') {
  // 降级工具，让规则引擎换路径
  signal._failedTools = analysis.failedTools;
  signal._retryStrategy = analysis.suggestedStrategy;
}
// 重新 orchestrate — 带着失败信息
const newPlan = await this.agentRef.orchestrate(content, { failureContext: analysis });
```

**预期效果**: retry 成功率从 ~20% 提升到 ~50%（不同路走而非重复）

#### 1.2 任务检查点持久化

**核心思想**: ExecutionSession 完成时写入 ProjectStore，新会话恢复

**改动文件**:
- `core/execution-session.ts` — onComplete 写入 ProjectStore
- `core/subsystems.ts` — 启动时查询未完成任务
- `core/message-processor.ts` — 上下文注入未完成任务
- `behavior/context-provider.ts` — 维护任务进度状态

**实现**:

```typescript
// execution-session.ts — 完成时持久化
session.onComplete(() => {
  projectStore.saveCheckpoint({
    projectId: inferProjectId(session.goal),
    stepIndex: session.currentStep,
    status: session.status,
    completedSteps: session.steps.filter(s => s.success),
    failedSteps: session.steps.filter(s => !s.success),
    lessons: reflector.extractedLessons,
    context: { signal: lastSignal, plan: lastPlan },
  });
});

// subsystems.ts — 启动时查询
const pendingTasks = projectStore.getPendingCheckpoints();
if (pendingTasks.length > 0) {
  this._pendingTasks = pendingTasks;
}

// message-processor.ts — 注入上下文
if (this.sys.pendingTasks?.length > 0) {
  promptBudget.add({
    id: 'pending-tasks',
    source: 'memory',
    priority: 70,
    content: formatPendingTasks(this.sys.pendingTasks),
  });
}
```

**预期效果**: 用户说"继续"时，系统能恢复上次任务进度

#### 1.3 记忆语义检索升级

**核心思想**: FTS5 关键词匹配 → 向量语义检索

**改动文件**:
- `memory/store.ts` — 新增 embedding 存储 + 向量检索
- `core/message-processor.ts` — buildContext 用语义检索

**方案选择**:
- **轻量方案**: 用 TextEncoder 的 embedding 做余弦相似度（零外部依赖）
- **标准方案**: 用本地 embedding 模型（如 bge-small-zh）做向量检索

**推荐**: 先用轻量方案（TextEncoder 已有），后续升级到标准方案

```typescript
// memory/store.ts — 新增语义检索
searchMemoriesSemantic(queryEmbedding: Float32Array, limit = 5): Memory[] {
  const all = this.getAllMemories();
  const scored = all.map(m => ({
    ...m,
    similarity: cosineSimilarity(queryEmbedding, m.embedding),
  }));
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}
```

**预期效果**: "上次那个 auth 模块的重构" 能找到相关记忆，即使关键词不完全匹配

---

### Phase 2: 智能资源决策（2-4 周）

**目标**: 从「选一个模型」升级到「组合最优资源」

#### 2.1 多候选方案生成

**核心思想**: orchestrate 不只生成一个 plan，而是 2-3 个候选

**改动文件**:
- `brain/brain.ts` — decide() 返回候选列表
- `brain/left/scheduler.ts` — schedule() 生成多个候选
- `core/agent.ts` — orchestrate() 评估候选选最优

**实现**:

```typescript
// scheduler.ts — 生成多个候选
async scheduleMultiple(signal, resources, intuition, body, count = 3): Promise<ExecutionPlan[]> {
  const plans: ExecutionPlan[] = [];

  // 候选 1: 规则引擎命中
  const rulePlan = this.ruleEngine.evaluate(signal, resources, intuition, body);
  if (rulePlan) plans.push(rulePlan);

  // 候选 2: Thompson Sampling 选不同模型
  const tsPlan = await this.thompsonSelect(signal, resources, intuition, body);
  if (tsPlan) plans.push(tsPlan);

  // 候选 3: 经验路由
  if (resources.experienceHit) {
    plans.push(this.makePlan('exp_direct', 'local_only', '经验路由', 0.8, [...]));
  }

  return plans;
}

// agent.ts — 评估候选
const candidates = await scheduler.scheduleMultiple(signal, resources, intuition, body, 3);
const scored = candidates.map(p => ({
  plan: p,
  score: p.confidence * (1 - calcNovelty(signal, resources)) * toolHealthFactor,
}));
scored.sort((a, b) => b.score - a.score);
const bestPlan = scored[0].plan;

// 失败时切换到下一个候选
if (failed && scored.length > 1) {
  const fallbackPlan = scored[1].plan;
  return executeByPlan(fallbackPlan);
}
```

**预期效果**: 第一个方案失败时，立即切换到备选方案，而非重新 orchestrate

#### 2.2 任务分解与 DAG 编排

**核心思想**: 复杂任务自动分解为子任务图

**改动文件**:
- `orchestrate/planner.ts` — 降低 DAG 触发阈值
- `core/plan-executor.ts` — 支持并行子任务执行
- `brain/left/rule-engine.ts` — 新增分解规则

**关键改动**:

```typescript
// 当前: 需要 3+ 并行标记词或 4+ 子句才触发 DAG
// 改后: 复杂任务 + 多工具需求 → 自动分解

function shouldDecompose(signal: TaskSignal, content: string): boolean {
  // 已有: 并行标记词检测
  if (parallelMarkers >= 3) return true;
  if (clauses >= 4) return true;

  // 新增: 多工具需求检测
  const intent = classifyFromText(content);
  if (intent.suggestedTools.length >= 3) return true;

  // 新增: 复杂度 + 长度联合判断
  if (signal.complexity === 'complex' && content.length > 300) return true;

  // 新增: 多领域任务
  if (signal.domains.length >= 2) return true;

  return false;
}
```

**预期效果**: "分析这个项目的代码质量，找出安全漏洞，生成报告" 自动分解为 3 个子任务并行执行

#### 2.3 资源能力感知调度

**核心思想**: 调度时查询「谁能做好这件事」，而非随机选

**改动文件**:
- `brain/left/scheduler.ts` — 调度前查询 pool 能力
- `core/model-router.ts` — buildModelRequirement 注入历史表现
- `brain/hub/resource-hub.ts` — 提供能力查询接口

**实现**:

```typescript
// scheduler.ts — 能力感知调度
async schedule(signal, resources, intuition, body) {
  // 查询 pool 中该任务类型的可用模型
  const capable = pool.queryCapableModels(signal.taskType);

  // 按历史表现排序
  const ranked = capable.sort((a, b) => {
    const scoreA = a.taskSuccessRate * 0.6 + (1 - a.avgLatencyMs / 10000) * 0.2 + (1 - a.costPer1kInput) * 0.2;
    const scoreB = b.taskSuccessRate * 0.6 + (1 - b.avgLatencyMs / 10000) * 0.2 + (1 - b.costPer1kInput) * 0.2;
    return scoreB - scoreA;
  });

  // 结合 BodyState 调整
  if (body.load > 80) {
    // 高负载 → 选最快而非最好的
    ranked.sort((a, b) => a.avgLatencyMs - b.avgLatencyMs);
  }
  if (body.energy < 30) {
    // 低精力 → 选最便宜的
    ranked.sort((a, b) => a.costPer1kInput - b.costPer1kInput);
  }

  return ranked[0];
}
```

**预期效果**: 不再随机选模型，而是根据任务特征 + 系统状态选最优

---

### Phase 3: 自适应学习系统（4-8 周）

**目标**: 系统从每次交互中学习，越用越好

#### 3.1 任务级教训跨会话迁移

**核心思想**: reflect 提取的教训持久化，新会话可复用

**改动文件**:
- `core/reflector.ts` — 教训写入 ProjectStore
- `project/store.ts` — 新增 lessons 查询接口
- `core/message-processor.ts` — 教训注入上下文

```typescript
// reflector.ts — 教训持久化
if (failedCalls.length > 0) {
  for (const failed of failedCalls) {
    projectStore.addLesson({
      category: 'tool_failure',
      tool: failed.name,
      error: failed.result.slice(0, 200),
      context: { signal: signal.taskType, domains: signal.domains },
      timestamp: Date.now(),
    });
  }
}

// message-processor.ts — 教训注入
const relevantLessons = projectStore.getLessonsForTask(signal.taskType, signal.domains);
if (relevantLessons.length > 0) {
  const lessonText = relevantLessons.map(l =>
    `⚠️ 历史教训: ${l.category} — ${l.content}`
  ).join('\n');
  promptBudget.add({ id: 'lessons', source: 'memory', priority: 65, content: lessonText });
}
```

**预期效果**: "上次用 exec 跑 python 超时了" → 下次同类任务自动换策略

#### 3.2 经验系统深度集成

**核心思想**: 经验路由命中时，不仅注入 hint，还注入资源偏好

**改动文件**:
- `intelligence/experience-router.ts` — 返回资源偏好
- `brain/left/scheduler.ts` — 经验偏好注入调度
- `core/model-router.ts` — 经验推荐的模型优先

```typescript
// experience-router.ts — 扩展 RouteDecision
interface RouteDecision {
  path: RoutePath;
  skill?: ExperienceUnit;
  confidence: number;
  novelty: number;
  // 新增: 资源偏好
  resourceHints?: {
    preferredModels?: string[];    // 这个任务用什么模型效果好
    preferredTools?: string[];     // 用什么工具组合
    avoidModels?: string[];        // 什么模型不适合
    avoidTools?: string[];         // 什么工具不适合
  };
}

// scheduler.ts — 经验偏好注入
if (resources.experienceHit?.resourceHints) {
  const hints = resources.experienceHit.resourceHints;
  if (hints.preferredModels) {
    // 让 Thompson Sampling 优先选这些模型
    for (const model of hints.preferredModels) {
      pool.boostModel(model, 1.5); // 1.5x 加权
    }
  }
}
```

#### 3.3 蒸馏升级：决策模式 → 可复用规则

**核心思想**: PolicyDistiller 从历史决策中提炼规则，自动加入规则引擎

**改动文件**:
- `brain/left/policy-distiller.ts` — 增强蒸馏逻辑
- `brain/left/rule-engine.ts` — 自动管理学习规则

**关键改进**:
- 当前蒸馏只是简单聚类，应升级为：聚类 → 提取共性 → 生成条件 → 验证 → 加入规则引擎
- 学习规则应有「置信度」和「样本数」，低于阈值时不触发

---

### Phase 4: 高级能力（8+ 周）

#### 4.1 多模型协作

- 多模型辩论：同一问题让 2-3 个模型回答，选最优
- 模型接力：模型 A 生成初稿，模型 B 审核改进
- 专家组合：代码模型写代码 + 推理模型做架构 + 翻译模型做文档

#### 4.2 自我进化

- 影子大脑（ShadowBrain）已部分实现，需完善：
  - 自动发现能力缺口 → 生成训练数据 → 微调
  - 规则自动进化：观察决策模式 → 提炼规则 → 淘汰低效规则
  - Prompt 自动优化：观察 prompt 效果 → 自动调整

#### 4.3 知识图谱

- STMP 时空记忆宫殿已有框架，需完善：
  - 自动从对话中提取实体和关系
  - 构建项目级知识图谱
  - 决策时查询知识图谱做推理

---

## 四、实施节奏建议

```
Week 1-2:  Phase 1.1 失败感知重试 + Phase 1.2 任务检查点
           → 最小改动，最大收益：失败能换路，任务能恢复

Week 3-4:  Phase 1.3 记忆语义检索 + Phase 2.1 多候选方案
           → 记忆更智能，决策有备选

Week 5-8:  Phase 2.2 DAG 触发优化 + Phase 2.3 能力感知调度
           → 复杂任务自动分解，资源选择更精准

Week 9-12: Phase 3 全部
           → 系统开始自我学习

Week 13+:  Phase 4 按需
           → 高级能力逐步落地
```

---

## 五、关键设计原则

1. **最小改动，最大收益** — 每个 Phase 的第一个子任务都应该是投入产出比最高的
2. **向后兼容** — 所有改动都应有 fallback，新机制失败时退回旧逻辑
3. **可度量** — 每个改动都应有可度量的指标（retry 成功率、任务恢复率、记忆命中率）
4. **渐进式** — 不要一次性重构，每个子任务独立可交付、独立有价值
5. **为失败而设计** — 系统的每个环节都应考虑「如果这一步失败了怎么办」

---

## 六、核心洞察

**当前系统的本质**: 带反馈的机械程序（状态机 + 多臂老虎机）

**要达到的本质**: 智能资源编排者（理解任务 → 组合资源 → 失败换路 → 经验积累）

**最关键的一步**: 把 reflect retry 从「重跑一遍」升级为「带着失败信息换路走」。

这一步打通后，整个系统的性质就从「机械重试」变成了「智能适应」。

---

_文档维护: 每完成一个 Phase 后更新评分和状态_
