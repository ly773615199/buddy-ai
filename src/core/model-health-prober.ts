/**
 * ModelHealthProber — 模型健康探测器
 *
 * 轻量级后台探测：模型是否可达、延迟如何、是否支持声明的能力
 * 不测质量（那是 QualityAssessor 的事），只测"能不能用"
 *
 * 增强（前沿调研补充 7.2）：
 * - 与 QualityEstimator 联动：unhealthy 模型的质量估计自动降权
 * - 探测结果写入 ModelProfile 的新字段
 */

import type { ModelPool, ModelProfile } from './model-pool.js';

// ==================== 类型定义 ====================

export interface HealthProbeResult {
  modelId: string;
  reachable: boolean;
  latencyMs: number;
  quality: 'healthy' | 'degraded' | 'unhealthy';
  capabilities: {
    toolCallingVerified: boolean;
    visionVerified: boolean;
  };
  lastProbedAt: number;
  probeCount: number;
  consecutiveFailures: number;
  error?: string;
}

export interface ProbeConfig {
  /** 探测间隔 ms（默认 10 分钟） */
  intervalMs: number;
  /** 探测超时 ms（默认 10s） */
  timeoutMs: number;
  /** 延迟阈值：超过此值标记 degraded（默认 5s） */
  degradedThresholdMs: number;
  /** 连续失败阈值：超过此值标记 unhealthy（默认 3） */
  unhealthyThreshold: number;
  /** 是否启用 */
  enabled: boolean;
}

export interface ProbeOptions {
  /** 自定义探测调用器（测试用） */
  prober?: (modelId: string) => Promise<{ reachable: boolean; latencyMs: number; error?: string }>;
}

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: ProbeConfig = {
  intervalMs: 10 * 60 * 1000,    // 10 分钟
  timeoutMs: 10_000,               // 10 秒
  degradedThresholdMs: 5_000,      // 5 秒
  unhealthyThreshold: 3,           // 连续 3 次失败
  enabled: true,
};

// ==================== 探测器 ====================

export class ModelHealthProber {
  private config: ProbeConfig;
  private results = new Map<string, HealthProbeResult>();
  private pool: ModelPool;
  private timer: ReturnType<typeof setInterval> | null = null;
  private verbose: boolean;
  private prober: ((modelId: string) => Promise<{ reachable: boolean; latencyMs: number; error?: string }>) | null;
  /** 新模型优先队列 — 入池后立即探测 */
  private priorityQueue: Set<string> = new Set();
  /** ResourceHub 回调 — 探测结果同步 */
  private resourceHubSync: ((modelId: string, result: HealthProbeResult) => void) | null = null;

  constructor(pool: ModelPool, config?: Partial<ProbeConfig>, options?: ProbeOptions & { resourceHubSync?: (modelId: string, result: HealthProbeResult) => void }, verbose = false) {
    this.pool = pool;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.verbose = verbose;
    this.prober = options?.prober ?? null;
    this.resourceHubSync = options?.resourceHubSync ?? null;
  }

  /**
   * 将新模型加入优先探测队列
   * 入池时调用，下次探测周期会优先处理这些模型
   */
  enqueuePriority(modelIds: string[]): void {
    for (const id of modelIds) this.priorityQueue.add(id);
    // 如果探测器尚未启动，立即触发一次优先探测
    if (this.config.enabled && !this.timer) {
      this.probePriority().catch(() => {});
    }
  }

