/**
 * 运动控制 — 小脑的自主行为触发
 *
 * 整合 IdleBehavior + ProactiveEngine，提供：
 * - 空闲行为（眨眼、东张西望、打哈欠等）
 * - 主动行为（问候、关心、提醒、反思）
 * - 基于 BodyState 的行为决策
 * - 行为限频和优先级管理
 *
 * 设计原则：
 * - 纯决策层，不直接发消息（通过回调）
 * - 参考 BodyState 做决策
 * - 低延迟 < 1ms
 */

import type { BodyState, EmotionVector, DesireVector } from '../types.js';

// ==================== 类型 ====================

export type IdleAction = 'blink' | 'look_around' | 'yawn' | 'stretch' | 'wave' | 'think' | 'sleep' | 'peek';
export type ProactiveAction = 'greeting' | 'care' | 'maintenance' | 'learning' | 'reminder' | 'reflection';

export interface ActionParams {
  action: IdleAction | ProactiveAction;
  duration: number;   // ms
  intensity: number;  // 0-1
  reason: string;
}

export interface MotorControlConfig {
  /** 眨眼间隔 (ms) */
  blinkInterval: number;
  /** 空闲行为间隔 (ms) */
  idleInterval: number;
  /** 主动行为间隔 (ms) */
  proactiveInterval: number;
  /** 每小时最大主动行为数 */
  maxProactivePerHour: number;
  /** 是否启用空闲行为 */
  enableIdle: boolean;
  /** 是否启用主动行为 */
  enableProactive: boolean;
}

const DEFAULT_CONFIG: MotorControlConfig = {
  blinkInterval: 3000,
  idleInterval: 8000,
  proactiveInterval: 600_000,  // 10 分钟
  maxProactivePerHour: 5,
  enableIdle: true,
  enableProactive: true,
};

// ==================== 行为权重 ====================

/** 情绪状态 → 空闲行为权重 */
const EMOTION_IDLE_WEIGHTS: Record<string, Record<IdleAction, number>> = {
  energetic: { blink: 3, look_around: 4, yawn: 0, stretch: 3, wave: 2, think: 1, sleep: 0, peek: 2 },
  calm:      { blink: 3, look_around: 2, yawn: 1, stretch: 1, wave: 0, think: 2, sleep: 0, peek: 1 },
  tired:     { blink: 2, look_around: 1, yawn: 4, stretch: 1, wave: 0, think: 1, sleep: 3, peek: 0 },
  excited:   { blink: 3, look_around: 3, yawn: 0, stretch: 2, wave: 4, think: 0, sleep: 0, peek: 2 },
  frustrated:{ blink: 2, look_around: 1, yawn: 2, stretch: 1, wave: 0, think: 3, sleep: 1, peek: 0 },
  happy:     { blink: 3, look_around: 3, yawn: 0, stretch: 2, wave: 3, think: 1, sleep: 0, peek: 2 },
  thinking:  { blink: 2, look_around: 1, yawn: 0, stretch: 0, wave: 0, think: 5, sleep: 0, peek: 1 },
  confused:  { blink: 2, look_around: 4, yawn: 1, stretch: 0, wave: 0, think: 3, sleep: 0, peek: 2 },
};

/** 行为默认参数 */
const ACTION_DEFAULTS: Record<IdleAction, { duration: number; baseIntensity: number }> = {
  blink:       { duration: 200,  baseIntensity: 0.8 },
  look_around: { duration: 4000, baseIntensity: 0.6 },
  yawn:        { duration: 3000, baseIntensity: 0.7 },
  stretch:     { duration: 1500, baseIntensity: 0.8 },
  wave:        { duration: 1000, baseIntensity: 0.7 },
  think:       { duration: 5000, baseIntensity: 0.5 },
  sleep:       { duration: 0,    baseIntensity: 0 },
  peek:        { duration: 2000, baseIntensity: 0.6 },
};

/** 行为描述 */
const ACTION_DESCRIPTIONS: Record<string, string> = {
  blink: '眨眼', look_around: '东张西望', yawn: '打哈欠', stretch: '伸懒腰',
  wave: '挥手', think: '思考', sleep: '犯困', peek: '偷看',
  greeting: '问候', care: '关心', maintenance: '自我维护',
  learning: '学习', reminder: '提醒', reflection: '反思',
};

// ==================== MotorControl ====================

export class MotorControl {
  private config: MotorControlConfig;
  private verbose: boolean;

