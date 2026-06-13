/**
 * TimingController 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TimingController } from '../timing-controller.js';
import type { BodyState } from '../../types.js';

function makeBodyState(overrides?: Partial<BodyState>): BodyState {
  return {
    energy: 80, temperature: 50, load: 30, hunger: 20,
    emotion: { joy: 15, sadness: 5, anger: 0, fear: 0, surprise: 0, disgust: 0, trust: 20, anticipation: 10 },
    desires: { hunger: 20, curiosity: 20, social: 15, safety: 10, expression: 15, rest: 15 },
    focusLevel: 70, confidenceLevel: 60, confusionLevel: 20,
    intimacyLevel: 50, socialNeed: 30,
    hour: 14, isUserActive: true, lastInteractionMs: Date.now(), systemHealth: 'good',
    ...overrides,
  };
}

describe('TimingController', () => {
  let controller: TimingController;

  beforeEach(() => {
    controller = new TimingController({
      maxLoad: 50,
      minSamples: 10,
      maxLossVolatility: 0.1,
      minIntervalMs: 0, // 方便测试
      preferredWindowStart: 0,
      preferredWindowEnd: 24,
    });
  });

  it('should allow when all conditions met', () => {
    const body = makeBodyState({ load: 30 });
    const decision = controller.shouldEvolve(body, 50, [0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(decision.allowed).toBe(true);
    expect(decision.score).toBeGreaterThan(0.8);
  });

  it('should reject when load too high', () => {
    const body = makeBodyState({ load: 80 });
    const decision = controller.shouldEvolve(body, 50, [0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('负载过高');
  });

  it('should reject when samples insufficient', () => {
    const body = makeBodyState({ load: 30 });
    const decision = controller.shouldEvolve(body, 5, [0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('样本不足');
  });

  it('should reject when loss unstable', () => {
    const body = makeBodyState({ load: 30 });
    const decision = controller.shouldEvolve(body, 50, [0.1, 0.9, 0.1, 0.9, 0.1]);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('loss不稳定');
  });

  it('should reject when too few loss samples', () => {
    const body = makeBodyState({ load: 30 });
    const decision = controller.shouldEvolve(body, 50, [0.5]);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('loss不稳定');
  });

  it('should respect minIntervalMs', () => {
    const controller2 = new TimingController({
      maxLoad: 50, minSamples: 10, maxLossVolatility: 0.1,
      minIntervalMs: 24 * 60 * 60 * 1000, // 24h
      preferredWindowStart: 0, preferredWindowEnd: 24,
    });
    controller2.recordEvolution();

    const body = makeBodyState({ load: 30 });
    const decision = controller2.shouldEvolve(body, 50, [0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('距上次进化太近');
  });

  it('should record evolution time', () => {
    const before = controller.getLastEvolutionTime();
    controller.recordEvolution();
    const after = controller.getLastEvolutionTime();
    expect(after).toBeGreaterThan(before);
  });

  it('should calculate score based on passed conditions', () => {
    const body = makeBodyState({ load: 30 });
    const decision = controller.shouldEvolve(body, 50, [0.5, 0.5, 0.5, 0.5, 0.5]);
    // All conditions pass: 0.3 + 0.25 + 0.25 + 0.1 + 0.1 = 1.0
    expect(decision.score).toBe(1.0);
  });
});
