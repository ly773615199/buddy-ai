/**
 * 情绪系统 — 统一入口
 */
export { computeEmotionParams, lerpEmotionParams, applyHueShift, EMOTION_LABELS, EMOTION_COLORS } from './emotion-particles';
export type { EmotionParticleParams } from './emotion-particles';
export { getEmotionVoiceParams, emotionToTTSOptions, getEmotionTransitionSFX, VOICE_EMOTION_HINTS } from './emotion-sound';
export type { EmotionVoiceParams, EmotionTransitionSFX } from './emotion-sound';
