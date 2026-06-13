/**
 * 网络知识源 — 搜索引擎 → 抓取 → 学习 → 记忆
 *
 * 三脑判定"本地知识没命中，需要外部知识"时触发
 * 搜索结果通过 BuddyLearn.learnFromUrl() 逐条抓取学习
 * 学习结果存入 STMP（来源标记为 'web'）
 * 后续相同问题直接查本地命中，不再重复搜索
 */

import type {
  KnowledgeSource, KnowledgeNode, KnowledgeContent,
  SearchOptions, SyncResult,
} from './source-manager.js';
import type { BuddyLearn } from './learn.js';
import type { MemoryStore } from '../memory/store.js';

// ==================== 类型 ====================

/**
 * 搜索引擎类型
 *
 * 国内网络优先级：
 *   searxng（自托管，稳定可靠） > bing（需 key，国内可达） > duckduckgo（免费但国内不稳）
 * 隐私优先：local（本地搜索，零网络依赖）
 */
type SearchEngineType = 'searxng' | 'duckduckgo' | 'bing' | 'google' | 'local';

interface WebSourceConfig {
  id?: string;
  searchEngine?: SearchEngineType;
  /** SearXNG 实例地址，如 http://localhost:8080 */
  searxngUrl?: string;
  /** Bing / Google API key */
  apiKey?: string;
  /** 本地搜索索引路径（searchEngine='local' 时使用） */
  localIndexPath?: string;
  maxResults?: number;
  cooldownMs?: number;
  /** 请求超时（ms），国内网络建议 15000+ */
  requestTimeoutMs?: number;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// ==================== WebSource ====================

export class WebSource implements KnowledgeSource {
  readonly id: string;
  readonly type = 'web' as const;
  readonly name = '网络知识源';

  private searchEngine: SearchEngineType;
  private searxngUrl: string;
  private apiKey?: string;
  private localIndexPath?: string;
  private maxResults: number;
  private cooldownMs: number;
  private requestTimeoutMs: number;
  private learn: BuddyLearn;
  private memory: MemoryStore;

  // 搜索冷却（同问题不重复搜）
  private recentQueries: Map<string, number> = new Map();

  constructor(learn: BuddyLearn, memory: MemoryStore, config?: WebSourceConfig) {
    this.id = config?.id ?? 'web';
    this.searchEngine = config?.searchEngine ?? 'searxng';
    this.searxngUrl = config?.searxngUrl ?? 'http://localhost:8080';
    this.apiKey = config?.apiKey;
    this.localIndexPath = config?.localIndexPath;
    this.maxResults = config?.maxResults ?? 5;
    this.cooldownMs = config?.cooldownMs ?? 60 * 60 * 1000; // 1 小时冷却
    this.requestTimeoutMs = config?.requestTimeoutMs ?? 15000; // 15s 超时，适配国内网络
    this.learn = learn;
    this.memory = memory;
  }

  // ==================== KnowledgeSource 接口 ====================

