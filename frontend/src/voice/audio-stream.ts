/**
 * 音频流管理器
 * 分段录制 + VAD (Voice Activity Detection) + 音频流后传
 *
 * 基于 AudioStreamManager 接口定义
 */

import type { AudioDevice, AudioStatus, AudioChunk } from '../types/device-types.js';

export interface AudioStreamOptions {
  chunkMs?: number;         // 每段时长，默认 3000ms
  sampleRate?: number;      // 采样率，默认 16000
  mimeType?: string;        // 编码格式，默认 'audio/webm;codecs=opus'
  vadEnabled?: boolean;     // 是否启用 VAD
  vadThreshold?: number;    // VAD 阈值 0-1，默认 0.02
  silenceTimeoutMs?: number; // 静音超时自动停止，默认 3000ms
}

export interface AudioChunkCallback {
  (chunk: AudioChunk): void;
}

export interface VADCallback {
  (speaking: boolean): void;
}

/**
 * 基于浏览器 MediaRecorder 的音频流实现
 */
export class AudioStreamManager {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private status: AudioStatus = { state: 'inactive' };
  private sequenceId = 0;

  // VAD 状态
  private isSpeaking = false;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private vadAnimFrame: number | null = null;

  // 回调
  private chunkCallbacks: Set<AudioChunkCallback> = new Set();
  private vadCallbacks: Set<VADCallback> = new Set();

  // 选项
  private options: Required<AudioStreamOptions>;

  constructor(options: AudioStreamOptions = {}) {
    this.options = {
      chunkMs: options.chunkMs ?? 3000,
      sampleRate: options.sampleRate ?? 16000,
      mimeType: options.mimeType ?? 'audio/webm;codecs=opus',
      vadEnabled: options.vadEnabled ?? true,
      vadThreshold: options.vadThreshold ?? 0.02,
      silenceTimeoutMs: options.silenceTimeoutMs ?? 3000,
    };
  }

  // ==================== AudioStreamManager 接口实现 ====================

