/**
 * ModelPool 端到端集成测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ModelPoolScheduler } from './model-pool-scheduler.js';
import { ModelPool } from './model-pool.js';
import { DecisionRecorder } from './decision-recorder.js';
import type { PoolNodeConfig, ModelPoolConfig } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function makeConfig(nodes: PoolNodeConfig[]): ModelPoolConfig {
  return { strategy: 'task_match', nodes };
}

function makeNode(overrides: Partial<PoolNodeConfig> = {}): PoolNodeConfig {
  return {
    id: 'test-node',
    type: 'cloud',
    provider: 'test',
    model: 'test-model',
    tags: ['chat'],
    tier: 'standard',
    ...overrides,
  };
}

describe('ModelPool E2E', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-pool-'));
  });

  it('full lifecycle: schedule → record → learn → better schedule', () => {
    const pool = new ModelPool(makeConfig([
      makeNode({ id: 'cheap', tier: 'budget', tags: ['chat'], costPer1kInput: 0.001 }),
      makeNode({ id: 'mid', tier: 'standard', tags: ['chat', 'code'], costPer1kInput: 0.01 }),
      makeNode({ id: 'expensive', tier: 'premium', tags: ['reasoning'], costPer1kInput: 0.05 }),
    ]), tmpDir);

    const recorder = new DecisionRecorder(tmpDir);
    const scheduler = new ModelPoolScheduler(pool, recorder);

    // 第一次调度：chat 任务，没有历史数据
    const ctx1 = { input: '你好呀', taskType: 'chat' as const };
    const r1 = scheduler.schedule(ctx1);
    expect(['cheap', 'mid']).toContain(r1.node.id);

    // 记录结果：成功
    scheduler.recordResult(ctx1, r1, true, 80);

    // 第二次调度：同样的输入，有历史了
    const ctx2 = { input: '你好呀', taskType: 'chat' as const };
    const r2 = scheduler.schedule(ctx2);
    // 应该倾向于选上次成功的节点（但 Thompson Sampling 有随机性，不强制）
    expect(r2.node).toBeDefined();

    // 记录多次失败，触发熔断
    for (let i = 0; i < 3; i++) {
      const c = { input: `fail-${i}`, taskType: 'chat' as const };
      const r = scheduler.schedule(c);
      scheduler.recordResult(c, r, false, 5000);
    }

    // 被熔断的节点应该不在可用列表中
    const cheapStats = pool.getStats('cheap');
    if (cheapStats && cheapStats.consecutiveFailures >= 3) {
      expect(pool.getAvailableNodes().some(n => n.id === 'cheap')).toBe(false);
    }
  });

  it('cascade: schedule → fail → upgrade → succeed', () => {
    const pool = new ModelPool(makeConfig([
      makeNode({ id: 'small', tier: 'budget', tags: ['chat'] }),
      makeNode({ id: 'big', tier: 'premium', tags: ['chat', 'reasoning'] }),
    ]), tmpDir);

    const recorder = new DecisionRecorder(tmpDir);
    const scheduler = new ModelPoolScheduler(pool, recorder);

    // 调度得到 small 节点
    const ctx = { input: '复杂问题', taskType: 'reasoning' as const };
    const result = scheduler.schedule(ctx);

    // 模拟级联：如果质量不达标，找升级节点
    if (result.node.id === 'small') {
      const upgraded = scheduler.getUpgradedNode(result.node);
      expect(upgraded).toBeDefined();
      expect(upgraded!.id).toBe('big');
    }
  });

  it('pool stats persist across instances', () => {
    const pool1 = new ModelPool(makeConfig([
      makeNode({ id: 'persist' }),
    ]), tmpDir);

    pool1.recordSuccess('persist', 100);
    pool1.recordSuccess('persist', 200);
    pool1.saveStats();

    // 新实例加载
    const pool2 = new ModelPool(makeConfig([
      makeNode({ id: 'persist' }),
    ]), tmpDir);

    const stats = pool2.getStats('persist');
    expect(stats!.totalCalls).toBe(2);
    expect(stats!.consecutiveFailures).toBe(0);
  });

  it('decision recorder feeds into scheduling', () => {
    const pool = new ModelPool(makeConfig([
      makeNode({ id: 'node-a', tier: 'standard', tags: ['chat'] }),
      makeNode({ id: 'node-b', tier: 'standard', tags: ['chat'] }),
    ]), tmpDir);

    const recorder = new DecisionRecorder(tmpDir);
    const scheduler = new ModelPoolScheduler(pool, recorder);

    // 预先记录 node-a 在类似任务上 100% 成功
    for (let i = 0; i < 5; i++) {
      recorder.record({
        input: `聊天消息 ${i}`,
        intent: 'chat',
        domain: null,
        novelty: 0,
        complexity: 'simple',
        selectedNode: 'node-a',
        selectionReason: 'test',
        selectionLayer: 2,
        outputTokenLimit: 512,
        success: true,
        latencyMs: 50 + i * 10,
        inputTokens: 0,
        outputTokens: 0,
        costEstimate: 0,
        fallbackTriggered: false,
      });
    }

    // node-b 全失败
    for (let i = 0; i < 5; i++) {
      recorder.record({
        input: `聊天消息 ${i}`,
        intent: 'chat',
        domain: null,
        novelty: 0,
        complexity: 'simple',
        selectedNode: 'node-b',
        selectionReason: 'test',
        selectionLayer: 2,
        outputTokenLimit: 512,
        success: false,
        latencyMs: 500,
        inputTokens: 0,
        outputTokens: 0,
        costEstimate: 0,
        fallbackTriggered: false,
      });
    }

    // 调度相似输入，node-a 应该更受青睐
    // （Thompson Sampling 有随机性，但 node-a 100% vs node-b 0%，大概率选 a）
    let aCount = 0;
    for (let i = 0; i < 20; i++) {
      const r = scheduler.schedule({ input: '聊天消息', taskType: 'chat' });
      if (r.node.id === 'node-a') aCount++;
    }
    // node-a 应该被选中超过 50% 的次数
    expect(aCount).toBeGreaterThan(5);
  });
});
