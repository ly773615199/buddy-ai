/**
 * ModelPool 测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelPool } from './model-pool.js';
import type { ModelPoolConfig, PoolNodeConfig } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function makeConfig(nodes: PoolNodeConfig[]): ModelPoolConfig {
  return { strategy: 'task_match', nodes };
}

function makeNode(overrides: Partial<PoolNodeConfig> = {}): PoolNodeConfig {
  return {
    id: 'test-node',
    type: 'cloud',
    provider: 'test',
    model: 'test-model',
    tags: ['chat'],
    tier: 'standard',
    costPer1kInput: 0.01,
    costPer1kOutput: 0.02,
    ...overrides,
  };
}

describe('ModelPool', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-test-'));
  });

  // ==================== 节点注册 / 查询 ====================

  it('should register and retrieve nodes', () => {
    const pool = new ModelPool(makeConfig([
      makeNode({ id: 'node-a' }),
      makeNode({ id: 'node-b', tier: 'premium' }),
    ]), tmpDir);

    expect(pool.getNode('node-a')).toBeDefined();
    expect(pool.getNode('node-b')!.tier).toBe('premium');
    expect(pool.getNode('nonexistent')).toBeUndefined();
  });

  it('should filter by tier', () => {
    const pool = new ModelPool(makeConfig([
      makeNode({ id: 'std', tier: 'standard' }),
      makeNode({ id: 'prem', tier: 'premium' }),
      makeNode({ id: 'bud', tier: 'budget' }),
    ]), tmpDir);

    expect(pool.getNodesByTier('premium')).toHaveLength(1);
    expect(pool.getNodesByTier('budget')).toHaveLength(1);
  });

  it('should filter by tag', () => {
    const pool = new ModelPool(makeConfig([
      makeNode({ id: 'a', tags: ['code', 'reasoning'] }),
      makeNode({ id: 'b', tags: ['chat'] }),
    ]), tmpDir);

    expect(pool.getNodesByTag('code')).toHaveLength(1);
    expect(pool.getNodesByTag('chat')).toHaveLength(1);
  });

  it('should filter by type', () => {
    const pool = new ModelPool(makeConfig([
      makeNode({ id: 'cloud', type: 'cloud' }),
      makeNode({ id: 'expert', type: 'local_expert', domain: 'react' }),
    ]), tmpDir);

    expect(pool.getCloudNodes()).toHaveLength(1);
    expect(pool.getLocalExperts()).toHaveLength(1);
  });

  // ==================== 动态管理 ====================

  it('should register nodes dynamically', () => {
    const pool = new ModelPool(makeConfig([]), tmpDir);
    expect(pool.getAllNodes()).toHaveLength(0);

    pool.registerNode(makeNode({ id: 'dynamic' }));
    expect(pool.getAllNodes()).toHaveLength(1);
    expect(pool.getNode('dynamic')).toBeDefined();
  });

  it('should unregister nodes', () => {
    const pool = new ModelPool(makeConfig([makeNode({ id: 'removable' })]), tmpDir);
    expect(pool.getAllNodes()).toHaveLength(1);

    pool.unregisterNode('removable');
    expect(pool.getAllNodes()).toHaveLength(0);
  });

  // ==================== 熔断 / 恢复 ====================

  it('should circuit-break after consecutive failures', () => {
    const pool = new ModelPool(makeConfig([makeNode({ id: 'fragile' })]), tmpDir);

    // 3 次连续失败触发熔断
    pool.recordFailure('fragile', 100);
    pool.recordFailure('fragile', 100);
    expect(pool.getAvailableNodes()).toHaveLength(1); // 还没熔断

    pool.recordFailure('fragile', 100);
    expect(pool.getAvailableNodes()).toHaveLength(0); // 已熔断
  });

  it('should recover from circuit break on success', () => {
    const pool = new ModelPool(makeConfig([makeNode({ id: 'recoverable' })]), tmpDir);

    // 触发熔断
    pool.recordFailure('recoverable', 100);
    pool.recordFailure('recoverable', 100);
    pool.recordFailure('recoverable', 100);
    expect(pool.getAvailableNodes()).toHaveLength(0);

    // 成功恢复
    pool.recordSuccess('recoverable', 50);
    expect(pool.getAvailableNodes()).toHaveLength(1);
  });

  it('should reset consecutive failures on success', () => {
    const pool = new ModelPool(makeConfig([makeNode({ id: 'node' })]), tmpDir);

    pool.recordFailure('node', 100);
    pool.recordFailure('node', 100);
    pool.recordSuccess('node', 50); // 重置连续失败计数
    pool.recordFailure('node', 100);
    pool.recordFailure('node', 100);
    // 只有 2 次连续失败，不触发熔断
    expect(pool.getAvailableNodes()).toHaveLength(1);
  });

  // ==================== 统计 ====================

  it('should track stats with EWMA', () => {
    const pool = new ModelPool(makeConfig([makeNode({ id: 'tracked' })]), tmpDir);

    pool.recordSuccess('tracked', 100);
    pool.recordSuccess('tracked', 200);

    const stats = pool.getStats('tracked');
    expect(stats).toBeDefined();
    expect(stats!.totalCalls).toBe(2);
    expect(stats!.consecutiveFailures).toBe(0);
    expect(stats!.avgLatencyMs).toBeGreaterThan(0);
  });

  it('should track stats by task type', () => {
    const pool = new ModelPool(makeConfig([makeNode({ id: 'multi' })]), tmpDir);

    pool.recordSuccess('multi', 100, 'chat');
    pool.recordSuccess('multi', 200, 'reasoning');
    pool.recordFailure('multi', 150, 'chat');

    const chatStats = pool.getTaskTypeStats('multi', 'chat');
    expect(chatStats).toBeDefined();
    expect(chatStats!.attempts).toBe(2);
    expect(chatStats!.successes).toBe(1);

    const reasonStats = pool.getTaskTypeStats('multi', 'reasoning');
    expect(reasonStats).toBeDefined();
    expect(reasonStats!.attempts).toBe(1);
    expect(reasonStats!.successes).toBe(1);
  });

  // ==================== 级联升级 ====================

  it('should select upgraded node for cascade', () => {
    const pool = new ModelPool(makeConfig([
      makeNode({ id: 'budget', tier: 'budget' }),
      makeNode({ id: 'standard', tier: 'standard' }),
      makeNode({ id: 'premium', tier: 'premium' }),
    ]), tmpDir);

    const budgetNode = pool.getNode('budget')!;
    const upgraded = pool.selectUpgraded(budgetNode);
    expect(upgraded).toBeDefined();
    expect(['standard', 'premium']).toContain(upgraded!.tier);
  });

  it('should return null when no upgrade available', () => {
    const pool = new ModelPool(makeConfig([
      makeNode({ id: 'top', tier: 'premium' }),
    ]), tmpDir);

    const topNode = pool.getNode('top')!;
    const upgraded = pool.selectUpgraded(topNode);
    expect(upgraded).toBeNull();
  });

  // ==================== 持久化 ====================

  it('should save and load stats', () => {
    const pool1 = new ModelPool(makeConfig([makeNode({ id: 'persisted' })]), tmpDir);
    pool1.recordSuccess('persisted', 150);
    pool1.saveStats();

    const pool2 = new ModelPool(makeConfig([makeNode({ id: 'persisted' })]), tmpDir);
    const stats = pool2.getStats('persisted');
    expect(stats).toBeDefined();
    expect(stats!.totalCalls).toBe(1);
  });

  // ==================== 摘要 ====================

  it('should return summary', () => {
    const pool = new ModelPool(makeConfig([
      makeNode({ id: 'a', tier: 'standard', type: 'cloud' }),
      makeNode({ id: 'b', tier: 'premium', type: 'cloud' }),
    ]), tmpDir);

    const summary = pool.getSummary();
    expect(summary.total).toBe(2);
    expect(summary.available).toBe(2);
    expect(summary.circuitBroken).toHaveLength(0);
    expect(summary.byType.cloud).toBe(2);
  });

  // ==================== 统一池：toggle / setActive ====================

  describe('unified pool: toggle & setActive', () => {
    function makeProfile(overrides: Record<string, unknown> = {}) {
      return {
        id: 'test/model-1',
        platform: 'test',
        displayName: 'Test Model',
        tier: 'standard' as const,
        capabilities: {
          reasoning: 0.8, code: 0.7, chinese: 0.6, english: 0.8,
          math: 0.7, creative: 0.5, toolCalling: true, toolCallingMode: 'native' as const,
          vision: false, streaming: true,
        },
        maxContextTokens: 32000,
        maxOutputTokens: 4096,
        costPer1kInput: 0.01,
        costPer1kOutput: 0.02,
        stats: { totalCalls: 0, successes: 0, avgLatencyMs: 0, byTaskType: {} },
        source: 'user_added' as const,
        discoveredAt: Date.now(),
        ...overrides,
      };
    }

    it('should toggle active state', () => {
      const pool = new ModelPool(null, tmpDir);
      pool.addProfile(makeProfile({ id: 'model-a' }));

      // 默认 active (undefined = true)
      expect(pool.toggleActive('model-a')).toBe(false); // toggles to false
      expect(pool.getProfile('model-a')!.active).toBe(false);

      expect(pool.toggleActive('model-a')).toBe(true); // toggles back to true
      expect(pool.getProfile('model-a')!.active).toBe(true);
    });

    it('should set active state directly', () => {
      const pool = new ModelPool(null, tmpDir);
      pool.addProfile(makeProfile({ id: 'model-a' }));

      pool.setActive('model-a', false);
      expect(pool.getProfile('model-a')!.active).toBe(false);

      pool.setActive('model-a', true);
      expect(pool.getProfile('model-a')!.active).toBe(true);
    });

    it('should return false for nonexistent model', () => {
      const pool = new ModelPool(null, tmpDir);
      expect(pool.toggleActive('nonexistent')).toBe(false);
      expect(pool.setActive('nonexistent', true)).toBe(false);
    });

    it('should batch set active by platform', () => {
      const pool = new ModelPool(null, tmpDir);
      pool.addProfile(makeProfile({ id: 'sf/model-a', platform: 'sf' }));
      pool.addProfile(makeProfile({ id: 'sf/model-b', platform: 'sf' }));
      pool.addProfile(makeProfile({ id: 'ds/model-c', platform: 'ds' }));

      const changed = pool.setActiveByPlatform('sf', false);
      expect(changed).toBe(2);
      expect(pool.getProfile('sf/model-a')!.active).toBe(false);
      expect(pool.getProfile('sf/model-b')!.active).toBe(false);
      expect(pool.getProfile('ds/model-c')!.active).toBeUndefined(); // untouched
    });

    it('should set all active', () => {
      const pool = new ModelPool(null, tmpDir);
      pool.addProfile(makeProfile({ id: 'a', active: false }));
      pool.addProfile(makeProfile({ id: 'b', active: false }));
      pool.addProfile(makeProfile({ id: 'c' }));

      const changed = pool.setAllActive();
      expect(changed).toBe(2);
      expect(pool.getProfile('a')!.active).toBe(true);
      expect(pool.getProfile('b')!.active).toBe(true);
    });

    it('should filter inactive models in layer0StaticFilter via select', () => {
      const pool = new ModelPool(null, tmpDir);
      pool.addProfile(makeProfile({ id: 'active-model' }));
      pool.addProfile(makeProfile({ id: 'inactive-model', active: false }));

      const result = pool.select({
        taskType: 'chat',
        minCapabilities: {},
        requiredFeatures: [],
        complexity: 'simple',
      });
      expect(result).not.toBeNull();
      expect(result!.profile.id).toBe('active-model');
    });
  });

  // ==================== 统一池：去重 ====================

  describe('unified pool: dedupeAndOptimize', () => {
    function makeProfile(overrides: Record<string, unknown> = {}) {
      return {
        id: 'test/model-1',
        platform: 'test',
        displayName: 'Test Model',
        tier: 'standard' as const,
        capabilities: {
          reasoning: 0.8, code: 0.7, chinese: 0.6, english: 0.8,
          math: 0.7, creative: 0.5, toolCalling: true, toolCallingMode: 'native' as const,
          vision: false, streaming: true,
        },
        maxContextTokens: 32000,
        maxOutputTokens: 4096,
        costPer1kInput: 0.01,
        costPer1kOutput: 0.02,
        stats: { totalCalls: 0, successes: 0, avgLatencyMs: 0, byTaskType: {} },
        source: 'user_added' as const,
        discoveredAt: Date.now(),
        ...overrides,
      };
    }

    it('should dedupe same-name models and keep best as active', () => {
      const pool = new ModelPool(null, tmpDir);
      pool.addProfile(makeProfile({ id: 'sf/Qwen2.5-7B-Instruct', platform: 'sf', displayName: 'Qwen2.5-7B-Instruct', costPer1kInput: 0.005 }));
      pool.addProfile(makeProfile({ id: 'sf/Qwen2.5-7B-Instruct-Pro', platform: 'sf', displayName: 'Qwen2.5-7B-Instruct', costPer1kInput: 0.01 }));
      pool.addProfile(makeProfile({ id: 'sf/Qwen2.5-7B-Instruct-Lora', platform: 'sf', displayName: 'Qwen2.5-7B-Instruct', costPer1kInput: 0.002 }));

      pool.dedupeAndOptimize();

      // 最低成本的应该被选为 winner (active=true)
      const winner = pool.getProfile('sf/Qwen2.5-7B-Instruct-Lora');
      expect(winner!.active).toBe(true);
      expect(winner!.variantCount).toBe(3);

      // 其余应该 active=false
      expect(pool.getProfile('sf/Qwen2.5-7B-Instruct')!.active).toBe(false);
      expect(pool.getProfile('sf/Qwen2.5-7B-Instruct-Pro')!.active).toBe(false);
    });

    it('should not dedupe different models', () => {
      const pool = new ModelPool(null, tmpDir);
      pool.addProfile(makeProfile({ id: 'a/Model-A', displayName: 'Model-A' }));
      pool.addProfile(makeProfile({ id: 'b/Model-B', displayName: 'Model-B' }));

      pool.dedupeAndOptimize();

      expect(pool.getProfile('a/Model-A')!.active).toBeUndefined(); // untouched
      expect(pool.getProfile('b/Model-B')!.active).toBeUndefined();
    });
  });

  // ==================== 多模态：preferredCategories 过滤 ====================

  describe('multimodal: preferredCategories filtering', () => {
    function makeProfile(overrides: Record<string, unknown> = {}) {
      return {
        id: 'test/model-1',
        platform: 'test',
        displayName: 'Test Model',
        tier: 'standard' as const,
        capabilities: {
          reasoning: 0.8, code: 0.7, chinese: 0.6, english: 0.8,
          math: 0.7, creative: 0.5, toolCalling: true, toolCallingMode: 'native' as const,
          vision: false, streaming: true,
        },
        maxContextTokens: 32000,
        maxOutputTokens: 4096,
        costPer1kInput: 0.01,
        costPer1kOutput: 0.02,
        stats: { totalCalls: 0, successes: 0, avgLatencyMs: 0, byTaskType: {} },
        source: 'user_added' as const,
        discoveredAt: Date.now(),
        ...overrides,
      };
    }

    it('preferredCategories=[image-gen] → 只选中 image-gen 类别模型', () => {
      const pool = new ModelPool(null, tmpDir);
      pool.addProfile(makeProfile({ id: 'chat-model', category: 'chat' }));
      pool.addProfile(makeProfile({ id: 'img-model', category: 'image-gen' }));
      pool.addProfile(makeProfile({ id: 'embed-model', category: 'embedding' }));

      const result = pool.select({
        taskType: 'image-gen',
        minCapabilities: {},
        requiredFeatures: [],
        complexity: 'simple',
        preferredCategories: ['image-gen'],
      });
      expect(result).not.toBeNull();
      expect(result!.profile.id).toBe('img-model');
    });

    it('preferredCategories=[ocr, vl-chat] → 匹配任一类别', () => {
      const pool = new ModelPool(null, tmpDir);
      pool.addProfile(makeProfile({ id: 'chat-model', category: 'chat' }));
      pool.addProfile(makeProfile({ id: 'vl-model', category: 'vl-chat' }));

      const result = pool.select({
        taskType: 'ocr',
        minCapabilities: {},
        requiredFeatures: [],
        complexity: 'simple',
        preferredCategories: ['ocr', 'vl-chat'],
      });
      expect(result).not.toBeNull();
      expect(result!.profile.id).toBe('vl-model');
    });

    it('excludedCategories=[embedding] → 排除 embedding 模型', () => {
      const pool = new ModelPool(null, tmpDir);
      pool.addProfile(makeProfile({ id: 'chat-model', category: 'chat' }));
      pool.addProfile(makeProfile({ id: 'embed-model', category: 'embedding' }));

      const result = pool.select({
        taskType: 'chat',
        minCapabilities: {},
        requiredFeatures: [],
        complexity: 'simple',
        excludedCategories: ['embedding'],
      });
      expect(result).not.toBeNull();
      expect(result!.profile.id).toBe('chat-model');
    });

    it('preferredCategories 无匹配 → 降级选择（fallback 到全量候选）', () => {
      const pool = new ModelPool(null, tmpDir);
      pool.addProfile(makeProfile({ id: 'chat-model', category: 'chat' }));

      // layer1 过滤无匹配 → 降级到 layer0 全量候选 → 仍能选出模型
      const result = pool.select({
        taskType: 'image-gen',
        minCapabilities: {},
        requiredFeatures: [],
        complexity: 'simple',
        preferredCategories: ['image-gen'],
      });
      // 降级机制：返回 chat-model 而非 null
      expect(result).not.toBeNull();
      expect(result!.profile.id).toBe('chat-model');
    });

    it('无 preferredCategories → 不过滤类别，正常选择', () => {
      const pool = new ModelPool(null, tmpDir);
      pool.addProfile(makeProfile({ id: 'embed-model', category: 'embedding' }));

      const result = pool.select({
        taskType: 'chat',
        minCapabilities: {},
        requiredFeatures: [],
        complexity: 'simple',
      });
      expect(result).not.toBeNull();
      expect(result!.profile.id).toBe('embed-model');
    });

    it('category 为 undefined → 当作 unknown，preferredCategories 不匹配但 fallback 选中', () => {
      const pool = new ModelPool(null, tmpDir);
      pool.addProfile(makeProfile({ id: 'no-cat-model' })); // category undefined

      // category undefined → unknown → 不在 preferredCategories 中 → fallback 选中
      const result = pool.select({
        taskType: 'image-gen',
        minCapabilities: {},
        requiredFeatures: [],
        complexity: 'simple',
        preferredCategories: ['image-gen'],
      });
      expect(result).not.toBeNull();
      expect(result!.profile.id).toBe('no-cat-model');
    });
  });

  // ==================== 路由准确性：derived 能力过滤 ====================

  describe('routing accuracy: derived capability filtering', () => {
    function makeProfile(overrides: Record<string, unknown> = {}) {
      return {
        id: 'test/model-1',
        platform: 'test',
        displayName: 'Test Model',
        tier: 'standard' as const,
        capabilities: {
          reasoning: 0.8, code: 0.7, chinese: 0.6, english: 0.8,
          math: 0.7, creative: 0.5, toolCalling: true, toolCallingMode: 'native' as const,
          vision: false, streaming: true,
        },
        maxContextTokens: 32000,
        maxOutputTokens: 4096,
        costPer1kInput: 0.01,
        costPer1kOutput: 0.02,
        stats: { totalCalls: 0, successes: 0, avgLatencyMs: 0, byTaskType: {} },
        source: 'user_added' as const,
        discoveredAt: Date.now(),
        ...overrides,
      };
    }

    /** 创建一个完整的混合模型池：chat + embedding + image-gen + tts */
    function createMixedPool() {
      const pool = new ModelPool(null, tmpDir);

      // 聊天模型
      pool.addProfile(makeProfile({
        id: 'deepseek/deepseek-chat',
        displayName: 'DeepSeek Chat',
        category: 'chat',
        pipelineTag: 'text-generation',
        derived: { chatCapable: true, toolCapable: true, embedCapable: false, visionCapable: false },
      }));

      // 另一个聊天模型（带视觉）
      pool.addProfile(makeProfile({
        id: 'deepseek/deepseek-v3',
        displayName: 'DeepSeek V3',
        category: 'vl-chat',
        pipelineTag: 'image-text-to-text',
        derived: { chatCapable: true, toolCapable: true, embedCapable: false, visionCapable: true },
        capabilities: {
          reasoning: 0.9, code: 0.8, chinese: 0.8, english: 0.9,
          math: 0.8, creative: 0.6, toolCalling: true, toolCallingMode: 'native' as const,
          vision: true, streaming: true,
        },
      }));

      // Embedding 模型（streaming=true 保证能通过 layer0，实际使用时走非流式 API）
      pool.addProfile(makeProfile({
        id: 'BAAI/bge-m3',
        displayName: 'BGE M3',
        category: 'embedding',
        pipelineTag: 'feature-extraction',
        derived: { chatCapable: false, toolCapable: false, embedCapable: true, visionCapable: false },
        capabilities: {
          reasoning: 0, code: 0, chinese: 0.5, english: 0.5,
          math: 0, creative: 0, toolCalling: false, toolCallingMode: 'none' as const,
          vision: false, streaming: true,
        },
      }));

      // Reranker 模型
      pool.addProfile(makeProfile({
        id: 'BAAI/bge-reranker-v2-m3',
        displayName: 'BGE Reranker',
        category: 'reranker',
        pipelineTag: 'text-classification',
        derived: { chatCapable: false, toolCapable: false, embedCapable: false, visionCapable: false },
        capabilities: {
          reasoning: 0, code: 0, chinese: 0.5, english: 0.5,
          math: 0, creative: 0, toolCalling: false, toolCallingMode: 'none' as const,
          vision: false, streaming: true,
        },
      }));

      // 图片生成模型
      pool.addProfile(makeProfile({
        id: 'black-forest-labs/FLUX.1-schnell',
        displayName: 'FLUX.1',
        category: 'image-gen',
        pipelineTag: 'text-to-image',
        derived: { chatCapable: false, toolCapable: false, embedCapable: false, visionCapable: false },
        capabilities: {
          reasoning: 0, code: 0, chinese: 0, english: 0,
          math: 0, creative: 0.9, toolCalling: false, toolCallingMode: 'none' as const,
          vision: false, streaming: true,
        },
      }));

      // TTS 模型
      pool.addProfile(makeProfile({
        id: 'fishaudio/fish-speech-1.5',
        displayName: 'Fish Speech',
        category: 'tts',
        pipelineTag: 'text-to-speech',
        derived: { chatCapable: false, toolCapable: false, embedCapable: false, visionCapable: false },
        capabilities: {
          reasoning: 0, code: 0, chinese: 0.5, english: 0.3,
          math: 0, creative: 0, toolCalling: false, toolCallingMode: 'none' as const,
          vision: false, streaming: true,
        },
      }));

      return pool;
    }

    it('chat 任务 → 选中 chat 模型，不选 embedding/reranker/image-gen/tts', () => {
      const pool = createMixedPool();
      const result = pool.select({
        taskType: 'chat',
        minCapabilities: {},
        requiredFeatures: [],
        complexity: 'simple',
      });
      expect(result).not.toBeNull();
      expect(['deepseek/deepseek-chat', 'deepseek/deepseek-v3']).toContain(result!.profile.id);
      // 绝对不能选到 embedding/reranker
      expect(result!.profile.id).not.toBe('BAAI/bge-m3');
      expect(result!.profile.id).not.toBe('BAAI/bge-reranker-v2-m3');
    });

    it('embedding 任务 → 选中 embedding 模型，不选 chat', () => {
      const pool = createMixedPool();
      const result = pool.select({
        taskType: 'embedding',
        minCapabilities: {},
        requiredFeatures: [],
        complexity: 'simple',
        preferredCategories: ['embedding'],
      });
      expect(result).not.toBeNull();
      expect(result!.profile.id).toBe('BAAI/bge-m3');
    });

    it('image-gen 任务 → 选中 image-gen 模型，不选 chat', () => {
      const pool = createMixedPool();
      const result = pool.select({
        taskType: 'image-gen',
        minCapabilities: {},
        requiredFeatures: [],
        complexity: 'simple',
        preferredCategories: ['image-gen'],
      });
      expect(result).not.toBeNull();
      expect(result!.profile.id).toBe('black-forest-labs/FLUX.1-schnell');
    });

    it('tts 任务 → 选中 tts 模型', () => {
      const pool = createMixedPool();
      const result = pool.select({
        taskType: 'tts',
        minCapabilities: {},
        requiredFeatures: [],
        complexity: 'simple',
        preferredCategories: ['tts'],
      });
      expect(result).not.toBeNull();
      expect(result!.profile.id).toBe('fishaudio/fish-speech-1.5');
    });

    it('tools 任务 → 选中 toolCapable 的 chat 模型', () => {
      const pool = createMixedPool();
      const result = pool.select({
        taskType: 'tools',
        minCapabilities: { code: 0.6 },
        requiredFeatures: ['toolCalling'],
        complexity: 'medium',
      });
      expect(result).not.toBeNull();
      // 必须是 toolCapable 的模型
      expect(['deepseek/deepseek-chat', 'deepseek/deepseek-v3']).toContain(result!.profile.id);
      // 不能是 embedding/reranker（它们 toolCalling=false）
      expect(result!.profile.id).not.toBe('BAAI/bge-m3');
      expect(result!.profile.id).not.toBe('BAAI/bge-reranker-v2-m3');
    });

    it('只有 embedding 模型时，chat 任务 → layer0 降级（不传 taskType）仍能选中', () => {
      const pool = new ModelPool(null, tmpDir);
      pool.addProfile(makeProfile({
        id: 'BAAI/bge-m3',
        category: 'embedding',
        pipelineTag: 'feature-extraction',
        derived: { chatCapable: false, toolCapable: false, embedCapable: true, visionCapable: false },
        capabilities: {
          reasoning: 0, code: 0, chinese: 0.5, english: 0.5,
          math: 0, creative: 0, toolCalling: false, toolCallingMode: 'none' as const,
          vision: false, streaming: true,
        },
      }));

      // chat 任务，只有 embedding 模型 → layer0 过滤后为空 → 降级到不传 taskType 的 layer0
      const result = pool.select({
        taskType: 'chat',
        minCapabilities: {},
        requiredFeatures: [],
        complexity: 'simple',
      });
      // 降级后应该能选到（虽然不是理想模型，但比报错好）
      expect(result).not.toBeNull();
      expect(result!.profile.id).toBe('BAAI/bge-m3');
    });

    it('queryCapableModels(chat) → 只返回 chatCapable 模型', () => {
      const pool = createMixedPool();
      const capable = (pool as any).queryCapableModels('chat') as Array<{ id: string }>;
      const ids = capable.map((m) => m.id);
      expect(ids).toContain('deepseek/deepseek-chat');
      expect(ids).toContain('deepseek/deepseek-v3');
      expect(ids).not.toContain('BAAI/bge-m3');
      expect(ids).not.toContain('BAAI/bge-reranker-v2-m3');
      expect(ids).not.toContain('black-forest-labs/FLUX.1-schnell');
      expect(ids).not.toContain('fishaudio/fish-speech-1.5');
    });

    it('queryCapableModels(embedding) → 只返回 embedCapable 模型', () => {
      const pool = createMixedPool();
      const capable = (pool as any).queryCapableModels('embedding') as Array<{ id: string }>;
      const ids = capable.map((m) => m.id);
      expect(ids).toContain('BAAI/bge-m3');
      expect(ids).not.toContain('deepseek/deepseek-chat');
    });

    it('getModelAffinity → 新模型置信度低，老模型置信度高', () => {
      const pool = createMixedPool();
      // 新模型：0 次调用
      const newbie = pool.getModelAffinity('deepseek/deepseek-chat', 'chat');
      expect(newbie.totalCalls).toBe(0);
      expect(newbie.confidence).toBe(0);

      // 模拟 10 次调用（用 recordFeedback 更新 profile 统计）
      for (let i = 0; i < 10; i++) {
        pool.recordFeedback('deepseek/deepseek-chat', 'chat' as any, true, 100, 0.01, 0.9);
      }
      const veteran = pool.getModelAffinity('deepseek/deepseek-chat', 'chat');
      expect(veteran.totalCalls).toBe(10);
      expect(veteran.confidence).toBe(1);
      expect(veteran.taskSuccessRate).toBe(1);
    });
  });
});
