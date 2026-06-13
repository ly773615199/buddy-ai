/**
 * 习惯缓存命中率基准测试
 *
 * 模拟 1000 次决策，测量不同配置下 HabitMemory 的命中率。
 * 用于指导 Phase 8 的 minHits / fingerprint 粒度调优。
 *
 * 关注指标：
 * - 命中率：固化条目被命中的比例
 * - 固化率：满足条件的条目比例
 * - 查表延迟：lookup 耗时
 */

import { describe, it, expect } from 'vitest';
import { HabitMemory, type HabitConfig } from '../cerebellum/adaptive/habit.js';
import type { TaskSignal, ExecutionPlan } from '../types.js';

// ==================== 辅助 ====================

const DOMAINS = ['code', 'chat', 'data', 'web', 'file', 'system', 'math', 'creative'];
const COMPLEXITIES: TaskSignal['complexity'][] = ['simple', 'medium', 'complex'];
const TASK_TYPES: TaskSignal['taskType'][] = ['chat', 'tools', 'reasoning', 'background', 'domain'];
const MODES: ExecutionPlan['mode'][] = ['single', 'parallel', 'cascade', 'sequential'];

function makeSignal(domainIdx: number, complexityIdx: number, taskTypeIdx: number): TaskSignal {
  return {
    domains: [DOMAINS[domainIdx % DOMAINS.length]],
    complexity: COMPLEXITIES[complexityIdx % COMPLEXITIES.length],
    taskType: TASK_TYPES[taskTypeIdx % TASK_TYPES.length],
    shouldUseDAP: false, dagReason: '', intentConfidence: 0.8,
  };
}

function makePlan(modeIdx: number): ExecutionPlan {
  return {
    mode: MODES[modeIdx % MODES.length],
    reason: 'benchmark',
    selectedNodes: [{ id: `node-${modeIdx}`, type: 'cloud_node' }],
    confidence: 0.8,
    source: 'scheduler',
  };
}

/** 模拟 N 次决策，返回统计 */
function simulateDecisions(
  config: Partial<HabitConfig>,
  totalDecisions: number,
  scenario: 'uniform' | 'zipf' | 'burst',
): {
  hitRate: number;
  solidifiedCount: number;
  totalEntries: number;
  avgLookupMs: number;
} {
  const habit = new HabitMemory(config);
  let hits = 0;
  let lookupTotalNs = 0;

  for (let i = 0; i < totalDecisions; i++) {
    let domainIdx: number, complexityIdx: number, taskTypeIdx: number;

    switch (scenario) {
      case 'uniform':
        // 均匀分布：每个 pattern 出现概率相同
        domainIdx = i % DOMAINS.length;
        complexityIdx = i % COMPLEXITIES.length;
        taskTypeIdx = i % TASK_TYPES.length;
        break;
      case 'zipf':
        // Zipf 分布：少数 pattern 高频出现
        domainIdx = Math.floor(Math.random() * 3); // 只用前 3 个 domain
        complexityIdx = 0; // 大部分是 simple
        taskTypeIdx = Math.random() < 0.7 ? 0 : Math.floor(Math.random() * TASK_TYPES.length);
        break;
      case 'burst':
        // 突发模式：前 50% 集中在 2 个 pattern，后 50% 分散
        if (i < totalDecisions / 2) {
          domainIdx = i % 2;
          complexityIdx = 0;
          taskTypeIdx = 0;
        } else {
          domainIdx = i % DOMAINS.length;
          complexityIdx = i % COMPLEXITIES.length;
          taskTypeIdx = i % TASK_TYPES.length;
        }
        break;
    }

    const signal = makeSignal(domainIdx, complexityIdx, taskTypeIdx);

    // 查表
    const t0 = process.hrtime.bigint();
    const hit = habit.lookup(signal);
    const t1 = process.hrtime.bigint();
    lookupTotalNs += Number(t1 - t0);

    if (hit) {
      hits++;
    } else {
      // 未命中 → 记录决策
      const plan = makePlan(i);
      const success = Math.random() > 0.2;
      habit.record(signal, plan, success);
    }
  }

  const stats = habit.getStats();
  const avgLookupMs = lookupTotalNs / totalDecisions / 1_000_000;

  return {
    hitRate: hits / totalDecisions,
    solidifiedCount: stats.solidifiedEntries,
    totalEntries: stats.totalEntries,
    avgLookupMs,
  };
}

