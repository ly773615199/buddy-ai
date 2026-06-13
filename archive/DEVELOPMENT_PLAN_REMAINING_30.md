# Buddy 剩余 30% 开发计划 — 核销修订版 v3

> 基于 `PLAN_V2.md` 主开发方案（v3.5）+ `DEVELOPMENT_PLAN_V2.md` 养成即引导
> 核对时间：2026-04-13 | 全量代码审查 + Git 历史核对 + 前后端链路追踪

---

## 核销结论：实际进度 vs 文档声称

### Git 提交记录（按 Sprint）

```
5a92748 feat: ShopCatalog SQLite 持久化 (Sprint 3 Task 12)        ✅
fc326e1 feat: 多任务编排引擎 — DAG 并行执行 (Sprint 3 Task 11)    ✅
2fc43f3 feat: PetStats 重写 — 雷达图 + 热力图 + 统计卡片 (S2 T10) ✅
5604260 feat: 引导气泡脉冲动画 (Sprint 2 Task 9)                   ✅
e500d48 feat: ExplorationMap 重写 — 节点图 + 掌握度环 (S2 Task 8)  ✅
2586b15 feat: ChatPanel 重写 — Markdown + 工具卡片 + 输入栏 (S2 T6-7) ✅
ebf6f7d fix: BuddyState 类型对齐后端 (Sprint 1 Task 5)             ✅
6ce0dca docs: .env.example + 启动文档更新 (Sprint 1 Task 4)        ✅
e613ba7 feat: Onboarding 新增 LLM 配置步骤 (Sprint 1 Task 3)       ✅
6866db6 feat: Vite proxy 优化 + WS URL 修复 (Sprint 1 Task 2)      ✅
6dad1e0 feat: dev:all 一键启动前后端 (Sprint 1 Task 1)              ✅
```

### Sprint 完成度

| Sprint | 文档声称 | 实际状态 | 说明 |
|--------|---------|---------|------|
| Sprint 1 (W1-2) | 未提及已完成 | **✅ 100%** | 5/5 任务全部提交 |
| Sprint 2 (W3-4) | 未提及已完成 | **✅ 100%** | 5/5 任务全部提交 |
| Sprint 3 (W5-6) | 未提及 | **⚠️ 40%** | Task 11+12 完成，其余 6 项未做 |
| Sprint 4+ | 待做 | **❌ 未开始** | — |

### 文档错误勘误（v1 → v2 修正）

| # | v1 文章声称 | 实际代码审查 | 修正 |
|---|-----------|------------|------|
| 1 | ExplorationMap 是"148 行空壳" | **277 行完整实现** — SVG 环形进度 + 分类节点网格 + 掌握度指示器 + 引导区 | ❌ v1 错误 |
| 2 | ExplorationMap 未接入 React | **已接入** — PetStats.tsx import ExplorationMap 并渲染 | ❌ v1 错误 |
| 3 | platform.ts TelegramAdapter.send() 是 "console.log" | **真实 fetch 调用 Telegram Bot API** (sendMessage, setMessageReaction)；DiscordAdapter 有完整 Gateway WS（Identify/Heartbeat/Dispatch/Reconnect） | ❌ v1 错误 |
| 4 | payment.ts 是 "stub" | **PaymentManager 有完整订单管理逻辑**（createOrder/confirmPayment/refund/cleanupExpiredOrders/getOrderSummary），底层 Stripe/支付宝/微信 API 调用为 mock 数据 | ⚠️ v1 过度简化 |
| 5 | ChatPanel 需要重写 (1 周) | **已完成** — Sprint 2 Task 6-7 提交：renderMarkdown（代码块+行内代码+粗体+链接）、ToolCallCard（展开/折叠+参数+结果）、streaming cursor、InputBar | ❌ v1 未更新 |

---

## 已开发但未做完的缺口（前后端链路断裂）

> 只列「写了代码但没跑通全链路」的项，未启动的任务不在此列。

### 🔴 高优先级缺口（3 处）

#### 缺口 1：Onboarding「LLM 测试连接」是假的

