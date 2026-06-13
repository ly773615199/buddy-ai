import { describe, it, expect, vi } from 'vitest';
import { ModelHealthProber, type HealthProbeResult } from './model-health-prober.js';
import type { ModelPool, ModelProfile } from './model-pool.js';

function makeProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: 'test/model', platform: 'test', displayName: 'Test', tier: 'standard',
    capabilities: {
      reasoning: 0.7, code: 0.7, chinese: 0.8, english: 0.7, math: 0.5,
      creative: 0.5, toolCalling: true, toolCallingMode: 'native',
      vision: false, streaming: true,
    },
    maxContextTokens: 32000, maxOutputTokens: 4096,
    costPer1kInput: 0.001, costPer1kOutput: 0.002,
    stats: { totalCalls: 0, successes: 0, avgLatencyMs: 0, byTaskType: {} },
    source: 'platform_api', discoveredAt: Date.now(),
    ...overrides,
  };
}

function createMockPool(profiles: ModelProfile[]): ModelPool {
  return {
    getAllProfiles: () => profiles,
    getProfile: (id: string) => profiles.find(p => p.id === id) ?? null,
  } as unknown as ModelPool;
}

describe('ModelHealthProber', () => {
  it('未探测时默认可用', () => {
    const pool = createMockPool([makeProfile()]);
    const prober = new ModelHealthProber(pool, { enabled: false });
    expect(prober.isAvailable('test/model')).toBe(true);
    expect(prober.getQualityFactor('test/model')).toBe(1.0);
  });

  it('探测成功 → healthy', async () => {
    const pool = createMockPool([makeProfile()]);
    const prober = new ModelHealthProber(pool, { enabled: false }, {
      prober: async () => ({ reachable: true, latencyMs: 100 }),
    });
    const result = await prober.probeOne('test/model');
    expect(result.quality).toBe('healthy');
    expect(result.reachable).toBe(true);
    expect(result.latencyMs).toBeLessThan(1000);
  });

  it('探测延迟高 → degraded', async () => {
    const pool = createMockPool([makeProfile()]);
    const prober = new ModelHealthProber(pool, {
      enabled: false,
      degradedThresholdMs: 200,
    }, {
      prober: async () => ({ reachable: true, latencyMs: 500 }),
    });
    const result = await prober.probeOne('test/model');
    expect(result.quality).toBe('degraded');
  });

  it('连续失败 → unhealthy', async () => {
    const pool = createMockPool([makeProfile()]);
    const prober = new ModelHealthProber(pool, {
      enabled: false,
      unhealthyThreshold: 2,
    }, {
      prober: async () => { throw new Error('连接超时'); },
    });

    await prober.probeOne('test/model');
    expect(prober.isAvailable('test/model')).toBe(true); // 第 1 次失败还可用

    await prober.probeOne('test/model');
    expect(prober.isAvailable('test/model')).toBe(false); // 第 2 次失败 → unhealthy
    expect(prober.getUnhealthyModels()).toContain('test/model');
  });

  it('质量系数: healthy=1.0, degraded=0.7, unhealthy=0.3', async () => {
    const pool = createMockPool([
      makeProfile({ id: 'a/model' }),
      makeProfile({ id: 'b/model' }),
      makeProfile({ id: 'c/model' }),
    ]);

    let callCount = 0;
    const prober = new ModelHealthProber(pool, {
      enabled: false,
      unhealthyThreshold: 2,
      degradedThresholdMs: 100,
    }, {
      prober: async (id: string) => {
        if (id === 'a/model') return { reachable: true, latencyMs: 50 };
        if (id === 'b/model') return { reachable: true, latencyMs: 500 };
        throw new Error('fail');
      },
    });

    // 探测两次（让 c/model 达到 unhealthy 阈值）
    await prober.probeOne('a/model');
    await prober.probeOne('b/model');
    await prober.probeOne('c/model');
    await prober.probeOne('c/model');

    expect(prober.getQualityFactor('a/model')).toBe(1.0);
    expect(prober.getQualityFactor('b/model')).toBe(0.7);
    expect(prober.getQualityFactor('c/model')).toBe(0.3);
  });
});
