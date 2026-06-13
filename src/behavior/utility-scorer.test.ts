/**
 * Utility AI 打分引擎测试
 */

import { describe, test, expect } from 'vitest';
import { scoreAction, scoreAllActions, selectAction, type ScoringContext } from './utility-scorer.js';
import type { IdleAction } from './idle.js';
import type { EmotionVector, Mood } from '../emotion/engine.js';
import type { OceanPersonality } from '../personality/ocean.js';
import type { DesireVector } from '../desire/engine.js';

// ==================== Mock 工具 ====================

function mockDesires(overrides: Partial<DesireVector> = {}): DesireVector {
  return {
    hunger: 30, curiosity: 30, social: 30, safety: 20, expression: 20, rest: 30,
    ...overrides,
  };
}

function mockEmotion(overrides: Partial<EmotionVector> = {}): EmotionVector {
  return {
    joy: 30, sadness: 10, anger: 5, fear: 5, surprise: 10, disgust: 5, trust: 30, anticipation: 20,
    ...overrides,
  };
}

function mockOcean(overrides: Partial<OceanPersonality> = {}): OceanPersonality {
  return {
    openness: 50, conscientiousness: 50, extraversion: 50, agreeableness: 50, neuroticism: 50,
    ...overrides,
  };
}

function mockContext(overrides: Partial<ScoringContext> = {}): ScoringContext {
  return {
    desires: mockDesires(),
    emotion: mockEmotion(),
    mood: 'calm',
    ocean: mockOcean(),
    personalityStrength: 1,
    hour: 14,
    idleMinutes: 1,
    lastAction: null,
    lastActionAge: 0,
    recentActions: [],
    userPresent: false,
    userLastInteraction: Date.now(),
    ...overrides,
  };
}

function argmax(scores: Array<{ action: IdleAction; score: number }>): IdleAction {
  return scores.reduce((best, curr) => curr.score > best.score ? curr : best).action;
}

// ==================== 需求打分测试 ====================

describe('scoreNeed', () => {
  test('高 rest 时 yawn 分数显著上升', () => {
    const ctxLow = mockContext({ desires: mockDesires({ rest: 20 }) });
    const ctxHigh = mockContext({ desires: mockDesires({ rest: 85 }) });
    const lowAvg = avgN(() => scoreAction('yawn', ctxLow), 30);
    const highAvg = avgN(() => scoreAction('yawn', ctxHigh), 30);
    expect(highAvg).toBeGreaterThan(lowAvg);
  });

  test('高 social 时 wave 分数上升', () => {
    const ctx = mockContext({ desires: mockDesires({ social: 80 }) });
    const score = scoreAction('wave', ctx);
    expect(score).toBeGreaterThan(0.4);
  });

  test('高 curiosity 时 look_around 和 think 分数上升', () => {
    const ctx = mockContext({ desires: mockDesires({ curiosity: 80 }) });
    const lookAvg = avgN(() => scoreAction('look_around', ctx), 30);
    const thinkAvg = avgN(() => scoreAction('think', ctx), 30);
    const blinkAvg = avgN(() => scoreAction('blink', ctx), 30);
    expect(lookAvg).toBeGreaterThan(blinkAvg);
    expect(thinkAvg).toBeGreaterThan(blinkAvg);
  });

  test('极度疲劳时 sleep 分数高', () => {
    const ctx = mockContext({ desires: mockDesires({ rest: 90 }) });
    const score = scoreAction('sleep', ctx);
    expect(score).toBeGreaterThan(0.5);
  });

  test('低 rest 时 sleep 分数接近 0', () => {
    const ctx = mockContext({ desires: mockDesires({ rest: 30 }) });
    const score = scoreAction('sleep', ctx);
    expect(score).toBeLessThan(0.3);
  });
});

// ==================== 情绪打分测试 ====================

