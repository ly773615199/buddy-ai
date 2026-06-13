/**
 * GapDetector 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GapDetector } from '../gap-detector.js';
import type { TaskSignal, DecisionOutcome } from '../../types.js';

function makeSignal(overrides?: Partial<TaskSignal>): TaskSignal {
  return {
    domains: ['code'],
    complexity: 'medium',
    taskType: 'tools',
    shouldUseDAG: false,
    dagReason: '',
    intentConfidence: 0.5,
    ...overrides,
  };
}

function makeOutcome(success: boolean, tools: string[] = []): DecisionOutcome {
  return {
    success,
    latencyMs: 100,
    costEstimate: 0,
    toolsUsed: tools,
  };
}

describe('GapDetector', () => {
  let detector: GapDetector;

  beforeEach(() => {
    detector = new GapDetector({ minFailures: 3, maxConfidence: 0.3 });
  });

  it('should not create gaps on success', () => {
    const signal = makeSignal();
    detector.observe(signal, makeOutcome(true), 0.8);
    expect(detector.getAllGaps()).toHaveLength(0);
  });

  it('should create gap on failure', () => {
    const signal = makeSignal();
    detector.observe(signal, makeOutcome(false, ['exec']), 0.1);
    const gaps = detector.getAllGaps();
    expect(gaps).toHaveLength(1);
    expect(gaps[0].failureCount).toBe(1);
    expect(gaps[0].priority).toBe('low');
  });

  it('should reset gap on success after failures', () => {
    const signal = makeSignal();
    detector.observe(signal, makeOutcome(false), 0.1);
    detector.observe(signal, makeOutcome(false), 0.1);
    detector.observe(signal, makeOutcome(true), 0.8);
    const gaps = detector.getAllGaps();
    expect(gaps[0].failureCount).toBe(0);
  });

  it('should return actionable gaps after minFailures', () => {
    const signal = makeSignal();
    detector.observe(signal, makeOutcome(false), 0.1);
    detector.observe(signal, makeOutcome(false), 0.1);
    expect(detector.getActionableGaps()).toHaveLength(0);

    detector.observe(signal, makeOutcome(false), 0.1);
    expect(detector.getActionableGaps()).toHaveLength(1);
  });

  it('should not return actionable gaps with high confidence', () => {
    const signal = makeSignal();
    detector.observe(signal, makeOutcome(false), 0.8);
    detector.observe(signal, makeOutcome(false), 0.8);
    detector.observe(signal, makeOutcome(false), 0.8);
    expect(detector.getActionableGaps()).toHaveLength(0);
  });

  it('should calculate priority correctly', () => {
    const detector2 = new GapDetector({ minFailures: 1, maxConfidence: 0.5 });
    const signal = makeSignal();

    // 3 failures → medium
    detector2.observe(signal, makeOutcome(false), 0.1);
    detector2.observe(signal, makeOutcome(false), 0.1);
    detector2.observe(signal, makeOutcome(false), 0.1);
    expect(detector2.getActionableGaps()[0].priority).toBe('medium');

    // 5 failures + low confidence → high
    detector2.observe(signal, makeOutcome(false), 0.1);
    detector2.observe(signal, makeOutcome(false), 0.1);
    expect(detector2.getActionableGaps()[0].priority).toBe('high');
  });

  it('should handle multiple fingerprints independently', () => {
    const sig1 = makeSignal({ domains: ['code'] });
    const sig2 = makeSignal({ domains: ['web'] });

    detector.observe(sig1, makeOutcome(false), 0.1);
    detector.observe(sig2, makeOutcome(false), 0.1);

    expect(detector.getAllGaps()).toHaveLength(2);
  });

  it('should prune resolved gaps', () => {
    const signal = makeSignal();
    detector.observe(signal, makeOutcome(false), 0.1);
    detector.observe(signal, makeOutcome(true), 0.8);
    const pruned = detector.pruneResolved();
    expect(pruned).toBe(1);
    expect(detector.getAllGaps()).toHaveLength(0);
  });

  it('should return correct stats', () => {
    const sig1 = makeSignal({ domains: ['code'] });
    const sig2 = makeSignal({ domains: ['web'] });

    for (let i = 0; i < 5; i++) {
      detector.observe(sig1, makeOutcome(false), 0.1);
    }
    detector.observe(sig2, makeOutcome(false), 0.1);

    const stats = detector.getStats();
    expect(stats.totalGaps).toBe(2);
    expect(stats.actionableGaps).toBe(1); // only sig1 has >= 3 failures
  });

  it('should generate consistent fingerprints', () => {
    const sig1 = makeSignal({ domains: ['a', 'b'] });
    const sig2 = makeSignal({ domains: ['b', 'a'] });
    // Same domains (sorted), same complexity, same taskType → same fingerprint
    expect(detector['fingerprint'](sig1)).toBe(detector['fingerprint'](sig2));
  });

  it('should get gap by fingerprint', () => {
    const signal = makeSignal();
    detector.observe(signal, makeOutcome(false), 0.1);
    const fp = detector['fingerprint'](signal);
    const gap = detector.getGap(fp);
    expect(gap).toBeDefined();
    expect(gap!.fingerprint).toBe(fp);
  });

  it('should return undefined for unknown fingerprint', () => {
    expect(detector.getGap('nonexistent|medium|tools')).toBeUndefined();
  });
});
