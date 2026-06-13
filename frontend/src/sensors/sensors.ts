/**
 * 统一传感器管理器
 * 聚合 Location / Motion / Environment → 统一接口
 * 为 PhysicalContextFusion 提供数据源
 */

import type { GeoPosition, Geofence } from './location.js';
import type { MotionState, MotionData } from './motion.js';
import type { EnvironmentData } from './environment.js';

// ── 类型定义 ──

export interface SensorStatus {
  location: { available: boolean; active: boolean; accuracy: string | null };
  motion: { available: boolean; active: boolean };
  environment: { available: boolean; active: boolean };
}

export interface SensorSnapshot {
  position: GeoPosition | null;
  motion: MotionState;
  motionData: MotionData | null;
  environment: EnvironmentData | null;
  timestamp: number;
}

export interface SensorAlert {
  type: 'geofence_enter' | 'geofence_exit' | 'fall_detected' | 'low_battery' | 'offline' | 'low_light';
  message: string;
  severity: 'info' | 'warning' | 'critical';
  data?: unknown;
  timestamp: number;
}

export type SensorAlertCallback = (alert: SensorAlert) => void;

// ── 主类 ──

export class SensorManager {
  private locationWatchId: number | null = null;
  private motionListener: ((e: DeviceMotionEvent) => void) | null = null;
  private isRunning = false;
  private snapshot: SensorSnapshot;
  private alertCallbacks: SensorAlertCallback[] = [];
  private geoFences: Geofence[] = [];
  private lastPosition: GeoPosition | null = null;

  // 源端节流：motion 传感器最小上报间隔（ms）
  private readonly MOTION_MIN_INTERVAL_MS: number;
  private lastMotionTimestamp = 0;

  constructor(options?: { motionMinIntervalMs?: number }) {
    this.MOTION_MIN_INTERVAL_MS = options?.motionMinIntervalMs ?? 500;
    this.snapshot = {
      position: null,
      motion: 'stationary',
      motionData: null,
      environment: null,
      timestamp: Date.now(),
    };
  }

  // ── 位置感知 ──