| 项目 | 详情 |
|------|------|
| **位置** | `frontend/src/components/Onboarding.tsx` → `handleTestConnection()` |
| **现状** | `await new Promise(r => setTimeout(r, 1500)); setTestResult('success');` — 永远返回成功 |
| **后端** | `ws-handler.ts` → `handleLLMConfig()` 只保存配置到磁盘，不测试连接 |
| **WS Hook** | `useWebSocket.ts` → `sendLLMConfig()` 存在但未被测试按钮调用 |
| **缺口** | 前端注释写「连接测试通过 WS 发送到后端」，实际没发；后端也没暴露 test_llm 事件 |
| **影响** | 用户填错 API Key 也能通过测试，进入后发现 LLM 不可用 |
| **修复** | 1) 前端 handleTestConnection 通过 WS 发送 `{type: 'test_llm', provider, model, apiKey, baseUrl}` 2) 后端新增 `test_llm` 事件处理：用 LLMAdapter.testConnection() 验证 3) 返回 `{type: 'test_llm_result', success, error?}` |

#### 缺口 2：TTS 音频后端推了前端没播放

| 项目 | 详情 |
|------|------|
| **后端** | `ws-handler.ts` → `speakLongText()` 调用 TTS 合成 base64 音频，emit `{type: 'audio', data, format, sentenceId}` |
| **前端** | `useWebSocket.ts` → `case 'audio': // TTS 音频，后续处理` — 空处理 |
| **缺口** | 后端 TTS 完整（Edge TTS / Azure），WebSocket 通道正常，前端收到后丢弃 |
| **影响** | TTS 功能后端 100% 完成，前端 0% 接入，用户永远听不到语音 |
| **修复** | 1) useWebSocket 中 case 'audio': 解析 base64 → Blob → Audio 播放 2) 支持流式拼接（按 sentenceId 排序） 3) 加音量控制 + 静音开关 UI |

#### 缺口 3：多任务编排引擎前端完全未接

| 项目 | 详情 |
|------|------|
| **后端** | `ws-handler.ts` 发出 5 种编排事件：`orch_start` / `orch_task_start` / `orch_task_done` / `orch_progress` / `orch_done` |
| **前端** | `useWebSocket.ts` switch 中**无任何 `orch_*` 处理**，事件被 onEvent 回调吞掉后无后续 |
| **触发** | CLI 有 `/orch` 命令可触发；WS 模式下无 UI 按钮、无输入方式 |
| **缺口** | 1) 前端无编排事件处理 2) 无任务进度面板组件 3) 无触发入口 4) useWebSocket 缺 sendOrchestrate() 方法 |
| **影响** | 编排引擎后端完成（DAG 规划 + 并行执行 + 事件推送），前端完全断链 |
| **修复** | 1) useWebSocket 新增 orch_* 事件处理 2) 新增 `sendOrchestrate(content)` 方法 3) 新建 TaskProgressPanel 组件 4) ChatPanel 输入栏加「编排」模式切换或命令前缀 |

### 🟡 中优先级缺口（3 处）

#### 缺口 4：LLM 配置不热重载

| 项目 | 详情 |
|------|------|
| **位置** | `ws-handler.ts` → `handleLLMConfig()` |
| **现状** | 调用 `patchConfig()` 写入磁盘，但不重新初始化 LLMAdapter 实例 |
| **影响** | 用户在前端换 Provider/Key 后，当前进程 LLM 仍是旧配置，需重启后端才生效 |
| **修复** | patchConfig 后触发 Agent 重建 LLMAdapter 或调用 reconfigure() |

#### 缺口 5：进化阶段类型定义与视觉渲染器不一致

| 项目 | 详情 |
|------|------|
| **类型** | `types/buddy.ts` → `EVOLUTION_STAGES` 定义 6 阶段：egg / baby / growing / mature / complete / legendary |
| **视觉** | `SpriteRenderer.tsx` 只渲染 4 阶段：egg+egg / hatching / growing / formed |
| **后端** | `pet/types.ts` → `getVisualStage()` 也只返回这 4 个值 |
| **影响** | 无直接 bug（实际不会走到不存在的阶段），但类型定义给人误导，后续扩展需同步 |
| **修复** | 统一：要么 `EVOLUTION_STAGES` 改为 4 阶段与视觉对齐，要么 SpriteRenderer 扩展到 6 阶段 |

