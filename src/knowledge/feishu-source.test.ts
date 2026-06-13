import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FeishuSource } from './feishu-source.js';

// Mock MemoryStore
const mockMemory = {
  getMemoriesByCategory: vi.fn().mockReturnValue([]),
  setMemory: vi.fn(),
  addDiaryEntry: vi.fn(),
};

// ── Tests ──

describe('FeishuSource', () => {
  let source: FeishuSource;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockMemory.getMemoriesByCategory.mockReturnValue([]);
  });

  // ── 基本属性 ──

  describe('属性', () => {
    it('type 为 feishu', () => {
      source = new FeishuSource(mockMemory as any, {
        appId: 'cli_test',
        appSecret: 'secret',
        spaces: [{ spaceId: 'sp1', name: 'Test Space' }],
      });
      expect(source.type).toBe('feishu');
    });

    it('有默认 id', () => {
      source = new FeishuSource(mockMemory as any, {
        appId: 'cli_test',
        appSecret: 'secret',
        spaces: [],
      });
      expect(source.id).toBe('feishu');
    });

    it('可自定义 id', () => {
      source = new FeishuSource(mockMemory as any, {
        id: 'my-feishu',
        appId: 'cli_test',
        appSecret: 'secret',
        spaces: [],
      });
      expect(source.id).toBe('my-feishu');
    });
  });

  // ── isAvailable ──

  describe('isAvailable', () => {
    it('有 appId + appSecret + spaces 时可用', () => {
      source = new FeishuSource(mockMemory as any, {
        appId: 'cli_test',
        appSecret: 'secret',
        spaces: [{ spaceId: 'sp1', name: 'Space' }],
      });
      expect(source.isAvailable()).toBe(true);
    });

    it('无 spaces 时不可用', () => {
      source = new FeishuSource(mockMemory as any, {
        appId: 'cli_test',
        appSecret: 'secret',
        spaces: [],
      });
      expect(source.isAvailable()).toBe(false);
    });

    it('无 appId 时不可用', () => {
      source = new FeishuSource(mockMemory as any, {
        appId: '',
        appSecret: 'secret',
        spaces: [{ spaceId: 'sp1', name: 'Space' }],
      });
      expect(source.isAvailable()).toBe(false);
    });
  });

  // ── search ──

  describe('search', () => {
    it('无缓存数据时返回空', async () => {
      source = new FeishuSource(mockMemory as any, {
        appId: 'cli_test',
        appSecret: 'secret',
        spaces: [{ spaceId: 'sp1', name: 'Space' }],
      });
      const result = await source.search('test');
      expect(result).toEqual([]);
    });
  });

  // ── read ──

  describe('read', () => {
    it('不存在的节点返回 null', async () => {
      source = new FeishuSource(mockMemory as any, {
        appId: 'cli_test',
        appSecret: 'secret',
        spaces: [{ spaceId: 'sp1', name: 'Space' }],
      });
      const result = await source.read('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ── list ──

  describe('list', () => {
    it('无缓存时返回空数组', async () => {
      source = new FeishuSource(mockMemory as any, {
        appId: 'cli_test',
        appSecret: 'secret',
        spaces: [{ spaceId: 'sp1', name: 'Space' }],
      });
      const result = await source.list();
      expect(result).toEqual([]);
    });
  });

  // ── sync ──

  describe('sync', () => {
    it('不可用时返回空结果', async () => {
      source = new FeishuSource(mockMemory as any, {
        appId: '',
        appSecret: '',
        spaces: [],
      });
      const result = await source.sync();
      expect(result.synced).toBe(0);
      expect(result.added).toBe(0);
    });

    it('可用但 API 失败时返回带 error 的结果', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network'));

      source = new FeishuSource(mockMemory as any, {
        appId: 'cli_test',
        appSecret: 'secret',
        spaces: [{ spaceId: 'sp1', name: 'Space' }],
      });

      const result = await source.sync();
      expect(result).toHaveProperty('sourceId', 'feishu');
    });
  });

  // ── getStats ──

  describe('getStats', () => {
    it('返回 spaces 和 cachedNodes 计数', () => {
      source = new FeishuSource(mockMemory as any, {
        appId: 'cli_test',
        appSecret: 'secret',
        spaces: [
          { spaceId: 'sp1', name: 'Space 1' },
          { spaceId: 'sp2', name: 'Space 2' },
        ],
      });
      const stats = source.getStats();
      expect(stats.spaces).toBe(2);
      expect(stats.cachedNodes).toBe(0);
    });
  });

  // ── Token 管理 ──

  describe('Token 管理', () => {
    it('首次调用获取 tenant_access_token', async () => {
      let fetchCallCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        fetchCallCount++;
        if (url.toString().includes('auth/v3/tenant_access_token/internal')) {
          return {
            ok: true,
            json: async () => ({
              tenant_access_token: 'test-token-123',
              expire: 7200,
            }),
          } as any;
        }
        return { ok: false, json: async () => ({}) } as any;
      });

      source = new FeishuSource(mockMemory as any, {
        appId: 'cli_test',
        appSecret: 'secret',
        spaces: [{ spaceId: 'sp1', name: 'Space' }],
      });

      await source.sync();
      expect(fetchCallCount).toBeGreaterThan(0);
    });
  });
});
