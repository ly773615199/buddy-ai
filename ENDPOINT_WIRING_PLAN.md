# 端点接入实施计划

> 目标：将 7 个已实现但未接入主流程的端点全部打通
> 生成日期：2026-05-11

---

## 总览

| # | 端点 | 优先级 | 当前状态 | 接入点 | 复杂度 |
|---|------|--------|----------|--------|--------|
| 1 | L2 意图扩展写回 | P0 | 只打日志，不写 NN | `ShadowBrain.applyProposal()` | 中 |
| 2 | World Model 训练 | P0 | 权重永不更新 | `ConvergenceLayer` 回调 | 高 |
| 3 | autoEvolve() 接入 | P1 | 仅测试调用 | `ShadowBrain.onInteraction()` | 低 |
| 4 | hypothesize() 接入 | P1 | 仅注释提及 | `ShadowBrain.onInteraction()` | 低 |
| 5 | distill() 接入 | P1 | 暴露但无人调用 | `ThreeBrain` 生命周期 | 低 |
| 6 | 小脑自适应层 | P2 | 三个模块未导入 Cerebellum | `Cerebellum` 构造函数 | 中 |
| 7 | CrossSessionLearner | P2 | 零引用 | `Subsystems` 初始化 | 中 |

---

## P0-1: L2 意图扩展写回

### 问题

`ShadowBrain.applyProposal()` 对 L2 `new_intent` 类型只做日志 + `markEvolving()`，不修改 NN 的意图类别数。

### 方案

L2 扩展不需要立即重训 NN，但需要：
1. **持久化新意图到意图注册表**（供右脑 predict 时使用）
2. **触发异步增量训练**（用新意图的样本微调分类头）
3. **标记为 pending，训练完成后激活**

### 改动文件

#### `src/brain/shadow/index.ts` — `applyProposal()`

```typescript
// L2: 意图扩展（记录 + 触发异步训练）
if (change.target === 'right' && change.action === 'expand' && proposal.type === 'new_intent') {
  const details = change.details as {
    newIntents: Array<{ label: string; description: string; estimatedSamples: number }>;
    expandFrom: number;
    expandTo: number;
  };

  // 1. 持久化到意图注册表
  this.stateManager.registerNewIntents(details.newIntents, details.expandFrom);

  // 2. 标记为 pending（训练完成后激活）
  this.stateManager.markEvolving(proposal.gap.fingerprint);

  // 3. 触发右脑增量训练（异步，不阻塞主流程）
  if (this.brain) {
    const rightBrain = this.brain.getRightBrain();
    if (rightBrain && typeof rightBrain.expandIntentHead === 'function') {
      // 收集相关样本
      const samples = ctx.samples.filter(s => s.labelIntent >= ctx.currentIntentCount);
      rightBrain.expandIntentHead(details.newIntents, samples).catch(err => {
        if (this.verbose) console.warn(`[ShadowBrain] 意图扩展训练失败: ${err.message}`);
      });
    }
  }

  if (this.verbose) {
    console.log(`[ShadowBrain] 意图扩展: ${details.expandFrom} → ${details.expandTo} (${details.newIntents.map(i => i.label).join(', ')}) [pending training]`);
  }
}
```

#### `src/brain/right/index.ts` — 新增 `expandIntentHead()`

```typescript
/**
 * 扩展意图分类头 — L2 写回入口
 * 新增意图类别并用相关样本增量训练
 */
async expandIntentHead(
  newIntents: Array<{ label: string; description: string }>,
  samples: Array<{ features: Float32Array; labelIntent: number }>,
): Promise<void> {
  const oldCount = this.model.getConfig().intentClasses;
  const newCount = oldCount + newIntents.length;

  // 扩展模型的分类头维度
  this.model.expandIntentClasses(newCount);

  // 用新样本增量训练（冻结 backbone，只训分类头）
  for (const sample of samples) {
    await this.learner.trainHeadOnly(sample.features, sample.labelIntent, newCount);
  }

  if (this.verbose) {
    console.log(`[RightBrain] 意图分类头扩展: ${oldCount} → ${newCount}`);
  }
}
```

