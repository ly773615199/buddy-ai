/**
 * i18n 配置 — V3（静态文件优先 + LLM 安全网）
 *
 * 架构：预翻译 JSON → 术语表 → LLM 兜底
 * Vite 插件自动提取中文，组件无需手动 t() 包裹
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  translate,
  translateSync,
  warmup,
  clearTranslationCache,
  getCacheSize,
  exportCache,
  setTranslationCallback,
  loadStaticTranslations,
} from './translate-engine';
// Re-export t from t.ts (供 useTranslation hook 等向后兼容场景使用)
export { t } from './t';

// 全量语言列表（所有可选语言）
export const ALL_LANGUAGES = [
  { code: 'zh-CN', label: '中文', flag: '🇨🇳' },
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
  { code: 'ko', label: '한국어', flag: '🇰🇷' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'es', label: 'Espanol', flag: '🇪🇸' },
  { code: 'pt', label: 'Portugues', flag: '🇵🇹' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦' },
  { code: 'th', label: 'ไทย', flag: '🇹🇭' },
  { code: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
  { code: 'nl', label: 'Nederlands', flag: '🇳🇱' },
  { code: 'pl', label: 'Polski', flag: '🇵🇱' },
  { code: 'tr', label: 'Turkce', flag: '🇹🇷' },
] as const;

export type LangCode = string;

// 默认注册的语言（首次使用时写入 localStorage）
const DEFAULT_REGISTERED = ['zh-CN', 'en', 'ja', 'ko', 'fr', 'de', 'es'];

const REGISTERED_KEY = 'buddy_registered_languages';

/** 获取已注册的语言列表 */
export function getRegisteredLanguages(): typeof ALL_LANGUAGES[number][] {
  try {
    const stored = localStorage.getItem(REGISTERED_KEY);
    if (stored) {
      const codes: string[] = JSON.parse(stored);
      return codes
        .map(code => ALL_LANGUAGES.find(l => l.code === code))
        .filter(Boolean) as typeof ALL_LANGUAGES[number][];
    }
  } catch { /* ignore */ }
  // 首次：写入默认注册列表
  localStorage.setItem(REGISTERED_KEY, JSON.stringify(DEFAULT_REGISTERED));
  return ALL_LANGUAGES.filter(l => (DEFAULT_REGISTERED as readonly string[]).includes(l.code));
}

/** 注册新语言 */
export function registerLanguage(code: string): void {
  const lang = ALL_LANGUAGES.find(l => l.code === code);
  if (!lang) return;
  const registered = getRegisteredLanguages().map(l => l.code);
  if (!registered.includes(code)) {
    registered.push(code);
    localStorage.setItem(REGISTERED_KEY, JSON.stringify(registered));
  }
}

/** 取消注册语言（不能移除中文） */
export function unregisterLanguage(code: string): void {
  if (code === 'zh-CN' || code === 'zh') return;
  const registered = getRegisteredLanguages().map(l => l.code);
  const filtered = registered.filter(c => c !== code);
  localStorage.setItem(REGISTERED_KEY, JSON.stringify(filtered));
}

/** 获取尚未注册的语言列表（供"添加语言"使用） */
export function getAvailableLanguages(): typeof ALL_LANGUAGES[number][] {
  const registeredCodes = new Set(getRegisteredLanguages().map(l => l.code));
  return ALL_LANGUAGES.filter(l => !registeredCodes.has(l.code));
}

// 向后兼容：SUPPORTED_LANGUAGES 现在是动态的
export const SUPPORTED_LANGUAGES = getRegisteredLanguages();

// 初始化 i18next
i18n
  .use(initReactI18next)
  .init({
    resources: {},
    lng: (localStorage.getItem('buddy_lang') as LangCode) || 'zh-CN',
    fallbackLng: 'zh-CN',
    interpolation: {
      escapeValue: false,
    },
  });

// 注册翻译完成回调 → 触发 React 重渲染
setTranslationCallback((lang: string) => {
  i18n.emit('languageChanged', lang);
});

// 启动时加载静态翻译文件 + 术语表
loadStaticTranslations();

/**
 * 切换语言（持久化 + 触发重渲染）
 */
export async function changeLanguage(lang: LangCode): Promise<void> {
  i18n.changeLanguage(lang);
  localStorage.setItem('buddy_lang', lang);

  if (lang !== 'zh-CN' && lang !== 'zh') {
    collectAndWarmup(lang);
  }
}

/**
 * 收集页面中的中文文本并预热翻译缓存
 */
function collectAndWarmup(lang: string): void {
  const texts = new Set<string>();

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent?.trim();
    if (text && /[\u4e00-\u9fff]/.test(text) && text.length < 100) {
      texts.add(text);
    }
  }

  document.querySelectorAll('[placeholder]').forEach(el => {
    const ph = el.getAttribute('placeholder');
    if (ph && /[\u4e00-\u9fff]/.test(ph)) texts.add(ph);
  });

  if (texts.size > 0) {
    warmup([...texts], lang);
  }
}

// 工具函数导出（向后兼容）
export { clearTranslationCache, getCacheSize, exportCache, loadStaticTranslations };
export default i18n;
