/**
 * 视觉隐私控制
 * 权限管理 / 数据过滤 / 脱敏处理
 */

export type VisionPermissionLevel = 'disabled' | 'manual' | 'auto' | 'full';

export interface PrivacyConfig {
  /** 权限级别 */
  permissionLevel: VisionPermissionLevel;
  /** 视频帧是否持久化存储 */
  persistFrames: boolean;
  /** 状态指示器是否显示 */
  showIndicator: boolean;
  /** 脱敏配置 */
  anonymize: AnonymizeConfig;
  /** 数据保留时间（ms），超时自动清理 */
  retentionMs: number;
  /** 信任度阈值，低于此值禁用自动捕获 */
  minTrustForAuto: number;
}

export interface AnonymizeConfig {
  /** 人脸打码 */
  blurFaces: boolean;
  /** 文字脱敏 */
  redactText: boolean;
  /** 位置信息脱敏 */
  stripLocation: boolean;
}

export interface PrivacyAuditEntry {
  timestamp: number;
  action: 'capture' | 'analyze' | 'store' | 'transmit' | 'delete';
  source: 'camera' | 'screenshot' | 'upload';
  permissionLevel: VisionPermissionLevel;
  anonymized: boolean;
  details?: string;
}

const DEFAULT_CONFIG: PrivacyConfig = {
  permissionLevel: 'manual',
  persistFrames: false,
  showIndicator: true,
  anonymize: {
    blurFaces: false,
    redactText: false,
    stripLocation: true,
  },
  retentionMs: 300000, // 5 分钟
  minTrustForAuto: 50,
};

