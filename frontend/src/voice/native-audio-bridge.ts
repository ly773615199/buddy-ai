/**
 * 原生音频桥
 *
 * 将 Capacitor 原生麦克风的 PCM 帧注入 Web Audio API
 * 供现有 emotion-voice.ts / sound-events.ts / wakeword.ts / audio-stream.ts 使用
 *
 * 降级策略：浏览器 getUserMedia 可用时走原生 API，不可用时降级到此桥
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

// ── 原生插件接口 ──

interface NativeAudioPlugin {
  startRecording(): Promise<{ status: string }>;
  stopRecording(): Promise<{ status: string }>;
  playAudio(options: { audio: string; title?: string }): Promise<{ status: string }>;
  stopAudio(): Promise<{ status: string }>;
  addListener(event: string, callback: (data: unknown) => void): Promise<PluginListenerHandle>;
}

interface PluginListenerHandle {
  remove(): Promise<void>;
}

export interface AudioFrameData {
  /** base64 编码的 Int16 PCM */
  pcm: string;
  /** 采样率 */
  sampleRate: number;
  /** 声道数 */
  channels: number;
  /** 帧大小（采样点数） */
  frameSize: number;
}

export interface AudioPlaybackCompleteData {
  success: boolean;
}

// ── 延迟注册（仅在 Capacitor 环境中可用） ──

let _nativeAudio: NativeAudioPlugin | null = null;

function getNativeAudio(): NativeAudioPlugin | null {
  if (_nativeAudio) return _nativeAudio;
  if (!Capacitor.isNativePlatform()) return null;
  try {
    _nativeAudio = registerPlugin<NativeAudioPlugin>('NativeAudio');
    return _nativeAudio;
  } catch {
    return null;
  }
}

// ── 主类 ──

export class NativeAudioBridge {
  private audioContext: AudioContext | null = null;
  private listenerHandle: PluginListenerHandle | null = null;
  private playbackListenerHandle: PluginListenerHandle | null = null;
  private isRunning = false;
  private pcmRingBuffer: Float32Array = new Float32Array(0);
  private readonly ringBufferSize = 16000 * 2; // 2 秒 @ 16kHz

  // 音量回调（供 VAD / 唤醒词 / 情绪检测使用）
  private volumeCallbacks: Set<(level: number) => void> = new Set();

  // 帧回调（供摄像头桥等外部消费者使用）
  private frameCallbacks: Set<(pcm: Float32Array) => void> = new Set();

  // 播放完成回调
  private playbackCompleteCallbacks: Set<(success: boolean) => void> = new Set();

  /**
   * 检测是否在原生平台
   */
  static isNativePlatform(): boolean {
    return Capacitor.isNativePlatform();
  }

