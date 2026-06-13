/**
 * 能力协同调度器 — 子任务级别的动态能力组合
 *
 * 核心理念：不是"有LLM用LLM，没有走模板"的二元降级，
 * 而是五种能力（检索/推理/执行/知识/表达）动态组合，
 * 根据任务性质 + 当前能力状态 + 历史经验，追求每个子任务的最优完成质量。
 */

import { LLMProfiler } from './llm-profiler.js';
import type { GenerationCache } from './generation-cache.js';

// ==================== 类型定义 ====================

/** 五种能力维度 */
export interface CapabilityState {
  retrieval: { available: boolean; quality: number; latency: number };
  reasoning: { available: boolean; quality: number; latency: number };
  execution: { available: boolean; quality: number; latency: number };
  knowledge: { available: boolean; quality: number; latency: number };
  expression: { available: boolean; quality: number; latency: number };
}

/** 子任务类型 */
export type SubTaskType = 'retrieval' | 'reasoning' | 'execution' | 'expression' | 'mixed';

/** 子任务描述 */
export interface SubTask {
  type: SubTaskType;
  content: string;
  domains: string[];
  complexity: 'simple' | 'medium' | 'complex';
  /** 是否需要 LLM 参与（默认 true） */
  needsLLM?: boolean;
  /** 优先级 (越高越先执行) */
  priority?: number;
}

/** 能力分配方案 */
export interface TaskAllocation {
  /** 各能力贡献度权重 (0-1) */
  weights: {
    retrieval: number;
    reasoning: number;
    execution: number;
    knowledge: number;
    expression: number;
  };
  /** 执行策略 */
  strategy: 'full_llm' | 'rag_assisted' | 'template_plus_cache' | 'tool_direct' | 'cache_only';
  /** LLM 输入策略 */
  llmInputStrategy: 'full' | 'condensed' | 'minimal' | 'none';
  /** 是否并行执行多路径 */
  multiPath: boolean;
  /** 调度理由 (调试用) */
  reason: string;
}

/** 历史经验记录 */
interface TaskHistoryRecord {
  taskType: SubTaskType;
  domains: string[];
  allocation: TaskAllocation;
  qualityScore: number;
  timestamp: number;
}

// ==================== 调度器 ====================

export class CapabilityScheduler {
  private history: TaskHistoryRecord[] = [];
  private readonly maxHistory = 500;

  /**
   * 为子任务分配最优能力组合
   */
  allocate(
    subtask: SubTask,
    state: CapabilityState,
    llmProfiler: LLMProfiler,
    cache: GenerationCache,
  ): TaskAllocation {
    const llmProfile = llmProfiler.getProfile();

    // 1. 任务性质决定基础权重
    const base = this.getBaseWeights(subtask);

    // 2. 当前能力状态调整权重
    const adjusted = this.adjustByState(base, state, subtask);

    // 3. 历史经验修正
    const final = this.adjustByHistory(adjusted, subtask);

    // 4. 确定执行策略
    const strategy = this.determineStrategy(subtask, state, llmProfiler, cache);

    // 5. 确定 LLM 输入策略
    const llmInputStrategy = llmProfiler.getInputStrategy();

    // 6. 是否需要多路径
    const multiPath = subtask.complexity !== 'simple' && state.reasoning.available;

    return {
      weights: final,
      strategy,
      llmInputStrategy: llmProfiler.getInputStrategy(),
      multiPath,
      reason: this.explainDecision(subtask, state, llmProfile, strategy),
    };
  }

  /** 记录任务结果，回流到历史经验 */
  recordOutcome(
    subtask: SubTask,
    allocation: TaskAllocation,
    qualityScore: number,
  ): void {
    this.history.push({
      taskType: subtask.type,
      domains: subtask.domains,
      allocation,
      qualityScore,
      timestamp: Date.now(),
    });
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  }

  /** 获取历史中同类任务的最优策略 */
  getBestStrategy(taskType: SubTaskType, domains: string[]): TaskAllocation | null {
    const similar = this.history.filter(h =>
      h.taskType === taskType &&
      h.domains.some(d => domains.includes(d)),
    );
    if (similar.length < 3) return null;

    // 按质量分排序，取中位数附近的策略
    similar.sort((a, b) => b.qualityScore - a.qualityScore);
    return similar[Math.floor(similar.length * 0.3)].allocation;
  }

  // ==================== 内部逻辑 ====================

