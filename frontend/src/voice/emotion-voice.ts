/**
 * 语音情绪分析
 * 通过语速/音量/音调特征判断说话者情绪
 *
 * 基于 Web Audio API 频谱分析（免费，实时）
 * 降级方案：简单能量分析
 */

export type VoiceEmotion = 'calm' | 'excited' | 'angry' | 'sad' | 'anxious' | 'happy' | 'tired' | 'neutral';

export interface VoiceEmotionResult {
  emotion: VoiceEmotion;
  confidence: number;
  features: VoiceFeatures;
  timestamp: number;
  description: string;
}

export interface VoiceFeatures {
  energy: number;           // 音量能量 0-1
  energyVariance: number;   // 能量波动
  pitch: number;            // 基频估计 (Hz)
  pitchVariance: number;    // 音调波动
  speakingRate: number;     // 语速估计 (0-1)
  spectralCentroid: number; // 频谱重心
}

export interface VoiceEmotionOptions {
  /** 分析间隔（ms），默认 1000 */
  analysisIntervalMs?: number;
  /** 历史窗口大小（用于计算方差），默认 10 */
  windowSize?: number;
}

const EMOTION_DESCRIPTIONS: Record<VoiceEmotion, string> = {
  calm: '语气平静',
  excited: '语气兴奋',
  angry: '语气生气',
  sad: '语气低落',
  anxious: '语气着急',
  happy: '语气开心',
  tired: '语气疲惫',
  neutral: '情绪中性',
};

export class VoiceEmotionAnalyzer {
  private intervalMs: number;
  private windowSize: number;
  private analyzing = false;
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private emotionCallback: ((result: VoiceEmotionResult) => void) | null = null;

  // 历史数据窗口
  private energyHistory: number[] = [];
  private pitchHistory: number[] = [];

  constructor(options: VoiceEmotionOptions = {}) {
    this.intervalMs = options.analysisIntervalMs ?? 1000;
    this.windowSize = options.windowSize ?? 10;
  }

  /** 开始分析 */
  async start(): Promise<void> {
    if (this.analyzing) return;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    this.audioContext = new AudioContext({ sampleRate: 16000 });
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 1024;
    source.connect(this.analyser);

    this.analyzing = true;
    this.energyHistory = [];
    this.pitchHistory = [];

    this.timer = setInterval(() => {
      this._analyze();
    }, this.intervalMs);
  }

  /** 停止分析 */
  stop(): void {
    this.analyzing = false;

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

    this.energyHistory = [];
    this.pitchHistory = [];
  }

  /** 订阅情绪结果 */
  onEmotion(callback: (result: VoiceEmotionResult) => void): () => void {
    this.emotionCallback = callback;
    return () => { this.emotionCallback = null; };
  }

  /** 是否正在分析 */
  get isAnalyzing(): boolean {
    return this.analyzing;
  }

  /** 清理 */
  destroy(): void {
    this.stop();
    this.emotionCallback = null;
  }

  // ==================== 内部方法 ====================

  private _analyze(): void {
    if (!this.analyser || !this.analyzing) return;

    const timeData = new Float32Array(this.analyser.fftSize);
    const freqData = new Float32Array(this.analyser.frequencyBinCount);

    this.analyser.getFloatTimeDomainData(timeData);
    this.analyser.getFloatFrequencyData(freqData);

    const features = this._extractFeatures(timeData, freqData);

    // 更新历史窗口
    this.energyHistory.push(features.energy);
    this.pitchHistory.push(features.pitch);
    if (this.energyHistory.length > this.windowSize) this.energyHistory.shift();
    if (this.pitchHistory.length > this.windowSize) this.pitchHistory.shift();

    // 计算方差
    features.energyVariance = this._variance(this.energyHistory);
    features.pitchVariance = this._variance(this.pitchHistory);

    // 分类情绪
    const emotion = this._classifyEmotion(features);
    const confidence = this._computeConfidence(features, emotion);

    const result: VoiceEmotionResult = {
      emotion,
      confidence,
      features,
      timestamp: Date.now(),
      description: EMOTION_DESCRIPTIONS[emotion],
    };

    this.emotionCallback?.(result);
  }