#### `src/brain/shadow/state-manager.ts` — 新增 `registerNewIntents()`

```typescript
/** 注册新意图类别（持久化） */
registerNewIntents(intents: Array<{ label: string; description: string }>, baseIndex: number): void {
  const registry = this.loadIntentRegistry();
  for (let i = 0; i < intents.length; i++) {
    registry.set(baseIndex + i, {
      label: intents[i].label,
      description: intents[i].description,
      registeredAt: Date.now(),
      status: 'pending', // pending → active（训练完成后）
    });
  }
  this.saveIntentRegistry(registry);
}
```

### 验证

- 单元测试：模拟 L2 proposal → 验证 intent registry 写入 + `expandIntentHead` 调用
- 集成测试：触发 5+ 次同类失败 → 验证新意图出现在 NN 输出层

---

## P0-2: World Model 训练

### 问题

- `WorldModel` (MLP) 无 train 方法，权重随机初始化后永不更新
- `SceneWorldModel` 有数据生成器但无训练循环
- `ConvergenceLayer` 只写 ReplayBuffer 不触发训练

### 方案

在现有 `OnlineLearner` 基础上增加 World Model 训练路径：
1. `ConvergenceLayer` 汇聚的样本同时喂给 World Model
2. 定期（每 N 个样本或定时）触发 World Model 训练
3. 用 ReplayBuffer 的 (state, action, next_state) 三元组训练

### 改动文件

#### `src/brain/right/nn/world-model.ts` — 新增训练方法

```typescript
/**
 * 增量训练 — 用单个样本更新权重
 */
trainStep(
  state: Float32Array,
  action: ActionEncoding,
  nextState: Float32Array,
  spatialDelta: Float32Array,
  topologyLabel: number,
  learningRate = 0.001,
): void {
  // 前向传播
  const input = this.concatStateAction(state, action);
  const hidden = this.relu(this.linear(input, this.wTransition1, this.bTransition1));
  const predNext = this.linear(hidden, this.wTransition2, this.bTransition2);
  const predSpatial = this.linear(predNext, this.wSpatial, this.bSpatial);
  const predTopology = this.sigmoid(this.linear(predNext, this.wTopology, this.bTopology));

  // 计算损失梯度（MSE + BCE）
  const dNext = this.mseGrad(predNext, nextState);
  const dSpatial = this.mseGrad(predSpatial, spatialDelta);
  const dTopology = this.bceGrad(predTopology, topologyLabel);

  // 反向传播 + 权重更新
  this.backwardAndUpdate(input, hidden, dNext, dSpatial, dTopology, learningRate);
}

/**
 * 批量训练 — 从 ReplayBuffer 采样训练
 */
async trainBatch(buffer: WorldModelTrainingSample[], batchSize = 16): Promise<{ loss: number }> {
  const batch = this.sample(buffer, batchSize);
  let totalLoss = 0;

  for (const sample of batch) {
    const action = this.encodeAction(sample.action);
    const nextState = this.encodeScene(sample.scene_after);
    const spatialDelta = this.computeSpatialDelta(sample.scene_before, sample.scene_after);
    const topologyLabel = sample.risk_label;

    this.trainStep(
      this.encodeScene(sample.scene_before),
      action,
      nextState,
      spatialDelta,
      topologyLabel,
    );

    totalLoss += this.computeLoss(sample);
  }

  return { loss: totalLoss / batch.length };
}
```

#### `src/brain/right/scene/scene-world-model.ts` — 新增训练接口

```typescript
/**
 * 训练入口 — 从训练样本更新权重
 */
async train(samples: WorldModelTrainingSample[], epochs = 1): Promise<{ loss: number }> {
  let totalLoss = 0;
  for (let e = 0; e < epochs; e++) {
    for (const sample of samples) {
      // 前向 + 反向 + 更新
      const loss = this.trainStep(sample);
      totalLoss += loss;
    }
  }
  return { loss: totalLoss / (samples.length * epochs) };
}
```

