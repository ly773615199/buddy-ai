import { z } from 'zod';
import type { ToolDef } from '../types.js';

// ==================== 网页搜索 ====================

/**
 * 搜索引擎适配层
 * 支持 Brave Search / Serper / DuckDuckGo (免费)
 */

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function searchBrave(query: string, count: number, apiKey: string): Promise<SearchResult[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(count));

  const res = await fetch(url.toString(), {
    headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' },
  });

  if (!res.ok) throw new Error(`Brave API 错误: ${res.status}`);
  const data = await res.json();

  return (data.web?.results ?? []).slice(0, count).map((r: any) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
  }));
}

async function searchSerper(query: string, count: number, apiKey: string): Promise<SearchResult[]> {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num: count }),
  });

  if (!res.ok) throw new Error(`Serper API 错误: ${res.status}`);
  const data = await res.json();

  return (data.organic ?? []).slice(0, count).map((r: any) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet,
  }));
}

async function searchDuckDuckGo(query: string, count: number): Promise<SearchResult[]> {
  // DuckDuckGo Lite HTML 搜索（免费，无需 key，返回真实网页结果）
  // 先尝试 Instant Answer API 获取摘要，再用 Lite 搜索获取真实链接
  const results: SearchResult[] = [];

  // 1. Instant Answer API — 获取知识图谱摘要（有的话）
  try {
    const iaUrl = new URL('https://api.duckduckgo.com/');
    iaUrl.searchParams.set('q', query);
    iaUrl.searchParams.set('format', 'json');
    iaUrl.searchParams.set('no_html', '1');
    iaUrl.searchParams.set('skip_disambig', '1');

    const iaRes = await fetch(iaUrl.toString(), { signal: AbortSignal.timeout(5000) });
    if (iaRes.ok) {
      const iaData = await iaRes.json() as any;
      if (iaData.AbstractText) {
        results.push({
          title: iaData.Heading || query,
          url: iaData.AbstractURL || '',
          snippet: iaData.AbstractText,
        });
      }
      // Related Topics
      for (const topic of (iaData.RelatedTopics ?? []).slice(0, Math.max(0, count - results.length))) {
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.slice(0, 80),
            url: topic.FirstURL,
            snippet: topic.Text,
          });
        }
      }
    }
  } catch { /* Instant Answer 不影响主流程 */ }

  // 2. 结果不足时，用 DuckDuckGo Lite HTML 补充真实搜索结果
  if (results.length < count) {
    try {
      const liteUrl = new URL('https://lite.duckduckgo.com/lite/');
      liteUrl.searchParams.set('q', query);
      liteUrl.searchParams.set('kd', '-1'); // 无安全搜索

      const liteRes = await fetch(liteUrl.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Buddy/1.0)',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (liteRes.ok) {
        const html = await liteRes.text();
        // 解析 Lite 页面的搜索结果：<a href="..." class="result-link"> + <td class="result-snippet">
        const linkRegex = /<a[^>]*class="result-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        const snippetRegex = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

        const links: Array<{ url: string; title: string }> = [];
        let match;
        while ((match = linkRegex.exec(html)) !== null && links.length < count) {
          links.push({
            url: match[1],
            title: match[2].replace(/<[^>]+>/g, '').trim(),
          });
        }

        const snippets: string[] = [];
        while ((match = snippetRegex.exec(html)) !== null && snippets.length < count) {
          snippets.push(match[1].replace(/<[^>]+>/g, '').trim());
        }

        // 合并 title + snippet
        const existingUrls = new Set(results.map(r => r.url));
        for (let i = 0; i < links.length && results.length < count; i++) {
          if (existingUrls.has(links[i].url)) continue;
          results.push({
            title: links[i].title || query,
            url: links[i].url,
            snippet: snippets[i] || '',
          });
        }
      }
    } catch { /* Lite 搜索失败时返回已有结果 */ }
  }

  return results.slice(0, count);
}

/**
 * 智能选择搜索引擎
 */
/**
 * Step 15: 领域感知查询增强 — 根据领域添加 site: 限定词
 * 减少无关源，提高搜索精准度
 */
