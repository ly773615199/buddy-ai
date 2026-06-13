/**
 * 元认知自适应 — 学会如何学习
 *
 * 来源: ICML 2025 "Truly Self-Improving Agents Require Intrinsic Metacognition"
 *
 * 核心思想: 评估"哪种学习方式对哪种任务最有效"，自动生成学习策略调度器。
 * 系统不再用固定的学习框架优化，而是能切换到更高效的学习方式。
 */

import type { TaskSignal } from '../../types.js';

// ── 类型定义 ──

export type SamplingMethod = 'random' | 'curriculum' | 'contextual' | 're-attentive';
export type LRschedule = 'constant' | 'exponential' | 'cosine' | 'adaptive';

export interface LearningStrategy {
  id: string;
  name: string;
  samplingMethod: SamplingMethod;
  lrSchedule: LRschedule;
  batchSize: number;
  avgConvergenceSteps: number;
  avgFinalLoss: number;
  taskTypes: string[];
  usageCount: number;
  successCount: number;
  createdAt: number;
  lastUsedAt: number;
}

export interface StrategyEvaluation {
  strategyId: string;
  taskType: string;
  convergenceSteps: number;
  finalLoss: number;
  forgettingRate: number;
  sampleEfficiency: number;
  timestamp: number;
}

export interface MetaLearnerConfig {
  /** 最大策略缓存数 */
  maxStrategies: number;
  /** 最少使用次数才信任策略效果 */
  minUsageForTrust: number;
  /** 策略评估窗口（最近 N 次） */
  evaluationWindow: number;
  /** 收敛判定：连续 N 步 loss 下降 < threshold */
  convergenceThreshold: number;
  convergenceSteps: number;
}

const DEFAULT_CONFIG: MetaLearnerConfig = {
  maxStrategies: 50,
  minUsageForTrust: 5,
  evaluationWindow: 20,
  convergenceThreshold: 0.001,
  convergenceSteps: 10,
};

// ── 预置策略模板 ──

const BUILTIN_STRATEGIES: Omit<LearningStrategy, 'usageCount' | 'successCount' | 'createdAt' | 'lastUsedAt'>[] = [
  {
    id: 'default-curriculum',
    name: '默认课程学习',
    samplingMethod: 'curriculum',
    lrSchedule: 'cosine',
    batchSize: 8,
    avgConvergenceSteps: 0,
    avgFinalLoss: 0,
    taskTypes: ['*'],
  },
  {
    id: 'fast-random',
    name: '快速随机采样',
    samplingMethod: 'random',
    lrSchedule: 'exponential',
    batchSize: 16,
    avgConvergenceSteps: 0,
    avgFinalLoss: 0,
    taskTypes: ['simple', 'routine'],
  },
  {
    id: 'context-sensitive',
    name: '上下文感知学习',
    samplingMethod: 'contextual',
    lrSchedule: 'adaptive',
    batchSize: 8,
    avgConvergenceSteps: 0,
    avgFinalLoss: 0,
    taskTypes: ['complex', 'ambiguous'],
  },
  {
    id: 're-attentive-deep',
    name: '再注意力深度学习',
    samplingMethod: 're-attentive',
    lrSchedule: 'cosine',
    batchSize: 4,
    avgConvergenceSteps: 0,
    avgFinalLoss: 0,
    taskTypes: ['novel', 'rare'],
  },
];

// ── MetaLearner 核心 ──

export class MetaLearner {
  private strategies: Map<string, LearningStrategy> = new Map();
  private evaluations: StrategyEvaluation[] = [];
  private taskTypeIndex: Map<string, string[]> = new Map(); // taskType → strategyId[]
  private config: MetaLearnerConfig;

  constructor(config?: Partial<MetaLearnerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadBuiltinStrategies();
  }

  // ── 策略选择 ──