  private _extractFeatures(
    timeData: Float32Array,
    freqData: Float32Array,
  ): VoiceFeatures {
    // 能量
    let energy = 0;
    for (let i = 0; i < timeData.length; i++) {
      energy += timeData[i] * timeData[i];
    }
    energy = Math.sqrt(energy / timeData.length);

    // 频谱重心
    let totalPower = 0;
    let weightedSum = 0;
    for (let i = 0; i < freqData.length; i++) {
      const power = Math.pow(10, freqData[i] / 10);
      totalPower += power;
      weightedSum += i * power;
    }
    const spectralCentroid = totalPower > 0 ? weightedSum / totalPower : 0;

    // 基频估计（自相关法简化版）
    const pitch = this._estimatePitch(timeData, 16000);

    // 语速估计（基于能量变化频率）
    let changes = 0;
    const threshold = 0.02;
    for (let i = 1; i < timeData.length; i++) {
      if (Math.abs(timeData[i] - timeData[i - 1]) > threshold) changes++;
    }
    const speakingRate = Math.min(1, changes / (timeData.length * 0.3));

    return {
      energy,
      energyVariance: 0,
      pitch,
      pitchVariance: 0,
      speakingRate,
      spectralCentroid,
    };
  }

  private _classifyEmotion(features: VoiceFeatures): VoiceEmotion {
    const { energy, energyVariance, pitch, speakingRate } = features;

    // 高能量 + 高波动 + 高语速 → 兴奋/生气
    if (energy > 0.1 && energyVariance > 0.01) {
      if (speakingRate > 0.6) return pitch > 200 ? 'excited' : 'angry';
      return 'anxious';
    }

    // 高能量 + 稳定 → 开心
    if (energy > 0.08 && energyVariance < 0.005) return 'happy';

    // 低能量 + 低语速 → 疲惫/悲伤
    if (energy < 0.03) {
      return pitch < 150 ? 'sad' : 'tired';
    }

    // 中等能量 + 稳定 → 平静
    if (energy < 0.06 && energyVariance < 0.005) return 'calm';

    return 'neutral';
  }

  private _computeConfidence(features: VoiceFeatures, emotion: VoiceEmotion): number {
    // 简化的置信度计算
    const { energy, energyVariance } = features;

    if (energy < 0.01) return 0.1; // 几乎无声

    switch (emotion) {
      case 'excited':
      case 'angry':
        return Math.min(0.8, 0.4 + energyVariance * 10);
      case 'sad':
      case 'tired':
        return Math.min(0.7, 0.3 + (0.05 - energy) * 10);
      case 'calm':
      case 'neutral':
        return Math.min(0.6, 0.3 + (1 - energyVariance) * 0.3);
      default:
        return 0.4;
    }
  }

  private _estimatePitch(data: Float32Array, sampleRate: number): number {
    // 简化的自相关基频估计
    const minLag = Math.floor(sampleRate / 500); // 最高 500Hz
    const maxLag = Math.floor(sampleRate / 80);  // 最低 80Hz

    let bestLag = 0;
    let bestCorr = 0;

    for (let lag = minLag; lag < maxLag && lag < data.length / 2; lag++) {
      let corr = 0;
      let norm = 0;
      for (let i = 0; i < data.length - lag; i++) {
        corr += data[i] * data[i + lag];
        norm += data[i] * data[i];
      }
      corr = norm > 0 ? corr / norm : 0;
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }

    return bestLag > 0 && bestCorr > 0.3 ? sampleRate / bestLag : 0;
  }

  private _variance(arr: number[]): number {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  }
}
