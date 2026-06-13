/**
 * plan-executor.ts — 单元测试
 *
 * 覆盖：纯函数 + 路由逻辑 + 边界条件
 */
import { describe, it, expect } from 'vitest';
import {
  fallbackPlan,
  fuseResults,
  evaluateQuality,
  executeByPlan,
  type ExecutionContext,
} from './plan-executor.js';
import type { OrchestrationPlan } from '../types.js';

// ==================== fallbackPlan ====================

describe('fallbackPlan', () => {
  it('返回 single 模式的降级计划', () => {
    const plan = fallbackPlan('hello');
    expect(plan.mode).toBe('single');
    expect(plan.content).toBe('hello');
    expect(plan.reason).toBe('经验降级');
    expect(plan.selectedNodes).toEqual([{ id: 'fallback', type: 'cloud_node' }]);
    expect(plan.useDAG).toBe(false);
  });

  it('支持自定义 reason', () => {
    const plan = fallbackPlan('test', 'DAG 失败');
    expect(plan.reason).toBe('DAG 失败');
  });
});

// ==================== fuseResults ====================

describe('fuseResults', () => {
  it('所有结果失败时返回提示', () => {
    const result = fuseResults(
      [{ nodeId: 'a', text: '', success: false }],
      'question',
    );
    expect(result).toContain('未返回有效结果');
  });

  it('单个成功结果直接返回文本', () => {
    const result = fuseResults(
      [{ nodeId: 'a', text: 'answer A', success: true }],
      'question',
    );
    expect(result).toBe('answer A');
  });

  it('多个成功结果拼接并带分隔符', () => {
    const result = fuseResults(
      [
        { nodeId: 'expert-1', text: '观点 A', success: true },
        { nodeId: 'expert-2', text: '观点 B', success: true },
      ],
      'question',
    );
    expect(result).toContain('观点 A');
    expect(result).toContain('观点 B');
    expect(result).toContain('---');
    expect(result).toContain('expert-1');
    expect(result).toContain('expert-2');
  });

  it('过滤掉失败结果，只拼接成功的', () => {
    const result = fuseResults(
      [
        { nodeId: 'a', text: 'good', success: true },
        { nodeId: 'b', text: '', success: false },
        { nodeId: 'c', text: 'also good', success: true },
      ],
      'q',
    );
    expect(result).toContain('good');
    expect(result).toContain('also good');
    expect(result).not.toContain('expert 2');
  });

  it('nodeId 缺失时使用 "专家 N" 格式', () => {
    const result = fuseResults(
      [
        { text: 'A', success: true },
        { text: 'B', success: true },
      ],
      'q',
    );
    expect(result).toContain('专家 1');
    expect(result).toContain('专家 2');
  });

  it('空结果数组返回提示', () => {
    expect(fuseResults([], 'q')).toContain('未返回有效结果');
  });
});

// ==================== evaluateQuality ====================

