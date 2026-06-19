# 三脑资源决策机制分析与优化方案

> 文档版本: v1.0 | 日期: 2026-06-19
> 状态: 待实施

## 1. 问题概述

三脑架构（左脑规则+右脑直觉+小脑感知）在资源决策上存在**权力错位**问题：
三脑负责策略决策（选择协作模式），但具体模型选择权被 Thompson Sampling 算法独立控制，
导致三脑无法确保关键任务使用最优模型。

## 2. 当前决策链路

```
用户输入
  → collectPerceptionState()           [信号采集: 意图分类 + 领域检测 + 复杂度评估]
  → ThreeBrain.decide()
    → Cerebellum.regulate()            [小脑: 感知融合 + 稳态调节]
    → RightBrain.predict()             [右脑: 直觉预测 + 质量估计]
    → DeliberationCouncil.deliberate() [审议委员会: 多角色辩论]
    → LawClassifier.classify()         [法则分类: 6条互斥法则]
    → LeftBrain.decide()
      → RuleEngine.evaluate()          [规则引擎: 确定性规则优先]
      → Scheduler.schedule()           [调度器: 7层漏斗]
        → selectViaRouter()            [委托 ModelRouter]
          → ModelPool.select()         [Thompson Sampling 最终决策 ← 三脑无法控制]
  → OrchestrationPlan (mode + nodes)
  → executeByPlan()
    → executeSingle()
      → processStream() → LLMAdapter.chat()
        → ModelRouter.select()         ← 又选一次！规划结果被丢弃
```

## 3. 发现的 6 个设计问题

### 3.1 模型选择发生两次，规划结果被丢弃

**位置**: `src/core/plan-executor.ts` — `executeSingle()`

规划阶段 ThreeBrain → Scheduler → `selectViaRouter()` 精心选出模型并注入 OrchestrationNode，
但执行阶段 `executeSingle()` 完全忽略节点中的模型信息，通过 `processStream()` 内部再次调用
`ModelRouter.select()`，Thompson Sampling 可能选出完全不同的模型。

只有 `executeWithConcreteNode()` 路径才真正使用规划选定的模型。

### 3.2 任务类型推断过于简单，复杂开发任务被误分类

**位置**: `src/core/model-router.ts` — `inferTaskType()`

使用关键词匹配：包含"写"/"创建"/"开发"等工具关键词就被分类为 `'tools'`，
但实际上软件架构设计、复杂系统开发需要 `'reasoning'` 级别的模型。

```
用户: "帮我写一个分布式任务调度系统"
→ 包含"写" → 被分为 'tools'
→ 'tools' 触发 requiredFeatures: ['toolCalling'] + maxCostPer1k: 5.0
→ GPT-4o、Claude 等强推理模型被排除
```

### 3.3 成本约束把强模型排除在外

**位置**: `src/core/model-router.ts` — `buildModelRequirement()`

```typescript
case 'tools':
  if (complexity === 'medium') {
    req.maxCostPer1k = 5.0;  // 把 GPT-4o、Claude 排除
  }
```

加上小脑负载调节：高负载时 `req.maxCostPer1k = avgCost * 0.5`，进一步限制强模型。

### 3.4 Cascade 策略先弱后强，关键任务浪费一轮

**位置**: `src/core/plan-executor.ts` — `executeCascade()`

先用 chat 模型（弱），quality >= 0.6 就直接返回。质量评估是纯启发式（长度+关键词匹配），
弱模型给出一个"看起来还行"的回答就通过了，真正的深层问题被忽略。

### 3.5 三脑没有"任务关键性"信号传递到模型选择

ThreeBrain 可以评估复杂度和新颖度，但没有 `criticality` 信号。
模型选择完全委托给 `ModelRouter.select(taskType)`，而 taskType 可能已被误分类。

### 3.6 Thompson Sampling 的探索机制在关键任务上浪费资源

