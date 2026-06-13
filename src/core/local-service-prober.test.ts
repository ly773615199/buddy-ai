import { describe, it, expect, vi, beforeEach } from 'vitest';
import { probeLocalServices, probeAndAutoRegister } from './local-service-prober.js';

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('LocalServiceProber', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('probeLocalServices', () => {
    it('返回空数组当所有服务不可达', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      const result = await probeLocalServices();
      expect(result).toEqual([]);
    });

    it('探测到 Ollama', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('11434/api/tags')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              models: [
                { name: 'qwen3:8b' },
                { name: 'llama3.1:8b' },
              ],
            }),
          });
        }
        return Promise.reject(new Error('not matched'));
      });

      const result = await probeLocalServices();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('ollama');
      expect(result[0].type).toBe('ollama');
      expect(result[0].models).toEqual(['qwen3:8b', 'llama3.1:8b']);
      expect(result[0].isProvider).toBe(true);
      expect(result[0].isTool).toBe(false);
    });

    it('探测到 LM Studio', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('1234/v1/models')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              data: [{ id: 'qwen3-8b' }, { id: 'deepseek-v3' }],
            }),
          });
        }
        return Promise.reject(new Error('not matched'));
      });

      const result = await probeLocalServices();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('lmstudio');
      expect(result[0].models).toEqual(['qwen3-8b', 'deepseek-v3']);
    });

    it('探测到 ComfyUI', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('8188/system_stats')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              system: { python_version: '3.10' },
            }),
          });
        }
        return Promise.reject(new Error('not matched'));
      });

      const result = await probeLocalServices();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('comfyui');
      expect(result[0].isProvider).toBe(false);
      expect(result[0].isTool).toBe(true);
    });

    it('同时探测到多个服务', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('11434')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ models: [{ name: 'qwen3:8b' }] }),
          });
        }
        if (url.includes('1234')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: [{ id: 'my-model' }] }),
          });
        }
        return Promise.reject(new Error('ECONNREFUSED'));
      });

      const result = await probeLocalServices();
      expect(result).toHaveLength(2);
      expect(result.map(r => r.id).sort()).toEqual(['lmstudio', 'ollama']);
    });

    it('服务返回非200时跳过', async () => {
      mockFetch.mockImplementation(() => {
        return Promise.resolve({ ok: false, status: 404 });
      });

      const result = await probeLocalServices();
      expect(result).toEqual([]);
    });
  });

  describe('probeAndAutoRegister', () => {
    const baseConfig = {
      name: 'TestBuddy',
      species: '猫',
      personality: { snark: 50, wisdom: 50, chaos: 50, patience: 50, debugging: 50 },
      ws: { port: 8765 },
      sandbox: { timeout: 30000, workspace: '/tmp' },
      idle: { enabled: false, blinkMs: 3000, actionMs: 8000 },
      tts: { enabled: false, backend: 'disabled' as const },
      mcp: { servers: [] },
      platforms: {},
    };

    it('无发现时返回原始配置', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      const { config, changes } = await probeAndAutoRegister(baseConfig);
      expect(changes).toEqual([]);
      expect(config).toBe(baseConfig);
    });

    it('发现 Ollama 时自动注册 provider', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('11434')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ models: [{ name: 'qwen3:8b' }] }),
          });
        }
        return Promise.reject(new Error('not matched'));
      });

      const { config, changes } = await probeAndAutoRegister(baseConfig);
      expect(changes).toHaveLength(1);
      expect(changes[0]).toContain('Ollama');
      expect(config.models?.providers).toHaveLength(1);
      expect(config.models?.providers?.[0].type).toBe('ollama');
      expect(config.models?.providers?.[0].model).toBe('qwen3:8b');
    });

    it('已有 Ollama provider 时不重复注册', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('11434')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ models: [{ name: 'qwen3:8b' }] }),
          });
        }
        return Promise.reject(new Error('not matched'));
      });

      const configWithOllama = {
        ...baseConfig,
        models: {
          providers: [{ id: 'ollama', type: 'ollama' as const, model: 'llama3.1:8b', baseUrl: 'http://localhost:11434/v1' }],
          strategy: 'task_match' as const,
        },
      };

      const { config, changes } = await probeAndAutoRegister(configWithOllama);
      expect(changes).toEqual([]);
      expect(config.models?.providers).toHaveLength(1);
      expect(config.models?.providers?.[0].model).toBe('llama3.1:8b'); // 不覆盖
    });

    it('发现 ComfyUI 时注册为 customTool', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('8188')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ system: {} }),
          });
        }
        return Promise.reject(new Error('not matched'));
      });

      const { config, changes } = await probeAndAutoRegister(baseConfig);
      expect(changes).toHaveLength(1);
      expect(changes[0]).toContain('ComfyUI');
      expect(config.customTools).toHaveLength(1);
      expect(config.customTools?.[0].id).toBe('comfyui_generate');
    });

    it('已有 ComfyUI tool 时不重复注册', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('8188')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ system: {} }),
          });
        }
        return Promise.reject(new Error('not matched'));
      });

      const configWithComfyUI = {
        ...baseConfig,
        customTools: [{
          id: 'comfyui_generate',
          name: 'My ComfyUI',
          description: 'Custom',
          endpoint: 'http://localhost:8188/api/prompt',
        }],
      };

      const { config, changes } = await probeAndAutoRegister(configWithComfyUI);
      expect(changes).toEqual([]);
      expect(config.customTools).toHaveLength(1);
      expect(config.customTools?.[0].name).toBe('My ComfyUI'); // 不覆盖
    });
  });
});