  /**
   * 立即探测优先队列中的模型（不等待定时器）
   */
  async probePriority(): Promise<HealthProbeResult[]> {
    if (this.priorityQueue.size === 0) return [];
    const ids = [...this.priorityQueue];
    this.priorityQueue.clear();

    if (this.verbose) console.log(`[HealthProber] 优先探活 ${ids.length} 个新模型...`);

    const results: HealthProbeResult[] = [];
    const BATCH_SIZE = 3;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map(id => this.probeOne(id)),
      );
      for (const r of batchResults) {
        if (r.status === 'fulfilled') results.push(r.value);
      }
    }

    return results;
  }

  // ==================== 生命周期 ====================

  /** 启动后台定期探测 */
  start(): void {
    if (!this.config.enabled) return;
    if (this.timer) return;

    this.timer = setInterval(() => {
      this.probeAll().catch(err => {
        if (this.verbose) console.warn('[HealthProber] 批量探测失败:', (err as Error).message);
      });
    }, this.config.intervalMs);

    // 首次探测延迟 30 秒（等系统稳定）
    setTimeout(() => {
      if (this.verbose) console.log(`[HealthProber] 首次探活开始...`);
      this.probeAll().then(results => {
        const available = results.filter(r => r.reachable).length;
        const denied = results.filter(r => !r.reachable).length;
        if (this.verbose) console.log(`[HealthProber] 首次探活完成: ${available} 可用, ${denied} 不可用, 共 ${results.length} 个`);
      }).catch(err => {
        if (this.verbose) console.warn('[HealthProber] 首次探活失败:', (err as Error).message);
      });
    }, 30_000);

    if (this.verbose) console.log(`[HealthProber] 启动，间隔 ${this.config.intervalMs / 1000}s`);
  }

  /** 停止后台探测 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ==================== 探测 ====================

  /** 探测所有模型 */
  async probeAll(): Promise<HealthProbeResult[]> {
    const profiles = this.pool.getAllProfiles();
    if (this.verbose) console.log(`[HealthProber] 开始探活 ${profiles.length} 个模型...`);
    const results: HealthProbeResult[] = [];

    // 限制并发：最多同时探测 3 个
    const BATCH_SIZE = 3;
    for (let i = 0; i < profiles.length; i += BATCH_SIZE) {
      const batch = profiles.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map(p => this.probeOne(p.id)),
      );
      for (const r of batchResults) {
        if (r.status === 'fulfilled') results.push(r.value);
      }
    }

    return results;
  }

  /** 探测单个模型 */
  async probeOne(modelId: string): Promise<HealthProbeResult> {
    const existing = this.results.get(modelId);
    const probeCount = (existing?.probeCount ?? 0) + 1;

    // 如果上次探测是 degraded 或 unhealthy，检查是否需要重试
    if (existing && existing.quality === 'healthy') {
      const elapsed = Date.now() - existing.lastProbedAt;
      if (elapsed < this.config.intervalMs) {
        return existing; // 还在冷却期
      }
    }

    const startMs = Date.now();
    let reachable = false;
    let latencyMs = 0;
    let error: string | undefined;

    try {
      if (this.prober) {
        // 自定义探测器
        const result = await this.withTimeout(
          this.prober(modelId),
          this.config.timeoutMs,
        );
        reachable = result.reachable;
        latencyMs = result.latencyMs;
        error = result.error;
      } else {
        // 默认探测：检查模型是否在池中且可用
        const profile = this.pool.getProfile(modelId);
        if (!profile) {
          reachable = false;
          error = '模型不在池中';
        } else {
          // 简单可达性检查（不实际调用 LLM）
          reachable = profile.capabilities.streaming !== false;
          latencyMs = Date.now() - startMs;
        }
      }
    } catch (err) {
      reachable = false;
      latencyMs = Date.now() - startMs;
      error = (err as Error).message;
    }

    // 计算健康状态
    const consecutiveFailures = reachable
      ? 0
      : (existing?.consecutiveFailures ?? 0) + 1;

    const quality: HealthProbeResult['quality'] =
      !reachable && consecutiveFailures >= this.config.unhealthyThreshold
        ? 'unhealthy'
        : reachable && latencyMs > this.config.degradedThresholdMs
        ? 'degraded'
        : reachable
        ? 'healthy'
        : 'degraded';

    const result: HealthProbeResult = {
      modelId,
      reachable,
      latencyMs,
      quality,
      capabilities: {
        toolCallingVerified: existing?.capabilities.toolCallingVerified ?? false,
        visionVerified: existing?.capabilities.visionVerified ?? false,
      },
      lastProbedAt: Date.now(),
      probeCount,
      consecutiveFailures,
      error,
    };

    this.results.set(modelId, result);

    // 回写 ModelPool 的 accessStatus（P2-2: 探活结果同步到模型画像）
    try {
      const profile = this.pool.getProfile(modelId);
      if (profile) {
        if (reachable) {
          // 可达 → 恢复为 available
          this.pool.setModelAccessStatus(modelId, 'available');
        } else {
          // 不可达 → 探活是独立检查，一次失败即标记
          const errorType = error === 'auth' ? 'auth'
            : error === 'payment' ? 'payment'
            : error === 'permission' ? 'permission'
            : error === 'not_found' ? 'not_found'
            : error === 'rate_limited' ? 'rate_limited'
            : error === 'inference_failed' ? 'unknown'
            : error?.includes('abort') || error?.includes('timeout') ? 'timeout'
            : 'network';
          // 探活是主动探测，一次不可达即标记 denied（非运行时失败累积）
          const newStatus = errorType === 'not_found' ? 'denied' // 端点不支持，可能重试
            : errorType === 'auth' ? 'denied'            // Key 问题，用户可能更换
            : consecutiveFailures >= this.config.unhealthyThreshold ? 'broken'
            : 'denied';
          this.pool.setModelAccessStatus(modelId, newStatus);
          profile.failureType = errorType as any;
          profile.failureStreak = consecutiveFailures;
          profile.lastFailureAt = Date.now();
          if (this.verbose) console.warn(`[HealthProber] ${modelId} → ${newStatus} (${errorType})`);
        }
      }
    } catch { /* 静默 */ }

    // unhealthy 模型自动降权
    if (quality === 'unhealthy') {
      if (this.verbose) console.warn(`[HealthProber] ${modelId} 标记为 unhealthy (连续 ${consecutiveFailures} 次失败)`);
    }

    // 同步探测结果到 ResourceHub（一致性保障）
    try {
      this.resourceHubSync?.(modelId, result);
    } catch { /* 静默 */ }

    return result;
  }

  // ==================== 查询 ====================

  /** 获取模型健康状态 */
  getHealth(modelId: string): HealthProbeResult | null {
    return this.results.get(modelId) ?? null;
  }

  /** 获取所有健康状态 */
  getAllHealth(): HealthProbeResult[] {
    return [...this.results.values()];
  }

  /** 获取 unhealthy 模型列表 */
  getUnhealthyModels(): string[] {
    return [...this.results.values()]
      .filter(r => r.quality === 'unhealthy')
      .map(r => r.modelId);
  }

  /** 获取 degraded 模型列表 */
  getDegradedModels(): string[] {
    return [...this.results.values()]
      .filter(r => r.quality === 'degraded')
      .map(r => r.modelId);
  }

  /** 模型是否可用（非 unhealthy） */
  isAvailable(modelId: string): boolean {
    const health = this.results.get(modelId);
    if (!health) return true; // 未探测过默认可用
    return health.quality !== 'unhealthy';
  }

  /**
   * 获取质量估计系数（供 Thompson Sampling 加权用）
   * healthy → 1.0, degraded → 0.7, unhealthy → 0.3
   */
  getQualityFactor(modelId: string): number {
    const health = this.results.get(modelId);
    if (!health) return 1.0;
    switch (health.quality) {
      case 'healthy': return 1.0;
      case 'degraded': return 0.7;
      case 'unhealthy': return 0.3;
    }
  }

  // ==================== 工具 ====================

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`探测超时 (${ms}ms)`)), ms),
      ),
    ]);
  }
}