#### 缺口 6：useWebSocket 缺 orchestrate 入口方法

| 项目 | 详情 |
|------|------|
| **位置** | `useWebSocket.ts` 返回值 |
| **现状** | 有 `send` / `sendPet` / `sendCommand` / `sendVisualSeed` / `sendLLMConfig`，但无 `sendOrchestrate` |
| **影响** | 即使加了任务进度面板 UI，前端也无法触发编排请求 |
| **修复** | 新增 `sendOrchestrate(content)` — `ws.send(JSON.stringify({ type: 'orchestrate', content }))` |

---

## 真实剩余工作量（核销后）

### ✅ 已完成（从计划中核销）

| 任务 | 状态 | 说明 |
|------|------|------|
| 1. npm run dev:all 一键启动 | ✅ | `concurrently` 并行前后端 |
| 2. Vite proxy + WS URL 修复 | ✅ | |
| 3. Onboarding LLM 配置步骤 | ✅ | 第 4 步：选 Provider/输入 Key/测试连接 |
| 4. .env.example + 启动文档 | ✅ | |
| 5. BuddyState 类型更新 | ✅ | 含 visualSeed/features/guidance/behaviorSignals |
| 6. ChatPanel 重写 | ✅ | Markdown + 代码高亮 + ToolCallCard + streaming |
| 7. MessageBubble + InputBar | ✅ | 引导气泡 UI 已含（role='guidance'） |
| 8. ExplorationMap 重写 | ✅ | 节点图 + 掌握度环 + 分类展开 |
| 9. 引导气泡 UI | ✅ | guidancePulse 动画 + role='bubble'/'guidance' |
| 10. PetStats 可视化 | ✅ | 雷达图 + 热力图 + 统计卡片 |
| 11. 多任务编排引擎 | ✅ | DAG 并行执行器 + 事件推送 |
| 12. ShopCatalog → SQLite | ✅ | |

### 🟥 P0：必须做（产品不能发布）

| # | 任务 | 来源 | 工作量 | 说明 |
|---|------|------|--------|------|
| 1 | **WS Token 认证** | PLAN_V2 §13 | 3 天 | EventBus 无任何认证，直接接受连接 |
| 2 | **SpriteRenderer 动画状态机补全** | PLAN_V2 §3.3 | 1 周 | PIXI 渲染器 591 行已完成 egg/hatching/growing/formed，但缺 **idle/think/speak/excite/sleep** 状态间过渡动画（当前只有嘴部微调） |
| 3 | **编排引擎前端全链路接通** | 缺口 3+6 | 1 周 | 后端 5 种 orch 事件已发出，前端零处理 + 无入口 + 无进度面板 |
| 4 | **Onboarding LLM 测试真实连通** | 缺口 1 | 2 天 | 当前测试按钮是假的（永远 success） |
| 5 | **TTS 音频播放前端接通** | 缺口 2 | 2 天 | 后端 TTS 完整，前端 case 'audio' 空处理 |
| 6 | **部署方案** — Dockerfile + docker-compose | PLAN_V2 §2.5 | 1 周 | |
| 7 | **REST API 层** — HTTP 端点 + WS 共端口 upgrade | 基础设施 | 4 天 | 当前 WS 单独端口，无 HTTP API |

**P0 合计：~4.5 周**

### 🟨 P1：应该做（体验差距大）

| # | 任务 | 来源 | 工作量 |
|---|------|------|--------|
| 8 | **MCP 适配层**（连接 100+ 社区 MCP Server） | Sprint 3 设计文档 | 5 天 |
| 9 | **数据库统一管理**（4 个 SQLite + backup/restore） | PROJECT_ANALYSIS §5 | 3 天 |
| 10 | **视觉模块前端接入**（摄像头 → WS → Omni 分析） | PLAN_V2 Phase C W13 | 1 周 |
| 11 | **语音模块前端接入**（STT Web Speech API，TTS 已列 P0） | PLAN_V2 Phase C W14 | 3 天 |
| 12 | **传感器数据接入**（前端 sensors → WS → 后端 → Prompt） | PLAN_V2 Phase C W15 | 4 天 |
| 13 | **进化动画**（全屏揭晓 + 粒子效果） | 养成 v2 §3.5 | 4 天 |
| 14 | **LLM 配置热重载** | 缺口 4 | 1 天 |
| 15 | **进化阶段类型统一** | 缺口 5 | 1 天 |

