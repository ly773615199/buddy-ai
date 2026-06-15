# 资源画像 & 三脑决策 修复计划

> 基于 2026-06-15 运行轨迹分析报告生成
> 优先级: P0(立即修复) → P1(本周) → P2(迭代优化) → P3(体验优化) → O1~O6(系统级优化)

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

## O1: 资源推荐算法优化（综合评分）

### 现状

`UnifiedResourceHub.recommend()` 仅按 taskType + domain 匹配 + 健康度排序，评分公式简单：

```typescript
score = taskTypeMatch * 50 + domainMatch * 30 + healthScore * 0.2
```

### 问题

- 未考虑模型能力（toolCalling/vision/streaming）是否匹配任务需求
- 未考虑成本约束（用户可能设置了 maxCostPer1k）
- 未考虑延迟偏好（实时对话 vs 后台任务）
- 未引入三脑的 BodyState（高负载时应选轻量模型）

### 优化方案

```typescript
// src/brain/hub/unified-resource-hub.ts
recommend(taskType: string, domain?: string, type?: ResourceType, context?: {
  requiresToolCalling?: boolean;
  requiresVision?: boolean;
  maxCostPer1k?: number;
  latencyTolerance?: 'low' | 'medium' | 'high';
  bodyState?: { load: number; energy: number };
}): UnifiedResource[] {
  const candidates = this.getActive(type);

  const scored = candidates.map(r => {
    let score = 0;

    // 1. 任务类型匹配 (0-40分)
    const typeStats = r.stats.byTaskType[taskType];
    if (typeStats && typeStats.attempts > 0) {
      score += (typeStats.successes / typeStats.attempts) * 40;
    }

    // 2. 领域匹配 (0-20分)
    if (domain) {
      const domainStats = r.stats.byDomain[domain];
      if (domainStats && domainStats.attempts > 0) {
        score += (domainStats.successes / domainStats.attempts) * 20;
      }
    }

    // 3. 能力匹配 (0-20分) — 新增
    if (context?.requiresToolCalling && r.capabilities.toolCalling?.value) score += 10;
    if (context?.requiresVision && r.capabilities.vision?.value) score += 10;
    if (!context?.requiresToolCalling && !context?.requiresVision) score += 10; // 无特殊需求

    // 4. 成本约束 (0-10分) — 新增
    if (context?.maxCostPer1k) {
      const cost = (r.metadata.costPer1kInput as number) ?? 0;
      if (cost <= context.maxCostPer1k) score += 10;
      else score += Math.max(0, 10 - (cost - context.maxCostPer1k) * 2);
    } else {
      score += 5; // 无成本约束时给中等分
    }

    // 5. 延迟适配 (0-5分) — 新增
    if (context?.latencyTolerance === 'low' && r.stats.avgLatencyMs < 2000) score += 5;
    else if (context?.latencyTolerance === 'high') score += 5;
    else if (r.stats.avgLatencyMs < 5000) score += 3;

    // 6. 系统负载适配 (0-5分) — 新增
    if (context?.bodyState) {
      const { load, energy } = context.bodyState;
      // 高负载时偏好轻量模型（avgLatencyMs 低的）
      if (load > 70 && r.stats.avgLatencyMs < 3000) score += 5;
      // 低能量时偏好可靠模型（成功率高的）
      if (energy < 30 && typeStats && typeStats.attempts > 5) {
        const sr = typeStats.successes / typeStats.attempts;
        if (sr > 0.9) score += 5;
      }
    }

    // 7. 健康度 (0-10分)
    score += r.healthScore * 0.1;

    return { resource: r, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.resource);
}
```

### 涉及文件

- `src/brain/hub/unified-resource-hub.ts` — `recommend()` 方法
- `src/brain/left/scheduler.ts` — 调用 recommend 时传入 context

### 验收标准

- 需要 toolCalling 的任务优先选中 toolCalling=true 的模型
- 高负载时自动选择轻量模型
- 推荐结果可追溯（日志输出评分 breakdown）

---

## O2: DriftDetector 参数调优

### 现状

滑动窗口 20、warning 阈值 0.3、critical 阈值 0.6。这些参数对所有资源类型统一使用。

### 问题

- 模型能力变化慢（7天探测一次），窗口 20 需要 140 天才能填满 → 漂移检测几乎不触发
- 工具变化快（每次调用都更新），窗口 20 太小 → 频繁告警
- 布尔值和数值用同一阈值不合理

### 优化方案

