/**
 * MetaLearner 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MetaLearner } from '../phase10/meta-learner.js';
import type { StrategyEvaluation } from '../phase10/meta-learner.js';

describe('MetaLearner', () => {
  let ml: MetaLearner;

  beforeEach(() => {
    ml = new MetaLearner({ minUsageForTrust: 2, maxStrategies: 20 });
  });

  it('should load builtin strategies on init', () => {
    const all = ml.getAllStrategies();
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(all.some(s => s.id === 'default-curriculum')).toBe(true);
    expect(all.some(s => s.id === 'fast-random')).toBe(true);
  });

  it('should select default-curriculum for unknown taskType', () => {
    const best = ml.selectBest('unknown-type');
    expect(best.id).toBe('default-curriculum');
  });

  it('should select best strategy after enough evaluations', () => {
    // Add a custom strategy
    ml.addStrategy({
      id: 'custom-1',
      name: 'Custom',
      samplingMethod: 'contextual',
      lrSchedule: 'adaptive',
      batchSize: 8,
      avgConvergenceSteps: 0,
      avgFinalLoss: 0,
      taskTypes: ['code'],
      usageCount: 0,
      successCount: 0,
      createdAt: Date.now(),
      lastUsedAt: 0,
    });

    // Record evaluations for custom-1 (high success)
    for (let i = 0; i < 5; i++) {
      ml.evaluate({
        strategyId: 'custom-1',
        taskType: 'code',
        convergenceSteps: 20,
        finalLoss: 0.05,
        forgettingRate: 0.01,
        sampleEfficiency: 0.8,
        timestamp: Date.now(),
      });
    }

    // Record evaluations for default-curriculum (low success)
    for (let i = 0; i < 5; i++) {
      ml.evaluate({
        strategyId: 'default-curriculum',
        taskType: 'code',
        convergenceSteps: 100,
        finalLoss: 0.3,
        forgettingRate: 0.1,
        sampleEfficiency: 0.3,
        timestamp: Date.now(),
      });
    }

    const best = ml.selectBest('code');
    expect(best.id).toBe('custom-1');
  });

  it('should recommend switch on oscillation', () => {
    // Add a strategy with enough usage
    ml.addStrategy({
      id: 'stable-strategy',
      name: 'Stable',
      samplingMethod: 'curriculum',
      lrSchedule: 'cosine',
      batchSize: 4,
      avgConvergenceSteps: 50,
      avgFinalLoss: 0.1,
      taskTypes: ['tools'],
      usageCount: 10,
      successCount: 8,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    });

    // Oscillating losses — need enough sign changes (>= 4) in last 6 items
    const oscillatingLosses = [0.5, 0.3, 0.6, 0.2, 0.7, 0.1, 0.8, 0.05, 0.9, 0.02];
    const rec = ml.recommendSwitch('default-curriculum', oscillatingLosses, 'tools');
    expect(rec.shouldSwitch).toBe(true);
    expect(rec.reason).toContain('震荡');
  });

  it('should not recommend switch when converged', () => {
    const convergedLosses = [0.5, 0.4, 0.3, 0.2, 0.1, 0.05, 0.03, 0.02, 0.01, 0.005];
    const rec = ml.recommendSwitch('default-curriculum', convergedLosses, 'code');
    expect(rec.shouldSwitch).toBe(false);
    expect(rec.reason).toContain('收敛');
  });

  it('should not recommend switch with insufficient data', () => {
    const fewLosses = [0.5, 0.4];
    const rec = ml.recommendSwitch('default-curriculum', fewLosses, 'code');
    expect(rec.shouldSwitch).toBe(false);
    expect(rec.reason).toContain('数据不足');
  });

  it('should generate strategy based on bottleneck', () => {
    const strategy = ml.generateStrategy('code', {
      avgLoss: 0.6,
      convergenceSteps: 150,
      forgettingRate: 0.15,
    });

    expect(strategy.taskTypes).toContain('code');
    expect(strategy.samplingMethod).toBe('re-attentive'); // slow + high forgetting
    expect(strategy.lrSchedule).toBe('adaptive');
    expect(ml.getStrategy(strategy.id)).toBeDefined();
  });

  it('should evict LRU strategy when at capacity', () => {
    const smallMl = new MetaLearner({ maxStrategies: 6, minUsageForTrust: 1 });

    // Fill up to capacity (4 builtin + 2 custom)
    smallMl.addStrategy({
      id: 'custom-a', name: 'A', samplingMethod: 'random', lrSchedule: 'constant',
      batchSize: 4, avgConvergenceSteps: 0, avgFinalLoss: 0, taskTypes: ['a'],
      usageCount: 0, successCount: 0, createdAt: Date.now(), lastUsedAt: 0,
    });
    smallMl.addStrategy({
      id: 'custom-b', name: 'B', samplingMethod: 'random', lrSchedule: 'constant',
      batchSize: 4, avgConvergenceSteps: 0, avgFinalLoss: 0, taskTypes: ['b'],
      usageCount: 0, successCount: 0, createdAt: Date.now(), lastUsedAt: 0,
    });

    const countBefore = smallMl.getAllStrategies().length;

    // Add one more → should evict oldest
    smallMl.addStrategy({
      id: 'custom-c', name: 'C', samplingMethod: 'curriculum', lrSchedule: 'cosine',
      batchSize: 8, avgConvergenceSteps: 0, avgFinalLoss: 0, taskTypes: ['c'],
      usageCount: 0, successCount: 0, createdAt: Date.now(), lastUsedAt: 0,
    });

    expect(smallMl.getAllStrategies().length).toBe(countBefore);
    expect(smallMl.getStrategy('custom-c')).toBeDefined();
  });

  it('should return correct summary', () => {
    const summary = ml.getSummary();
    expect(summary.totalStrategies).toBeGreaterThanOrEqual(4);
    expect(summary.bySamplingMethod).toHaveProperty('random');
    expect(summary.bySamplingMethod).toHaveProperty('curriculum');
    expect(summary.byLRschedule).toHaveProperty('cosine');
    expect(summary.byLRschedule).toHaveProperty('adaptive');
  });

  it('should track evaluation history and update strategy stats', () => {
    ml.evaluate({
      strategyId: 'fast-random',
      taskType: 'simple',
      convergenceSteps: 30,
      finalLoss: 0.1,
      forgettingRate: 0.02,
      sampleEfficiency: 0.9,
      timestamp: Date.now(),
    });

    const strategy = ml.getStrategy('fast-random');
    expect(strategy).toBeDefined();
    expect(strategy!.usageCount).toBe(1);
    expect(strategy!.lastUsedAt).toBeGreaterThan(0);
  });
});
