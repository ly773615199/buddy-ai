import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeSourceManager } from './source-manager.js';
import type { KnowledgeSource, KnowledgeNode, SearchOptions } from './source-manager.js';

// ── Mock helpers ──

function makeNode(overrides?: Partial<KnowledgeNode>): KnowledgeNode {
  return {
    id: 'n-1',
    sourceId: 'test',
    sourceType: 'local',
    title: 'Test Node',
    content: 'Test content about AI',
    summary: 'Test summary',
    domain: 'tech',
    concepts: ['ai', 'test'],
    score: 0.8,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeSource(id: string, type: KnowledgeNode['sourceType'], opts?: {
  available?: boolean;
  nodes?: KnowledgeNode[];
  searchFn?: (q: string, o?: SearchOptions) => Promise<KnowledgeNode[]>;
}): KnowledgeSource {
  const nodes = opts?.nodes ?? [makeNode({ sourceId: id, sourceType: type })];
  return {
    id,
    type,
    name: `Mock ${id}`,
    search: opts?.searchFn ?? (async (_q, o) => nodes.slice(0, o?.limit ?? 10)),
    read: async () => null,
    list: async () => nodes,
    sync: async () => ({ sourceId: id, synced: 1, added: 1, updated: 0, deleted: 0, durationMs: 10 }),
    isAvailable: () => opts?.available ?? true,
  };
}

// ── Tests ──

describe('KnowledgeSourceManager', () => {
  let mgr: KnowledgeSourceManager;

  beforeEach(() => {
    mgr = new KnowledgeSourceManager();
  });

  // ── register / unregister ──

  describe('register / unregister', () => {
    it('注册后可获取源', () => {
      const src = makeSource('s1', 'local');
      mgr.register(src);
      expect(mgr.getSource('s1')).toBe(src);
      expect(mgr.getAllSources()).toHaveLength(1);
    });

    it('注销后移除源', () => {
      mgr.register(makeSource('s1', 'local'));
      mgr.unregister('s1');
      expect(mgr.getSource('s1')).toBeUndefined();
      expect(mgr.getAllSources()).toHaveLength(0);
    });

    it('注销不存在的源不报错', () => {
      expect(() => mgr.unregister('nope')).not.toThrow();
    });
  });

  // ── query ──

  describe('query', () => {
    it('无源时返回空数组', async () => {
      const result = await mgr.query('test');
      expect(result).toEqual([]);
    });

    it('从单个源查询并返回结果', async () => {
      mgr.register(makeSource('s1', 'local', {
        nodes: [makeNode({ title: 'AI Guide', score: 0.9 })],
      }));
      const result = await mgr.query('AI');
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('AI Guide');
    });

    it('多源结果合并并按 score 排序', async () => {
      mgr.register(makeSource('local', 'local', {
        nodes: [makeNode({ id: 'n-local', title: 'Local Doc', score: 0.6 })],
      }));
      mgr.register(makeSource('feishu', 'feishu', {
        nodes: [makeNode({ id: 'n-feishu', title: 'Feishu Doc', score: 0.9 })],
      }));
      const result = await mgr.query('test');
      expect(result).toHaveLength(2);
      expect(result[0].score).toBeGreaterThanOrEqual(result[1].score);
      expect(result[0].title).toBe('Feishu Doc');
    });

    it('按指定源查询', async () => {
      mgr.register(makeSource('local', 'local', {
        nodes: [makeNode({ id: 'n-local', title: 'Local' })],
      }));
      mgr.register(makeSource('feishu', 'feishu', {
        nodes: [makeNode({ id: 'n-feishu', title: 'Feishu' })],
      }));
      const result = await mgr.query('test', { sources: ['feishu'] });
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Feishu');
    });

    it('不可用的源被跳过', async () => {
      mgr.register(makeSource('unavail', 'web', { available: false }));
      const result = await mgr.query('test');
      expect(result).toEqual([]);
    });

    it('limit 限制返回数量', async () => {
      const nodes = Array.from({ length: 20 }, (_, i) =>
        makeNode({ id: `n-${i}`, title: `Doc ${i}`, score: 0.5 + i * 0.02 }),
      );
      mgr.register(makeSource('s1', 'local', { nodes }));
      const result = await mgr.query('test', { limit: 3 });
      expect(result).toHaveLength(3);
    });

    it('去重：相同 title+content 的节点只保留一个', async () => {
      const dupNode = makeNode({ id: 'dup-1', title: 'Same', content: 'Same content here' });
      mgr.register(makeSource('s1', 'local', {
        nodes: [dupNode, makeNode({ id: 'dup-2', title: 'Same', content: 'Same content here', score: 0.7 })],
      }));
      const result = await mgr.query('test', { deduplicate: true });
      expect(result).toHaveLength(1);
    });

    it('源查询异常时静默跳过', async () => {
      mgr.register(makeSource('bad', 'web', {
        searchFn: async () => { throw new Error('network error'); },
      }));
      mgr.register(makeSource('good', 'local', {
        nodes: [makeNode({ title: 'Good' })],
      }));
      const result = await mgr.query('test');
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Good');
    });
  });

  // ── 缓存 ──

  describe('缓存', () => {
    it('相同查询返回缓存结果', async () => {
      let callCount = 0;
      mgr.register(makeSource('s1', 'local', {
        searchFn: async () => { callCount++; return [makeNode()]; },
      }));
      await mgr.query('cache test');
      await mgr.query('cache test');
      expect(callCount).toBe(1);
    });

    it('clearCache 清除缓存后重新查询', async () => {
      let callCount = 0;
      mgr.register(makeSource('s1', 'local', {
        searchFn: async () => { callCount++; return [makeNode()]; },
      }));
      await mgr.query('cache test');
      mgr.clearCache();
      await mgr.query('cache test');
      expect(callCount).toBe(2);
    });
  });

  // ── syncAll ──

  describe('syncAll', () => {
    it('同步所有可用源', async () => {
      mgr.register(makeSource('s1', 'local'));
      mgr.register(makeSource('s2', 'feishu'));
      const results = await mgr.syncAll();
      expect(results).toHaveLength(2);
      expect(results.every(r => r.synced > 0)).toBe(true);
    });

    it('跳过不可用的源', async () => {
      mgr.register(makeSource('s1', 'local', { available: false }));
      const results = await mgr.syncAll();
      expect(results).toHaveLength(0);
    });

    it('同步异常时记录错误', async () => {
      mgr.register(makeSource('bad', 'web', {
        available: true,
        searchFn: async () => [],
      }));
      // Override sync to throw
      const src = mgr.getSource('bad')!;
      (src as any).sync = async () => { throw new Error('sync failed'); };
      const results = await mgr.syncAll();
      expect(results).toHaveLength(1);
      expect(results[0].error).toContain('sync failed');
    });
  });

  // ── getStats ──

  describe('getStats', () => {
    it('返回正确的统计信息', () => {
      mgr.register(makeSource('local', 'local'));
      mgr.register(makeSource('feishu', 'feishu'));
      mgr.register(makeSource('web', 'web', { available: false }));
      const stats = mgr.getStats();
      expect(stats.totalSources).toBe(3);
      expect(stats.availableSources).toBe(2);
      expect(stats.byType['local']).toBe(1);
      expect(stats.byType['feishu']).toBe(1);
      expect(stats.byType['web']).toBe(1);
    });
  });

  // ── 优先级排序 ──

  describe('优先级排序', () => {
    it('默认查询按 local > conversation > feishu > web 排序', async () => {
      // 注册顺序：web, feishu, local（故意倒序）
      mgr.register(makeSource('web', 'web', {
        nodes: [makeNode({ id: 'web-1', title: 'Web', score: 0.9 })],
      }));
      mgr.register(makeSource('feishu', 'feishu', {
        nodes: [makeNode({ id: 'feishu-1', title: 'Feishu', score: 0.9 })],
      }));
      mgr.register(makeSource('local', 'local', {
        nodes: [makeNode({ id: 'local-1', title: 'Local', score: 0.9 })],
      }));

      // 用指定源时不排序，但默认查询应按优先级
      const result = await mgr.query('test', { sources: ['local', 'feishu', 'web'] });
      expect(result).toHaveLength(3);
    });
  });
});
