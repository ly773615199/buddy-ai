/**
 * 模型能力静态知识表（精简版）
 *
 * 只存储模型能力评分和元数据，不存储定价和上下文长度。
 * 定价和上下文长度由 ModelDiscovery 从平台 API + LiteLLM 社区数据自动获取。
 *
 * 三层来源优先级：
 *   能力评分：静态知识(高) → 运行时学习(修正)
 *   定价/上下文：平台 API(高) → LiteLLM 社区(中) → 默认值(低)
 */

// ==================== 能力评分常量 ====================

/** 能力维度键 */
export type CapabilityKey =
  | 'reasoning' | 'code' | 'chinese' | 'english' | 'math'
  | 'creative' | 'toolCalling' | 'toolCallingMode' | 'vision' | 'streaming';

// ==================== 静态知识条目 ====================

interface ModelKnowledgeEntry {
  id: string;                     // 'provider/model' 格式
  displayName: string;
  tier: 'premium' | 'standard' | 'budget' | 'free';
  capabilities: {
    reasoning: number;
    code: number;
    chinese: number;
    english: number;
    math: number;
    creative: number;
    toolCalling: boolean;
    /** 工具调用模式：native=原生函数调用，prompt=prompt 模拟，none=不支持 */
    toolCallingMode: 'native' | 'prompt' | 'none';
    vision: boolean;
    streaming: boolean;
    /** 是否为 embedding 模型 */
    embedding?: boolean;
    /** embedding 维度 */
    dimensions?: number;
  };
  /** Task 8.2: 上下文窗口大小（token 数），供 provider-adapter 动态查询 */
  contextWindow?: number;
  notes?: string;
  /** 模型类别 */
  category?: string;
  /** HuggingFace pipeline tag */
  pipelineTag?: string;
}

// ==================== 静态知识表 ====================
// 只存能力评分，定价和上下文长度由 API 自动获取

