/**
 * @deprecated Phase 2: 已废弃 — ModelRouter 直接使用 ModelPool.select()
 * 保留类定义仅为向后兼容旧配置
 *
 * ModelPoolScheduler — 三层调度智能核心（分诊台）
 *
 * Layer 1: 规则快筛（0ms）— 专家匹配 + 意图分类 + 静态规则
 * Layer 2: 经验路由（<10ms）— kNN 历史匹配 + Thompson Sampling
 * Layer 3: 级联兜底（按需）— 小模型先试，不行再升级
 *
 * 设计原则：
 * - 用相对排序，不用绝对评分（避免 routing collapse）
 * - 分维度统计，不汇总（避免预算越高越选贵模型）
 * - 不用 DNN/神经网络做路由决策（脆弱、不安全）
 */

import type { PoolNode } from '../types.js';
import { ModelPool } from './model-pool.js';
import { DecisionRecorder } from './decision-recorder.js';
import { ProviderLimiter } from './provider-limiter.js';
import type { TaskType } from './model-router.js';

// ==================== 调度结果 ====================

export interface ScheduleResult {
  node: PoolNode;
  layer: 1 | 2 | 3;
  reason: string;
  outputTokenLimit: number;
}

// ==================== 调度上下文 ====================

export interface ScheduleContext {
  input: string;
  taskType: TaskType;
  domain?: string | null;
  novelty?: number;
  complexity?: 'simple' | 'medium' | 'complex';
}

// ==================== Thompson Sampling ====================

/**
 * Thompson Sampling — Beta 分布采样
 * 用 Beta(successes + 1, failures + 1) 采样，自然平衡探索和利用
 */
function thompsonSample(nodeId: string, stats: { attempts: number; successes: number }): number {
  const alpha = stats.successes + 1;
  const beta = stats.attempts - stats.successes + 1;
  // 简化的 Beta 采样（用正态近似，避免引入 gamma 函数）
  return betaSampleApprox(alpha, beta);
}

/**
 * 多维反馈加权成功分（借鉴 CQB-MNL 隐式反馈）
 * 不再只看 success/fail 二元，加入延迟、成本、token 效率
 */
function weightedSuccessScore(record: import('../types.js').DecisionRecord): number {
  if (!record.success) return 0;
  let score = 1.0;
  // 延迟惩罚：超过 5s 扣分
  if (record.latencyMs > 5000) score *= 0.7;
  else if (record.latencyMs > 2000) score *= 0.85;
  // 成本惩罚：单次超 0.1 元扣分
  if (record.costEstimate > 0.1) score *= 0.8;
  else if (record.costEstimate > 0.05) score *= 0.9;
  // token 效率：输出/输入比 > 3 可能在废话
  const ratio = record.outputTokens / Math.max(1, record.inputTokens);
  if (ratio > 3) score *= 0.9;
  // 用户反馈
  if (record.userFeedback === 'bad') score *= 0.5;
  else if (record.userFeedback === 'good') score *= 1.1;
  return Math.min(1, Math.max(0, score));
}

/**
 * 从 DecisionRecord 列表计算加权 Thompson Sampling 参数
 */
function computeWeightedStats(records: import('../types.js').DecisionRecord[]): { attempts: number; successes: number } {
  if (records.length === 0) return { attempts: 0, successes: 0 };
  const totalWeight = records.length;
  const weightedSuccesses = records.reduce((sum, r) => sum + weightedSuccessScore(r), 0);
  return { attempts: totalWeight, successes: weightedSuccesses };
}

/**
 * Beta 分布的正态近似（适用于 alpha, beta > 1 的情况）
 */
function betaSampleApprox(alpha: number, beta: number): number {
  if (alpha <= 1 || beta <= 1) {
    // 小样本时用均匀随机，鼓励探索
    return Math.random();
  }
  const mean = alpha / (alpha + beta);
  const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
  const stdDev = Math.sqrt(variance);
  // Box-Muller 正态采样
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.min(1, mean + z * stdDev));
}

// ==================== ModelPoolScheduler ====================

export class ModelPoolScheduler {
  public limiter: ProviderLimiter;

  constructor(
    private pool: ModelPool,
    private decisionRecorder: DecisionRecorder,
    limiter?: ProviderLimiter,
  ) {
    this.limiter = limiter ?? new ProviderLimiter();
  }