冷启动保护给新模型加分，对于关键任务应该利用（exploitation）而非探索（exploration）。

## 4. 核心设计缺陷：Thompson Sampling 篡权

### 当前权力结构

```
ThreeBrain → 决定 mode（single/cascade/parallel）
ModelPool  → 决定具体模型（Thompson Sampling 独立决策）  ← 篡权
```

### Thompson Sampling 的本质问题

- **目标不同**: TS 优化"长期累积收益"，三脑需要"每个任务即时最优"
- **信息不同**: TS 只看 taskType + 历史统计，三脑有完整上下文（直觉/法则/稳态/审议）
- **不可控**: 三脑无法告诉 TS "这个任务必须用最强模型"

### 正确的权力结构

```
ThreeBrain → 决定 mode + 具体模型 + 降级策略（完全掌控）
  └─ 内部可参考 Thompson Sampling 的历史数据（作为信号，不是决策者）
```

## 5. 优化方案

### 5.1 核心改造：三脑完全掌控资源

#### 5.1.1 ModelPool 变为只读数据源

**文件**: `src/core/model-pool.ts`

新增三脑专用查询接口，暴露模型完整信息但不做决策：

```typescript
interface ModelQueryResult {
  id: string;
  displayName: string;
  tier: string;
  platform: string;
  capabilities: ModelProfile['capabilities'];
  costPer1kInput: number;
  costPer1kOutput: number;
  maxContextTokens: number;
  history: {
    taskSuccessRate: number;
    avgLatencyMs: number;
    totalCalls: number;
    avgQuality: number;
    confidence: number;
  };
  tsScore: number;       // 供参考，不是自动选择
  accessStatus: string;
  active: boolean;
}

queryForBrain(taskType: TaskType, filter?: {
  minReasoning?: number;
  requireToolCalling?: boolean;
  maxCost?: number;
  excludeIds?: string[];
}): ModelQueryResult[]
```

`select()` 方法保留但标记为内部方法，三脑不再调用它。

#### 5.1.2 Scheduler 直接选择模型

**文件**: `src/brain/left/scheduler.ts`

`selectViaRouter()` 改为 `selectModel()`，直接查询 ModelPool 数据，自己做最终选择：

```typescript
private async selectModel(signal, body, reason): Promise<ExecutionPlan> {
  const pool = this.router?.getPool();
  const criticality = signal.criticality ?? 'normal';

  // 三脑自己构建查询条件
  const filter = {};
  if (signal.taskType === 'reasoning') filter.minReasoning = 0.7;
  if (signal.taskType === 'tools') filter.requireToolCalling = true;
  if (criticality === 'high') filter.maxCost = undefined; // 关键任务不限成本

  const models = pool.queryForBrain(signal.taskType, filter);

  // 三脑自己排序 — 综合多个维度
  const scored = models.map(m => ({
    model: m,
    score: this.computeBrainScore(m, criticality, signal.taskType, body),
  }));
  scored.sort((a, b) => b.score - a.score);

  return this.buildPlanFromModel(scored[0].model, reason, signal);
}
```

三脑综合评分函数（不是 Thompson Sampling 的随机采样）：

```typescript
private computeBrainScore(model, criticality, taskType, body): number {
  let score = 0;

  // 历史质量分（权重最高）
  if (model.history.confidence > 0.3) {
    score += model.history.avgQuality * 40;
  }

  // 任务成功率
  score += model.history.taskSuccessRate * 25;

  // 关键性加权
  if (criticality === 'high') {
    score += (model.capabilities.reasoning ?? 0) * 20;
    const tierBonus = { premium: 15, standard: 10, budget: 5, free: 0 };
    score += tierBonus[model.tier] ?? 0;
  } else if (criticality === 'low') {
    score += Math.max(0, 10 - model.costPer1kInput * 5);
  }

  // 延迟惩罚
  score -= Math.min(10, model.history.avgLatencyMs / 3000);

  // 小脑状态调节
  if (body?.load > 80) score -= model.costPer1kInput * 3;
  if (body?.energy < 30) score += model.history.taskSuccessRate * 10;

  return score;
}
```