describe('evaluateQuality', () => {
  it('短回答 (<20 字) 扣分', () => {
    const score = evaluateQuality('是', '你觉得这个方案怎么样？');
    expect(score).toBeLessThan(0.3);
  });

  it('较长回答得分较高', () => {
    const answer = '这个方案需要考虑多个因素，包括技术可行性、资源投入和时间安排。建议分阶段实施，先做核心功能。';
    const score = evaluateQuality(answer, '你觉得这个方案怎么样？');
    expect(score).toBeGreaterThan(0.3);
  });

  it('包含问题关键词的回答加分', () => {
    const q = '如何优化数据库查询性能？';
    const a = '优化数据库查询性能的方法包括：1. 添加索引 2. 使用缓存 3. 优化 SQL 语句';
    const score = evaluateQuality(a, q);
    expect(score).toBeGreaterThan(0.3);
  });

  it('result 值在 [0, 1] 范围内', () => {
    const testCases = [
      ['', ''],
      ['a'.repeat(1000), ''],
      ['', '很长的问题 '.repeat(50)],
      ['错误 error failed 失败', 'q'],
    ];
    for (const [a, q] of testCases) {
      const score = evaluateQuality(a, q);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('诚实表达不确定但有内容的回答加分', () => {
    const answer = '根据我的分析，这个问题比较复杂。我不确定所有细节，但可以提供以下思路：首先需要检查系统的日志，然后分析错误模式。建议从以下几个方面入手。';
    const score = evaluateQuality(answer, '系统出问题了怎么办？');
    expect(score).toBeGreaterThan(0.5);
  });

  it('错误信号 + 短回答大幅扣分', () => {
    const score = evaluateQuality('error', 'what happened?');
    expect(score).toBeLessThan(0.3);
  });
});

// ==================== executeByPlan 路由逻辑 ====================

describe('executeByPlan 路由', () => {
  function mockCtx(overrides: Record<string, any> = {}): ExecutionContext {
    return {
      sys: {
        llm: {
          chat: async () => ({ text: 'llm reply', toolCalls: [] }),
          consumeLastUnifiedSelection: () => null,
        },
        intelligence: {
          graph: { getNode: () => null },
          executor: { execute: async () => ({ success: true, reply: 'exp reply', outputs: {} }) },
          evolver: { onSuccess: () => {}, onFailure: () => {} },
        },
        ternaryRouter: {
          query: async () => ({ answer: 'ternary answer' }),
        },
        router: { getPool: () => null },
        taskExecutor: {
          execute: async () => ({
            summary: 'dag result',
            taskResults: [{ name: 'step1', result: 'ok', success: true }],
          }),
        },
        cerebellum: null,
      },
      processor: {
        processStream: async () => ({ text: 'processed', toolCalls: [] }),
      },
      ws: {
        getEventBus: () => null,
      },
      config: {},
      verbose: false,
      ...overrides,
    } as unknown as ExecutionContext;
  }

  function makePlan(overrides: Partial<OrchestrationPlan> = {}): OrchestrationPlan {
    return {
      content: 'test',
      mode: 'single',
      reason: 'test',
      domains: [],
      complexity: 'simple',
      selectedNodes: [{ id: 'fallback', type: 'cloud_node' }],
      useDAG: false,
      ...overrides,
    };
  }

  it('clarify 模式直接返回 reason', async () => {
    const ctx = mockCtx();
    const plan = makePlan({ mode: 'clarify', reason: '请提供更多信息' });

    const result = await executeByPlan(ctx, plan);

    expect(result.text).toBe('请提供更多信息');
    expect(result.source).toBe('deliberation');
  });

  it('brainstorm 模式直接返回 reason', async () => {
    const ctx = mockCtx();
    const plan = makePlan({ mode: 'brainstorm', reason: '头脑风暴结果' });

    const result = await executeByPlan(ctx, plan);

    expect(result.text).toBe('头脑风暴结果');
    expect(result.source).toBe('deliberation');
  });

  it('useDAG + resolvedDAG 走 DAG 路径', async () => {
    const ctx = mockCtx();
    const dag = { id: 'dag-1', steps: [] } as any;
    const plan = makePlan({ useDAG: true, resolvedDAG: dag });

    const result = await executeByPlan(ctx, plan);

    expect(result.source).toContain('dag/');
  });

  it('经验路由 exp_direct 走经验执行', async () => {
    const ctx = mockCtx({
      sys: {
        llm: { chat: async () => ({ text: 'llm', toolCalls: [] }), consumeLastUnifiedSelection: () => null },
        intelligence: {
          graph: { getNode: () => ({ name: 'skill-a', steps: [], stats: { confidence: 0.8 }, reasoning: 'r' }) },
          executor: { execute: async () => ({ success: true, reply: '这是经验执行的详细结果，内容足够长', outputs: {} }) },
          evolver: { onSuccess: () => {}, onFailure: () => {} },
        },
        ternaryRouter: { query: async () => ({ answer: 't' }) },
        router: { getPool: () => null },
        taskExecutor: { execute: async () => ({ summary: '', taskResults: [] }) },
        cerebellum: null,
      },
    });
    const plan = makePlan({
      selectedNodes: [{
        id: 'exp/skill-a',
        type: 'experience',
        skillId: 'skill-a',
        routePath: 'exp_direct',
      }],
    });

    const result = await executeByPlan(ctx, plan);

    expect(result.source).toContain('exp/');
  });

  it('未知 mode 降级到 single', async () => {
    const ctx = mockCtx();
    const plan = makePlan({ mode: 'unknown_mode' as any });

    const result = await executeByPlan(ctx, plan);

    // 走 single 路径
    expect(result.text).toBeTruthy();
  });
});
