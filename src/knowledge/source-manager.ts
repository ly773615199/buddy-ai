/**
 * 知识源统一接入层
 *
 * 四层知识源：本地 / 对话 / 网络搜索 / SaaS 知识库
 * 统一接口 + 自动选源 + 检索 + 去重 + 排序
 */

// ==================== 类型定义 ====================

/** 知识节点 */
export interface KnowledgeNode {
  id: string;
  sourceId: string;
  sourceType: 'local' | 'web' | 'feishu' | 'conversation';
  title: string;
  content: string;
  summary: string;
  domain: string;
  concepts: string[];
  score: number;         // 相关性得分 0-1
  createdAt: number;
  updatedAt: number;
}

/** 知识内容（完整） */
export interface KnowledgeContent {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
}

/** 搜索选项 */
export interface SearchOptions {
  limit?: number;         // 最大返回数，默认 10
  minScore?: number;      // 最低相关性得分，默认 0.3
  domain?: string;        // 按领域过滤
  sourceType?: KnowledgeNode['sourceType'];
}

/** 查询选项 */
export interface QueryOptions {
  limit?: number;
  domain?: string;
  sources?: string[];     // 指定源 ID，不填则自动选源
  deduplicate?: boolean;  // 是否去重，默认 true
}

/** 同步结果 */
export interface SyncResult {
  sourceId: string;
  synced: number;
  added: number;
  updated: number;
  deleted: number;
  durationMs: number;
  error?: string;
}

/** 知识源接口 */
export interface KnowledgeSource {
  id: string;
  type: KnowledgeNode['sourceType'];
  name: string;

  /** 搜索知识 */
  search(query: string, options?: SearchOptions): Promise<KnowledgeNode[]>;
  /** 读取完整内容 */
  read(nodeId: string): Promise<KnowledgeContent | null>;
  /** 列出子节点 */
  list(parentId?: string): Promise<KnowledgeNode[]>;
  /** 同步数据 */
  sync(): Promise<SyncResult>;
  /** 是否可用 */
  isAvailable(): boolean;
}

// ==================== KnowledgeSourceManager ====================

export class KnowledgeSourceManager {
  private sources: Map<string, KnowledgeSource> = new Map();
  private queryCache: Map<string, { result: KnowledgeNode[]; timestamp: number }> = new Map();
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5 分钟缓存
  private readonly maxCacheSize = 100;

  /**
   * 统一查询入口 — 自动选源 + 检索 + 去重 + 排序
   *
   * 三脑调这个方法：
   * 1. 如果指定了 sources，只查指定源
   * 2. 否则按优先级：本地 → 对话 → 飞书 → 网络
   * 3. 合并结果，去重，按 score 排序
   */
  async query(query: string, options?: QueryOptions): Promise<KnowledgeNode[]> {
    const limit = options?.limit ?? 10;
    const deduplicate = options?.deduplicate ?? true;

    // 检查缓存
    const cacheKey = `${query}|${JSON.stringify(options)}`;
    const cached = this.queryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return cached.result;
    }

    // 确定要查询的源
    const targetSources = options?.sources
      ? options.sources.map(id => this.sources.get(id)).filter((s): s is KnowledgeSource => !!s?.isAvailable())
      : this.getAvailableSourcesByPriority();

    // 并行查询所有源
    const searchPromises = targetSources.map(async source => {
      try {
        return await source.search(query, {
          limit: Math.ceil(limit / targetSources.length) + 2,
          domain: options?.domain,
        });
      } catch {
        return [];
      }
    });

    const results = await Promise.all(searchPromises);
    let merged = results.flat();

    // 去重（基于 title + content 前 100 字符）
    if (deduplicate) {
      const seen = new Set<string>();
      merged = merged.filter(node => {
        const key = `${node.title}|${node.content.slice(0, 100)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    // 按 score 降序排列
    merged.sort((a, b) => b.score - a.score);
    const final = merged.slice(0, limit);

    // 写入缓存
    this.queryCache.set(cacheKey, { result: final, timestamp: Date.now() });
    if (this.queryCache.size > this.maxCacheSize) {
      const oldest = [...this.queryCache.entries()]
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      if (oldest) this.queryCache.delete(oldest[0]);
    }

    return final;
  }

  /**
   * 注册知识源
   */
  register(source: KnowledgeSource): void {
    this.sources.set(source.id, source);
  }

  /**
   * 注销知识源
   */
  unregister(id: string): void {
    this.sources.delete(id);
  }

  /**
   * 获取指定源
   */
  getSource(id: string): KnowledgeSource | undefined {
    return this.sources.get(id);
  }

  /**
   * 获取所有已注册源
   */
  getAllSources(): KnowledgeSource[] {
    return [...this.sources.values()];
  }

  /**
   * 全量同步所有源
   */
  async syncAll(): Promise<SyncResult[]> {
    const results: SyncResult[] = [];
    for (const source of this.sources.values()) {
      if (source.isAvailable()) {
        try {
          const result = await source.sync();
          results.push(result);
        } catch (e: any) {
          results.push({
            sourceId: source.id,
            synced: 0, added: 0, updated: 0, deleted: 0,
            durationMs: 0,
            error: e.message ?? String(e),
          });
        }
      }
    }
    return results;
  }

  /**
   * 同步指定源
   */
  async sync(sourceId: string): Promise<SyncResult | null> {
    const source = this.sources.get(sourceId);
    if (!source || !source.isAvailable()) return null;
    return source.sync();
  }

  /**
   * 清除查询缓存
   */
  clearCache(): void {
    this.queryCache.clear();
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalSources: number;
    availableSources: number;
    byType: Record<string, number>;
    cacheSize: number;
  } {
    const all = [...this.sources.values()];
    const byType: Record<string, number> = {};
    for (const s of all) {
      byType[s.type] = (byType[s.type] ?? 0) + 1;
    }
    return {
      totalSources: all.length,
      availableSources: all.filter(s => s.isAvailable()).length,
      byType,
      cacheSize: this.queryCache.size,
    };
  }

  // ── 内部方法 ──

  /**
   * 按优先级获取可用源
   * 本地 → 对话 → 飞书 → 网络
   */
  private getAvailableSourcesByPriority(): KnowledgeSource[] {
    const priorityOrder: KnowledgeNode['sourceType'][] = ['local', 'conversation', 'feishu', 'web'];
    const available = [...this.sources.values()].filter(s => s.isAvailable());
    return available.sort((a, b) => {
      const ai = priorityOrder.indexOf(a.type);
      const bi = priorityOrder.indexOf(b.type);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }
}
