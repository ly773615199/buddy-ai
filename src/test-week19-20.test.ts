/**
 * Phase C Week 19-20 测试 — 性能模块 + 上线就绪 (vitest)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LRUCache } from './perf/cache.js';
import { LaunchReadiness } from './launch/readiness.js';

describe('Phase C Week 19-20 — 性能模块 + 上线就绪', () => {
  // ══════════════════════════════════════════
  // 1. LRUCache — LRU 缓存
  // ══════════════════════════════════════════

  describe('LRU 缓存', () => {
    it('基本 set/get 和 LRU 淘汰', () => {
      const cache = new LRUCache<string>({ maxSize: 3, ttlMs: 5000 });

      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');
      expect(cache.size).toBe(3);
      expect(cache.get('a')).toBe('1');
      expect(cache.get('b')).toBe('2');

      // LRU 淘汰 — get(a) 和 get(b) 使其变为最近使用，c 变为最旧被淘汰
      cache.set('d', '4');
      expect(cache.size).toBe(3);
      expect(cache.get('c')).toBeUndefined();
      expect(cache.get('a')).toBe('1');
      expect(cache.get('d')).toBe('4');

      cache.clear();
    });

    it('has 方法', () => {
      const cache = new LRUCache<string>({ maxSize: 3, ttlMs: 5000 });
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');

      expect(cache.has('a')).toBe(true); // has() 调用 get()，将 a 移至最新
      cache.set('d', '4'); // evicts b (has 后 a 移至最新，b 变最旧)
      expect(cache.has('b')).toBe(false);
      expect(cache.has('a')).toBe(true);

      cache.clear();
    });

    it('delete 方法', () => {
      const cache = new LRUCache<string>({ maxSize: 3, ttlMs: 5000 });
      cache.set('a', '1');
      cache.delete('a');
      expect(cache.has('a')).toBe(false);

      cache.clear();
    });

    it('统计信息', () => {
      const cache = new LRUCache<string>({ maxSize: 3, ttlMs: 5000 });
      cache.set('a', '1');
      cache.set('b', '2');

      const stats = cache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(3);

      cache.clear();
    });

    it('clear 后 size=0', () => {
      const cache = new LRUCache<string>({ maxSize: 3, ttlMs: 5000 });
      cache.set('a', '1');
      cache.clear();
      expect(cache.size).toBe(0);
    });

    it('TTL 过期', async () => {
      const ttlCache = new LRUCache<number>({ maxSize: 10, ttlMs: 50 });
      ttlCache.set('x', 42);
      expect(ttlCache.get('x')).toBe(42);

      await new Promise(r => setTimeout(r, 60));
      expect(ttlCache.get('x')).toBeUndefined();
      expect(ttlCache.purgeExpired()).toBe(0); // already deleted by get
    });
  });

  // ══════════════════════════════════════════
  // 2. LaunchReadiness — 上线就绪检查
  // ══════════════════════════════════════════

  describe('上线就绪检查', () => {
    let readiness: LaunchReadiness;

    beforeAll(() => {
      readiness = new LaunchReadiness();
    });

    it('全量检查 — 检查项>0，ready 是 boolean', async () => {
      const report = await readiness.runAll();
      expect(report.checks.length).toBeGreaterThan(0);
      expect(typeof report.ready).toBe('boolean');
      expect(report.passed).toBeGreaterThan(0);
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('各类别检查有效', async () => {
      const categories: Array<'environment' | 'config' | 'security' | 'performance' | 'data'> =
        ['environment', 'config', 'security', 'performance', 'data'];

      for (const cat of categories) {
        const catChecks = await readiness.runCategory(cat);
        expect(catChecks.length).toBeGreaterThan(0);
        for (const c of catChecks) {
          expect(['pass', 'warn', 'fail']).toContain(c.status);
        }
      }
    });

    it('报告格式化包含标题和分类', async () => {
      const report = await readiness.runAll();
      const formatted = readiness.formatReport(report);
      expect(formatted).toContain('Buddy');
      expect(formatted.includes('就绪') || formatted.includes('未就绪')).toBe(true);
      expect(formatted).toContain('环境');
      expect(formatted).toContain('安全');
    });

    it('Node.js 版本检查存在且通过', async () => {
      const envChecks = await readiness.runCategory('environment');
      const nodeCheck = envChecks.find(c => c.name === 'Node.js 版本');
      expect(nodeCheck).toBeDefined();
      expect(nodeCheck?.status).toBe('pass');
    });

    it('所有安全检查通过', async () => {
      const secChecks = await readiness.runCategory('security');
      for (const c of secChecks) {
        expect(c.status).toBe('pass');
      }
    });
  });
});
