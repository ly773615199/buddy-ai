# Buddy 项目深度分析报告

> 分析日期: 2026-05-05
> 范围: 前端配置 → API端点 → LLM模型池 → 用户消息 → 三脑决策 → 任务执行 → 结果输出

---

## 一、完整数据流概览

```
┌─────────────────────────────────────────────────────────────────────┐
│                        用户交互层 (Frontend)                         │
│  Onboarding.tsx / Settings.tsx → 配置 API 端点                      │
│  ChatPanel.tsx → 发送消息                                            │
│  useWebSocket.ts → WS 连接管理                                       │
│  App.tsx → 状态协调 + 事件分发                                        │
└────────────────────────────┬────────────────────────────────────────┘
                             │ WebSocket (ws://host:8765/ws?token=xxx)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     通信层 (BuddyLink + EventBus)                    │
│  frontend/src/comm/link.ts — 4层管道: STATE→RELIABILITY→TRANSPORT   │
│  src/ws/server.ts — EventBus: WS服务器 + HTTP REST + Token认证       │
│  心跳 / ACK / 重连 / 离线队列 / REST降级                              │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Agent 核心 (BuddyAgent)                          │
│  src/core/agent.ts — 主类，串联所有子系统                              │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 消息预处理 (preprocessMessage)                                │   │
│  │  ├── 养成追踪 (pet.trackFeature)                             │   │
│  │  ├── 反馈检测 (feedback.detectCorrection)                    │   │
│  │  ├── 行为检测 (behavior.detectNegation/Repeat)               │   │
│  │  ├── 模式检测 (observer.detectPatterns)                      │   │
│  │  ├── 认知推断 (cognitive.inferFromMessage)                   │   │
│  │  ├── 实体提取 (entityStore.extractAndUpdate)                 │   │
│  │  ├── 感知事件 (perceptionBus.publish)                        │   │
│  │  ├── 记忆存储 (memory.addMessage)                            │   │
│  │  ├── 情绪更新 (cerebellum.onUserMessage)                     │   │
│  │  └── 提醒检测 (clock.notifyMessage)                          │   │
│  └──────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 编排决策 (orchestrate) — < 5ms，纯逻辑，无LLM调用             │   │
│  │  ├── Stage 1: collectSignals() — 纯语义分析                  │   │
│  │  │   ├── detectDomains() — 右脑分类 → 领域标签               │   │
│  │  │   └── assessTaskComplexity() — 复杂度评估                  │   │
│  │  ├── Stage 1.5: collectResourceState() — 运行时资源状态       │   │
│  │  │   ├── 本地专家覆盖度                                       │   │
│  │  │   ├── 本地置信度                                           │   │
│  │  │   ├── 预算剩余                                             │   │
│  │  │   └── 经验路由命中                                         │   │
│  │  └── Stage 2: decideCollaboration() — 策略决策                │   │
│  │      ├── 规则0: 经验路由命中 → local_only/cascade             │   │
│  │      ├── 规则1: 预算耗尽 → local_only                         │   │
│  │      ├── 规则2: 用户连续纠正 → local_only                     │   │
│  │      ├── 规则3: 本地完全覆盖+高置信度 → local_only            │   │
│  │      ├── 规则4: 无领域/简单任务 → single                      │   │
│  │      ├── 规则5: 多领域+可用节点≥2 → parallel                  │   │
│  │      ├── 规则6: 可用节点不足 → single                         │   │
│  │      └── 规则7: 默认 → cascade                                │   │
│  └──────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 三脑协作路径 (orchestrateWithThreeBrain)                      │   │
│  │  信号流: 小脑(感知) → 右脑(直觉) → 左脑(规则+调度)            │   │
│  │  详见「三脑架构」章节                                          │   │
│  └──────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 执行 (executeByPlan) — 7种模式                               │   │
│  │  ├── local_only — 本地专家直接回答                            │   │
│  │  ├── single — 单LLM调用                                       │   │
│  │  ├── parallel — 多专家并行 + 融合                             │   │
│  │  ├── cascade — 级联升级(质量不够→升级模型)                    │   │
│  │  ├── sequential — 接力传递上下文                               │   │
│  │  ├── debate — 多方论证 + 裁决                                 │   │
│  │  └── 经验直连/经验+质检/LLM+hint                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 消息后处理 (postprocessResult)                                │   │
│  │  ├── 记忆存储 (memory.addMessage)                            │   │
│  │  ├── STMP写入 (processor.storeToSTMP)                        │   │
│  │  ├── 情绪更新 (cerebellum.onResponseComplete)                │   │
│  │  ├── 认知更新 (cognitive.inferFromMessage)                   │   │
│  │  ├── 知识提取 (extractKnowledgeAsync)                        │   │
│  │  ├── 经验学习 (learnFromConversation)                        │   │
│  │  ├── 决策回写 (recorder.updateLastOutcome)                   │   │
│  │  └── 自动训练 (autoTriggerTraining)                          │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 二、前端 → API端点 → LLM模型池 详细链路

### 2.1 前端配置入口

**Onboarding.tsx (首次使用)**
- Step 1-3: 选择主色调/质感/气质 → 生成 VisualSeed
- Step 4 (LLM配置):
  - 选择 Provider (DeepSeek/OpenAI/硅基流动/Ollama/自定义)
  - 填写 API Key + Base URL + 模型名称
  - 「测试连接」→ WS 发送 `test_llm` → 后端返回 `test_llm_result`
  - 「开启旅程」→ `POST /api/model-pool/providers` (REST API 写入后端配置)
  - 同时调用 `onComplete()` 保存 VisualSeed 到 localStorage

**Settings.tsx (后续修改)**
- ModelsSection 组件:
  - `GET /api/model-pool` — 获取模型池状态(模型数/排除列表/策略)
  - `GET /api/config` — 获取已配置的 providers 列表
  - `POST /api/model-pool/providers` — 添加 API 端点
  - `DELETE /api/model-pool/providers` — 删除 API 端点
  - `POST /api/model-pool/exclude` — 排除模型
  - `PATCH /api/model-pool/preferences` — 修改调度策略
  - 支持9种 Provider: OpenAI/DeepSeek/Anthropic/Google/硅基流动/OpenRouter/MiMo/Ollama/自定义

**App.tsx (连接协调)**
- 获取 WS Token: `GET /api/ws-token` → 构建 `ws://host:8765/ws?token=xxx`
- 连接后自动发送 `llm_config` WS 消息(从 localStorage 读取)
- 后端收到后热重载 LLM adapter

