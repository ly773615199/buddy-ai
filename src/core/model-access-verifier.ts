/**
 * ModelAccessVerifier — 模型可用性验证器
 *
 * 实现 THREE_BRAIN_LLM_SELECTION_PLAN.md §2.7 两层验证架构：
 * - 第 1 层：端点验证（Key 级）— 用户添加端点时同步验证
 * - 第 2 层：LLM 验证（模型级）— 首次选中模型时异步验证
 *
 * 错误分类：区分永久失效（auth/payment/permission/not_found）与临时故障（rate_limited/network/timeout）
 * 状态恢复：调用成功时自动从 denied 恢复为 available
 */

import type { ModelProfile } from './model-pool.js';

// ==================== 类型定义 ====================

/** 模型访问状态 */
export type ModelAccessStatus = 'unknown' | 'available' | 'denied' | 'broken';

/** 模型访问错误类型 */
export type ModelAccessErrorType =
  | 'auth'           // Key 无效/过期
  | 'payment'        // 余额不足
  | 'permission'     // Key 权限不足，无法访问该模型
  | 'not_found'      // 模型已下架/不存在
  | 'rate_limited'   // 频率限制（临时）
  | 'network'        // 网络错误（临时）
  | 'timeout'        // 超时（临时）
  | 'unknown';       // 未知错误

/** 错误范围 */
export type ErrorScope = 'endpoint' | 'model';

/** 端点验证结果 */
export interface EndpointVerifyResult {
  ok: boolean;
  /** 余额警告（端点可达但余额不足） */
  balanceWarning?: 'INSUFFICIENT_BALANCE' | null;
  /** 错误类型 */
  error?: ModelAccessErrorType;
  /** 人类可读消息 */
  message: string;
  /** 延迟 ms */
  latencyMs: number;
  /** 发现的模型数（仅端点验证成功时有值） */
  modelCount?: number;
}

/** 模型验证结果 */
export interface ModelVerifyResult {
  ok: boolean;
  error?: ModelAccessErrorType;
  scope: ErrorScope;
  message?: string;
  latencyMs: number;
}

/** 预验证配置 */
export interface PreVerifyConfig {
  /** 并发数（默认 2） */
  concurrency: number;
  /** 单个探测超时 ms（默认 8000） */
  timeoutMs: number;
  /** 是否跳过已验证的模型 */
  skipVerified: boolean;
}

const DEFAULT_PRE_VERIFY_CONFIG: PreVerifyConfig = {
  concurrency: 2,
  timeoutMs: 8000,
  skipVerified: true,
};

// ==================== 错误分类 ====================

/**
 * 将 HTTP 状态码 + 响应体分类为 ModelAccessErrorType
 */
export function classifyHttpError(status: number, body?: string): {
  scope: ErrorScope;
  type: ModelAccessErrorType;
  message: string;
} {
  switch (status) {
    case 401:
      return { scope: 'endpoint', type: 'auth', message: 'API Key 无效或已过期' };
    case 403:
      return { scope: 'model', type: 'permission', message: 'API Key 权限不足，无法访问该模型' };
    case 402:
      return { scope: 'model', type: 'payment', message: '账户余额不足' };
    case 404:
      return { scope: 'model', type: 'not_found', message: '模型不存在或已下架' };
    case 429:
      return { scope: 'model', type: 'rate_limited', message: '请求频率超限' };
    default:
      if (status >= 500) {
        return { scope: 'model', type: 'network', message: `服务端错误 (${status})` };
      }
      return { scope: 'model', type: 'unknown', message: `HTTP ${status}: ${body?.slice(0, 200) ?? '无响应体'}` };
  }
}

/**
 * 将异常分类为 ModelAccessErrorType
 */
