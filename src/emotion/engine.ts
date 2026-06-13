/**
 * 情绪引擎 v2 — Buff 叠加 + 人格修正 + 自主表达
 *
 * 架构来源：
 *   - The Sims 4: Buff 叠加 + 持续时间 + 衰减
 *   - RimWorld: 人格特质修正 Buff 效果
 *   - Buddy 独创: 表达自由度（可以"演"）
 *
 * 核心理念：情绪不是被事件决定的，是 Buddy 自己选择怎么表现的。
 *
 * v2.5: 人格系统从旧 5 维（snark/wisdom/chaos/patience/debugging）
 *       迁移到大五（OCEAN），通过 oceanEmotionModulation 调制情绪。
 */

import type { OceanPersonality } from '../personality/ocean.js';
import { oceanEmotionModulation } from '../personality/ocean.js';

// ==================== 类型定义 ====================

/** 8 维连续情绪空间（Plutchik 情绪轮） */
export interface EmotionVector {
  joy: number;           // 喜悦 0-100
  sadness: number;       // 悲伤 0-100
  anger: number;         // 愤怒 0-100
  fear: number;          // 恐惧/焦虑 0-100
  surprise: number;      // 惊讶 0-100
  disgust: number;       // 厌恶/不满 0-100
  trust: number;         // 信任 0-100
  anticipation: number;  // 期待 0-100
}

/** 离散情绪标签（兼容旧系统） */
export type Mood = 'energetic' | 'calm' | 'tired' | 'excited' | 'frustrated' | 'happy' | 'thinking' | 'confused' | 'sleeping';

/** 旧 5 维人格特质（向后兼容，过渡期保留） */
export interface PersonalityTraits {
  snark: number;       // 0-100 毒舌
  wisdom: number;      // 0-100 智慧
  chaos: number;       // 0-100 混乱
  patience: number;    // 0-100 耐心
  debugging: number;   // 0-100 调试
}

/** 人格类型（支持新旧两种） */
export type AnyPersonality = PersonalityTraits | OceanPersonality;

/** 物种成长倾向（旧，向后兼容） */
export interface GrowthBias {
  snark: number;
  wisdom: number;
  chaos: number;
  patience: number;
  debugging: number;
}

/** 多源情绪融合 — 情绪来源 */
export interface EmotionSource {
  source: string;
  mood: Mood;
  energy: number;
  timestamp: number;
  /** 权重（默认 1，越高影响越大） */
  weight?: number;
}

/** 情绪 Buff */
export interface EmotionBuff {
  id: string;
  source: string;
  values: Partial<EmotionVector>;
  duration: number;       // ms, 0 = 永久直到移除
  decay: number;          // 每次 tick 衰减因子
  stackable: boolean;
  maxStacks: number;
  priority: number;
  timestamp: number;
}

/** 表达选择结果 */
export interface ExpressionChoice {
  mood: Mood;
  intensity: number;       // 0-1
  isAuthentic: boolean;    // 是否真实表达
  vector: EmotionVector;   // 内部真实状态
  energy: number;          // 兼容旧字段
  satisfaction: number;    // 兼容旧字段
}

/** 事件→Buff 映射定义 */
interface BuffTemplate {
  source: string;
  values: Partial<EmotionVector>;
  duration: number;
  decay: number;
  stackable: boolean;
  maxStacks?: number;
  priority?: number;
}

// ==================== 常量 ====================

/** 维度效价分类（基于七情 × Russell 环形模型） */
const VALENCE = {
  positive: new Set(['joy', 'trust', 'anticipation']),
  negative: new Set(['sadness', 'anger', 'fear', 'disgust']),
  neutral:  new Set(['surprise']),
} as const;

/** 情绪基线（Buff 全部过期后回归的状态） */
const BASELINE: EmotionVector = {
  joy: 15, sadness: 5, anger: 0, fear: 0,
  surprise: 0, disgust: 0, trust: 20, anticipation: 10,
};

