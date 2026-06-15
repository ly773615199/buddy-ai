/**
 * 知识汇聚器 — 采集层
 *
 * 并行从所有知识源收集，统一为 CollisionNode[]
 * 复用现有检索接口，不重复实现
 *
 * 6 个源: STMP / ExperienceGraph / KnowledgeSourceManager / TernaryExpertRouter / 工具结果 / 对话上下文
 */

import type { STMPStore } from '../memory/stmp.js';
import type { ExperienceGraph } from './experience-graph.js';
import type { KnowledgeSourceManager } from '../knowledge/source-manager.js';
import type { TernaryExpertRouter } from '../tools/ternary-expert.js';
import type { TextEncoder } from '../brain/right/features/text-encoder.js';
import type { CollisionNode } from './collision-engine.js';

export interface ConvergenceOptions {
  toolResults?: Array<{ name: string; result: string }>;
  contextTags?: string[];
  maxNodes?: number;       // 默认 20
  timeoutMs?: number;      // 单源超时，默认 500ms（向后兼容）
  localTimeoutMs?: number; // 本地源超时，默认 100ms
  networkTimeoutMs?: number; // 网络源超时，默认 2000ms
  ternaryTimeoutMs?: number; // 三进制超时，默认 200ms
  cacheTtlMs?: number;     // 缓存有效期，默认 5 分钟
  maxCacheSize?: number;   // 最大缓存条目，默认 100
}

interface CacheEntry {
  nodes: CollisionNode[];
  timestamp: number;
}

export class KnowledgeConvergence {
  private cache = new Map<string, CacheEntry>();
  private readonly defaultCacheTtlMs: number;
  private readonly defaultMaxCacheSize: number;

  constructor(
    private stmp: STMPStore,
    private experienceGraph: ExperienceGraph,
    private knowledgeSourceManager: KnowledgeSourceManager | null,
    private ternaryRouter: TernaryExpertRouter | null,
    private textEncoder: TextEncoder | null,
    private verbose: boolean,
    options?: { cacheTtlMs?: number; maxCacheSize?: number },
  ) {
    this.defaultCacheTtlMs = options?.cacheTtlMs ?? 5 * 60 * 1000; // 5 分钟
    this.defaultMaxCacheSize = options?.maxCacheSize ?? 100;
  }

  /**
   * 汇聚所有来源的知识（带缓存 + 分源超时）
   */
  async converge(input: string, options?: ConvergenceOptions): Promise<CollisionNode[]> {
    const maxNodes = options?.maxNodes ?? 20;
    const cacheTtlMs = options?.cacheTtlMs ?? this.defaultCacheTtlMs;
    const maxCacheSize = options?.maxCacheSize ?? this.defaultMaxCacheSize;

    // O5: 检查缓存
    const cacheKey = this.buildCacheKey(input, options);
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < cacheTtlMs) {
      if (this.verbose) console.log(`[KnowledgeConvergence] 缓存命中 (${cached.nodes.length} 节点)`);
      return cached.nodes.slice(0, maxNodes);
    }

    // O5: 分源超时 — 本地源快、网络源慢、三进制快速失败
    const localTimeout = options?.localTimeoutMs ?? 100;
    const networkTimeout = options?.networkTimeoutMs ?? 2000;
    const ternaryTimeout = options?.ternaryTimeoutMs ?? 200;
    const fallbackTimeout = options?.timeoutMs ?? 500; // 向后兼容

    // 并行采集，分源超时保护
    const sources = await Promise.allSettled([
      this.withTimeout(this.fromSTMP(input, options), localTimeout, 'stmp'),
      this.withTimeout(this.fromExperience(input, options), localTimeout, 'experience'),
      this.withTimeout(this.fromKnowledgeSources(input, options), networkTimeout, 'knowledge'),
      this.withTimeout(this.fromTernary(input, options), ternaryTimeout, 'ternary'),
      this.fromToolResults(options),  // 工具结果不需要超时（已有的）
      this.fromConversation(input),
    ]);

    // 合并所有源
    const allNodes: CollisionNode[] = [];
    for (const result of sources) {
      if (result.status === 'fulfilled') {
        allNodes.push(...result.value);
      }
    }

