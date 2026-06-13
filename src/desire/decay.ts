/**
 * 需求衰减系统 — 六欲的自然增长与满足
 *
 * 灵感：The Sims 的 8 个需求持续衰减，驱动行为选择。
 *
 * 核心机制：
 * - 每次心跳(5分钟)，各需求自然增长（模拟"生理驱动力"）
 * - 用户交互/完成任务 → 对应需求降低（满足）
 * - 需求增长速度可被 OCEAN 人格微调
 *
 * 与 computeDesires() 的关系：
 * - computeDesires() 从上下文实时计算（快照）
 * - decay 在心跳间持续累加（时间维度）
 * - 两者合并：desire = computeDesires(ctx) + decayAccumulator
 */

import type { DesireVector } from './engine.js';
import type { OceanPersonality } from '../personality/ocean.js';

// ==================== 配置 ====================

export interface DesireDecayConfig {
  /** 每次心跳(5分钟)各需求增长量 */
  growthPerTick: DesireVector;
  /** 交互后需求降低量 */
  reliefOnInteraction: Partial<DesireVector>;
  /** 完成任务后需求降低量 */
  reliefOnTaskComplete: Partial<DesireVector>;
  /** OCEAN 人格对增长速度的修正系数 */
  oceanGrowthModifier: (ocean: OceanPersonality) => Partial<DesireVector>;
}

const DEFAULT_CONFIG: DesireDecayConfig = {
  growthPerTick: {
    hunger:     2,    // 每 5 分钟 +2 → 约 4 小时满
    curiosity:  1.5,  // 每 5 分钟 +1.5 → 约 5.5 小时满
    social:     2.5,  // 每 5 分钟 +2.5 → 约 3.3 小时满
    safety:     0.5,  // 安全感增长慢
    expression: 1,    // 表达欲中等
    rest:       3,    // 每 5 分钟 +3 → 约 2.8 小时满
  },
  reliefOnInteraction: {
    social: -30,      // 聊天大幅降低社交欲
    hunger: -10,      // 聊天略微降低饥饿感
    curiosity: -15,   // 新知识降低求知欲
    rest: 5,          // 聊天略微增加疲劳
  },
  reliefOnTaskComplete: {
    expression: -40,  // 完成任务大幅满足表达欲
    curiosity: -20,
    hunger: 5,        // 做任务消耗精力
    rest: 10,         // 做任务增加疲劳
  },
  oceanGrowthModifier: (ocean) => ({
    // 高开放性 → 求知欲增长更快
    curiosity: ocean.openness > 70 ? 1.3 : ocean.openness < 30 ? 0.7 : 1.0,
    // 高外倾性 → 社交欲增长更快
    social: ocean.extraversion > 70 ? 1.3 : ocean.extraversion < 30 ? 0.7 : 1.0,
    // 高神经质 → 安全欲增长更快
    safety: ocean.neuroticism > 70 ? 1.5 : ocean.neuroticism < 30 ? 0.6 : 1.0,
    // 高尽责性 → 表达欲增长更快（想完成任务）
    expression: ocean.conscientiousness > 70 ? 1.3 : ocean.conscientiousness < 30 ? 0.7 : 1.0,
    // 低尽责性 → 休息欲增长更快（容易累）
    rest: ocean.conscientiousness < 30 ? 1.4 : ocean.conscientiousness > 70 ? 0.8 : 1.0,
  }),
};

// ==================== DesireDecay ====================

export class DesireDecay {
  private config: DesireDecayConfig;
  /** 累积的需求增长（每次 tick 累加，被外部读取后可选择性重置） */
  private accumulator: DesireVector = {
    hunger: 0, curiosity: 0, social: 0, safety: 0, expression: 0, rest: 0,
  };
  private ocean: OceanPersonality | null = null;

  constructor(config?: Partial<DesireDecayConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 设置人格（影响增长速度） */
  setOcean(ocean: OceanPersonality): void {
    this.ocean = ocean;
  }

  /**
   * 心跳 tick — 每 5 分钟调用一次
   * 累加需求增长到 accumulator
   */
  tick(): void {
    const growth = { ...this.config.growthPerTick };

    // 应用 OCEAN 人格修正
    if (this.ocean) {
      const mod = this.config.oceanGrowthModifier(this.ocean);
      for (const key of Object.keys(mod) as Array<keyof DesireVector>) {
        const factor = mod[key];
        if (typeof factor === 'number') {
          growth[key] *= factor;
        }
      }
    }

    // 累加
    for (const key of Object.keys(growth) as Array<keyof DesireVector>) {
      this.accumulator[key] = clamp(this.accumulator[key] + growth[key], 0, 100);
    }
  }

  /**
   * 用户交互时调用 — 降低社交欲/饥饿感等
   */
  onInteraction(): void {
    const relief = this.config.reliefOnInteraction;
    this.applyRelief(relief);
  }

  /**
   * 完成任务时调用 — 降低表达欲/求知欲
   */
  onTaskComplete(): void {
    const relief = this.config.reliefOnTaskComplete;
    this.applyRelief(relief);
  }

  /**
   * 获取当前累积的需求增长
   * 外部将其合并到 computeDesires() 的输出中
   */
  getAccumulator(): DesireVector {
    return { ...this.accumulator };
  }

  /**
   * 将累积值合并到一个基础 DesireVector 上
   * desire = base + accumulator，clamp 到 0-100
   */
  mergeWithBase(base: DesireVector): DesireVector {
    return {
      hunger:     clamp(base.hunger + this.accumulator.hunger, 0, 100),
      curiosity:  clamp(base.curiosity + this.accumulator.curiosity, 0, 100),
      social:     clamp(base.social + this.accumulator.social, 0, 100),
      safety:     clamp(base.safety + this.accumulator.safety, 0, 100),
      expression: clamp(base.expression + this.accumulator.expression, 0, 100),
      rest:       clamp(base.rest + this.accumulator.rest, 0, 100),
    };
  }

  /**
   * 重置累积值（例如新的一天、长时间休息后）
   */
  reset(): void {
    this.accumulator = { hunger: 0, curiosity: 0, social: 0, safety: 0, expression: 0, rest: 0 };
  }

  /**
   * 手动设置累积值（用于状态恢复）
   */
  setAccumulator(acc: DesireVector): void {
    this.accumulator = { ...acc };
  }

  // ==================== 内部 ====================

  private applyRelief(relief: Partial<DesireVector>): void {
    for (const key of Object.keys(relief) as Array<keyof DesireVector>) {
      const value = relief[key];
      if (typeof value === 'number') {
        this.accumulator[key] = clamp(this.accumulator[key] + value, 0, 100);
      }
    }
  }
}

// ==================== 工具 ====================

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
