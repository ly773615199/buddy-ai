import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHttpApiTools, createFromPreset, PRESET_TOOL_TEMPLATES } from './http-api.js';

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('HttpApiTools', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('createHttpApiTools', () => {
    it('空配置返回空数组', () => {
      expect(createHttpApiTools([])).toEqual([]);
      expect(createHttpApiTools(undefined)).toEqual([]);
    });

    it('从配置生成 ToolDef', () => {
      const tools = createHttpApiTools([{
        id: 'test_tool',
        name: 'Test Tool',
        description: 'A test tool',
        endpoint: 'http://localhost:9999/api',
        method: 'POST',
      }]);

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('test_tool');
      expect(tools[0].description).toBe('A test tool');
      expect(tools[0].permission).toBe('exec_safe');
      expect(tools[0].source).toBe('plugin');
    });

    it('执行 POST 请求', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([['content-type', 'application/json']]),
        json: () => Promise.resolve({ result: 'success', url: 'http://img.png' }),
      });

      const tools = createHttpApiTools([{
        id: 'gen',
        name: 'Generate',
        description: 'Generate something',
        endpoint: 'http://localhost:8188/api/prompt',
      }]);

      const result = await tools[0].execute({ prompt: 'a cat' });
      const parsed = JSON.parse(result);

      expect(parsed.result).toBe('success');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8188/api/prompt',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ prompt: 'a cat' }),
        }),
      );
    });

    it('HTTP 错误返回错误信息', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      const tools = createHttpApiTools([{
        id: 'fail',
        name: 'Fail',
        description: 'Will fail',
        endpoint: 'http://localhost:9999/api',
      }]);

      const result = await tools[0].execute({});
      expect(result).toContain('HTTP 500');
    });

    it('超时返回超时信息', async () => {
      mockFetch.mockImplementation(() => {
        return new Promise((_, reject) => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          setTimeout(() => reject(err), 10);
        });
      });

      const tools = createHttpApiTools([{
        id: 'slow',
        name: 'Slow',
        description: 'Slow tool',
        endpoint: 'http://localhost:9999/api',
        timeoutMs: 50,
      }]);

      const result = await tools[0].execute({});
      expect(result).toContain('超时');
    });

    it('纯文本响应被截断', async () => {
      const longText = 'x'.repeat(6000);
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([['content-type', 'text/plain']]),
        text: () => Promise.resolve(longText),
      });

      const tools = createHttpApiTools([{
        id: 'text',
        name: 'Text',
        description: 'Text tool',
        endpoint: 'http://localhost:9999/api',
      }]);

      const result = await tools[0].execute({});
      expect(result.length).toBeLessThan(6000);
      expect(result).toContain('已截断');
    });
  });

  describe('PRESET_TOOL_TEMPLATES', () => {
    it('包含 4 个预设', () => {
      expect(Object.keys(PRESET_TOOL_TEMPLATES)).toHaveLength(4);
      expect(PRESET_TOOL_TEMPLATES.comfyui_generate).toBeDefined();
      expect(PRESET_TOOL_TEMPLATES.comfyui_video).toBeDefined();
      expect(PRESET_TOOL_TEMPLATES.whisper_transcribe).toBeDefined();
      expect(PRESET_TOOL_TEMPLATES.ollama_generate).toBeDefined();
    });
  });

  describe('createFromPreset', () => {
    it('从预设创建工具配置', () => {
      const tool = createFromPreset('comfyui_generate', 'http://localhost:8188/api/prompt');
      expect(tool.id).toBe('comfyui_generate');
      expect(tool.endpoint).toBe('http://localhost:8188/api/prompt');
      expect(tool.timeoutMs).toBe(300000);
    });

    it('未知预设抛出错误', () => {
      expect(() => createFromPreset('unknown', 'http://localhost:9999')).toThrow('未知');
    });

    it('支持覆盖参数', () => {
      const tool = createFromPreset('whisper_transcribe', 'http://my-whisper:9000/transcribe', {
        id: 'my_whisper',
        name: 'My Whisper',
      });
      expect(tool.id).toBe('my_whisper');
      expect(tool.name).toBe('My Whisper');
      expect(tool.endpoint).toBe('http://my-whisper:9000/transcribe');
    });
  });
});
