/**
 * 唤醒词检测器
 * 基于 Porcupine (Picovoice) 或浏览器端 Web Audio 基础方案
 *
 * Porcupine: 本地 WASM 运行，低功耗，支持自定义唤醒词
 * 降级方案: 简单关键词匹配 (基于音频频谱特征)
 */

export interface WakeWordOptions {
  keyword?: string;            // 唤醒词，默认 "Hey Buddy"
  sensitivity?: number;        // 灵敏度 0-1，默认 0.5
  backend?: 'porcupine' | 'browser' | 'fallback';
  porcupineApiKey?: string;
  onWake?: (keyword: string, confidence: number) => void;
}

export interface WakeWordResult {
  keyword: string;
  confidence: number;
  timestamp: number;
}

export class WakeWordDetector {
  private keyword: string;
  private sensitivity: number;
  private backend: string;
  private apiKey: string;
  private listening = false;
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private animFrame: number | null = null;
  private porcupine: any = null;
  private wakeCallback: ((result: WakeWordResult) => void) | null = null;
  private cooldownUntil = 0;
  private cooldownMs = 3000; // 唤醒后冷却时间

  constructor(options: WakeWordOptions = {}) {
    this.keyword = options.keyword ?? 'Hey Buddy';
    this.sensitivity = options.sensitivity ?? 0.5;
    this.backend = options.backend ?? 'fallback';
    this.apiKey = options.porcupineApiKey ?? '';

    if (options.onWake) {
      const cb = options.onWake;
      this.onWake((result) => cb(result.keyword, result.confidence));
    }
  }

  /** 初始化检测器 */
  async init(): Promise<void> {
    if (this.backend === 'porcupine') {
      try {
        // Porcupine 需要 @picovoice/porcupine-web 包（可选依赖）
        const porcupineModule = await import(/* @vite-ignore */ '@picovoice/porcupine-web' as string) as any;
        const Porcupine = porcupineModule.Porcupine;
        this.porcupine = await Porcupine.create(
          this.apiKey,
          [{ builtin: 'Hey Buddy', sensitivity: this.sensitivity }],
        );
      } catch {
        console.warn('Porcupine 加载失败，降级到基础检测');
        this.backend = 'browser';
      }
    }
  }

  /** 开始监听 */
  async startListening(): Promise<void> {
    if (this.listening) return;

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
    this.analyser.fftSize = 512;
    source.connect(this.analyser);

    this.listening = true;
    this._startDetectionLoop();
  }

  /** 停止监听 */
  stopListening(): void {
    this.listening = false;

    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
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

  /** 唤醒回调 */
  onWake(callback: (result: WakeWordResult) => void): void {
    this.wakeCallback = callback;
  }

  /** 是否正在监听 */
  get isListening(): boolean {
    return this.listening;
  }

  /** 获取当前唤醒词 */
  getKeyword(): string {
    return this.keyword;
  }

  /** 获取当前灵敏度 */
  getSensitivity(): number {
    return this.sensitivity;
  }

  /** 设置灵敏度 */
  setSensitivity(value: number): void {
    this.sensitivity = Math.max(0, Math.min(1, value));
  }

  /** 检查可用性 */
  async isAvailable(): Promise<boolean> {
    if (this.backend === 'porcupine' && this.apiKey) return true;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.some(d => d.kind === 'audioinput');
    } catch {
      return false;
    }
  }

  /** 清理 */
  destroy(): void {
    this.stopListening();
    if (this.porcupine) {
      this.porcupine.release?.();
      this.porcupine = null;
    }
    this.wakeCallback = null;
  }

  // ==================== 内部方法 ====================

  private _startDetectionLoop(): void {
    if (!this.listening || !this.analyser) return;

    if (this.backend === 'porcupine' && this.porcupine) {
      this._porcupineDetectLoop();
    } else {
      this._energyDetectLoop();
    }
  }

  /** Porcupine 检测循环 */
  private _porcupineDetectLoop(): void {
    // Porcupine 需要 PCM Int16 输入，这里简化处理
    // 实际需要从 AudioWorklet 获取 PCM 数据
    const loop = () => {
      if (!this.listening) return;
      // Porcupine 检测逻辑需配合 AudioWorklet
      this.animFrame = requestAnimationFrame(loop);
    };
    this.animFrame = requestAnimationFrame(loop);
  }

  /** 基础能量检测循环 (降级方案)
   * 通过检测突然的音量变化来模拟唤醒
   */
  private _energyDetectLoop(): void {
    if (!this.analyser) return;

    const data = new Float32Array(this.analyser.fftSize);
    let prevEnergy = 0;
    let spikeCount = 0;

    const loop = () => {
      if (!this.listening || !this.analyser) return;

      this.analyser.getFloatTimeDomainData(data);

      let energy = 0;
      for (let i = 0; i < data.length; i++) {
        energy += data[i] * data[i];
      }
      energy = Math.sqrt(energy / data.length);

      // 检测能量突变（类似唤醒词的特征）
      const energyRatio = prevEnergy > 0.001 ? energy / prevEnergy : 1;
      if (energyRatio > 3 && energy > 0.05) {
        spikeCount++;
      } else {
        spikeCount = Math.max(0, spikeCount - 1);
      }

      prevEnergy = energy * 0.9 + prevEnergy * 0.1; // 平滑

      // 冷却期内不触发
      if (Date.now() < this.cooldownUntil) {
        this.animFrame = requestAnimationFrame(loop);
        return;
      }

      // 连续能量突变达到阈值 → 触发唤醒
      if (spikeCount >= 3) {
        spikeCount = 0;
        this.cooldownUntil = Date.now() + this.cooldownMs;

        const result: WakeWordResult = {
          keyword: this.keyword,
          confidence: Math.min(0.7, 0.3 + energy * 2),
          timestamp: Date.now(),
        };

        this.wakeCallback?.(result);
      }

      this.animFrame = requestAnimationFrame(loop);
    };

    this.animFrame = requestAnimationFrame(loop);
  }
}