#### 5.1.3 PlanExecutor 尊重规划结果

**文件**: `src/core/plan-executor.ts`

`executeSingle()` 必须检查 `plan.selectedNodes` 中是否有具体模型：

```typescript
async function executeSingle(ctx, plan) {
  const node = plan.selectedNodes[0];
  if (node?.type === 'cloud_node' && node.provider && node.model) {
    return executeWithConcreteNode(ctx, node, plan.content);
  }
  // 仅当规划阶段没有具体模型时才重新选择
  const result = await ctx.processor.processStream(plan.content, ...);
  // ...
}
```

#### 5.1.4 Cascade 策略由三脑控制起始层级

```typescript
async function executeCascade(ctx, plan) {
  // 三脑已评估关键性 → 决定从哪一层开始
  if (plan.criticality === 'high' || plan.complexity === 'complex') {
    // 关键任务：直接用最强模型
    return await ctx.sys.llm.chat(..., { taskType: 'reasoning' });
  }
  // 非关键任务：先弱后强
  // ...
}
```

### 5.2 引入"任务关键性"信号

#### TaskSignal 扩展

**文件**: `src/core/agent-types.ts`

```typescript
interface TaskSignal {
  // ...existing fields...
  criticality: 'low' | 'normal' | 'high';
}
```

#### 关键性评估

**文件**: `src/core/perception-state.ts`

```typescript
function assessCriticality(content, intent): 'low' | 'normal' | 'high' {
  if (intent.category === 'complex_task' && content.length > 300) return 'high';
  if (content.length > 500 && /架构|系统|设计|重构|优化|实现|architecture|system|design|refactor|implement/i.test(content)) return 'high';
  if (content.length < 50 && intent.category === 'conversation') return 'low';
  return 'normal';
}
```

### 5.3 改进任务类型推断

**文件**: `src/core/model-router.ts`

```typescript
export function inferTaskType(content, context): TaskType {
  // 新增：复杂软件开发任务 → reasoning（不是 tools）
  const DEV_DESIGN_KEYWORDS = [
    '架构', '系统', '设计', '重构', '优化', '实现一个', '写一个',
    'architecture', 'system', 'design', 'refactor', 'implement', 'build a',
  ];
  const devScore = DEV_DESIGN_KEYWORDS.filter(k => lower.includes(k)).length;
  if (devScore >= 1 && content.length > 150) return 'reasoning';

  // 简单工具操作仍为 tools
  const toolScore = TOOL_KEYWORDS.filter(k => lower.includes(k)).length;
  if (toolScore >= 1 && content.length < 150) return 'tools';

  // ...其余逻辑
}
```

### 5.4 改进质量评估

**文件**: `src/core/plan-executor.ts`

```typescript
function evaluateQuality(answer, question): number {
  let score = 0.5;

  // 形式检查
  if (answer.length < 20) score -= 0.3;

  // 结构化检查
  if (/```[\s\S]*?```/.test(answer) && question.includes('代码')) score += 0.15;
  if (/\d+[.、)）]/.test(answer)) score += 0.1;
  if (/错误|异常|error|exception|fallback/i.test(answer)) score += 0.1;

  // 完整性检查
  const questionClauses = question.split(/[,，;；.。\n]+/).filter(s => s.trim().length > 3);
  const coveredClauses = questionClauses.filter(c => {
    const keywords = c.replace(/[^\w\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(w => w.length > 1);
    return keywords.some(w => answer.includes(w));
  });
  const completeness = questionClauses.length > 0 ? coveredClauses.length / questionClauses.length : 1;
  score += completeness * 0.2;

  return Math.max(0, Math.min(1, score));
}
```

### 5.5 Thompson Sampling 降级为评分参考

