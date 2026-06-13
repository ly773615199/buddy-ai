# 真 LLM E2E 测试深度分析报告

**日期**: 2026-05-05  
**分析范围**: `e2e/real-llm.spec.ts` 及相关 fixture、helper、三脑架构核心模块  
**运行方式**: `SILICONFLOW_API_KEY=sk-xxx npx playwright test --project=real-llm e2e/real-llm.spec.ts`  
**最新运行结果**: 2 通过 / 22 失败 (16.4min)

---

## 一、测试架构总览

```
e2e/
├── real-llm.spec.ts          ← 核心：真 LLM 端到端测试（6 大维度，26 个用例）
├── real-llm-fixtures.ts      ← Fixture：SiliconFlow API 配置管理 + 生命周期
├── global-setup.ts           ← webServer 启动前预写 config（解决时序竞争）
├── helpers.ts                ← UI 操作辅助（sendMessage, waitForWSReady）
├── ws-event-collector.ts     ← WS 帧监听器（Playwright WebSocket API 直接抓帧）
├── fixtures.ts               ← Mock 基础设施（buddyState 注入、WS mock）
└── test-model-fixture.ts     ← 三进制模型 fixture（.ta 文件生成）
```

### 测试维度分布

| 维度 | 用例数 | 覆盖内容 |
|------|--------|----------|
| 前端配置 — 模型入池 | 4 | localStorage 注入、REST API 添加 provider、模型池状态、刷新发现 |
| 三脑决策 — 模型池选择 | 5 | model_decision 完整性、聊天/工具/推理任务选型、Thompson Sampling |
| 工具调用 — 真实能力 | 3 | read_file 执行、结果正确性、执行轨迹 |
| 多模型协作 — DAG | 3 | 多步骤工具调用、orch 事件、专家池选择 |
| 多模型切换 | 4 | 默认模型、切换模型、弱模型(7B)、强模型(32B) |
| 错误恢复 | 2 | 无效 key 恢复、无效 key 不崩溃 |
| 边界输入 | 3 | 超长消息(2000字符)、Emoji、特殊字符 |

---

## 二、最新运行结果 (2026-05-05 12:19)

### 结果总览

```
24 tests, 2 passed, 22 failed (16.4 min)
```

### 通过用例 (2)

| # | 用例 | 耗时 |
|---|------|------|
| 12 | agent_trace / brain_trace 执行轨迹存在 | 4.7s |
| 21 | 无效 key — 页面不崩溃 | 13.6s |

### 失败分类

#### 🔴 P0 新发现：SiliconFlow API Bad Request

后端 LLM 流式调用返回 `400 Bad Request`，但直连 `@ai-sdk/openai-compatible` + `generateText()` 正常。
问题出在 Buddy LLMAdapter 调用路径，非 API Key 或网络问题。

```
[WebServer] ⚠️ LLM 流式调用失败 [unknown]: Bad Request
[WebServer] Agent 处理错误: 出了点问题: 未知错误
[WebServer] [Orchestrate] DAG 规划失败，降级: Bad Request
```

**受影响用例 (17)**: #5-#11, #13-#20, #22-#24
- 所有需要 LLM 生成回复的测试均超时或断言失败
- LLM 事件链断裂：thinking 到了，但 response_end 未到达

**可能原因**:
1. `transformRequestBody` 的 `developer→system` role 转换干扰
2. `systemPrompt` 包含特殊字符导致 SiliconFlow 解析失败
3. 工具描述注入 prompt 后 token 超限
4. 三脑架构注入的 system prompt 格式与 SiliconFlow 不兼容

#### 🟡 前端配置测试失败 (4): #1-#4

| # | 失败原因 |
|---|----------|
| 1 | 超时 60s — bubble 事件未捕获（LLM 配置后未收到确认） |
| 2 | POST /api/model-pool/providers 返回非 ok（REST API 认证问题） |
| 3 | GET /api/model-pool 返回 body.profileCount 为 undefined |
| 4 | POST /api/model-pool/providers 非 ok（同 #2） |

#### 🟡 测试断言问题 (1): #22

| # | 失败原因 |
|---|----------|
| 22 | `expect(types).toContain('thinking')` 失败 — 收到 `["ack","status","llm_response","response_end"]`，说明 LLM 直接回复未经过 thinking 阶段 |

---

## 三、测试设计评估

### ✅ 优秀设计

#### 1. WS 事件驱动，不依赖文本匹配

`WSEventCollector` 直接监听浏览器 ↔ 后端的 WebSocket 帧，通过 Playwright 的 `page.on('websocket')` API 捕获 `framereceived` 事件，解析 JSON 后按类型分发。