```typescript
// src/brain/hub/drift-detector.ts
interface DriftDetectorConfig {
  // 按资源类型配置不同参数
  model: { windowSize: number; warningThreshold: number; criticalThreshold: number };
  tool: { windowSize: number; warningThreshold: number; criticalThreshold: number };
  default: { windowSize: number; warningThreshold: number; criticalThreshold: number };
}

const DEFAULT_CONFIG: DriftDetectorConfig = {
  model:  { windowSize: 10, warningThreshold: 0.4, criticalThreshold: 0.7 },  // 模型: 大窗口低敏感
  tool:   { windowSize: 30, warningThreshold: 0.2, criticalThreshold: 0.5 },  // 工具: 小窗口高敏感
  default:{ windowSize: 20, warningThreshold: 0.3, criticalThreshold: 0.6 },
};

// detect() 方法增加 resourceType 参数
detect(resourceId: string, dimension: string, newValue: boolean | number | string,
       timestamp: number, resourceType?: ResourceType): DriftAlert | null {
  const config = this.config[resourceType ?? 'default'];
  // 使用对应配置...
}
```

### 涉及文件

- `src/brain/hub/drift-detector.ts` — 配置参数化
- `src/brain/hub/unified-resource-hub.ts` — 传递 resourceType

### 验收标准

- 模型能力漂移在合理时间内触发告警
- 工具漂移不会因短期波动频繁告警

---

## O3: MarginalAuditor 审计频率优化

### 现状

`MarginalAuditor` 需要外部手动调用 `runAndApply()`，没有自动调度。
`UnifiedResourceHub.runAudit()` 也是手动触发。

### 问题

- 审计不执行 → deprecated 资源永远不会被淘汰或复活
- 没有按资源类型区分审计频率（模型变化慢，工具变化快）

### 优化方案

```typescript
// src/brain/hub/marginal-auditor.ts
export class MarginalAuditor {
  private auditTimer: ReturnType<typeof setInterval> | null = null;

  // 新增: 启动自动审计
  startAutoAudit(): void {
    // 每小时审计一次模型，每 30 分钟审计一次工具
    this.auditTimer = setInterval(() => {
      this.runAndApply('chat');     // 按 chat 任务类型审计
      this.runAndApply('tools');    // 按 tools 任务类型审计
    }, 60 * 60 * 1000); // 1 小时
  }

  stopAutoAudit(): void {
    if (this.auditTimer) {
      clearInterval(this.auditTimer);
      this.auditTimer = null;
    }
  }
}

// src/core/subsystems.ts — 在初始化时启动
if (sys.marginalAuditor) {
  sys.marginalAuditor.startAutoAudit();
}
```

### 涉及文件

- `src/brain/hub/marginal-auditor.ts` — 自动审计调度
- `src/core/subsystems.ts` — 启动自动审计

### 验收标准

- deprecated 资源在边际贡献恢复时自动复活
- 低贡献资源被自动淘汰

---

## O4: Thompson Sampling 探索参数优化

### 现状

`Scheduler` 使用 Thompson Sampling 做模型选择，但 `explorationFactor = 1.0`（无额外探索）。

### 问题

- 冷启动时所有模型的 α=β=1（均匀分布），选模近乎随机
- 没有区分"探索新模型"和"利用已知好模型"的阶段
- 用户纠正次数（userCorrectionCount）未反馈到探索系数

### 优化方案

```typescript
// src/brain/left/scheduler.ts
interface SchedulerConfig {
  // ... 现有字段
  /** 冷启动探索系数（前 N 次决策时使用） */
  coldStartExplorationFactor: number;
  /** 冷启动阈值（决策次数低于此值时使用冷启动探索） */
  coldStartThreshold: number;
  /** 用户纠正后增加探索 */
  correctionExplorationBoost: number;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  // ... 现有默认值
  coldStartExplorationFactor: 2.0,  // 冷启动时探索更激进
  coldStartThreshold: 20,
  correctionExplorationBoost: 0.5,  // 每次纠正增加 0.5 探索系数
};

// 在 selectModel 中:
getExplorationFactor(decisionCount: number, userCorrectionCount: number): number {
  let factor = this.config.explorationFactor;

  // 冷启动阶段: 更激进探索
  if (decisionCount < this.config.coldStartThreshold) {
    factor = this.config.coldStartExplorationFactor;
  }

  // 用户纠正后: 增加探索
  factor += userCorrectionCount * this.config.correctionExplorationBoost;

  return Math.min(factor, 3.0); // 上限 3.0
}
```

### 涉及文件

- `src/brain/left/scheduler.ts` — 探索系数动态调整

### 验收标准

