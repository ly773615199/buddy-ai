# 资源画像 & 三脑决策 修复计划

> 基于 2026-06-15 运行轨迹分析报告生成
> 优先级: P0(立即修复) → P1(本周) → P2(迭代优化) → P3(体验优化)

---

## P0-1: 生命周期非法转换 `discovered → deprecated`

### 问题

`ResourceHubAdapter.registerLegacy()` 将旧系统的 `unavailable` 状态映射为 `deprecated`，
但资源刚注册时处于 `discovered` 状态，`discovered → deprecated` 不在合法转换表中。
启动时产生 60+ 条 `[Lifecycle] 非法转换` 警告。

### 涉及文件

- `src/brain/hub/resource-hub-adapter.ts` — 第 46-64 行

### 修复方案

```typescript
// src/brain/hub/resource-hub-adapter.ts
// 修改前:
const stateMap: Record<string, 'active' | 'degraded' | 'deprecated' | 'discovered'> = {
  active: 'active',
  degraded: 'degraded',
  unavailable: 'deprecated',  // ← BUG: discovered → deprecated 非法
  unknown: 'discovered',
};

// 修改后:
const stateMap: Record<string, 'active' | 'degraded' | 'rejected' | 'discovered'> = {
  active: 'active',
  degraded: 'degraded',
  unavailable: 'rejected',   // ← 修复: 先 rejected，由审计决定是否 deprecated
  unknown: 'discovered',
};
```

同时修改 `updateStatus()` 方法（第 160-168 行）:

```typescript
// 修改前:
const stateMap: Record<string, 'active' | 'degraded' | 'deprecated'> = {
  active: 'active',
  degraded: 'degraded',
  unavailable: 'deprecated',
};

// 修改后:
const stateMap: Record<string, 'active' | 'degraded' | 'rejected'> = {
  active: 'active',
  degraded: 'degraded',
  unavailable: 'rejected',
};
```

以及 `getHealthSummary()` 中的映射（第 175 行）:

```typescript
// 修改前:
unavailable: summary.byState.deprecated + summary.byState.deceased,

// 修改后:
unavailable: summary.byState.rejected + summary.byState.deprecated + summary.byState.deceased,
```

### 验证方法

```bash
# 启动后端，检查日志中不应再出现 discovered → deprecated 警告
npx tsx src/start-ws.ts 2>&1 | grep -c "非法转换: discovered → deprecated"
# 期望输出: 0
```

---

## P0-2: `active → active` 自转换（状态机绕过）

### 问题

`unified-resource-bridge.ts` 的多个同步方法直接赋值 `resource.state = 'active'`，
绕过了 `LifecycleManager.transition()`，导致后续 `markState('active')` 触发自转换警告。

### 涉及文件

- `src/brain/hub/unified-resource-bridge.ts` — 多处（第 198-203, 240-241, 276-277, 312-313, 350-366, 424-425 行）

### 修复方案

统一通过 `LifecycleManager` 进行状态转换。在 `UnifiedResourceBridge` 中注入 lifecycle 引用:

```typescript
// src/brain/hub/unified-resource-bridge.ts

// 1. 构造函数中获取 lifecycle 引用
private lifecycle: LifecycleManager;

constructor(hub: UnifiedResourceHub, ...) {
  this.hub = hub;
  this.lifecycle = hub.getLifecycle();  // 需要在 UnifiedResourceHub 上暴露此方法
  ...
}

// 2. 将所有直接赋值改为通过 lifecycle 转换
// 修改前 (多处):
resource.state = 'active';
resource.lastStateChange = Date.now();

// 修改后:
if (resource.state !== 'active') {
  this.lifecycle.transition(resource, 'active', '同步激活');
}
```

需要在 `UnifiedResourceHub` 中暴露 lifecycle:

```typescript
// src/brain/hub/unified-resource-hub.ts
getLifecycle(): LifecycleManager {
  return this.lifecycle;
}
```

### 涉及的直接赋值位置（全部需要修改）

| 行号 | 当前代码 | 修改为 |
|------|----------|--------|
| 200 | `resource.state = 'active'` | `this.lifecycle.transition(resource, 'active', '工具同步')` |
| 203 | `resource.state = 'degraded'` | `this.lifecycle.transition(resource, 'degraded', '工具同步')` |
| 241 | `resource.state = source.isAvailable() ? 'active' : 'degraded'` | 通过 lifecycle 转换 |
| 277 | `resource.state = activePlatform?.platform === platform ? 'active' : 'discovered'` | 通过 lifecycle 转换 |
| 313 | `resource.state = activeBackend?.name === backend ? 'active' : 'discovered'` | 通过 lifecycle 转换 |
| 354 | `resource.state = 'active'` | 通过 lifecycle 转换 |
| 358 | `resource.state = 'active'` | 通过 lifecycle 转换 |
| 425 | `resource.state = resource.healthScore >= 50 ? 'active' : 'degraded'` | 通过 lifecycle 转换 |

