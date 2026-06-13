/**
 * 能力协同调度器测试
 *
 * 覆盖：
 * - 基础调度：不同子任务类型的基础权重
 * - 能力状态调整：LLM 不可用/弱/检索高质量时的权重变化
 * - 历史经验修正：同类任务最优策略靠拢
 * - 策略选择：full_llm/rag_assisted/template_plus_cache/tool_direct/cache_only
 * - LLM 输入策略
 * - 多路径判断
 * - recordOutcome 回流
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CapabilityScheduler } from './capability-scheduler.js';
import { LLMProfiler } from './llm-profiler.js';
import { GenerationCache } from './generation-cache.js';
import type { SubTask, CapabilityState, TaskAllocation } from './capability-scheduler.js';

// ==================== Mock 辅助 ====================

/** 全能力可用 */
function fullCapability(): CapabilityState {
  return {
    retrieval: { available: true, quality: 0.8, latency: 100 },
    reasoning: { available: true, quality: 0.8, latency: 200 },
    execution: { available: true, quality: 0.9, latency: 50 },
    knowledge: { available: true, quality: 0.7, latency: 100 },
    expression: { available: true, quality: 0.8, latency: 150 },
  };
}

/** LLM 不可用 */
function noLLMCapability(): CapabilityState {
  return {
    ...fullCapability(),
    reasoning: { available: false, quality: 0, latency: 0 },
    expression: { available: false, quality: 0, latency: 0 },
  };
}

/** 检索高质量 */
function highRetrievalCapability(): CapabilityState {
  return {
    ...fullCapability(),
    retrieval: { available: true, quality: 0.95, latency: 50 },
  };
}

function makeSubtask(overrides?: Partial<SubTask>): SubTask {
  return {
    type: 'mixed',
    content: 'test task',
    domains: ['general'],
    complexity: 'medium',
    ...overrides,
  };
}

function makeStrongProfiler(): LLMProfiler {
  const p = new LLMProfiler();
  for (let i = 0; i < 5; i++) p.record({ latencyMs: 300, success: true, qualityScore: 0.85 });
  return p;
}

function makeWeakProfiler(): LLMProfiler {
  const p = new LLMProfiler();
  for (let i = 0; i < 5; i++) p.record({ latencyMs: 12000, success: true, qualityScore: 0.3 });
  return p;
}

function makeUnavailableProfiler(): LLMProfiler {
  const p = new LLMProfiler();
  for (let i = 0; i < 5; i++) p.record({ latencyMs: 100, success: false });
  return p;
}

// ==================== 测试 ====================

