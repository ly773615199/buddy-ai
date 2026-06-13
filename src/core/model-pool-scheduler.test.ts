/**
 * ModelPoolScheduler 测试
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
    costPer1kInput: 0.01,
    costPer1kOutput: 0.02,
    ...overrides,
  };
}

describe('ModelPoolScheduler', () => {
  let tmpDir: string;
  let pool: ModelPool;
  let recorder: DecisionRecorder;
  let scheduler: ModelPoolScheduler;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduler-test-'));
    pool = new ModelPool(makeConfig([
      makeNode({ id: 'budget-chat', tier: 'budget', tags: ['chat', 'fast'] }),
      makeNode({ id: 'standard-code', tier: 'standard', tags: ['code', 'tools'] }),
      makeNode({ id: 'premium-reason', tier: 'premium', tags: ['reasoning', 'complex'] }),
      makeNode({ id: 'react-expert', type: 'local_expert', domain: 'react', tags: ['react', 'frontend'], tier: 'free' }),
      makeNode({ id: 'python-expert', type: 'local_expert', domain: 'python', tags: ['python', 'data'], tier: 'free' }),
    ]), tmpDir);
    recorder = new DecisionRecorder(tmpDir);
    scheduler = new ModelPoolScheduler(pool, recorder);
  });

  // ==================== Layer 1: 规则快筛 ====================

  it('should route domain tasks to local experts', () => {
    const result = scheduler.schedule({
      input: '帮我写一个 React 组件',
      taskType: 'domain',
      domain: 'react',
    });

    expect(result.node.id).toBe('react-expert');
    // 单一候选时 experienceRoute 返回 layer 2 (single_candidate)
    expect(result.layer).toBe(2);
  });

  it('should route chat tasks to budget/standard nodes', () => {
    const result = scheduler.schedule({
      input: '你好',
      taskType: 'chat',
    });

    expect(['budget-chat', 'standard-code']).toContain(result.node.id);
  });

  it('should route reasoning tasks to premium/standard nodes', () => {
    const result = scheduler.schedule({
      input: '分析一下微服务架构的优劣',
      taskType: 'reasoning',
    });

    expect(['premium-reason', 'standard-code']).toContain(result.node.id);
  });

  it('should route background tasks to cheapest nodes', () => {
    const result = scheduler.schedule({
      input: '后台整理',
      taskType: 'background',
    });

    expect(result.node.id).toBe('budget-chat');
  });

  // ==================== Layer 2: 经验路由 ====================

  it('should use experience routing when history exists', () => {
    // 先记录一些成功的历史
    recorder.record({
      input: '写个 React hook',
      intent: 'domain',
      domain: 'react',
      novelty: 0,
      complexity: 'medium',
      selectedNode: 'react-expert',
      selectionReason: 'rule',
      selectionLayer: 1,
      outputTokenLimit: 2048,
      success: true,
      latencyMs: 50,
      inputTokens: 0,
      outputTokens: 0,
      costEstimate: 0,
      fallbackTriggered: false,
    });

    const result = scheduler.schedule({
      input: '写个 React hook',
      taskType: 'domain',
      domain: 'react',
    });

    // 应该还是选 react-expert（历史成功过）
    expect(result.node.id).toBe('react-expert');
  });

  // ==================== Layer 3: 级联支持 ====================

  it('should provide upgraded node for cascade', () => {
    const budgetNode = pool.getNode('budget-chat')!;
    const upgraded = scheduler.getUpgradedNode(budgetNode);

    expect(upgraded).toBeDefined();
    expect(['standard', 'premium']).toContain(upgraded!.tier);
  });

  it('should return null when no upgrade available for cascade', () => {
    const premiumNode = pool.getNode('premium-reason')!;
    const upgraded = scheduler.getUpgradedNode(premiumNode);
    expect(upgraded).toBeNull();
  });

  // ==================== 输出长度决策 ====================

  it('should decide output limit based on complexity', () => {
    const simple = scheduler.schedule({
      input: 'hi',
      taskType: 'chat',
      complexity: 'simple',
    });
    expect(simple.outputTokenLimit).toBe(512);

    const complex = scheduler.schedule({
      input: '设计一个分布式系统',
      taskType: 'reasoning',
      complexity: 'complex',
    });
    expect(complex.outputTokenLimit).toBe(4096);
  });

  // ==================== 决策记录 ====================

  it('should record results and update pool stats', () => {
    const context = {
      input: '测试输入',
      taskType: 'chat' as const,
    };
    const result = scheduler.schedule(context);

    scheduler.recordResult(context, result, true, 100);

    // 验证 pool 统计已更新
    const stats = pool.getStats(result.node.id);
    expect(stats).toBeDefined();
    expect(stats!.totalCalls).toBe(1);
    expect(stats!.consecutiveFailures).toBe(0);

    // 验证 decision recorder 已记录
    expect(recorder.count()).toBe(1);
  });

  // ==================== 无可用节点 ====================

  it('should throw when no nodes available', () => {
    const emptyPool = new ModelPool(makeConfig([]), tmpDir);
    const emptyScheduler = new ModelPoolScheduler(emptyPool, recorder);

    expect(() => emptyScheduler.schedule({
      input: 'test',
      taskType: 'chat',
    })).toThrow('没有可用节点');
  });

  // ==================== 摘要 ====================

  it('should return summary', () => {
    const summary = scheduler.getSummary();
    expect(summary.pool.total).toBe(5);
    expect(summary.recentDecisions).toBe(0);
  });
});