export function classifyProbeError(err: unknown): {
  scope: ErrorScope;
  type: ModelAccessErrorType;
  message: string;
} {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  // 网络错误
  if (lower.includes('econnrefused') || lower.includes('enotfound') ||
      lower.includes('econnreset') || lower.includes('socket hang up') ||
      lower.includes('network') || lower.includes('fetch failed')) {
    return { scope: 'endpoint', type: 'network', message: `网络错误: ${msg.slice(0, 100)}` };
  }

  // 超时
  if (lower.includes('timeout') || lower.includes('aborted') ||
      lower.includes('aborterror') || lower.includes('signal timed out')) {
    return { scope: 'model', type: 'timeout', message: `请求超时: ${msg.slice(0, 100)}` };
  }

  // 认证
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid api key')) {
    return { scope: 'endpoint', type: 'auth', message: 'API Key 无效' };
  }

  // 权限（但 403 + 余额关键词 = 余额不足）
  if (lower.includes('403') || lower.includes('forbidden') || lower.includes('permission')) {
    if (lower.includes('balance') || lower.includes('insufficient') || lower.includes('quota') ||
        lower.includes('credit') || lower.includes('payment') || lower.includes('billing') ||
        lower.includes('余额') || lower.includes('不足') || lower.includes('欠费')) {
      return { scope: 'model', type: 'payment', message: '余额不足' };
    }
    return { scope: 'model', type: 'permission', message: '无权访问该模型' };
  }

  // 余额
  if (lower.includes('402') || lower.includes('insufficient') || lower.includes('balance') ||
      lower.includes('quota') || lower.includes('billing')) {
    return { scope: 'model', type: 'payment', message: '余额不足' };
  }

  // 模型不存在
  if (lower.includes('404') || lower.includes('not found') || lower.includes('does not exist') ||
      lower.includes('model not found')) {
    return { scope: 'model', type: 'not_found', message: '模型不存在或已下架' };
  }

  // 频率限制
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests')) {
    return { scope: 'model', type: 'rate_limited', message: '请求频率超限' };
  }

  // Bad Request + 常见余额/配额错误（AI SDK 可能丢失原始 body，只抛出 "Bad Request"）
  if (lower.includes('bad request') || lower.includes('400')) {
    // 如果同时包含余额相关关键词，分类为 payment
    if (lower.includes('balance') || lower.includes('insufficient') || lower.includes('quota') ||
        lower.includes('credit') || lower.includes('payment') || lower.includes('billing') ||
        lower.includes('余额') || lower.includes('不足') || lower.includes('欠费')) {
      return { scope: 'model', type: 'payment', message: '余额不足' };
    }
    // Bad Request 可能是模型不支持该请求格式，标记为 unknown 让后续重试
    return { scope: 'model', type: 'unknown', message: `请求格式错误: ${msg.slice(0, 150)}` };
  }

  return { scope: 'model', type: 'unknown', message: msg.slice(0, 200) };
}

// ==================== 端点验证（第 1 层） ====================

/**
 * 端点验证 — 检查 API Key 有效性和端点可达性
 *
 * 通过 GET /v1/models 测试连通性，同步执行，用户在设置页面等待。
 * 失败则不将模型加入池中。
 */
export async function verifyEndpoint(config: {
  type: string;
  apiKey?: string;
  baseUrl?: string;
}): Promise<EndpointVerifyResult> {
  const startTime = Date.now();

  // 构建 /models URL — 兼容 baseUrl 已含 /v1 的情况（前端 defaultBaseUrl 带 /v1）
  const baseUrl = resolveBaseUrl(config.type, config.baseUrl);
  if (!baseUrl) {
    return {
      ok: false,
      error: 'unknown',
      message: `不支持的端点类型: ${config.type}`,
      latencyMs: 0,
    };
  }

  const modelsUrl = baseUrl.endsWith('/v1')
    ? `${baseUrl}/models`
    : `${baseUrl}/v1/models`;

  try {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(modelsUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const latencyMs = Date.now() - startTime;

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        error: 'auth',
        message: 'API Key 无效或已过期',
        latencyMs,
      };
    }

    if (res.status === 402) {
      return {
        ok: true,
        balanceWarning: 'INSUFFICIENT_BALANCE',
        message: '账户余额不足，部分模型可能无法使用',
        latencyMs,
      };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const classified = classifyHttpError(res.status, body);
      return {
        ok: false,
        error: classified.type,
        message: classified.message,
        latencyMs,
      };
    }

    // 尝试解析模型数量
    let modelCount: number | undefined;
    try {
      const data = await res.json() as { data?: unknown[] };
      if (Array.isArray(data.data)) {
        modelCount = data.data.length;
      }
    } catch {
      // 解析失败不影响验证结果
    }

    return {
      ok: true,
      balanceWarning: null,
      message: '端点连接成功',
      latencyMs,
      modelCount,
    };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    const classified = classifyProbeError(err);

    return {
      ok: false,
      error: classified.type,
      message: classified.message,
      latencyMs,
    };
  }
}

