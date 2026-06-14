# 统一资源生命周期管理方案

> 日期：2026-06-14 | 基于项目现状 + 业界研究

## 核心思想

**三个来源的融合：**

1. **SLIM 框架**（港中文 2026.05）— 技能/资源有生命周期，通过边际贡献审计动态决定 retain / retire / expand
2. **熔断器模式**（Circuit Breaker）— 三态健康机：Closed → Open → Half-Open，自动降级与恢复
3. **能力漂移检测**（Capability Drift Detection）— 资源的能力不是静态的，会随时间变化，需要时序监控

**一句话：** 每个资源从注册到消亡，都有一个状态机驱动的生命周期，能力变化被持续追踪，价值被周期性审计。

---

## 一、统一资源生命周期状态机

所有资源类型共用同一套生命周期状态机：

```
                    ┌──────────────────────────────────────┐
                    │                                      │
                    ▼                                      │
  ┌─────────┐   probe    ┌────────┐   连续失败   ┌──────────────┐
  │discovered│──────────►│ active │─────────────►│  degraded    │
  └─────────┘   通过     └────────┘              └──────────────┘
       │            │        │  ▲                     │  ▲
       │            │        │  │                     │  │
       │            │        │  │  恢复探测通过        │  │  恢复探测通过
       │            │        │  └─────────────────────┘  │
       │            │        │                           │
       │            │        │  长期低价值               │
       │            │        │  (SLIM audit)            │
       │            │        ▼                           │
       │            │  ┌──────────────┐                  │
       │            │  │  deprecated  │◄─────────────────┘
       │            │  └──────────────┘    连续失败超阈值
       │            │        │
       │            │        │  清理
       │            │        ▼
       │            │  ┌──────────┐
       │            │  │ deceased │  ← 从注册表移除，保留历史
       │            │  └──────────┘
       │            │
       │  probe失败  │
       │  ─────────►│
       ▼            ▼
  ┌──────────────┐
  │  rejected    │  ← 首次探测就失败，不进入 active
  └──────────────┘
```

### 状态定义

| 状态 | 含义 | 允许操作 |
|------|------|----------|
| `discovered` | 刚被发现/注册，未经过任何验证 | 只能 probe |
| `active` | 探测通过，正常服务中 | serve, recordOutcome, audit |
| `degraded` | 能力下降或部分失败 | serve(降级), probe, recover |
| `deprecated` | 长期低价值或能力严重退化 | 只读，不参与调度 |
| `deceased` | 已消亡，保留历史数据 | 只读归档 |
| `rejected` | 首次验证失败 | 无操作 |

### 资源类型映射

```typescript
type ResourceType = 'model' | 'tool' | 'knowledge_source' | 'platform' | 'tts' | 'local_expert' | 'skill';

type LifecycleState = 'discovered' | 'active' | 'degraded' | 'deprecated' | 'deceased' | 'rejected';
```

---

## 二、能力画像（CapabilityProfile）

每个资源的"能力"不再是一个布尔值，而是一个**带时间序列的能力快照链**。

```typescript
interface CapabilitySnapshot {
  timestamp: number;
  source: 'probe' | 'runtime' | 'manual' | 'litellm' | 'hf';
  capabilities: Record<string, CapabilityValue>;
  confidence: number;        // 0-1，本次探测的置信度
  latencyMs: number;
  error?: string;
}

interface CapabilityValue {
  value: boolean | number | string;
  verified: boolean;         // 是否经过实测验证
  lastVerifiedAt: number;
  driftScore: number;        // 0-1，与历史值的偏离程度
}

interface CapabilityTimeline {
  resourceId: string;
  snapshots: CapabilitySnapshot[];  // 按时间排序，保留最近 N 个
  current: Record<string, CapabilityValue>;  // 当前最佳估计
  driftAlerts: DriftAlert[];
}
```

### 能力维度（按资源类型）

| 资源类型 | 探测维度 |
|----------|----------|
| **model** | reachable, toolCalling, vision, streaming, embedding, maxContext, maxOutput, latency |
| **tool (MCP)** | reachable, schemaValid, executionSuccess, latency |
| **tool (HTTP)** | endpointAlive, responseValid, latency, authValid |
| **knowledge_source** | accessible, dataFresh, responseQuality, latency |
| **platform** | tokenValid, webhookAlive, messageDelivery, latency |
| **tts** | serviceAlive, voiceAvailable, synthesisQuality, latency |
| **local_expert** | inferenceWorking, accuracyScore, latency |
| **skill** | installable, runnable, compatible, executionSuccess |

