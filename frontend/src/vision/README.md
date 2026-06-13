# 视觉模块 — 前端/桌面端专用

> ⚠️ 此目录下的模块使用浏览器 API（`navigator.mediaDevices`、`document`、`getUserMedia` 等），
> **无法在 Node.js 后端运行**。

## 模块列表

| 模块 | 功能 | 浏览器 API |
|------|------|-----------|
| camera.ts | 摄像头管理 | `getUserMedia`, `HTMLVideoElement` |
| camera-interface.ts | 摄像头接口定义 | 类型引用 |
| frame-capture.ts | 帧捕获策略 | 依赖 camera.ts |
| face-detect.ts | 人脸检测 | TensorFlow.js 浏览器模型 |
| scene-analyze.ts | 场景分析 | 依赖 camera.ts |
| screen.ts | 屏幕捕获 | `desktopCapturer` (Electron) |
| omni.ts | 多模态视觉适配 | 统一调度以上模块 |
| ocr.ts | OCR 识别 | 浏览器原生 OCR / 云端 API |
| privacy.ts | 视觉隐私控制 | 纯逻辑，无 API 依赖 |
| index.ts | 统一入口 | Barrel 导出 |

## 架构说明

这些模块从后端 `src/vision/` 迁移而来（2026-04-11），前端通过 WebSocket 与后端通信。
后端不再保留任何视觉模块。
