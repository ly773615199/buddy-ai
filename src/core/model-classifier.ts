/**
 * ModelClassifier — 模型分类器
 *
 * 职责：根据 HuggingFace 元数据判断模型用途，决定是否加入模型池
 * 从 model-enrichment.ts 拆出分类逻辑，便于独立测试和扩展
 */

import type { EnrichmentResult, ModelCategory } from './model-enrichment.js';

// ==================== 分类映射表 ====================

/** 聊天模型 pipeline_tag 白名单 */
const CHAT_TAGS = new Set([
  'text-generation',
  'image-text-to-text',
  'any-to-any',
  'visual-question-answering',
  'question-answering',
  'conversational',
]);

/** 排除的 pipeline_tag（非聊天用途） */
const EXCLUDE_TAGS = new Set([
  'text-to-image', 'image-to-image', 'image-to-video', 'text-to-video',
  'text-to-speech', 'audio-to-audio', 'audio-to-text',
  'feature-extraction', 'sentence-similarity', 'sentence-transformers',
  'text-ranking', 'text-classification', 'fill-mask',
  'table-question-answering', 'translation', 'summarization',
  'zero-shot-classification', 'token-classification',
  'object-detection', 'image-segmentation', 'depth-estimation',
  'video-classification', 'reinforcement-learning',
]);

// ==================== 分类函数 ====================

/**
 * 根据 enrichment 结果分类模型
 *
 * 优先级：pipeline_tag > tags 推断 > 名称推断
 */
export function classify(enrichment: EnrichmentResult): ModelCategory {
  const tag = enrichment.pipelineTag;

  // 精确匹配 pipeline_tag
  if (tag) {
    if (CHAT_TAGS.has(tag)) {
      if (tag === 'image-text-to-text') return 'vl-chat';
      if (tag === 'any-to-any') return 'omni-chat';
      return 'chat';
    }

    if (EXCLUDE_TAGS.has(tag)) {
      return classifyExcludedTag(tag);
    }
  }

  // Fallback: 从 tags 推断
  const tags = enrichment.tags.map((t) => t.toLowerCase());
  if (tags.includes('chat') || tags.includes('conversational')) return 'chat';
  if (tags.includes('embedding') || tags.includes('sentence-transformers')) return 'embedding';

  // Fallback: 名称推断
  if (enrichment.hfId) {
    return inferFromName(enrichment.hfId);
  }

  return 'unknown';
}

/**
 * 分类被排除的 pipeline_tag
 */
function classifyExcludedTag(tag: string): ModelCategory {
  if (tag.startsWith('text-to-image') || tag === 'image-to-image') return 'image-gen';
  if (tag.includes('video')) return 'video-gen';
  if (tag === 'text-to-speech') return 'tts';
  if (tag.includes('audio')) return 'asr';
  if (tag.includes('embedding') || tag === 'sentence-similarity' || tag === 'sentence-transformers' || tag === 'feature-extraction') return 'embedding';
  if (tag === 'text-ranking' || tag === 'text-classification') return 'reranker';
  if (tag === 'translation') return 'translation';
  return 'other';
}

/**
 * 从模型名称推断分类（最后手段）
 */
export function inferFromName(name: string): ModelCategory {
  const lower = name.toLowerCase();

  // 硬排除（明确非对话）
  if (/bge-|bce-|embed|text-embedding/.test(lower)) return 'embedding';
  if (/rerank/.test(lower)) return 'reranker';
  if (/tts|cosyvoice|speech/.test(lower)) return 'tts';
  if (/asr|sensevoice|whisper/.test(lower)) return 'asr';
  if (/dall-e|dalle|stable-diffusion|flux|imagen|kolors|image-edit/.test(lower)) return 'image-gen';
  if (/i2v|t2v|wan2|video/.test(lower)) return 'video-gen';
  if (/ocr|paddleocr/.test(lower)) return 'ocr';
  if (/moderation|text-to-|t2i/.test(lower)) return 'other';
  // 精确识别（对话子类型）
  if (/-vl\b|vl-|vision|visual|qwen-vl|internvl|minicpm-v/.test(lower)) return 'vl-chat';
  if (/omni|any-to-any|mini-omni/.test(lower)) return 'omni-chat';
  if (/instruct|chat|[-_](it|gguf|awq|gptq|fp8|int[48])\b/.test(lower)) return 'chat';

  return 'unknown';
}

/**
 * 判断模型是否应加入模型池
 * API 返回的模型 = 用户的资源，全部入池
 * 三脑才是决策者，入池阶段不应替三脑做判断
 * Thompson Sampling 会自然通过成功率筛选好模型
 */
export function shouldIncludeInPool(_category: ModelCategory): boolean {
  return true;
}

/**
 * 获取分类的中文标签（用于日志和前端展示）
 */
export function getCategoryLabel(category: ModelCategory): string {
  const labels: Record<ModelCategory, string> = {
    'chat': '💬 纯聊天',
    'vl-chat': '👁️ 视觉语言',
    'omni-chat': '🌐 全模态',
    'embedding': '📐 向量嵌入',
    'reranker': '📊 重排序',
    'image-gen': '🎨 图像生成',
    'image-edit': '🖼️ 图像编辑',
    'video-gen': '🎬 视频生成',
    'tts': '🔊 语音合成',
    'asr': '🎤 语音识别',
    'translation': '🌐 翻译',
    'ocr': '👁️ OCR',
    'other': '📦 其他',
    'unknown': '❓ 未知',
  };
  return labels[category] ?? category;
}
