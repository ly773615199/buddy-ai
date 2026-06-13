/**
 * 环境感知
 * 环境光 / 噪音级别 / 网络状态 / 电池状态
 */

export interface EnvironmentData {
  ambientLight: number | null;     // lux
  noiseLevel: number | null;       // dB (0-1)
  networkType: 'wifi' | 'cellular' | 'offline' | 'unknown';
  networkDownlink: number | null;  // Mbps
  networkRtt: number | null;       // ms
  batteryLevel: number | null;     // 0-1
  batteryCharging: boolean | null;
  timestamp: number;
}

export interface EnvironmentChangeEvent {
  field: keyof Omit<EnvironmentData, 'timestamp'>;
  oldValue: unknown;
  newValue: unknown;
  timestamp: number;
}

export class EnvironmentMonitor {
  private data: EnvironmentData;
  private changeCallback: ((event: EnvironmentChangeEvent) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private monitoring = false;

  // 传感器监听器清理函数
  private cleanupFns: (() => void)[] = [];

  constructor() {
    this.data = this._createEmptyData();
  }

  /** 开始监控 */
  start(intervalMs = 10000): void {
    if (this.monitoring) return;
    this.monitoring = true;

    this._setupNetworkListener();
    this._setupBatteryListener();
    this._setupAmbientLightListener();

    // 定时刷新
    this.timer = setInterval(() => {
      this._refresh();
    }, intervalMs);

    // 立即刷新一次
    this._refresh();
  }

  /** 停止监控 */
  stop(): void {
    this.monitoring = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    for (const cleanup of this.cleanupFns) {
      try { cleanup(); } catch { /* ignore */ }
    }
    this.cleanupFns = [];
  }

  /** 获取当前环境数据 */
  getData(): EnvironmentData {
    return { ...this.data };
  }

  /** 变更回调 */
  onChange(callback: (event: EnvironmentChangeEvent) => void): () => void {
    this.changeCallback = callback;
    return () => { this.changeCallback = null; };
  }

  /** 是否在监控中 */
  get isMonitoring(): boolean {
    return this.monitoring;
  }

  /** 获取环境描述文本 */
  getDescription(): string {
    const parts: string[] = [];
    const d = this.data;

    if (d.ambientLight !== null) {
      parts.push(d.ambientLight < 10 ? '环境较暗' : d.ambientLight > 1000 ? '光线充足' : '光线适中');
    }

    if (d.noiseLevel !== null) {
      parts.push(d.noiseLevel < 0.1 ? '环境安静' : d.noiseLevel > 0.5 ? '环境较吵' : '环境正常');
    }

    parts.push(`网络: ${d.networkType}`);

    if (d.batteryLevel !== null) {
      const pct = Math.round(d.batteryLevel * 100);
      parts.push(`电量: ${pct}%${d.batteryCharging ? ' (充电中)' : ''}`);
    }

    return parts.join(' | ');
  }

  /** 清理 */
  destroy(): void {
    this.stop();
    this.changeCallback = null;
  }

  // ==================== 内部方法 ====================

  private async _refresh(): Promise<void> {
    // 网络
    const net = this._getNetworkInfo();
    this._update('networkType', net.type);
    this._update('networkDownlink', net.downlink);
    this._update('networkRtt', net.rtt);

    // 电池
    try {
      const battery = await this._getBatteryInfo();
      if (battery) {
        this._update('batteryLevel', battery.level);
        this._update('batteryCharging', battery.charging);
      }
    } catch { /* 不支持 */ }
  }

  private _setupNetworkListener(): void {
    if (typeof navigator === 'undefined' || !navigator.connection) return;

    const conn = navigator.connection;
    const handler = () => {
      const net = this._getNetworkInfo();
      this._update('networkType', net.type);
      this._update('networkDownlink', net.downlink);
      this._update('networkRtt', net.rtt);
    };

    conn.addEventListener?.('change', handler);
    this.cleanupFns.push(() => conn.removeEventListener?.('change', handler));
  }

  private async _setupBatteryListener(): Promise<void> {
    try {
      const battery = await this._getBatteryInfo();
      if (!battery) return;

      const handler = () => {
        this._update('batteryLevel', battery.level);
        this._update('batteryCharging', battery.charging);
      };

      battery.addEventListener?.('levelchange', handler);
      battery.addEventListener?.('chargingchange', handler);
      this.cleanupFns.push(() => {
        battery.removeEventListener?.('levelchange', handler);
        battery.removeEventListener?.('chargingchange', handler);
      });
    } catch { /* 不支持 */ }
  }

  private _setupAmbientLightListener(): void {
    if (typeof window === 'undefined') return;

    // AmbientLightSensor API（实验性）
    try {
      const SensorClass = window.AmbientLightSensor;
      if (!SensorClass) return;

      const sensor = new SensorClass();
      sensor.addEventListener('reading', () => {
        this._update('ambientLight', sensor.illuminance);
      });
      sensor.start();
      this.cleanupFns.push(() => sensor.stop());
    } catch { /* 不支持 */ }
  }

  private _getNetworkInfo(): { type: EnvironmentData['networkType']; downlink: number | null; rtt: number | null } {
    if (typeof navigator === 'undefined' || !navigator.onLine) {
      return { type: 'offline', downlink: null, rtt: null };
    }

    const conn = navigator.connection;
    if (!conn) return { type: 'unknown', downlink: null, rtt: null };

    const effectiveType = conn.effectiveType ?? '';
    const connType = conn.type ?? '';

    let type: EnvironmentData['networkType'];
    if (connType === 'wifi' || (effectiveType as string) === 'wifi') type = 'wifi';
    else if (connType === 'cellular' || ['2g', '3g', '4g', '5g'].includes(effectiveType)) type = 'cellular';
    else if (navigator.onLine) type = 'wifi'; // fallback
    else type = 'offline';

    return {
      type,
      downlink: conn.downlink ?? null,
      rtt: conn.rtt ?? null,
    };
  }

  private async _getBatteryInfo(): Promise<BatteryManager | null> {
    if (typeof navigator === 'undefined') return null;

    try {
      if (!navigator.getBattery) return null;
      const battery = await navigator.getBattery();
      if (!battery) return null;
      return battery;
    } catch {
      return null;
    }
  }

  private _update(field: keyof Omit<EnvironmentData, 'timestamp'>, value: unknown): void {
    const oldValue = this.data[field];
    if (oldValue === value) return;

    (this.data as unknown as Record<string, unknown>)[field] = value;
    this.data.timestamp = Date.now();

    this.changeCallback?.({
      field,
      oldValue,
      newValue: value,
      timestamp: Date.now(),
    });
  }

  private _createEmptyData(): EnvironmentData {
    return {
      ambientLight: null,
      noiseLevel: null,
      networkType: 'unknown',
      networkDownlink: null,
      networkRtt: null,
      batteryLevel: null,
      batteryCharging: null,
      timestamp: Date.now(),
    };
  }
}
