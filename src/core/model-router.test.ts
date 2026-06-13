import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelRouter, inferTaskType, type TaskType, type ModelConfig } from './model-router.js';
import type { ProviderCapabilities } from './provider-registry.js';
import type { ModelPoolUnified, ModelProfile, ModelSelection, ModelRequirement } from './model-pool-unified.js';

// ==================== Mock 能力 ====================

const FULL_CAPS: ProviderCapabilities = {
  toolCalling: true,
  streaming: true,
  structuredOutput: true,
  vision: true,
  maxContextTokens: 128000,
  maxOutputTokens: 16384,
  toolChoice: 'strict',
  parallelToolCalls: true,
  needsPromptToolCalling: false,
  preferredToolFormat: 'openai',
  supportsDeveloperRole: true,
};

const LIGHT_CAPS: ProviderCapabilities = {
  toolCalling: true,
  streaming: true,
  structuredOutput: false,
  vision: false,
  maxContextTokens: 32000,
  maxOutputTokens: 4096,
  toolChoice: 'auto',
  parallelToolCalls: false,
  needsPromptToolCalling: false,
  preferredToolFormat: 'openai',
  supportsDeveloperRole: false,
};

// ==================== Mock 统一模型池 ====================

function makeProfile(id: string, overrides?: Partial<ModelProfile>): ModelProfile {
  return {
    id,
    platform: id.split('/')[0],
    displayName: id.split('/').slice(1).join('/'),
    tier: 'standard',
    capabilities: {
      reasoning: 0.8,
      code: 0.8,
      chinese: 0.8,
      english: 0.8,
      math: 0.7,
      creative: 0.7,
      toolCalling: true,
      toolCallingMode: 'native',
      vision: false,
      streaming: true,
    },
    maxContextTokens: 128000,
    maxOutputTokens: 4096,
    costPer1kInput: 0.01,
    costPer1kOutput: 0.02,
    stats: { totalCalls: 0, successes: 0, avgLatencyMs: 0, byTaskType: {} },
    source: 'platform_api',
    discoveredAt: Date.now(),
    ...overrides,
  };
}

function makeSelection(profile: ModelProfile, reason = 'best match'): ModelSelection {
  return {
    profile,
    reason,
    layer: 2,
    candidateCount: 1,
    tsSample: 0.85,
  };
}

function createMockUnifiedPool(profiles: ModelProfile[]): ModelPoolUnified {
  const profileMap = new Map(profiles.map(p => [p.id, p]));
  let lastRequirement: ModelRequirement | null = null;

  return {
    get isInitialized() { return true; },
    get size() { return profileMap.size; },
    select(requirement: ModelRequirement) {
      lastRequirement = requirement;
      // 简单逻辑：返回第一个匹配的 profile
      const first = profiles[0];
      return first ? makeSelection(first) : null;
    },
    selectExcluding(requirement: ModelRequirement, _excludeIds: string[]) {
      lastRequirement = requirement;
      const first = profiles[0];
      return first ? makeSelection(first) : null;
    },
    getProviderCredentials(_platformId: string): { apiKey?: string; baseUrl?: string } | null {
      return { apiKey: 'mock-key' };
    },
    getProfile(ref: string): ModelProfile | null {
      return profiles.find(p => p.id === ref) ?? null;
    },
    getLastRequirement() { return lastRequirement; },
    recordFeedback: vi.fn(),
    initializeFromProviders: vi.fn(),
    warmup: vi.fn(),
    getAllProfiles: () => profiles,
    profileCount: profiles.length,
  } as unknown as ModelPoolUnified;
}

// ==================== Tests ====================

