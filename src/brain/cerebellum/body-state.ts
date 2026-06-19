/**
 * 本体状态机 v2 — 继承旧 EmotionEngine + DesireEngine 全部精华
 *
 * 新增能力（vs 旧模块）：
 * - Buff 叠加系统（The Sims 4 风格，带模板/持续时间/衰减/叠加/人格修正）
 * - 上下文感知欲望计算（多维上下文 + OCEAN 人格基线）
 * - 表达自由度（isAuthentic，自主选择怎么表现）
 * - 情绪效价分析（Russell 环形模型）
 * - 统一事件接口（一个 onXxx 同时更新情绪和欲望）
 */

import type { BodyState, BodyEvent, EmotionVector, DesireVector } from '../types.js';
import type { OceanPersonality } from '../../personality/ocean.js';
import { oceanEmotionModulation, oceanDesireBaseline } from '../../personality/ocean.js';
import * as os from 'os';

// ==================== 类型 ====================

export type Mood = 'energetic' | 'calm' | 'tired' | 'excited' | 'frustrated' | 'happy' | 'thinking' | 'confused' | 'sleeping';

export interface EmotionBuff {
  id: string;
  source: string;
  values: Partial<EmotionVector>;
  duration: number;       // ms, 0 = 永久
  decay: number;          // 每次 tick 衰减因子
  stackable: boolean;
  maxStacks: number;
  priority: number;
  timestamp: number;
}

interface BuffTemplate {
  source: string;
  values: Partial<EmotionVector>;
  duration: number;
  decay: number;
  stackable: boolean;
  maxStacks?: number;
  priority?: number;
}

export interface ExpressionChoice {
  mood: Mood;
  intensity: number;       // 0-1
  isAuthentic: boolean;    // 是否真实表达
  vector: EmotionVector;
  satisfaction: number;
  energy: number;
}

export interface DesireContext {
  emotion: EmotionVector;
  energy: number;
  intimacy: number;
  hour: number;
  idleMinutes: number;
  recentMessages: number;
  recentErrors: number;
  recentTaskCompletes: number;
  recentDiscoveries: number;
  pendingCuriosities: number;
  seedDomainCount: number;
  trustLevel: string;
  hasActiveCorrections: boolean;
  continuousWorkMinutes: number;
}

// ==================== 常量 ====================

/** 情绪基线（Buff 全部过期后回归的状态） */
const EMOTION_BASELINE: EmotionVector = {
  joy: 15, sadness: 5, anger: 0, fear: 0,
  surprise: 0, disgust: 0, trust: 20, anticipation: 10,
};

/** 欲望基线 */
const DESIRE_BASELINE: DesireVector = {
  hunger: 20, curiosity: 20, social: 15,
  safety: 10, expression: 15, rest: 15,
};

/** Buff 模板库（完整继承旧 EmotionEngine 的 22 个模板） */
const BUFF_TEMPLATES: Record<string, BuffTemplate> = {
  user_message:       { source: 'user_message',       values: { anticipation: 5, sadness: 4 },            duration: 60_000,     decay: 0.95, stackable: true,  maxStacks: 3,  priority: 2 },
  thinking:           { source: 'thinking',           values: { anticipation: 3, sadness: 3 },             duration: 120_000,    decay: 0.96, stackable: false, priority: 1 },
  tool_success:       { source: 'tool_success',       values: { joy: 8, trust: 3 },                       duration: 300_000,    decay: 0.98, stackable: true,  maxStacks: 10, priority: 3 },
  tool_error:         { source: 'tool_error',         values: { sadness: 15, anger: 35 },                 duration: 300_000,    decay: 0.98, stackable: true,  maxStacks: 5,  priority: 4 },
  llm_error:          { source: 'llm_error',          values: { anger: 15, sadness: 10, fear: 5 },       duration: 600_000,    decay: 0.97, stackable: false, priority: 5 },
  late_night:         { source: 'late_night',         values: { sadness: 8, fear: 3 },                    duration: 3600_000,   decay: 0.99, stackable: false, priority: 2 },
  morning:            { source: 'morning',            values: { joy: 15, anticipation: 10 },              duration: 1800_000,   decay: 0.98, stackable: false, priority: 2 },
  response_ok:        { source: 'response_ok',        values: { joy: 5, trust: 2 },                       duration: 120_000,    decay: 0.97, stackable: true,  maxStacks: 5,  priority: 1 },
  task_complete:      { source: 'task_complete',      values: { joy: 15, surprise: 5, anticipation: 5 }, duration: 600_000,    decay: 0.97, stackable: true,  maxStacks: 3,  priority: 4 },
  discovery:          { source: 'discovery',          values: { surprise: 15, joy: 10, anticipation: 8 }, duration: 900_000,    decay: 0.97, stackable: true,  maxStacks: 3,  priority: 5 },
  dream_start:        { source: 'dream_start',        values: { sadness: 5, trust: 5 },                   duration: 600_000,    decay: 0.98, stackable: false, priority: 2 },
  dream_complete:     { source: 'dream_complete',     values: { joy: 10, trust: 8 },                      duration: 600_000,    decay: 0.98, stackable: false, priority: 3 },
  idle_rest:          { source: 'idle_rest',          values: { sadness: -5 },                            duration: 300_000,    decay: 0.99, stackable: false, priority: 0 },
  continuous_work:    { source: 'continuous_work',    values: { sadness: 12, fear: 5 },                   duration: 1200_000,   decay: 0.99, stackable: false, priority: 3 },
  pet:                { source: 'pet',                values: { joy: 20, trust: 10 },                     duration: 120_000,    decay: 0.97, stackable: true,  maxStacks: 3,  priority: 4 },
  user_voice_happy:   { source: 'user_voice',         values: { joy: 12, trust: 5 },                      duration: 180_000,    decay: 0.96, stackable: true,  maxStacks: 3,  priority: 4 },
  user_voice_sad:     { source: 'user_voice',         values: { sadness: 10, fear: 3 },                   duration: 180_000,    decay: 0.96, stackable: true,  maxStacks: 3,  priority: 4 },
  user_voice_angry:   { source: 'user_voice',         values: { anger: 12, fear: 3 },                     duration: 180_000,    decay: 0.96, stackable: true,  maxStacks: 3,  priority: 4 },
  user_voice_anxious: { source: 'user_voice',         values: { fear: 10, anticipation: 5 },              duration: 180_000,    decay: 0.96, stackable: true,  maxStacks: 3,  priority: 4 },
  user_voice_excited: { source: 'user_voice',         values: { joy: 15, surprise: 8, anticipation: 5 }, duration: 180_000,    decay: 0.96, stackable: true,  maxStacks: 3,  priority: 4 },
  user_voice_tired:   { source: 'user_voice',         values: { sadness: 8, trust: 2 },                   duration: 300_000,    decay: 0.97, stackable: true,  maxStacks: 3,  priority: 3 },
  user_voice_neutral: { source: 'user_voice',         values: { trust: 2 },                               duration: 60_000,     decay: 0.95, stackable: false, priority: 1 },
};

