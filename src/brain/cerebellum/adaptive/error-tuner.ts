/**
 * 错误阈值自适应 — ErrorTuner
 *
 * 高频无害异常 → 弱化告警（suppressionFactor 衰减）
 * 致命阻塞 → 强化熔断（boostFactor 放大）
 *
 * 纯统计阈值调整，不改逻辑、不学新行为
 * 每小时周期衰减，缓慢恢复到中性值
 */

// ==================== 类型 ====================

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ErrorProfile {
  /** 错误类型标识 */
  errorType: string;
  /** 总次数 */
  occurrences: number;
  /** 最近 1 小时频率 */
  recentRate: number;
  /** 最近 1 小时时间戳队列 */
  recentTimestamps: number[];
  /** 严重度分级 */
  severity: ErrorSeverity;
  /** 最后发生时间 */
  lastOccurrence: number;
  /** 告警抑制因子（1.0 = 正常，0.1 = 几乎忽略） */
  suppressionFactor: number;
  /** 告警增强因子（1.0 = 正常，3.0 = 三倍敏感） */
  boostFactor: number;
}

export interface ErrorTunerConfig {
  /** 高频阈值：超过此次数/小时触发弱化 */
  highFrequencyThreshold: number;
  /** 弱化衰减率（每次观测） */
  suppressionDecay: number;
  /** suppressionFactor 下限 */
  minSuppression: number;
  /** 强化放大率（首次致命错误） */
  boostAmplify: number;
  /** boostFactor 上限 */
  maxBoost: number;
  /** 周期衰减：suppressionFactor 恢复率 */
  suppressionRecovery: number;
  /** 周期衰减：boostFactor 回落率 */
  boostRecovery: number;
  /** 时间窗口（ms） */
  windowMs: number;
}

const DEFAULT_CONFIG: ErrorTunerConfig = {
  highFrequencyThreshold: 10,
  suppressionDecay: 0.9,
  minSuppression: 0.1,
  boostAmplify: 1.5,
  maxBoost: 3.0,
  suppressionRecovery: 1.05,
  boostRecovery: 0.95,
  windowMs: 3600_000, // 1 小时
};

// ==================== ErrorTuner ====================

export class ErrorTuner {
  private profiles: Map<string, ErrorProfile> = new Map();
  private config: ErrorTunerConfig;
  private verbose: boolean;

