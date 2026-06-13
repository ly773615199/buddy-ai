/**
 * 节律自适配 — RhythmAdaptor
 *
 * 根据全天负载，自动调节 BuddyClock 参数：
 * - 高峰压低：心跳拉长、梦境密度降低、后台任务减少
 * - 空闲提升：心跳缩短、自检频率提升、梦境巩固增加
 * - 正常区间：线性插值平滑过渡
 *
 * 纯统计 + 阈值调整，不改逻辑，< 1ms
 */

import type { BodyState } from '../../types.js';

// ==================== 类型 ====================

export interface RhythmState {
  /** 负载采样（滑动窗口 60 点，每分钟一个） */
  loadSamples: number[];
  /** 最近一次采样时间戳 */
  lastSampleTime: number;
  /** 每小时交互次数 */
  interactionRate: number;
  /** 每小时错误次数 */
  errorRate: number;
}

export interface RhythmAdjustment {
  /** 动态心跳间隔（ms），默认 300000（5 分钟） */
  heartbeatIntervalMs: number;
  /** 梦境频率系数 0.3-2.0 */
  dreamDensity: number;
  /** 后台任务密度 0.5-2.0 */
  backgroundTaskDensity: number;
  /** 自检频率系数 0.5-2.0 */
  maintenanceFrequency: number;
}

export interface RhythmConfig {
  /** 采样窗口大小（点数） */
  windowSize: number;
  /** 采样间隔（ms） */
  sampleIntervalMs: number;
  /** 负载高阈值（触发压低） */
  highLoadThreshold: number;
  /** 负载低阈值（触发提升） */
  lowLoadThreshold: number;
  /** 默认心跳间隔 */
  defaultHeartbeatMs: number;
  /** 最小心跳间隔 */
  minHeartbeatMs: number;
  /** 最大心跳间隔 */
  maxHeartbeatMs: number;
}

const DEFAULT_CONFIG: RhythmConfig = {
  windowSize: 60,
  sampleIntervalMs: 60_000,
  highLoadThreshold: 70,
  lowLoadThreshold: 30,
  defaultHeartbeatMs: 300_000,
  minHeartbeatMs: 180_000,
  maxHeartbeatMs: 600_000,
};

// ==================== RhythmAdaptor ====================

export class RhythmAdaptor {
  private state: RhythmState;
  private config: RhythmConfig;
  private verbose: boolean;

  constructor(config?: Partial<RhythmConfig>, verbose = false) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.verbose = verbose;
    this.state = {
      loadSamples: [],
      lastSampleTime: 0,
      interactionRate: 0,
      errorRate: 0,
    };
  }

  // ==================== 采样 ====================

  /**
   * 注入一次负载采样（由 HomeostasisRegulator 或 Cerebellum 调用）
   */
  addLoadSample(load: number): void {
    this.state.loadSamples.push(Math.max(0, Math.min(100, load)));
    if (this.state.loadSamples.length > this.config.windowSize) {
      this.state.loadSamples.shift();
    }
    this.state.lastSampleTime = Date.now();
  }

  /**
   * 从 BodyState 自动采样
   */
  sampleFromBody(body: BodyState): void {
    this.addLoadSample(body.load);
  }

  /**
   * 记录一次交互
   */
  recordInteraction(): void {
    this.state.interactionRate++;
  }

  /**
   * 记录一次错误
   */
  recordError(): void {
    this.state.errorRate++;
  }

  // ==================== 调节 ====================

  /**
   * 核心调节逻辑：基于负载统计输出节奏参数
   *
   * 高峰（load > 70）：拉长心跳、压低梦境、减少后台
   * 空闲（load < 30）：缩短心跳、提升梦境、增加自检
   * 正常（30-70）：线性插值
   */
  regulate(): RhythmAdjustment {
    const load = this.movingAverage();
    const { highLoadThreshold, lowLoadThreshold } = this.config;

    // 高峰压低
    if (load > highLoadThreshold) {
      const excess = (load - highLoadThreshold) / (100 - highLoadThreshold); // 0~1
      return {
        heartbeatIntervalMs: this.lerp(this.config.defaultHeartbeatMs, this.config.maxHeartbeatMs, excess),
        dreamDensity: this.lerp(1.0, 0.3, excess),
        backgroundTaskDensity: this.lerp(1.0, 0.5, excess),
        maintenanceFrequency: this.lerp(1.0, 0.5, excess),
      };
    }

    // 空闲提升
    if (load < lowLoadThreshold) {
      const deficit = (lowLoadThreshold - load) / lowLoadThreshold; // 0~1
      return {
        heartbeatIntervalMs: this.lerp(this.config.defaultHeartbeatMs, this.config.minHeartbeatMs, deficit),
        dreamDensity: this.lerp(1.0, 1.5, deficit),
        backgroundTaskDensity: this.lerp(1.0, 1.2, deficit),
        maintenanceFrequency: this.lerp(1.0, 2.0, deficit),
      };
    }

    // 正常区间：线性插值
    const factor = (load - lowLoadThreshold) / (highLoadThreshold - lowLoadThreshold); // 0~1
    return {
      heartbeatIntervalMs: this.lerp(this.config.minHeartbeatMs, this.config.maxHeartbeatMs, factor),
      dreamDensity: this.lerp(1.5, 0.3, factor),
      backgroundTaskDensity: this.lerp(1.2, 0.5, factor),
      maintenanceFrequency: this.lerp(2.0, 0.5, factor),
    };
  }

  // ==================== 查询 ====================

  /**
   * 获取当前移动平均负载
   */
  getCurrentLoad(): number {
    return this.movingAverage();
  }

  /**
   * 获取当前节奏状态
   */
  getState(): Readonly<RhythmState> {
    return { ...this.state };
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    avgLoad: number;
    sampleCount: number;
    interactionRate: number;
    errorRate: number;
  } {
    return {
      avgLoad: this.movingAverage(),
      sampleCount: this.state.loadSamples.length,
      interactionRate: this.state.interactionRate,
      errorRate: this.state.errorRate,
    };
  }

  /**
   * 重置计数器（每小时调用一次）
   */
  resetRates(): void {
    this.state.interactionRate = 0;
    this.state.errorRate = 0;
  }

  /**
   * 清空采样
   */
  clear(): void {
    this.state.loadSamples = [];
    this.state.interactionRate = 0;
    this.state.errorRate = 0;
  }

  // ==================== 内部 ====================

  /**
   * 移动平均
   */
  private movingAverage(): number {
    const samples = this.state.loadSamples;
    if (samples.length === 0) return 50; // 默认中等负载
    let sum = 0;
    for (const s of samples) sum += s;
    return sum / samples.length;
  }

  /**
   * 线性插值
   */
  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * Math.max(0, Math.min(1, t));
  }
}
