/**
 * BuddyLink — 事件驱动管道通信层
 * 单文件实现，12 项能力全保留
 *
 * Layer 1: STATE       — 连接状态机（6 种状态，类型约束转换）
 * Layer 2: RELIABILITY — 消息 ACK + 超时重试
 * Layer 3: TRANSPORT   — WS / REST 降级 / IndexedDB 离线队列
 * Layer 4: OBSERVE     — 诊断环形缓冲区 + 故障模式 + 策略自适应
 */

import type {
  LinkState,
  CommEvent,
  FaultPattern,
  CommParams,
  PendingMsg,
  LinkMetrics,
  QueueItem,
  PipelineLayer,
  PipelineContext,
} from './types.js';
import { Priority } from './types.js';

// ==================== 常量 ====================

const HEARTBEAT_INTERVAL_MS = 30_000;
const ACK_TIMEOUT_MS = 5_000;
const MAX_RETRIES = 3;
const MAX_RECONNECT_DELAY = 30_000;
const BASE_RECONNECT_DELAY = 1_000;
const EVENT_BUFFER_SIZE = 100;
const QUEUE_MAX_AGE_MS = 86_400_000; // 24h
const RTT_DEGRADED_THRESHOLD = 1_000;
const IDB_DB_NAME = 'buddy_comm';
const IDB_STORE_NAME = 'queue';

// ==================== 工具函数 ====================

