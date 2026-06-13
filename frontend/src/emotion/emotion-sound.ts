/**
 * Sprint 3 D4: 情绪→声音反馈桥接
 *
 * 将光灵的情绪状态映射到 TTS 语调参数和合成音效，
 * 实现"情绪只通过光灵自身表达"的声音层面。
 *
 * 设计原则：
 * - TTS 语调随情绪变化（语速/音调/音量）
 * - 情绪切换时触发过渡音效
 * - 高情绪时粒子振动与声波同步
 */

import type { BuddyState } from '../types/buddy';

// ==================== TTS 情绪参数 ====================

export interface EmotionVoiceParams {
  /** 语速调节 "+15%" / "-10%" */
  rate: string;
  /** 音调调节 "+5Hz" / "-3Hz" */
  pitch: string;
  /** 音量调节 "+10%" / "-5%" */
  volume: string;
  /** 情绪音效名（用于合成音效触发） */
  sfxName: string | null;
  /** 粒子振动强度 0-1（声波联动） */
  particleVibration: number;
}

// ==================== 情绪→声音参数映射 ====================

const EMOTION_VOICE_MAP: Record<string, EmotionVoiceParams> = {
  happy: {
    rate: '+12%',
    pitch: '+6Hz',
    volume: '+8%',
    sfxName: 'happy',
    particleVibration: 0.5,
  },
  excited: {
    rate: '+20%',
    pitch: '+10Hz',
    volume: '+15%',
    sfxName: 'excited',
    particleVibration: 0.9,
  },
  calm: {
    rate: '-8%',
    pitch: '-2Hz',
    volume: '-5%',
    sfxName: 'calm',
    particleVibration: 0.1,
  },
  curious: {
    rate: '+5%',
    pitch: '+4Hz',
    volume: '+3%',
    sfxName: null,
    particleVibration: 0.3,
  },
  tired: {
    rate: '-18%',
    pitch: '-8Hz',
    volume: '-12%',
    sfxName: 'tired',
    particleVibration: 0.05,
  },
  sad: {
    rate: '-15%',
    pitch: '-10Hz',
    volume: '-15%',
    sfxName: null,
    particleVibration: 0.05,
  },
  frustrated: {
    rate: '+10%',
    pitch: '-5Hz',
    volume: '+20%',
    sfxName: 'frustrated',
    particleVibration: 0.8,
  },
  thinking: {
    rate: '-5%',
    pitch: '+2Hz',
    volume: '-5%',
    sfxName: null,
    particleVibration: 0.2,
  },
  confused: {
    rate: '+15%',
    pitch: '+8Hz',
    volume: '+10%',
    sfxName: 'confused',
    particleVibration: 0.7,
  },
  energetic: {
    rate: '+18%',
    pitch: '+8Hz',
    volume: '+12%',
    sfxName: 'excited',
    particleVibration: 0.9,
  },
  neutral: {
    rate: '+0%',
    pitch: '+0Hz',
    volume: '+0%',
    sfxName: null,
    particleVibration: 0.15,
  },
};

// ==================== 核心函数 ====================

/**
 * 从 buddy 情绪状态获取 TTS 声音参数
 */
export function getEmotionVoiceParams(emotion: BuddyState['emotion']): EmotionVoiceParams {
  const mood = emotion.mood || 'neutral';
  const base = EMOTION_VOICE_MAP[mood] || EMOTION_VOICE_MAP.neutral;

  // energy 微调：高能量时语速更快、音量更大
  const energy = Math.max(0, Math.min(1, emotion.energy ?? 0.5));
  const energyBonus = Math.round((energy - 0.5) * 10); // -5 ~ +5

  return {
    rate: adjustPercent(base.rate, energyBonus),
    pitch: adjustHz(base.pitch, Math.round(energyBonus * 0.5)),
    volume: adjustPercent(base.volume, Math.round(energyBonus * 0.6)),
    sfxName: base.sfxName,
    particleVibration: base.particleVibration * (0.7 + energy * 0.6),
  };
}

/**
 * 将情绪参数转为 TTSOptions（供 TTSManager 使用）
 */
export function emotionToTTSOptions(emotion: BuddyState['emotion']): {
  rate: string;
  pitch: string;
  volume: string;
} {
  const params = getEmotionVoiceParams(emotion);
  return {
    rate: params.rate,
    pitch: params.pitch,
    volume: params.volume,
  };
}

// ==================== 情绪过渡音效 ====================

/** 情绪切换时的过渡音效参数 */
export interface EmotionTransitionSFX {
  /** 起始频率 */
  freq: number;
  /** 结束频率 */
  freqEnd: number;
  /** 波形 */
  type: OscillatorType;
  /** 时长 ms */
  duration: number;
  /** 音量 */
  volume: number;
}

const MOOD_TRANSITIONS: Record<string, EmotionTransitionSFX> = {
  happy:      { freq: 400, freqEnd: 700, type: 'sine',     duration: 250, volume: 0.25 },
  excited:    { freq: 300, freqEnd: 900, type: 'triangle', duration: 200, volume: 0.3 },
  calm:       { freq: 500, freqEnd: 400, type: 'sine',     duration: 400, volume: 0.12 },
  tired:      { freq: 350, freqEnd: 200, type: 'sine',     duration: 500, volume: 0.15 },
  frustrated: { freq: 200, freqEnd: 400, type: 'sawtooth', duration: 300, volume: 0.3 },
  thinking:   { freq: 450, freqEnd: 500, type: 'sine',     duration: 300, volume: 0.15 },
  confused:   { freq: 400, freqEnd: 500, type: 'triangle', duration: 200, volume: 0.25 },
  energetic:  { freq: 350, freqEnd: 800, type: 'triangle', duration: 200, volume: 0.3 },
};

/**
 * 获取情绪切换过渡音效
 * @param fromMood 之前的情绪
 * @param toMood 新的情绪
 * @returns 过渡音效参数，如果不需要则返回 null
 */
export function getEmotionTransitionSFX(
  fromMood: string,
  toMood: string,
): EmotionTransitionSFX | null {
  if (fromMood === toMood) return null;
  return MOOD_TRANSITIONS[toMood] ?? null;
}

// ==================== 工具函数 ====================

function adjustPercent(base: string, bonus: number): string {
  const match = base.match(/([+-]?\d+)%/);
  if (!match) return base;
  const val = parseInt(match[1]) + bonus;
  return `${val >= 0 ? '+' : ''}${val}%`;
}

function adjustHz(base: string, bonus: number): string {
  const match = base.match(/([+-]?\d+)Hz/);
  if (!match) return base;
  const val = parseInt(match[1]) + bonus;
  return `${val >= 0 ? '+' : ''}${val}Hz`;
}

// ==================== 情绪描述（声音反馈 UI 展示） ====================

export const VOICE_EMOTION_HINTS: Record<string, string> = {
  happy: '语调轻快上扬',
  excited: '语速加快、声音明亮',
  calm: '语调平稳、节奏舒缓',
  tired: '语速放慢、声音低沉',
  frustrated: '语速加快、声音低沉有力',
  thinking: '语调犹豫、节奏探索',
  confused: '语速偏快、音调偏高',
  energetic: '语速加快、声音明亮有力',
  neutral: '正常语调',
};