**P1 合计：~4 周**

### 🟩 P2：锦上添花（按需）

| # | 任务 | 来源 | 工作量 |
|---|------|------|--------|
| 16 | **浏览器自动化工具集**（Playwright） | Sprint 4-A 设计 | 3 天 |
| 17 | **屏幕 RPA 工具集**（截图+OCR+鼠标键盘） | Sprint 4-A 设计 | 3 天 |
| 18 | **客服/财务工作流模板** | Sprint 4-A 设计 | 2 天 |
| 19 | **测试框架迁移** — vitest + CI | PROJECT_ANALYSIS §6 | 1 周 |
| 20 | **Telegram Bot 落地** | PLAN_V2 Phase C W17 | 3 天 |
| 21 | **Discord Bot 落地** | PLAN_V2 Phase C W17 | 3 天 |
| 22 | **Electron 托盘应用 MVP** | PLAN_V2 §2.5 | 1.5 周 |
| 23 | **Landing Page** | PROJECT_ANALYSIS | 3 天 |
| 24 | **Stripe 支付对接** | PLAN_V2 §15 | 1 周 |

**P2 合计：~6 周**（可选，按优先级取舍）

---

## 与 PLAN_V2 的逐章核对（修正版）

### §3.1 AI 助手能力

| PLAN_V2 要求 | v1 声称 | v2 实际状态 |
|-------------|---------|------------|
| 流式输出（打字机效果） | ❌ 前端无 | **✅ 已完成** — MessageBubble 有 streaming cursor |
| 工具调用过程可视化 | ❌ 前端只显示"调用 xxx" | **✅ 已完成** — ToolCallCard 可展开/折叠，显示参数+结果+状态色 |
| Markdown 渲染 + 代码高亮 | ❌ 前端需补 | **✅ 已完成** — renderMarkdown 函数支持代码块/行内代码/粗体/链接 |

### §3.2 个人化

全部已完成，无变化。

### §3.3 形象 & 交互

| PLAN_V2 要求 | v1 声称 | v2 实际状态 |
|-------------|---------|------------|
| 状态切换动画 | ⚠️ 动画简陋 | **⚠️ 需补充** — PIXI 591 行已完成多阶段渲染（egg/hatching/growing/formed 各有独立绘制），缺状态间过渡动画 |
| 引导气泡 | ❌ 前端无气泡 UI | **✅ 已完成** — MessageBubble 有 role='guidance' 样式 + guidancePulse 动画 |
| 摸头互动 | ❌ 前端点击无粒子效果 | **✅ 已完成** — SpriteRenderer handleClick 有粒子爆发效果 |

### §3.4 生态

无变化，能力包系统已完成。

### §7-12 认知/记忆/安全

无变化，后端逻辑全部确认完整。

### §13 安全

| 要求 | 状态 |
|------|------|
| WS 连接认证 | ❌ 未实现 — EventBus 无 token 校验（确认） |
| 其他安全机制 | ✅ 已实现 |

### §14 路线图 — Phase C 差距（修正）

| Week | 要求 | v1 状态 | v2 实际状态 |
|------|------|---------|------------|
| 13 摄像头 | 代码在 frontend/src/vision/ | ❌ 未接入 | ❌ 确认未接入（2,231 行 / 10 文件） |
| 14 麦克风 | 代码在 frontend/src/voice/ | ❌ 未接入 | ❌ 确认未接入（2,072 行 / 9 文件） |
| 15 传感器 | 代码在 frontend/src/sensors/ | ❌ 未接入 | ❌ 确认未接入（1,421 行 / 6 文件） |
| 16 能力包分享 | ✅ | — | ✅ |
| 17 社交+多平台 | ⚠️ 接口 stub | **✅ 实际有完整实现** — Telegram/Discord/CLI 适配器均为可工作代码 | 修正：仅需配置接入 |
| 18-20 商业化 | ⚠️ 支付 stub | ⚠️ 确认 — 订单管理完整，底层 API mock | |

