/**
 * 摄像头管理器实现
 * 浏览器端：navigator.mediaDevices.getUserMedia()
 * 移动端：降级到 NativeCameraBridge（原生摄像头桥）
 * 桌面端：Electron desktopCapturer
 */

import type { CameraDevice, CameraStatus } from '../types/device-types.js';
import { NativeCameraBridge } from './native-camera-bridge.js';

export interface CameraOptions {
  facing?: 'user' | 'environment';  // 前置/后置
  width?: number;
  height?: number;
  frameRate?: number;
}

export class CameraManager {
  private stream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private status: CameraStatus = { state: 'inactive' };
  private currentDeviceId: string | null = null;
  private availableDevices: CameraDevice[] = [];
  private nativeBridge: NativeCameraBridge | null = null;
  private latestNativeFrame: string | null = null;

  /** 枚举可用摄像头设备 */
  async enumerateDevices(): Promise<CameraDevice[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.availableDevices = devices
        .filter(d => d.kind === 'videoinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `摄像头 ${i + 1}`,
          kind: 'videoinput' as const,
          facing: d.label?.toLowerCase().includes('back') ? 'environment' as const : 'user' as const,
        }));
      return this.availableDevices;
    } catch {
      return [];
    }
  }

  /** 开启视频流 */
  async startStream(deviceId?: string, constraints?: MediaTrackConstraints): Promise<MediaStream> {
    if (this.stream) {
      throw new Error('摄像头已在使用中');
    }

    this.status = { state: 'requesting' };

    try {
      const videoConstraints: MediaTrackConstraints = constraints ?? {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 15 },
      };

      this.stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });

      const track = this.stream.getVideoTracks()[0];
      const settings = track?.getSettings();
      this.currentDeviceId = settings?.deviceId ?? deviceId ?? 'default';

      this.status = {
        state: 'active',
        deviceId: this.currentDeviceId,
        resolution: {
          width: settings?.width ?? 640,
          height: settings?.height ?? 480,
        },
      };

      // 创建隐藏 video 元素用于帧捕获
      this._setupCaptureElements();

      return this.stream;
    } catch (err) {
      // 浏览器 API 失败，降级到原生桥
      console.log('[Camera] 浏览器 API 不可用，尝试原生摄像头桥:', (err as Error).message);

      if (NativeCameraBridge.isNativePlatform()) {
        try {
          this.nativeBridge = new NativeCameraBridge();
          const facing = constraints?.facingMode === 'user' ? 'user' : 'environment';
          await this.nativeBridge.start(facing);

          // 缓存最新帧
          this.nativeBridge.onFrame((frame) => {
            this.latestNativeFrame = frame;
          });

          this.status = {
            state: 'active',
            deviceId: 'native',
            resolution: { width: 640, height: 480 },
          };

          // 返回空的 MediaStream（兼容现有代码）
          return new MediaStream();
        } catch (nativeErr) {
          this.status = { state: 'error', message: `原生摄像头也失败: ${(nativeErr as Error).message}` };
          throw nativeErr;
        }
      }

      this.status = { state: 'error', message: (err as Error).message };
      throw err;
    }
  }

  /** 停止视频流 */
  stopStream(): void {
    // 停止原生桥
    if (this.nativeBridge) {
      this.nativeBridge.stop();
      this.nativeBridge.destroy();
      this.nativeBridge = null;
      this.latestNativeFrame = null;
    }

    // 停止浏览器流
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }

    this._teardownCaptureElements();
    this.status = { state: 'inactive' };
    this.currentDeviceId = null;
  }

  /** 截取当前帧为 base64 JPEG */
  async captureFrame(quality = 0.8): Promise<string> {
    // 原生桥模式：直接返回缓存的帧
    if (this.nativeBridge) {
      const frame = this.nativeBridge.captureFrame();
      if (frame) return frame;
      throw new Error('原生摄像头帧未就绪');
    }

    if (!this.stream || this.status.state !== 'active') {
      throw new Error('摄像头未启动');
    }

    return new Promise((resolve, reject) => {
      if (!this.videoElement || !this.canvas || !this.ctx) {
        reject(new Error('捕获元素未初始化'));
        return;
      }

      const video = this.videoElement;
      const canvas = this.canvas;
      const ctx = this.ctx;

      if (video.readyState < 2) {
        // 等待视频就绪
        video.addEventListener('loadeddata', () => {
          this._doCapture(video, canvas, ctx, quality, resolve, reject);
        }, { once: true });
      } else {
        this._doCapture(video, canvas, ctx, quality, resolve, reject);
      }
    });
  }

  /** 获取当前状态 */
  getStatus(): CameraStatus {
    return { ...this.status };
  }

  /** 切换摄像头 */
  async switchCamera(): Promise<void> {
    if (this.availableDevices.length < 2) {
      // 先枚举
      await this.enumerateDevices();
    }

    if (this.availableDevices.length < 2) {
      throw new Error('只有一个摄像头设备');
    }

    const currentIndex = this.availableDevices.findIndex(
      d => d.deviceId === this.currentDeviceId,
    );
    const nextIndex = (currentIndex + 1) % this.availableDevices.length;
    const nextDevice = this.availableDevices[nextIndex];

    this.stopStream();
    await this.startStream(nextDevice.deviceId);
  }

  /** 检查摄像头可用 */
  async isAvailable(): Promise<boolean> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.some(d => d.kind === 'videoinput' && d.deviceId);
    } catch {
      return false;
    }
  }

  /** 请求摄像头权限 */
  async requestPermission(): Promise<boolean> {
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
      tempStream.getTracks().forEach(t => t.stop());
      return true;
    } catch {
      return false;
    }
  }

  /** 获取当前 MediaStream */
  getStream(): MediaStream | null {
    return this.stream;
  }

  /** 是否活跃 */
  get isActive(): boolean {
    return (this.stream !== null || this.nativeBridge?.active === true) && this.status.state === 'active';
  }

  /** 清理 */
  destroy(): void {
    this.stopStream();
    this.availableDevices = [];
  }

  // ==================== 内部方法 ====================

  private _setupCaptureElements(): void {
    if (typeof document === 'undefined') {
      // Node.js 环境，跳过 DOM 操作
      return;
    }

    this.videoElement = document.createElement('video');
    this.videoElement.autoplay = true;
    this.videoElement.muted = true;
    this.videoElement.playsInline = true;
    this.videoElement.srcObject = this.stream;

    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
  }

  private _teardownCaptureElements(): void {
    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }
    this.canvas = null;
    this.ctx = null;
  }

  private _doCapture(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    quality: number,
    resolve: (value: string) => void,
    reject: (reason: Error) => void,
  ): void {
    try {
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      // 返回纯 base64 部分
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    } catch (err) {
      reject(new Error(`帧捕获失败: ${(err as Error).message}`));
    }
  }
}
