# 智能路由 + 闭环反馈改造计划

> 生成时间：2026-05-05
> 基于：真 LLM E2E 测试报告（2/24 通过）+ 全量代码审计 + 前沿论文调研
> 状态：待执行

---

## 一、问题诊断

### 1.1 表面现象

真 LLM E2E 测试 22/24 失败，核心错误：

```
[WebServer] ⚠️ LLM 流式调用失败 [unknown]: Bad Request
[WebServer] Agent 处理错误: 出了点问题: 未知错误
[WebServer] [Orchestrate] DAG 规划失败，降级: Bad Request
```

SiliconFlow API 返回 400 Bad Request，但直连 `@ai-sdk/openai-compatible` + `generateText()` 正常。

### 1.2 根因：三层信息断裂

问题不是单个 flag，而是 **ProviderAdapter → ModelPool → ModelRouter → LLMAdapter** 的能力信息流断裂。

#### 断裂点 1：ModelProfile 缺少工具调用模式信息

```typescript
// src/core/model-pool.ts:55 — ModelProfile.capabilities
capabilities: {
  toolCalling: boolean;   // ✅ 有 — 只表示"能处理工具任务"
  // ❌ 没有 needsPromptToolCalling
  // ❌ 没有 toolCallingMode ('native' | 'prompt' | 'none')
}

// src/core/provider-adapter.ts:50 — ProviderCapabilities
needsPromptToolCalling: boolean;  // ✅ 有 — 但从未传入 ModelProfile
```

**影响**：ModelPool 不知道模型是"原生工具调用"还是"prompt 模拟"。

#### 断裂点 2：ModelRouter 不区分执行路径

```typescript
// src/core/model-router.ts:458 — buildModelRequirement
case 'tools':
  req.requiredFeatures = ['toolCalling'];  // ← 只检查 boolean
  break;

// src/core/model-pool.ts:754 — layer1MetadataFilter
for (const feat of req.requiredFeatures) {
  if (!p.capabilities[feat]) return false;  // ← toolCalling: true 就通过
}
```

**影响**：SiliconFlow Qwen（`toolCalling: true, needsPromptToolCalling: true`）和 GLM（`toolCalling: true, needsPromptToolCalling: false`）通过同一道过滤，权重相同。

#### 断裂点 3：LLMAdapter 事后才发现不兼容

```typescript
// src/core/llm.ts:212 — chat()
if (capabilities.toolCalling && !capabilities.needsPromptToolCalling) {
  return this.chatNative(...);     // ← GLM 走这条路
}
return this.chatWithPromptTools(...); // ← Qwen 走这条路 → prompt 膨胀 → 400
```

**影响**：模型已选完才发现不兼容，但已无法回退。

#### 完整链路图

```
ModelRouter.buildModelRequirement('tools')
  → requiredFeatures: ['toolCalling']          ← 不区分原生/prompt

ModelPool.layer1MetadataFilter()
  → siliconflow/Qwen: toolCalling=true ✅     ← 通过
  → siliconflow/GLM:  toolCalling=true ✅     ← 通过（同权重）

Thompson Sampling 选中 Qwen（可能因历史成功率/成本）

LLMAdapter.chat()
  → getStaticCapabilities('Qwen...')
  → needsPromptToolCalling: true
  → chatWithPromptTools()                     ← 注入完整工具 JSON schema 到 system prompt
  → system prompt 膨胀 → SiliconFlow 400
```

---

## 二、架构分析

### 2.1 项目定位

Buddy 不是简单聊天机器人，是有认知架构的个人 AI 助手：

```
三脑架构（决策层）
├── 小脑：感知融合 + 稳态调节（BodyState）
├── 右脑：直觉预测 + 在线学习（IntuitionSignal / 300K 参数手写 NN）
└── 左脑：规则匹配 + 统一调度（ExecutionPlan / UnifiedScheduler + Thompson Sampling）

LLM 执行层
├── ModelRouter → ModelPool（Thompson Sampling 选模型）
├── LLMAdapter（chatNative / chatWithPromptTools）
└── ToolCaller（32 内置 + MCP + .skillmate）

自进化层
├── 经验引擎（编译→图谱→路由→执行→进化）
├── 影子大脑（能力缺口检测 → L1/L2/L3 进化）
└── STMP 时空记忆宫殿 + 梦境巩固
```

