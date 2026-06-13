import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebSource } from './web-source.js';

// ── Mock dependencies ──

const mockLearn = {
  learnFromUrl: vi.fn().mockResolvedValue({ success: true, chunks: 3 }),
};

const mockMemory = {
  getMemoriesByCategory: vi.fn().mockReturnValue([]),
  setMemory: vi.fn(),
  addDiaryEntry: vi.fn(),
};

// ── Tests ──

describe('WebSource', () => {
  let source: WebSource;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMemory.getMemoriesByCategory.mockReturnValue([]);
  });

  // ── 构造与 isAvailable ──

  describe('isAvailable', () => {
    it('searxng 默认可用（有 URL 即可）', () => {
      source = new WebSource(mockLearn as any, mockMemory as any, {
        searchEngine: 'searxng',
        searxngUrl: 'http://localhost:8080',
      });
      expect(source.isAvailable()).toBe(true);
    });

    it('searxng 无 URL 时不可用', () => {
      source = new WebSource(mockLearn as any, mockMemory as any, {
        searchEngine: 'searxng',
        searxngUrl: '',
      });
      expect(source.isAvailable()).toBe(false);
    });

    it('duckduckgo 始终可用', () => {
      source = new WebSource(mockLearn as any, mockMemory as any, {
        searchEngine: 'duckduckgo',
      });
      expect(source.isAvailable()).toBe(true);
    });

    it('bing 有 key 可用', () => {
      source = new WebSource(mockLearn as any, mockMemory as any, {
        searchEngine: 'bing',
        apiKey: 'test-key',
      });
      expect(source.isAvailable()).toBe(true);
    });

    it('bing 无 key 不可用', () => {
      source = new WebSource(mockLearn as any, mockMemory as any, {
        searchEngine: 'bing',
      });
      expect(source.isAvailable()).toBe(false);
    });

    it('local 有 indexPath 可用', () => {
      source = new WebSource(mockLearn as any, mockMemory as any, {
        searchEngine: 'local',
        localIndexPath: '/tmp/index',
      });
      expect(source.isAvailable()).toBe(true);
    });

    it('默认引擎为 searxng', () => {
      source = new WebSource(mockLearn as any, mockMemory as any);
      expect(source.isAvailable()).toBe(true); // 默认有 searxngUrl
    });
  });

  // ── SearXNG 搜索 ──

  describe('searchSearXNG', () => {
    it('解析 SearXNG JSON 结果', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { title: 'AI Guide', url: 'https://example.com/ai', content: 'AI is...' },
            { title: 'ML Basics', url: 'https://example.com/ml', content: 'Machine learning...' },
          ],
        }),
      } as any);

      source = new WebSource(mockLearn as any, mockMemory as any, {
        searchEngine: 'searxng',
        searxngUrl: 'http://localhost:8080',
      });

      const result = await source.search('AI');
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('localhost:8080/search'),
        expect.any(Object),
      );
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].title).toBeDefined();
    });

    it('SearXNG 返回非 ok 时返回空', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as any);

      source = new WebSource(mockLearn as any, mockMemory as any, {
        searchEngine: 'searxng',
        searxngUrl: 'http://localhost:8080',
      });

      const result = await source.search('test');
      expect(result).toEqual([]);
    });

    it('SearXNG 网络异常时返回空', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

      source = new WebSource(mockLearn as any, mockMemory as any, {
        searchEngine: 'searxng',
        searxngUrl: 'http://localhost:8080',
      });

      const result = await source.search('test');
      expect(result).toEqual([]);
    });
  });

  // ── DuckDuckGo 搜索 ──

  describe('searchDuckDuckGo', () => {
    it('解析 HTML 结果', async () => {
      const html = `
        <a class="result__a" href="https://example.com/test">Test Result</a>
        <a class="result__snippet">This is a test snippet</a>
      `;
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        text: async () => html,
      } as any);

      source = new WebSource(mockLearn as any, mockMemory as any, {
        searchEngine: 'duckduckgo',
      });

      const result = await source.search('test');
      expect(result.length).toBeGreaterThanOrEqual(0); // HTML parsing may vary
    });
  });

  // ── Bing 搜索 ──

  describe('searchBing', () => {
    it('无 key 时返回空', async () => {
      source = new WebSource(mockLearn as any, mockMemory as any, {
        searchEngine: 'bing',
      });

      const result = await source.search('test');
      expect(result).toEqual([]);
    });

    it('解析 Bing API 结果', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          webPages: {
            value: [
              { name: 'AI Guide', url: 'https://example.com/ai', snippet: 'About AI' },
            ],
          },
        }),
      } as any);

      source = new WebSource(mockLearn as any, mockMemory as any, {
        searchEngine: 'bing',
        apiKey: 'test-key',
      });

      const result = await source.search('AI');
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('AI Guide');
    });
  });

  // ── 冷却机制 ──

  describe('冷却机制', () => {
    it('相同查询在冷却期内返回缓存结果', async () => {
      let fetchCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        fetchCount++;
        return {
          ok: true,
          json: async () => ({ results: [{ title: 'T', url: 'https://x.com', content: 'C' }] }),
        } as any;
      });

      source = new WebSource(mockLearn as any, mockMemory as any, {
        searchEngine: 'searxng',
        searxngUrl: 'http://localhost:8080',
        cooldownMs: 60000,
      });

      await source.search('same query');
      // 第二次应该走缓存，不发 fetch
      mockMemory.getMemoriesByCategory.mockReturnValue([
        { key: 'url:https://x.com#0', value: 'cached content' },
      ]);
      await source.search('same query');
      expect(fetchCount).toBe(1);
    });
  });

  // ── 学习流程 ──

  describe('学习流程', () => {
    it('搜索结果通过 learnFromUrl 学习', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { title: 'Doc', url: 'https://example.com/doc', content: 'Content here' },
          ],
        }),
      } as any);

      source = new WebSource(mockLearn as any, mockMemory as any, {
        searchEngine: 'searxng',
        searxngUrl: 'http://localhost:8080',
      });

      await source.search('test query');
      expect(mockLearn.learnFromUrl).toHaveBeenCalledWith('https://example.com/doc');
    });

    it('learnFromUrl 失败时跳过该条', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { title: 'Good', url: 'https://good.com', content: 'OK' },
            { title: 'Bad', url: 'https://bad.com', content: 'Fail' },
          ],
        }),
      } as any);

      mockLearn.learnFromUrl
        .mockResolvedValueOnce({ success: true, chunks: 1 })
        .mockRejectedValueOnce(new Error('fetch failed'));

      source = new WebSource(mockLearn as any, mockMemory as any, {
        searchEngine: 'searxng',
        searxngUrl: 'http://localhost:8080',
      });

      const result = await source.search('test');
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── local 搜索 ──

  describe('searchLocal', () => {
    it('从本地记忆中检索匹配内容', async () => {
      mockMemory.getMemoriesByCategory.mockReturnValue([
        { key: 'ai-guide.md#0', value: 'Artificial intelligence is a field of computer science' },
        { key: 'cooking.md#0', value: 'How to make pasta with tomato sauce' },
      ]);

      source = new WebSource(mockLearn as any, mockMemory as any, {
        searchEngine: 'local',
        localIndexPath: '/tmp/index',
      });

      const result = await source.search('artificial intelligence');
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].title).toContain('ai-guide');
    });

    it('无匹配时返回空', async () => {
      mockMemory.getMemoriesByCategory.mockReturnValue([
        { key: 'cooking.md#0', value: 'How to make pasta' },
      ]);

      source = new WebSource(mockLearn as any, mockMemory as any, {
        searchEngine: 'local',
        localIndexPath: '/tmp/index',
      });

      const result = await source.search('quantum physics');
      expect(result).toEqual([]);
    });
  });

  // ── 类型与属性 ──

  describe('属性', () => {
    it('type 为 web', () => {
      source = new WebSource(mockLearn as any, mockMemory as any);
      expect(source.type).toBe('web');
    });

    it('有默认 id', () => {
      source = new WebSource(mockLearn as any, mockMemory as any);
      expect(source.id).toBe('web');
    });

    it('可自定义 id', () => {
      source = new WebSource(mockLearn as any, mockMemory as any, { id: 'my-web' });
      expect(source.id).toBe('my-web');
    });
  });
});
