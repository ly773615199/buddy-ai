# 三脑能力迭代执行计划 v1.0

> 日期: 2026-06-13
> 目标: 三脑意图理解能力 + 三脑资源决策能力
> 原则: 基于项目实际代码，不依赖 BuddyLM，不依赖三进制训练

---

## 一、现状基线

### 1.1 已有基础设施

| 组件 | 文件 | 行数 | 实际能力 | 状态 |
|------|------|------|----------|------|
| IntuitionNet | `brain/right/nn/model.ts` | 434 | 分类 NN (~300K 参数)，输出意图/工具/质量 | ✅ 可用但未接入意图分类 |
| classifyFromText | `brain/right/index.ts` | ~80 | 7 组关键词规则匹配 | ⚠️ 精度低 |
| PrototypeMemory | `brain/right/prototype-memory.ts` | 656 | 8 个种子原型，hidden[256] 空间余弦匹配 | ✅ 可用但未接入意图分类 |
| RuleEngine | `brain/left/rule-engine.ts` | 455 | 17 条规则 | ⚠️ 覆盖率低 |
| Scheduler | `brain/left/scheduler.ts` | 542 | 四层新颖度路由 + Thompson Sampling | ✅ 完整 |
| DecisionRecorder | `core/decision-recorder.ts` | 313 | JSONL 持久化决策记录 | ✅ 完整 |
| ModelPool | `core/model-pool.ts` | 1627 | 统一模型池，profile 管理 | ✅ 完整 |
| ModelRouter | `core/model-router.ts` | 797 | 三层模型选择（缓存→经验→Thompson） | ✅ 完整 |
| ExperienceRouter | `intelligence/experience-router.ts` | — | 经验图谱路由 | ✅ 可用 |
| Brain.decide() | `brain/brain.ts` | 741 | 小脑→右脑→审议→左脑 决策链 | ✅ 完整 |
| Brain.feedback() | `brain/brain.ts` | ~100 | 反馈方法定义 | ❌ 从未被调用 |
| collectSignals | `core/signal-collector.ts` | 254 | 领域检测+复杂度评估 | ⚠️ 用关键词匹配 |
| decideCollaboration | `core/orchestrator.ts` | 113 | 8 条规则选协作模式 | ✅ 可用 |
| PlanExecutor | `core/plan-executor.ts` | 637 | 7 种模式执行器 | ✅ 完整但"盲执行" |
| Cerebellum | `brain/cerebellum/` | 3644 | 感知融合/稳态调节/质量评估 | ✅ 完整 |
| BodyState | `brain/cerebellum/body-state.ts` | 980 | 情绪/精力/负载/困惑度 | ✅ 完整 |
| SkillManager | `skills/skill-manager.ts` | — | 工具健康度追踪 | ✅ 可用 |

### 1.2 缺失的基础设施

| 组件 | 为什么缺 | 影响 |
|------|----------|------|
| **ResourceHub** | 从未实现 | 资源决策基于硬编码估算，无统一资源画像 |
| **PerceptionState** | 从未实现 | 意图分类重复调用，结果不共享 |
| **ConfidenceCalibrator** | 从未实现 | 置信度硬编码，跨模块不可比 |
| **ProposalCollector** | 从未实现 | 各模块方案无法统一收集和裁决 |
| **feedback() 调用** | agent.ts 缺失 | 整个学习闭环断裂 |
| **setEditingPipeline()** | subsystems.ts 缺失 | v5 碰撞管线形同虚设 |
| **工具结果直连路由** | 从未实现 | 工具结果走了冗余的向量检索 |
| **搜索源精准路由** | 从未实现 | 10+ 源全查，大部分无关 |

---

## 二、能力一：三脑意图理解能力

### 2.1 目标

从"7 组关键词规则"升级为"多信号融合意图理解"：

