/**
 * 声音事件检测
 * 检测环境声音：门铃/警报/宠物叫声/玻璃碎裂等
 *
 * 后端选择：
 * - Web Audio API 基础频谱分析（免费，精度低）
 * - 云端 API（高精度，需付费）
 * - 本地模型（YAMNet/audioset，需加载）
 */

export type SoundEventType =
  | 'doorbell'        // 门铃
  | 'knock'           // 敲门
  | 'alarm'           // 警报
  | 'pet'             // 宠物叫声
  | 'glass_break'     // 玻璃碎裂
  | 'speech'          // 人声
  | 'music'           // 音乐
  | 'silence'         // 静音
  | 'unknown';        // 未知

export interface SoundEvent {
  type: SoundEventType;
  confidence: number;
  timestamp: number;
  durationMs: number;
  description: string;
}

export interface SoundDetectorOptions {
  /** 检测间隔（ms），默认 2000 */
  checkIntervalMs?: number;
  /** 最低置信度，默认 0.4 */
  minConfidence?: number;
  /** 是否启用 */
  enabled?: boolean;
}

const EVENT_DESCRIPTIONS: Record<SoundEventType, string> = {
  doorbell: '有人按门铃',
  knock: '有人敲门',
  alarm: '检测到警报声',
  pet: '检测到宠物声音',
  glass_break: '检测到玻璃碎裂声',
  speech: '检测到人声',
  music: '检测到音乐',
  silence: '环境安静',
  unknown: '检测到声音事件',
};

export class SoundEventDetector {
  private checkIntervalMs: number;
  private minConfidence: number;
  private enabled: boolean;
  private listening = false;
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private eventCallback: ((event: SoundEvent) => void) | null = null;
  private prevEnergy = 0;
  private silenceFrames = 0;

  constructor(options: SoundDetectorOptions = {}) {
    this.checkIntervalMs = options.checkIntervalMs ?? 2000;
    this.minConfidence = options.minConfidence ?? 0.4;
    this.enabled = options.enabled ?? true;
  }

  /** 开始检测 */
  async start(): Promise<void> {
    if (this.listening || !this.enabled) return;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: false, // 环境声音检测需关闭回声消除
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    this.audioContext = new AudioContext({ sampleRate: 16000 });
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 1024;
    source.connect(this.analyser);

    this.listening = true;

    this.timer = setInterval(() => {
      this._analyzeFrame();
    }, this.checkIntervalMs);
  }

  /** 停止检测 */
  stop(): void {
    this.listening = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.analyser?.disconnect();
    this.analyser = null;
    this.audioContext?.close();
    this.audioContext = null;

    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }

  /** 订阅事件 */
  onEvent(callback: (event: SoundEvent) => void): () => void {
    this.eventCallback = callback;
    return () => { this.eventCallback = null; };
  }

  /** 是否正在监听 */
  get isListening(): boolean {
    return this.listening;
  }