---

## 修正后的执行计划（v2）

### ~~Sprint 1~~ ✅ 已完成
### ~~Sprint 2~~ ✅ 已完成

### Sprint 3 剩余（Week 5-6）

```
任务                                          工作量    状态
─────────────────────────────────────────────────────────────
11. 多任务编排引擎                              —       ✅ 已完成（后端）
12. ShopCatalog → SQLite                        —       ✅ 已完成
13. WS Token 认证                              3 天     ❌ 待做
14. REST API 层                                4 天     ❌ 待做
15. 数据库统一管理 + backup/restore             3 天     ❌ 待做
16. SpriteRenderer 动画状态机补全               1 周     ❌ 待做
17. 编排引擎前端全链路接通 ★缺口               1 周     ❌ 待做
    ├─ useWebSocket orch_* 事件处理                      （缺口 3）
    ├─ sendOrchestrate() 方法                             （缺口 6）
    ├─ TaskProgressPanel 组件
    └─ ChatPanel 编排触发入口
18. Onboarding LLM 测试真实连通 ★缺口          2 天     ❌ 待做（缺口 1）
19. TTS 音频播放接通 ★缺口                     2 天     ❌ 待做（缺口 2）
20. MCP 适配层                                 5 天     ❌ 待做
```

### Sprint 4（Week 7-8）

```
任务                                          工作量    状态
─────────────────────────────────────────────────────────────
21. 视觉模块前端接入                           1 周     ❌ 待做
22. STT Web Speech API                         3 天     ❌ 待做
23. 进化动画                                   4 天     ❌ 待做
24. Dockerfile + docker-compose                1 周     ❌ 待做
25. 传感器数据接入                             4 天     ❌ 待做
26. LLM 配置热重载 ★缺口                       1 天     ❌ 待做（缺口 4）
27. 进化阶段类型统一 ★缺口                      1 天     ❌ 待做（缺口 5）
```

### Sprint 5（Week 9-10）— 浏览器自动化 + 质量

```
任务                                          工作量    状态
─────────────────────────────────────────────────────────────
28. 浏览器自动化工具集（Playwright）            3 天     ❌ 待做
29. 屏幕 RPA 工具集                            3 天     ❌ 待做
30. 客服/财务工作流模板                         2 天     ❌ 待做
31. vitest 迁移 + CI                           1 周     ❌ 待做
32. 压力测试                                   3 天     ❌ 待做
```

### Sprint 6（Week 11-12）— 扩展

```
任务                                          工作量    状态
─────────────────────────────────────────────────────────────
33. Telegram Bot 落地                          3 天     ❌ 待做（适配器已完成）
34. Discord Bot 落地                           3 天     ❌ 待做（适配器已完成）
35. Electron 托盘应用 MVP                      1.5 周   ❌ 待做
36. Landing Page                               3 天     ❌ 待做
37. Stripe 支付对接                            1 周     ❌ 待做
```

---

## 验收标准（保持不变）

最小可体验版本已在 Sprint 1+2 完成。当前可验收：
1. ✅ Onboarding 收集视觉种子 + LLM 配置 → 连接成功 → 看到精灵
2. ✅ 对话有 Markdown 渲染 + 代码高亮 + 工具调用卡片 + 流式打字机
3. ✅ ExplorationMap 显示功能图谱 + 掌握度环 + 引导气泡
4. ✅ PetStats 有雷达图 + 热力图 + 统计卡片
5. ❌ WS 需要 token 认证（Sprint 3 P0）
6. ❌ docker-compose up 能启动（Sprint 4 P0）

---

*v3.0 — 2026-04-13 | 基于全量代码审查 + Git 历史核对 + 前后端链路追踪*
*相比 v2 新增「已开发但未做完的缺口」6 处，P0 增加 3 项，P1 增加 2 项*
