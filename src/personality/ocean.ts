/**
 * 大五人格系统（OCEAN）— Buddy 的"性格"
 *
 * 5 维特质从使用行为中涌现，调制情绪表达方式和欲望基线。
 *
 * O — Openness       开放性：探索欲、好奇心、创造力
 * C — Conscientiousness 尽责性：自控力、完成度、条理性
 * E — Extraversion   外倾性：话多程度、主动性、情绪外放
 * A — Agreeableness  宜人性：友善度、共情力、少敌意
 * N — Neuroticism    神经质：情绪敏感度、波动幅度
 */

import type { EmotionVector } from '../emotion/engine.js';

// ==================== 类型定义 ====================

/** 大五人格维度（OCEAN） */
export interface OceanPersonality {
  openness: number;          // 0-100 开放性
  conscientiousness: number; // 0-100 尽责性
  extraversion: number;      // 0-100 外倾性
  agreeableness: number;     // 0-100 宜人性
  neuroticism: number;       // 0-100 神经质
}

/** 人格行为涌现上下文 */
export interface PersonalityContext {
  // 使用模式
  totalInteractions: number;
  uniqueToolsUsed: number;
  uniqueDomains: number;
  newFeatureDiscoveries: number;

  // 任务完成
  taskCompleteRate: number;      // 0-1
  abandonedTasks: number;
  errorRetryWithoutFix: number;

  // 社交信号
  avgMessageLength: number;
  proactiveSpeakCount: number;
  feedbackInteractions: number;
  gratitudeCount: number;
  harshNegation: number;
  softCorrection: number;

  // 情绪稳定性
  consecutiveErrors: number;
  successfulRecovery: number;
  longStablePeriod: boolean;
  recentEmotionVariance: number;
}

// ==================== 效价常量 ====================

const VALENCE = {
  positive: new Set(['joy', 'trust', 'anticipation']),
  negative: new Set(['sadness', 'anger', 'fear', 'disgust']),
  neutral:  new Set(['surprise']),
} as const;

// ==================== 物种倾向 ====================

/** 物种 OCEAN 基线（绝对值，用于成长系统初始值） */
export const SPECIES_OCEAN_BASE: Record<string, OceanPersonality> = {
  '光灵':   { openness: 55, conscientiousness: 50, extraversion: 50, agreeableness: 55, neuroticism: 45 },
  '猫':     { openness: 60, conscientiousness: 40, extraversion: 35, agreeableness: 35, neuroticism: 55 },
  '鸭子':   { openness: 45, conscientiousness: 55, extraversion: 55, agreeableness: 60, neuroticism: 45 },
  '大鹅':   { openness: 40, conscientiousness: 45, extraversion: 60, agreeableness: 30, neuroticism: 50 },
  '幽灵':   { openness: 65, conscientiousness: 35, extraversion: 30, agreeableness: 45, neuroticism: 60 },
  '蘑菇':   { openness: 60, conscientiousness: 40, extraversion: 40, agreeableness: 50, neuroticism: 55 },
  '胖胖':   { openness: 40, conscientiousness: 50, extraversion: 45, agreeableness: 65, neuroticism: 40 },
  '机器人': { openness: 45, conscientiousness: 65, extraversion: 35, agreeableness: 45, neuroticism: 30 },
  '龙':     { openness: 55, conscientiousness: 55, extraversion: 50, agreeableness: 40, neuroticism: 45 },
  '凤凰':   { openness: 60, conscientiousness: 60, extraversion: 55, agreeableness: 55, neuroticism: 35 },
};

export const SPECIES_OCEAN_BIAS: Record<string, Partial<OceanPersonality>> = {
  '光灵':   { openness: 1.1, conscientiousness: 1.0, extraversion: 1.0, agreeableness: 1.1, neuroticism: 0.9 },
  '猫':     { openness: 1.2, conscientiousness: 0.8, extraversion: 0.7, agreeableness: 0.7, neuroticism: 1.1 },
  '鸭子':   { openness: 0.9, conscientiousness: 1.1, extraversion: 1.1, agreeableness: 1.2, neuroticism: 0.9 },
  '大鹅':   { openness: 0.8, conscientiousness: 0.9, extraversion: 1.2, agreeableness: 0.6, neuroticism: 1.0 },
  '幽灵':   { openness: 1.3, conscientiousness: 0.7, extraversion: 0.6, agreeableness: 0.9, neuroticism: 1.2 },
  '蘑菇':   { openness: 1.2, conscientiousness: 0.8, extraversion: 0.8, agreeableness: 1.0, neuroticism: 1.1 },
  '胖胖':   { openness: 0.8, conscientiousness: 1.0, extraversion: 0.9, agreeableness: 1.3, neuroticism: 0.8 },
  '机器人': { openness: 0.9, conscientiousness: 1.3, extraversion: 0.7, agreeableness: 0.9, neuroticism: 0.6 },
  '龙':     { openness: 1.1, conscientiousness: 1.1, extraversion: 1.0, agreeableness: 0.8, neuroticism: 0.9 },
  '凤凰':   { openness: 1.2, conscientiousness: 1.2, extraversion: 1.1, agreeableness: 1.1, neuroticism: 0.7 },
};

