/**
 * 上下文聚合器 — 从各模块收集当前状态，构建 ScoringContext
 *
 * 职责：
 * - 聚合六欲、情绪、人格、环境数据
 * - 维护行为历史（防重复）
 * - 提供统一的 ScoringContext 给 UtilityScorer
 */

import type { EmotionVector, Mood } from '../emotion/engine.js';
import type { OceanPersonality } from '../personality/ocean.js';
import type { DesireVector } from '../desire/engine.js';
import type { ScoringContext } from './utility-scorer.js';
import type { IdleAction } from './idle.js';

// ==================== 感知事件类型 ====================

/** 声音事件类型（与前端 sound-events.ts 对齐） */
export type SoundEventType = 'doorbell' | 'knock' | 'alarm' | 'pet' | 'glass_break' | 'speech' | 'music' | 'silence' | 'unknown';

/** 语音情绪类型（与前端 emotion-voice.ts 对齐） */
export type VoiceEmotion = 'calm' | 'excited' | 'angry' | 'sad' | 'anxious' | 'happy' | 'tired' | 'neutral';

// ==================== 感知事件 ====================

export interface PerceptionEvent {
  source: 'sound' | 'voice' | 'environment' | 'user';
  type: string;
  data?: unknown;
  timestamp: number;
}

// ==================== ContextProvider ====================

export class ContextProvider {
  // 行为历史
  private recentActions: IdleAction[] = [];
  private lastAction: IdleAction | null = null;
  private lastActionTime: number = 0;

  // 感知状态
  private lastSoundEvent: SoundEventType | null = null;
  private lastSoundTime: number = 0;
  private lastVoiceEmotion: VoiceEmotion | null = null;
  private lastVoiceTime: number = 0;
  private ambientLight: number = 0.5;

  // 用户状态
  private userPresent: boolean = false;
  private userLastInteraction: number = 0;

  // 空闲追踪
  private sessionStartTime: number = Date.now();
  private lastActivityTime: number = Date.now();

  // 情绪/欲望/人格引用（由外部设置）
  private currentEmotion: EmotionVector = {
    joy: 30, sadness: 10, anger: 5, fear: 5,
    surprise: 10, disgust: 5, trust: 30, anticipation: 20,
  };
  private currentMood: Mood = 'calm';
  private currentDesires: DesireVector = {
    hunger: 30, curiosity: 30, social: 30, safety: 20, expression: 20, rest: 30,
  };
  private currentOcean: OceanPersonality = {
    openness: 50, conscientiousness: 50, extraversion: 50,
    agreeableness: 50, neuroticism: 50,
  };
  private personalityStrength: number = 0.5;

  // ==================== 外部更新接口 ====================

  updateEmotion(emotion: EmotionVector, mood: Mood): void {
    this.currentEmotion = emotion;
    this.currentMood = mood;
  }

  updateDesires(desires: DesireVector): void {
    this.currentDesires = desires;
  }

  updateOcean(ocean: OceanPersonality): void {
    this.currentOcean = ocean;
  }

  updatePersonalityStrength(ps: number): void {
    this.personalityStrength = ps;
  }

  setUserPresent(present: boolean): void {
    this.userPresent = present;
    if (present) {
      this.userLastInteraction = Date.now();
      this.lastActivityTime = Date.now();
    }
  }

  /** 记录用户交互（聊天/点击等） */
  recordUserInteraction(): void {
    this.userLastInteraction = Date.now();
    this.lastActivityTime = Date.now();
    this.userPresent = true;
  }

  /** 记录行为执行 */
  recordAction(action: IdleAction): void {
    this.lastAction = action;
    this.lastActionTime = Date.now();
    this.recentActions.push(action);
    if (this.recentActions.length > 10) this.recentActions.shift();
  }

  /** 接收感知事件 */
  onPerception(event: PerceptionEvent): void {
    switch (event.source) {
      case 'sound':
        this.lastSoundEvent = event.type as SoundEventType;
        this.lastSoundTime = event.timestamp;
        break;
      case 'voice':
        this.lastVoiceEmotion = event.type as VoiceEmotion;
        this.lastVoiceTime = event.timestamp;
        break;
      case 'environment':
        if (typeof event.data === 'number') {
          this.ambientLight = event.data;
        }
        break;
      case 'user':
        this.recordUserInteraction();
        break;
    }
    this.lastActivityTime = Date.now();
  }

  // ==================== 构建 ScoringContext ====================

  getContext(): ScoringContext {
    const now = Date.now();
    const idleMs = now - this.lastActivityTime;
    const idleMinutes = idleMs / 60_000;

    // 感知事件有效期：30秒内有效
    const soundEvent = (this.lastSoundEvent && now - this.lastSoundTime < 30_000)
      ? this.lastSoundEvent
      : undefined;
    const voiceEmotion = (this.lastVoiceEmotion && now - this.lastVoiceTime < 30_000)
      ? this.lastVoiceEmotion
      : undefined;

    return {
      desires: { ...this.currentDesires },
      emotion: { ...this.currentEmotion },
      mood: this.currentMood,
      ocean: { ...this.currentOcean },
      personalityStrength: this.personalityStrength,
      hour: new Date().getHours(),
      idleMinutes,
      lastAction: this.lastAction,
      lastActionAge: this.lastAction ? (now - this.lastActionTime) / 1000 : 0,
      recentActions: [...this.recentActions],
      userPresent: this.userPresent,
      userLastInteraction: this.userLastInteraction,
      soundEvent,
      voiceEmotion,
      ambientLight: this.ambientLight,
    };
  }

  // ==================== 状态查询 ====================

  /** 获取最近行为历史（调试用） */
  getRecentActions(): IdleAction[] {
    return [...this.recentActions];
  }

  /** 获取空闲时间（分钟） */
  getIdleMinutes(): number {
    return (Date.now() - this.lastActivityTime) / 60_000;
  }

  /** 重置状态（新会话时） */
  reset(): void {
    this.recentActions = [];
    this.lastAction = null;
    this.lastActionTime = 0;
    this.lastSoundEvent = null;
    this.lastVoiceEmotion = null;
    this.sessionStartTime = Date.now();
    this.lastActivityTime = Date.now();
  }
}