```
当前: classifyFromText() → 7 组关键词 → category + confidence
目标: PerceptionState → NN + 关键词 + 原型 + 语义向量 → 统一意图/领域/复杂度/任务类型
```

### 2.2 基础设施依赖链

```
                        ┌─────────────────────────┐
                        │    PerceptionState       │ ← 新建
                        │  统一感知结果容器         │
                        └────────┬────────────────┘
                                 │ 消费
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
   ┌──────────────────┐ ┌──────────────┐ ┌──────────────────┐
   │ 细粒度意图层      │ │ IntuitionNet │ │ PrototypeMemory  │
   │ (已完成Phase1-4)  │ │ (NN 分类)    │ │ (原型匹配)       │
   └────────┬─────────┘ └──────┬───────┘ └────────┬─────────┘
            │                  │                   │
            │    ┌─────────────┴──────────┐        │
            │    │   classifyFromText()   │        │
            │    │   (当前: 7 组关键词)    │        │
            │    │   (目标: 多信号融合)    │        │
            │    └────────────────────────┘        │
            │                                      │
            └──────────────────┬───────────────────┘
                               ▼
                    ┌─────────────────────┐
                    │   ByteEncoder       │ ← 已有，256 维向量
                    │   语义编码基座       │
                    └─────────────────────┘
```

### 2.3 执行步骤

#### Step 1: 新建 PerceptionState（统一感知结果容器）

**文件**: `src/core/perception-state.ts`（新建，~80 行）

```typescript
/**
 * 统一感知状态 — 一次计算，全链路共享
 *
 * 替代: detectDomains() + assessTaskComplexity() 各自独立调用 classifyFromText()
 * 原则: 信号采集阶段只算一次，后续决策/执行/反馈全部复用
 */
export interface PerceptionState {
  // === 意图 ===
  intent: {
    category: string;           // 统一分类（来自 classifyFromText）
    confidence: number;         // 0-1
    matchedKeywords: string[];  // 命中的关键词
    nnCategory?: string;        // NN 分类结果（IntuitionNet）
    nnConfidence?: number;      // NN 置信度
    protoMatch?: {              // 原型匹配结果
      prototypeId: string;
      distance: number;
      confidence: number;
    };
  };
  domains: string[];            // 任务域标签
  complexity: 'simple' | 'medium' | 'complex';
  taskType: 'chat' | 'tools' | 'reasoning' | 'background' | 'domain';
  shouldUseDAG: boolean;
  dagReason: string;

  // === 语义向量 ===
  embedding?: Float32Array;     // ByteEncoder 256 维向量（供下游复用）

  // === 元信息 ===
  timestamp: number;
  computeMs: number;            // 计算耗时
}
```

**验收**: 类型定义完整，可被 signal-collector/brain/agent 共用。

#### Step 2: 改造 classifyFromText() — 多信号融合

**文件**: `src/brain/right/index.ts`

**当前**: 纯关键词匹配（7 组规则，~80 行）

**目标**: 关键词 + NN + 原型 + 语义向量 四信号融合

```typescript
classifyFromText(input: string): {
  category: string;
  confidence: number;
  suggestedTools: string[];
  hit: boolean;
  // 新增
  nnCategory?: string;
  nnConfidence?: number;
  protoMatch?: { prototypeId: string; distance: number; confidence: number };
  embedding?: Float32Array;
} {
  // 1. 关键词匹配（现有逻辑，保留）
  const keywordResult = this.keywordMatch(input);

  // 2. NN 分类（IntuitionNet，已有但未接入）
  let nnResult: { category: string; confidence: number } | null = null;
  try {
    const encoder = this.getByteEncoder(); // 获取全局单例
    const embedding = encoder.forward(input);
    const nnOutput = this.intuitionNet.forward(/* encoded tokens */);
    nnResult = decodeDecision(nnOutput);
  } catch { /* NN 不可用时降级 */ }

  // 3. 原型匹配（PrototypeMemory，已有但未接入）
  let protoResult: { prototypeId: string; distance: number; confidence: number } | null = null;
  try {
    if (embedding) {
      const match = this.prototypeMemory.findNearest(embedding);
      if (match.confidence > 0.3) {
        protoResult = { prototypeId: match.prototypeId, distance: match.distance, confidence: match.confidence };
      }
    }
  } catch { /* 原型匹配失败 */ }

  // 4. 融合策略
  //    关键词命中 → 直接用（高精确度）
  //    关键词未命中 + NN 命中 → 用 NN（扩展覆盖）
  //    关键词未命中 + NN 未命中 + 原型匹配 → 用原型（兜底）
  //    全未命中 → conversation
  const finalResult = this.fuseResults(keywordResult, nnResult, protoResult);

  return finalResult;
}
```