const DOMAIN_SEARCH_HINTS: Record<string, string[]> = {
  code: ['site:github.com', 'site:stackoverflow.com'],
  git: ['site:github.com', 'site:git-scm.com'],
  data: ['site:arxiv.org', 'site:paperswithcode.com'],
  knowledge: ['site:wikipedia.org', 'site:arxiv.org'],
  writing: ['site:wikipedia.org'],
};

export function augmentSearchQuery(query: string, domains: string[] = []): string {
  if (domains.length === 0) return query;
  // 只取第一个领域的 hint，避免查询过长
  const primaryDomain = domains[0];
  const hints = DOMAIN_SEARCH_HINTS[primaryDomain];
  if (!hints) return query;
  // 如果 query 已经包含 site: 则不增强
  if (query.includes('site:')) return query;
  return `${query} ${hints[0]}`;
}

async function doSearch(query: string, count: number, domains?: string[]): Promise<SearchResult[]> {
  // Step 15: 领域感知查询增强
  const augmentedQuery = augmentSearchQuery(query, domains);

  // 优先级：Brave > Serper > DuckDuckGo
  const braveKey = process.env.BRAVE_API_KEY;
  const serperKey = process.env.SERPER_API_KEY;

  if (braveKey) {
    try { return await searchBrave(augmentedQuery, count, braveKey); } catch { /* fallback */ }
  }
  if (serperKey) {
    try { return await searchSerper(augmentedQuery, count, serperKey); } catch { /* fallback */ }
  }
  // DuckDuckGo 免费兜底
  return searchDuckDuckGo(augmentedQuery, count);
}

export const search_web: ToolDef = {
  name: 'search_web',
  description: '搜索网络获取信息。支持 Brave/Serper/DuckDuckGo。',
  parameters: z.object({
    query: z.string().describe('搜索关键词'),
    count: z.number().optional().describe('返回结果数量（默认5）'),
    domains: z.array(z.string()).optional().describe('搜索领域标签（用于精准路由）'),
  }),
  permission: 'web_search',
  execute: async (args) => {
    const { query, count, domains } = args as { query: string; count?: number; domains?: string[] };
    try {
      const results = await doSearch(query, count ?? 5, domains);
      if (results.length === 0) return '[搜索无结果]';

      return results.map((r, i) =>
        `${i + 1}. [${r.title}]\n   ${r.snippet}\n   ${r.url}`
      ).join('\n\n');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[搜索失败: ${msg}]`;
    }
  },
};

// ==================== 网页抓取 ====================

/**
 * 简易 HTML → 可读文本提取
 * 不依赖 cheerio，纯正则实现基础版本
 */
function extractReadableContent(html: string): string {
  // 移除 script/style
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '');

  // 提取 title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';

  // 提取 main/article 内容优先
  const mainMatch = text.match(/<(main|article)[^>]*>([\s\S]*?)<\/(main|article)>/i);
  if (mainMatch) {
    text = mainMatch[2];
  }

  // 移除所有 HTML 标签
  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return title ? `${title}\n\n${text}` : text;
}

export const fetch_url: ToolDef = {
  name: 'fetch_url',
  description: '抓取网页内容并提取正文。',
  parameters: z.object({
    url: z.string().describe('网页 URL'),
    max_chars: z.number().optional().describe('最大字符数（默认5000）'),
  }),
  permission: 'web_search',
  execute: async (args) => {
    const { url, max_chars } = args as { url: string; max_chars?: number };
    const maxChars = max_chars ?? 5000;

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Buddy/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) return `[抓取失败: HTTP ${res.status}]`;

      const contentType = res.headers.get('content-type') ?? '';

      // JSON 直接返回
      if (contentType.includes('application/json')) {
        const json = await res.text();
        return json.slice(0, maxChars);
      }

      // HTML 提取正文
      const html = await res.text();
      const content = extractReadableContent(html);

      if (!content) return '[页面无可提取内容]';

      return content.length > maxChars
        ? content.slice(0, maxChars) + `\n... (已截断，共 ${content.length} 字符)`
        : content;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[抓取失败: ${msg}]`;
    }
  },
};

// ==================== 导出 ====================

export const WEB_TOOLS: ToolDef[] = [search_web, fetch_url];
