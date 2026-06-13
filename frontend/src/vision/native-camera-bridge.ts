/**
 * 原生摄像头桥
 *
 * 将 Capacitor 原生摄像头的视频帧 JPEG 推送给 WebView
 * 供现有 camera.ts / face-detect.ts / scene-analyze.ts / ocr.ts 使用
 *
 * 降级策略：浏览器 getUserMedia 可用时走原生 API，不可用时降级到此桥
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

// ── 原生插件接口 ──

interface NativeCameraPlugin {
  startCamera(options?: { facing?: string; intervalMs?: number }): Promise<{ status: string; facing: string }>;
  stopCamera(): Promise<{ status: string }>;
  switchCamera(options?: { facing?: string }): Promise<{ status: string; facing: string }>;
  addListener(event: string, callback: (data: unknown) => void): Promise<PluginListenerHandle>;
}

interface PluginListenerHandle {
  remove(): Promise<void>;
}

export interface CameraFrameData {
  /** base64 编码的 JPEG */
  frame: string;
  /** 图片宽度 */
  width: number;
  /** 图片高度 */
  height: number;
  /** 时间戳 ms */
  timestamp: number;
}

// ── 延迟注册 ──

let _nativeCamera: NativeCameraPlugin | null = null;

function getNativeCamera(): NativeCameraPlugin | null {
  if (_nativeCamera) return _nativeCamera;
  if (!Capacitor.isNativePlatform()) return null;
  try {
    _nativeCamera = registerPlugin<NativeCameraPlugin>('NativeCamera');
    return _nativeCamera;
  } catch {
    return null;
  }
}

// ── 主类 ──

export class NativeCameraBridge {
  private listenerHandle: PluginListenerHandle | null = null;
  private isRunning = false;
  private latestFrame: string | null = null;
  private latestFrameTimestamp = 0;
  private currentFacing: 'user' | 'environment' = 'environment';

  // 帧回调
  private frameCallbacks: Set<(frame: string, timestamp: number) => void> = new Set();

  /**
   * 检测是否在原生平台
   */
  static isNativePlatform(): boolean {
    return Capacitor.isNativePlatform();
  }

  /**
   * 检测是否需要原生模式
   */
  static async needsNativeMode(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(t => t.stop());
      return false;
    } catch {
      return true;
    }
  }

  /**
   * 启动原生摄像头
   * @param facing 前置/后置
   * @param intervalMs 帧间隔（毫秒），默认 200ms（5fps）
   */
  async start(
    facing: 'user' | 'environment' = 'environment',
    intervalMs = 200
  ): Promise<void> {
    const native = getNativeCamera();
    if (!native) {
      throw new Error('NativeCamera 插件不可用（非原生平台）');
    }

    if (this.isRunning) return;

    // 监听原生层推送的视频帧
    this.listenerHandle = await native.addListener('cameraFrame', (data) => {
      this.handleNativeFrame(data as CameraFrameData);
    });

    await native.startCamera({ facing, intervalMs });
    this.isRunning = true;
    this.currentFacing = facing;
  }

  /**
   * 停止原生摄像头
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    this.latestFrame = null;

    const native = getNativeCamera();
    if (native) {
      await native.stopCamera();
    }

    await this.listenerHandle?.remove();
    this.listenerHandle = null;
  }

  /**
   * 切换前后摄像头
   */
  async switchCamera(): Promise<void> {
    const native = getNativeCamera();
    if (!native) return;

    const newFacing = this.currentFacing === 'user' ? 'environment' : 'user';
    const result = await native.switchCamera({ facing: newFacing });
    this.currentFacing = result.facing as 'user' | 'environment';
  }

  /**
   * 截取当前帧（base64 JPEG）
   */
  captureFrame(): string | null {
    return this.latestFrame;
  }

  /**
   * 获取当前帧的最新时间戳
   */
  getLatestTimestamp(): number {
    return this.latestFrameTimestamp;
  }

  /**
   * 订阅新帧
   */
  onFrame(callback: (frame: string, timestamp: number) => void): () => void {
    this.frameCallbacks.add(callback);
    return () => this.frameCallbacks.delete(callback);
  }

  /**
   * 当前朝向
   */
  get facing(): 'user' | 'environment' {
    return this.currentFacing;
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
    this.frameCallbacks.clear();
  }

  // ── 内部方法 ──

  /**
   * 处理原生视频帧
   */
  private handleNativeFrame(data: CameraFrameData): void {
    if (!this.isRunning) return;

    this.latestFrame = data.frame;
    this.latestFrameTimestamp = data.timestamp;

    // 通知帧回调
    for (const cb of this.frameCallbacks) {
      try { cb(data.frame, data.timestamp); } catch { /* ignore */ }
    }
  }
}