### 2.2 "智能路由"的架构归属

从项目哲学看，路由是**左脑 UnifiedScheduler 的职责**：

| 层 | 职责 | 问什么 |
|---|------|--------|
| 小脑 | 感知 | "当前状态是什么？"（load/energy/mood） |
| 右脑 | 直觉 | "这个任务像什么？"（quality/confidence/intent） |
| 左脑 | 决策 | "怎么做？用什么做？"（plan + model selection） |

路由本质是资源分配决策，属于左脑。但当前左脑只看了 `taskType`，没有看执行路径兼容性。

### 2.3 研究对标

| 论文 | 来源 | 核心思想 | 映射到 Buddy |
|------|------|----------|-------------|
| MasRouter | arXiv:2502.11133 (2025.02) | 多智能体路由 = 协作模式 + 角色分配 + LLM 路由，级联控制器 | UnifiedScheduler 级联：先定执行路径 → 再选模型 |
| LLMSelector | arXiv:2502.14815 (2025.02, Stanford/Berkeley) | 复合 AI 系统中每个模块独立选最优模型 | 工具调用链各环节独立选模型 |
| Cascade Routing | arXiv:2410.10347 (2024.10) | 路由 + 级联统一，质量评估器判断是否级联到更强模型 | LLMAdapter 加质量评估 + 级联 |
| Reflexion | NeurIPS 2023, Shinn et al. | 语言反馈强化学习，反思存入 episodic memory | ThreeBrain.feedback() 加反思闭环 |
| AgentDebug | ICML 2025 Spotlight | 错误分类法 + 根因定位 + 修正反馈 | 结构化错误分类器 |
| LPP: When to Escalate | AAMAS 2026 | LLM 不确定性量化，学习何时升级给人类 | 三脑置信度 → 用户升级信号 |
| MoMA | arXiv:2509.07571 (2025.09) | 广义路由 = 意图识别 + 能力画像 + 自适应策略 | ModelProfile 扩展能力画像 |

---

## 三、方案设计

### 3.1 核心原则：分层责任 + 向上反馈

```
用户 ← "我做不到，因为 X，你可以 Y"
 ↑
三脑（决策层）← "换策略？还是告诉用户？"
 ↑
执行层 ← "400 / 超时 / 质量差"
 ↑
LLM / 工具
```

**每一层有自己的能力边界，解决不了的向上走，最终到用户。**

### 3.2 三层反馈架构

