import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ModelPoolUnified, type ModelProfile, type ModelRequirement } from './model-pool-unified.js';

// ==================== Helpers ====================

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pool-test-'));
}

function makeProfile(overrides?: Partial<ModelProfile>): ModelProfile {
  return {
    id: 'test/model-1',
    platform: 'test',
    displayName: 'Test Model',
    tier: 'standard',
    capabilities: {
      reasoning: 0.8,
      code: 0.7,
      chinese: 0.6,
      english: 0.8,
      math: 0.7,
      creative: 0.5,
      toolCalling: true,
      toolCallingMode: 'native',
      vision: false,
      streaming: true,
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

function makeRequirement(overrides?: Partial<ModelRequirement>): ModelRequirement {
  return {
    taskType: 'chat',
    minCapabilities: {},
    requiredFeatures: [],
    complexity: 'simple',
    ...overrides,
  };
}

// ==================== Tests ====================

describe('ModelPoolUnified', () => {
  let pool: ModelPoolUnified;
  let dataDir: string;

  beforeEach(() => {
    dataDir = makeTmpDir();
    pool = new ModelPoolUnified(dataDir);
  });

  describe('initialization', () => {
    it('should start uninitialized', () => {
      expect(pool.isInitialized).toBe(false);
      expect(pool.size).toBe(0);
    });

    it('should accept manual profiles', () => {
      pool.addProfile(makeProfile({ id: 'test/a' }));
      pool.addProfile(makeProfile({ id: 'test/b' }));
      expect(pool.size).toBe(2);
    });

    it('should initialize from legacy pool config', () => {
      pool.initializeFromLegacy({
        strategy: 'task_match',
        nodes: [
          {
            id: 'node1',
            type: 'cloud',
            provider: 'openai',
            model: 'gpt-4o',
            tags: [],
            tier: 'premium',
            costPer1kInput: 0.02,
            costPer1kOutput: 0.06,
          },
        ],
      });
      expect(pool.isInitialized).toBe(true);
      expect(pool.size).toBe(1);
    });
  });

  describe('three-layer funnel selection', () => {
    beforeEach(() => {
      // Add multiple models with different capabilities
      pool.addProfile(makeProfile({
        id: 'premium/reasoning', tier: 'premium',
        capabilities: { ...makeProfile().capabilities, reasoning: 0.95, code: 0.9, math: 0.9 },
        costPer1kInput: 0.05,
      }));
      pool.addProfile(makeProfile({
        id: 'budget/fast', tier: 'budget',
        capabilities: { ...makeProfile().capabilities, reasoning: 0.6, code: 0.5 },
        costPer1kInput: 0.001,
      }));
      pool.addProfile(makeProfile({
        id: 'free/local', tier: 'free',
        capabilities: { ...makeProfile().capabilities, reasoning: 0.5, code: 0.4, chinese: 0.7 },
        costPer1kInput: 0,
      }));
      pool.addProfile(makeProfile({
        id: 'standard/balanced', tier: 'standard',
        capabilities: { ...makeProfile().capabilities, reasoning: 0.75, code: 0.7 },
        costPer1kInput: 0.02,
      }));
    });

    it('should select a model from the pool', () => {
      const result = pool.select(makeRequirement());
      expect(result).not.toBeNull();
      expect(result!.profile).toBeDefined();
      expect(result!.layer).toBeDefined();
      expect(result!.candidateCount).toBeGreaterThan(0);
    });

    it('should filter by required capabilities', () => {
      const result = pool.select(makeRequirement({
        minCapabilities: { reasoning: 0.9 },
      }));
      expect(result).not.toBeNull();
      expect(result!.profile.capabilities.reasoning).toBeGreaterThanOrEqual(0.9);
    });

    it('should filter by required features', () => {
      // Add a model without tool calling
      pool.addProfile(makeProfile({
        id: 'no-tools/model',
        capabilities: { ...makeProfile().capabilities, toolCalling: false },
      }));

      const result = pool.select(makeRequirement({
        requiredFeatures: ['toolCalling'],
      }));
      expect(result).not.toBeNull();
      expect(result!.profile.capabilities.toolCalling).toBe(true);
    });

    it('should respect cost constraints', () => {
      const result = pool.select(makeRequirement({
        maxCostPer1k: 0.005,
      }));
      expect(result).not.toBeNull();
      expect(result!.profile.costPer1kInput).toBeLessThanOrEqual(0.005);
    });

    it('should respect language preference', () => {
      const result = pool.select(makeRequirement({
        languagePreference: 'chinese',
        minCapabilities: { chinese: 0.6 },
      }));
      expect(result).not.toBeNull();
      expect(result!.profile.capabilities.chinese).toBeGreaterThanOrEqual(0.6);
    });

    it('should return null for empty pool', () => {
      const emptyDir = makeTmpDir();
      const emptyPool = new ModelPoolUnified(emptyDir);
      const result = emptyPool.select(makeRequirement());
      expect(result).toBeNull();
    });
  });

  describe('user controls', () => {
    beforeEach(() => {
      pool.addProfile(makeProfile({ id: 'keep/model' }));
      pool.addProfile(makeProfile({ id: 'exclude/me' }));
    });

    it('should exclude models by pattern', () => {
      pool.addExclusion('exclude/*');
      const result = pool.select(makeRequirement());
      expect(result).not.toBeNull();
      expect(result!.profile.id).toBe('keep/model');
    });

    it('should remove exclusions', () => {
      pool.addExclusion('exclude/*');
      pool.removeExclusion('exclude/*');
      // Both models should be available now
      expect(pool.size).toBe(2);
    });

    it('should update preferences', () => {
      pool.updatePreferences({ strategy: 'cost_optimized', preferFree: true });
      const prefs = pool.getPreferences();
      expect(prefs.strategy).toBe('cost_optimized');
      expect(prefs.preferFree).toBe(true);
    });
  });

  describe('Thompson Sampling feedback', () => {
    beforeEach(() => {
      pool.addProfile(makeProfile({ id: 'model/a' }));
    });

    it('should record feedback and update stats', () => {
      pool.recordFeedback('model/a', 'chat', true, 1500, 0.001);
      const profile = pool.getProfile('model/a');
      expect(profile).not.toBeNull();
      expect(profile!.stats.totalCalls).toBe(1);
      expect(profile!.stats.successes).toBe(1);
      expect(profile!.stats.byTaskType['chat']).toBeDefined();
      expect(profile!.stats.byTaskType['chat'].attempts).toBe(1);
      expect(profile!.stats.byTaskType['chat'].successes).toBe(1);
    });

    it('should track failures', () => {
      pool.recordFeedback('model/a', 'reasoning', false, 5000, 0);
      const profile = pool.getProfile('model/a');
      expect(profile!.stats.totalCalls).toBe(1);
      expect(profile!.stats.successes).toBe(0);
    });

    it('should persist and reload state', () => {
      pool.recordFeedback('model/a', 'chat', true, 1000, 0.001);

      // Create new pool from same dataDir
      const pool2 = new ModelPoolUnified(dataDir);
      const profile = pool2.getProfile('model/a');
      expect(profile).not.toBeNull();
      expect(profile!.stats.totalCalls).toBe(1);
    });
  });

  describe('query methods', () => {
    beforeEach(() => {
      pool.addProfile(makeProfile({ id: 'platform-a/model-1', platform: 'platform-a', tier: 'premium' }));
      pool.addProfile(makeProfile({ id: 'platform-b/model-2', platform: 'platform-b', tier: 'free' }));
    });

    it('should get all profiles', () => {
      expect(pool.getAllProfiles().length).toBe(2);
    });

    it('should get profile by id', () => {
      const p = pool.getProfile('platform-a/model-1');
      expect(p).not.toBeNull();
      expect(p!.platform).toBe('platform-a');
    });

    it('should filter by platform', () => {
      const results = pool.getProfilesByPlatform('platform-a');
      expect(results.length).toBe(1);
      expect(results[0].platform).toBe('platform-a');
    });

    it('should filter by tier', () => {
      const free = pool.getProfilesByTier('free');
      expect(free.length).toBe(1);
      expect(free[0].tier).toBe('free');
    });

    it('should get Thompson params', () => {
      pool.recordFeedback('model/a', 'chat', true, 1000, 0);
      const params = pool.getThompsonParams();
      expect(Object.keys(params).length).toBeGreaterThan(0);
    });
  });
});
