/**
 * ProviderLimiter — provider/model 级别速率限制追踪
 *
 * 滑动窗口计数器，独立追踪每个 provider/model 组合的：
 * - RPM（每分钟请求数）
 * - TPM（每分钟 token 数）
 *
 * 超限时返回降级建议，与 ModelPool 熔断机制协同。
 *
 * 并发安全：所有公共方法均为同步操作，在 Node.js 单线程事件循环模型下
 * 天然原子，无需额外加锁。若未来迁移到 Worker Threads，需引入 Atomics
 * 或 Mutex 保护 windows/cooldowns Map。
 */

// ==================== 配置 ====================

export interface ProviderLimitConfig {
  /** 每分钟最大请求数 */
  rpm: number;
  /** 每分钟最大 token 数 */
  tpm: number;
  /** 超限后冷却时间（秒） */
  cooldownSec: number;
}

export interface LimitCheckResult {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
  /** 建议降级到的 provider/model */
  fallback?: { provider: string; model: string };
}

// ==================== 滑动窗口 ====================

interface WindowBucket {
  timestamps: number[];
  tokens: number[];
}

const DEFAULT_LIMITS: ProviderLimitConfig = {
  rpm: 60,
  tpm: 100000,
  cooldownSec: 10,
};

// 已知 provider 默认限制（可被配置覆盖）
const PROVIDER_DEFAULTS: Record<string, ProviderLimitConfig> = {
  openai: { rpm: 500, tpm: 300000, cooldownSec: 5 },
  anthropic: { rpm: 50, tpm: 100000, cooldownSec: 10 },
  google: { rpm: 60, tpm: 1000000, cooldownSec: 5 },
  deepseek: { rpm: 30, tpm: 100000, cooldownSec: 10 },
  siliconflow: { rpm: 100, tpm: 200000, cooldownSec: 5 },
  mimo: { rpm: 60, tpm: 100000, cooldownSec: 10 },
  ollama: { rpm: 999, tpm: 999999, cooldownSec: 0 }, // 本地无限
};

// ==================== ProviderLimiter ====================

export class ProviderLimiter {
  private windows = new Map<string, WindowBucket>();
  private cooldowns = new Map<string, number>(); // key → 恢复时间戳
  private limits = new Map<string, ProviderLimitConfig>();
  private readonly windowMs = 60_000; // 1 分钟窗口

  constructor(customLimits?: Record<string, Partial<ProviderLimitConfig>>) {
    if (customLimits) {
      for (const [key, partial] of Object.entries(customLimits)) {
        const base = PROVIDER_DEFAULTS[key] ?? DEFAULT_LIMITS;
        this.limits.set(key, { ...base, ...partial });
      }
    }
  }

  // ==================== 核心方法 ====================

  /**
   * 检查是否允许发送请求
   */
  check(provider: string, model: string): LimitCheckResult {
    const key = this.makeKey(provider, model);
    const now = Date.now();

    // 冷却期检查
    const cooldownUntil = this.cooldowns.get(key);
    if (cooldownUntil && now < cooldownUntil) {
      return {
        allowed: false,
        reason: `冷却中（${Math.ceil((cooldownUntil - now) / 1000)}s 后恢复）`,
        retryAfterMs: cooldownUntil - now,
      };
    }

    const limits = this.getLimits(provider);
    const window = this.getOrCreateWindow(key);

    // 清理过期记录
    this.cleanupWindow(window, now);

    // RPM 检查
    if (window.timestamps.length >= limits.rpm) {
      const oldest = window.timestamps[0];
      const retryAfterMs = oldest + this.windowMs - now;
      this.cooldowns.set(key, now + limits.cooldownSec * 1000);
      return {
        allowed: false,
        reason: `RPM 超限（${window.timestamps.length}/${limits.rpm}）`,
        retryAfterMs,
      };
    }

    // TPM 检查
    const totalTokens = window.tokens.reduce((a, b) => a + b, 0);
    if (totalTokens >= limits.tpm) {
      const retryAfterMs = limits.cooldownSec * 1000;
      this.cooldowns.set(key, now + retryAfterMs);
      return {
        allowed: false,
        reason: `TPM 超限（${totalTokens}/${limits.tpm}）`,
        retryAfterMs,
      };
    }

    return { allowed: true };
  }