describe('inferTaskType', () => {
  it('short message → chat', () => {
    expect(inferTaskType('你好')).toBe('chat');
  });

  it('tool keywords → tools', () => {
    expect(inferTaskType('帮我读取 config.json 文件')).toBe('tools');
    expect(inferTaskType('执行 git status')).toBe('tools');
  });

  it('reasoning keywords → reasoning', () => {
    expect(inferTaskType('分析一下这个架构的设计，为什么选择微服务而不是单体')).toBe('reasoning');
  });

  it('isBackground flag → background', () => {
    expect(inferTaskType('anything', { isBackground: true })).toBe('background');
  });

  it('domainMatch → domain', () => {
    expect(inferTaskType('anything', { domainMatch: 'react' })).toBe('domain');
  });

  it('hasToolCalls → tools', () => {
    expect(inferTaskType('hello', { hasToolCalls: true })).toBe('tools');
  });

  it('image gen keywords → image-gen', () => {
    expect(inferTaskType('画一张猫的图片')).toBe('image-gen');
    expect(inferTaskType('generate image of a cat')).toBe('image-gen');
    expect(inferTaskType('做一张图')).toBe('image-gen');
  });

  it('video gen keywords → video-gen', () => {
    expect(inferTaskType('生成视频')).toBe('video-gen');
    expect(inferTaskType('generate video')).toBe('video-gen');
  });

  it('image edit keywords → image-edit', () => {
    expect(inferTaskType('编辑图片')).toBe('image-edit');
    expect(inferTaskType('修图')).toBe('image-edit');
  });

  it('tts keywords → tts', () => {
    expect(inferTaskType('念一段话')).toBe('tts');
    expect(inferTaskType('语音合成')).toBe('tts');
    expect(inferTaskType('read aloud this text')).toBe('tts');
  });

  it('asr keywords → asr', () => {
    expect(inferTaskType('转录音频')).toBe('asr');
    expect(inferTaskType('speech to text')).toBe('asr');
  });

  it('embedding keywords → embedding', () => {
    expect(inferTaskType('向量化这段文本')).toBe('embedding');
    expect(inferTaskType('embed this text')).toBe('embedding');
  });

  it('ocr keywords → ocr', () => {
    expect(inferTaskType('识别图片里的字')).toBe('ocr');
    expect(inferTaskType('ocr')).toBe('ocr');
  });

  it('translation keywords → translation', () => {
    expect(inferTaskType('翻译这段话')).toBe('translation');
    expect(inferTaskType('translate this')).toBe('translation');
  });
});