**验收**:
- "帮我写个快排" → code_operations（当前命中不了）
- "今天天气怎么样" → web_operations（当前命中不了）
- "对比 React 和 Vue" → knowledge_query（当前命中不了）
- "你好" → conversation（保持不变）

#### Step 3: 改造 collectSignals() — 使用 PerceptionState

**文件**: `src/core/signal-collector.ts`

**当前**: `detectDomains()` 和 `assessTaskComplexity()` 各自独立调用 `classifyFromText()`

**目标**: 合并为一个 `collectPerceptionState()` 函数，结果缓存复用

```typescript
/**
 * 统一感知采集 — 替代 detectDomains + assessTaskComplexity
 * 调用一次 classifyFromText()，结果供全链路使用
 */
export function collectPerceptionState(sys: Subsystems, content: string): PerceptionState {
  const t0 = performance.now();

  // 一次调用，获取完整意图信息
  const intent = sys.threeBrain!.right.classifyFromText(content);

  // 从意图推断领域
  const domains = inferDomains(intent);

  // 复杂度评估（基于意图+内容长度+标记词）
  const complexity = assessComplexity(content, intent);

  // DAG 判断
  const { shouldUseDAG, dagReason } = assessDAG(content);

  // 任务类型映射
  const taskType = mapTaskType(intent.category);

  // 语义向量（如果 ByteEncoder 可用，缓存供下游复用）
  let embedding: Float32Array | undefined;
  try {
    embedding = intent.embedding; // 从 classifyFromText 获取
  } catch {}

  return {
    intent: {
      category: intent.category,
      confidence: intent.confidence,
      matchedKeywords: intent.matchedKeywords,
      nnCategory: intent.nnCategory,
      nnConfidence: intent.nnConfidence,
      protoMatch: intent.protoMatch,
    },
    domains,
    complexity,
    taskType,
    shouldUseDAG,
    dagReason,
    embedding,
    timestamp: Date.now(),
    computeMs: performance.now() - t0,
  };
}
```

**验收**:
- `collectSignals()` 调用一次 `classifyFromText()` 而非两次
- 返回 `PerceptionState` 供 agent/brain/plan-executor 共用
- 意图分类耗时 < 5ms（关键词+NN+原型，纯 CPU）

#### Step 4: 集成已完成的细粒度意图层

**文件**: `src/core/signal-collector.ts` + 相关模块

**来源**: `FINE_GRAINED_INTENT_PLAN.md`（Phase 1-4 已完成，30/30 测试通过）

**当前状态**: 细粒度意图层已完成但未集成到主决策链

**集成方式**:
- 在 `collectPerceptionState()` 中调用细粒度意图层
- 作为 classifyFromText 的补充信号（当关键词+NN 都不确定时）
- 细粒度意图层的 `matchBest()` 结果注入 PerceptionState

**验收**: 细粒度意图层的匹配结果参与意图分类决策

#### Step 5: 统一 classifyFromText → IntuitionNet + PrototypeMemory

**文件**: `src/brain/right/index.ts`