const MODEL_KNOWLEDGE: ModelKnowledgeEntry[] = [
  // ── OpenAI ──
  {
    id: 'openai/gpt-4o',
    displayName: 'GPT-4o',
    tier: 'premium',
    capabilities: { reasoning: 0.92, code: 0.90, chinese: 0.75, english: 0.95, math: 0.88, creative: 0.85, toolCalling: true, toolCallingMode: 'native', vision: true, streaming: true },
    contextWindow: 128000,
  },
  {
    id: 'openai/gpt-4o-mini',
    displayName: 'GPT-4o Mini',
    tier: 'budget',
    capabilities: { reasoning: 0.78, code: 0.75, chinese: 0.68, english: 0.85, math: 0.72, creative: 0.70, toolCalling: true, toolCallingMode: 'native', vision: true, streaming: true },
    contextWindow: 128000,
  },
  {
    id: 'openai/gpt-4-turbo',
    displayName: 'GPT-4 Turbo',
    tier: 'premium',
    capabilities: { reasoning: 0.90, code: 0.88, chinese: 0.72, english: 0.93, math: 0.86, creative: 0.83, toolCalling: true, toolCallingMode: 'native', vision: true, streaming: true },
    contextWindow: 128000,
  },
  {
    id: 'openai/o1',
    displayName: 'o1',
    tier: 'premium',
    capabilities: { reasoning: 0.97, code: 0.93, chinese: 0.70, english: 0.95, math: 0.96, creative: 0.75, toolCalling: false, toolCallingMode: 'none', vision: false, streaming: true },
    contextWindow: 200000,
  },
  {
    id: 'openai/o3-mini',
    displayName: 'o3-mini',
    tier: 'standard',
    capabilities: { reasoning: 0.90, code: 0.88, chinese: 0.65, english: 0.90, math: 0.92, creative: 0.65, toolCalling: true, toolCallingMode: 'native', vision: false, streaming: true },
    contextWindow: 200000,
  },
  {
    id: 'openai/gpt-5.4',
    displayName: 'GPT-5.4',
    tier: 'premium',
    capabilities: { reasoning: 0.95, code: 0.93, chinese: 0.78, english: 0.95, math: 0.93, creative: 0.88, toolCalling: true, toolCallingMode: 'native', vision: true, streaming: true },
    contextWindow: 128000,
    notes: '2026 新旗舰',
  },
  {
    id: 'openai/gpt-5.4-mini',
    displayName: 'GPT-5.4 Mini',
    tier: 'standard',
    capabilities: { reasoning: 0.85, code: 0.82, chinese: 0.72, english: 0.88, math: 0.82, creative: 0.78, toolCalling: true, toolCallingMode: 'native', vision: true, streaming: true },
    contextWindow: 128000,
    notes: '2026 最强 mini',
  },

  // ── DeepSeek ──
  {
    id: 'deepseek/deepseek-chat',
    displayName: 'DeepSeek-V3',
    tier: 'standard',
    capabilities: { reasoning: 0.88, code: 0.90, chinese: 0.92, english: 0.82, math: 0.85, creative: 0.78, toolCalling: true, toolCallingMode: 'native', vision: false, streaming: true },
    contextWindow: 64000,
  },
  {
    id: 'deepseek/deepseek-reasoner',
    displayName: 'DeepSeek-R1',
    tier: 'premium',
    capabilities: { reasoning: 0.95, code: 0.92, chinese: 0.90, english: 0.85, math: 0.95, creative: 0.70, toolCalling: false, toolCallingMode: 'none', vision: false, streaming: true },
    contextWindow: 64000,
  },

  // ── Anthropic ──
  {
    id: 'anthropic/claude-3-5-sonnet-20241022',
    displayName: 'Claude 3.5 Sonnet',
    tier: 'premium',
    capabilities: { reasoning: 0.90, code: 0.92, chinese: 0.72, english: 0.93, math: 0.85, creative: 0.88, toolCalling: true, toolCallingMode: 'native', vision: true, streaming: true },
    contextWindow: 200000,
  },
  {
    id: 'anthropic/claude-3-haiku-20240307',
    displayName: 'Claude 3 Haiku',
    tier: 'budget',
    capabilities: { reasoning: 0.72, code: 0.70, chinese: 0.65, english: 0.82, math: 0.68, creative: 0.72, toolCalling: true, toolCallingMode: 'native', vision: true, streaming: true },
    contextWindow: 200000,
  },
  {
    id: 'anthropic/claude-4-sonnet',
    displayName: 'Claude 4 Sonnet',
    tier: 'premium',
    capabilities: { reasoning: 0.93, code: 0.95, chinese: 0.75, english: 0.95, math: 0.88, creative: 0.90, toolCalling: true, toolCallingMode: 'native', vision: true, streaming: true },
    contextWindow: 200000,
    notes: '2025-05 发布',
  },
  {
    id: 'anthropic/claude-4-opus',
    displayName: 'Claude 4 Opus',
    tier: 'premium',
    capabilities: { reasoning: 0.96, code: 0.95, chinese: 0.78, english: 0.96, math: 0.92, creative: 0.92, toolCalling: true, toolCallingMode: 'native', vision: true, streaming: true },
    contextWindow: 200000,
    notes: '旗舰模型',
  },
  {
    id: 'anthropic/claude-sonnet-4.6',
    displayName: 'Claude Sonnet 4.6',
    tier: 'premium',
    capabilities: { reasoning: 0.94, code: 0.96, chinese: 0.76, english: 0.95, math: 0.90, creative: 0.91, toolCalling: true, toolCallingMode: 'native', vision: true, streaming: true },
    contextWindow: 200000,
    notes: '2026-02 发布，操作电脑接近人类',
  },

  // ── Google ──
  {
    id: 'google/gemini-1.5-pro',
    displayName: 'Gemini 1.5 Pro',
    tier: 'premium',
    capabilities: { reasoning: 0.88, code: 0.85, chinese: 0.72, english: 0.90, math: 0.85, creative: 0.80, toolCalling: true, toolCallingMode: 'native', vision: true, streaming: true },
    contextWindow: 1000000,
  },
  {
    id: 'google/gemini-1.5-flash',
    displayName: 'Gemini 1.5 Flash',
    tier: 'budget',
    capabilities: { reasoning: 0.78, code: 0.75, chinese: 0.68, english: 0.82, math: 0.75, creative: 0.72, toolCalling: true, toolCallingMode: 'native', vision: true, streaming: true },
    contextWindow: 1000000,
  },
  {
    id: 'google/gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    tier: 'premium',
    capabilities: { reasoning: 0.93, code: 0.90, chinese: 0.75, english: 0.93, math: 0.92, creative: 0.85, toolCalling: true, toolCallingMode: 'native', vision: true, streaming: true },
    contextWindow: 1000000,
    notes: '2025-06 正式版，硬刚 DeepSeek R1',
  },
  {
    id: 'google/gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    tier: 'standard',
    capabilities: { reasoning: 0.85, code: 0.82, chinese: 0.72, english: 0.88, math: 0.83, creative: 0.78, toolCalling: true, toolCallingMode: 'native', vision: true, streaming: true },
    contextWindow: 1000000,
    notes: '2025-06 正式版，性价比之王',
  },

  // ── Qwen (通义千问) ──
  {
    id: 'qwen/qwen-2.5-72b-instruct',
    displayName: 'Qwen2.5-72B',
    tier: 'standard',
    capabilities: { reasoning: 0.85, code: 0.82, chinese: 0.95, english: 0.80, math: 0.82, creative: 0.80, toolCalling: true, toolCallingMode: 'native', vision: false, streaming: true },
    contextWindow: 131072,
  },
  {
    id: 'qwen/qwen-2.5-7b-instruct',
    displayName: 'Qwen2.5-7B',
    tier: 'free',
    capabilities: { reasoning: 0.65, code: 0.62, chinese: 0.88, english: 0.68, math: 0.65, creative: 0.65, toolCalling: true, toolCallingMode: 'native', vision: false, streaming: true },
    contextWindow: 131072,
  },
  {
    id: 'qwen/qwen-2.5-14b-instruct',
    displayName: 'Qwen2.5-14B',
    tier: 'free',
    capabilities: { reasoning: 0.72, code: 0.70, chinese: 0.90, english: 0.72, math: 0.72, creative: 0.70, toolCalling: true, toolCallingMode: 'native', vision: false, streaming: true },
    contextWindow: 131072,
  },
  {
    id: 'qwen/qwen-2.5-32b-instruct',
    displayName: 'Qwen2.5-32B',
    tier: 'standard',
    capabilities: { reasoning: 0.80, code: 0.78, chinese: 0.92, english: 0.78, math: 0.78, creative: 0.75, toolCalling: true, toolCallingMode: 'native', vision: false, streaming: true },
    contextWindow: 131072,
  },

  // ── GLM (智谱) ──
  {
    id: 'zhipu/glm-4-9b-chat',
    displayName: 'GLM-4-9B',
    tier: 'free',
    capabilities: { reasoning: 0.68, code: 0.65, chinese: 0.88, english: 0.65, math: 0.65, creative: 0.70, toolCalling: true, toolCallingMode: 'native', vision: false, streaming: true },
    contextWindow: 128000,
  },
  {
    id: 'zhipu/glm-4-plus',
    displayName: 'GLM-4 Plus',
    tier: 'standard',
    capabilities: { reasoning: 0.82, code: 0.78, chinese: 0.92, english: 0.75, math: 0.78, creative: 0.80, toolCalling: true, toolCallingMode: 'native', vision: true, streaming: true },
    contextWindow: 128000,
  },

  // ── Llama (Meta) ──
  {
    id: 'meta-llama/llama-3.1-8b-instruct',
    displayName: 'Llama 3.1 8B',
    tier: 'free',
    capabilities: { reasoning: 0.62, code: 0.60, chinese: 0.45, english: 0.78, math: 0.58, creative: 0.60, toolCalling: true, toolCallingMode: 'native', vision: false, streaming: true },
    contextWindow: 128000,
  },
  {
    id: 'meta-llama/llama-3.1-70b-instruct',
    displayName: 'Llama 3.1 70B',
    tier: 'standard',
    capabilities: { reasoning: 0.82, code: 0.80, chinese: 0.55, english: 0.88, math: 0.78, creative: 0.75, toolCalling: true, toolCallingMode: 'native', vision: false, streaming: true },
    contextWindow: 128000,
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct',
    displayName: 'Llama 3.3 70B',
    tier: 'standard',
    capabilities: { reasoning: 0.84, code: 0.82, chinese: 0.55, english: 0.90, math: 0.80, creative: 0.78, toolCalling: true, toolCallingMode: 'native', vision: false, streaming: true },
    contextWindow: 128000,
  },

  // ── Mistral ──
  {
    id: 'mistralai/mistral-7b-instruct',
    displayName: 'Mistral 7B',
    tier: 'free',
    capabilities: { reasoning: 0.60, code: 0.58, chinese: 0.40, english: 0.75, math: 0.55, creative: 0.58, toolCalling: true, toolCallingMode: 'native', vision: false, streaming: true },
    contextWindow: 32000,
  },
  {
    id: 'mistralai/mixtral-8x7b-instruct',
    displayName: 'Mixtral 8x7B',
    tier: 'budget',
    capabilities: { reasoning: 0.75, code: 0.72, chinese: 0.45, english: 0.82, math: 0.70, creative: 0.70, toolCalling: true, toolCallingMode: 'native', vision: false, streaming: true },
    contextWindow: 32000,
  },

  // ── Yi (零一万物) ──
  {
    id: '01-ai/yi-1.5-34b-chat',
    displayName: 'Yi-1.5 34B',
    tier: 'standard',
    capabilities: { reasoning: 0.78, code: 0.75, chinese: 0.90, english: 0.78, math: 0.75, creative: 0.75, toolCalling: true, toolCallingMode: 'native', vision: false, streaming: true },
    contextWindow: 200000,
  },

  // ── InternLM (书生) ──
  {
    id: 'internlm/internlm2_5-7b-chat',
    displayName: 'InternLM2.5 7B',
    tier: 'free',
    capabilities: { reasoning: 0.65, code: 0.62, chinese: 0.88, english: 0.65, math: 0.68, creative: 0.62, toolCalling: true, toolCallingMode: 'native', vision: false, streaming: true },
  },

  // ── MiMo (小米) ──
  {
    id: 'mimo/mimo-v2.5-pro',
    displayName: 'MiMo v2.5 Pro',
    tier: 'standard',
    capabilities: { reasoning: 0.85, code: 0.88, chinese: 0.90, english: 0.80, math: 0.85, creative: 0.78, toolCalling: true, toolCallingMode: 'native', vision: true, streaming: true },
  },

  // ── Embedding 模型 ──
  {
    id: 'siliconflow/BAAI/bge-small-zh-v1.5',
    displayName: 'BGE Small ZH (SF)',
    tier: 'free',
    capabilities: { reasoning: 0, code: 0, chinese: 0.95, english: 0, math: 0, creative: 0, toolCalling: false, toolCallingMode: 'none', vision: false, streaming: false, embedding: true, dimensions: 512 },
    category: 'embedding',
    pipelineTag: 'feature-extraction',
  },
  {
    id: 'BAAI/bge-small-zh-v1.5',
    displayName: 'BGE Small ZH (Local)',
    tier: 'free',
    capabilities: { reasoning: 0, code: 0, chinese: 0.95, english: 0, math: 0, creative: 0, toolCalling: false, toolCallingMode: 'none', vision: false, streaming: false, embedding: true, dimensions: 512 },
    category: 'embedding',
    pipelineTag: 'feature-extraction',
  },

  // ── 硅基流动免费模型 ──
  {
    id: 'siliconflow/Qwen2.5-7B-Instruct',
    displayName: 'Qwen2.5-7B (SF)',
    tier: 'free',
    capabilities: { reasoning: 0.65, code: 0.62, chinese: 0.88, english: 0.68, math: 0.65, creative: 0.65, toolCalling: true, toolCallingMode: 'native', vision: false, streaming: true },
  },
  {
    id: 'siliconflow/Qwen2.5-14B-Instruct',
    displayName: 'Qwen2.5-14B (SF)',
    tier: 'free',
    capabilities: { reasoning: 0.72, code: 0.70, chinese: 0.90, english: 0.72, math: 0.72, creative: 0.70, toolCalling: true, toolCallingMode: 'native', vision: false, streaming: true },
  },
  {
    id: 'siliconflow/DeepSeek-V3',
    displayName: 'DeepSeek-V3 (SF)',
    tier: 'standard',
    capabilities: { reasoning: 0.88, code: 0.90, chinese: 0.92, english: 0.82, math: 0.85, creative: 0.78, toolCalling: true, toolCallingMode: 'native', vision: false, streaming: true },
  },
  {
    id: 'siliconflow/DeepSeek-R1',
    displayName: 'DeepSeek-R1 (SF)',
    tier: 'premium',
    capabilities: { reasoning: 0.95, code: 0.92, chinese: 0.90, english: 0.85, math: 0.95, creative: 0.70, toolCalling: false, toolCallingMode: 'none', vision: false, streaming: true },
  },

  // ── OpenRouter 常见模型 ──
  {
    id: 'openrouter/auto',
    displayName: 'OpenRouter Auto',
    tier: 'standard',
    capabilities: { reasoning: 0.80, code: 0.78, chinese: 0.70, english: 0.85, math: 0.78, creative: 0.75, toolCalling: true, toolCallingMode: 'native', vision: false, streaming: true },
  },
];

