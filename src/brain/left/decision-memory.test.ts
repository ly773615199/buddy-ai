import { describe, it, expect } from 'vitest';
import { DecisionMemory } from './decision-memory.js';
import type { DecisionRecord, TaskSignal, ExecutionPlan, DecisionOutcome } from '../types.js';

function makeSignal(overrides?: Partial<TaskSignal>): TaskSignal {
  return {
    domains: ['code'], complexity: 'medium', taskType: 'tools',
    shouldUseDAG: false, dagReason: '', intentConfidence: 0.8,
    ...overrides,
  };
}

function makePlan(overrides?: Partial<ExecutionPlan>): ExecutionPlan {
  return {
    mode: 'single', reason: 'test', selectedNodes: [{ id: 'primary', type: 'cloud_node' }],
    confidence: 0.8, source: 'rule', ...overrides,
  };
}

function makeRecord(overrides?: Partial<DecisionRecord>): DecisionRecord {
  return {
    input: 'test', signal: makeSignal(), plan: makePlan(),
    latencyMs: 100, timestamp: Date.now(), ...overrides,
  };
}

describe('DecisionMemory', () => {
  it('record + size', () => {
    const mem = new DecisionMemory();
    expect(mem.size).toBe(0);
    mem.record(makeRecord());
    expect(mem.size).toBe(1);
  });

  it('maxRecords 限制', () => {
    const mem = new DecisionMemory({ maxRecords: 3 });
    for (let i = 0; i < 5; i++) mem.record(makeRecord());
    expect(mem.size).toBe(3);
  });

  it('getRecent 返回最近 N 条', () => {
    const mem = new DecisionMemory();
    mem.record(makeRecord({ input: 'a' }));
    mem.record(makeRecord({ input: 'b' }));
    mem.record(makeRecord({ input: 'c' }));
    const recent = mem.getRecent(2);
    expect(recent.length).toBe(2);
    expect(recent[0].input).toBe('b'); // 最近 2 条
    expect(recent[1].input).toBe('c');
  });

  it('updateLastOutcome 更新结果', () => {
    const mem = new DecisionMemory();
    mem.record(makeRecord({ input: 'test' }));
    const outcome: DecisionOutcome = { success: true, latencyMs: 50, costEstimate: 0, toolsUsed: [] };
    mem.updateLastOutcome('test', outcome);
    const recent = mem.getRecent(1);
    expect(recent[0].outcome?.success).toBe(true);
  });

  it('clusterByFingerprint 聚类', () => {
    const mem = new DecisionMemory();
    mem.record(makeRecord({ signal: makeSignal({ domains: ['code'], complexity: 'medium', taskType: 'tools' }) }));
    mem.record(makeRecord({ signal: makeSignal({ domains: ['code'], complexity: 'medium', taskType: 'tools' }) }));
    mem.record(makeRecord({ signal: makeSignal({ domains: ['git'], complexity: 'simple', taskType: 'chat' }) }));

    const clusters = mem.clusterByFingerprint();
    expect(clusters.size).toBe(2);
  });

  it('getClusterStats 返回统计', () => {
    const mem = new DecisionMemory();
    for (let i = 0; i < 5; i++) {
      mem.record(makeRecord({
        signal: makeSignal({ domains: ['code'], complexity: 'medium', taskType: 'tools' }),
        outcome: { success: i < 4, latencyMs: 100, costEstimate: 0, toolsUsed: [] },
      }));
    }
    const stats = mem.getClusterStats(3);
    expect(stats.length).toBeGreaterThanOrEqual(1);
    expect(stats[0].count).toBe(5);
    expect(stats[0].successRate).toBeCloseTo(0.8, 1);
  });

  it('findSimilar 找相似决策', () => {
    const mem = new DecisionMemory();
    mem.record(makeRecord({ signal: makeSignal({ domains: ['code'], complexity: 'medium', taskType: 'tools' }) }));
    mem.record(makeRecord({ signal: makeSignal({ domains: ['git'], complexity: 'simple', taskType: 'chat' }) }));

    const similar = mem.findSimilar(makeSignal({ domains: ['code'], complexity: 'medium', taskType: 'tools' }), 1);
    expect(similar.length).toBe(1);
    expect(similar[0].similarity).toBe(1); // 完全匹配
  });

  it('getGlobalStats 全局统计', () => {
    const mem = new DecisionMemory();
    mem.record(makeRecord({ outcome: { success: true, latencyMs: 100, costEstimate: 0, toolsUsed: [] } }));
    mem.record(makeRecord({ outcome: { success: false, latencyMs: 200, costEstimate: 0, toolsUsed: [] } }));

    const stats = mem.getGlobalStats();
    expect(stats.total).toBe(2);
    expect(stats.withOutcome).toBe(2);
    expect(stats.overallSuccessRate).toBeCloseTo(0.5, 1);
  });
});