// ==================== LLM 验证（第 2 层） ====================

/**
 * LLM 验证 — 检查指定模型是否可被当前 Key 调用
 *
 * 发送最小请求（1 token 输出），异步执行，首次选中模型时按需触发。
 * 结果会缓存到 ModelProfile 的 accessStatus 字段。
 */
export async function verifyModelAccess(
  model: ModelProfile,
  callFn: (model: ModelProfile, timeoutMs: number) => Promise<void>,
  timeoutMs: number = 8000,
): Promise<ModelVerifyResult> {
  const startTime = Date.now();

  try {
    await callFn(model, timeoutMs);
    return {
      ok: true,
      scope: 'model',
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    const classified = classifyProbeError(err);
    return {
      ok: false,
      error: classified.type,
      scope: classified.scope,
      message: classified.message,
      latencyMs: Date.now() - startTime,
    };
  }
}

// ==================== 异步预验证 ====================

/**
 * 模型自报能力（探测时收集）
 */
export interface ModelSelfReportedCapabilities {
  /** 是否支持工具调用 */
  toolCalling?: boolean;
  /** 是否支持视觉/图片理解 */
  vision?: boolean;
  /** 是否支持流式输出 */
  streaming?: boolean;
  /** 上下文窗口大小 (tokens) */
  maxContextTokens?: number;
  /** 最大输出长度 (tokens) */
  maxOutputTokens?: number;
  /** 擅长领域 */
  strengths?: string[];
  /** 模型简述 */
  description?: string;
}

/**
 * 轻量 LLM 探测结果
 */
export interface InferenceProbeResult {
  modelId: string;
  reachable: boolean;
  inferenceOk: boolean;
  latencyMs: number;
  error?: string;
  errorType?: ModelAccessErrorType;
  /** 模型自报能力（推理成功时填充） */
  selfCapabilities?: ModelSelfReportedCapabilities;
}

/**
 * 按模型类型探测 — 用对应端点验证是否可用
 *
 * 原则：能不能用 = 走对端点、发对请求、有没有回复
 * - chat/vl-chat/omni → /v1/chat/completions
 * - embedding → /v1/embeddings
 * - reranker → /v1/rerank
 * - image-gen/image-edit → /v1/images/generations
 * - tts → /v1/audio/speech
 * - asr/ocr/translation/other → 降级 chat 探测
 */
export async function probeModelInference(config: {
  modelId: string;
  provider: string;
  category?: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}): Promise<InferenceProbeResult> {
  const { modelId, provider, category, apiKey, baseUrl, timeoutMs = 8000 } = config;
  const startMs = Date.now();
  const rawModelId = modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId;

  // 根据 category 路由到对应探测器
  const probeFn = getProbeByCategory(category);

  try {
    const result = await probeFn({ modelId, rawModelId, provider, apiKey, baseUrl, timeoutMs });
    return { ...result, modelId, latencyMs: Date.now() - startMs };
  } catch (err) {
    const latencyMs = Date.now() - startMs;
    const classified = classifyProbeError(extractApiError(err));
    return { modelId, reachable: false, inferenceOk: false, latencyMs, error: classified.message, errorType: classified.type };
  }
}

// ==================== 按类型探测器 ====================

type ProbeFn = (ctx: {
  modelId: string; rawModelId: string; provider: string;
  apiKey?: string; baseUrl?: string; timeoutMs: number;
}) => Promise<{ reachable: boolean; inferenceOk: boolean; selfCapabilities?: ModelSelfReportedCapabilities }>;

function getProbeByCategory(category?: string): ProbeFn {
  switch (category) {
    case 'embedding': return probeEmbedding;
    case 'reranker':  return probeReranker;
    case 'image-gen':
    case 'image-edit': return probeImageGen;
    case 'tts':       return probeTTS;
    case 'asr':       return probeASR;
    default:          return probeChat; // chat, vl-chat, omni-chat, unknown, other
  }
}

/** Chat 探测 — /v1/chat/completions */
const probeChat: ProbeFn = async (ctx) => {
  const { ProviderFactory } = await import('./provider-registry.js');
  const { generateText } = await import('ai');

  const { model } = await ProviderFactory.create({
    provider: ctx.provider, model: ctx.rawModelId, apiKey: ctx.apiKey, baseUrl: ctx.baseUrl,
  });

  const result = await withTimeout(
    generateText({
      model,
      messages: [{ role: 'user', content: 'Reply with a JSON object: {"ok":true,"capabilities":{"toolCalling":bool,"vision":bool,"streaming":bool}}' }],
      maxOutputTokens: 150,
    }),
    ctx.timeoutMs,
  );

  const hasOutput = !!(result.text && result.text.length > 0);
  let selfCaps: ModelSelfReportedCapabilities | undefined;
  if (hasOutput) {
    try {
      const m = result.text.match(/\{[\s\S]*\}/);
      if (m) {
        const p = JSON.parse(m[0]);
        const c = p.capabilities ?? p;
        selfCaps = {
          toolCalling: typeof c.toolCalling === 'boolean' ? c.toolCalling : undefined,
          vision: typeof c.vision === 'boolean' ? c.vision : undefined,
          streaming: typeof c.streaming === 'boolean' ? c.streaming : undefined,
        };
      }
    } catch { /* ignore */ }
  }
  return { reachable: true, inferenceOk: hasOutput, selfCapabilities: selfCaps };
};

/** Embedding 探测 — /v1/embeddings */
const probeEmbedding: ProbeFn = async (ctx) => {
  const base = (ctx.baseUrl ?? 'https://api.openai.com/v1')
  const resp = await withTimeout(
    fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ctx.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ctx.rawModelId, input: 'hello' }),
    }),
    ctx.timeoutMs,
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json() as any;
  const hasVector = !!(data?.data?.[0]?.embedding?.length > 0);
  return {
    reachable: true,
    inferenceOk: hasVector,
    selfCapabilities: hasVector ? {
      streaming: false,
      maxContextTokens: data?.usage?.total_tokens ? undefined : undefined,
    } : undefined,
  };
};

