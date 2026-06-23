/**
 * 声音事件检测 v2
 *
 * 改进：多特征融合 + 自适应阈值 + 滑动窗口 + 历史上下文
 *
 * 后端选择：
 * - Web Audio API 基础频谱分析（免费，精度低）
 * - 云端 API（高精度，需付费）
 * - 本地模型（YAMNet/audioset，需加载）
 */

export type SoundEventType =
  | 'doorbell'
  | 'knock'
  | 'alarm'
  | 'pet'
  | 'glass_break'
  | 'speech'
  | 'music'
  | 'silence'
  | 'unknown';

export interface SoundEvent {
  type: SoundEventType;
  confidence: number;
  timestamp: number;
  durationMs: number;
  description: string;
  /** 原始特征（调试用） */
  features?: SpectralFeatures;
}

export interface SoundDetectorOptions {
  /** 检测间隔（ms），默认 2000 */
  checkIntervalMs?: number;
  /** 最低置信度，默认 0.4 */
  minConfidence?: number;
  /** 是否启用 */
  enabled?: boolean;
  /** 自适应阈值窗口大小，默认 30 */
  adaptiveWindowSize?: number;
  /** 滑动窗口大小（帧数），默认 3 */
  slidingWindowSize?: number;
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

interface SpectralFeatures {
  energy: number;
  lowEnergy: number;
  midEnergy: number;
  highEnergy: number;
  centroid: number;
  flatness: number;
  rolloff: number;
  zeroCrossingRate: number;
  spectralContrast: number;
}

interface EnergyHistory {
  values: number[];
  mean: number;
  stddev: number;
}

// ==================== 特征提取增强 ====================

function extractFeatures(
  timeData: Float32Array,
  freqData: Float32Array,
  sampleRate: number,
): SpectralFeatures {
  const len = freqData.length;
  const timeLen = timeData.length;

  // 能量
  let energy = 0;
  for (let i = 0; i < timeLen; i++) {
    energy += timeData[i] * timeData[i];
  }
  energy = Math.sqrt(energy / timeLen);

  // 频带能量
  const third = Math.floor(len / 3);
  let low = 0, mid = 0, high = 0;
  let totalPower = 0;
  let weightedSum = 0;

  for (let i = 0; i < len; i++) {
    const power = Math.pow(10, freqData[i] / 10);
    totalPower += power;
    if (i < third) low += power;
    else if (i < third * 2) mid += power;
    else high += power;
    weightedSum += i * power;
  }

  const lowEnergy = totalPower > 0 ? low / totalPower : 0;
  const midEnergy = totalPower > 0 ? mid / totalPower : 0;
  const highEnergy = totalPower > 0 ? high / totalPower : 0;
  const centroid = totalPower > 0 ? weightedSum / totalPower : 0;

  // 频谱平坦度
  let geoMean = 0;
  for (let i = 0; i < len; i++) {
    geoMean += Math.log(Math.max(1e-10, Math.pow(10, freqData[i] / 10)));
  }
  geoMean = Math.exp(geoMean / len);
  const flatness = totalPower > 0 ? geoMean / (totalPower / len) : 0;

  // 频谱滚降点（85% 能量处）
  let cumulative = 0;
  const rolloffThreshold = totalPower * 0.85;
  let rolloff = 0;
  for (let i = 0; i < len; i++) {
    cumulative += Math.pow(10, freqData[i] / 10);
    if (cumulative >= rolloffThreshold) {
      rolloff = i / len;
      break;
    }
  }

  // 过零率
  let zeroCrossings = 0;
  for (let i = 1; i < timeLen; i++) {
    if ((timeData[i] >= 0) !== (timeData[i - 1] >= 0)) zeroCrossings++;
  }
  const zeroCrossingRate = zeroCrossings / timeLen;

  // 频谱对比度（高频 vs 低频能量差）
  const spectralContrast = highEnergy - lowEnergy;

  return {
    energy,
    lowEnergy,
    midEnergy,
    highEnergy,
    centroid,
    flatness,
    rolloff,
    zeroCrossingRate,
    spectralContrast,
  };
}

// ==================== 自适应阈值 ====================

function updateEnergyHistory(
  history: EnergyHistory,
  energy: number,
  windowSize: number,
): void {
  history.values.push(energy);
  if (history.values.length > windowSize) history.values.shift();

  const n = history.values.length;
  history.mean = history.values.reduce((s, v) => s + v, 0) / n;
  history.stddev = Math.sqrt(
    history.values.reduce((s, v) => s + (v - history.mean) ** 2, 0) / n,
  );
}

function isEnergySpike(energy: number, history: EnergyHistory): boolean {
  if (history.values.length < 5) return energy > 0.05;
  const threshold = history.mean + history.stddev * 2;
  return energy > threshold;
}

// ==================== 滑动窗口投票 ====================

interface DetectionVote {
  type: SoundEventType;
  confidence: number;
}

function majorityVote(windows: DetectionVote[]): DetectionVote | null {
  if (windows.length === 0) return null;

  const counts = new Map<SoundEventType, { count: number; totalConfidence: number }>();
  for (const vote of windows) {
    const existing = counts.get(vote.type);
    if (existing) {
      existing.count++;
      existing.totalConfidence += vote.confidence;
    } else {
      counts.set(vote.type, { count: 1, totalConfidence: vote.confidence });
    }
  }

  let best: SoundEventType | null = null;
  let bestScore = 0;
  for (const [type, { count, totalConfidence }] of counts) {
    // 综合票数和置信度
    const score = count * (totalConfidence / count);
    if (score > bestScore) {
      bestScore = score;
      best = type;
    }
  }

  if (!best) return null;
  const entry = counts.get(best)!;
  return {
    type: best,
    confidence: Math.min(0.95, entry.totalConfidence / entry.count + (entry.count / windows.length) * 0.2),
  };
}

// ==================== 分类器 v2 ====================

function classifyEvent(
  features: SpectralFeatures,
  energyHistory: EnergyHistory,
): DetectionVote | null {
  const { energy, lowEnergy, midEnergy, highEnergy, centroid, flatness, rolloff, zeroCrossingRate, spectralContrast } = features;

  // 静音
  if (energy < 0.003) return { type: 'silence', confidence: 0.95 };

  const isSpike = isEnergySpike(energy, energyHistory);
  const energyRatio = energyHistory.mean > 0.001 ? energy / energyHistory.mean : 1;

  // ── 玻璃碎裂：高频 + 瞬时突增 + 高平坦度 + 高过零率 ──
  if (isSpike && highEnergy > 0.25 && flatness > 0.25 && zeroCrossingRate > 0.1) {
    return { type: 'glass_break', confidence: Math.min(0.85, 0.5 + flatness * 0.5 + zeroCrossingRate * 0.3) };
  }

  // ── 警报：高频为主 + 持续高能量 + 高频谱对比度 ──
  if (highEnergy > 0.35 && energy > 0.08 && spectralContrast > 0.1) {
    return { type: 'alarm', confidence: Math.min(0.8, 0.4 + highEnergy * 0.5) };
  }

  // ── 门铃：中频 + 短促脉冲 + 中等能量突变 ──
  if (isSpike && midEnergy > 0.35 && energy > 0.04 && rolloff < 0.6) {
    return { type: 'doorbell', confidence: Math.min(0.7, 0.35 + energyRatio * 0.05) };
  }

  // ── 敲门：低频为主 + 突变 + 低过零率 ──
  if (isSpike && lowEnergy > 0.45 && zeroCrossingRate < 0.08) {
    return { type: 'knock', confidence: Math.min(0.7, 0.35 + lowEnergy * 0.4) };
  }

  // ── 人声：中频为主 + 中等频谱复杂度 + 中等过零率 ──
  if (midEnergy > 0.3 && centroid > 40 && centroid < 250 && energy > 0.015 &&
      zeroCrossingRate > 0.02 && zeroCrossingRate < 0.15) {
    return { type: 'speech', confidence: Math.min(0.75, 0.35 + midEnergy * 0.4) };
  }

  // ── 音乐：频谱分布均匀 + 中等能量 + 高频谱滚降 ──
  if (flatness > 0.35 && energy > 0.025 && rolloff > 0.3 && centroid > 100) {
    return { type: 'music', confidence: Math.min(0.6, 0.25 + flatness * 0.4) };
  }

  // ── 宠物：中高频混合 + 不规则 ──
  if (highEnergy > 0.15 && midEnergy > 0.15 && energy > 0.03 &&
      centroid > 200 && zeroCrossingRate > 0.05) {
    return { type: 'pet', confidence: Math.min(0.55, 0.2 + energy * 2) };
  }

  return null;
}

// ==================== 主类 ====================

export class SoundEventDetector {
  private checkIntervalMs: number;
  private minConfidence: number;
  private enabled: boolean;
  private adaptiveWindowSize: number;
  private slidingWindowSize: number;
  private listening = false;
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private eventCallback: ((event: SoundEvent) => void) | null = null;

