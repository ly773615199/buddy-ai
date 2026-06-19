# 三脑决策的硬编码阈值问题与神经网络集成分析

> 文档版本: v1.0 | 日期: 2026-06-19
> 状态: 待实施
> 关联文档: THREE_BRAIN_RESOURCE_DECISION.md

## 1. 问题概述

三脑系统有 **23 处硬编码阈值决策**，分布在 7 个模块中。
这些阈值将连续的感知信号（置信度、新颖度、能量、负载）二值化，
导致决策出现"悬崖效应"——微小的数值差异导致完全不同的行为路径。

更关键的是：项目已实现完整的神经网络系统（IntuitionNet + GNN + WorldModel + PrototypeMemory），
但 NN 的输出被硬编码阈值"过滤"后才进入决策链路，**神经网络的连续信号被离散阈值截断**，
NN 的丰富信息被大幅损耗。

## 2. 硬编码阈值全景

### 2.1 感知阶段

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

**问题**: 字符数衡量复杂度，忽略语义密度。

#### inferTaskType — 关键词计数无权重
**文件**: `src/core/model-router.ts`

```
toolScore >= 1     → tools     (一个关键词就定性)
reasonScore >= 2   → reasoning
reasonScore >= 1 && length > 200 → reasoning  (又是 200 字符门槛)
```

**反例**:
- `"写一个分布式任务调度系统"` → 包含"写" → toolScore=1 → **tools** ← 应该是 reasoning

**问题**: "写一个系统"和"写一行日志"中的"写"权重应该完全不同。

#### mapTaskType — 硬编码类别映射
**文件**: `src/core/perception-state.ts`

```
debugging: 'tools'      ← 复杂死锁分析也是 tools
writing: 'domain'       ← 技术写作需要 reasoning
complex_task: 'domain'  ← 不是 reasoning
```

**问题**: 同一类别内的复杂度差异完全被忽略。

### 2.2 调度阶段

#### calcNovelty — 固定权重
**文件**: `src/brain/left/scheduler.ts`

```
familiarity = domainCoverage * 0.4 + maturity * 0.3 + intentCertainty * 0.3
```

**问题**: 权重固定。对于全新领域（domainCoverage=0），即使意图非常明确（intentCertainty=0.9），
新颖度仍为 0.73 → 触发"极高新颖度"路径。

#### 元认知阈值 — 二值化决策
**文件**: `src/brain/left/scheduler.ts`

```
quality < 0.3 → 强制 LLM（跳过所有经验路由）
quality < 0.6 → 经验 + LLM 验证
quality >= 0.6 → 正常路径
```

**反例**:
- quality=0.29 → **强制 LLM**
- quality=0.31 → 正常路径
- 右脑的直觉估计本身有大量噪声，0.29 和 0.31 的差异无意义

#### 新颖度路由 — 硬阈值悬崖
**文件**: `src/brain/left/scheduler.ts`

```
novelty >= 0.9 → 极高新颖度，强制 LLM
novelty < 0.7 && localConfidence >= 0.8 → 零 LLM，经验直连
novelty < 0.7 && localConfidence >= 0.5 → 经验 + LLM 验证
```

**反例**:
- novelty=0.89 → 正常路由
- novelty=0.91 → **强制 LLM**（0.02 的差异导致完全不同路径）
- localConfidence=0.79 → 经验 + LLM 验证
- localConfidence=0.81 → **零 LLM**（0.02 的差异跳过了 LLM 验证）

#### 小脑状态 — 悬崖效应
**文件**: `src/brain/left/scheduler.ts`

```
body.load > 80    → 强制降级到便宜模型
body.energy < 30  → 强制降级
body.confusionLevel > 70 → 强制用强模型
```

**反例**:
- load=79 → 正常路径
- load=81 → **强制降级**（2 的差异导致完全不同行为）
- energy=31 → 正常
- energy=29 → **降级**（2 的差异）

