# Buddy 通信层强化方案 v3

**日期**: 2026-04-23
**核心理念**: 事件驱动管道 — 能力全保留，架构变干净
**原则**: 单文件实现，类型约束状态，管道扩展层，诊断融入流程

---

## 一、设计哲学

### 1.1 问题回顾

通信层的核心问题：**消息发出去后没有反馈闭环**。

```
BUG-002: 消息发了但没送达 → 没有送达确认
BUG-003: 配置没送达 → 后端用了错误配置 → 没有配置校验
BUG-005: 无限重连 → 没有连接有效性检查
```

### 1.2 架构选择

**不用模块拆分，用事件驱动管道。**

模块拆分的问题（v2 方案）：
```
CommDiagnostics ←→ CommStateMachine ←→ CommQueue
      ↕                  ↕                  ↕
CommStrategy ←→ CommFeedbackStore ←→ LinkHandler
```
6 个模块互相引用，边界情况在模块接口处产生。

管道架构：
```
Layer 1: STATE       — "我现在什么状态？"
Layer 2: RELIABILITY — "消息能到吗？"
Layer 3: TRANSPORT   — "用什么通道发？"
Layer 4: OBSERVE     — "发生了什么？"
```
每层只做一件事，事件单向流过，层间零耦合。

### 1.3 三个核心原则

**① 单文件实现**：能力不减，文件不增。前端 1 个类，后端 1 个类。

**② 类型约束状态**：用 TypeScript 联合类型让非法状态在编译期被排除，不靠运行时 if-else。

**③ 管道扩展层**：新增能力 = 在管道中插入一层，不改已有代码。

---

## 二、能力清单（12 项，全部保留）

| # | 能力 | 实现位置 | 实现方式 |
|---|------|---------|---------|
| 1 | 心跳保活 | State 层 | setInterval 30s ping/pong |
| 2 | 连接状态机 | State 层 | 6 种状态 + 类型约束转换 |
| 3 | Jitter 退避 | State 层 | `Math.random() * min(base * 2^attempt, max)` |
| 4 | 消息 ACK | Reliability 层 | 每条消息附 id，pending Map，超时重发 |
| 5 | 消息重试 | Reliability 层 | 最多 3 次，指数退避 |
| 6 | 离线持久化 | Transport 层 | IndexedDB，连接恢复后 flush |
| 7 | REST 降级 | Transport 层 | WS 不可用时走 POST /api/chat |
| 8 | Token 自动刷新 | Transport 层 | 连接失败时 fetch /api/ws-token |
| 9 | 配置同步 | State 层（心跳） | pong 附 configHash，不一致触发重推 |
| 10 | 错误归因 | Observe 层 | 每个 catch 块写入事件缓冲区，带 cause 分类 |
| 11 | 故障模式库 | Observe 层（查询） | 从事件缓冲区派生，不存额外数据 |
| 12 | 策略自适应 | Observe 层（查询） | 从故障模式推导参数，不存额外状态 |

---

## 三、架构设计

### 3.1 管道流程

```
用户调用 send(msg)
       │
       ▼
┌─────────────────────────────────────────────────┐
│  Layer 1: STATE — "我现在什么状态？"              │
│                                                  │
│  状态：idle | connecting | live | degraded |      │
│        offline | dead                            │
│                                                  │
│  live → 继续                                     │
│  connecting/degraded → 入 pending 队列，等恢复    │
│  offline → 入 IndexedDB 持久化队列               │
│  dead → 拒绝，抛错误                             │
└──────────────────────┬──────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────┐
│  Layer 2: RELIABILITY — "消息能到吗？"            │
│                                                  │
│  1. 生成唯一 id                                  │
│  2. 加入 pending Map                             │
│  3. 发送                                         │
│  4. 等 ACK（超时 5s）                            │
│  5. 超时 → 重试（最多 3 次，指数退避 + jitter）   │
│  6. 仍失败 → 标记失败，写入 Observe              │
└──────────────────────┬──────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────┐
│  Layer 3: TRANSPORT — "用什么通道发？"            │
│                                                  │
│  优先级：                                        │
│    1. WS（live 状态）                            │
│    2. REST fallback（POST /api/chat）            │
│    3. IndexedDB 持久化队列（离线时）             │
│                                                  │
│  连接恢复时：                                    │
│    flush IndexedDB 队列 → 重新进入 Reliability   │
└──────────────────────┬──────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────┐
│  Layer 4: OBSERVE — "发生了什么？"                │
│                                                  │
│  环形缓冲区（100 条），记录每个事件：             │
│  { timestamp, type, success, cause, context }    │
│                                                  │
│  不干扰主流程，只记录。                          │
│  故障模式 = 从缓冲区查询（不存额外数据）         │
│  策略参数 = 从故障模式推导（不存额外状态）       │
└─────────────────────────────────────────────────┘
```

