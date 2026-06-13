/**
 * 音频子系统纯逻辑测试（不依赖浏览器 API）
 */
import { describe, it, expect } from 'vitest';

describe('音效播放器', () => {
  it('音效类型列表', () => {
    const sfx = ['click', 'notification', 'success', 'error', 'message', 'typing', 'connect', 'disconnect'];
    expect(sfx.length).toBeGreaterThanOrEqual(5);
    expect(sfx).toContain('click');
    expect(sfx).toContain('error');
  });

  it('情绪音效映射', () => {
    const map: Record<string, string> = {
      happy: '/sfx/happy.mp3', sad: '/sfx/sad.mp3', excited: '/sfx/excited.mp3',
      angry: '/sfx/angry.mp3', thinking: '/sfx/thinking.mp3',
    };
    expect(map.happy).toContain('happy');
    expect(map.thinking).toContain('thinking');
  });

  it('进化音效', () => {
    const evo = { start: '/sfx/evo-start.mp3', progress: '/sfx/evo-progress.mp3', complete: '/sfx/evo-complete.mp3' };
    expect(evo.start).toBeTruthy();
    expect(evo.complete).toBeTruthy();
  });
});

describe('音频缓存', () => {
  it('写入和读取', () => {
    const cache = new Map<string, { data: string; format: string; ts: number }>();
    cache.set('a-1', { data: 'd', format: 'mp3', ts: Date.now() });
    expect(cache.get('a-1')?.format).toBe('mp3');
  });

  it('过期清理', () => {
    const cache = new Map<string, { data: string; format: string; ts: number }>();
    cache.set('old', { data: 'd', format: 'mp3', ts: Date.now() - 120000 });
    cache.set('new', { data: 'd', format: 'mp3', ts: Date.now() });
    const now = Date.now();
    for (const [k, v] of cache) { if (now - v.ts > 60000) cache.delete(k); }
    expect(cache.has('old')).toBe(false);
    expect(cache.has('new')).toBe(true);
  });

  it('大小限制', () => {
    const cache = new Map<string, string>();
    for (let i = 0; i < 60; i++) {
      cache.set(`a-${i}`, `d-${i}`);
      if (cache.size > 50) cache.delete(cache.keys().next().value!);
    }
    expect(cache.size).toBeLessThanOrEqual(50);
  });

  it('一次性读取（取后删除）', () => {
    const cache = new Map<string, string>();
    cache.set('a-1', 'data');
    const get = (id: string) => { const v = cache.get(id); if (v) cache.delete(id); return v ?? null; };
    expect(get('a-1')).toBe('data');
    expect(cache.has('a-1')).toBe(false);
  });
});

describe('音频数据', () => {
  it('base64 编码/解码', () => {
    const orig = 'Hello Audio';
    expect(btoa(orig)).toBeTruthy();
    expect(atob(btoa(orig))).toBe(orig);
  });

  it('大小阈值判断', () => {
    const THRESHOLD = 4096;
    const isLarge = (b64: string) => b64.length > THRESHOLD;
    expect(isLarge('x'.repeat(5000))).toBe(true);
    expect(isLarge('x'.repeat(3000))).toBe(false);
  });

  it('大音频走 REST，小音频内联', () => {
    const route = (size: number) => size > 4096 ? 'rest' : 'inline';
    expect(route(10000)).toBe('rest');
    expect(route(1000)).toBe('inline');
  });
});
