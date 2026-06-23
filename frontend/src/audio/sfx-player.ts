/**
 * 音效播放器 — Web Audio API 合成音效 v2
 *
 * 增强版：FM 合成 + BiquadFilter + 立体声声像 + 复合音效
 * 不依赖外部音频文件，用 OscillatorNode + GainNode + Filter 合成丰富音效。
 */

import { getAudioEngine, type SoundCategory, type FilterPreset } from './engine.js';

// ==================== 音效定义（增强版） ====================

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

  // ── FM 合成 ──
  /** 调制频率 Hz（FM 合成） */
  modFreq?: number;
  /** 调制深度 Hz（FM 合成） */
  modDepth?: number;
  /** 调制波形 */
  modType?: OscillatorType;

  // ── 滤波器 ──
  /** 滤波器预设 */
  filter?: FilterPreset;

  // ── 空间音效 ──
  /** 声像 -1(左) ~ 1(右) */
  pan?: number;

  // ── 复合音效 ──
  /** 多层叠加（和弦 / 泛音） */
  layers?: Array<{
    freq: number;
    freqEnd?: number;
    type: OscillatorType;
    volume: number;
    detune?: number;
  }>;
}

// ==================== 预设音效（增强版） ====================

/** UI 操作音效 */
export const UI_SFX: Record<string, SFXParams> = {
  click:       { freq: 800,  type: 'sine',     duration: 50,  volume: 0.3, fadeOut: 30,
                 filter: { type: 'highpass', frequency: 600 } },
  send:        { freq: 600,  freqEnd: 900,     type: 'sine',  duration: 120, volume: 0.35, fadeOut: 60,
                 modFreq: 3, modDepth: 50, modType: 'sine' },
  receive:     { freq: 900,  freqEnd: 600,     type: 'sine',  duration: 150, volume: 0.35, fadeOut: 80,
                 filter: { type: 'lowpass', frequency: 2000, Q: 1 } },
  tabSwitch:   { freq: 500,  freqEnd: 700,     type: 'triangle', duration: 80,  volume: 0.2, fadeOut: 40,
                 pan: 0 },
  success:     { freq: 523,  freqEnd: 784,     type: 'sine',  duration: 200, volume: 0.4, fadeOut: 100,
                 layers: [
                   { freq: 659, freqEnd: 988, type: 'sine', volume: 0.2 },
                   { freq: 784, freqEnd: 1175, type: 'sine', volume: 0.15 },
                 ] },
  error:       { freq: 300,  freqEnd: 200,     type: 'sawtooth', duration: 300, volume: 0.35, fadeOut: 150,
                 filter: { type: 'lowpass', frequency: 1200, Q: 2 } },
  typing:      { freq: 1200, type: 'sine',     duration: 20,  volume: 0.1, fadeOut: 15,
                 pan: 0 },
};

/** 光灵状态音效 */
export const SPRITE_SFX: Record<string, SFXParams> = {
  breathe:      { freq: 200,  freqEnd: 250,    type: 'sine',     duration: 2000, volume: 0.08, fadeIn: 500, fadeOut: 500,
                  modFreq: 0.5, modDepth: 20, modType: 'sine' },
  pulse:        { freq: 300,  freqEnd: 400,    type: 'sine',     duration: 300,  volume: 0.12, fadeOut: 150,
                  modFreq: 6, modDepth: 30 },
  thinkingHum:  { freq: 180,  type: 'triangle', duration: 3000, volume: 0.06, fadeIn: 800, fadeOut: 800,
                  modFreq: 0.3, modDepth: 15, filter: { type: 'lowpass', frequency: 500 } },
  speakBurst:   { freq: 500,  freqEnd: 700,    type: 'sine',     duration: 100,  volume: 0.2,  fadeOut: 50,
                  modFreq: 8, modDepth: 80 },
  sleep:        { freq: 150,  freqEnd: 120,    type: 'sine',     duration: 4000, volume: 0.05, fadeIn: 1000, fadeOut: 1000,
                  modFreq: 0.2, modDepth: 10, filter: { type: 'lowpass', frequency: 300 } },
  wake:         { freq: 400,  freqEnd: 800,    type: 'sine',     duration: 500,  volume: 0.3,  fadeOut: 200,
                  layers: [
                    { freq: 600, freqEnd: 1200, type: 'triangle', volume: 0.15 },
                  ] },
};

