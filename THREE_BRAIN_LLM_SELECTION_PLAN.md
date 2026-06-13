# 三脑自由选择 LLM 实施计划

> 三脑架构 × 多模型池 × 聚合平台 — 让 Buddy 自主选择最优 LLM

---

## 一、背景与目标

### 当前问题

三脑架构（左脑理性决策 + 右脑直觉学习 + 小脑本体感知）已经实现了完整的决策链路，但在 LLM 选择上存在断点：

```
现状：三脑决策 → modelTierHint ('primary'|'lightweight'|'budget') → 只能三选一
目标：三脑决策 → 从 100+ 可用模型池中智能选择 → 直接调用
```

核心痛点：
1. **主模型/轻量模型概念冗余** — 如果模型池能自动发现+按任务选择，primary/lightweight 只是被硬编码选中的两个池成员
2. **聚合平台接入困难** — 硅基流动、OpenRouter 等平台一个 endpoint 挂着几十上百个模型，无法逐个配置
3. **modelTierHint 太粗** — 左脑精心做的决策，传递时丢成了三档
4. **三进制微模型未接入** — TernaryEngine 是独立推理引擎，没有接入 LLM 调用链
5. **决策不可观测** — 前端看不到"选了哪个模型、为什么选它"
6. **用户无法干预** — 无法排除不想用的模型，无法表达偏好

### 设计目标

| 目标 | 描述 |
|------|------|
| **统一模型池** | 去掉 primary/lightweight 概念，所有模型平等进入模型池 |
| **零配置模型发现** | 用户只需配置 API Key，系统自动拉取、裁剪、标注可用模型 |
| **三脑直接选模型** | 左脑输出具体模型而非抽象 tier，支持 4 类 LLM 源 |
| **三级漏斗高效匹配** | 100 模型 → 40 候选 → 10 匹配 → 1 最优，<5ms |
| **动态学习** | Thompson Sampling 从使用中学习每个模型擅长什么 |
| **用户可控** | 黑名单排除 + 偏好覆盖 + 成本上限 |
| **决策可观测** | 前端展示模型选择链路 + 使用统计 |
| **智能容错** | 端点/模型两级验证，区分永久失效与临时故障，自动跳过不可用模型 |

---

## 二、架构设计

### 2.1 配置简化：去掉 primary/lightweight

**之前（3 层概念叠在一起）**：
```typescript
// ❌ 旧设计：primary/lightweight/pool 三套，关系混乱
config = {
  llm: {
    provider: 'deepseek',        // "主模型"
    model: 'deepseek-chat',
    lightweight: {                // "轻量模型"
      provider: 'ollama',
      model: 'llama3',
    },
    fallbacks: [...]
  },
  pool: { nodes: [...] }         // 模型池（可选扩展）
}
```

**之后（统一模型池）**：
```typescript
// ✅ 新设计：只有一个模型池，用户只配 API 端点
config = {
  models: {
    // 用户只填这些
    providers: [
      { id: 'sf', type: 'siliconflow', apiKey: 'sk-xxx' },
      { id: 'ollama', type: 'ollama' },
      { id: 'deepseek', type: 'deepseek', apiKey: 'sk-yyy' },
    ],
    // 可选：用户偏好（不填就全自动）
    preferences: {
      excluded: ['meta-llama/*'],
      preferFree: true,
      maxCostPer1k: 0.05,
      maxCostPerHour: 0.50,
    },
    // 可选：调度策略
    strategy: 'task_match',      // 'task_match' | 'cost_optimized' | 'quality_first'
  }
}
```

**池大小=1 的特例**：用户只配了一个 API key → 池里只有一个模型 → 跳过 Thompson Sampling，直接用。不需要叫"主模型"，就是"唯一可用"。

### 2.2 四类 LLM 源（统一进池）

```
┌─────────────────────────────────────────────────────┐
│                  统一模型池                            │
│                                                     │
│  ① 独立 LLM        ② 聚合平台 LLM                   │
│  openai/gpt-4o     siliconflow/Qwen2.5-72B          │
│  anthropic/claude   siliconflow/DeepSeek-V3          │
│  deepseek/deepseek  openrouter/...                   │
│                                                     │
│  ③ 本地配置 LLM     ④ 三进制微模型                    │
│  ollama/llama3      ternary/coding                   │
│  ollama/qwen2.5     ternary/reasoning                │
│  ollama/deepseek    ternary/chat                     │
│                                                     │
│  所有模型平等参与 Thompson Sampling 选择              │
│  没有"主模型"和"轻量模型"的区别                       │
└─────────────────────────────────────────────────────┘
```

