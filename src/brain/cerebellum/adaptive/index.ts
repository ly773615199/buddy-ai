/**
 * 自适应层 — Adaptive Layer
 *
 * 小脑的三层"条件反射"：
 * - RhythmAdaptor：节律自适配（调节心跳/梦境/后台频率）
 * - HabitMemory：肌肉记忆（高频 pattern 缓存，跳过完整链路）
 * - ErrorTuner：错误阈值自适应（弱化/强化告警）
 *
 * 全部归小脑 MAPE-K 循环统一管理
 */

export { RhythmAdaptor, type RhythmConfig, type RhythmState, type RhythmAdjustment } from './rhythm.js';
export { HabitMemory, type HabitConfig, type HabitEntry } from './habit.js';
export { ErrorTuner, type ErrorTunerConfig, type ErrorProfile, type ErrorSeverity } from './error-tuner.js';