**改动**:
1. `classifyFromText()` 内部调用 IntuitionNet（当前只在 `predict()` 时用）
2. `classifyFromText()` 内部调用 PrototypeMemory（当前只在 `predictFull()` 时用）
3. 两个信号与关键词匹配结果融合

**关键约束**:
- IntuitionNet 需要 ByteEncoder 输出的 embedding 作为输入
- PrototypeMemory 需要 hidden[256] 向量
- 两者共享同一个 ByteEncoder 实例（不能各自 new）

**验收**: classifyFromText 返回 4 个信号的融合结果

---

## 三、能力二：三脑资源决策能力

### 3.1 目标

从"硬编码估算"升级为"实时资源画像驱动决策"：

```
当前: collectResourceState() → 硬算 pool.profileCount / localCoverageRatio / budgetRemaining
目标: ResourceHub → 统一资源注册/画像/查询/反馈 → 资源决策基于实时数据
```

### 3.2 基础设施依赖链

```
┌─────────────────────────────────────────────────────────────────┐
│                        ResourceHub                              │ ← 新建
│  统一资源注册/画像/查询/反馈                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ ModelPool     │  │ SkillManager │  │ TernaryRouter        │  │
│  │ 模型资源      │  │ 工具资源      │  │ 本地专家资源          │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                      │              │
│         └─────────────────┼──────────────────────┘              │
│                           ▼                                     │
│              ┌────────────────────────┐                         │
│              │  ModelPoolResourceBridge│ ← 新建                  │
│              │  双向同步桥             │                         │
│              └────────────────────────┘                         │
│                                                                 │
│         ┌─────────────────────────────────────┐                 │
│         │         feedback() 闭环              │                 │
│         │  执行结果 → ResourceHub 画像更新      │ ← 打通          │
│         └─────────────────────────────────────┘                 │
│                                                                 │
│         ┌─────────────────────────────────────┐                 │
│         │      ConfidenceCalibrator            │ ← 新建          │
│         │      置信度在线校准                   │                 │
│         └─────────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  collectResourceState()│ ← 改造
              │  从 ResourceHub 读取   │
              └────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  decideCollaboration() │ ← 改造
              │  基于实时资源画像决策   │
              └────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  PlanExecutor          │ ← 改造
              │  执行时感知资源约束     │
              └────────────────────────┘
```

### 3.3 执行步骤

#### Step 6: 创建 ResourceHub（统一资源画像系统）

**文件**: `src/brain/hub/resource-hub.ts`（新建，~300 行）

```typescript
/**
 * ResourceHub — 统一资源画像系统
 *
 * 职责:
 * 1. 注册所有可用资源（模型/工具/本地专家/知识源）
 * 2. 维护资源画像（成功率/延迟/成本/擅长任务）
 * 3. 提供查询接口（getActive/recommend/getHealth）
 * 4. 接收执行反馈（recordOutcome → 更新画像）
 *
 * 不做的事:
 * - 不管理资源生命周期（那是 ModelPool/SkillManager 的事）
 * - 不做调度决策（那是 Scheduler 的事）
 * - 不做执行（那是 PlanExecutor 的事）
 */

export interface ResourceProfile {
  id: string;
  type: 'model' | 'tool' | 'expert' | 'knowledge_source';
  name: string;

  // 画像数据
  stats: {
    totalCalls: number;
    successCount: number;
    failureCount: number;
    avgLatencyMs: number;
    totalCost: number;
    lastUsedAt: number;
  };

  // 擅长任务（从 DecisionRecorder 学习）
  strengths: {
    taskTypes: Record<string, { attempts: number; successes: number }>;
    domains: Record<string, { attempts: number; successes: number }>;
  };

  // 状态
  status: 'active' | 'degraded' | 'unavailable' | 'unknown';
  healthScore: number;  // 0-100
  lastHealthCheck: number;
}

export class ResourceHub {
  private profiles: Map<string, ResourceProfile> = new Map();

  // 注册
  register(resource: Omit<ResourceProfile, 'stats' | 'strengths'>): void;
  unregister(id: string): void;

  // 查询
  getActive(type?: ResourceProfile['type']): ResourceProfile[];
  getById(id: string): ResourceProfile | undefined;
  recommend(taskType: string, domain?: string): ResourceProfile[];

  // 反馈
  recordOutcome(id: string, outcome: {
    success: boolean;
    latencyMs: number;
    cost?: number;
    taskType?: string;
    domain?: string;
  }): void;

  // 健康检查
  getHealthSummary(): {
    total: number;
    active: number;
    degraded: number;
    unavailable: number;
  };
}
```

