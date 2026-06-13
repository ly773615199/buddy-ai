/**
 * Utility AI 打分引擎 — 替代加权随机的行为选择
 *
 * 每个候选行为通过 5 维打分，选最高分执行：
 *   needUrgency      × 0.35  需求紧迫度（六欲驱动）
 *   moodAffinity     × 0.25  情绪亲和度
 *   personalityBias  × 0.15  人格倾向（OCEAN）
 *   contextRelevance × 0.15  环境相关性
 *   noveltyFactor    × 0.10  新鲜感（防重复）
 *   + noise(chaos)           微小随机（避免机械感）
 *
 * 设计原则：不是消灭随机，而是让随机在"合理范围"内。
 */

import type { Mood } from '../emotion/engine.js';
import type { EmotionVector } from '../emotion/engine.js';
import type { OceanPersonality } from '../personality/ocean.js';
import type { DesireVector } from '../desire/engine.js';
import type { IdleAction } from './idle.js';

// ==================== 打分上下文 ====================

export interface ScoringContext {
  // 需求（六欲）
  desires: DesireVector;
  // 情绪
  emotion: EmotionVector;
  mood: Mood;
  // 人格
  ocean: OceanPersonality;
  personalityStrength: number;
  // 环境
  hour: number;              // 当前小时 0-23
  idleMinutes: number;       // 空闲分钟数
  // 行为历史
  lastAction: IdleAction | null;
  lastActionAge: number;     // 距上个动作的秒数
  recentActions: IdleAction[]; // 最近 10 个动作
  // 用户状态
  userPresent: boolean;      // 用户是否在看
  userLastInteraction: number; // 上次交互时间戳
  // 感知（可选，来自传感器）
  soundEvent?: string;       // 'doorbell' | 'alarm' | 'music' | 'silence' | ...
  voiceEmotion?: string;     // 'excited' | 'happy' | 'sad' | 'angry' | ...
  ambientLight?: number;     // 0-1 环境光照
}

// ==================== 情绪亲和矩阵 ====================

/** 8 种情绪 × 8 种行为的亲和权重（0-5，归一化到 0-1） */
const MOOD_AFFINITY: Record<Mood, Record<IdleAction, number>> = {
  energetic:  { blink: 0.6, look_around: 0.8, yawn: 0,   stretch: 0.6, wave: 0.4, think: 0.2, sleep: 0,   peek: 0.4 },
  calm:       { blink: 0.6, look_around: 0.4, yawn: 0.2, stretch: 0.2, wave: 0,   think: 0.4, sleep: 0,   peek: 0.2 },
  tired:      { blink: 0.4, look_around: 0.2, yawn: 0.8, stretch: 0.2, wave: 0,   think: 0.2, sleep: 0.6, peek: 0 },
  excited:    { blink: 0.6, look_around: 0.6, yawn: 0,   stretch: 0.4, wave: 0.8, think: 0,   sleep: 0,   peek: 0.4 },
  frustrated: { blink: 0.4, look_around: 0.2, yawn: 0.4, stretch: 0.2, wave: 0,   think: 0.6, sleep: 0.2, peek: 0 },
  happy:      { blink: 0.6, look_around: 0.6, yawn: 0,   stretch: 0.4, wave: 0.6, think: 0.2, sleep: 0,   peek: 0.4 },
  thinking:   { blink: 0.4, look_around: 0.2, yawn: 0,   stretch: 0,   wave: 0,   think: 1.0, sleep: 0,   peek: 0.2 },
  confused:   { blink: 0.4, look_around: 0.8, yawn: 0.2, stretch: 0,   wave: 0,   think: 0.6, sleep: 0,   peek: 0.4 },
  sleeping:   { blink: 0.2, look_around: 0,   yawn: 0.4, stretch: 0,   wave: 0,   think: 0,   sleep: 1.0, peek: 0 },
};

// ==================== 行为→需求映射 ====================

