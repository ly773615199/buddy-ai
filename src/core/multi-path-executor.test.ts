/**
 * 多路执行器测试
 *
 * 覆盖：
 * - 单路径模式：直接走指定策略
 * - 多路径模式：并行执行多条路径 + 择优
 * - 路径失败处理：部分失败仍能返回最优
 * - 择优算法：质量优先
 * - 缓存命中路径
 * - 边界：无执行器、全部失败
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MultiPathExecutor } from './multi-path-executor.js';
import { GenerationCache } from './generation-cache.js';
import type { SubTask, TaskAllocation, CapabilityState } from './capability-scheduler.js';
import type { PathResult } from './multi-path-executor.js';

// ==================== Mock 辅助 ====================

function makeSubtask(overrides?: Partial<SubTask>): SubTask {
  return {
    type: 'reasoning',
    content: 'explain how React hooks work',
    domains: ['code'],
    complexity: 'medium',
    ...overrides,
  };
}

function makeAllocation(strategy: TaskAllocation['strategy'], multiPath = false): TaskAllocation {
  return {
    weights: { retrieval: 0.3, reasoning: 0.4, execution: 0.1, knowledge: 0.1, expression: 0.1 },
    strategy,
    llmInputStrategy: 'full',
    multiPath,
    reason: 'test',
  };
}

function makeResult(overrides?: Partial<PathResult>): PathResult {
  return {
    pathName: 'test',
    output: 'test output',
    qualityScore: 0.8,
    latencyMs: 100,
    cost: 0.01,
    success: true,
    ...overrides,
  };
}

/** 快速返回的执行器 */
function quickExecutor(name: string, quality: number): (input: string) => Promise<PathResult> {
  return async () => makeResult({ pathName: name, qualityScore: quality, latencyMs: 50 });
}

/** 慢速返回的执行器 */
function slowExecutor(name: string, quality: number): (input: string) => Promise<PathResult> {
  return async () => {
    await new Promise(r => setTimeout(r, 200));
    return makeResult({ pathName: name, qualityScore: quality, latencyMs: 200 });
  };
}

/** 失败的执行器 */
function failingExecutor(name: string): (input: string) => Promise<PathResult> {
  return async () => makeResult({ pathName: name, success: false, qualityScore: 0, output: '' });
}

// ==================== 测试 ====================