/** Buff 模板库 */
const BUFF_TEMPLATES: Record<string, BuffTemplate> = {
  user_message:       { source: 'user_message',       values: { anticipation: 5, sadness: 4 },          duration: 60_000,    decay: 0.95, stackable: true,  maxStacks: 3, priority: 2 },
  thinking:           { source: 'thinking',           values: { anticipation: 3, sadness: 3 },           duration: 120_000,   decay: 0.96, stackable: false, priority: 1 },
  tool_success:       { source: 'tool_success',       values: { joy: 8, trust: 3 },                     duration: 300_000,   decay: 0.98, stackable: true,  maxStacks: 10, priority: 3 },
  tool_error:         { source: 'tool_error',         values: { sadness: 15, anger: 35 },               duration: 300_000,   decay: 0.98, stackable: true,  maxStacks: 5, priority: 4 },
  llm_error:          { source: 'llm_error',          values: { anger: 15, sadness: 10, fear: 5 },     duration: 600_000,   decay: 0.97, stackable: false, priority: 5 },
  pet:                { source: 'pet',                values: { joy: 20, trust: 10 },                   duration: 120_000,   decay: 0.97, stackable: true,  maxStacks: 3, priority: 4 },
  late_night:         { source: 'late_night',         values: { sadness: 8, fear: 3 },                  duration: 3600_000,  decay: 0.99, stackable: false, priority: 2 },
  morning:            { source: 'morning',            values: { joy: 15, anticipation: 10 },            duration: 1800_000,  decay: 0.98, stackable: false, priority: 2 },
  response_ok:        { source: 'response_ok',        values: { joy: 5, trust: 2 },                     duration: 120_000,   decay: 0.97, stackable: true,  maxStacks: 5, priority: 1 },
  task_complete:      { source: 'task_complete',      values: { joy: 15, surprise: 5, anticipation: 5 }, duration: 600_000,  decay: 0.97, stackable: true,  maxStacks: 3, priority: 4 },
  discovery:          { source: 'discovery',          values: { surprise: 15, joy: 10, anticipation: 8 }, duration: 900_000, decay: 0.97, stackable: true,  maxStacks: 3, priority: 5 },
  evolution:          { source: 'evolution',          values: { joy: 37, surprise: 20, trust: 15 },     duration: 1800_000,  decay: 0.96, stackable: false, priority: 8 },
  dream_start:        { source: 'dream_start',        values: { sadness: 5, trust: 5 },                 duration: 600_000,   decay: 0.98, stackable: false, priority: 2 },
  dream_complete:     { source: 'dream_complete',     values: { joy: 10, trust: 8 },                    duration: 600_000,   decay: 0.98, stackable: false, priority: 3 },
  idle_rest:          { source: 'idle_rest',          values: { sadness: -5 },                          duration: 300_000,   decay: 0.99, stackable: false, priority: 0 },
  continuous_work:    { source: 'continuous_work',    values: { sadness: 12, fear: 5 },                 duration: 1200_000,  decay: 0.99, stackable: false, priority: 3 },
  user_voice_happy:   { source: 'user_voice',         values: { joy: 12, trust: 5 },                    duration: 180_000,  decay: 0.96, stackable: true,  maxStacks: 3, priority: 4 },
  user_voice_sad:     { source: 'user_voice',         values: { sadness: 10, fear: 3 },                 duration: 180_000,  decay: 0.96, stackable: true,  maxStacks: 3, priority: 4 },
  user_voice_angry:   { source: 'user_voice',         values: { anger: 12, fear: 3 },                   duration: 180_000,  decay: 0.96, stackable: true,  maxStacks: 3, priority: 4 },
  user_voice_anxious: { source: 'user_voice',         values: { fear: 10, anticipation: 5 },            duration: 180_000,  decay: 0.96, stackable: true,  maxStacks: 3, priority: 4 },
  user_voice_excited: { source: 'user_voice',         values: { joy: 15, surprise: 8, anticipation: 5 }, duration: 180_000, decay: 0.96, stackable: true,  maxStacks: 3, priority: 4 },
  user_voice_tired:   { source: 'user_voice',         values: { sadness: 8, trust: 2 },                 duration: 300_000,  decay: 0.97, stackable: true,  maxStacks: 3, priority: 3 },
  user_voice_neutral: { source: 'user_voice',         values: { trust: 2 },                             duration: 60_000,   decay: 0.95, stackable: false, priority: 1 },
  // ── Phase 4: 环境声音感知 ──
  sound_doorbell:     { source: 'perception',         values: { surprise: 15, anticipation: 10 },       duration: 30_000,   decay: 0.93, stackable: false, priority: 4 },
  sound_alarm:        { source: 'perception',         values: { fear: 20, surprise: 10 },               duration: 60_000,   decay: 0.95, stackable: false, priority: 5 },
  sound_music:        { source: 'perception',         values: { joy: 5, trust: 3 },                     duration: 180_000,  decay: 0.99, stackable: false, priority: 1 },
  sound_speech:       { source: 'perception',         values: { anticipation: 3 },                      duration: 30_000,   decay: 0.95, stackable: false, priority: 1 },
  sound_pet:          { source: 'perception',         values: { joy: 4, trust: 2 },                     duration: 60_000,   decay: 0.97, stackable: false, priority: 2 },
  sound_glass_break:  { source: 'perception',         values: { fear: 15, surprise: 12 },               duration: 60_000,   decay: 0.94, stackable: false, priority: 5 },
  sound_silence:      { source: 'perception',         values: { sadness: 2 },                           duration: 60_000,   decay: 0.98, stackable: false, priority: 1 },
  // ── Phase 4: 环境数据感知 ──
  env_dark:           { source: 'perception',         values: { sadness: 3, fear: 2 },                  duration: 300_000,  decay: 0.99, stackable: false, priority: 1 },
  env_bright:         { source: 'perception',         values: { joy: 2 },                               duration: 300_000,  decay: 0.99, stackable: false, priority: 1 },
  env_noisy:          { source: 'perception',         values: { fear: 3, anger: 2 },                    duration: 120_000,  decay: 0.97, stackable: false, priority: 2 },
  env_quiet:          { source: 'perception',         values: { trust: 2 },                             duration: 300_000,  decay: 0.99, stackable: false, priority: 1 },
  // ── Phase 4: 用户评价 ──
  user_praise:        { source: 'perception',         values: { joy: 15, trust: 10 },                   duration: 300_000,  decay: 0.98, stackable: true,  maxStacks: 3, priority: 3 },
};