  /**
   * 搜索网络知识
   *
   * 流程：
   * 1. 检查冷却期
   * 2. 调搜索 API 获取 URL
   * 3. 用 BuddyLearn 逐条抓取学习
   * 4. 从本地记忆中返回学习结果
   */
  async search(query: string, options?: SearchOptions): Promise<KnowledgeNode[]> {
    const limit = options?.limit ?? this.maxResults;

    // 检查冷却期
    const lastQuery = this.findSimilarQuery(query);
    if (lastQuery && Date.now() - lastQuery < this.cooldownMs) {
      // 冷却期内，从已学习的知识中返回
      return this.searchLearned(query, limit);
    }

    // 调搜索 API
    let searchResults: SearchResult[];
    try {
      searchResults = await this.doSearch(query, limit);
    } catch {
      return [];
    }

    if (searchResults.length === 0) return [];

    // 记录搜索冷却
    this.recentQueries.set(query, Date.now());
    this.pruneOldQueries();

    // 逐条抓取学习
    const nodes: KnowledgeNode[] = [];
    for (const result of searchResults) {
      try {
        const learnResult = await this.learn.learnFromUrl(result.url);
        if (learnResult.success) {
          nodes.push({
            id: `web-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            sourceId: this.id,
            sourceType: 'web',
            title: result.title,
            content: result.snippet,
            summary: result.snippet.slice(0, 200),
            domain: '网络',
            concepts: [],
            score: 0.6, // 网络搜索基础分
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
      } catch {
        // 单条抓取失败，继续
      }
    }

    return nodes.slice(0, limit);
  }

  /**
   * 读取完整内容（从本地记忆）
   */
  async read(nodeId: string): Promise<KnowledgeContent | null> {
    // 网络知识已存入 STMP，从记忆中读取
    const memories = this.memory.getMemoriesByCategory('learned_knowledge');
    const match = memories.find(m => m.key.includes(nodeId));
    if (!match) return null;

    return {
      id: nodeId,
      content: match.value,
      metadata: { source: 'web' },
    };
  }

  /**
   * 列出已学习的网络知识
   */
  async list(): Promise<KnowledgeNode[]> {
    const memories = this.memory.getMemoriesByCategory('learned_knowledge');
    return memories
      .filter(m => m.key.startsWith('url:'))
      .map((m, i) => ({
        id: `web-listed-${i}`,
        sourceId: this.id,
        sourceType: 'web' as const,
        title: m.key.replace(/^url:/, '').split('#')[0],
        content: m.value,
        summary: m.value.slice(0, 200),
        domain: '网络',
        concepts: [],
        score: 0.5,
        createdAt: 0,
        updatedAt: 0,
      }));
  }

  /**
   * 同步（清理过期缓存）
   */
  async sync(): Promise<SyncResult> {
    const startTime = Date.now();
    this.pruneOldQueries();
    return {
      sourceId: this.id,
      synced: 0,
      added: 0,
      updated: 0,
      deleted: 0,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * 是否可用
   *
   * - searxng: 有实例地址即可用（自托管，无 key 要求）
   * - duckduckgo: 始终可用（免费，但国内可能不稳）
   * - bing/google: 需要 apiKey
   * - local: 有索引路径即可用
   */
  isAvailable(): boolean {
    switch (this.searchEngine) {
      case 'searxng':
        return !!this.searxngUrl;
      case 'duckduckgo':
        return true;
      case 'bing':
      case 'google':
        return !!this.apiKey;
      case 'local':
        return !!this.localIndexPath;
      default:
        return false;
    }
  }

  // ==================== 内部方法 ====================

  /**
   * 调搜索 API
   *
   * 优先级：searxng > bing > google > duckduckgo > local
   */
  private async doSearch(query: string, limit: number): Promise<SearchResult[]> {
    switch (this.searchEngine) {
      case 'searxng':
        return this.searchSearXNG(query, limit);
      case 'bing':
        return this.searchBing(query, limit);
      case 'google':
        return this.searchGoogle(query, limit);
      case 'duckduckgo':
        return this.searchDuckDuckGo(query, limit);
      case 'local':
        return this.searchLocal(query, limit);
      default:
        return this.searchSearXNG(query, limit);
    }
  }

  /**
   * SearXNG 搜索（自托管元搜索引擎，国内网络首选）
   *
   * 优势：
   * - 自托管，不依赖外部服务
   * - 聚合多个搜索引擎结果
   * - JSON API，解析简单
   * - 无速率限制（自己控制）
   *
   * 部署：docker run -d -p 8080:8080 searxng/searxng
   */
  private async searchSearXNG(query: string, limit: number): Promise<SearchResult[]> {
    try {
      const url = `${this.searxngUrl}/search?q=${encodeURIComponent(query)}&format=json&pageno=1`;
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Buddy/1.0',
        },
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });

      if (!res.ok) return [];
      const data = await res.json() as any;

      return (data.results ?? []).slice(0, limit).map((item: any) => ({
        title: item.title ?? '',
        url: item.url ?? '',
        snippet: item.content ?? '',
      }));
    } catch {
      return [];
    }
  }

  /**
   * 本地搜索（从已学习的知识中检索，零网络依赖）
   *
   * 适用场景：离线环境、隐私敏感、高频查询缓存
   */
  private async searchLocal(query: string, limit: number): Promise<SearchResult[]> {
    const memories = this.memory.getMemoriesByCategory('learned_knowledge');
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);

    const scored = memories
      .map(m => {
        const text = (m.key + ' ' + m.value).toLowerCase();
        const matchCount = queryWords.filter(w => text.includes(w)).length;
        return { memory: m, score: matchCount / queryWords.length };
      })
      .filter(s => s.score > 0.3);

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map(s => ({
      title: s.memory.key.split('#')[0],
      url: `local://${s.memory.key}`,
      snippet: s.memory.value.slice(0, 300),
    }));
  }

  /**
   * DuckDuckGo 搜索（免费，无需 API key）
   */
  private async searchDuckDuckGo(query: string, limit: number): Promise<SearchResult[]> {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Buddy/1.0)' },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) return [];

      const html = await res.text();
      const results: SearchResult[] = [];

      // 解析 DuckDuckGo HTML 结果
      const resultRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
      const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

      const links: string[] = [];
      const titles: string[] = [];
      const snippets: string[] = [];

      let match;
      while ((match = resultRegex.exec(html)) !== null && links.length < limit) {
        const href = match[1];
        // DuckDuckGo 的链接可能是重定向格式
        const realUrl = href.includes('uddg=')
          ? decodeURIComponent(href.match(/uddg=([^&]+)/)?.[1] ?? href)
          : href;
        if (realUrl.startsWith('http')) {
          links.push(realUrl);
          titles.push(match[2].replace(/<[^>]+>/g, '').trim());
        }
      }

      while ((match = snippetRegex.exec(html)) !== null && snippets.length < links.length) {
        snippets.push(match[1].replace(/<[^>]+>/g, '').trim());
      }

      for (let i = 0; i < links.length; i++) {
        results.push({
          title: titles[i] || 'Untitled',
          url: links[i],
          snippet: snippets[i] || '',
        });
      }

      return results;
    } catch {
      return [];
    }
  }

