/**
 * LinkHandler — 后端通信层
 * ACK 回复、幂等检查、pong + configHash、诊断记录
 * + 消息序列号 + 环形重放缓冲区（断连恢复）
 */

import type { CommEvent, ProcessedMsg } from './link-types.js';
import { createHash } from 'crypto';

// ==================== 常量 ====================

const EVENT_BUFFER_SIZE = 100;
const PROCESSED_MSG_MAX_AGE_MS = 300_000; // 5 分钟清理已处理消息
const REPLAY_BUFFER_SIZE = 20;            // 重放缓冲区最大消息数（从 50 降到 20，减少重放风暴）
const REPLAY_BUFFER_MAX_AGE_MS = 300_000; // 重放缓冲区消息最大存活 5 分钟

// ==================== 重放缓冲区项 ====================

interface ReplayEntry {
  seq: number;
  payload: Record<string, unknown>;
  timestamp: number;
}

// ==================== LinkHandler ====================

export class LinkHandler {
  private events: CommEvent[] = [];
  private processed: Map<string, ProcessedMsg> = new Map();
  private configHash: string = '';

  // 消息序列号 + 重放缓冲区
  private seqCounter = 0;
  private replayBuffer: ReplayEntry[] = [];

  constructor(private verbose: boolean = false) {}

  // ==================== 配置 Hash ====================

  /**
   * 更新配置 hash（配置变更时调用）
   */
  updateConfigHash(config: unknown): void {
    const json = JSON.stringify(config);
    this.configHash = createHash('md5').update(json).digest('hex').slice(0, 8);
  }

  /**
   * 获取当前配置 hash
   */
  getConfigHash(): string {
    return this.configHash;
  }

  // ==================== 消息处理 ====================

  /**
   * 处理 WS 消息 — 返回是否已处理（用于幂等检查）
   * 集成到 ws-handler.ts 的 onMessage 中
   */
  shouldProcess(msgId: string | undefined): boolean {
    if (!msgId) return true; // 无 id 的消息正常处理

    const existing = this.processed.get(msgId);
    if (existing) {
      if (this.verbose) console.log(`[LinkHandler] 幂等拦截: ${msgId}`);
      return false;
    }

    return true;
  }

  /**
   * 标记消息已处理
   */
  markProcessed(msgId: string, result?: string): void {
    if (!msgId) return;

    this.processed.set(msgId, {
      id: msgId,
      processedAt: Date.now(),
      result,
    });

    // 清理过期记录
    this.cleanupProcessed();
  }

  /**
   * 生成 ACK 响应
   */
  createAck(msgId: string): { type: 'ack'; id: string } | null {
    if (!msgId) return null;
    return { type: 'ack', id: msgId };
  }

  /**
   * 生成 Pong 响应（含 configHash + serverTime）
   */
  createPong(clientTs: number): {
    type: 'pong';
    ts: number;
    configHash: string;
    serverTime: number;
  } {
    return {
      type: 'pong',
      ts: clientTs,
      configHash: this.configHash,
      serverTime: Date.now(),
    };
  }

  // ==================== 消息序列号 + 重放缓冲区 ====================

  /**
   * 获取下一个消息序列号
   */
  nextSeq(): number {
    return ++this.seqCounter;
  }

  /**
   * 将已发送的消息加入重放缓冲区
   * @param seq 消息序列号
   * @param payload 消息内容（不含 seq，发送时动态附加）
   */
  addToReplayBuffer(seq: number, payload: Record<string, unknown>): void {
    this.replayBuffer.push({ seq, payload, timestamp: Date.now() });

    // 超出最大长度 → 淘汰最旧的
    if (this.replayBuffer.length > REPLAY_BUFFER_SIZE) {
      this.replayBuffer = this.replayBuffer.slice(-REPLAY_BUFFER_SIZE);
    }

    // 清理过期条目
    const now = Date.now();
    this.replayBuffer = this.replayBuffer.filter(
      e => now - e.timestamp < REPLAY_BUFFER_MAX_AGE_MS,
    );
  }

  /**
   * 获取从 lastSeq + 1 开始的重放消息
   * @param lastSeq 客户端最后收到的序列号
   * @returns 需要重放的消息数组（按 seq 升序）
   */
  getReplayMessages(lastSeq: number): Array<Record<string, unknown>> {
    return this.replayBuffer
      .filter(e => e.seq > lastSeq)
      .sort((a, b) => a.seq - b.seq)
      .map(e => ({ ...e.payload, seq: e.seq, _replaySeq: e.seq }));
  }

  /**
   * 获取当前最大序列号（用于新连接初始值）
   */
  getCurrentSeq(): number {
    return this.seqCounter;
  }

  // ==================== 诊断 ====================

  /**
   * 记录通信事件
   */
  recordEvent(
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

  /**
   * 获取诊断日志
   */
  getLog(count: number = 20): CommEvent[] {
    return this.events.slice(-count);
  }

  // ==================== 内部工具 ====================

  private cleanupProcessed(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [id, msg] of this.processed) {
      if (now - msg.processedAt > PROCESSED_MSG_MAX_AGE_MS) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.processed.delete(id);
    }
  }
}