**验收**:
- 能注册模型/工具/本地专家
- recordOutcome 后画像实时更新
- recommend() 返回按成功率排序的资源列表

#### Step 7: 创建 ModelPoolResourceBridge（双向同步桥）

**文件**: `src/brain/hub/model-pool-bridge.ts`（新建，~120 行）

**职责**:
1. **ModelPool → ResourceHub**: 模型激活/去激活/发现时同步到 ResourceHub
2. **ResourceHub → ModelPool**: 执行反馈回流到 ModelPool stats
3. **启动时全量同步**: 把 ModelPool 中所有 active 模型注册到 ResourceHub

```typescript
export class ModelPoolResourceBridge {
  constructor(private pool: ModelPool, private hub: ResourceHub) {}

  // 启动时全量同步
  fullSync(): void {
    const profiles = this.pool.getAllProfiles();
    for (const profile of profiles) {
      this.hub.register({
        id: profile.id,
        type: 'model',
        name: profile.displayName ?? profile.id,
        status: profile.active ? 'active' : 'unavailable',
        healthScore: 100,
        lastHealthCheck: Date.now(),
      });
    }
  }

  // 监听 ModelPool 事件（需要 ModelPool 暴露事件接口）
  onModelActivated(profileId: string): void { /* 更新 ResourceHub */ }
  onModelDeactivated(profileId: string): void { /* 更新 ResourceHub */ }
  onModelDiscovered(profileId: string): void { /* 注册到 ResourceHub */ }
}
```

**验收**: ModelPool 中的模型状态变更自动同步到 ResourceHub

#### Step 8: 打通 feedback() 闭环

**文件**: `src/core/agent.ts`

**当前**: ThreeBrain.feedback() 定义了但从未被调用

**目标**: 在消息处理完成后自动调用 feedback()

**改动点**:

```typescript
// agent.ts — postprocessResult() 中注入 feedback 调用
private postprocessResult(content: string, result: ExecutionResult): void {
  // ... 现有逻辑 ...

  // 新增: 三脑反馈闭环
  if (this.sys.threeBrain && this.pendingDecision) {
    const outcome: DecisionOutcome = {
      success: result.toolCalls.every(tc => !tc.result?.startsWith('[')),
      latencyMs: Date.now() - this.pendingDecision.timestamp,
      toolsUsed: result.toolCalls.map(tc => tc.name),
      costEstimate: 0, // 从 LLMAdapter.getLastUsage() 获取
    };

    this.sys.threeBrain.feedback(
      this.pendingDecision.signal,
      this.pendingDecision.resources,
      this.pendingDecision.plan,
      outcome,
    ).catch(err => {
      if (this.verbose) console.warn('[Agent] feedback 失败:', err.message);
    });

    this.pendingDecision = null;
  }
}
```

**需要同步改动**:
1. `handleCLIMessage()` 和 `handleUserMessage()` 中保存 `pendingDecision`
2. `pendingDecision` 类型定义（signal + resources + plan + timestamp）

**验收**:
- ThreeBrain.feedback() 被实际调用
- calibrator.update() 被调用 → 校准器开始学习
- ResourceHub.recordOutcome() 被调用 → 资源画像更新
- DecisionRecorder 记录完整的决策+结果

