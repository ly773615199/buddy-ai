/**
 * 性能模块 — 缓存
 */

// ── LRU 缓存 ──

export interface CacheOptions {
  maxSize: number;
  ttlMs: number;        // 过期时间（ms），0=不过期
}

export class LRUCache<V> {
  private cache = new Map<string, { value: V; expiry: number }>();
  private maxSize: number;
  private ttlMs: number;

  constructor(options: CacheOptions) {
    this.maxSize = options.maxSize;
    this.ttlMs = options.ttlMs;
  }

  get(key: string): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (this.ttlMs > 0 && Date.now() > entry.expiry) {
      this.cache.delete(key);
      return undefined;
    }

    // 移到最新（LRU）
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // 删除最旧的
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      value,
      expiry: this.ttlMs > 0 ? Date.now() + this.ttlMs : Infinity,
    });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  /** 清理过期条目 */
  purgeExpired(): number {
    const now = Date.now();
    let purged = 0;
    for (const [key, entry] of this.cache) {
      if (this.ttlMs > 0 && now > entry.expiry) {
        this.cache.delete(key);
        purged++;
      }
    }
    return purged;
  }

  /** 获取统计 */
  getStats() {
    return { size: this.cache.size, maxSize: this.maxSize, ttlMs: this.ttlMs };
  }
}