### 2.2 后端配置处理

**config.ts**
- 配置文件: `~/.buddy/config.json`
- 唯一路径: `config.models.providers[]` (旧 `config.llm` 已迁移)
- 环境变量兜底: `OPENAI_API_KEY`/`DEEPSEEK_API_KEY`/`SILICONFLOW_API_KEY` 等
- 自动迁移: 旧 `llm`+`pool` 配置 → 统一 `models` 格式

**provider-registry.ts (ProviderFactory)**
- 根据 provider 类型创建 AI SDK 实例
- 支持: openai/deepseek/anthropic/google/ollama/siliconflow/openrouter/custom
- 每个 Provider 有独立的 adapter (消息预处理/错误分类/能力声明)

### 2.3 模型池 (ModelPool)

**model-pool.ts**
- 统一模型池: 所有 provider 的模型自动发现 + 画像
- 模型画像: id/platform/displayName/tier/capabilities/stats/cost
- 分层: budget(廉价) → standard(标准) → premium(高级)
- 熔断器: 连续失败3次自动排除，成功后恢复
- 统计持久化: JSON 文件存储调用次数/成功率/延迟

**model-pool-scheduler.ts**
- 调度策略: task_match(任务匹配) / cost_optimized(成本优先) / quality_first(质量优先)
- Thompson Sampling: 基于历史成功率的贝叶斯选择
- 域名路由: react/python/git 等本地专家优先
- 任务类型路由: chat→budget, reasoning→premium, tools→standard, background→cheapest
- 级联升级: budget→standard→premium

**model-router.ts**
- 统一入口: 优先 ModelPool → fallback 到 config 默认模型
- 任务类型推断: inferTaskType() 从内容推断 chat/tools/reasoning
- DecisionRecorder: 记录每次选择结果，影响后续决策