**问题**: load 从 60 到 100 应该是平滑过渡，不是在 80 处悬崖式切换。

### 2.3 审议阶段

#### 共识度过早退出
**文件**: `src/brain/deliberation/debate-engine.ts`

```
consensus >= 0.8 → 停止辩论
```

**问题**: 20% 的分歧可能是关键风险。共识度是 LLM 自评的，本身不可靠。

#### 风险校验的置信度悬崖
**文件**: `src/brain/deliberation/risk-validator.ts`

```
confidence < 0.4 → 标记风险（但 severity='medium'，不阻止执行）
```

**问题**: 0.39 和 0.41 的差异被放大为"有风险"和"无风险"。
而且 medium 风险不阻止执行，这个阈值实际没有作用。

#### 快速通道的模糊度阈值
**文件**: `src/brain/deliberation/council.ts`

```
ambiguityScore < 0.3 → 快速放行
```

**问题**: 0.29 和 0.31 的差异导致"跳过审议"和"完整审议"两个极端。

### 2.4 执行阶段

#### 质量评估的长度歧视
**文件**: `src/core/plan-executor.ts`

```
answer.length < 20 → score -= 0.3
answer.length < 50 → score -= 0.1
```

**反例**:
- `"1+1=?"` → 回答 `"2"` (1 字符) → quality = 0.2 → 触发 cascade 升级
- 回答 200 字废话但包含"2" → quality = 0.65 → 通过

**问题**: 短而精确的回答被惩罚，冗长但低质量的回答被奖励。

#### Cascade 升级阈值
**文件**: `src/core/plan-executor.ts`

```
quality >= 0.6 → 接受（不再升级）
quality >= 0.3 → 升级到 reasoning 模型
quality < 0.3 → 直接用 reasoning 模型
```

**反例**:
- 弱模型回答 quality=0.61 → 接受（可能遗漏了深层问题）
- 弱模型回答 quality=0.59 → 升级到强模型（多花一轮）

#### 延迟惩罚的阶梯断崖
**文件**: `src/brain/left/scheduler.ts`

```
latencyMs > 5000 → score *= 0.7
latencyMs > 2000 → score *= 0.85
```

**反例**: 4999ms → score=0.85, 5001ms → score=0.7（2ms 差异导致 15% 分差）

### 2.5 状态映射

#### 情绪映射的硬阈值
**文件**: `src/brain/cerebellum/body-state.ts`

```
energy > 70 && valence > 20 → energetic
energy < 30 → tired
joy > 60 → happy
anger > 50 → frustrated
confusionLevel > 60 → confused
focusLevel > 60 → thinking
```

**问题**: joy=59 → 不是 happy, joy=61 → happy。情绪是连续变化的，不应该在 60 处二值化。

## 3. 神经网络系统现状

项目已实现完整的 NN 系统，但未真正融入决策链路。

### 3.1 IntuitionNet（右脑 NN）

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

### 3.2 GNN 场景世界模型

**文件**: `src/brain/right/scene/gnn-layer.ts`

- **架构**: Message Passing GNN，2 层
- **用途**: 场景图推理，实体间关系建模
- **参数量**: N≤32 实体，CPU < 5ms

**当前用途**: 仅在 `imagineScene()` 中用于脑内构图预测，触发条件是"选择困难"（confidence < 0.7）。

### 3.3 World Model（世界模型）

**文件**: `src/brain/right/nn/world-model.ts`

- **架构**: MLP，潜空间预测（状态 + 动作 → 下一状态）
- **用途**: 心理模拟——预测动作后果
- **灵感**: World Models (2018) / DreamerV3 (2023)

**当前用途**: 仅在 `imagineScene()` 中使用，触发条件苛刻。

### 3.4 PrototypeMemory（原型记忆）

**文件**: `src/brain/right/prototype-memory.ts`

- **机制**: 从 intentHead 权重提取种子原型，在线学习更新
- **用途**: 双通道意图表征——NN + 原型匹配并行

