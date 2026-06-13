# ⚡ 定时机制自适应优化计划

> 生成时间：2026-05-11
> 目标：将 World Model 训练、autoEvolve、distill 三个固定间隔机制改为事件驱动 + 自适应 + 效果门控

---

## 问题总结

| 机制 | 当前数字 | 核心缺陷 |
|------|----------|----------|
| World Model 训练 | 每 5 分钟，≥16 条 | 固定间隔不考虑负载；32 条只训 8 条浪费；无 loss 门控 |
| autoEvolve | 每 50 次交互 | 与经验数量无关；与 distill 同时触发 CPU 尖峰；无效果门控 |
| distill | 每 100 次决策 | 不检查决策多样性；不检查蒸馏质量；与 autoEvolve 未错开 |

---

## Phase 1：World Model 训练自适应化

**修改文件**：`src/core/subsystems.ts`

### 改动 1.1：定时器改为 1 分钟检查 + 事件驱动触发

**当前代码**（约 880-890 行）：
```typescript
setInterval(() => {
  if (this._worldModelBuffer.length >= 16 && this.rightBrain) {
    const batch = this._worldModelBuffer.splice(0, 32);
    const sceneWM = this.rightBrain.getSceneWorldModel();
    if (sceneWM) {
      const result = sceneWM.train(batch, 8);
      if (verbose) console.log(`[WorldModel] 训练: loss=...`);
    }
    try { fs.writeFileSync(wmBufferFile, JSON.stringify(this._worldModelBuffer)); } catch {}
  }
}, 5 * 60 * 1000);
```

**改为**：
```typescript
// 自适应训练配置
let wmLastTrainAt = 0;
let wmConsecutiveNoop = 0;  // 连续无有效训练计数
const WM_BASE_INTERVAL = 60_000;   // 基础检查间隔 1 分钟
const WM_BATCH_SIZE = 8;
const WM_MIN_SAMPLES = 16;         // 最少样本数
const WM_TRAIN_THRESHOLD = 32;     // 理想训练阈值

setInterval(() => {
  if (this._worldModelBuffer.length < WM_MIN_SAMPLES || !this.rightBrain) return;

  // 自适应：缓冲区接近满时立即训练，少时等待积累
  const urgency = this._worldModelBuffer.length / 200; // 0~1
  const interval = WM_BASE_INTERVAL * (1 - urgency * 0.8); // 最短 12 秒
  if (Date.now() - wmLastTrainAt < interval) return;

  const sceneWM = this.rightBrain.getSceneWorldModel();
  if (!sceneWM) return;

  // 取全部可用样本（不只 32 条）
  const available = Math.min(this._worldModelBuffer.length, 64);
  const batch = this._worldModelBuffer.splice(0, available);

  // 多轮训练：每轮 batch_size=8，用完所有样本
  const epochs = Math.ceil(batch.length / WM_BATCH_SIZE);
  let lastLoss = Infinity;
  let totalTrained = 0;

  for (let e = 0; e < epochs; e++) {
    const result = sceneWM.train(batch, WM_BATCH_SIZE);
    totalTrained += result.trained;

    // loss 门控：loss 暴涨 50% 则停止（可能数据有噪声）
    if (lastLoss < Infinity && result.loss > lastLoss * 1.5) {
      if (verbose) console.log(`[WorldModel] loss 暴涨 ${lastLoss.toFixed(4)}→${result.loss.toFixed(4)}，提前停止`);
      break;
    }
    lastLoss = result.loss;
  }

  wmLastTrainAt = Date.now();

  if (totalTrained > 0) {
    wmConsecutiveNoop = 0;
    if (verbose) console.log(`[WorldModel] 训练: loss=${lastLoss.toFixed(4)}, samples=${totalTrained}/${batch.length}, epochs=${epochs}`);
  } else {
    wmConsecutiveNoop++;
  }

  // 持久化
  try { fs.writeFileSync(wmBufferFile, JSON.stringify(this._worldModelBuffer)); } catch {}
}, WM_BASE_INTERVAL);
```

### 改动 1.2：feedWorldModelSample 加即时触发

**当前代码**：
```typescript
feedWorldModelSample(sample: {...}): void {
  this._worldModelBuffer.push(sample);
  if (this._worldModelBuffer.length > 200) {
    this._worldModelBuffer.splice(0, this._worldModelBuffer.length - 200);
  }
}
```

**改为**：
```typescript
feedWorldModelSample(sample: {...}): void {
  this._worldModelBuffer.push(sample);
  if (this._worldModelBuffer.length > 200) {
    this._worldModelBuffer.splice(0, this._worldModelBuffer.length - 200);
  }
  // 缓冲区满 64 条时标记需要训练（不直接训练，由定时器统一处理）
  // 定时器的 urgency 机制会自动缩短检查间隔
}
```