---

## 三、三脑架构详解

### 3.1 ThreeBrain 编排器 (brain/brain.ts)

```
外部输入 → 小脑(感知融合) → 右脑(直觉) → 左脑(规则+调度) → 执行
执行结果 → 反馈给三脑
```

**decide() 方法三步走:**

1. **小脑 (Cerebellum)** — 感知融合 + 稳态调节
   - `regulate(bodyEvent)` → HomeostasisAction[]
   - `getBodyState()` → BodyState (情绪/精力/满足度/OCEAN人格)
   - 4条PID回路: 情绪/精力/满足度/好奇心

2. **右脑 (RightBrain)** — 直觉预测
   - `predict(input, signal, resources, bodyState)` → IntuitionSignal
   - 手写NN内核: Tensor + Attention + FFN + Encoder + 5输出头
   - 在线学习: ReplayBuffer + SGD + LPR防遗忘
   - 特征编码: 结构化/空间/图像/场景多模态

3. **左脑 (LeftBrain)** — 规则匹配 + 调度
   - `decide(signal, resources, intuition, bodyState)` → ExecutionPlan
   - 规则引擎: 8条内置 + 学习 + 否定 + 淘汰
   - 统一调度器: 四层新颖度路由 + Thompson Sampling + 元认知
   - 决策记忆: JSONL + kNN + 聚类 + 反事实

### 3.2 影子大脑 (ShadowBrain)

- 能力缺口检测: 连续失败 + 低置信度
- 进化引擎: L1规则/L2参数/L3结构
- 时机控制器: 负载/样本/稳定性/间隔/窗口
- 进化锁: GDI + CPS + 回归 + 人工审批
- A/B对比记录器

### 3.3 信号流可观测性

- `SignalObserver` 回调 → `brain_trace` WS 事件
- 三个阶段: signal → resource → decision
- 每个阶段推送独立的 traceId 关联事件
- 前端 AgentTrace 组件实时渲染决策链路

---

## 四、用户消息 → 任务执行 → 结果 完整链路

### 4.1 WS 消息流 (WSHandler)

```
用户输入 → ChatPanel → useWebSocket.send()
  → WS 传输 (BuddyLink: ACK+重试+离线队列)
  → EventBus.onMessage → WSHandler.handleUserMessage()
  → BuddyAgent.handleUserMessage()
```

### 4.2 后端处理链

```
handleUserMessage(content)
  ├── 1. preprocessMessage(content)
  │   ├── 养成追踪 / 反馈检测 / 行为检测
  │   ├── 认知推断 / 实体提取 / 感知事件
  │   ├── 记忆存储 / 情绪更新
  │   └── 提醒意图检测
  │
  ├── 2. orchestrate(content) — < 5ms
  │   ├── collectSignals → TaskSignal
  │   ├── collectResourceState → ResourceState
  │   └── decideCollaboration → OrchestrationPlan
  │       或 orchestrateWithThreeBrain → DecisionResult
  │
  ├── 3. executeByPlan(plan) — 可能耗时数秒
  │   ├── 经验直连 (exp_direct) — 零LLM
  │   ├── 经验+质检 (exp_verified) — 经验执行+LLM验证
  │   ├── LLM+hint (llm_with_hint) — LLM为主+经验参考
  │   ├── 统一池节点 (chatWithNode) — 直接指定模型
  │   ├── local_only — 本地三进制专家
  │   ├── single — 单LLM调用 (MessageProcessor)
  │   │   ├── 构建系统Prompt (人格+情绪+认知+知识)
  │   │   ├── 上下文组装 (prompt-budget token分配)
  │   │   ├── LLM调用 (streamChat/chat)
  │   │   │   ├── ModelRouter.select() → 选择模型
  │   │   │   ├── ProviderFactory.create() → 创建SDK实例
  │   │   │   ├── 消息预处理 (role映射/合并)
  │   │   │   ├── Function Calling 或 Prompt Tool Calling
  │   │   │   └── 熔断器 + 重试 + fallback
  │   │   └── 工具执行循环 (最多maxSteps轮)
  │   │       ├── 工具拦截 (权限检查)
  │   │       ├── 并行执行无依赖工具
  │   │       ├── 结果截断 (上下文预算控制)
  │   │       └── 自纠错重试
  │   ├── parallel — 多专家并行+融合
  │   ├── cascade — 级联升级
  │   ├── sequential — 接力传递
  │   └── debate — 多方论证+裁决
  │
  └── 4. postprocessResult(content, result)
      ├── 记忆存储 / STMP写入
      ├── 情绪更新 / 认知更新
      ├── 知识提取 / 经验学习
      ├── 决策回写 / 自动训练
      └── WS 推送: llm_response + tool_call + tool_result + emotion + ...
```