/** 情绪音效 */
export const EMOTION_SFX: Record<string, SFXParams> = {
  happy:       { freq: 523,  freqEnd: 784,    type: 'sine',     duration: 300, volume: 0.3, fadeOut: 150,
                 layers: [{ freq: 659, freqEnd: 988, type: 'sine', volume: 0.15 }] },
  excited:     { freq: 400,  freqEnd: 800,    type: 'triangle', duration: 200, volume: 0.35, fadeOut: 100,
                 modFreq: 12, modDepth: 100, filter: { type: 'bandpass', frequency: 800, Q: 2 } },
  tired:       { freq: 300,  freqEnd: 150,    type: 'sine',     duration: 600, volume: 0.2, fadeOut: 300,
                 filter: { type: 'lowpass', frequency: 600, Q: 0.5 } },
  frustrated:  { freq: 250,  freqEnd: 180,    type: 'sawtooth', duration: 400, volume: 0.25, fadeOut: 200,
                 filter: { type: 'lowpass', frequency: 800, Q: 4 } },
  calm:        { freq: 440,  type: 'sine',     duration: 500, volume: 0.15, fadeIn: 200, fadeOut: 200,
                 modFreq: 0.5, modDepth: 5 },
  confused:    { freq: 400,  freqEnd: 300,    type: 'triangle', duration: 350, volume: 0.2, fadeOut: 150,
                 modFreq: 5, modDepth: 60 },
};

/** 事件音效 */
export const EVENT_SFX: Record<string, SFXParams> = {
  evolution:       { freq: 200, freqEnd: 1200, type: 'sine',     duration: 2000, volume: 0.5, fadeOut: 500,
                     layers: [
                       { freq: 300, freqEnd: 1800, type: 'sine', volume: 0.3 },
                       { freq: 400, freqEnd: 2400, type: 'triangle', volume: 0.15 },
                     ],
                     filter: { type: 'lowpass', frequency: 3000, Q: 1 } },
  levelUp:         { freq: 523, freqEnd: 1047, type: 'sine',     duration: 800,  volume: 0.4, fadeOut: 300,
                     layers: [
                       { freq: 659, freqEnd: 1319, type: 'sine', volume: 0.25 },
                       { freq: 784, freqEnd: 1568, type: 'sine', volume: 0.15 },
                     ] },
  discovery:       { freq: 600, freqEnd: 900,  type: 'triangle', duration: 400,  volume: 0.35, fadeOut: 200,
                     modFreq: 4, modDepth: 40 },
  toolStart:       { freq: 500, type: 'sine',  duration: 80,  volume: 0.2, fadeOut: 40,
                     filter: { type: 'highpass', frequency: 400 } },
  toolSuccess:     { freq: 600, freqEnd: 800,  type: 'sine',     duration: 150, volume: 0.25, fadeOut: 80,
                     layers: [{ freq: 750, freqEnd: 1000, type: 'sine', volume: 0.12 }] },
  toolError:       { freq: 300, freqEnd: 200,  type: 'sawtooth', duration: 250, volume: 0.3, fadeOut: 120,
                     filter: { type: 'lowpass', frequency: 1000, Q: 3 } },
  notification:    { freq: 800, freqEnd: 600,  type: 'sine',     duration: 200, volume: 0.3, fadeOut: 100,
                     layers: [{ freq: 1000, freqEnd: 800, type: 'sine', volume: 0.1 }] },
  dreamComplete:   { freq: 440, freqEnd: 660,  type: 'sine',     duration: 600, volume: 0.25, fadeIn: 200, fadeOut: 200,
                     modFreq: 2, modDepth: 20, filter: { type: 'lowpass', frequency: 1500 } },
};

// ==================== 节流控制 ====================

const throttleMap: Map<string, number> = new Map();
const THROTTLE_MS = 100;

function shouldThrottle(key: string): boolean {
  const now = Date.now();
  const last = throttleMap.get(key) ?? 0;
  if (now - last < THROTTLE_MS) return true;
  throttleMap.set(key, now);
  return false;
}

// ==================== SFX 播放器 ====================

/**
 * 播放单层合成音
 */