// ==================== 基准测试 ====================

describe('习惯缓存命中率基准', () => {

  it('基线：默认配置 1000 次均匀决策', () => {
    const result = simulateDecisions({}, 1000, 'uniform');
    console.log(`[基线-均匀] hitRate=${(result.hitRate * 100).toFixed(1)}%, solidified=${result.solidifiedCount}/${result.totalEntries}, avgLookup=${result.avgLookupMs.toFixed(4)}ms`);
    expect(result.totalEntries).toBeGreaterThan(0);
  });

  it('场景对比: uniform vs zipf vs burst', () => {
    for (const scenario of ['uniform', 'zipf', 'burst'] as const) {
      const result = simulateDecisions({}, 1000, scenario);
      console.log(`[${scenario}] hitRate=${(result.hitRate * 100).toFixed(1)}%, solidified=${result.solidifiedCount}/${result.totalEntries}, avgLookup=${result.avgLookupMs.toFixed(4)}ms`);
    }
  });

  it('minHitsToSolidify 对比: 3 vs 5 vs 10', () => {
    for (const minHits of [3, 5, 10]) {
      const result = simulateDecisions({ minHitsToSolidify: minHits }, 1000, 'zipf');
      console.log(`[minHits=${minHits}] hitRate=${(result.hitRate * 100).toFixed(1)}%, solidified=${result.solidifiedCount}/${result.totalEntries}`);
    }
  });

  it('minSuccessRateToSolidify 对比: 0.6 vs 0.8 vs 0.95', () => {
    for (const rate of [0.6, 0.8, 0.95]) {
      const result = simulateDecisions({ minSuccessRateToSolidify: rate }, 1000, 'zipf');
      console.log(`[successRate=${rate}] hitRate=${(result.hitRate * 100).toFixed(1)}%, solidified=${result.solidifiedCount}/${result.totalEntries}`);
    }
  });

  it('maxEntries 对比: 50 vs 200 vs 500', () => {
    for (const max of [50, 200, 500]) {
      const result = simulateDecisions({ maxEntries: max }, 1000, 'zipf');
      console.log(`[maxEntries=${max}] hitRate=${(result.hitRate * 100).toFixed(1)}%, solidified=${result.solidifiedCount}/${result.totalEntries}`);
    }
  });

  it('查表延迟基准：10000 次 lookup', () => {
    const habit = new HabitMemory();
    // 预填充 100 条固化记录
    for (let i = 0; i < 100; i++) {
      const signal = makeSignal(i % 8, i % 3, i % 5);
      habit.record(signal, makePlan(i), true);
      // 重复命中直到固化
      for (let j = 0; j < 10; j++) {
        habit.lookup(signal);
        habit.record(signal, makePlan(i), true);
      }
    }

    // 测量 lookup 延迟
    const iterations = 10000;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
      habit.lookup(makeSignal(i % 8, i % 3, i % 5));
    }
    const t1 = process.hrtime.bigint();
    const avgNs = Number(t1 - t0) / iterations;

    console.log(`[延迟] ${iterations}次 lookup, 平均=${(avgNs / 1000).toFixed(2)}μs`);
    expect(avgNs).toBeLessThan(100_000); // 应该 < 100μs
  });

  it('淘汰压力测试：maxEntries=20，2000 次不同 pattern', () => {
    const habit = new HabitMemory({ maxEntries: 20 });
    for (let i = 0; i < 2000; i++) {
      const signal = makeSignal(i, i % 3, i % 5);
      habit.record(signal, makePlan(i), Math.random() > 0.3);
    }
    const stats = habit.getStats();
    console.log(`[淘汰] 2000次记录, 最终条目=${stats.totalEntries}, 固化=${stats.solidifiedEntries}`);
    expect(stats.totalEntries).toBeLessThanOrEqual(20);
  });
});