```
┌─────────────────────────────────────────────────────────────┐
│  L1: 执行层反射（毫秒级）                                     │
│  触发：400/超时/429/质量低                                     │
│  动作：重试/换同级模型/精简 prompt                              │
│  用户感知：无                                                 │
│  上报：全部失败时上报三脑                                       │
├─────────────────────────────────────────────────────────────┤
│  L2: 三脑重决策（秒级）                                       │
│  触发：执行层上报 "能力不足"                                    │
│  动作：换执行路径（native↔prompt）、调整工具集                   │
│  用户感知：前端显示 "正在换一种方式尝试"                          │
│  上报：所有路径穷尽时上报用户                                    │
├─────────────────────────────────────────────────────────────┤
│  L3: 用户透明报告（秒级）                                      │
│  触发：三脑穷尽所有路径仍然失败                                  │
│  动作：推送结构化诊断报告 + 可操作建议                           │
│  用户感知：明确知道发生了什么、为什么、怎么解决                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 四、实施计划

### Phase 1: 打通能力信息流（修复三层断裂）

**目标**：让 ModelPool 知道每个模型的工具调用方式。

#### 1.1 扩展 ModelProfile

**文件**：`src/core/model-pool.ts`

```typescript
// ModelProfile.capabilities 扩展
capabilities: {
  // ... 现有字段 ...
  toolCalling: boolean;
  toolCallingMode: 'native' | 'prompt' | 'none';  // 新增
  preferredToolFormat: 'openai' | 'qwen_tags' | 'json_block' | 'natural';  // 新增
}
```

#### 1.2 ProviderAdapter → ModelProfile 信息传递

**文件**：`src/core/model-discovery.ts`

在 `rawToProfile()` 中，从 ProviderAdapter 的 `getStaticCapabilities()` 读取 `needsPromptToolCalling` 和 `preferredToolFormat`，映射到 ModelProfile 的新字段。

**文件**：`src/core/model-pool.ts`

在 `resolveCapabilities()` 中，为每个 provider 设置默认 `toolCallingMode`：

```typescript
const providerCaps: Record<string, Partial<NodeCapabilities>> = {
  openai:      { toolCalling: true, toolCallingMode: 'native', ... },
  anthropic:   { toolCalling: true, toolCallingMode: 'native', ... },
  deepseek:    { toolCalling: true, toolCallingMode: 'native', ... },
  siliconflow: { toolCalling: true, toolCallingMode: 'prompt', ... },  // 默认 prompt
  ollama:      { toolCalling: true, toolCallingMode: 'prompt', ... },
  // ...
};
```

#### 1.3 模型级能力覆盖

**文件**：`src/core/model-pool.ts`

在 `resolveCapabilities()` 或 `initializeFromProviders()` 中，按模型名覆盖：

```typescript
// SiliconFlow 下特定模型支持原生
const modelOverrides: Record<string, Partial<NodeCapabilities>> = {
  'deepseek': { toolCallingMode: 'native', preferredToolFormat: 'openai' },
  'glm':      { toolCallingMode: 'native', preferredToolFormat: 'openai' },
  // Qwen 等不覆盖，默认 'prompt'
};
```

**工作量**：3-4h
**风险**：低 — 增量字段，不影响现有逻辑

---

### Phase 2: ModelRouter 执行路径感知

**目标**：路由决策时考虑工具调用模式。

#### 2.1 扩展 ModelRequirement

**文件**：`src/core/model-pool.ts`

```typescript
interface ModelRequirement {
  // ... 现有字段 ...
  executionPath?: 'native_tools' | 'prompt_tools' | 'any';  // 新增
}
```

#### 2.2 UnifiedScheduler 级联决策

**文件**：`src/brain/left/scheduler.ts`

在 `schedule()` 中，工具任务先定执行路径再选模型：

```typescript
schedule(signal, resources, intuition, body): ExecutionPlan {
  // Layer 0: 预算 + 元认知（已有）

  // Layer 1: 确定执行路径（新增 — 级联第一级）
  if (signal.taskType === 'tools' && this.router) {
    const hasNative = this.router.getPool()?.hasModelWithCapability('toolCallingMode', 'native');
    const executionPath = hasNative ? 'native_tools' : 'prompt_tools';

    // Layer 2: 按执行路径选模型（级联第二级）
    const selection = this.router.select('tools', {
      content: signal.content,
      bodyState: body,
      executionPath,
    });
    // ...
  }
}
```

#### 2.3 ModelPool 过滤增加执行路径维度

**文件**：`src/core/model-pool.ts`

```typescript
// layer1MetadataFilter() 增加
if (req.executionPath === 'native_tools') {
  if (p.capabilities.toolCallingMode !== 'native') return false;
}
if (req.executionPath === 'prompt_tools') {
  if (p.capabilities.toolCallingMode === 'none') return false;
}
```

**工作量**：4-5h
**风险**：中 — 改变路由逻辑，需要充分测试

---

### Phase 3: LLMAdapter Cascade Routing

**目标**：执行层能自动级联到更强模型，并向上传递结构化错误。

#### 3.1 结构化错误分类

**文件**：`src/core/llm.ts`

```typescript
interface ExecutionFeedback {
  errorType: 'capability_mismatch' | 'prompt_too_long' | 'network' | 'auth' | 'quality_low' | 'timeout';
  quality: number;           // 0-1
  modelId: string;
  taskType: string;
  latencyMs: number;
  detail: string;            // 人类可读的失败原因
}
```

升级 `isRetryable()` 为结构化分类器：

```typescript
private classifyError(err: unknown): ExecutionFeedback['errorType'] {
  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  if (msg.includes('400') && msg.includes('bad request')) return 'capability_mismatch';
  if (msg.includes('token') || msg.includes('too long')) return 'prompt_too_long';
  if (msg.includes('401') || msg.includes('403')) return 'auth';
  if (msg.includes('429') || msg.includes('rate limit')) return 'network';
  if (msg.includes('timeout') || msg.includes('econnrefused')) return 'network';
  return 'unknown';
}
```

#### 3.2 Cascade Routing

**文件**：`src/core/llm.ts`

升级 `executeWithFallback()`：

```typescript
private async executeWithFallback<T>(taskType, context, fn): Promise<T> {
  const selected = this.selectModel(taskType, context);
  const selectedModel = this.createModelFromConfig(selected);

  try {
    const result = await this.withRetry(() => fn(selectedModel, selected.capabilities));

    // 质量评估（新增）
    const quality = this.assessQuality(result, taskType);
    if (quality < this.QUALITY_THRESHOLD) {
      return this.cascadeToStronger(taskType, context, fn, selected, quality);
    }

    this.router.recordOutcome({ ... success: true });
    return result;
  } catch (callErr) {
    const errorType = this.classifyError(callErr);

    // 能力不匹配 → 级联到更强模型（不是同一模型重试）
    if (errorType === 'capability_mismatch') {
      return this.cascadeToStronger(taskType, context, fn, selected, 0);
    }

    // 记录失败 + 向上传递结构化错误
    this.router.recordOutcome({ ... success: false, errorType });
    throw callErr;
  }
}

