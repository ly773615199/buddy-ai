/**
 * 需求衰减系统测试
 */

import { describe, test, expect } from 'vitest';
import { DesireDecay } from './decay.js';
import type { DesireVector } from './engine.js';
import type { OceanPersonality } from '../personality/ocean.js';

function mockDesires(overrides: Partial<DesireVector> = {}): DesireVector {
  return { hunger: 30, curiosity: 30, social: 30, safety: 20, expression: 20, rest: 30, ...overrides };
}

function mockOcean(overrides: Partial<OceanPersonality> = {}): OceanPersonality {
  return { openness: 50, conscientiousness: 50, extraversion: 50, agreeableness: 50, neuroticism: 50, ...overrides };
}

describe('DesireDecay', () => {
  test('tick 后各需求增长', () => {
    const decay = new DesireDecay();
    const before = decay.getAccumulator();
    decay.tick();
    const after = decay.getAccumulator();
    expect(after.hunger).toBeGreaterThan(before.hunger);
    expect(after.curiosity).toBeGreaterThan(before.curiosity);
    expect(after.social).toBeGreaterThan(before.social);
    expect(after.rest).toBeGreaterThan(before.rest);
  });

  test('多次 tick 累积增长', () => {
    const decay = new DesireDecay();
    decay.tick();
    const once = decay.getAccumulator().hunger;
    decay.tick();
    const twice = decay.getAccumulator().hunger;
    expect(twice).toBe(once * 2);
  });

  test('需求不会超过 100', () => {
    const decay = new DesireDecay();
    for (let i = 0; i < 100; i++) decay.tick();
    const acc = decay.getAccumulator();
    expect(acc.hunger).toBeLessThanOrEqual(100);
    expect(acc.rest).toBeLessThanOrEqual(100);
  });

  test('onInteraction 降低社交欲', () => {
    const decay = new DesireDecay();
    for (let i = 0; i < 10; i++) decay.tick(); // 累积一些
    const before = decay.getAccumulator().social;
    decay.onInteraction();
    const after = decay.getAccumulator().social;
    expect(after).toBeLessThan(before);
  });

  test('onTaskComplete 降低表达欲', () => {
    const decay = new DesireDecay();
    for (let i = 0; i < 10; i++) decay.tick();
    const before = decay.getAccumulator().expression;
    decay.onTaskComplete();
    const after = decay.getAccumulator().expression;
    expect(after).toBeLessThan(before);
  });

  test('onTaskComplete 增加疲劳', () => {
    const decay = new DesireDecay();
    const beforeRest = decay.getAccumulator().rest;
    decay.onTaskComplete();
    const afterRest = decay.getAccumulator().rest;
    expect(afterRest).toBeGreaterThan(beforeRest);
  });

  test('mergeWithBase 将累积值加到基础上', () => {
    const decay = new DesireDecay();
    decay.tick();
    decay.tick();
    const base = mockDesires({ hunger: 50 });
    const merged = decay.mergeWithBase(base);
    expect(merged.hunger).toBeGreaterThan(50);
    expect(merged.hunger).toBeLessThanOrEqual(100);
  });

  test('mergeWithBase 不超过 100', () => {
    const decay = new DesireDecay();
    for (let i = 0; i < 50; i++) decay.tick();
    const base = mockDesires({ hunger: 90 });
    const merged = decay.mergeWithBase(base);
    expect(merged.hunger).toBeLessThanOrEqual(100);
  });

  test('reset 清空累积', () => {
    const decay = new DesireDecay();
    decay.tick();
    decay.tick();
    decay.reset();
    const acc = decay.getAccumulator();
    expect(acc.hunger).toBe(0);
    expect(acc.social).toBe(0);
  });

  test('高开放性加速求知欲增长', () => {
    const decayLow = new DesireDecay();
    decayLow.setOcean(mockOcean({ openness: 20 }));
    const decayHigh = new DesireDecay();
    decayHigh.setOcean(mockOcean({ openness: 90 }));
    decayLow.tick();
    decayHigh.tick();
    expect(decayHigh.getAccumulator().curiosity).toBeGreaterThan(decayLow.getAccumulator().curiosity);
  });

  test('高外倾性加速社交欲增长', () => {
    const decayLow = new DesireDecay();
    decayLow.setOcean(mockOcean({ extraversion: 20 }));
    const decayHigh = new DesireDecay();
    decayHigh.setOcean(mockOcean({ extraversion: 90 }));
    decayLow.tick();
    decayHigh.tick();
    expect(decayHigh.getAccumulator().social).toBeGreaterThan(decayLow.getAccumulator().social);
  });

  test('高神经质加速安全欲增长', () => {
    const decayLow = new DesireDecay();
    decayLow.setOcean(mockOcean({ neuroticism: 20 }));
    const decayHigh = new DesireDecay();
    decayHigh.setOcean(mockOcean({ neuroticism: 90 }));
    decayLow.tick();
    decayHigh.tick();
    expect(decayHigh.getAccumulator().safety).toBeGreaterThan(decayLow.getAccumulator().safety);
  });
});
