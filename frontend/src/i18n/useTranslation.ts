/**
 * useTranslation — 自定义 hook，接入 LLM 翻译引擎
 *
 * 用法：const { t } = useTranslation();
 * 然后：t('中文文本') → 自动翻译为当前语言
 *
 * 组件直接写中文作为 t() 的参数，无需维护翻译文件。
 */
import { useSyncExternalStore, useCallback } from 'react';
import i18n from 'i18next';
import { translateSync, translate } from './translate-engine';

// 语言变更订阅（供 useSyncExternalStore 使用）
let currentLang = i18n.language || 'zh-CN';
const listeners = new Set<() => void>();

i18n.on('languageChanged', (lng: string) => {
  currentLang = lng;
  listeners.forEach(fn => fn());
});

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function getSnapshot(): string {
  return currentLang;
}

/** 替换 {{变量名}} 占位符 */
function interpolate(str: string, vars?: Record<string, unknown>): string {
  if (!vars) return str;
  return str.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    vars[key] !== undefined ? String(vars[key]) : `{{${key}}}`
  );
}

export function useTranslation(): { t: (key: string, options?: Record<string, unknown>) => string; i18n: typeof i18n; lang: string } {
  const lang = useSyncExternalStore(subscribe, getSnapshot);

  const t = useCallback((key: string, options?: Record<string, unknown>): string => {
    // 中文模式：插值后返回
    if (lang === 'zh-CN' || lang === 'zh') {
      return interpolate(key, options);
    }

    // 非中文模式：同步从缓存读取（模板），再插值
    const cached = translateSync(key, lang);
    if (cached !== key) return interpolate(cached, options);

    // 缓存未命中：触发异步翻译（下次渲染生效）
    translate(key, lang);

    // 当前渲染返回原文插值（降级）
    return interpolate(key, options);
  }, [lang]);

  return { t, i18n, lang };
}
