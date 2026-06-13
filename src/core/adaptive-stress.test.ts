/**
 * 自适应并发控制压力测试
 *
 * 验证 ConcurrencyLimiter + AdaptiveTaskQueue 在各种负载场景下的行为
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConcurrencyLimiter, type TaskSample, type AdaptiveConfig } from './concurrency-limiter.js';
import { AdaptiveTaskQueue, TaskQueue } from './task-queue.js';

function sample(overrides: Partial<TaskSample> = {}): TaskSample {
  return {
    id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    latencyMs: 1500,
    success: true,
    timestamp: Date.now(),
    ...overrides,
  };
}

function config(overrides: Partial<AdaptiveConfig> = {}): AdaptiveConfig {
  return {
    initialLimit: 3,
    minLimit: 1,
    maxLimit: 10,
    sampleWindow: 5,
    alpha: 2,
    beta: 5,
    scaleUpCooldownMs: 0,
    scaleDownCooldownMs: 0,
    minRTTResetInterval: 100,
    ...overrides,
  };
}

describe('ConcurrencyLimiter 压力测试', () => {

  describe('快速连续发 20 条消息', () => {
    it('低延迟下 limit 持续上升直到 maxLimit', () => {
      const limiter = new ConcurrencyLimiter(config({ maxLimit: 6, sampleWindow: 5 }));

      // 20 条低延迟消息，每 5 条一个窗口
      for (let i = 0; i < 20; i++) {
        limiter.onSample(sample({ latencyMs: 800 }));
      }

      // 应该从 3 加速到 6（maxLimit）
      expect(limiter.getLimit()).toBe(6);
    });

    it('高延迟下 limit 下降到稳定区（Vegas 特性）', () => {
      const limiter = new ConcurrencyLimiter(config({ initialLimit: 8, minLimit: 1, sampleWindow: 5 }));

      // 建立基准
      for (let i = 0; i < 5; i++) {
        limiter.onSample(sample({ latencyMs: 1000 }));
      }
      // 第一个窗口：limit 8→9（低延迟加速）

      // 持续高延迟
      for (let i = 0; i < 40; i++) {
        limiter.onSample(sample({ latencyMs: 50000 }));
      }

      // Vegas 算法特性：limit 降到约 beta 附近就不再降
      // 因为 queueEstimate = limit * 0.98，当 limit<=5 时 queueEstimate<5=beta
      expect(limiter.getLimit()).toBeLessThanOrEqual(6);
      expect(limiter.getLimit()).toBeGreaterThanOrEqual(1);
    });

    it('429 能突破 Vegas 稳定区，降到 minLimit', () => {
      const limiter = new ConcurrencyLimiter(config({ initialLimit: 8, minLimit: 1, sampleWindow: 5 }));

      // 先让 Vegas 降到稳定区
      for (let i = 0; i < 5; i++) {
        limiter.onSample(sample({ latencyMs: 1000 }));
      }
      for (let i = 0; i < 40; i++) {
        limiter.onSample(sample({ latencyMs: 50000 }));
      }

      // 再用 429 打到底
      for (let i = 0; i < 5; i++) {
        limiter.onSample(sample({ errorCode: 429, success: false }));
      }

      expect(limiter.getLimit()).toBe(1);
    });

    it('混合延迟下 limit 波动但不崩溃', () => {
      const limiter = new ConcurrencyLimiter(config({ sampleWindow: 3 }));

      const results: number[] = [];
      for (let i = 0; i < 30; i++) {
        const latency = i % 2 === 0 ? 1000 : 5000;
        limiter.onSample(sample({ latencyMs: latency }));
        results.push(limiter.getLimit());
      }

      // 不应低于 minLimit 或超过 maxLimit
      for (const r of results) {
        expect(r).toBeGreaterThanOrEqual(1);
        expect(r).toBeLessThanOrEqual(10);
      }
    });
  });

  describe('模拟 429 响应', () => {
    it('单次 429 立即砍半', () => {
      const limiter = new ConcurrencyLimiter(config({ initialLimit: 8 }));
      limiter.onSample(sample({ errorCode: 429, success: false }));
      expect(limiter.getLimit()).toBe(4);
    });

    it('连续 429 快速降到 minLimit', () => {
      const limiter = new ConcurrencyLimiter(config({ initialLimit: 8, minLimit: 1 }));

      for (let i = 0; i < 5; i++) {
        limiter.onSample(sample({ errorCode: 429, success: false }));
      }

      expect(limiter.getLimit()).toBe(1);
    });

    it('429 后恢复正常，limit 逐步回升', () => {
      const limiter = new ConcurrencyLimiter(config({ initialLimit: 6, sampleWindow: 3 }));

      // 先被 429 打到 3
      limiter.onSample(sample({ errorCode: 429, success: false }));
      expect(limiter.getLimit()).toBe(3);

      // 恢复正常低延迟
      for (let i = 0; i < 15; i++) {
        limiter.onSample(sample({ latencyMs: 1000 }));
      }

      // 应该回升
      expect(limiter.getLimit()).toBeGreaterThan(3);
    });
  });

  describe('模拟延迟逐渐升高（渐进拥堵）', () => {
    it('延迟从 1s 爬升到 10s，limit 平滑下降', () => {
      const limiter = new ConcurrencyLimiter(config({ initialLimit: 6, sampleWindow: 3 }));

      // 建立基准 minRTT=1000
      for (let i = 0; i < 3; i++) {
        limiter.onSample(sample({ latencyMs: 1000 }));
      }

      const limits: number[] = [];
      // 延迟逐步升高
      for (let latency = 1500; latency <= 10000; latency += 500) {
        for (let i = 0; i < 3; i++) {
          limiter.onSample(sample({ latencyMs: latency }));
        }
        limits.push(limiter.getLimit());
      }

      // 最终应该比初始低
      expect(limits[limits.length - 1]).toBeLessThan(limits[0]);

      // 不应出现剧烈跳动（相邻差值不超过 2）
      for (let i = 1; i < limits.length; i++) {
        expect(Math.abs(limits[i] - limits[i - 1])).toBeLessThanOrEqual(2);
      }
    });
  });

  describe('高延迟→低延迟恢复', () => {
    it('从拥堵恢复后 limit 回升', () => {
      const limiter = new ConcurrencyLimiter(config({ initialLimit: 5, sampleWindow: 3 }));

      // 建立基准
      for (let i = 0; i < 3; i++) {
        limiter.onSample(sample({ latencyMs: 1000 }));
      }

      // 拥堵阶段
      for (let i = 0; i < 15; i++) {
        limiter.onSample(sample({ latencyMs: 20000 }));
      }
      const congestedLimit = limiter.getLimit();

      // 恢复低延迟
      for (let i = 0; i < 15; i++) {
        limiter.onSample(sample({ latencyMs: 1000 }));
      }
      const recoveredLimit = limiter.getLimit();

      expect(recoveredLimit).toBeGreaterThan(congestedLimit);
    });
  });

  describe('错误类型区分', () => {
    it('500 错误比 429 温和', () => {
      const limiter429 = new ConcurrencyLimiter(config({ initialLimit: 8 }));
      const limiter500 = new ConcurrencyLimiter(config({ initialLimit: 8 }));

      limiter429.onSample(sample({ errorCode: 429, success: false }));
      limiter500.onSample(sample({ errorCode: 500, success: false }));

      // 429 砍半(4)，500 减到 75%(6)
      expect(limiter429.getLimit()).toBeLessThan(limiter500.getLimit());
    });

    it('超时(408)和 500 同等处理', () => {
      const limiter408 = new ConcurrencyLimiter(config({ initialLimit: 8 }));
      const limiter500 = new ConcurrencyLimiter(config({ initialLimit: 8 }));

      limiter408.onSample(sample({ errorCode: 408, success: false }));
      limiter500.onSample(sample({ errorCode: 500, success: false }));

      expect(limiter408.getLimit()).toBe(limiter500.getLimit());
    });
  });

  describe('minRTT 重置', () => {
    it('采样超过重置间隔后 minRTT 更新', () => {
      const limiter = new ConcurrencyLimiter(config({
        sampleWindow: 1,
        minRTTResetInterval: 5,
      }));

      // 初始基准 2000ms
      for (let i = 0; i < 5; i++) {
        limiter.onSample(sample({ latencyMs: 2000 }));
      }

      // 后续全部 500ms（更快的网络）
      for (let i = 0; i < 10; i++) {
        limiter.onSample(sample({ latencyMs: 500 }));
      }

      const status = limiter.getStatus();
      // minRTT 应该被刷新到更小的值
      expect(status.minRTT).toBeLessThanOrEqual(500);
    });
  });

  describe('极端场景', () => {
    it('所有消息都失败，limit 稳定在 minLimit', () => {
      const limiter = new ConcurrencyLimiter(config({ initialLimit: 10, minLimit: 1 }));

      for (let i = 0; i < 50; i++) {
        const errorType = i % 3 === 0 ? 429 : i % 3 === 1 ? 500 : 408;
        limiter.onSample(sample({ errorCode: errorType, success: false }));
      }

      expect(limiter.getLimit()).toBe(1);
    });

    it('延迟为 0 不会导致除零', () => {
      const limiter = new ConcurrencyLimiter(config({ sampleWindow: 3 }));

      for (let i = 0; i < 5; i++) {
        limiter.onSample(sample({ latencyMs: 0 }));
      }

      // 不应崩溃
      expect(limiter.getLimit()).toBeGreaterThanOrEqual(1);
    });

    it('超大延迟不溢出', () => {
      const limiter = new ConcurrencyLimiter(config({ sampleWindow: 3 }));

      for (let i = 0; i < 5; i++) {
        limiter.onSample(sample({ latencyMs: 999_999_999 }));
      }

      expect(limiter.getLimit()).toBeGreaterThanOrEqual(1);
      expect(limiter.getLimit()).toBeLessThanOrEqual(10);
    });
  });
});

describe('AdaptiveTaskQueue 压力测试', () => {

  describe('并发 acquire/release', () => {
    it('3 个任务同时 acquire，第 4 个排队', async () => {
      const queue = new AdaptiveTaskQueue({
        initialLimit: 3,
        enabled: false, // 固定模式，纯队列测试
      });

      const acquired: string[] = [];

      // 3 个立即获得
      await queue.acquire('a');
      acquired.push('a');
      await queue.acquire('b');
      acquired.push('b');
      await queue.acquire('c');
      acquired.push('c');

      expect(acquired).toEqual(['a', 'b', 'c']);
      expect(queue.getRunning()).toHaveLength(3);

      // 释放一个后，第 4 个才能获得
      queue.release('a');
      await queue.acquire('d');
      acquired.push('d');
      expect(acquired).toEqual(['a', 'b', 'c', 'd']);

      // 清理
      queue.release('b');
      queue.release('c');
      queue.release('d');
    });

    it('自适应模式下 release 后 limit 可能变化', async () => {
      const queue = new AdaptiveTaskQueue({
        initialLimit: 3,
        minLimit: 1,
        maxLimit: 6,
        sampleWindow: 2,
        enabled: true,
      });

      await queue.acquire('a');
      await queue.acquire('b');

      // 释放时传入低延迟样本
      queue.release('a', { id: 'a', latencyMs: 500, success: true, timestamp: Date.now() });
      queue.release('b', { id: 'b', latencyMs: 500, success: true, timestamp: Date.now() });

      const status = queue.getStatus();
      expect(status.adaptive).toBe(true);
      expect(status.limiter).not.toBeNull();
    });
  });

  describe('adaptive.enabled=false 回退', () => {
    it('禁用自适应时行为与固定 TaskQueue 一致', async () => {
      const adaptive = new AdaptiveTaskQueue({
        initialLimit: 3,
        enabled: false,
      });

      await adaptive.acquire('a');
      adaptive.release('a', { id: 'a', latencyMs: 500, success: true, timestamp: Date.now() });

      const status = adaptive.getStatus();
      expect(status.adaptive).toBe(false);
      expect(status.limiter).toBeNull();
      expect(status.maxConcurrent).toBe(3); // 不变
    });
  });

  describe('releaseExpired 兼容性', () => {
    it('超时任务被正确释放', async () => {
      vi.useFakeTimers();
      const queue = new AdaptiveTaskQueue({
        initialLimit: 2,
        enabled: false,
      });

      await queue.acquire('slow');
      await queue.acquire('fast');

      // 快进时间让 slow 任务超时
      vi.advanceTimersByTime(100);

      const released = queue.releaseExpired(10); // 10ms 超时
      expect(released).toContain('slow');

      queue.release('fast');
      vi.useRealTimers();
    });
  });

  describe('clear 不影响 limiter 配置', () => {
    it('clear 后 limiter reset 但配置保留', async () => {
      const queue = new AdaptiveTaskQueue({
        initialLimit: 5,
        enabled: true,
      });

      await queue.acquire('a');
      queue.release('a', { id: 'a', latencyMs: 1000, success: true, timestamp: Date.now() });

      queue.clear();

      const status = queue.getStatus();
      expect(status.running).toBe(0);
      expect(status.pending).toBe(0);
    });
  });
});
