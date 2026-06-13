/**
 * 语音模块 — 统一入口
 */
export { TTSManager } from './tts.js';
export type { TTSOptions, TTSResult, TTSBackend, TTSVoice } from './tts.js';
export { SPECIES_VOICE_MAP } from './tts.js';
export { EdgeTTSBackend as EdgeTTS } from './edge-tts.js';

export { STTManager } from './stt.js';
export type { STTOptions, STTResult, STTBackend, STTStream } from './stt.js';
export { WebSpeechSTT, WhisperSTT } from './stt.js';

export { MicrophoneManager } from './mic-manager.js';
export type { MicConstraints, VolumeCallback } from './mic-manager.js';

export { AudioStreamManager } from './audio-stream.js';
export type { AudioStreamOptions, AudioChunkCallback, VADCallback } from './audio-stream.js';

export { WakeWordDetector } from './wakeword.js';
export type { WakeWordOptions, WakeWordResult } from './wakeword.js';

export { SoundEventDetector } from './sound-events.js';
export type { SoundEventType, SoundEvent, SoundDetectorOptions } from './sound-events.js';

export { VoiceEmotionAnalyzer } from './emotion-voice.js';
export type { VoiceEmotion, VoiceEmotionResult, VoiceFeatures, VoiceEmotionOptions } from './emotion-voice.js';