### 3.2 状态机（类型约束）

```typescript
type State =
  | { tag: 'idle' }
  | { tag: 'connecting'; ws: WebSocket; attempt: number; since: number }
  | { tag: 'live'; ws: WebSocket; since: number; rtt: number }
  | { tag: 'degraded'; ws: WebSocket; since: number; reason: string; failCount: number }
  | { tag: 'offline'; since: number; queueSize: number }
  | { tag: 'dead'; reason: string; since: number; attempts: number }

// 合法转换（编译期检查）
// idle → connecting
// connecting → live | dead
// live → degraded | offline | dead
// degraded → live | offline | dead
// offline → connecting
// dead → idle（用户手动重试）
```

非法转换（如 dead → live）在 TypeScript 编译期报错。**不是靠 if-else 防御，是让错误不可能发生。**

### 3.3 心跳 + 配置同步

```
每 30 秒：
  Client → { type: 'ping', ts: 123456, configHash: 'abc' }
  Server → { type: 'pong', ts: 123456, configHash: 'def' }

Client 检查：
  rtt = now - ts                    → 记录 RTT
  localConfigHash !== configHash    → 触发配置重推
  
连续 3 次无 pong → 判定连接死亡 → 触发重连
RTT > 1000ms → 降级状态（degraded）
```

### 3.4 故障模式库（从诊断派生）

不存额外数据，从事件缓冲区查询：

```typescript
getFaultPattern(): FaultPattern[] {
  return this.events
    .filter(e => !e.success)
    .groupBy(e => e.cause.category)
    .map(group => ({
      cause: group.key,
      count: group.length,
      lastSeen: group.last().timestamp,
      trend: group.isIncreasing() ? 'worsening' : 'stable',
    }));
}
```

### 3.5 策略自适应（从故障模式推导）

不存额外状态，从故障模式推导参数：

```typescript
getAdaptiveParams(): CommParams {
  const pattern = this.getFaultPattern();
  const timeoutIssues = pattern.find(p => p.cause === 'timeout');
  const authIssues = pattern.find(p => p.cause === 'auth');
  
  return {
    timeoutMs: timeoutIssues?.count > 5 ? 15000 : 10000,
    maxRetries: timeoutIssues?.count > 10 ? 5 : 3,
    tokenRefreshFirst: !!authIssues && authIssues.count > 2,
  };
}
```

### 3.6 管道扩展机制

新增能力 = 在管道中插入一层，不改已有代码：

```typescript
// 管道注册
const pipeline = new Pipeline();
pipeline.use('state', stateHandler);
pipeline.use('reliability', reliabilityHandler);
pipeline.use('transport', transportHandler);
pipeline.use('observe', observeHandler);

// 将来想加压缩：
pipeline.use('reliability', 'transport', compressLayer);

// 将来想加加密：
pipeline.use('reliability', 'transport', encryptLayer);

// 将来想加消息优先级：
pipeline.use('state', 'reliability', priorityLayer);

// 将来想加批量发送：
pipeline.use('reliability', 'transport', batchLayer);

// 将来想加指标上报：
pipeline.use('transport', 'observe', metricsLayer);
```

每新增一层，只写一个函数，不碰其他层。

---

## 四、文件结构

### 4.1 新增文件

| 文件 | 用途 | 行数 |
|------|------|------|
| `frontend/src/comm/link.ts` | BuddyLink 类（前端通信层） | ~400 |
| `frontend/src/comm/types.ts` | 前端类型定义 | ~50 |
| `src/core/link-handler.ts` | LinkHandler 类（后端通信层） | ~200 |
| `src/core/link-types.ts` | 后端类型定义 | ~30 |

**总计：4 个文件，~680 行。**

### 4.2 修改文件

| 文件 | 改动 |
|------|------|
| `frontend/src/hooks/useWebSocket.ts` | 内部改用 BuddyLink，对外接口不变 |
| `frontend/src/App.tsx` | 配置同步逻辑（从 localStorage 恢复） |
| `src/core/ws-handler.ts` | 集成 LinkHandler（ACK 回复、幂等检查） |
| `src/ws/server.ts` | pong 响应附 configHash |
| `src/types.ts` | WSClientMessage 添加 id，新增 ack/pong 类型 |

