/**
 * 感知层统一类型定义
 * Phase A Week 4 — 接口地基，Phase B/C 填实现
 */

// ==================== 感知事件总线 ====================

export type PerceptionSourceType =
  | 'image'       // 用户发的图片
  | 'camera'      // 摄像头实时帧
  | 'screen'      // 屏幕截图
  | 'mic'         // 麦克风
  | 'file'        // 文件录音
  | 'stream'      // 实时音频流
  | 'gps'         // GPS 定位
  | 'motion'      // 加速度/陀螺仪
  | 'light'       // 环境光
  | 'network'     // 网络状态
  | 'battery'     // 电池
  | 'touch'       // 触摸交互
  | 'git'         // Git 状态变更
  | 'fs'          // 文件系统变更
  | 'process'     // 进程状态
  | 'terminal';   // 终端输出

export type PerceptionCategory = 'vision' | 'audio' | 'sensor' | 'interaction' | 'environment';

export interface PerceptionEvent {
  id: string;
  category: PerceptionCategory;
  source: PerceptionSourceType;
  timestamp: number;
  data: unknown;
  metadata?: Record<string, unknown>;
}

// ==================== 视觉事件 ====================

export type VisionEventData =
  | { subtype: 'image_analyzed'; description: string; objects?: string[]; text?: string }
  | { subtype: 'camera_frame'; frameBase64: string; width: number; height: number }
  | { subtype: 'face_detected'; count: number; expressions?: string[] }
  | { subtype: 'scene_recognized'; scene: string; confidence: number }
  | { subtype: 'screen_captured'; windowTitle?: string; app?: string };

// ==================== 音频事件 ====================

export type AudioEventData =
  | { subtype: 'stt_result'; text: string; confidence: number; language?: string }
  | { subtype: 'wakeword'; word: string; confidence: number }
  | { subtype: 'sound_event'; event: string; confidence: number }
  | { subtype: 'voice_emotion'; emotion: string; confidence: number }
  | { subtype: 'audio_chunk'; data: string; sampleRate: number; channels: number }
  | { subtype: 'volume_level'; rms: number; peak: number };

// ==================== 传感器事件 ====================

export type SensorEventData =
  | { subtype: 'location'; lat: number; lng: number; accuracy: number; altitude?: number }
  | { subtype: 'motion'; state: 'stationary' | 'walking' | 'running' | 'driving'; acceleration?: { x: number; y: number; z: number } }
  | { subtype: 'orientation'; alpha: number; beta: number; gamma: number }
  | { subtype: 'ambient_light'; lux: number }
  | { subtype: 'network'; type: 'wifi' | 'cellular' | 'offline'; downlink?: number; rtt?: number }
  | { subtype: 'battery'; level: number; charging: boolean };

// ==================== 交互事件 ====================

export type InteractionEventData =
  | { subtype: 'pet' }
  | { subtype: 'tap' }
  | { subtype: 'hold'; durationMs: number }
  | { subtype: 'drag'; deltaX: number; deltaY: number }
  | { subtype: 'rapid_tap'; count: number };

// ==================== 物理上下文（聚合） ====================

export interface PhysicalContext {
  location: { lat: number; lng: number; accuracy: number } | null;
  motion: 'stationary' | 'walking' | 'running' | 'driving' | 'unknown';
  orientation: { alpha: number; beta: number; gamma: number } | null;
  ambientLight: number | null;        // lux
  noiseLevel: number | null;          // dB
  networkType: 'wifi' | 'cellular' | 'offline' | 'unknown';
  batteryLevel: number | null;        // 0-1
  batteryCharging: boolean | null;
  timestamp: number;
}

export const DEFAULT_PHYSICAL_CONTEXT: PhysicalContext = {
  location: null,
  motion: 'unknown',
  orientation: null,
  ambientLight: null,
  noiseLevel: null,
  networkType: 'unknown',
  batteryLevel: null,
  batteryCharging: null,
  timestamp: 0,
};

// ==================== 设备信息 ====================

export interface CameraDevice {
  deviceId: string;
  label: string;
  kind: 'videoinput';
  facing?: 'user' | 'environment';
}

export interface AudioDevice {
  deviceId: string;
  label: string;
  kind: 'audioinput';
}

// ==================== 状态类型 ====================

export type CameraStatus =
  | { state: 'inactive' }
  | { state: 'requesting' }
  | { state: 'active'; deviceId: string; resolution: { width: number; height: number } }
  | { state: 'error'; message: string };

export type AudioStatus =
  | { state: 'inactive' }
  | { state: 'requesting' }
  | { state: 'recording'; deviceId: string; durationMs: number }
  | { state: 'streaming'; deviceId: string }
  | { state: 'error'; message: string };

export interface AudioChunk {
  data: string;        // base64 PCM
  sampleRate: number;  // e.g. 16000
  channels: number;    // e.g. 1
  timestamp: number;
  sequenceId: number;
}

// ==================== 隐私权限 ====================

export type PermissionType = 'camera' | 'microphone' | 'location' | 'motion' | 'ambient_light' | 'screen';

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'revoked';

export interface PermissionRecord {
  type: PermissionType;
  state: PermissionState;
  grantedAt?: number;
  revokedAt?: number;
}