// ==================== 查询接口 ====================

/** 从静态知识表查询模型能力 */
export function lookupModelKnowledge(providerModel: string): ModelKnowledgeEntry | null {
  // 精确匹配
  const exact = MODEL_KNOWLEDGE.find((m) => m.id === providerModel);
  if (exact) return exact;

  // 模糊匹配：去掉 provider 前缀
  const modelPart = providerModel.includes('/') ? providerModel.split('/').slice(1).join('/') : providerModel;
  const fuzzy = MODEL_KNOWLEDGE.find((m) => {
    const mPart = m.id.includes('/') ? m.id.split('/').slice(1).join('/') : m.id;
    return mPart === modelPart || mPart.includes(modelPart) || modelPart.includes(mPart);
  });
  return fuzzy ?? null;
}

/** 根据模型 ID 推断 tier */
export function inferTier(model: string): 'premium' | 'standard' | 'budget' | 'free' {
  const lower = model.toLowerCase();

  // 免费模型关键词
  if (/\b(7b|8b|9b)\b/.test(lower) || lower.includes('free') || lower.includes(':free')) return 'free';

  // 预算模型
  if (/\b(14b|13b)\b/.test(lower) || lower.includes('mini') || lower.includes('lite') || lower.includes('flash') || lower.includes('haiku')) return 'budget';

  // 高端模型
  if (lower.includes('gpt-4o') && !lower.includes('mini')) return 'premium';
  if (lower.includes('claude-3.5') || lower.includes('claude-3-opus') || lower.includes('claude-4') || lower.includes('claude-opus')) return 'premium';
  if (lower.includes('r1') || lower.includes('reasoner') || lower.includes('o1') || lower.includes('o3')) return 'premium';
  if (/\b(70b|72b|405b)\b/.test(lower)) return 'premium';
  if (lower.includes('gpt-5')) return 'premium';
  if (lower.includes('gemini-2.5-pro')) return 'premium';

  // 标准
  if (/\b(32b|34b|20b)\b/.test(lower)) return 'standard';
  if (lower.includes('gemini-2.5-flash')) return 'standard';

  return 'standard';
}