    // 向量化（如果 TextEncoder 可用）
    await this.vectorizeNodes(allNodes, input);

    // 简单去重（基于内容前 100 字符）
    const deduped = this.dedup(allNodes);

    // 按 score 排序，取 top N
    deduped.sort((a, b) => b.score - a.score);
    const sliced = deduped.slice(0, maxNodes);

    // O5: 写入缓存
    this.cache.set(cacheKey, { nodes: sliced, timestamp: Date.now() });
    this.evictCache(maxCacheSize);

    if (this.verbose) {
      const sourceCounts = new Map<string, number>();
      for (const n of sliced) sourceCounts.set(n.source, (sourceCounts.get(n.source) ?? 0) + 1);
      const desc = [...sourceCounts.entries()].map(([s, c]) => `${s}:${c}`).join(' ');
      console.log(`[KnowledgeConvergence] ${sliced.length} 节点 (${desc})`);
    }

    return sliced;
  }

  /**
   * 构建缓存键（基于输入内容 + 相关选项）
   */
  private buildCacheKey(input: string, options?: ConvergenceOptions): string {
    const tags = options?.contextTags?.sort().join(',') ?? '';
    return `${input.slice(0, 200)}|${tags}`;
  }

  /**
   * 缓存淘汰：超过上限时删除最老条目
   */
  private evictCache(maxSize: number): void {
    if (this.cache.size <= maxSize) return;
    const entries = [...this.cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = this.cache.size - maxSize;
    for (let i = 0; i < toRemove; i++) {
      this.cache.delete(entries[i][0]);
    }
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存状态
   */
  getCacheStats(): { size: number; ttlMs: number; maxSize: number } {
    return {
      size: this.cache.size,
      ttlMs: this.defaultCacheTtlMs,
      maxSize: this.defaultMaxCacheSize,
    };
  }

  /**
   * STMP 记忆 → CollisionNode
   */
  private async fromSTMP(input: string, options?: ConvergenceOptions): Promise<CollisionNode[]> {
    try {
      const result = await this.stmp.retrieve(input, { maxPrimary: 5, maxAssociative: 3 });
      const nodes: CollisionNode[] = [];

      for (const node of result.primary) {
        nodes.push({
          id: `stmp-${node.id}`,
          content: node.content,
          vector: new Float32Array(128), // 向量化在后续步骤
          source: 'stmp',
          score: 0.8,
          timestamp: node.timestamp,
          metadata: { room: node.room, concepts: node.concepts, relations: node.relations },
        });
      }

      for (const node of result.associative) {
        nodes.push({
          id: `stmp-assoc-${node.id}`,
          content: node.content,
          vector: new Float32Array(128),
          source: 'stmp',
          score: 0.5,
          timestamp: node.timestamp,
          metadata: { room: node.room, concepts: node.concepts, associative: true },
        });
      }

      return nodes;
    } catch (err) {
      if (this.verbose) console.warn('[KnowledgeConvergence] STMP 采集失败:', (err as Error).message);
      return [];
    }
  }

  /**
   * 经验图谱 → CollisionNode
   */
  private async fromExperience(input: string, options?: ConvergenceOptions): Promise<CollisionNode[]> {
    try {
      const tags = options?.contextTags ?? [];
      const nodes: CollisionNode[] = [];

      // 用输入的关键词匹配经验
      const inputLower = input.toLowerCase();
      for (const exp of this.experienceGraph.getAllNodes()) {
        const triggerKeywords = exp.trigger.keywords ?? [];
        const matched = triggerKeywords.some(kw => inputLower.includes(kw.toLowerCase()));
        if (matched) {
          const stepSummary = exp.steps.map(s => `${s.tool}(${JSON.stringify(s.args).slice(0, 50)})`).join(' → ');
          nodes.push({
            id: `exp-${exp.id}`,
            content: `[经验: ${exp.name}] ${exp.description ?? ''} 步骤: ${stepSummary}`,
            vector: new Float32Array(128),
            source: 'experience',
            score: exp.stats.confidence,
            timestamp: exp.stats.lastUsed ?? 0,
            metadata: { experienceId: exp.id, steps: exp.steps.length },
          });
        }
      }

      return nodes.slice(0, 5);
    } catch (err) {
      if (this.verbose) console.warn('[KnowledgeConvergence] 经验采集失败:', (err as Error).message);
      return [];
    }
  }

  /**
   * KnowledgeSourceManager (本地/网络/飞书) → CollisionNode
   */
  private async fromKnowledgeSources(input: string, options?: ConvergenceOptions): Promise<CollisionNode[]> {
    if (!this.knowledgeSourceManager) return [];
    try {
      const results = await this.knowledgeSourceManager.query(input, {
        limit: 5,
        deduplicate: true,
      });

      return results.map(node => ({
        id: `ksm-${node.id}`,
        content: node.content || node.title,
        vector: new Float32Array(128),
        source: node.sourceType,
        score: node.score,
        timestamp: node.updatedAt,
        metadata: { domain: node.domain, concepts: node.concepts },
      }));
    } catch (err) {
      if (this.verbose) console.warn('[KnowledgeConvergence] 知识源采集失败:', (err as Error).message);
      return [];
    }
  }

  /**
   * 三进制路由 → CollisionNode
   */
  private async fromTernary(input: string, options?: ConvergenceOptions): Promise<CollisionNode[]> {
    if (!this.ternaryRouter) return [];
    try {
      const tags = options?.contextTags ?? [];
      const domain = tags[0] ?? 'general';
      const result = await this.ternaryRouter.query(domain, input);

      if (!result.answer) return [];

      return [{
        id: `ternary-${domain}`,
        content: result.answer,
        vector: new Float32Array(128),
        source: 'ternary',
        score: result.confidence ?? 0.6,
        timestamp: Date.now(),
        metadata: { domain },
      }];
    } catch (err) {
      if (this.verbose) console.warn('[KnowledgeConvergence] 三进制采集失败:', (err as Error).message);
      return [];
    }
  }

  /**
   * 工具执行结果 → CollisionNode
   */
  private fromToolResults(options?: ConvergenceOptions): CollisionNode[] {
    if (!options?.toolResults || options.toolResults.length === 0) return [];

    return options.toolResults
      .filter(tr => tr.result && tr.result.length > 10)
      .map((tr, i) => ({
        id: `tool-${tr.name}-${i}`,
        content: `[工具 ${tr.name}] ${tr.result.slice(0, 500)}`,
        vector: new Float32Array(128),
        source: 'tool',
        score: 0.9,  // 工具结果高置信度
        timestamp: Date.now(),
        metadata: { toolName: tr.name },
      }));
  }

  /**
   * 对话上下文 → CollisionNode
   */
  private fromConversation(input: string): CollisionNode[] {
    // 对话上下文作为低优先级补充
    return [{
      id: `conv-${Date.now()}`,
      content: input,
      vector: new Float32Array(128),
      source: 'conversation',
      score: 0.3,
      timestamp: Date.now(),
    }];
  }

  /**
   * 向量化：用 TextEncoder 生成 128 维向量
   */
  private async vectorizeNodes(nodes: CollisionNode[], input: string): Promise<void> {
    if (!this.textEncoder) return;

    try {
      // 向量化输入（用于后续相关性计算）
      const inputVec = this.textEncoder.forwardPooled(input);

      // 向量化每个节点
      for (const node of nodes) {
        try {
          const vec = this.textEncoder.forwardPooled(node.content);
          node.vector = new Float32Array(vec.data);
        } catch {
          // 单节点向量化失败，保留零向量
        }
      }
    } catch {
      // TextEncoder 整体失败，跳过向量化
    }
  }

  /**
   * 去重：基于内容前 100 字符
   */
  private dedup(nodes: CollisionNode[]): CollisionNode[] {
    const seen = new Set<string>();
    return nodes.filter(node => {
      const key = `${node.source}:${node.content.slice(0, 100)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * 超时包装
   */
  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.verbose) console.warn(`[KnowledgeConvergence] ${label} 超时 (${ms}ms)`);
        reject(new Error(`timeout: ${label}`));
      }, ms);

      promise.then(
        result => { clearTimeout(timer); resolve(result); },
        err => { clearTimeout(timer); reject(err); },
      );
    });
  }
}
