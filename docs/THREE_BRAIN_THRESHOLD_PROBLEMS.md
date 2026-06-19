# 三脑决策问题分析与自学习神经网络决策方案

> 文档版本: v2.0 | 日期: 2026-06-19
> 状态: 待实施
> 关联文档: THREE_BRAIN_RESOURCE_DECISION.md
> 设计原则: **不要并行竞争，要自我学习的神经网络决策**

## 1. 设计原则

### 1.1 不要什么

**不要并行竞争架构**（DISPATCH_REFORM_PLAN.md 中的方案）：

```
用户输入 → 4 个模块并行出方案 → 裁决器选最优 → 执行
          ├─ 组装引擎方案 A
          ├─ NN 方案 B
          ├─ 经验图谱方案 C
          └─ LLM 方案 D
```

这个方案的问题：
- **延迟叠加**: 4 个模块并行，最慢的（LLM 2-3s）决定总延迟
- **资源浪费**: 90% 的任务只需 1 个模块，其余 3 个白跑
- **裁决悖论**: Arbiter 选最优方案本身就是决策问题，又需要一个 NN/规则
- **学习信号稀释**: 4 个模块各出方案，只用 1 个，其他 3 个的学习信号浪费
- **复杂度爆炸**: 需要新增 5 个模块（Coordinator + Calibrator + Collector + Arbiter + FeasibilityChecker）

### 1.2 要什么

**一个可以自我学习的神经网络决策系统**。核心链路：

```
用户输入 → 特征编码 → NN 前向推理 → 直接输出决策 → 执行
                                    ↑                      │
                                    └──── 反馈更新权重 ←────┘
```

NN 同时做所有决策（意图分类 + 工具选择 + 模型选择 + 质量预判），
执行结果回来后用实际 outcome 更新权重，越用越准。

### 1.3 为什么这个更好

| 维度 | 并行竞争 | 自学习 NN |
|------|----------|-----------|
| 延迟 | 2-3s（等 LLM）| <5ms（NN 推理）|
| 资源 | 4 个模块全跑 | 1 个 NN |
| 学习 | 无（裁决器不学习）| 每次执行都更新权重 |
| 复杂度 | 5 个新模块 | 修 3 个断裂点 |
| 演进 | 需要手动调裁决规则 | 自动从数据中学习 |

## 2. 问题概述

三脑系统有 **23 处硬编码阈值决策**，分布在 7 个模块中。
这些阈值将连续的感知信号（置信度、新颖度、能量、负载）二值化，
导致决策出现"悬崖效应"——微小的数值差异导致完全不同的行为路径。

更关键的是：项目已实现完整的神经网络系统（IntuitionNet + GNN + WorldModel + PrototypeMemory），
但 NN 的输出被硬编码阈值"过滤"后才进入决策链路，**神经网络的连续信号被离散阈值截断**，
NN 的丰富信息被大幅损耗。

## 3. 三个核心断裂点

### 断裂 1: NN 输出 → 决策（被硬阈值截断）

```
NN 输出:  qualityEstimate = 0.31 (连续值，包含丰富信息)
              │
              ▼
硬阈值:   quality < 0.3 ? ──── 是 → 强制 LLM
              │
              否 → 正常路径
              │
              ▼
决策:     完全不同的行为路径（0.31 vs 0.29 的差异被无限放大）
```

**NN 的能力被浪费了**:
- NN 输出了 8 类意图的概率分布 → Scheduler 只用 argmax（丢弃其他 7 个）
- NN 输出了 32 个工具的概率 → Scheduler 只用 >0.3 阈值过滤
- NN 输出了连续的质量预判 → Scheduler 用 <0.3 / <0.6 二值化
- NN 输出了空间/场景概率 → 只在极少数场景被使用

### 断裂 2: 执行结果 → 学习（信号稀疏）