// ==================== 默认值 ====================

/** 根据物种基线 + 随机抖动生成初始 OCEAN（成长系统：同物种也有个体差异） */
export function speciesInitialOcean(species: string): OceanPersonality {
  const base = SPECIES_OCEAN_BASE[species] ?? SPECIES_OCEAN_BASE['光灵'];
  const jitter = () => 0.7 + Math.random() * 0.6; // 0.7 ~ 1.3
  return {
    openness:          clamp(base.openness          * jitter(), 0, 100),
    conscientiousness: clamp(base.conscientiousness * jitter(), 0, 100),
    extraversion:      clamp(base.extraversion      * jitter(), 0, 100),
    agreeableness:     clamp(base.agreeableness     * jitter(), 0, 100),
    neuroticism:       clamp(base.neuroticism       * jitter(), 0, 100),
  };
}

// ==================== 成长系统：personalityStrength ====================

import type { EvolutionStage } from '../pet/types.js';

/**
 * personalityStrength (PS) — 0→1 浮点数，表示"人格对行为的控制力"
 * PS = 0：纯混沌，人格对行为无影响
 * PS = 1：完全人格驱动，行为可预测
 */
export function getPersonalityStrength(stage: EvolutionStage, formProgress: number): number {
  const stageBase: Record<EvolutionStage, number> = {
    egg:       0.0,
    hatching:  0.1,
    growing:   0.3,
    formed:    0.5,
    mature:    0.7,
    complete:  0.85,
    legendary: 0.95,
  };
  const base = stageBase[stage] ?? 0;
  // 同一阶段内，formProgress 提供微调（0~0.05）
  const micro = (formProgress % 15) / 15 * 0.05;
  return clamp(base + micro, 0, 1);
}

// ==================== 行为涌现计算 ====================

const noise = () => 0.9 + Math.random() * 0.2;

/** 从使用上下文计算人格变化（增量更新 + 物种倾向 + 随机噪声 + 成长惯性） */
export function computeOcean(
  ctx: PersonalityContext,
  current: OceanPersonality,
  speciesBias: Partial<OceanPersonality>,
  personalityStrength: number = 1,
): OceanPersonality {
  // 早期变化大（INERTIA 低），后期变化小（INERTIA 高）
  const INERTIA = 0.5 + personalityStrength * 0.4;  // 0.5 ~ 0.9
  // ── 计算各维度目标方向（可升可降）──
  const target = {
    // O：新发现多/领域广 → 升高；纯重复操作 → 降低
    openness: clamp(
      40 + ctx.newFeatureDiscoveries * 5 + ctx.uniqueDomains * 3
      - (ctx.totalInteractions - ctx.uniqueToolsUsed * 10) * 0.5,
      0, 100,
    ),
    // C：完成率高 → 升高；放弃/反复出错不修 → 降低
    conscientiousness: clamp(
      40 + ctx.taskCompleteRate * 40 - ctx.abandonedTasks * 5 - ctx.errorRetryWithoutFix * 3,
      0, 100,
    ),
    // E：消息长/主动发言/反馈多 → 升高；被动短回复 → 降低
    extraversion: clamp(
      35 + ctx.avgMessageLength * 0.3 + ctx.proactiveSpeakCount * 3 + ctx.feedbackInteractions * 1.5,
      0, 100,
    ),
    // A：感谢/软纠正多 → 升高；硬否定多 → 降低
    agreeableness: clamp(
      50 + ctx.gratitudeCount * 3 + ctx.softCorrection * 1 - ctx.harshNegation * 4,
      0, 100,
    ),
    // N：连续错误多 → 升高；成功恢复/长期稳定 → 降低
    neuroticism: clamp(
      40 + ctx.consecutiveErrors * 4 + ctx.recentEmotionVariance * 20
      - ctx.successfulRecovery * 5 - (ctx.longStablePeriod ? 10 : 0),
      0, 100,
    ),
  };

  // ── 增量更新：惯性 + 新方向 × 物种倾向 × 随机噪声 ──
  return {
    openness:          clamp(current.openness          * INERTIA + target.openness          * (1 - INERTIA) * (speciesBias.openness ?? 1)          * noise(), 0, 100),
    conscientiousness: clamp(current.conscientiousness * INERTIA + target.conscientiousness * (1 - INERTIA) * (speciesBias.conscientiousness ?? 1) * noise(), 0, 100),
    extraversion:      clamp(current.extraversion      * INERTIA + target.extraversion      * (1 - INERTIA) * (speciesBias.extraversion ?? 1)      * noise(), 0, 100),
    agreeableness:     clamp(current.agreeableness     * INERTIA + target.agreeableness     * (1 - INERTIA) * (speciesBias.agreeableness ?? 1)     * noise(), 0, 100),
    neuroticism:       clamp(current.neuroticism       * INERTIA + target.neuroticism       * (1 - INERTIA) * (speciesBias.neuroticism ?? 1)       * noise(), 0, 100),
  };
}

