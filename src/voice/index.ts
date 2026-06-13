/**
 * 语音模块 — 后端入口（Node.js 可用模块）
 *
 * ⚠️ 浏览器专属模块（stt, mic-manager, audio-stream, wakeword, sound-events, emotion-voice）
 * 已迁移至 frontend/src/voice/，此文件仅导出后端可用模块。
 */
export { TTSManager } from './tts.js';
export type { TTSOptions, TTSResult, TTSBackend, TTSVoice } from './tts.js';
export { SPECIES_VOICE_MAP } from './tts.js';
export { EdgeTTSBackend as EdgeTTS } from './edge-tts.js';
