# Buddy WebSocket 通信层分析与优化方案

**日期**: 2026-04-24  
**范围**: BuddyLink 通信层 + useWebSocket React 集成 + WebSocket 服务端  
**目标**: 提升连接稳定性、消息可靠性、流量控制能力

---

## 1. 现状评估

### 1.1 通信层架构（BuddyLink — 4 层管道）

| 层 | 能力 | 状态 |
|---|------|------|
| **STATE** | 6 态状态机（idle → connecting → live → degraded → offline → dead） | ✅ 完整 |
| **RELIABILITY** | 消息 ACK + 超时重试（最多 3 次）+ 指数退避 | ✅ 完整 |
| **TRANSPORT** | WS 主通道 + REST 降级 + IndexedDB 离线队列（24h） | ✅ 完整 |
| **OBSERVE** | 诊断环形缓冲区（100 条）+ 故障模式分析 + 自适应参数 | ✅ 完整 |

**额外能力:**
- ✅ 心跳保活（30s 间隔，3 次 pong 未响应断连）
- ✅ Token 自动刷新（连接失败时重新获取）
- ✅ 消息优先级常量（CRITICAL / HIGH / NORMAL / LOW）
- ✅ 管道扩展机制（中间件模式，可插入压缩、指标上报等）
- ✅ RTT 监测 + 自动降级（>1s 切 degraded）

### 1.2 消息类型

**后端 → 前端（37 种事件）:**

| 类别 | 事件 |
|------|------|
| 对话 | `llm_response`（流式/非流式）、`thinking`、`error`、`bubble` |
| 工具 | `tool_call`、`tool_result`、`tool_confirm_request`、`tool_panel_data` |
| 状态 | `status`、`emotion`、`idle`、`idle_action`、`dreaming` |
| 进化 | `evolution`、`achievement`、`experience_matched`、`domain_mature`、`skill_registered` |
| 三进制 | `ternary_models`、`ternary_train_start/progress/complete`、`ternary_inference` |
| 编排 | `orch_start`、`orch_task_start/done/fail`、`orch_progress`、`orch_done/fail` |
| 其他 | `audio`、`sensor_update`、`cognitive_update`、`config_mismatch`、`agent_trace`、`memory_panel_data`、`model_installed`、`test_llm_result` |

**前端 → 后端（12 种请求）:**

`chat`、`pet`、`command`、`visual_seed`、`llm_config`、`test_llm`、`orchestrate`、`sensor_update`、`tool_panel_request`、`memory_panel_request`、`tool_confirm_response`

### 1.3 流量特征分析

| 流量类型 | 频率 | 特点 | 风险等级 |
|---------|------|------|---------|
| LLM 流式响应 | 中 | 持续流、不能断 | 🔴 断连 = 丢回复 |
| 工具调用/结果 | 低 | 请求-响应、需确认 | 🟡 需可靠送达 |
| 情绪/精灵状态 | 中 | 实时、影响动画 | 🟡 延迟 = 卡顿 |
| 传感器数据 | 高 | location/motion/environment 持续上报 | 🔴 可能打爆 WS |
| 音频数据 | 低 | base64 编码、体积大 | 🟡 阻塞其他消息 |
| 编排进度 | 中 | 多任务并行、进度推送 | 🟢 批量消息 |
| 梦境/认知更新 | 低 | 后台异步 | 🟢 不急 |
| 三进制训练 | 低 | 长时间任务、进度流 | 🟢 可恢复 |
| 心跳 | 极低 | 30s 一次 | 🟢 |

---

## 2. 问题清单

### 🔴 严重

**P0-1: useWebSocket 连接重建问题**

`useWebSocket.ts` 中 `handleMessage` 依赖 `[onEvent, setSprite]`，`useEffect` 依赖 `[url, handleMessage]`。当 `onEvent` 引用变化时，`handleMessage` 引用变化 → `useEffect` 重跑 → 新建 BuddyLink → 新建 WebSocket。

当前 App.tsx 的 `useCallback` 修复只是临时方案，任何上游回调变化都会触发连锁反应。

**P0-2: 流式响应断连丢失**

LLM 正在流式输出时 WS 断开，重连后之前的流式消息丢失，前端显示半截回复。无断点续传机制。

**P0-3: 传感器洪水无背压**

motion 传感器可能每秒多次上报，全部走 WS 无节流，高频消息可能阻塞 LLM 响应和工具确认等关键消息。

### 🟡 中等

**P1-1: 状态感知缺失**

前端只有 `connected: boolean`，无法区分「正在连接」「已断开正在重连」「信号弱」。PIXI.js 精灵无法根据连接质量显示不同动画。

**P1-2: 1s 轮询低效**

`useWebSocket` 中 `setInterval 1000ms` 轮询 `linkRef.current.currentState`，应该用事件驱动。

**P1-3: 类型安全弱**

`BuddyEvent` 是 `{ type: string; [key: string]: any }`，37 种事件全靠 switch case 匹配，没有联合类型约束，拼错了静默失败。