/** Reranker 探测 — /v1/rerank */
const probeReranker: ProbeFn = async (ctx) => {
  const base = (ctx.baseUrl ?? 'https://api.openai.com/v1')
  const resp = await withTimeout(
    fetch(`${base}/rerank`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ctx.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ctx.rawModelId, query: 'hello', documents: ['hi', 'bye'] }),
    }),
    ctx.timeoutMs,
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json() as any;
  const hasScores = !!(data?.results?.length > 0);
  return { reachable: true, inferenceOk: hasScores };
};

/** 图像生成探测 — /v1/images/generations */
const probeImageGen: ProbeFn = async (ctx) => {
  const base = (ctx.baseUrl ?? 'https://api.openai.com/v1')
  const resp = await withTimeout(
    fetch(`${base}/images/generations`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ctx.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ctx.rawModelId, prompt: 'a red dot', n: 1, size: '256x256' }),
    }),
    ctx.timeoutMs,
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json() as any;
  const hasImage = !!(data?.data?.length > 0);
  return { reachable: true, inferenceOk: hasImage };
};

/** TTS 探测 — 先试 /v1/audio/speech，失败则走 chat/completions（MiMo 格式） */
const probeTTS: ProbeFn = async (ctx) => {
  // 方式1: 标准 OpenAI TTS 端点
  try {
    const base = (ctx.baseUrl ?? 'https://api.openai.com/v1')
    const resp = await withTimeout(
      fetch(`${base}/audio/speech`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ctx.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: ctx.rawModelId, input: 'hi', voice: 'default' }),
      }),
      ctx.timeoutMs,
    );
    if (resp.ok) return { reachable: true, inferenceOk: true };
  } catch { /* fallthrough */ }

  // 方式2: MiMo 格式 — chat/completions + assistant role
  try {
    const base = (ctx.baseUrl ?? 'https://api.openai.com/v1')
    const url = `${base}/chat/completions`;
    const resp = await withTimeout(
      fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ctx.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ctx.rawModelId,
          messages: [
            { role: 'user', content: '请用语音说：测试' },
            { role: 'assistant', content: '' },
          ],
        }),
      }),
      ctx.timeoutMs,
    );
    if (resp.ok) {
      const data = await resp.json() as any;
      const hasAudio = !!data?.choices?.[0]?.message?.audio;
      const hasText = !!data?.choices?.[0]?.message?.content;
      return { reachable: true, inferenceOk: hasAudio || hasText };
    }
    const body = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${body.slice(0, 120)}`);
  } catch (err) {
    console.error(`[ProbeTTS] MiMo格式失败:`, (err as Error).message.slice(0, 120));
    throw err;
  }
};

/** ASR 探测 — chat/completions + input_audio（MiMo 格式）或 /v1/audio/transcriptions */
const probeASR: ProbeFn = async (ctx) => {
  // 方式1: 标准 OpenAI ASR 端点
  try {
    const base = (ctx.baseUrl ?? 'https://api.openai.com/v1')
    // 生成最小 WAV 文件（16kHz, 16bit, mono, 静音 0.1s）
    const wavBase64 = generateSilentWav();
    const formData = new FormData();
    formData.append('model', ctx.rawModelId);
    const blob = new Blob([Uint8Array.from(atob(wavBase64), c => c.charCodeAt(0))], { type: 'audio/wav' });
    formData.append('file', blob, 'test.wav');
    const resp = await withTimeout(
      fetch(`${base}/audio/transcriptions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ctx.apiKey}` },
        body: formData,
      }),
      ctx.timeoutMs,
    );
    if (resp.ok) return { reachable: true, inferenceOk: true };
  } catch { /* fallthrough */ }

  // 方式2: MiMo 格式 — chat/completions + input_audio data URL（raw fetch）
  try {
    const base = (ctx.baseUrl ?? 'https://api.openai.com/v1')
    const wavBase64 = generateSilentWav();
    const resp = await withTimeout(
      fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ctx.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ctx.rawModelId,
          messages: [{
            role: 'user',
            content: [{ type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${wavBase64}`, format: 'wav' } }],
          }],
          max_tokens: 50,
        }),
      }),
      ctx.timeoutMs,
    );
    if (resp.ok) {
      const data = await resp.json() as any;
      const hasText = !!(data?.choices?.[0]?.message?.content);
      return { reachable: true, inferenceOk: hasText };
    }
    const body = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
  } catch (err) {
    console.error(`[ProbeASR] 标准端点失败:`, (err as Error).message.slice(0, 80));
  }

  return { reachable: false, inferenceOk: false };
};

