/**
 * 多模态工具集测试
 *
 * 覆盖:
 *   - image_generate: 参数校验、成功/失败、文件保存、base64 保存
 *   - speech_recognize: 文件读取、结果解析
 *   - text_embed: 参数校验、向量预览、文件保存
 *   - image_ocr: 文件读取、自定义 prompt
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createMultimodalTools } from './multimodal.js';
import type { LLMAdapter } from '../core/llm.js';
import * as fs from 'fs/promises';

// ==================== Mock LLMAdapter ====================

function createMockLLM(overrides: Record<string, any> = {}): LLMAdapter {
  return {
    executeMultimodal: vi.fn(),
    ...overrides,
  } as unknown as LLMAdapter;
}

// ==================== Mock fs ====================

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

// ==================== Tests ====================

describe('createMultimodalTools', () => {
  let tools: ReturnType<typeof createMultimodalTools>;
  let mockLLM: LLMAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 工具注册 ──

  it('返回 5 个工具', () => {
    mockLLM = createMockLLM();
    tools = createMultimodalTools(mockLLM);
    expect(tools).toHaveLength(5);
    expect(tools.map(t => t.name)).toEqual([
      'image_generate', 'video_generate', 'speech_recognize', 'text_embed', 'image_ocr',
    ]);
  });

  // ── image_generate ──

  describe('image_generate', () => {
    beforeEach(() => {
      mockLLM = createMockLLM();
      tools = createMultimodalTools(mockLLM);
    });

    it('prompt 为空 → 返回错误信息', async () => {
      const tool = tools.find(t => t.name === 'image_generate')!;
      const result = await tool.execute({ prompt: '  ' });
      expect(result).toContain('prompt 不能为空');
    });

    it('成功 → 返回 JSON 包含 urls', async () => {
      (mockLLM.executeMultimodal as any).mockResolvedValue({
        type: 'image',
        urls: ['https://cdn.example.com/img.png'],
      });

      const tool = tools.find(t => t.name === 'image_generate')!;
      const result = JSON.parse(await tool.execute({ prompt: 'a cat' }) as string);
      expect(result.success).toBe(true);
      expect(result.urls).toEqual(['https://cdn.example.com/img.png']);
      expect(result.urlCount).toBe(1);
    });

    it('有 revisedPrompt → 包含在结果中', async () => {
      (mockLLM.executeMultimodal as any).mockResolvedValue({
        type: 'image',
        urls: ['img.png'],
        revisedPrompt: 'A detailed fluffy cat',
      });

      const tool = tools.find(t => t.name === 'image_generate')!;
      const result = JSON.parse(await tool.execute({ prompt: 'cat' }) as string);
      expect(result.revisedPrompt).toBe('A detailed fluffy cat');
    });

    it('executeMultimodal 失败 → 返回错误信息', async () => {
      (mockLLM.executeMultimodal as any).mockRejectedValue(new Error('API timeout'));

      const tool = tools.find(t => t.name === 'image_generate')!;
      const result = await tool.execute({ prompt: 'a cat' });
      expect(result).toContain('ImageGen 失败');
      expect(result).toContain('API timeout');
    });

    it('返回非 image 类型 → 返回错误信息', async () => {
      (mockLLM.executeMultimodal as any).mockResolvedValue({ type: 'text', text: 'oops' });

      const tool = tools.find(t => t.name === 'image_generate')!;
      const result = await tool.execute({ prompt: 'a cat' });
      expect(result).toContain('意外的返回类型');
    });
  });

  // ── speech_recognize ──

  describe('speech_recognize', () => {
    beforeEach(() => {
      mockLLM = createMockLLM();
      tools = createMultimodalTools(mockLLM);
    });

    it('成功 → 返回 text/language/duration', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(Buffer.from('audio-data'));
      (mockLLM.executeMultimodal as any).mockResolvedValue({
        type: 'asr',
        text: '你好世界',
        language: 'zh',
        duration: 2.5,
        segments: [{ start: 0, end: 2, text: '你好' }],
      });

      const tool = tools.find(t => t.name === 'speech_recognize')!;
      const result = JSON.parse(await tool.execute({ audio_path: '/tmp/test.wav' }) as string);
      expect(result.success).toBe(true);
      expect(result.text).toBe('你好世界');
      expect(result.language).toBe('zh');
      expect(result.durationSec).toBe(2.5);
      expect(result.segmentCount).toBe(1);
    });

    it('文件读取失败 → 返回错误信息', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const tool = tools.find(t => t.name === 'speech_recognize')!;
      const result = await tool.execute({ audio_path: '/nonexistent.wav' });
      expect(result).toContain('ASR 失败');
    });

    it('传递 language 参数', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(Buffer.from('audio'));
      (mockLLM.executeMultimodal as any).mockResolvedValue({ type: 'asr', text: 'hi' });

      const tool = tools.find(t => t.name === 'speech_recognize')!;
      await tool.execute({ audio_path: '/tmp/a.wav', language: 'en' });
      expect(mockLLM.executeMultimodal).toHaveBeenCalledWith('asr', expect.any(Buffer), { language: 'en' });
    });
  });

  // ── text_embed ──

  describe('text_embed', () => {
    beforeEach(() => {
      mockLLM = createMockLLM();
      tools = createMultimodalTools(mockLLM);
    });

    it('文本为空 → 返回错误信息', async () => {
      const tool = tools.find(t => t.name === 'text_embed')!;
      const result = await tool.execute({ text: '  ' });
      expect(result).toContain('文本不能为空');
    });

    it('成功 → 返回 dimensions/vectorCount/preview', async () => {
      (mockLLM.executeMultimodal as any).mockResolvedValue({
        type: 'embedding',
        embeddings: [[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]],
        dimensions: 9,
        model: 'bge-large-zh',
      });

      const tool = tools.find(t => t.name === 'text_embed')!;
      const result = JSON.parse(await tool.execute({ text: 'hello' }) as string);
      expect(result.success).toBe(true);
      expect(result.dimensions).toBe(9);
      expect(result.vectorCount).toBe(1);
      expect(result.preview).toContain('0.1000');
      expect(result.model).toBe('bge-large-zh');
    });

    it('指定 output 路径 → 保存文件', async () => {
      (mockLLM.executeMultimodal as any).mockResolvedValue({
        type: 'embedding',
        embeddings: [[0.1, 0.2]],
        dimensions: 2,
        model: 'test-model',
      });

      const tool = tools.find(t => t.name === 'text_embed')!;
      const result = JSON.parse(await tool.execute({ text: 'hello', output: '/tmp/vec.json' }) as string);
      expect(result.savedTo).toBe('/tmp/vec.json');
      expect(fs.mkdir).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  // ── image_ocr ──

  describe('image_ocr', () => {
    beforeEach(() => {
      mockLLM = createMockLLM();
      tools = createMultimodalTools(mockLLM);
    });

    it('成功 → 返回 text', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(Buffer.from('png-data'));
      (mockLLM.executeMultimodal as any).mockResolvedValue({
        type: 'ocr',
        text: '图片中的文字',
      });

      const tool = tools.find(t => t.name === 'image_ocr')!;
      const result = JSON.parse(await tool.execute({ image_path: '/tmp/test.png' }) as string);
      expect(result.success).toBe(true);
      expect(result.text).toBe('图片中的文字');
      expect(result.textLength).toBe(6);
    });

    it('自定义 prompt → 传递给 executeMultimodal', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(Buffer.from('img'));
      (mockLLM.executeMultimodal as any).mockResolvedValue({ type: 'ocr', text: 'result' });

      const tool = tools.find(t => t.name === 'image_ocr')!;
      await tool.execute({ image_path: '/tmp/a.png', prompt: '只提取数字' });
      expect(mockLLM.executeMultimodal).toHaveBeenCalledWith('ocr', expect.any(Buffer), {
        ocrPrompt: '只提取数字',
      });
    });

    it('文件读取失败 → 返回错误信息', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const tool = tools.find(t => t.name === 'image_ocr')!;
      const result = await tool.execute({ image_path: '/nonexistent.png' });
      expect(result).toContain('OCR 失败');
    });
  });
});