OnlineLearner 已经实现了完整的在线学习管线（LPR + Replay Buffer + Distillation），
但学习信号来源太少：
- 只有 `feedback()` 被调用时才收集样本
- 质量评估是启发式的（长度+关键词），不是基于实际效果
- NN 的 loss 下降了，但决策层不听 NN 的，学习信号被浪费

### 断裂 3: NN → 模型选择（被 Thompson Sampling 篡权）

模型选择完全由 Thompson Sampling（ModelPool.select()）控制：
- NN 预判了质量分数 → 但不参与模型选择
- Thompson Sampling 用自己的 alpha/beta 参数独立决策
- 三脑对模型选择没有任何控制力

## 4. 硬编码阈值全景（23 处）

### 4.1 感知阶段

#### assessComplexity — 长度 ≠ 复杂度
**文件**: `src/core/perception-state.ts`

```
content.length > 200 → complex
content.length > 80  → medium
否则 → simple
```

**反例**:
- `"帮我用 Rust 写一个分布式 Raft 共识算法"` (21 字符) → **simple** ← 荒谬
- `"你好呀，我最近在学编程，想了解一下 Python 和 JavaScript 的区别，能帮我对比一下吗？顺便推荐一些学习资源"` (81 字符) → **medium** ← 其实是简单闲聊

#### inferTaskType — 关键词计数无权重
**文件**: `src/core/model-router.ts`

```
toolScore >= 1     → tools     (一个关键词就定性)
reasonScore >= 2   → reasoning
reasonScore >= 1 && length > 200 → reasoning
```

**反例**: `"写一个分布式任务调度系统"` → 包含"写" → **tools** ← 应该是 reasoning

#### mapTaskType — 硬编码类别映射
**文件**: `src/core/perception-state.ts`

```
debugging: 'tools'      ← 复杂死锁分析也是 tools
writing: 'domain'       ← 技术写作需要 reasoning
complex_task: 'domain'  ← 不是 reasoning
```

### 4.2 调度阶段

#### calcNovelty — 固定权重
**文件**: `src/brain/left/scheduler.ts`

```
familiarity = domainCoverage * 0.4 + maturity * 0.3 + intentCertainty * 0.3
```

**问题**: 权重固定。全新领域（domainCoverage=0）+ 意图明确（intentCertainty=0.9）→ 新颖度 0.73 → 触发"极高新颖度"路径。

#### 元认知阈值 — 二值化决策
**文件**: `src/brain/left/scheduler.ts`

```
quality < 0.3 → 强制 LLM（跳过所有经验路由）
quality < 0.6 → 经验 + LLM 验证
quality >= 0.6 → 正常路径
```

**反例**: quality=0.29 → 强制 LLM, quality=0.31 → 正常路径。右脑直觉估计本身有大量噪声。

#### 新颖度路由 — 硬阈值悬崖
**文件**: `src/brain/left/scheduler.ts`

```
novelty >= 0.9 → 极高新颖度，强制 LLM
novelty < 0.7 && localConfidence >= 0.8 → 零 LLM，经验直连
novelty < 0.7 && localConfidence >= 0.5 → 经验 + LLM 验证
```

**反例**: novelty=0.89→正常, novelty=0.91→强制 LLM（0.02 差异）

#### 小脑状态 — 悬崖效应
**文件**: `src/brain/left/scheduler.ts`

```
body.load > 80    → 强制降级到便宜模型
body.energy < 30  → 强制降级
body.confusionLevel > 70 → 强制用强模型
```

**反例**: load=79→正常, load=81→强制降级（2 的差异）

### 4.3 审议阶段

#### 共识度过早退出
**文件**: `src/brain/deliberation/debate-engine.ts`

```
consensus >= 0.8 → 停止辩论
```

#### 风险校验的置信度悬崖
**文件**: `src/brain/deliberation/risk-validator.ts`

```
confidence < 0.4 → 标记风险（但 severity='medium'，不阻止执行）
```