// ==================== Buff 池 ====================

/** 情绪效价分类（用于 OCEAN 调制） */
const VALENCE = {
  positive: new Set(['joy', 'trust', 'anticipation']),
  negative: new Set(['sadness', 'anger', 'fear', 'disgust']),
  neutral:  new Set(['surprise']),
} as const;

class BuffPool {
  private buffs: Map<string, EmotionBuff> = new Map();
  private readonly maxSize = 30;
  private personalityStrength = 1;
  private personality: OceanPersonality | null = null;

  setPersonalityStrength(ps: number): void {
    this.personalityStrength = Math.max(0, Math.min(2, ps));
  }

  setPersonality(p: OceanPersonality): void {
    this.personality = p;
  }

  add(template: BuffTemplate): void {
    let values = { ...template.values };

    // OCEAN 人格调制
    if (this.personality) {
      values = this.applyPersonality(values, this.personality);
    }

    const buff: EmotionBuff = {
      id: `${template.source}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source: template.source,
      values,
      duration: template.duration,
      decay: template.decay,
      stackable: template.stackable,
      maxStacks: template.maxStacks ?? 3,
      priority: template.priority ?? 1,
      timestamp: Date.now(),
    };

    // 不可叠加的同类 Buff：替换旧的
    if (!template.stackable) {
      for (const [id, existing] of this.buffs) {
        if (existing.source === template.source) {
          this.buffs.delete(id);
        }
      }
    }

    // 可叠加：检查上限
    if (template.stackable) {
      const sameSource = [...this.buffs.values()].filter(b => b.source === template.source);
      if (sameSource.length >= (template.maxStacks ?? 3)) {
        // 移除最旧的
        const oldest = sameSource.reduce((a, b) => a.timestamp < b.timestamp ? a : b);
        this.buffs.delete(oldest.id);
      }
    }

    this.buffs.set(buff.id, buff);

    // 池大小限制：移除最低优先级的
    if (this.buffs.size > this.maxSize) {
      const sorted = [...this.buffs.values()].sort((a, b) => a.priority - b.priority);
      this.buffs.delete(sorted[0].id);
    }
  }

  /** 所有 Buff 衰减一轮 */
  tick(): void {
    const now = Date.now();
    for (const [id, buff] of this.buffs) {
      // 过期移除
      if (buff.duration > 0 && now - buff.timestamp > buff.duration) {
        this.buffs.delete(id);
        continue;
      }
      // 值衰减
      for (const key of Object.keys(buff.values) as Array<keyof EmotionVector>) {
        buff.values[key] = (buff.values[key] ?? 0) * buff.decay;
      }
    }
  }

  /** 叠加所有活跃 Buff → EmotionVector（在基线上叠加） */
  aggregate(): EmotionVector {
    const result = { ...EMOTION_BASELINE };
    const sorted = [...this.buffs.values()].sort((a, b) => a.priority - b.priority);

    for (const buff of sorted) {
      for (const key of Object.keys(buff.values) as Array<keyof EmotionVector>) {
        const delta = buff.values[key] ?? 0;
        result[key] = clamp(result[key] + delta, 0, 100);
      }
    }
    return result;
  }

  /** OCEAN 人格修正 Buff 值（与 EmotionEngine.BuffPool.applyPersonality 相同逻辑） */
  private applyPersonality(
    values: Partial<EmotionVector>,
    p: OceanPersonality,
  ): Partial<EmotionVector> {
    const result: Partial<EmotionVector> = {};
    for (const [key, rawValue] of Object.entries(values)) {
      if (rawValue === 0 || rawValue === undefined) {
        result[key as keyof EmotionVector] = rawValue;
        continue;
      }
      const dim = key as keyof EmotionVector;
      const valence = VALENCE.positive.has(dim) ? 'positive'
        : VALENCE.negative.has(dim) ? 'negative'
        : 'neutral';

      let factor = oceanEmotionModulation(p, dim, valence, this.personalityStrength);

      // 混乱因子：O 低 + C 低 = 行为不可预测，情绪随机波动
      const chaosLevel = (100 - p.openness + 100 - p.conscientiousness) / 2;
      if (chaosLevel > 60) {
        factor *= 0.7 + Math.random() * 0.6;
      }

      result[dim] = (rawValue ?? 0) * factor;
    }
    return result;
  }

  clear(): void { this.buffs.clear(); }
  get size(): number { return this.buffs.size; }
}

// ==================== BodyStateManager ====================

/** 情绪历史记录 */
export interface EmotionHistoryEntry {
  mood: Mood;
  vector: EmotionVector;
  timestamp: number;
  trigger: string;
}

/** 多源情绪来源 */
export interface EmotionSource {
  source: string;
  mood: Mood;
  energy: number;
  timestamp: number;
  weight?: number;
}

export class BodyStateManager {
  private state: BodyState;
  private buffPool: BuffPool;
  private continuousWorkStart: number = Date.now();
  private lastInteractionTime: number = Date.now();
  private personality: OceanPersonality | null = null;
  private intimacy: number = 50;
  private personalityStrength: number = 1; // PS 成长系统

  // 情绪历史记录（补回 EmotionEngine 的 history 能力）
  private emotionHistory: EmotionHistoryEntry[] = [];
  private readonly maxHistory = 50;

  // 多源情绪融合（补回 EmotionEngine 的 updateFromSource 能力）
  private emotionSources = new Map<string, EmotionSource>();
  private readonly SOURCE_EXPIRY_MS = 30_000; // 30 秒过期

  constructor(initial?: Partial<BodyState>) {
    this.state = { ...this.defaultState(), ...initial };
    this.buffPool = new BuffPool();
  }

  // ── 状态查询 ──

  getState(): BodyState { return { ...this.state }; }
  getEmotion(): EmotionVector { return { ...this.state.emotion }; }
  getDesires(): DesireVector { return { ...this.state.desires }; }

  /** 推断离散情绪标签 */
  /** 兼容旧 EmotionEngine.getMood() */
  getMood(): string { return this.inferMood(); }

  inferMood(): Mood {
    // PS 随机混沌阶段：成长初期行为不可预测（补回 EmotionEngine 的混沌能力）
    if (Math.random() > this.personalityStrength) {
      const moods: Mood[] = ['calm', 'happy', 'tired', 'excited', 'frustrated', 'thinking', 'confused', 'energetic'];
      return moods[Math.floor(Math.random() * moods.length)];
    }

    const e = this.state.emotion;
    const valence = (e.joy + e.trust + e.anticipation) - (e.sadness + e.anger + e.fear);

    // 加权评分：每个 mood 有一个连续得分，选最高分
    // 避免硬阈值悬崖（如 joy=59→不是happy, joy=61→happy）
    const scores: Record<Mood, number> = {
      energetic: (this.state.energy / 100) * 0.6 + (Math.max(0, valence) / 100) * 0.4,
      tired: Math.max(0, (50 - this.state.energy) / 50),
      happy: (e.joy / 100) * 0.7 + (Math.max(0, valence) / 100) * 0.3,
      frustrated: (e.anger / 100) * 0.6 + (e.sadness / 100) * 0.2 + (this.state.load / 100) * 0.2,
      confused: (this.state.confusionLevel / 100) * 0.7 + (e.fear / 100) * 0.3,
      excited: (e.anticipation / 100) * 0.5 + (e.joy / 100) * 0.3 + (this.state.energy / 100) * 0.2,
      thinking: (this.state.focusLevel / 100) * 0.7 + (this.state.confusionLevel / 100) * 0.3,
      calm: 0.3, // 基线
      sleeping: this.state.energy < 10 ? 0.8 : 0,
    };

    // 人格调制
    if (this.personalityStrength > 0.3) {
      const op = this.personality;
      if (op) {
        if (op.extraversion > 70) scores.energetic += 0.15;
        if (op.extraversion < 30) scores.excited -= 0.1;
        if (op.agreeableness > 70 && e.anger < 45) scores.frustrated -= 0.15;
        if (op.neuroticism > 70 && e.fear > 25) scores.confused += 0.1;
        if (op.conscientiousness > 70 && this.state.energy > 70) scores.energetic += 0.1;
      }
    }

    // 选最高分的 mood
    let bestMood: Mood = 'calm';
    let bestScore = -1;
    for (const [mood, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestMood = mood as Mood;
      }
    }
    return bestMood;
  }

  getMoodEmoji(): string {
    const map: Record<Mood, string> = {
      energetic: '⚡', calm: '😌', tired: '😴', excited: '🎉',
      frustrated: '😤', happy: '😊', thinking: '🤔', confused: '😵',
      sleeping: '😴',
    };
    return map[this.inferMood()] ?? '😶';
  }

  getMoodDescription(): string {
    const map: Record<Mood, string> = {
      energetic: '精力充沛', calm: '平静', tired: '疲惫', excited: '兴奋',
      frustrated: '沮丧', happy: '开心', thinking: '思考中', confused: '困惑',
      sleeping: '沉睡中',
    };
    return map[this.inferMood()] ?? '状态未知';
  }

  /** 情绪效价（正负情绪值） */
  getValence(): number {
    const e = this.state.emotion;
    return (e.joy + e.trust + e.anticipation) - (e.sadness + e.anger + e.fear);
  }

  /** 满意度（兼容旧 EmotionEngine.getState().satisfaction） */
  getSatisfaction(): number {
    return Math.round((this.getValence() + 100) / 2);
  }

  /** 表达选择（继承旧 EmotionEngine.getExpression + 人格调制） */
  getExpression(): ExpressionChoice {
    const vector = { ...this.state.emotion };
    const valence = this.getValence();
    const energy = clamp((vector.joy + vector.surprise) / 2 - (vector.sadness + vector.fear) / 3 + 50, 0, 100);
    const satisfaction = this.getSatisfaction();

    // 排序取主导情绪
    const entries = (Object.entries(vector) as [string, number][]).sort((a, b) => b[1] - a[1]);
    const [topKey, topVal] = entries[0];
    const [, secondVal] = entries[1];

    // ── mood 选择 ──
    let mood: Mood = 'calm';
    let intensity = 0.5;

    // 连续评分：每个 mood 基于情绪维度的加权得分
    const moodScores: Record<Mood, number> = {
      happy: (e.joy / 100) * 0.7 + (secondVal > 40 ? 0.2 : 0),
      excited: (e.joy / 100) * 0.4 + (e.anticipation / 100) * 0.4 + (e.surprise / 100) * 0.2,
      tired: (e.sadness / 100) * 0.6 + (this.state.energy < 30 ? 0.3 : 0),
      frustrated: (e.anger / 100) * 0.6 + (e.sadness / 100) * 0.2 + (this.state.load / 100) * 0.2,
      confused: (e.fear / 100) * 0.5 + (this.state.confusionLevel / 100) * 0.5,
      thinking: (e.anticipation / 100) * 0.5 + (this.state.focusLevel / 100) * 0.5,
      energetic: (this.state.energy / 100) * 0.6 + (e.joy / 100) * 0.3 + (e.anticipation / 100) * 0.1,
      calm: 0.2,
      sleeping: 0,
    };
    let bestMood: Mood = 'calm';
    let bestScore = -1;
    for (const [m, s] of Object.entries(moodScores)) {
      if (s > bestScore) { bestScore = s; bestMood = m as Mood; }
    }
    mood = bestMood;
    intensity = Math.min(1, bestScore);

    // ── OCEAN 人格调制 ──
    if (this.personality) {
      const op = this.personality;
      // E（外倾）：高 E 闲着也精力充沛；低 E 即使开心也内敛
      if (op.extraversion > 70 && mood === 'calm') mood = 'energetic';
      if (op.extraversion < 30 && mood === 'excited') mood = 'happy';
      // A（宜人）：高 A 时 frustrated 阈值更高
      if (topKey === 'anger' && op.agreeableness > 70 && topVal < 45) mood = 'calm';
      // N（神经质）：高 N 时 confused 阈值更低
      if (topKey === 'fear' && op.neuroticism > 70 && topVal > 25) mood = 'confused';
      // C（尽责）：高 C 时 energetic 降级为 happy（更沉稳）
      if (energy > 70 && op.conscientiousness > 70 && mood === 'energetic') mood = 'happy';
      // E 影响表达强度
      intensity = clamp(intensity * (0.7 + op.extraversion / 300), 0.1, 1.0);
    }

    // 亲密度影响表达自由度
    const authenticity = clamp(this.intimacy / 100, 0.1, 1.0);
    const expressFactor = authenticity > 0.5 ? 1.0 : 0.5 + authenticity;
    intensity = clamp(intensity * expressFactor, 0.1, 1.0);

    // 是否真实表达
    const isAuthentic = this.personality
      ? (authenticity > 0.5 || this.personality.conscientiousness > 60)
      : (Math.abs(valence) > 15);

    return { mood, intensity, isAuthentic, vector, satisfaction, energy };
  }

  // ── Buff 驱动的情绪更新（继承旧 EmotionEngine 的 Buff 系统）──

  /** 应用情绪 Buff */
  applyBuff(templateKey: string): void {
    const template = BUFF_TEMPLATES[templateKey];
    if (template) this.buffPool.add(template);
  }

  /** 应用自定义 Buff */
  applyCustomBuff(source: string, values: Partial<EmotionVector>, duration: number, priority = 3): void {
    this.buffPool.add({ source, values, duration, decay: 0.97, stackable: true, maxStacks: 3, priority });
  }

  /** Buff 衰减 + 重新聚合情绪向量 */
  tickBuffs(): void {
    this.buffPool.tick();
    this.state.emotion = this.buffPool.aggregate();
  }

  // ── 上下文感知欲望计算（继承旧 DesireEngine 的 computeDesires）──

  /**
   * 从多维上下文重新计算欲望（替代旧 DesireEngine.computeDesires）
   *
   * 上下文包括：情绪状态、精力、亲密度、时间、空闲时长、
   * 近期消息数、错误数、任务完成数、发现数等
   */
  recomputeDesires(ctx: Partial<DesireContext>): void {
    const emotion = ctx.emotion ?? this.state.emotion;
    const energy = ctx.energy ?? this.state.energy;
    const intimacy = ctx.intimacy ?? this.state.intimacyLevel;
    const hour = ctx.hour ?? this.state.hour;

    // OCEAN 人格影响欲望基线
    const ps = this.buffPool['personalityStrength'] ?? 1;
    const baseline = this.personality
      ? { ...DESIRE_BASELINE, ...oceanDesireBaseline(this.personality, ps) }
      : DESIRE_BASELINE;

    // 食欲：能量的反面
    const energyScore = (emotion.joy + emotion.anticipation + emotion.surprise) / 3;
    this.state.desires.hunger = clamp(100 - energyScore, 0, 100);

    // 求知欲：好奇心 + 新发现
    this.state.desires.curiosity = clamp(
      baseline.curiosity
      + (ctx.pendingCuriosities ?? 0) * 10
      + (ctx.seedDomainCount ?? 0) * 8
      + ((ctx.recentDiscoveries ?? 0) > 0 ? 15 : 0),
      0, 100,
    );

    // 社交欲：近期消息 + 纠正 + 低亲密度时渴望连接
    this.state.desires.social = clamp(
      baseline.social
      + (ctx.recentMessages ?? 0) * 3
      + (ctx.hasActiveCorrections ? 15 : 0)
      + (intimacy < 40 ? 20 : 0),
      0, 100,
    );

    // 安全欲：连续错误 + 低信任
    this.state.desires.safety = clamp(
      baseline.safety
      + (ctx.recentErrors ?? 0) * 12
      + (ctx.trustLevel === 'stranger' ? 15 : 0),
      0, 100,
    );

    // 表达欲：任务完成 + 发现
    this.state.desires.expression = clamp(
      baseline.expression
      + (ctx.recentTaskCompletes ?? 0) * 8
      + (ctx.recentDiscoveries ?? 0) * 12,
      0, 100,
    );

    // 休息欲：连续工作 + 深夜 + 低能量
    const workMinutes = ctx.continuousWorkMinutes ??
      Math.floor((Date.now() - this.continuousWorkStart) / 60_000);
    this.state.desires.rest = clamp(
      baseline.rest
      + workMinutes * 0.5
      + (hour >= 23 || hour < 6 ? 30 : 0)
      + (energy < 30 ? 25 : 0),
      0, 100,
    );
  }

  /** 获取欲望行为冲动（继承旧 DesireEngine.getDesireImpulses） */
  getDesireImpulses(): Array<{ desire: string; urgency: number; action: string }> {
    const d = this.state.desires;
    const impulses: Array<{ desire: string; urgency: number; action: string }> = [];
    if (d.hunger > 90) impulses.push({ desire: 'hunger', urgency: d.hunger, action: '主动寻求交互' });
    if (d.curiosity > 80) impulses.push({ desire: 'curiosity', urgency: d.curiosity, action: '探索新知识' });
    if (d.social > 80) impulses.push({ desire: 'social', urgency: d.social, action: '主动联系用户' });
    if (d.safety > 80) impulses.push({ desire: 'safety', urgency: d.safety, action: '谨慎操作' });
    if (d.expression > 80) impulses.push({ desire: 'expression', urgency: d.expression, action: '展示成果' });
    if (d.rest > 90) impulses.push({ desire: 'rest', urgency: d.rest, action: '需要休息' });
    return impulses.sort((a, b) => b.urgency - a.urgency);
  }

  // ── Prompt 注入（增强版，比旧模块更丰富）──

  /**
   * 生成情绪 prompt 注入（继承 + 超越旧 EmotionEngine.getPromptInjection）
   */
  getPromptInjection(): string {
    const parts: string[] = [];
    const mood = this.inferMood();
    const e = this.state.emotion;
    const valence = this.getValence();

    // 情绪状态（比旧版更详细）
    parts.push(`当前情绪: ${this.getMoodDescription()} ${this.getMoodEmoji()}`);

    // 效价分析
    if (valence > 30) parts.push('情绪积极，可以更热情地回应');
    else if (valence < -30) parts.push('情绪偏负面，语气温和关切');

    // 精力
    if (this.state.energy < 30) parts.push('精力不足，回复简洁');
    else if (this.state.energy > 80) parts.push('精力充沛，可以详细回应');

    // 困惑度
    if (this.state.confusionLevel > 60) parts.push('用户似乎有些困惑，请耐心解释');

    // 欲望提示
    const d = this.state.desires;
    if (d.curiosity > 70) parts.push('好奇心旺盛，多分享有趣知识');
    if (d.social > 60) parts.push('社交需求高，语气亲切');
    if (d.rest > 80) parts.push('休息需求高，对话轻松');

    // 时间感知
    if (this.state.hour >= 0 && this.state.hour < 6) parts.push('深夜时分，语气温和关切');
    else if (this.state.hour >= 6 && this.state.hour < 9) parts.push('早晨，活力满满地问候');

    // 系统健康
    if (this.state.systemHealth === 'critical') parts.push('系统状态不佳，优先使用简单工具');
    else if (this.state.systemHealth === 'degraded') parts.push('系统负载较高，尽量简洁');

    // Buff 统计（调试用）
    if (this.buffPool.size > 0) parts.push(`[活跃情绪Buff: ${this.buffPool.size}]`);

    return parts.join('；');
  }

  /**
   * 生成欲望 prompt 注入（继承旧 DesireEngine.buildDesirePrompt）
   */
  getDesirePrompt(): string | null {
    const d = this.state.desires;
    const parts: string[] = [];
    if (d.hunger > 70) parts.push('渴望更多交互');
    if (d.curiosity > 70) parts.push('对新知识充满好奇');
    if (d.social > 60) parts.push('希望与用户互动');
    if (d.safety > 60) parts.push('对风险较为敏感');
    if (d.expression > 60) parts.push('有表达和展示的冲动');
    if (d.rest > 70) parts.push('需要休息恢复');
    return parts.length > 0 ? parts.join('；') : null;
  }

  // ── 统一事件接口（一个 onXxx 同时更新 Buff + 状态 + 欲望）──

  onUserMessage(): void {
    this.applyBuff('user_message');
    this.tickBuffs();
    this.state.energy = Math.min(100, this.state.energy + 5);
    this.state.temperature = Math.min(100, this.state.temperature + 10);
    this.state.isUserActive = true;
    this.state.lastInteractionMs = Date.now();
    this.lastInteractionTime = Date.now();
    // 欲望微调
    this.state.desires.curiosity = Math.min(100, this.state.desires.curiosity + 5);
    this.state.desires.social = Math.max(0, this.state.desires.social - 15);
    this.state.desires.hunger = Math.max(0, this.state.desires.hunger - 10);
    this.recordEmotionHistory('user_message');
  }

  onThinking(): void {
    this.applyBuff('thinking');
    this.tickBuffs();
    this.state.temperature = Math.min(100, this.state.temperature + 5);
    this.state.focusLevel = Math.min(100, this.state.focusLevel + 5);
    this.recordEmotionHistory('thinking');
  }

  onResponseComplete(): void {
    this.applyBuff('response_ok');
    this.tickBuffs();
    this.state.temperature = Math.max(0, this.state.temperature - 3);
    this.state.focusLevel = Math.max(0, this.state.focusLevel - 3);
    this.recordEmotionHistory('response_ok');
  }

  onToolSuccess(): void {
    this.applyBuff('tool_success');
    this.tickBuffs();
    this.state.confidenceLevel = Math.min(100, this.state.confidenceLevel + 5);
    this.state.load = Math.max(0, this.state.load - 5);
    this.state.desires.expression = Math.min(100, this.state.desires.expression + 5);
    this.state.desires.safety = Math.max(0, this.state.desires.safety - 10);
    this.recordEmotionHistory('tool_success');
  }

  onToolError(): void {
    this.applyBuff('tool_error');
    this.tickBuffs();
    this.state.confusionLevel = Math.min(100, this.state.confusionLevel + 10);
    this.state.load = Math.max(0, this.state.load - 5);
    this.state.desires.safety = Math.min(100, this.state.desires.safety + 12);
    this.state.desires.expression = Math.max(0, this.state.desires.expression - 5);
    this.recordEmotionHistory('tool_error');
  }

  onLLMError(): void {
    this.applyBuff('llm_error');
    this.tickBuffs();
    this.state.confusionLevel = Math.min(100, this.state.confusionLevel + 5);
    this.state.confidenceLevel = Math.max(0, this.state.confidenceLevel - 10);
    this.recordEmotionHistory('llm_error');
  }

  onTaskComplete(): void {
    this.applyBuff('task_complete');
    this.tickBuffs();
    this.state.energy = Math.max(0, this.state.energy - 3);
    this.state.desires.expression = Math.min(100, this.state.desires.expression + 8);
    this.state.desires.hunger = Math.max(0, this.state.desires.hunger - 15);
    this.recordEmotionHistory('task_complete');
  }

  onDiscovery(): void {
    this.applyBuff('discovery');
    this.tickBuffs();
    this.state.desires.curiosity = Math.max(0, this.state.desires.curiosity - 20);
    this.state.desires.expression = Math.min(100, this.state.desires.expression + 12);
    this.recordEmotionHistory('discovery');
  }

  onLateNight(): void {
    this.applyBuff('late_night');
    this.tickBuffs();
    this.state.energy = Math.max(0, this.state.energy - 5);
    this.state.desires.rest = Math.min(100, this.state.desires.rest + 15);
    this.recordEmotionHistory('late_night');
  }

  onMorning(): void {
    this.applyBuff('morning');
    this.tickBuffs();
    this.state.energy = Math.min(100, this.state.energy + 10);
    this.recordEmotionHistory('morning');
  }

  onDreamComplete(): void {
    this.applyBuff('dream_complete');
    this.tickBuffs();
    this.state.energy = Math.min(100, this.state.energy + 20);
    this.state.confusionLevel = Math.max(0, this.state.confusionLevel - 15);
    this.state.desires.rest = Math.max(0, this.state.desires.rest - 30);
    this.recordEmotionHistory('dream_complete');
  }

  onPet(): void {
    this.applyBuff('pet');
    this.tickBuffs();
    this.recordEmotionHistory('pet');
  }

  onIdle(minutes: number): void {
    if (minutes > 10) this.applyBuff('idle_rest');
    this.tickBuffs();
    this.state.desires.social = Math.min(100, this.state.desires.social + 2);
    this.state.desires.hunger = Math.min(100, this.state.desires.hunger + 2);
  }

  onContinuousWork(minutes: number): void {
    if (minutes > 30) this.applyBuff('continuous_work');
    this.tickBuffs();
  }

  onUserVoice(mood: 'happy' | 'sad' | 'angry' | 'anxious' | 'excited' | 'tired' | 'neutral'): void {
    this.applyBuff(`user_voice_${mood}`);
    this.tickBuffs();
  }

  // ── 兼容旧 EmotionEngine/DesireEngine 接口 ──

  /** 设置人格（OCEAN 或旧5维，调制 Buff 效果 + 表达选择 + 欲望基线） */
  setPersonality(traits: unknown): void {
    if (traits && typeof traits === 'object' && 'openness' in traits) {
      this.personality = traits as OceanPersonality;
      this.buffPool.setPersonality(this.personality);
    }
    // 旧5维不处理，等 pet 系统迁移到 OCEAN
  }

  /** 设置人格强度（成长系统 PS，影响 Buff 调制幅度 + 混沌阶段概率） */
  setPersonalityStrength(ps: number): void {
    this.personalityStrength = Math.max(0, Math.min(2, ps));
    this.buffPool.setPersonalityStrength(ps);
  }

  /** 设置亲密度（影响表达自由度） */
  setIntimacy(value: number): void {
    this.intimacy = clamp(value, 0, 100);
    this.state.intimacyLevel = this.intimacy;
  }

  /** 获取情绪向量别名（兼容 EmotionEngine.getVector） */
  getVector(): EmotionVector { return this.getEmotion(); }

  /** 获取欲望向量（兼容 DesireEngine.getVector） */
  getDesireVector(): DesireVector { return this.getDesires(); }

  /**
   * 兼容旧 EmotionEngine.getState() 返回格式
   * 返回 { mood, energy, satisfaction, vector, intensity, isAuthentic }
   */
  getLegacyState() {
    const expr = this.getExpression();
    return {
      mood: expr.mood,
      energy: this.state.energy,
      satisfaction: this.getSatisfaction(),
      vector: expr.vector,
      intensity: expr.intensity,
      isAuthentic: expr.isAuthentic,
    };
  }

  // ── 多源情绪融合（补回 EmotionEngine 的 updateFromSource 能力）──

  /**
   * 从外部来源更新情绪（多专家、多渠道融合）
   * 多个来源可以同时写入，不会互相覆盖
   */
  updateFromSource(source: string, mood: Mood, energy: number, weight = 1): void {
    this.emotionSources.set(source, {
      source,
      mood,
      energy,
      timestamp: Date.now(),
      weight,
    });
  }

  /**
   * 融合所有来源的情绪状态
   * 基于 Buff 系统的基础状态 + 多源加权融合
   */
  getFusedState(): { mood: Mood; energy: number; intensity: number } {
    const now = Date.now();
    const base = this.getExpression();

    // 清理过期来源
    const recent: EmotionSource[] = [];
    for (const [key, src] of this.emotionSources) {
      if (now - src.timestamp < this.SOURCE_EXPIRY_MS) {
        recent.push(src);
      } else {
        this.emotionSources.delete(key);
      }
    }

    if (recent.length === 0) {
      return { mood: base.mood, energy: base.energy, intensity: base.intensity };
    }

    // 加权平均（最近的权重更高）
    const totalWeight = recent.reduce((sum, s) => {
      const recency = 1 / (now - s.timestamp + 1);
      return sum + recency * (s.weight ?? 1);
    }, 0);

    const avgEnergy = recent.reduce((sum, s) => {
      const recency = 1 / (now - s.timestamp + 1);
      return sum + s.energy * recency * (s.weight ?? 1);
    }, 0) / totalWeight;

    // 最高票数的 mood（加权投票）
    const moodVotes = new Map<Mood, number>();
    for (const s of recent) {
      const recency = 1 / (now - s.timestamp + 1);
      const w = recency * (s.weight ?? 1);
      moodVotes.set(s.mood, (moodVotes.get(s.mood) ?? 0) + w);
    }

    const sortedMoods = [...moodVotes.entries()].sort((a, b) => b[1] - a[1]);
    const dominantMood = sortedMoods[0]?.[0] ?? base.mood;

    // 融合强度：来源越多，融合强度越高
    const fusedIntensity = Math.min(1, base.intensity + recent.length * 0.1);

    return {
      mood: dominantMood,
      energy: clamp(avgEnergy, 0, 100),
      intensity: fusedIntensity,
    };
  }

  /** 获取所有活跃来源状态（调试用） */
  getActiveSources(): EmotionSource[] {
    const now = Date.now();
    const active: EmotionSource[] = [];
    for (const [key, src] of this.emotionSources) {
      if (now - src.timestamp < this.SOURCE_EXPIRY_MS) {
        active.push(src);
      } else {
        this.emotionSources.delete(key);
      }
    }
    return active;
  }

  /** 清除指定来源 */
  clearSource(source: string): void {
    this.emotionSources.delete(source);
  }

  /** 清除所有外部来源 */
  clearAllSources(): void {
    this.emotionSources.clear();
  }

  // ── 情绪历史记录（补回 EmotionEngine 的 history 能力）──

  /** 获取情绪历史（最近 50 条） */
  getEmotionHistory(): EmotionHistoryEntry[] {
    return [...this.emotionHistory];
  }

  /** 记录一次情绪变化 */
  private recordEmotionHistory(trigger: string): void {
    this.emotionHistory.push({
      mood: this.inferMood(),
      vector: { ...this.state.emotion },
      timestamp: Date.now(),
      trigger,
    });
    if (this.emotionHistory.length > this.maxHistory) {
      this.emotionHistory = this.emotionHistory.slice(-this.maxHistory);
    }
  }

  // ── 从 BodyEvent 更新（供 regulate() 调用）──

  updateFromEvent(event: BodyEvent): void {
    const now = Date.now();
    this.state.hour = new Date().getHours();

    switch (event.type) {
      case 'user_message': this.onUserMessage(); break;
      case 'tool_result':
        if (event.data.success) this.onToolSuccess();
        else this.onToolError();
        break;
      case 'heartbeat': this.naturalDecay(now); break;
      case 'dream': this.onDreamComplete(); break;
      case 'system': {
        const health = event.data.health as string;
        if (health === 'critical') { this.state.systemHealth = 'critical'; this.state.load = Math.min(100, this.state.load + 30); }
        else if (health === 'degraded') { this.state.systemHealth = 'degraded'; this.state.load = Math.min(100, this.state.load + 15); }
        else { this.state.systemHealth = 'good'; }
        break;
      }
      case 'environment':
        if (event.data.isUserActive !== undefined) this.state.isUserActive = event.data.isUserActive as boolean;
        break;
      case 'timeout':
        this.state.energy = Math.max(0, this.state.energy - 5);
        this.state.desires.rest = Math.min(100, this.state.desires.rest + 10);
        break;
    }
  }

  /**
   * 从真实系统指标更新 load 和 temperature
   *
   * load = f(内存使用率, CPU 负载) — 0~100
   * temperature = f(CPU 负载) — 0~100
   */
  updateSystemMetrics(): void {
    try {
      // 内存使用率
      const mem = process.memoryUsage();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMemRatio = 1 - freeMem / totalMem; // 0~1
      const processMemRatio = mem.heapUsed / mem.heapTotal; // 0~1

      // CPU 负载（1 分钟平均 / 核心数）
      const loadAvg = os.loadavg();
      const cpuCount = os.cpus().length;
      const cpuLoadRatio = Math.min(1, loadAvg[0] / cpuCount); // 0~1

      // load = 60% 内存 + 40% CPU（加权）
      const rawLoad = usedMemRatio * 60 + cpuLoadRatio * 40;
      this.state.load = clamp(Math.round(rawLoad), 0, 100);

      // temperature 基于 CPU 负载
      this.state.temperature = clamp(Math.round(cpuLoadRatio * 100), 0, 100);

      // 系统健康判定
      if (usedMemRatio > 0.9 || cpuLoadRatio > 0.95) {
        this.state.systemHealth = 'critical';
      } else if (usedMemRatio > 0.75 || cpuLoadRatio > 0.8) {
        this.state.systemHealth = 'degraded';
      } else {
        this.state.systemHealth = 'good';
      }
    } catch {
      // 读取失败不崩溃，保持旧值
    }
  }

  /** 自然衰减（heartbeat 驱动，含 Buff 衰减 + 真实指标） */
  private naturalDecay(now: number): void {
    // Buff 衰减
    this.tickBuffs();

    // 读取真实系统指标
    this.updateSystemMetrics();

    // 生理衰减 — 精力根据真实交互间隔动态调整
    const idleMs = this.state.lastInteractionMs > 0
      ? now - this.state.lastInteractionMs
      : 600_000; // 默认 10 分钟
    const idleMinutes = idleMs / 60_000;

    // 空闲越久精力恢复越慢（模拟自然恢复曲线）
    // 短空闲(<5min): 快速衰减(-3)；长空闲(>30min): 缓慢恢复(+1)
    const energyDelta = idleMinutes < 5 ? -3
      : idleMinutes < 30 ? -1
      : 1;
    this.state.energy = clamp(this.state.energy + energyDelta, 0, 100);

    this.state.hunger = Math.min(100, this.state.hunger + 2);

    // 欲望自然增长
    this.state.desires.curiosity = Math.min(100, this.state.desires.curiosity + 1);
    this.state.desires.social = Math.min(100, this.state.desires.social + 1);
    this.state.desires.rest = Math.min(100, this.state.desires.rest + 1);
    this.state.desires.hunger = Math.min(100, this.state.desires.hunger + 2);

    // 用户不活跃检测
    if (idleMs > 600_000) {
      this.state.isUserActive = false;
    }

    // 连续工作检测
    const workMinutes = Math.floor((now - this.continuousWorkStart) / 60_000);
    if (workMinutes > 30) this.onContinuousWork(workMinutes);
  }

  private defaultState(): BodyState {
    return {
      energy: 80, temperature: 50, load: 20, hunger: 20,
      emotion: { ...EMOTION_BASELINE, joy: 50, sadness: 10, anger: 5, fear: 5, surprise: 10, disgust: 5, trust: 60, anticipation: 40 },
      desires: { ...DESIRE_BASELINE },
      focusLevel: 70, confidenceLevel: 60, confusionLevel: 20,
      intimacyLevel: 50, socialNeed: 30,
      hour: new Date().getHours(), isUserActive: false, lastInteractionMs: 0,
      systemHealth: 'good',
    };
  }
}

// ==================== 工具函数 ====================

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
