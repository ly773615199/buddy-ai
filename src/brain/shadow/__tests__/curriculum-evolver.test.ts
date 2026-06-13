/**
 * CurriculumEvolver 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CurriculumEvolver } from '../phase10/curriculum-evolver.js';

describe('CurriculumEvolver', () => {
  let ce: CurriculumEvolver;

  beforeEach(() => {
    ce = new CurriculumEvolver({ minUsageForTrust: 2 });
  });

  it('should load builtin strategies', () => {
    const all = ce.getAllStrategies();
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(ce.getCurrent().id).toBe('standard');
  });

  it('should return sampling weights for warmup phase', () => {
    const weights = ce.getSamplingWeights(50); // within warmup (100)
    expect(weights.easyWeight).toBe(1);
    expect(weights.mediumWeight).toBe(0);
    expect(weights.hardWeight).toBe(0);
  });

  it('should return graduated weights after warmup', () => {
    const weights = ce.getSamplingWeights(500);
    expect(weights.easyWeight).toBeGreaterThan(0);
    expect(weights.easyWeight + weights.mediumWeight + weights.hardWeight).toBeCloseTo(1);
  });

  it('should switch strategy', () => {
    expect(ce.switchTo('aggressive')).toBe(true);
    expect(ce.getCurrent().id).toBe('aggressive');
  });

  it('should not switch to unknown strategy', () => {
    expect(ce.switchTo('nonexistent')).toBe(false);
    expect(ce.getCurrent().id).toBe('standard');
  });

  it('should generate variant based on bottleneck', () => {
    const variant = ce.generateVariant('code', {
      avgLoss: 0.6,
      convergenceSteps: 250,
      forgettingRate: 0.15,
    });

    expect(variant.id).toContain('gen-code');
    // warmupSteps = min(500, 100 * 1.5) = 150
    expect(variant.warmupSteps).toBeGreaterThanOrEqual(150);
    expect(variant.easyRatio).toBeGreaterThan(0.7); // high forgetting → more easy
    expect(ce.getAllStrategies().some(s => s.id === variant.id)).toBe(true);
  });

  it('should recommend switch on oscillation', () => {
    ce.addStrategy({
      id: 'test-strategy',
      name: 'Test',
      warmupSteps: 50,
      easyRatio: 0.6,
      progressSchedule: 'step',
      difficultyThreshold: 0.8,
      difficultyGrowth: 0.01,
      convergenceSteps: 100,
      finalLoss: 0.1,
      forgettingRate: 0.02,
      usageCount: 10,
      successCount: 8,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    });

    // Need >= 20 items (recommendSwitch threshold) with oscillation
    const oscillating = Array.from({ length: 25 }, (_, i) =>
      i % 2 === 0 ? 0.5 + Math.random() * 0.3 : 0.1 + Math.random() * 0.1
    );
    const rec = ce.recommendSwitch(oscillating);
    expect(rec.shouldSwitch).toBe(true);
    expect(rec.reason).toContain('震荡');
  });

  it('should not recommend switch when converged', () => {
    const converged = Array(15).fill(0.0005);
    const rec = ce.recommendSwitch(converged);
    expect(rec.shouldSwitch).toBe(false);
  });

  it('should track evaluations and update stats', () => {
    ce.evaluate({
      strategyId: 'standard',
      taskType: 'code',
      convergenceSteps: 80,
      finalLoss: 0.05,
      forgettingRate: 0.01,
      sampleEfficiency: 0.9,
      timestamp: Date.now(),
    });

    const strategy = ce.getAllStrategies().find(s => s.id === 'standard');
    expect(strategy).toBeDefined();
    expect(strategy!.usageCount).toBe(1);
  });

  it('should return correct summary', () => {
    const summary = ce.getSummary();
    expect(summary.totalStrategies).toBeGreaterThanOrEqual(4);
    expect(summary.currentStrategy).toBe('standard');
    expect(summary.bySchedule).toHaveProperty('linear');
  });
});
