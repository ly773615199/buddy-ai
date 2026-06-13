/**
 * MultimodalExecutor 测试
 *
 * 覆盖:
 *   - image-gen: 请求构造、SiliconFlow/OpenAI 格式解析、超时、错误处理
 *   - asr: FormData 构造、响应解析
 *   - embedding: 请求构造、向量解析
 *   - ocr: VL 模型 chat 路径、base64 编码
 *   - 边界: tts 拒绝、video-gen 拒绝、未知类型拒绝、缺少 apiKey
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MultimodalExecutor } from './multimodal-executor.js';
import type { ModelConfig } from './model-router.js';

// ==================== Mock fetch ====================

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeModelConfig(overrides?: Partial<ModelConfig>): ModelConfig {
  return {
    id: 'siliconflow/stable-diffusion-xl',
    model: 'stabilityai/stable-diffusion-xl-base-1.0',
    provider: 'siliconflow',
    source: 'default',
    apiKey: 'test-api-key',
    baseUrl: 'https://api.siliconflow.cn/v1',
    ...overrides,
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response;
}

function errorResponse(status: number, message: string): Response {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error('not json')),
    text: () => Promise.resolve(message),
  } as unknown as Response;
}

// ==================== Tests ====================

describe('MultimodalExecutor', () => {
  let executor: MultimodalExecutor;

  beforeEach(() => {
    executor = new MultimodalExecutor();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 参数校验 ──

  describe('参数校验', () => {
    it('缺少 apiKey → 抛错', async () => {
      const config = makeModelConfig({ apiKey: undefined });
      await expect(executor.execute('image-gen', 'a cat', config))
        .rejects.toThrow('缺少 apiKey');
    });

    it('tts → 抛错（应使用 TTSManager）', async () => {
      const config = makeModelConfig();
      await expect(executor.execute('tts', 'hello', config))
        .rejects.toThrow('TTSManager');
    });

    it('video-gen → 已支持', async () => {
      const config = makeModelConfig();
      mockFetch.mockResolvedValueOnce(jsonResponse({
        output: { video_url: 'https://cdn.example.com/video.mp4' },
      }));
      const result = await executor.execute('video-gen', 'a video', config);
      expect(result.type).toBe('video');
    });

    it('未知 taskType → 抛错', async () => {
      const config = makeModelConfig();
      await expect(executor.execute('unknown-type' as any, 'input', config))
        .rejects.toThrow('不支持的任务类型');
    });
  });

  // ── Image Gen ──

  describe('executeImageGen', () => {
    it('SiliconFlow 格式 → 正确解析 images 数组', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        images: [{ url: 'https://cdn.example.com/img1.png' }, { url: 'https://cdn.example.com/img2.png' }],
      }));

      const result = await executor.execute('image-gen', 'a cute cat', makeModelConfig());
      expect(result.type).toBe('image');
      expect((result as any).urls).toEqual([
        'https://cdn.example.com/img1.png',
        'https://cdn.example.com/img2.png',
      ]);
    });

    it('OpenAI 格式 → 正确解析 data 数组', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        data: [{ url: 'https://cdn.example.com/openai-img.png' }],
        revised_prompt: 'A cute fluffy cat',
      }));

      const result = await executor.execute('image-gen', 'a cat', makeModelConfig());
      expect(result.type).toBe('image');
      expect((result as any).urls).toEqual(['https://cdn.example.com/openai-img.png']);
      expect((result as any).revisedPrompt).toBe('A cute fluffy cat');
    });

    it('base64 返回 → 解析 b64Images', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        data: [{ b64_json: 'iVBORw0KGgo=' }],
      }));

      const result = await executor.execute('image-gen', 'a cat', makeModelConfig());
      expect((result as any).b64Images).toEqual(['iVBORw0KGgo=']);
    });

    it('请求体包含正确的 model/prompt/image_size', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ images: [] }));

      await executor.execute('image-gen', 'a dog', makeModelConfig(), { imageSize: '512x512' });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/images/generations');
      const body = JSON.parse(init.body);
      expect(body.model).toBe('stabilityai/stable-diffusion-xl-base-1.0');
      expect(body.prompt).toBe('a dog');
      expect(body.image_size).toBe('512x512');
    });

    it('HTTP 错误 → 抛错包含状态码', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(429, 'rate limited'));

      await expect(executor.execute('image-gen', 'a cat', makeModelConfig()))
        .rejects.toThrow('HTTP 429');
    });

    it('image-edit → 走 image-gen 路径', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ images: [{ url: 'edited.png' }] }));

      const result = await executor.execute('image-edit', 'remove background', makeModelConfig());
      expect(result.type).toBe('image');
    });
  });

  // ── ASR ──

  describe('executeASR', () => {
    it('正确构造 FormData 请求', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        text: '你好世界',
        language: 'zh',
        duration: 3.5,
      }));

      const audioBuf = Buffer.from('fake-audio-data');
      const result = await executor.execute('asr', audioBuf, makeModelConfig(), { language: 'zh' });

      expect(result.type).toBe('asr');
      expect((result as any).text).toBe('你好世界');
      expect((result as any).language).toBe('zh');
      expect((result as any).duration).toBe(3.5);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/audio/transcriptions');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe('Bearer test-api-key');
    });

    it('返回 segments → 正确传递', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        text: 'hello world',
        segments: [{ start: 0, end: 2, text: 'hello' }, { start: 2, end: 5, text: 'world' }],
      }));

      const result = await executor.execute('asr', Buffer.from('audio'), makeModelConfig());
      expect((result as any).segments).toHaveLength(2);
    });

    it('HTTP 错误 → 抛错', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(500, 'internal error'));

      await expect(executor.execute('asr', Buffer.from('audio'), makeModelConfig()))
        .rejects.toThrow('HTTP 500');
    });
  });

  // ── Embedding ──

  describe('executeEmbedding', () => {
    it('正确解析 OpenAI 格式响应', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        model: 'BAAI/bge-large-zh',
        usage: { prompt_tokens: 10, total_tokens: 10 },
      }));

      const result = await executor.execute('embedding', 'hello world', makeModelConfig());
      expect(result.type).toBe('embedding');
      expect((result as any).embeddings).toEqual([[0.1, 0.2, 0.3]]);
      expect((result as any).dimensions).toBe(3);
      expect((result as any).model).toBe('BAAI/bge-large-zh');
      expect((result as any).usage).toEqual({ promptTokens: 10, totalTokens: 10 });
    });

    it('请求体包含 model/input/dimensions', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [{ embedding: [0.5] }] }));

      await executor.execute('embedding', 'test text', makeModelConfig(), { dimensions: 768 });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/embeddings');
      const body = JSON.parse(init.body);
      expect(body.model).toBe('stabilityai/stable-diffusion-xl-base-1.0');
      expect(body.input).toBe('test text');
      expect(body.dimensions).toBe(768);
    });

    it('多个向量 → 全部返回', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        data: [{ embedding: [0.1] }, { embedding: [0.2] }],
      }));

      const result = await executor.execute('embedding', 'text', makeModelConfig());
      expect((result as any).embeddings).toHaveLength(2);
    });

    it('HTTP 错误 → 抛错', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(401, 'unauthorized'));

      await expect(executor.execute('embedding', 'text', makeModelConfig()))
        .rejects.toThrow('HTTP 401');
    });
  });

  // ── OCR ──

  describe('executeOCR', () => {
    it('走 chat/completions 路径，图片 base64 编码', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: '图片中的文字内容' } }],
      }));

      const imageBuf = Buffer.from('fake-png-data');
      const result = await executor.execute('ocr', imageBuf, makeModelConfig());

      expect(result.type).toBe('ocr');
      expect((result as any).text).toBe('图片中的文字内容');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/chat/completions');
      const body = JSON.parse(init.body);
      expect(body.messages[0].content).toHaveLength(2);
      expect(body.messages[0].content[0].type).toBe('text');
      expect(body.messages[0].content[1].type).toBe('image_url');
      expect(body.messages[0].content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
      expect(body.temperature).toBe(0);
    });

    it('自定义 ocrPrompt → 使用自定义 prompt', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: 'custom result' } }],
      }));

      await executor.execute('ocr', Buffer.from('img'), makeModelConfig(), {
        ocrPrompt: '只提取数字',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].content[0].text).toBe('只提取数字');
    });

    it('HTTP 错误 → 抛错', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(503, 'service unavailable'));

      await expect(executor.execute('ocr', Buffer.from('img'), makeModelConfig()))
        .rejects.toThrow('HTTP 503');
    });
  });

  // ── URL 规范化 ──

  describe('URL 规范化', () => {
    it('baseUrl 尾部斜杠 → 自动去除', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ images: [] }));
      const config = makeModelConfig({ baseUrl: 'https://api.example.com/v1/' });

      await executor.execute('image-gen', 'test', config);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.example.com/v1/images/generations');
    });

    it('无 baseUrl → 默认 SiliconFlow', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ images: [] }));
      const config = makeModelConfig({ baseUrl: undefined });

      await executor.execute('image-gen', 'test', config);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('api.siliconflow.cn');
    });
  });
});
