/**
 * DecisionExplainer — 决策可解释器
 *
 * 记录 ModelPool 三级漏斗选择的完整 trace：
 * - Layer 0: 静态裁剪（黑名单/streaming/成本）
 * - Layer 1: 元数据快筛（能力/任务匹配/语言/上下文）
 * - Layer 2: Thompson Sampling 采样值排名
 *
 * 性能开销 <1ms（纯数据记录）
 */

import type { ModelPool, ModelProfile, ModelRequirement, ModelSelection } from './model-pool.js';

// ==================== 类型定义 ====================

export interface DecisionTrace {
  /** 决策 ID */
  id: string;
  /** 时间戳 */
  timestamp: number;
  /** 输入信号 */
  input: {
    taskType: string;
    complexity: string;
    domains: string[];
    languagePreference?: string;
  };
  /** 漏斗经过的层 */
  layers: TraceLayer[];
  /** 最终选择 */
  result: {
    modelId: string;
    provider: string;
    reason: string;
    confidence: number;
    source: string;
  };
  /** 被过滤掉的候选（top 5） */
  filtered: Array<{ modelId: string; filteredBy: string; reason: string }>;
  /** 总耗时 */
  totalMs: number;
}

export interface TraceLayer {
  name: string;                 // 'static_filter' | 'metadata_filter' | 'thompson_select'
  inputCount: number;           // 进入该层的候选数
  outputCount: number;          // 通过的候选数
  filters: Array<{
    condition: string;
    passed: boolean;
    affected: number;           // 被此条件过滤的数量
  }>;
  durationMs: number;
}

// ==================== 决策解释器 ====================

export class DecisionExplainer {
  private traces: DecisionTrace[] = [];
  private readonly maxTraces: number;

  constructor(maxTraces = 100) {
    this.maxTraces = maxTraces;
  }

  // ==================== 记录 ====================

  /** 记录一次决策 trace */
  record(trace: DecisionTrace): void {
    this.traces.push(trace);
    if (this.traces.length > this.maxTraces) {
      this.traces = this.traces.slice(-this.maxTraces);
    }
  }

  /**
   * 包装 ModelPool.selectFromUnified()，自动记录 trace
   *
   * 用法：
   * ```ts
   * const explainer = new DecisionExplainer();
   * const selection = explainer.traceSelect(pool, requirement);
   * ```
   */
  traceSelect(
    pool: ModelPool,
    requirement: ModelRequirement,
  ): ModelSelection | null {
    const t0 = performance.now();
    const traceId = `trace-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // 获取所有候选（Layer 0 前）
    const allProfiles = pool.getAllProfiles();

    // 执行实际选择
    const selection = pool.select(requirement);

    const totalMs = performance.now() - t0;

    // 构建简化 trace（无法直接观测漏斗内部，但可以记录输入输出）
    const layers: TraceLayer[] = [];

    // Layer 0: 推断静态裁剪
    const layer0Output = allProfiles.filter(p =>
      p.capabilities.streaming &&
      !this.isExcluded(p.id, pool)
    );
    layers.push({
      name: 'static_filter',
      inputCount: allProfiles.length,
      outputCount: layer0Output.length,
      filters: [
        { condition: 'streaming=true', passed: true, affected: allProfiles.length - layer0Output.length },
      ],
      durationMs: 0,
    });

    // Layer 1: 推断元数据过滤
    const layer1Output = layer0Output.filter(p => {
      if (requirement.minCapabilities.reasoning && (p.capabilities.reasoning ?? 0) < requirement.minCapabilities.reasoning) return false;
      if (requirement.minCapabilities.code && (p.capabilities.code ?? 0) < requirement.minCapabilities.code) return false;
      if (requirement.requiredFeatures.includes('toolCalling') && !p.capabilities.toolCalling) return false;
      if (requirement.languagePreference === 'chinese' && p.capabilities.chinese < 0.6) return false;
      if (requirement.languagePreference === 'english' && p.capabilities.english < 0.6) return false;
      return true;
    });
    layers.push({
      name: 'metadata_filter',
      inputCount: layer0Output.length,
      outputCount: layer1Output.length,
      filters: [
        { condition: 'capability_match', passed: true, affected: layer0Output.length - layer1Output.length },
      ],
      durationMs: 0,
    });

    // Layer 2: Thompson Sampling
    layers.push({
      name: 'thompson_select',
      inputCount: layer1Output.length,
      outputCount: selection ? 1 : 0,
      filters: [],
      durationMs: 0,
    });

    // 被过滤的候选
    const selectedId = selection?.profile.id;
    const filtered = allProfiles
      .filter(p => p.id !== selectedId)
      .slice(0, 5)
      .map(p => ({
        modelId: p.id,
        filteredBy: layer1Output.some(lp => lp.id === p.id) ? 'thompson' : 'metadata',
        reason: layer1Output.some(lp => lp.id === p.id)
          ? 'Thompson Sampling 未选中'
          : '不满足能力要求',
      }));

    const trace: DecisionTrace = {
      id: traceId,
      timestamp: Date.now(),
      input: {
        taskType: requirement.taskType,
        complexity: requirement.complexity,
        domains: [],
        languagePreference: requirement.languagePreference,
      },
      layers,
      result: selection ? {
        modelId: selection.profile.id,
        provider: selection.profile.platform,
        reason: selection.reason,
        confidence: selection.tsSample ?? 0,
        source: 'thompson',
      } : {
        modelId: 'none',
        provider: 'none',
        reason: '无可用模型',
        confidence: 0,
        source: 'none',
      },
      filtered,
      totalMs,
    };

    this.record(trace);

    return selection;
  }

  // ==================== 查询 ====================

  /** 获取最近 N 条 trace */
  getRecent(n = 10): DecisionTrace[] {
    return this.traces.slice(-n);
  }

  /** 获取所有 trace */
  getAll(): DecisionTrace[] {
    return [...this.traces];
  }

  /** 获取 trace 总数 */
  count(): number {
    return this.traces.length;
  }

  /** 按模型 ID 查询被选中的 trace */
  getBySelectedModel(modelId: string): DecisionTrace[] {
    return this.traces.filter(t => t.result.modelId === modelId);
  }

  /** 按任务类型查询 */
  getByTaskType(taskType: string): DecisionTrace[] {
    return this.traces.filter(t => t.input.taskType === taskType);
  }

  /** 获取平均决策耗时 */
  getAverageLatencyMs(): number {
    if (this.traces.length === 0) return 0;
    const total = this.traces.reduce((s, t) => s + t.totalMs, 0);
    return total / this.traces.length;
  }

  /** 格式化最近的 trace 为可读文本 */
  formatRecent(n = 5): string {
    const recent = this.getRecent(n);
    if (recent.length === 0) return '无决策记录';

    return recent.map(t => {
      const layers = t.layers.map(l =>
        `  ${l.name}: ${l.inputCount} → ${l.outputCount}`
      ).join('\n');

      return [
        `[${new Date(t.timestamp).toLocaleTimeString()}] ${t.input.taskType}`,
        layers,
        `  选择: ${t.result.modelId} (${t.result.reason})`,
        `  耗时: ${t.totalMs.toFixed(2)}ms`,
      ].join('\n');
    }).join('\n\n');
  }

  // ==================== 辅助 ====================

  private isExcluded(id: string, pool: ModelPool): boolean {
    try {
      const prefs = pool.getPreferences();
      return prefs.excluded.some(pattern => {
        if (pattern === id) return true;
        if (pattern.endsWith('/*')) {
          return id.startsWith(pattern.slice(0, -2));
        }
        return false;
      });
    } catch {
      return false;
    }
  }
}
