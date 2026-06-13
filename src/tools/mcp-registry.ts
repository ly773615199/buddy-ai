/**
 * MCP Registry — Smithery.ai 市场集成
 *
 * 对接 Smithery.ai API 搜索和发现 MCP Server，
 * API 不可用时降级到本地预设列表。
 */

import type { MCPServerConfig } from './mcp-adapter.js';

export interface SmitheryServerEntry {
  name: string;
  description: string;
  packageName: string;     // npm 包名
  command: string;         // 启动命令
  args: string[];          // 启动参数
  downloads: number;
  stars: number;
  tags: string[];
}

const POPULAR_SERVERS: SmitheryServerEntry[] = [
  {
    name: 'filesystem',
    description: '文件系统访问 - 读写本地文件',
    packageName: '@modelcontextprotocol/server-filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    downloads: 50000,
    stars: 200,
    tags: ['文件', 'IO', '核心'],
  },
  {
    name: 'github',
    description: 'GitHub 操作 - Issues/PRs/代码搜索',
    packageName: '@modelcontextprotocol/server-github',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    downloads: 30000,
    stars: 150,
    tags: ['GitHub', '开发', '代码'],
  },
  {
    name: 'puppeteer',
    description: '浏览器自动化 - 网页抓取/截图/交互',
    packageName: '@modelcontextprotocol/server-puppeteer',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    downloads: 25000,
    stars: 120,
    tags: ['浏览器', '自动化', '爬虫'],
  },
  {
    name: 'memory',
    description: '知识图谱记忆 - 持久化知识存储',
    packageName: '@modelcontextprotocol/server-memory',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    downloads: 20000,
    stars: 100,
    tags: ['记忆', '知识', '图谱'],
  },
  {
    name: 'slack',
    description: 'Slack 消息/频道操作',
    packageName: '@modelcontextprotocol/server-slack',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    downloads: 15000,
    stars: 80,
    tags: ['Slack', '消息', '协作'],
  },
  {
    name: 'postgres',
    description: 'PostgreSQL 数据库查询',
    packageName: '@modelcontextprotocol/server-postgres',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    downloads: 12000,
    stars: 60,
    tags: ['数据库', 'SQL', 'PostgreSQL'],
  },
  {
    name: 'sqlite',
    description: 'SQLite 数据库操作',
    packageName: '@modelcontextprotocol/server-sqlite',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite'],
    downloads: 10000,
    stars: 50,
    tags: ['数据库', 'SQL', 'SQLite'],
  },
  {
    name: 'playwright',
    description: 'Playwright 浏览器自动化 - 比 Puppeteer 更现代',
    packageName: '@playwright/mcp',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    downloads: 8000,
    stars: 40,
    tags: ['浏览器', '自动化', '测试'],
  },
  {
    name: 'fetch',
    description: '网页抓取和内容提取',
    packageName: '@modelcontextprotocol/server-fetch',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    downloads: 18000,
    stars: 90,
    tags: ['网页', '抓取', 'HTTP'],
  },
  {
    name: 'sequential-thinking',
    description: '结构化思考链 - 帮助复杂推理',
    packageName: '@modelcontextprotocol/server-sequential-thinking',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    downloads: 15000,
    stars: 70,
    tags: ['思考', '推理', '规划'],
  },
];

export class MCPRegistry {
  private baseUrl = 'https://registry.smithery.ai';

  /**
   * 搜索 MCP Server
   * 使用 Smithery API: GET /servers?q={query}&page={page}&pageSize={pageSize}
   * 如果 API 不可用，降级到本地预置列表搜索
   */
  async search(query: string, options?: { page?: number; pageSize?: number }): Promise<SmitheryServerEntry[]> {
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 10;

    // 尝试 Smithery API
    try {
      const url = `${this.baseUrl}/servers?q=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        headers: { 'Accept': 'application/json' },
      });
      if (response.ok) {
        const data = await response.json() as any;
        if (Array.isArray(data.servers)) {
          return data.servers.map((s: any) => this.normalizeServer(s));
        }
      }
    } catch {
      // API 不可用，降级到本地搜索
    }

    // 降级：本地搜索（模糊匹配 name/description/tags）
    const q = query.toLowerCase();
    return this.listPopular().filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  /**
   * 根据名称获取 Server 详情
   */
  async getServer(name: string): Promise<SmitheryServerEntry | null> {
    // 先查本地预设
    const local = this.listPopular().find(s => s.name === name);
    if (local) return local;

    // 尝试远程查询
    try {
      const url = `${this.baseUrl}/servers/${encodeURIComponent(name)}`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        headers: { 'Accept': 'application/json' },
      });
      if (response.ok) {
        const data = await response.json() as any;
        return this.normalizeServer(data);
      }
    } catch {
      // API 不可用
    }

    return null;
  }

  /**
   * 将 Smithery Server 转换为 MCP 适配器配置
   */
  toMCPConfig(entry: SmitheryServerEntry): MCPServerConfig {
    return {
      name: entry.name,
      command: entry.command,
      args: entry.args,
      description: entry.description,
    };
  }

  /**
   * 列出已知的热门 MCP Server（本地预设）
   * 当 API 不可用时作为 fallback
   */
  listPopular(): SmitheryServerEntry[] {
    return [...POPULAR_SERVERS];
  }

  /**
   * 将 Smithery API 返回的原始数据规范化为 SmitheryServerEntry
   */
  private normalizeServer(raw: any): SmitheryServerEntry {
    const name: string = raw.name ?? raw.qualifiedName ?? 'unknown';
    const packageName: string = raw.packageName ?? raw.package_name ?? name;
    return {
      name,
      description: raw.description ?? '',
      packageName,
      command: raw.command ?? 'npx',
      args: raw.args ?? ['-y', packageName],
      downloads: raw.downloads ?? raw.downloadCount ?? 0,
      stars: raw.stars ?? raw.starCount ?? 0,
      tags: Array.isArray(raw.tags) ? raw.tags : [],
    };
  }
}
