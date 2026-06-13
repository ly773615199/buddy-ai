/**
 * AudioStreamManager 接口定义
 * Phase A Week 4 — 仅类型/接口，Phase B 填实现
 *
 * 实现指南：
 * - 浏览器端：navigator.mediaDevices.getUserMedia() + MediaRecorder / AudioWorklet
 * - 桌面端：Node.js naudiodon / Web Audio API (Electron)
 * - 离线方案：本地 Whisper.cpp
 */

import type { AudioDevice, AudioStatus, AudioChunk } from '../types/device-types.js';

export interface AudioStreamManager {
  /**
   * 枚举可用麦克风设备
   */
  enumerateDevices(): Promise<AudioDevice[]>;

  /**
   * 开始录音（一次性，直到 stopRecording）
   * @param constraints 音频约束
   */
  startRecording(constraints?: MediaTrackConstraints): Promise<void>;

  /**
   * 停止录音并返回录音数据
   */
  stopRecording(): Promise<Blob>;

  /**
   * 开始实时音频流（分块回调）
   * @param chunkMs 每个块的时长（毫秒），默认 3000
   */
  startStreaming(chunkMs?: number): Promise<void>;

  /**
   * 停止实时音频流
   */
  stopStreaming(): void;

  /**
   * 获取当前音量级别（RMS）
   * 范围 0-1
   */
  getVolumeLevel(): number;

  /**
   * 获取当前麦克风状态
   */
  getStatus(): AudioStatus;

  /**
   * 检查是否有可用的麦克风设备
   */
  isAvailable(): Promise<boolean>;

  /**
   * 请求麦克风权限
   */
  requestPermission(): Promise<boolean>;

  /**
   * 设置音频块回调（startStreaming 时触发）
   */
  onChunk(callback: (chunk: AudioChunk) => void): void;

  /**
   * 移除音频块回调
   */
  offChunk(callback: (chunk: AudioChunk) => void): void;
}

/**
 * STT 适配层接口
 * 多后端统一接口
 */
export interface STTAdapter {
  /**
   * 后端名称
   */
  readonly name: string;

  /**
   * 识别一段音频
   * @param audioBlob 音频数据
   * @param language 语言代码，如 'zh-CN'
   */
  transcribe(audioBlob: Blob, language?: string): Promise<STTResult>;

  /**
   * 是否支持流式识别
   */
  supportsStreaming(): boolean;

  /**
   * 流式识别（如果支持）
   * @param onPartial 部分结果回调
   */
  startStreamingRecognition?(
    onPartial: (text: string, isFinal: boolean) => void,
    language?: string
  ): Promise<void>;

  stopStreamingRecognition?(): Promise<void>;
}

export interface STTResult {
  text: string;
  confidence: number;
  language?: string;
  durationMs?: number;
}

/**
 * 唤醒词检测器接口
 */
export interface WakeWordDetector {
  /**
   * 初始化检测器
   * @param keywords 要检测的唤醒词列表
   */
  init(keywords: string[]): Promise<void>;

  /**
   * 开始监听
   * @param onDetected 检测到唤醒词时的回调
   */
  start(onDetected: (word: string, confidence: number) => void): void;

  /**
   * 停止监听
   */
  stop(): void;

  /**
   * 是否正在监听
   */
  isListening(): boolean;

  /**
   * 释放资源
   */
  dispose(): void;
}
