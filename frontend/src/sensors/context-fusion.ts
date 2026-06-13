/**
 * 物理上下文融合
 * 聚合所有传感器数据 → 统一 PhysicalContext → Agent 上下文注入
 */

import type { PhysicalContext } from '../types/device-types.js';
import { DEFAULT_PHYSICAL_CONTEXT } from '../types/device-types.js';
import type { GeoPosition } from './location.js';
import type { MotionState } from './motion.js';
import type { EnvironmentData } from './environment.js';

export interface ContextFusionOptions {
  /** 聚合刷新间隔（ms），默认 30000 */
  refreshIntervalMs?: number;
  /** 是否启用自动刷新 */
  autoRefresh?: boolean;
}

export interface ContextSummary {
  /** 一句话描述当前物理环境 */
  description: string;
  /** 建议的行为调整 */
  suggestions: string[];
  /** 上下文置信度 0-1 */
  confidence: number;
  /** 各数据源可用性 */
  availability: {
    location: boolean;
    motion: boolean;
    environment: boolean;
  };
}

export class PhysicalContextFusion {
  private context: PhysicalContext;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private changeCallback: ((ctx: PhysicalContext) => void) | null = null;
  private lastRefresh = 0;

  // 数据源
  private locationProvider: (() => GeoPosition | null) | null = null;
  private motionProvider: (() => MotionState) | null = null;
  private environmentProvider: (() => EnvironmentData) | null = null;

  constructor(options: ContextFusionOptions = {}) {
    this.context = { ...DEFAULT_PHYSICAL_CONTEXT };

    if (options.autoRefresh !== false) {
      this.startAutoRefresh(options.refreshIntervalMs ?? 30000);
    }
  }

  // ==================== 数据源注册 ====================

  /** 注册位置数据源 */
  registerLocation(provider: () => GeoPosition | null): void {
    this.locationProvider = provider;
  }

  /** 注册运动数据源 */
  registerMotion(provider: () => MotionState): void {
    this.motionProvider = provider;
  }

  /** 注册环境数据源 */
  registerEnvironment(provider: () => EnvironmentData): void {
    this.environmentProvider = provider;
  }

  // ==================== 上下文管理 ====================

  /** 手动更新位置 */
  updateLocation(lat: number, lng: number, accuracy: number): void {
    this.context.location = { lat, lng, accuracy };
    this.context.timestamp = Date.now();
    this._notifyChange();
  }

  /** 手动更新运动状态 */
  updateMotion(state: MotionState): void {
    this.context.motion = state;
    this.context.timestamp = Date.now();
    this._notifyChange();
  }

  /** 获取当前物理上下文 */
  getContext(): PhysicalContext {
    return { ...this.context };
  }

  /** 聚合所有数据源（手动触发） */
  refresh(): PhysicalContext {
    if (this.locationProvider) {
      const pos = this.locationProvider();
      if (pos) {
        this.context.location = { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy };
      }
    }

    if (this.motionProvider) {
      this.context.motion = this.motionProvider();
    }

    if (this.environmentProvider) {
      const env = this.environmentProvider();
      this.context.ambientLight = env.ambientLight;
      this.context.noiseLevel = env.noiseLevel;
      this.context.networkType = env.networkType;
      this.context.batteryLevel = env.batteryLevel;
      this.context.batteryCharging = env.batteryCharging;
    }

    this.context.timestamp = Date.now();
    this.lastRefresh = Date.now();
    this._notifyChange();

    return { ...this.context };
  }

  /** 启动自动刷新 */
  startAutoRefresh(intervalMs = 30000): void {
    if (this.refreshInterval) return;

    this.refreshInterval = setInterval(() => {
      this.refresh();
    }, intervalMs);
  }

  /** 停止自动刷新 */
  stopAutoRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  /** 变更回调 */
  onChange(callback: (ctx: PhysicalContext) => void): () => void {
    this.changeCallback = callback;
    return () => { this.changeCallback = null; };
  }

  // ==================== 智能分析 ====================

  /** 生成上下文摘要 */
  getSummary(): ContextSummary {
    const ctx = this.context;
    const description: string[] = [];
    const suggestions: string[] = [];

    // 位置
    if (ctx.location) {
      description.push('位置已知');
    }

    // 运动
    switch (ctx.motion) {
      case 'walking':
        description.push('正在走路');
        suggestions.push('回复简短一些，用户在移动');
        break;
      case 'running':
        description.push('正在跑步');
        suggestions.push('只回复紧急内容');
        break;
      case 'driving':
        description.push('可能在开车');
        suggestions.push('优先语音交互，避免文字');
        break;
      case 'stationary':
        description.push('静止状态');
        break;
    }

    // 光线
    if (ctx.ambientLight !== null) {
      if (ctx.ambientLight < 10) {
        description.push('环境较暗');
        suggestions.push('可能是夜间，注意关怀提醒');
      } else if (ctx.ambientLight > 1000) {
        description.push('光线充足');
      }
    }

    // 网络
    if (ctx.networkType === 'cellular') {
      description.push('移动网络');
      suggestions.push('减少图片分析，节省流量');
    } else if (ctx.networkType === 'offline') {
      description.push('离线');
      suggestions.push('仅使用本地功能');
    }

    // 电量
    if (ctx.batteryLevel !== null && ctx.batteryLevel < 0.2 && !ctx.batteryCharging) {
      description.push(`电量低 (${Math.round(ctx.batteryLevel * 100)}%)`);
      suggestions.push('减少后台任务，节省电量');
    }

    // 置信度
    let available = 0;
    const total = 3;
    if (ctx.location) available++;
    if (ctx.motion !== 'unknown') available++;
    if (ctx.ambientLight !== null || ctx.networkType !== 'unknown') available++;

    return {
      description: description.length > 0 ? description.join('，') : '环境信息有限',
      suggestions,
      confidence: available / total,
      availability: {
        location: ctx.location !== null,
        motion: ctx.motion !== 'unknown',
        environment: ctx.ambientLight !== null || ctx.networkType !== 'unknown',
      },
    };
  }

  /** 生成 Agent 上下文注入文本 */
  toAgentContext(): string {
    const summary = this.getSummary();
    let text = `[物理环境] ${summary.description}`;

    if (summary.suggestions.length > 0) {
      text += `\n[环境建议] ${summary.suggestions.join('; ')}`;
    }

    return text;
  }

  /** 是否应该减少交互 */
  shouldReduceInteraction(): boolean {
    const ctx = this.context;
    return (
      ctx.motion === 'running' ||
      ctx.motion === 'driving' ||
      ctx.networkType === 'offline' ||
      (ctx.batteryLevel !== null && ctx.batteryLevel < 0.1 && !ctx.batteryCharging)
    );
  }

  /** 是否应该用语音 */
  shouldUseVoice(): boolean {
    return this.context.motion === 'walking' || this.context.motion === 'running' || this.context.motion === 'driving';
  }

  /** 清理 */
  destroy(): void {
    this.stopAutoRefresh();
    this.changeCallback = null;
    this.locationProvider = null;
    this.motionProvider = null;
    this.environmentProvider = null;
  }

  // ==================== 内部方法 ====================

  private _notifyChange(): void {
    this.changeCallback?.(this.context);
  }
}