describe('MultiPathExecutor', () => {
  let executor: MultiPathExecutor;
  let cache: GenerationCache;

  beforeEach(() => {
    executor = new MultiPathExecutor();
    cache = new GenerationCache('/tmp/test-multi-path');
  });

  // ==================== 单路径模式 ====================

  describe('单路径模式 (multiPath=false)', () => {
    it('full_llm 策略调用 fullLLM 执行器', async () => {
      const result = await executor.execute(
        makeSubtask(),
        makeAllocation('full_llm', false),
        cache,
        { fullLLM: quickExecutor('llm', 0.9) },
      );
      expect(result.selectedPath).toBe('llm');
      expect(result.output).toBe('test output');
    });

    it('rag_assisted 策略调用 ragAssisted 执行器', async () => {
      const result = await executor.execute(
        makeSubtask(),
        makeAllocation('rag_assisted', false),
        cache,
        { ragAssisted: quickExecutor('rag', 0.85) },
      );
      expect(result.selectedPath).toBe('rag');
    });

    it('template_plus_cache 策略调用对应执行器', async () => {
      const result = await executor.execute(
        makeSubtask(),
        makeAllocation('template_plus_cache', false),
        cache,
        { templatePlusCache: quickExecutor('template', 0.7) },
      );
      expect(result.selectedPath).toBe('template');
    });

    it('tool_direct 策略调用对应执行器', async () => {
      const result = await executor.execute(
        makeSubtask(),
        makeAllocation('tool_direct', false),
        cache,
        { toolDirect: quickExecutor('tool', 0.8) },
      );
      expect(result.selectedPath).toBe('tool');
    });

    it('cache_only 策略调用对应执行器', async () => {
      const result = await executor.execute(
        makeSubtask(),
        makeAllocation('cache_only', false),
        cache,
        { cacheOnly: quickExecutor('cache', 0.75) },
      );
      expect(result.selectedPath).toBe('cache');
    });

    it('无对应执行器时返回失败', async () => {
      const result = await executor.execute(
        makeSubtask(),
        makeAllocation('full_llm', false),
        cache,
        { /* 无 fullLLM */ },
      );
      expect(result.selectedPath).toBe('full_llm');
      expect(result.qualityScore).toBe(0);
    });

    it('执行器抛异常时返回失败', async () => {
      const result = await executor.execute(
        makeSubtask(),
        makeAllocation('full_llm', false),
        cache,
        { fullLLM: async () => { throw new Error('boom'); } },
      );
      expect(result.qualityScore).toBe(0);
      // BestResult 没有 success 字段，用 qualityScore=0 表示失败
    });
  });

  // ==================== 多路径模式 ====================

  describe('多路径模式 (multiPath=true)', () => {
    it('并行执行主路径 + 模板保底路径', async () => {
      const result = await executor.execute(
        makeSubtask(),
        makeAllocation('full_llm', true),
        cache,
        {
          fullLLM: quickExecutor('llm', 0.9),
          templatePlusCache: quickExecutor('template', 0.7),
        },
      );
      expect(result.allCandidates.length).toBeGreaterThanOrEqual(2);
    });

    it('选择质量最高的路径', async () => {
      const result = await executor.execute(
        makeSubtask(),
        makeAllocation('full_llm', true),
        cache,
        {
          fullLLM: quickExecutor('llm-high', 0.95),
          templatePlusCache: quickExecutor('template-low', 0.5),
        },
      );
      // 质量 0.95 应该胜出
      expect(result.selectedPath).toBe('llm-high');
      expect(result.qualityScore).toBeCloseTo(0.95, 2);
    });

    it('主路径失败时仍能从保底路径返回', async () => {
      const result = await executor.execute(
        makeSubtask(),
        makeAllocation('full_llm', true),
        cache,
        {
          fullLLM: failingExecutor('llm-fail'),
          templatePlusCache: quickExecutor('template-ok', 0.7),
        },
      );
      expect(result.selectedPath).toBe('template-ok');
      expect(result.qualityScore).toBeGreaterThan(0);
    });

    it('template_plus_cache 策略不加保底路径（已经是保底）', async () => {
      const result = await executor.execute(
        makeSubtask(),
        makeAllocation('template_plus_cache', true),
        cache,
        { templatePlusCache: quickExecutor('template', 0.7) },
      );
      // 只有 1 条路径（不重复加保底）
      expect(result.allCandidates.length).toBe(1);
    });

    it('cache_only 策略不加保底路径', async () => {
      const result = await executor.execute(
        makeSubtask(),
        makeAllocation('cache_only', true),
        cache,
        { cacheOnly: quickExecutor('cache', 0.8) },
      );
      expect(result.allCandidates.length).toBe(1);
    });
  });

  // ==================== 择优算法 ====================

  describe('择优算法', () => {
    it('高质量低延迟胜出', async () => {
      const result = await executor.execute(
        makeSubtask(),
        makeAllocation('full_llm', true),
        cache,
        {
          fullLLM: makeResult.bind(null, { pathName: 'fast-high', qualityScore: 0.9, latencyMs: 50, cost: 0.01 }),
          templatePlusCache: makeResult.bind(null, { pathName: 'slow-low', qualityScore: 0.6, latencyMs: 500, cost: 0.01 }),
        },
      );
      expect(result.selectedPath).toBe('fast-high');
    });

    it('低成本有优势（同等质量时）', async () => {
      const result = await executor.execute(
        makeSubtask(),
        makeAllocation('full_llm', true),
        cache,
        {
          fullLLM: makeResult.bind(null, { pathName: 'expensive', qualityScore: 0.8, latencyMs: 100, cost: 0.1 }),
          templatePlusCache: makeResult.bind(null, { pathName: 'cheap', qualityScore: 0.8, latencyMs: 100, cost: 0.001 }),
        },
      );
      expect(result.selectedPath).toBe('cheap');
    });
  });

  // ==================== 全部失败 ====================

  describe('全部失败', () => {
    it('所有路径失败时返回空结果', async () => {
      const result = await executor.execute(
        makeSubtask(),
        makeAllocation('full_llm', true),
        cache,
        {
          fullLLM: failingExecutor('llm'),
          templatePlusCache: failingExecutor('template'),
        },
      );
      expect(result.selectedPath).toBe('none');
      expect(result.qualityScore).toBe(0);
      expect(result.output).toBe('');
    });
  });

  // ==================== allCandidates ====================

  describe('allCandidates', () => {
    it('单路径模式返回 1 个候选', async () => {
      const result = await executor.execute(
        makeSubtask(),
        makeAllocation('full_llm', false),
        cache,
        { fullLLM: quickExecutor('llm', 0.8) },
      );
      expect(result.allCandidates.length).toBe(1);
    });

    it('多路径模式返回多个候选', async () => {
      const result = await executor.execute(
        makeSubtask(),
        makeAllocation('full_llm', true),
        cache,
        {
          fullLLM: quickExecutor('llm', 0.9),
          templatePlusCache: quickExecutor('template', 0.7),
        },
      );
      expect(result.allCandidates.length).toBeGreaterThanOrEqual(2);
    });
  });
});