describe('scoreMood', () => {
  test('excited 情绪下 wave 亲和度最高', () => {
    const ctx = mockContext({
      mood: 'excited',
      emotion: mockEmotion({ joy: 80, anticipation: 70 }),
    });
    const waveAvg = avgN(() => scoreAction('wave', ctx), 30);
    const blinkAvg = avgN(() => scoreAction('blink', ctx), 30);
    expect(waveAvg).toBeGreaterThan(blinkAvg);
  });

  test('tired 情绪下 yawn 亲和度最高', () => {
    const ctx = mockContext({
      mood: 'tired',
      emotion: mockEmotion({ sadness: 60 }),
    });
    // 多次运行取平均（噪声可能导致个别运行偏差）
    const yawnAvg = avgN(() => scoreAction('yawn', ctx), 30);
    const blinkAvg = avgN(() => scoreAction('blink', ctx), 30);
    expect(yawnAvg).toBeGreaterThan(blinkAvg);
  });

  test('thinking 情绪下 think 亲和度最高', () => {
    const ctx = mockContext({
      mood: 'thinking',
      emotion: mockEmotion({ anticipation: 60 }),
    });
    const scores = scoreAllActions(ctx);
    expect(argmax(scores)).toBe('think');
  });

  test('强情绪时行为更夸张（分数更高）', () => {
    const ctxWeak = mockContext({
      mood: 'excited',
      emotion: mockEmotion({ joy: 20, anticipation: 20 }),
    });
    const ctxStrong = mockContext({
      mood: 'excited',
      emotion: mockEmotion({ joy: 90, anticipation: 80 }),
    });
    const weakWave = scoreAction('wave', ctxWeak);
    const strongWave = scoreAction('wave', ctxStrong);
    expect(strongWave).toBeGreaterThan(weakWave);
  });
});

// ==================== 环境打分测试 ====================

describe('scoreContext', () => {
  test('深夜时 sleep 和 yawn 分数上升', () => {
    const ctxDay = mockContext({ hour: 14 });
    const ctxNight = mockContext({ hour: 2 });
    const dayAvg = avgN(() => scoreAction('sleep', ctxDay), 30);
    const nightAvg = avgN(() => scoreAction('sleep', ctxNight), 30);
    expect(nightAvg).toBeGreaterThan(dayAvg);
  });

  test('用户在看时 wave 分数上升', () => {
    const ctxAbsent = mockContext({ userPresent: false });
    const ctxPresent = mockContext({ userPresent: true });
    const absentWave = scoreAction('wave', ctxAbsent);
    const presentWave = scoreAction('wave', ctxPresent);
    expect(presentWave).toBeGreaterThan(absentWave);
  });

  test('用户在看时 sleep 分数下降', () => {
    const ctxAbsent = mockContext({ userPresent: false });
    const ctxPresent = mockContext({ userPresent: true });
    // 多次运行取平均（消除噪声）
    const absentAvg = avgN(() => scoreAction('sleep', ctxAbsent), 30);
    const presentAvg = avgN(() => scoreAction('sleep', ctxPresent), 30);
    expect(presentAvg).toBeLessThan(absentAvg);
  });

  test('声音事件时 look_around 分数上升', () => {
    const ctxQuiet = mockContext({ soundEvent: undefined });
    const ctxSound = mockContext({ soundEvent: 'doorbell' });
    const quietAvg = avgN(() => scoreAction('look_around', ctxQuiet), 30);
    const soundAvg = avgN(() => scoreAction('look_around', ctxSound), 30);
    expect(soundAvg).toBeGreaterThan(quietAvg);
  });

  test('用户语音兴奋时 wave 分数上升', () => {
    const ctxNeutral = mockContext({ voiceEmotion: undefined });
    const ctxExcited = mockContext({ voiceEmotion: 'excited' });
    const neutralAvg = avgN(() => scoreAction('wave', ctxNeutral), 30);
    const excitedAvg = avgN(() => scoreAction('wave', ctxExcited), 30);
    expect(excitedAvg).toBeGreaterThan(neutralAvg);
  });

  test('长时间空闲后 yawn 和 sleep 分数上升', () => {
    const ctxShort = mockContext({ idleMinutes: 1 });
    const ctxLong = mockContext({ idleMinutes: 15 });
    const shortAvg = avgN(() => scoreAction('yawn', ctxShort), 30);
    const longAvg = avgN(() => scoreAction('yawn', ctxLong), 30);
    expect(longAvg).toBeGreaterThan(shortAvg);
  });
});

// ==================== 新鲜感测试 ====================