---

## 三、能力漂移检测

### 3.1 滑动窗口统计

对每个能力维度，维护一个滑动窗口（最近 N 次探测）：

```typescript
class DriftDetector {
  private window: CapabilitySnapshot[] = [];
  private readonly windowSize = 20;
  private readonly driftThreshold = 0.3;  // 漂移阈值

  /** 计算某维度的漂移分数 */
  computeDrift(dimension: string, newValue: boolean | number): number {
    const historical = this.window
      .map(s => s.capabilities[dimension])
      .filter(Boolean);

    if (historical.length < 3) return 0;  // 数据不足

    // 布尔值：计算翻转率
    if (typeof newValue === 'boolean') {
      const flips = historical.filter(h => h.value !== newValue).length;
      return flips / historical.length;
    }

    // 数值：计算变异系数
    const values = historical.map(h => h.value as number);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const stdDev = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
    return mean > 0 ? stdDev / mean : 0;
  }

  /** 检测是否发生漂移 */
  detectDrift(dimension: string, newValue: boolean | number): DriftAlert | null {
    const score = this.computeDrift(dimension, newValue);
    if (score > this.driftThreshold) {
      return {
        dimension,
        driftScore: score,
        timestamp: Date.now(),
        severity: score > 0.6 ? 'critical' : score > 0.3 ? 'warning' : 'info',
        message: `${dimension} 发生漂移 (score=${score.toFixed(2)})`,
      };
    }
    return null;
  }
}
```

### 3.2 漂移触发动作

| 漂移程度 | 动作 |
|----------|------|
| `info` (0-0.3) | 记录日志，不影响调度 |
| `warning` (0.3-0.6) | 触发一次额外探测验证，通知 ResourceHub |
| `critical` (>0.6) | 标记 `degraded`，触发重新探测，从调度候选中降权 |

---

## 四、边际价值审计（SLIM 启发）

周期性评估每个资源的边际贡献，决定 retain / retire / expand。

### 4.1 边际贡献计算

```typescript
interface MarginalContribution {
  resourceId: string;
  // 有这个资源时的任务成功率
  performanceWith: number;
  // 没有这个资源时的任务成功率（从历史数据估算）
  performanceWithout: number;
  // 边际贡献 = with - without
  delta: number;
  // 指数滑动平均
  smoothedDelta: number;
  // 样本数
  sampleCount: number;
}

class MarginalAuditor {
  private readonly alpha = 0.3;  // EMA 衰减系数
  private readonly retainThreshold = 0.05;   // 保留阈值
  private readonly retireThreshold = -0.05;  // 淘汰阈值

  /** 
   * 估算资源 s 的边际贡献
   * 
   * 方法：从 DecisionRecorder 中找到使用了 s 的任务和未使用 s 的同类任务，
   * 比较成功率差异。
   */
  estimateContribution(resourceId: string, taskType: string): MarginalContribution {
    const withResource = this.getOutcomes(resourceId, taskType, true);
    const withoutResource = this.getOutcomes(resourceId, taskType, false);

    const perfWith = withResource.length > 0
      ? withResource.filter(o => o.success).length / withResource.length
      : 0.5;
    const perfWithout = withoutResource.length > 0
      ? withoutResource.filter(o => o.success).length / withoutResource.length
      : 0.5;

    const delta = perfWith - perfWithout;

    return {
      resourceId,
      performanceWith: perfWith,
      performanceWithout: perfWithout,
      delta,
      smoothedDelta: delta,  // 需要与历史 EMA 合并
      sampleCount: withResource.length + withoutResource.length,
    };
  }

  /** 审计决策 */
  audit(mc: MarginalContribution): 'retain' | 'retire' | 'expand' | 'observe' {
    if (mc.sampleCount < 10) return 'observe';  // 样本不足
    if (mc.smoothedDelta >= this.retainThreshold) return 'retain';
    if (mc.smoothedDelta < this.retireThreshold) return 'retire';
    return 'observe';  // 边界情况，继续观察
  }
}
```

### 4.2 审计触发时机

- **定期审计**：每日凌晨（低峰期），对所有 active 资源执行
- **事件驱动审计**：资源连续失败 3 次后触发单资源审计
- **用户反馈驱动**：用户标记"回答不好"时，追溯到涉及的资源并审计

---

## 五、统一探测架构

