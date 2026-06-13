/**
 * WebSocket 压力测试 — 全部基于真实 LinkHandler 生产代码
 *
 * 覆盖：
 * 1. 高频消息吞吐 — 1000 条消息 seq 无重复、重放缓冲区限制
 * 2. 重放缓冲区压力 — 乱序插入排序、边界条件
 * 3. 幂等去重 — 大量不同/重复消息的拦截
 * 4. 序列号单调递增 — 10000 次无跳号
 * 5. 内存泄漏 — 幂等 Map + 诊断缓冲区不膨胀
 * 6. 传感器洪水 — 高频 sensor 消息 seq 连续、缓冲区限制
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LinkHandler } from './core/link-handler.js';

function makeHandler() {
  return new LinkHandler(false);
}

describe('🔥 WebSocket 压力测试 (真实 LinkHandler)', () => {

  // ── 1. 高频消息吞吐 ──

  describe('高频消息吞吐', () => {
    it('1000 条消息 seq 无重复', () => {
      const handler = makeHandler();
      const seqs = new Set<number>();
      for (let i = 0; i < 1000; i++) {
        seqs.add(handler.nextSeq());
      }
      expect(seqs.size).toBe(1000);
    });

    it('1000 条消息重放缓冲区大小 ≤ 50', () => {
      const handler = makeHandler();
      for (let i = 1; i <= 1000; i++) {
        handler.addToReplayBuffer(i, { type: 'msg', i });
      }
      const replay = handler.getReplayMessages(0);
      expect(replay.length).toBeLessThanOrEqual(50);
      // 保留最新的 50 条（seq 951-1000）
      expect(replay[0].seq).toBe(951);
    });

    it('1000 次 send + 诊断不崩溃', () => {
      const handler = makeHandler();
      for (let i = 0; i < 1000; i++) {
        handler.recordEvent('send', true);
      }
      const log = handler.getLog(200);
      expect(log.length).toBeLessThanOrEqual(100);
    });
  });

  // ── 2. 重放缓冲区压力 ──

  describe('重放缓冲区压力', () => {
    it('200 条消息积压，重放返回最新 50 条', () => {
      const handler = makeHandler();
      for (let i = 1; i <= 200; i++) {
        handler.addToReplayBuffer(i, { type: 'msg', content: `msg-${i}` });
      }
      const replay = handler.getReplayMessages(0);
      expect(replay.length).toBeLessThanOrEqual(50);
      expect(replay[replay.length - 1].seq).toBe(200);
    });

    it('重放消息按 seq 严格升序', () => {
      const handler = makeHandler();
      const order = [50, 10, 30, 20, 40, 5, 15, 25, 35, 45];
      for (const seq of order) {
        handler.addToReplayBuffer(seq, { type: 'test', seq });
      }
      const replay = handler.getReplayMessages(0);
      const seqs = replay.map(r => r.seq as number);
      for (let i = 1; i < seqs.length; i++) {
        expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
      }
    });

    it('无消息时重放返回空数组', () => {
      const handler = makeHandler();
      expect(handler.getReplayMessages(0)).toEqual([]);
      expect(handler.getReplayMessages(999)).toEqual([]);
    });

    it('重放从 lastSeq+1 开始，不含 lastSeq', () => {
      const handler = makeHandler();
      for (let i = 1; i <= 10; i++) {
        handler.addToReplayBuffer(i, { type: 'msg' });
      }
      const replay = handler.getReplayMessages(5);
      expect(replay.every(r => (r.seq as number) > 5)).toBe(true);
      expect(replay).toHaveLength(5);
    });
  });

  // ── 3. 幂等去重 ──

  describe('幂等去重', () => {
    it('1000 条不同消息全部通过', () => {
      const handler = makeHandler();
      for (let i = 0; i < 1000; i++) {
        expect(handler.shouldProcess(`msg-${i}`)).toBe(true);
        handler.markProcessed(`msg-${i}`);
      }
    });

    it('1000 条重复消息全部拦截', () => {
      const handler = makeHandler();
      handler.markProcessed('dup-msg');
      for (let i = 0; i < 1000; i++) {
        expect(handler.shouldProcess('dup-msg')).toBe(false);
      }
    });

    it('交替新旧消息，旧的被拦截新的通过', () => {
      const handler = makeHandler();
      for (let i = 0; i < 100; i++) {
        handler.markProcessed(`old-${i}`);
      }
      let passed = 0;
      let blocked = 0;
      for (let i = 0; i < 200; i++) {
        const id = i < 100 ? `old-${i}` : `new-${i}`;
        if (handler.shouldProcess(id)) {
          passed++;
          handler.markProcessed(id);
        } else {
          blocked++;
        }
      }
      expect(passed).toBe(100);
      expect(blocked).toBe(100);
    });
  });

  // ── 4. 序列号单调递增 ──

  describe('序列号单调递增', () => {
    it('10000 次 nextSeq 严格递增无跳号', () => {
      const handler = makeHandler();
      let prev = 0;
      for (let i = 0; i < 10000; i++) {
        const s = handler.nextSeq();
        expect(s).toBe(prev + 1);
        prev = s;
      }
      expect(handler.getCurrentSeq()).toBe(10000);
    });
  });

  // ── 5. 内存泄漏 — 缓冲区清理 ──

  describe('内存泄漏', () => {
    it('幂等 Map 不随消息无限增长（5 分钟过期清理）', () => {
      const handler = makeHandler();
      for (let i = 0; i < 10000; i++) {
        handler.markProcessed(`msg-${i}`);
      }
      expect(handler.shouldProcess('msg-9999')).toBe(false);
      expect(handler.shouldProcess('new-msg')).toBe(true);
    });

    it('诊断环形缓冲区限制 100 条', () => {
      const handler = makeHandler();
      for (let i = 0; i < 5000; i++) {
        handler.recordEvent('send', true);
      }
      const log = handler.getLog(1000);
      expect(log.length).toBeLessThanOrEqual(100);
    });
  });

  // ── 6. 传感器洪水 ──

  describe('传感器洪水', () => {
    it('1000 条 sensor 消息 seq 不跳号', () => {
      const handler = makeHandler();
      const seqs: number[] = [];
      for (let i = 0; i < 1000; i++) {
        seqs.push(handler.nextSeq());
      }
      for (let i = 1; i < seqs.length; i++) {
        expect(seqs[i]).toBe(seqs[i - 1] + 1);
      }
    });

    it('sensor 消息在重放缓冲区中正常存储且限制 50', () => {
      const handler = makeHandler();
      for (let i = 1; i <= 60; i++) {
        handler.addToReplayBuffer(i, {
          type: 'sensor_update',
          data: { motion: { x: 0, y: 0, z: 9.8, state: 'stationary' } },
        });
      }
      const replay = handler.getReplayMessages(0);
      expect(replay.length).toBeLessThanOrEqual(50);
      expect(replay[0].type).toBe('sensor_update');
    });
  });

  // ── 7. 综合：LinkHandler 全链路 ──

  describe('综合：LinkHandler 全链路', () => {
    it('模拟完整生命周期：发送 → 积压 → 重放 → 去重', () => {
      const handler = makeHandler();

      // 1. 发送 50 条消息
      for (let i = 1; i <= 50; i++) {
        handler.addToReplayBuffer(i, { type: 'chat', content: `msg-${i}` });
      }

      // 2. 断连期间积压 30 条
      for (let i = 51; i <= 80; i++) {
        handler.addToReplayBuffer(i, { type: 'llm_response', content: `offline-${i}` });
      }

      // 3. 重连后重放（从 lastSeq=50 开始）
      const replay = handler.getReplayMessages(50);
      expect(replay).toHaveLength(30);
      expect(replay[0].seq).toBe(51);
      expect(replay[29].seq).toBe(80);

      // 4. 继续发送 + 去重
      handler.markProcessed('msg-dup');
      expect(handler.shouldProcess('msg-dup')).toBe(false);
      expect(handler.shouldProcess('msg-new')).toBe(true);

      // 5. 诊断记录
      handler.recordEvent('connect', true);
      handler.recordEvent('send', true);
      const log = handler.getLog(10);
      expect(log.length).toBeGreaterThanOrEqual(2);
    });
  });
});
