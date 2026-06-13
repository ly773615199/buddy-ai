/**
 * LLM 运行时自动翻译引擎（V3 — 静态文件优先 + LLM 兜底）
 *
 * 架构：静态 JSON 文件 → 术语表 → 内存缓存 → localStorage 缓存 → LLM（安全网）
 *
 * 向后兼容：保留所有原有导出
 */

import {
  buildSystemPrompt,
  buildUserPrompt,
  parseTranslationResponse,
  LANG_NAMES,
} from './translate-prompt';

// ==================== 静态翻译文件 ====================

/** 静态翻译文件缓存：lang → { zhText: translatedText } */
const staticTranslations: Record<string, Record<string, string>> = {};

/** 术语表：zhText → { lang: translatedText } */
let glossary: Record<string, Record<string, string>> = {};

/** 是否已初始化 */
let initialized = false;

/**
 * 加载静态翻译文件和术语表
 * 在 index.ts 中调用，启动时执行一次
 */
export async function loadStaticTranslations(): Promise<void> {
  if (initialized) return;
  initialized = true;

  // 加载术语表
  try {
    const glossaryModule = await import('./glossary.json');
    glossary = glossaryModule.default || glossaryModule;
  } catch {
    console.warn('[i18n] Failed to load glossary.json');
  }

  // 加载各语言静态翻译文件
  const languages = ['en', 'ja', 'ko', 'fr', 'de', 'es'];
  for (const lang of languages) {
    try {
      const module = await import(`./locales/${lang}.json`);
      const data = module.default || module;
      // 过滤掉 _comment 字段
      const filtered: Record<string, string> = {};
      for (const [key, value] of Object.entries(data)) {
        if (key !== '_comment' && typeof value === 'string') {
          filtered[key] = value;
        }
      }
      staticTranslations[lang] = filtered;
    } catch {
      // 文件不存在是正常的（可能还没生成翻译）
      staticTranslations[lang] = {};
    }
  }
}

/**
 * 从术语表查找翻译
 */
function lookupGlossary(text: string, lang: string): string | undefined {
  const entry = glossary[text];
  if (!entry) return undefined;
  return entry[lang];
}

/**
 * 从静态翻译文件查找翻译
 */
function lookupStatic(text: string, lang: string): string | undefined {
  const translations = staticTranslations[lang];
  if (!translations) return undefined;
  return translations[text];
}

// ==================== 原有引擎逻辑 ====================

const CACHE_KEY = 'buddy_i18n_cache';

/** 同步内存缓存（从 localStorage 加载） */
const cache: Record<string, string> = (() => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
})();

function cacheKey(text: string, lang: string): string {
  return `${lang}::${text}`;
}

function persistCache(): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch { /* quota exceeded, ignore */ }
}

/** 判断字符串是否包含中文 */
function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}

/** 判断是否是中文语言 */
function isChineseLang(lang: string): boolean {
  return lang === 'zh-CN' || lang === 'zh' || lang.startsWith('zh-');
}

/** 缓存中的翻译数量 */
export function getCacheSize(): number {
  return Object.keys(cache).length;
}

/** 清除翻译缓存 */
export function clearTranslationCache(): void {
  for (const key of Object.keys(cache)) {
    delete cache[key];
  }
  localStorage.removeItem(CACHE_KEY);
  _apiToken = null; // 重置 token 缓存，避免测试间干扰
}

/** 导出缓存（调试用） */
export function exportCache(): Record<string, string> {
  return { ...cache };
}

// ==================== 翻译完成回调 ====================

/** 翻译完成回调（用于触发 React 重渲染） */
let onTranslated: ((lang: string) => void) | null = null;
export function setTranslationCallback(cb: (lang: string) => void): void {
  onTranslated = cb;
}

// ==================== LLM 翻译调用 ====================

/** 获取 API Token（从 /api/ws-token 缓存） */
let _apiToken: string | null = null;
async function getApiToken(): Promise<string> {
  if (_apiToken) return _apiToken;
  try {
    const res = await fetch('/api/ws-token');
    const data = await res.json();
    _apiToken = data.token || '';
  } catch {
    _apiToken = '';
  }
  return _apiToken;
}

/** 测试用：预设 API Token，跳过 ws-token 请求 */
export function setApiTokenForTesting(token: string): void {
  _apiToken = token;
}

/** 翻译请求队列（合并同一帧内的多个请求） */
let pendingBatch: Array<{
  text: string;
  lang: string;
  resolve: (v: string) => void;
}> = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;
const BATCH_DELAY_MS = 50;

