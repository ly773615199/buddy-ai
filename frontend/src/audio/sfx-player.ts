/**
 * 音效播放器 — Web Audio API 合成音效
 *
 * 不依赖外部音频文件，用 OscillatorNode + GainNode 合成基础音效。
 * 每个音效由参数定义（频率/时长/波形），支持节流防叠加。
 */

import { getAudioEngine, type SoundCategory } from './engine.js';

// ==================== 音效定义 ====================

export interface SFXParams {
  /** 起始频率 Hz */
  freq: number;
  /** 结束频率 Hz（滑音） */
  freqEnd?: number;
  /** 波形 */
  type: OscillatorType;
  /** 时长 ms */
  duration: number;
  /** 音量 0-1 */
  volume: number;
  /** 淡入 ms */
  fadeIn?: number;
  /** 淡出 ms */
  fadeOut?: number;
  /** 分类 */
  category?: SoundCategory;
}

// ==================== 预设音效 ====================

/** UI 操作音效 */
export const UI_SFX: Record<string, SFXParams> = {
  click:       { freq: 800,  type: 'sine',     duration: 50,  volume: 0.3, fadeOut: 30 },
  send:        { freq: 600,  freqEnd: 900,     type: 'sine',  duration: 120, volume: 0.35, fadeOut: 60 },
  receive:     { freq: 900,  freqEnd: 600,     type: 'sine',  duration: 150, volume: 0.35, fadeOut: 80 },
  tabSwitch:   { freq: 500,  freqEnd: 700,     type: 'triangle', duration: 80,  volume: 0.2, fadeOut: 40 },
  success:     { freq: 523,  freqEnd: 784,     type: 'sine',  duration: 200, volume: 0.4, fadeOut: 100 },
  error:       { freq: 300,  freqEnd: 200,     type: 'sawtooth', duration: 300, volume: 0.35, fadeOut: 150 },
  typing:      { freq: 1200, type: 'sine',     duration: 20,  volume: 0.1, fadeOut: 15 },
};

/** 光灵状态音效 */
export const SPRITE_SFX: Record<string, SFXParams> = {
  breathe:      { freq: 200,  freqEnd: 250,    type: 'sine',     duration: 2000, volume: 0.08, fadeIn: 500, fadeOut: 500 },
  pulse:        { freq: 300,  freqEnd: 400,    type: 'sine',     duration: 300,  volume: 0.12, fadeOut: 150 },
  thinkingHum:  { freq: 180,  type: 'triangle', duration: 3000, volume: 0.06, fadeIn: 800, fadeOut: 800 },
  speakBurst:   { freq: 500,  freqEnd: 700,    type: 'sine',     duration: 100,  volume: 0.2,  fadeOut: 50 },
  sleep:        { freq: 150,  freqEnd: 120,    type: 'sine',     duration: 4000, volume: 0.05, fadeIn: 1000, fadeOut: 1000 },
  wake:         { freq: 400,  freqEnd: 800,    type: 'sine',     duration: 500,  volume: 0.3,  fadeOut: 200 },
};

/** 情绪音效 */
export const EMOTION_SFX: Record<string, SFXParams> = {
  happy:       { freq: 523,  freqEnd: 784,    type: 'sine',     duration: 300, volume: 0.3, fadeOut: 150 },
  excited:     { freq: 400,  freqEnd: 800,    type: 'triangle', duration: 200, volume: 0.35, fadeOut: 100 },
  tired:       { freq: 300,  freqEnd: 150,    type: 'sine',     duration: 600, volume: 0.2, fadeOut: 300 },
  frustrated:  { freq: 250,  freqEnd: 180,    type: 'sawtooth', duration: 400, volume: 0.25, fadeOut: 200 },
  calm:        { freq: 440,  type: 'sine',     duration: 500, volume: 0.15, fadeIn: 200, fadeOut: 200 },
  confused:    { freq: 400,  freqEnd: 300,    type: 'triangle', duration: 350, volume: 0.2, fadeOut: 150 },
};