### 4.3 WS 事件推送到前端

```
EventBus.emit() → WS 广播
  ├── thinking — 三脑决策开始
  ├── model_decision — 模型选择结果 (modelId/tier/reason/layer/candidateCount)
  ├── tool_call — 工具调用 (tool/args)
  ├── tool_result — 工具结果 (tool/success/preview)
  ├── brain_trace — 决策信号流 (phase/traceId/data)
  ├── agent_trace — 执行轨迹
  ├── emotion — 情绪变化 (mood/energy/satisfaction)
  ├── llm_response — 流式回复 (content/streaming)
  ├── response_end — 回复结束
  ├── experience_matched — 经验匹配
  ├── evolution — 进化事件
  └── bubble — 通知气泡
```

---

## 五、关键模块关联图

### 5.1 核心依赖关系

```
BuddyAgent
  ├── Subsystems (容器)
  │   ├── LLMAdapter ← ProviderFactory ← ModelRouter ← ModelPool
  │   ├── ThreeBrain ← LeftBrain + RightBrain + Cerebellum + ShadowBrain
  │   ├── MemoryStore + STMP + DreamEngine
  │   ├── CognitiveEngine (用户模型+自我模型+领域画像)
  │   ├── ExperienceEngine (图谱+路由+编译+执行+进化)
  │   ├── PetManager (养成+探索+进化)
  │   ├── EmotionEngine + PersonalityPrompt
  │   ├── ToolRegistry (32内置+27动态+MCP)
  │   ├── WorkflowManager + DAGPlanner
  │   ├── TernaryRouter + TernaryScheduler (三进制微模型)
  │   ├── LoRAService + TrainingExporter
  │   ├── SubscriptionManager + EntitlementChecker
  │   ├── FriendSystem + BuddyInteraction
  │   ├── PlatformManager (CLI/Telegram/Discord)
  │   ├── MCPAdapter + MCPRegistry
  │   ├── PrivacyManager + AuditLogger
  │   └── EventBus (WS服务器)
  ├── MessageProcessor (消息处理管线)
  ├── BehaviorTracker (行为追踪)
  ├── SkillOps (能力包操作)
  └── WSHandler (WS消息处理)
```

### 5.2 数据存储

| 数据库 | 用途 | 关键表 |
|--------|------|--------|
| memory.db | 对话+记忆+日记+FTS5 | messages, memories, diary |
| stmp.db | 时空记忆宫殿 | rooms, nodes, concepts, star_map |
| cognitive.db | 用户模型+自我模型+领域画像 | user_profile, self_model, domain_profiles |
| pet.db | 养成数据 | features, evolution, behavior |
| billing.db | 订阅+商城 | subscriptions, entitlements, transactions |

---

## 六、Playwright E2E 测试分析

### 6.1 测试架构

```
playwright.config.ts
  ├── Mock 测试 (chromium project)
  │   ├── 测试目录: e2e/*.spec.ts (排除 real-llm*.spec.ts)
  │   ├── WebServer: 后端(8765) + 前端(5173)
  │   ├── 环境: BUDDY_MOCK_LLM=1 (不调真实API)
  │   └── 22个测试文件
  │
  └── 真实LLM测试 (real-llm project, 需 --project=real-llm)
      ├── 测试文件: e2e/real-llm.spec.ts
      ├── 前置: setupRealLLMConfig() 写入 ~/.buddy/config.json
      ├── 环境: SILICONFLOW_API_KEY 必须设置
      ├── 超时: 60s (比mock的30s更长)
      └── 测试维度: 6大类 15+个测试用例
```