  /**
   * 为给定任务类型选择最优学习策略
   *
   * 优先级:
   * 1. 历史最优（同 taskType 收敛最快的策略）
   * 2. 近似匹配（通配符 * 匹配）
   * 3. 默认策略
   */
  selectBest(taskType: string): LearningStrategy {
    // 精确匹配
    const exactCandidates = this.getCandidatesForTaskType(taskType);
    if (exactCandidates.length > 0) {
      return this.rankStrategies(exactCandidates)[0];
    }

    // 通配符匹配
    const wildcardCandidates = this.getCandidatesForTaskType('*');
    if (wildcardCandidates.length > 0) {
      return this.rankStrategies(wildcardCandidates)[0];
    }

    // 兜底：默认策略
    return this.strategies.get('default-curriculum')!;
  }

  /**
   * 根据当前学习表现，动态推荐策略切换
   */
  recommendSwitch(
    currentStrategyId: string,
    recentLosses: number[],
    taskType: string,
  ): { shouldSwitch: boolean; recommendedStrategy?: LearningStrategy; reason: string } {
    if (recentLosses.length < this.config.convergenceSteps) {
      return { shouldSwitch: false, reason: '数据不足，继续观察' };
    }

    // 检查是否收敛
    const isConverged = this.checkConvergence(recentLosses);
    if (isConverged) {
      return { shouldSwitch: false, reason: '已收敛，无需切换' };
    }

    // 检查 loss 是否在震荡
    const isOscillating = this.checkOscillation(recentLosses);
    if (isOscillating) {
      const candidates = this.getCandidatesForTaskType(taskType)
        .filter(s => s.id !== currentStrategyId && s.samplingMethod !== 'random');
      if (candidates.length > 0) {
        const best = this.rankStrategies(candidates)[0];
        return {
          shouldSwitch: true,
          recommendedStrategy: best,
          reason: `loss 震荡，建议切换到 ${best.name}（${best.samplingMethod}）`,
        };
      }
    }

    // 检查收敛速度是否太慢
    const convergenceSpeed = this.estimateConvergenceSpeed(recentLosses);
    if (convergenceSpeed < 0.1) {
      const candidates = this.getCandidatesForTaskType(taskType)
        .filter(s => s.id !== currentStrategyId && s.lrSchedule === 'adaptive');
      if (candidates.length > 0) {
        const best = this.rankStrategies(candidates)[0];
        return {
          shouldSwitch: true,
          recommendedStrategy: best,
          reason: `收敛过慢(速度=${convergenceSpeed.toFixed(3)})，建议切换到 ${best.name}`,
        };
      }
    }

    return { shouldSwitch: false, reason: '当前策略表现正常' };
  }

  // ── 策略评估 ──

  /**
   * 记录一次策略评估结果
   */
  evaluate(result: StrategyEvaluation): void {
    this.evaluations.push(result);

    // 限制历史长度
    if (this.evaluations.length > this.config.maxStrategies * this.config.evaluationWindow) {
      this.evaluations = this.evaluations.slice(-this.config.maxStrategies * this.config.evaluationWindow);
    }

    // 更新策略统计
    const strategy = this.strategies.get(result.strategyId);
    if (strategy) {
      strategy.usageCount++;
      strategy.lastUsedAt = result.timestamp;

      // 滑动平均更新
      const recentEvals = this.getRecentEvaluations(result.strategyId);
      if (recentEvals.length > 0) {
        strategy.avgConvergenceSteps = recentEvals.reduce((s, e) => s + e.convergenceSteps, 0) / recentEvals.length;
        strategy.avgFinalLoss = recentEvals.reduce((s, e) => s + e.finalLoss, 0) / recentEvals.length;
      }

      if (result.finalLoss < this.config.convergenceThreshold * 10) {
        strategy.successCount++;
      }
    }
  }

  // ── 策略生成 ──