### 5.1 探测器接口

```typescript
interface ResourceProber<T> {
  /** 探测资源能力 */
  probe(resource: T): Promise<CapabilitySnapshot>;
  /** 探测频率（ms） */
  probeIntervalMs: number;
  /** 探测超时（ms） */
  probeTimeoutMs: number;
  /** 是否需要凭据 */
  requiresCredentials: boolean;
}
```

### 5.2 各资源类型的探测器实现

```
src/core/probers/
├── model-prober.ts          // 已有 capability-prober.ts，扩展
├── mcp-tool-prober.ts       // 新增：MCP 工具连通性 + schema 验证
├── http-tool-prober.ts      // 新增：HTTP 端点存活 + 响应验证
├── knowledge-prober.ts      // 新增：知识源可达性 + 数据新鲜度
├── platform-prober.ts       // 新增：平台 token 有效性 + webhook 存活
├── tts-prober.ts            // 新增：TTS 服务存活 + 音色验证
├── local-expert-prober.ts   // 新增：本地专家推理验证
└── skill-prober.ts          // 新增：技能可执行性验证
```

### 5.3 批量调度器（BatchProbeScheduler）

```typescript
class BatchProbeScheduler {
  private probers: Map<ResourceType, ResourceProber<any>>;
  private concurrency = 3;
  private delayBetweenMs = 500;

  /** 调度策略 */
  async scheduleProbe(resources: UnifiedResource[]): Promise<void> {
    // 1. 按优先级排序：degraded > discovered > active（定期刷新）
    const sorted = this.prioritize(resources);

    // 2. 并发控制
    const batches = this.chunk(sorted, this.concurrency);
    for (const batch of batches) {
      await Promise.allSettled(batch.map(r => this.probeOne(r)));
      await this.sleep(this.delayBetweenMs);
    }
  }

  /** 触发条件 */
  // - 资源首次注册 → discovered → 立即 probe
  // - 资源调用失败 → 触发单个 probe
  // - 定期刷新 → 每日低峰期全量 probe
  // - 能力漂移 → 触发单个 probe 验证
}
```

---

## 六、ResourceHub 升级

现有 `ResourceHub` 需要扩展以支持完整的生命周期：

```typescript
class UnifiedResourceHub {
  // === 生命周期管理 ===
  private resources: Map<string, UnifiedResource>;
  private lifecycle: LifecycleManager;
  private driftDetector: Map<string, DriftDetector>;
  private auditor: MarginalAuditor;

  /** 注册资源 → 进入 discovered 状态 */
  register(def: ResourceDefinition): UnifiedResource {
    const resource: UnifiedResource = {
      id: def.id,
      type: def.type,
      name: def.name,
      state: 'discovered',
      capabilities: {},
      capabilityTimeline: [],
      stats: { totalCalls: 0, successes: 0, failures: 0, avgLatencyMs: 0, totalCost: 0 },
      healthScore: 50,  // discovered 初始分
      marginalContribution: null,
      createdAt: Date.now(),
      lastStateChange: Date.now(),
      probeHistory: [],
    };
    this.resources.set(resource.id, resource);

    // 立即触发首次探测
    this.scheduler.scheduleProbe(resource);

    return resource;
  }

  /** 探测结果回调 → 更新能力 + 状态 */
  onProbeResult(resourceId: string, snapshot: CapabilitySnapshot): void {
    const r = this.resources.get(resourceId);
    if (!r) return;

    // 1. 记录能力快照
    r.capabilityTimeline.push(snapshot);
    if (r.capabilityTimeline.length > 50) r.capabilityTimeline.shift();

    // 2. 检测漂移
    for (const [dim, val] of Object.entries(snapshot.capabilities)) {
      const detector = this.getOrCreateDriftDetector(resourceId);
      const alert = detector.detectDrift(dim, val.value);
      if (alert) {
        r.driftAlerts.push(alert);
        if (alert.severity === 'critical') {
          this.lifecycle.transition(r, 'degraded');
        }
      }
    }

    // 3. 更新当前能力（加权：probe > runtime > static）
    this.mergeCapabilities(r, snapshot);

    // 4. 状态转换
    if (snapshot.error) {
      this.lifecycle.onProbeFailed(r);
    } else {
      this.lifecycle.onProbeSucceeded(r);
    }
  }

  /** 执行反馈 → 更新统计 + 健康度 */
  recordOutcome(resourceId: string, outcome: ResourceOutcome): void {
    const r = this.resources.get(resourceId);
    if (!r) return;

    // 更新统计
    const s = r.stats;
    s.totalCalls++;
    if (outcome.success) s.successes++;
    else s.failures++;
    s.avgLatencyMs = (s.avgLatencyMs * (s.totalCalls - 1) + outcome.latencyMs) / s.totalCalls;
    s.totalCost += outcome.cost ?? 0;

    // 健康度重算
    this.recalculateHealth(r);

    // 连续失败 → 状态降级
    if (!outcome.success) {
      r.consecutiveFailures = (r.consecutiveFailures ?? 0) + 1;
      if (r.consecutiveFailures >= 3) {
        this.lifecycle.transition(r, 'degraded');
      }
    } else {
      r.consecutiveFailures = 0;
    }
  }

  /** 周期性审计 → retain / retire / expand */
  async runAudit(): Promise<AuditReport> {
    const report: AuditReport = { retained: [], retired: [], expanded: [], observed: [] };

    for (const r of this.resources.values()) {
      if (r.state !== 'active' && r.state !== 'degraded') continue;

      const mc = this.auditor.estimateContribution(r.id, 'overall');
      const decision = this.auditor.audit(mc);

      switch (decision) {
        case 'retain':
          report.retained.push(r.id);
          break;
        case 'retire':
          this.lifecycle.transition(r, 'deprecated');
          report.retired.push(r.id);
          break;
        case 'expand':
          report.expanded.push(r.id);
          // 触发能力扩展探测
          break;
        case 'observe':
          report.observed.push(r.id);
          break;
      }
    }

    return report;
  }
}
```