**当前用途**: `predictDetailed()` 中用于增强工具概率（原型先验 + NN 概率融合）。

### 3.5 TernaryEngine（三进制引擎）

**文件**: `src/ternary/engine.ts`

- **架构**: Transformer，三进制权重（-1/0/+1），纯 CPU 整数运算
- **用途**: 本地文本生成，不需要 GPU

**当前用途**: 本地专家领域问答，与三脑决策链路分离。

### 3.6 在线学习系统

**文件**: `src/brain/right/training/online-learner.ts`

- **机制**: 每次决策后，用实际结果更新 NN 权重
- **包含**: LPR (Local Plasticity Rule) + Replay Buffer + Distillation

**当前问题**: NN 学到了模式，但输出被硬阈值截断，学习信号无法完整传递到决策层。

## 4. 核心矛盾：NN 连续信号 vs 硬阈值二值化

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
- NN 输出了 8 类意图的概率分布 → 但 Scheduler 只用 argmax（取最高一个）
- NN 输出了 32 个工具的概率 → 但 Scheduler 只用 >0.3 阈值过滤
- NN 输出了连续的质量预判 → 但 Scheduler 用 <0.3 / <0.6 二值化
- NN 输出了空间/场景概率 → 但只在极少数场景被使用

## 5. 改造方案：让 NN 驱动决策，而非被阈值截断

### 5.1 核心思路：阈值 → 连续函数

将所有硬阈值改为**连续衰减函数**，让 NN 的连续输出直接驱动决策权重。

#### 5.1.1 质量阈值 → Sigmoid 衰减

```typescript
// 当前（硬阈值）:
if (quality < 0.3) return 'force_llm';
if (quality < 0.6) return 'verify';

// 改造后（连续函数）:
const llmForceWeight = sigmoid((0.3 - quality) * 10);    // quality=0.29→0.56, quality=0.31→0.44
const verifyWeight = sigmoid((0.6 - quality) * 10);       // 平滑过渡
const directWeight = 1 - verifyWeight;                    // 互补
```

#### 5.1.2 小脑状态 → 线性衰减

```typescript
// 当前（悬崖）:
if (body.load > 80) { req.maxCostPer1k = avgCost * 0.5; }

// 改造后（渐进）:
const loadFactor = Math.max(0, 1 - body.load / 100);      // load=60→0.4, load=80→0.2, load=100→0
req.maxCostPer1k = baseCostLimit * (0.3 + 0.7 * loadFactor); // 平滑过渡
```

#### 5.1.3 新颖度 → 软路由权重

```typescript
// 当前（硬路由）:
if (novelty >= 0.9) return forceLLM();
if (novelty < 0.7 && confidence >= 0.8) return directExperience();

// 改造后（加权混合）:
const llmWeight = sigmoid((novelty - 0.7) * 8);           // 0.5→0.12, 0.7→0.5, 0.9→0.88
const expWeight = 1 - llmWeight;
const plan = blendPlans(llmPlan, expPlan, llmWeight, expWeight);
```

### 5.2 NN 输出 → 决策信号（而非被截断）

#### 5.2.1 用 NN 完整概率分布替代 argmax

```typescript
// 当前:
const intent = argmax(output.intentProbs);  // 丢弃其他 7 个概率

// 改造后:
const intentDistribution = output.intentProbs;  // 完整 8 维分布
// 混合意图：当 top1 和 top2 概率接近时，考虑混合策略
const top1 = sorted[0];
const top2 = sorted[1];
if (top1.prob - top2.prob < 0.15) {
  // 两个意图都很可能 → 混合工具集
  suggestedTools = [...intentTools[top1.label], ...intentTools[top2.label]];
}
```

#### 5.2.2 用 NN qualityScore 直接驱动 cascade 深度