- 冷启动阶段模型选择更均匀（探索）
- 稳定后逐步收敛到最优模型（利用）
- 用户纠正后自动增加探索

---

## O5: 知识管线采集层优化

### 现状

`KnowledgeConvergence.converge()` 并行从所有源采集，超时 500ms。
三进制专家模型缺失时直接失败，无降级。

### 问题

- 500ms 超时对网络源太短，对本地源太长
- 三进制模型缺失时日志刷警告但无实际降级路径
- 采集结果未缓存，每次交互都重新采集

### 优化方案

```typescript
// src/intelligence/knowledge-convergence.ts
interface ConvergenceConfig {
  // 按源类型配置不同超时
  localTimeoutMs: number;    // 本地源: 100ms
  networkTimeoutMs: number;  // 网络源: 2000ms
  ternaryTimeoutMs: number;  // 三进制: 200ms（快速失败）
  // 结果缓存
  cacheTtlMs: number;        // 缓存有效期: 5 分钟
  maxCacheSize: number;      // 最大缓存条目: 100
}

// 新增: 采集结果缓存
private cache = new Map<string, { nodes: KnowledgeNode[]; timestamp: number }>();

async converge(input: string, options?: ConvergeOptions): Promise<KnowledgeNode[]> {
  // 1. 检查缓存
  const cacheKey = this.buildCacheKey(input);
  const cached = this.cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < this.config.cacheTtlMs) {
    return cached.nodes;
  }

  // 2. 按源类型分组并行，不同超时
  const [localNodes, networkNodes] = await Promise.all([
    this.collectLocal(input, this.config.localTimeoutMs),
    this.collectNetwork(input, this.config.networkTimeoutMs),
  ]);

  // 3. 三进制快速失败（不阻塞）
  let ternaryNodes: KnowledgeNode[] = [];
  try {
    ternaryNodes = await this.collectTernary(input, this.config.ternaryTimeoutMs);
  } catch { /* 静默 */ }

  const nodes = [...localNodes, ...networkNodes, ...ternaryNodes];

  // 4. 写入缓存
  this.cache.set(cacheKey, { nodes, timestamp: Date.now() });
  if (this.cache.size > this.config.maxCacheSize) {
    const oldest = [...this.cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    this.cache.delete(oldest[0]);
  }

  return nodes;
}
```

### 涉及文件

- `src/intelligence/knowledge-convergence.ts` — 采集层优化

### 验收标准

- 本地采集 < 100ms，网络采集 < 2s
- 三进制缺失时不刷警告
- 相同输入 5 分钟内命中缓存

---

## O6: 资源画像可视化仪表盘（前端）

### 现状

前端有 `CognitiveDashboard.tsx` 和 `PetStats.tsx`，但没有资源画像的专门可视化。

### 优化方案

新增 REST API + 前端组件，展示资源画像实时状态：

#### 后端 API

```typescript
// src/core/rest-api.ts
// GET /api/resource-profiles — 资源画像概览
eb.addRoute('GET', '/api/resource-profiles', (_req, res) => {
  const hub = sys.resourceSystem?.hub;
  if (!hub) { json(res, 200, { resources: [] }); return; }

  const all = hub.getAll();
  const profiles = all.map(r => ({
    id: r.id,
    type: r.type,
    name: r.name,
    state: r.state,
    healthScore: r.healthScore,
    stats: {
      totalCalls: r.stats.totalCalls,
      successRate: r.stats.totalCalls > 0
        ? (r.stats.successes / r.stats.totalCalls * 100).toFixed(1) + '%'
        : 'N/A',
      avgLatencyMs: Math.round(r.stats.avgLatencyMs),
    },
    capabilities: Object.fromEntries(
      Object.entries(r.capabilities).map(([k, v]) => [k, {
        value: v.value,
        verified: v.verified,
      }])
    ),
    driftAlerts: r.driftAlerts.filter(a => a.timestamp > Date.now() - 3600_000).length,
    marginalDelta: r.marginalContribution?.smoothedDelta?.toFixed(3) ?? 'N/A',
  }));

  json(res, 200, {
    total: profiles.length,
    byState: hub.getHealthSummary().byState,
    byType: hub.getHealthSummary().byType,
    resources: profiles,
  });
});

// GET /api/resource-profiles/:id/timeline — 资源能力时间线
eb.addRoute('GET', '/api/resource-profiles/:id/timeline', (req, res) => {
  const id = decodeURIComponent(req.url!.split('/timeline')[0].split('/').pop()!);
  const graph = new CapabilityGraph(sys.resourceSystem!.hub);
  const timeline = graph.getTimeline(id);
  const profile = graph.getCapabilityProfile(id);
  json(res, 200, { id, timeline, profile });
});
```

