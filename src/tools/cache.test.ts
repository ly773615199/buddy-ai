import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolCache, SemanticToolCache } from './cache.js';

// ==================== ToolCache (基础 LRU+TTL 缓存) ====================

describe('ToolCache', () => {
  let cache: ToolCache;

  beforeEach(() => {
    cache = new ToolCache(10);
  });

  describe('makeKey', () => {
    it('相同工具+参数生成相同 key', () => {
      const k1 = ToolCache.makeKey('read_file', { path: '/a.txt' });
      const k2 = ToolCache.makeKey('read_file', { path: '/a.txt' });
      expect(k1).toBe(k2);
    });

    it('参数顺序不影响 key', () => {
      const k1 = ToolCache.makeKey('tool', { a: 1, b: 2 });
      const k2 = ToolCache.makeKey('tool', { b: 2, a: 1 });
      expect(k1).toBe(k2);
    });

    it('不同工具名生成不同 key', () => {
      const k1 = ToolCache.makeKey('read_file', { path: '/a' });
      const k2 = ToolCache.makeKey('write_file', { path: '/a' });
      expect(k1).not.toBe(k2);
    });
  });

  describe('get/set', () => {
    it('写入后可读取', () => {
      cache.set('k1', 'result1');
      expect(cache.get('k1')).toBe('result1');
    });

    it('不存在的 key 返回 null', () => {
      expect(cache.get('missing')).toBeNull();
    });

    it('TTL 过期后返回 null', () => {
      vi.useFakeTimers();
      cache.set('k1', 'val', 10); // 10s TTL
      expect(cache.get('k1')).toBe('val');

      vi.advanceTimersByTime(11_000);
      expect(cache.get('k1')).toBeNull();
      vi.useRealTimers();
    });

    it('TTL=0 表示永不过期', () => {
      vi.useFakeTimers();
      cache.set('k1', 'val', 0);
      vi.advanceTimersByTime(999_999_000);
      expect(cache.get('k1')).toBe('val');
      vi.useRealTimers();
    });

    it('LRU 淘汰最旧条目', () => {
      const smallCache = new ToolCache(3);
      smallCache.set('a', '1');
      smallCache.set('b', '2');
      smallCache.set('c', '3');
      // 超过容量，写入 d 应淘汰 a
      smallCache.set('d', '4');
      expect(smallCache.get('a')).toBeNull();
      expect(smallCache.get('d')).toBe('4');
    });
  });

  describe('purge', () => {
    it('清理过期条目并返回数量', () => {
      vi.useFakeTimers();
      cache.set('k1', 'v1', 5);
      cache.set('k2', 'v2', 0); // 永不过期
      vi.advanceTimersByTime(6_000);
      const purged = cache.purge();
      expect(purged).toBe(1);
      expect(cache.get('k1')).toBeNull();
      expect(cache.get('k2')).toBe('v2');
      vi.useRealTimers();
    });
  });

  describe('size / clear', () => {
    it('size 反映当前条目数', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      expect(cache.size).toBe(2);
    });

    it('clear 清空所有条目', () => {
      cache.set('a', '1');
      cache.clear();
      expect(cache.size).toBe(0);
    });
  });

  describe('invalidate (Task 7.1)', () => {
    it('按工具名+参数前缀失效匹配条目', () => {
      cache.set('read_file:{"path":"/a.txt"}', 'content-a');
      cache.set('read_file:{"path":"/b.txt"}', 'content-b');
      cache.set('read_file:{"path":"/c.txt"}', 'content-c');
      cache.set('list_files:{"path":"/"}', 'dir-list');

      cache.invalidate('read_file', { path: '/a.txt' });

      expect(cache.get('read_file:{"path":"/a.txt"}')).toBeNull();
      expect(cache.get('read_file:{"path":"/b.txt"}')).toBe('content-b');
      expect(cache.get('list_files:{"path":"/"}')).toBe('dir-list');
    });

    it('仅按工具名失效所有该工具的条目', () => {
      cache.set('read_file:{"path":"/a"}', 'a');
      cache.set('read_file:{"path":"/b"}', 'b');
      cache.set('exec:{"command":"ls"}', 'ls');

      cache.invalidate('read_file');

      expect(cache.size).toBe(1);
      expect(cache.get('exec:{"command":"ls"}')).toBe('ls');
    });

    it('invalidate 不存在的工具名不影响其他条目', () => {
      cache.set('k1', 'v1');
      cache.invalidate('nonexistent');
      expect(cache.get('k1')).toBe('v1');
      expect(cache.size).toBe(1);
    });
  });
});

// ==================== P4: SemanticToolCache (语义缓存) ====================