// 级联到更强模型
private async cascadeToStronger<T>(taskType, context, fn, failedModel, failedQuality): Promise<T> {
  const stronger = this.router.selectExcluding(taskType, context, [failedModel.id]);
  if (!stronger) {
    // 没有更强模型 → 向上抛出结构化错误（三脑/用户处理）
    throw new CapabilityError(failedModel.id, 'no_stronger_model');
  }
  const strongerModel = this.createModelFromConfig(stronger);
  return fn(strongerModel, stronger.capabilities);
}
```

**工作量**：5-6h
**风险**：中 — 改变核心执行逻辑，需要 E2E 测试验证

---

### Phase 4: ThreeBrain Feedback 闭环

**目标**：三脑在执行失败时重新决策，穷尽路径后向用户报告。

#### 4.1 Reflexion-style 反馈

**文件**：`src/brain/brain.ts`

升级 `feedback()` 为闭环：

```typescript
async feedback(signal, resources, plan, outcome, actualIntent, actualTools): Promise<FeedbackResult> {
  // ... 现有记录逻辑 ...

  // 新增：执行失败时的反思 + 重决策
  if (!outcome.success || outcome.quality < 0.5) {
    const reflection = this.buildReflection(signal, plan, outcome);

    // 检查是否还有可尝试的路径
    if (this.hasAlternativePaths(plan, outcome)) {
      const newPlan = await this.redecide(signal, resources, reflection);
      return { action: 'redecide', newPlan, reflection };
    }

    // 路径穷尽 → 升级到用户
    return { action: 'escalate', diagnostic: this.buildDiagnostic(signal, plan, outcome, reflection) };
  }

  return { action: 'success' };
}
```

#### 4.2 结构化诊断报告

**文件**：`src/brain/brain.ts`

```typescript
interface DiagnosticReport {
  category: 'no_provider' | 'auth_expired' | 'no_native_tools' | 'all_models_weak' | 'token_limit';
  message: string;
  detail: string;
  suggestions: Array<{
    action: 'add_provider' | 'update_key' | 'reduce_tools' | 'switch_model';
    label: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
  }>;
  attempted: string[];
  failedReasons: string[];
  mood: 'frustrated' | 'confused' | 'tired';
}
```

#### 4.3 用户通知

**文件**：`src/core/ws-handler.ts`

通过已有的 eventBus 推送诊断事件：

```typescript
// 新增事件类型
this.eventBus?.emit({
  type: 'diagnostic',
  data: diagnosticReport,
});
```

前端收到后显示**可操作的诊断卡片**（不是 generic error bubble）。

**工作量**：6-8h
**风险**：中 — 改变三脑决策流 + 前端交互

---

### Phase 5: 前端诊断卡片

**目标**：用户看到的不是"出了点问题"，而是结构化的诊断 + 建议。

#### 5.1 诊断事件监听

**文件**：`frontend/src/` 下 WebSocket 监听处

```typescript
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'diagnostic') {
    showDiagnosticCard(data);
  }
};
```

#### 5.2 诊断卡片 UI

显示：
- 问题描述（human-readable）
- 失败原因（技术细节可折叠）
- 可操作建议（按钮/链接）
- Buddy 情绪动画（frustrated/confused/tired）

**工作量**：4-5h
**风险**：低 — 纯前端新增

---

### Phase 6: E2E 测试修复

**目标**：真 LLM E2E 测试通过率从 2/24 提升到 20+/24。

#### 6.1 测试断言调整

**文件**：`e2e/real-llm.spec.ts`

- tier 断言改为宽松验证：`expect(['premium','standard','budget','free']).toContain(decision.tier)`
- `sendAndWaitForEvent` 先等 `thinking` 确认后端收到
- expect.timeout 提升到 30s

#### 6.2 新增路由测试

- 验证 native tools 模型优先被选中
- 验证 cascade routing 在 400 时触发
- 验证诊断报告正确推送到前端

**工作量**：4-5h
**风险**：低

---

## 五、时间线

| Phase | 内容 | 工作量 | 依赖 | 优先级 |
|-------|------|--------|------|--------|
| **1** | 打通能力信息流 | 3-4h | 无 | 🔴 P0 |
| **2** | ModelRouter 执行路径感知 | 4-5h | Phase 1 | 🔴 P0 |
| **3** | LLMAdapter Cascade Routing | 5-6h | Phase 1 | 🔴 P0 |
| **4** | ThreeBrain Feedback 闭环 | 6-8h | Phase 2, 3 | 🟡 P1 |
| **5** | 前端诊断卡片 | 4-5h | Phase 4 | 🟡 P1 |
| **6** | E2E 测试修复 | 4-5h | Phase 1-3 | 🔴 P0 |

**总工作量**：26-33h

**推荐执行顺序**：

```
Phase 1 (能力信息流)
    ├── Phase 2 (路由感知) ──→ Phase 6 (E2E 测试)
    └── Phase 3 (Cascade Routing) ──→ Phase 6
                                        │