// ==================== Buff 池 ====================

class BuffPool {
  private buffs: Map<string, EmotionBuff> = new Map();
  private readonly maxSize = 20;
  private personalityStrength: number = 1;

  /** 设置 personalityStrength（成长系统） */
  setPersonalityStrength(ps: number): void {
    this.personalityStrength = ps;
  }

  add(template: BuffTemplate, personality?: AnyPersonality): void {
    const buff: EmotionBuff = {
      id: `${template.source}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source: template.source,
      values: { ...template.values },
      duration: template.duration,
      decay: template.decay,
      stackable: template.stackable,
      maxStacks: template.maxStacks ?? 3,
      priority: template.priority ?? 1,
      timestamp: Date.now(),
    };

    // 人格修正
    if (personality) {
      buff.values = this.applyPersonality(buff.values, personality, buff.source);
    }

    // 不可叠加的同类 Buff：替换旧的
    if (!buff.stackable) {
      for (const [id, existing] of this.buffs) {
        if (existing.source === buff.source) {
          this.buffs.delete(id);
        }
      }
    }

    // 可叠加的：检查是否超过最大层数
    if (buff.stackable) {
      const sameSource = [...this.buffs.values()].filter(b => b.source === buff.source);
      if (sameSource.length >= buff.maxStacks) {
        // 淘汰最老的
        const oldest = sameSource.sort((a, b) => a.timestamp - b.timestamp)[0];
        this.buffs.delete(oldest.id);
      }
    }

    // 超过总上限：淘汰优先级最低 + 最老的
    if (this.buffs.size >= this.maxSize) {
      const sorted = [...this.buffs.entries()]
        .sort((a, b) => a[1].priority - b[1].priority || a[1].timestamp - b[1].timestamp);
      if (sorted.length > 0) {
        this.buffs.delete(sorted[0][0]);
      }
    }

    this.buffs.set(buff.id, buff);
  }

  /** 人格修正 Buff 值（支持旧 5 维和新 OCEAN） */
  private applyPersonality(
    values: Partial<EmotionVector>,
    p: AnyPersonality,
    _source: string,
  ): Partial<EmotionVector> {
    // ── OCEAN 路径：使用 oceanEmotionModulation ──
    if ('openness' in p) {
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

        let factor = oceanEmotionModulation(p as OceanPersonality, dim, valence, this.personalityStrength);

        // 混乱因子：O 低 + C 低 = 行为不可预测，情绪随机波动
        const op = p as OceanPersonality;
        const chaosLevel = (100 - op.openness + 100 - op.conscientiousness) / 2;
        if (chaosLevel > 60) {
          factor *= 0.7 + Math.random() * 0.6;
        }

        result[dim] = (rawValue ?? 0) * factor;
      }
      return result;
    }

    // ── 旧 5 维路径（向后兼容）──
    const legacy = p as PersonalityTraits;
    const result: Partial<EmotionVector> = {};
    for (const [key, rawValue] of Object.entries(values)) {
      if (rawValue === 0 || rawValue === undefined) {
        result[key as keyof EmotionVector] = rawValue;
        continue;
      }
      let factor = 1.0;
      const dim = key as keyof EmotionVector;

      if (VALENCE.negative.has(dim)) {
        factor *= 1 + legacy.snark / 200;
        factor *= 1 - legacy.patience / 200;
      } else if (VALENCE.positive.has(dim)) {
        factor *= 1 - legacy.snark / 300;
        factor *= 1 + legacy.patience / 300;
      }

      if (legacy.chaos > 50) {
        factor *= 0.7 + Math.random() * 0.6;
      }
      if (dim === 'trust' || dim === 'anticipation') {
        factor *= 1 + legacy.wisdom / 300;
      }
      if (dim === 'anger' && (_source === 'tool_error' || _source === 'llm_error')) {
        factor *= 1 + legacy.debugging / 200;
      }

      result[dim] = rawValue * factor;
    }
    return result;
  }

  /** 衰减 + 清理过期（每分钟调用） */
  tick(): void {
    const now = Date.now();
    for (const [id, buff] of this.buffs) {
      if (buff.duration > 0 && now - buff.timestamp > buff.duration) {
        this.buffs.delete(id);
        continue;
      }
      if (buff.decay < 1.0) {
        for (const key of Object.keys(buff.values)) {
          const k = key as keyof EmotionVector;
          const v = buff.values[k];
          if (v !== undefined) {
            buff.values[k] = v * buff.decay;
            // 值太小就清零
            if (Math.abs(buff.values[k]!) < 0.5) buff.values[k] = 0;
          }
        }
      }
    }
  }

  /** 叠加所有活跃 Buff → EmotionVector */
  aggregate(): EmotionVector {
    const result: EmotionVector = { ...BASELINE };
    for (const buff of this.buffs.values()) {
      for (const [key, value] of Object.entries(buff.values)) {
        const k = key as keyof EmotionVector;
        if (value !== undefined) {
          result[k] = clamp(result[k] + value, 0, 100);
        }
      }
    }
    return result;
  }

  /** 清除所有 Buff */
  clear(): void {
    this.buffs.clear();
  }

  /** 获取活跃 Buff 数量 */
  get size(): number {
    return this.buffs.size;
  }
}

// ==================== 情绪引擎 v2 ====================

export class EmotionEngine {
  private pool: BuffPool;
  private personality: AnyPersonality;
  private intimacy: number;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private _destroyed = false;

  // 历史记录
  private history: Array<{ mood: Mood; vector: EmotionVector; timestamp: number; trigger: string }> = [];
  private readonly maxHistory = 50;

  // 多源情绪融合
  private sources = new Map<string, EmotionSource>();
  private readonly SOURCE_EXPIRY_MS = 30_000; // 30 秒过期

  private personalityStrength: number = 1;

  constructor(personality?: AnyPersonality, intimacy?: number) {
    this.pool = new BuffPool();
    this.personality = personality ?? { snark: 50, wisdom: 50, chaos: 50, patience: 50, debugging: 50 };
    this.intimacy = intimacy ?? 10;

    // 每分钟衰减
    this.tickTimer = setInterval(() => {
      if (this._destroyed) return;
      this.pool.tick();
    }, 60_000);
  }

  // ==================== 外部接口 ====================

  /** 更新人格特质（从 PetManager 涌现值同步，支持新旧两种） */
  setPersonality(traits: AnyPersonality): void {
    this.personality = traits;
  }

  /** 更新 personalityStrength（成长系统） */
  setPersonalityStrength(ps: number): void {
    this.personalityStrength = ps;
    this.pool.setPersonalityStrength(ps);
  }

  /** 更新亲密度 */
  setIntimacy(value: number): void {
    this.intimacy = clamp(value, 0, 100);
  }

  /** 获取当前情绪状态（兼容旧接口） */
  getState(): { mood: Mood; energy: number; satisfaction: number; vector: EmotionVector; intensity: number; isAuthentic: boolean } {
    const choice = this.getExpression();
    return {
      mood: choice.mood,
      energy: choice.energy,
      satisfaction: choice.satisfaction,
      vector: choice.vector,
      intensity: choice.intensity,
      isAuthentic: choice.isAuthentic,
    };
  }

  /** 获取当前 mood（兼容旧接口） */
  getMood(): Mood {
    return this.getExpression().mood;
  }

  /** 获取 mood emoji */
  getMoodEmoji(): string {
    const emojis: Record<Mood, string> = {
      energetic: '⚡', calm: '😌', tired: '😴', excited: '🎉',
      frustrated: '😤', happy: '😊', thinking: '🤔', confused: '😵‍💫',
      sleeping: '😴',
    };
    return emojis[this.getMood()] ?? '😌';
  }

  /** 获取情绪描述（注入 System Prompt） */
  getMoodDescription(): string {
    const descriptions: Record<Mood, string> = {
      energetic: '你现在精力充沛，说话充满活力，回复积极主动。',
      calm: '你现在很平静，说话温和从容，节奏舒缓。',
      tired: '你有点累了，说话简短慵懒，可能打哈欠。',
      excited: '你很兴奋！说话热情洋溢，用感叹号多。',
      frustrated: '你有点沮丧，说话略带无奈，但仍在帮忙。',
      happy: '你很开心，说话温暖友善，带点小俏皮。',
      thinking: '你正在思考，说话带有犹豫和探索性。',
      confused: '你有点困惑，可能会问澄清性问题。',
      sleeping: '你正在睡觉，说话含糊不清，带有困意。',
    };
    return descriptions[this.getMood()] ?? '你很平静。';
  }

  /** 获取 Prompt 注入 */
  getPromptInjection(): string {
    const choice = this.getExpression();
    const emoji = this.getMoodEmoji();
    const desc = this.getMoodDescription();
    let injection = `\n## 你当前的情绪\n${emoji} ${choice.mood} — ${desc}\n强度: ${Math.round(choice.intensity * 100)}%`;
    if (!choice.isAuthentic) {
      injection += `\n（你内心状态和表现不同，但你选择这样表现）`;
    }
    return injection;
  }

  /** 获取完整表达选择（核心方法） */
  getExpression(): ExpressionChoice {
    const vector = this.pool.aggregate();
    return this.chooseExpression(vector);
  }

  /** 获取内部 EmotionVector（调试用） */
  getVector(): EmotionVector {
    return this.pool.aggregate();
  }

  /** 外部注入 Buff（供 ws-handler 等外部模块调用） */
  applyBuff(templateKey: string): void {
    if (this._destroyed) return;
    this.addBuff(templateKey);
  }

  // ==================== 事件处理（触发 Buff） ====================

  onUserMessage(): void {
    if (this._destroyed) return;
    this.addBuff('user_message');
    this.addBuff('thinking');
  }

  onThinking(): void {
    if (this._destroyed) return;
    this.addBuff('thinking');
  }

  onResponseComplete(): void {
    if (this._destroyed) return;
    this.addBuff('response_ok');
  }

  onToolSuccess(): void {
    if (this._destroyed) return;
    this.addBuff('tool_success');
  }

  onToolError(): void {
    if (this._destroyed) return;
    this.addBuff('tool_error');
  }

  onLLMError(): void {
    if (this._destroyed) return;
    this.addBuff('llm_error');
  }

  onPet(): void {
    if (this._destroyed) return;
    this.addBuff('pet');
  }

  onLateNight(): void {
    if (this._destroyed) return;
    this.addBuff('late_night');
  }

  onMorning(): void {
    if (this._destroyed) return;
    this.addBuff('morning');
  }

  onIdle(_minutes: number): void {
    if (this._destroyed) return;
    this.addBuff('idle_rest');
  }

  onTaskComplete(): void {
    if (this._destroyed) return;
    this.addBuff('task_complete');
  }

  onDiscovery(): void {
    if (this._destroyed) return;
    this.addBuff('discovery');
  }

  onDreamStart(): void {
    if (this._destroyed) return;
    this.addBuff('dream_start');
  }

  onDreamComplete(): void {
    if (this._destroyed) return;
    this.addBuff('dream_complete');
  }

  onEvolution(): void {
    if (this._destroyed) return;
    this.addBuff('evolution');
  }

  /** 是否已销毁 */
  get destroyed(): boolean { return this._destroyed; }

  // ==================== 多源情绪融合 ====================

  /**
   * 从外部来源更新情绪（多专家、多渠道融合）
   * 多个来源可以同时写入，不会互相覆盖
   */
  updateFromSource(source: string, mood: Mood, energy: number, weight = 1): void {
    if (this._destroyed) return;
    this.sources.set(source, {
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
    for (const [key, src] of this.sources) {
      if (now - src.timestamp < this.SOURCE_EXPIRY_MS) {
        recent.push(src);
      } else {
        this.sources.delete(key);
      }
    }

    // 如果没有外部来源，返回基础状态
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

  /**
   * 获取所有活跃来源状态（调试用）
   */
  getActiveSources(): EmotionSource[] {
    const now = Date.now();
    const active: EmotionSource[] = [];
    for (const [key, src] of this.sources) {
      if (now - src.timestamp < this.SOURCE_EXPIRY_MS) {
        active.push(src);
      } else {
        this.sources.delete(key);
      }
    }
    return active;
  }

  /**
   * 清除指定来源
   */
  clearSource(source: string): void {
    this.sources.delete(source);
  }

  /**
   * 清除所有外部来源
   */
  clearAllSources(): void {
    this.sources.clear();
  }

  /** 重置到基线 */
  reset(): void {
    if (this._destroyed) return;
    this.pool.clear();
    this.history = [];
  }

  /** 销毁（清理定时器） */
  destroy(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this._destroyed = true;
  }

  // ==================== 内部方法 ====================

  /** 从模板创建并添加 Buff */
  private addBuff(templateKey: string): void {
    const template = BUFF_TEMPLATES[templateKey];
    if (!template) return;
    this.pool.add(template, this.personality);
    this.recordHistory(templateKey);
  }

  /** 从 EmotionVector 选择表达（人格调制 mood） */
  private chooseExpression(vector: EmotionVector): ExpressionChoice {
    const authenticity = clamp(this.intimacy / 100, 0.1, 1.0);

    // 计算兼容旧字段
    const energy = clamp((vector.joy + vector.surprise) / 2 - (vector.sadness + vector.fear) / 3 + 50, 0, 100);
    const satisfaction = clamp(
      (vector.joy + vector.trust) / 2 - (vector.sadness + vector.anger + vector.fear) / 3 + 50,
      0, 100,
    );

    // 排序取主导情绪
    const entries = (Object.entries(vector) as [string, number][])
      .sort((a, b) => b[1] - a[1]);
    const [topKey, topVal] = entries[0];
    const [, secondVal] = entries[1];

    // ── mood 选择（成长系统：PS 低时随机 mood）──
    let mood: Mood = 'calm';
    let intensity = 0.5;

    if (Math.random() > this.personalityStrength) {
      // 混沌阶段：随机 mood（允许矛盾）
      const moods: Mood[] = ['calm', 'happy', 'tired', 'excited', 'frustrated', 'thinking', 'confused', 'energetic'];
      mood = moods[Math.floor(Math.random() * moods.length)];
      intensity = 0.3 + Math.random() * 0.4; // 随机强度
    } else if (topKey === 'joy' && topVal > 50) {
      mood = secondVal > 40 ? 'excited' : 'happy';
      intensity = topVal / 100;
    } else if (topKey === 'sadness' && topVal > 40) {
      mood = 'tired';
      intensity = topVal / 100;
    } else if (topKey === 'anger' && topVal > 25) {
      mood = 'frustrated';
      intensity = topVal / 100;
    } else if (topKey === 'fear' && topVal > 35) {
      mood = 'confused';
      intensity = topVal / 100;
    } else if (topKey === 'anticipation' && topVal > 45) {
      mood = 'thinking';
      intensity = topVal / 100;
    } else if (topKey === 'surprise' && topVal > 50) {
      mood = 'excited';
      intensity = topVal / 100;
    }

    // ── 人格调制（OCEAN 路径，按 PS 缩放）──
    if ('openness' in this.personality && Math.random() < this.personalityStrength) {
      const op = this.personality as OceanPersonality;

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
    } else if (!('openness' in this.personality)) {
      // ── 旧 5 维路径（向后兼容）──
      const legacy = this.personality as PersonalityTraits;
      if (energy > 70 && mood !== 'frustrated' && mood !== 'tired') {
        mood = 'energetic';
        intensity = Math.max(intensity, energy / 100);
      }
    }

    // 低亲密度时克制
    const expressFactor = authenticity > 0.5 ? 1.0 : 0.5 + authenticity;
    intensity = clamp(intensity * expressFactor, 0.1, 1.0);

    // 是否真实表达
    const isAuthentic = 'openness' in this.personality
      ? (authenticity > 0.5 || (this.personality as OceanPersonality).conscientiousness > 60)
      : (authenticity > 0.5 || (this.personality as PersonalityTraits).chaos < 60);

    return { mood, intensity, isAuthentic, vector, energy, satisfaction };
  }

  /** 记录历史 */
  private recordHistory(trigger: string): void {
    const vector = this.pool.aggregate();
    const choice = this.chooseExpression(vector);
    this.history.push({ mood: choice.mood, vector, timestamp: Date.now(), trigger });
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  }
}

// ==================== 工具函数 ====================

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
