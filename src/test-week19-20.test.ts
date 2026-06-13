/**
 * Phase C Week 19-20 测试 — 性能模块 + 上线就绪 (vitest)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LRUCache, RateLimiter, ConnectionPool } from './perf/cache.js';
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
  // 2. RateLimiter — 限流器
  // ══════════════════════════════════════════

  describe('限流器', () => {
    it('基本限流 — 超过 maxRequests 被拦截', () => {
      const limiter = new RateLimiter({ maxRequests: 3, windowMs: 1000 });

      const r1 = limiter.check('user1');
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(2);

      limiter.check('user1');
      limiter.check('user1');
      const r4 = limiter.check('user1');
      expect(r4.allowed).toBe(false);
      expect(r4.remaining).toBe(0);
    });

    it('不同 key 独立计数', () => {
      const limiter = new RateLimiter({ maxRequests: 3, windowMs: 1000 });
      limiter.check('user1');
      limiter.check('user1');
      limiter.check('user1');

      const r_other = limiter.check('user2');
      expect(r_other.allowed).toBe(true);
    });

    it('reset 后可再次请求', () => {
      const limiter = new RateLimiter({ maxRequests: 3, windowMs: 1000 });
      limiter.check('user1');
      limiter.check('user1');
      limiter.check('user1');

      limiter.reset('user1');
      const r_after_reset = limiter.check('user1');
      expect(r_after_reset.allowed).toBe(true);
    });

    it('过期清理', async () => {
      const shortLimiter = new RateLimiter({ maxRequests: 1, windowMs: 50 });
      shortLimiter.check('key');

      await new Promise(r => setTimeout(r, 60));
      expect(shortLimiter.purgeExpired()).toBe(1);
    });
  });

  // ══════════════════════════════════════════
  // 3. ConnectionPool — 连接池
  // ══════════════════════════════════════════

  describe('连接池', () => {
    it('获取和归还连接', async () => {
      let connId = 0;
      const pool = new ConnectionPool<{ id: number }>({
        maxConnections: 3,
        create: async () => ({ id: ++connId }),
        destroy: async () => {},
        idleTimeoutMs: 1000,
      });

      const c1 = await pool.acquire();
      expect(c1.id).toBe(1);
      const c2 = await pool.acquire();
      expect(c2.id).toBe(2);

      const poolStats = pool.getStats();
      expect(poolStats.inUse).toBe(2);
      expect(poolStats.available).toBe(0);

      await pool.release(c1);
      const statsAfterRelease = pool.getStats();
      expect(statsAfterRelease.available).toBe(1);

      // 复用连接
      const c3 = await pool.acquire();
      expect(c3.id).toBe(1);

      await pool.release(c2);
      await pool.release(c3);
      await pool.shutdown();
    });

    it('池满时抛出错误', async () => {
      let connId = 0;
      const pool = new ConnectionPool<{ id: number }>({
        maxConnections: 3,
        create: async () => ({ id: ++connId }),
        destroy: async () => {},
        idleTimeoutMs: 1000,
      });

      const c1 = await pool.acquire();
      const c2 = await pool.acquire();
      const c3 = await pool.acquire();

      try {
        await pool.acquire();
        expect(true).toBe(false); // should not reach here
      } catch (e: any) {
        expect(e.message).toContain('连接池已满');
      }

      await pool.release(c1);
      await pool.release(c2);
      await pool.release(c3);
      await pool.shutdown();
    });

    it('shutdown 后 available=0', async () => {
      let connId = 0;
      const pool = new ConnectionPool<{ id: number }>({
        maxConnections: 3,
        create: async () => ({ id: ++connId }),
        destroy: async () => {},
        idleTimeoutMs: 1000,
      });

      const c1 = await pool.acquire();
      await pool.release(c1);
      await pool.shutdown();
      expect(pool.getStats().available).toBe(0);
    });
  });

  // ══════════════════════════════════════════
  // 4. LaunchReadiness — 上线就绪检查
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
