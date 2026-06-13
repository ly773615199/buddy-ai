/**
 * SensorManager 接口定义
 * Phase A Week 4 — 仅类型/接口，Phase B/C 填实现
 *
 * 实现指南：
 * - 浏览器端：Geolocation API / DeviceMotion API / Ambient Light API / Network Information API
 * - 移动端：Capacitor Geolocation / Motion 插件
 * - IoT/远期：蓝牙 BLE 传感器
 */

import type { PhysicalContext } from '../types/device-types.js';

export interface SensorManager {
  // ==================== 位置 ====================

  /**
   * 获取当前位置（一次性）
   */
  getLocation(): Promise<GeoPosition>;

  /**
   * 持续追踪位置变化
   * @returns 取消订阅函数
   */
  watchLocation(onChange: (pos: GeoPosition) => void): () => void;

  /**
   * 检查位置权限
   */
  hasLocationPermission(): Promise<boolean>;

  // ==================== 运动 ====================

  /**
   * 获取运动状态变化（持续监听）
   * @returns 取消订阅函数
   */
  watchMotion(onChange: (data: MotionData) => void): () => void;

  /**
   * 检查运动传感器是否可用
   */
  isMotionAvailable(): boolean;

  // ==================== 环境 ====================

  /**
   * 获取环境光亮度（lux）
   * @returns 取消订阅函数
   */
  watchAmbientLight(onChange: (lux: number) => void): () => void;

  /**
   * 获取当前网络信息
   */
  getNetworkInfo(): NetworkInfo;

  /**
   * 获取电池状态
   */
  getBatteryInfo(): Promise<BatteryInfo>;

  // ==================== 聚合 ====================

  /**
   * 获取当前物理上下文（聚合所有传感器）
   */
  getPhysicalContext(): PhysicalContext;

  /**
   * 持续更新物理上下文
   * @param intervalMs 刷新间隔，默认 30000
   * @returns 取消订阅函数
   */
  watchPhysicalContext(
    onChange: (ctx: PhysicalContext) => void,
    intervalMs?: number
  ): () => void;
}

// ==================== 数据类型 ====================

export interface GeoPosition {
  lat: number;
  lng: number;
  accuracy: number;      // 米
  altitude?: number;
  altitudeAccuracy?: number;
  heading?: number;
  speed?: number;
  timestamp: number;
}

export interface MotionData {
  state: 'stationary' | 'walking' | 'running' | 'driving' | 'unknown';
  acceleration: {
    x: number;  // m/s²
    y: number;
    z: number;
  };
  rotationRate?: {
    alpha: number;  // deg/s
    beta: number;
    gamma: number;
  };
  timestamp: number;
}

export interface NetworkInfo {
  type: 'wifi' | 'cellular' | 'offline' | 'unknown';
  downlink?: number;     // Mbps
  rtt?: number;          // ms
  saveData?: boolean;
}

export interface BatteryInfo {
  level: number;         // 0-1
  charging: boolean;
  chargingTime?: number; // 秒
  dischargingTime?: number;
}

// ==================== 地理围栏 ====================

export interface GeoFence {
  id: string;
  name: string;          // "公司" / "家"
  lat: number;
  lng: number;
  radiusMeters: number;
  onEnter?: () => void;
  onExit?: () => void;
}

export interface GeoFenceManager {
  addFence(fence: GeoFence): void;
  removeFence(id: string): void;
  getFences(): GeoFence[];
  getCurrentFences(): GeoFence[];
}