### 2.3 三级漏斗

```
100 个模型（平台 API 返回）
    ↓ Layer 0: 静态裁剪（启动时一次性，结果缓存）
    ↓ 规则：用户黑名单 + 不支持 chat + <3B 参数 + 重复去重
40 个候选
    ↓ Layer 1: 元数据快筛（每次决策，<1ms，纯内存）
    ↓ 规则：任务类型匹配 + 成本约束 + 上下文长度 + 能力阈值
10-15 个匹配
    ↓ Layer 2: Thompson Sampling（在匹配集中选，<5ms）
    ↓ 加权：历史成功率 + 用户偏好 + 成本惩罚 + 延迟惩罚
1 个最终选择
```

### 2.4 决策流（改造后）

```
用户输入
  ↓
ThreeBrain.decide()
  ├─ 小脑: BodyEvent → BodyState (load/energy/emotion)
  ├─ 右脑: IntuitionSignal (intent/tools/quality)
  └─ 左脑: UnifiedScheduler.schedule(signal, resources, intuition, body, modelPool)
       ├─ 计算 novelty + complexity
       ├─ 生成 ModelRequirement (能力需求 + 约束)
       ├─ 三级漏斗选择
       └─ 输出 ExecutionPlan { selectedNodes: [具体模型节点] }
  ↓
agent.ts → 提取 node → LLMAdapter.chatWithNode(node)
  ├─ ternary → TernaryEngine.generate()
  ├─ local_expert → LocalExpert.query()
  └─ cloud → ProviderFactory.create() → Vercel AI SDK
  ↓
反馈 → ThreeBrain.feedback() → 更新 Thompson Sampling 参数
```

**关键变化**：不再有 `modelTierHint` 这个中间层。左脑直接输出 `{provider:'deepseek', model:'deepseek-chat'}`，agent 直接用。

### 2.5 能力画像系统

三脑做决策时需要知道"这个任务需要什么能力"和"哪个模型能提供"：

```typescript
// 模型能力画像（池中每个模型一个）
interface ModelProfile {
  id: string;                    // 'siliconflow/Qwen2.5-72B-Instruct'
  platform: string;              // 'siliconflow'
  displayName: string;           // 'Qwen2.5-72B'
  tier: 'premium' | 'standard' | 'budget' | 'free';

  // 能力维度 (0-1)
  capabilities: {
    reasoning: number;           // 推理能力
    code: number;                // 代码能力
    chinese: number;             // 中文能力
    english: number;             // 英文能力
    math: number;                // 数学能力
    creative: number;            // 创意写作
    toolCalling: boolean;        // 是否支持工具调用
    vision: boolean;             // 是否支持视觉
    streaming: boolean;          // 是否支持流式
  };

  // 资源维度
  maxContextTokens: number;
  maxOutputTokens: number;
  costPer1kInput: number;        // ¥/千 token
  costPer1kOutput: number;

  // 运行时统计（Thompson Sampling 用）
  stats: {
    totalCalls: number;
    successes: number;
    avgLatencyMs: number;
    byTaskType: Record<string, { attempts: number; successes: number }>;
  };

  // 来源
  source: 'platform_api' | 'static_knowledge' | 'user_added';
  discoveredAt: number;
}
```

能力标注三层来源：

| 层 | 来源 | 可靠度 | 时机 |
|---|---|---|---|
| 静态知识 | 内置模型能力表 (MODEL_KNOWLEDGE) | 中 | 冷启动 |
| 平台元数据 | API 返回的 context_length, pricing | 高 | 启动时 |
| 运行时学习 | Thompson Sampling 历史 | 高 | 每次调用后 |

### 2.6 用户控制机制

```typescript
interface UserPoolPreferences {
  // 黑名单（硬排除）
  excluded: string[];            // ['meta-llama/*', 'mistralai/*'] 支持通配符

  // 偏好（软排序，不硬排除，只影响 Thompson Sampling 权重）
  taskPreferences: Record<TaskType, {
    prefer: string[];            // ['deepseek-ai/*'] 推理任务偏好 DeepSeek
    avoid: string[];             // ['google/*'] 避免 Google 模型
  }>;

  // 全局约束
  preferFree: boolean;           // 优先免费模型
  preferLocal: boolean;          // 优先本地模型（ollama + ternary）
  maxCostPer1k: number;          // 成本上限 ¥/千 token
  maxCostPerHour: number;        // 每小时成本上限
}
```