/** 生成最小静音 WAV (16kHz, 16bit, mono, 0.1s) */
function generateSilentWav(): string {
  const sampleRate = 16000;
  const numSamples = 1600; // 0.1s
  const dataSize = numSamples * 2; // 16bit = 2 bytes
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  // silent samples (all zeros)
  return Buffer.from(buffer).toString('base64');
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

// ==================== 工具函数 ====================

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, r) => setTimeout(() => r(new Error(`timeout (${ms}ms)`)), ms))]);
}

/** 从 AI SDK 错误中提取原始 API 错误信息 */
function extractApiError(err: unknown): Error {
  const e = err as any;
  try {
    // APICallError: 有 statusCode + responseBody
    if (e.responseBody || e.data?.message) {
      const status = e.statusCode ?? '';
      const msg = e.data?.message ?? JSON.parse(e.responseBody ?? '{}').message;
      if (msg) return new Error(`${status} ${msg}`.trim());
    }
    if (e.cause?.responseBody || e.cause?.data?.message) {
      const c = e.cause;
      const status = c.statusCode ?? '';
      const msg = c.data?.message ?? JSON.parse(c.responseBody ?? '{}').message;
      if (msg) return new Error(`${status} ${msg}`.trim());
    }
  } catch { /* ignore */ }
  return e instanceof Error ? e : new Error(String(e));
}