  constructor(config?: Partial<ErrorTunerConfig>, verbose = false) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.verbose = verbose;
  }

  // ==================== 观测 ====================

  /**
   * 观测一次错误，更新统计和自适应因子
   *
   * 弱化逻辑：severity=low + 高频 → suppressionFactor 衰减
   * 强化逻辑：severity=critical + 首次 → boostFactor 放大
   */
  observe(errorType: string, severity: ErrorSeverity): void {
    const now = Date.now();
    let profile = this.profiles.get(errorType);

    if (!profile) {
      profile = {
        errorType,
        occurrences: 0,
        recentRate: 0,
        recentTimestamps: [],
        severity,
        lastOccurrence: 0,
        suppressionFactor: 1.0,
        boostFactor: 1.0,
      };
      this.profiles.set(errorType, profile);
    }

    // 更新统计
    profile.occurrences++;
    profile.lastOccurrence = now;
    profile.recentTimestamps.push(now);

    // 清理过期时间戳
    const cutoff = now - this.config.windowMs;
    profile.recentTimestamps = profile.recentTimestamps.filter(t => t > cutoff);
    profile.recentRate = profile.recentTimestamps.length;

    // 更新严重度（取最高）
    if (this.severityLevel(severity) > this.severityLevel(profile.severity)) {
      profile.severity = severity;
    }

    // 弱化逻辑：低严重度 + 高频 → 抑制
    if (severity === 'low' && profile.recentRate > this.config.highFrequencyThreshold) {
      profile.suppressionFactor = Math.max(
        this.config.minSuppression,
        profile.suppressionFactor * this.config.suppressionDecay,
      );
      if (this.verbose) {
        console.log(`[ErrorTuner] 弱化 ${errorType}: suppression=${profile.suppressionFactor.toFixed(3)}`);
      }
    }

    // 强化逻辑：致命错误 + 首几次 → 增强
    if (severity === 'critical' && profile.occurrences <= 3) {
      profile.boostFactor = Math.min(
        this.config.maxBoost,
        profile.boostFactor * this.config.boostAmplify,
      );
      if (this.verbose) {
        console.log(`[ErrorTuner] 强化 ${errorType}: boost=${profile.boostFactor.toFixed(3)}`);
      }
    }

    // 致命错误永远不弱化
    if (severity === 'critical') {
      profile.suppressionFactor = Math.max(profile.suppressionFactor, 0.5);
    }
  }

  // ==================== 查询 ====================

  /**
   * 获取调整后的告警权重
   *
   * weight = suppressionFactor × boostFactor
   * - weight < 1: 告警被弱化（高频无害异常）
   * - weight = 1: 正常
   * - weight > 1: 告警被强化（致命错误频发）
   */
  getAlertWeight(errorType: string): number {
    const profile = this.profiles.get(errorType);
    if (!profile) return 1.0;
    return profile.suppressionFactor * profile.boostFactor;
  }

  /**
   * 获取错误 profile
   */
  getProfile(errorType: string): ErrorProfile | undefined {
    return this.profiles.get(errorType);
  }

  /**
   * 获取所有 profiles
   */
  getAllProfiles(): ErrorProfile[] {
    return [...this.profiles.values()];
  }

  // ==================== 衰减 ====================

  /**
   * 周期衰减（每小时调用一次）
   *
   * - suppressionFactor 缓慢恢复到 1.0（停止弱化）
   * - boostFactor 缓慢回落到 1.0（停止强化）
   */
  decay(): void {
    for (const profile of this.profiles.values()) {
      // suppression 恢复（向 1.0 靠拢）
      profile.suppressionFactor = Math.min(1.0, profile.suppressionFactor * this.config.suppressionRecovery);

      // boost 回落（向 1.0 靠拢）
      profile.boostFactor = Math.max(1.0, profile.boostFactor * this.config.boostRecovery);

      // 清理过期时间戳
      const cutoff = Date.now() - this.config.windowMs;
      profile.recentTimestamps = profile.recentTimestamps.filter(t => t > cutoff);
      profile.recentRate = profile.recentTimestamps.length;
    }
  }

  // ==================== 维护 ====================

  /**
   * 清理长期未出现的错误类型
   */
  prune(maxIdleMs: number = 7 * 24 * 3600_000): number {
    const now = Date.now();
    let pruned = 0;
    for (const [type, profile] of this.profiles) {
      if (now - profile.lastOccurrence > maxIdleMs) {
        this.profiles.delete(type);
        pruned++;
      }
    }
    return pruned;
  }

  /**
   * 清空
   */
  clear(): void {
    this.profiles.clear();
  }

  /**
   * 获取统计
   */
  getStats(): {
    totalTypes: number;
    suppressed: number;
    boosted: number;
    critical: number;
  } {
    let suppressed = 0;
    let boosted = 0;
    let critical = 0;
    for (const p of this.profiles.values()) {
      if (p.suppressionFactor < 0.9) suppressed++;
      if (p.boostFactor > 1.1) boosted++;
      if (p.severity === 'critical') critical++;
    }
    return {
      totalTypes: this.profiles.size,
      suppressed,
      boosted,
      critical,
    };
  }

  // ==================== 内部 ====================

  private severityLevel(s: ErrorSeverity): number {
    const map: Record<ErrorSeverity, number> = { low: 1, medium: 2, high: 3, critical: 4 };
    return map[s] ?? 0;
  }
}