#### `src/core/subsystems.ts` — 汇聚层回调增强

```typescript
// 汇聚层输出 → 右脑 ReplayBuffer + World Model 训练
this.convergenceLayer.setOnSample((sample) => {
  this.rightBrain?.ingestExternalSample(sample);

  // World Model: 收集训练样本
  if (sample.worldModelState && sample.worldModelAction) {
    this.worldModelBuffer.push({
      scene_before: sample.worldModelState,
      action: sample.worldModelAction,
      scene_after: sample.worldModelNextState!,
      completion: sample.outcome,
      risk_label: sample.labelQuality,
      timestamp: sample.timestamp,
      source: 'runtime',
    });
  }
});

// 定期训练 World Model（每 5 分钟 + 样本数 >= 32）
setInterval(async () => {
  if (this.worldModelBuffer.length >= 32) {
    const batch = this.worldModelBuffer.splice(0, 64);
    const sceneWM = this.rightBrain?.getSceneWorldModel();
    if (sceneWM) {
      const result = await sceneWM.train(batch);
      if (verbose) console.log(`[WorldModel] 训练完成: loss=${result.loss.toFixed(4)}, samples=${batch.length}`);
    }
  }
}, 5 * 60 * 1000);
```

#### `src/brain/right/scene/runtime-collector.ts` — 补全采集

```typescript
/**
 * 采集交互前后的场景快照 → 训练三元组
 */
captureBeforeAfter(
  before: SceneGraph,
  action: SceneAction,
  after: SceneGraph,
  outcome: boolean,
): WorldModelTrainingSample {
  return {
    scene_before: before,
    action,
    scene_after: after,
    completion: outcome,
    risk_label: this.computeRiskLabel(before, after, outcome),
    timestamp: Date.now(),
    source: 'runtime',
  };
}
```

### 验证

- 单元测试：构造 100 个合成样本 → trainBatch → 验证 loss 下降
- 集成测试：运行 10 轮对话 → 检查 WorldModel 权重是否有变化

---

## P1-3: autoEvolve() 接入

### 问题

`ExperienceEvolver.autoEvolve()` 仅在测试中调用。主流程通过 `ShadowBrain.onInteraction()` → `runEvolution()` 走单缺口路径，不会主动扫描所有经验做自动进化。

### 方案

在 `ShadowBrain.onInteraction()` 中增加定期触发 `autoEvolve` 的逻辑：
- 每 N 次交互后（如 50 次）触发一次全量扫描
- 或在空闲时段（idle）触发

### 改动文件

#### `src/brain/shadow/index.ts`

```typescript
// 新增计数器
private interactionCount = 0;
private readonly AUTO_EVOLVE_INTERVAL = 50;

async onInteraction(signal, outcome, confidence, bodyState) {
  this.interactionCount++;

  // 现有逻辑...
  await this.gapDetector.observe(signal, outcome, confidence);
  // ...

  // 定期触发 autoEvolve
  if (this.interactionCount % this.AUTO_EVOLVE_INTERVAL === 0) {
    this.runAutoEvolve().catch(err => {
      if (this.verbose) console.warn(`[ShadowBrain] autoEvolve 失败: ${err.message}`);
    });
  }
}

private async runAutoEvolve(): Promise<void> {
  if (!this.brain) return;
  const evolver = this.brain.getExperienceEvolver();
  if (!evolver) return;

  if (this.verbose) console.log('[ShadowBrain] 触发 autoEvolve 全量扫描');
  const events = await evolver.autoEvolve();

  if (events.length > 0 && this.verbose) {
    console.log(`[ShadowBrain] autoEvolve 产出 ${events.length} 个进化事件`);
  }
}
```

#### `src/brain/brain.ts` — BrainProvider 补全