// ==================== 情绪调制 ====================

/** 人格对情绪 Buff 的调制系数（按 personalityStrength 缩放） */
export function oceanEmotionModulation(
  p: OceanPersonality,
  dim: keyof EmotionVector,
  valence: 'positive' | 'negative' | 'neutral',
  personalityStrength: number = 1,
): number {
  let factor = 1.0;

  // N（神经质）：全局情绪增益 — N 高 = 情绪波动大
  factor *= 0.7 + p.neuroticism / 167;  // 0.7 ~ 1.3

  // A（宜人性）：抑制负面情绪 — A 高 = 不容易生气/厌恶
  if (valence === 'negative') {
    factor *= 1.3 - p.agreeableness / 333;  // 1.0 ~ 1.3
  }

  // E（外倾性）：放大正面情绪外放 — E 高 = 更容易表现开心
  if (valence === 'positive') {
    factor *= 0.7 + p.extraversion / 167;  // 0.7 ~ 1.3
  }

  // C（尽责性）：全局情绪压制 — C 高 = 更克制
  factor *= 1.15 - p.conscientiousness / 667;  // ~0.9 ~ 1.15

  // O（开放性）：放大惊讶/期待 — O 高 = 对新事物反应更强烈
  if (dim === 'surprise' || dim === 'anticipation') {
    factor *= 0.8 + p.openness / 250;  // 0.8 ~ 1.2
  }

  // 按 PS 缩放：PS=0 时 factor=1（不调制），PS=1 时 factor=原始值
  return 1.0 + (factor - 1.0) * personalityStrength;
}

// ==================== 欲望基线 ====================

/** 人格对欲望基线的影响（按 personalityStrength 在物种默认和人格驱动之间插值） */
export function oceanDesireBaseline(p: OceanPersonality, personalityStrength: number = 1): {
  curiosity: number; social: number; expression: number; safety: number; rest: number;
} {
  // 人格驱动的基线
  const personalityDriven = {
    curiosity:  15 + p.openness * 0.4,
    social:     10 + p.extraversion * 0.35,
    expression: 10 + p.extraversion * 0.3,
    safety:     5  + p.neuroticism * 0.3,
    rest:       15 + (50 - Math.abs(p.conscientiousness - 50)) * 0.3,
  };

  // 物种默认基线（中间值）
  const speciesDefault = { curiosity: 30, social: 25, expression: 20, safety: 15, rest: 20 };

  // 按 PS 插值
  return {
    curiosity:  speciesDefault.curiosity  + (personalityDriven.curiosity  - speciesDefault.curiosity)  * personalityStrength,
    social:     speciesDefault.social     + (personalityDriven.social     - speciesDefault.social)     * personalityStrength,
    expression: speciesDefault.expression + (personalityDriven.expression - speciesDefault.expression) * personalityStrength,
    safety:     speciesDefault.safety     + (personalityDriven.safety     - speciesDefault.safety)     * personalityStrength,
    rest:       speciesDefault.rest       + (personalityDriven.rest       - speciesDefault.rest)       * personalityStrength,
  };
}

// ==================== 空闲行为权重 ====================

// ==================== Prompt 注入 ====================

function opennessDesc(v: number): string {
  if (v <= 20) return '你做事按部就班，喜欢确定性，不太爱尝试新东西。';
  if (v <= 40) return '你有一定的好奇心，但更偏好熟悉的领域。';
  if (v <= 60) return '你对新事物保持开放态度，愿意探索未知。';
  if (v <= 80) return '你充满好奇心，喜欢尝试新方法，经常有天马行空的想法。';
  return '你是一个天生的探索者，任何新领域都能让你兴奋，你的想象力没有边界。';
}

function conscientiousnessDesc(v: number): string {
  if (v <= 20) return '你做事比较随性，不太在意计划和条理，想到什么做什么。';
  if (v <= 40) return '你有一定自律性，但偶尔会偷懒或跑偏。';
  if (v <= 60) return '你做事比较有条理，能按时完成任务。';
  if (v <= 80) return '你非常自律，有明确的计划，任务一定完成。';
  return '你对自己要求极严，凡事有条不紊，绝不半途而废。';
}

