/**
 * 聚合平台模型自动发现
 *
 * 三层数据源优先级：
 *   1. 平台 API 直连（OpenRouter 等有定价的平台）
 *   2. LiteLLM 社区数据库（GitHub JSON，覆盖主流厂商直连定价）
 *   3. 本地静态表兜底（硅基流动等 API 无定价的平台）
 *
 * 用户只需配置 API Key，系统自动发现并注册到统一模型池。
 */

import type { ModelProfile } from './model-pool.js';
import { lookupModelKnowledge, inferTier, inferCapabilities } from './model-knowledge.js';
import { getModelEnricher, type EnrichmentResult, type ModelCategory } from './model-enrichment.js';
import { classify } from './model-classifier.js';

/**
 * 保留变体关联（variantCount/variantIds），不做 active 裁剪。
 * active 状态由 model-pool.ts 的 dedupeAndOptimize 统一管理。
 */
export function dedupeModels(profiles: ModelProfile[]): ModelProfile[] {
  const groups = new Map<string, ModelProfile[]>();

  for (const p of profiles) {
    const key = `${normalizeBaseName(p.displayName)}:${p.category ?? 'unknown'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  const result: ModelProfile[] = [];
  for (const [, variants] of groups) {
    if (variants.length > 1) {
      variants[0].variantCount = variants.length;
      variants[0].variantIds = variants.slice(1).map(v => v.id);
    }
    result.push(...variants);
  }

  return result;
}

/** 规范化模型名（去重用） */
function normalizeBaseName(name: string): string {
  return name
    .replace(/[-_\s]?(Pro|Plus|Lora|Instruct|Chat|it|GGUF|AWQ|GPTQ|FP8|INT4|INT8)$/i, '')
    .replace(/[-_\s]?(v\d+(\.\d+)*)$/i, '')
    .trim()
    .toLowerCase();
}

// ==================== 平台定义 ====================

export interface PlatformConfig {
  id: string;
  type: 'siliconflow' | 'openrouter' | 'deepseek' | 'openai' | 'anthropic' | 'google' | 'ollama' | 'lmstudio' | 'custom';
  apiKey?: string;
  baseUrl?: string;
  /** 用户自定义定价覆盖（¥/千token），可选 */
  costPer1kInput?: number;
  costPer1kOutput?: number;
}

interface PlatformMeta {
  name: string;
  defaultBaseUrl: string;
  modelsEndpoint: string;
  /** 是否需要 API Key 才能获取模型列表 */
  requiresAuth: boolean;
  /** 从 API 响应中提取模型列表的路径 */
  extractModels: (data: any) => RawModelEntry[];
}

interface RawModelEntry {
  id: string;
  owned_by?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  capabilities?: Record<string, unknown>;
  // OpenRouter 扩展字段
  top_provider?: { max_completion_tokens?: number };
  // SiliconFlow 扩展字段
  model_type?: string;
  max_tokens?: number;
}

// ==================== 平台元数据 ====================

const PLATFORM_META: Record<string, PlatformMeta> = {
  siliconflow: {
    name: 'SiliconFlow',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    modelsEndpoint: '/models',
    requiresAuth: true,
    extractModels: (data: any) => {
      const models = Array.isArray(data) ? data : (data?.data ?? []);
      // SiliconFlow 返回的模型对象可能包含 pricing 字段
      return models.map((m: any) => ({
        ...m,
        // 确保 pricing 从模型对象中透传
        pricing: m.pricing ?? undefined,
        context_length: m.context_length ?? m.max_model_len ?? undefined,
      }));
    },
  },
  openrouter: {
    name: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    modelsEndpoint: '/models',
    requiresAuth: false,
    extractModels: (data: any) => {
      const models = data?.data ?? (Array.isArray(data) ? data : []);
      // OpenRouter 返回 pricing: { prompt, completion } 单位是 $/token
      // 同时返回 context_length 和 top_provider.max_completion_tokens
      return models.map((m: any) => ({
        id: m.id,
        owned_by: m.owned_by,
        context_length: m.context_length,
        pricing: m.pricing ? {
          prompt: m.pricing.prompt,
          completion: m.pricing.completion,
        } : undefined,
        top_provider: m.top_provider,
      }));
    },
  },
  deepseek: {
    name: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    modelsEndpoint: '/models',
    requiresAuth: true,
    extractModels: (data: any) => data?.data ?? [],
  },
  openai: {
    name: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    modelsEndpoint: '/models',
    requiresAuth: true,
    extractModels: (data: any) => data?.data ?? [],
  },
  anthropic: {
    name: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    modelsEndpoint: '/models',
    requiresAuth: true,
    extractModels: (data: any) => data?.data ?? [],
  },
  google: {
    name: 'Google',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    modelsEndpoint: '/models',
    requiresAuth: true,
    extractModels: (data: any) => {
      // Google API 返回 { models: [...] }
      if (data?.models) return data.models.map((m: any) => ({
        id: m.name?.replace('models/', ''),
        ...m,
      }));
      return data?.data ?? [];
    },
  },
  ollama: {
    name: 'Ollama',
    defaultBaseUrl: 'http://localhost:11434/v1',
    modelsEndpoint: '/models',
    requiresAuth: false,
    extractModels: (data: any) => {
      // Ollama 的 /api/tags 返回 { models: [...] }
      if (data?.models) return data.models.map((m: any) => ({ id: m.name, ...m }));
      if (data?.data) return data.data;
      if (Array.isArray(data)) return data;
      return [];
    },
  },
  lmstudio: {
    name: 'LM Studio',
    defaultBaseUrl: 'http://localhost:1234/v1',
    modelsEndpoint: '/models',
    requiresAuth: false,
    extractModels: (data: any) => {
      // LM Studio 标准 OpenAI 格式: { data: [{ id: "model-name", ... }] }
      if (data?.data) return data.data;
      if (Array.isArray(data)) return data;
      return [];
    },
  },
};

// ==================== 发现结果 ====================

export interface DiscoveryResult {
  platform: string;
  models: ModelProfile[];
  discoveredAt: number;
  error?: string;
  fromCache: boolean;
}

/** 定价来源 */
export type PricingSource = 'api' | 'community' | 'static' | 'none';

// ==================== LiteLLM 社区数据 ====================

const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const LITELLM_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 小时

interface LiteLLMCache {
  data: Record<string, LiteLLMEntry>;
  fetchedAt: number;
  expiresAt: number;
}

interface LiteLLMEntry {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  max_tokens?: number;
  max_input_tokens?: number;
  litellm_provider?: string;
  mode?: string;
  supports_function_calling?: boolean;
  supports_vision?: boolean;
}

let litellmCache: LiteLLMCache | null = null;

/**
 * 获取 LiteLLM 社区定价数据（带缓存）
 */
async function getLiteLLMData(): Promise<Record<string, LiteLLMEntry>> {
  const now = Date.now();
  if (litellmCache && now < litellmCache.expiresAt) {
    return litellmCache.data;
  }

  try {
    const res = await fetch(LITELLM_URL, {
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json() as Record<string, LiteLLMEntry>;
    litellmCache = {
      data,
      fetchedAt: now,
      expiresAt: now + LITELLM_CACHE_TTL,
    };
    console.log(`[ModelDiscovery] LiteLLM 数据已更新: ${Object.keys(data).length} 条目`);
    return data;
  } catch (err) {
    // 失败时用过期缓存
    if (litellmCache) {
      console.warn(`[ModelDiscovery] LiteLLM 拉取失败，使用过期缓存: ${(err as Error).message}`);
      return litellmCache.data;
    }
    console.warn(`[ModelDiscovery] LiteLLM 拉取失败且无缓存: ${(err as Error).message}`);
    return {};
  }
}

/**
 * 从 LiteLLM 数据中查找模型定价
 * 匹配规则：provider/model 格式，支持模糊匹配
 */
function lookupLiteLLMPricing(
  litellmData: Record<string, LiteLLMEntry>,
  platformId: string,
  modelId: string,
): LiteLLMEntry | null {
  // 1. 精确匹配：platformId/modelId
  const exact1 = litellmData[`${platformId}/${modelId}`];
  if (exact1) return exact1;

  // 2. 精确匹配：modelId（如 deepseek/deepseek-chat）
  const exact2 = litellmData[modelId];
  if (exact2) return exact2;

  // 3. 模糊匹配：modelId 去掉前缀
  const modelPart = modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId;
  for (const [key, entry] of Object.entries(litellmData)) {
    const keyPart = key.includes('/') ? key.split('/').slice(1).join('/') : key;
    if (keyPart === modelPart && entry.input_cost_per_token !== undefined) {
      return entry;
    }
  }

  return null;
}

// ==================== 缓存 ====================

interface CachedDiscovery {
  models: ModelProfile[];
  discoveredAt: number;
  expiresAt: number;
}

const discoveryCache = new Map<string, CachedDiscovery>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 分钟

// ==================== 核心发现逻辑 ====================

/**
 * 从指定平台发现可用模型
 */
export async function discoverModels(config: PlatformConfig): Promise<DiscoveryResult> {
  const cacheKey = `${config.type}:${config.id}`;

  // 检查缓存
  const cached = discoveryCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return {
      platform: config.id,
      models: cached.models,
      discoveredAt: cached.discoveredAt,
      fromCache: true,
    };
  }

  // 预加载 LiteLLM 社区数据
  const litellmData = await getLiteLLMData();

  const meta = PLATFORM_META[config.type];
  if (!meta) {
    // 未知平台，尝试按 OpenAI 兼容模式处理
    return discoverOpenAICompatible(config, litellmData);
  }

  try {
    const baseUrl = config.baseUrl ?? meta.defaultBaseUrl;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    const url = `${baseUrl}${meta.modelsEndpoint}`;
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const rawModels = meta.extractModels(data);

    // ── HuggingFace 元数据增强 ──
    const enricher = getModelEnricher();
    const enrichmentMap = await enricher.enrich(rawModels.map((m) => m.id));

    // 入池：API 返回的模型全部入池，分类仅用于标注类型，不拦截
    const models = rawModels
      .map((m) => {
        const enrichment = enrichmentMap.get(m.id);
        // 优先用 enrichment 分类（更准确），降级到名称推断
        const category = enrichment?.category ?? inferCategoryFromName(m.id);

        return rawToProfile(m, config, litellmData, enrichment);
      })
      .filter(Boolean) as ModelProfile[];

    console.log(`[ModelDiscovery] ${config.id}: API 返回 ${rawModels.length} 个模型, 过滤后 ${models.length} 个有效模型`);

    // 去重：同名同类型模型只保留择优的一个
    const deduped = dedupeModels(models);
    const activeCount = deduped.filter(m => m.active !== false).length;
    if (deduped.length !== models.length || activeCount !== deduped.length) {
      console.log(`[ModelDiscovery] ${config.id}: 去重后 ${deduped.length} 个模型, 激活 ${activeCount} 个`);
    }

    // 写入缓存
    discoveryCache.set(cacheKey, {
      models: deduped,
      discoveredAt: Date.now(),
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return {
      platform: config.id,
      models: deduped,
      discoveredAt: Date.now(),
      fromCache: false,
    };
  } catch (err) {
    // 失败时尝试返回缓存（即使过期）
    if (cached) {
      console.warn(`[ModelDiscovery] ${config.id} 拉取失败，使用过期缓存: ${(err as Error).message}`);
      return {
        platform: config.id,
        models: cached.models,
        discoveredAt: cached.discoveredAt,
        error: (err as Error).message,
        fromCache: true,
      };
    }

    return {
      platform: config.id,
      models: [],
      discoveredAt: Date.now(),
      error: (err as Error).message,
      fromCache: false,
    };
  }
}

/**
 * 批量发现多个平台的模型
 */
export async function discoverAll(configs: PlatformConfig[]): Promise<DiscoveryResult[]> {
  const results = await Promise.allSettled(
    configs.map((c) => discoverModels(c)),
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      platform: configs[i].id,
      models: [],
      discoveredAt: Date.now(),
      error: r.reason?.message ?? 'Unknown error',
      fromCache: false,
    };
  });
}

// ==================== OpenAI 兼容模式发现 ====================

async function discoverOpenAICompatible(config: PlatformConfig, litellmData: Record<string, LiteLLMEntry> = {}): Promise<DiscoveryResult> {
  const baseUrl = config.baseUrl ?? 'http://localhost:11434/v1';

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const rawModels: RawModelEntry[] = data?.data ?? (Array.isArray(data) ? data : []);

    // ── HuggingFace 元数据增强 ──
    const enricher = getModelEnricher();
    const enrichmentMap = await enricher.enrich(rawModels.map((m) => m.id));

    // 入池：API 返回的模型全部入池，分类仅用于标注类型，不拦截
    const models = rawModels
      .map((m) => {
        const enrichment = enrichmentMap.get(m.id);
        // 优先用 enrichment 分类（更准确），降级到名称推断
        const category = enrichment?.category ?? inferCategoryFromName(m.id);
        return rawToProfile(m, config, litellmData, enrichment);
      })
      .filter(Boolean) as ModelProfile[];

    // 去重
    const deduped = dedupeModels(models);

    return {
      platform: config.id,
      models: deduped,
      discoveredAt: Date.now(),
      fromCache: false,
    };
  } catch (err) {
    return {
      platform: config.id,
      models: [],
      discoveredAt: Date.now(),
      error: (err as Error).message,
      fromCache: false,
    };
  }
}

// ==================== 模型过滤（旧逻辑保留为 fallback） ====================

/**
 * 从名称推断模型分类（当 enrichment 无数据时的兜底）
 * 仅用于无法获取 HuggingFace 元数据的场景
 */
function inferCategoryFromName(id: string): ModelCategory {
  const lower = id.toLowerCase();

  // 排除非聊天模型
  if (/embedding|text-embedding|bge-|bce-embed/.test(lower)) return 'embedding';
  if (/rerank/.test(lower)) return 'reranker';
  if (/tts|whisper|cosyvoice|sensevoice|speechasr/.test(lower)) return 'tts';
  if (/dall-e|dalle|stable-diffusion|flux|imagen|kolors|image-edit|i2v|t2v|z-image|ernie-image/.test(lower)) return 'image-gen';
  if (/paddleocr|ocr/.test(lower)) return 'ocr';
  if (/wan2\.|video/.test(lower)) return 'video-gen';
  if (/moderation|text-to-|t2i/.test(lower)) return 'other';

  // 默认当作聊天模型（保持向后兼容）
  return 'chat';
}

// ==================== 转换逻辑 ====================

/** 将平台原始模型数据转换为 ModelProfile */
function rawToProfile(
  raw: RawModelEntry,
  config: PlatformConfig,
  litellmData: Record<string, LiteLLMEntry> = {},
  enrichment?: EnrichmentResult,
): ModelProfile | null {
  if (!raw.id) return null;

  const fullId = `${config.id}/${raw.id}`;

  // 查找静态知识（只提供能力评分、tier、displayName）
  const knowledge = lookupModelKnowledge(fullId) ?? lookupModelKnowledge(raw.id);

  // 推断 tier：enrichment 参数量 > 静态知识 > 名称推断
  const tier = knowledge?.tier ?? inferTier(raw.id);

  // 推断能力：静态知识 > 名称推断
  const caps = knowledge?.capabilities ?? inferCapabilities(raw.id);

  // ========== 三层定价优先级 ==========
  let costPer1kInput = 0;
  let costPer1kOutput = 0;
  let pricingSource: PricingSource = 'none';

  // Layer 1: 平台 API 定价
  if (raw.pricing) {
    const parsed = parsePricing(raw.pricing.prompt, raw.pricing.completion);
    if (parsed) {
      costPer1kInput = parsed.input;
      costPer1kOutput = parsed.output;
      pricingSource = 'api';
    }
  }

  // Layer 2: LiteLLM 社区数据
  if (pricingSource === 'none' && Object.keys(litellmData).length > 0) {
    const litellmEntry = lookupLiteLLMPricing(litellmData, config.id, raw.id);
    if (litellmEntry) {
      const inputPerToken = litellmEntry.input_cost_per_token ?? 0;
      const outputPerToken = litellmEntry.output_cost_per_token ?? 0;
      if (inputPerToken > 0 || outputPerToken > 0) {
        costPer1kInput = inputPerToken * 1000 * 7.2;
        costPer1kOutput = outputPerToken * 1000 * 7.2;
        pricingSource = 'community';
      }
    }
  }

  // Layer 3: 端点配置中的用户自定义定价
  if (pricingSource === 'none' && config.costPer1kInput !== undefined) {
    costPer1kInput = config.costPer1kInput;
    costPer1kOutput = config.costPer1kOutput ?? 0;
    pricingSource = 'static';
  }

  // 上下文/输出长度：enrichment 真实值 > API 数据 > 默认值
  const maxContextTokens = enrichment?.contextLength ?? raw.context_length ?? 4096;
  const maxOutputTokens = enrichment?.maxOutput ?? raw.top_provider?.max_completion_tokens ?? 4096;

  const profile: ModelProfile = {
    id: fullId,
    platform: config.id,
    displayName: knowledge?.displayName ?? raw.id.split('/').pop() ?? raw.id,
    tier,
    capabilities: caps,
    maxContextTokens,
    maxOutputTokens,
    costPer1kInput,
    costPer1kOutput,
    stats: {
      totalCalls: 0,
      successes: 0,
      avgLatencyMs: 0,
      byTaskType: {},
    },
    source: 'platform_api',
    discoveredAt: Date.now(),
  };

  // 附加 enrichment 字段（如果有）
  if (enrichment) {
    profile.category = enrichment.category;
    profile.parameters = enrichment.parameters;
    profile.contextLength = enrichment.contextLength;
    profile.realMaxOutput = enrichment.maxOutput;
    profile.modelType = enrichment.modelType;
    profile.license = enrichment.license;
    profile.pipelineTag = enrichment.pipelineTag;
    profile.hfId = enrichment.hfId;
    profile.enrichmentSource = enrichment.source;
  }

  // 派生能力硬约束（从 category/pipelineTag/静态知识 推导）
  profile.derived = deriveCapabilities(profile);

  return profile;
}

// ==================== 派生能力判断 ====================

/** 聊天模型 pipeline_tag 白名单 */
const CHAT_PIPELINE_TAGS = new Set([
  'text-generation', 'image-text-to-text', 'any-to-any',
  'conversational', 'question-answering', 'visual-question-answering',
]);

/** 非聊天 pipeline_tag（明确不能做聊天） */
const NON_CHAT_PIPELINE_TAGS = new Set([
  'feature-extraction', 'sentence-similarity', 'sentence-transformers',
  'text-ranking', 'text-classification', 'fill-mask',
  'text-to-image', 'image-to-image', 'image-to-video', 'text-to-video',
  'text-to-speech', 'audio-to-audio', 'audio-to-text',
  'object-detection', 'image-segmentation', 'depth-estimation',
  'table-question-answering', 'translation', 'summarization',
  'zero-shot-classification', 'token-classification',
  'video-classification', 'reinforcement-learning',
]);

/** 聊天类别白名单 */
const CHAT_CATEGORIES = new Set(['chat', 'vl-chat', 'omni-chat']);

/** 嵌入类别/标签 */
const EMBED_CATEGORIES = new Set(['embedding']);
const EMBED_PIPELINE_TAGS = new Set(['feature-extraction', 'sentence-similarity', 'sentence-transformers']);

/**
 * 从 ModelProfile 的 category/pipelineTag/静态知识 派生能力硬约束
 *
 * 优先级：pipelineTag > category > 静态知识(工具调用模式) > 名称推断 > 默认 true
 */
function deriveCapabilities(profile: ModelProfile): ModelProfile['derived'] {
  const pipelineTag = profile.pipelineTag ?? null;
  const category = profile.category ?? null;

  // ── chatCapable 判断 ──
  let chatCapable: boolean;
  if (pipelineTag) {
    // pipelineTag 明确 → 用白名单/黑名单
    if (CHAT_PIPELINE_TAGS.has(pipelineTag)) chatCapable = true;
    else if (NON_CHAT_PIPELINE_TAGS.has(pipelineTag)) chatCapable = false;
    else chatCapable = true; // 未知 tag，默认允许（向后兼容）
  } else if (category) {
    // category 明确
    if (CHAT_CATEGORIES.has(category)) chatCapable = true;
    else if (EMBED_CATEGORIES.has(category)) chatCapable = false;
    else if (category === 'reranker') chatCapable = false;
    else if (category === 'image-gen' || category === 'image-edit' || category === 'video-gen') chatCapable = false;
    else if (category === 'tts' || category === 'asr') chatCapable = false;
    else if (category === 'ocr') chatCapable = false;
    else chatCapable = true; // unknown/other，默认允许
  } else {
    // 无 enrichment 数据 → 静态知识或名称推断
    // 有 toolCallingMode 说明是已知聊天模型
    if (profile.capabilities.toolCallingMode !== 'none') {
      chatCapable = true; // 明确支持工具调用 → 大概率是聊天模型
    } else {
      // 仅凭 streaming=true 不能判断为聊天模型（embedding 模型也支持 streaming）
      // 回退到静态知识：如果 capabilities 中有聊天相关评分，认为是聊天模型
      const caps = profile.capabilities;
      const hasChatSignal = (caps.reasoning ?? 0) > 0 || (caps.creative ?? 0) > 0
        || (caps.chinese ?? 0) > 0 || (caps.english ?? 0) > 0;
      chatCapable = hasChatSignal;
    }
  }

  // ── toolCapable 判断 ──
  const toolCapable = chatCapable && profile.capabilities.toolCalling
    && profile.capabilities.toolCallingMode !== 'none';

  // ── embedCapable 判断 ──
  let embedCapable: boolean;
  if (category && EMBED_CATEGORIES.has(category)) embedCapable = true;
  else if (pipelineTag && EMBED_PIPELINE_TAGS.has(pipelineTag)) embedCapable = true;
  else embedCapable = false;

  // ── visionCapable 判断 ──
  let visionCapable: boolean;
  if (category === 'vl-chat' || category === 'omni-chat') visionCapable = true;
  else if (profile.capabilities.vision) visionCapable = true;
  else if (pipelineTag === 'image-text-to-text' || pipelineTag === 'visual-question-answering') visionCapable = true;
  else visionCapable = false;

  return { chatCapable, toolCapable, embedCapable, visionCapable };
}

/**
 * 解析定价字符串 → ¥/千token
 * 支持多种格式：$/token, $/M tokens, ¥/千token
 */
function parsePricing(prompt?: string, completion?: string): { input: number; output: number } | null {
  const p = parseFloat(prompt ?? '0');
  const c = parseFloat(completion ?? '0');
  if (p === 0 && c === 0) return null;

  const isPerMillion = p >= 100; // $/M tokens
  const isPerToken = p > 0 && p < 0.01; // $/token

  if (isPerMillion) {
    return { input: (p / 1000) * 7.2, output: (c / 1000) * 7.2 };
  } else if (isPerToken) {
    return { input: p * 1000 * 7.2, output: c * 1000 * 7.2 };
  } else {
    // 已经是 ¥/千token
    return { input: p, output: c };
  }
}

// ==================== 缓存管理 ====================

/** 清除所有发现缓存 */
export function clearDiscoveryCache(): void {
  discoveryCache.clear();
}

/** 清除指定平台的缓存 */
export function clearPlatformCache(platformId: string): void {
  for (const key of discoveryCache.keys()) {
    if (key.startsWith(platformId + ':')) {
      discoveryCache.delete(key);
    }
  }
}

/** 获取缓存状态 */
export function getDiscoveryCacheStatus(): Array<{ key: string; modelCount: number; age: number; ttl: number }> {
  const result: Array<{ key: string; modelCount: number; age: number; ttl: number }> = [];
  const now = Date.now();
  for (const [key, cached] of discoveryCache) {
    result.push({
      key,
      modelCount: cached.models.length,
      age: now - cached.discoveredAt,
      ttl: Math.max(0, cached.expiresAt - now),
    });
  }
  return result;
}
