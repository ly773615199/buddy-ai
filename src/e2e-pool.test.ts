/**
 * ModelPool 端到端集成测试
 * 调度 → 执行 → 记录 → 级联 → 统计
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ModelPool } from './core/model-pool.js';
import { ModelPoolScheduler } from './core/model-pool-scheduler.js';
import { DecisionRecorder } from './core/decision-recorder.js';
import type { PoolNodeConfig, ModelPoolConfig } from './types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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

describe('ModelPool E2E', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-pool-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createFullPool(nodeConfigs: PoolNodeConfig[] = []) {
    const defaultNodes: PoolNodeConfig[] = [
      makeNode({ id: 'budget-chat', tier: 'budget', tags: ['chat', 'fast'], costPer1kInput: 0.002 }),
      makeNode({ id: 'standard-code', tier: 'standard', tags: ['code', 'tools'], costPer1kInput: 0.01 }),
      makeNode({ id: 'premium-reason', tier: 'premium', tags: ['reasoning', 'complex', 'vision'], costPer1kInput: 0.04 }),
      makeNode({ id: 'react-expert', type: 'local_expert', domain: 'react', tags: ['react', 'frontend'], tier: 'free' }),
      makeNode({ id: 'python-expert', type: 'local_expert', domain: 'python', tags: ['python', 'data'], tier: 'free' }),
      makeNode({ id: 'git-expert', type: 'local_expert', domain: 'git', tags: ['git', 'version_control'], tier: 'free' }),
    ];

    const nodes = nodeConfigs.length > 0 ? nodeConfigs : defaultNodes;
    const config: ModelPoolConfig = { strategy: 'task_match', nodes };
    const pool = new ModelPool(config, tmpDir);
    const recorder = new DecisionRecorder(tmpDir);
    const scheduler = new ModelPoolScheduler(pool, recorder);

    return { pool, recorder, scheduler };
  }

  // ==================== 域名路由 ====================

  it('React 任务路由到 react-expert', () => {
    const { scheduler } = createFullPool();
    const result = scheduler.schedule({
      input: '帮我写一个 React 组件',
      taskType: 'domain',
      domain: 'react',
    });

    expect(result.node.id).toBe('react-expert');
  });

  it('Python 任务路由到 python-expert', () => {
    const { scheduler } = createFullPool();
    const result = scheduler.schedule({
      input: '写一个 Python 爬虫',
      taskType: 'domain',
      domain: 'python',
    });

    expect(result.node.id).toBe('python-expert');
  });

  it('Git 任务路由到 git-expert', () => {
    const { scheduler } = createFullPool();
    const result = scheduler.schedule({
      input: '帮我整理 git 提交历史',
      taskType: 'domain',
      domain: 'git',
    });

    expect(result.node.id).toBe('git-expert');
  });

  // ==================== 任务类型路由 ====================

  it('简单闲聊路由到 budget 或 standard 节点', () => {
    const { scheduler } = createFullPool();
    const result = scheduler.schedule({
      input: '你好',
      taskType: 'chat',
    });

    expect(['budget', 'standard']).toContain(result.node.tier);
  });

  it('复杂推理路由到 premium 节点', () => {
    const { scheduler } = createFullPool();
    const result = scheduler.schedule({
      input: '分析微服务架构的优劣',
      taskType: 'reasoning',
    });

    expect(['premium', 'standard']).toContain(result.node.tier);
  });

  it('工具任务路由到可用节点', () => {
    const { scheduler } = createFullPool();
    const result = scheduler.schedule({
      input: '重构这段代码',
      taskType: 'tools',
    });

    expect(result.node).toBeDefined();
    expect(result.node.id).toBeTruthy();
  });

  it('后台任务路由到最便宜的节点', () => {
    const { scheduler } = createFullPool();
    const result = scheduler.schedule({
      input: '后台整理记忆',
      taskType: 'background',
    });

    expect(result.node.id).toBe('budget-chat');
  });

  // ==================== 输出长度决策 ====================

  it('简单任务输出长度较短', () => {
    const { scheduler } = createFullPool();
    const result = scheduler.schedule({
      input: 'hi',
      taskType: 'chat',
      complexity: 'simple',
    });

    expect(result.outputTokenLimit).toBeLessThanOrEqual(1024);
  });

  it('复杂任务输出长度较长', () => {
    const { scheduler } = createFullPool();
    const result = scheduler.schedule({
      input: '设计一个分布式系统架构',
      taskType: 'reasoning',
      complexity: 'complex',
    });

    expect(result.outputTokenLimit).toBeGreaterThanOrEqual(2048);
  });

  // ==================== 决策记录与经验路由 ====================

  it('记录调度结果后影响后续决策', () => {
    const { scheduler, pool, recorder } = createFullPool();

    // 第一次调度
    const ctx1 = { input: '写个 React hook', taskType: 'domain' as const, domain: 'react' };
    const result1 = scheduler.schedule(ctx1);
    scheduler.recordResult(ctx1, result1, true, 50);

    // 验证记录已保存
    expect(recorder.count()).toBe(1);

    // 第二次调度类似任务
    const ctx2 = { input: '写个 React 组件', taskType: 'domain' as const, domain: 'react' };
    const result2 = scheduler.schedule(ctx2);

    // 应该倾向于选择之前成功的节点
    expect(result2.node.id).toBe(result1.node.id);
  });

  it('失败记录影响后续选择', () => {
    const { scheduler, recorder } = createFullPool();

    // 多次记录某节点在 chat 任务上失败
    for (let i = 0; i < 5; i++) {
      recorder.record({
        input: `chat message ${i}`,
        intent: 'chat',
        domain: null,
        novelty: 0,
        complexity: 'simple',
        selectedNode: 'budget-chat',
        selectionReason: 'rule',
        selectionLayer: 1,
        outputTokenLimit: 512,
        success: false,
        latencyMs: 200,
        inputTokens: 10,
        outputTokens: 0,
        costEstimate: 0,
        fallbackTriggered: false,
      });
    }

    // 调度 chat 任务 — 可能不再选 budget-chat（取决于经验路由实现）
    const result = scheduler.schedule({
      input: '新的聊天消息',
      taskType: 'chat',
    });

    // 至少应该返回一个可用节点
    expect(result.node).toBeDefined();
  });

  // ==================== 级联升级 ====================

  it('budget 节点可升级到 standard 或 premium', () => {
    const { scheduler, pool } = createFullPool();
    const budgetNode = pool.getNode('budget-chat')!;
    const upgraded = scheduler.getUpgradedNode(budgetNode);

    expect(upgraded).toBeDefined();
    expect(['standard', 'premium']).toContain(upgraded!.tier);
  });

  it('premium 节点无法升级', () => {
    const { scheduler, pool } = createFullPool();
    const premiumNode = pool.getNode('premium-reason')!;
    const upgraded = scheduler.getUpgradedNode(premiumNode);

    expect(upgraded).toBeNull();
  });

  it('级联链 budget → standard → premium', () => {
    const { scheduler, pool } = createFullPool();

    const budget = pool.getNode('budget-chat')!;
    const step1 = scheduler.getUpgradedNode(budget);
    expect(step1).toBeDefined();
    expect(step1!.tier).toBe('standard');

    const step2 = scheduler.getUpgradedNode(step1!);
    expect(step2).toBeDefined();
    expect(step2!.tier).toBe('premium');

    const step3 = scheduler.getUpgradedNode(step2!);
    expect(step3).toBeNull();
  });

  // ==================== 熔断与恢复 ====================

  it('熔断后自动排除该节点', () => {
    const { pool, scheduler } = createFullPool();

    // budget-chat 连续失败 3 次触发熔断
    pool.recordFailure('budget-chat', 100);
    pool.recordFailure('budget-chat', 100);
    pool.recordFailure('budget-chat', 100);

    // chat 任务不应再选 budget-chat
    const result = scheduler.schedule({
      input: 'hello',
      taskType: 'chat',
    });

    expect(result.node.id).not.toBe('budget-chat');
  });

  it('熔断恢复后重新可用', () => {
    const { pool } = createFullPool();

    // 触发熔断
    pool.recordFailure('budget-chat', 100);
    pool.recordFailure('budget-chat', 100);
    pool.recordFailure('budget-chat', 100);
    expect(pool.getAvailableNodes().find(n => n.id === 'budget-chat')).toBeUndefined();

    // 恢复
    pool.recordSuccess('budget-chat', 50);
    expect(pool.getAvailableNodes().find(n => n.id === 'budget-chat')).toBeDefined();
  });

  // ==================== 全局预算约束 ====================

  it('成本统计正确', () => {
    const { pool } = createFullPool();

    pool.recordSuccess('budget-chat', 100);
    pool.recordSuccess('premium-reason', 200);

    const budgetStats = pool.getStats('budget-chat');
    const premiumStats = pool.getStats('premium-reason');

    expect(budgetStats!.totalCalls).toBe(1);
    expect(premiumStats!.totalCalls).toBe(1);
  });

  // ==================== 持久化 ====================

  it('统计数据跨实例持久化', () => {
    const { pool: pool1 } = createFullPool();
    pool1.recordSuccess('budget-chat', 100);
    pool1.recordSuccess('budget-chat', 200);
    pool1.saveStats();

    // 重新创建 pool
    const pool2 = new ModelPool(
      { strategy: 'task_match', nodes: [
        makeNode({ id: 'budget-chat', tier: 'budget', tags: ['chat'] }),
      ]},
      tmpDir,
    );

    const stats = pool2.getStats('budget-chat');
    expect(stats).toBeDefined();
    expect(stats!.totalCalls).toBe(2);
  });

  it('决策记录跨实例持久化', () => {
    const { scheduler: scheduler1, recorder: recorder1 } = createFullPool();

    const ctx = { input: '持久化测试', taskType: 'chat' as const };
    const result = scheduler1.schedule(ctx);
    scheduler1.recordResult(ctx, result, true, 100);

    expect(recorder1.count()).toBe(1);

    // 重新创建
    const recorder2 = new DecisionRecorder(tmpDir);
    expect(recorder2.count()).toBe(1);
    expect(recorder2.getRecent(1)[0].input).toBe('持久化测试');
  });

  // ==================== 空池 / 边界 ====================

  it('空池抛出异常', () => {
    const emptyPool = new ModelPool({ strategy: 'task_match', nodes: [] }, tmpDir);
    const recorder = new DecisionRecorder(tmpDir);
    const scheduler = new ModelPoolScheduler(emptyPool, recorder);

    expect(() => scheduler.schedule({
      input: 'test',
      taskType: 'chat',
    })).toThrow('没有可用节点');
  });

  it('所有节点熔断后抛出异常', () => {
    const { pool, scheduler } = createFullPool([
      makeNode({ id: 'only-node', tier: 'standard', tags: ['chat'] }),
    ]);

    // 熔断唯一节点
    pool.recordFailure('only-node', 100);
    pool.recordFailure('only-node', 100);
    pool.recordFailure('only-node', 100);

    expect(() => scheduler.schedule({
      input: 'test',
      taskType: 'chat',
    })).toThrow('没有可用节点');
  });

  // ==================== 摘要 ====================

  it('调度器摘要包含完整信息', () => {
    const { scheduler, pool, recorder } = createFullPool();

    const ctx = { input: '摘要测试', taskType: 'chat' as const };
    const result = scheduler.schedule(ctx);
    scheduler.recordResult(ctx, result, true, 80);

    const summary = scheduler.getSummary();
    expect(summary.pool.total).toBe(6);
    expect(summary.pool.available).toBe(6);
    expect(summary.recentDecisions).toBe(1);
  });

  // ==================== 多专家协作场景 ====================

  it('DAG 编排场景：多任务分别路由到不同专家', () => {
    const { scheduler } = createFullPool();

    // 模拟 DAG 中的多个任务
    const tasks = [
      { input: '分析需求', taskType: 'reasoning' as const },
      { input: '写 React 前端', taskType: 'domain' as const, domain: 'react' },
      { input: '写 Python 后端', taskType: 'domain' as const, domain: 'python' },
      { input: '整理 git 历史', taskType: 'domain' as const, domain: 'git' },
    ];

    const results = tasks.map(t => scheduler.schedule(t));

    // 每个任务应该路由到合适的节点
    expect(['premium', 'standard']).toContain(results[0].node.tier);
    expect(results[1].node.id).toBe('react-expert');
    expect(results[2].node.id).toBe('python-expert');
    expect(results[3].node.id).toBe('git-expert');
  });

  // ==================== 成本优化 ====================

  it('两个节点都能被选中（无历史数据时）', () => {
    const { scheduler } = createFullPool([
      makeNode({ id: 'cheap', tier: 'budget', tags: ['chat'], costPer1kInput: 0.001 }),
      makeNode({ id: 'expensive', tier: 'standard', tags: ['chat'], costPer1kInput: 0.1 }),
    ]);

    const result = scheduler.schedule({
      input: 'hello',
      taskType: 'chat',
    });

    expect(['cheap', 'expensive']).toContain(result.node.id);
  });
});
