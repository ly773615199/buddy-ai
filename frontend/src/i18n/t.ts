/**
 * 独立 t 函数 — 供 Vite 插件自动注入
 *
 * 用法（由插件自动注入）：
 *   import { t } from '../i18n/t';
 *   <div>{t('中文文本')}</div>
 */
import { translateSync, translate } from './translate-engine';
import i18n from 'i18next';

/** 替换 {{变量名}} 占位符 */
function interpolate(str: string, vars?: Record<string, unknown>): string {
  if (!vars) return str;
  return str.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    vars[key] !== undefined ? String(vars[key]) : `{{${key}}}`
  );
}

/**
 * 翻译函数（同步路径为主）
 *
 * 中文模式 → 直接返回原文
 * 非中文模式 → 静态文件/缓存命中 → 返回翻译 / 未命中 → 触发异步翻译 + 返回原文
 */
export function t(key: string, options?: Record<string, unknown>): string {
  const lang = i18n.language || 'zh-CN';

  // 中文模式：插值后返回
  if (lang === 'zh-CN' || lang === 'zh') {
    return interpolate(key, options);
  }

  // 非中文模式：同步从缓存/静态文件读取
  const cached = translateSync(key, lang);
  if (cached !== key) return interpolate(cached, options);

  // 缓存未命中：触发异步翻译（下次渲染生效）
  translate(key, lang);

  // 当前渲染返回原文插值（降级）
  return interpolate(key, options);
}
