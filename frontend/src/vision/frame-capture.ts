/**
 * 帧捕获策略
 * 手动 / 定时 / 运动检测
 */

export type FrameCallback = (frameBase64: string, timestamp: number) => void;

export interface CaptureStrategyOptions {
  /** 捕获间隔（ms），定时策略用 */
  intervalMs?: number;
  /** 像素差异阈值，运动检测用 */
  threshold?: number;
  /** 最小变化面积百分比，运动检测用 */
  minChangePercent?: number;
  /** 检测间隔（ms），运动检测用 */
  checkIntervalMs?: number;
  /** JPEG 质量 0-1 */
  quality?: number;
}

// ==================== 手动捕获 ====================

export class ManualCapture {
  readonly name = 'manual' as const;
  private callback: FrameCallback | null = null;

  start(onFrame: FrameCallback): void {
    this.callback = onFrame;
  }

  stop(): void {
    this.callback = null;
  }

  isRunning(): boolean {
    return this.callback !== null;
  }

  /** 手动触发捕获 */
  async trigger(captureFn: () => Promise<string>): Promise<void> {
    if (!this.callback) return;
    const frame = await captureFn();
    this.callback(frame, Date.now());
  }
}

// ==================== 定时捕获 ====================

export class IntervalCapture {
  readonly name = 'interval' as const;
  private timer: ReturnType<typeof setInterval> | null = null;
  private callback: FrameCallback | null = null;
  private captureFn: (() => Promise<string>) | null = null;
  private intervalMs: number;

  constructor(options: CaptureStrategyOptions = {}) {
    this.intervalMs = options.intervalMs ?? 5000;
  }

  start(onFrame: FrameCallback, captureFn?: () => Promise<string>): void {
    this.callback = onFrame;
    this.captureFn = captureFn ?? null;

    this.timer = setInterval(async () => {
      if (this.callback && this.captureFn) {
        try {
          const frame = await this.captureFn();
          this.callback(frame, Date.now());
        } catch {
          // 捕获失败，跳过
        }
      }
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.callback = null;
    this.captureFn = null;
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  /** 更新间隔 */
  setInterval(ms: number): void {
    this.intervalMs = ms;
    if (this.timer && this.callback && this.captureFn) {
      this.stop();
      this.start(this.callback, this.captureFn);
    }
  }
}

// ==================== 运动检测捕获 ====================

export class MotionCapture {
  readonly name = 'motion' as const;
  private timer: ReturnType<typeof setInterval> | null = null;
  private callback: FrameCallback | null = null;
  private prevFrame: ImageData | null = null;
  private threshold: number;
  private minChangePercent: number;
  private checkIntervalMs: number;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  constructor(options: CaptureStrategyOptions = {}) {
    this.threshold = options.threshold ?? 30;
    this.minChangePercent = options.minChangePercent ?? 5;
    this.checkIntervalMs = options.checkIntervalMs ?? 1000;
  }

  start(onFrame: FrameCallback): void {
    this.callback = onFrame;

    if (typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d');
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.callback = null;
    this.prevFrame = null;
    this.canvas = null;
    this.ctx = null;
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  /** 将视频帧传入检测循环 */
  attachVideo(videoElement: HTMLVideoElement): void {
    if (!this.callback) return;

    this.timer = setInterval(() => {
      this._checkMotion(videoElement);
    }, this.checkIntervalMs);
  }

  /** 停止视频检测 */
  detachVideo(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.prevFrame = null;
  }

  // ==================== 内部方法 ====================

  private _checkMotion(video: HTMLVideoElement): void {
    if (!this.canvas || !this.ctx || !this.callback) return;
    if (video.readyState < 2) return;

    const w = 160; // 降采样以提高性能
    const h = Math.round((video.videoHeight / video.videoWidth) * w) || 120;
    this.canvas.width = w;
    this.canvas.height = h;

    this.ctx.drawImage(video, 0, 0, w, h);
    const currentFrame = this.ctx.getImageData(0, 0, w, h);

    if (this.prevFrame) {
      const changePercent = this._computeDiff(this.prevFrame.data, currentFrame.data);

      if (changePercent >= this.minChangePercent) {
        // 检测到运动，触发全分辨率捕获
        const fullCanvas = document.createElement('canvas');
        fullCanvas.width = video.videoWidth || 640;
        fullCanvas.height = video.videoHeight || 480;
        const fullCtx = fullCanvas.getContext('2d');
        if (fullCtx) {
          fullCtx.drawImage(video, 0, 0, fullCanvas.width, fullCanvas.height);
          const dataUrl = fullCanvas.toDataURL('image/jpeg', 0.8);
          const base64 = dataUrl.split(',')[1];
          this.callback(base64, Date.now());
        }
      }
    }

    this.prevFrame = currentFrame;
  }

  private _computeDiff(prev: Uint8ClampedArray, curr: Uint8ClampedArray): number {
    let changedPixels = 0;
    const totalPixels = prev.length / 4;

    for (let i = 0; i < prev.length; i += 4) {
      const dr = Math.abs(prev[i] - curr[i]);
      const dg = Math.abs(prev[i + 1] - curr[i + 1]);
      const db = Math.abs(prev[i + 2] - curr[i + 2]);
      const diff = (dr + dg + db) / 3;

      if (diff > this.threshold) {
        changedPixels++;
      }
    }

    return (changedPixels / totalPixels) * 100;
  }
}

// ==================== 捕获策略管理器 ====================

export class FrameCaptureManager {
  private strategies: Map<string, ManualCapture | IntervalCapture | MotionCapture> = new Map();
  private activeStrategy: string | null = null;

  constructor() {
    this.strategies.set('manual', new ManualCapture());
  }

  /** 添加定时策略 */
  addInterval(name = 'interval', options?: CaptureStrategyOptions): IntervalCapture {
    const strategy = new IntervalCapture(options);
    this.strategies.set(name, strategy);
    return strategy;
  }

  /** 添加运动检测策略 */
  addMotion(name = 'motion', options?: CaptureStrategyOptions): MotionCapture {
    const strategy = new MotionCapture(options);
    this.strategies.set(name, strategy);
    return strategy;
  }

  /** 获取手动策略 */
  getManual(): ManualCapture {
    return this.strategies.get('manual') as ManualCapture;
  }

  /** 获取指定策略 */
  get(name: string): ManualCapture | IntervalCapture | MotionCapture | undefined {
    return this.strategies.get(name);
  }

  /** 激活策略 */
  activate(name: string): void {
    if (!this.strategies.has(name)) {
      throw new Error(`策略 "${name}" 不存在`);
    }
    // 停止当前活跃策略
    if (this.activeStrategy) {
      this.strategies.get(this.activeStrategy)?.stop();
    }
    this.activeStrategy = name;
  }

  /** 停止所有策略 */
  stopAll(): void {
    for (const strategy of this.strategies.values()) {
      strategy.stop();
    }
    this.activeStrategy = null;
  }

  /** 列出所有策略 */
  list(): string[] {
    return Array.from(this.strategies.keys());
  }
}
