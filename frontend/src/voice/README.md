# 语音模块 — 前端/桌面端专用

> ⚠️ 此目录下的模块使用浏览器 API（`getUserMedia`、`MediaRecorder`、`AudioContext`、`SpeechRecognition` 等），
> **无法在 Node.js 后端运行**。

## 模块列表

| 模块 | 功能 | 浏览器 API |
|------|------|-----------|
| stt.ts | 语音识别 | `SpeechRecognition` / Whisper API |
| mic-manager.ts | 麦克风管理 | `getUserMedia({audio})` |
| audio-stream.ts | 音频流 | `MediaRecorder`, `AudioContext` |
| audio-interface.ts | 音频接口定义 | 类型引用 |
| wakeword.ts | 唤醒词检测 | `AudioContext`, `getUserMedia` |
| sound-events.ts | 声音事件检测 | `AudioContext`, `getUserMedia` |
| emotion-voice.ts | 语音情绪分析 | `AudioContext`, `getUserMedia` |
| index.ts | 统一入口 | Barrel 导出 |

## 后端保留模块

后端 `src/voice/` 保留以下 Node.js 可用模块：
- `tts.ts` — TTS 适配层
- `edge-tts.ts` — Edge TTS 后端