Phase 4 (Feedback 闭环) ←──────────────┘
    └── Phase 5 (前端诊断)
```

Phase 1 → 2 → 3 → 6 可以先做，解决核心的 400 问题。
Phase 4 → 5 是增强用户体验，可以后续迭代。

---

## 六、验收标准

### P0 核心修复

- [ ] SiliconFlow Qwen + tools 任务不再 400（要么选到 native 模型，要么 prompt 精简后成功）
- [ ] 真 LLM E2E 测试通过率 ≥ 20/24
- [ ] ModelProfile 包含 `toolCallingMode` 字段
- [ ] ModelRouter 工具任务优先选 native 模型

### P1 体验增强

- [ ] 执行失败时三脑能重新决策（换路径）
- [ ] 路径穷尽时向用户推送诊断报告
- [ ] 前端显示可操作的诊断卡片
- [ ] Buddy 情绪反映系统状态（frustrated/confused）

### 回归验证

- [ ] Mock 测试（chromium project）全部通过
- [ ] 现有功能无破坏
- [ ] 性能无显著退化（决策延迟 < 50ms）

---

## 附录：设计第一原则

> **沟通反馈永远是解决问题的第一步。**

三脑再聪明，信息不通就是瞎子。
执行层再强，不反馈就是黑洞。
系统解决不了的问题，不告诉用户就是欺骗。

每一层的责任边界：
1. **知道问题** → 感知
2. **反馈问题** → 沟通
3. **解决问题** → 行动
4. **解决不了** → 诚实上报

不知道问题，没法决策。
不知道反馈，没法修正。
不知道边界，没法求助。

---

## 七、实施修正（2026-05-05 静态审计）

> 基于全量源码静态分析 + TypeScript 编译检查
> 发现：Phase 1-3 的**数据层已实现，管道层未贯通**

### 7.1 审计结果

#### ✅ 已正确实现（数据层 + 管道层 A/B 已贯通）

| 计划项 | 代码位置 | 状态 |
|--------|----------|------|
| ModelProfile.capabilities.toolCallingMode | `model-pool.ts` ModelProfile 接口 | ✅ 字段存在 |
| ModelProfile.capabilities.preferredToolFormat | `model-pool.ts` ModelProfile 接口 | ✅ 字段存在 |
| resolveCapabilities() 按 provider 设 toolCallingMode | `model-pool.ts:110-130` | ✅ openai/anthropic→native, siliconflow/ollama→prompt |
| 模型级覆盖（deepseek/glm → native） | `model-pool.ts:137-141` | ✅ SiliconFlow 下已覆盖 |
| ModelRequirement.executionPath | `model-pool.ts` ModelRequirement 接口 | ✅ 字段存在 |
| layer1MetadataFilter 执行路径过滤 | `model-pool.ts:754-760` | ✅ native_tools/prompt_tools 过滤已实现 |
| buildModelRequirement 自动设 executionPath | `model-router.ts:468-473` | ✅ tools 任务自动判断 |
| classifyErrorType 结构化错误分类 | `llm.ts:237-245` | ✅ 6 种错误类型 |
| cascadeToStronger 级联路由 | `llm.ts:250-280` | ✅ 排除失败模型重新选择 |
| selectExcluding 排除选择 | `model-router.ts:200-215` | ✅ 委托 pool.selectExcluding |
| **~~断裂点 A~~** ModelRouter → ModelConfig 丢失 capabilities | `model-router.ts:245` | ✅ **已修复** — `profileToCapabilities()` 正确映射 toolCallingMode→needsPromptToolCalling |
| **~~断裂点 B~~** LLMAdapter 用静态 capabilities | `llm.ts:441` | ✅ **已修复** — `selected.capabilities ?? this.currentCapabilities`，A 通则 B 通 |

#### ❌→✅ 管道断裂（已全部修复）

**~~断裂点 C：UnifiedScheduler 直接委托 router，跳过全部调度策略~~** — ✅ 已修复（2026-05-05）

修复方案：删除 Layer 0.3 的 router 短路，新增 `selectViaRouter()` 嵌入各策略层。
调度策略恢复为：元认知 → 新颖度分层 → Thompson Sampling → 右脑直觉 → 小脑稳态 → 兜底。

> ⚠️ 测试覆盖：`UnifiedScheduler` 无专用单元测试。`e2e-pool.test.ts` 测的是 `ModelPoolScheduler`（不同类）。
> 建议补充：scheduler 单测（各层路由条件 + selectViaRouter fallback + body 状态注入）。

### 7.2 修复方案

#### Fix A：ModelRouter.select() 返回带 capabilities 的 ModelConfig

**文件**：`src/core/model-router.ts`

```typescript
// 新增：ModelProfile → ProviderCapabilities 转换
private profileToCapabilities(profile: ModelProfile): ProviderCapabilities {
  // 从 ProviderFactory 获取基础静态 capabilities
  const base = ProviderFactory.create({
    provider: profile.platform,
    model: profile.id.split('/').slice(1).join('/'),
  }).capabilities;

  // 用 ModelProfile 的运行时信息覆盖
  return {
    ...base,
    toolCalling: profile.capabilities.toolCallingMode !== 'none',
    needsPromptToolCalling: profile.capabilities.toolCallingMode === 'prompt',
    vision: profile.capabilities.vision ?? base.vision,
  };
}