**P1-4: 音频 base64 阻塞**

大音频文件 base64 编码后走 WS，一条消息可能几十 KB，阻塞其他消息传输。

**P1-5: 管道层全空**

Pipeline 机制设计得很好但一个层都没注册，压缩、指标、优先级都是空的。

### 🟢 可优化

**P2-1: 消息去重** — 收端没有幂等检查，网络抖动可能重复处理消息。  
**P2-2: 多标签页无共享** — 多个标签页各自建连，后端压力倍增。  
**P2-3: 心跳单向** — 只有客户端发 ping，服务端不主动探测客户端存活。  
**P2-4: 消息类型弱** — 没有联合类型约束，运行时才发现错误。

---

## 3. 业界方案研究

### 3.1 react-use-websocket（npm 周下载 60w+）

**核心模式:**
- **Shared Socket 单例** — 多组件共享一个连接
- **回调用 ref 透传** — 连接不随回调变化重建
- 内置心跳 + 重连

**可借鉴:** ref 透传模式、Shared Socket 思路  
**不足:** 没有 ACK、离线队列、诊断、管道扩展 — BuddyLink 已超越

### 3.2 reconnecting-websocket（npm 周下载 100w+）

**核心模式:**
- Drop-in replacement，内置指数退避 + 抖动重连
- 事件驱动状态变化（`onopen`、`onclose`、`onconnecting`）

**可借鉴:** 重连状态事件对外暴露  
**不足:** BuddyLink 状态机更完善（6 态 vs 3 态）

### 3.3 useSyncExternalStore（React 18 官方 API）

**核心模式:**
- 专为外部状态源设计的 React Hook
- 并发模式安全、不会撕裂、自动订阅/取消
- 替代 `useState` + `useEffect` 订阅模式

**可借鉴:** 替代当前 1s 轮询，零延迟感知 WS 状态变化

### 3.4 uWebSockets.js 优先级队列

**核心模式:**
- 4 级消息队列（P0 紧急 / P1 高 / P2 普通 / P3 低）
- 按优先级依次发送，低优先级队列有最大长度限制
- 监听 `drain` 事件控制发送速率

**可借鉴:** BuddyLink 有 Priority 常量但没有队列调度，需要实现 `PrioritySender`

### 3.5 游戏引擎 Delta 同步

**核心模式:**
- 只发变化的字段，不发全量
- 高频数据在发送端节流

**可借鉴:** 传感器数据节流 + 情绪状态 delta 同步

### 3.6 BroadcastChannel 多标签页共享

**核心模式:**
- 第一个标签页建 WS 连接（主节点）
- 其他标签页通过 `BroadcastChannel` 收发消息
- 主标签页关闭时竞选新主节点

**可借鉴:** Electron 多窗口 / 浏览器多标签页不重复建连

### 3.7 permessage-deflate（RFC 7692）

**核心模式:**
- `ws` 库原生支持
- 大消息自动压缩，JSON 格式压缩率 60-80%
- 阈值控制（>1KB 才压缩）

**可借鉴:** 服务端 1 行配置，零代码改动

---

## 4. 优化方案

### 第一阶段：连接稳定性（P0 — 最高优先级）

#### 4.1 useWebSocket ref 透传 + useSyncExternalStore

**改动文件:** `frontend/src/hooks/useWebSocket.ts`、`frontend/src/App.tsx`

**方案:**
1. 用 `useRef` 持有 `onEvent` 和 `onStateChange`，连接 `useEffect` 只依赖 `[url]`
2. 用 `useSyncExternalStore` 替代 `useState` + 轮询管理 WS 状态
3. BuddyLink 增加 `subscribe` / `unsubscribe` 状态订阅 API

**效果:** 回调变化不再触发重连，状态变化零延迟感知，Concurrent Mode 安全。

#### 4.2 传感器数据节流

**改动文件:** `frontend/src/hooks/useWebSocket.ts` 或 `frontend/src/sensors/*.ts`

**方案:**
- motion 传感器：500ms 节流
- environment 传感器：10s 节流
- 在发送端节流，不在服务端

**效果:** 传感器消息量降低 90%+，不阻塞 LLM 响应。

#### 4.3 流式响应断连恢复

**改动文件:** `frontend/src/comm/link.ts`、`src/core/ws-handler.ts`

**方案:**
1. 消息带递增 `seq` 序列号
2. 重连时客户端发送 `{ type: 'resume', lastSeq }` 
3. 服务端从 `lastSeq + 1` 重放缓存中的未确认消息（环形缓冲区，最近 50 条）

**效果:** LLM 流式输出中途断连 → 重连后从断点续传。

### 第二阶段：流量控制（P1）

#### 4.4 消息优先级队列

**改动文件:** `frontend/src/comm/link.ts`（新增 `PrioritySender`）

**方案:**
- 发送端维护 4 级队列
- 按优先级依次发送，低优先级队列最大长度限制
- `send()` 方法根据 priority 入对应队列