**文件**: `src/core/model-pool.ts`

```typescript
/** 获取 Thompson Sampling 分数（供三脑参考，不是自动选择） */
getThompsonScore(modelId: string, taskType: TaskType): number {
  const key = `${taskType}:${modelId}`;
  const params = this.tsParams.get(key);
  if (!params) return 0.5;
  return params.avgQuality;
}
```

## 6. 改造后的决策流程

```
用户输入: "帮我设计一个分布式任务调度系统"
  │
  ▼
collectPerceptionState()
  ├─ intent: complex_task (conf=0.85)
  ├─ domains: [code, architect]
  ├─ complexity: complex
  ├─ criticality: high              ← 新增
  └─ taskType: reasoning            ← 不再误分为 tools
  │
  ▼
ThreeBrain.decide()
  ├─ Cerebellum: bodyState { energy: 70, load: 40 }
  ├─ RightBrain: qualityEstimate=0.3, 命中"系统设计"原型
  ├─ Deliberation: proceed (conf=0.8)
  ├─ Law: #3 (创新任务，需要外部知识)
  └─ Scheduler.selectModel()
       ├─ novelty=0.7 → 需要强模型
       ├─ pool.queryForBrain('reasoning', { minReasoning: 0.7 })
       │   → [GPT-4o, Claude-3.5, DeepSeek-V3]
       ├─ computeBrainScore(GPT-4o, criticality='high') = 89.3
       ├─ computeBrainScore(Claude-3.5, criticality='high') = 86.7
       └─ 选择: GPT-4o (score=89.3)   ← 三脑自己的决策
  │
  ▼
OrchestrationPlan {
  mode: 'single',
  criticality: 'high',
  selectedNodes: [{
    id: 'openai/gpt-4o',
    provider: 'openai',
    model: 'gpt-4o',               ← 具体模型已确定
    type: 'cloud_node'
  }]
}
  │
  ▼
PlanExecutor.executeSingle()
  ├─ 检查 selectedNodes[0] → 有 provider/model
  └─ executeWithConcreteNode('openai', 'gpt-4o')  ← 直接使用
```

## 7. 改动清单

| 文件 | 改动 | 优先级 |
|------|------|--------|
| `src/core/model-pool.ts` | 新增 `queryForBrain()` 只读接口；`select()` 标记为内部方法 | P0 |
| `src/brain/left/scheduler.ts` | `selectViaRouter()` → `selectModel()`，直接查询+自己评分 | P0 |
| `src/core/plan-executor.ts` | `executeSingle()` 检查节点模型信息，不再重新选择 | P0 |
| `src/core/plan-executor.ts` | `executeCascade()` 根据 criticality 决定起始层级 | P1 |
| `src/core/agent-types.ts` | TaskSignal 增加 `criticality` 字段 | P1 |
| `src/core/perception-state.ts` | `assessCriticality()` 评估任务关键性 | P1 |
| `src/core/orchestrator.ts` | `decideCollaboration()` 传递 criticality | P1 |
| `src/core/model-router.ts` | `inferTaskType()` 区分工具执行和软件开发 | P1 |
| `src/core/llm.ts` | `chat()`/`streamChat()` 在有明确模型时跳过 `selectModel()` | P2 |

## 8. 预期效果

| 问题 | 修复前 | 修复后 |
|------|--------|--------|
| 模型选择一致性 | 规划选A，执行用B | 规划选A，执行用A |
| 复杂开发任务 | 被误分为tools，用弱模型 | 正确分为reasoning，用强模型 |
| 成本约束 | 强模型被排除 | 关键任务不限成本 |
| Cascade效率 | 先弱后强，浪费一轮 | 关键任务直接用强模型 |
| 质量评估 | 纯形式检查 | 形式+结构+完整性 |
| 探索/利用 | 关键任务也在探索 | 关键任务纯利用 |
| 权力结构 | Thompson Sampling 篡权 | 三脑完全掌控 |