```typescript
// 在 createBrainProvider() 中暴露 ExperienceEvolver
getExperienceEvolver: () => this.right?.getExperienceEvolver?.() ?? null,
```

### 验证

- 模拟 50 次交互 → 验证 `autoEvolve()` 被调用
- 检查进化事件日志中有 autoEvolve 产出

---

## P1-4: hypothesize() 接入

### 问题

`ExperienceEvolver.hypothesize()` 在失败时应自动生成改进假设，但从未被调用。

### 方案

在 `ShadowBrain.onInteraction()` 的失败路径中调用 `hypothesize()`。

### 改动文件

#### `src/brain/shadow/index.ts`

```typescript
async onInteraction(signal, outcome, confidence, bodyState) {
  // 现有逻辑...

  // 执行失败 → 生成假设
  if (!outcome.success) {
    this.runHypothesize(signal, outcome).catch(err => {
      if (this.verbose) console.warn(`[ShadowBrain] hypothesize 失败: ${err.message}`);
    });
  }
}

private async runHypothesize(signal, outcome): Promise<void> {
  if (!this.brain) return;
  const evolver = this.brain.getExperienceEvolver();
  if (!evolver) return;

  const hypotheses = await evolver.hypothesize();
  if (hypotheses.length > 0 && this.verbose) {
    console.log(`[ShadowBrain] 生成 ${hypotheses.length} 个假设`);
  }

  // 将假设事件接入 ConvergenceLayer（产生训练样本）
  for (const h of hypotheses) {
    this.convergenceLayer?.ingestEvolution({
      eventType: 'hypothesis',
      skillId: h.skillId ?? 'unknown',
      detail: h.description ?? 'auto-hypothesis',
    });
  }
}
```

### 验证

- 触发一次失败交互 → 检查 hypothesize() 被调用
- 检查 ConvergenceLayer 收到 hypothesis 事件

---

## P1-5: distill() 接入

### 问题

`PolicyDistiller.distill()` 将决策历史蒸馏为规则，但无人调用。`KnowledgeDistiller` 同理。

### 方案

在两个时机触发 distill：
1. **定期触发**：每 N 次决策后（如 100 次）
2. **空闲触发**：在 idle 行为中执行

### 改动文件

#### `src/brain/brain.ts`

```typescript
// 新增决策计数器
private decisionCount = 0;
private readonly DISTILL_INTERVAL = 100;

async decide(input, signal, resources): Promise<DecisionResult> {
  this.decisionCount++;

  // 现有逻辑...

  // 定期蒸馏
  if (this.decisionCount % this.DISTILL_INTERVAL === 0) {
    this.runDistill().catch(err => {
      if (this.verbose) console.warn(`[ThreeBrain] distill 失败: ${err.message}`);
    });
  }

  return result;
}

private async runDistill(): Promise<void> {
  if (this.verbose) console.log('[ThreeBrain] 触发策略蒸馏');
  const report = await this.left.distill();

  if (report.newRules > 0 && this.verbose) {
    console.log(`[ThreeBrain] 蒸馏完成: ${report.newRules} 新规则, ${report.prunedRules} 淘汰`);
  }

  // 同步触发右脑 KnowledgeDistiller
  const rightDistiller = this.right.getDistiller?.();
  if (rightDistiller) {
    await rightDistiller.distill();
  }
}
```

#### `src/core/agent.ts` — idle 触发

```typescript
// 在 setupIdleBehavior 或空闲回调中
if (this.sys.threeBrain) {
  this.sys.threeBrain.runDistill?.();
}
```

### 验证

- 模拟 100 次决策 → 验证 distill() 被调用
- 检查规则引擎新增蒸馏产出的规则

---

## P2-6: 小脑自适应层

### 问题

`RhythmAdaptor`、`HabitMemory`、`ErrorTuner` 三个模块实现完整，但 `Cerebellum` 主类不使用它们。

### 方案

在 `Cerebellum` 构造函数中初始化三个自适应模块，并在 MAPE-K 循环中接入。

### 改动文件