  // 行为回调
  private idleCallback: ((action: IdleAction, params: ActionParams) => void) | null = null;
  private proactiveCallback: ((action: ProactiveAction, params: ActionParams) => void) | null = null;

  // 计时器
  private blinkTimer: ReturnType<typeof setInterval> | null = null;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private proactiveTimer: ReturnType<typeof setInterval> | null = null;

  // 状态
  private lastMood: string = 'calm';
  private proactiveHistory: Array<{ action: ProactiveAction; timestamp: number }> = [];

  constructor(config?: Partial<MotorControlConfig>, verbose = false) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.verbose = verbose;
  }

  // ==================== 生命周期 ====================

  /** 启动自动行为 */
  start(): void {
    if (this.config.enableIdle) {
      this.blinkTimer = setInterval(() => this.onBlink(), this.config.blinkInterval);
      this.idleTimer = setInterval(() => this.onIdle(), this.config.idleInterval);
    }
    if (this.config.enableProactive) {
      this.proactiveTimer = setInterval(() => this.onProactive(), this.config.proactiveInterval);
    }
  }

  /** 停止自动行为 */
  stop(): void {
    if (this.blinkTimer) { clearInterval(this.blinkTimer); this.blinkTimer = null; }
    if (this.idleTimer) { clearInterval(this.idleTimer); this.idleTimer = null; }
    if (this.proactiveTimer) { clearInterval(this.proactiveTimer); this.proactiveTimer = null; }
  }

  /** 销毁 */
  destroy(): void {
    this.stop();
    this.idleCallback = null;
    this.proactiveCallback = null;
    this.proactiveHistory = [];
  }

  // ==================== 回调注册 ====================

  /** 注册空闲行为回调 */
  onIdleAction(callback: (action: IdleAction, params: ActionParams) => void): void {
    this.idleCallback = callback;
  }

  /** 注册主动行为回调 */
  onProactiveAction(callback: (action: ProactiveAction, params: ActionParams) => void): void {
    this.proactiveCallback = callback;
  }

  // ==================== 手动触发 ====================

  /** 手动触发一次空闲行为（基于当前 BodyState） */
  triggerIdle(body: BodyState): IdleAction | null {
    const mood = this.bodyToMood(body);
    const action = this.pickIdleAction(mood, body);
    if (action) {
      const params = this.getIdleParams(action, body);
      this.idleCallback?.(action, params);
      if (this.verbose) console.log(`[MotorControl] idle: ${action}`);
    }
    return action;
  }

  /** 手动触发一次主动行为（基于当前 BodyState） */
  triggerProactive(body: BodyState): ProactiveAction | null {
    if (!this.canProactive()) return null;

    const action = this.pickProactiveAction(body);
    if (action) {
      const params = this.getProactiveParams(action, body);
      this.proactiveHistory.push({ action, timestamp: Date.now() });
      this.proactiveCallback?.(action, params);
      if (this.verbose) console.log(`[MotorControl] proactive: ${action}`);
    }
    return action;
  }

  // ==================== 内部 ====================

  private onBlink(): void {
    this.idleCallback?.('blink', {
      action: 'blink', duration: 200, intensity: 0.8, reason: '自动眨眼',
    });
  }

  private onIdle(): void {
    // 空闲行为需要 BodyState，但自动模式下没有实时 BodyState
    // 用默认值触发
    const mood = this.lastMood;
    const action = this.pickIdleAction(mood, null);
    if (action) {
      const defaults = ACTION_DEFAULTS[action];
      this.idleCallback?.(action, {
        action,
        duration: defaults.duration,
        intensity: defaults.baseIntensity,
        reason: `空闲行为: ${ACTION_DESCRIPTIONS[action]}`,
      });
    }
  }

  private onProactive(): void {
    if (!this.canProactive()) return;

    // 自动模式下用默认 BodyState
    const action = this.pickProactiveAction(null);
    if (action) {
      this.proactiveHistory.push({ action, timestamp: Date.now() });
      this.proactiveCallback?.(action, {
        action,
        duration: 5000,
        intensity: 0.5,
        reason: `主动行为: ${ACTION_DESCRIPTIONS[action]}`,
      });
    }
  }

  /** 从 BodyState 推断情绪状态 */
  private bodyToMood(body: BodyState): string {
    const e = body.emotion;
    const valence = (e.joy + e.trust + e.anticipation) - (e.sadness + e.anger + e.fear);

    if (body.energy > 70 && valence > 20) return 'energetic';
    if (body.energy < 30) return 'tired';
    if (e.joy > 60) return 'happy';
    if (e.anger > 50) return 'frustrated';
    if (body.confusionLevel > 60) return 'confused';
    if (e.anticipation > 50) return 'excited';
    if (body.focusLevel > 60) return 'thinking';
    return 'calm';
  }

  /** 选择空闲行为（加权随机） */
  private pickIdleAction(mood: string, body: BodyState | null): IdleAction | null {
    const weights = EMOTION_IDLE_WEIGHTS[mood] ?? EMOTION_IDLE_WEIGHTS.calm;

    // 根据 BodyState 微调
    let adjustedWeights = { ...weights };
    if (body) {
      if (body.energy < 20) {
        adjustedWeights.sleep += 5;
        adjustedWeights.stretch -= 1;
      }
      if (body.hunger > 70) {
        adjustedWeights.yawn += 2;
      }
      if (body.isUserActive) {
        adjustedWeights.wave += 2;
        adjustedWeights.peek += 1;
      }
    }

    // 加权随机选择
    const entries = Object.entries(adjustedWeights) as [IdleAction, number][];
    const totalWeight = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
    if (totalWeight === 0) return null;

    let roll = Math.random() * totalWeight;
    for (const [action, weight] of entries) {
      roll -= Math.max(0, weight);
      if (roll <= 0) return action;
    }
    return 'blink';
  }

  /** 选择主动行为 */
  private pickProactiveAction(body: BodyState | null): ProactiveAction | null {
    const hour = body?.hour ?? new Date().getHours();

    // 根据时间选择行为
    if (hour >= 7 && hour <= 9) return 'greeting';
    if (hour >= 12 && hour <= 13) return 'care';
    if (hour >= 18 && hour <= 20) return 'care';
    if (hour >= 22 || hour <= 1) return 'reflection';

    // 根据 BodyState 选择
    if (body) {
      if (body.confusionLevel > 70) return 'care';
      if (body.hunger > 80) return 'reminder';
      if (body.desires.curiosity > 70) return 'learning';
    }

    // 随机选择
    const actions: ProactiveAction[] = ['greeting', 'care', 'maintenance', 'learning', 'reminder'];
    return actions[Math.floor(Math.random() * actions.length)];
  }

  /** 获取空闲行为参数 */
  private getIdleParams(action: IdleAction, body: BodyState): ActionParams {
    const defaults = ACTION_DEFAULTS[action];
    const moodIntensity = this.getMoodIntensity(body);
    const intensity = Math.min(1, Math.max(0.3, defaults.baseIntensity * (0.6 + moodIntensity * 0.8)));

    return {
      action,
      duration: defaults.duration,
      intensity,
      reason: ACTION_DESCRIPTIONS[action] || action,
    };
  }

  /** 获取主动行为参数 */
  private getProactiveParams(action: ProactiveAction, body: BodyState): ActionParams {
    return {
      action,
      duration: 5000,
      intensity: 0.5 + (body.energy / 200),
      reason: ACTION_DESCRIPTIONS[action] || action,
    };
  }

  /** 获取情绪强度 (0-1) */
  private getMoodIntensity(body: BodyState): number {
    const e = body.emotion;
    return Math.min(1, (Math.abs(e.joy - 50) + Math.abs(e.sadness - 10) + Math.abs(e.anger - 5)) / 150);
  }

  /** 检查是否可以触发主动行为 */
  private canProactive(): boolean {
    const oneHourAgo = Date.now() - 3600_000;
    const recentCount = this.proactiveHistory.filter(h => h.timestamp > oneHourAgo).length;
    return recentCount < this.config.maxProactivePerHour;
  }

  // ==================== 状态查询 ====================

  /** 更新情绪状态（外部调用） */
  updateMood(mood: string): void {
    this.lastMood = mood;
  }

  /** 获取行为历史 */
  getProactiveHistory(limit = 10): Array<{ action: ProactiveAction; timestamp: number }> {
    return this.proactiveHistory.slice(-limit);
  }

  /** 获取统计 */
  getStats(): {
    idleEnabled: boolean;
    proactiveEnabled: boolean;
    proactiveThisHour: number;
    totalProactive: number;
  } {
    const oneHourAgo = Date.now() - 3600_000;
    return {
      idleEnabled: this.config.enableIdle,
      proactiveEnabled: this.config.enableProactive,
      proactiveThisHour: this.proactiveHistory.filter(h => h.timestamp > oneHourAgo).length,
      totalProactive: this.proactiveHistory.length,
    };
  }
}