  // ==================== 三层调度入口 ====================

  schedule(context: ScheduleContext): ScheduleResult {
    // Layer 1: 规则快筛
    const layer1Candidates = this.ruleFilter(context);

    // Layer 2: 经验路由
    const layer2Result = this.experienceRoute(layer1Candidates, context);

    // Layer 3: 决定输出长度约束
    const outputTokenLimit = this.decideOutputLimit(context);

    if (layer2Result) {
      return {
        node: layer2Result.node,
        layer: layer2Result.layer,
        reason: layer2Result.reason,
        outputTokenLimit,
      };
    }

    // 都没有匹配 → 用第一个可用节点（兜底）
    const fallback = layer1Candidates[0] ?? this.pool.getAvailableNodes()[0];
    if (!fallback) {
      throw new Error('[ModelPoolScheduler] 没有可用节点');
    }

    return {
      node: fallback,
      layer: 1,
      reason: 'no_match_fallback',
      outputTokenLimit,
    };
  }

  // ==================== Layer 1: 规则快筛 ====================

  private ruleFilter(context: ScheduleContext): PoolNode[] {
    const available = this.pool.getAvailableNodes();
    if (available.length === 0) return [];

    // 0. 按 provider/model 速率限制过滤
    const rateLimited = available.filter(n => {
      if (!n.provider || !n.model) return true; // 本地节点不过滤
      const check = this.limiter.check(n.provider, n.model);
      return check.allowed;
    });

    // 如果所有节点都被限流，降级到原始列表（让后续层处理）
    const candidates = rateLimited.length > 0 ? rateLimited : available;

    // 1. 专家优先 — 本地专家零成本、<50ms
    if (context.domain) {
      const experts = candidates.filter(
        n => n.type === 'local_expert' && n.domain === context.domain,
      );
      if (experts.length > 0) return experts;
    }

    // 2. 按任务类型过滤（排除 local_expert，它们只走 domain 匹配）
    return candidates.filter(n => {
      // local_expert 不参与非领域任务的调度
      if (n.type === 'local_expert') return false;

      switch (context.taskType) {
        case 'chat':
          // 闲聊 → budget 或 standard 节点
          return n.tier === 'budget' || n.tier === 'standard';
        case 'reasoning':
          // 复杂推理 → premium 或 standard
          return n.tier === 'premium' || n.tier === 'standard';
        case 'tools':
          // 工具调用 → 支持 tool calling 的节点
          return n.capabilities.toolCalling || n.tags.includes('tools') || n.tags.includes('code') || n.type === 'cloud';
        case 'background':
          // 后台任务 → 最低成本
          return n.tier === 'budget';
        case 'domain':
          // 领域任务 → 已在上面的专家匹配处理，这里放行所有
          return true;
        default:
          return true;
      }
    });
  }

  // ==================== Layer 2: 经验路由 ====================

  private experienceRoute(
    candidates: PoolNode[],
    context: ScheduleContext,
  ): { node: PoolNode; layer: 2; reason: string } | null {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) {
      return { node: candidates[0], layer: 2, reason: 'single_candidate' };
    }

    // kNN：找相似历史案例
    const similar = this.decisionRecorder.findSimilar(context.input, 10);

    if (similar.length > 0) {
      // 按节点聚合相似案例，用多维加权反馈（借鉴 CQB-MNL）
      const nodeRecords = new Map<string, import('../types.js').DecisionRecord[]>();

      for (const { record } of similar) {
        const nodeId = record.selectedNode;
        if (!candidates.some(c => c.id === nodeId)) continue;

        if (!nodeRecords.has(nodeId)) {
          nodeRecords.set(nodeId, []);
        }
        nodeRecords.get(nodeId)!.push(record);
      }

      if (nodeRecords.size > 0) {
        // Thompson Sampling 选最优（加权反馈，非二元 success/fail）
        let bestNode: PoolNode | null = null;
        let bestScore = -1;

        for (const [nodeId, records] of nodeRecords) {
          const stats = computeWeightedStats(records);
          const sample = thompsonSample(nodeId, stats);
          if (sample > bestScore) {
            bestScore = sample;
            bestNode = candidates.find(c => c.id === nodeId) ?? null;
          }
        }

        if (bestNode) {
          return {
            node: bestNode,
            layer: 2,
            reason: `knn_thompson_weighted_${similar.length}_similar`,
          };
        }
      }
    }