#### 前端组件

```tsx
// frontend/src/components/ResourceProfilePanel.tsx
export function ResourceProfilePanel() {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [filter, setFilter] = useState<'all' | ResourceType>('all');

  useEffect(() => {
    fetch('/api/resource-profiles')
      .then(r => r.json())
      .then(data => setProfiles(data.resources));
  }, []);

  const filtered = filter === 'all' ? profiles : profiles.filter(p => p.type === filter);

  return (
    <div className="resource-profile-panel">
      <h3>📊 资源画像</h3>
      <div className="filters">
        {['all', 'model', 'tool', 'knowledge_source', 'platform', 'tts', 'skill'].map(t => (
          <button key={t} onClick={() => setFilter(t as any)}
                  className={filter === t ? 'active' : ''}>
            {t === 'all' ? '全部' : t} ({profiles.filter(p => t === 'all' || p.type === t).length})
          </button>
        ))}
      </div>
      <div className="resource-grid">
        {filtered.map(r => (
          <ResourceCard key={r.id} resource={r} />
        ))}
      </div>
    </div>
  );
}

function ResourceCard({ resource }: { resource: any }) {
  const stateColor = {
    active: '#4caf50', degraded: '#ff9800', deprecated: '#f44336',
    discovered: '#2196f3', rejected: '#9e9e9e', deceased: '#616161',
  }[resource.state] ?? '#9e9e9e';

  return (
    <div className="resource-card" style={{ borderLeft: `4px solid ${stateColor}` }}>
      <div className="resource-header">
        <span className="resource-type">{resource.type}</span>
        <span className="resource-state" style={{ color: stateColor }}>{resource.state}</span>
      </div>
      <div className="resource-name">{resource.name}</div>
      <div className="resource-stats">
        <span>调用: {resource.stats.totalCalls}</span>
        <span>成功率: {resource.stats.successRate}</span>
        <span>延迟: {resource.stats.avgLatencyMs}ms</span>
      </div>
      <div className="health-bar">
        <div className="health-fill" style={{
          width: `${resource.healthScore}%`,
          backgroundColor: resource.healthScore >= 70 ? '#4caf50' :
                           resource.healthScore >= 30 ? '#ff9800' : '#f44336',
        }} />
      </div>
      {resource.driftAlerts > 0 && (
        <span className="drift-badge">⚠️ {resource.driftAlerts} 漂移</span>
      )}
    </div>
  );
}
```

### 涉及文件

- `src/core/rest-api.ts` — 新增 2 个 API
- `frontend/src/components/ResourceProfilePanel.tsx` — 新增组件
- `frontend/src/App.tsx` — 集成到主界面

### 验收标准

- 前端可实时查看所有资源的画像状态
- 支持按类型筛选、按状态排序
- 健康度进度条颜色变化直观

---

## 实施计划（更新）

| 阶段 | 任务 | 预计工时 | 验收标准 |
|------|------|----------|----------|
| Phase 1 | P0-1 + P0-2 | 2h | 启动日志 0 条非法转换警告 |
| Phase 2 | P1-1 + P1-2 | 4h | 执行失败后画像 success/failures 更新 |
| Phase 3 | P2-1 + P2-2 | 3h | decision-trace.success 非 null；余额不足优雅降级 |
| Phase 4 | P2-3 + O1 | 6h | 经验路由匹配准确率 +20%；推荐结果可追溯 |
| Phase 5 | O2 + O3 | 3h | 漂移检测按资源类型区分；审计自动执行 |
| Phase 6 | O4 + O5 | 4h | 冷启动探索优化；知识管线缓存 |
| Phase 7 | P3 + O6 | 5h | 决策追踪增强 + 资源画像仪表盘 |

**总预计工时: 27h**（原 15h + 优化 12h）

---

## 依赖关系

```
P0-1 ──→ P0-2 ──→ P1-1 ──→ P1-2 ──→ O1(推荐算法)
                    │                  ──→ O2(漂移调优)
                    │                  ──→ O3(审计频率)
                    └──→ P2-1 ──→ O4(Thompson调优)
                         P2-2 ──→ O5(知识管线缓存)
                         P2-3 ──→ P3(追踪增强) ──→ O6(仪表盘)
```

- **Phase 1-3**: 修复基础问题（必须先完成）
- **Phase 4-6**: 系统级优化（可并行）
- **Phase 7**: 体验优化（依赖基础修复完成）