describe('scoreNovelty', () => {
  test('最近做过的动作降权', () => {
    const ctxFresh = mockContext({ recentActions: [] });
    const ctxRepeat = mockContext({ recentActions: ['yawn', 'yawn', 'yawn'] });
    const freshAvg = avgN(() => scoreAction('yawn', ctxFresh), 30);
    const repeatAvg = avgN(() => scoreAction('yawn', ctxRepeat), 30);
    expect(repeatAvg).toBeLessThan(freshAvg);
  });

  test('连续重复 3 次后分数显著降低', () => {
    const ctx = mockContext({ recentActions: ['wave', 'wave', 'wave'] });
    const score = scoreAction('wave', ctx);
    expect(score).toBeLessThan(0.3);
  });
});

// ==================== 人格打分测试 ====================

describe('scorePersonality', () => {
  test('高外倾性提升 wave/peek 分数', () => {
    const ctxLow = mockContext({ ocean: mockOcean({ extraversion: 20 }) });
    const ctxHigh = mockContext({ ocean: mockOcean({ extraversion: 90 }) });
    const waveLow = avgN(() => scoreAction('wave', ctxLow), 30);
    const waveHigh = avgN(() => scoreAction('wave', ctxHigh), 30);
    const peekLow = avgN(() => scoreAction('peek', ctxLow), 30);
    const peekHigh = avgN(() => scoreAction('peek', ctxHigh), 30);
    expect(waveHigh).toBeGreaterThan(waveLow);
    expect(peekHigh).toBeGreaterThan(peekLow);
  });

  test('高开放性提升 think/look_around 分数', () => {
    const ctxLow = mockContext({ ocean: mockOcean({ openness: 20 }) });
    const ctxHigh = mockContext({ ocean: mockOcean({ openness: 90 }) });
    const thinkLow = avgN(() => scoreAction('think', ctxLow), 30);
    const thinkHigh = avgN(() => scoreAction('think', ctxHigh), 30);
    const lookLow = avgN(() => scoreAction('look_around', ctxLow), 30);
    const lookHigh = avgN(() => scoreAction('look_around', ctxHigh), 30);
    expect(thinkHigh).toBeGreaterThan(thinkLow);
    expect(lookHigh).toBeGreaterThan(lookLow);
  });

  test('高神经质增加噪声幅度', () => {
    const ctxLow = mockContext({ ocean: mockOcean({ neuroticism: 10 }) });
    const ctxHigh = mockContext({ ocean: mockOcean({ neuroticism: 95 }) });
    // 多次运行取方差
    const lowScores = Array.from({ length: 50 }, () => scoreAction('blink', ctxLow));
    const highScores = Array.from({ length: 50 }, () => scoreAction('blink', ctxHigh));
    const lowVar = variance(lowScores);
    const highVar = variance(highScores);
    expect(highVar).toBeGreaterThan(lowVar);
  });
});

// ==================== Utility 选择测试 ====================

describe('selectAction', () => {
  test('高 rest 时大概率选 yawn', () => {
    const ctx = mockContext({ desires: mockDesires({ rest: 85 }) });
    const results = runN(ctx, 100);
    const yawnRate = results.filter(a => a === 'yawn').length / 100;
    expect(yawnRate).toBeGreaterThan(0.3);
  });

  test('高 social + 用户在看时大概率选 wave', () => {
    const ctx = mockContext({
      desires: mockDesires({ social: 80 }),
      userPresent: true,
    });
    const results = runN(ctx, 100);
    const waveRate = results.filter(a => a === 'wave').length / 100;
    expect(waveRate).toBeGreaterThan(0.2);
  });

  test('深夜大概率选 sleep 或 yawn', () => {
    const ctx = mockContext({
      hour: 2,
      desires: mockDesires({ rest: 60 }),
    });
    const results = runN(ctx, 100);
    const drowsyRate = results.filter(a => a === 'sleep' || a === 'yawn').length / 100;
    expect(drowsyRate).toBeGreaterThan(0.3);
  });

  test('不会永远选同一个动作（有随机性）', () => {
    const ctx = mockContext();
    const results = runN(ctx, 50);
    const unique = new Set(results).size;
    expect(unique).toBeGreaterThanOrEqual(2);
  });
});

// ==================== 工具函数 ====================

function runN(ctx: ScoringContext, n: number): IdleAction[] {
  return Array.from({ length: n }, () => selectAction(ctx));
}

function avgN(fn: () => number, n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += fn();
  return sum / n;
}

function variance(arr: number[]): number {
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
}