async function flushBatch(): Promise<void> {
  const batch = pendingBatch;
  pendingBatch = [];
  batchTimer = null;

  if (batch.length === 0) return;

  const lang = batch[0].lang;
  const texts = batch.map(b => b.text);

  try {
    // 构建相关术语表（只包含本次翻译涉及的术语）
    const relevantGlossary: Record<string, string> = {};
    for (const text of texts) {
      const entry = glossary[text];
      if (entry?.[lang]) relevantGlossary[text] = entry[lang];
    }

    const token = await getApiToken();
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        texts,
        targetLang: lang,
        systemPrompt: `You are a professional UI translator for a pet AI companion app called "Buddy". Keep translations SHORT and suitable for UI labels. Maintain a warm, friendly tone. Preserve emoji prefixes. For technical terms, keep English. For placeholders ({{count}}), keep unchanged. Output ONLY the translation.`,
        glossary: Object.keys(relevantGlossary).length > 0 ? relevantGlossary : undefined,
      }),
    });

    if (!res.ok) {
      throw new Error(`Translation API returned ${res.status}`);
    }

    const data = await res.json();
    const translations: string[] = data.translations || [];

    for (let i = 0; i < batch.length; i++) {
      const translated = translations[i] || batch[i].text;
      const key = cacheKey(batch[i].text, lang);
      cache[key] = translated;
      batch[i].resolve(translated);
    }

    persistCache();
    if (onTranslated) onTranslated(lang);
  } catch (err) {
    console.warn('[i18n] Translation batch failed:', err);
    for (const item of batch) {
      item.resolve(item.text);
    }
  }
}

// ==================== 核心翻译函数 ====================

/**
 * 核心翻译函数（异步）— 三级查找：术语表 → 静态文件 → LLM
 */
export async function translate(text: string, targetLang: string): Promise<string> {
  if (!text || isChineseLang(targetLang)) return text;
  if (!hasChinese(text)) return text;

  // 1. 术语表优先
  const glossaryResult = lookupGlossary(text, targetLang);
  if (glossaryResult) {
    const key = cacheKey(text, targetLang);
    cache[key] = glossaryResult;
    persistCache();
    return glossaryResult;
  }

  // 2. 静态翻译文件
  const staticResult = lookupStatic(text, targetLang);
  if (staticResult) {
    const key = cacheKey(text, targetLang);
    cache[key] = staticResult;
    persistCache();
    return staticResult;
  }

  // 3. 内存/localStorage 缓存
  const key = cacheKey(text, targetLang);
  if (cache[key]) return cache[key];

  // 4. LLM 兜底（加入批量队列）
  return new Promise<string>(resolve => {
    pendingBatch.push({ text, lang: targetLang, resolve });
    if (batchTimer) clearTimeout(batchTimer);
    batchTimer = setTimeout(flushBatch, BATCH_DELAY_MS);
  });
}

/**
 * 同步翻译（术语表 → 静态文件 → 缓存）
 * 用于 t() 的同步路径
 */
export function translateSync(text: string, targetLang: string): string {
  if (!text || isChineseLang(targetLang)) return text;
  if (!hasChinese(text)) return text;

  // 1. 术语表
  const glossaryResult = lookupGlossary(text, targetLang);
  if (glossaryResult) return glossaryResult;

  // 2. 静态翻译文件
  const staticResult = lookupStatic(text, targetLang);
  if (staticResult) return staticResult;

  // 3. 缓存
  const key = cacheKey(text, targetLang);
  return cache[key] || text;
}

/**
 * 预热：批量翻译一组文本
 */
export async function warmup(texts: string[], targetLang: string): Promise<void> {
  if (isChineseLang(targetLang)) return;

  // 过滤出需要翻译的文本（术语表 + 静态文件 + 缓存都未命中的）
  const uncached = texts.filter(t => {
    if (!t || !hasChinese(t)) return false;
    if (lookupGlossary(t, targetLang)) return false;
    if (lookupStatic(t, targetLang)) return false;
    if (cache[cacheKey(t, targetLang)]) return false;
    return true;
  });

  if (uncached.length === 0) return;

  try {
    // 构建相关术语表
    const relevantGlossary: Record<string, string> = {};
    for (const text of uncached) {
      const entry = glossary[text];
      if (entry?.[targetLang]) relevantGlossary[text] = entry[targetLang];
    }

    const token = await getApiToken();
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        texts: uncached,
        targetLang,
        systemPrompt: `You are a professional UI translator for a pet AI companion app called "Buddy". Keep translations SHORT and suitable for UI labels. Maintain a warm, friendly tone. Preserve emoji prefixes. For technical terms, keep English. For placeholders ({{count}}), keep unchanged. Output ONLY the translation.`,
        glossary: Object.keys(relevantGlossary).length > 0 ? relevantGlossary : undefined,
      }),
    });

    if (!res.ok) return;

    const data = await res.json();
    const translations: string[] = data.translations || [];

    for (let i = 0; i < uncached.length; i++) {
      const key = cacheKey(uncached[i], targetLang);
      cache[key] = translations[i] || uncached[i];
    }

    persistCache();
  } catch (err) {
    console.warn('[i18n] Warmup failed:', err);
  }
}
