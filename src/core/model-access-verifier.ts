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

  // 权限
  if (lower.includes('403') || lower.includes('forbidden') || lower.includes('permission')) {
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
