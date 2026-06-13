/**
 * LinkHandler 测试 — 覆盖 WebSocket 优化项
 * P0-2: 消息序列号 + 环形重放缓冲区 + resume
 * P2-3: 心跳双向化（LinkHandler 配置 hash 部分）
 * P2-1: 幂等去重
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LinkHandler } from './link-handler.js';

describe('LinkHandler', () => {
  let handler: LinkHandler;

  beforeEach(() => {
    handler = new LinkHandler(false);
  });

  // ==================== 配置 Hash ====================

  describe('配置 Hash', () => {
    it('生成 8 位 md5 hash', () => {
      handler.updateConfigHash({ name: 'test', port: 8765 });
      const hash = handler.getConfigHash();
      expect(hash).toHaveLength(8);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    it('相同配置生成相同 hash', () => {
      handler.updateConfigHash({ name: 'test' });
      const h1 = handler.getConfigHash();
      handler.updateConfigHash({ name: 'test' });
      expect(handler.getConfigHash()).toBe(h1);
    });

    it('不同配置生成不同 hash', () => {
      handler.updateConfigHash({ name: 'a' });
      const h1 = handler.getConfigHash();
      handler.updateConfigHash({ name: 'b' });
      expect(handler.getConfigHash()).not.toBe(h1);
    });
  });

  // ==================== 消息序列号（P0-2） ====================

  describe('消息序列号', () => {
    it('nextSeq 递增', () => {
      const s1 = handler.nextSeq();
      const s2 = handler.nextSeq();
      const s3 = handler.nextSeq();
      expect(s2).toBe(s1 + 1);
      expect(s3).toBe(s2 + 1);
    });

    it('getCurrentSeq 返回当前最大值', () => {
      handler.nextSeq();
      handler.nextSeq();
      handler.nextSeq();
      expect(handler.getCurrentSeq()).toBe(3);
    });

    it('初始 seq 为 0', () => {
      expect(handler.getCurrentSeq()).toBe(0);
    });
  });

  // ==================== 重放缓冲区（P0-2） ====================

  describe('重放缓冲区', () => {
    it('加入缓冲区后可重放', () => {
      handler.addToReplayBuffer(1, { type: 'llm_response', content: 'hello' });
      handler.addToReplayBuffer(2, { type: 'llm_response', content: 'world' });

      const replay = handler.getReplayMessages(0);
      expect(replay).toHaveLength(2);
      expect(replay[0].seq).toBe(1);
      expect(replay[1].seq).toBe(2);
    });

    it('getReplayMessages 从 lastSeq+1 开始', () => {
      handler.addToReplayBuffer(1, { type: 'a' });
      handler.addToReplayBuffer(2, { type: 'b' });
      handler.addToReplayBuffer(3, { type: 'c' });

      const replay = handler.getReplayMessages(2);
      expect(replay).toHaveLength(1);
      expect(replay[0].seq).toBe(3);
    });

    it('无重放消息返回空数组', () => {
      handler.addToReplayBuffer(1, { type: 'a' });
      const replay = handler.getReplayMessages(5);
      expect(replay).toHaveLength(0);
    });

    it('缓冲区超出最大长度淘汰最旧的', () => {
      // REPLAY_BUFFER_SIZE = 50
      for (let i = 1; i <= 55; i++) {
        handler.addToReplayBuffer(i, { type: 'msg', i });
      }
      const replay = handler.getReplayMessages(0);
      // 最多保留 50 条，最旧的 1-5 被淘汰
      expect(replay.length).toBeLessThanOrEqual(50);
      expect(replay[0].seq).toBeGreaterThan(1);
    });

    it('按 seq 升序返回', () => {
      handler.addToReplayBuffer(5, { type: 'a' });
      handler.addToReplayBuffer(1, { type: 'b' });
      handler.addToReplayBuffer(3, { type: 'c' });

      const replay = handler.getReplayMessages(0);
      const seqs = replay.map(r => r.seq as number);
      expect(seqs).toEqual([1, 3, 5]);
    });

    it('重放消息包含原始 payload 字段', () => {
      handler.addToReplayBuffer(1, { type: 'emotion', mood: 'happy', energy: 80 });
      const replay = handler.getReplayMessages(0);
      expect(replay[0].type).toBe('emotion');
      expect(replay[0].mood).toBe('happy');
      expect(replay[0].energy).toBe(80);
    });
  });

  // ==================== 幂等去重（P2-1） ====================

  describe('幂等去重', () => {
    it('首次消息应处理', () => {
      expect(handler.shouldProcess('msg-001')).toBe(true);
    });

    it('无 id 消息始终处理', () => {
      expect(handler.shouldProcess(undefined)).toBe(true);
      expect(handler.shouldProcess(undefined)).toBe(true);
    });

    it('重复消息拦截', () => {
      handler.markProcessed('msg-001');
      expect(handler.shouldProcess('msg-001')).toBe(false);
    });

    it('不同 id 不拦截', () => {
      handler.markProcessed('msg-001');
      expect(handler.shouldProcess('msg-002')).toBe(true);
    });
  });

  // ==================== ACK ====================

  describe('ACK', () => {
    it('有 id 返回 ACK', () => {
      const ack = handler.createAck('msg-001');
      expect(ack).toEqual({ type: 'ack', id: 'msg-001' });
    });

    it('无 id 返回 null', () => {
      expect(handler.createAck('')).toBeNull();
    });
  });

  // ==================== Pong ====================

  describe('Pong', () => {
    it('生成包含 configHash + serverTime 的 pong', () => {
      handler.updateConfigHash({ test: true });
      const ts = Date.now() - 100;
      const pong = handler.createPong(ts);
      expect(pong.type).toBe('pong');
      expect(pong.ts).toBe(ts);
      expect(pong.configHash).toHaveLength(8);
      expect(pong.serverTime).toBeGreaterThan(ts);
    });
  });

  // ==================== 诊断 ====================

  describe('诊断', () => {
    it('记录事件', () => {
      handler.recordEvent('connect', true);
      handler.recordEvent('send', true);
      const log = handler.getLog(10);
      expect(log).toHaveLength(2);
      expect(log[0].type).toBe('connect');
    });

    it('环形缓冲区限制 100 条', () => {
      for (let i = 0; i < 110; i++) {
        handler.recordEvent('send', true);
      }
      const log = handler.getLog(200);
      expect(log.length).toBeLessThanOrEqual(100);
    });
  });
});