#### 快速通道的模糊度阈值
**文件**: `src/brain/deliberation/council.ts`

```
ambiguityScore < 0.3 → 快速放行
```

### 4.4 执行阶段

#### 质量评估的长度歧视
**文件**: `src/core/plan-executor.ts`

```
answer.length < 20 → score -= 0.3
answer.length < 50 → score -= 0.1
```

**反例**: `"1+1=?"` → 回答 `"2"` (1 字符) → quality=0.2 → 触发 cascade 升级

#### Cascade 升级阈值
**文件**: `src/core/plan-executor.ts`

```
quality >= 0.6 → 接受
quality >= 0.3 → 升级到 reasoning 模型
quality < 0.3 → 直接用 reasoning 模型
```

#### 延迟惩罚的阶梯断崖
**文件**: `src/brain/left/scheduler.ts`

```
latencyMs > 5000 → score *= 0.7
latencyMs > 2000 → score *= 0.85
```

**反例**: 4999ms→0.85, 5001ms→0.7（2ms 差异 15% 分差）

### 4.5 状态映射

#### 情绪映射的硬阈值
**文件**: `src/brain/cerebellum/body-state.ts`

```
energy > 70 && valence > 20 → energetic
energy < 30 → tired
joy > 60 → happy
anger > 50 → frustrated
confusionLevel > 60 → confused
```

## 5. 神经网络系统现状

项目已实现完整的 NN 系统，但未真正融入决策链路。

### 5.1 IntuitionNet（右脑 NN）

**文件**: `src/brain/right/nn/model.ts`

- **架构**: Embedding → Encoder Block × 2 → 池化 → 5 个输出头
- **参数量**: ~300K 参数，int8 量化后 ~300KB
- **推理速度**: CPU < 5ms
- **输出头**:
  - `intentProbs` — 8 类意图概率分布
  - `toolProbs` — 32 个工具概率分布
  - `qualityScore` — 质量预判 (0-1)
  - `spatialProbs` — 空间位置概率
  - `sceneProbs` — 场景节点概率

**当前用途**:
- `predict()` → 输出 IntuitionSignal → 被 Scheduler 的硬阈值二值化使用
- `predictDetailed()` → 输出工具概率 → 仅用于 Thompson Sampling 的先验注入

### 5.2 GNN 场景世界模型

**文件**: `src/brain/right/scene/gnn-layer.ts`

- **架构**: Message Passing GNN，2 层
- **用途**: 场景图推理，实体间关系建模
- **当前**: 仅在 `imagineScene()` 中用于脑内构图预测，触发条件苛刻

### 5.3 World Model（世界模型）

**文件**: `src/brain/right/nn/world-model.ts`

- **架构**: MLP，潜空间预测（状态 + 动作 → 下一状态）
- **当前**: 仅在 `imagineScene()` 中使用，触发条件苛刻

### 5.4 PrototypeMemory（原型记忆）

**文件**: `src/brain/right/prototype-memory.ts`

- **机制**: 从 intentHead 权重提取种子原型，在线学习更新
- **当前**: `predictDetailed()` 中用于增强工具概率

### 5.5 在线学习系统

**文件**: `src/brain/right/training/online-learner.ts`

- **机制**: LPR (Local Plasticity Rule) + Replay Buffer + Distillation
- **当前问题**: NN 学到了模式，但输出被硬阈值截断，学习信号无法完整传递到决策层

## 6. 改造方案：自学习神经网络决策

### 6.1 总体架构

