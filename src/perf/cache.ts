/**
 * 性能模块 — 缓存/限流/连接池
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

// ── 限流器 ──

export interface RateLimitOptions {
  maxRequests: number;    // 窗口内最大请求数
  windowMs: number;       // 窗口大小（ms）
}

export class RateLimiter {
  private windows: Map<string, { count: number; resetAt: number }> = new Map();
  private maxRequests: number;
  private windowMs: number;

  constructor(options: RateLimitOptions) {
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
  }

  /** 检查是否允许请求 */
  check(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    let window = this.windows.get(key);

    if (!window || now > window.resetAt) {
      window = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, window);
    }

    window.count++;

    return {
      allowed: window.count <= this.maxRequests,
      remaining: Math.max(0, this.maxRequests - window.count),
      resetAt: window.resetAt,
    };
  }

  /** 重置某个 key */
  reset(key: string): void {
    this.windows.delete(key);
  }

  /** 清理过期窗口 */
  purgeExpired(): number {
    const now = Date.now();
    let purged = 0;
    for (const [key, window] of this.windows) {
      if (now > window.resetAt) {
        this.windows.delete(key);
        purged++;
      }
    }
    return purged;
  }
}

// ── 连接池（抽象）──

export interface PoolOptions<T> {
  maxConnections: number;
  create: () => Promise<T>;
  destroy: (conn: T) => Promise<void>;
  validate?: (conn: T) => Promise<boolean>;
  idleTimeoutMs?: number;
}

export class ConnectionPool<T> {
  private available: Array<{ conn: T; lastUsed: number }> = [];
  private inUse = new Set<T>();
  private maxConnections: number;
  private createFn: () => Promise<T>;
  private destroyFn: (conn: T) => Promise<void>;
  private validateFn: ((conn: T) => Promise<boolean>) | undefined;
  private idleTimeoutMs: number;

  constructor(options: PoolOptions<T>) {
    this.maxConnections = options.maxConnections;
    this.createFn = options.create;
    this.destroyFn = options.destroy;
    this.validateFn = options.validate;
    this.idleTimeoutMs = options.idleTimeoutMs || 60000;
  }

  /** 获取连接 */
  async acquire(): Promise<T> {
    // 先从可用池取
    while (this.available.length > 0) {
      const entry = this.available.pop()!;
      if (this.validateFn) {
        const valid = await this.validateFn(entry.conn).catch(() => false);
        if (!valid) {
          await this.destroyFn(entry.conn).catch(() => {});
          continue;
        }
      }
      this.inUse.add(entry.conn);
      return entry.conn;
    }

    // 池满则等待或创建
    if (this.inUse.size < this.maxConnections) {
      const conn = await this.createFn();
      this.inUse.add(conn);
      return conn;
    }

    throw new Error('连接池已满');
  }

  /** 归还连接 */
  async release(conn: T): Promise<void> {
    this.inUse.delete(conn);
    this.available.push({ conn, lastUsed: Date.now() });
  }

  /** 清理空闲连接 */
  async purgeIdle(): Promise<number> {
    const now = Date.now();
    let purged = 0;
    const remaining: typeof this.available = [];

    for (const entry of this.available) {
      if (now - entry.lastUsed > this.idleTimeoutMs) {
        await this.destroyFn(entry.conn).catch(() => {});
        purged++;
      } else {
        remaining.push(entry);
      }
    }

    this.available = remaining;
    return purged;
  }

  /** 获取状态 */
  getStats() {
    return {
      available: this.available.length,
      inUse: this.inUse.size,
      maxConnections: this.maxConnections,
    };
  }

  /** 关闭池 */
  async shutdown(): Promise<void> {
    for (const entry of this.available) {
      await this.destroyFn(entry.conn).catch(() => {});
    }
    this.available = [];
    this.inUse.clear();
  }
}