  /**
   * 记录一次请求（调用成功后）
   */
  record(provider: string, model: string, tokens: number = 0): void {
    const key = this.makeKey(provider, model);
    const now = Date.now();
    const window = this.getOrCreateWindow(key);

    window.timestamps.push(now);
    window.tokens.push(tokens);

    // 清理过期记录
    this.cleanupWindow(window, now);

    // 清除冷却（成功请求说明已恢复）
    this.cooldowns.delete(key);
  }

  /**
   * 记录一次失败（429 等限流错误）
   */
  recordLimitHit(provider: string, model: string): void {
    const key = this.makeKey(provider, model);
    const limits = this.getLimits(provider);
    this.cooldowns.set(key, Date.now() + limits.cooldownSec * 1000);
  }

  // ==================== 查询 ====================

  /**
   * 获取当前使用统计
   */
  getStats(provider: string, model: string): {
    rpm: number;
    rpmLimit: number;
    tpm: number;
    tpmLimit: number;
    inCooldown: boolean;
    cooldownRemainingMs: number;
  } {
    const key = this.makeKey(provider, model);
    const limits = this.getLimits(provider);
    const now = Date.now();
    const window = this.windows.get(key);

    let rpm = 0;
    let tpm = 0;

    if (window) {
      this.cleanupWindow(window, now);
      rpm = window.timestamps.length;
      tpm = window.tokens.reduce((a, b) => a + b, 0);
    }

    const cooldownUntil = this.cooldowns.get(key) ?? 0;
    const inCooldown = now < cooldownUntil;

    return {
      rpm,
      rpmLimit: limits.rpm,
      tpm,
      tpmLimit: limits.tpm,
      inCooldown,
      cooldownRemainingMs: inCooldown ? cooldownUntil - now : 0,
    };
  }

  /**
   * 获取所有被追踪的 provider/model 组合统计
   */
  getAllStats(): Array<{
    provider: string;
    model: string;
    rpm: number;
    rpmLimit: number;
    tpm: number;
    tpmLimit: number;
    inCooldown: boolean;
  }> {
    const now = Date.now();
    const results: Array<{
      provider: string;
      model: string;
      rpm: number;
      rpmLimit: number;
      tpm: number;
      tpmLimit: number;
      inCooldown: boolean;
    }> = [];

    for (const [key, window] of this.windows) {
      this.cleanupWindow(window, now);
      const [provider, model] = key.split('::');
      const limits = this.getLimits(provider);
      const cooldownUntil = this.cooldowns.get(key) ?? 0;

      results.push({
        provider,
        model,
        rpm: window.timestamps.length,
        rpmLimit: limits.rpm,
        tpm: window.tokens.reduce((a, b) => a + b, 0),
        tpmLimit: limits.tpm,
        inCooldown: now < cooldownUntil,
      });
    }

    return results;
  }

  // ==================== 内部 ====================

  private makeKey(provider: string, model: string): string {
    return `${provider}::${model}`;
  }

  private getLimits(provider: string): ProviderLimitConfig {
    return this.limits.get(provider) ?? PROVIDER_DEFAULTS[provider] ?? DEFAULT_LIMITS;
  }

  private getOrCreateWindow(key: string): WindowBucket {
    let window = this.windows.get(key);
    if (!window) {
      window = { timestamps: [], tokens: [] };
      this.windows.set(key, window);
    }
    return window;
  }

  private cleanupWindow(window: WindowBucket, now: number): void {
    const cutoff = now - this.windowMs;
    while (window.timestamps.length > 0 && window.timestamps[0] < cutoff) {
      window.timestamps.shift();
      window.tokens.shift();
    }
  }
}