  /**
   * Bing Search API
   */
  private async searchBing(query: string, limit: number): Promise<SearchResult[]> {
    if (!this.apiKey) return [];

    try {
      const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${limit}`;
      const res = await fetch(url, {
        headers: { 'Ocp-Apim-Subscription-Key': this.apiKey },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) return [];
      const data = await res.json() as any;

      return (data.webPages?.value ?? []).slice(0, limit).map((item: any) => ({
        title: item.name ?? '',
        url: item.url ?? '',
        snippet: item.snippet ?? '',
      }));
    } catch {
      return [];
    }
  }

  /**
   * Google Custom Search API
   */
  private async searchGoogle(query: string, limit: number): Promise<SearchResult[]> {
    if (!this.apiKey) return [];

    try {
      // Google Custom Search 需要 cx (搜索引擎 ID)，这里用 apiKey 兼做
      const cx = this.apiKey.split(':')[0];
      const key = this.apiKey.split(':')[1] ?? this.apiKey;
      const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(query)}&num=${limit}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });

      if (!res.ok) return [];
      const data = await res.json() as any;

      return (data.items ?? []).slice(0, limit).map((item: any) => ({
        title: item.title ?? '',
        url: item.link ?? '',
        snippet: item.snippet ?? '',
      }));
    } catch {
      return [];
    }
  }

  /**
   * 从已学习的知识中搜索
   */
  private searchLearned(query: string, limit: number): KnowledgeNode[] {
    const memories = this.memory.getMemoriesByCategory('learned_knowledge');
    const urlMemories = memories.filter(m => m.key.startsWith('url:'));

    // 简单关键词匹配
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
    const scored = urlMemories.map(m => {
      const text = (m.key + ' ' + m.value).toLowerCase();
      const matchCount = queryWords.filter(w => text.includes(w)).length;
      return { memory: m, score: matchCount / queryWords.length };
    }).filter(s => s.score > 0);

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map((s, i) => ({
      id: `web-cached-${i}`,
      sourceId: this.id,
      sourceType: 'web' as const,
      title: s.memory.key.replace(/^url:/, '').split('#')[0],
      content: s.memory.value,
      summary: s.memory.value.slice(0, 200),
      domain: '网络',
      concepts: [],
      score: 0.4 + s.score * 0.3, // 缓存结果得分稍低
      createdAt: 0,
      updatedAt: 0,
    }));
  }

  /**
   * 查找相似的已搜索查询
   */
  private findSimilarQuery(query: string): number | undefined {
    const normalized = query.toLowerCase().trim();
    for (const [q, time] of this.recentQueries) {
      if (q.toLowerCase().trim() === normalized) return time;
    }
    return undefined;
  }

  /**
   * 清理过期的搜索记录
   */
  private pruneOldQueries(): void {
    const cutoff = Date.now() - this.cooldownMs * 2;
    for (const [q, time] of this.recentQueries) {
      if (time < cutoff) this.recentQueries.delete(q);
    }
  }
}