/** 从模型名称推断能力评分（当静态表无匹配时的 fallback） */
export function inferCapabilities(model: string): ModelKnowledgeEntry['capabilities'] {
  const tier = inferTier(model);
  const lower = model.toLowerCase();

  // 基础分
  const base: Record<string, number> = {
    premium: 0.85, standard: 0.75, budget: 0.65, free: 0.55,
  };
  const b = base[tier];

  // 中文能力推断
  const isChinese = /qwen|glm|yi|deepseek|internlm|moonshot|minimax|mimo/i.test(lower);
  const chinese = isChinese ? b + 0.15 : b - 0.15;

  // 代码能力推断
  const isCode = /code|coder|deepseek-coder|starcoder|codegeex/i.test(lower);
  const code = isCode ? b + 0.1 : b;

  // 推理能力推断
  const isReasoning = /r1|reason|o1|o3|think/i.test(lower);
  const reasoning = isReasoning ? b + 0.1 : b;

  // 工具调用能力推断
  const supportsToolCalling = !(/r1|reasoner|o1/.test(lower));  // 推理模型通常不支持
  // 原生支持 function calling 的模型家族
  const isNativeToolCalling = /gpt|claude|gemini|deepseek-chat|deepseek-v3|qwen-2\.5|glm-4|mistral|llama-3|mixtral/i.test(lower);

  return {
    reasoning: Math.min(1, reasoning),
    code: Math.min(1, code),
    chinese: Math.min(1, Math.max(0, chinese)),
    english: Math.min(1, b + 0.05),
    math: Math.min(1, b),
    creative: Math.min(1, b - 0.05),
    toolCalling: supportsToolCalling,
    toolCallingMode: supportsToolCalling ? (isNativeToolCalling ? 'native' : 'prompt') : 'none',
    vision: /vision|vl|gpt-4o|gemini|claude-3|claude-4/i.test(lower),
    streaming: true,
  };
}

/** 获取所有静态知识条目（调试用） */
export function getAllModelKnowledge(): ModelKnowledgeEntry[] {
  return [...MODEL_KNOWLEDGE];
}

/** 按平台过滤模型知识 */
export function getModelsByPlatform(platform: string): ModelKnowledgeEntry[] {
  return MODEL_KNOWLEDGE.filter((m) => m.id.startsWith(platform + '/'));
}