### 6.2 真实LLM测试 (real-llm.spec.ts) — 6大维度

#### 维度0: 前端配置 → 模型入池
- `前端 llm_config 配置` — localStorage → WS llm_config → 后端热重载 → bubble确认
- `POST /api/model-pool/providers` — REST API 添加端点 → 返回 modelCount
- `GET /api/model-pool` — 模型池状态可观测 (initialized/profileCount)
- `模型池刷新` — refreshPlatform 发现新模型

#### 维度1: 三脑决策 → 模型池LLM选择
- `model_decision 事件完整性` — 验证 modelId/displayName/tier/reason/layer/candidateCount/taskType
- `聊天任务选型` — simple chat → budget/standard tier, taskType=chat
- `工具调用选型` — taskType=tools, candidateCount≥1
- `推理任务选型` — taskType=reasoning, tier=premium/standard
- `Thompson Sampling` — tsSample ∈ [0,1]

#### 维度2: 工具调用 → 真实能力验证
- `read_file 能读取文件` — tool_call→tool_result→response_end 顺序正确
- `工具结果正确性` — tool_result 包含实际文件内容
- `agent_trace/brain_trace` — 执行轨迹存在

#### 维度3: 多模型协作 → DAG编排
- `DAG多步骤任务` — 多次tool_call都有tool_result, 数量匹配
- `orch 事件` — 编排任务状态可观测
- `expert_pool_start` — 专家池选择可观测

#### 维度4: 多模型切换
- `默认模型对话` — thinking→response_end 闭环
- `切换模型` — 两次决策模型不同(或都成功)
- `弱模型(7B)` — 简单问答正常
- `强模型(32B)` — 推理任务正常

#### 维度5: 错误恢复
- `无效key后恢复` — 恢复正确key后model_decision正常
- `无效key不崩溃` — 页面body正常

#### 维度6: 边界输入
- `超长消息(2000字符)` — 不崩溃，链路闭环
- `Emoji输入` — 不破坏WS协议
- `特殊字符(代码片段)` — 不破坏协议

### 6.3 Mock E2E 测试覆盖

| 文件 | 覆盖范围 |
|------|----------|
| onboarding.spec.ts | 引导流程4步 |
| chat-flow.spec.ts | 消息发送/接收/流式 |
| three-brain.spec.ts | 三脑决策状态/消息处理/brain_trace/情绪/进化 |
| brain-decision.spec.ts | 决策链路 |
| model-selection.spec.ts | 模型选择 |
| tool-execution.spec.ts | 工具执行 |
| tool-memory.spec.ts | 工具记忆 |
| memory-intelligence.spec.ts | 记忆+智能 |
| experts-vision-trace.spec.ts | 专家+视觉+轨迹 |
| ternary-local.spec.ts | 三进制本地专家 |
| confirm-clarify.spec.ts | 确认/澄清 |
| persistence.spec.ts | 持久化 |
| ws-lifecycle.spec.ts | WS生命周期 |
| ws-reconnection.spec.ts | WS重连 |
| pet-interaction.spec.ts | 养成交互 |
| activity-panel.spec.ts | 活动面板 |
| smooth-interaction.spec.ts | 流畅交互 |
| error-boundary.spec.ts | 错误边界 |
| visual-regression.spec.ts | 视觉回归(截图对比) |
| voice-audio.spec.ts | 语音音频 |
| frontend-components.spec.ts | 前端组件 |

### 6.4 Vitest 单元/集成测试

| 文件 | 覆盖范围 |
|------|----------|
| src/e2e-real-flow.test.ts | 全链路真实闭环(MockLLM+真实工具+真实子系统) |
| src/e2e-pool.test.ts | ModelPool E2E (调度→记录→级联→统计) |
| src/core/e2e-pool.test.ts | ModelPool核心E2E (持久化/熔断/Thompson Sampling) |
| src/core.test.ts | 核心模块 |
| src/core-system.test.ts | 子系统 |
| src/core-link.test.ts | 通信链路 |
| src/orchestrate.test.ts | 编排 |
| src/modules.test.ts | 模块 |
| src/code-intel.test.ts | 代码智能 |
| src/extractor.test.ts | 知识提取 |
| src/errors.test.ts | 错误处理 |
| src/platform.test.ts | 平台适配 |
| src/skills-lora.test.ts | 技能+LoRA |
| src/e2e-clock.test.ts | 时钟系统 |

