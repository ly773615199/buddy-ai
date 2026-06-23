/**
 * 环境音 & 背景音乐生成器
 *
 * 用 Web Audio API 合成环境氛围音和简单背景旋律，
 * 填充 ambient / music 两个闲置通道。
 */

import { getAudioEngine, type SoundCategory } from './engine.js';

// ==================== 环境音预设 ====================

export interface AmbientPreset {
  /** 名称 */
  name: string;
  /** 基础频率 */
  baseFreq: number;
  /** 波形 */
  type: OscillatorType;
  /** 音量 0-1 */
  volume: number;
  /** LFO 频率（呼吸感） */
  lfoFreq: number;
  /** LFO 深度 */
  lfoDepth: number;
  /** 滤波器截止频率 */
  filterFreq: number;
  /** 滤波器 Q */
  filterQ: number;
}

export const AMBIENT_PRESETS: Record<string, AmbientPreset> = {
  /** 温暖嗡鸣 — 低频正弦波 + 缓慢呼吸 */
  warmHum: {
    name: '温暖嗡鸣',
    baseFreq: 120,
    type: 'sine',
    volume: 0.06,
    lfoFreq: 0.15,
    lfoDepth: 10,
    filterFreq: 400,
    filterQ: 0.5,
  },
  /** 空灵氛围 — 三角波 + 高频泛音 */
  ethereal: {
    name: '空灵氛围',
    baseFreq: 220,
    type: 'triangle',
    volume: 0.04,
    lfoFreq: 0.1,
    lfoDepth: 15,
    filterFreq: 800,
    filterQ: 1,
  },
  /** 雨声模拟 — 噪声 + 带通滤波 */
  rain: {
    name: '雨声',
    baseFreq: 0, // 使用噪声源
    type: 'sine',
    volume: 0.08,
    lfoFreq: 0.05,
    lfoDepth: 0,
    filterFreq: 2000,
    filterQ: 0.3,
  },
  /** 夜间蝉鸣 — 高频脉冲 */
  crickets: {
    name: '蝉鸣',
    baseFreq: 4200,
    type: 'sine',
    volume: 0.03,
    lfoFreq: 7,
    lfoDepth: 200,
    filterFreq: 5000,
    filterQ: 2,
  },
};

// ==================== 简单旋律生成 ====================

/** 音阶音符频率（C4 起） */
const SCALE_FREQS = {
  pentatonic: [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25],
  major: [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25],
  minor: [261.63, 293.66, 311.13, 349.23, 392.00, 415.30, 466.16, 523.25],
};

export type ScaleType = keyof typeof SCALE_FREQS;

export interface MelodyOptions {
  /** 音阶类型 */
  scale?: ScaleType;
  /** 每个音符时长 ms */
  noteDuration?: number;
  /** 音量 0-1 */
  volume?: number;
  /** 波形 */
  type?: OscillatorType;
  /** 随机性 0-1（音符选择随机程度） */
  randomness?: number;
}

// ==================== Ambient Player ====================

export class AmbientPlayer {
  private ctx: AudioContext | null = null;
  private nodes: AudioNode[] = [];
  private playing = false;
  private currentPreset: string | null = null;

  /** 播放环境音 */
  async play(presetName: string): Promise<void> {
    const preset = AMBIENT_PRESETS[presetName];
    if (!preset) return;

    const engine = getAudioEngine();
    this.ctx = await engine.ensureContext();
    const catGain = engine.getCategoryGain('ambient');
    if (!catGain) return;

    // 停止当前
    this.stop();

    this.playing = true;
    this.currentPreset = presetName;

    if (presetName === 'rain') {
      this._playNoise(catGain, preset);
    } else {
      this._playTone(catGain, preset);
    }
  }

  /** 停止环境音 */
  stop(): void {
    this.playing = false;
    for (const node of this.nodes) {
      try { node.disconnect(); } catch { /* ignore */ }
    }
    this.nodes = [];
    this.currentPreset = null;
  }

  /** 是否正在播放 */
  get isPlaying(): boolean {
    return this.playing;
  }

  /** 当前预设 */
  get activePreset(): string | null {
    return this.currentPreset;
  }