```
用户输入
  │
  ▼
特征编码 (encodeFeatures)
  ├─ TaskSignal (意图/领域/复杂度)
  ├─ ResourceState (预算/模型数/本地覆盖)
  ├─ BodyState (能量/负载/困惑度)
  └─ 历史上下文 (对话阶段/经验命中)
  │
  ▼
IntuitionNet.forward()          ← 一次推理，输出所有决策信号
  ├─ intentProbs[8]             → 意图分类
  ├─ toolProbs[32]              → 工具选择
  ├─ qualityScore               → 质量预判 → 模型选择 + cascade 深度
  ├─ spatialProbs[6]            → 空间位置
  └─ sceneProbs[32]             → 场景节点
  │
  ▼
连续决策层（无硬阈值）           ← 用 Sigmoid/线性函数，不用 if-else
  ├─ intentProbs → 混合意图策略
  ├─ toolProbs → 概率加权工具链
  ├─ qualityScore → 模型强度匹配 + cascade 深度
  └─ BodyState → 渐进成本调节
  │
  ▼
执行 → 收集 outcome
  ├─ 实际质量 (用户反馈/任务成功)
  ├─ 实际延迟
  └─ 实际成本
  │
  ▼
OnlineLearner.update()          ← 每次执行都更新 NN 权重
  ├─ 用 outcome 计算 loss
  ├─ LPR 防遗忘
  └─ Replay Buffer 稳定训练
```

### 6.2 修复断裂 1: NN 输出 → 连续决策层

**核心**: 把 23 处硬阈值全部改为 Sigmoid/线性连续函数。

#### 6.2.1 质量阈值 → Sigmoid 衰减

```typescript
// 当前（硬阈值）:
if (quality < 0.3) return 'force_llm';
if (quality < 0.6) return 'verify';

// 改造后（连续函数）:
const llmForceWeight = sigmoid((0.3 - quality) * 10);    // quality=0.29→0.56, quality=0.31→0.44
const verifyWeight = sigmoid((0.6 - quality) * 10);       // 平滑过渡
const directWeight = 1 - verifyWeight;                    // 互补
```

#### 6.2.2 小脑状态 → 线性衰减

```typescript
// 当前（悬崖）:
if (body.load > 80) { req.maxCostPer1k = avgCost * 0.5; }

// 改造后（渐进）:
const loadFactor = Math.max(0, 1 - body.load / 100);
req.maxCostPer1k = baseCostLimit * (0.3 + 0.7 * loadFactor);
```

#### 6.2.3 新颖度 → 软路由权重

```typescript
// 当前（硬路由）:
if (novelty >= 0.9) return forceLLM();

// 改造后（加权混合）:
const llmWeight = sigmoid((novelty - 0.7) * 8);
const expWeight = 1 - llmWeight;
const plan = blendPlans(llmPlan, expPlan, llmWeight, expWeight);
```

#### 6.2.4 用 NN 完整概率分布替代 argmax

```typescript
// 当前:
const intent = argmax(output.intentProbs);  // 丢弃其他 7 个概率

// 改造后:
const intentDistribution = output.intentProbs;
const top1 = sorted[0], top2 = sorted[1];
if (top1.prob - top2.prob < 0.15) {
  // 混合意图 → 混合工具集
  suggestedTools = [...intentTools[top1.label], ...intentTools[top2.label]];
}
```

#### 6.2.5 用 NN qualityScore 直接驱动模型选择和 cascade

```typescript
// NN 预判需要多强的模型
const requiredStrength = 1 - output.qualityScore;

// 在 ModelPool 中按 strength 匹配
const models = pool.queryForBrain(taskType);
const selected = models.reduce((best, m) => {
  const strength = computeModelStrength(m);
  const distance = Math.abs(strength - requiredStrength);
  return distance < best.distance ? { model: m, distance } : best;
}, { model: models[0], distance: Infinity }).model;

// cascade 深度由质量连续决定
const cascadeDepth = Math.max(0, Math.min(3, Math.round((1 - output.qualityScore) * 3)));
```

#### 6.2.6 用 NN 工具概率直接构建执行计划

```typescript
// 当前: 阈值截断
const tools = output.toolProbs.filter(p => p > 0.3);

// 改造后: 概率加权
const toolScores = output.toolProbs
  .map((prob, i) => ({ name: toolMap[i], score: prob }))
  .sort((a, b) => b.score - a.score);
const toolChain = buildToolChain(toolScores, signal);
```

