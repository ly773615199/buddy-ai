# 🔧 神经连接数据流通修复计划

> 生成时间：2026-05-11
> 基于：深度代码分析发现的 7 条主干通路诊断结果
> 目标：将系统数据流通率从 ~93% 提升到 ~99%

---

## 总览：问题分级与修复优先级

| # | 问题 | 严重度 | 影响范围 | 修复复杂度 |
|---|------|--------|----------|-----------|
| 1 | CrossSession → ModelPool 参数恢复缺失 | 🔴 严重 | 模型选择质量 | 低 |
| 2 | ModelPool 与 CrossSession 双重持久化冗余 | 🟡 中等 | 维护成本/一致性 | 中 |
| 3 | 感知事件总线文档标记 deprecated 与实际不符 | 🟢 轻微 | 开发体验 | 极低 |
| 4 | 脑内构图依赖未初始化 NN 静默失败 | 🟡 中等 | 决策质量 | 低 |
| 5 | World Model 训练缓冲区无持久化 | 🟡 中等 | 训练效率 | 低 |
| 6 | KnowledgeExporter.getExperiences 空数组 | 🟡 中等 | 知识导出 | 中 |
| 7 | 自动训练触发去重 Set 无持久化 | 🟢 轻微 | 资源浪费 | 极低 |
| 8 | 情绪/欲望引擎废弃标记不一致 | 🟢 轻微 | 代码可读性 | 极低 |

---

## Phase 1：关键断裂修复（优先级最高）

### 1.1 CrossSession → ModelPool 参数恢复桥接

**问题根因**：

```
session 启动时:
  ModelPool.loadUnifiedState()     → 从 model-pool-unified/thompson.json 加载 tsParams ✅
  CrossSessionLearner.load()       → 从 global-thompson.json 加载 params ✅
  pool.initializeFromProviders()   → 只发现模型，不恢复 CrossSession 参数 ❌
```

两个持久化源各自维护 Thompson Sampling 参数，session 内通过 `setFeedbackCallback` 同步，但跨 session 启动时无桥接。

**修复方案**：在 `pool.initializeFromProviders()` 完成后，从 CrossSession 恢复参数到 pool。

**修改文件**：`src/core/subsystems.ts`

**具体改动**：

```typescript
// 位置：subsystems.ts 构造函数中，pool.initializeFromProviders() 的 .then() 回调内
// 当前代码（约 239-243 行）：
pool.initializeFromProviders(config.models.providers).then(() => {
  if (verbose) console.log(`[UnifiedPool] 已初始化: ${pool.profileCount} 个模型`);
}).catch((err) => {
  if (verbose) console.warn('[UnifiedPool] 初始化失败:', err.message);
});

// 改为：
pool.initializeFromProviders(config.models.providers).then(() => {
  // P2-7 FIX: 从 CrossSession 恢复全局 Thompson 参数到 ModelPool
  if (this.crossSession) {
    const globalParams = this.crossSession.getAllParams();
    let restored = 0;
    for (const gp of globalParams) {
      // key 格式: "taskType:modelId" — 与 pool.tsParams 的 key 格式一致
      const decayed = this.crossSession.initializeLocal(gp.key);
      if (decayed) {
        // 只恢复 pool 中尚无数据或数据更少的 key
        const existing = pool.getThompsonParams?.(gp.key);
        if (!existing || (existing.alpha + existing.beta) < (decayed.alpha + decayed.beta)) {
          pool.setThompsonParams(gp.key, decayed);
          restored++;
        }
      }
    }
    if (verbose && restored > 0) {
      console.log(`[UnifiedPool] 从 CrossSession 恢复 ${restored} 个 Thompson 参数`);
    }
  }
  if (verbose) console.log(`[UnifiedPool] 已初始化: ${pool.profileCount} 个模型`);
}).catch((err) => {
  if (verbose) console.warn('[UnifiedPool] 初始化失败:', err.message);
});
```

**修改文件**：`src/core/model-pool.ts`

**需要新增的公开方法**：

```typescript
// 在 ModelPool 类中新增（约 recordFeedback 方法附近）：

/** 获取指定 key 的 Thompson 参数（供 CrossSession 恢复用） */
getThompsonParams(key: string): ThompsonParams | null {
  return this.tsParams.get(key) ?? null;
}

/** 设置指定 key 的 Thompson 参数（供 CrossSession 恢复用） */
setThompsonParams(key: string, params: ThompsonParams): void {
  this.tsParams.set(key, params);
}
```

**验收标准**：
- 启动时 verbose 日志显示 `[UnifiedPool] 从 CrossSession 恢复 N 个 Thompson 参数`
- 重启后模型选择行为与重启前一致（通过 AB 测试对比）