  /**
   * 基于当前瓶颈生成新策略候选
   *
   * 分析已有策略的效果分布，找出可改进方向，生成新策略变体
   */
  generateStrategy(
    taskType: string,
    currentPerformance: { avgLoss: number; convergenceSteps: number; forgettingRate: number },
  ): LearningStrategy {
    const existing = this.getCandidatesForTaskType(taskType);

    // 分析瓶颈
    const slowConvergence = currentPerformance.convergenceSteps > 100;
    const highForgetting = currentPerformance.forgettingRate > 0.1;
    const highLoss = currentPerformance.avgLoss > 0.5;

    // 基于瓶颈选择策略参数
    let samplingMethod: SamplingMethod = 'curriculum';
    let lrSchedule: LRschedule = 'cosine';
    let batchSize = 8;

    if (slowConvergence && highForgetting) {
      // 收敛慢+遗忘严重 → 再注意力 + 自适应学习率 + 小 batch
      samplingMethod = 're-attentive';
      lrSchedule = 'adaptive';
      batchSize = 4;
    } else if (slowConvergence) {
      // 收敛慢 → 上下文感知 + 自适应
      samplingMethod = 'contextual';
      lrSchedule = 'adaptive';
      batchSize = 8;
    } else if (highForgetting) {
      // 遗忘严重 → 课程学习 + 余弦 + 小 batch
      samplingMethod = 'curriculum';
      lrSchedule = 'cosine';
      batchSize = 4;
    } else if (highLoss) {
      // loss 高 → 随机采样 + 指数衰减 + 大 batch
      samplingMethod = 'random';
      lrSchedule = 'exponential';
      batchSize = 16;
    }

    // 避免与已有策略重复
    const isDuplicate = existing.some(s =>
      s.samplingMethod === samplingMethod && s.lrSchedule === lrSchedule && s.batchSize === batchSize
    );
    if (isDuplicate) {
      // 微调参数避免重复
      batchSize = Math.max(2, batchSize + (Math.random() > 0.5 ? 2 : -2));
    }

    const strategy: LearningStrategy = {
      id: `gen-${taskType}-${Date.now()}`,
      name: `自动生成: ${taskType} (${samplingMethod}/${lrSchedule})`,
      samplingMethod,
      lrSchedule,
      batchSize,
      avgConvergenceSteps: 0,
      avgFinalLoss: 0,
      taskTypes: [taskType],
      usageCount: 0,
      successCount: 0,
      createdAt: Date.now(),
      lastUsedAt: 0,
    };

    this.addStrategy(strategy);
    return strategy;
  }

  // ── 策略管理 ──

  addStrategy(strategy: LearningStrategy): void {
    // LRU 淘汰
    if (this.strategies.size >= this.config.maxStrategies) {
      const oldest = [...this.strategies.values()]
        .filter(s => s.id !== 'default-curriculum')
        .sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
      if (oldest) {
        this.strategies.delete(oldest.id);
        this.removeFromIndex(oldest);
      }
    }

    this.strategies.set(strategy.id, strategy);
    for (const taskType of strategy.taskTypes) {
      const list = this.taskTypeIndex.get(taskType) ?? [];
      if (!list.includes(strategy.id)) list.push(strategy.id);
      this.taskTypeIndex.set(taskType, list);
    }
  }

  getStrategy(id: string): LearningStrategy | undefined {
    return this.strategies.get(id);
  }

  getAllStrategies(): LearningStrategy[] {
    return [...this.strategies.values()];
  }

  /**
   * 获取策略效果摘要
   */
  getSummary(): {
    totalStrategies: number;
    bySamplingMethod: Record<SamplingMethod, number>;
    byLRschedule: Record<LRschedule, number>;
    bestStrategies: Array<{ strategy: LearningStrategy; score: number }>;
    topTaskTypes: Array<{ taskType: string; strategyCount: number }>;
  } {
    const all = [...this.strategies.values()];

    const bySamplingMethod: Record<SamplingMethod, number> = {
      random: 0, curriculum: 0, contextual: 0, 're-attentive': 0,
    };
    const byLRschedule: Record<LRschedule, number> = {
      constant: 0, exponential: 0, cosine: 0, adaptive: 0,
    };

    for (const s of all) {
      bySamplingMethod[s.samplingMethod]++;
      byLRschedule[s.lrSchedule]++;
    }

    // 按成功率排名
    const scored = all
      .filter(s => s.usageCount >= this.config.minUsageForTrust)
      .map(s => ({
        strategy: s,
        score: (s.successCount / Math.max(1, s.usageCount)) * 0.6
          + (1 - Math.min(1, s.avgConvergenceSteps / 200)) * 0.3
          + (1 - Math.min(1, s.avgFinalLoss)) * 0.1,
      }))
      .sort((a, b) => b.score - a.score);

    // taskType 统计
    const topTaskTypes = [...this.taskTypeIndex.entries()]
      .map(([taskType, ids]) => ({ taskType, strategyCount: ids.length }))
      .sort((a, b) => b.strategyCount - a.strategyCount)
      .slice(0, 10);

    return {
      totalStrategies: all.length,
      bySamplingMethod,
      byLRschedule,
      bestStrategies: scored.slice(0, 5),
      topTaskTypes,
    };
  }