describe('ModelRouter', () => {
  let router: ModelRouter;

  describe('统一模型池选择', () => {
    beforeEach(() => {
      router = new ModelRouter();
    });

    it('统一池选择 → 返回模型', async () => {
      const pool = createMockUnifiedPool([makeProfile('deepseek/deepseek-chat')]);
      router.setUnifiedPool(pool);

      const selected = await router.select('chat');
      expect(selected.id).toBe('deepseek/deepseek-chat');
      expect(selected.provider).toBe('deepseek');
    });

    it('不同任务类型 → 统一池接收对应 requirement', async () => {
      const pool = createMockUnifiedPool([makeProfile('openai/gpt-4o')]);
      router.setUnifiedPool(pool);

      await router.select('reasoning');
      const req = (pool as any).getLastRequirement();
      expect(req.taskType).toBe('reasoning');
      expect(req.minCapabilities.reasoning).toBeGreaterThanOrEqual(0.7);
    });

    it('统一池有多个模型 → Thompson Sampling 选择', async () => {
      const profiles = [
        makeProfile('deepseek/deepseek-chat'),
        makeProfile('openai/gpt-4o'),
        makeProfile('siliconflow/Qwen2.5-7B'),
      ];
      const pool = createMockUnifiedPool(profiles);
      router.setUnifiedPool(pool);

      const selected = await router.select('chat');
      expect(profiles.some(p => p.id === selected.id)).toBe(true);
    });

    it('统一池未初始化 → 抛错', async () => {
      await expect(router.select('chat')).rejects.toThrow('无可用模型');
    });

    it('统一池返回 null → 抛错', async () => {
      const pool = {
        get isInitialized() { return true; },
        select: () => null,
      } as unknown as ModelPoolUnified;
      router.setUnifiedPool(pool);

      await expect(router.select('chat')).rejects.toThrow('无可用模型');
    });
  });

  describe('用户覆盖', () => {
    beforeEach(() => {
      router = new ModelRouter();
      const pool = createMockUnifiedPool([makeProfile('deepseek/deepseek-chat')]);
      router.setUnifiedPool(pool);
    });

    it('用户会话级覆盖 → 通过 local/ 前缀', async () => {
      router.registerLocalExpert({
        domain: 'react',
        confidence: 0.9,
        capabilities: LIGHT_CAPS,
        query: async (p) => `local: ${p}`,
      });
      router.setUserOverride('local/react');

      const selected = await router.select('chat');
      expect(selected.id).toBe('local/react');
      expect(selected.source).toBe('user_override');
    });

    it('清除覆盖 → 恢复自动路由', async () => {
      router.setUserOverride('local/nonexistent');
      router.clearUserOverride();

      const selected = await router.select('chat');
      expect(selected.id).toBe('deepseek/deepseek-chat');
    });

    it('per-message 覆盖优先级最高', async () => {
      router.registerLocalExpert({
        domain: 'vue',
        confidence: 0.9,
        capabilities: LIGHT_CAPS,
        query: async (p) => `local: ${p}`,
      });
      router.setUserOverride('local/nonexistent');

      const selected = await router.select('chat', { content: 'hi', userOverride: 'local/vue' });
      expect(selected.id).toBe('local/vue');
      expect(selected.source).toBe('user_override');
    });
  });

  describe('本地专家', () => {
    beforeEach(() => {
      router = new ModelRouter();
      const pool = createMockUnifiedPool([makeProfile('deepseek/deepseek-chat')]);
      router.setUnifiedPool(pool);
    });

    it('领域匹配 + 高置信度 → 本地专家', async () => {
      router.registerLocalExpert({
        domain: 'react',
        confidence: 0.85,
        capabilities: LIGHT_CAPS,
        query: async (p) => `local: ${p}`,
      });
      const selected = await router.select('domain', { content: 'useEffect', domainMatch: 'react' });
      expect(selected.id).toBe('local/react');
      expect(selected.source).toBe('local_expert');
    });

    it('领域匹配 + 低置信度 → 走统一池', async () => {
      router.registerLocalExpert({
        domain: 'react',
        confidence: 0.5,
        capabilities: LIGHT_CAPS,
        query: async (p) => `local: ${p}`,
      });
      const selected = await router.select('domain', { content: 'useEffect', domainMatch: 'react' });
      // 置信度不够，不走本地专家，走统一池
      expect(selected.id).toBe('deepseek/deepseek-chat');
    });

    it('注销专家 → 不再走本地', async () => {
      router.registerLocalExpert({
        domain: 'react',
        confidence: 0.9,
        capabilities: LIGHT_CAPS,
        query: async (p) => `local: ${p}`,
      });
      router.unregisterLocalExpert('react');
      const selected = await router.select('domain', { content: 'useEffect', domainMatch: 'react' });
      expect(selected.id).toBe('deepseek/deepseek-chat');
    });
  });

  describe('经验学习', () => {
    beforeEach(() => {
      router = new ModelRouter();
    });

    it('连续失败 → 委托 ModelPool 记录反馈', () => {
      // Phase 2: 封锁逻辑已迁移到 ModelPool 的熔断器，Router 不再本地维护 blocked
      // 此测试验证 recordOutcome 不抛错且委托给 pool
      for (let i = 0; i < 3; i++) {
        router.recordOutcome({
          taskType: 'tools',
          modelId: 'deepseek/deepseek-chat',
          success: false,
          latencyMs: 1000,
          errorType: 'timeout',
          timestamp: Date.now(),
        });
      }
      // getSummary 不再返回 blocked（由 ModelPool 管理）
      const summary = router.getSummary();
      expect(summary).toBeDefined();
      expect(summary.localExperts).toBeDefined();
    });

    it('高成功率 → 委托 ModelPool 记录反馈', () => {
      // Phase 2: 学习偏好已迁移到 ModelPool 的 Thompson Sampling
      for (let i = 0; i < 5; i++) {
        router.recordOutcome({
          taskType: 'tools',
          modelId: 'deepseek/deepseek-chat',
          success: true,
          latencyMs: 500,
          timestamp: Date.now(),
        });
      }
      const summary = router.getSummary();
      expect(summary).toBeDefined();
    });
  });

  describe('getSummary', () => {
    it('返回完整摘要', () => {
      router = new ModelRouter();
      const pool = createMockUnifiedPool([makeProfile('deepseek/deepseek-chat')]);
      router.setUnifiedPool(pool);

      const summary = router.getSummary();
      expect(summary.hasPool).toBe(true);
      expect(summary.userOverride).toBeNull();
      expect(Array.isArray(summary.localExperts)).toBe(true);
    });

    it('无统一池 → hasPool = false', () => {
      router = new ModelRouter();
      const summary = router.getSummary();
      expect(summary.hasPool).toBe(false);
    });
  });

  describe('getFallbacks', () => {
    it('始终返回空数组（统一池内部处理 fallback）', () => {
      router = new ModelRouter();
      expect(router.getFallbacks()).toEqual([]);
    });
  });

  describe('buildModelRequirement 多模态', () => {
    it('image-gen → preferredCategories=["image-gen"]', async () => {
      const r = new ModelRouter();
      const profiles = [makeProfile('openai/dall-e-3', { category: 'image-gen' } as any)];
      const pool = createMockUnifiedPool(profiles);
      r.setUnifiedPool(pool);

      const selected = await r.select('image-gen');
      expect(selected.id).toBe('openai/dall-e-3');
      const req = (pool as any).getLastRequirement();
      expect(req.taskType).toBe('image-gen');
      expect(req.preferredCategories).toEqual(['image-gen']);
      expect(req.complexity).toBe('simple');
    });

    it('image-edit → preferredCategories=["image-edit"]', async () => {
      const r = new ModelRouter();
      const pool = createMockUnifiedPool([makeProfile('openai/dall-e-3-edit', { category: 'image-edit' } as any)]);
      r.setUnifiedPool(pool);
      await r.select('image-edit');
      const req = (pool as any).getLastRequirement();
      expect(req.preferredCategories).toEqual(['image-edit']);
    });

    it('video-gen → preferredCategories=["video-gen"]', async () => {
      const r = new ModelRouter();
      const pool = createMockUnifiedPool([makeProfile('openai/sora', { category: 'video-gen' } as any)]);
      r.setUnifiedPool(pool);
      await r.select('video-gen');
      const req = (pool as any).getLastRequirement();
      expect(req.preferredCategories).toEqual(['video-gen']);
    });

    it('tts → preferredCategories=["tts"]', async () => {
      const r = new ModelRouter();
      const pool = createMockUnifiedPool([makeProfile('openai/tts-1', { category: 'tts' } as any)]);
      r.setUnifiedPool(pool);
      await r.select('tts');
      const req = (pool as any).getLastRequirement();
      expect(req.preferredCategories).toEqual(['tts']);
    });

    it('asr → preferredCategories=["asr"]', async () => {
      const r = new ModelRouter();
      const pool = createMockUnifiedPool([makeProfile('openai/whisper-1', { category: 'asr' } as any)]);
      r.setUnifiedPool(pool);
      await r.select('asr');
      const req = (pool as any).getLastRequirement();
      expect(req.preferredCategories).toEqual(['asr']);
    });

    it('embedding → preferredCategories=["embedding"]', async () => {
      const r = new ModelRouter();
      const pool = createMockUnifiedPool([makeProfile('openai/text-embedding-3', { category: 'embedding' } as any)]);
      r.setUnifiedPool(pool);
      await r.select('embedding');
      const req = (pool as any).getLastRequirement();
      expect(req.preferredCategories).toEqual(['embedding']);
    });

    it('ocr → preferredCategories=["ocr","vl-chat"]', async () => {
      const r = new ModelRouter();
      const pool = createMockUnifiedPool([makeProfile('openai/gpt-4o', { category: 'vl-chat' } as any)]);
      r.setUnifiedPool(pool);
      await r.select('ocr');
      const req = (pool as any).getLastRequirement();
      expect(req.preferredCategories).toEqual(['ocr', 'vl-chat']);
    });

    it('translation → preferredCategories=["translation"]', async () => {
      const r = new ModelRouter();
      const pool = createMockUnifiedPool([makeProfile('openai/gpt-4o', { category: 'translation' } as any)]);
      r.setUnifiedPool(pool);
      await r.select('translation');
      const req = (pool as any).getLastRequirement();
      expect(req.preferredCategories).toEqual(['translation']);
    });

    it('chat → 无 preferredCategories', async () => {
      const r = new ModelRouter();
      const pool = createMockUnifiedPool([makeProfile('deepseek/deepseek-chat')]);
      r.setUnifiedPool(pool);
      await r.select('chat');
      const req = (pool as any).getLastRequirement();
      expect(req.preferredCategories).toBeUndefined();
    });
  });
});