---

## Phase 2：架构一致性优化

### 2.1 合并双重 Thompson 参数持久化

**问题根因**：ModelPool 和 CrossSessionLearner 各自维护独立的 Thompson 参数文件，逻辑完全重复。

**修复方案**：统一为单一数据源 —— ModelPool 为主，CrossSession 仅作为跨 session 传输层。

**修改文件**：
- `src/core/cross-session-learner.ts` — 改为读写 ModelPool 的 `thompson.json`
- `src/core/model-pool.ts` — 增加 `exportForCrossSession()` / `importFromCrossSession()`

**具体改动**：

```typescript
// cross-session-learner.ts — 新增方法：

/**
 * 从 ModelPool 的 thompson.json 导入参数
 * 用于 session 启动时合并 pool 已有数据
 */
importFromPool(poolThompsonFile: string): number {
  try {
    if (!fs.existsSync(poolThompsonFile)) return 0;
    const raw = JSON.parse(fs.readFileSync(poolThompsonFile, 'utf-8'));
    let merged = 0;
    for (const [key, params] of Object.entries(raw)) {
      const existing = this.params.get(key);
      const poolParams = params as ThompsonParams;
      // 合并策略：取样本数更多的那个
      if (!existing || (poolParams.alpha + poolParams.beta) > (existing.alpha + existing.beta)) {
        this.params.set(key, {
          key,
          alpha: poolParams.alpha,
          beta: poolParams.beta,
          totalSamples: Math.round(poolParams.alpha + poolParams.beta - 2),
          lastUpdated: Date.now(),
          sourceSessions: [this.sessionId],
          decayProfile: { ...DEFAULT_DECAY_PROFILE },
        });
        merged++;
      }
    }
    if (merged > 0) this.save();
    return merged;
  } catch { return 0; }
}
```

```typescript
// model-pool.ts — 新增方法：

/**
 * 导出 Thompson 参数给 CrossSession（用于跨 session 迁移）
 */
exportThompsonParams(): Record<string, ThompsonParams> {
  const result: Record<string, ThompsonParams> = {};
  for (const [key, params] of this.tsParams) {
    result[key] = params;
  }
  return result;
}
```

**验收标准**：
- `~/.buddy/global-thompson.json` 和 `~/.buddy/model-pool-unified/thompson.json` 内容一致
- 删除其中一个文件后重启，数据可从另一个恢复

---

### 2.2 脑内构图（Mental Simulation）容错增强

**问题根因**：`brain.ts:imagine()` 调用 `right.bestAction()` 时，如果 NN 模型未训练，返回 null，整个脑内构图静默跳过。

**修改文件**：`src/brain/brain.ts`

**具体改动**：

```typescript
// brain.ts 的 decide() 方法中（约 115-135 行）
// 当前代码：
if (intuition && intuition.qualityEstimate < 0.5 && plan.confidence < 0.6) {
  try {
    const tokenIds = this.right['model'] ? [] : [];
    const candidates = [...];
    const best = this.right.bestAction([], candidates);
    if (best) { mentalSimulation = {...}; }
  } catch { }
}

// 改为：
if (intuition && intuition.qualityEstimate < 0.5 && plan.confidence < 0.6) {
  try {
    // 检查右脑 NN 是否已训练（至少有 10 个样本）
    const rightStats = this.right.getLearnStats();
    if (rightStats.totalSamples >= 10) {
      const candidates = [
        { type: 0, params: [], label: 'sequential' },
        { type: 1, params: [], label: 'parallel' },
        { type: 2, params: [], label: 'single' },
      ];
      const best = this.right.bestAction([], candidates);
      if (best) {
        mentalSimulation = {
          candidates: candidates.map(c => ({
            label: c.label,
            confidence: best.prediction.confidence,
            topologyChange: best.prediction.topologyChangeProb,
          })),
          selected: best.label,
        };
      }
    } else if (this.verbose) {
      console.log(`[ThreeBrain] 脑内构图跳过: NN 样本不足 (${rightStats.totalSamples} < 10)`);
    }
  } catch (err) {
    if (this.verbose) console.warn('[ThreeBrain] 脑内构图失败:', (err as Error).message);
  }
}
```

**验收标准**：
- NN 未训练时 verbose 日志显示跳过原因
- NN 训练后（≥10 样本）脑内构图正常工作

---

### 2.3 World Model 训练缓冲区持久化

**问题根因**：`_worldModelBuffer` 存内存，进程重启丢失。

**修改文件**：`src/core/subsystems.ts`

**具体改动**：