  /** 启用/禁用 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }

  /** 检查可用性 */
  async isAvailable(): Promise<boolean> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.some(d => d.kind === 'audioinput');
    } catch {
      return false;
    }
  }

  /** 清理 */
  destroy(): void {
    this.stop();
    this.eventCallback = null;
  }

  // ==================== 内部方法 ====================

  private _analyzeFrame(): void {
    if (!this.analyser || !this.listening) return;

    const timeData = new Float32Array(this.analyser.fftSize);
    const freqData = new Float32Array(this.analyser.frequencyBinCount);

    this.analyser.getFloatTimeDomainData(timeData);
    this.analyser.getFloatFrequencyData(freqData);

    // 计算能量
    let energy = 0;
    for (let i = 0; i < timeData.length; i++) {
      energy += timeData[i] * timeData[i];
    }
    energy = Math.sqrt(energy / timeData.length);

    // 计算频谱特征
    const spectralFeatures = this._extractSpectralFeatures(freqData);

    // 分类事件
    const event = this._classifyEvent(energy, spectralFeatures);

    if (event) {
      this.eventCallback?.(event);
    }

    this.prevEnergy = energy;
  }

  private _extractSpectralFeatures(freqData: Float32Array): {
    lowEnergy: number;
    midEnergy: number;
    highEnergy: number;
    centroid: number;
    flatness: number;
  } {
    const len = freqData.length;
    const third = Math.floor(len / 3);

    let low = 0, mid = 0, high = 0;
    let totalEnergy = 0;
    let weightedSum = 0;

    for (let i = 0; i < len; i++) {
      const power = Math.pow(10, freqData[i] / 10); // dB → power
      totalEnergy += power;

      if (i < third) low += power;
      else if (i < third * 2) mid += power;
      else high += power;

      weightedSum += i * power;
    }

    const centroid = totalEnergy > 0 ? weightedSum / totalEnergy : 0;

    // 频谱平坦度 (geometric mean / arithmetic mean)
    let geoMean = 0;
    for (let i = 0; i < len; i++) {
      geoMean += Math.log(Math.max(1e-10, Math.pow(10, freqData[i] / 10)));
    }
    geoMean = Math.exp(geoMean / len);
    const flatness = totalEnergy > 0 ? geoMean / (totalEnergy / len) : 0;

    return {
      lowEnergy: totalEnergy > 0 ? low / totalEnergy : 0,
      midEnergy: totalEnergy > 0 ? mid / totalEnergy : 0,
      highEnergy: totalEnergy > 0 ? high / totalEnergy : 0,
      centroid,
      flatness,
    };
  }

  private _classifyEvent(
    energy: number,
    features: { lowEnergy: number; midEnergy: number; highEnergy: number; centroid: number; flatness: number },
  ): SoundEvent | null {
    // 静音检测
    if (energy < 0.005) {
      this.silenceFrames++;
      if (this.silenceFrames > 5) {
        this.silenceFrames = 0;
        return this._createEvent('silence', 0.9);
      }
      return null;
    }
    this.silenceFrames = 0;

    // 能量突变检测
    const energyRatio = this.prevEnergy > 0.001 ? energy / this.prevEnergy : 1;

    // 警报：高频为主，持续高能量
    if (features.highEnergy > 0.4 && energy > 0.1) {
      return this._createEvent('alarm', Math.min(0.7, 0.3 + features.highEnergy));
    }

    // 玻璃碎裂：高频 + 瞬时能量突增 + 高平坦度
    if (energyRatio > 5 && features.highEnergy > 0.3 && features.flatness > 0.3) {
      return this._createEvent('glass_break', Math.min(0.8, 0.4 + energyRatio * 0.05));
    }

    // 门铃/敲门：中频 + 短促脉冲
    if (energyRatio > 3 && features.midEnergy > 0.4 && energy > 0.05) {
      return this._createEvent('doorbell', Math.min(0.6, 0.3 + energyRatio * 0.05));
    }

    // 敲门：低频为主 + 突变
    if (energyRatio > 3 && features.lowEnergy > 0.5) {
      return this._createEvent('knock', Math.min(0.6, 0.3 + energyRatio * 0.05));
    }

    // 人声：中频为主，频谱复杂度中等
    if (features.midEnergy > 0.35 && features.centroid > 50 && features.centroid < 200 && energy > 0.02) {
      return this._createEvent('speech', Math.min(0.7, 0.3 + features.midEnergy));
    }

    // 音乐：频谱分布较均匀
    if (features.flatness > 0.4 && energy > 0.03) {
      return this._createEvent('music', Math.min(0.5, 0.2 + features.flatness));
    }

    // 宠物：中高频 + 不规则
    if (features.highEnergy > 0.2 && features.midEnergy > 0.2 && energy > 0.04) {
      return this._createEvent('pet', Math.min(0.5, 0.2 + energy));
    }

    return null;
  }

  private _createEvent(type: SoundEventType, confidence: number): SoundEvent {
    return {
      type,
      confidence,
      timestamp: Date.now(),
      durationMs: this.checkIntervalMs,
      description: EVENT_DESCRIPTIONS[type],
    };
  }
}