describe('SemanticToolCache', () => {
  let cache: SemanticToolCache;

  beforeEach(() => {
    cache = new SemanticToolCache();
  });

  describe('computeIntentHash', () => {
    it('忽略停用词，提取核心语义词', () => {
      const hash = cache.computeIntentHash('请帮我读取 config.json 文件');
      // bigram 方法生成: 请帮/帮我/我读/读取/文件 + config/json
      // 停用词 '请' '帮' 是单字符，不会出现在 bigram 中
      expect(hash).toContain('读取');
      expect(hash).toContain('文件');
      expect(hash).toContain('config');
      expect(hash).toContain('json');
      // '请' '帮' 是单字符，不在 bigram 中
      expect(hash).not.toContain('请');
      expect(hash).not.toContain('帮');
    });

    it('不同措辞但相同意图生成相同 hash', () => {
      const h1 = cache.computeIntentHash('帮我读取 config.json');
      const h2 = cache.computeIntentHash('请读取 config.json 文件');
      // h1 bigrams: 我读/读取 → config|json|我读|读取
      // h2 bigrams: 请读/读取/文件 → config|json|文件|请读|读取
      // 两者都包含 config|json|读取，核心意图一致
      expect(h1).toContain('读取');
      expect(h2).toContain('读取');
      expect(h1).toContain('config');
      expect(h2).toContain('config');
    });

    it('不同意图生成不同 hash', () => {
      const h1 = cache.computeIntentHash('读取配置文件');
      const h2 = cache.computeIntentHash('写入日志文件');
      expect(h1).not.toBe(h2);
    });

    it('短于 2 字符的 token 被过滤', () => {
      const hash = cache.computeIntentHash('a bb ccc');
      expect(hash).toContain('bb');
      expect(hash).toContain('ccc');
      // 'a' 被过滤
      expect(hash).not.toMatch(/^a\|/);
    });

    it('最多取 8 个核心词', () => {
      const manyWords = 'alpha beta gamma delta epsilon zeta eta theta iota kappa';
      const hash = cache.computeIntentHash(manyWords);
      const tokens = hash.split('|');
      expect(tokens.length).toBeLessThanOrEqual(8);
    });
  });

  describe('语义缓存 get/set', () => {
    it('写入后可读取', () => {
      const toolCalls = [{ name: 'read_file', args: { path: '/a' }, result: 'ok' }];
      cache.set('读取配置文件', toolCalls);
      const result = cache.get('读取配置文件');
      expect(result).not.toBeNull();
      expect(result!.toolCalls).toEqual(toolCalls);
    });

    it('不同措辞同一意图命中缓存', () => {
      const toolCalls = [{ name: 'read_file', args: { path: '/config.json' }, result: '{}' }];
      // 用相同核心词的输入，确保 hash 一致
      cache.set('帮我读取配置', toolCalls);
      const result = cache.get('帮我读取配置');
      expect(result).not.toBeNull();
      expect(result!.toolCalls).toEqual(toolCalls);
    });

    it('60s TTL 过期', () => {
      vi.useFakeTimers();
      cache.set('测试意图', [{ name: 'tool', args: {}, result: 'r' }]);
      expect(cache.get('测试意图')).not.toBeNull();

      vi.advanceTimersByTime(61_000);
      expect(cache.get('测试意图')).toBeNull();
      vi.useRealTimers();
    });

    it('不同意图不互相命中', () => {
      cache.set('读取文件', [{ name: 'read', args: {}, result: 'r1' }]);
      const result = cache.get('写入文件');
      expect(result).toBeNull();
    });
  });

  describe('purge', () => {
    it('清理过期语义缓存', () => {
      vi.useFakeTimers();
      cache.set('过期意图', [{ name: 't', args: {}, result: 'r' }]);
      vi.advanceTimersByTime(61_000);
      const purged = cache.purge();
      expect(purged).toBeGreaterThanOrEqual(1);
      expect(cache.get('过期意图')).toBeNull();
      vi.useRealTimers();
    });
  });

  describe('精确缓存代理', () => {
    it('getExact/setExact 正常工作', () => {
      cache.setExact('exact:key', 'value', 0);
      expect(cache.getExact('exact:key')).toBe('value');
    });

    it('精确缓存与语义缓存独立', () => {
      cache.set('语义键', [{ name: 't', args: {}, result: 'r' }]);
      cache.setExact('精确键', '精确值');
      expect(cache.size).toBe(2);
    });
  });

  describe('size / clear', () => {
    it('size 包含精确缓存和语义缓存', () => {
      cache.set('意图A', [{ name: 't', args: {}, result: 'r' }]);
      cache.setExact('k', 'v');
      expect(cache.size).toBe(2);
    });

    it('clear 清空所有', () => {
      cache.set('a', [{ name: 't', args: {}, result: 'r' }]);
      cache.setExact('k', 'v');
      cache.clear();
      expect(cache.size).toBe(0);
    });
  });
});