### 2.7 模型可用性管理：端点验证 + LLM 验证

聚合平台（硅基流动、OpenRouter 等）存在一个核心矛盾：**端点可用 ≠ 模型可用**。

#### 三种不可用场景

| 场景 | 例子 | 影响范围 | 能在添加时发现？ |
|------|------|---------|----------------|
| **Key 失效** | API Key 过期/被吊销 | 整个端点 | ✅ `/models` 直接 401 |
| **Key 权限不足** | Key 只能用免费模型 | 部分模型 | ❌ `/models` 返回全量列表 |
| **模型停用** | 平台下架某个模型 | 单个模型 | ❌ API 可能有缓存延迟 |
| **余额不足** | 没充钱/余额用完 | 全部或部分模型 | ❌ 端点验证能连通 |
| **月额度超了** | 订阅额度耗尽 | 全部或部分模型 | ❌ 端点验证能连通 |

#### 两层验证架构

```
第 1 层：端点验证（Key 级）          第 2 层：LLM 验证（模型级）
─────────────────────          ─────────────────────
时机：用户添加端点时               时机：首次选中模型时（异步）
粒度：每个 provider               粒度：每个模型
内容：Key 是否有效、端点是否可连通    内容：这个 Key 能不能调用这个模型
动作：失败则不进池                  动作：失败则标记该模型不可用
```

```typescript
// 第 1 层：端点验证（同步，用户在设置页面等待）
async function verifyEndpoint(config: PlatformConfig): Promise<EndpointVerifyResult> {
  const res = await fetch(`${config.baseUrl}/models`, {
    headers: { 'Authorization': `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(10000),
  });

  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: 'AUTH_FAILED', message: 'API Key 无效或已过期' };
  }
  if (res.status === 402) {
    return { ok: true, balanceWarning: 'INSUFFICIENT_BALANCE', message: '账户余额不足，部分模型可能无法使用' };
  }

  return { ok: true, balanceWarning: null };
}

// 第 2 层：LLM 验证（异步，首次选中时按需执行）
async function verifyModelAccess(model: ModelProfile): Promise<ModelVerifyResult> {
  // 已验证过，直接返回缓存
  if (modelAccessCache.has(model.id)) return modelAccessCache.get(model.id)!;

  // 只对聚合平台做验证（独立 LLM 失败时直接熔断即可）
  const AGGREGATORS = new Set(['siliconflow', 'openrouter']);
  if (!AGGREGATORS.has(model.platform)) {
    modelAccessCache.set(model.id, { ok: true });
    return { ok: true };
  }

  try {
    // 最小请求：1 token 输出，成本 ≈ 0
    await callLLM(model, { messages: [{ role: 'user', content: 'hi' }], maxTokens: 1, timeout: 8000 });
    modelAccessCache.set(model.id, { ok: true });
    return { ok: true };
  } catch (err) {
    const result = classifyProbeError(err);
    modelAccessCache.set(model.id, result);
    return result;
  }
}
```

#### 异步预验证：零感知用户体验

LLM 验证不阻塞用户操作，后台异步执行：

```typescript
// 用户添加端点后，立即注册模型，后台异步验证
async function onEndpointAdded(config: PlatformConfig): Promise<void> {
  // 1. 端点验证（同步，用户在设置页面等待）
  const endpointResult = await verifyEndpoint(config);
  if (!endpointResult.ok) { showError(endpointResult.message); return; }

  // 2. 注册到模型池（立即可用）
  const models = await discoverModels(config);
  registerToPool(models);

  // 3. 后台异步验证每个模型（用户无感知）
  preVerifyModels(models, { concurrency: 2 });
}