    // 没有相似历史 → 用分维度加权统计做 Thompson Sampling
    const taskType = context.taskType;
    let bestNode: PoolNode | null = null;
    let bestScore = -1;

    for (const candidate of candidates) {
      // 优先用 DecisionRecorder 的加权统计（借鉴 CQB-MNL 多维反馈）
      const histRecords = this.decisionRecorder.getByNodeAndTask(candidate.id, taskType);
      let stats: { attempts: number; successes: number };

      if (histRecords.length >= 3) {
        stats = computeWeightedStats(histRecords);
      } else {
        const histStats = this.decisionRecorder.getNodeStats(candidate.id, taskType);
        stats = histStats.attempts > 0
          ? { attempts: histStats.attempts, successes: histStats.successes }
          : { attempts: candidate.stats.totalCalls, successes: Math.round(candidate.stats.totalCalls * candidate.stats.successRate) };
      }

      const sample = thompsonSample(candidate.id, stats);
      if (sample > bestScore) {
        bestScore = sample;
        bestNode = candidate;
      }
    }

    if (bestNode) {
      return { node: bestNode, layer: 2, reason: 'thompson_sampling' };
    }

    return null;
  }

  // ==================== Layer 3: 级联支持 ====================

  /**
   * 获取级联升级节点（当质量不达标时调用）
   */
  getUpgradedNode(current: PoolNode): PoolNode | null {
    return this.pool.selectUpgraded(current);
  }

  // ==================== 输出长度决策（R2-Router 思路） ====================

  /**
   * 强模型 + 短输出 > 弱模型 + 长输出
   */
  private decideOutputLimit(context: ScheduleContext): number {
    switch (context.complexity) {
      case 'simple':
        return 512;
      case 'medium':
        return 2048;
      case 'complex':
        return 4096;
      default:
        return 2048;
    }
  }

  // ==================== 回调：记录决策结果 ====================

  recordResult(
    context: ScheduleContext,
    result: ScheduleResult,
    success: boolean,
    latencyMs: number,
    inputTokens: number = 0,
    outputTokens: number = 0,
    fallbackTriggered: boolean = false,
    fallbackFrom?: string,
  ): void {
    // 更新 pool 节点统计
    if (success) {
      this.pool.recordSuccess(result.node.id, latencyMs, context.taskType);
    } else {
      this.pool.recordFailure(result.node.id, latencyMs, context.taskType);
    }

    // 记录到 ProviderLimiter
    if (result.node.provider && result.node.model) {
      const totalTokens = inputTokens + outputTokens;
      this.limiter.record(result.node.provider, result.node.model, totalTokens);
      if (!success) {
        // 检查是否是限流错误
        this.limiter.recordLimitHit(result.node.provider, result.node.model);
      }
    }

    // 记录到 DecisionRecorder
    this.decisionRecorder.record({
      input: context.input.slice(0, 500),
      intent: context.taskType,
      domain: context.domain ?? null,
      novelty: context.novelty ?? 0,
      complexity: context.complexity ?? 'medium',
      selectedNode: result.node.id,
      selectionReason: result.reason,
      selectionLayer: result.layer,
      outputTokenLimit: result.outputTokenLimit,
      success,
      latencyMs,
      inputTokens,
      outputTokens,
      costEstimate: this.estimateCost(result.node, inputTokens, outputTokens),
      fallbackTriggered,
      fallbackFrom,
    });

    // 定期保存 pool 统计
    this.pool.saveStats();
  }

  // ==================== 成本估算 ====================

  private estimateCost(node: PoolNode, inputTokens: number, outputTokens: number): number {
    if (node.type !== 'cloud') return 0;
    return (inputTokens / 1000) * node.costPer1kInput + (outputTokens / 1000) * node.costPer1kOutput;
  }

  // ==================== 状态查询 ====================

  getPool(): ModelPool {
    return this.pool;
  }

  getSummary(): {
    pool: ReturnType<ModelPool['getSummary']>;
    recentDecisions: number;
  } {
    return {
      pool: this.pool.getSummary(),
      recentDecisions: this.decisionRecorder.count(),
    };
  }
}
