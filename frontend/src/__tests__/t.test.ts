/**
 * i18n/t.ts 测试
 * 覆盖：interpolate 占位符替换、中文直通、t 函数行为
 */
import { describe, it, expect, vi } from 'vitest';

// 直接测试 interpolate 逻辑（从 t.ts 中提取）
function interpolate(str: string, vars?: Record<string, unknown>): string {
  if (!vars) return str;
  return str.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    vars[key] !== undefined ? String(vars[key]) : `{{${key}}}`
  );
}

describe('t.ts interpolate', () => {
  it('无变量时返回原字符串', () => {
    expect(interpolate('你好世界')).toBe('你好世界');
  });

  it('替换单个变量', () => {
    expect(interpolate('你好 {{name}}', { name: 'Buddy' })).toBe('你好 Buddy');
  });

  it('替换多个变量', () => {
    expect(interpolate('{{greeting}} {{name}}!', { greeting: '你好', name: 'Buddy' })).toBe('你好 Buddy!');
  });

  it('变量不存在时保留占位符', () => {
    expect(interpolate('你好 {{name}}')).toBe('你好 {{name}}');
    expect(interpolate('你好 {{name}}', {})).toBe('你好 {{name}}');
  });

  it('数字变量转为字符串', () => {
    expect(interpolate('数量: {{count}}', { count: 42 })).toBe('数量: 42');
  });

  it('空字符串变量', () => {
    expect(interpolate('值: {{v}}', { v: '' })).toBe('值: ');
  });

  it('多次出现同一变量', () => {
    expect(interpolate('{{name}} 和 {{name}}', { name: 'Buddy' })).toBe('Buddy 和 Buddy');
  });

  it('多个不同变量', () => {
    const result = interpolate('{{a}} {{b}} {{c}}', { a: '1', b: '2', c: '3' });
    expect(result).toBe('1 2 3');
  });
});

describe('t.ts 中文直通逻辑', () => {
  // 模拟 t 函数的中文判断
  function isChineseLang(lang: string): boolean {
    return lang === 'zh-CN' || lang === 'zh' || lang.startsWith('zh-');
  }

  function hasChinese(text: string): boolean {
    return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
  }

  it('zh-CN 是中文', () => {
    expect(isChineseLang('zh-CN')).toBe(true);
    expect(isChineseLang('zh')).toBe(true);
    expect(isChineseLang('zh-TW')).toBe(true);
  });

  it('en 不是中文', () => {
    expect(isChineseLang('en')).toBe(false);
    expect(isChineseLang('ja')).toBe(false);
  });

  it('中文文本检测', () => {
    expect(hasChinese('你好世界')).toBe(true);
    expect(hasChinese('hello 你好')).toBe(true);
    expect(hasChinese('hello world')).toBe(false);
    expect(hasChinese('12345')).toBe(false);
  });
});
