# 重构计划：ws-handler.ts 瘦身

> 目标：2,944 行 → ~800 行，按职责拆分
> 原则：每次拆分保持功能不变，测试全绿后再推送

---

## 现状

`ws-handler.ts` 混杂了 **5 种职责**：

| 职责 | 行数 | 说明 |
|---|---|---|
| REST API 路由 | ~1,200 | 30+ 个 GET/POST 端点 |
| 消息处理管线 | ~400 | 预处理→编排→执行→后处理 |
| WS 协议层 | ~300 | 心跳、重连、诊断、确认队列 |
| 广播/通知 | ~200 | 情绪、状态、进化事件推送 |
| i18n 缓存 | ~100 | 翻译服务端缓存 |
| 辅助逻辑 | ~200 | 音频缓存、诊断、杂项 |

---

## 拆分方案

```
ws-handler.ts（瘦身后 ~800 行：消息管线 + 广播 + 核心编排）
├── rest-api.ts      ~1,200 行  30+ 个 REST 端点
├── ws-protocol.ts   ~300 行    心跳、重连、诊断、确认队列
├── i18n-cache.ts    ~100 行    翻译缓存
└── audio-cache.ts   ~50 行     音频缓存
```

---

## Step 1: 提取 rest-api.ts（最大收益，风险最低）

**新文件：`src/core/rest-api.ts`**

将 `setupREST()` 方法中的 30+ 个路由定义提取为独立函数：

```typescript
export function setupRESTAPI(
  eventBus: EventBus,
  sys: Subsystems,
  agentRef: AgentBridge,
  wsHandler: WSHandler,
  verbose: boolean,
): void {
  // GET /api/status
  // GET /api/concurrency
  // GET /api/decision-trace
  // GET /api/brain-status
  // GET /api/memory
  // POST /api/memory/search
  // GET /api/tools
  // POST /api/tools/:name/execute
  // GET /api/skills
  // POST /api/skills/:id/install
  // GET /api/models
  // POST /api/models/add
  // POST /api/models/test
  // POST /api/tts
  // GET /api/billing/status
  // POST /api/billing/subscribe
  // GET /api/pet
  // POST /api/pet/interact
  // ... 全部端点
}
```

ws-handler.ts 中：
```typescript
setupREST(): void {
  setupRESTAPI(this.eventBus, this.sys, this.agentRef, this, this.verbose);
}
```

**验证：** `npx vitest run` + 手动测试 REST 端点

---

## Step 2: 提取 ws-protocol.ts

**新文件：`src/core/ws-protocol.ts`**

提取 WS 协议层逻辑：

```typescript
export class WSProtocol {
  private pendingConfirms = new Map<string, PendingConfirm>();
  private linkDiag = new LinkDiagnostics();
  private linkHandler: LinkHandler;
  private taskExecutor: TaskExecutor;
  private taskQueue: AdaptiveTaskQueue;
  private expertPool: ExpertPool;

  setupHeartbeat(eb: EventBus): void { ... }
  setupReconnect(eb: EventBus): void { ... }
  handlePingPong(msg: WSClientMessage, eb: EventBus): boolean { ... }
  handleResume(msg: WSClientMessage, eb: EventBus): boolean { ... }
  handleConfirm(id: string, allowed: boolean): void { ... }
}
```

---

## Step 3: 提取 i18n-cache.ts + audio-cache.ts

**新文件：`src/core/i18n-cache.ts`**

```typescript
export class I18nServerCache {
  lookup(texts: string[], lang: string): { hits; misses } { ... }
  write(lang: string, translations: Record<string, string>): void { ... }
  init(cacheDir: string): void { ... }
}
```

**新文件：`src/core/audio-cache.ts`**

```typescript
export class AudioCache {
  get(id: string): { data: string; format: string } | null { ... }
  set(id: string, data: string, format: string): void { ... }
  shouldUseREST(dataSize: number): boolean { ... }
  purge(): number { ... }
}
```

---

## Step 4: ws-handler.ts 清理

删除已提取代码，ws-handler.ts 保留：
- 核心消息处理管线（`handleMessage` 流程）
- 广播方法（`broadcastEmotion`, `broadcastStatus`）
- Dream/Ternary 触发逻辑
- Agent 桥接

---

## 执行顺序

| 步骤 | 任务 | 行数变化 | 风险 |
|---|---|---|---|
| 1 | `rest-api.ts` 提取 | 2944→1744 | 低 |
| 2 | `ws-protocol.ts` 提取 | 1744→1444 | 低 |
| 3 | `i18n-cache.ts` + `audio-cache.ts` | 1444→1300 | 低 |
| 4 | 清理 + 类型整理 | 1300→800 | 低 |

**总计：~2 天**

---

## 验证标准

每步完成后：
1. `npx vitest run` 全部通过
2. `npx tsc --noEmit` 无类型错误
3. WS 连接 + 消息收发正常
4. REST API 端点可用
