/**
 * MultimodalExecutor — 多模态执行适配器
 *
 * 支持:
 *   - image-gen: 文生图 (SiliconFlow / OpenAI-compatible)
 *   - asr: 语音识别 (Whisper-compatible)
 *   - embedding: 文本向量化
 *   - ocr: 图片文字识别 (走 VL 模型 chat 路径)
 *
 * 复用 ProviderLimiter 做速率控制，不新建流控。
 */

import type { ModelConfig } from './model-router.js';
import type { TaskType } from './model-router.js';

// ==================== 类型定义 ====================

export interface MultimodalOptions {
  /** 图片生成尺寸 */
  imageSize?: string;
  /** 图片生成数量 */
  imageCount?: number;
  /** ASR 语言 */
  language?: string;
  /** embedding 维度 */
  dimensions?: number;
  /** OCR 自定义 prompt */
  ocrPrompt?: string;
  /** 通用超时 ms */
  timeoutMs?: number;
}

export interface ImageGenResult {
  type: 'image';
  urls: string[];
  /** 如果 provider 返回 base64 */
  b64Images?: string[];
  revisedPrompt?: string;
}

export interface ASRResult {
  type: 'asr';
  text: string;
  language?: string;
  duration?: number;
  segments?: Array<{ start: number; end: number; text: string }>;
}

export interface EmbeddingResult {
  type: 'embedding';
  embeddings: number[][];
  dimensions: number;
  model: string;
  usage?: { promptTokens: number; totalTokens: number };
}

export interface OCRResult {
  type: 'ocr';
  text: string;
  /** 结构化提取（如果 VL 模型返回了 JSON） */
  blocks?: Array<{ text: string; confidence?: number }>;
}

export interface VideoGenResult {
  type: 'video';
  urls: string[];
  /** 本地文件路径（如果下载了） */
  localPaths?: string[];
  durationMs?: number;
}

export type MultimodalResult = ImageGenResult | ASRResult | EmbeddingResult | OCRResult | VideoGenResult;

// ==================== Provider URL 规范化 ====================

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function buildUrl(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}${path}`;
}

function buildAuthHeaders(apiKey: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${apiKey}`,
  };
}

// ==================== 主类 ====================

export class MultimodalExecutor {
  private defaultTimeoutMs = 60_000;

  /**
   * 统一执行入口 — 根据 taskType 路由
   */
  async execute(
    taskType: TaskType,
    input: string | Buffer,
    modelConfig: ModelConfig,
    options?: MultimodalOptions,
  ): Promise<MultimodalResult> {
    const apiKey = modelConfig.apiKey;
    if (!apiKey) {
      throw new Error(`[Multimodal] 模型 ${modelConfig.id} 缺少 apiKey`);
    }

    switch (taskType) {
      case 'image-gen':
      case 'image-edit':
        return this.executeImageGen(apiKey, modelConfig, input as string, options);
      case 'tts':
        throw new Error('[Multimodal] TTS 请使用 TTSManager 子系统，不走多模态执行器');
      case 'asr':
        return this.executeASR(apiKey, modelConfig, input as Buffer, options);
      case 'embedding':
        return this.executeEmbedding(apiKey, modelConfig, input as string, options);
      case 'ocr':
        return this.executeOCR(apiKey, modelConfig, input as Buffer, options);
      case 'video-gen':
        return this.executeVideoGen(apiKey, modelConfig, input as string, options);
      default:
        throw new Error(`[Multimodal] 不支持的任务类型: ${taskType}`);
    }
  }

  // ==================== 文生图 ====================