  // ── 内部方法 ──

  private loadBuiltinStrategies(): void {
    for (const template of BUILTIN_STRATEGIES) {
      this.addStrategy({
        ...template,
        usageCount: 0,
        successCount: 0,
        createdAt: Date.now(),
        lastUsedAt: 0,
      });
    }
  }

  private getCandidatesForTaskType(taskType: string): LearningStrategy[] {
    const ids = this.taskTypeIndex.get(taskType) ?? [];
    return ids.map(id => this.strategies.get(id)).filter((s): s is LearningStrategy => !!s);
  }

  /**
   * 按综合得分排名策略
   *
   * 得分 = 成功率 × 0.5 + 收敛速度 × 0.3 + 最终loss × 0.2
   */
  private rankStrategies(strategies: LearningStrategy[]): LearningStrategy[] {
    return strategies
      .filter(s => s.usageCount >= this.config.minUsageForTrust)
      .sort((a, b) => {
        const scoreA = this.calcScore(a);
        const scoreB = this.calcScore(b);
        return scoreB - scoreA;
      })
      .length > 0
      ? strategies.filter(s => s.usageCount >= this.config.minUsageForTrust)
        .sort((a, b) => this.calcScore(b) - this.calcScore(a))
      : strategies.sort((a, b) => b.usageCount - a.usageCount); // 无足够数据时按使用频率
  }

  private calcScore(s: LearningStrategy): number {
    const successRate = s.usageCount > 0 ? s.successCount / s.usageCount : 0;
    const convergenceSpeed = s.avgConvergenceSteps > 0 ? Math.min(1, 100 / s.avgConvergenceSteps) : 0.5;
    const lossScore = s.avgFinalLoss > 0 ? Math.max(0, 1 - s.avgFinalLoss) : 0.5;
    return successRate * 0.5 + convergenceSpeed * 0.3 + lossScore * 0.2;
  }

  private getRecentEvaluations(strategyId: string): StrategyEvaluation[] {
    return this.evaluations
      .filter(e => e.strategyId === strategyId)
      .slice(-this.config.evaluationWindow);
  }

  private checkConvergence(losses: number[]): boolean {
    if (losses.length < this.config.convergenceSteps) return false;
    const recent = losses.slice(-this.config.convergenceSteps);
    const diffs = recent.slice(1).map((v, i) => v - recent[i]);
    return diffs.every(d => d <= this.config.convergenceThreshold);
  }

  private checkOscillation(losses: number[]): boolean {
    if (losses.length < 6) return false;
    const recent = losses.slice(-6);
    let signChanges = 0;
    for (let i = 1; i < recent.length; i++) {
      if ((recent[i] - recent[i - 1]) * (recent[i - 1] - (recent[i - 2] ?? recent[i - 1])) < 0) {
        signChanges++;
      }
    }
    return signChanges >= 4;
  }

  private estimateConvergenceSpeed(losses: number[]): number {
    if (losses.length < 2) return 0;
    const first = losses[0];
    const last = losses[losses.length - 1];
    if (first === 0) return 1;
    return Math.max(0, (first - last) / first / losses.length);
  }

  private removeFromIndex(strategy: LearningStrategy): void {
    for (const taskType of strategy.taskTypes) {
      const list = this.taskTypeIndex.get(taskType);
      if (list) {
        const idx = list.indexOf(strategy.id);
        if (idx >= 0) list.splice(idx, 1);
      }
    }
  }
}
