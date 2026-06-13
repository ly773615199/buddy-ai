/**
 * 共享设备/传感器类型定义
 * 从后端 src/perception/types.ts 提取，供前端视觉/语音/传感器模块使用
 */

// ==================== 物理上下文 ====================

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
  sequenceId?: number;
}