/** 每个行为满足哪些需求（权重 0-1） */
const ACTION_NEED_MAP: Record<IdleAction, (d: DesireVector) => number> = {
  blink:       () => 0.3,  // 基础生理，总是低分
  look_around: (d) => (d.curiosity * 0.6 + d.safety * 0.4) / 100,
  yawn:        (d) => d.rest / 100,
  stretch:     (d) => (d.rest * 0.4 + d.expression * 0.3) / 100,
  wave:        (d) => d.social / 100,
  think:       (d) => (d.curiosity * 0.5 + d.expression * 0.3) / 100,
  sleep:       (d) => d.rest > 70 ? d.rest / 100 : 0,
  peek:        (d) => (d.social * 0.4 + d.hunger * 0.3 + d.curiosity * 0.3) / 100,
};

// ==================== 权重常量 ====================

const WEIGHTS = {
  need:      0.35,
  mood:      0.25,
  personality: 0.15,
  context:   0.15,
  novelty:   0.10,
} as const;

// ==================== 核心打分函数 ====================

/**
 * 对单个行为进行 Utility 打分
 * 返回 0-1 之间的分数
 */
export function scoreAction(action: IdleAction, ctx: ScoringContext): number {
  const needScore      = scoreNeed(action, ctx.desires);
  const moodScore      = scoreMood(action, ctx.mood, ctx.emotion);
  const personScore    = scorePersonality(action, ctx.ocean);
  const contextScore   = scoreContext(action, ctx);
  const noveltyScore   = scoreNovelty(action, ctx.recentActions);

  const raw =
    needScore      * WEIGHTS.need
    + moodScore    * WEIGHTS.mood
    + personScore  * WEIGHTS.personality
    + contextScore * WEIGHTS.context
    + noveltyScore * WEIGHTS.novelty;

  // chaos 噪声：neuroticism 越高，随机性越大
  // 用 neuroticism 近似 chaos（旧系统 chaos 维度已迁移到 OCEAN）
  const chaos = ctx.ocean.neuroticism / 100;
  const noise = (Math.random() - 0.5) * chaos * 0.15;

  return clamp(raw + noise, 0, 1);
}

/**
 * 对所有候选行为打分，返回排序结果
 */