  private _playTone(catGain: GainNode, preset: AmbientPreset): void {
    if (!this.ctx) return;
    const ctx = this.ctx;

    // 主振荡器
    const osc = ctx.createOscillator();
    osc.type = preset.type;
    osc.frequency.value = preset.baseFreq;

    // LFO（呼吸感）
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = preset.lfoFreq;
    lfoGain.gain.value = preset.lfoDepth;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    // 滤波器
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = preset.filterFreq;
    filter.Q.value = preset.filterQ;

    // 音量
    const gain = ctx.createGain();
    gain.gain.value = preset.volume;

    // 连接
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(catGain);

    osc.start();
    lfo.start();

    this.nodes.push(osc, lfo, lfoGain, filter, gain);
  }

  private _playNoise(catGain: GainNode, preset: AmbientPreset): void {
    if (!this.ctx) return;
    const ctx = this.ctx;

    // 白噪声缓冲
    const bufferSize = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    // 带通滤波（模拟雨声）
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = preset.filterFreq;
    filter.Q.value = preset.filterQ;

    // LFO 调制滤波器频率（雨声起伏）
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = preset.lfoFreq;
    lfoGain.gain.value = 500;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    // 音量
    const gain = ctx.createGain();
    gain.gain.value = preset.volume;

    // 连接
    source.connect(filter);
    filter.connect(gain);
    gain.connect(catGain);

    source.start();
    lfo.start();

    this.nodes.push(source, lfo, lfoGain, filter, gain);
  }
}

// ==================== Melody Generator ====================

export class MelodyGenerator {
  private ctx: AudioContext | null = null;
  private playing = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nodes: AudioNode[] = [];
  private options: Required<MelodyOptions>;

  constructor(options: MelodyOptions = {}) {
    this.options = {
      scale: options.scale ?? 'pentatonic',
      noteDuration: options.noteDuration ?? 800,
      volume: options.volume ?? 0.12,
      type: options.type ?? 'sine',
      randomness: options.randomness ?? 0.3,
    };
  }

  /** 开始播放旋律 */
  async play(): Promise<void> {
    if (this.playing) return;

    const engine = getAudioEngine();
    this.ctx = await engine.ensureContext();
    this.playing = true;

    const scale = SCALE_FREQS[this.options.scale];
    let lastIndex = 0;

    const playNote = () => {
      if (!this.playing || !this.ctx) return;

      // 选择下一个音符（倾向于相邻音符，偶尔跳跃）
      let nextIndex: number;
      if (Math.random() < this.options.randomness) {
        nextIndex = Math.floor(Math.random() * scale.length);
      } else {
        nextIndex = lastIndex + (Math.random() > 0.5 ? 1 : -1);
        nextIndex = Math.max(0, Math.min(scale.length - 1, nextIndex));
      }
      lastIndex = nextIndex;

      this._playNote(scale[nextIndex]);
    };

    playNote();
    this.timer = setInterval(playNote, this.options.noteDuration);
  }

  /** 停止旋律 */
  stop(): void {
    this.playing = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const node of this.nodes) {
      try { node.disconnect(); } catch { /* ignore */ }
    }
    this.nodes = [];
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  private _playNote(freq: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const engine = getAudioEngine();
    const catGain = engine.getCategoryGain('music');
    if (!catGain) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = this.options.type;
    osc.frequency.value = freq;

    const durationSec = this.options.noteDuration / 1000;
    const volume = this.options.volume;

    // 柔和的音量包络
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.05);
    gain.gain.setValueAtTime(volume, ctx.currentTime + durationSec * 0.6);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + durationSec);

    osc.connect(gain);
    gain.connect(catGain);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + durationSec);

    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }
}

// ==================== 便捷实例 ====================

let ambientInstance: AmbientPlayer | null = null;
let melodyInstance: MelodyGenerator | null = null;

export function getAmbientPlayer(): AmbientPlayer {
  if (!ambientInstance) ambientInstance = new AmbientPlayer();
  return ambientInstance;
}

export function getMelodyGenerator(options?: MelodyOptions): MelodyGenerator {
  if (!melodyInstance) melodyInstance = new MelodyGenerator(options);
  return melodyInstance;
}