  // 自适应状态
  private energyHistory: EnergyHistory = { values: [], mean: 0, stddev: 0 };
  private silenceFrames = 0;

  // 滑动窗口
  private detectionWindow: DetectionVote[] = [];

  constructor(options: SoundDetectorOptions = {}) {
    this.checkIntervalMs = options.checkIntervalMs ?? 2000;
    this.minConfidence = options.minConfidence ?? 0.4;
    this.enabled = options.enabled ?? true;
    this.adaptiveWindowSize = options.adaptiveWindowSize ?? 30;
    this.slidingWindowSize = options.slidingWindowSize ?? 3;
  }

  /** 开始检测 */
  async start(): Promise<void> {
    if (this.listening || !this.enabled) return;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: false,
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
    this.energyHistory = { values: [], mean: 0, stddev: 0 };
    this.detectionWindow = [];

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

    this.detectionWindow = [];
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

  /** 获取当前能量历史（调试用） */
  getEnergyStats(): { mean: number; stddev: number; samples: number } {
    return {
      mean: this.energyHistory.mean,
      stddev: this.energyHistory.stddev,
      samples: this.energyHistory.values.length,
    };
  }

  /** 清理 */
  destroy(): void {
    this.stop();
    this.eventCallback = null;
  }

  // ==================== 内部方法 ====================

  private _analyzeFrame(): void {
    if (!this.analyser || !this.listening || !this.audioContext) return;

    const timeData = new Float32Array(this.analyser.fftSize);
    const freqData = new Float32Array(this.analyser.frequencyBinCount);

    this.analyser.getFloatTimeDomainData(timeData);
    this.analyser.getFloatFrequencyData(freqData);

    // 提取增强特征
    const features = extractFeatures(timeData, freqData, this.audioContext.sampleRate);

    // 更新自适应阈值
    updateEnergyHistory(this.energyHistory, features.energy, this.adaptiveWindowSize);

    // 分类
    const vote = classifyEvent(features, this.energyHistory);

    if (vote) {
      // 静音帧计数
      if (vote.type === 'silence') {
        this.silenceFrames++;
        if (this.silenceFrames > 3) {
          this.silenceFrames = 0;
          this._emitEvent(vote, features);
        }
        return;
      }
      this.silenceFrames = 0;

      // 滑动窗口投票
      this.detectionWindow.push(vote);
      if (this.detectionWindow.length > this.slidingWindowSize) {
        this.detectionWindow.shift();
      }

      const result = majorityVote(this.detectionWindow);
      if (result && result.confidence >= this.minConfidence) {
        this._emitEvent(result, features);
        this.detectionWindow = []; // 重置窗口
      }
    }
  }

  private _emitEvent(vote: DetectionVote, features: SpectralFeatures): void {
    const event: SoundEvent = {
      type: vote.type,
      confidence: vote.confidence,
      timestamp: Date.now(),
      durationMs: this.checkIntervalMs,
      description: EVENT_DESCRIPTIONS[vote.type],
      features,
    };
    this.eventCallback?.(event);
  }
}