  /** 获取当前位置 */
  async getPosition(): Promise<GeoPosition> {
    return new Promise((resolve, reject) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        reject(new Error('Geolocation API 不可用'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const position: GeoPosition = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            altitude: pos.coords.altitude ?? undefined,
            speed: pos.coords.speed ?? undefined,
            timestamp: pos.timestamp,
          };
          this.snapshot.position = position;
          this.lastPosition = position;
          this.checkGeoFences(position);
          resolve(position);
        },
        (err) => reject(new Error(`定位失败: ${err.message}`)),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  /** 开始持续定位 */
  startLocationWatch(): void {
    if (typeof navigator === 'undefined' || !navigator.geolocation || this.locationWatchId !== null) {
      return;
    }

    this.locationWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const position: GeoPosition = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude ?? undefined,
          speed: pos.coords.speed ?? undefined,
          timestamp: pos.timestamp,
        };
        this.snapshot.position = position;
        this.checkGeoFences(position);
        this.lastPosition = position;
      },
      () => {},
      { enableHighAccuracy: false, timeout: 30000, maximumAge: 60000 }
    );
  }

  /** 停止持续定位 */
  stopLocationWatch(): void {
    if (this.locationWatchId !== null && typeof navigator !== 'undefined') {
      navigator.geolocation.clearWatch(this.locationWatchId);
      this.locationWatchId = null;
    }
  }

  /** 添加地理围栏 */
  addGeoFence(zone: Geofence): void {
    this.geoFences.push(zone);
  }

  /** 移除地理围栏 */
  removeGeoFence(name: string): void {
    this.geoFences = this.geoFences.filter(z => z.name !== name);
  }

  // ── 运动感知 ──

  /** 开始运动监听 */
  startMotionListening(): void {
    if (typeof window === 'undefined' || this.motionListener) return;

    this.motionListener = (event: DeviceMotionEvent) => {
      const acc = event.accelerationIncludingGravity;
      if (!acc || acc.x === null || acc.y === null || acc.z === null) return;

      const now = Date.now();
      const magnitude = Math.sqrt(acc.x ** 2 + acc.y ** 2 + acc.z ** 2);

      // 跌倒检测：不受节流限制，始终检测
      if (magnitude > 25) {
        this.emitAlert({
          type: 'fall_detected',
          message: '检测到可能的跌倒事件',
          severity: 'critical',
          data: { magnitude },
          timestamp: now,
        });
      }

      // 源端节流：低于最小间隔直接跳过
      if (now - this.lastMotionTimestamp < this.MOTION_MIN_INTERVAL_MS) return;
      this.lastMotionTimestamp = now;

      const motionData: MotionData = {
        state: this.snapshot.motion,
        acceleration: { x: acc.x, y: acc.y, z: acc.z },
        rotation: {
          alpha: event.rotationRate?.alpha || 0,
          beta: event.rotationRate?.beta || 0,
          gamma: event.rotationRate?.gamma || 0,
        },
        magnitude,
        timestamp: now,
      };

      this.snapshot.motionData = motionData;

      // 简单步态检测
      if (magnitude > 15) {
        this.snapshot.motion = 'running';
      } else if (magnitude > 10.5) {
        this.snapshot.motion = 'walking';
      } else {
        this.snapshot.motion = 'stationary';
      }
    };

    window.addEventListener('devicemotion', this.motionListener);
  }

  /** 停止运动监听 */
  stopMotionListening(): void {
    if (typeof window !== 'undefined' && this.motionListener) {
      window.removeEventListener('devicemotion', this.motionListener);
      this.motionListener = null;
    }
  }

  // ── 环境感知 ──

  /** 获取当前环境数据 */
  getEnvironment(): EnvironmentData {
    const netInfo = this.getNetworkInfo();
    const data: EnvironmentData = {
      ambientLight: null,
      noiseLevel: null,
      networkType: netInfo.type,
      networkDownlink: netInfo.downlink,
      networkRtt: netInfo.rtt,
      batteryLevel: null,
      batteryCharging: null,
      timestamp: Date.now(),
    };

    // 电池 API
    if (typeof navigator !== 'undefined' && 'getBattery' in navigator) {
      navigator.getBattery?.().then((battery) => {
        data.batteryLevel = battery.level;
        if (battery.level < 0.15) {
          this.emitAlert({
            type: 'low_battery',
            message: `电量低：${Math.round(battery.level * 100)}%`,
            severity: 'warning',
            timestamp: Date.now(),
          });
        }
      }).catch(() => {});
    }

    this.snapshot.environment = data;
    return data;
  }

  // ── 统一接口 ──

  /** 启动所有传感器 */
  startAll(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    try { this.startLocationWatch(); } catch { /* 非浏览器环境 */ }
    try { this.startMotionListening(); } catch { /* 非移动设备 */ }
    this.getEnvironment();
  }

  /** 停止所有传感器 */
  stopAll(): void {
    this.stopLocationWatch();
    this.stopMotionListening();
    this.isRunning = false;
  }

  /** 获取传感器状态 */
  getStatus(): SensorStatus {
    return {
      location: {
        available: typeof navigator !== 'undefined' && !!navigator.geolocation,
        active: this.locationWatchId !== null,
        accuracy: this.snapshot.position ? `${Math.round(this.snapshot.position.accuracy)}m` : null,
      },
      motion: {
        available: typeof window !== 'undefined' && 'DeviceMotionEvent' in window,
        active: this.motionListener !== null,
      },
      environment: {
        available: typeof navigator !== 'undefined',
        active: this.isRunning,
      },
    };
  }

  /** 获取快照 */
  getSnapshot(): SensorSnapshot {
    this.snapshot.timestamp = Date.now();
    return { ...this.snapshot };
  }

  /** 注册告警回调 */
  onAlert(callback: SensorAlertCallback): () => void {
    this.alertCallbacks.push(callback);
    return () => {
      this.alertCallbacks = this.alertCallbacks.filter(cb => cb !== callback);
    };
  }

  /** 是否正在运行 */
  isActive(): boolean {
    return this.isRunning;
  }

  /** 释放资源 */
  dispose(): void {
    this.stopAll();
    this.alertCallbacks = [];
    this.geoFences = [];
  }

  // ── 私有方法 ──

  private getNetworkInfo(): { type: 'wifi' | 'cellular' | 'offline' | 'unknown'; downlink: number | null; rtt: number | null } {
    if (typeof navigator === 'undefined') return { type: 'unknown', downlink: null, rtt: null };

    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!connection) return { type: 'unknown', downlink: null, rtt: null };

    const rawType = connection.type || connection.effectiveType;
    let type: 'wifi' | 'cellular' | 'offline' | 'unknown' = 'unknown';
    if (rawType === 'wifi') type = 'wifi';
    else if (rawType === 'cellular' || ['2g', '3g', '4g', '5g'].includes(rawType)) type = 'cellular';
    else if (rawType === 'none') type = 'offline';

    return {
      type,
      downlink: connection.downlink ?? null,
      rtt: connection.rtt ?? null,
    };
  }

  private checkGeoFences(position: GeoPosition): void {
    for (const fence of this.geoFences) {
      const distance = this.calculateDistance(
        position.lat, position.lng,
        fence.lat, fence.lng
      );

      const isInside = distance <= fence.radius;
      const wasInside = this.lastPosition
        ? this.calculateDistance(this.lastPosition.lat, this.lastPosition.lng, fence.lat, fence.lng) <= fence.radius
        : !isInside;

      if (isInside && !wasInside) {
        this.emitAlert({
          type: 'geofence_enter',
          message: `进入区域：${fence.name}`,
          severity: 'info',
          data: fence,
          timestamp: Date.now(),
        });
      } else if (!isInside && wasInside) {
        this.emitAlert({
          type: 'geofence_exit',
          message: `离开区域：${fence.name}`,
          severity: 'info',
          data: fence,
          timestamp: Date.now(),
        });
      }
    }
  }

  /** Haversine 公式计算两点距离（米） */
  private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private emitAlert(alert: SensorAlert): void {
    for (const cb of this.alertCallbacks) {
      try { cb(alert); } catch { /* 忽略回调异常 */ }
    }
  }
}
