/**
 * 屏幕截图分析模块
 * 桌面端：Electron desktopCapturer / 浏览器：getDisplayMedia
 * 支持全屏/区域截图 + 活跃窗口感知
 */

// ── 类型定义 ──

export type ScreenSource = 'fullscreen' | 'window' | 'region';

export interface ScreenCaptureOptions {
  /** 截图源类型 */
  source?: ScreenSource;
  /** 目标窗口标题（source=window 时） */
  windowTitle?: string;
  /** 区域（source=region 时） */
  region?: { x: number; y: number; width: number; height: number };
  /** 图片格式 */
  format?: 'png' | 'jpeg';
  /** JPEG 质量 0-100 */
  quality?: number;
}

export interface ScreenCaptureResult {
  /** base64 编码的截图 */
  base64: string;
  /** 截图尺寸 */
  size: { width: number; height: number };
  /** 活跃窗口标题 */
  activeWindowTitle: string | null;
  /** 时间戳 */
  timestamp: number;
  /** 截图源 */
  source: ScreenSource;
}

export interface WindowInfo {
  title: string;
  id: string;
  bounds?: { x: number; y: number; width: number; height: number };
  app?: string;
  isActive: boolean;
}

export interface ScreenAnalysisResult {
  /** 截图结果 */
  capture: ScreenCaptureResult;
  /** 场景分析 */
  analysis: {
    description: string;
    activeApp: string | null;
    suggestions: string[];
  };
}

// ── 主类 ──

export class ScreenCapture {
  private options: Required<ScreenCaptureOptions>;
  private isCapturing = false;
  private lastCapture: ScreenCaptureResult | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(options: ScreenCaptureOptions = {}) {
    this.options = {
      source: options.source || 'fullscreen',
      windowTitle: options.windowTitle || '',
      region: options.region || { x: 0, y: 0, width: 0, height: 0 },
      format: options.format || 'png',
      quality: options.quality || 80,
    };
  }

  /** 截取屏幕 */
  async capture(): Promise<ScreenCaptureResult> {
    const timestamp = Date.now();
    let base64: string;
    let size: { width: number; height: number };

    // 尝试 Electron desktopCapturer
    if (typeof process !== 'undefined' && process.versions?.electron) {
      const result = await this.captureElectron();
      base64 = result.base64;
      size = result.size;
    }
    // 尝试浏览器 getDisplayMedia
    else if (typeof navigator !== 'undefined' && 'mediaDevices' in navigator && 'getDisplayMedia' in (navigator.mediaDevices || {})) {
      const result = await this.captureBrowser();
      base64 = result.base64;
      size = result.size;
    }
    else {
      // 降级：生成模拟截图（用于测试/非图形环境）
      base64 = this.generatePlaceholder();
      size = { width: 1920, height: 1080 };
    }

    const activeWindowTitle = await this.getActiveWindowTitle().catch(() => null);

    this.lastCapture = {
      base64,
      size,
      activeWindowTitle,
      timestamp,
      source: this.options.source,
    };

    return this.lastCapture;
  }

  /** 截取并分析 */
  async captureAndAnalyze(
    analyzer?: (base64: string) => Promise<string>
  ): Promise<ScreenAnalysisResult> {
    const capture = await this.capture();

    let description = '屏幕截图已捕获';
    let activeApp: string | null = null;
    const suggestions: string[] = [];

    if (capture.activeWindowTitle) {
      activeApp = this.extractAppName(capture.activeWindowTitle);
      description = `当前活跃窗口：${capture.activeWindowTitle}`;

      // 基于窗口标题给出建议
      if (capture.activeWindowTitle.includes('Terminal') || capture.activeWindowTitle.includes('终端')) {
        suggestions.push('检测到终端窗口');
      }
      if (capture.activeWindowTitle.includes('VS Code') || capture.activeWindowTitle.includes('IntelliJ')) {
        suggestions.push('检测到代码编辑器');
      }
      if (capture.activeWindowTitle.includes('Chrome') || capture.activeWindowTitle.includes('Firefox')) {
        suggestions.push('检测到浏览器窗口');
      }
    }

    // 如果提供了分析器，使用它来分析截图
    if (analyzer) {
      try {
        const aiDescription = await analyzer(capture.base64);
        description = aiDescription;
      } catch {
        // 分析失败，使用基础描述
      }
    }

    return {
      capture,
      analysis: { description, activeApp, suggestions },
    };
  }

