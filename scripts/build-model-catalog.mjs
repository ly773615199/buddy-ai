#!/usr/bin/env node
/**
 * 模型画像探测器 v2
 *
 * 数据链路: SiliconFlow API → HuggingFace API + README → 结构化模型目录
 *
 * 输出: model-catalog.json（完整画像）+ 终端摘要
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ==================== 配置 ====================

const SF_API_KEY = process.env.SF_API_KEY || '';
const HF_BASE = 'https://hf-mirror.com/api/models';
const HF_RAW = 'https://hf-mirror.com';
const CONCURRENCY = 5;
const DELAY_MS = 350;
const CACHE_DIR = join(import.meta.dirname, '..', '.cache', 'model-profiles');
const CATALOG_PATH = join(import.meta.dirname, '..', 'model-catalog.json');

// ==================== 工具函数 ====================

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJSON(url, headers = {}, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { ...headers },
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 404) return null;
      if (res.status === 429) { await sleep(2000 * (i + 1)); continue; }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      if (i === retries) return null;
      await sleep(1000);
    }
  }
  return null;
}

async function fetchText(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return null;
      return await res.text();
    } catch {
      if (i === retries) return null;
      await sleep(1000);
    }
  }
  return null;
}

// ==================== 缓存 ====================

if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

function cacheKey(id) { return id.replace(/\//g, '__') + '.json'; }

function loadCache(id) {
  const p = join(CACHE_DIR, cacheKey(id));
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    // 缓存 7 天有效
    if (Date.now() - data._cachedAt > 7 * 24 * 3600_000) return null;
    return data;
  } catch { return null; }
}

function saveCache(id, data) {
  const p = join(CACHE_DIR, cacheKey(id));
  writeFileSync(p, JSON.stringify({ ...data, _cachedAt: Date.now() }, null, 2));
}

// ==================== HuggingFace repo 路径解析 ====================

// 已知的特殊映射（SF ID → HF repo）
const KNOWN_HF_MAP = {
  'MiniMaxAI/MiniMax-M2.5': 'MiniMaxAI/MiniMax-M2.5',
  'stepfun-ai/Step-3.5-Flash': 'stepfun-ai/Step-3.5-Flash',
  'inclusionAI/Ring-flash-2.0': 'inclusionAI/Ring-flash-2.0',
  'inclusionAI/Ling-flash-2.0': 'inclusionAI/Ling-flash-2.0',
  'inclusionAI/Ling-mini-2.0': 'inclusionAI/Ling-mini-2.0',
  'tencent/Hunyuan-MT-7B': 'tencent/Hunyuan-MT-7B',
  'tencent/Hunyuan-A13B-Instruct': 'tencent/Hunyuan-A13B-Instruct',
  'ByteDance-Seed/Seed-OSS-36B-Instruct': 'ByteDance-Seed/Seed-OSS-36B-Instruct',
  'fnlp/MOSS-TTSD-v0.5': 'fnlp/MOSS-TTSD-v0.5',
  'PaddlePaddle/PaddleOCR-VL-1.5': 'PaddlePaddle/PaddleOCR-VL-1.5',
  'Wan-AI/Wan2.2-I2V-A14B': 'Wan-AI/Wan2.2-I2V-A14B',
  'Wan-AI/Wan2.2-T2V-A14B': 'Wan-AI/Wan2.2-T2V-A14B',
};

function getHFCandidates(sfId) {
  const candidates = new Set();

  // 原始 ID
  candidates.add(sfId);

  // 去掉 Pro/ LoRA/ 前缀
  for (const prefix of ['Pro/', 'LoRA/']) {
    if (sfId.startsWith(prefix)) candidates.add(sfId.slice(prefix.length));
  }

  // 已知映射
  if (KNOWN_HF_MAP[sfId]) candidates.add(KNOWN_HF_MAP[sfId]);

  // zai-org → THUDM (GLM 系列)
  if (sfId.includes('zai-org/GLM')) {
    const model = sfId.split('/').pop();
    candidates.add(`THUDM/${model.toLowerCase()}`);
    candidates.add(`THUDM/${model}`);
    candidates.add(sfId); // zai-org 可能也直接存在
  }

  return [...candidates];
}

// ==================== 上下文长度提取 ====================

function extractContextLength(text) {
  const results = { contextLength: null, maxOutput: null, source: null };

  // 模式 1: "Context Length: Full 131,072 tokens"
  const m1 = text.match(/context\s*length[:\s]*(?:full\s*)?([\d,]+)\s*tokens?/i);
  if (m1) {
    results.contextLength = parseInt(m1[1].replace(/,/g, ''));
    results.source = 'model_card';
  }

  // 模式 2: "up to 128K tokens" 或 "128k context"
  if (!results.contextLength) {
    const m2 = text.match(/(?:up\s+to|supports?)\s+(\d+)\s*[kK]\s*tokens?/);
    if (m2) {
      results.contextLength = parseInt(m2[1]) * 1024;
      results.source = 'model_card';
    }
  }

  // 模式 3: "context_window: 131072" 或类似 JSON 格式
  if (!results.contextLength) {
    const m3 = text.match(/(?:context_window|max_position_embeddings|n_positions)[:\s]*(\d{4,})/i);
    if (m3) {
      results.contextLength = parseInt(m3[1]);
      results.source = 'model_card';
    }
  }

  // 模式 4: "32,768" 出现在上下文相关段落
  if (!results.contextLength) {
    const ctxSection = text.match(/(?:context|length|sequence)[^\n]{0,200}/gi);
    if (ctxSection) {
      for (const s of ctxSection) {
        const m = s.match(/([\d,]{4,})\s*(?:tokens?|token\s+length)/i);
        if (m) {
          results.contextLength = parseInt(m[1].replace(/,/g, ''));
          results.source = 'model_card_context_section';
          break;
        }
      }
    }
  }

  // 提取最大输出长度
  const outM = text.match(/(?:generation|generate|output|max_new_tokens?)[:\s]*(?:up\s+to\s+)?([\d,]+)\s*tokens?/i);
  if (outM) {
    results.maxOutput = parseInt(outM[1].replace(/,/g, ''));
  }

  return results;
}

// ==================== 模型画像构建 ====================

async function buildProfile(sfId) {
  // 检查缓存
  const cached = loadCache(sfId);
  if (cached) return cached;

  const candidates = getHFCandidates(sfId);
  let hfData = null;
  let matchedHfId = null;

  // 尝试每个候选路径
  for (const hfId of candidates) {
    const data = await fetchJSON(`${HF_BASE}/${hfId}`);
    if (data && data.pipeline_tag) {
      hfData = data;
      matchedHfId = hfId;
      break;
    }
  }

  const profile = {
    sfId,
    hfId: matchedHfId,
    found: !!hfData,
  };

  if (hfData) {
    // 结构化元数据
    profile.pipeline_tag = hfData.pipeline_tag;
    profile.tags = (hfData.tags || []).filter(t =>
      !t.startsWith('arxiv:') && !t.startsWith('region:') && !t.startsWith('deploy:')
    );
    profile.model_type = hfData.config?.model_type || null;
    profile.library_name = hfData.library_name || null;
    profile.parameters = hfData.safetensors?.total || null;
    profile.language = hfData.cardData?.language || null;
    profile.license = hfData.cardData?.license || null;
    profile.base_model = hfData.cardData?.base_model || null;
    profile.likes = hfData.likes || 0;
    profile.downloads = hfData.downloads || 0;
    profile.lastModified = hfData.lastModified || null;

    // 标准化分类
    profile.category = classifyModel(profile);

    // 从 README 提取上下文长度
    const readmeUrl = `${HF_RAW}/${matchedHfId}/raw/main/README.md`;
    const readmeText = await fetchText(readmeUrl);
    if (readmeText) {
      const ctx = extractContextLength(readmeText);
      profile.contextLength = ctx.contextLength;
      profile.maxOutput = ctx.maxOutput;
      profile.contextSource = ctx.source;
    }
  } else {
    // 未匹配，用名字推断
    profile.category = inferFromName(sfId);
  }

  // 保存缓存
  saveCache(sfId, profile);
  return profile;
}

// ==================== 分类逻辑 ====================

const CHAT_PIPELINE_TAGS = new Set([
  'text-generation',
  'image-text-to-text',
  'any-to-any',
  'visual-question-answering',
  'question-answering',
  'conversational',
]);

const EXCLUDE_PIPELINE_TAGS = new Set([
  'text-to-image', 'image-to-image', 'image-to-video', 'text-to-video',
  'text-to-speech', 'audio-to-audio', 'audio-to-text',
  'feature-extraction', 'sentence-similarity', 'sentence-transformers',
  'text-ranking', 'text-classification', 'fill-mask',
  'table-question-answering', 'translation', 'summarization',
  'zero-shot-classification', 'token-classification',
  'object-detection', 'image-segmentation', 'depth-estimation',
  'video-classification', 'reinforcement-learning',
]);

function classifyModel(profile) {
  const tag = profile.pipeline_tag;

  // 非聊天用途
  if (EXCLUDE_PIPELINE_TAGS.has(tag)) return tag;

  // 聊天用途
  if (CHAT_PIPELINE_TAGS.has(tag)) {
    // 细分 VL 模型
    if (tag === 'image-text-to-text') return 'vl-chat';
    if (tag === 'any-to-any') return 'omni-chat';
    return 'chat';
  }

  // 未知 pipeline_tag，从 tags 推断
  const tags = (profile.tags || []).map(t => t.toLowerCase());
  if (tags.includes('chat') || tags.includes('conversational')) return 'chat';
  if (tags.includes('embedding') || tags.includes('sentence-transformers')) return 'embedding';

  return `unknown:${tag}`;
}

function inferFromName(sfId) {
  const lower = sfId.toLowerCase();
  if (/bge-|bce-|embed/.test(lower)) return 'embedding';
  if (/rerank/.test(lower)) return 'reranker';
  if (/tts|cosyvoice|speech/.test(lower)) return 'text-to-speech';
  if (/asr|sensevoice/.test(lower)) return 'audio-to-text';
  if (/image|kolors|flux|diffusion/.test(lower)) return 'text-to-image';
  if (/ocr/.test(lower)) return 'ocr';
  if (/instruct|chat/.test(lower)) return 'chat';
  return 'unknown';
}

// ==================== 批量执行 ====================

async function batchRun(items, fn, concurrency) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    process.stderr.write(`  进度: ${results.length}/${items.length}\r`);
    if (i + concurrency < items.length) await sleep(DELAY_MS);
  }
  return results;
}

// ==================== 主流程 ====================

async function main() {
  console.error('📡 获取 SiliconFlow 模型列表...');
  const sfRes = await fetch('https://api.siliconflow.cn/v1/models', {
    headers: { Authorization: `Bearer ${SF_API_KEY}` },
    signal: AbortSignal.timeout(10000),
  });
  const sfData = await sfRes.json();
  const sfModels = sfData.data.map(m => m.id);
  console.error(`✅ ${sfModels.length} 个模型\n`);

  // 检查缓存命中数
  const cached = sfModels.filter(id => loadCache(id));
  console.error(`💾 缓存命中: ${cached.length}/${sfModels.length}`);
  console.error(`🔍 需查询: ${sfModels.length - cached.length}\n`);

  console.error(`🔍 构建模型画像 (${CONCURRENCY} 并发)...\n`);
  const profiles = await batchRun(sfModels, buildProfile, CONCURRENCY);

  // ==================== 统计 ====================
  const found = profiles.filter(p => p.found);
  const notFound = profiles.filter(p => !p.found);

  const byCat = {};
  for (const p of profiles) {
    const cat = p.category || 'unknown';
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(p);
  }

  const chatModels = profiles.filter(p =>
    ['chat', 'vl-chat', 'omni-chat'].includes(p.category)
  );

  // ==================== 输出 ====================
  console.log('\n' + '='.repeat(80));
  console.log('📊 模型画像总览');
  console.log('='.repeat(80));
  console.log(`总模型: ${sfModels.length} | HF匹配: ${found.length} | 未匹配: ${notFound.length}`);
  console.log(`聊天模型: ${chatModels.length} | 非聊天: ${sfModels.length - chatModels.length}`);
  console.log('');

  // 按分类输出
  const CAT_LABELS = {
    'chat': '💬 纯聊天模型',
    'vl-chat': '👁️ 视觉语言模型',
    'omni-chat': '🌐 全模态模型',
    'text-to-image': '🎨 图像生成',
    'image-to-image': '🖼️ 图像编辑',
    'text-to-video': '🎬 视频生成',
    'image-to-video': '🎬 图像→视频',
    'text-to-speech': '🔊 语音合成',
    'audio-to-text': '🎤 语音识别',
    'audio-to-audio': '🎵 音频处理',
    'feature-extraction': '📐 Embedding',
    'sentence-similarity': '📐 Embedding (相似度)',
    'text-ranking': '📊 Reranker',
    'text-classification': '📊 分类',
    'translation': '🌐 翻译',
    'ocr': '👁️ OCR',
    'reranker': '📊 Reranker',
    'embedding': '📐 Embedding',
  };

  for (const [cat, models] of Object.entries(byCat).sort((a, b) => b[1].length - a[1].length)) {
    const label = CAT_LABELS[cat] || `❓ ${cat}`;
    console.log(`\n${label} (${models.length} 个):`);
    for (const m of models) {
      const info = [];
      if (m.parameters) info.push(formatParams(m.parameters));
      if (m.contextLength) info.push(`${formatCtx(m.contextLength)} ctx`);
      if (m.maxOutput) info.push(`${formatCtx(m.maxOutput)} out`);
      if (m.model_type) info.push(m.model_type);
      if (m.license) info.push(m.license);
      console.log(`  ${m.sfId}  [${info.join(' | ')}]`);
    }
  }

  // 未匹配
  if (notFound.length > 0) {
    console.log(`\n❓ 未匹配 (${notFound.length}):`);
    for (const m of notFound) {
      console.log(`  ${m.sfId} → 推断: ${m.category}`);
    }
  }

  // ==================== 保存 JSON ====================
  const catalog = {
    version: 2,
    generatedAt: new Date().toISOString(),
    platform: 'siliconflow',
    summary: {
      total: sfModels.length,
      matched: found.length,
      notFound: notFound.length,
      chatModels: chatModels.length,
      byCategory: Object.fromEntries(
        Object.entries(byCat).map(([k, v]) => [k, v.length])
      ),
    },
    profiles,
  };

  writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));
  console.log(`\n💾 模型目录已保存: ${CATALOG_PATH}`);
  console.log(`💾 缓存目录: ${CACHE_DIR}`);
}

function formatParams(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
  return n.toLocaleString();
}

function formatCtx(n) {
  if (n >= 1024) return `${Math.round(n / 1024)}K`;
  return `${n}`;
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