```typescript
// ws-event-collector.ts
this.page.on('websocket', (ws: PlaywrightWS) => {
  ws.on('framereceived', (frame) => {
    const data = JSON.parse(frame.payload.toString());
    if (data && typeof data.type === 'string') {
      this.events.push(data);
      this.notify(data);
    }
  });
});
```

**优势**：不依赖 DOM 文本匹配（`page.textContent()` 轮询），不会因 UI 改版而断裂。事件类型与后端 `WSEvent` 类型严格对齐。

#### 2. 前后端配置分离 — 时序竞争解决

```
globalSetup (预写 ~/.buddy/config.json)
  → webServer 启动（读取 config）
    → beforeAll (setupRealLLMConfig 备份+覆盖)
      → 测试用例 (setupFrontendLLMConfig 注入 localStorage)
```

- `globalSetup` 在 webServer 启动前写入 config，确保后端启动时读到正确 LLM 配置
- `setupFrontendLLMConfig` 用 `page.addInitScript` 注入（解决 `about:blank` 禁止 `localStorage` 的问题）
- `cleanupSensitiveStorage` 每个测试后清除 apiKey（防止 Playwright trace 截图泄露密钥）

#### 3. Thompson Sampling 可观测性验证

测试验证了模型选择的完整决策链路：

```typescript
expect(decision.modelId).toBeTruthy();
expect(decision.tier).toBeTruthy();        // premium/standard/budget/free
expect(decision.reason).toBeTruthy();       // 选择原因
expect(decision.layer).toBeGreaterThanOrEqual(1);  // 漏斗层
expect(decision.candidateCount).toBeGreaterThanOrEqual(1);
expect(decision.taskType).toBeTruthy();
// tsSample 在 [0, 1] 范围内
if (event.tsSample !== undefined) {
  expect(event.tsSample).toBeGreaterThanOrEqual(0);
  expect(event.tsSample).toBeLessThanOrEqual(1);
}
```

#### 4. 安全意识强

- 每个测试结束后调用 `cleanupSensitiveStorage` 清除 apiKey
- `restoreConfig` 恢复原始配置文件
- `resyncBackendConfig` 在污染后重新同步正确凭据
- 无效 key 测试的 `finally` 块确保恢复

---

### ⚠️ 需要关注的问题

#### 问题 1：任务类型推断过于简单 — 关键词计数

**位置**: `src/core/model-router.ts` → `inferTaskType()`

```typescript
const toolScore = TOOL_KEYWORDS.filter((k) => lower.includes(k)).length;
if (toolScore >= 2) return 'tools';

const reasonScore = REASONING_KEYWORDS.filter((k) => lower.includes(k)).length;
if (reasonScore >= 2 || (reasonScore >= 1 && content.length > 200)) return 'reasoning';

if (content.length < 50) return 'chat';
return 'chat';
```

**问题分析**:

| 测试输入 | 工具关键词命中 | 推理关键词命中 | 实际分类 | 测试期望 |
|----------|---------------|---------------|----------|----------|
| `读取 package.json 文件的 name 字段` | `读取`(1个) | 0 | `chat` ❌ | `tools` |
| `分析一下这个项目的架构设计，为什么用三脑架构而不是单模型？` | 0 | `分析`,`为什么`,`架构`(3个) | `reasoning` ✅ | `reasoning` |
| `查看当前目录有哪些文件` | `查看`(1个) | 0 | `chat` ❌ | — |
| `先读取 package.json 看项目名，再读取 README.md 看简介` | `读取`(2次)=2个 | 0 | `tools` ✅ | — |

**风险**：`expect(decision.taskType).toBe('tools')` 这个断言在单次工具调用场景下可能失败，因为 `toolScore < 2`。

**建议**：
- 短期：降低 `tools` 阈值到 1，或把 `读取/查看/写入` 等动词权重提高
- 长期：用 LLM 做意图分类（已有 `IntentClassifier`，但未接入 `inferTaskType`）

---

#### 问题 2：模型选择断言硬编码 tier — 依赖模型池配置

**位置**: `real-llm.spec.ts` 多处

```typescript
// 测试断言简单聊天必须是 budget/standard
expect(['budget', 'standard']).toContain(decision.tier);
```

**问题**：tier 选择取决于模型池实际注册了什么模型。如果用户只配了一个 Qwen2.5-32B（tier=premium），这个断言会失败。测试不应该预设模型池的组成。

**建议**：改为宽松断言：