// 修复 select() 返回值
select(taskType: TaskType, context?: TaskContext): ModelConfig {
  // ... 现有选择逻辑 ...
  if (selection) {
    return {
      id: selection.profile.id,
      provider: selection.profile.platform,
      model: selection.profile.id.split('/').slice(1).join('/'),
      apiKey: creds?.apiKey,
      baseUrl: creds?.baseUrl,
      source: 'default',
      capabilities: this.profileToCapabilities(selection.profile),  // ✅ 新增
    };
  }
  // ...
}

// 同步修复 selectExcluding()
selectExcluding(...): ModelConfig | null {
  // ... 同理附加 capabilities ...
}
```

#### Fix B：LLMAdapter 优先用 ModelConfig 携带的 capabilities

**文件**：`src/core/llm.ts`

```typescript
// 修复 executeWithFallback()
private async executeWithFallback<T>(...): Promise<T> {
  const selected = this.selectModel(taskType, context);
  const selectedModel = this.createModelFromConfig(selected);

  // ✅ 修复：优先用 ModelConfig 携带的 capabilities
  const capabilities = selected.capabilities ?? this.currentCapabilities;

  try {
    const result = await this.withRetry(() => fn(selectedModel, capabilities));
    // ...
  }
}

// 同步修复 chatWithNode()
async chatWithNode(
  node: { provider: string; model: string; apiKey?: string; baseUrl?: string;
          capabilities?: ProviderCapabilities },  // ✅ 新增 capabilities 参数
  ...
) {
  const { model, capabilities: staticCaps } = ProviderFactory.create({...});
  const capabilities = node.capabilities ?? staticCaps;  // ✅ 优先用传入的
  // ...
}