```typescript
// 当前:
const quality = evaluateQuality(answer, question);  // 启发式打分
if (quality >= 0.6) return answer;

// 改造后:
const nnQuality = output.qualityScore;  // NN 的连续质量预判
const heuristicQuality = evaluateQuality(answer, question);
const blendedQuality = nnQuality * 0.6 + heuristicQuality * 0.4;  // NN + 启发式混合
// cascade 深度由质量连续决定，不是 3 个硬台阶
const cascadeDepth = Math.max(0, Math.min(3, Math.round((1 - blendedQuality) * 3)));
```

#### 5.2.3 用 NN 工具概率直接构建执行计划

```typescript
// 当前:
const tools = output.toolProbs.filter(p => p > 0.3);  // 阈值截断

// 改造后:
const toolScores = output.toolProbs
  .map((prob, i) => ({ name: toolMap[i], score: prob }))
  .sort((a, b) => b.score - a.score);
// 用概率加权构建工具链，不是二值过滤
const toolChain = buildToolChain(toolScores, signal);
```

### 5.3 让 NN 参与模型选择

当前模型选择是 Thompson Sampling（独立于 NN 的统计系统）。
应该让 NN 的质量预判直接影响模型选择。

```typescript
// NN 预判这个任务需要多强的模型
const requiredStrength = 1 - output.qualityScore;  // 质量预判越低 → 需要越强的模型

// 在 ModelPool 中按 strength 排序
const models = pool.queryForBrain(taskType);
const selected = models.reduce((best, m) => {
  const strength = computeModelStrength(m);  // tier + reasoning + params
  const distance = Math.abs(strength - requiredStrength);
  return distance < best.distance ? { model: m, distance } : best;
}, { model: models[0], distance: Infinity }).model;
```

### 5.4 World Model 参与决策验证

当前 WorldModel 只在"选择困难"时触发。应该让它成为决策的标准环节。

```typescript
// 对 top-k 候选方案做心理模拟
const candidates = plan.selectedNodes.slice(0, 3);
const simulations = candidates.map(node => {
  const action = encodeAction(node);
  return worldModel.predict(currentState, action);
});
// 选预测收益最高的方案
const best = simulations.reduce((a, b) =>
  a.confidence > b.confidence ? a : b
);
```

## 6. 改动清单

| 文件 | 改动 | 优先级 |
|------|------|--------|
| `src/brain/left/scheduler.ts` | 所有硬阈值改为连续函数 | P0 |
| `src/core/perception-state.ts` | assessComplexity 语义化 | P0 |
| `src/core/model-router.ts` | inferTaskType 加权化 | P0 |
| `src/core/plan-executor.ts` | quality 评估混合 NN 分数 | P1 |
| `src/brain/deliberation/debate-engine.ts` | 共识度改为软退出 | P1 |
| `src/brain/cerebellum/body-state.ts` | 情绪映射改为连续函数 | P1 |
| `src/brain/right/features/decoder.ts` | 输出完整概率分布，不截断 | P1 |
| `src/brain/right/index.ts` | predict 输出增加决策权重建议 | P2 |
| `src/core/model-pool.ts` | NN qualityScore 接入模型选择 | P2 |
| `src/brain/right/nn/world-model.ts` | 标准决策验证环节 | P2 |

## 7. 预期效果

| 维度 | 改造前 | 改造后 |
|------|--------|--------|
| 决策连续性 | 23 处硬阈值悬崖 | 全部平滑过渡 |
| NN 利用率 | argmax + 阈值截断，信息损耗 > 70% | 完整概率分布驱动决策 |
| 模型选择 | Thompson Sampling 自治 | NN 质量预判 + 池数据联合决策 |
| 质量评估 | 纯启发式（长度+关键词）| NN + 启发式混合 |
| 小脑状态 | load>80 一刀切 | 负载越高越倾向便宜模型（渐进）|
| World Model | 仅"选择困难"时触发 | 标准决策验证环节 |
| 共识度过早退出 | >= 0.8 硬停 | 持续评估分歧重要性 |
