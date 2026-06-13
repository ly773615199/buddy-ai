/**
 * SharedConnection — BroadcastChannel 多标签页 WS 共享
 *
 * 策略：第一个标签页建 WS（主节点），其他通过 BroadcastChannel 收发。
 * 主标签页关闭时竞选新主节点（最小 tabId 胜出）。
 *
 * 协议：
 *   BC 消息类型：
 *     - 'claim'    → 竞选主节点
 *     - 'heartbeat' → 主节点心跳（每 5s）
 *     - 'message'  → WS 消息转发（主 → 从）
 *     - 'send'     → 发送请求（从 → 主）
 *     - 'close'    → 主节点关闭通知
 */

const BC_CHANNEL_NAME = 'buddy-ws-shared';
const HEARTBEAT_INTERVAL_MS = 5_000;
const HEARTBEAT_TIMEOUT_MS = 15_000; // 3 次未收到心跳 → 主节点失效

export interface BCMessage {
  type: 'claim' | 'heartbeat' | 'message' | 'send' | 'close';
  tabId: string;
  timestamp: number;
  payload?: unknown;
}

export type SharedConnectionRole = 'master' | 'slave' | 'unclaimed';

export class SharedConnection {
  private tabId: string;
  private bc: BroadcastChannel | null = null;
  private role: SharedConnectionRole = 'unclaimed';
  private masterTabId: string | null = null;
  private masterLastSeen = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private claimTimer: ReturnType<typeof setTimeout> | null = null;

  // 回调
  private onMessageCallback: ((msg: unknown) => void) | null = null;
  private onSendCallback: ((payload: string) => void) | null = null;
  private onRoleChangeCallback: ((role: SharedConnectionRole) => void) | null = null;

  constructor() {
    this.tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /** 初始化 */
  init(): void {
    if (typeof BroadcastChannel === 'undefined') {
      // 不支持 BroadcastChannel（如 Safari 旧版），直接当独立节点
      this.role = 'master';
      this.onRoleChangeCallback?.('master');
      return;
    }

    this.bc = new BroadcastChannel(BC_CHANNEL_NAME);
    this.bc.onmessage = (event) => this.handleBCMessage(event.data as BCMessage);

    // 竞选：先等一小段时间看有没有主节点
    this.broadcast({ type: 'claim' });
    this.claimTimer = setTimeout(() => {
      if (this.role === 'unclaimed') {
        // 没人响应 → 我当主节点
        this.becomeMaster();
      }
    }, 500);
  }

  /** 设置消息回调（主节点收到的 WS 消息转发给从节点） */
  onMessage(callback: (msg: unknown) => void): void {
    this.onMessageCallback = callback;
  }

  /** 设置发送回调（从节点的发送请求转发给主节点执行） */
  onSend(callback: (payload: string) => void): void {
    this.onSendCallback = callback;
  }

  /** 角色变化回调 */
  onRoleChange(callback: (role: SharedConnectionRole) => void): void {
    this.onRoleChangeCallback = callback;
  }

  /** 当前角色 */
  get currentRole(): SharedConnectionRole {
    return this.role;
  }

  /** 是否为主节点 */
  get isMaster(): boolean {
    return this.role === 'master';
  }

  /**
   * 发送消息
   * 主节点：直接通过回调发送 WS
   * 从节点：通过 BroadcastChannel 转发给主节点
   */
  send(payload: string): boolean {
    if (this.role === 'master') {
      // 主节点：直接发送
      this.onSendCallback?.(payload);
      return true;
    } else if (this.role === 'slave') {
      // 从节点：转发给主节点
      this.broadcast({ type: 'send', payload });
      return true;
    }
    return false;
  }

  /**
   * 广播 WS 消息给所有从节点（主节点调用）
   */
  broadcastToSlaves(msg: unknown): void {
    if (this.role !== 'master') return;
    this.broadcast({ type: 'message', payload: msg });
  }

  /** 清理 */
  destroy(): void {
    if (this.role === 'master') {
      this.broadcast({ type: 'close' });
    }
    this.stopHeartbeat();
    if (this.claimTimer) {
      clearTimeout(this.claimTimer);
      this.claimTimer = null;
    }
    if (this.bc) {
      this.bc.close();
      this.bc = null;
    }
    this.role = 'unclaimed';
  }

  // ==================== 内部方法 ====================

  private handleBCMessage(msg: BCMessage): void {
    if (msg.tabId === this.tabId) return; // 忽略自己发的

    switch (msg.type) {
      case 'claim':
        if (this.role === 'master') {
          // 我是主节点，回复心跳确认
          this.broadcast({ type: 'heartbeat' });
        } else if (this.role === 'unclaimed') {
          // 有人竞选，等一下看谁当主
          this.masterTabId = msg.tabId;
          this.masterLastSeen = Date.now();
          this.role = 'slave';
          this.onRoleChangeCallback?.('slave');
          this.startSlaveHeartbeat();
        }
        break;

      case 'heartbeat':
        if (this.role === 'slave') {
          this.masterTabId = msg.tabId;
          this.masterLastSeen = Date.now();
        } else if (this.role === 'unclaimed') {
          // 有主节点在，我当从节点
          this.masterTabId = msg.tabId;
          this.masterLastSeen = Date.now();
          this.role = 'slave';
          this.onRoleChangeCallback?.('slave');
          this.startSlaveHeartbeat();
          if (this.claimTimer) {
            clearTimeout(this.claimTimer);
            this.claimTimer = null;
          }
        }
        break;

      case 'message':
        // 主节点转发的 WS 消息
        if (this.role === 'slave' && msg.tabId === this.masterTabId) {
          this.onMessageCallback?.(msg.payload);
        }
        break;

      case 'send':
        // 从节点的发送请求（只有主节点处理）
        if (this.role === 'master') {
          this.onSendCallback?.(msg.payload as string);
        }
        break;

      case 'close':
        // 主节点关闭
        if (this.role === 'slave' && msg.tabId === this.masterTabId) {
          this.masterTabId = null;
          this.role = 'unclaimed';
          this.stopHeartbeat();
          // 竞选新主节点
          this.broadcast({ type: 'claim' });
          this.claimTimer = setTimeout(() => {
            if (this.role === 'unclaimed') {
              this.becomeMaster();
            }
          }, 500);
        }
        break;
    }
  }

  private becomeMaster(): void {
    this.role = 'master';
    this.onRoleChangeCallback?.('master');
    this.broadcast({ type: 'heartbeat' });
    this.startMasterHeartbeat();
    if (this.claimTimer) {
      clearTimeout(this.claimTimer);
      this.claimTimer = null;
    }
  }

  private startMasterHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.broadcast({ type: 'heartbeat' });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private startSlaveHeartbeat(): void {
    this.stopHeartbeat();
    // 从节点定期检查主节点是否存活
    this.heartbeatTimer = setInterval(() => {
      if (this.role === 'slave' && Date.now() - this.masterLastSeen > HEARTBEAT_TIMEOUT_MS) {
        // 主节点失效 → 竞选
        this.masterTabId = null;
        this.role = 'unclaimed';
        this.onRoleChangeCallback?.('unclaimed');
        this.broadcast({ type: 'claim' });
        this.claimTimer = setTimeout(() => {
          if (this.role === 'unclaimed') {
            this.becomeMaster();
          }
        }, 500);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private broadcast(msg: Omit<BCMessage, 'tabId' | 'timestamp'>): void {
    if (!this.bc) return;
    try {
      this.bc.postMessage({
        ...msg,
        tabId: this.tabId,
        timestamp: Date.now(),
      } as BCMessage);
    } catch { /* ignore */ }
  }
}
