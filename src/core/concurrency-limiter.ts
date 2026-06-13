/**
 * ConcurrencyLimiter — Vegas + AIMD 混合自适应并发控制
 *
 * 核心思路：把 LLM API 并发当成 TCP 拥塞控制问题
 * - 429 限流 → 紧急砍半（乘性减）
 * - 超时/错误 → 温和减速
 * - 延迟低 → 缓慢加速（加性增）
 * - 延迟高 → 减速
 * - 稳定区 → 不变
 *
 * 参考：Netflix concurrency-limits / TCP Vegas / AIMD
 */

export interface TaskSample {
  id: string;
  latencyMs: number;
  success: boolean;
  errorCode?: number;       // HTTP 错误码（429/500/timeout）
  taskWeight?: 'light' | 'normal' | 'heavy';
  timestamp: number;
  /** LLM 响应中的 total_tokens，用于归一化延迟（区分"堵了"和"prompt 长"） */
  promptTokens?: number;
}

export interface AdaptiveConfig {
  /** 初始并发数（默认 3） */
  initialLimit: number;
  /** 最小并发数（默认 1） */
  minLimit: number;
  /** 最大并发数（默认 10） */
  maxLimit: number;
  /** 采样窗口大小（默认 10） */
  sampleWindow: number;
  /** 加速阈值：队列估算 < alpha 时加速（默认 2） */
  alpha: number;
  /** 减速阈值：队列估算 > beta 时减速（默认 5） */
  beta: number;
  /** 加速冷却时间 ms（默认 5000） */
  scaleUpCooldownMs: number;
  /** 减速冷却时间 ms（默认 1000） */
  scaleDownCooldownMs: number;
  /** minRTT 重置间隔（每 N 次采样刷新一次，默认 100） */
  minRTTResetInterval: number;
}

export interface LimiterStatus {
  currentLimit: number;
  minRTT: number;
  avgRTT: number;
  sampleCount: number;
  recentSamples: TaskSample[];
  lastScaleAction: 'up' | 'down' | 'none';
  lastScaleActionAt: number;
  algorithm: string;
}

const DEFAULT_CONFIG: Omit<AdaptiveConfig, 'initialLimit'> = {
  minLimit: 1,
  maxLimit: 10,
  sampleWindow: 10,
  alpha: 2,
  beta: 5,
  scaleUpCooldownMs: 5_000,
  scaleDownCooldownMs: 1_000,
  minRTTResetInterval: 100,
};

export class ConcurrencyLimiter {
  private config: AdaptiveConfig;
  private limit: number;
  private minRTT = Infinity;
  private samples: TaskSample[] = [];
  private totalSampleCount = 0;
  private lastScaleUpAt = 0;
  private lastScaleDownAt = 0;
  private lastScaleAction: 'up' | 'down' | 'none' = 'none';
  private lastScaleActionAt = 0;
  private verbose: boolean;