### 验收标准
- verbose 日志显示 `loss=... samples=N/M epochs=K`（多轮训练）
- 缓冲区 100+ 条时训练间隔自动缩短
- loss 暴涨时提前停止并输出日志

---

## Phase 2：autoEvolve 自适应 + 错开调度

**修改文件**：`src/brain/shadow/index.ts`

### 改动 2.1：固定间隔改为自适应间隔

**当前代码**（约 71、176 行）：
```typescript
private readonly AUTO_EVOLVE_INTERVAL = 50;
// ...
if (this.interactionCount % this.AUTO_EVOLVE_INTERVAL === 0) {
  this.runAutoEvolve().catch(...);
}
```

**改为**：
```typescript
// 移除固定常量，改为自适应方法
private autoEvolveLastAt = 0;
private autoEvolveNoopStreak = 0;  // 连续无产出计数
private recentPlanModes: string[] = [];  // 最近 50 次决策模式（用于自身多样性判断）

/** 自适应 autoEvolve 间隔：交互多→多触发，连续无产出→自动退避 */
private getAutoEvolveInterval(): number {
  // 注意：BrainProvider.getRightBrain() 不暴露 getLearnStats()
  // 改用 interactionCount 作为经验积累的代理指标
  const ic = this.interactionCount;

  let base: number;
  if (ic < 100) base = 200;        // 刚启动，几乎不触发
  else if (ic < 500) base = 100;   // 早期阶段
  else if (ic < 2000) base = 50;   // 中期阶段
  else base = 30;                   // 成熟阶段

  // 连续无产出退避：每连续 1 次无产出，间隔翻倍（上限 4 倍）
  const backoff = Math.min(4, Math.pow(2, this.autoEvolveNoopStreak));
  return base * backoff;
}

// onInteraction 中的触发逻辑改为：
// 5. P1-3: 自适应触发 autoEvolve（与 distill 错开 25 次交互）
if (this.interactionCount > 25 &&
    (this.interactionCount - 25) % this.getAutoEvolveInterval() === 0) {
  this.runAutoEvolve().catch(err => {
    if (this.verbose) console.warn(`[ShadowBrain] autoEvolve 失败: ${err.message}`);
  });
}
```

> **注**：原计划用 `this.brain?.getRightBrain?.()?.getLearnStats()?.totalSamples`，
> 但 `BrainProvider.getRightBrain()` 返回类型为 `{ expandIntentHead() } | null`，
> 不暴露 `getLearnStats()`。改用 `interactionCount` 作为代理指标。

### 改动 2.2：runAutoEvolve 返回产出数量

**当前代码**：
```typescript
private async runAutoEvolve(): Promise<void> {
  // ...
  const events = await evolver.autoEvolve();
  if (events.length > 0 && this.verbose) {
    console.log(`[ShadowBrain] autoEvolve 产出 ${events.length} 个进化事件`);
  }
}
```

**改为**：
```typescript
private async runAutoEvolve(): Promise<void> {
  if (!this.brain?.getExperienceEvolver) return;
  const evolver = this.brain.getExperienceEvolver();
  if (!evolver) return;

  if (this.verbose) console.log('[ShadowBrain] 触发 autoEvolve 全量扫描');
  const events = await evolver.autoEvolve();

  if (events.length > 0) {
    this.autoEvolveNoopStreak = 0;  // 有产出，重置退避
    if (this.verbose) console.log(`[ShadowBrain] autoEvolve 产出 ${events.length} 个进化事件`);
  } else {
    this.autoEvolveNoopStreak++;  // 无产出，增加退避
    if (this.verbose) console.log(`[ShadowBrain] autoEvolve 无产出 (连续 ${this.autoEvolveNoopStreak} 次)`);
  }
}
```

### 验收标准
- 经验 < 30 条时几乎不触发 autoEvolve
- 连续无产出时触发频率自动降低
- verbose 日志显示退避状态

---

## Phase 3：distill 多样性门控 + 质量检查

**修改文件**：`src/brain/brain.ts`

### 改动 3.1：distill 触发加多样性门控

**当前代码**（约 57-58、245-248 行）：
```typescript
private readonly DISTILL_INTERVAL = 100;
// ...
this.decisionCount++;
if (this.decisionCount % this.DISTILL_INTERVAL === 0) {
  this.runDistill().catch(...);
}
```