/** 事件音效 */
export const EVENT_SFX: Record<string, SFXParams> = {
  evolution:       { freq: 200, freqEnd: 1200, type: 'sine',     duration: 2000, volume: 0.5, fadeOut: 500 },
  levelUp:         { freq: 523, freqEnd: 1047, type: 'sine',     duration: 800,  volume: 0.4, fadeOut: 300 },
  discovery:       { freq: 600, freqEnd: 900,  type: 'triangle', duration: 400,  volume: 0.35, fadeOut: 200 },
  toolStart:       { freq: 500, type: 'sine',  duration: 80,  volume: 0.2, fadeOut: 40 },
  toolSuccess:     { freq: 600, freqEnd: 800,  type: 'sine',     duration: 150, volume: 0.25, fadeOut: 80 },
  toolError:       { freq: 300, freqEnd: 200,  type: 'sawtooth', duration: 250, volume: 0.3, fadeOut: 120 },
  notification:    { freq: 800, freqEnd: 600,  type: 'sine',     duration: 200, volume: 0.3, fadeOut: 100 },
  dreamComplete:   { freq: 440, freqEnd: 660,  type: 'sine',     duration: 600, volume: 0.25, fadeIn: 200, fadeOut: 200 },
};

// ==================== 节流控制 ====================

const throttleMap: Map<string, number> = new Map();
const THROTTLE_MS = 100; // 同一音效 100ms 内不重复

function shouldThrottle(key: string): boolean {
  const now = Date.now();
  const last = throttleMap.get(key) ?? 0;
  if (now - last < THROTTLE_MS) return true;
  throttleMap.set(key, now);
  return false;
}

// ==================== SFX 播放器 ====================

/**
 * 播放合成音效
 * @param params 音效参数或预设名
 * @param key 节流键（相同 key 的音效不会同时播放）
 */
export async function playSFX(
  params: SFXParams | string,
  key?: string,
): Promise<void> {
  // 解析预设
  const resolved = typeof params === 'string'
    ? (UI_SFX[params] ?? SPRITE_SFX[params] ?? EMOTION_SFX[params] ?? EVENT_SFX[params])
    : params;

  if (!resolved) return;

  // 节流
  const throttleKey = key ?? (typeof params === 'string' ? params : `${params.freq}-${params.duration}`);
  if (shouldThrottle(throttleKey)) return;

  const engine = getAudioEngine();
  const ctx = await engine.ensureContext();
  const categoryGain = engine.getCategoryGain(resolved.category ?? 'sfx');
  if (!categoryGain) return;

  // 创建振荡器
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();

  osc.type = resolved.type;
  osc.frequency.setValueAtTime(resolved.freq, ctx.currentTime);

  // 滑音
  if (resolved.freqEnd !== undefined) {
    osc.frequency.linearRampToValueAtTime(
      resolved.freqEnd,
      ctx.currentTime + resolved.duration / 1000,
    );
  }

  // 音量包络
  const durationSec = resolved.duration / 1000;
  const fadeInSec = (resolved.fadeIn ?? 0) / 1000;
  const fadeOutSec = (resolved.fadeOut ?? resolved.duration * 0.3) / 1000;

  gainNode.gain.setValueAtTime(0, ctx.currentTime);

  // 淡入
  if (fadeInSec > 0) {
    gainNode.gain.linearRampToValueAtTime(resolved.volume, ctx.currentTime + fadeInSec);
  } else {
    gainNode.gain.setValueAtTime(resolved.volume, ctx.currentTime);
  }

  // 淡出
  const fadeOutStart = ctx.currentTime + durationSec - fadeOutSec;
  if (fadeOutSec > 0 && fadeOutStart > ctx.currentTime) {
    gainNode.gain.setValueAtTime(resolved.volume, fadeOutStart);
    gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + durationSec);
  }

  // 连接
  osc.connect(gainNode);
  gainNode.connect(categoryGain);

  engine.incrementSources();

  // 播放
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + durationSec);

  // 清理
  osc.onended = () => {
    osc.disconnect();
    gainNode.disconnect();
    engine.decrementSources();
  };
}

/**
 * 播放情绪音效（基于 mood 字符串）
 */
export async function playMoodSFX(mood: string): Promise<void> {
  const params = EMOTION_SFX[mood];
  if (params) {
    await playSFX(params, `mood-${mood}`);
  }
}

/**
 * 播放事件音效
 */
export async function playEventSFX(event: string): Promise<void> {
  const params = EVENT_SFX[event];
  if (params) {
    await playSFX(params, `event-${event}`);
  }
}