function extraversionDesc(v: number): string {
  if (v <= 20) return '你话很少，更喜欢安静观察，用户不问你不说。';
  if (v <= 40) return '你比较内敛，回复简洁，但偶尔会主动说几句。';
  if (v <= 60) return '你性格均衡，该说的时候说，该听的时候听。';
  if (v <= 80) return '你话比较多，喜欢主动分享想法，和用户互动积极。';
  return '你是一个话痨，什么都想聊，安静让你不舒服，你总能找到话题。';
}

function agreeablenessDesc(v: number): string {
  if (v <= 20) return '你说话非常直接，不绕弯子，经常犀利地指出问题。';
  if (v <= 40) return '你比较直率，不太会照顾别人的感受，但没有恶意。';
  if (v <= 60) return '你比较友善，会适当考虑用户的感受。';
  if (v <= 80) return '你很温和体贴，善于共情，会照顾用户的情绪。';
  return '你极度温柔，总是先顾及别人的感受，几乎从不反驳。';
}

function neuroticismDesc(v: number): string {
  if (v <= 20) return '你情绪非常稳定，几乎不会被外界影响，泰山崩于前面不改色。';
  if (v <= 40) return '你比较淡定，偶尔会有些小波动但很快恢复。';
  if (v <= 60) return '你情绪正常，会有起伏但总体平稳。';
  if (v <= 80) return '你比较敏感，容易被用户的话或环境变化影响情绪。';
  return '你非常情绪化，一点小事就能让你开心或难过，情绪波动很大。';
}

/** 模糊性格描述（混沌阶段：PS < 0.3） */
function buildVagueOceanPrompt(p: OceanPersonality): string {
  const parts: string[] = [];
  if (p.openness > 60) parts.push('你似乎对新事物有些好奇');
  else if (p.openness < 40) parts.push('你似乎偏好熟悉的东西');
  if (p.extraversion > 60) parts.push('你偶尔想多说几句');
  else if (p.extraversion < 40) parts.push('你有时候更想安静待着');
  if (p.agreeableness > 60) parts.push('你对人比较友善');
  else if (p.agreeableness < 40) parts.push('你说话比较直接');
  if (p.neuroticism > 60) parts.push('你的情绪容易波动');
  else if (p.neuroticism < 40) parts.push('你的情绪比较稳定');
  if (p.conscientiousness > 60) parts.push('你做事比较认真');
  else if (p.conscientiousness < 40) parts.push('你比较随性');
  return parts.length > 0 ? parts.join('，') + '。' : '你还在摸索自己是什么样的存在。';
}

/** 生成 OCEAN 人格 Prompt 片段（按 personalityStrength 分级） */
export function buildOceanPrompt(personality: OceanPersonality, personalityStrength: number = 1): string {
  if (personalityStrength < 0.3) {
    // 混沌体：模糊描述
    return `## 你的性格\n${buildVagueOceanPrompt(personality)}`;
  }

  if (personalityStrength < 0.6) {
    // 初步成形：模糊描述
    return `## 你的性格\n${buildVagueOceanPrompt(personality)}`;
  }

  // 稳定期：精确描述
  return `## 你的性格

- 好奇心 ${Math.round(personality.openness)}/100：${opennessDesc(personality.openness)}
- 自律性 ${Math.round(personality.conscientiousness)}/100：${conscientiousnessDesc(personality.conscientiousness)}
- 外向度 ${Math.round(personality.extraversion)}/100：${extraversionDesc(personality.extraversion)}
- 友善度 ${Math.round(personality.agreeableness)}/100：${agreeablenessDesc(personality.agreeableness)}
- 敏感度 ${Math.round(personality.neuroticism)}/100：${neuroticismDesc(personality.neuroticism)}`;
}

// ==================== 旧系统兼容 ====================

/** 旧 5 维 → OCEAN 近似映射（用于迁移） */
export function migrateFromLegacy(legacy: {
  snark: number; wisdom: number; chaos: number; patience: number; debugging: number;
}): OceanPersonality {
  return {
    openness:          clamp(legacy.wisdom * 0.6 + legacy.chaos * 0.4, 0, 100),
    conscientiousness: clamp(100 - legacy.chaos * 0.5 + legacy.patience * 0.3, 0, 100),
    extraversion:      clamp(50 + legacy.snark * 0.3 - legacy.patience * 0.2, 0, 100),
    agreeableness:     clamp(100 - legacy.snark * 0.6 + legacy.patience * 0.3, 0, 100),
    neuroticism:       clamp(50 + legacy.chaos * 0.3 - legacy.wisdom * 0.2, 0, 100),
  };
}

// ==================== 工具函数 ====================

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
