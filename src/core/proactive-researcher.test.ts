import { describe, it, expect } from 'vitest';
import { ProactiveResearcher, type ResearchResult } from './proactive-researcher.js';

describe('ProactiveResearcher', () => {
  it('纯聊天不触发', () => {
    const r = new ProactiveResearcher();
    expect(r.shouldResearch('你好', 'chat')).toBe(false);
  });

  it('部署关键词触发', () => {
    const r = new ProactiveResearcher();
    expect(r.shouldResearch('帮我部署到阿里云', 'tools')).toBe(true);
    expect(r.shouldResearch('How to deploy to AWS', 'tools')).toBe(true);
  });

  it('最新信息触发', () => {
    const r = new ProactiveResearcher();
    expect(r.shouldResearch('最新的 React 19 有什么新特性', 'chat')).toBe(true);
  });

  it('纯代码生成不触发', () => {
    const r = new ProactiveResearcher();
    expect(r.shouldResearch('帮我写一个排序函数', 'tools')).toBe(false);
    expect(r.shouldResearch('帮我实现一个 REST API', 'tools')).toBe(false);
  });

  it('未知实体触发', () => {
    const r = new ProactiveResearcher();
    expect(r.shouldResearch('Supabase 和 Firebase 哪个更适合我的项目', 'chat')).toBe(true);
  });

  it('搜索和缓存', async () => {
    const r = new ProactiveResearcher();
    let callCount = 0;
    r.setSearchFn(async (query) => {
      callCount++;
      return {
        query,
        sources: [{ title: 'Test', url: 'https://test.com', snippet: 'test', relevance: 0.8 }],
        summary: 'Test summary',
        fetchedAt: Date.now(),
        cacheHit: false,
      };
    });

    const result1 = await r.research({ query: 'React 19', context: '', depth: 'quick', maxResults: 3 });
    expect(result1.cacheHit).toBe(false);
    expect(result1.sources).toHaveLength(1);
    expect(callCount).toBe(1);

    const result2 = await r.research({ query: 'React 19', context: '', depth: 'quick', maxResults: 3 });
    expect(result2.cacheHit).toBe(true);
    expect(callCount).toBe(1); // 没有再次调用
  });

  it('超时降级', async () => {
    const r = new ProactiveResearcher({ timeoutMs: 50 });
    r.setSearchFn(async () => {
      await new Promise(resolve => setTimeout(resolve, 200));
      return { query: '', sources: [], summary: '', fetchedAt: Date.now(), cacheHit: false };
    });

    const result = await r.research({ query: 'test', context: '', depth: 'quick', maxResults: 3 });
    expect(result.sources).toHaveLength(0); // 超时返回空
  });

  it('未注入搜索函数 → 空结果', async () => {
    const r = new ProactiveResearcher();
    const result = await r.research({ query: 'test', context: '', depth: 'quick', maxResults: 3 });
    expect(result.sources).toHaveLength(0);
    expect(result.summary).toBe('');
  });
});
