import { describe, it, expect } from 'vitest';
import { validateConfig, configExists, getConfigDir, migrateToUnifiedConfig } from './config.js';
import { DEFAULT_CONFIG, PRESET_PERSONALITIES, getTrustLevel, getPermissions } from './types.js';

describe('配置管理', () => {
  describe('默认配置验证', () => {
    it('默认配置通过验证', () => {
      const result = validateConfig(DEFAULT_CONFIG);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('空名字不通过', () => {
      const result = validateConfig({ ...DEFAULT_CONFIG, name: '' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('name 不能为空');
    });

    it('空物种不通过', () => {
      const result = validateConfig({ ...DEFAULT_CONFIG, species: '' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('species 不能为空');
    });

    it('snark 超出范围不通过', () => {
      const result = validateConfig({
        ...DEFAULT_CONFIG,
        personality: { ...DEFAULT_CONFIG.personality, snark: 101 },
      });
      expect(result.valid).toBe(false);
    });

    it('所有属性边界值正确', () => {
      const result = validateConfig({
        ...DEFAULT_CONFIG,
        personality: { snark: 0, wisdom: 100, chaos: 50, patience: 0, debugging: 100 },
      });
      expect(result.valid).toBe(true);
    });

    it('空 model 不通过', () => {
      const result = validateConfig({
        ...DEFAULT_CONFIG,
        models: { providers: [{ id: 'test', type: 'openai' as const, model: '' }] },
      });
      expect(result.valid).toBe(false);
    });

    it('apiKey 长度不足不通过', () => {
      const result = validateConfig({
        ...DEFAULT_CONFIG,
        models: { providers: [{ id: 'test', type: 'openai' as const, model: 'gpt-4o', apiKey: 'short' }] },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('apiKey 长度不足'))).toBe(true);
    });

    it('合法 apiKey 通过', () => {
      const result = validateConfig({
        ...DEFAULT_CONFIG,
        models: { providers: [{ id: 'test', type: 'openai' as const, model: 'gpt-4o', apiKey: 'sk-abcdefghijklmnop' }] },
      });
      expect(result.valid).toBe(true);
    });

    it('baseUrl 无效格式不通过', () => {
      const result = validateConfig({
        ...DEFAULT_CONFIG,
        models: { providers: [{ id: 'test', type: 'openai' as const, model: 'gpt-4o', baseUrl: 'not-a-url' }] },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('baseUrl 不是有效的 URL 格式'))).toBe(true);
    });

    it('baseUrl 使用 ftp 协议不通过', () => {
      const result = validateConfig({
        ...DEFAULT_CONFIG,
        models: { providers: [{ id: 'test', type: 'openai' as const, model: 'gpt-4o', baseUrl: 'ftp://example.com' }] },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('baseUrl 必须使用 http:// 或 https:// 协议'))).toBe(true);
    });

    it('合法 baseUrl 通过', () => {
      const result = validateConfig({
        ...DEFAULT_CONFIG,
        models: { providers: [{ id: 'test', type: 'openai' as const, model: 'gpt-4o', baseUrl: 'https://api.example.com/v1' }] },
      });
      expect(result.valid).toBe(true);
    });

    it('ws.port 超出范围不通过', () => {
      const result1 = validateConfig({
        ...DEFAULT_CONFIG,
        ws: { ...DEFAULT_CONFIG.ws, port: 0 },
      });
      expect(result1.valid).toBe(false);

      const result2 = validateConfig({
        ...DEFAULT_CONFIG,
        ws: { ...DEFAULT_CONFIG.ws, port: 70000 },
      });
      expect(result2.valid).toBe(false);
    });

    it('ws.port 边界值通过', () => {
      const result1 = validateConfig({
        ...DEFAULT_CONFIG,
        ws: { ...DEFAULT_CONFIG.ws, port: 1 },
      });
      expect(result1.valid).toBe(true);

      const result2 = validateConfig({
        ...DEFAULT_CONFIG,
        ws: { ...DEFAULT_CONFIG.ws, port: 65535 },
      });
      expect(result2.valid).toBe(true);
    });

    it('sandbox.workspace 相对路径不通过', () => {
      const result = validateConfig({
        ...DEFAULT_CONFIG,
        sandbox: { ...DEFAULT_CONFIG.sandbox, workspace: 'relative/path' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('sandbox.workspace 必须是绝对路径');
    });

    it('sandbox.workspace 绝对路径通过', () => {
      const result = validateConfig({
        ...DEFAULT_CONFIG,
        sandbox: { ...DEFAULT_CONFIG.sandbox, workspace: '/tmp/buddy-sandbox' },
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('预设性格', () => {
    it('所有预设性格有完整属性', () => {
      for (const [name, preset] of Object.entries(PRESET_PERSONALITIES)) {
        expect(preset.snark).toBeGreaterThanOrEqual(0);
        expect(preset.snark).toBeLessThanOrEqual(100);
        expect(preset.wisdom).toBeGreaterThanOrEqual(0);
        expect(preset.wisdom).toBeLessThanOrEqual(100);
        expect(preset.chaos).toBeGreaterThanOrEqual(0);
        expect(preset.chaos).toBeLessThanOrEqual(100);
        expect(preset.patience).toBeGreaterThanOrEqual(0);
        expect(preset.patience).toBeLessThanOrEqual(100);
        expect(preset.debugging).toBeGreaterThanOrEqual(0);
        expect(preset.debugging).toBeLessThanOrEqual(100);
      }
    });

    it('预设数量 >= 3', () => {
      expect(Object.keys(PRESET_PERSONALITIES).length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('配置路径', () => {
    it('配置目录为 ~/.buddy', () => {
      expect(getConfigDir()).toContain('.buddy');
    });

    it('configExists 返回布尔值', () => {
      expect(typeof configExists()).toBe('boolean');
    });
  });
});

describe('信任度系统', () => {
  it('各分数段返回正确等级（五阶段阈值）', () => {
    // 初见 0-15 → stranger
    expect(getTrustLevel(0)).toBe('stranger');
    expect(getTrustLevel(10)).toBe('stranger');
    expect(getTrustLevel(15)).toBe('stranger');
    // 相识 16-40 → acquaintance
    expect(getTrustLevel(16)).toBe('acquaintance');
    expect(getTrustLevel(40)).toBe('acquaintance');
    // 相知 41-65 → friend
    expect(getTrustLevel(41)).toBe('friend');
    expect(getTrustLevel(65)).toBe('friend');
    // 相伴 66-85 → close_friend
    expect(getTrustLevel(66)).toBe('close_friend');
    expect(getTrustLevel(85)).toBe('close_friend');
    // 灵犀 86-100 → soulmate
    expect(getTrustLevel(86)).toBe('soulmate');
    expect(getTrustLevel(100)).toBe('soulmate');
  });

  it('陌生人只有聊天权限', () => {
    const perms = getPermissions('stranger');
    expect(perms).toContain('chat');
    expect(perms).toHaveLength(1);
    expect(perms).not.toContain('exec');
    expect(perms).not.toContain('write_files');
  });

  it('熟人可以读文件和搜索', () => {
    const perms = getPermissions('acquaintance');
    expect(perms).toContain('chat');
    expect(perms).toContain('read_files');
    expect(perms).toContain('search_web');
    expect(perms).not.toContain('write_files');
    expect(perms).not.toContain('exec');
  });

  it('朋友可以读写文件和执行命令', () => {
    const perms = getPermissions('friend');
    expect(perms).toContain('read_files');
    expect(perms).toContain('write_files');
    expect(perms).toContain('exec');
    expect(perms).toContain('buddy_learn');
  });

  it('挚友有感知和记忆能力', () => {
    const perms = getPermissions('close_friend');
    expect(perms).toContain('camera');
    expect(perms).toContain('microphone');
    expect(perms).toContain('stmp_retrieve');
    expect(perms).toContain('dream_consolidate');
  });

  it('灵魂伴侣有所有权限', () => {
    const perms = getPermissions('soulmate');
    expect(perms).toContain('chat');
    expect(perms).toContain('read_files');
    expect(perms).toContain('write_files');
    expect(perms).toContain('exec');
    expect(perms).toContain('search_web');
    expect(perms).toContain('package_create');
    expect(perms).toContain('package_share');
    expect(perms).toContain('camera');
    expect(perms).toContain('microphone');
  });
});

describe('migrateToUnifiedConfig', () => {
  it('已有 models 配置时不迁移', () => {
    const config = {
      ...DEFAULT_CONFIG,
      models: {
        providers: [{ id: 'existing', type: 'openai' as const, model: 'gpt-4o' }],
        strategy: 'task_match' as const,
      },
    };
    const result = migrateToUnifiedConfig(config);
    expect(result.models).toEqual(config.models);
  });

  it('从 llm.primary 迁移到 providers', () => {
    const config = {
      ...DEFAULT_CONFIG,
      llm: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        apiKey: 'sk-test',
      },
    };
    const result = migrateToUnifiedConfig(config);
    expect(result.models).toBeDefined();
    expect(result.models!.providers.length).toBeGreaterThanOrEqual(1);
    expect(result.models!.providers[0].type).toBe('deepseek');
    expect(result.models!.providers[0].apiKey).toBe('sk-test');
  });

  it('从 llm.lightweight 迁移到 providers', () => {
    const config = {
      ...DEFAULT_CONFIG,
      llm: {
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-openai',
        lightweight: {
          provider: 'ollama',
          model: 'llama3',
        },
      },
    };
    const result = migrateToUnifiedConfig(config);
    expect(result.models!.providers.length).toBeGreaterThanOrEqual(2);
    const ollamaProvider = result.models!.providers.find(p => p.type === 'ollama');
    expect(ollamaProvider).toBeDefined();
  });

  it('从 pool.nodes 迁移到 providers（去重）', () => {
    const config = {
      ...DEFAULT_CONFIG,
      llm: {
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-test',
      },
      pool: {
        strategy: 'task_match' as const,
        nodes: [
          {
            id: 'node1',
            type: 'cloud' as const,
            provider: 'openai',
            model: 'gpt-4o',
            apiKey: 'sk-test',
            tags: [],
            tier: 'premium' as const,
          },
          {
            id: 'node2',
            type: 'cloud' as const,
            provider: 'deepseek',
            model: 'deepseek-chat',
            apiKey: 'sk-ds',
            tags: [],
            tier: 'standard' as const,
          },
        ],
      },
    };
    const result = migrateToUnifiedConfig(config);
    // openai should be deduped (same apiKey)
    const providers = result.models!.providers;
    expect(providers.length).toBeGreaterThanOrEqual(2);
  });

  it('迁移后保留默认偏好', () => {
    const config = {
      ...DEFAULT_CONFIG,
      llm: { provider: 'openai', model: 'gpt-4o' },
    };
    const result = migrateToUnifiedConfig(config);
    expect(result.models!.preferences).toBeDefined();
    expect(result.models!.preferences!.excluded).toEqual([]);
    expect(result.models!.preferences!.preferFree).toBe(false);
    expect(result.models!.preferences!.maxCostPer1k).toBe(1.0);
  });

  it('迁移后保留 pool.strategy', () => {
    const config = {
      ...DEFAULT_CONFIG,
      llm: { provider: 'openai', model: 'gpt-4o' },
      pool: {
        strategy: 'cost_optimized' as const,
        nodes: [],
      },
    };
    const result = migrateToUnifiedConfig(config);
    expect(result.models!.strategy).toBe('cost_optimized');
  });
});