**效果:** LLM 响应、工具确认不被传感器数据阻塞。

#### 4.5 perMessageDeflate 消息压缩

**改动文件:** `src/ws/server.ts`（1 行配置）

**方案:**
```typescript
const wss = new WebSocketServer({ 
  server: httpServer,
  perMessageDeflate: {
    zlibDeflateOptions: { level: 6 },
    threshold: 1024,
  }
});
```

**效果:** 大消息（工具结果、编排进度、三进制训练数据）压缩 60%+。

#### 4.6 音频走 REST

**改动文件:** `src/core/ws-handler.ts`、`frontend/src/hooks/useWebSocket.ts`

**方案:**
- 大音频（>4KB）走 REST `/api/audio` 返回 blob URL
- WS 只发通知 `{ type: 'audio_ready', url }`

**效果:** 音频不再阻塞 WS 消息通道。

### 第三阶段：健壮性（P2）

#### 4.7 BroadcastChannel 多标签页共享

**改动文件:** 新增 `frontend/src/comm/shared-connection.ts`

**方案:**
- 第一个标签页建 WS（主节点），其他通过 BroadcastChannel 收发
- 主节点关闭时竞选新主节点

#### 4.8 消息幂等去重

**改动文件:** `frontend/src/comm/link.ts`

**方案:** 收端维护 `recentMsgIds` Set（最近 100 条），重复消息跳过。

#### 4.9 心跳双向化

**改动文件:** `src/ws/server.ts`

**方案:** 服务端也主动发 ping，检测客户端存活，清理僵尸连接。

### 第四阶段：可观测性（P3 — 可选）

#### 4.10 连接质量指标暴露

RTT、重连次数、消息成功率 → 前端诊断面板，精灵可根据连接质量显示不同动画。

#### 4.11 管道层注册

- 压缩层：大消息 gzip（备选，perMessageDeflate 已覆盖大部分场景）
- 指标层：记录每条消息的延迟

---

## 5. 实施优先级

| 阶段 | 改动 | 文件 | 难度 | 收益 | 预估工时 |
|------|------|------|------|------|---------|
| **P0** | ref 透传 + useSyncExternalStore | `useWebSocket.ts`、`App.tsx` | 中 | 根治重连、零延迟状态 | 3h |
| **P0** | 传感器节流 | `useWebSocket.ts` / `sensors/*.ts` | 低 | 防止消息洪水 | 1h |
| **P1** | 消息优先级队列 | `link.ts` | 中 | 关键消息不被阻塞 | 2h |
| **P1** | perMessageDeflate | `server.ts` | 极低 | 大消息压缩 60%+ | 10min |
| **P1** | 音频走 REST | `ws-handler.ts`、`useWebSocket.ts` | 中 | 音频不阻塞 WS | 2h |
| **P2** | 流式断连恢复 | `link.ts`、`ws-handler.ts` | 高 | LLM 流式不丢 | 4h |
| **P2** | BroadcastChannel 共享 | 新增 `shared-connection.ts` | 中 | 多标签页不重复建连 | 3h |
| **P2** | 消息幂等去重 | `link.ts` | 低 | 防重复处理 | 1h |
| **P2** | 心跳双向化 | `server.ts` | 低 | 清理僵尸连接 | 1h |
| **P3** | 连接质量指标 | 新增诊断组件 | 中 | 调试效率 | 2h |
| **P3** | 管道层注册 | `link.ts` | 中 | 可扩展性 | 2h |

**建议先做 P0 + P1，改 4 个文件，覆盖 80% 的问题。**

---

## 6. Bug 修复记录

本次分析中同时修复了 2 个已有 Bug：

### Bug #2: Onboarding Provider 名称错误 ✅

**文件:** `frontend/src/components/Onboarding.tsx`（第 143、157 行）  
**问题:** 选择硅基流动后 provider 被硬编码映射为 `custom`，后端丢失适配器能力信息  
**修复:** 删除三元表达式，直接透传 `selectedProvider.id`

### Bug #3: 端口占用冲突 ✅

**文件:** `package.json`  
**问题:** `dev:all` / `dev:ws` / `dev:frontend` 启动时如果端口被占用会 `EADDRINUSE` 崩溃  
**修复:** 为所有 dev 脚本添加 `pre` 钩子，启动前自动清理残留进程

---

## 7. 技术参考

- [react-use-websocket](https://github.com/robtauss/react-use-websocket) — React Hook + Shared Socket 模式
- [reconnecting-websocket](https://github.com/pladaria/reconnecting-websocket) — 自动重连 + 指数退避
- [React useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore) — 外部状态源订阅
- [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js) — 高性能 WS + 优先级队列
- [BroadcastChannel API](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel) — 多标签页通信
- [RFC 7692](https://tools.ietf.org/html/rfc7692) — permessage-deflate 压缩扩展
- [WebSocket 生产环境 7 大坑](https://blog.csdn.net/CompiShoal/article/details/155931908) — 心跳、重连、连接泄漏、消息丢失等