---

## 七、生命周期管理器

```typescript
class LifecycleManager {
  /** 合法状态转换 */
  private transitions: Record<LifecycleState, LifecycleState[]> = {
    discovered:  ['active', 'rejected'],
    active:      ['degraded', 'deprecated'],
    degraded:    ['active', 'deprecated'],
    deprecated:  ['deceased', 'active'],  // 可以"复活"
    deceased:    [],  // 终态
    rejected:    ['discovered'],  // 可以重新探测
  };

  transition(resource: UnifiedResource, target: LifecycleState): boolean {
    const allowed = this.transitions[resource.state];
    if (!allowed.includes(target)) {
      console.warn(`[Lifecycle] 非法转换: ${resource.state} → ${target} (${resource.id})`);
      return false;
    }

    const from = resource.state;
    resource.state = target;
    resource.lastStateChange = Date.now();

    // 发出事件
    this.emit('lifecycle_transition', { resourceId: resource.id, from, to: target });

    // 触发副作用
    this.onTransition(resource, from, target);

    return true;
  }

  private onTransition(resource: UnifiedResource, from: LifecycleState, to: LifecycleState): void {
    // active → degraded: 从调度候选降权
    if (from === 'active' && to === 'degraded') {
      this.emit('resource_degraded', { resourceId: resource.id });
    }

    // degraded → active: 恢复调度权重
    if (from === 'degraded' && to === 'active') {
      this.emit('resource_recovered', { resourceId: resource.id });
    }

    // * → deprecated: 从调度候选移除
    if (to === 'deprecated') {
      this.emit('resource_deprecated', { resourceId: resource.id });
    }

    // deprecated → deceased: 清理资源占用
    if (to === 'deceased') {
      this.emit('resource_deceased', { resourceId: resource.id });
      this.cleanup(resource);
    }
  }
}
```

---

## 八、能力变化图谱（可视化）

每个资源维护一条完整的能力变化时间线，支持可视化查询：

```typescript
interface CapabilityGraph {
  /** 获取资源的能力变化历史 */
  getTimeline(resourceId: string, from?: number, to?: number): CapabilitySnapshot[];

  /** 获取某维度的变化趋势 */
  getTrend(resourceId: string, dimension: string): Array<{ t: number; v: number }>;

  /** 获取漂移事件 */
  getDriftAlerts(resourceId: string, severity?: string): DriftAlert[];

  /** 获取状态转换历史 */
  getStateHistory(resourceId: string): Array<{ from: LifecycleState; to: LifecycleState; at: number }>;

  /** 全局概览 */
  getOverview(): {
    total: number;
    byState: Record<LifecycleState, number>;
    byType: Record<ResourceType, number>;
    recentDrifts: DriftAlert[];
    healthDistribution: { healthy: number; degraded: number; unhealthy: number };
  };
}
```

---

## 九、与现有架构的整合点