---

## 五、BuddyLink 接口设计

### 5.1 公开 API（4 个方法）

```typescript
class BuddyLink {
  /**
   * 建立连接（含心跳 + 重连 + Token 刷新）
   * 内部自动处理所有连接生命周期
   */
  connect(url: string): void;

  /**
   * 发送消息（含 ACK + 重试 + 降级 + 离线队列）
   * 返回 Promise：ACK 确认后 resolve，重试耗尽后 reject
   */
  send(msg: unknown): Promise<void>;

  /**
   * 监听消息（后端推过来的事件）
   */
  onMessage(handler: (msg: unknown) => void): void;

  /**
   * 断开连接
   */
  disconnect(): void;
}
```

### 5.2 状态查询（只读）

```typescript
class BuddyLink {
  /** 当前连接状态 */
  get state(): State;

  /** 连接质量指标 */
  get metrics(): {
    rtt: number;              // 心跳往返时间
    reconnectCount: number;   // 重连次数
    messagesSent: number;     // 发送消息数
    messagesFailed: number;   // 失败消息数
    pendingCount: number;     // 待确认消息数
    queueSize: number;        // 离线队列大小
    uptime: number;           // 连接时长（ms）
    quality: 'good' | 'degraded' | 'poor';
  };

  /** 故障模式（从诊断派生） */
  getFaultPattern(): FaultPattern[];

  /** 自适应参数（从故障模式推导） */
  getAdaptiveParams(): CommParams;

  /** 诊断日志（最近 N 条事件） */
  getLog(count?: number): CommEvent[];
}
```

### 5.3 使用示例

```typescript
// App.tsx
const link = new BuddyLink();

// 连接
link.connect(wsUrl);

// 监听消息
link.onMessage((event) => {
  switch (event.type) {
    case 'llm_response': // ...
    case 'emotion':      // ...
  }
});

// 发送（自动处理 ACK/重试/降级）
await link.send({ type: 'chat', content: 'hello' });
await link.send({ type: 'llm_config', ...config });

// 查询状态
console.log(link.metrics.quality);  // 'good'
console.log(link.getFaultPattern()); // [{ cause: 'timeout', count: 2, ... }]
```

---

## 六、后端 LinkHandler

### 6.1 职责

```
收到消息：
  1. 检查 id → 幂等性（已处理过就只回 ACK）
  2. 回 ACK
  3. 处理消息

收到 ping：
  1. 回 pong + configHash + serverTime

收到配置更新：
  1. 写入磁盘
  2. 热重载 LLM
  3. 更新内存 configHash
  4. 回 ACK
```

### 6.2 接口

```typescript
class LinkHandler {
  /** 处理 WS 消息（集成到 ws-handler.ts 的 onMessage 中） */
  handleMessage(ws: WebSocket, msg: WSClientMessage): void;

  /** 处理 ping（集成到 ws-handler.ts 的 ping 处理中） */
  handlePing(ws: WebSocket, msg: { ts: number; configHash: string }): void;

  /** 获取当前配置 hash（用于 pong 响应） */
  getConfigHash(): string;
}
```

---

## 七、TypeScript 类型定义

### 7.1 共享类型（link-types.ts）

```typescript
// 通信事件（诊断用）
export interface CommEvent {
  timestamp: number;
  type: 'send' | 'ack' | 'retry' | 'timeout' | 'connect' | 'disconnect' 
      | 'heartbeat' | 'fallback' | 'queue' | 'flush' | 'error' | 'config_sync';
  success: boolean;
  cause?: {
    category: 'network' | 'auth' | 'config' | 'timeout' | 'protocol' | 'unknown';
    detail: string;
  };
  context?: Record<string, unknown>;
}

// 故障模式（从诊断派生）
export interface FaultPattern {
  cause: string;
  count: number;
  lastSeen: number;
  trend: 'increasing' | 'stable' | 'decreasing';
}

// 自适应参数
export interface CommParams {
  timeoutMs: number;
  maxRetries: number;
  heartbeatIntervalMs: number;
  tokenRefreshFirst: boolean;
}

// 待确认消息
export interface PendingMsg {
  id: string;
  payload: string;
  sentAt: number;
  retries: number;
  resolve: () => void;
  reject: (err: Error) => void;
}
```

