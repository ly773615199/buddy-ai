/**
 * 运动感知 + 跌倒检测
 * 浏览器端：DeviceMotion API
 */

export type MotionState = 'stationary' | 'walking' | 'running' | 'driving' | 'unknown';

export interface MotionData {
  state: MotionState;
  acceleration: { x: number; y: number; z: number };
  rotation: { alpha: number; beta: number; gamma: number };
  magnitude: number;       // 加速度模量
  timestamp: number;
}

export interface FallEvent {
  severity: 'low' | 'medium' | 'high';
  impact: number;          // 冲击力 (g)
  position: { x: number; y: number; z: number };
  timestamp: number;
}

export interface MotionOptions {
  /** 采样间隔（ms），默认 200 */
  sampleIntervalMs?: number;
  /** 跌倒检测阈值（g），默认 2.5 */
  fallThreshold?: number;
  /** 步行判断阈值，默认 0.3 */
  walkThreshold?: number;
  /** 跑步判断阈值，默认 0.8 */
  runThreshold?: number;
}

const HISTORY_SIZE = 20;

export class MotionManager {
  private options: Required<MotionOptions>;
  private listening = false;
  private motionCallback: ((data: MotionData) => void) | null = null;
  private fallCallback: ((event: FallEvent) => void) | null = null;
  private magnitudeHistory: number[] = [];
  private currentState: MotionState = 'unknown';
  private stepCount = 0;
  private lastStepTime = 0;

  constructor(options: MotionOptions = {}) {
    this.options = {
      sampleIntervalMs: options.sampleIntervalMs ?? 200,
      fallThreshold: options.fallThreshold ?? 2.5,
      walkThreshold: options.walkThreshold ?? 0.3,
      runThreshold: options.runThreshold ?? 0.8,
    };
  }

  /** 开始监听运动 */
  start(): void {
    if (this.listening || typeof window === 'undefined') return;
    this.listening = true;

    window.addEventListener('devicemotion', this._onMotion);
    window.addEventListener('deviceorientation', this._onOrientation);
  }

  /** 停止监听 */
  stop(): void {
    if (!this.listening) return;
    this.listening = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('devicemotion', this._onMotion);
      window.removeEventListener('deviceorientation', this._onOrientation);
    }
    this.magnitudeHistory = [];
  }

  /** 运动数据回调 */
  onMotion(callback: (data: MotionData) => void): () => void {
    this.motionCallback = callback;
    return () => { this.motionCallback = null; };
  }

  /** 跌倒事件回调 */
  onFall(callback: (event: FallEvent) => void): () => void {
    this.fallCallback = callback;
    return () => { this.fallCallback = null; };
  }

  /** 获取当前运动状态 */
  getState(): MotionState {
    return this.currentState;
  }

  /** 获取步数 */
  getStepCount(): number {
    return this.stepCount;
  }

  /** 重置步数 */
  resetStepCount(): void {
    this.stepCount = 0;
  }

  /** 检查传感器可用 */
  isAvailable(): boolean {
    return typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
  }

  /** 请求权限（iOS 13+ 需要） */
  async requestPermission(): Promise<boolean> {
    const DME = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> };
    if (typeof DME.requestPermission === 'function') {
      try {
        const result = await DME.requestPermission();
        return result === 'granted';
      } catch {
        return false;
      }
    }
    return true;
  }

  /** 清理 */
  destroy(): void {
    this.stop();
    this.motionCallback = null;
    this.fallCallback = null;
  }

  // ==================== 内部方法 ====================

  private lastOrientation: { alpha: number; beta: number; gamma: number } = { alpha: 0, beta: 0, gamma: 0 };

  private _onOrientation = (event: DeviceOrientationEvent): void => {
    this.lastOrientation = {
      alpha: event.alpha ?? 0,
      beta: event.beta ?? 0,
      gamma: event.gamma ?? 0,
    };
  };

  private _onMotion = (event: DeviceMotionEvent): void => {
    const acc = event.accelerationIncludingGravity;
    if (!acc || acc.x === null || acc.y === null || acc.z === null) return;

    const x: number = acc.x;
    const y: number = acc.y;
    const z: number = acc.z;
    const magnitude = Math.sqrt(x * x + y * y + z * z);

    // 更新历史
    this.magnitudeHistory.push(magnitude);
    if (this.magnitudeHistory.length > HISTORY_SIZE) {
      this.magnitudeHistory.shift();
    }

    // 跌倒检测
    if (magnitude > this.options.fallThreshold * 9.8) {
      const severity: FallEvent['severity'] =
        magnitude > 4 * 9.8 ? 'high' :
        magnitude > 3 * 9.8 ? 'medium' : 'low';

      this.fallCallback?.({
        severity,
        impact: magnitude / 9.8,
        position: { x, y, z },
        timestamp: Date.now(),
      });
    }

    // 运动状态判断
    this.currentState = this._classifyMotion(magnitude);

    // 步数估计（简化：基于周期性加速度变化）
    this._estimateSteps(magnitude);

    // 回调
    const data: MotionData = {
      state: this.currentState,
      acceleration: { x, y, z },
      rotation: this.lastOrientation,
      magnitude,
      timestamp: Date.now(),
    };

    this.motionCallback?.(data);
  };

  private _classifyMotion(magnitude: number): MotionState {
    // 去掉重力 (9.8 m/s²) 后的加速度
    const netAccel = Math.abs(magnitude - 9.8);

    if (netAccel < 0.1) return 'stationary';
    if (netAccel < this.options.walkThreshold * 9.8) return 'stationary';
    if (netAccel < this.options.runThreshold * 9.8) return 'walking';
    if (netAccel < 2 * 9.8) return 'running';

    return 'driving';
  }

  private _estimateSteps(_magnitude: number): void {
    if (this.magnitudeHistory.length < 3) return;

    const len = this.magnitudeHistory.length;
    const prev = this.magnitudeHistory[len - 2];
    const curr = this.magnitudeHistory[len - 1];
    const prevPrev = this.magnitudeHistory[len - 3];

    // 过零检测：加速度从高到低或从低到高变化
    const isPeak = prev > prevPrev && prev > curr;
    const isValley = prev < prevPrev && prev < curr;

    if (isPeak || isValley) {
      const now = Date.now();
      // 最小步频间隔 250ms (240步/分上限)
      if (now - this.lastStepTime > 250) {
        this.stepCount++;
        this.lastStepTime = now;
      }
    }
  }
}