// 选中模型时的兜底：如果还没验证完，直接试（不等待）
async function selectAndCall(taskType: TaskType, context: TaskContext): Promise<LLMResult> {
  const model = router.select(taskType, context);
  const verifyStatus = getVerifyStatus(model.id);

  switch (verifyStatus) {
    case 'verified':   return callLLM(model, context);           // 已验证可用
    case 'denied':     return cascadeToNext(taskType, context);  // 已验证不可用，跳过
    case 'pending':    // 还没验证完，直接试
      try { return await callLLM(model, context); }
      catch { return cascadeToNext(taskType, context); }
  }
}
```

#### 运行时验证：每次调用都是隐式验证

验证不是一次性检查，而是**每次调用的自然结果**：

```typescript
// 每次调用结束时，自动更新模型状态
function onCallComplete(modelId: string, result: CallResult): void {
  const state = getModelState(modelId);

  if (result.success) {
    // ✅ 能用 → 更新状态（之前 denied 的也可能恢复，如充值后）
    state.status = 'available';
    state.lastSuccessAt = Date.now();
    state.failureStreak = 0;
  } else {
    state.lastFailureAt = Date.now();
    state.failureStreak++;

    switch (classifyError(result.error)) {
      case 'auth': case 'payment': case 'permission': case 'not_found':
        state.status = 'denied';       // 永久性问题
        state.failureType = result.errorType;
        break;
      case 'rate_limited': case 'network': case 'timeout':
        if (state.failureStreak >= 3) state.status = 'broken';  // 临时故障
        break;
    }
  }
}
```

#### 模型状态机

```
        ┌──────────────────────────────────────────┐
        │                                          │
        ▼                                          │
   ┌─────────┐   调用成功    ┌─────────┐           │
   │ unknown  │────────────→│available │←────────┐ │
   └─────────┘              └────┬────┘         │ │
        │                        │              │ │
        │ 首次调用失败            │ 调用失败     │ │ 调用成功
        ▼                        ▼              │ │ (充值/恢复)
   ┌─────────┐              ┌─────────┐        │ │
   │ denied   │←─(永久错误)──│ broken  │────────┘ │
   └────┬────┘              └─────────┘          │
        │                                       │
        │ 每小时/每天重试一次                      │
        └───────────────────────────────────────┘
```

#### 错误分类：端点级 vs 模型级

```typescript
type ModelAccessError =
  | { scope: 'model'; modelId: string; reason: 'payment' | 'permission' | 'not_found' | 'rate_limited' }
  | { scope: 'endpoint'; providerId: string; reason: 'auth' | 'network' | 'balance_exhausted' };

// 升级机制：连续 3 个模型都 402 → 从模型级升级为端点级（账户余额不足）
private handleModelAccessError(provider: string, error: ModelAccessError): void {
  if (error.scope === 'model' && error.reason === 'payment') {
    const count = (this.recentPaymentFailures.get(provider) ?? 0) + 1;
    this.recentPaymentFailures.set(provider, count);

    if (count >= 3) {
      // 升级：不是某个模型贵，是整个账户没钱了
      this.markProviderBroken(provider, { reason: 'balance_exhausted', brokenAt: Date.now() });
      this.emit('provider_broken', { provider, reason: 'balance_exhausted', message: '账户余额不足，请充值' });
    }
  }
}
```

#### 用户通知策略

| 事件 | 严重程度 | 是否需要用户操作 | 处理方式 |
|------|---------|----------------|---------|
| `provider.auth_failed` | 🔴 高 | 更新 API Key | 自动禁用该端点 |
| `provider.balance_exhausted` | 🔴 高 | 充值 | 自动禁用该端点 |
| `model.payment_required` | 🟡 中 | 可能需要充值 | 标记该模型，其他模型不受影响 |
| `model.permission_denied` | 🟡 中 | 升级套餐或换 Key | 标记该模型 |
| `model.not_found` | 🟡 中 | 无需操作 | 标记该模型，自动跳过 |
| `model.rate_limited` | 🟢 低 | 无需操作 | 临时熔断，自动恢复 |
| `model.timeout` | 🟢 低 | 无需操作 | 临时熔断 + cascade |

#### 完整验证流程图

```
用户添加端点
  │
  ▼
┌─────────────────────────────────┐
│ 第 1 层：端点验证（同步，10s）     │
│ GET /models + Bearer Key        │
└─────────────┬───────────────────┘
              │
     ┌────────┼────────┐
     ▼        ▼        ▼
   401      200/402   超时
   Key无效   Key有效   网络问题
     │        │        │
     ▼        ▼        ▼
  不进池    进池      降级注册
  通知用户  标记状态   标记"未验证"
              │
              ▼
        用户开始使用
              │
              ▼
