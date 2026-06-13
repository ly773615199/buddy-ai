/**
 * 三脑决策延迟基准测试
 *
 * 测量 ThreeBrain.decide() 端到端延迟分布。
 * 目标：不含 LLM 调用 < 10ms。
 */

import { describe, it, expect } from 'vitest';
import { ThreeBrain } from '../brain.js';
import type { TaskSignal, ResourceState } from '../types.js';

// ==================== 辅助 ====================

function makeSignal(overrides?: Partial<TaskSignal>): TaskSignal {
  return {
    domains: ['code'], complexity: 'medium', taskType: 'tools',
    shouldUseDAG: false, dagReason: '', intentConfidence: 0.8,
    ...overrides,
  };
}

function makeResources(overrides?: Partial<ResourceState>): ResourceState {
  return {
    budgetRemaining: 100, availableNodeCount: 3,
    localCoverageRatio: 0.5, localConfidence: 0.6,
    userCorrectionCount: 0, experienceHit: null,
    ...overrides,
  };
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil(sorted.length * p / 100) - 1;
  return sorted[Math.max(0, idx)];
}

// ==================== 基准测试 ====================

describe('三脑决策延迟基准', () => {

  it('100 次 decide 延迟分布', async () => {
    const brain = new ThreeBrain({ verbose: false });
    const latencies: number[] = [];

    for (let i = 0; i < 100; i++) {
      const result = await brain.decide(
        `test input ${i}`,
        makeSignal({ domains: [['code', 'chat', 'data', 'web'][i % 4]] }),
        makeResources(),
      );
      latencies.push(result.latencyMs);
    }

    latencies.sort((a, b) => a - b);
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

    console.log(`[延迟分布] n=100`);
    console.log(`  avg=${avg.toFixed(2)}ms`);
    console.log(`  p50=${percentile(latencies, 50).toFixed(2)}ms`);
    console.log(`  p90=${percentile(latencies, 90).toFixed(2)}ms`);
    console.log(`  p99=${percentile(latencies, 99).toFixed(2)}ms`);
    console.log(`  min=${latencies[0].toFixed(2)}ms, max=${latencies[latencies.length - 1].toFixed(2)}ms`);

    // 延迟阈值断言（三脑不含 LLM 调用，目标 < 10ms，留 3x headroom 给 CI 环境）
    expect(avg).toBeLessThan(30);
    expect(percentile(latencies, 90)).toBeLessThan(50);
    expect(percentile(latencies, 99)).toBeLessThan(100);
    brain.destroy();
  });

  it('不同任务类型的延迟', async () => {
    const brain = new ThreeBrain({ verbose: false });
    const types: Array<{ name: string; signal: Partial<TaskSignal> }> = [
      { name: 'simple-chat', signal: { domains: ['chat'], complexity: 'simple', taskType: 'chat' } },
      { name: 'complex-tools', signal: { domains: ['code'], complexity: 'complex', taskType: 'tools' } },
      { name: 'reasoning', signal: { domains: ['math'], complexity: 'complex', taskType: 'reasoning' } },
      { name: 'background', signal: { domains: ['system'], complexity: 'simple', taskType: 'background' } },
    ];

    for (const { name, signal } of types) {
      const latencies: number[] = [];
      for (let i = 0; i < 20; i++) {
        const result = await brain.decide(`test ${name} ${i}`, makeSignal(signal), makeResources());
        latencies.push(result.latencyMs);
      }
      const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      console.log(`[${name}] avg=${avg.toFixed(2)}ms`);
      // 每种任务类型延迟 < 30ms
      expect(avg).toBeLessThan(30);
    }

    brain.destroy();
  });

  it('decide + feedback 完整循环延迟', async () => {
    const brain = new ThreeBrain({ verbose: false });
    const latencies: number[] = [];

    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      const signal = makeSignal();
      const resources = makeResources();
      const result = await brain.decide(`test ${i}`, signal, resources);
      await brain.feedback(signal, resources, result.plan, {
        success: Math.random() > 0.2,
        latencyMs: 100,
        costEstimate: 0.001,
        toolsUsed: ['read_file'],
      });
      latencies.push(performance.now() - t0);
    }

    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    console.log(`[decide+feedback] avg=${avg.toFixed(2)}ms, n=50`);
    // decide+feedback 完整循环 < 100ms
    expect(avg).toBeLessThan(100);

    brain.destroy();
  });
});