  /** 开始定时截图 */
  startInterval(
    intervalMs: number,
    callback: (result: ScreenCaptureResult) => void
  ): void {
    if (this.intervalId) {
      this.stopInterval();
    }

    this.isCapturing = true;
    this.intervalId = setInterval(async () => {
      try {
        const result = await this.capture();
        callback(result);
      } catch {
        // 忽略单次截图失败
      }
    }, intervalMs);
  }

  /** 停止定时截图 */
  stopInterval(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isCapturing = false;
  }

  /** 获取最后的截图 */
  getLastCapture(): ScreenCaptureResult | null {
    return this.lastCapture;
  }

  /** 是否正在定时截图 */
  isActive(): boolean {
    return this.isCapturing;
  }

  /** 列出可用窗口（桌面端） */
  async listWindows(): Promise<WindowInfo[]> {
    // Electron 环境
    if (typeof process !== 'undefined' && process.versions?.electron) {
      try {
        const { desktopCapturer } = await import('electron' as any);
        const sources = await desktopCapturer.getSources({
          types: ['window', 'screen'],
          thumbnailSize: { width: 150, height: 150 },
        });

        return sources.map((source: any) => ({
          title: source.name,
          id: source.id,
          app: this.extractAppName(source.name),
          isActive: source.id.includes('screen'),
        }));
      } catch {
        return [];
      }
    }

    return [];
  }

  // ── 私有方法 ──

  /** Electron desktopCapturer 截图 */
  private async captureElectron(): Promise<{ base64: string; size: { width: number; height: number } }> {
    const { desktopCapturer } = await import('electron' as any);

    const sources = await desktopCapturer.getSources({
      types: this.options.source === 'window' ? ['window'] : ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });

    if (sources.length === 0) {
      throw new Error('没有可用的屏幕源');
    }

    const source: any = sources[0];
    const pngBuffer = source.thumbnail.toPNG();
    const base64 = pngBuffer.toString('base64');
    const size = source.thumbnail.getSize();

    return { base64, size };
  }

  /** 浏览器 getDisplayMedia 截图 */
  private async captureBrowser(): Promise<{ base64: string; size: { width: number; height: number } }> {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always' } as MediaTrackConstraints,
    });

    try {
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;

      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => {
          video.play();
          resolve();
        };
      });

      // 等待一帧
      await new Promise(resolve => setTimeout(resolve, 200));

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0);

      const format = this.options.format === 'jpeg' ? 'image/jpeg' : 'image/png';
      const quality = this.options.format === 'jpeg' ? this.options.quality / 100 : undefined;
      const dataUrl = canvas.toDataURL(format, quality);
      const base64 = dataUrl.split(',')[1];

      return {
        base64,
        size: { width: canvas.width, height: canvas.height },
      };
    } finally {
      stream.getTracks().forEach(track => track.stop());
    }
  }

  /** 获取活跃窗口标题 */
  private async getActiveWindowTitle(): Promise<string | null> {
    // Electron 环境
    if (typeof process !== 'undefined' && process.versions?.electron) {
      try {
        const { BrowserWindow } = await import('electron' as any);
        const focused = BrowserWindow.getFocusedWindow();
        return focused?.getTitle() || null;
      } catch {
        return null;
      }
    }

    // 浏览器环境无法获取系统窗口标题
    if (typeof document !== 'undefined') {
      return document.title || null;
    }

    return null;
  }

  /** 从窗口标题提取应用名 */
  private extractAppName(title: string): string {
    // 常见格式："文件名 — 应用名" 或 "应用名 - 窗口内容"
    const separators = [' — ', ' - ', ' – ', ' | '];
    for (const sep of separators) {
      if (title.includes(sep)) {
        const parts = title.split(sep);
        // 通常应用名在最后（macOS）或最前（Windows）
        return parts[parts.length - 1].trim();
      }
    }
    return title;
  }

  /** 生成占位截图（非图形环境降级） */
  private generatePlaceholder(): string {
    // 返回一个 1x1 像素的透明 PNG
    return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  }
}
