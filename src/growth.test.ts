/**
 * 成长系统测试 — personalityStrength (PS) 全链路覆盖
 */
import { describe, it, expect } from 'vitest';
import {
  SPECIES_OCEAN_BASE,
  speciesInitialOcean,
  getPersonalityStrength,
  computeOcean,
  oceanEmotionModulation,
  oceanDesireBaseline,
  buildOceanPrompt,
  defaultOcean,
  type OceanPersonality,
  type PersonalityContext,
} from './personality/ocean.js';
import { BodyStateManager } from './brain/cerebellum/body-state.js';
import { IdleBehavior, type IdleAction } from './behavior/idle.js';
import type { EvolutionStage } from './pet/types.js';

// ==================== SPECIES_OCEAN_BASE ====================

describe('SPECIES_OCEAN_BASE 物种基线表', () => {
  it('包含 10 个物种', () => {
    expect(Object.keys(SPECIES_OCEAN_BASE)).toHaveLength(10);
  });

  it('每个物种都有完整的 5 个维度', () => {
    for (const [species, base] of Object.entries(SPECIES_OCEAN_BASE)) {
      expect(base).toHaveProperty('openness');
      expect(base).toHaveProperty('conscientiousness');
      expect(base).toHaveProperty('extraversion');
      expect(base).toHaveProperty('agreeableness');
      expect(base).toHaveProperty('neuroticism');
      // 所有值在 0-100 范围内
      for (const [k, v] of Object.entries(base)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it('不同物种基线不同（猫 vs 机器人差异明显）', () => {
    const cat = SPECIES_OCEAN_BASE['猫'];
    const robot = SPECIES_OCEAN_BASE['机器人'];
    // 猫开放性高，机器人尽责性高
    expect(cat.openness).toBeGreaterThan(robot.openness);
    expect(robot.conscientiousness).toBeGreaterThan(cat.conscientiousness);
  });

  it('光灵是中间值基线（接近 50）', () => {
    const light = SPECIES_OCEAN_BASE['光灵'];
    expect(light.openness).toBeGreaterThanOrEqual(45);
    expect(light.openness).toBeLessThanOrEqual(60);
  });
});

// ==================== speciesInitialOcean ====================

describe('speciesInitialOcean 物种初始值', () => {
  it('使用基线 + 抖动，不是固定值', () => {
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const ocean = speciesInitialOcean('猫');
      results.add(JSON.stringify(ocean));
    }
    // 20 次生成应该有多种不同结果
    expect(results.size).toBeGreaterThan(1);
  });

  it('所有值在 0-100 范围内', () => {
    for (let i = 0; i < 50; i++) {
      const ocean = speciesInitialOcean('幽灵');
      for (const v of Object.values(ocean)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it('未知物种使用光灵基线', () => {
    const ocean = speciesInitialOcean('未知物种');
    const light = speciesInitialOcean('光灵');
    // 两者都基于光灵基线，抖动后可能不同但范围接近
    expect(Math.abs(ocean.openness - light.openness)).toBeLessThan(40);
  });

  it('猫的初始值倾向高开放性、低宜人性', () => {
    // 统计测试：多次取样看趋势
    let opennessSum = 0;
    let agreeablenessSum = 0;
    const n = 100;
    for (let i = 0; i < n; i++) {
      const ocean = speciesInitialOcean('猫');
      opennessSum += ocean.openness;
      agreeablenessSum += ocean.agreeableness;
    }
    const avgOpenness = opennessSum / n;
    const avgAgreeableness = agreeablenessSum / n;
    // 猫基线：openness=60, agreeableness=35，抖动后均值应偏高开放性、低宜人性
    expect(avgOpenness).toBeGreaterThan(45);
    expect(avgAgreeableness).toBeLessThan(55);
  });
});

// ==================== getPersonalityStrength ====================

describe('getPersonalityStrength PS 计算', () => {
  const stages: EvolutionStage[] = ['egg', 'hatching', 'growing', 'formed', 'mature', 'complete', 'legendary'];

  it('蛋阶段 PS 接近 0', () => {
    expect(getPersonalityStrength('egg', 0)).toBe(0);
    expect(getPersonalityStrength('egg', 10)).toBeLessThan(0.1);
  });

  it('传说阶段 PS 接近 1', () => {
    expect(getPersonalityStrength('legendary', 100)).toBeGreaterThanOrEqual(0.95);
  });

  it('PS 随进化阶段递增', () => {
    const psValues = stages.map(s => getPersonalityStrength(s, 0));
    for (let i = 1; i < psValues.length; i++) {
      expect(psValues[i]).toBeGreaterThanOrEqual(psValues[i - 1]);
    }
  });

  it('同一阶段内 formProgress 提供微调', () => {
    // 同一 15-unit 块内递增（41 和 44 都在 30~44 块内）
    const ps1 = getPersonalityStrength('growing', 41);
    const ps2 = getPersonalityStrength('growing', 44);
    expect(ps2).toBeGreaterThanOrEqual(ps1);
    // 微调幅度不超过 0.05
    expect(ps2 - ps1).toBeLessThanOrEqual(0.05);
  });

  it('PS 始终在 0-1 范围内', () => {
    for (const stage of stages) {
      for (const progress of [0, 15, 50, 85, 100]) {
        const ps = getPersonalityStrength(stage, progress);
        expect(ps).toBeGreaterThanOrEqual(0);
        expect(ps).toBeLessThanOrEqual(1);
      }
    }
  });

  it('各阶段基准值符合计划', () => {
    expect(getPersonalityStrength('egg', 0)).toBe(0);
    expect(getPersonalityStrength('hatching', 0)).toBeCloseTo(0.1, 1);
    expect(getPersonalityStrength('growing', 0)).toBeCloseTo(0.3, 1);
    expect(getPersonalityStrength('formed', 0)).toBeCloseTo(0.5, 1);
    expect(getPersonalityStrength('mature', 0)).toBeCloseTo(0.7, 1);
    expect(getPersonalityStrength('complete', 0)).toBeCloseTo(0.85, 1);
    expect(getPersonalityStrength('legendary', 0)).toBeCloseTo(0.95, 1);
  });
});

// ==================== computeOcean PS 惯性 ====================

describe('computeOcean PS 惯性', () => {
  const ctx: PersonalityContext = {
    totalInteractions: 100,
    uniqueToolsUsed: 10,
    uniqueDomains: 5,
    newFeatureDiscoveries: 3,
    taskCompleteRate: 0.8,
    abandonedTasks: 1,
    errorRetryWithoutFix: 0,
    avgMessageLength: 50,
    proactiveSpeakCount: 5,
    feedbackInteractions: 3,
    gratitudeCount: 2,
    harshNegation: 0,
    softCorrection: 1,
    consecutiveErrors: 0,
    successfulRecovery: 2,
    longStablePeriod: true,
    recentEmotionVariance: 0.1,
  };

  it('PS=0 时变化大（低惯性）', () => {
    const current: OceanPersonality = { openness: 50, conscientiousness: 50, extraversion: 50, agreeableness: 50, neuroticism: 50 };
    const resultLow = computeOcean(ctx, current, {}, 0);
    const resultHigh = computeOcean(ctx, current, {}, 1);

    // PS=0 时惯性=0.5，PS=1 时惯性=0.9
    // 低惯性 = 更接近 target，变化更大
    const diffLow = Math.abs(resultLow.openness - 50);
    const diffHigh = Math.abs(resultHigh.openness - 50);
    expect(diffLow).toBeGreaterThan(diffHigh);
  });

  it('PS=1 时接近原值（高惯性）', () => {
    const current: OceanPersonality = { openness: 50, conscientiousness: 50, extraversion: 50, agreeableness: 50, neuroticism: 50 };
    const result = computeOcean(ctx, current, {}, 1);
    // 高惯性下变化小
    for (const dim of ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'] as const) {
      expect(Math.abs(result[dim] - current[dim])).toBeLessThan(20);
    }
  });

  it('默认 PS=1（向后兼容）', () => {
    const current: OceanPersonality = { openness: 50, conscientiousness: 50, extraversion: 50, agreeableness: 50, neuroticism: 50 };
    const resultDefault = computeOcean(ctx, current, {});
    const resultExplicit = computeOcean(ctx, current, {}, 1);
    // 由于有随机噪声，不能精确匹配，但应该在同一量级
    for (const dim of ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'] as const) {
      expect(Math.abs(resultDefault[dim] - resultExplicit[dim])).toBeLessThan(5);
    }
  });
});

// ==================== oceanEmotionModulation PS 缩放 ====================

describe('oceanEmotionModulation PS 缩放', () => {
  const p: OceanPersonality = { openness: 80, conscientiousness: 80, extraversion: 80, agreeableness: 80, neuroticism: 80 };

  it('PS=1 时完全调制（原始值）', () => {
    const factor = oceanEmotionModulation(p, 'joy', 'positive', 1);
    expect(factor).not.toBe(1);
  });

  it('PS=0 时完全不调制（返回 1）', () => {
    const factor = oceanEmotionModulation(p, 'joy', 'positive', 0);
    expect(factor).toBe(1);
  });

  it('PS=0.5 时部分调制', () => {
    const factorFull = oceanEmotionModulation(p, 'joy', 'positive', 1);
    const factorHalf = oceanEmotionModulation(p, 'joy', 'positive', 0.5);
    const factorNone = oceanEmotionModulation(p, 'joy', 'positive', 0);
    // 半调制应该在完全调制和不调制之间
    if (factorFull > 1) {
      expect(factorHalf).toBeGreaterThan(factorNone);
      expect(factorHalf).toBeLessThan(factorFull);
    } else {
      expect(factorHalf).toBeLessThan(factorNone);
      expect(factorHalf).toBeGreaterThan(factorFull);
    }
  });

  it('默认 PS=1（向后兼容）', () => {
    const factorDefault = oceanEmotionModulation(p, 'joy', 'positive');
    const factorExplicit = oceanEmotionModulation(p, 'joy', 'positive', 1);
    expect(factorDefault).toBe(factorExplicit);
  });
});

// ==================== oceanDesireBaseline PS 插值 ====================

describe('oceanDesireBaseline PS 插值', () => {
  const p: OceanPersonality = { openness: 80, conscientiousness: 50, extraversion: 80, agreeableness: 50, neuroticism: 50 };

  it('PS=1 时完全由人格驱动', () => {
    const baseline = oceanDesireBaseline(p, 1);
    // openness=80 → curiosity = 15 + 80*0.4 = 47
    expect(baseline.curiosity).toBeCloseTo(47, 0);
  });

  it('PS=0 时接近物种默认', () => {
    const baseline = oceanDesireBaseline(p, 0);
    // 物种默认 curiosity=30
    expect(baseline.curiosity).toBeCloseTo(30, 0);
    expect(baseline.social).toBeCloseTo(25, 0);
    expect(baseline.expression).toBeCloseTo(20, 0);
    expect(baseline.safety).toBeCloseTo(15, 0);
    expect(baseline.rest).toBeCloseTo(20, 0);
  });

  it('PS=0.5 时在默认和人格之间', () => {
    const baseline0 = oceanDesireBaseline(p, 0);
    const baseline5 = oceanDesireBaseline(p, 0.5);
    const baseline1 = oceanDesireBaseline(p, 1);
    expect(baseline5.curiosity).toBeGreaterThan(baseline0.curiosity);
    expect(baseline5.curiosity).toBeLessThan(baseline1.curiosity);
  });

  it('默认 PS=1（向后兼容）', () => {
    const baselineDefault = oceanDesireBaseline(p);
    const baselineExplicit = oceanDesireBaseline(p, 1);
    expect(baselineDefault.curiosity).toBeCloseTo(baselineExplicit.curiosity, 5);
  });
});

// ==================== buildOceanPrompt PS 分级 ====================

describe('buildOceanPrompt PS 分级', () => {
  const p: OceanPersonality = { openness: 80, conscientiousness: 30, extraversion: 70, agreeableness: 50, neuroticism: 20 };

  it('PS<0.3 输出模糊描述', () => {
    const prompt = buildOceanPrompt(p, 0.1);
    // 模糊描述包含"似乎"、"有时候"等模糊词
    expect(prompt).toContain('你');
    // 不应该包含精确数值
    expect(prompt).not.toMatch(/\d+\/100/);
  });

  it('PS>=0.6 输出精确描述', () => {
    const prompt = buildOceanPrompt(p, 0.8);
    // 精确描述包含数值
    expect(prompt).toMatch(/\d+\/100/);
    // 包含"好奇心"等精确维度名
    expect(prompt).toContain('好奇心');
    expect(prompt).toContain('自律性');
  });

  it('PS=0.3~0.6 也是模糊描述', () => {
    const prompt = buildOceanPrompt(p, 0.4);
    expect(prompt).not.toMatch(/\d+\/100/);
  });

  it('默认 PS=1（向后兼容，精确描述）', () => {
    const prompt = buildOceanPrompt(p);
    expect(prompt).toMatch(/\d+\/100/);
  });

  it('混沌体描述不为空', () => {
    const prompt = buildOceanPrompt(p, 0);
    expect(prompt.length).toBeGreaterThan(10);
  });
});

// ==================== BodyStateManager PS 集成 ====================

describe('BodyStateManager PS 集成', () => {
  it('setPersonalityStrength 不抛异常', () => {
    const engine = new BodyStateManager();
    expect(() => engine.setPersonalityStrength(0)).not.toThrow();
    expect(() => engine.setPersonalityStrength(0.5)).not.toThrow();
    expect(() => engine.setPersonalityStrength(1)).not.toThrow();
  });

  it('PS=0 时 mood 选择有随机性', () => {
    const engine = new BodyStateManager();
    engine.setPersonalityStrength(0);
    engine.onUserMessage();
    engine.onToolSuccess();
    const moods = new Set<string>();
    for (let i = 0; i < 30; i++) {
      moods.add(engine.getMood());
    }
    // PS=0 时应该有较多种 mood
    expect(moods.size).toBeGreaterThan(1);
  });

  it('PS=1 时 mood 相对稳定', () => {
    const engine = new BodyStateManager();
    engine.setPersonalityStrength(1);
    engine.onUserMessage();
    engine.onToolSuccess();
    const moods: string[] = [];
    for (let i = 0; i < 20; i++) {
      moods.push(engine.getMood());
    }
    const uniqueMoods = new Set(moods);
    expect(uniqueMoods.size).toBeLessThanOrEqual(8);
  });
});

// ==================== IdleBehavior PS 集成 ====================

describe('IdleBehavior PS 权重混合', () => {
  it('setPersonalityStrength 不抛异常', () => {
    const idle = new IdleBehavior({ enabled: false });
    expect(() => idle.setPersonalityStrength(0)).not.toThrow();
    expect(() => idle.setPersonalityStrength(1)).not.toThrow();
  });

  it('PS=0 时行为分布更均匀', () => {
    const idle = new IdleBehavior({ enabled: false });
    idle.setPersonalityStrength(0);
    idle.setMood('calm');

    const counts: Record<string, number> = {};
    for (let i = 0; i < 500; i++) {
      const action = idle.triggerRandom();
      if (action) counts[action] = (counts[action] || 0) + 1;
    }

    // PS=0 时所有行为都应该出现（噪声更大，分布更均匀）
    const actionCount = Object.keys(counts).length;
    expect(actionCount).toBeGreaterThanOrEqual(4);
  });

  it('PS=1 时行为由人格驱动', () => {
    const idle = new IdleBehavior({ enabled: false });
    idle.setPersonalityStrength(1);
    idle.setMood('calm');

    const counts: Record<string, number> = {};
    for (let i = 0; i < 500; i++) {
      const action = idle.triggerRandom();
      if (action) counts[action] = (counts[action] || 0) + 1;
    }

    // PS=1 时 blink 权重高（conscientiousness 驱动），应该频繁出现
    expect(counts['blink'] || 0).toBeGreaterThan(0);
  });
});