```typescript
// 只验证 tier 有值且在合法范围内
expect(['premium', 'standard', 'budget', 'free']).toContain(decision.tier);
```

---

#### 问题 3：`sendAndWaitForEvent` 存在消息丢失竞态

**位置**: `real-llm.spec.ts` → `sendAndWaitForEvent()`

```typescript
async function sendAndWaitForEvent(page, collector, message, timeoutMs = 120000) {
  collector.clear();
  await sendMessage(page, message);  // fire-and-forget: fill + Enter
  const terminalEvent = await collector.waitForAny(['response_end', 'error'], timeoutMs);
```

**问题**：`sendMessage` 只是填入 textarea + 按 Enter，没有确认消息已被后端接收。如果 WS 连接还在建立中或后端正在初始化，消息可能丢失，然后测试在 120s 后超时。

**建议**：发送后先等待一个早期事件（如 `thinking`）确认后端已收到：

```typescript
collector.clear();
await sendMessage(page, message);
// 先确认后端已收到消息
await collector.waitFor('thinking', 30000);
// 再等终止事件
const terminalEvent = await collector.waitForAny(['response_end', 'error'], timeoutMs);
```

---

#### 问题 4：超时设置需要根据模型能力调整

| 场景 | 当前超时 | 实际耗时估算 | 风险 |
|------|----------|-------------|------|
| real-llm project timeout | 60s | — | 对工具调用测试偏短 |
| sendAndWaitForEvent 默认 | 120s | thinking 10s + 工具 30s + 生成 60s = 100s | 逼近边界 |
| expect timeout (real-llm) | 15s | model_decision 可能需要 20-30s | 可能超时 |
| 普通 chromium expect | 5s | — | 真 LLM 不适用 |

**建议**：real-llm project 的 `expect.timeout` 提升到 30s。

---

#### 问题 5：错误恢复测试未验证后端模型池凭据更新

**位置**: `real-llm.spec.ts` → `无效 key 后恢复`

```typescript
// 恢复正确 key
await setupFrontendLLMConfig(page);
await resyncBackendConfig(page);  // 依赖前端 useEffect 自动发 llm_config
```

**问题**：`resyncBackendConfig` 依赖前端连接后自动发送 localStorage 中的 `llm_config` WS 消息。但后端的 `handleLLMConfig` 调用的是 `LLMAdapter.updateProvider()`，这只更新了默认 fallback 模型，**不会更新 ModelPool 中的 provider credentials**。

```
前端 llm_config → ws-handler → agent.handleLLMConfig → sys.llm.updateProvider()
                                                          ↓
                                                   只更新 currentModel
                                                   不更新 ModelPool.providerCredentials
```

**影响**：恢复后，如果 ModelRouter 从模型池选中了之前的 provider，可能仍用旧的（无效）凭据。

**建议**：`handleLLMConfig` 应同步更新 `ModelPool.getProviderCredentials()`。

---

#### 问题 6：`expert_pool_start` 测试用 try-catch 吞错误

```typescript
try {
  const event = await collector.waitFor('expert_pool_start', 60000);
  expect(event.taskId).toBeTruthy();
} catch {
  console.log('[专家池] ⚠️ expert_pool_start 未发射');
}
```

**问题**：这不是真正的断言。如果专家池功能完全坏了，测试依然 pass（只是打印警告）。

**建议**：至少用 `test.fail()` 标记为已知失败，或拆分为 `test.skip` + 注释说明条件。

---

## 三、三脑架构代码评估

### 架构信号流

```
用户输入 → 小脑(感知融合+稳态) → 右脑(直觉预测+NN) → 左脑(规则匹配+调度) → 执行
                                                                        ↓
执行结果 → 反馈给三脑（左脑记录决策、右脑在线学习、Thompson Sampling 更新）
```

### 核心模块评估

| 模块 | 文件 | 职责 | 评价 |
|------|------|------|------|
| **ThreeBrain** | `brain/brain.ts` | 三脑协作协议 | ✅ 清晰的信号流 + 决策融合 |
| **Cerebellum** | `brain/cerebellum/` | 感知融合 + 稳态调节 | ✅ homeostasis 机制完整 |
| **RightBrain** | `brain/right/` | 直觉预测 + NN 推理 | ✅ 在线学习 + 损失反馈 |
| **LeftBrain** | `brain/left/` | 规则匹配 + 调度 | ✅ 条件函数 + 决策分布 |
| **ModelPool** | `core/model-pool.ts` | 三级漏斗选择 | ✅ 静态裁剪→元数据→Thompson Sampling |
| **ModelRouter** | `core/model-router.ts` | 决策链入口 | ⚠️ `inferTaskType` 过于简单 |
| **DecisionRecorder** | `core/decision-recorder.ts` | 决策记录 + kNN 查询 | ✅ JSONL 持久化 + 多维加权 |
| **DAG 编排** | `orchestrate/dag.ts` | 多步骤任务 | ✅ 条件边 + 并行组 + 重试配置 |
| **IntentClassifier** | `core/intent-classifier.ts` | 意图分类 | ✅ 但未接入 inferTaskType |