#### `src/brain/cerebellum/index.ts`

```typescript
import { RhythmAdaptor, type RhythmConfig } from './adaptive/rhythm.js';
import { HabitMemory, type HabitConfig } from './adaptive/habit.js';
import { ErrorTuner, type ErrorTunerConfig } from './adaptive/error-tuner.js';

export class Cerebellum {
  // 新增自适应模块
  readonly rhythm: RhythmAdaptor;
  readonly habits: HabitMemory;
  readonly errorTuner: ErrorTuner;

  constructor(config?: Partial<CerebellumConfig>, verbose = false) {
    // 现有初始化...

    // 自适应层
    this.rhythm = new RhythmAdaptor(config?.rhythm, verbose);
    this.habits = new HabitMemory(config?.habits, verbose);
    this.errorTuner = new ErrorTuner(config?.errorTuner, verbose);
  }

  /**
   * MAPE-K 循环增强版
   */
  regulate(event: BodyEvent): HomeostasisAction[] {
    const t0 = performance.now();

    // Monitor
    this.bodyState.updateFromEvent(event);
    this.motorControl.updateMood(this.bodyState.inferMood());

    // 自适应：错误阈值调节
    if (event.type === 'tool_result' || event.type === 'llm_error') {
      const errorType = event.data?.errorType ?? 'unknown';
      const severity = event.data?.severity ?? 'medium';
      this.errorTuner.recordError(errorType, severity);
    }

    // Analyze + Plan + Execute
    const filtered = this.homeostasis.regulate(this.bodyState.getState());

    // 自适应：节律调节
    const rhythmAdj = this.rhythm.onRegulate(this.bodyState.getState(), filtered);
    if (rhythmAdj) {
      // 应用节律调整（心跳频率、梦境间隔等）
      this.applyRhythmAdjustment(rhythmAdj);
    }

    // 自适应：习惯缓存检查
    const habitKey = this.habits.computeKey(event);
    if (habitKey) {
      const cached = this.habits.lookup(habitKey);
      if (cached && cached.confidence > 0.9) {
        // 命中习惯缓存，跳过完整链路
        if (this.verbose) console.log(`[Cerebellum] 习惯缓存命中: ${habitKey.slice(0, 30)}`);
        return cached.cachedActions;
      }
    }

    return filtered;
  }

  /**
   * 获取习惯缓存（供外部查询命中率）
   */
  getHabitStats() {
    return this.habits.getStats();
  }

  /**
   * 获取错误阈值配置（供 prompt 注入）
   */
  getErrorProfiles() {
    return this.errorTuner.getProfiles();
  }

  /**
   * 获取节律状态（供 idle 行为参考）
   */
  getRhythmState() {
    return this.rhythm.getState();
  }
}
```

#### `src/brain/cerebellum/index.ts` — Config 扩展

```typescript
export interface CerebellumConfig extends HomeostasisConfig {
  sensorFusion?: Partial<SensorFusionConfig>;
  motorControl?: Partial<MotorControlConfig>;
  rhythm?: Partial<RhythmConfig>;       // 新增
  habits?: Partial<HabitConfig>;         // 新增
  errorTuner?: Partial<ErrorTunerConfig>; // 新增
}
```

### 验证

- 单元测试：发送 tool_error 事件 → 验证 ErrorTuner 记录
- 单元测试：重复相同 pattern → 验证 HabitMemory 命中
- 集成测试：运行 1 小时 → 验证 RhythmAdaptor 调整心跳频率

---

## P2-7: CrossSessionLearner

### 问题

`CrossSessionLearner` 实现了 Thompson 参数跨会话持久化，但从未被实例化或使用。

### 方案

在 `Subsystems` 初始化时创建，接入 `ModelPool` 的反馈循环。

### 改动文件

#### `src/core/subsystems.ts`