```typescript
// 1. 构造函数中加载持久化缓冲区（World Model 定时器附近）：

// World Model 训练缓冲区 — 持久化到磁盘
const wmBufferFile = path.join(dbDir, 'world-model-buffer.json');
this._worldModelBuffer = [];
try {
  if (fs.existsSync(wmBufferFile)) {
    const raw = JSON.parse(fs.readFileSync(wmBufferFile, 'utf-8'));
    if (Array.isArray(raw)) {
      this._worldModelBuffer = raw.slice(-200); // 最多保留 200 条
      if (verbose) console.log(`[WorldModel] 加载 ${this._worldModelBuffer.length} 条缓冲样本`);
    }
  }
} catch { /* 加载失败不影响运行 */ }

// 2. 定时器中训练完成后持久化（setInterval 回调内）：

// 训练完成后清空并持久化
if (this._worldModelBuffer.length >= 16 && this.rightBrain) {
  const batch = this._worldModelBuffer.splice(0, 32);
  // ... 训练逻辑 ...
  // 持久化剩余缓冲区
  try {
    fs.writeFileSync(wmBufferFile, JSON.stringify(this._worldModelBuffer));
  } catch { /* 静默 */ }
}

// 3. closeAll() 中持久化：
// 持久化 World Model 缓冲区
try {
  fs.writeFileSync(wmBufferFile, JSON.stringify(this._worldModelBuffer));
} catch { /* 静默 */ }
```

**验收标准**：
- 重启后 `[WorldModel] 加载 N 条缓冲样本` 日志正确
- 缓冲区超过 200 条时自动裁剪

---

## Phase 3：知识通路补全

### 3.1 KnowledgeExporter 绑定 ExperienceEngine

**问题根因**：`KnowledgeExporter` 构造时 `getExperiences` 回调返回空数组，因为 `ExperienceEngine` 未暴露 `getExperiences()` 方法。

**修改文件**：
- `src/intelligence/index.ts` — 新增 `getExperiences()` 公开方法
- `src/core/subsystems.ts` — 修改 `KnowledgeExporter` 构造

**具体改动**：

```typescript
// src/intelligence/index.ts — ExperienceEngine 类中新增：

/** 获取所有已编译的经验单元（供 KnowledgeExporter 使用） */
getExperiences(): import('./types.js').ExperienceUnit[] {
  return this.graph.getAllNodes();
}

// src/core/subsystems.ts — KnowledgeExporter 构造修改：
// 当前代码：
this.knowledgeExporter = new KnowledgeExporter(
  this.cognitive,
  () => [], // ExperienceEngine 未暴露 getExperiences，暂用空数组
);

// 改为：
this.knowledgeExporter = new KnowledgeExporter(
  this.cognitive,
  () => this.intelligence.getExperiences(),
);
```

**验收标准**：
- `knowledge_export` 相关 CLI 命令输出非空经验列表

---

### 3.2 自动训练触发去重持久化

**问题根因**：`agent.ts:autoTrainingTriggered` 是内存 Set，进程重启后丢失。

**修改文件**：`src/core/agent.ts`

**具体改动**：

```typescript
// 1. 构造函数中加载已触发记录：
private autoTrainingTriggeredFile: string;

constructor(config: BuddyConfig, options?: {...}) {
  // ... 现有代码 ...
  this.autoTrainingTriggeredFile = path.join(
    process.env.HOME ?? '/tmp', '.buddy', 'auto-training-triggered.json'
  );
  this.loadAutoTrainingTriggered();
}

// 2. 新增加载/保存方法：
private loadAutoTrainingTriggered(): void {
  try {
    if (fs.existsSync(this.autoTrainingTriggeredFile)) {
      const raw = JSON.parse(fs.readFileSync(this.autoTrainingTriggeredFile, 'utf-8'));
      if (Array.isArray(raw)) {
        this.autoTrainingTriggered = new Set(raw);
      }
    }
  } catch { /* 静默 */ }
}

private saveAutoTrainingTriggered(): void {
  try {
    fs.writeFileSync(
      this.autoTrainingTriggeredFile,
      JSON.stringify([...this.autoTrainingTriggered])
    );
  } catch { /* 静默 */ }
}

// 3. autoTriggerTraining() 中触发后保存：
this.autoTrainingTriggered.add(profile.domain);
this.saveAutoTrainingTriggered(); // 新增此行
```

**验收标准**：
- 重启后同一领域不重复触发训练

---

## Phase 4：文档与代码一致性

### 4.1 感知事件总线 deprecated 标记修正

**修改文件**：`src/perception/event-bus.ts`