┌─────────────────────────────────┐
│ 第 2 层：LLM 验证（异步/按需）    │
│ 后台预验证 + 首次调用时兜底        │
└─────────────┬───────────────────┘
              │
     ┌────────┼────────┬──────────┐
     ▼        ▼        ▼          ▼
   成功      402      403        404
   缓存结果  余额不足  无权限     已下架
     │        │        │          │
     ▼        ▼        ▼          ▼
  正常使用  标记该模型  标记该模型  标记该模型
            不可用     不可用     不可用
              │
              │ 连续 3 个模型都 402？
              ▼
        升级为端点级：账户余额不足
        通知用户充值
              │
              ▼
┌─────────────────────────────────┐
│ 运行时：隐式验证（每次调用）       │
│ 成功 → 状态恢复    失败 → 更新状态 │
└─────────────────────────────────┘
```

### 2.8 现有配置迁移

旧配置自动迁移到新格式：

```typescript
function migrateConfig(old: OldBuddyConfig): NewBuddyConfig {
  const providers = [];

  // primary → providers 列表
  if (old.llm.provider) {
    providers.push({
      id: old.llm.provider,
      type: old.llm.provider,
      apiKey: old.llm.apiKey,
      baseUrl: old.llm.baseUrl,
    });
  }

  // lightweight → providers 列表
  if (old.llm.lightweight) {
    providers.push({
      id: `${old.llm.lightweight.provider}-light`,
      type: old.llm.lightweight.provider,
      apiKey: old.llm.lightweight.apiKey ?? old.llm.apiKey,
      baseUrl: old.llm.lightweight.baseUrl ?? old.llm.baseUrl,
    });
  }

  // pool.nodes → providers 列表（去重）
  if (old.pool?.nodes) {
    for (const node of old.pool.nodes) {
      if (node.type === 'cloud' && node.provider) {
        const exists = providers.some(p => p.type === node.provider && p.apiKey === node.apiKey);
        if (!exists) {
          providers.push({ id: node.id, type: node.provider, apiKey: node.apiKey, baseUrl: node.baseUrl });
        }
      }
    }
  }

  return {
    models: {
      providers,
      preferences: { excluded: [], preferFree: false, preferLocal: false, maxCostPer1k: 1.0, maxCostPerHour: 5.0 },
      strategy: old.pool?.strategy ?? 'task_match',
    },
    // 其他配置不变
    name: old.name,
    species: old.species,
    // ...
  };
}
```

---

## 三、前端设计

### 3.1 Settings — 模型池管理（替代旧的单一 LLM 配置）

**变更**：去掉旧的"主模型"和"轻量模型"配置区域，改为 API 端点管理。活跃模型池、已排除、三进制、调度策略等面板保留。

```
┌──────────────────────────────────────────────────────┐
│ ⚙️ 设置 — 模型管理                                    │
├──────────────────────────────────────────────────────┤
│                                                      │
│ 📡 API 端点（替代旧的主模型/轻量模型配置）              │
│ ┌──────────────────────────────────────────────────┐ │
│ │ ✅ siliconflow  key: sk-***  可用: 47 模型       │ │
│ │ ✅ ollama       本地          可用: 3 模型        │ │
│ │ ❌ deepseek     key: sk-***  连接失败             │ │
│ │ [+ 添加 API 端点]                                 │ │
│ └──────────────────────────────────────────────────┘ │
│                                                      │
│ 🏊 活跃模型池（保留，自动从端点发现）                   │
│ ┌──────────────────────────────────────────────────┐ │
│ │ ✅ DeepSeek-V3     推理⭐⭐⭐  成功率 87%  ¥0.02  │ │
│ │ ✅ Qwen2.5-72B     中文⭐⭐⭐  成功率 82%  ¥0.04  │ │
│ │ ✅ Qwen2.5-7B      快速⭐⭐⭐  成功率 79%  免费   │ │
│ │ ✅ GLM-4-9B        中文⭐⭐   成功率 75%  免费   │ │
│ │ ✅ Llama-3.1-8B    通用⭐⭐   成功率 71%  免费   │ │
│ └──────────────────────────────────────────────────┘ │
│                                                      │
│ ❌ 已排除                                            │
│ ┌──────────────────────────────────────────────────┐ │
│ │ ❌ Llama-3.1-70B   用户排除: 太贵                 │ │
│ │ ❌ Mistral-7B      自动排除: 连续失败 3 次        │ │
│ │ [+ 手动排除]  [重置自动排除]                       │ │
│ └──────────────────────────────────────────────────┘ │
│                                                      │
│ 🧠 三进制微模型                                       │
│ ┌──────────────────────────────────────────────────┐ │
│ │ 🌱 coding    种子期   128 params  12 步训练       │ │
│ │ 🪴 reasoning 成长期   512 params  89 步训练       │ │
│ └──────────────────────────────────────────────────┘ │
│                                                      │
│ 📊 调度策略: (●) task_match  ( ) cost_optimized     │
│             ( ) quality_first                        │
│ 每小时预算: [¥0.50]                                  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**变更说明**：旧版有"主模型"和"轻量模型"两个独立配置区域，新版用"API 端点"替代。用户只管 API key，模型自动发现。活跃模型池、已排除、三进制、调度策略等面板保持不变。