  constructor(config: Partial<AdaptiveConfig> & { initialLimit: number }, verbose = false) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.limit = this.config.initialLimit;
    this.verbose = verbose;
  }

  /**
   * 任务完成时调用，返回新的并发数
   */
  onSample(sample: TaskSample): number {
    const oldLimit = this.limit;

    // ── 1. 429 限流 → 紧急刹车 ──
    if (sample.errorCode === 429) {
      this.limit = Math.max(this.config.minLimit, Math.floor(this.limit * 0.5));
      this.lastScaleAction = 'down';
      this.lastScaleActionAt = Date.now();
      this.log(`429 限流 → limit ${oldLimit} → ${this.limit}`);
      return this.limit;
    }

    // ── 2. 超时/错误 → 温和减速 ──
    if (!success(sample)) {
      this.limit = Math.max(this.config.minLimit, Math.floor(this.limit * 0.75));
      this.lastScaleAction = 'down';
      this.lastScaleActionAt = Date.now();
      this.log(`任务失败 → limit ${oldLimit} → ${this.limit}`);
      return this.limit;
    }

    // ── 3. 成功 → Vegas 延迟探测 ──

    // 记录成功请求时间戳（用于运行时 RPM 估算）
    this.recordSuccess(sample.timestamp);

    // 归一化延迟：长 prompt 不应被误判为拥塞
    // 基准 token 数 500，prompt 越长归一化系数越小
    const BASELINE_TOKENS = 500;
    const normalizedLatency = sample.promptTokens && sample.promptTokens > 0
      ? sample.latencyMs * (BASELINE_TOKENS / sample.promptTokens)
      : sample.latencyMs;

    // 更新基准延迟（用归一化后的值）
    if (normalizedLatency < this.minRTT) {
      this.minRTT = normalizedLatency;
    }

    // 累积采样
    this.samples.push(sample);
    this.totalSampleCount++;

    // 定期重置 minRTT（防止基准失真）
    if (this.totalSampleCount % this.config.minRTTResetInterval === 0) {
      const oldMinRTT = this.minRTT;
      this.minRTT = Math.min(...this.samples.map(s => {
        const norm = s.promptTokens && s.promptTokens > 0
          ? s.latencyMs * (BASELINE_TOKENS / s.promptTokens)
          : s.latencyMs;
        return norm;
      }));
      if (this.verbose && oldMinRTT !== this.minRTT) {
        console.log(`  [ConcurrencyLimiter] minRTT 重置: ${oldMinRTT.toFixed(0)}ms → ${this.minRTT.toFixed(0)}ms`);
      }
    }

    // 采样窗口未满，不决策
    if (this.samples.length < this.config.sampleWindow) {
      return this.limit;
    }

    // 窗口已满，开始决策
    // 用归一化延迟计算 avgRTT，避免长 prompt 误判为拥塞
    const avgRTT = this.samples.reduce((sum, s) => {
      const norm = s.promptTokens && s.promptTokens > 0
        ? s.latencyMs * (BASELINE_TOKENS / s.promptTokens)
        : s.latencyMs;
      return sum + norm;
    }, 0) / this.samples.length;
    const queueEstimate = this.limit * (1 - this.minRTT / avgRTT);

    const now = Date.now();

    if (queueEstimate < this.config.alpha) {
      // 路很空 → 加速（加性增）
      if (now - this.lastScaleUpAt >= this.config.scaleUpCooldownMs) {
        this.limit = Math.min(this.config.maxLimit, this.limit + 1);
        this.lastScaleUpAt = now;
        this.lastScaleAction = 'up';
        this.lastScaleActionAt = now;
        this.log(`延迟低 (queue=${queueEstimate.toFixed(2)}) → limit ${oldLimit} → ${this.limit}`);
      }
    } else if (queueEstimate > this.config.beta) {
      // 堵了 → 减速
      if (now - this.lastScaleDownAt >= this.config.scaleDownCooldownMs) {
        this.limit = Math.max(this.config.minLimit, this.limit - 1);
        this.lastScaleDownAt = now;
        this.lastScaleAction = 'down';
        this.lastScaleActionAt = now;
        this.log(`延迟高 (queue=${queueEstimate.toFixed(2)}) → limit ${oldLimit} → ${this.limit}`);
      }
    }
    // alpha <= queueEstimate <= beta → 稳定区，不变

    // 清空采样窗口
    this.samples = [];

    return this.limit;
  }

  /** 获取当前并发数 */
  getLimit(): number {
    return this.limit;
  }

  /** 手动设置并发数（用于外部覆盖） */
  setLimit(n: number): void {
    this.limit = clamp(n, this.config.minLimit, this.config.maxLimit);
  }

  /** 动态更新 maxLimit（运行时 RPM 估算驱动） */
  setMaxLimit(newMax: number): void {
    this.config.maxLimit = clamp(newMax, this.config.minLimit, 100);
    // 确保当前 limit 不超过新的 maxLimit
    this.limit = Math.min(this.limit, this.config.maxLimit);
  }

  /** 获取状态快照 */
  getStatus(): LimiterStatus {
    const recentRTTs = this.samples.map(s => s.latencyMs);
    return {
      currentLimit: this.limit,
      minRTT: this.minRTT === Infinity ? 0 : this.minRTT,
      avgRTT: recentRTTs.length > 0 ? recentRTTs.reduce((a, b) => a + b, 0) / recentRTTs.length : 0,
      sampleCount: this.totalSampleCount,
      recentSamples: [...this.samples],
      lastScaleAction: this.lastScaleAction,
      lastScaleActionAt: this.lastScaleActionAt,
      algorithm: 'vegas+aimd',
    };
  }

  /** 重置状态 */
  reset(): void {
    this.limit = this.config.initialLimit;
    this.minRTT = Infinity;
    this.samples = [];
    this.totalSampleCount = 0;
    this.lastScaleUpAt = 0;
    this.lastScaleDownAt = 0;
    this.lastScaleAction = 'none';
    this.lastScaleActionAt = 0;
    this.successTimestamps = [];
  }

  /**
   * 运行时 RPM 估算 — 基于最近 60 秒的成功请求数
   * 替代静态 PROVIDER_RPM_TABLE，让 estimateMaxLimit 更准确
   */
  estimateRPM(): number {
    const now = Date.now();
    const windowMs = 60_000;
    const recent = this.successTimestamps.filter(t => now - t < windowMs);
    return recent.length; // 最近 60 秒的请求数 ≈ RPM
  }

  /** 记录成功请求的时间戳（由 onSample 内部调用） */
  private successTimestamps: number[] = [];
  private readonly MAX_TIMESTAMPS = 1000;

  private recordSuccess(timestamp: number): void {
    this.successTimestamps.push(timestamp);
    // 清理 60 秒前的记录
    const cutoff = timestamp - 60_000;
    this.successTimestamps = this.successTimestamps.filter(t => t > cutoff);
    if (this.successTimestamps.length > this.MAX_TIMESTAMPS) {
      this.successTimestamps = this.successTimestamps.slice(-this.MAX_TIMESTAMPS);
    }
  }

  private log(msg: string): void {
    if (this.verbose) {
      console.log(`  [ConcurrencyLimiter] ${msg}`);
    }
  }
}

/** 判断任务是否成功 */
function success(sample: TaskSample): boolean {
  if (sample.success) return true;
  if (sample.errorCode && sample.errorCode >= 500) return false;
  if (sample.errorCode === 408) return false; // timeout
  return sample.success;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