  async enumerateDevices(): Promise<AudioDevice[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter(d => d.kind === 'audioinput')
        .map(d => ({
          deviceId: d.deviceId,
          label: d.label || `麦克风 ${d.deviceId.slice(0, 8)}`,
          kind: 'audioinput' as const,
        }));
    } catch {
      return [];
    }
  }

  /** 开始一次性录音（直到 stopRecording） */
  async startRecording(constraints?: MediaTrackConstraints): Promise<void> {
    if (this.stream) throw new Error('音频设备已在使用中');

    this.status = { state: 'requesting' };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: constraints ?? {
          sampleRate: this.options.sampleRate,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.status = {
        state: 'recording',
        deviceId: this.stream.getAudioTracks()[0]?.getSettings().deviceId ?? 'default',
        durationMs: 0,
      };

      if (this.options.vadEnabled) {
        this._startVAD();
      }
    } catch (err) {
      this.status = { state: 'error', message: (err as Error).message };
      throw err;
    }
  }

  /** 停止录音 */
  async stopRecording(): Promise<Blob> {
    if (!this.stream) throw new Error('未在录音');

    return new Promise((resolve, reject) => {
      const recorder = new MediaRecorder(this.stream!, {
        mimeType: this._getSupportedMimeType(),
      });
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        this._cleanup();
        resolve(new Blob(chunks, { type: recorder.mimeType }));
      };

      recorder.onerror = () => {
        this._cleanup();
        reject(new Error('录音失败'));
      };

      recorder.start();
      // 立即停止，收集已有数据
      setTimeout(() => recorder.stop(), 100);
    });
  }

  /** 开始实时分块音频流 */
  async startStreaming(chunkMs?: number): Promise<void> {
    if (this.stream) throw new Error('音频设备已在使用中');

    this.status = { state: 'requesting' };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.options.sampleRate,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const mimeType = this._getSupportedMimeType();
      this.recorder = new MediaRecorder(this.stream, { mimeType });
      this.sequenceId = 0;

      this.recorder.ondataavailable = async (event) => {
        if (event.data.size === 0) return;

        const buffer = await event.data.arrayBuffer();
        const base64 = this._arrayBufferToBase64(buffer);

        const chunk: AudioChunk = {
          data: base64,
          sampleRate: this.options.sampleRate,
          channels: 1,
          timestamp: Date.now(),
          sequenceId: this.sequenceId++,
        };

        for (const cb of this.chunkCallbacks) {
          try { cb(chunk); } catch { /* ignore */ }
        }
      };

      this.recorder.start(chunkMs ?? this.options.chunkMs);

      this.status = {
        state: 'streaming',
        deviceId: this.stream.getAudioTracks()[0]?.getSettings().deviceId ?? 'default',
      };

      if (this.options.vadEnabled) {
        this._startVAD();
      }
    } catch (err) {
      this.status = { state: 'error', message: (err as Error).message };
      throw err;
    }
  }

  /** 停止实时音频流 */
  stopStreaming(): void {
    if (this.recorder?.state === 'recording') {
      this.recorder.stop();
    }
    this._cleanup();
    this.status = { state: 'inactive' };
  }

  /** 获取当前音量 (0-1) */
  getVolumeLevel(): number {
    if (!this.analyser) return 0;

    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);

    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
    }
    return Math.sqrt(sum / data.length);
  }

  /** 获取当前状态 */
  getStatus(): AudioStatus {
    return { ...this.status };
  }

  /** 检查麦克风可用 */
  async isAvailable(): Promise<boolean> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.some(d => d.kind === 'audioinput' && d.deviceId);
    } catch {
      return false;
    }
  }

  /** 请求权限 */
  async requestPermission(): Promise<boolean> {
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach(t => t.stop());
      return true;
    } catch {
      return false;
    }
  }

  // ==================== 扩展方法 ====================

  /** 订阅音频块 */
  onChunk(callback: AudioChunkCallback): () => void {
    this.chunkCallbacks.add(callback);
    return () => this.chunkCallbacks.delete(callback);
  }

  /** 订阅 VAD 状态 */
  onVADChange(callback: VADCallback): () => void {
    this.vadCallbacks.add(callback);
    return () => this.vadCallbacks.delete(callback);
  }

  /** 是否正在说话（VAD） */
  get speaking(): boolean {
    return this.isSpeaking;
  }

  /** 是否活跃中 */
  get isActive(): boolean {
    return this.stream !== null;
  }

  /** 清理 */
  destroy(): void {
    this.stopStreaming();
    this.chunkCallbacks.clear();
    this.vadCallbacks.clear();
  }

  // ==================== 内部方法 ====================

  private _startVAD(): void {
    if (!this.stream) return;

    this.audioContext = new AudioContext();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);

    const detectLoop = () => {
      const level = this.getVolumeLevel();
      const wasSpeaking = this.isSpeaking;
      this.isSpeaking = level > this.options.vadThreshold;

      if (this.isSpeaking !== wasSpeaking) {
        for (const cb of this.vadCallbacks) {
          try { cb(this.isSpeaking); } catch { /* ignore */ }
        }
      }

      // 静音超时
      if (!this.isSpeaking) {
        if (!this.silenceTimer) {
          this.silenceTimer = setTimeout(() => {
            // 长时间静音，可以触发自动停止
            for (const cb of this.vadCallbacks) {
              try { cb(false); } catch { /* ignore */ }
            }
          }, this.options.silenceTimeoutMs);
        }
      } else {
        if (this.silenceTimer) {
          clearTimeout(this.silenceTimer);
          this.silenceTimer = null;
        }
      }

      this.vadAnimFrame = requestAnimationFrame(detectLoop);
    };

    this.vadAnimFrame = requestAnimationFrame(detectLoop);
  }

  private _getSupportedMimeType(): string {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];
    for (const mime of candidates) {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
    return '';
  }

  private _arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private _cleanup(): void {
    if (this.vadAnimFrame !== null) {
      cancelAnimationFrame(this.vadAnimFrame);
      this.vadAnimFrame = null;
    }
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.analyser?.disconnect();
    this.analyser = null;
    this.audioContext?.close();
    this.audioContext = null;
    this.recorder = null;
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    this.isSpeaking = false;
  }
}
