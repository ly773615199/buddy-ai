/**
 * StateManager + ABTestRecorder 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EvolutionStateManager } from '../state-manager.js';
import { ABTestRecorder } from '../ab-recorder.js';
import type { EvolutionSnapshot, ABTestResult } from '../types.js';

describe('EvolutionStateManager', () => {
  let manager: EvolutionStateManager;

  beforeEach(() => {
    manager = new EvolutionStateManager('/tmp/buddy-test-shadow');
  });

  it('should save and retrieve snapshots', async () => {
    const version = await manager.saveSnapshot({
      leftRules: [],
      nnConfig: {} as any,
      nnParamCount: 100,
      metrics: { successRate: 0.8, avgLatencyMs: 100, gdi: 0.1, capabilityCount: 5 },
    });

    expect(version).toBe(1);
    expect(manager.currentVersion).toBe(1);

    const snapshot = manager.getSnapshot(1);
    expect(snapshot).toBeDefined();
    expect(snapshot!.metrics.successRate).toBe(0.8);
  });

  it('should increment version on each save', async () => {
    await manager.saveSnapshot({ leftRules: [], nnConfig: {} as any, nnParamCount: 0, metrics: { successRate: 0, avgLatencyMs: 0, gdi: 0, capabilityCount: 0 } });
    await manager.saveSnapshot({ leftRules: [], nnConfig: {} as any, nnParamCount: 0, metrics: { successRate: 0, avgLatencyMs: 0, gdi: 0, capabilityCount: 0 } });
    expect(manager.currentVersion).toBe(2);
  });

  it('should track capabilities', () => {
    // successRate = successRate * 0.9 + 0.1, starting from 0
    // After n successes: 1 - 0.9^n, need ~20 to reach 0.88
    for (let i = 0; i < 20; i++) {
      manager.updateCapability('code|medium|tools', true, 'code task');
    }

    const cap = manager.getCapability('code|medium|tools');
    expect(cap).toBeDefined();
    expect(cap!.status).toBe('mastered');
    expect(cap!.successRate).toBeGreaterThan(0.8);
  });

  it('should track gap capabilities', () => {
    for (let i = 0; i < 5; i++) {
      manager.updateCapability('web|complex|tools', false, 'web task');
    }

    const cap = manager.getCapability('web|complex|tools');
    expect(cap).toBeDefined();
    expect(cap!.status).toBe('gap');
  });

  it('should mark evolving', () => {
    manager.updateCapability('code|medium|tools', false, 'test');
    manager.markEvolving('code|medium|tools');

    const cap = manager.getCapability('code|medium|tools');
    expect(cap!.status).toBe('evolving');
  });

  it('should return correct capability map', () => {
    manager.updateCapability('a', true, 'a');
    manager.updateCapability('b', false, 'b');

    const map = manager.getCapabilityMap();
    expect(map.totalCapabilities).toBe(2);
  });

  it('should log evolution', () => {
    manager.logEvolution({
      proposal: {} as any,
      validation: { allPassed: true, locks: [], summary: 'ok', timestamp: Date.now() },
      result: 'applied',
      metricsBefore: {},
      metricsAfter: {},
      durationMs: 100,
    });

    const log = manager.getLog();
    expect(log).toHaveLength(1);
    expect(log[0].result).toBe('applied');
  });

  it('should return evolution summary', () => {
    manager.logEvolution({
      proposal: {} as any,
      validation: { allPassed: true, locks: [], summary: 'ok', timestamp: Date.now() },
      result: 'applied',
      metricsBefore: { gdi: 0.3 },
      metricsAfter: { gdi: 0.2 },
      durationMs: 100,
    });
    manager.logEvolution({
      proposal: {} as any,
      validation: { allPassed: false, locks: [], summary: 'no', timestamp: Date.now() },
      result: 'rejected',
      metricsBefore: {},
      metricsAfter: {},
      durationMs: 50,
    });

    const summary = manager.getEvolutionSummary();
    expect(summary.totalEvolutions).toBe(2);
    expect(summary.successfulEvolutions).toBe(1);
    expect(summary.rejectedEvolutions).toBe(1);
  });
});

describe('ABTestRecorder', () => {
  let recorder: ABTestRecorder;

  beforeEach(() => {
    recorder = new ABTestRecorder();
  });

  it('should record results', () => {
    recorder.record({ group: 'shadow', success: true, latencyMs: 100, cost: 0 });
    recorder.record({ group: 'production', success: true, latencyMs: 100, cost: 0 });
    expect(recorder.count).toBe(2);
  });

  it('should analyze results', () => {
    for (let i = 0; i < 20; i++) {
      recorder.record({ group: 'shadow', success: i < 18, latencyMs: 100, cost: 0.01 });
      recorder.record({ group: 'production', success: i < 15, latencyMs: 120, cost: 0.02 });
    }

    const analysis = recorder.analyze();
    expect(analysis).not.toBeNull();
    expect(analysis!.shadow.successRate).toBeCloseTo(0.9);
    expect(analysis!.production.successRate).toBeCloseTo(0.75);
    expect(analysis!.comparison.winner).toBe('shadow');
  });

  it('should return null with insufficient data', () => {
    recorder.record({ group: 'shadow', success: true, latencyMs: 100, cost: 0 });
    expect(recorder.analyze()).toBeNull();
  });

  it('should clear results', () => {
    recorder.record({ group: 'shadow', success: true, latencyMs: 100, cost: 0 });
    recorder.clear();
    expect(recorder.count).toBe(0);
  });

  it('should filter by group', () => {
    recorder.record({ group: 'shadow', success: true, latencyMs: 100, cost: 0 });
    recorder.record({ group: 'production', success: true, latencyMs: 100, cost: 0 });

    expect(recorder.getResults('shadow')).toHaveLength(1);
    expect(recorder.getResults('production')).toHaveLength(1);
  });

  it('should respect maxResults', () => {
    const r = new ABTestRecorder(5);
    for (let i = 0; i < 10; i++) {
      r.record({ group: 'shadow', success: true, latencyMs: 100, cost: 0 });
    }
    expect(r.count).toBe(5);
  });

  it('should batch record', () => {
    const r = new ABTestRecorder();
    r.recordBatch([
      { group: 'shadow', success: true, latencyMs: 100, cost: 0 },
      { group: 'production', success: false, latencyMs: 120, cost: 0 },
    ]);
    expect(r.count).toBe(2);
  });
});

describe('StateManager — additional coverage', () => {
  it('should get latest snapshot', async () => {
    const manager = new EvolutionStateManager('/tmp/buddy-test-sm-extra');
    await manager.saveSnapshot({ leftRules: [], nnConfig: {} as any, nnParamCount: 100, metrics: { successRate: 0.8, avgLatencyMs: 100, gdi: 0.1, capabilityCount: 5 } });
    await manager.saveSnapshot({ leftRules: [], nnConfig: {} as any, nnParamCount: 200, metrics: { successRate: 0.9, avgLatencyMs: 90, gdi: 0.05, capabilityCount: 6 } });

    const latest = manager.getLatestSnapshot();
    expect(latest).toBeDefined();
    expect(latest!.version).toBe(2);
    expect(latest!.nnParamCount).toBe(200);
  });

  it('should get log with limit', () => {
    const manager = new EvolutionStateManager('/tmp/buddy-test-sm-log');
    for (let i = 0; i < 5; i++) {
      manager.logEvolution({
        proposal: {} as any,
        validation: { allPassed: true, locks: [], summary: 'ok', timestamp: Date.now() },
        result: 'applied',
        metricsBefore: {},
        metricsAfter: {},
        durationMs: 100,
      });
    }
    expect(manager.getLog()).toHaveLength(5);
    expect(manager.getLog(2)).toHaveLength(2);
  });
});