### 3.2 AgentTrace — 模型决策可视化

在现有 thinking/tool_call/tool_result/response 基础上，新增 `model_decision` 步骤：

```
🧠 三脑决策                          20:15:32
├─ 小脑: load=23 energy=85 → 无调节
├─ 右脑: intent=reasoning conf=0.82
├─ 左脑: novelty=0.35 → 从 12 个候选中选择
├─ 决策: DeepSeek-V3 (推理任务, Thompson 采样最优)
└─ 延迟: 12ms | 候选: Qwen72B, DeepSeek-V3, GLM-4

🔧 调用 LLM                         20:15:32
├─ 模型: deepseek-ai/DeepSeek-V3 (standard)
├─ 输入: 1,234 tokens → 输出: 567 tokens
├─ 延迟: 1.8s | 成本: ¥0.003
└─ 结果: ✅ 成功
```

### 3.3 CognitiveDashboard — 模型决策 Tab

新增 `模型决策` Tab，展示：
- 最近 10 次模型选择记录（任务/模型/路由层/结果）
- 模型使用分布柱状图
- Thompson Sampling 状态（探索系数/历史条数/学习偏好数）
- 按任务类型的最优模型排名

---

## 四、需要修改的文件

### 后端

| 文件 | 修改内容 | 复杂度 |
|------|---------|--------|
| `src/types.ts` | 1) 扩展 `OrchestrationNode` 增加 `provider/model/apiKey/baseUrl/selectionReason`<br>2) 新增 `ModelProfile`、`UserPoolPreferences`、`ModelRequirement` 类型<br>3) `BuddyConfig` 新增 `models` 字段，标记 `llm` 为 deprecated | 中 |
| `src/brain/types.ts` | 新增 `ModelRequirement` 类型（能力需求+约束），扩展 `ExecutionPlan.selectedNodes` 类型 | 低 |
| `src/brain/left/scheduler.ts` | 改造 `schedule()` 接收 `ModelProfile[]`，输出具体模型节点而非抽象 tier | 高 |
| `src/core/llm.ts` | 1) 新增 `chatWithNode(node)` 方法<br>2) 移除 `modelTierHint` 机制<br>3) `ModelRouter.select()` 改为从统一池中选择 | 高 |
| `src/core/model-router.ts` | 核心改造：去掉 primary/lightweight 二选一，改为统一模型池 + 三级漏斗 | 高 |
| **新增** `src/core/model-pool-unified.ts` | 统一模型池管理：自动发现 + 裁剪 + 标注 + Thompson Sampling | 高 |
| **新增** `src/core/model-discovery.ts` | 聚合平台模型自动发现（`/v1/models` 拉取 + 裁剪 + 标注） | 中 |
| **新增** `src/core/model-knowledge.ts` | 内置模型能力静态表（冷启动用，200+ 模型的能力评分） | 中 |
| **新增** `src/core/model-access-verifier.ts` | 两层验证：端点验证 + LLM 验证 + 异步预验证 + 状态缓存 | 高 |
| `src/core/subsystems.ts` | 初始化统一模型池，注册三进制为 LocalExpert | 中 |
| `src/core/agent.ts` | 桥接三脑决策与 `chatWithNode`，新增 `model_decision` WS 事件 | 中 |
| `src/core/ws-handler.ts` | 处理前端模型池管理请求（排除/偏好/查看/添加端点） | 中 |
| `src/core/config.ts` | 配置迁移逻辑（旧 `llm` → 新 `models`），向后兼容 | 中 |
| `src/tools/ternary-expert.ts` | 实现 `LocalExpert` 接口，让三进制接入统一模型池 | 中 |