### 验证方法

```bash
# 启动后不应出现 active → active 警告
npx tsx src/start-ws.ts 2>&1 | grep -c "非法转换: active → active"
# 期望输出: 0
```

---

## P1-1: 执行失败未回写资源画像

### 问题

`PlanExecutor` 执行失败时调用了 `recordResourceOutcome()`，但仅在统一池执行路径中。
经验执行路径、DAG 执行路径的失败未回写到 `UnifiedResourceHub`。
导致资源画像的健康度/成功率不反映真实运行状况。

### 涉及文件

- `src/core/plan-executor.ts` — 第 425 行附近
- `src/core/agent.ts` — 第 748 行附近（三脑决策后的执行路径）

### 修复方案

#### 方案 A: 在 PlanExecutor 的所有失败路径中添加 recordOutcome

```typescript
// src/core/plan-executor.ts

// 在 executeSingle() 的 catch 块中:
} catch (err) {
  // 新增: 回写失败到资源画像
  const modelId = resolveModelId(ctx, plan);
  if (modelId) {
    recordResourceOutcome(ctx.sys, modelId, false, Date.now() - startTime, undefined,
      plan.domains?.[0], plan.complexity);
  }
  console.warn(`[PlanExecutor] 执行失败: ${(err as Error).message}`);
  ...
}

// 在 executeExperience() 的失败路径中:
} catch (err) {
  // 新增: 回写经验执行失败
  recordResourceOutcome(ctx.sys, `experience/${skillId}`, false, Date.now() - startTime);
  ...
}
```

#### 方案 B: 在 Agent 的 feedback 回调中统一回写

```typescript
// src/core/agent.ts — 在 executeByPlan 调用后
const result = await execByPlan(ctx, plan);

// 新增: 将执行结果回写到三脑反馈系统
if (sys.threeBrain) {
  const outcome: DecisionOutcome = {
    success: result.toolCalls?.length > 0 ? true : !!result.text,
    latencyMs: result.latencyMs ?? 0,
    costEstimate: 0,
    toolsUsed: result.toolCalls?.map(tc => tc.name) ?? [],
  };
  await sys.threeBrain.feedback(signal, resources, plan, outcome);
}
```

### 验证方法

```typescript
// 发送消息后检查资源画像是否更新
const health = await api('GET', '/api/health');
// 检查 modelPool 的 success/failures 计数是否变化
```

---

## P1-2: 能力画像缺乏运行时验证

### 问题

模型能力（toolCalling、vision、streaming 等）在启动时由 `ModelEnricher` 从静态 catalog 填充，
运行时未根据实际执行结果更新。如果 catalog 标记错误，三脑决策会做出错误选择。

### 涉及文件

- `src/core/plan-executor.ts` — 执行失败时
- `src/brain/hub/unified-resource-hub.ts` — 能力更新接口

### 修复方案

在执行失败时，根据错误类型更新能力画像:

```typescript
// src/core/plan-executor.ts — 新增函数
function updateCapabilityFromError(
  sys: Subsystems,
  resourceId: string,
  error: Error,
  taskType: string,
): void {
  const hub = sys.resourceSystem?.hub;
  if (!hub) return;

  const msg = error.message;

  // 400 + tools → toolCalling 不支持
  if (msg.includes('400') && taskType === 'tools') {
    hub.updateCapability(resourceId, 'toolCalling', {
      value: false,
      verified: true,
      lastVerifiedAt: Date.now(),
      sourcePriority: 4, // runtime > static
    });
  }

  // 401/403 → 认证失败，标记不可达
  if (msg.includes('401') || msg.includes('403')) {
    hub.updateCapability(resourceId, 'reachable', {
      value: false,
      verified: true,
      lastVerifiedAt: Date.now(),
      sourcePriority: 4,
    });
  }

  // token limit → 标记 maxContextTokens 不足
  if (msg.includes('too long') || msg.includes('token')) {
    // 触发漂移检测
    hub.onProbeResult(resourceId, {
      timestamp: Date.now(),
      source: 'runtime',
      capabilities: {
        maxContextTokens: { value: 0, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 4 },
      },
      confidence: 0.8,
      latencyMs: 0,
      error: msg,
    });
  }
}
```