**改为**：
```typescript
private readonly DISTILL_INTERVAL = 100;
private distillNoopStreak = 0;  // 连续无新规则计数
private recentModes: string[] = [];  // 最近 50 次决策模式

// feedback() 方法中，在 decisionCount++ 后记录模式：
this.recentModes.push(plan.mode);
if (this.recentModes.length > 50) this.recentModes.shift();

this.decisionCount++;
if (this.decisionCount % this.DISTILL_INTERVAL === 0) {
  // 多样性门控：最近 50 次决策中至少 2 种模式才值得蒸馏
  const uniqueModes = new Set(this.recentModes);
  if (uniqueModes.size >= 2) {
    this.runDistill().catch(err => {
      if (this.verbose) console.warn(`[ThreeBrain] distill 失败: ${err.message}`);
    });
  } else if (this.verbose) {
    console.log(`[ThreeBrain] distill 跳过: 决策模式单一 (${uniqueModes.size} 种)`);
  }
}
```

> **注**：原计划用 `this.decisionTrace.slice(-50).map(t => t.mode)`，
> 但 `decisionTrace` 在 `BuddyAgent` 上，`ThreeBrain` 无法访问。
> 改为在 `ThreeBrain` 内部维护 `recentModes` 数组，在 `feedback()` 中记录。

### 改动 3.2：runDistill 加质量门控 + 退避

**当前代码**：
```typescript
async runDistill(): Promise<void> {
  if (this.verbose) console.log('[ThreeBrain] 触发策略蒸馏');
  const report = await this.left.distill();
  if (report.newRules > 0 && this.verbose) {
    console.log(`[ThreeBrain] 蒸馏完成: ${report.newRules} 新规则, ${report.prunedRules} 淘汰`);
  }
}
```

**改为**：
```typescript
async runDistill(): Promise<void> {
  if (this.verbose) console.log('[ThreeBrain] 触发策略蒸馏');
  const report = await this.left.distill();

  if (report.newRules > 0) {
    this.distillNoopStreak = 0;
    if (this.verbose) {
      console.log(`[ThreeBrain] 蒸馏完成: ${report.newRules} 新规则, ${report.prunedRules} 淘汰`);
    }
  } else {
    this.distillNoopStreak++;
    if (this.verbose) {
      console.log(`[ThreeBrain] 蒸馏无新规则 (连续 ${this.distillNoopStreak} 次)`);
    }
  }
}
```

### 验收标准
- 决策模式单一时跳过蒸馏并输出日志
- 连续无新规则时蒸馏频率不变化（distill 本身成本低，不需要退避）
- 多样性门控生效：只有跨多种模式时才蒸馏

---

## Phase 4：补充 — feedWorldModelSample 限流

**修改文件**：`src/core/subsystems.ts`

当前 `feedWorldModelSample` 没有采样率控制，高频交互场景下缓冲区可能几秒就满。

### 改动 4.1：加采样率控制

```typescript
private wmSampleCounter = 0;
private readonly WM_SAMPLE_RATE = 3; // 每 3 次交互采样 1 次

feedWorldModelSample(sample: {...}): void {
  this.wmSampleCounter++;
  if (this.wmSampleCounter % this.WM_SAMPLE_RATE !== 0) return; // 降采样

  this._worldModelBuffer.push(sample);
  if (this._worldModelBuffer.length > 200) {
    this._worldModelBuffer.splice(0, this._worldModelBuffer.length - 200);
  }
}
```

---

## 实施时间线

```
Phase 1: World Model 自适应训练     1.5h
├── 1.1 定时器自适应化              1h
└── 1.2 采样率控制                  15min

Phase 2: autoEvolve 自适应 + 错开   1h
├── 2.1 自适应间隔                  30min
└── 2.2 产出反馈 + 退避             30min

Phase 3: distill 多样性门控         45min
├── 3.1 多样性检查                  20min
└── 3.2 质量门控 + 退避             20min
```

**总计：约 3 小时**

---

## 改动对比

| 维度 | 改前 | 改后 |
|------|------|------|
| World Model 检查间隔 | 5 分钟固定 | 1 分钟检查，urgency 驱动最短 12 秒 |
| World Model 每次训练样本 | 最多 32 条（只训 8 条） | 最多 64 条（全部用完，多轮训练） |
| World Model loss 门控 | 无 | loss 涨 50% 停止 |
| autoEvolve 间隔 | 固定 50 次 | 30-200 次，与经验数量 + 产出效果挂钩 |
| autoEvolve 与 distill 错开 | 未错开（每 100 次同时触发） | 偏移 25 次交互 |
| distill 触发条件 | 固定 100 次 | 100 次 + 多样性门控（≥2 种模式） |