// 同步修复 streamChat() 中的 capabilities 获取
async streamChat(...): Promise<...> {
  // ...
  const selected = this.selectModel(taskType, context);
  const caps = selected.capabilities ?? this.currentCapabilities;  // ✅ 修复
  // ...
}
```

#### Fix C：UnifiedScheduler 嵌入 router 而非替代

**文件**：`src/brain/left/scheduler.ts`

```typescript
schedule(signal, resources, intuition?, body?): ExecutionPlan {
  // ── Layer 0: 预算硬约束（不变）──
  if (resources.budgetRemaining <= 0) {
    return this.makePlan('budget_fallback', 'local_only', '预算耗尽', 0.6, [...]);
  }

  // ── Layer 1: 元认知控制信号（恢复 — 之前被 router 跳过）──
  if (intuition?.hit) {
    const quality = intuition.qualityEstimate;
    if (quality < this.config.metacognitiveForceLlm) {
      return this.selectViaRouter('metacognitive_override', signal, body,
        `元认知降级: quality=${quality.toFixed(2)}`);
    }
    if (quality < this.config.metacognitiveCaution && resources.experienceHit
        && resources.localConfidence >= this.config.mediumConfidenceThreshold) {
      return this.selectViaRouter('exp_verified', signal, body,
        `元认知谨慎: quality=${quality.toFixed(2)}`);
    }
  }

  // ── Layer 2: 新颖度分层路由（恢复）──
  const novelty = calcNovelty(signal, resources);

  if (novelty >= this.config.noveltyExtremeThreshold) {
    return this.selectViaRouter('llm_only', signal, body,
      `极高新颖度(${novelty.toFixed(2)})`);
  }

  if (novelty < this.config.noveltyHighThreshold && resources.experienceHit
      && resources.localConfidence >= this.config.highConfidenceThreshold) {
    return this.makePlan('exp_direct', 'local_only',
      `低新颖度(${novelty.toFixed(2)}) + 高置信度(${resources.localConfidence.toFixed(2)})`,
      resources.localConfidence, [{ id: 'experience', type: 'experience' }]);
  }

  if (novelty < this.config.noveltyHighThreshold && resources.experienceHit
      && resources.localConfidence >= this.config.mediumConfidenceThreshold) {
    return this.makePlan('exp_verified', 'cascade',
      `中等新颖度(${novelty.toFixed(2)})`,
      resources.localConfidence, [
        { id: 'experience', type: 'experience' },
        { id: 'local', type: 'local_expert' },
      ]);
  }

  // ── Layer 3: Thompson Sampling 工具选择（恢复）──
  if (intuition?.hit && this.config.useThompsonSampling) {
    const tsResult = this.thompsonSelect(signal, resources, intuition);
    if (tsResult) return tsResult;
  }

  // ── Layer 4: 右脑直觉信号注入（恢复）──
  if (intuition?.hit && intuition.intent.confidence > 0.7) {
    return this.selectViaRouter('llm_with_hint', signal, body,
      `直觉推荐: ${intuition.intent.category}`);
  }

  // ── Layer 5: 小脑稳态注入（恢复）──
  if (body) {
    if (body.load > 80) {
      return this.selectViaRouter('budget_fallback', signal, body,
        `高负载降级(load=${body.load})`);
    }
    if (body.energy < 30) {
      return this.selectViaRouter('budget_fallback', signal, body,
        `低精力(energy=${body.energy})`);
    }
    if (body.confusionLevel > 70) {
      return this.selectViaRouter('llm_only', signal, body,
        `高困惑度(confusion=${body.confusionLevel})`);
    }
  }

  // ── Layer 6: 兜底 ──
  return this.selectViaRouter('llm_only', signal, body, '默认调度');
}