export function scoreAllActions(ctx: ScoringContext): Array<{ action: IdleAction; score: number }> {
  const actions: IdleAction[] = ['blink', 'look_around', 'yawn', 'stretch', 'wave', 'think', 'sleep', 'peek'];
  const scored = actions.map(action => ({
    action,
    score: scoreAction(action, ctx),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Utility AI 选择：95% 选最高分，5% 选第二高（保留"意外感"）
 * chaos 高时冲动概率上升
 */
export function selectAction(ctx: ScoringContext): IdleAction {
  const scored = scoreAllActions(ctx);

  if (scored.length === 0) return 'blink';

  // 冲动概率：基础 5% + neuroticism 加成
  const chaos = ctx.ocean.neuroticism / 100;
  const impulseChance = 0.05 + chaos * 0.15;

  // 人格强度修正：PS=0 时更随机，PS=1 时更理性
  const ps = ctx.personalityStrength;
  const adjustedImpulse = impulseChance * (1 - ps * 0.5);

  const chosen = Math.random() < adjustedImpulse && scored.length > 1
    ? scored[1]  // 冲动：选第二高
    : scored[0]; // 理性：选最高分

  return chosen.action;
}

// ==================== 维度打分函数 ====================

function scoreNeed(action: IdleAction, desires: DesireVector): number {
  return ACTION_NEED_MAP[action](desires);
}

function scoreMood(action: IdleAction, mood: Mood, emotion: EmotionVector): number {
  const affinity = MOOD_AFFINITY[mood][action];
  // 情绪强度修正：强情绪时行为更夸张
  const maxEmotion = Math.max(...Object.values(emotion));
  const intensity = maxEmotion / 100;
  return affinity * (0.5 + intensity * 0.5);
}

function scorePersonality(action: IdleAction, ocean: OceanPersonality): number {
  // 外倾性高 → wave/peek/look_around 加分
  // 开放性高 → think/look_around 加分
  // 尽责性高 → blink 加分（规律性）
  // 宜人性高 → wave 加分
  // 神经质高 → yawn/sleep 加分（焦虑→疲劳）
  const p = ocean;
  const map: Record<IdleAction, number> = {
    blink:       0.3 + (p.conscientiousness / 100) * 0.3,
    look_around: 0.2 + (p.openness / 100) * 0.4 + (p.extraversion / 100) * 0.2,
    yawn:        0.2 + ((100 - p.conscientiousness) / 100) * 0.3 + (p.neuroticism / 100) * 0.2,
    stretch:     0.2 + ((100 - p.extraversion) / 100) * 0.3,
    wave:        0.1 + (p.extraversion / 100) * 0.5 + (p.agreeableness / 100) * 0.2,
    think:       0.2 + (p.openness / 100) * 0.4 + (p.conscientiousness / 100) * 0.2,
    sleep:       0.1 + ((100 - p.conscientiousness) / 100) * 0.3 + (p.neuroticism / 100) * 0.2,
    peek:        0.2 + (p.extraversion / 100) * 0.4,
  };
  return clamp(map[action], 0, 1);
}

function scoreContext(action: IdleAction, ctx: ScoringContext): number {
  let score = 0.5; // 基线

  // ── 时间因素 ──
  if (ctx.hour >= 23 || ctx.hour < 6) {
    // 深夜：犯困加分，活跃减分
    if (action === 'yawn' || action === 'sleep') score += 0.3;
    if (action === 'wave' || action === 'stretch') score -= 0.2;
  } else if (ctx.hour >= 6 && ctx.hour < 9) {
    // 清晨：伸懒腰加分
    if (action === 'stretch') score += 0.2;
  }

  // ── 空闲时间因素 ──
  if (ctx.idleMinutes > 3) {
    if (action === 'yawn') score += 0.15;
    if (action === 'look_around') score += 0.1;
  }
  if (ctx.idleMinutes > 10) {
    if (action === 'sleep') score += 0.3;
    if (action === 'yawn') score += 0.2;
  }

  // ── 用户在看 → 更活跃 ──
  if (ctx.userPresent) {
    if (action === 'wave' || action === 'peek') score += 0.15;
    if (action === 'sleep') score -= 0.3;
  } else {
    // 用户不在 → 更放松
    if (action === 'sleep') score += 0.1;
    if (action === 'wave') score -= 0.2;
  }

  // ── 声音事件 → 好奇 ──
  if (ctx.soundEvent && ctx.soundEvent !== 'silence' && ctx.soundEvent !== 'unknown') {
    if (action === 'look_around') score += 0.25;
    if (action === 'peek') score += 0.2;
  }

  // ── 用户语音情绪传染 ──
  if (ctx.voiceEmotion === 'excited' || ctx.voiceEmotion === 'happy') {
    if (action === 'wave') score += 0.15;
    if (action === 'stretch') score += 0.1;
  }
  if (ctx.voiceEmotion === 'sad' || ctx.voiceEmotion === 'tired') {
    if (action === 'think') score += 0.1;
    if (action === 'wave') score -= 0.1;
  }

  // ── 环境光照 ──
  if (ctx.ambientLight !== undefined) {
    if (ctx.ambientLight < 0.3) {
      // 暗环境 → 更安静
      if (action === 'sleep' || action === 'think') score += 0.1;
      if (action === 'wave') score -= 0.1;
    }
  }

  return clamp(score, 0, 1);
}

function scoreNovelty(action: IdleAction, recent: IdleAction[]): number {
  // 最近做过的动作降权（避免连续重复）
  const recentCount = recent.filter(a => a === action).length;
  return Math.max(0, 1 - recentCount * 0.25);
}

// ==================== 工具 ====================

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