### 7.2 WS 协议扩展（types.ts）

```typescript
// 新增消息类型
export type WSClientMessage =
  | ... // 已有类型
  | { type: 'ack'; id: string }                    // 新增：ACK 确认
  | { type: 'pong'; ts: number; configHash: string }; // 新增：心跳响应

// 所有客户端消息可选附带 id
// WSClientMessage & { id?: string }
```

---

## 八、IndexedDB 离线队列

### 8.1 结构

```
Database: buddy_comm
Store: queue
  key: id
  value: { id, payload, priority, createdAt, retryCount }

优先级：
  CRITICAL = 3  — LLM 配置、认证
  HIGH     = 2  — 用户聊天消息
  NORMAL   = 1  — 视觉种子、状态请求
  LOW      = 0  — 心跳、统计
```

### 8.2 操作

```typescript
// 入队（离线时）
await idb.put('queue', { id, payload, priority, createdAt: Date.now(), retryCount: 0 });

// flush（连接恢复时）
const queued = await idb.getAll('queue');
queued.sort((a, b) => b.priority - a.priority); // 高优先先发
for (const item of queued) {
  await this.send(JSON.parse(item.payload));
  await idb.delete('queue', item.id);
}

// 清理（超过 24h 未发送的丢弃）
const stale = queued.filter(q => Date.now() - q.createdAt > 86400000);
stale.forEach(q => idb.delete('queue', q.id));
```

---

## 九、实施计划

### Week 1: 核心管道（BuddyLink + LinkHandler）

```
Day 1-2: BuddyLink 骨架
├── 状态机（6 种状态 + 类型约束）
├── connect / disconnect
├── 心跳（ping/pong + RTT）
└── 重连（指数退避 + jitter）

Day 3-4: 消息可靠性
├── send（附 id + pending Map + ACK 等待）
├── 超时重试（最多 3 次）
├── 降级（REST fallback）
└── 离线队列（IndexedDB）

Day 5: 后端 LinkHandler
├── ACK 回复
├── 幂等检查
├── pong + configHash
└── 集成到 ws-handler.ts
```

### Week 2: 诊断 + 配置同步 + 集成

```
Day 1-2: Observe 层
├── 事件环形缓冲区
├── getFaultPattern（查询派生）
├── getAdaptiveParams（参数推导）
└── Token 自动刷新

Day 3: 配置同步
├── 心跳附 configHash
├── 检测到不一致 → 自动重推
└── Push + Pull 双向确认

Day 4-5: 集成 + 测试
├── useWebSocket 内部改用 BuddyLink
├── 对外接口不变（零破坏性）
├── App.tsx 配置同步
└── 端到端测试
```

### Week 3: 管道扩展 + 优化

```
Day 1-2: 扩展机制
├── Pipeline 注册机制
├── 插入层 API
└── 示例：压缩层 / 优先级层

Day 3-5: 边界情况 + 性能
├── 异常状态恢复测试
├── IndexedDB 并发安全
├── 内存泄漏检查
└── 前端 UI 连接状态展示
```

---

## 十、验收标准

### 功能验收（12 项能力全部覆盖）

- [ ] 心跳 30s 间隔，RTT 可观测
- [ ] 连接死亡 90s 内自动检测
- [ ] 重连使用 Jitter 退避
- [ ] 消息发送后收到 ACK
- [ ] 超时消息自动重发（最多 3 次）
- [ ] 页面刷新后离线队列不丢失
- [ ] WS 不可用时 REST 降级可用
- [ ] Token 过期时自动刷新
- [ ] 前后端配置自动对齐
- [ ] 每个通信失败有归因日志
- [ ] 故障模式可查询
- [ ] 策略参数可自适应

### 架构验收

- [ ] 前端 BuddyLink 单文件 < 500 行
- [ ] 后端 LinkHandler 单文件 < 250 行
- [ ] 模块间零耦合（无循环引用）
- [ ] 状态转换编译期检查
- [ ] 新增能力不改已有代码（管道扩展）
- [ ] useWebSocket 对外接口不变（零破坏性）

### 性能验收

- [ ] 管道处理延迟 < 1ms（不含网络）
- [ ] IndexedDB 操作不阻塞主线程
- [ ] 内存占用 < 1MB（缓冲区 + pending Map）
- [ ] 无内存泄漏（长时间运行稳定）
