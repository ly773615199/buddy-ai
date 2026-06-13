/**
 * 视觉模块 — 统一入口
 */
export { CameraManager } from './camera.js';
export type { CameraOptions } from './camera.js';

export { FrameCaptureManager, ManualCapture, IntervalCapture, MotionCapture } from './frame-capture.js';
export type { CaptureStrategyOptions, FrameCallback } from './frame-capture.js';

export { FaceDetector } from './face-detect.js';
export type { FaceDetectionResult, DetectedFace, FaceDetectorOptions, FaceDetectionBackend } from './face-detect.js';

export { SceneAnalyzer } from './scene-analyze.js';
export type { SceneAnalysisResult, DetectedObject, SceneAnalyzerOptions } from './scene-analyze.js';

export { VisionPrivacyManager } from './privacy.js';
export type { VisionPermissionLevel, PrivacyConfig, AnonymizeConfig, PrivacyAuditEntry } from './privacy.js';

export { OmniVision } from './omni.js';
export type { OmniVisionOptions, VisionAnalysisResult, VisionBackend, ImageAnalysisInput } from './omni.js';

export { OCRProcessor } from './ocr.js';
export type { OCRResult, OCRSegment, OCROptions, OCRBackend } from './ocr.js';

export { ScreenCapture } from './screen.js';
export type { ScreenCaptureOptions, ScreenCaptureResult, WindowInfo, ScreenAnalysisResult, ScreenSource } from './screen.js';