  /**
   * 检测是否需要原生模式
   * getUserMedia 失败时降级到原生
   */
  static async needsNativeMode(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      return false;
    } catch {
      return true;
    }
  }

  /**
   * 启动原生录音
   */
  async start(): Promise<void> {
    const native = getNativeAudio();
    if (!native) {
      throw new Error('NativeAudio 插件不可用（非原生平台）');
    }

    if (this.isRunning) return;

    // 初始化 AudioContext（用于后续 AnalyserNode 等处理）
    this.audioContext = new AudioContext({ sampleRate: 16000 });

    // 初始化环形缓冲区
    this.pcmRingBuffer = new Float32Array(this.ringBufferSize);

    // 监听原生层推送的 PCM 帧
    this.listenerHandle = await native.addListener('audioFrame', (data) => {
      this.handleNativeFrame(data as AudioFrameData);
    });

    await native.startRecording();
    this.isRunning = true;
  }

  /**
   * 停止原生录音
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    const native = getNativeAudio();
    if (native) {
      await native.stopRecording();
    }

    await this.listenerHandle?.remove();
    this.listenerHandle = null;

    this.audioContext?.close();
    this.audioContext = null;
  }

  /**
   * 播放音频（base64 MP3）
   */
  async playAudio(base64Mp3: string, title?: string): Promise<void> {
    const native = getNativeAudio();
    if (!native) {
      // 降级：用浏览器 Audio 元素播放
      this.playWithBrowserAudio(base64Mp3);
      return;
    }

    // 监听播放完成
    if (!this.playbackListenerHandle) {
      this.playbackListenerHandle = await native.addListener(
        'audioPlaybackComplete',
        (data) => {
          const d = data as AudioPlaybackCompleteData;
          for (const cb of this.playbackCompleteCallbacks) {
            try { cb(d.success); } catch { /* ignore */ }
          }
        }
      );
    }

    await native.playAudio({ audio: base64Mp3, title });
  }

  /**
   * 停止音频播放
   */
  async stopAudio(): Promise<void> {
    const native = getNativeAudio();
    if (native) {
      await native.stopAudio();
    }
  }

  /**
   * 获取 AudioContext（供现有 AnalyserNode 代码使用）
   */
  getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  /**
   * 创建 AnalyserNode（供现有频谱分析代码使用）
   * 返回的 AnalyserNode 已连接到原生音频源
   */
  createAnalyserNode(fftSize = 256): AnalyserNode | null {
    if (!this.audioContext) return null;
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = fftSize;
    // 注意：原生模式下 AnalyserNode 不直接连接到麦克风流
    // 需要通过 ScriptProcessorNode 或 AudioWorklet 将 PCM 数据注入
    return analyser;
  }

  /**
   * 订阅音量变化（RMS 0-1）
   */
  onVolumeChange(callback: (level: number) => void): () => void {
    this.volumeCallbacks.add(callback);
    return () => this.volumeCallbacks.delete(callback);
  }

  /**
   * 订阅原始 PCM 帧（Float32Array）
   */
  onFrame(callback: (pcm: Float32Array) => void): () => void {
    this.frameCallbacks.add(callback);
    return () => this.frameCallbacks.delete(callback);
  }

  /**
   * 订阅播放完成事件
   */
  onPlaybackComplete(callback: (success: boolean) => void): () => void {
    this.playbackCompleteCallbacks.add(callback);
    return () => this.playbackCompleteCallbacks.delete(callback);
  }

  /**
   * 获取最新的 PCM 数据（环形缓冲区）
   * @param samples 需要的采样点数，默认 1024
   */
  getLatestPCM(samples = 1024): Float32Array {
    const len = this.pcmRingBuffer.length;
    if (len === 0) return new Float32Array(samples);
    const count = Math.min(samples, len);
    const result = new Float32Array(count);
    // 从尾部取最新数据
    for (let i = 0; i < count; i++) {
      result[i] = this.pcmRingBuffer[(len - count + i) % len];
    }
    return result;
  }

  /**
   * 是否正在运行
   */
  get active(): boolean {
    return this.isRunning;
  }

  /**
   * 清理所有资源
   */
  destroy(): void {
    this.stop();
    this.volumeCallbacks.clear();
    this.frameCallbacks.clear();
    this.playbackCompleteCallbacks.clear();
    this.playbackListenerHandle?.remove();
    this.playbackListenerHandle = null;
  }

  // ── 内部方法 ──

  /**
   * 处理原生 PCM 帧 → 注入 Web Audio 管线
   */
  private handleNativeFrame(data: AudioFrameData): void {
    if (!this.isRunning) return;

    // base64 → Int16 → Float32
    const raw = atob(data.pcm);
    const int16 = new Int16Array(raw.length / 2);
    for (let i = 0; i < int16.length; i++) {
      int16[i] = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
    }

    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    // 写入环形缓冲区
    this.appendToRingBuffer(float32);

    // 计算 RMS 音量
    let energy = 0;
    for (let i = 0; i < float32.length; i++) {
      energy += float32[i] * float32[i];
    }
    const rms = Math.sqrt(energy / float32.length);

    // 通知音量回调
    for (const cb of this.volumeCallbacks) {
      try { cb(rms); } catch { /* ignore */ }
    }

    // 通知帧回调
    for (const cb of this.frameCallbacks) {
      try { cb(float32); } catch { /* ignore */ }
    }
  }

  /**
   * 追加数据到环形缓冲区
   */
  private appendToRingBuffer(data: Float32Array): void {
    const bufLen = this.pcmRingBuffer.length;
    const dataLen = data.length;

    if (dataLen >= bufLen) {
      // 数据比缓冲区大，只保留尾部
      this.pcmRingBuffer.set(data.slice(dataLen - bufLen));
    } else {
      // 左移旧数据，追加新数据
      this.pcmRingBuffer.copyWithin(0, dataLen);
      this.pcmRingBuffer.set(data, bufLen - dataLen);
    }
  }

  /**
   * 浏览器降级播放
   */
  private playWithBrowserAudio(base64Mp3: string): void {
    const audio = new Audio(`data:audio/mp3;base64,${base64Mp3}`);
    audio.onended = () => {
      for (const cb of this.playbackCompleteCallbacks) {
        try { cb(true); } catch { /* ignore */ }
      }
    };
    audio.onerror = () => {
      for (const cb of this.playbackCompleteCallbacks) {
        try { cb(false); } catch { /* ignore */ }
      }
    };
    audio.play().catch(() => {
      for (const cb of this.playbackCompleteCallbacks) {
        try { cb(false); } catch { /* ignore */ }
      }
    });
  }
}
