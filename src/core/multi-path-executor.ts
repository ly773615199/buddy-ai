/**
 * 多路执行器 — 并行执行多条路径，选最优结果
 *
 * 根据调度器的分配方案，同时准备多路结果，
 * 按 质量(0.6) + 延迟(0.2) + 成本(0.2) 选择最优。
 */

import type { TaskAllocation, SubTask, CapabilityState } from './capability-scheduler.js';
import type { GenerationCache } from './generation-cache.js';

/** 单条路径的执行结果 */
export interface PathResult {
  pathName: string;
  output: string;
  qualityScore: number;
  latencyMs: number;
  cost: number;
  success: boolean;
}

/** 最终择优结果 */
export interface BestResult {
  output: string;
  selectedPath: string;
  qualityScore: number;
  allCandidates: PathResult[];
}

const WEIGHTS = { quality: 0.6, latency: 0.2, cost: 0.2 };

export class MultiPathExecutor {
  /**
   * 根据分配方案选择并执行路径
   *
   * 注意：实际的 LLM/工具调用由上层负责，
   * 这里只负责策略选择和结果择优。
   */
  async execute(
    subtask: SubTask,
    allocation: TaskAllocation,
    cache: GenerationCache,
    executors: {
      /** 全量 LLM 生成 */
      fullLLM?: (input: string) => Promise<PathResult>;
      /** RAG 辅助生成 */
      ragAssisted?: (input: string) => Promise<PathResult>;
      /** 模板 + 缓存 */
      templatePlusCache?: (input: string) => Promise<PathResult>;
      /** 工具直连 */
      toolDirect?: (input: string) => Promise<PathResult>;
      /** 纯缓存 */
      cacheOnly?: (input: string) => Promise<PathResult>;
    },
  ): Promise<BestResult> {
    // 单路径模式：直接走策略指定的路径
    if (!allocation.multiPath) {
      const result = await this.executeSingle(subtask.content, allocation.strategy, cache, executors);
      return {
        output: result.output,
        selectedPath: result.pathName,
        qualityScore: result.qualityScore,
        allCandidates: [result],
      };
    }

    // 多路径模式：并行执行多条路径
    const tasks: Promise<PathResult>[] = [];

    // 路径 1: 策略指定的主路径
    tasks.push(this.executeSingle(subtask.content, allocation.strategy, cache, executors));

    // 路径 2: 如果主路径不是模板，加一条模板路径作为保底
    if (allocation.strategy !== 'template_plus_cache' && allocation.strategy !== 'cache_only') {
      tasks.push(this.executeSingle(subtask.content, 'template_plus_cache', cache, executors));
    }

    // 路径 3: 如果有缓存，加一条缓存路径
    const cached = cache.get(subtask.type, subtask.content);
    if (cached) {
      tasks.push(Promise.resolve({
        pathName: 'cache_hit',
        output: cached.output,
        qualityScore: cached.qualityScore,
        latencyMs: 1,
        cost: 0,
        success: true,
      }));
    }

    const results = await Promise.allSettled(tasks);
    const candidates = results
      .filter((r): r is PromiseFulfilledResult<PathResult> => r.status === 'fulfilled')
      .map(r => r.value)
      .filter(r => r.success);

    if (candidates.length === 0) {
      return {
        output: '',
        selectedPath: 'none',
        qualityScore: 0,
        allCandidates: [],
      };
    }

    // 择优
    const best = this.selectBest(candidates);
    return {
      output: best.output,
      selectedPath: best.pathName,
      qualityScore: best.qualityScore,
      allCandidates: candidates,
    };
  }

  /** 执行单条路径 */
  private async executeSingle(
    input: string,
    strategy: TaskAllocation['strategy'],
    cache: GenerationCache,
    executors: {
      fullLLM?: (input: string) => Promise<PathResult>;
      ragAssisted?: (input: string) => Promise<PathResult>;
      templatePlusCache?: (input: string) => Promise<PathResult>;
      toolDirect?: (input: string) => Promise<PathResult>;
      cacheOnly?: (input: string) => Promise<PathResult>;
    },
  ): Promise<PathResult> {
    const start = Date.now();

    try {
      switch (strategy) {
        case 'full_llm':
          if (executors.fullLLM) return await executors.fullLLM(input);
          break;
        case 'rag_assisted':
          if (executors.ragAssisted) return await executors.ragAssisted(input);
          break;
        case 'template_plus_cache':
          if (executors.templatePlusCache) return await executors.templatePlusCache(input);
          break;
        case 'tool_direct':
          if (executors.toolDirect) return await executors.toolDirect(input);
          break;
        case 'cache_only':
          if (executors.cacheOnly) return await executors.cacheOnly(input);
          break;
      }
    } catch (err) {
      return {
        pathName: strategy,
        output: '',
        qualityScore: 0,
        latencyMs: Date.now() - start,
        cost: 0,
        success: false,
      };
    }

    // 没有对应执行器时返回失败
    return {
      pathName: strategy,
      output: '',
      qualityScore: 0,
      latencyMs: Date.now() - start,
      cost: 0,
      success: false,
    };
  }

  /** 从候选结果中选择最优 */
  private selectBest(candidates: PathResult[]): PathResult {
    if (candidates.length === 1) return candidates[0];

    // 归一化各维度
    const maxLatency = Math.max(...candidates.map(c => c.latencyMs), 1);
    const maxCost = Math.max(...candidates.map(c => c.cost), 0.001);

    let best = candidates[0];
    let bestScore = -1;

    for (const c of candidates) {
      const score =
        WEIGHTS.quality * c.qualityScore +
        WEIGHTS.latency * (1 - c.latencyMs / maxLatency) +
        WEIGHTS.cost * (1 - c.cost / maxCost);

      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    return best;
  }
}