#### Step 9: 创建 ConfidenceCalibrator（置信度校准器）

**文件**: `src/brain/dispatch/calibrator.ts`（新建，~150 行）

```typescript
/**
 * 置信度校准器 — 在线校准，替代硬编码阈值
 *
 * 基于 Online Platt Scaling
 * 输入: 模块名 + 原始 confidence + 实际 outcome
 * 输出: 校准后的 confidence（语义统一，可跨模块比较）
 */
export class ConfidenceCalibrator {
  // 每个模块的校准参数
  private calibrators: Map<string, { a: number; b: number; count: number }> = new Map();

  // 校准原始置信度
  calibrate(moduleName: string, rawConfidence: number): number {
    const cal = this.calibrators.get(moduleName);
    if (!cal || cal.count < 5) return rawConfidence; // 样本不足，返回原始值
    return sigmoid(cal.a * rawConfidence + cal.b);
  }

  // 更新校准模型 — feedback() 中调用
  update(moduleName: string, rawConfidence: number, outcome: boolean): void {
    // 在线 logistic regression 更新
    const cal = this.calibrators.get(moduleName) ?? { a: 1, b: 0, count: 0 };
    const predicted = sigmoid(cal.a * rawConfidence + cal.b);
    const error = (outcome ? 1 : 0) - predicted;
    const lr = 0.01;
    cal.a += lr * error * rawConfidence;
    cal.b += lr * error;
    cal.count++;
    this.calibrators.set(moduleName, cal);
  }

  // 是否已校准（至少 5 个样本）
  isCalibrated(moduleName: string): boolean {
    return (this.calibrators.get(moduleName)?.count ?? 0) >= 5;
  }
}
```

**验收**:
- 5 次交互后 calibrator.isCalibrated('rule') 返回 true
- 校准后的 confidence 可跨模块比较

#### Step 10: 改造 collectResourceState() — 从 ResourceHub 读取

**文件**: `src/core/signal-collector.ts`

**当前**: 硬算 pool.profileCount / localCoverageRatio / budgetRemaining

**目标**: 从 ResourceHub 读取实时数据

```typescript
export function collectResourceState(sys: Subsystems, ...): ResourceState {
  const hub = sys.resourceHub; // 新增

  // 本地覆盖率: 从 ResourceHub 查询（而非硬算）
  const localExperts = hub.getActive('expert');
  const coveredDomains = signal.domains.filter(d =>
    localExperts.some(e => e.strengths.domains[d]?.successes > 0)
  );
  const localCoverageRatio = coveredDomains.length / signal.domains.length;

  // 本地置信度: 从 ResourceHub 的画像数据获取
  const localConfidence = coveredDomains.length > 0
    ? Math.max(...coveredDomains.map(d => {
        const expert = localExperts.find(e => e.strengths.domains[d]);
        return expert ? expert.strengths.domains[d].successes / expert.strengths.domains[d].attempts : 0;
      }))
    : 0;

  // 预算: 从 ResourceHub 汇总
  const allModels = hub.getActive('model');
  const recentCost = allModels.reduce((sum, m) => sum + m.stats.totalCost, 0);
  const budgetRemaining = hourlyBudget - recentCost;

  // ... 其余逻辑不变 ...
}
```

**验收**: 资源状态来自 ResourceHub 实时数据，而非硬编码估算

#### Step 11: 改造 PlanExecutor — 执行时感知资源约束

**文件**: `src/core/plan-executor.ts`

**当前**: "盲执行"——不知道预算、不知道工具健康度

**目标**: 执行前检查资源约束，执行中可降级