### 前端

| 文件 | 修改内容 | 复杂度 |
|------|---------|--------|
| `frontend/src/components/Settings.tsx` | 核心改造：去掉"主模型/轻量模型"配置，改为 API 端点管理 + 模型池展示 | 高 |
| `frontend/src/components/AgentTrace.tsx` | 新增 `model_decision` 步骤渲染 | 低 |
| `frontend/src/components/CognitiveDashboard.tsx` | 新增"模型决策" Tab | 中 |
| `frontend/src/hooks/useWebSocket.ts` | 处理 `model_decision` 事件 | 低 |
| `frontend/src/types/buddy.ts` | 新增 `ModelDecision`、`ModelProfile` 类型定义 | 低 |

---

## 五、实施阶段

### Phase 1: 后端核心链路打通（优先级最高）

**目标**：统一模型池 + 三脑直接选模型 + 聚合平台自动发现

1. 新增 `src/core/model-knowledge.ts` — 内置模型能力静态表
2. 新增 `src/core/model-discovery.ts` — 聚合平台自动发现
3. 新增 `src/core/model-pool-unified.ts` — 统一模型池 + 三级漏斗
4. 扩展 `src/types.ts` — 新类型定义 + `BuddyConfig.models` 字段
5. 改造 `src/core/model-router.ts` — 从统一池中选择
6. 改造 `src/core/llm.ts` — `chatWithNode()` + 移除 `modelTierHint`
7. 改造 `src/brain/left/scheduler.ts` — 输出具体模型节点
8. 三进制注册为 `LocalExpert`
9. 桥接 `src/core/agent.ts` 决策流
10. 配置迁移 `src/core/config.ts`

### Phase 2: 模型可用性管理 + 容错

**目标**：端点/模型两级验证，区分永久失效与临时故障，自动跳过不可用模型

1. 实现端点验证（`verifyEndpoint`）— 添加端点时同步验证 Key 有效性
2. 实现 LLM 验证（`verifyModelAccess`）— 首次选中时异步验证模型可访问性
3. 实现异步预验证（`preVerifyModels`）— 端点添加后后台批量验证
4. 实现模型状态机（available/denied/broken/unknown）— 运行时自动更新
5. 实现错误分类与升级机制 — 模型级 vs 端点级，连续 402 升级为账户余额不足
6. 实现状态自动恢复 — 调用成功时从 denied 恢复为 available
7. 实现用户通知策略 — 区分严重程度，只通知需要用户操作的事件

### Phase 3: 用户控制 + 可观测性

**目标**：用户可管理模型池，决策过程可追踪

1. 实现用户偏好系统（黑名单/偏好/成本上限）
2. 新增 `model_decision` WS 事件
3. 改造 `AgentTrace` 显示模型决策
4. 扩展 `ws-handler` 处理前端模型管理请求

### Phase 4: 前端 UI

**目标**：完整的模型池管理界面

1. 改造 `Settings.tsx` — API 端点管理 + 模型池展示（去掉主模型/轻量模型）
2. 新增 `CognitiveDashboard` 模型决策 Tab
3. 模型使用统计图表
4. 端点/模型状态展示（可用/不可用/验证中）

---

## 六、与现有系统的关系

| 现有模块 | 关系 | 改动 |
|---------|------|------|
| `config.llm` (primary) | **废弃**，迁移到 `config.models.providers` | 废弃 |
| `config.llm.lightweight` | **废弃**，自动成为 providers 列表中的一个 | 废弃 |
| `config.pool` | **废弃**，合并到统一模型池 | 废弃 |
| `ModelPool` | 基础设施保留，改造为统一池的底层 | 中改 |
| `ModelPoolScheduler` | 三层调度保留，集成到统一池的 Layer 2 | 中改 |
| `ModelRouter` | 核心改造：去掉 primary/lightweight 二选一 | 大改 |
| `UnifiedScheduler` | 核心改造：输出具体模型而非抽象 tier | 大改 |
| `LLMAdapter` | 新增 `chatWithNode()`，移除 `modelTierHint` | 中改 |
| `TernaryEngine` | 不改，通过 `LocalExpert` 接口接入 | 不改 |
| `DecisionRecorder` | 保留，记录模型决策数据 | 不改 |
| `ThreeBrain` | 不改，`decide()` 输出的 `ExecutionPlan` 自然扩展 | 不改 |