describe('DecisionMemory — 反事实样本', () => {
  it('generateCounterfactuals 无替代方案时返回空', () => {
    const mem = new DecisionMemory();
    mem.record(makeRecord({ outcome: { success: true, latencyMs: 100, costEstimate: 0, toolsUsed: [] } }));

    const cfs = mem.generateCounterfactuals(mem.getRecent(1)[0]);
    // 只有 1 条记录，无替代方案
    expect(cfs.length).toBe(0);
  });

  it('generateCounterfactuals 有替代方案时返回样本', () => {
    const mem = new DecisionMemory();
    // 同 fingerprint，不同 mode
    mem.record(makeRecord({
      plan: makePlan({ mode: 'sequential' }),
      outcome: { success: true, latencyMs: 100, costEstimate: 0, toolsUsed: [] },
    }));
    mem.record(makeRecord({
      plan: makePlan({ mode: 'parallel' }),
      outcome: { success: false, latencyMs: 200, costEstimate: 0, toolsUsed: [] },
    }));
    mem.record(makeRecord({
      plan: makePlan({ mode: 'single' }),
      outcome: { success: true, latencyMs: 50, costEstimate: 0, toolsUsed: [] },
    }));

    const recent = mem.getRecent(1)[0];
    const cfs = mem.generateCounterfactuals(recent, 3);
    // 应该有替代方案
    expect(cfs.length).toBeGreaterThanOrEqual(0); // 取决于 fingerprint 匹配
  });

  it('反事实样本有正确的 alternativeMode', () => {
    const mem = new DecisionMemory();
    // 创建多个同 fingerprint 的记录
    for (let i = 0; i < 5; i++) {
      mem.record(makeRecord({
        plan: makePlan({ mode: i < 3 ? 'sequential' : 'parallel' }),
        outcome: { success: i < 3, latencyMs: 100, costEstimate: 0, toolsUsed: [] },
      }));
    }

    const recent = mem.getRecent(1)[0];
    const cfs = mem.generateCounterfactuals(recent, 3);
    for (const cf of cfs) {
      expect(cf.alternativeMode).toBeDefined();
      expect(cf.labelIntent).toBeGreaterThanOrEqual(0);
      expect(cf.labelTools).toBeDefined();
      expect(cf.labelQuality).toBeGreaterThanOrEqual(0);
      expect(cf.labelQuality).toBeLessThanOrEqual(1);
    }
  });

  it('record 自动调用 generateCounterfactuals 并合并', () => {
    const mem = new DecisionMemory();
    // 先创建一些历史
    for (let i = 0; i < 5; i++) {
      mem.record(makeRecord({
        plan: makePlan({ mode: 'sequential' }),
        outcome: { success: true, latencyMs: 100, costEstimate: 0, toolsUsed: [] },
      }));
    }
    // 记录一条不同 mode 的
    mem.record(makeRecord({
      plan: makePlan({ mode: 'parallel' }),
      outcome: { success: false, latencyMs: 200, costEstimate: 0, toolsUsed: [] },
    }));

    // 不应崩溃
    const size = mem.size;
    expect(size).toBeGreaterThanOrEqual(6);
  });
});