  /** 任务性质 → 基础权重 */
  private getBaseWeights(subtask: SubTask): TaskAllocation['weights'] {
    switch (subtask.type) {
      case 'retrieval':
        return { retrieval: 0.7, reasoning: 0.1, execution: 0.05, knowledge: 0.1, expression: 0.05 };
      case 'reasoning':
        return { retrieval: 0.2, reasoning: 0.5, execution: 0.05, knowledge: 0.15, expression: 0.1 };
      case 'execution':
        return { retrieval: 0.1, reasoning: 0.1, execution: 0.6, knowledge: 0.1, expression: 0.1 };
      case 'expression':
        return { retrieval: 0.15, reasoning: 0.2, execution: 0.05, knowledge: 0.1, expression: 0.5 };
      case 'mixed':
        return { retrieval: 0.25, reasoning: 0.25, execution: 0.2, knowledge: 0.15, expression: 0.15 };
    }
  }

  /** 能力状态调整权重 */
  private adjustByState(
    base: TaskAllocation['weights'],
    state: CapabilityState,
    subtask: SubTask,
  ): TaskAllocation['weights'] {
    const adjusted = { ...base };

    // LLM 不可用 → 降低 reasoning/expression，提升 retrieval/knowledge
    if (!state.reasoning.available) {
      const deficit = adjusted.reasoning * 0.7;
      adjusted.reasoning *= 0.3;
      adjusted.retrieval += deficit * 0.5;
      adjusted.knowledge += deficit * 0.3;
      adjusted.expression += deficit * 0.2;
    }

    // 检索质量高 → 提升检索权重
    if (state.retrieval.available && state.retrieval.quality > 0.7) {
      const boost = adjusted.retrieval * 0.2;
      adjusted.retrieval += boost;
      adjusted.reasoning -= boost * 0.5;
      adjusted.expression -= boost * 0.5;
    }

    // 知识库丰富 → 提升知识权重
    if (state.knowledge.available && state.knowledge.quality > 0.6) {
      const boost = adjusted.knowledge * 0.15;
      adjusted.knowledge += boost;
      adjusted.reasoning -= boost;
    }

    // 归一化
    const total = Object.values(adjusted).reduce((s, v) => s + v, 0);
    if (total > 0) {
      for (const key of Object.keys(adjusted) as Array<keyof typeof adjusted>) {
        adjusted[key] /= total;
      }
    }

    return adjusted;
  }

  /** 历史经验修正 */
  private adjustByHistory(
    base: TaskAllocation['weights'],
    subtask: SubTask,
  ): TaskAllocation['weights'] {
    const best = this.getBestStrategy(subtask.type, subtask.domains);
    if (!best) return base;

    // 向历史最优策略靠拢 (30% 权重)
    const blend = 0.3;
    return {
      retrieval: base.retrieval * (1 - blend) + best.weights.retrieval * blend,
      reasoning: base.reasoning * (1 - blend) + best.weights.reasoning * blend,
      execution: base.execution * (1 - blend) + best.weights.execution * blend,
      knowledge: base.knowledge * (1 - blend) + best.weights.knowledge * blend,
      expression: base.expression * (1 - blend) + best.weights.expression * blend,
    };
  }

  /** 确定执行策略 */
  private determineStrategy(
    subtask: SubTask,
    state: CapabilityState,
    llmProfiler: LLMProfiler,
    cache: GenerationCache,
  ): TaskAllocation['strategy'] {
    // 缓存命中 → 直接用缓存
    const cached = cache.get(subtask.type, subtask.content);
    if (cached && cached.qualityScore > 0.7) {
      return 'cache_only';
    }

    // 纯执行型任务 → 工具直连
    if (subtask.type === 'execution' && state.execution.available) {
      return 'tool_direct';
    }

    // 检索型任务 + 检索可用 → RAG
    if (subtask.type === 'retrieval' && state.retrieval.available) {
      if (state.reasoning.available && llmProfiler.canUseFor('batch')) {
        return 'rag_assisted';
      }
      return 'template_plus_cache';
    }

    // LLM 强 → 全量生成
    if (state.reasoning.available && llmProfiler.canUseFor('realtime')) {
      return 'full_llm';
    }

    // LLM 弱 → RAG 辅助
    if (state.reasoning.available && llmProfiler.canUseFor('batch')) {
      return 'rag_assisted';
    }

    // LLM 不可用 → 模板 + 缓存
    return 'template_plus_cache';
  }

  /** 调试：解释调度决策 */
  private explainDecision(
    subtask: SubTask,
    state: CapabilityState,
    llmProfile: { capabilityLevel: string },
    strategy: TaskAllocation['strategy'],
  ): string {
    const parts = [
      `task=${subtask.type}`,
      `complexity=${subtask.complexity}`,
      `llm=${llmProfile.capabilityLevel}`,
      `strategy=${strategy}`,
    ];
    return parts.join(', ');
  }
}
