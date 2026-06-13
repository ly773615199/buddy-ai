/**
 * SelfModifier 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SelfModifier } from '../phase10/self-modifier.js';
import type { EvolutionLogEntry } from '../types.js';

function makeLogEntry(overrides?: Partial<EvolutionLogEntry>): EvolutionLogEntry {
  return {
    version: 1,
    timestamp: Date.now(),
    proposal: {
      id: 'p-1',
      level: 'L1',
      type: 'new_rule',
      description: 'test rule',
      gap: {
        id: 'g-1', fingerprint: 'code|medium|tools', description: 'test',
        failures: [], firstDetectedAt: Date.now(), failureCount: 3,
        avgConfidence: 0.1, relatedSamples: 100, priority: 'medium',
      },
      changes: [],
      expectedImpact: 'test',
      createdAt: Date.now(),
    },
    validation: {
      allPassed: false,
      locks: [
        { lockName: '目标漂移检测 (GDI)', passed: false, score: 0.3, details: 'GDI too high' },
      ],
      summary: 'rejected by GDI',
      timestamp: Date.now(),
    },
    result: 'rejected',
    metricsBefore: {},
    metricsAfter: {},
    durationMs: 5000,
    ...overrides,
  };
}

describe('SelfModifier', () => {
  let sm: SelfModifier;

  beforeEach(() => {
    sm = new SelfModifier({ minLogForEvaluation: 3, observationPeriod: 3 });
  });

  it('should return empty if insufficient history', () => {
    const mods = sm.evaluateComponents([makeLogEntry(), makeLogEntry()]);
    expect(mods).toHaveLength(0);
  });

  it('should suggest GDI threshold relaxation when rejection rate is high', () => {
    const history = Array.from({ length: 10 }, () =>
      makeLogEntry({
        result: 'rejected',
        validation: {
          allPassed: false,
          locks: [{ lockName: '目标漂移检测 (GDI)', passed: false, score: 0.3, details: 'GDI too high' }],
          summary: 'rejected',
          timestamp: Date.now(),
        },
      }),
    );

    const mods = sm.evaluateComponents(history);
    const gdiMod = mods.find(m => m.parameter === 'gdiThreshold');
    expect(gdiMod).toBeDefined();
    expect(gdiMod!.newValue).toBeGreaterThan(0.44);
    expect(gdiMod!.status).toBe('pending');
  });

  it('should suggest timing relaxation when intervals are too long', () => {
    const baseTime = Date.now();
    // Create history with varying intervals: 1h, 1h, 100h, 100h
    // avgInterval = 50.67h, minInterval = 1h → avg > min*3 ✓ AND avg > 12h ✓
    const timestamps = [
      baseTime,
      baseTime + 1 * 3600 * 1000,        // +1h
      baseTime + 2 * 3600 * 1000,        // +1h
      baseTime + 102 * 3600 * 1000,      // +100h
      baseTime + 202 * 3600 * 1000,      // +100h
    ];
    const history = timestamps.map((ts, i) =>
      makeLogEntry({
        timestamp: ts,
        result: 'applied',
        validation: {
          allPassed: true,
          locks: [{ lockName: 'all', passed: true, score: 1, details: 'ok' }],
          summary: 'passed',
          timestamp: ts,
        },
      }),
    );

    const mods = sm.evaluateComponents(history);
    const timingMod = mods.find(m => m.target === 'timing_controller');
    expect(timingMod).toBeDefined();
  });

  it('should apply and revert modifications', () => {
    const mod = {
      id: 'test-mod',
      target: 'evolution_lock' as const,
      parameter: 'gdiThreshold',
      oldValue: 0.44,
      newValue: 0.55,
      reason: 'test',
      evidence: [],
      createdAt: Date.now(),
      appliedAt: null,
      revertedAt: null,
      status: 'pending' as const,
    };

    // Apply
    expect(sm.apply(mod)).toBe(true);
    expect(mod.status).toBe('applied');
    expect(mod.appliedAt).toBeGreaterThan(0);
    expect(sm.getComponentState('evolution_lock').gdiThreshold).toBe(0.55);

    // Revert
    expect(sm.revert(mod.id)).toBe(true);
    expect(mod.status).toBe('reverted');
    expect(sm.getComponentState('evolution_lock').gdiThreshold).toBe(0.44);
  });

  it('should not apply non-pending modifications', () => {
    const mod = {
      id: 'test-mod',
      target: 'gap_detector' as const,
      parameter: 'minFailures',
      oldValue: 3,
      newValue: 4,
      reason: 'test',
      evidence: [],
      createdAt: Date.now(),
      appliedAt: Date.now(),
      revertedAt: null,
      status: 'applied' as const,
    };

    expect(sm.apply(mod)).toBe(false);
  });

  it('should check rollback when success rate drops', () => {
    const baseTime = Date.now();

    // Apply a modification
    const mod = {
      id: 'test-mod',
      target: 'evolution_lock' as const,
      parameter: 'gdiThreshold',
      oldValue: 0.44,
      newValue: 0.55,
      reason: 'test',
      evidence: [],
      createdAt: baseTime,
      appliedAt: baseTime,
      revertedAt: null,
      status: 'applied' as const,
    };
    sm['modifications'].push(mod);

    // History: 5 successes before, 2 successes after (dropped)
    const history = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeLogEntry({ timestamp: baseTime - (5 - i) * 1000, result: 'applied' }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        makeLogEntry({ timestamp: baseTime + (i + 1) * 1000, result: 'rejected' }),
      ),
    ];

    const toRevert = sm.checkRollback(history);
    expect(toRevert).toHaveLength(1);
    expect(toRevert[0].id).toBe('test-mod');
  });

  it('should get component performance', () => {
    const history = Array.from({ length: 10 }, (_, i) =>
      makeLogEntry({ result: i < 7 ? 'applied' : 'rejected' }),
    );

    const perf = sm.getComponentPerformance('evolution_lock', history);
    expect(perf.sampleCount).toBe(10);
    expect(perf.metrics.successRate).toBeCloseTo(0.7);
    expect(perf.metrics.rejectionRate).toBeCloseTo(0.3);
  });

  it('should return pending modifications', () => {
    const history = Array.from({ length: 10 }, () =>
      makeLogEntry({ result: 'rejected' }),
    );

    sm.evaluateComponents(history);
    const pending = sm.getPendingModifications();
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every(m => m.status === 'pending')).toBe(true);
  });

  it('should suggest gap detector tightening when success rate is too high', () => {
    const history = Array.from({ length: 25 }, () =>
      makeLogEntry({ result: 'applied' }),
    );

    const mods = sm.evaluateComponents(history);
    const gapMod = mods.find(m => m.target === 'gap_detector' && m.parameter === 'minFailures');
    expect(gapMod).toBeDefined();
    expect(gapMod!.newValue).toBe(4); // tighten from 3 to 4
  });
});
