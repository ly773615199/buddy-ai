/**
 * 工具结果缓存 — LRU + TTL
 *
 * 对相同工具+相同参数的结果做缓存，避免重复执行
 */

interface CacheEntry {
  result: string;
  expiresAt: number; // 0 = 不过期
}

export class ToolCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;

  constructor(maxSize = 200) {
    this.maxSize = maxSize;
  }

  /**
   * 生成缓存键
   */
  static makeKey(toolName: string, args: Record<string, unknown>): string {
    // 排序 key 保证一致性
    const sorted = Object.keys(args).sort().reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = args[k];
      return acc;
    }, {});
    return `${toolName}:${JSON.stringify(sorted)}`;
  }

  /**
   * 获取缓存
   */
  get(key: string): string | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    // LRU: 移到末尾
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.result;
  }

  /**
   * 写入缓存
   */
  set(key: string, result: string, ttlSec = 0): void {
    // 驱逐超限
    if (this.cache.size >= this.maxSize) {
      const first = this.cache.keys().next().value;
      if (first) this.cache.delete(first);
    }
    this.cache.set(key, {
      result,
      expiresAt: ttlSec > 0 ? Date.now() + ttlSec * 1000 : 0,
    });
  }

  /**
   * 清除过期条目
   */
  purge(): number {
    const now = Date.now();
    let purged = 0;
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt > 0 && now > entry.expiresAt) {
        this.cache.delete(key);
        purged++;
      }
    }
    return purged;
  }

  /** 缓存大小 */
  get size(): number {
    return this.cache.size;
  }

  /** 清空 */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 按工具名 + 参数前缀失效缓存
   * 用于 write_file 后清除对应 read_file 缓存
   */
  invalidate(toolName: string, argsPrefix?: Record<string, unknown>): void {
    const prefix = argsPrefix
      ? `${toolName}:${JSON.stringify(argsPrefix)}`
      : `${toolName}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }
}

/** 全局工具缓存实例 */
export const globalToolCache = new ToolCache();

// ──────────────────────────────────────────────────────────
// P4: 语义缓存 — 不同措辞同一意图命中同一缓存
// ──────────────────────────────────────────────────────────

/** 停用词（用于意图指纹提取）— 使用共享停用词表 */
import { SHARED_STOP_WORDS } from '../core/constants.js';
const INTENT_STOP_WORDS = SHARED_STOP_WORDS;

interface SemanticCacheEntry {
  intentHash: string;
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }>;
  timestamp: number;
}

/**
 * 语义缓存 — 将用户输入抽象为意图指纹
 * 不同措辞但相同意图的请求命中同一缓存
 */
export class SemanticToolCache {
  private exactCache = new ToolCache(200);
  private intentCache = new Map<string, SemanticCacheEntry>();
  private readonly TTL_MS = 60_000; // 60s 过期
  private readonly MAX_INTENT_ENTRIES = 500; // H4: 限制 intentCache 大小

  /** 意图指纹：提取核心语义词，忽略停用词和措辞 */
  computeIntentHash(content: string): string {
    const lower = content.toLowerCase();

    // 提取英文/数字词
    const engWords = lower.match(/[\w][\w.]*/g) ?? [];

    // 提取中文 bigram（连续中文两两分组），过滤含停用字的
    const cjkRuns = lower.match(/[\u4e00-\u9fff]+/g) ?? [];
    const cjkBigrams: string[] = [];
    for (const run of cjkRuns) {
      for (let i = 0; i < run.length - 1; i++) {
        const bg = run.slice(i, i + 2);
        // 跳过含停用字的 bigram
        if ([...bg].some(ch => INTENT_STOP_WORDS.has(ch))) continue;
        cjkBigrams.push(bg);
      }
    }

    // 合并、过滤停用词和短 token
    const tokens = [...engWords, ...cjkBigrams]
      .filter(t => t.length >= 2 && !INTENT_STOP_WORDS.has(t))
      .sort()
      .slice(0, 8);
    return tokens.join('|');
  }

  /** 查询缓存（先精确 → 再语义） */
  get(content: string): SemanticCacheEntry | null {
    const hash = this.computeIntentHash(content);
    const cached = this.intentCache.get(hash);
    if (cached && Date.now() - cached.timestamp < this.TTL_MS) {
      return cached;
    }
    if (cached) this.intentCache.delete(hash); // 过期清理
    return null;
  }

  /** 写入语义缓存 */
  set(content: string, toolCalls: SemanticCacheEntry['toolCalls']): void {
    const hash = this.computeIntentHash(content);
    // H4: 超限时淘汰最旧条目
    if (this.intentCache.size >= this.MAX_INTENT_ENTRIES) {
      const first = this.intentCache.keys().next().value;
      if (first) this.intentCache.delete(first);
    }
    this.intentCache.set(hash, { intentHash: hash, toolCalls, timestamp: Date.now() });
  }

  /** 精确缓存代理 */
  getExact(key: string): string | null { return this.exactCache.get(key); }
  setExact(key: string, result: string, ttlSec?: number): void { this.exactCache.set(key, result, ttlSec); }

  /** 清理过期 */
  purge(): number {
    const now = Date.now();
    let purged = 0;
    for (const [k, v] of this.intentCache) {
      if (now - v.timestamp > this.TTL_MS) { this.intentCache.delete(k); purged++; }
    }
    return purged + this.exactCache.purge();
  }

  get size(): number { return this.exactCache.size + this.intentCache.size; }
  clear(): void { this.exactCache.clear(); this.intentCache.clear(); }
}

/** 全局语义缓存实例 */
export const globalSemanticCache = new SemanticToolCache();