```typescript
import { CrossSessionLearner } from './cross-session-learner.js';

// 在 Subsystems 类中
crossSession: CrossSessionLearner | null = null;

// 在 initializeAsync() 中
// 在 ModelPool 初始化之后
this.crossSession = new CrossSessionLearner(dbDir, sessionId, verbose);

// 接入 ModelPool 反馈
if (this.modelPool) {
  // 从全局参数初始化本地 Thompson
  const globalKeys = this.crossSession.getGlobalStats();
  if (verbose) console.log(`[CrossSession] 加载 ${globalKeys.totalKeys} 个全局参数`);

  // 反馈写入全局
  this.modelPool.setFeedbackCallback((taskType, modelId, success, latencyMs) => {
    this.crossSession?.reportOutcome(taskType, modelId, success, latencyMs);
  });
}
```

#### `src/core/cross-session-learner.ts` — 补全 `getGlobalStats()`

```typescript
/** 获取全局统计（已有，确认返回值完整） */
getGlobalStats(): { totalKeys: number; totalSamples: number } {
  let totalSamples = 0;
  for (const p of this.params.values()) {
    totalSamples += p.totalSamples;
  }
  return { totalKeys: this.params.size, totalSamples };
}
```

#### `src/core/model-pool.ts` — 新增反馈回调

```typescript
private feedbackCallback: ((taskType: string, modelId: string, success: boolean, latencyMs: number) => void) | null = null;

setFeedbackCallback(cb: (taskType: string, modelId: string, success: boolean, latencyMs: number) => void): void {
  this.feedbackCallback = cb;
}

// 在 recordFeedback 中调用
recordFeedback(taskType: string, modelId: string, success: boolean, latencyMs: number): void {
  // 现有逻辑...
  this.feedbackCallback?.(taskType, modelId, success, latencyMs);
}
```

### 验证

- 启动 → 停止 → 再启动 → 验证全局参数被加载
- 多次反馈 → 检查 `global-thompson.json` 更新

---

## 实施顺序

```
Week 1 (P0):
├── Day 1-2: P0-1 L2 意图扩展写回
│   ├── expandIntentHead() 实现
│   ├── applyProposal() 改造
│   └── 单元测试
├── Day 3-4: P0-2 World Model 训练
│   ├── WorldModel.trainStep() 实现
│   ├── SceneWorldModel.train() 实现
│   ├── ConvergenceLayer 回调增强
│   └── 单元测试
└── Day 5: 集成测试 P0 全链路

Week 2 (P1):
├── Day 1: P1-3 autoEvolve 接入
├── Day 2: P1-4 hypothesize 接入
├── Day 3: P1-5 distill 接入
├── Day 4: P1 集成测试
└── Day 5: 回归测试

Week 3 (P2):
├── Day 1-2: P2-6 小脑自适应层接入
├── Day 3: P2-7 CrossSessionLearner 接入
├── Day 4: 全链路集成测试
└── Day 5: 性能基准测试 + 文档更新
```

---

## 风险与注意事项

1. **World Model 训练性能**：CPU 训练需控制 batch size，避免阻塞主流程。建议异步 + 可中断。
2. **L2 意图扩展**：新增意图类别需要右脑模型支持动态扩展输出层，需确认 `OnlineLearner` 兼容。
3. **distill 规则冲突**：蒸馏产出的规则可能与现有规则冲突，需去重 + 优先级仲裁。
4. **CrossSession 并发**：多实例同时写入 `global-thompson.json` 需确认原子 rename 机制。
5. **小脑自适应层**：HabitMemory 缓存命中跳过完整链路，需确保不会跳过关键安全检查。

---

## 依赖关系图

```
P0-1 (L2 写回) ──→ P1-3 (autoEvolve)   [autoEvolve 可能产出 L2 proposals]
P0-2 (WM 训练) ──→ P1-4 (hypothesize)   [hypothesize 产出 WM 训练样本]
P1-5 (distill)  ──→ 独立
P2-6 (小脑)     ──→ 独立
P2-7 (跨会话)   ──→ 独立
```

P0 可先行，P1 不依赖 P2。
