/**
 * 多模态视觉适配层
 * 统一调度 Camera → FrameCapture → FaceDetect → SceneAnalyze
 * 支持多种视觉后端：GPT-4o Vision / MiMo Omni / 本地模型
 */

import { CameraManager, type CameraOptions } from './camera.js';
import { FrameCaptureManager, IntervalCapture, type CaptureStrategyOptions } from './frame-capture.js';
import { FaceDetector, type FaceDetectionResult, type FaceDetectorOptions } from './face-detect.js';
import { SceneAnalyzer, type SceneAnalysisResult, type SceneAnalyzerOptions } from './scene-analyze.js';
import { VisionPrivacyManager, type PrivacyConfig } from './privacy.js';

// ── 类型定义 ──

export type VisionBackend = 'gpt4v' | 'mimo-omni' | 'local-llava';

export interface OmniVisionOptions {
  /** 视觉后端 */
  backend?: VisionBackend;
  /** 摄像头选项 */
  camera?: CameraOptions;
  /** 帧捕获选项（定时间隔等） */
  capture?: CaptureStrategyOptions;
  /** 人脸检测选项 */
  face?: FaceDetectorOptions;
  /** 场景分析选项 */
  scene?: SceneAnalyzerOptions;
  /** 隐私配置 */
  privacy?: Partial<PrivacyConfig>;
  /** 信任度（用于隐私权限判断） */
  trustScore?: number;
}

export interface VisionAnalysisResult {
  /** 场景分析结果 */
  scene: SceneAnalysisResult | null;
  /** 人脸检测结果 */
  faces: FaceDetectionResult | null;
  /** 原始帧 base64 */
  frame: string | null;
  /** 综合描述 */
  summary: string;
  /** 处理耗时 ms */
  processingMs: number;
  /** 时间戳 */
  timestamp: number;
}

export interface ImageAnalysisInput {
  /** base64 编码的图片 */
  base64?: string;
  /** 图片 URL */
  url?: string;
  /** 图片 MIME 类型 */
  mimeType?: string;
  /** 分析提示词 */
  prompt?: string;
}

// ── 主类 ──

export class OmniVision {
  private camera: CameraManager;
  private captureManager: FrameCaptureManager;
  private faceDetector: FaceDetector;
  private sceneAnalyzer: SceneAnalyzer;
  private privacy: VisionPrivacyManager;
  private backend: VisionBackend;
  private trustScore: number;
  private monitoringInterval: IntervalCapture | null = null;
  private initialized = false;

  constructor(options: OmniVisionOptions = {}) {
    this.backend = options.backend || 'gpt4v';
    this.trustScore = options.trustScore ?? 50;

    this.camera = new CameraManager();
    this.captureManager = new FrameCaptureManager();
    this.faceDetector = new FaceDetector(options.face);
    this.sceneAnalyzer = new SceneAnalyzer(options.scene);
    this.privacy = new VisionPrivacyManager(options.privacy);
  }

  /** 初始化所有子模块 */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 检查隐私权限
    if (!this.privacy.canCapture(this.trustScore)) {
      throw new Error('摄像头权限未授予，请先授权');
    }

    this.initialized = true;
  }

  /** 拍照并进行完整分析 */
  async captureAndAnalyze(prompt?: string): Promise<VisionAnalysisResult> {
    const startTime = Date.now();

    await this.initialize();

    // 检查隐私
    if (!this.privacy.canCapture(this.trustScore)) {
      throw new Error('摄像头权限已被撤销');
    }

    // 捕获帧
    const frame = await this.camera.captureFrame();

    // 并行执行人脸检测和场景分析
    const [faces, scene] = await Promise.all([
      this.faceDetector.detect(frame).catch(() => null),
      this.sceneAnalyzer.analyze(frame, prompt).catch(() => null),
    ]);

    // 生成综合描述
    const summary = this.composeSummary(faces, scene);

    return {
      scene,
      faces,
      frame,
      summary,
      processingMs: Date.now() - startTime,
      timestamp: Date.now(),
    };
  }

  /** 分析用户提供的图片（非摄像头） */
  async analyzeImage(input: ImageAnalysisInput): Promise<SceneAnalysisResult> {
    const base64 = input.base64 || '';
    if (!base64 && !input.url) {
      throw new Error('需要提供 base64 或 url');
    }

    const imageData = base64 || input.url || '';
    return this.sceneAnalyzer.analyze(imageData, input.prompt);
  }

  /** 开始持续监控 */
  async startMonitoring(options?: {
    intervalMs?: number;
    onFrame?: (result: VisionAnalysisResult) => void;
  }): Promise<void> {
    await this.initialize();

    const intervalMs = options?.intervalMs || 5000;

    // 使用定时捕获策略
    this.monitoringInterval = this.captureManager.addInterval('omni-monitor', {
      intervalMs,
    });

    this.monitoringInterval.start(
      async (frameBase64: string) => {
        const startTime = Date.now();

        const [faces, scene] = await Promise.all([
          this.faceDetector.detect(frameBase64).catch(() => null),
          this.sceneAnalyzer.analyze(frameBase64).catch(() => null),
        ]);

        const summary = this.composeSummary(faces, scene);

        options?.onFrame?.({
          scene,
          faces,
          frame: frameBase64,
          summary,
          processingMs: Date.now() - startTime,
          timestamp: Date.now(),
        });
      },
      () => this.camera.captureFrame()
    );
  }

  /** 停止持续监控 */
  stopMonitoring(): void {
    this.monitoringInterval?.stop();
    this.monitoringInterval = null;
  }

  /** 获取可用摄像头设备 */
  async getDevices() {
    return this.camera.enumerateDevices();
  }

  /** 切换摄像头 */
  async switchCamera(deviceId: string): Promise<void> {
    this.camera.stopStream();
    await this.camera.startStream(deviceId);
  }

  /** 获取隐私状态 */
  getPrivacyStatus() {
    return {
      canCapture: this.privacy.canCapture(this.trustScore),
      canAutoAnalyze: this.privacy.canAutoAnalyze(this.trustScore),
      canStore: this.privacy.canStore(),
    };
  }

  /** 更新隐私配置 */
  updatePrivacy(config: Partial<PrivacyConfig>): void {
    this.privacy.updateConfig(config);
  }

  /** 更新信任度 */
  setTrustScore(score: number): void {
    this.trustScore = score;
  }

  /** 释放所有资源 */
  dispose(): void {
    this.stopMonitoring();
    this.camera.stopStream();
    this.privacy.destroy();
    this.initialized = false;
  }

  // ── 私有方法 ──

  private composeSummary(
    faces: FaceDetectionResult | null,
    scene: SceneAnalysisResult | null
  ): string {
    const parts: string[] = [];

    if (scene) {
      parts.push(`场景：${scene.description}`);
      if (scene.objects.length > 0) {
        const objs = scene.objects.map(o => o.name).join('、');
        parts.push(`检测到：${objs}`);
      }
      if (scene.actions?.length) {
        parts.push(`动作：${scene.actions.join('、')}`);
      }
    }

    if (faces && faces.faces.length > 0) {
      parts.push(`检测到 ${faces.faces.length} 张人脸`);
      for (const face of faces.faces) {
        if (face.expression) {
          parts.push(`表情：${face.expression}`);
        }
      }
    }

    return parts.length > 0 ? parts.join('；') : '未检测到明显内容';
  }
}