export class VisionPrivacyManager {
  private config: PrivacyConfig;
  private auditLog: PrivacyAuditEntry[] = [];
  private maxAuditEntries = 1000;
  private tempFrameStore: Map<string, { data: string; timestamp: number }> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<PrivacyConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 定时清理过期帧
    this.cleanupTimer = setInterval(() => {
      this._cleanupExpiredFrames();
    }, 60000);
  }

  // ==================== 权限检查 ====================

  /** 检查是否允许捕获 */
  canCapture(trustScore: number): boolean {
    switch (this.config.permissionLevel) {
      case 'disabled':
        return false;
      case 'manual':
        return true; // 手动触发总是允许
      case 'auto':
        return trustScore >= this.config.minTrustForAuto;
      case 'full':
        return true;
    }
  }

  /** 检查是否允许自动分析 */
  canAutoAnalyze(trustScore: number): boolean {
    return this.config.permissionLevel !== 'disabled'
      && trustScore >= this.config.minTrustForAuto;
  }

  /** 检查是否允许存储 */
  canStore(): boolean {
    return this.config.persistFrames;
  }

  // ==================== 数据处理 ====================

  /** 临时存储帧（自动过期） */
  storeFrameTemporarily(id: string, base64: string): void {
    if (!this.canStore()) return;

    this.tempFrameStore.set(id, {
      data: base64,
      timestamp: Date.now(),
    });

    this._audit('store', 'camera', false);
  }

  /** 获取临时帧 */
  getFrame(id: string): string | null {
    const entry = this.tempFrameStore.get(id);
    if (!entry) return null;

    // 检查是否过期
    if (Date.now() - entry.timestamp > this.config.retentionMs) {
      this.tempFrameStore.delete(id);
      return null;
    }

    return entry.data;
  }

  /** 删除帧 */
  deleteFrame(id: string): boolean {
    const result = this.tempFrameStore.delete(id);
    if (result) this._audit('delete', 'camera', false);
    return result;
  }

  /** 清理所有临时帧 */
  clearAllFrames(): void {
    this.tempFrameStore.clear();
    this._audit('delete', 'camera', false);
  }

  // ==================== 脱敏处理 ====================

  /** 同步脱敏 — 纯 Canvas 像素化（零依赖） */
  anonymizeFrame(base64: string, faceRegions?: Array<{ x: number; y: number; width: number; height: number }>): string {
    if (!this.config.anonymize.blurFaces || !faceRegions || faceRegions.length === 0) {
      return base64;
    }

    // 在浏览器环境下用 Canvas 像素化
    if (typeof document !== 'undefined') {
      try {
        return this._canvasPixelate(base64, faceRegions);
      } catch {
        this._audit('analyze', 'camera', true, 'canvas pixelate failed');
        return base64;
      }
    }

    // Node 环境下无法使用 Canvas，返回原图
    this._audit('analyze', 'camera', true, 'no canvas available');
    return base64;
  }

  /**
   * 纯 Canvas 像素化 — 替代 sharp，零外部依赖
   * 将 base64 图片中指定区域进行块平均色像素化
   */
  private _canvasPixelate(
    base64: string,
    faceRegions: Array<{ x: number; y: number; width: number; height: number }>,
    blockSize: number = 8,
  ): string {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${base64}`;

    // 同步绘制到离屏 Canvas
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return base64;

    ctx.drawImage(img, 0, 0);

    for (const region of faceRegions) {
      const x = Math.max(0, Math.round(region.x));
      const y = Math.max(0, Math.round(region.y));
      const w = Math.min(Math.round(region.width), canvas.width - x);
      const h = Math.min(Math.round(region.height), canvas.height - y);
      if (w <= 0 || h <= 0) continue;

      const imageData = ctx.getImageData(x, y, w, h);
      const data = imageData.data;

      for (let py = 0; py < h; py += blockSize) {
        for (let px = 0; px < w; px += blockSize) {
          // 采样块内平均色
          let r = 0, g = 0, b = 0, count = 0;
          for (let dy = 0; dy < blockSize && py + dy < h; dy++) {
            for (let dx = 0; dx < blockSize && px + dx < w; dx++) {
              const i = ((py + dy) * w + (px + dx)) * 4;
              r += data[i]; g += data[i + 1]; b += data[i + 2];
              count++;
            }
          }
          r = Math.round(r / count);
          g = Math.round(g / count);
          b = Math.round(b / count);

          // 填充块
          for (let dy = 0; dy < blockSize && py + dy < h; dy++) {
            for (let dx = 0; dx < blockSize && px + dx < w; dx++) {
              const i = ((py + dy) * w + (px + dx)) * 4;
              data[i] = r; data[i + 1] = g; data[i + 2] = b;
            }
          }
        }
      }

      ctx.putImageData(imageData, x, y);
    }

    this._audit('analyze', 'camera', true, 'canvas pixelate');
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  }

  /** 脱敏分析结果中的隐私信息 */
  anonymizeResult(result: Record<string, any>): Record<string, any> {
    const cleaned = { ...result };

    if (this.config.anonymize.stripLocation) {
      delete cleaned.location;
      delete cleaned.gps;
      delete cleaned.address;
    }

    if (this.config.anonymize.redactText && cleaned.text) {
      cleaned.text = '[已脱敏]';
    }

    return cleaned;
  }

  // ==================== 配置管理 ====================

  /** 更新配置 */
  updateConfig(partial: Partial<PrivacyConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  /** 获取配置 */
  getConfig(): PrivacyConfig {
    return { ...this.config };
  }

  /** 设置权限级别 */
  setPermissionLevel(level: VisionPermissionLevel): void {
    this.config.permissionLevel = level;
  }

  /** 一键隐私模式（禁用所有视觉功能） */
  enablePrivacyMode(): void {
    this.config.permissionLevel = 'disabled';
    this.clearAllFrames();
  }

  /** 退出隐私模式 */
  disablePrivacyMode(level: VisionPermissionLevel = 'manual'): void {
    this.config.permissionLevel = level;
  }

  // ==================== 审计日志 ====================

  /** 获取审计日志 */
  getAuditLog(count = 50): PrivacyAuditEntry[] {
    return this.auditLog.slice(-count);
  }

  /** 清除审计日志 */
  clearAuditLog(): void {
    this.auditLog = [];
  }

  /** 导出审计日志 */
  exportAuditLog(): string {
    return JSON.stringify(this.auditLog, null, 2);
  }

  // ==================== 状态 ====================

  /** 获取隐私状态摘要 */
  getStatus(): {
    level: VisionPermissionLevel;
    tempFrames: number;
    auditEntries: number;
    indicator: boolean;
  } {
    return {
      level: this.config.permissionLevel,
      tempFrames: this.tempFrameStore.size,
      auditEntries: this.auditLog.length,
      indicator: this.config.showIndicator,
    };
  }

  /** 清理 */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clearAllFrames();
    this.auditLog = [];
  }

  // ==================== 内部方法 ====================

  private _audit(
    action: PrivacyAuditEntry['action'],
    source: PrivacyAuditEntry['source'],
    anonymized: boolean,
    details?: string,
  ): void {
    this.auditLog.push({
      timestamp: Date.now(),
      action,
      source,
      permissionLevel: this.config.permissionLevel,
      anonymized,
      details,
    });

    if (this.auditLog.length > this.maxAuditEntries) {
      this.auditLog = this.auditLog.slice(-this.maxAuditEntries);
    }
  }

  private _cleanupExpiredFrames(): void {
    const now = Date.now();
    for (const [id, entry] of this.tempFrameStore) {
      if (now - entry.timestamp > this.config.retentionMs) {
        this.tempFrameStore.delete(id);
      }
    }
  }
}