### 6.3 修复断裂 2: 执行结果 → 在线学习

**核心**: 每次执行都收集样本，用真实 outcome 更新 NN 权重。

```typescript
// plan-executor.ts — 执行完成后
async function executeWithLearning(ctx, plan) {
  const result = await execute(ctx, plan);
  
  // 收集学习样本
  const sample: TrainingSample = {
    input: encodeFeatures({ signal, resources, body }),
    // 用实际 outcome 作为训练目标（不是启发式打分）
    intentLabel: actualIntentCategory,
    toolLabels: actualToolsUsed,
    qualityLabel: computeActualQuality(result),  // 基于任务成功/用户反馈
    outcome: {
      success: result.success,
      latencyMs: result.latencyMs,
      costEstimate: result.costEstimate,
    },
  };
  
  // 送入 OnlineLearner 更新权重
  ctx.sys.right.learner.collectSample(sample);
  
  return result;
}

// 真实质量评估（替代启发式）
function computeActualQuality(result): number {
  let score = 0;
  // 任务是否成功完成
  if (result.success) score += 0.4;
  // 工具调用是否全部成功
  if (result.toolCalls.every(tc => tc.success)) score += 0.2;
  // 是否有用户正面反馈
  if (result.userFeedback === 'good') score += 0.3;
  // 延迟是否在合理范围
  if (result.latencyMs < 5000) score += 0.1;
  return Math.min(1, score);
}
```

### 6.4 修复断裂 3: NN → 模型选择（替代 Thompson Sampling）

**核心**: NN 的 qualityScore 直接决定模型强度，Thompson Sampling 降级为历史数据参考。

```typescript
// model-pool.ts — 新增三脑专用查询接口
queryForBrain(taskType: TaskType, filter?: {
  minReasoning?: number;
  requireToolCalling?: boolean;
  maxCost?: number;
  excludeIds?: string[];
}): ModelQueryResult[]

// scheduler.ts — 三脑自己选模型
private async selectModel(signal, body, reason): Promise<ExecutionPlan> {
  const pool = this.router?.getPool();
  const criticality = signal.criticality ?? 'normal';

  // 根据任务类型和关键性构建查询
  const filter = {};
  if (signal.taskType === 'reasoning') filter.minReasoning = 0.7;
  if (criticality === 'high') filter.maxCost = undefined; // 关键任务不限成本

  const models = pool.queryForBrain(signal.taskType, filter);

  // 三脑综合评分（不是 Thompson Sampling 随机采样）
  const scored = models.map(m => ({
    model: m,
    score: this.computeBrainScore(m, criticality, signal.taskType, body),
  }));
  scored.sort((a, b) => b.score - a.score);

  return this.buildPlanFromModel(scored[0].model, reason, signal);
}

// 三脑的综合评分函数
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

  // 小脑状态渐进调节
  if (body?.load > 80) score -= model.costPer1kInput * 3;
  if (body?.energy < 30) score += model.history.taskSuccessRate * 10;

  return score;
}
```

Thompson Sampling 降级为评分参考：

```typescript
// model-pool.ts — Thompson Sampling 变为评分函数
getThompsonScore(modelId: string, taskType: TaskType): number {
  const key = `${taskType}:${modelId}`;
  const params = this.tsParams.get(key);
  if (!params) return 0.5;
  return params.avgQuality;  // 返回历史质量分，不采样
}
```

### 6.5 TaskSignal 扩展：关键性信号

```typescript
// agent-types.ts
interface TaskSignal {
  // ...existing fields...
  criticality: 'low' | 'normal' | 'high';
}

// perception-state.ts
function assessCriticality(content, intent): 'low' | 'normal' | 'high' {
  if (intent.category === 'complex_task' && content.length > 300) return 'high';
  if (content.length > 500 && /架构|系统|设计|重构|优化|实现|architecture|system|design|refactor|implement/i.test(content)) return 'high';
  if (content.length < 50 && intent.category === 'conversation') return 'low';
  return 'normal';
}
```

