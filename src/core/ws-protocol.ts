/**
 * WS 协议层 — 心跳、重连、诊断、确认队列
 *
 * 从 ws-handler.ts 提取（REFACTOR_PLAN Step 2）
 * 职责：WS 连接生命周期管理、消息确认、链路诊断
 */

import type { WSClientMessage, WSEvent } from '../types.js';
import type { EventBus } from '../ws/server.js';
import type { LinkHandler } from './link-handler.js';
import type { LinkDiagnostics } from './link-diagnostics.js';
import type { WebSocket } from 'ws';

export interface PendingConfirm {
  id: string;
  resolve: (allowed: boolean) => void;
}

export interface WSProtocolDeps {
  linkHandler: LinkHandler;
  linkDiag: LinkDiagnostics;
  verbose: boolean;
}

/**
 * WS 协议层管理器
 *
 * 封装：
 * - 并发确认队列（pendingConfirms）
 * - 链路诊断（linkDiag）
 * - 心跳/重连/ACK 协议处理
 */
export class WSProtocol {
  /** 并发确认队列 — ISSUE-012 */
  private pendingConfirms = new Map<string, PendingConfirm>();

  constructor(private deps: WSProtocolDeps) {}

  // ── 确认队列管理 ──

  /** 获取 pendingConfirm（供确认拦截使用） */
  getPendingConfirm(id?: string): PendingConfirm | null {
    if (id) return this.pendingConfirms.get(id) ?? null;
    return this.pendingConfirms.values().next().value ?? null;
  }

  /** 设置 pendingConfirm */
  setPendingConfirm(pc: PendingConfirm | null): void {
    if (pc) {
      this.pendingConfirms.set(pc.id, pc);
    } else {
      this.pendingConfirms.clear();
    }
  }

  /** 移除指定确认（ISSUE-012） */
  removePendingConfirm(id: string): void {
    this.pendingConfirms.delete(id);
  }

  // ── 诊断代理 ──

  /** 记录链路错误 */
  recordError(msg: string): void {
    this.deps.linkDiag.recordError(msg);
  }

  /** 获取链路诊断数据 */
  getDiagnostics() {
    return this.deps.linkDiag;
  }

  /** 获取 LinkHandler */
  getLinkHandler(): LinkHandler {
    return this.deps.linkHandler;
  }

  // ── 协议事件注册 ──

  /**
   * 注册连接/断连诊断事件
   */
  setupConnectionEvents(eventBus: EventBus): void {
    eventBus.onConnect(() => {
      this.deps.linkDiag.recordConnect();
    });
    eventBus.onDisconnect(() => {
      this.deps.linkDiag.recordDisconnect();
    });
  }

  /**
   * 处理协议层消息（心跳、重连、确认、ACK）
   * @returns true 表示消息已处理（调用方应跳过后续路由）
   */
  handleProtocolMessage(msg: WSClientMessage, eventBus: EventBus, ws?: WebSocket): boolean {
    // ACK 消息 — 透传给 LinkHandler
    if (msg.type === 'ack') {
      return true;
    }

    // Pong 消息 — 客户端心跳响应
    if (msg.type === 'pong') {
      return true;
    }

    // Ping 消息 — 客户端心跳，回复 pong + configHash
    if (msg.type === 'ping') {
      const pong = this.deps.linkHandler.createPong(msg.ts ?? Date.now());
      eventBus.emit({ type: 'status', data: pong });
      this.deps.linkHandler.recordEvent('heartbeat', true);
      return true;
    }

    // Resume 消息 — 客户端重连后请求重放未收到的消息
    if (msg.type === 'resume') {
      const lastSeq = msg.lastSeq ?? 0;
      const replayMessages = this.deps.linkHandler.getReplayMessages(lastSeq);
      if (replayMessages.length > 0) {
        if (this.deps.verbose) console.log(`[LinkHandler] 重放 ${replayMessages.length} 条消息 (from seq ${lastSeq + 1})`);
        // 直接发送给请求的客户端，不走 eventBus.emit() 避免：
        // 1. 广播给所有客户端（应只发给请求者）
        // 2. 重新写入 replayBuffer（导致重放风暴）
        if (ws && ws.readyState === 1 /* OPEN */) {
          // 分批发送，避免突发大量消息导致客户端处理不过来
          const BATCH_SIZE = 5;
          const BATCH_DELAY_MS = 50;
          const sendBatch = async () => {
            for (let i = 0; i < replayMessages.length; i += BATCH_SIZE) {
              const batch = replayMessages.slice(i, i + BATCH_SIZE);
              for (const replayMsg of batch) {
                if (ws.readyState !== 1) break; // 连接已断开
                ws.send(JSON.stringify(replayMsg));
              }
              if (i + BATCH_SIZE < replayMessages.length) {
                await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
              }
            }
          };
          sendBatch().catch(() => {});
        } else {
          // fallback: ws 不可用时走 eventBus（兼容旧路径，标记 skipReplay 防止回写）
          for (const replayMsg of replayMessages) {
            eventBus.emit(replayMsg as WSEvent, { skipReplay: true });
          }
        }
        // 关键：replay 完成后清除已发送的消息，防止下次 resume 重复重放
        const lastReplaySeq = (replayMessages.at(-1) as Record<string, unknown>)?.seq as number ?? lastSeq;
        this.deps.linkHandler.clearReplayUpTo(lastReplaySeq);
        this.deps.linkHandler.recordEvent('flush', true, undefined, { count: replayMessages.length, reason: 'resume' });
        // 发送 resume_ack，告知客户端重放结束的 seq
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'resume_ack', lastSeq: lastReplaySeq, count: replayMessages.length }));
        }
      }
      return true;
    }

    // 工具确认响应 — 匹配并发确认队列
    if (msg.type === 'tool_confirm_response') {
      const pendingId = msg.confirmId ?? msg.id;
      const pending = pendingId
        ? this.pendingConfirms.get(pendingId)
        : this.pendingConfirms.values().next().value;
      if (pending) {
        pending.resolve(msg.allowed);
        this.pendingConfirms.delete(pending.id);
      }
      return true;
    }

    return false;
  }

  /**
   * 幂等检查 + ACK 回复
   * @returns true 表示消息是重复的（调用方应跳过业务逻辑）
   */
  handleIdempotency(msg: WSClientMessage, eventBus: EventBus): boolean {
    // 幂等检查：有 id 的消息检查是否已处理
    if (msg.id && !this.deps.linkHandler.shouldProcess(msg.id)) {
      const ack = this.deps.linkHandler.createAck(msg.id);
      if (ack) eventBus.emit(ack as unknown as WSEvent);
      return true; // 重复消息
    }

    // 回 ACK（有 id 的消息）
    if (msg.id) {
      const ack = this.deps.linkHandler.createAck(msg.id);
      if (ack) eventBus.emit(ack as unknown as WSEvent);
    }

    return false;
  }

  /**
   * 标记消息已处理（在业务逻辑完成后调用）
   */
  markProcessed(msg: WSClientMessage): void {
    if (msg.id) {
      this.deps.linkHandler.markProcessed(msg.id);
    }
    this.deps.linkDiag.recordMessage();
  }
}