需要在 `UnifiedResourceHub` 中新增 `updateCapability()` 方法:

```typescript
// src/brain/hub/unified-resource-hub.ts
updateCapability(resourceId: string, dimension: string, value: CapabilityValue): void {
  const r = this.resources.get(resourceId);
  if (!r) return;
  const existing = r.capabilities[dimension];
  // 高优先级来源覆盖低优先级
  if (!existing || value.sourcePriority >= existing.sourcePriority) {
    r.capabilities[dimension] = value;
    // 触发漂移检测
    const alert = this.driftDetector.detect(resourceId, dimension, value.value);
    if (alert) {
      r.driftAlerts.push(alert);
    }
  }
}
```

### 验证方法

```bash
# 用一个不支持 tool calling 的模型发送工具请求
# 检查该模型的 toolCalling 能力是否被标记为 false (verified)
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8765/api/brain-status
```

---

## P2-1: 决策追踪 success 字段延迟更新

### 问题

REST API 返回的 `decision-trace` 中 `success` 为 `null`，因为决策追踪在决策完成后立即写入，
但执行结果是异步返回的。`recordLastOutcome()` 可能未被正确调用。

### 涉及文件

- `src/core/agent.ts` — 第 1287-1293 行

### 修复方案

确保在所有执行路径的出口处调用 `recordLastOutcome()`:

```typescript
// src/core/agent.ts — 在 handleUserMessage 的 try/catch 出口处
try {
  const result = await this.executeByPlan(ctx, plan);
  this.recordLastOutcome(true, undefined, result.latencyMs);  // ← 确保调用
  return result;
} catch (err) {
  this.recordLastOutcome(false, (err as Error).message);       // ← 确保调用
  throw err;
}
```

### 验证方法

```bash
# 发送消息后立即查询 decision-trace，success 字段不应为 null
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8765/api/decision-trace | \
  python3 -c "import json,sys; t=json.load(sys.stdin)['traces'][-1]; print(t['success'])"
# 期望: true 或 false，不应是 null
```

---

## P2-2: 余额不足级联失败防护

### 问题

API 余额不足时，Embedding 模型全部失败 → 记忆搜索不可用 → 知识管线退化 → 决策质量下降。
没有提前检测余额或优雅降级机制。

### 涉及文件

- `src/core/model-pool.ts` — 模型可用性判断
- `src/memory/store.ts` — Embedding 失败处理

### 修复方案

#### 1. 余额预检（启动时）

```typescript
// src/core/model-pool.ts — 在首次 refresh 后添加余额检测
async checkBalance(provider: string, apiKey: string): Promise<{ ok: boolean; balance?: number }> {
  try {
    // SiliconFlow 支持余额查询 API
    const resp = await fetch('https://api.siliconflow.cn/v1/user/info', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (resp.ok) {
      const data = await resp.json();
      return { ok: data.data?.balance > 0, balance: data.data?.balance };
    }
  } catch {}
  return { ok: true }; // 无法检测时假设正常
}
```

#### 2. Embedding 降级（记忆搜索）

```typescript
// src/memory/store.ts — embedMemory 失败时
async embedMemory(text: string): Promise<Float32Array | null> {
  try {
    return await this.embed(text);
  } catch (err) {
    if (err.message.includes('403') || err.message.includes('balance')) {
      // 标记 embedding 不可用，后续跳过 embedding 搜索
      this.embeddingAvailable = false;
      console.warn('[MemoryStore] Embedding 余额不足，降级到 FTS5 全文搜索');
      return null;
    }
    throw err;
  }
}

// 搜索时根据可用性选择路径
async search(query: string): Promise<Memory[]> {
  if (this.embeddingAvailable) {
    const embedding = await this.embedMemory(query);
    if (embedding) return this.vectorSearch(embedding);
  }
  // 降级到 FTS5
  return this.ftsSearch(query);
}
```

### 验证方法

```bash
# 用余额不足的 API key 启动，检查是否优雅降级而非刷错误
npx tsx src/start-ws.ts 2>&1 | grep -c "balance is insufficient"
# 期望: 1-2 次（初始检测），不应持续刷
```

---

## P2-3: 经验路由匹配精度优化

### 问题

"天气查询" 匹配到了 `seed_how_to`，"代码生成" 匹配到了 `seed_pip_install`。
seed 经验的粒度太粗，右脑直觉预测不够精确。

### 涉及文件

- `src/intelligence/seed-experiences.ts` — 种子经验定义
- `src/brain/right/prototype-memory.ts` — 原型匹配算法

### 修复方案

