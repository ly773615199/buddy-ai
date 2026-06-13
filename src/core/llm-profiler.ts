/**
 * LLM 能力实时探测器
 *
 * 持续监测 LLM 的延迟、质量、失败率，
 * 动态调整调度策略，而非假设固定能力等级。
 */

/** LLM 能力画像 */
export interface LLMProfile {
  /** 平均响应时间 (ms) */
  avgLatency: number;
  /** 质量评分 (滑动窗口均值 0-1) */
  qualityScore: number;
  /** 近 N 次调用失败率 */
  failureRate: number;
  /** 最近失败时间 */
  lastFailure: number;
  /** 连续失败次数 */
  consecutiveFailures: number;
  /** 总调用次数 */
  totalCalls: number;
  /** 能力等级 (由各项指标综合判定) */
  capabilityLevel: 'strong' | 'weak' | 'unstable' | 'unavailable';
}

/** 单次 LLM 调用记录 */
interface LLMCallRecord {
  timestamp: number;
  latencyMs: number;
  success: boolean;
  qualityScore?: number;
}

const WINDOW_SIZE = 20;
const LATENCY_THRESHOLD_SLOW = 5000;
const LATENCY_THRESHOLD_WEAK = 10000;
const QUALITY_THRESHOLD_WEAK = 0.4;
const FAILURE_THRESHOLD_UNSTABLE = 0.3;
const CONSECUTIVE_FAIL_THRESHOLD = 3;

export class LLMProfiler {
  private records: LLMCallRecord[] = [];
  private profile: LLMProfile = {
    avgLatency: 0,
    qualityScore: 1,
    failureRate: 0,
    lastFailure: 0,
    consecutiveFailures: 0,
    totalCalls: 0,
    capabilityLevel: 'strong',
  };

  /** 记录一次 LLM 调用结果 */
  record(result: { latencyMs: number; success: boolean; qualityScore?: number }): void {
    this.records.push({
      timestamp: Date.now(),
      latencyMs: result.latencyMs,
      success: result.success,
      qualityScore: result.qualityScore,
    });

    // 滑动窗口
    if (this.records.length > WINDOW_SIZE * 2) {
      this.records = this.records.slice(-WINDOW_SIZE);
    }

    this.profile.totalCalls++;
    if (!result.success) {
      this.profile.lastFailure = Date.now();
      this.profile.consecutiveFailures++;
    } else {
      this.profile.consecutiveFailures = 0;
    }

    this.recalculate();
  }

  /** 获取当前画像 */
  getProfile(): LLMProfile {
    return { ...this.profile };
  }

  /** 判断 LLM 是否可用于指定场景 */
  canUseFor(scenario: 'realtime' | 'batch' | 'critical'): boolean {
    const { capabilityLevel } = this.profile;
    switch (scenario) {
      case 'realtime':
        return capabilityLevel === 'strong';
      case 'batch':
        return capabilityLevel === 'strong' || capabilityLevel === 'weak';
      case 'critical':
        return capabilityLevel === 'strong';
    }
  }

  /** 获取建议的输入策略 */
  getInputStrategy(): 'full' | 'condensed' | 'minimal' | 'none' {
    switch (this.profile.capabilityLevel) {
      case 'strong': return 'full';
      case 'weak': return 'condensed';
      case 'unstable': return 'minimal';
      case 'unavailable': return 'none';
    }
  }

  private recalculate(): void {
    const window = this.records.slice(-WINDOW_SIZE);
    if (window.length === 0) return;

    // 平均延迟
    this.profile.avgLatency = window.reduce((s, r) => s + r.latencyMs, 0) / window.length;

    // 失败率
    const failures = window.filter(r => !r.success).length;
    this.profile.failureRate = failures / window.length;

    // 质量均值（只算有质量分的）
    const withQuality = window.filter(r => r.qualityScore !== undefined);
    if (withQuality.length > 0) {
      this.profile.qualityScore = withQuality.reduce((s, r) => s + r.qualityScore!, 0) / withQuality.length;
    }

    // 综合判定能力等级
    if (this.profile.consecutiveFailures >= CONSECUTIVE_FAIL_THRESHOLD) {
      this.profile.capabilityLevel = 'unavailable';
    } else if (this.profile.failureRate >= FAILURE_THRESHOLD_UNSTABLE) {
      this.profile.capabilityLevel = 'unstable';
    } else if (
      this.profile.avgLatency > LATENCY_THRESHOLD_WEAK ||
      this.profile.qualityScore < QUALITY_THRESHOLD_WEAK
    ) {
      this.profile.capabilityLevel = 'weak';
    } else {
      this.profile.capabilityLevel = 'strong';
    }
  }
}