function playSingleLayer(
  ctx: AudioContext,
  engine: ReturnType<typeof getAudioEngine>,
  params: {
    freq: number;
    freqEnd?: number;
    type: OscillatorType;
    volume: number;
    duration: number;
    fadeIn?: number;
    fadeOut?: number;
    detune?: number;
    modFreq?: number;
    modDepth?: number;
    modType?: OscillatorType;
    filter?: FilterPreset;
    pan?: number;
  },
  categoryGain: GainNode,
): { osc: OscillatorNode; cleanup: () => void } {
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();

  osc.type = params.type;
  osc.frequency.setValueAtTime(params.freq, ctx.currentTime);

  if (params.detune) {
    osc.detune.setValueAtTime(params.detune, ctx.currentTime);
  }

  // 滑音
  if (params.freqEnd !== undefined) {
    osc.frequency.linearRampToValueAtTime(
      params.freqEnd,
      ctx.currentTime + params.duration / 1000,
    );
  }

  // 音量包络
  const durationSec = params.duration / 1000;
  const fadeInSec = (params.fadeIn ?? 0) / 1000;
  const fadeOutSec = (params.fadeOut ?? params.duration * 0.3) / 1000;

  gainNode.gain.setValueAtTime(0, ctx.currentTime);
  if (fadeInSec > 0) {
    gainNode.gain.linearRampToValueAtTime(params.volume, ctx.currentTime + fadeInSec);
  } else {
    gainNode.gain.setValueAtTime(params.volume, ctx.currentTime);
  }
  const fadeOutStart = ctx.currentTime + durationSec - fadeOutSec;
  if (fadeOutSec > 0 && fadeOutStart > ctx.currentTime) {
    gainNode.gain.setValueAtTime(params.volume, fadeOutStart);
    gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + durationSec);
  }

  // FM 调制
  let modOsc: OscillatorNode | null = null;
  let modGain: GainNode | null = null;
  if (params.modFreq && params.modDepth) {
    modOsc = ctx.createOscillator();
    modGain = ctx.createGain();
    modOsc.type = params.modType ?? 'sine';
    modOsc.frequency.value = params.modFreq;
    modGain.gain.value = params.modDepth;
    modOsc.connect(modGain);
    modGain.connect(osc.frequency);
    modOsc.start(ctx.currentTime);
    modOsc.stop(ctx.currentTime + durationSec);
  }

  // 构建连接链
  let tail: AudioNode = gainNode;

  // 滤波器
  let filterNode: BiquadFilterNode | null = null;
  if (params.filter) {
    filterNode = engine.createFilter(params.filter);
    if (filterNode) {
      tail.connect(filterNode);
      tail = filterNode;
    }
  }

  // 声像
  let pannerNode: StereoPannerNode | null = null;
  if (params.pan !== undefined && params.pan !== 0) {
    pannerNode = engine.createPanner(params.pan);
    if (pannerNode) {
      tail.connect(pannerNode);
      tail = pannerNode;
    }
  }

  // 接入分类通道
  tail.connect(categoryGain);
  osc.connect(gainNode);

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + durationSec);

  const cleanup = () => {
    osc.disconnect();
    gainNode.disconnect();
    modOsc?.disconnect();
    modGain?.disconnect();
    filterNode?.disconnect();
    pannerNode?.disconnect();
  };

  return { osc, cleanup };
}

/**
 * 播放合成音效（增强版）
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
  const throttleKey = key ?? (typeof params === 'string' ? params : `${resolved.freq}-${resolved.duration}`);
  if (shouldThrottle(throttleKey)) return;

  const engine = getAudioEngine();
  const ctx = await engine.ensureContext();
  const categoryGain = engine.getCategoryGain(resolved.category ?? 'sfx');
  if (!categoryGain) return;

  engine.incrementSources();

  // 主层
  const main = playSingleLayer(ctx, engine, {
    freq: resolved.freq,
    freqEnd: resolved.freqEnd,
    type: resolved.type,
    volume: resolved.volume,
    duration: resolved.duration,
    fadeIn: resolved.fadeIn,
    fadeOut: resolved.fadeOut,
    modFreq: resolved.modFreq,
    modDepth: resolved.modDepth,
    modType: resolved.modType,
    filter: resolved.filter,
    pan: resolved.pan,
  }, categoryGain);

  // 叠加层（和弦 / 泛音）
  const layerCleanups: (() => void)[] = [];
  if (resolved.layers) {
    for (const layer of resolved.layers) {
      const l = playSingleLayer(ctx, engine, {
        freq: layer.freq,
        freqEnd: layer.freqEnd,
        type: layer.type,
        volume: layer.volume,
        duration: resolved.duration,
        fadeIn: resolved.fadeIn,
        fadeOut: resolved.fadeOut,
        detune: layer.detune,
        filter: resolved.filter,
        pan: resolved.pan,
      }, categoryGain);
      layerCleanups.push(l.cleanup);
    }
  }

  // 清理
  main.osc.onended = () => {
    main.cleanup();
    layerCleanups.forEach(fn => fn());
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