```typescript
// 在 executeByPlan() 开头增加资源检查
export async function executeByPlan(ctx: ExecutionContext, plan: OrchestrationPlan): Promise<ExecutionResult> {
  // 新增: 资源可行性检查
  const hub = ctx.sys.resourceHub;
  if (hub) {
    // 检查预算
    const budget = hub.getHealthSummary();
    if (budget.active === 0) {
      return { text: '⚠️ 当前无可用资源，请稍后重试', source: 'resource_check', toolCalls: [] };
    }

    // 检查工具健康度
    for (const node of plan.selectedNodes) {
      if (node.type === 'experience') {
        const toolHealth = hub.getById(`tool/${node.skillId}`);
        if (toolHealth && toolHealth.healthScore < 30) {
          // 工具不健康，降级到 LLM
          plan.mode = 'single';
          plan.reason = `工具 ${node.skillId} 健康度过低 (${toolHealth.healthScore})，降级`;
        }
      }
    }
  }

  // ... 现有执行逻辑 ...
}
```

**验收**: 预算耗尽时自动降级，工具不健康时自动跳过

#### Step 12: setEditingPipeline 注入

**文件**: `src/core/subsystems.ts`

**当前**: v5 碰撞管线未接入，`setEditingPipeline()` 从未调用

**改动**: 在 Subsystems 初始化完成后注入碰撞引擎

```typescript
// subsystems.ts — 初始化完成后
if (this.threeBrain && this.collisionEngine && this.knowledgeConvergence) {
  this.threeBrain.setEditingPipeline(this.collisionEngine, this.knowledgeConvergence);
}
```

**验收**: v5 管线不再走 legacy 降级路径

#### Step 13: 规则引擎扩展 17→40+

**文件**: `src/brain/left/rule-engine.ts`

**当前**: 17 条规则

**目标**: 40+ 条，覆盖高频确定性操作

**新增规则类别**:

| 类别 | 新增规则 | 触发词示例 |
|------|----------|-----------|
| 包管理 | 6 | npm install / npm run / pip install / yarn |
| 构建编译 | 3 | tsc / make / cargo |
| Docker | 4 | docker ps / docker logs / docker compose / docker build |
| 网络调试 | 3 | curl / ping / wget |
| 代码分析 | 4 | eslint / wc -l / grep / tsc --noEmit |
| Git 高级 | 4 | git commit / git push / git merge / git pull |

**关键约束**:
- 中文 regex 不能用 `\b`（对中文无效）
- 改用 `input.includes(keyword)` 或 Unicode-aware 正则
- 每条规则的 `action` 要返回 `ExecutablePlan`（可执行工具调用序列）

**验收**: "npm install" 直接执行 `exec npm install`，不走 LLM

#### Step 14: 工具结果跳过检索

**文件**: `src/brain/brain.ts`

**当前**: 工具已执行拿到结果，组装引擎又回去检索一遍

**改动**: 检测到 toolProposal 存在时，直接格式化结果，跳过组装引擎的检索管线

```typescript
// brain.ts — decide() 中
if (toolProposal && toolProposal.result && toolProposal.result.length > 10) {
  // 工具已有结果，直接格式化，不走检索
  const formatted = formatToolResult(toolProposal);
  return { text: formatted, source: 'tool_direct', ... };
}
```

**验收**: 工具调用后不再重复检索，响应延迟降低

#### Step 15: 搜索源精准路由

**文件**: 搜索相关模块

**当前**: 10+ 搜索源全部查询

**改动**: 根据 TaskSignal.domains 选择相关源

```typescript
// 根据领域选择搜索源
const DOMAIN_TO_SOURCES: Record<string, string[]> = {
  code: ['github', 'stackoverflow', 'npm', 'pypi'],
  data: ['arxiv', 'wikipedia'],
  writing: ['wikipedia', 'bing'],
  web: ['bing', 'duckduckgo'],
};
```

**验收**: "Python asyncio" 只查 github + stackoverflow，不查 npm/pypi/arxiv

---

## 四、执行顺序与依赖关系

