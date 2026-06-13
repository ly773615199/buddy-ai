/**
 * WS 事件收集器 — 通过 Playwright WebSocket API 监听后端推送
 *
 * 不修改前端代码，不注入 mock WS。
 * 直接监听浏览器与后端之间的真实 WebSocket 帧。
 *
 * 用法：
 *   const collector = new WSEventCollector(page);
 *   await collector.attach();
 *   await sendMessage(page, '你好');
 *   const thinking = await collector.waitFor('thinking');
 *   const response = await collector.waitFor('llm_response');
 *   expect(response.content).toContain('你好');
 */
import type { Page, WebSocket as PlaywrightWS } from '@playwright/test';

/** WS 事件类型（与 src/types.ts WSEvent 对齐） */
export interface WSEvent {
  type: string;
  [key: string]: unknown;
}

type EventCallback = (event: WSEvent) => void;

export class WSEventCollector {
  private events: WSEvent[] = [];
  private listeners: Map<string, EventCallback[]> = new Map();
  private attached = false;

  constructor(private page: Page) {}

  /** 绑定到页面的 WebSocket 连接 */
  async attach() {
    if (this.attached) return;
    this.attached = true;

    this.page.on('websocket', (ws: PlaywrightWS) => {
      ws.on('framereceived', (frame) => {
        try {
          const data = JSON.parse(frame.payload.toString());
          if (data && typeof data.type === 'string') {
            this.events.push(data);
            this.notify(data);
          }
        } catch {
          // 非 JSON 帧（如 ping/pong 二进制帧），忽略
        }
      });
    });
  }

  private notify(event: WSEvent) {
    const cbs = this.listeners.get(event.type) ?? [];
    cbs.forEach(cb => cb(event));
    // 通配符 '*' 监听所有事件
    const allCbs = this.listeners.get('*') ?? [];
    allCbs.forEach(cb => cb(event));
  }

  /**
   * 等待指定类型的事件出现
   * @param type 事件类型（如 'thinking', 'tool_call', 'llm_response'）
   * @param timeoutMs 超时毫秒数
   * @returns 匹配的事件
   */
  async waitFor(type: string, timeoutMs = 15000): Promise<WSEvent> {
    // 先检查已有事件（含尚未 flush 的情况用短轮询兜底）
    for (let i = 0; i < 3; i++) {
      const existing = this.events.find(e => e.type === type);
      if (existing) return existing;
      await this.page.waitForTimeout(50);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener(type, cb);
        const got = this.events.map(e => e.type).join(', ');
        reject(new Error(
          `WS 事件 "${type}" 超时 (${timeoutMs}ms)\n已收到事件: [${got}]`,
        ));
      }, timeoutMs);

      const cb: EventCallback = (e) => {
        clearTimeout(timer);
        this.removeListener(type, cb);
        resolve(e);
      };
      this.addListener(type, cb);
    });
  }

  /**
   * 等待事件序列（按顺序，每个事件独立超时）
   * @param types 事件类型数组
   * @param perEventTimeoutMs 每个事件的超时
   * @returns 匹配的事件数组
   */
  async waitForSequence(types: string[], perEventTimeoutMs = 15000): Promise<WSEvent[]> {
    const results: WSEvent[] = [];
    for (const type of types) {
      const event = await this.waitFor(type, perEventTimeoutMs);
      results.push(event);
    }
    return results;
  }

  /**
   * 等待任意一个事件出现（谁先到返回谁）
   * @param types 候选事件类型
   * @param timeoutMs 超时
   * @returns 先到达的事件
   */
  async waitForAny(types: string[], timeoutMs = 15000): Promise<WSEvent> {
    // 先检查已有事件
    for (const type of types) {
      const existing = this.events.find(e => e.type === type);
      if (existing) return existing;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        types.forEach(t => this.removeListener(t, cb));
        reject(new Error(`WS 事件 [${types.join('|')}] 均超时 (${timeoutMs}ms)`));
      }, timeoutMs);

      const cb: EventCallback = (e) => {
        clearTimeout(timer);
        types.forEach(t => this.removeListener(t, cb));
        resolve(e);
      };
      types.forEach(t => this.addListener(t, cb));
    });
  }

  /** 获取所有已收集的事件 */
  all(): WSEvent[] {
    return [...this.events];
  }

  /** 按类型过滤 */
  filter(type: string): WSEvent[] {
    return this.events.filter(e => e.type === type);
  }

  /** 按类型计数 */
  count(type: string): number {
    return this.events.filter(e => e.type === type).length;
  }

  /** 获取事件类型摘要（调试用） */
  summary(): string {
    const counts: Record<string, number> = {};
    for (const e of this.events) {
      counts[e.type] = (counts[e.type] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([t, n]) => `${t}:${n}`)
      .join(', ');
  }

  /** 清空已收集的事件 */
  clear() {
    this.events = [];
  }

  private addListener(type: string, cb: EventCallback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(cb);
  }

  private removeListener(type: string, cb: EventCallback) {
    const cbs = this.listeners.get(type);
    if (cbs) {
      this.listeners.set(type, cbs.filter(c => c !== cb));
    }
  }
}