### ModelPool 三级漏斗

```
Layer 0: 静态裁剪 — 黑名单、成本上限、必须能力（toolCalling/vision）
Layer 1: 元数据快筛 — tier 匹配、任务类型过滤、语言偏好
Layer 2: Thompson Sampling — Beta 分布采样（加权成功分，非简单 success/fail）
```

**亮点**：
- 多维反馈加权（延迟惩罚、成本惩罚、token 效率、用户反馈），不是简单二元 success/fail
- 按 `taskType:modelId` 聚合 Thompson Sampling 参数，分维度统计
- Beta 分布正态近似（避免引入 gamma 函数）

### 模型能力画像 (ModelProfile)

```typescript
interface ModelProfile {
  id: string;               // 'siliconflow/Qwen2.5-72B-Instruct'
  tier: 'premium' | 'standard' | 'budget' | 'free';
  capabilities: {
    reasoning: number;       // 0-1 能力评分
    code: number;
    chinese: number;
    toolCalling: boolean;    // 是否支持工具调用
    vision: boolean;
  };
  costPer1kInput: number;
  costPer1kOutput: number;
  stats: { totalCalls; successes; avgLatencyMs; byTaskType };
  source: 'platform_api' | 'static_knowledge' | 'user_added';
}
```

---

## 四、改进建议优先级

| 优先级 | 问题 | 影响 | 建议 | 状态 |
|--------|------|------|------|------|
| 🔴 P0 | ~~`inferTaskType` 关键词阈值~~ | ~~工具调用任务可能被误分类为 chat~~ | ✅ 已修复: `toolScore >= 2` → `>= 1` | ✅ |
| 🔴 P0 | ~~错误恢复不更新 ModelPool 凭据~~ | ~~恢复后可能仍用无效 key~~ | ✅ 已修复: `handleLLMConfig` 新增 `updateProviderCredentials` | ✅ |
| 🔴 P0 | SiliconFlow Bad Request (LLMAdapter 路径) | 17/24 测试失败，LLM 调用全部 400 | 排查 transformRequestBody / systemPrompt / token 超限 | 🔴 新增 |
| 🟡 P1 | 测试断言硬编码 tier | 测试依赖模型池配置 | 改为验证 tier 在合法范围内 | |
| 🟡 P1 | sendAndWaitForEvent 竞态 | 消息可能丢失导致超时 | 先等 thinking 事件确认 | |
| 🟡 P1 | 超时配置偏紧 | 真 LLM 慢响应可能超时 | expect.timeout 提升到 30s | |
| 🟡 P1 | REST API 认证问题 | 前端配置测试 #2/#4 失败 | 检查 page.request 是否携带 Authorization | |
| 🟢 P2 | expert_pool_start 吞错误 | 功能坏了测试仍 pass | 改为 test.fail 或显式 skip | |
| 🟢 P2 | IntentClassifier 未接入路由 | 两套意图分类系统并存 | 统一到 IntentClassifier | |

---

## 五、环境配置

```bash
# 依赖安装（跳过 electron 二进制下载）
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --registry=https://registry.npmmirror.com

# Playwright 使用系统 chromium（config 已配置）
# playwright.config.ts:
#   executablePath: '/usr/bin/chromium'
#   args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']

# 运行真 LLM 测试
SILICONFLOW_API_KEY=sk-xxx npx playwright test --project=real-llm e2e/real-llm.spec.ts

# 运行 mock 测试（不需要 API key）
npx playwright test --project=chromium
```

---

## 六、总结

**整体评价：测试设计质量高，架构合理。**

核心亮点：
1. WS 事件驱动的断言机制（不依赖 DOM 文本匹配）
2. 前后端配置分离 + 安全清理（apiKey 不泄露到 trace）
3. 三脑架构的 Thompson Sampling 可观测性验证
4. 六维测试覆盖（决策、工具、协作、切换、恢复、边界）

主要风险：
1. `inferTaskType` 关键词匹配过于简单，可能导致测试误判
2. 错误恢复路径未覆盖 ModelPool 凭据更新
3. 部分断言硬编码了模型池配置假设