  private async executeImageGen(
    apiKey: string,
    config: ModelConfig,
    prompt: string,
    options?: MultimodalOptions,
  ): Promise<ImageGenResult> {
    const baseUrl = normalizeBaseUrl(config.baseUrl ?? 'https://api.siliconflow.cn/v1');
    const url = buildUrl(baseUrl, '/images/generations');

    const body: Record<string, unknown> = {
      model: config.model,
      prompt,
      image_size: options?.imageSize ?? '1024x1024',
      num_inference_steps: 20,
    };
    if (options?.imageCount) body.batch_size = options.imageCount;

    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          ...buildAuthHeaders(apiKey),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`[ImageGen] HTTP ${resp.status}: ${errText.slice(0, 500)}`);
      }

      const data = await resp.json() as any;

      // SiliconFlow 格式: { images: [{ url: ... }] }
      // OpenAI 格式: { data: [{ url: ... }] }
      const images = data.images ?? data.data ?? [];
      const urls: string[] = [];
      const b64Images: string[] = [];

      for (const img of images) {
        if (img.url) urls.push(img.url);
        if (img.b64_json || img.b64) b64Images.push(img.b64_json ?? img.b64);
      }

      return {
        type: 'image',
        urls,
        b64Images: b64Images.length > 0 ? b64Images : undefined,
        revisedPrompt: data.revised_prompt,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // ==================== 视频生成 ====================

  private async executeVideoGen(
    apiKey: string,
    config: ModelConfig,
    prompt: string,
    options?: MultimodalOptions,
  ): Promise<VideoGenResult> {
    const baseUrl = normalizeBaseUrl(config.baseUrl ?? 'https://api.siliconflow.cn/v1');
    // SiliconFlow 视频生成端点: POST /video/submit
    const url = buildUrl(baseUrl, '/video/submit');

    const body: Record<string, unknown> = {
      model: config.model,
      prompt,
    };

    const timeoutMs = options?.timeoutMs ?? 300_000; // 视频生成默认 5 分钟
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          ...buildAuthHeaders(apiKey),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`[VideoGen] HTTP ${resp.status}: ${errText.slice(0, 500)}`);
      }

      const data = await resp.json() as any;

      // SiliconFlow 异步模式: 返回 requestId，需要轮询结果
      if (data.requestId) {
        const result = await this.pollVideoResult(apiKey, baseUrl, data.requestId, timeoutMs);
        return result;
      }

      // 直接返回模式
      const urls: string[] = [];
      if (data.video?.url) urls.push(data.video.url);
      if (data.videos) {
        for (const v of data.videos) {
          if (v.url) urls.push(v.url);
        }
      }
      if (data.data?.url) urls.push(data.data.url);

      return {
        type: 'video',
        urls,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 轮询视频生成结果（SiliconFlow 异步 API）
   */
  private async pollVideoResult(
    apiKey: string,
    baseUrl: string,
    requestId: string,
    timeoutMs: number,
  ): Promise<VideoGenResult> {
    const pollUrl = buildUrl(baseUrl, `/video/status/${requestId}`);
    const deadline = Date.now() + timeoutMs;
    const pollInterval = 3_000; // 每 3 秒查一次

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, pollInterval));

      const resp = await fetch(pollUrl, {
        headers: buildAuthHeaders(apiKey),
      });

      if (!resp.ok) continue;

      const data = await resp.json() as any;
      const status = data.status ?? data.result?.status;

      if (status === 'completed' || status === 'succeeded') {
        const urls: string[] = [];
        if (data.result?.video?.url) urls.push(data.result.video.url);
        if (data.video?.url) urls.push(data.video.url);
        if (data.results) {
          for (const r of data.results) {
            if (r.url) urls.push(r.url);
          }
        }
        return { type: 'video', urls };
      }

      if (status === 'failed' || status === 'error') {
        throw new Error(`[VideoGen] 生成失败: ${data.error ?? data.message ?? '未知错误'}`);
      }

      // status === 'pending' / 'processing' → 继续轮询
    }

    throw new Error(`[VideoGen] 轮询超时 (${timeoutMs}ms)`);
  }

  // ==================== 语音识别 (ASR) ====================

  private async executeASR(
    apiKey: string,
    config: ModelConfig,
    audioBuffer: Buffer,
    options?: MultimodalOptions,
  ): Promise<ASRResult> {
    const baseUrl = normalizeBaseUrl(config.baseUrl ?? 'https://api.siliconflow.cn/v1');
    const url = buildUrl(baseUrl, '/audio/transcriptions');

    const formData = new FormData();
    const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/wav' });
    formData.append('file', audioBlob, 'audio.wav');
    formData.append('model', config.model);
    if (options?.language) formData.append('language', options.language);

    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: buildAuthHeaders(apiKey),
        body: formData,
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`[ASR] HTTP ${resp.status}: ${errText.slice(0, 500)}`);
      }

      const data = await resp.json() as any;

      return {
        type: 'asr',
        text: data.text ?? '',
        language: data.language,
        duration: data.duration,
        segments: data.segments,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // ==================== 文本向量化 (Embedding) ====================

  private async executeEmbedding(
    apiKey: string,
    config: ModelConfig,
    text: string,
    options?: MultimodalOptions,
  ): Promise<EmbeddingResult> {
    const baseUrl = normalizeBaseUrl(config.baseUrl ?? 'https://api.siliconflow.cn/v1');
    const url = buildUrl(baseUrl, '/embeddings');

    const body: Record<string, unknown> = {
      model: config.model,
      input: text,
    };
    if (options?.dimensions) body.dimensions = options.dimensions;

    const timeoutMs = options?.timeoutMs ?? 30_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          ...buildAuthHeaders(apiKey),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`[Embedding] HTTP ${resp.status}: ${errText.slice(0, 500)}`);
      }

      const data = await resp.json() as any;
      const embeddings = (data.data ?? []).map((d: any) => d.embedding ?? []);

      return {
        type: 'embedding',
        embeddings,
        dimensions: embeddings[0]?.length ?? 0,
        model: data.model ?? config.model,
        usage: data.usage ? { promptTokens: data.usage.prompt_tokens, totalTokens: data.usage.total_tokens } : undefined,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // ==================== OCR (走 VL 模型 chat 路径) ====================

  private async executeOCR(
    apiKey: string,
    config: ModelConfig,
    imageBuffer: Buffer,
    options?: MultimodalOptions,
  ): Promise<OCRResult> {
    const baseUrl = normalizeBaseUrl(config.baseUrl ?? 'https://api.siliconflow.cn/v1');
    const url = buildUrl(baseUrl, '/chat/completions');

    const b64 = imageBuffer.toString('base64');
    const ocrPrompt = options?.ocrPrompt ?? '请提取图片中的所有文字内容，保持原始排版。只输出文字，不要添加额外说明。';

    const body = {
      model: config.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: ocrPrompt },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
          ],
        },
      ],
      max_tokens: 4096,
      temperature: 0,
    };

    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          ...buildAuthHeaders(apiKey),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`[OCR] HTTP ${resp.status}: ${errText.slice(0, 500)}`);
      }

      const data = await resp.json() as any;
      const text = data.choices?.[0]?.message?.content ?? '';

      return { type: 'ocr', text };
    } finally {
      clearTimeout(timer);
    }
  }
}
