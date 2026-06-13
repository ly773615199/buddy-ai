/**
 * GPS 定位 + 地理围栏
 * 浏览器端：Geolocation API
 */

export interface GeoPosition {
  lat: number;
  lng: number;
  accuracy: number;   // 米
  altitude?: number;
  speed?: number;
  timestamp: number;
}

export interface Geofence {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius: number;        // 米
  onEnter?: () => void;
  onExit?: () => void;
}

export interface GeofenceEvent {
  fenceId: string;
  fenceName: string;
  type: 'enter' | 'exit';
  position: GeoPosition;
  timestamp: number;
}

export class LocationManager {
  private watchId: number | null = null;
  private lastPosition: GeoPosition | null = null;
  private fences: Map<string, Geofence & { inside: boolean }> = new Map();
  private fenceCallback: ((event: GeofenceEvent) => void) | null = null;
  private positionCallback: ((pos: GeoPosition) => void) | null = null;

  /** 获取当前位置（一次性） */
  async getLocation(): Promise<GeoPosition> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation API 不可用'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const geo: GeoPosition = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            altitude: pos.coords.altitude ?? undefined,
            speed: pos.coords.speed ?? undefined,
            timestamp: pos.timestamp,
          };
          this.lastPosition = geo;
          this._checkFences(geo);
          resolve(geo);
        },
        (err) => reject(new Error(`定位失败: ${err.message}`)),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
      );
    });
  }

  /** 持续追踪位置 */
  watchPosition(onChange: (pos: GeoPosition) => void): () => void {
    this.positionCallback = onChange;

    if (!navigator.geolocation) {
      return () => {};
    }

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const geo: GeoPosition = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude ?? undefined,
          speed: pos.coords.speed ?? undefined,
          timestamp: pos.timestamp,
        };
        this.lastPosition = geo;
        this._checkFences(geo);
        onChange(geo);
      },
      () => {},
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );

    return () => {
      if (this.watchId !== null) {
        navigator.geolocation.clearWatch(this.watchId);
        this.watchId = null;
      }
      this.positionCallback = null;
    };
  }

  /** 检查位置权限 */
  async hasPermission(): Promise<boolean> {
    try {
      const result = await navigator.permissions.query({ name: 'geolocation' });
      return result.state === 'granted';
    } catch {
      return false;
    }
  }

  // ==================== 地理围栏 ====================

  /** 添加地理围栏 */
  addGeofence(fence: Geofence): void {
    this.fences.set(fence.id, { ...fence, inside: false });
  }

  /** 移除地理围栏 */
  removeGeofence(id: string): void {
    this.fences.delete(id);
  }

  /** 获取所有围栏 */
  getGeofences(): Geofence[] {
    return Array.from(this.fences.values()).map(({ inside: _, ...f }) => f);
  }

  /** 围栏事件回调 */
  onGeofenceEvent(callback: (event: GeofenceEvent) => void): void {
    this.fenceCallback = callback;
  }

  /** 获取最后位置 */
  getLastPosition(): GeoPosition | null {
    return this.lastPosition;
  }

  /** 清理 */
  destroy(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.fences.clear();
    this.fenceCallback = null;
    this.positionCallback = null;
  }

  // ==================== 内部方法 ====================

  private _checkFences(pos: GeoPosition): void {
    for (const [id, fence] of this.fences) {
      const distance = this._haversine(pos.lat, pos.lng, fence.lat, fence.lng);
      const wasInside = fence.inside;
      const isInside = distance <= fence.radius;

      if (isInside && !wasInside) {
        fence.inside = true;
        fence.onEnter?.();
        this.fenceCallback?.({
          fenceId: id,
          fenceName: fence.name,
          type: 'enter',
          position: pos,
          timestamp: Date.now(),
        });
      } else if (!isInside && wasInside) {
        fence.inside = false;
        fence.onExit?.();
        this.fenceCallback?.({
          fenceId: id,
          fenceName: fence.name,
          type: 'exit',
          position: pos,
          timestamp: Date.now(),
        });
      }
    }
  }

  /** Haversine 公式计算两点距离（米） */
  private _haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const dLat = this._deg2rad(lat2 - lat1);
    const dLng = this._deg2rad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(this._deg2rad(lat1)) * Math.cos(this._deg2rad(lat2)) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private _deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
  }
}
