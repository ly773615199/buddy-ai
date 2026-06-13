/**
 * ProactiveResearcher — 主动信息获取器
 *
 * 判断用户请求是否需要主动搜索上下文信息，
 * 搜索结果注入 LLM 上下文，提升任务准备质量。
 *
 * 触发条件：
 * - 包含未知实体（地名、产品名、API 名）
 * - 涉及最新信息（"最新的"、"2026年"）
 * - 涉及部署/配置（"部署到"、"配置"）
 *
 * 不触发：纯聊天、已知工具调用、代码生成
 */

// ==================== 类型定义 ====================

export interface ResearchRequest {
  query: string;
  context: string;
  depth: 'quick' | 'standard';
  maxResults: number;
}

export interface ResearchResult {
  query: string;
  sources: Array<{
    title: string;
    url: string;
    snippet: string;
    relevance: number;
  }>;
  summary: string;
  fetchedAt: number;
  cacheHit: boolean;
}

export interface ProactiveResearcherConfig {
  /** 缓存 TTL ms（默认 1 小时） */
  cacheTtlMs: number;
  /** 搜索超时 ms（默认 5s） */
  timeoutMs: number;
  /** 是否启用 */
  enabled: boolean;
  /** 最大缓存条目 */
  maxCacheEntries: number;
}

// ==================== 触发关键词 ====================

/** 需要搜索的关键词 */
const SEARCH_TRIGGERS = [
  // 部署/配置
  '部署到', '部署在', '配置', 'setup', 'deploy', 'configure',
  // 最新信息
  '最新的', '最新版', '2026年', '2025年', 'latest', 'newest', 'recent',
  // 未知实体（前缀匹配）
  '阿里云', '腾讯云', 'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes',
  'Vercel', 'Netlify', 'Cloudflare', 'Fly.io',
];

/** 不需要搜索的关键词（排除误触发） */
const SEARCH_EXCLUSIONS = [
  '帮我写', '帮我实现', '帮我创建', '帮我生成',
  'write', 'implement', 'create', 'generate',
  '代码', 'code', '函数', 'function', '类', 'class',
];

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: ProactiveResearcherConfig = {
  cacheTtlMs: 60 * 60 * 1000,  // 1 小时
  timeoutMs: 5_000,              // 5 秒
  enabled: true,
  maxCacheEntries: 50,
};

// ==================== 研究器 ====================

export class ProactiveResearcher {
  private config: ProactiveResearcherConfig;
  private cache = new Map<string, ResearchResult>();
  private searchFn: ((query: string) => Promise<ResearchResult>) | null = null;
  private verbose: boolean;

  constructor(config?: Partial<ProactiveResearcherConfig>, verbose = false) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.verbose = verbose;
  }

  /** 注入搜索函数（测试用或使用已有 web 工具） */
  setSearchFn(fn: (query: string) => Promise<ResearchResult>): void {
    this.searchFn = fn;
  }

  // ==================== 核心接口 ====================

  /** 判断是否需要主动研究 */
  shouldResearch(userRequest: string, taskType: string): boolean {
    if (!this.config.enabled) return false;

    // 纯聊天不搜索（除非有搜索触发词或未知实体）
    const hasTriggers = SEARCH_TRIGGERS.some(k => userRequest.toLowerCase().includes(k.toLowerCase()));
    if (taskType === 'chat' && userRequest.length < 50 && !hasTriggers) {
      // 短聊天消息：检查是否有未知实体
      const unknownEntities = userRequest.match(/\b[A-Z][a-zA-Z]{2,}\b/g) ?? [];
      const knownEntities = new Set(['TypeScript', 'JavaScript', 'React', 'Vue', 'Node', 'Python', 'Git', 'HTML', 'CSS', 'API', 'SQL']);
      const hasUnknown = unknownEntities.some(e => !knownEntities.has(e));
      if (!hasUnknown) return false;
    }

    // 排除：纯代码生成
    if (SEARCH_EXCLUSIONS.some(k => userRequest.includes(k)) &&
        !SEARCH_TRIGGERS.some(k => userRequest.includes(k))) {
      return false;
    }

    // 触发：包含搜索关键词
    if (SEARCH_TRIGGERS.some(k => userRequest.toLowerCase().includes(k.toLowerCase()))) {
      return true;
    }

    // 触发：包含未知实体（大写开头的英文词，可能是产品名）
    const unknownEntities = userRequest.match(/\b[A-Z][a-zA-Z]{2,}\b/g) ?? [];
    const knownEntities = new Set(['TypeScript', 'JavaScript', 'React', 'Vue', 'Node', 'Python', 'Git', 'HTML', 'CSS', 'API', 'SQL']);
    const hasUnknown = unknownEntities.some(e => !knownEntities.has(e));
    if (hasUnknown && userRequest.length > 15) return true;

    return false;
  }

  /** 执行研究 */
  async research(request: ResearchRequest): Promise<ResearchResult> {
    // 检查缓存
    const cacheKey = request.query.toLowerCase().trim();
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.fetchedAt) < this.config.cacheTtlMs) {
      return { ...cached, cacheHit: true };
    }

    // 执行搜索
    if (!this.searchFn) {
      return {
        query: request.query,
        sources: [],
        summary: '',
        fetchedAt: Date.now(),
        cacheHit: false,
      };
    }

    try {
      const result = await this.withTimeout(
        this.searchFn(request.query),
        this.config.timeoutMs,
      );

      // 写入缓存
      this.cache.set(cacheKey, result);

      // 缓存大小限制
      if (this.cache.size > this.config.maxCacheEntries) {
        const oldest = [...this.cache.entries()]
          .sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)[0];
        if (oldest) this.cache.delete(oldest[0]);
      }

      return result;
    } catch (err) {
      if (this.verbose) console.warn('[ProactiveResearcher] 搜索失败:', (err as Error).message);
      return {
        query: request.query,
        sources: [],
        summary: '',
        fetchedAt: Date.now(),
        cacheHit: false,
      };
    }
  }

  /** 获取缓存结果（不触发搜索） */
  getCached(query: string): ResearchResult | null {
    const cached = this.cache.get(query.toLowerCase().trim());
    if (!cached) return null;
    if ((Date.now() - cached.fetchedAt) >= this.config.cacheTtlMs) return null;
    return { ...cached, cacheHit: true };
  }

  /** 清除缓存 */
  clearCache(): void {
    this.cache.clear();
  }

  /** 获取缓存统计 */
  getCacheStats(): { size: number; hitRate: number } {
    return { size: this.cache.size, hitRate: 0 };
  }

  // ==================== 工具 ====================

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`搜索超时 (${ms}ms)`)), ms),
      ),
    ]);
  }
}
