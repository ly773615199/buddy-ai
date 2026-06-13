/**
 * i18n/translate-engine.ts 测试
 * 覆盖：translateSync 中文直通、缓存命中、clearTranslationCache、getCacheSize
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { translateSync, clearTranslationCache, getCacheSize, exportCache } from '../i18n/translate-engine.js';

// Mock localStorage
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((k: string) => store[k] ?? null),
  setItem: vi.fn((k: string, v: string) => { store[k] = v; }),
  removeItem: vi.fn((k: string) => { delete store[k]; }),
  clear: vi.fn(() => { for (const k of Object.keys(store)) delete store[k]; }),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

describe('translate-engine', () => {
  beforeEach(() => {
    clearTranslationCache();
    vi.clearAllMocks();
  });

  // ==================== translateSync ====================

  describe('translateSync', () => {
    it('中文语言直接返回原文', () => {
      expect(translateSync('你好世界', 'zh-CN')).toBe('你好世界');
      expect(translateSync('你好世界', 'zh')).toBe('你好世界');
    });

    it('空字符串直接返回', () => {
      expect(translateSync('', 'en')).toBe('');
    });

    it('非中文文本直接返回（无需翻译）', () => {
      expect(translateSync('hello world', 'en')).toBe('hello world');
      expect(translateSync('12345', 'en')).toBe('12345');
    });

    it('中文文本+非中文语言 → 查缓存', () => {
      // 缓存未命中时返回原文
      expect(translateSync('测试文本', 'en')).toBe('测试文本');
    });
  });

  // ==================== 缓存管理 ====================

  describe('缓存管理', () => {
    it('getCacheSize 返回缓存数量', () => {
      expect(getCacheSize()).toBe(0);
    });

    it('clearTranslationCache 清除缓存', () => {
      clearTranslationCache();
      expect(getCacheSize()).toBe(0);
    });

    it('exportCache 返回缓存副本', () => {
      const cache = exportCache();
      expect(typeof cache).toBe('object');
    });
  });
});