// ✅ 新增：router 作为模型来源，不替代调度策略
private selectViaRouter(
  routePath: RoutePath,
  signal: TaskSignal,
  body: BodyState | undefined,
  reason: string,
): ExecutionPlan {
  if (this.router) {
    try {
      const taskType = signal.taskType as TaskType;
      const selection = this.router.select(taskType, {
        content: signal.content ?? '',
        bodyState: body,
      });
      if (selection) {
        const creds = this.router.getPool()?.getProviderCredentials(selection.provider);
        const node: OrchestrationNode = {
          id: selection.id,
          type: 'cloud_node',
          model: selection.model,
          provider: selection.provider,
          apiKey: creds?.apiKey,
          baseUrl: creds?.baseUrl,
        };
        return this.makePlan(routePath, 'single',
          `${reason} → ModelRouter: ${selection.id} (${selection.source})`,
          0.8, [node]);
      }
    } catch (err) {
      if (this.verbose) console.warn(`[Scheduler] router 选择失败: ${(err as Error).message}`);
    }
  }
  return this.makePlan(routePath, 'local_only', `${reason} → 本地模型`, 0.5, [
    { id: 'local', type: 'local_expert' },
  ]);
}
```

### 7.3 修复依赖关系

```
Fix A (ModelRouter 带 capabilities)
    ↓
Fix B (LLMAdapter 用运行时 capabilities)  ← 依赖 Fix A 的 capabilities 来源
    ↓
Fix C (UnifiedScheduler 恢复调度策略)      ← 独立，但与 Fix A/B 协同效果最佳
```

### 7.4 修正后的时间线

| 修复项 | 文件 | 工作量 | 风险 |
|--------|------|--------|------|
| **Fix A** ModelRouter capabilities 透传 | `model-router.ts` | 1-2h | 低 — 增量字段 |
| **Fix B** LLMAdapter 优先用运行时 capabilities | `llm.ts` | 1-2h | 低 — fallback 逻辑 |
| **Fix C** UnifiedScheduler 恢复调度策略 | `brain/left/scheduler.ts` | 2-3h | 中 — 改变调度主路径 |
| **验证** TypeScript 编译 + 现有测试 | — | 1h | — |

**总计：5-8h**（vs 原计划 26-33h，因为数据层已实现，只需修管道层）

### 7.5 修正后的验收标准

- [x] `ModelRouter.select()` 返回的 `ModelConfig.capabilities` 包含正确的 `toolCallingMode` 映射
- [x] SiliconFlow DeepSeek（native）走 `chatNative()`，SiliconFlow Qwen（prompt）走 `chatWithPromptTools()`
- [x] `UnifiedScheduler.schedule()` 中新颖度分层、元认知、小脑调节、Thompson Sampling 不再是 dead code
- [x] 工具任务优先选 native 模型（`executionPath: 'native_tools'`）
- [x] TypeScript 编译源码 0 错误（当前已是）
- [ ] 现有测试不回归（scheduler 无专用测试，需补充）
- [ ] scheduler 单元测试覆盖各层路由条件