| 现有组件 | 整合方式 |
|----------|----------|
| `ResourceHub` | **升级为 `UnifiedResourceHub`**，增加生命周期 + 漂移 + 审计 |
| `CapabilityProber` | **保留并扩展**，作为 model prober 的实现 |
| `ModelHealthProber` | **合并到 BatchProbeScheduler**，成为 model 类型的定期探测 |
| `LocalServiceProber` | **合并**，成为 discovered 阶段的初始探测 |
| `ModelPoolResourceBridge` | **保留**，负责 ModelPool ↔ ResourceHub 双向同步 |
| `DecisionRecorder` | **作为审计数据源**，提供边际贡献计算的原始数据 |
| `LaunchReadiness` | **扩展**，启动时检查所有资源的 discovered → active 转换 |
| `ModelKnowledge` | **作为静态数据源 L2.5**，优先级低于 probe 高于 HF |

---

## 十、实现路径

| 阶段 | 内容 | 工作量 | 依赖 |
|------|------|--------|------|
| **P0** | 统一资源类型定义 + LifecycleManager 状态机 | 1 天 | 无 |
| **P1** | UnifiedResourceHub 替代 ResourceHub | 2 天 | P0 |
| **P2** | 各资源探测器实现（model 扩展 + 其他 6 类新增） | 3 天 | P0 |
| **P3** | BatchProbeScheduler 批量调度 | 1 天 | P2 |
| **P4** | DriftDetector 能力漂移检测 | 1 天 | P1 |
| **P5** | MarginalAuditor 边际价值审计 | 1 天 | P1 |
| **P6** | CapabilityGraph 可视化接口 | 1 天 | P1 |
| **P7** | 与 ModelPool/Scheduler/Orchestrator 联调 | 2 天 | P1-P6 |

**总计：约 12 天**

### 优先级建议

先做 **P0 + P1 + P2(model)** — 这部分与现有的 RESOURCE_PROFILE_PROBE_PLAN.md 对齐，可以直接扩展。

然后做 **P2(其他资源)** — 补全工具/知识源/平台/TTS 的探测能力。

最后做 **P3-P7** — 调度优化 + 漂移检测 + 审计 + 可视化。

---

## 十一、数据流全景

```
用户添加 Provider / 工具 / 知识源
         │
         ▼
  UnifiedResourceHub.register()
         │ state: discovered
         ▼
  BatchProbeScheduler.scheduleProbe()
         │
         ▼
  ┌──────────────────┐
  │ ResourceProber    │
  │ (model/mcp/http/  │
  │  knowledge/tts/..)│
  └──────────────────┘
         │
         ▼ CapabilitySnapshot
  UnifiedResourceHub.onProbeResult()
         │
         ├──► DriftDetector.detectDrift()
         │         │
         │         ▼ DriftAlert (if any)
         │
         ├──► mergeCapabilities() → 更新 current
         │
         ├──► LifecycleManager.transition()
         │         │
         │         ▼ 状态变更事件
         │
         └──► 持久化到 SQLite
                   │
                   ▼
  ┌──────────────────────────┐
  │ CapabilityGraph           │
  │ (timeline + trend + drift)│
  └──────────────────────────┘
                   │
  ┌──────────────────────────┐
  │ MarginalAuditor           │
  │ (每日审计 retain/retire)  │
  └──────────────────────────┘
                   │
                   ▼
  ModelPool / Scheduler / Orchestrator
  (根据资源状态做调度决策)
```

---

## 十二、与 SLIM 论文的对应关系

| SLIM 概念 | 本方案对应 |
|-----------|-----------|
| 活跃技能集 A_t | `UnifiedResourceHub.getActive()` |
| 边际贡献 Δ_t(s) | `MarginalAuditor.estimateContribution()` |
| 保留阈值 τ_keep | `retainThreshold = 0.05` |
| 淘汰阈值 τ_retire | `retireThreshold = -0.05` |
| 周期性审计 | `UnifiedResourceHub.runAudit()` |
| 层次化技能检索 | `ResourceHub.recommend(taskType, domain)` |
| 策略与技能交替优化 | 调度决策与资源审计分离 |

**本方案的增量（相对 SLIM）：**
- SLIM 只处理"技能"，本方案覆盖所有资源类型
- SLIM 不检测能力漂移，本方案增加了时序漂移检测
- SLIM 不区分"能力变化"和"价值下降"，本方案分开处理（drift vs marginal）