describe('CapabilityScheduler', () => {
  let scheduler: CapabilityScheduler;
  let cache: GenerationCache;

  beforeEach(() => {
    scheduler = new CapabilityScheduler();
    cache = new GenerationCache('/tmp/test-cache');
  });

  // ==================== 基础调度 ====================

  describe('基础权重分配', () => {
    it('retrieval 类型任务 retrieval 权重最高', () => {
      const result = scheduler.allocate(
        makeSubtask({ type: 'retrieval' }),
        fullCapability(),
        makeStrongProfiler(),
        cache,
      );
      expect(result.weights.retrieval).toBeGreaterThan(result.weights.reasoning);
      expect(result.weights.retrieval).toBeGreaterThan(result.weights.execution);
    });

    it('reasoning 类型任务 reasoning 权重最高', () => {
      const result = scheduler.allocate(
        makeSubtask({ type: 'reasoning' }),
        fullCapability(),
        makeStrongProfiler(),
        cache,
      );
      expect(result.weights.reasoning).toBeGreaterThan(result.weights.retrieval);
      expect(result.weights.reasoning).toBeGreaterThan(result.weights.execution);
    });

    it('execution 类型任务 execution 权重最高', () => {
      const result = scheduler.allocate(
        makeSubtask({ type: 'execution' }),
        fullCapability(),
        makeStrongProfiler(),
        cache,
      );
      expect(result.weights.execution).toBeGreaterThan(result.weights.retrieval);
      expect(result.weights.execution).toBeGreaterThan(result.weights.reasoning);
    });

    it('expression 类型任务 expression 权重最高', () => {
      const result = scheduler.allocate(
        makeSubtask({ type: 'expression' }),
        fullCapability(),
        makeStrongProfiler(),
        cache,
      );
      expect(result.weights.expression).toBeGreaterThan(result.weights.retrieval);
      expect(result.weights.expression).toBeGreaterThan(result.weights.execution);
    });

    it('mixed 类型任务权重分布较均匀', () => {
      const result = scheduler.allocate(
        makeSubtask({ type: 'mixed' }),
        fullCapability(),
        makeStrongProfiler(),
        cache,
      );
      const weights = Object.values(result.weights);
      const max = Math.max(...weights);
      const min = Math.min(...weights);
      // 最大权重不超过最小的 3 倍
      expect(max / min).toBeLessThan(3);
    });

    it('权重总和归一化为 1', () => {
      const result = scheduler.allocate(
        makeSubtask({ type: 'retrieval' }),
        fullCapability(),
        makeStrongProfiler(),
        cache,
      );
      const total = Object.values(result.weights).reduce((s, v) => s + v, 0);
      expect(total).toBeCloseTo(1.0, 5);
    });
  });

  // ==================== 能力状态调整 ====================

  describe('能力状态调整', () => {
    it('LLM 不可用时 reasoning 权重降低', () => {
      const withLLM = scheduler.allocate(
        makeSubtask({ type: 'reasoning' }),
        fullCapability(),
        makeStrongProfiler(),
        cache,
      );
      const noLLM = scheduler.allocate(
        makeSubtask({ type: 'reasoning' }),
        noLLMCapability(),
        makeUnavailableProfiler(),
        cache,
      );
      expect(noLLM.weights.reasoning).toBeLessThan(withLLM.weights.reasoning);
    });

    it('LLM 不可用时 retrieval 权重提升', () => {
      const withLLM = scheduler.allocate(
        makeSubtask({ type: 'reasoning' }),
        fullCapability(),
        makeStrongProfiler(),
        cache,
      );
      const noLLM = scheduler.allocate(
        makeSubtask({ type: 'reasoning' }),
        noLLMCapability(),
        makeUnavailableProfiler(),
        cache,
      );
      expect(noLLM.weights.retrieval).toBeGreaterThan(withLLM.weights.retrieval);
    });

    it('LLM 不可用时 knowledge 权重提升', () => {
      const withLLM = scheduler.allocate(
        makeSubtask({ type: 'reasoning' }),
        fullCapability(),
        makeStrongProfiler(),
        cache,
      );
      const noLLM = scheduler.allocate(
        makeSubtask({ type: 'reasoning' }),
        noLLMCapability(),
        makeUnavailableProfiler(),
        cache,
      );
      expect(noLLM.weights.knowledge).toBeGreaterThan(withLLM.weights.knowledge);
    });

    it('检索高质量时 retrieval 权重高于 reasoning（归一化后）', () => {
      const highRetrieval = scheduler.allocate(
        makeSubtask({ type: 'retrieval' }),
        highRetrievalCapability(),
        makeStrongProfiler(),
        cache,
      );
      expect(highRetrieval.weights.retrieval).toBeGreaterThan(highRetrieval.weights.reasoning);
    });
  });

  // ==================== 策略选择 ====================

  describe('策略选择', () => {
    it('LLM 强 + retrieval 任务 → rag_assisted 或 full_llm', () => {
      const result = scheduler.allocate(
        makeSubtask({ type: 'retrieval' }),
        fullCapability(),
        makeStrongProfiler(),
        cache,
      );
      expect(['rag_assisted', 'full_llm']).toContain(result.strategy);
    });

    it('纯 execution 任务 → tool_direct', () => {
      const result = scheduler.allocate(
        makeSubtask({ type: 'execution' }),
        fullCapability(),
        makeStrongProfiler(),
        cache,
      );
      expect(result.strategy).toBe('tool_direct');
    });

    it('LLM 不可用 → template_plus_cache', () => {
      const result = scheduler.allocate(
        makeSubtask({ type: 'reasoning' }),
        noLLMCapability(),
        makeUnavailableProfiler(),
        cache,
      );
      expect(result.strategy).toBe('template_plus_cache');
    });

    it('LLM 弱 → rag_assisted 或 template_plus_cache', () => {
      const result = scheduler.allocate(
        makeSubtask({ type: 'retrieval' }),
        fullCapability(),
        makeWeakProfiler(),
        cache,
      );
      expect(['rag_assisted', 'template_plus_cache']).toContain(result.strategy);
    });
  });

  // ==================== 历史经验修正 ====================

  describe('历史经验修正', () => {
    it('无历史时不报错', () => {
      const result = scheduler.allocate(
        makeSubtask({ type: 'retrieval' }),
        fullCapability(),
        makeStrongProfiler(),
        cache,
      );
      expect(result.weights).toBeDefined();
    });

    it('历史经验影响后续调度（3 次后）', () => {
      const subtask = makeSubtask({ type: 'retrieval', domains: ['test-domain'] });

      // 先记录 3 次高质量的 rag_assisted 结果
      for (let i = 0; i < 3; i++) {
        scheduler.recordOutcome(subtask, {
          weights: { retrieval: 0.6, reasoning: 0.2, execution: 0.05, knowledge: 0.1, expression: 0.05 },
          strategy: 'rag_assisted',
          llmInputStrategy: 'condensed',
          multiPath: false,
          reason: 'test',
        }, 0.9);
      }

      // 再次调度，应该受历史影响
      const result = scheduler.allocate(subtask, fullCapability(), makeStrongProfiler(), cache);
      expect(result.weights.retrieval).toBeGreaterThan(0.3);
    });

    it('getBestStrategy 无足够历史返回 null', () => {
      const best = scheduler.getBestStrategy('retrieval', ['test']);
      expect(best).toBeNull();
    });

    it('getBestStrategy 有 3+ 历史返回最优', () => {
      const subtask = makeSubtask({ type: 'retrieval', domains: ['find-me'] });
      for (let i = 0; i < 3; i++) {
        scheduler.recordOutcome(subtask, {
          weights: { retrieval: 0.5, reasoning: 0.3, execution: 0.05, knowledge: 0.1, expression: 0.05 },
          strategy: 'rag_assisted',
          llmInputStrategy: 'full',
          multiPath: false,
          reason: 'test',
        }, 0.85);
      }
      const best = scheduler.getBestStrategy('retrieval', ['find-me']);
      expect(best).not.toBeNull();
      expect(best!.strategy).toBe('rag_assisted');
    });
  });

  // ==================== recordOutcome ====================

  describe('recordOutcome()', () => {
    it('记录后历史增长', () => {
      scheduler.recordOutcome(makeSubtask(), {
        weights: { retrieval: 0.5, reasoning: 0.3, execution: 0.05, knowledge: 0.1, expression: 0.05 },
        strategy: 'full_llm',
        llmInputStrategy: 'full',
        multiPath: false,
        reason: 'test',
      }, 0.8);
      // 内部状态无法直接访问，但 getBestStrategy 可以间接验证
      // 记录 3 次后应该能查到
      scheduler.recordOutcome(makeSubtask(), {
        weights: { retrieval: 0.5, reasoning: 0.3, execution: 0.05, knowledge: 0.1, expression: 0.05 },
        strategy: 'full_llm',
        llmInputStrategy: 'full',
        multiPath: false,
        reason: 'test',
      }, 0.8);
      scheduler.recordOutcome(makeSubtask(), {
        weights: { retrieval: 0.5, reasoning: 0.3, execution: 0.05, knowledge: 0.1, expression: 0.05 },
        strategy: 'full_llm',
        llmInputStrategy: 'full',
        multiPath: false,
        reason: 'test',
      }, 0.8);
      const best = scheduler.getBestStrategy('mixed', ['general']);
      expect(best).not.toBeNull();
    });
  });

  // ==================== 多路径判断 ====================

  describe('多路径判断', () => {
    it('simple 任务不走多路径', () => {
      const result = scheduler.allocate(
        makeSubtask({ complexity: 'simple' }),
        fullCapability(),
        makeStrongProfiler(),
        cache,
      );
      expect(result.multiPath).toBe(false);
    });

    it('medium 任务 + reasoning 可用 → 多路径', () => {
      const result = scheduler.allocate(
        makeSubtask({ complexity: 'medium' }),
        fullCapability(),
        makeStrongProfiler(),
        cache,
      );
      expect(result.multiPath).toBe(true);
    });

    it('complex 任务 + reasoning 可用 → 多路径', () => {
      const result = scheduler.allocate(
        makeSubtask({ complexity: 'complex' }),
        fullCapability(),
        makeStrongProfiler(),
        cache,
      );
      expect(result.multiPath).toBe(true);
    });

    it('medium 任务 + reasoning 不可用 → 不走多路径', () => {
      const result = scheduler.allocate(
        makeSubtask({ complexity: 'medium' }),
        noLLMCapability(),
        makeUnavailableProfiler(),
        cache,
      );
      expect(result.multiPath).toBe(false);
    });
  });

  // ==================== reason 解释 ====================

  describe('reason 调试信息', () => {
    it('包含 task 类型', () => {
      const result = scheduler.allocate(
        makeSubtask({ type: 'retrieval' }),
        fullCapability(),
        makeStrongProfiler(),
        cache,
      );
      expect(result.reason).toContain('task=retrieval');
    });

    it('包含 complexity', () => {
      const result = scheduler.allocate(
        makeSubtask({ complexity: 'complex' }),
        fullCapability(),
        makeStrongProfiler(),
        cache,
      );
      expect(result.reason).toContain('complexity=complex');
    });

    it('包含 strategy', () => {
      const result = scheduler.allocate(
        makeSubtask(),
        fullCapability(),
        makeStrongProfiler(),
        cache,
      );
      expect(result.reason).toContain('strategy=');
    });
  });
});