---

## 七、实现与测试的印证关系

### 7.1 前端配置 → 模型入池

| 实现 | 测试印证 |
|------|----------|
| Onboarding.tsx Step4: Provider选择+API Key+测试连接 | onboarding.spec.ts + real-llm.spec.ts「前端配置」 |
| Settings.tsx ModelsSection: 添加/删除/刷新端点 | real-llm.spec.ts「REST API添加端点」 |
| App.tsx useEffect: 连接后发送 llm_config | real-llm.spec.ts「模型入池基础入口」 |
| config.ts: models.providers[] 唯一路径 | e2e-pool.test.ts + config.ts 单元测试 |
| ModelPool: 自动发现+画像+分层 | real-llm.spec.ts「模型池状态可观测」 |
| ModelPoolScheduler: Thompson Sampling | e2e-pool.test.ts「decision recorder feeds」 |

### 7.2 用户消息 → 三脑决策

| 实现 | 测试印证 |
|------|----------|
| agent.ts orchestrate(): 三阶段决策 | three-brain.spec.ts「brain_trace信号流」 |
| brain.ts decide(): 小脑→右脑→左脑 | three-brain.spec.ts「消息处理」 |
| SignalObserver → brain_trace WS事件 | three-brain.spec.ts「phase signal/resource/decision」 |
| decideCollaboration(): 8条规则 | e2e-pool.test.ts + orchestrate.test.ts |
| model_decision WS事件 | real-llm.spec.ts「model_decision事件完整性」 |
| taskType推断 | real-llm.spec.ts「聊天/工具/推理选型」 |

### 7.3 任务执行 → 结果

| 实现 | 测试印证 |
|------|----------|
| LLMAdapter.chat/streamChat | real-llm.spec.ts「默认模型对话」 |
| Function Calling + Prompt Tool Calling | real-llm.spec.ts「read_file能读取文件」 |
| 工具拦截+权限检查 | e2e-real-flow.test.ts「沙箱拦截危险命令」 |
| 熔断器+重试+fallback | e2e-pool.test.ts「熔断后自动排除」 |
| executeByPlan 7种模式 | three-brain.spec.ts「parallel/cascade模式」 |
| postprocessResult: 记忆+知识+经验 | e2e-real-flow.test.ts 全链路验证 |
| tool_call→tool_result→response_end | real-llm.spec.ts「工具调用事件顺序」 |

### 7.4 关键交叉验证点

1. **模型池初始化**: 前端POST端点 → 后端config.models.providers → ModelPool构造 → GET /api/model-pool 确认
2. **三脑决策链路**: agent.orchestrate() → ThreeBrain.decide() → SignalObserver → brain_trace WS事件 → 前端渲染
3. **工具执行闭环**: LLM返回tool_call → beforeToolExecute拦截 → 工具执行 → tool_result → LLM继续 → response_end
4. **经验路由**: ExperienceRouter.route() → exp_direct/exp_verified/llm_with_hint → 对应执行器
5. **级联升级**: ModelPoolScheduler.getUpgradedNode() → budget→standard→premium

---

## 八、依赖安装状态

| 组件 | 状态 |
|------|------|
| 后端 npm install | ✅ 完成 (427 packages) |
| 前端 npm install | ⏳ 进行中 |
| Playwright chromium | ⏳ 进行中 |

---

## 九、待确认/潜在问题

1. **SILICONFLOW_API_KEY**: 真实LLM测试需要设置环境变量
2. **前端构建**: 需要确认 TypeScript 编译是否通过
3. **后端启动**: 需要确认 .env 或 config.json 中有可用的 API Key
4. **三进制专家**: 需要确认本地专家是否已训练(影响 local_only 路径)
5. **视觉回归截图**: 需要确认是否需要更新基准截图