```
Phase 1 (Week 1-2): 基础设施 + 意图理解
├── Step 1:  PerceptionState 类型定义           [0.5d]
├── Step 2:  classifyFromText 多信号融合         [2d]
├── Step 3:  collectSignals 改用 PerceptionState [1d]
├── Step 6:  ResourceHub 创建                    [2d]
├── Step 7:  ModelPoolResourceBridge             [1d]
├── Step 8:  feedback() 闭环打通                 [1.5d]
└── Step 13: 规则引擎扩展 17→40+                 [1d]
    验收: 意图分类覆盖提升, ResourceHub 注册资源, feedback 被调用

Phase 2 (Week 3-4): 资源决策 + 决策闭环
├── Step 4:  细粒度意图层集成                    [1d]
├── Step 5:  IntuitionNet + PrototypeMemory 接入 [2d]
├── Step 9:  ConfidenceCalibrator                 [1d]
├── Step 10: collectResourceState 改造            [1d]
├── Step 11: PlanExecutor 资源感知                [1.5d]
├── Step 12: setEditingPipeline 注入              [0.5d]
└── Step 14: 工具结果跳过检索                     [1d]
    验收: 意图理解 4 信号融合, 资源决策基于实时数据, 执行层感知约束

Phase 3 (Week 5-6): 优化 + 验证
├── Step 15: 搜索源精准路由                      [1d]
├── 竞争裁决框架 (ProposalCollector + Arbiter)    [3d]
├── 端到端测试: 意图→决策→执行→反馈 全链路        [2d]
└── 性能基准: 意图分类 <5ms, 资源决策 <10ms       [1d]
    验收: 全链路跑通, 反馈闭环生效, 性能达标
```

### 依赖关系

```
Step 1 (PerceptionState) ──→ Step 2 (classifyFromText) ──→ Step 3 (collectSignals)
                                                              │
Step 6 (ResourceHub) ──→ Step 7 (Bridge) ──→ Step 8 (feedback) ──→ Step 9 (Calibrator)
                                                              │
                                                              └──→ Step 10 (collectResourceState)
                                                                      │
                                                                      └──→ Step 11 (PlanExecutor)

Step 13 (规则扩展) ← 无依赖，可并行
Step 14 (工具直连) ← 无依赖，可并行
Step 15 (搜索路由) ← 无依赖，可并行
```

---

## 五、验收标准总表

### 能力一：意图理解

| 场景 | 当前行为 | 目标行为 | 验收方式 |
|------|----------|----------|----------|
| "帮我写个快排" | → conversation (未命中) | → code_operations | 输入测试 |
| "今天天气怎么样" | → conversation (未命中) | → web_operations | 输入测试 |
| "对比 React 和 Vue" | → conversation (未命中) | → knowledge_query | 输入测试 |
| "git status" | → git_operations | → git_operations (不变) | 输入测试 |
| "你好" | → conversation | → conversation (不变) | 输入测试 |
| 意图分类耗时 | ~1ms (纯关键词) | <5ms (多信号融合) | 性能测试 |
| classifyFromText 调用次数 | 2 次 (detectDomains + assessComplexity) | 1 次 (PerceptionState) | 代码审查 |

### 能力二：资源决策

| 场景 | 当前行为 | 目标行为 | 验收方式 |
|------|----------|----------|----------|
| 模型激活/去激活 | ResourceHub 不知道 | 自动同步 | 日志验证 |
| 工具执行失败 | 不影响后续决策 | 工具健康度下降，后续降权 | 连续失败测试 |
| 预算耗尽 | 继续执行 | 自动降级到本地 | 预算耗尽测试 |
| feedback() 调用 | 从未调用 | 每次消息后自动调用 | 日志验证 |
| 置信度阈值 | 硬编码 0.6/0.8 | 在线校准，跨模块可比 | 校准曲线测试 |
| 工具结果处理 | 走冗余检索 | 直接格式化 | 延迟对比 |
| 搜索源选择 | 10+ 源全查 | 按领域选择 | 源数量对比 |