```typescript
// 当前（第 3 行）：
* @deprecated 当前版本未使用。为桌面端/移动端硬件感知预留。

// 改为：
* 感知事件总线 — 统一感知事件通道
* 当前用于：用户交互事件 → PerceptionBridge → 情绪 Buff 注入
* 扩展预留：摄像头/麦克风/位置传感器（桌面端/移动端）
```

### 4.2 情绪/欲望引擎废弃标记清理

**修改文件**：`src/core/subsystems.ts`

```typescript
// 将：
/** @deprecated 由小脑 BodyStateManager 接管，保留类型兼容 */
readonly emotion: EmotionEngine | null;
/** @deprecated 由小脑 BodyStateManager 接管，保留类型兼容 */
readonly desire: DesireEngine | null;

// 改为：
/** 已迁移至小脑 BodyStateManager，保留 null 以兼容旧接口引用 */
readonly emotion: null;
/** 已迁移至小脑 BodyStateManager，保留 null 以兼容旧接口引用 */
readonly desire: null;
```

同时清理 import 中未使用的 `EmotionEngine` 和 `DesireEngine` 类型导入。

---

## 实施时间线

```
Phase 1（关键断裂修复）     预计 2-3 小时
├── 1.1 CrossSession 恢复桥接     1h
├── 1.2 脑内构图容错              30min
└── 1.3 World Model 缓冲持久化    30min

Phase 2（架构一致性）       预计 2-3 小时
├── 2.1 Thompson 参数统一         1.5h
└── 2.2 脑内构图 NN 检查          30min

Phase 3（知识通路补全）     预计 1-2 小时
├── 3.1 KnowledgeExporter 绑定   30min
└── 3.2 训练触发持久化            30min

Phase 4（文档一致性）       预计 30 分钟
├── 4.1 deprecated 标记修正       10min
└── 4.2 废弃标记清理              10min
```

**总计：约 6-9 小时**

---

## 验证方案

### 单元测试

```typescript
// 新增测试文件：src/core/neural-flow.test.ts

describe('CrossSession → ModelPool 参数恢复', () => {
  it('启动时从 CrossSession 恢复 Thompson 参数', () => {
    // 1. 创建 CrossSessionLearner 并写入参数
    // 2. 创建 ModelPool（空 tsParams）
    // 3. 调用恢复逻辑
    // 4. 验证 pool.tsParams 包含 CrossSession 的参数
  });

  it('不覆盖 pool 中已有的更优参数', () => {
    // pool 已有 alpha=10, beta=2 的参数
    // CrossSession 有 alpha=5, beta=3 的参数
    // 恢复后应保留 pool 的参数（样本更多）
  });
});

describe('脑内构图容错', () => {
  it('NN 样本不足时跳过构图并输出日志', () => {
    // 右脑 totalSamples = 5
    // decide() 后 mentalSimulation 应为 undefined
  });

  it('NN 样本充足时执行构图', () => {
    // 右脑 totalSamples = 20
    // 低质量 + 低置信度场景
    // decide() 后 mentalSimulation 应有值
  });
});
```

### 集成验证

1. **跨 session 一致性测试**：
   - 启动 session A，进行 10 次对话（产生 Thompson 参数）
   - 关闭 session A
   - 启动 session B，检查 verbose 日志确认参数恢复
   - 进行相同类型对话，验证模型选择行为一致

2. **通路完整性测试**：
   - 开启 verbose 模式
   - 执行一次完整对话
   - 检查日志中每条通路都有输出：
     - `[Perception] 感知→情绪映射管线已启动`
     - `[ThreeBrain] 决策完成: Xms`
     - `[Convergence] 摄入 feedback: N 样本`
     - `[Cache] 静态层重建` / `半动态层更新`

---

## 风险评估

| 修复 | 风险 | 缓解措施 |
|------|------|----------|
| CrossSession 恢复 | 可能恢复过时参数 | 仅在 pool 无数据或数据更少时恢复 |
| Thompson 参数统一 | 文件格式不兼容 | 保留两个文件，渐进迁移 |
| World Model 持久化 | 磁盘空间 | 限制 200 条上限 |
| KnowledgeExporter 绑定 | getExperiences 性能 | 返回引用，不拷贝 |

---

## 后续优化方向（不在本次修复范围）

1. **感知事件总线扩展**：接入摄像头/麦克风 → PerceptionBridge → 情绪 Buff
2. **脑内构图增强**：用真实 token 序列替代 domain token 简化编码
3. **World Model 增量训练**：支持在线学习而非批量训练
4. **统一记忆检索**：STMP + MemoryStore + BeliefStore 三路融合检索
5. **影子大脑自动进化闭环**：GapDetector → 自动生成训练数据 → 自动训练 → 自动部署
