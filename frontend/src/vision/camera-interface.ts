/**
 * CameraManager 接口定义
 * Phase A Week 4 — 仅类型/接口，Phase B 填实现
 *
 * 实现指南：
 * - 浏览器端：navigator.mediaDevices.getUserMedia()
 * - 桌面端：Electron desktopCapturer / Tauri 插件
 * - 移动端：Capacitor Camera 插件
 */

import type { CameraDevice, CameraStatus } from '../types/device-types.js';

export interface CameraManager {
  /**
   * 枚举可用摄像头设备
   */
  enumerateDevices(): Promise<CameraDevice[]>;

  /**
   * 开启摄像头视频流
   * @param deviceId 目标设备 ID（可选，默认用第一个）
   * @param constraints 视频约束（分辨率、帧率等）
   */
  startStream(
    deviceId?: string,
    constraints?: MediaTrackConstraints
  ): Promise<MediaStream>;

  /**
   * 停止视频流
   */
  stopStream(): void;

  /**
   * 截取当前帧为 base64 JPEG
   * @param quality JPEG 质量 0-1，默认 0.8
   */
  captureFrame(quality?: number): Promise<string>;

  /**
   * 获取当前摄像头状态
   */
  getStatus(): CameraStatus;

  /**
   * 切换摄像头（前置/后置）
   */
  switchCamera(): Promise<void>;

  /**
   * 检查是否有可用的摄像头设备
   */
  isAvailable(): Promise<boolean>;

  /**
   * 请求摄像头权限
   * @returns 是否授权成功
   */
  requestPermission(): Promise<boolean>;
}

/**
 * 帧捕获策略接口
 */
export interface FrameCaptureStrategy {
  /**
   * 策略名称
   */
  readonly name: 'manual' | 'interval' | 'motion';

  /**
   * 开始捕获
   * @param onFrame 每次捕获到帧时的回调
   */
  start(onFrame: (frameBase64: string, timestamp: number) => void): void;

  /**
   * 停止捕获
   */
  stop(): void;

  /**
   * 是否正在捕获
   */
  isRunning(): boolean;
}

/**
 * 手动捕获策略配置
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- 未来扩展用的占位类型
export interface ManualCaptureConfig {}

/**
 * 定时捕获策略配置
 */
export interface IntervalCaptureConfig {
  /** 捕获间隔（毫秒），默认 5000 */
  intervalMs?: number;
}

/**
 * 运动检测捕获策略配置
 */
export interface MotionCaptureConfig {
  /** 像素差异阈值（0-255），默认 30 */
  threshold?: number;
  /** 最小变化面积百分比，默认 5 */
  minChangePercent?: number;
  /** 检测间隔（毫秒），默认 1000 */
  checkIntervalMs?: number;
}