#### 1. 增加种子经验粒度

```typescript
// src/intelligence/seed-experiences.ts — 新增更细粒度的种子
const SEED_EXPERIENCES = [
  // 现有: seed_how_to (太粗)
  // 新增:
  { id: 'seed_weather_query', intent: 'weather', domains: ['web', 'weather'],
    tools: ['search_web'], confidence: 0.85 },
  { id: 'seed_code_sort', intent: 'code_sort', domains: ['code', 'algorithm'],
    tools: ['write_file'], confidence: 0.80 },
  { id: 'seed_code_generate', intent: 'code_generate', domains: ['code', 'file'],
    tools: ['write_file', 'run_code'], confidence: 0.75 },
  { id: 'seed_knowledge_ml', intent: 'knowledge_ml', domains: ['knowledge', 'ml'],
    tools: ['search_web'], confidence: 0.70 },
  ...
];
```

#### 2. 改进原型匹配的特征提取

```typescript
// src/brain/right/prototype-memory.ts
// 当前: 仅基于 domain 匹配
// 改进: 加入 intent 关键词 + 历史成功率权重

match(signal: TaskSignal, body: BodyState): PrototypeMatch | null {
  const candidates = this.prototypes.filter(p =>
    p.domains.some(d => signal.domains.includes(d))
  );

  // 新增: 按 domain 重叠率 + intent 关键词匹配度排序
  const scored = candidates.map(p => {
    const domainOverlap = p.domains.filter(d => signal.domains.includes(d)).length
      / Math.max(p.domains.length, signal.domains.length);
    const intentKeywordMatch = this.matchIntentKeywords(signal.content ?? '', p);
    const successWeight = p.stats.successes / Math.max(1, p.stats.totalCalls);
    return {
      prototype: p,
      score: domainOverlap * 0.4 + intentKeywordMatch * 0.4 + successWeight * 0.2,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0.5 ? scored[0] : null;
}
```

---

## P3: 决策追踪增强

### 问题

决策追踪缺少三脑内部信号的详细信息（小脑状态、右脑匹配、左脑法则命中）。

### 涉及文件

- `src/core/agent.ts` — 决策追踪写入

### 修复方案

扩展决策追踪结构:

```typescript
// src/core/agent.ts
this.decisionTrace.push({
  traceId,
  timestamp: Date.now(),
  input: content.slice(0, 200),
  domains: signal.domains,
  complexity: signal.complexity,
  mode: decision.plan.mode,
  reason: decision.plan.reason,
  nodes: decision.plan.selectedNodes.map(n => n.id),
  path,
  latencyMs,
  success: null,

  // 新增: 三脑内部信号
  brain: {
    law: decision.plan.law,
    lawName: decision.plan.lawName,
    bodyState: {
      energy: decision.bodyState.energy,
      temperature: decision.bodyState.temperature,
      focusLevel: decision.bodyState.focusLevel,
    },
    intuition: decision.intuition ? {
      hit: decision.intuition.hit,
      intentCategory: decision.intuition.intent.category,
      intentConfidence: decision.intuition.intent.confidence,
      qualityEstimate: decision.intuition.qualityEstimate,
      protoMatch: decision.intuition.protoMatch?.prototype.label,
    } : null,
    deliberation: decision.deliberationResult ? {
      action: decision.deliberationResult.action,
      confidence: decision.deliberationResult.confidence,
    } : null,
    homeostasisActions: decision.homeostasisActions.map(a => a.type),
  },
});
```

---

## 实施计划

| 阶段 | 任务 | 预计工时 | 验收标准 |
|------|------|----------|----------|
| Phase 1 | P0-1 + P0-2 | 2h | 启动日志 0 条非法转换警告 |
| Phase 2 | P1-1 + P1-2 | 4h | 执行失败后画像 success/failures 更新 |
| Phase 3 | P2-1 + P2-2 | 3h | decision-trace.success 非 null；余额不足优雅降级 |
| Phase 4 | P2-3 | 4h | 经验路由匹配准确率提升 20% |
| Phase 5 | P3 | 2h | 决策追踪包含三脑内部信号 |

**总预计工时: 15h**

---

## 依赖关系

```
P0-1 ──→ P0-2 ──→ P1-1 ──→ P1-2
                                  ──→ P2-1
                                  ──→ P2-2
                                  ──→ P2-3 ──→ P3
```

P0-1 和 P0-2 可并行开发。P1 依赖 P0 完成（状态机修正后才能正确回写画像）。
P2 各项可并行。P3 依赖 P2-3（经验路由优化后追踪才有意义）。
