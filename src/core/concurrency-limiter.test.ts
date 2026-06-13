import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConcurrencyLimiter, type TaskSample, type AdaptiveConfig } from './concurrency-limiter.js';

function makeSample(overrides: Partial<TaskSample> = {}): TaskSample {
  return {
    id: `test-${Date.now()}`,
    latencyMs: 1500,
    success: true,
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeConfig(overrides: Partial<AdaptiveConfig> = {}): AdaptiveConfig {
  return {
    initialLimit: 3,
    minLimit: 1,
    maxLimit: 10,
    sampleWindow: 5,
    alpha: 2,
    beta: 5,
    scaleUpCooldownMs: 0,    // 测试中禁用冷却
    scaleDownCooldownMs: 0,
    minRTTResetInterval: 100,
    ...overrides,
  };
}

describe('ConcurrencyLimiter', () => {
  let limiter: ConcurrencyLimiter;

  beforeEach(() => {
    limiter = new ConcurrencyLimiter(makeConfig());
  });

  describe('初始化', () => {
    it('使用 initialLimit 作为初始值', () => {
      expect(limiter.getLimit()).toBe(3);
    });

    it('自定义初始值', () => {
      const custom = new ConcurrencyLimiter(makeConfig({ initialLimit: 5 }));
      expect(custom.getLimit()).toBe(5);
    });
  });

  describe('429 紧急回退', () => {
    it('收到 429 时砍半', () => {
      limiter.onSample(makeSample({ errorCode: 429, success: false }));
      expect(limiter.getLimit()).toBe(1); // floor(3 * 0.5) = 1
    });

    it('429 不低于 minLimit', () => {
      limiter.setLimit(1);
      limiter.onSample(makeSample({ errorCode: 429, success: false }));
      expect(limiter.getLimit()).toBe(1);
    });

    it('从高 limit 砍半', () => {
      limiter.setLimit(8);
      limiter.onSample(makeSample({ errorCode: 429, success: false }));
      expect(limiter.getLimit()).toBe(4);
    });
  });

  describe('错误温和减速', () => {
    it('500 错误减到 75%', () => {
      limiter.onSample(makeSample({ success: false, errorCode: 500 }));
      expect(limiter.getLimit()).toBe(2); // floor(3 * 0.75) = 2
    });

    it('超时减到 75%', () => {
      limiter.onSample(makeSample({ success: false, errorCode: 408 }));
      expect(limiter.getLimit()).toBe(2);
    });

    it('减速不低于 minLimit', () => {
      limiter.setLimit(1);
      limiter.onSample(makeSample({ success: false, errorCode: 500 }));
      expect(limiter.getLimit()).toBe(1);
    });
  });

  describe('Vegas 延迟探测', () => {
    it('低延迟时加速（+1）', () => {
      // 先建立基准延迟
      limiter.setLimit(3);
      for (let i = 0; i < 5; i++) {
        limiter.onSample(makeSample({ latencyMs: 1000 }));
      }
      // minRTT 应该是 1000，窗口满 → queue=0 < alpha → +1，limit=4
      // 持续低延迟，第二个窗口 → queue=0 < alpha → +1，limit=5
      for (let i = 0; i < 5; i++) {
        limiter.onSample(makeSample({ latencyMs: 1000 }));
      }
      // 两个窗口各加速一次：3 → 4 → 5
      expect(limiter.getLimit()).toBe(5);
    });

    it('高延迟时减速（-1）', () => {
      limiter.setLimit(5);
      // 建立基准
      for (let i = 0; i < 5; i++) {
        limiter.onSample(makeSample({ latencyMs: 1000 }));
      }
      // 高延迟窗口
      for (let i = 0; i < 5; i++) {
        limiter.onSample(makeSample({ latencyMs: 5000 }));
      }
      // queueEstimate = 5 * (1 - 1000/5000) = 4 → 在 alpha-beta 之间，不变
      // 更高延迟
      for (let i = 0; i < 5; i++) {
        limiter.onSample(makeSample({ latencyMs: 10000 }));
      }
      // queueEstimate = 5 * (1 - 1000/10000) = 4.5 → 还是稳定区
      // 再高
      for (let i = 0; i < 5; i++) {
        limiter.onSample(makeSample({ latencyMs: 50000 }));
      }
      // queueEstimate = 5 * (1 - 1000/50000) = 4.9 → 接近 beta(5)
      // 极端延迟
      for (let i = 0; i < 5; i++) {
        limiter.onSample(makeSample({ latencyMs: 100000 }));
      }
      // queueEstimate = 5 * (1 - 1000/100000) = 4.95 → < beta(5)
      // 需要让 minRTT 保持在 1000，用更高延迟突破 beta
      for (let i = 0; i < 5; i++) {
        limiter.onSample(makeSample({ latencyMs: 200000 }));
      }
      // queueEstimate = 5 * (1 - 1000/200000) = 4.975 → still < 5
      // 看来需要更大的延迟差异，或者调整 alpha/beta
      // 用 alpha=2, beta=5 测试：需要 queueEstimate > 5
      // 5 * (1 - 1000/x) > 5 → 不可能，因为 (1 - 1000/x) < 1
      // 所以实际上 limit=5 时不会减速，因为 queueEstimate 永远 < limit
      // 这是 Vegas 算法的特性：只有当 minRTT/avgRTT 比值很小时才会触发
      // 重新设计测试：用更高的 limit
      limiter.reset();
      limiter.setLimit(10);
      for (let i = 0; i < 5; i++) {
        limiter.onSample(makeSample({ latencyMs: 1000 }));
      }
      // minRTT = 1000
      for (let i = 0; i < 5; i++) {
        limiter.onSample(makeSample({ latencyMs: 3000 }));
      }
      // queueEstimate = 10 * (1 - 1000/3000) = 6.67 > beta(5) → -1
      expect(limiter.getLimit()).toBe(9);
    });

    it('稳定区不变', () => {
      // 建立基准延迟 minRTT=1000
      limiter.setLimit(5);
      for (let i = 0; i < 5; i++) {
        limiter.onSample(makeSample({ latencyMs: 1000 }));
      }
      // 第一个窗口：queue=5*(1-1000/1000)=0 < alpha → +1，limit=6
      expect(limiter.getLimit()).toBe(6);

      // 第二个窗口：queue=6*(1-1000/1700)=2.47 → 在 [2,5] 稳定区，不变
      for (let i = 0; i < 5; i++) {
        limiter.onSample(makeSample({ latencyMs: 1700 }));
      }
      expect(limiter.getLimit()).toBe(6); // 稳定区不变
    });
  });

  describe('边界保护', () => {
    it('不超过 maxLimit', () => {
      limiter.setLimit(10);
      // 持续低延迟，尝试加速
      for (let i = 0; i < 20; i++) {
        limiter.onSample(makeSample({ latencyMs: 1000 }));
      }
      expect(limiter.getLimit()).toBe(10);
    });

    it('不低于 minLimit', () => {
      limiter.setLimit(1);
      // 多次 429
      for (let i = 0; i < 5; i++) {
        limiter.onSample(makeSample({ errorCode: 429, success: false }));
      }
      expect(limiter.getLimit()).toBe(1);
    });
  });

  describe('采样窗口', () => {
    it('窗口未满时不决策', () => {
      limiter.setLimit(3);
      // 4 次（窗口大小 5）
      for (let i = 0; i < 4; i++) {
        limiter.onSample(makeSample({ latencyMs: 1000 }));
      }
      expect(limiter.getLimit()).toBe(3); // 未满窗口，不变
    });

    it('窗口满时决策并清空', () => {
      limiter.setLimit(3);
      // 5 次低延迟（窗口满）
      for (let i = 0; i < 5; i++) {
        limiter.onSample(makeSample({ latencyMs: 1000 }));
      }
      // minRTT=1000, avgRTT=1000, queue=0 < alpha → +1
      expect(limiter.getLimit()).toBe(4);
    });
  });

  describe('状态查询', () => {
    it('getStatus 返回完整状态', () => {
      limiter.onSample(makeSample({ latencyMs: 1200 }));
      const status = limiter.getStatus();
      expect(status.currentLimit).toBe(3);
      expect(status.algorithm).toBe('vegas+aimd');
      expect(status.recentSamples).toHaveLength(1);
      expect(status.sampleCount).toBe(1);
    });
  });

  describe('重置', () => {
    it('reset 恢复初始状态', () => {
      limiter.setLimit(8);
      limiter.onSample(makeSample({ errorCode: 429, success: false }));
      limiter.reset();
      expect(limiter.getLimit()).toBe(3);
      expect(limiter.getStatus().sampleCount).toBe(0);
    });
  });

  describe('冷却时间', () => {
    it('加速冷却期内不加速', () => {
      const cooled = new ConcurrencyLimiter(makeConfig({
        scaleUpCooldownMs: 10_000,
        sampleWindow: 1,
      }));
      cooled.setLimit(3);

      // 第一次低延迟 → 加速
      cooled.onSample(makeSample({ latencyMs: 1000 }));
      expect(cooled.getLimit()).toBe(4);

      // 立即再来一次 → 冷却期，不加速
      cooled.onSample(makeSample({ latencyMs: 1000 }));
      expect(cooled.getLimit()).toBe(4); // 不变
    });
  });

  describe('setLimit 手动覆盖', () => {
    it('手动设置后 clamp 到范围', () => {
      limiter.setLimit(0);
      expect(limiter.getLimit()).toBe(1); // minLimit

      limiter.setLimit(100);
      expect(limiter.getLimit()).toBe(10); // maxLimit

      limiter.setLimit(5);
      expect(limiter.getLimit()).toBe(5);
    });
  });
});