### 6.6 PlanExecutor 尊重规划结果

```typescript
// plan-executor.ts
async function executeSingle(ctx, plan) {
  // 检查规划阶段是否已选定具体模型
  const node = plan.selectedNodes[0];
  if (node?.type === 'cloud_node' && node.provider && node.model) {
    return executeWithConcreteNode(ctx, node, plan.content);
  }
  // 仅当没有具体模型时才重新选择
  const result = await ctx.processor.processStream(plan.content, ...);
  // ...
}
```

### 6.7 Cascade 策略由 NN 控制

```typescript
// plan-executor.ts
async function executeCascade(ctx, plan) {
  // NN 的 qualityScore 决定起始层级
  const nnQuality = plan.nnQualityScore ?? 0.5;
  
  if (nnQuality < 0.3) {
    // NN 预判质量很低 → 直接用最强模型
    return await ctx.sys.llm.chat(..., { taskType: 'reasoning' });
  }
  
  if (nnQuality < 0.6) {
    // NN 预判质量中等 → 先用中等模型，验证后决定
    const result = await ctx.sys.llm.chat(..., { taskType: 'tools' });
    const actualQuality = computeActualQuality(result);
    if (actualQuality < 0.5) {
      return await ctx.sys.llm.chat(..., { taskType: 'reasoning' });
    }
    return result;
  }
  
  // NN 预判质量高 → 直接用当前模型
  return await ctx.sys.llm.chat(..., { taskType: 'chat' });
}
```

## 7. 改动清单

| 文件 | 改动 | 优先级 |
|------|------|--------|
| `src/brain/left/scheduler.ts` | 所有硬阈值改为连续函数；新增 `selectModel()` + `computeBrainScore()` | P0 |
| `src/core/model-pool.ts` | 新增 `queryForBrain()` 只读接口；Thompson Sampling 降级为评分参考 | P0 |
| `src/core/plan-executor.ts` | `executeSingle()` 检查节点模型；`executeCascade()` 由 NN qualityScore 控制 | P0 |
| `src/core/perception-state.ts` | `assessComplexity` 语义化；新增 `assessCriticality()` | P1 |
| `src/core/model-router.ts` | `inferTaskType` 加权化 | P1 |
| `src/core/agent-types.ts` | TaskSignal 增加 `criticality` 字段 | P1 |
| `src/brain/right/features/decoder.ts` | 输出完整概率分布，不截断 | P1 |
| `src/brain/deliberation/debate-engine.ts` | 共识度改为软退出 | P1 |
| `src/brain/cerebellum/body-state.ts` | 情绪映射改为连续函数 | P1 |
| `src/brain/right/index.ts` | predict 输出增加 `criticality` + 决策权重建议 | P2 |
| `src/brain/right/nn/world-model.ts` | 标准决策验证环节 | P2 |

## 8. 预期效果

| 维度 | 改造前 | 改造后 |
|------|--------|--------|
| 决策方式 | 23 处硬阈值 if-else | NN 连续输出 + Sigmoid 平滑 |
| NN 利用率 | argmax + 阈值截断，信息损耗 > 70% | 完整概率分布驱动决策 |
| 模型选择 | Thompson Sampling 自治 | NN qualityScore + 三脑综合评分 |
| 学习能力 | 学了但决策层不听 | 每次执行都更新，决策直接用 NN 输出 |
| 质量评估 | 纯启发式（长度+关键词）| 基于真实 outcome 的在线学习 |
| 小脑状态 | load>80 一刀切 | 负载越高越倾向便宜模型（渐进）|
| 延迟 | 硬阈值判断 + 可能多轮 cascade | NN 直接输出，<5ms |
| 演进 | 手动调阈值 | 自动从数据中学习最优策略 |