/**
 * 批量推理探测 — 对每个入池模型发真实请求
 *
 * 原则：能不能用 = 发个请求有没有回复
 * - 不做轻量 GET 检查（很多 provider 不支持）
 * - 不做抽样（要么全测，要么不测）
 * - 并发控制避免打爆 API
 * - 结果实时回调，逐个更新状态
 */
export async function batchProbeInference(
  models: Array<{ id: string; platform: string; category?: string }>,
  getCredentials: (platform: string) => { apiKey?: string; baseUrl?: string } | null,
  options?: {
    limit?: number;
    concurrency?: number;
    timeoutMs?: number;
    onResult?: (result: InferenceProbeResult) => void;
  },
): Promise<InferenceProbeResult[]> {
  const limit = options?.limit ?? models.length;
  const concurrency = options?.concurrency ?? 3;
  const timeoutMs = options?.timeoutMs ?? 10000;
  const toProbe = models.slice(0, limit);

  const results: InferenceProbeResult[] = [];
  let idx = 0;

  const workers = Array.from({ length: Math.min(concurrency, toProbe.length) }, async () => {
    while (idx < toProbe.length) {
      const model = toProbe[idx++];
      const creds = getCredentials(model.platform);
      if (!creds) {
        const r: InferenceProbeResult = { modelId: model.id, reachable: false, inferenceOk: false, latencyMs: 0, error: '无 API Key', errorType: 'auth' };
        results.push(r);
        options?.onResult?.(r);
        continue;
      }

      const result = await probeModelInference({
        modelId: model.id,
        provider: model.platform,
        category: model.category,
        apiKey: creds.apiKey,
        baseUrl: creds.baseUrl,
        timeoutMs,
      });
      results.push(result);
      options?.onResult?.(result);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * 异步预验证 — 端点添加后后台批量验证模型
 *
 * 不阻塞用户操作，验证结果写入 ModelProfile 的 accessStatus 字段。
 * 并发控制避免对平台造成压力。
 */
export async function preVerifyModels(
  models: ModelProfile[],
  callFn: (model: ModelProfile, timeoutMs: number) => Promise<void>,
  onUpdate: (modelId: string, result: ModelVerifyResult) => void,
  config: Partial<PreVerifyConfig> = {},
): Promise<void> {
  const cfg = { ...DEFAULT_PRE_VERIFY_CONFIG, ...config };

  // 过滤已验证的
  const toVerify = cfg.skipVerified
    ? models.filter((m) => !m.accessStatus || m.accessStatus === 'unknown')
    : models;

  if (toVerify.length === 0) return;

  // 并发控制
  let index = 0;
  const workers: Promise<void>[] = [];

  for (let i = 0; i < Math.min(cfg.concurrency, toVerify.length); i++) {
    workers.push((async () => {
      while (index < toVerify.length) {
        const model = toVerify[index++];
        const result = await verifyModelAccess(model, callFn, cfg.timeoutMs);
        onUpdate(model.id, result);
      }
    })());
  }

  await Promise.all(workers);
}

// ==================== 辅助函数 ====================

/** 解析平台 baseUrl */
function resolveBaseUrl(type: string, customBaseUrl?: string): string | null {
  if (customBaseUrl) {
    return customBaseUrl.replace(/\/+$/, '');
  }

  const URLS: Record<string, string> = {
    siliconflow: 'https://api.siliconflow.cn',
    openrouter: 'https://openrouter.ai/api',
    deepseek: 'https://api.deepseek.com',
    openai: 'https://api.openai.com',
    anthropic: 'https://api.anthropic.com',
    google: 'https://generativelanguage.googleapis.com',
    ollama: 'http://localhost:11434',
    lmstudio: 'http://localhost:1234',
  };

  return URLS[type.toLowerCase()] ?? null;
}