---

## 七、风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| 旧配置不兼容 | 升级后无法启动 | 自动迁移逻辑，向后兼容 |
| 聚合平台 API 不稳定 | 模型列表拉取失败 | 缓存上次成功结果，离线模式降级 |
| Thompson Sampling 冷启动 | 初期随机选择质量差 | 静态知识表提供初始参数 |
| 模型能力标注不准 | 选错模型 | 运行时学习自修正 + 用户反馈 |
| 三进制模型质量不够 | 降级体验 | 置信度阈值控制，不够则 fallback 到云端 |
| 成本失控 | 花太多钱 | 每小时预算硬限制 + 熔断器 |
| 模型池太大(100+) | 效率问题 | 三级漏斗：静态裁剪→元数据快筛→Thompson采样（只在10-15个里选） |
| Key 权限不足 | 部分模型调用失败 | 首次调用时按模型粒度验证，标记不可用模型 |
| 余额/额度耗尽 | 全部模型不可用 | 连续多个模型 402 → 升级为端点级，通知用户充值 |
| 模型被平台下架 | 单个模型不可用 | 调用失败后标记 denied，每天允许重试一次（可能重新上架） |
| 用户充值后模型恢复 | 之前 denied 的模型又能用了 | 调用成功自动恢复状态，denied 模型每小时允许重试 |

---

## 八、成功指标

| 指标 | 目标 | 衡量方式 |
|------|------|---------|
| 模型选择延迟 | <5ms | `brain_trace` 事件中的 `brainLatencyMs` |
| 任务成功率 | >80% | Thompson Sampling 统计 |
| 成本节约 | 相比固定用单模型节省 30%+ | `DecisionRecorder` 成本统计 |
| 三进制利用率 | 闲聊任务 >50% 走三进制 | 模型决策统计 |
| 用户满意度 | 排除/偏好操作 <3 次/天 | 前端操作日志 |
| 配置简化 | 用户只需填 API Key | 配置字段数对比 |
| 不可用模型首次命中率 | <5%（预验证覆盖的） | 验证后直接跳过 vs 调用时才发现 |
| 永久失效恢复延迟 | <1 小时（充值后） | denied → available 的状态转换时间 |
| 用户感知的失败次数 | 相比无验证减少 80%+ | 超时/错误次数统计 |

---

## 九、附录：Thompson Sampling 在统一池中的工作方式

### 为什么用 Thompson Sampling 而非其他算法？

| 算法 | 优点 | 缺点 |
|------|------|------|
| UCB | 理论保证 | 需要维护全局计数器，不适合动态池 |
| ε-greedy | 简单 | 探索效率低，浪费成本 |
| **Thompson Sampling** | 自然平衡探索/利用，支持动态增减节点，无需全局状态 | 需要 Beta 分布近似 |
| DNN 路由 | 理论最优 | 脆弱、不安全、需要大量训练数据 |

Thompson Sampling 的 Beta(α, β) 参数：
- α = 加权成功次数 + 1（先验）
- β = 加权失败次数 + 1（先验）
- 每次调用后根据结果更新
- 按 taskType 分维度统计（避免"一个模型什么任务都选它"）

### 选择过程示例

```
任务: "分析代码性能" (taskType=reasoning, complexity=complex)

候选池 (Layer 1 过滤后 12 个):
  DeepSeek-V3     α=24, β=3   → sample=0.89
  Qwen2.5-72B     α=18, β=5   → sample=0.72
  Qwen2.5-7B      α=15, β=8   → sample=0.55
  GLM-4-9B        α=10, β=6   → sample=0.61
  Llama-3.1-8B    α=8,  β=7   → sample=0.48
  ...

Thompson Sampling 采样 → DeepSeek-V3 sample=0.89 最高 → 选中

调用后反馈:
  DeepSeek-V3 成功, 延迟 1.8s, 成本 ¥0.003
  → α += weightedSuccess(1.8s, ¥0.003) = 0.85
  → DeepSeek-V3 在 reasoning 任务上 α=24.85, β=3
```
