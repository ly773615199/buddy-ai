/**
 * 三层知识管线性能基准测试
 *
 * 验收标准: 管线总耗时 < 50ms（不含源检索时间）
 */
import { describe, it, expect } from 'vitest';
import { KnowledgeConvergence } from './knowledge-convergence.js';
import { CollisionEngine, type CollisionNode } from './collision-engine.js';
import { KnowledgeAssembler } from './knowledge-assembler.js';

// ==================== Mock 依赖 ====================

function makeMockSTMP() {
  return {
    retrieve: async () => [
      { id: 'mem-1', content: '记忆片段1', score: 0.8, timestamp: Date.now(), roomId: 'r1' },
      { id: 'mem-2', content: '记忆片段2', score: 0.6, timestamp: Date.now(), roomId: 'r1' },
    ],
  };
}

function makeMockExperienceGraph() {
  return {
    match: async () => [
      { id: 'exp-1', trigger: 'test', steps: ['step1'], successRate: 0.9, usageCount: 5 },
    ],
    getNode: async () => null,
  };
}

function makeMockKnowledgeSource() {
  return {
    query: async () => [
      { id: 'ks-1', content: '知识源结果1', source: 'local', score: 0.7 },
    ],
    getStats: () => ({ totalSources: 2 }),
  };
}

function makeMockTernaryRouter() {
  return {
    query: async () => [
      { id: 'tern-1', content: '专家推理结果', confidence: 0.75 },
    ],
  };
}

// ==================== 性能基准 ====================

describe('三层知识管线性能基准', () => {
  const WARMUP_RUNS = 5;
  const BENCHMARK_RUNS = 20;
  const MAX_PIPELINE_MS = 50;

  it('管线总耗时 < 50ms（20 次运行 P95）', async () => {
    const convergence = new KnowledgeConvergence(
      makeMockSTMP() as any,
      makeMockExperienceGraph() as any,
      makeMockKnowledgeSource() as any,
      makeMockTernaryRouter() as any,
      null, // TextEncoder — 不可用时降级
      false,
    );
    const collision = new CollisionEngine();
    const assembler = new KnowledgeAssembler();

    // 预热
    for (let i = 0; i < WARMUP_RUNS; i++) {
      const nodes = await convergence.converge('测试输入文本', { maxNodes: 10, timeoutMs: 500 });
      if (nodes.length >= 2) {
        const editResult = collision.fullEdit(nodes, 'report');
        assembler.assemble(editResult, 'report');
      }
    }

    // 正式基准
    const latencies: number[] = [];
    for (let i = 0; i < BENCHMARK_RUNS; i++) {
      const t0 = performance.now();

      // ① 采集层
      const nodes = await convergence.converge('帮我分析一下这个代码的性能瓶颈', {
        toolResults: [{ name: 'exec', result: '执行成功' }],
        maxNodes: 15,
        timeoutMs: 500,
      });

      // ② 编辑层
      if (nodes.length >= 2) {
        const editResult = collision.fullEdit(nodes, 'report');

        // ③ 发送层
        assembler.assemble(editResult, 'report');
      }

      latencies.push(performance.now() - t0);
    }

    // 统计
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const max = latencies[latencies.length - 1];
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

    console.log(`  管线性能: P50=${p50.toFixed(1)}ms, P95=${p95.toFixed(1)}ms, MAX=${max.toFixed(1)}ms, AVG=${avg.toFixed(1)}ms`);

    // P95 < 50ms
    expect(p95).toBeLessThan(MAX_PIPELINE_MS);
  });

  it('采集层: 6 源并行，单源超时不阻塞', async () => {
    // 模拟一个慢源（1s 超时保护应截断）
    const slowSTMP = {
      retrieve: async () => {
        await new Promise(r => setTimeout(r, 2000)); // 2s 延迟
        return [];
      },
    };

    const convergence = new KnowledgeConvergence(
      slowSTMP as any,
      makeMockExperienceGraph() as any,
      makeMockKnowledgeSource() as any,
      makeMockTernaryRouter() as any,
      null,
      false,
    );

    const t0 = performance.now();
    const nodes = await convergence.converge('测试', { timeoutMs: 500 });
    const elapsed = performance.now() - t0;

    // 应在 ~500ms 内返回（超时截断），不应等 2s
    expect(elapsed).toBeLessThan(1000);
    // 仍应有结果（来自其他源）
    expect(nodes.length).toBeGreaterThan(0);
  });

  it('编辑层: 去重 + 碰撞 + 冲突检测', () => {
    const collision = new CollisionEngine();

    const nodes: CollisionNode[] = [
      { id: 'a', content: '相同内容测试', vector: new Float32Array([1, 0, 0, ...new Array(125).fill(0)]), source: 'stmp', score: 0.9, timestamp: Date.now() },
      { id: 'b', content: '相同内容测试', vector: new Float32Array([1, 0, 0, ...new Array(125).fill(0)]), source: 'experience', score: 0.8, timestamp: Date.now() },
      { id: 'c', content: '完全不同的话题', vector: new Float32Array([0, 0, 1, ...new Array(125).fill(0)]), source: 'web', score: 0.7, timestamp: Date.now() },
    ];

    const t0 = performance.now();
    const result = collision.fullEdit(nodes, 'report');
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(10);
    expect(result.edited.length).toBeGreaterThan(0);
    expect(result.explanation).toBeTruthy();
  });

  it('发送层: 5 种意图策略', () => {
    const assembler = new KnowledgeAssembler();

    const editResult = {
      edited: [
        { id: 'r1', content: '测试知识', sources: ['stmp'], confidence: 0.8, strategy: 'fuse' as const },
      ],
      conflicts: [],
      stats: { fused: 1, emerged: 0, scattered: 0 },
    };

    for (const intent of ['report', 'explain', 'compare', 'execute', 'chat'] as const) {
      const t0 = performance.now();
      const output = assembler.assemble(editResult, intent);
      const elapsed = performance.now() - t0;

      expect(elapsed).toBeLessThan(5);
      if (intent === 'chat') {
        expect(output).toBe('');
      } else {
        expect(output.length).toBeGreaterThan(0);
      }
    }
  });

  it('降级: 节点 < 2 时跳过碰撞直接返回', async () => {
    const convergence = new KnowledgeConvergence(
      makeMockSTMP() as any,
      { match: async () => [] } as any, // 空经验图谱
      { query: async () => [], getStats: () => ({ totalSources: 0 }) } as any,
      null,
      null,
      false,
    );

    const nodes = await convergence.converge('测试', { maxNodes: 5, timeoutMs: 500 });
    // 即使只有 0-1 个节点，不应崩溃
    expect(nodes.length).toBeLessThan(2);
  });
});
