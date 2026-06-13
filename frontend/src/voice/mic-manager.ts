/**
 * 麦克风管理器
 * 设备枚举/权限/流控制/降噪
 *
 * 浏览器端：navigator.mediaDevices.getUserMedia({ audio: true })
 * 移动端：降级到 NativeAudioBridge（原生麦克风桥）
 * Node端：通过接口定义，具体实现依赖 Electron/Web Audio
 */

import type { AudioDevice, AudioStatus } from '../types/device-types.js';
import { NativeAudioBridge } from './native-audio-bridge.js';

export interface MicConstraints {
  deviceId?: string;
  sampleRate?: number;      // 默认 16000
  channelCount?: number;    // 默认 1 (单声道)
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
}

export interface VolumeCallback {
  (level: number): void;    // 0-1 RMS 音量
}

export class MicrophoneManager {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animFrameId: number | null = null;
  private status: AudioStatus = { state: 'inactive' };
  private volumeCallbacks: Set<VolumeCallback> = new Set();
  private nativeBridge: NativeAudioBridge | null = null;

  /** 枚举可用麦克风设备 */
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

  /** 请求麦克风权限（通过获取一次流来触发权限弹窗） */
  async requestPermission(): Promise<boolean> {
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach(t => t.stop());
      return true;
    } catch {
      return false;
    }
  }

  /** 检查麦克风是否可用 */
  async isAvailable(): Promise<boolean> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.some(d => d.kind === 'audioinput' && d.deviceId);
    } catch {
      return false;
    }
  }

  /** 开始录音 */
  async startRecording(constraints?: MicConstraints): Promise<void> {
    if (this.stream || this.nativeBridge?.active) {
      throw new Error('麦克风已在使用中');
    }

    this.status = { state: 'requesting' };

    try {
      // 尝试浏览器 API
      const mediaConstraints: MediaStreamConstraints = {
        audio: {
          deviceId: constraints?.deviceId ? { exact: constraints.deviceId } : undefined,
          sampleRate: constraints?.sampleRate ?? 16000,
          channelCount: constraints?.channelCount ?? 1,
          echoCancellation: constraints?.echoCancellation ?? true,
          noiseSuppression: constraints?.noiseSuppression ?? true,
          autoGainControl: constraints?.autoGainControl ?? true,
        },
      };

      this.stream = await navigator.mediaDevices.getUserMedia(mediaConstraints);

      // 设置音量分析
      this._setupAnalyser();

      const track = this.stream.getAudioTracks()[0];
      this.status = {
        state: 'recording',
        deviceId: track?.getSettings().deviceId ?? 'default',
        durationMs: 0,
      };
    } catch (err) {
      // 浏览器 API 失败，降级到原生桥
      console.log('[Mic] 浏览器 API 不可用，尝试原生麦克风桥:', (err as Error).message);

      if (NativeAudioBridge.isNativePlatform()) {
        try {
          this.nativeBridge = new NativeAudioBridge();
          await this.nativeBridge.start();

          // 原生模式下通过回调获取音量
          this.nativeBridge.onVolumeChange((level) => {
            for (const cb of this.volumeCallbacks) {
              try { cb(level); } catch { /* ignore */ }
            }
          });

          this.status = {
            state: 'recording',
            deviceId: 'native',
            durationMs: 0,
          };
          return;
        } catch (nativeErr) {
          this.status = { state: 'error', message: `原生麦克风也失败: ${(nativeErr as Error).message}` };
          throw nativeErr;
        }
      }

      this.status = { state: 'error', message: (err as Error).message };
      throw err;
    }
  }

  /** 停止录音 */
  stopRecording(): void {
    // 停止原生桥
    if (this.nativeBridge) {
      this.nativeBridge.stop();
      this.nativeBridge.destroy();
      this.nativeBridge = null;
    }

    // 停止浏览器流
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }

    this._teardownAnalyser();
    this.status = { state: 'inactive' };
  }

  /** 获取当前状态 */
  getStatus(): AudioStatus {
    return { ...this.status };
  }

  /** 获取当前音量级别 (0-1) */
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

  /** 订阅音量变化 */
  onVolumeChange(callback: VolumeCallback): () => void {
    this.volumeCallbacks.add(callback);
    return () => this.volumeCallbacks.delete(callback);
  }

  /** 获取当前 MediaStream（供 MediaRecorder 等使用） */
  getStream(): MediaStream | null {
    return this.stream;
  }

  /** 是否正在录音 */
  get isActive(): boolean {
    return (this.stream !== null || this.nativeBridge?.active === true) && this.status.state === 'recording';
  }

  /** 清理资源 */
  destroy(): void {
    this.stopRecording();
    this.volumeCallbacks.clear();
    this.nativeBridge?.destroy();
    this.nativeBridge = null;
  }

  // ==================== 内部方法 ====================

  private _setupAnalyser(): void {
    if (!this.stream) return;

    this.audioContext = new AudioContext();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);

    // 音量监控循环
    const monitorLoop = () => {
      const level = this.getVolumeLevel();
      for (const cb of this.volumeCallbacks) {
        try { cb(level); } catch { /* ignore */ }
      }
      this.animFrameId = requestAnimationFrame(monitorLoop);
    };
    this.animFrameId = requestAnimationFrame(monitorLoop);
  }

  private _teardownAnalyser(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.analyser?.disconnect();
    this.analyser = null;
    this.audioContext?.close();
    this.audioContext = null;
  }
}
