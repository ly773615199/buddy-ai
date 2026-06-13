/**
 * 音频模块 — 统一入口
 */
export { getAudioEngine, AudioEngine } from './engine.js';
export type { SoundCategory, VolumeState, AudioEngineState } from './engine.js';
export { playSFX, playMoodSFX, playEventSFX, UI_SFX, SPRITE_SFX, EMOTION_SFX, EVENT_SFX } from './sfx-player.js';
export type { SFXParams } from './sfx-player.js';
export { useAudio } from './use-audio.js';
