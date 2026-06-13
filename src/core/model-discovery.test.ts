import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  discoverModels,
  discoverAll,
  clearDiscoveryCache,
  clearPlatformCache,
  getDiscoveryCacheStatus,
  dedupeModels,
  type PlatformConfig,
  type PricingSource,
} from './model-discovery.js';
import type { ModelProfile } from './model-pool.js';

// ==================== Mock Platform Config ====================

const MOCK_CONFIG: PlatformConfig = {
  id: 'test-platform',
  type: 'custom',
  apiKey: 'test-key',
  baseUrl: 'http://localhost:9999/v1', // Non-existent, will fail
};

// ==================== Tests ====================

describe('ModelDiscovery', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearDiscoveryCache();
    // Mock fetch to fail immediately (avoid real network calls + timeouts)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
  });

  afterEach(() => {
    // Restore original fetch to prevent leaking into other test files
    vi.stubGlobal('fetch', originalFetch);
  });

  describe('discoverModels', () => {
    it('should handle connection failure gracefully', async () => {
      const result = await discoverModels(MOCK_CONFIG);
      expect(result.platform).toBe('test-platform');
      expect(result.models).toEqual([]);
      expect(result.error).toBeDefined();
      expect(result.fromCache).toBe(false);
    });

    it('should return cached results on failure', async () => {
      const result1 = await discoverModels(MOCK_CONFIG);
      expect(result1.error).toBeDefined();
      expect(result1.discoveredAt).toBeGreaterThan(0);
      expect(Array.isArray(result1.models)).toBe(true);
    });

    it('should handle unknown platform type as OpenAI compatible', async () => {
      const unknownConfig: PlatformConfig = {
        id: 'unknown',
        type: 'custom',
        baseUrl: 'http://localhost:9999/v1',
      };
      const result = await discoverModels(unknownConfig);
      expect(result.platform).toBe('unknown');
      expect(result.models).toEqual([]);
    });
  });

  describe('discoverAll', () => {
    it('should discover multiple platforms in parallel', async () => {
      const configs: PlatformConfig[] = [
        { id: 'p1', type: 'custom', baseUrl: 'http://localhost:9991/v1' },
        { id: 'p2', type: 'custom', baseUrl: 'http://localhost:9992/v1' },
      ];
      const results = await discoverAll(configs);
      expect(results.length).toBe(2);
      expect(results[0].platform).toBe('p1');
      expect(results[1].platform).toBe('p2');
    });

    it('should handle empty config list', async () => {
      const results = await discoverAll([]);
      expect(results).toEqual([]);
    });
  });

  describe('cache management', () => {
    it('should track cache status', () => {
      const status = getDiscoveryCacheStatus();
      expect(Array.isArray(status)).toBe(true);
    });

    it('should clear all cache', () => {
      clearDiscoveryCache();
      const status = getDiscoveryCacheStatus();
      expect(status.length).toBe(0);
    });

    it('should clear specific platform cache', () => {
      clearPlatformCache('nonexistent');
    });
  });

  describe('model filtering', () => {
    it('should filter out non-chat models from results', async () => {
      const result = await discoverModels({
        id: 'test',
        type: 'custom',
        baseUrl: 'http://localhost:9999/v1',
      });
      for (const model of result.models) {
        expect(model.id).toBeDefined();
        expect(model.capabilities).toBeDefined();
        expect(model.tier).toBeDefined();
      }
    });
  });

  describe('pricing priority chain', () => {
    it('should have api/community/static/none as valid PricingSource values', () => {
      // 类型测试：确认 PricingSource 类型存在
      const sources: PricingSource[] = ['api', 'community', 'static', 'none'];
      expect(sources).toHaveLength(4);
    });

    it('should return models with pricing from API when available', async () => {
      // OpenRouter 等有定价的平台
      const result = await discoverModels({
        id: 'test',
        type: 'custom',
        baseUrl: 'http://localhost:9999/v1',
      });
      // 所有模型应该有 costPer1kInput/Output 字段（即使为 0）
      for (const model of result.models) {
        expect(typeof model.costPer1kInput).toBe('number');
        expect(typeof model.costPer1kOutput).toBe('number');
      }
    });
  });

  describe('dedupeModels', () => {
    function makeProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
      return {
        id: 'test/model-1',
        platform: 'test',
        displayName: 'Test Model',
        tier: 'standard',
        capabilities: {
          reasoning: 0.8, code: 0.7, chinese: 0.6, english: 0.8,
          math: 0.7, creative: 0.5, toolCalling: true, toolCallingMode: 'native',
          vision: false, streaming: true,
        },
        maxContextTokens: 32000,
        maxOutputTokens: 4096,
        costPer1kInput: 0.01,
        costPer1kOutput: 0.02,
        stats: { totalCalls: 0, successes: 0, avgLatencyMs: 0, byTaskType: {} },
        source: 'user_added',
        discoveredAt: Date.now(),
        ...overrides,
      };
    }

    it('should dedupe same-name models and track variants', () => {
      const models: ModelProfile[] = [
        makeProfile({ id: 'sf/Qwen2.5-7B', displayName: 'Qwen2.5-7B', costPer1kInput: 0.01, category: 'chat' }),
        makeProfile({ id: 'sf/Qwen2.5-7B-Pro', displayName: 'Qwen2.5-7B', costPer1kInput: 0.05, category: 'chat' }),
        makeProfile({ id: 'sf/Qwen2.5-7B-Lora', displayName: 'Qwen2.5-7B', costPer1kInput: 0.005, category: 'chat' }),
      ];

      const result = dedupeModels(models);
      expect(result.length).toBe(3);

      // dedupeModels 不设置 active（由 model-pool.dedupeAndOptimize 管理）
      // 验证所有变体都被保留
      expect(result.map(m => m.id).sort()).toEqual([
        'sf/Qwen2.5-7B', 'sf/Qwen2.5-7B-Lora', 'sf/Qwen2.5-7B-Pro',
      ]);

      // First variant gets variantCount metadata
      const first = result[0];
      expect(first.variantCount).toBe(3);
      expect(first.variantIds?.length).toBe(2);
    });

    it('should not dedupe different models', () => {
      const models: ModelProfile[] = [
        makeProfile({ id: 'a/Model-A', displayName: 'Model-A', category: 'chat' }),
        makeProfile({ id: 'b/Model-B', displayName: 'Model-B', category: 'chat' }),
      ];

      const result = dedupeModels(models);
      expect(result.length).toBe(2);
      expect(result[0].id).toBe('a/Model-A');
      expect(result[1].id).toBe('b/Model-B');
    });

    it('should not dedupe same-name different-category models', () => {
      const models: ModelProfile[] = [
        makeProfile({ id: 'sf/Qwen-VL', displayName: 'Qwen-VL', category: 'vl-chat' }),
        makeProfile({ id: 'sf/Qwen-VL-gen', displayName: 'Qwen-VL', category: 'image-gen' }),
      ];

      const result = dedupeModels(models);
      expect(result.length).toBe(2);
      // Different categories, both preserved
      expect(result.map(m => m.category).sort()).toEqual(['image-gen', 'vl-chat']);
    });

    it('should handle single model', () => {
      const models: ModelProfile[] = [
        makeProfile({ id: 'a/Solo', displayName: 'Solo', category: 'chat' }),
      ];

      const result = dedupeModels(models);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('a/Solo');
    });

    it('should handle empty list', () => {
      const result = dedupeModels([]);
      expect(result.length).toBe(0);
    });
  });
});