let msgCounter = 0;
const nextMsgId = () => `m-${++msgCounter}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

function jitter(base: number): number {
  return Math.random() * base;
}

function computeBackoff(attempt: number): number {
  return Math.min(BASE_RECONNECT_DELAY * Math.pow(2, attempt), MAX_RECONNECT_DELAY);
}

// ==================== IndexedDB 离线队列 ====================

class OfflineQueue {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  init(): Promise<void> {
    if (this.db) return Promise.resolve();
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(IDB_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    return this.initPromise;
  }

  async enqueue(item: QueueItem): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(IDB_STORE_NAME, 'readwrite');
      tx.objectStore(IDB_STORE_NAME).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async dequeue(id: string): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(IDB_STORE_NAME, 'readwrite');
      tx.objectStore(IDB_STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getAll(): Promise<QueueItem[]> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(IDB_STORE_NAME, 'readonly');
      const req = tx.objectStore(IDB_STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result as QueueItem[]);
      req.onerror = () => reject(req.error);
    });
  }

  async size(): Promise<number> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(IDB_STORE_NAME, 'readonly');
      const req = tx.objectStore(IDB_STORE_NAME).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async clear(): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(IDB_STORE_NAME, 'readwrite');
      tx.objectStore(IDB_STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

// ==================== 管道扩展机制 ====================

/**
 * 管道 — 在已有层之间插入新能力，不改已有代码
 *
 * 位置标识：
 *   'before'  → 管道入口（在 STATE 之前）
 *   'state'   → STATE 层之后
 *   'reliability' → RELIABILITY 层之后
 *   'transport'   → TRANSPORT 层之后
 *   'observe'     → OBSERVE 层之后（管道出口）
 *
 * 示例：
 *   pipeline.use('compress', 'reliability', 'transport', compressFn);
 *   pipeline.use('priority', 'before', 'state', priorityFn);
 */
class Pipeline {
  private layers: Array<{ name: string; handler: PipelineLayer }> = [];

  /**
   * 注册管道层
   * @param name     层名称（用于调试 / 移除）
   * @param handler  处理函数
   */
  use(name: string, handler: PipelineLayer): void {
    // 去重：同名层替换
    this.layers = this.layers.filter(l => l.name !== name);
    this.layers.push({ name, handler });
  }

  /**
   * 移除管道层
   */
  remove(name: string): void {
    this.layers = this.layers.filter(l => l.name !== name);
  }

  /**
   * 执行管道
   * @param ctx     管道上下文
   * @param stage   当前阶段
   * @param coreFn  核心逻辑（管道中间件用 next() 调用）
   */
  async execute<T>(
    ctx: PipelineContext,
    stage: PipelineContext['stage'],
    coreFn: (ctx: PipelineContext) => Promise<T> | T,
  ): Promise<T> {
    ctx.stage = stage;

    let index = 0;
    const layers = this.layers;

    const next = async (): Promise<T> => {
      if (index < layers.length) {
        const layer = layers[index++];
        try {
          return await layer.handler(ctx, next);
        } catch (err) {
          // 层出错不阻断管道，记录后继续
          console.warn(`[Pipeline] layer "${layer.name}" error:`, err);
          return next();
        }
      }
      return coreFn(ctx);
    };

    return next();
  }

  /** 已注册层名称列表（调试用） */
  get layerNames(): string[] {
    return this.layers.map(l => l.name);
  }
}

// ==================== BuddyLink 主类 ====================

export class BuddyLink {
  // --- 状态 ---
  private state: LinkState = { tag: 'idle' };

  // --- 状态订阅（useSyncExternalStore 驱动） ---
  private stateListeners: Set<() => void> = new Set();

  // --- 配置 ---
  private url: string = '';
  private configHash: string = '';

  // --- 心跳 ---
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private missedPongs: number = 0;

  // --- 重连 ---
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts: number = 0;

  // --- 消息可靠性 ---
  private pending: Map<string, PendingMsg> = new Map();

  // --- 诊断 ---
  private events: CommEvent[] = [];
  private metrics = {
    rtt: 0,
    reconnectCount: 0,
    messagesSent: 0,
    messagesFailed: 0,
    connectedAt: 0,
  };

  // --- 离线队列 ---
  private offlineQueue = new OfflineQueue();

  // --- 消息监听 ---
  private messageHandlers: Array<(msg: unknown) => void> = [];

  // --- Token 刷新 ---
  private tokenRefresher?: () => Promise<string>;

  // --- 管道扩展 ---
  private pipeline = new Pipeline();

  // ==================== 公开 API ====================

  /**
   * 建立连接（含心跳 + 重连 + Token 刷新）
   */
  connect(url: string): void {
    this.url = url;
    this.reconnectAttempts = 0;
    this.doConnect();
  }

  /**
   * 发送消息（含 ACK + 重试 + 降级 + 离线队列 + 管道扩展）
   * 返回 Promise：ACK 确认后 resolve，重试耗尽后 reject
   */
  send(msg: unknown, priority: number = Priority.NORMAL): Promise<void> {
    const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);

    // 通过管道处理发送（含核心逻辑）
    return this.pipeline.execute(
      { type: 'send', payload, priority, stage: 'before' },
      'before',
      async (ctx) => {
        // 管道层可以设置 skip=true 跳过发送
        if (ctx.skip) return;

        const finalPayload = ctx.payload ?? payload;

        // Layer 1: STATE — 检查当前状态
        switch (this.state.tag) {
          case 'live':
          case 'degraded':
            return this.sendWithReliability(finalPayload, ctx.priority ?? priority);
          case 'connecting':
          case 'offline':
            return this.enqueueOffline(finalPayload, ctx.priority ?? priority);
          case 'dead':
            return Promise.reject(new Error(`Connection dead: ${this.state.reason}`));
          case 'idle':
            return Promise.reject(new Error('Not connected. Call connect() first.'));
        }
      },
    );
  }

  /**
   * 监听消息（后端推过来的事件）
   */
  onMessage(handler: (msg: unknown) => void): void {
    this.messageHandlers.push(handler);
  }

  /**
   * 移除消息监听
   */
  offMessage(handler: (msg: unknown) => void): void {
    this.messageHandlers = this.messageHandlers.filter(h => h !== handler);
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.stopHeartbeat();
    this.clearReconnectTimer();
    this.clearAllPending('User disconnected');

    if (this.state.tag === 'live' || this.state.tag === 'degraded' || this.state.tag === 'connecting') {
      this.state.ws.close();
    }

    this.transitionTo({ tag: 'idle' });
    this.recordEvent('disconnect', true);
  }

  /**
   * 获取内部 WebSocket 实例（只读，供需要直接监听的组件使用）
   */
  getSocket(): WebSocket | null {
    if (this.state.tag === 'live' || this.state.tag === 'degraded' || this.state.tag === 'connecting') {
      return this.state.ws;
    }
    return null;
  }

  /**
   * 设置 Token 刷新器
   */
  setTokenRefresher(refresher: () => Promise<string>): void {
    this.tokenRefresher = refresher;
  }

  /**
   * 设置配置 hash（用于心跳同步）
   */
  setConfigHash(hash: string): void {
    this.configHash = hash;
  }

  // ==================== 管道扩展 API ====================

  /**
   * 注册管道层 — 新增能力不改已有代码
   *
   * @param name    层名称（唯一标识，同名替换）
   * @param handler 处理函数：(ctx, next) => { ... return next(); }
   *
   * @example
   * // 压缩层（在 reliability 和 transport 之间）
   * link.use('compress', async (ctx, next) => {
   *   if (ctx.type === 'send') ctx.payload = compress(ctx.payload);
   *   const result = await next();
   *   if (ctx.type === 'receive') ctx.msg = decompress(ctx.msg);
   *   return result;
   * });
   *
   * // 优先级层（在 state 之前）
   * link.use('priority', async (ctx, next) => {
   *   if (ctx.type === 'send' && ctx.priority < Priority.HIGH) {
   *     ctx.skip = true; // 低优先级消息跳过
   *   }
   *   return next();
   * });
   *
   * // 指标上报层
   * link.use('metrics', async (ctx, next) => {
   *   const start = performance.now();
   *   const result = await next();
   *   reportMetric(ctx.type, ctx.stage, performance.now() - start);
   *   return result;
   * });
   */
  use(name: string, handler: PipelineLayer): void {
    this.pipeline.use(name, handler);
  }

  /**
   * 移除管道层
   */
  removeLayer(name: string): void {
    this.pipeline.remove(name);
  }

  /**
   * 已注册管道层名称（调试用）
   */
  get pipelineLayers(): string[] {
    return this.pipeline.layerNames;
  }

  // ==================== 状态查询（只读） ====================

  get currentState(): LinkState {
    return this.state;
  }

  /**
   * 状态订阅 — 用于 useSyncExternalStore
   * 返回取消订阅函数
   */
  subscribe = (listener: () => void): (() => void) => {
    this.stateListeners.add(listener);
    return () => { this.stateListeners.delete(listener); };
  };

  /**
   * 获取快照 — 用于 useSyncExternalStore
   * 返回当前状态的 tag（字符串），保证引用稳定
   */
  getSnapshot = (): string => {
    return this.state.tag;
  };

  /**
   * 获取完整状态快照 — 返回 LinkState 对象
   */
  getStateSnapshot = (): LinkState => {
    return this.state;
  };

  get metricsData(): LinkMetrics {
    const uptime = this.state.tag === 'live' || this.state.tag === 'degraded'
      ? Date.now() - this.state.since
      : 0;

    let quality: 'good' | 'degraded' | 'poor' = 'good';
    if (this.state.tag === 'degraded' || this.metrics.rtt > RTT_DEGRADED_THRESHOLD) {
      quality = 'degraded';
    }
    if (this.state.tag === 'offline' || this.state.tag === 'dead') {
      quality = 'poor';
    }

    return {
      rtt: this.metrics.rtt,
      reconnectCount: this.metrics.reconnectCount,
      messagesSent: this.metrics.messagesSent,
      messagesFailed: this.metrics.messagesFailed,
      pendingCount: this.pending.size,
      queueSize: 0, // async, use getQueueSize()
      uptime,
      quality,
    };
  }

  async getQueueSize(): Promise<number> {
    try {
      return await this.offlineQueue.size();
    } catch {
      return 0;
    }
  }

  /**
   * 故障模式（从诊断派生）
   */
  getFaultPattern(): FaultPattern[] {
    const failed = this.events.filter(e => !e.success && e.cause);
    const groups = new Map<string, CommEvent[]>();

    for (const ev of failed) {
      const key = ev.cause!.category;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(ev);
    }

    const patterns: FaultPattern[] = [];
    for (const [cause, evts] of groups) {
      const sorted = evts.sort((a, b) => a.timestamp - b.timestamp);
      const recent = sorted.slice(-10);
      const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
      const secondHalf = recent.slice(Math.floor(recent.length / 2));
      const trend = secondHalf.length > firstHalf.length ? 'increasing' :
        secondHalf.length < firstHalf.length ? 'decreasing' : 'stable';

      patterns.push({
        cause,
        count: evts.length,
        lastSeen: sorted[sorted.length - 1].timestamp,
        trend,
      });
    }

    return patterns;
  }

  /**
   * 自适应参数（从故障模式推导）
   */
  getAdaptiveParams(): CommParams {
    const pattern = this.getFaultPattern();
    const timeoutIssues = pattern.find(p => p.cause === 'timeout');
    const authIssues = pattern.find(p => p.cause === 'auth');

    return {
      timeoutMs: (timeoutIssues && timeoutIssues.count > 5) ? 15_000 : ACK_TIMEOUT_MS,
      maxRetries: (timeoutIssues && timeoutIssues.count > 10) ? 5 : MAX_RETRIES,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      tokenRefreshFirst: !!authIssues && authIssues.count > 2,
    };
  }

  /**
   * 诊断日志（最近 N 条事件）
   */
  getLog(count: number = 20): CommEvent[] {
    return this.events.slice(-count);
  }

  // ==================== Layer 1: STATE — 状态机 ====================

  private transitionTo(newState: LinkState): void {
    this.state = newState;
    // 通知所有状态订阅者
    for (const listener of this.stateListeners) {
      try { listener(); } catch { /* ignore */ }
    }
  }

  private doConnect(): void {
    // 清理旧连接
    if (this.state.tag === 'live' || this.state.tag === 'degraded' || this.state.tag === 'connecting') {
      this.state.ws.close();
    }

    this.transitionTo({
      tag: 'connecting',
      ws: null as unknown as WebSocket, // will set below
      attempt: this.reconnectAttempts,
      since: Date.now(),
    });

    try {
      const socket = new WebSocket(this.url);

      socket.onopen = () => {
        this.reconnectAttempts = 0;
        this.missedPongs = 0;
        this.metrics.connectedAt = Date.now();

        this.transitionTo({
          tag: 'live',
          ws: socket,
          since: Date.now(),
          rtt: 0,
        });

        this.recordEvent('connect', true);
        this.startHeartbeat();
        this.flushOfflineQueue();
      };

      socket.onclose = () => {
        const wasLive = this.state.tag === 'live' || this.state.tag === 'degraded';
        this.stopHeartbeat();

        if (wasLive) {
          this.recordEvent('disconnect', true, { category: 'network', detail: 'Connection closed' });
        }

        this.scheduleReconnect();
      };

      socket.onerror = () => {
        this.recordEvent('error', false, { category: 'network', detail: 'WebSocket error' });
      };

      socket.addEventListener('message', (e) => {
        this.handleMessage((e as MessageEvent).data);
      });

      // Update the connecting state with the actual socket
      if (this.state.tag === 'connecting') {
        this.state.ws = socket;
      }
    } catch (err) {
      this.recordEvent('error', false, {
        category: 'network',
        detail: (err as Error).message,
      });
      this.scheduleReconnect();
    }
  }

  // ==================== Layer 2: RELIABILITY — 消息可靠性 ====================

  private sendWithReliability(payload: string, _priority: number): Promise<void> {
    const params = this.getAdaptiveParams();
    const id = nextMsgId();

    return new Promise<void>((resolve, reject) => {
      const pendingMsg: PendingMsg = {
        id,
        payload,
        sentAt: Date.now(),
        retries: 0,
        resolve: () => {
          this.pending.delete(id);
          this.metrics.messagesSent++;
          resolve();
        },
        reject: (err: Error) => {
          this.pending.delete(id);
          this.metrics.messagesFailed++;
          reject(err);
        },
      };

      this.pending.set(id, pendingMsg);
      this.doSend(id, payload, params);
    });
  }

  private doSend(id: string, payload: string, params: CommParams): void {
    if (this.state.tag !== 'live' && this.state.tag !== 'degraded') {
      const p = this.pending.get(id);
      if (p) p.reject(new Error('Connection lost during send'));
      return;
    }

    try {
      // 附带消息 id
      const msgObj = JSON.parse(payload);
      msgObj.id = id;
      this.state.ws.send(JSON.stringify(msgObj));
      this.recordEvent('send', true, undefined, { id });

      // 等待 ACK
      this.waitForAck(id, params);
    } catch (err) {
      this.recordEvent('send', false, {
        category: 'network',
        detail: (err as Error).message,
      });
      const p = this.pending.get(id);
      if (p) p.reject(err as Error);
    }
  }

  private waitForAck(id: string, params: CommParams): void {
    const timeout = setTimeout(() => {
      const p = this.pending.get(id);
      if (!p) return;

      if (p.retries < params.maxRetries) {
        p.retries++;
        this.recordEvent('retry', true, undefined, {
          id,
          attempt: p.retries,
          maxRetries: params.maxRetries,
        });

        const backoff = jitter(computeBackoff(p.retries));
        setTimeout(() => this.doSend(id, p.payload, params), backoff);
      } else {
        this.recordEvent('timeout', false, {
          category: 'timeout',
          detail: `Max retries (${params.maxRetries}) exceeded`,
        }, { id });

        // 降级到 REST
        this.fallbackToRest(id, p.payload, params);
      }
    }, params.timeoutMs);

    // 存储 timeout 引用以便清理
    const p = this.pending.get(id);
    if (p) {
      (p as PendingMsg & { _timeout?: ReturnType<typeof setTimeout> })._timeout = timeout;
    }
  }

  private handleAck(id: string): void {
    const p = this.pending.get(id);
    if (!p) return;

    const timeout = (p as PendingMsg & { _timeout?: ReturnType<typeof setTimeout> })._timeout;
    if (timeout) clearTimeout(timeout);

    this.recordEvent('ack', true, undefined, { id });
    p.resolve();
  }

  // ==================== Layer 3: TRANSPORT — 通道选择 ====================

  private async fallbackToRest(id: string, payload: string, _params: CommParams): Promise<void> {
    this.recordEvent('fallback', true, undefined, { id, method: 'REST' });

    try {
      const msgObj = JSON.parse(payload);
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: msgObj.content || payload }),
      });

      if (res.ok) {
        const p = this.pending.get(id);
        if (p) p.resolve();
      } else {
        const p = this.pending.get(id);
        if (p) p.reject(new Error(`REST fallback failed: ${res.status}`));
      }
    } catch (err) {
      const p = this.pending.get(id);
      if (p) p.reject(new Error(`REST fallback error: ${(err as Error).message}`));
    }
  }

  private async enqueueOffline(payload: string, priority: number): Promise<void> {
    const id = nextMsgId();
    const item: QueueItem = {
      id,
      payload,
      priority,
      createdAt: Date.now(),
      retryCount: 0,
    };

    try {
      await this.offlineQueue.enqueue(item);
      this.recordEvent('queue', true, undefined, { id, priority });
    } catch (err) {
      this.recordEvent('queue', false, {
        category: 'unknown',
        detail: (err as Error).message,
      });
    }

    return Promise.resolve();
  }

  private async flushOfflineQueue(): Promise<void> {
    try {
      const queued = await this.offlineQueue.getAll();
      if (queued.length === 0) return;

      // 清理过期消息
      const now = Date.now();
      const stale = queued.filter(q => now - q.createdAt > QUEUE_MAX_AGE_MS);
      for (const s of stale) {
        await this.offlineQueue.dequeue(s.id);
      }

      // 按优先级排序，高优先先发
      const valid = queued.filter(q => now - q.createdAt <= QUEUE_MAX_AGE_MS);
      valid.sort((a, b) => b.priority - a.priority);

      this.recordEvent('flush', true, undefined, { count: valid.length });

      for (const item of valid) {
        try {
          await this.send(JSON.parse(item.payload), item.priority);
          await this.offlineQueue.dequeue(item.id);
        } catch {
          // 发送失败，留在队列
        }
      }
    } catch (err) {
      this.recordEvent('flush', false, {
        category: 'unknown',
        detail: (err as Error).message,
      });
    }
  }

  // ==================== Layer 4: OBSERVE — 诊断 ====================

  private recordEvent(
    type: CommEvent['type'],
    success: boolean,
    cause?: CommEvent['cause'],
    context?: Record<string, unknown>,
  ): void {
    const event: CommEvent = {
      timestamp: Date.now(),
      type,
      success,
      cause,
      context,
    };

    this.events.push(event);

    // 环形缓冲区
    if (this.events.length > EVENT_BUFFER_SIZE) {
      this.events = this.events.slice(-EVENT_BUFFER_SIZE);
    }
  }

  // ==================== 心跳 ====================

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.missedPongs = 0;

    this.heartbeatTimer = setInterval(() => {
      if (this.state.tag !== 'live' && this.state.tag !== 'degraded') return;

      if (this.missedPongs >= 3) {
        this.recordEvent('heartbeat', false, {
          category: 'timeout',
          detail: '3 consecutive pongs missed',
        });
        this.state.ws.close();
        return;
      }

      const ts = Date.now();
      try {
        this.state.ws.send(JSON.stringify({
          type: 'ping',
          ts,
          configHash: this.configHash,
        }));
        this.missedPongs++;
        this.recordEvent('heartbeat', true, undefined, { ts });
      } catch (err) {
        this.recordEvent('heartbeat', false, {
          category: 'network',
          detail: (err as Error).message,
        });
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private handlePong(ts: number, serverConfigHash: string): void {
    this.missedPongs = 0;
    const rtt = Date.now() - ts;
    this.metrics.rtt = rtt;

    // RTT 过高 → 降级
    if (this.state.tag === 'live' && rtt > RTT_DEGRADED_THRESHOLD) {
      this.transitionTo({
        tag: 'degraded',
        ws: this.state.ws,
        since: Date.now(),
        reason: `High RTT: ${rtt}ms`,
        failCount: 0,
      });
    }

    // RTT 恢复 → 回到 live
    if (this.state.tag === 'degraded' && rtt <= RTT_DEGRADED_THRESHOLD) {
      this.transitionTo({
        tag: 'live',
        ws: this.state.ws,
        since: Date.now(),
        rtt,
      });
    }

    // 配置同步
    if (serverConfigHash && serverConfigHash !== this.configHash) {
      this.recordEvent('config_sync', true, undefined, {
        local: this.configHash,
        remote: serverConfigHash,
      });
      // 通知监听器
      this.emitMessage({ type: 'config_mismatch', local: this.configHash, remote: serverConfigHash });
    }
  }

  // ==================== 重连 ====================

  private scheduleReconnect(): void {
    this.clearReconnectTimer();

    // 无效 token 不重连
    if (this.url.includes('token=undefined') || this.url.includes('token=null')) {
      this.transitionTo({ tag: 'dead', reason: 'Invalid token', since: Date.now(), attempts: 0 });
      return;
    }

    this.reconnectAttempts++;
    this.metrics.reconnectCount++;

    const delay = jitter(computeBackoff(this.reconnectAttempts));

    this.transitionTo({
      tag: 'offline',
      since: Date.now(),
      queueSize: 0,
    });

    this.reconnectTimer = setTimeout(() => {
      // Token 刷新
      if (this.tokenRefresher && this.reconnectAttempts > 1) {
        this.tokenRefresher()
          .then(newToken => {
            // 替换 URL 中的 token
            this.url = this.url.replace(/token=[^&]+/, `token=${newToken}`);
            this.doConnect();
          })
          .catch(() => this.doConnect());
      } else {
        this.doConnect();
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearAllPending(reason: string): void {
    for (const [, p] of this.pending) {
      const timeout = (p as PendingMsg & { _timeout?: ReturnType<typeof setTimeout> })._timeout;
      if (timeout) clearTimeout(timeout);
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }

  // ==================== 消息处理 ====================

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw);

      // ACK 消息（内部处理，不走管道）
      if (msg.type === 'ack' && msg.id) {
        this.handleAck(msg.id);
        return;
      }

      // Pong 消息（内部处理，不走管道）
      if (msg.type === 'pong') {
        this.handlePong(msg.ts, msg.configHash);
        return;
      }

      // 其他消息 → 通过管道后通知监听器
      this.pipeline.execute(
        { type: 'receive', msg, stage: 'before' },
        'before',
        async (ctx) => {
          if (!ctx.skip) {
            this.emitMessage(ctx.msg ?? msg);
          }
        },
      );
    } catch {
      // ignore parse errors
    }
  }

  private emitMessage(msg: unknown): void {
    for (const handler of this.messageHandlers) {
      try {
        handler(msg);
      } catch {
        // ignore handler errors
      }
    }
  }
}
