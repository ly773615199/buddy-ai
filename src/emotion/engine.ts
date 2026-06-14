/**
 * 情绪引擎 — 类型定义
 *
 * 运行时逻辑已迁移至小脑 BodyStateManager（src/brain/cerebellum/body-state.ts）。
 * 此文件仅保留类型定义，供 types.ts 等模块重导出使用。
 *
 * 历史：v2 Buff 叠加 + 人格修正 + 自主表达 → v2.5 OCEAN 人格 → 迁移到小脑
 */

import type { OceanPersonality } from '../personality/ocean.js';

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
