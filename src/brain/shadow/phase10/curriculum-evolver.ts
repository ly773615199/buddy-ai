/**
 * 学习策略进化 — 动态课程
 *
 * 来源: Intrinsic Metacognition (ICML 2025) — metacognitive planning
 *
 * 核心思想: 课程学习策略不再写死，影子脑可以实验不同的课程节奏，取最优。
 */

import type { TaskSignal } from '../../types.js';

// ── 类型定义 ──

export interface CurriculumStrategy {
  id: string;
  name: string;
  /** 热身步数 */
  warmupSteps: number;
  /** 简单样本比例 0-1 */
  easyRatio: number;
  /** 进度调度方式 */
  progressSchedule: 'linear' | 'exponential' | 'step' | 'adaptive';
  /** 最大难度阈值 0-1 */
  difficultyThreshold: number;
  /** 难度增长速率 */
  difficultyGrowth: number;
  // 效果统计
  convergenceSteps: number;
  finalLoss: number;
  forgettingRate: number;
  usageCount: number;
  successCount: number;
  createdAt: number;
  lastUsedAt: number;
}

export interface CurriculumEvaluation {
  strategyId: string;
  taskType: string;
  convergenceSteps: number;
  finalLoss: number;
  forgettingRate: number;
  sampleEfficiency: number;
  timestamp: number;
}

export interface CurriculumConfig {
  /** 最大策略数 */
  maxStrategies: number;
  /** 最少使用次数才信任 */
  minUsageForTrust: number;
  /** 收敛判定阈值 */
  convergenceThreshold: number;
  /** 收敛连续步数 */
  convergencePatience: number;
}

const DEFAULT_CONFIG: CurriculumConfig = {
  maxStrategies: 30,
  minUsageForTrust: 3,
  convergenceThreshold: 0.001,
  convergencePatience: 10,
};

// ── 预置课程策略 ──

const BUILTIN_CURRICULA: Omit<CurriculumStrategy, 'usageCount' | 'successCount' | 'createdAt' | 'lastUsedAt'>[] = [
  {
    id: 'standard',
    name: '标准课程',
    warmupSteps: 100,
    easyRatio: 0.7,
    progressSchedule: 'linear',
    difficultyThreshold: 0.8,
    difficultyGrowth: 0.01,
    convergenceSteps: 0,
    finalLoss: 0,
    forgettingRate: 0,
  },
  {
    id: 'aggressive',
    name: '激进课程',
    warmupSteps: 50,
    easyRatio: 0.5,
    progressSchedule: 'exponential',
    difficultyThreshold: 1.0,
    difficultyGrowth: 0.02,
    convergenceSteps: 0,
    finalLoss: 0,
    forgettingRate: 0,
  },
  {
    id: 'gentle',
    name: '温和课程',
    warmupSteps: 200,
    easyRatio: 0.8,
    progressSchedule: 'linear',
    difficultyThreshold: 0.6,
    difficultyGrowth: 0.005,
    convergenceSteps: 0,
    finalLoss: 0,
    forgettingRate: 0,
  },
  {
    id: 'adaptive',
    name: '自适应课程',
    warmupSteps: 80,
    easyRatio: 0.6,
    progressSchedule: 'adaptive',
    difficultyThreshold: 0.9,
    difficultyGrowth: 0.015,
    convergenceSteps: 0,
    finalLoss: 0,
    forgettingRate: 0,
  },
];

// ── CurriculumEvolver 核心 ──

export class CurriculumEvolver {
  private strategies: Map<string, CurriculumStrategy> = new Map();
  private evaluations: CurriculumEvaluation[] = [];
  private currentStrategyId: string = 'standard';
  private config: CurriculumConfig;

  constructor(config?: Partial<CurriculumConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadBuiltins();
  }

  /**
   * 获取当前课程策略
   */
  getCurrent(): CurriculumStrategy {
    return this.strategies.get(this.currentStrategyId)!;
  }

  /**
   * 获取当前策略的采样权重
   *
   * 基于当前步数和策略参数，返回每个难度级别的采样概率
   */
  getSamplingWeights(currentStep: number): {
    easyWeight: number;
    mediumWeight: number;
    hardWeight: number;
    currentDifficulty: number;
  } {
    const strategy = this.getCurrent();
    const progress = Math.max(0, (currentStep - strategy.warmupSteps) / 1000);

    // 计算当前难度
    let currentDifficulty: number;
    switch (strategy.progressSchedule) {
      case 'linear':
        currentDifficulty = Math.min(strategy.difficultyThreshold, progress * strategy.difficultyGrowth * 100);
        break;
      case 'exponential':
        currentDifficulty = Math.min(strategy.difficultyThreshold, 1 - Math.exp(-progress * 2));
        break;
      case 'step':
        currentDifficulty = progress > 0.5 ? strategy.difficultyThreshold : strategy.difficultyGrowth * 50;
        break;
      case 'adaptive':
        // 基于最近 loss 变化动态调整
        const recentLoss = this.getRecentLoss();
        currentDifficulty = recentLoss < strategy.difficultyThreshold
          ? Math.min(strategy.difficultyThreshold, strategy.difficultyGrowth * 100 * (1 - recentLoss))
          : strategy.difficultyGrowth * 50;
        break;
    }

    // 热身阶段：全部简单样本
    if (currentStep < strategy.warmupSteps) {
      return { easyWeight: 1, mediumWeight: 0, hardWeight: 0, currentDifficulty: 0 };
    }

    // 正常阶段：按策略分配
    const easy = strategy.easyRatio * (1 - currentDifficulty);
    const medium = (1 - strategy.easyRatio) * (1 - currentDifficulty);
    const hard = currentDifficulty;
    const total = easy + medium + hard;

    return {
      easyWeight: easy / total,
      mediumWeight: medium / total,
      hardWeight: hard / total,
      currentDifficulty,
    };
  }

  /**
   * 记录评估结果
   */
  evaluate(result: CurriculumEvaluation): void {
    this.evaluations.push(result);

    const strategy = this.strategies.get(result.strategyId);
    if (strategy) {
      strategy.usageCount++;
      strategy.lastUsedAt = result.timestamp;

      // 滑动平均更新
      const recent = this.evaluations
        .filter(e => e.strategyId === result.strategyId)
        .slice(-10);
      strategy.convergenceSteps = recent.reduce((s, e) => s + e.convergenceSteps, 0) / recent.length;
      strategy.finalLoss = recent.reduce((s, e) => s + e.finalLoss, 0) / recent.length;
      strategy.forgettingRate = recent.reduce((s, e) => s + e.forgettingRate, 0) / recent.length;

      if (result.finalLoss < this.config.convergenceThreshold * 10) {
        strategy.successCount++;
      }
    }
  }

  /**
   * 生成新课程策略变体
   *
   * 基于当前策略的瓶颈生成改进版本
   */
  generateVariant(
    taskType: string,
    performance: { avgLoss: number; convergenceSteps: number; forgettingRate: number },
  ): CurriculumStrategy {
    const current = this.getCurrent();

    let warmupSteps = current.warmupSteps;
    let easyRatio = current.easyRatio;
    let progressSchedule = current.progressSchedule;
    let difficultyGrowth = current.difficultyGrowth;

    // 收敛慢 → 增加热身步数，降低增长速率
    if (performance.convergenceSteps > 200) {
      warmupSteps = Math.min(500, warmupSteps * 1.5);
      difficultyGrowth = Math.max(0.001, difficultyGrowth * 0.7);
    }

    // 遗忘严重 → 提高简单样本比例，降低难度阈值
    if (performance.forgettingRate > 0.1) {
      easyRatio = Math.min(0.9, easyRatio + 0.1);
      difficultyGrowth = Math.max(0.001, difficultyGrowth * 0.8);
    }

    // loss 高 → 切换为指数调度
    if (performance.avgLoss > 0.5) {
      progressSchedule = 'exponential';
    }

    // loss 震荡 → 切换为步进调度
    if (performance.avgLoss > 0.3 && performance.convergenceSteps < 100) {
      progressSchedule = 'step';
    }

    const variant: CurriculumStrategy = {
      id: `gen-${taskType}-${Date.now()}`,
      name: `自动生成: ${taskType}`,
      warmupSteps,
      easyRatio,
      progressSchedule,
      difficultyThreshold: current.difficultyThreshold,
      difficultyGrowth,
      convergenceSteps: 0,
      finalLoss: 0,
      forgettingRate: 0,
      usageCount: 0,
      successCount: 0,
      createdAt: Date.now(),
      lastUsedAt: 0,
    };

    this.addStrategy(variant);
    return variant;
  }

  /**
   * 推荐切换策略
   */
  recommendSwitch(
    recentLosses: number[],
  ): { shouldSwitch: boolean; recommended?: CurriculumStrategy; reason: string } {
    if (recentLosses.length < 20) {
      return { shouldSwitch: false, reason: '数据不足' };
    }

    const current = this.getCurrent();
    const isConverged = this.checkConvergence(recentLosses);
    if (isConverged) {
      return { shouldSwitch: false, reason: '已收敛' };
    }

    const isOscillating = this.checkOscillation(recentLosses);
    if (isOscillating) {
      // 找非当前类型的策略
      const alternatives = [...this.strategies.values()]
        .filter(s => s.id !== current.id && s.progressSchedule !== 'adaptive');
      if (alternatives.length > 0) {
        const best = alternatives.sort((a, b) =>
          (b.successCount / Math.max(1, b.usageCount)) - (a.successCount / Math.max(1, a.usageCount))
        )[0];
        return { shouldSwitch: true, recommended: best, reason: `loss 震荡，建议切换到 ${best.name}` };
      }
    }

    return { shouldSwitch: false, reason: '当前策略正常' };
  }

  /**
   * 切换策略
   */
  switchTo(strategyId: string): boolean {
    if (this.strategies.has(strategyId)) {
      this.currentStrategyId = strategyId;
      return true;
    }
    return false;
  }

  addStrategy(strategy: CurriculumStrategy): void {
    if (this.strategies.size >= this.config.maxStrategies) {
      // LRU 淘汰
      const oldest = [...this.strategies.values()]
        .filter(s => s.id !== 'standard')
        .sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
      if (oldest) this.strategies.delete(oldest.id);
    }
    this.strategies.set(strategy.id, strategy);
  }

  getAllStrategies(): CurriculumStrategy[] {
    return [...this.strategies.values()];
  }

  getSummary(): {
    totalStrategies: number;
    currentStrategy: string;
    bySchedule: Record<string, number>;
    bestStrategies: Array<{ strategy: CurriculumStrategy; score: number }>;
  } {
    const all = [...this.strategies.values()];
    const bySchedule: Record<string, number> = {};
    for (const s of all) {
      bySchedule[s.progressSchedule] = (bySchedule[s.progressSchedule] ?? 0) + 1;
    }

    const scored = all
      .filter(s => s.usageCount >= this.config.minUsageForTrust)
      .map(s => ({
        strategy: s,
        score: (s.successCount / Math.max(1, s.usageCount)) * 0.5
          + (1 - Math.min(1, s.convergenceSteps / 300)) * 0.3
          + (1 - Math.min(1, s.finalLoss)) * 0.2,
      }))
      .sort((a, b) => b.score - a.score);

    return {
      totalStrategies: all.length,
      currentStrategy: this.currentStrategyId,
      bySchedule,
      bestStrategies: scored.slice(0, 5),
    };
  }

  // ── 内部方法 ──

  private loadBuiltins(): void {
    for (const template of BUILTIN_CURRICULA) {
      this.strategies.set(template.id, {
        ...template,
        usageCount: 0,
        successCount: 0,
        createdAt: Date.now(),
        lastUsedAt: 0,
      });
    }
  }

  private getRecentLoss(): number {
    if (this.evaluations.length === 0) return 0.5;
    return this.evaluations[this.evaluations.length - 1].finalLoss;
  }

  private checkConvergence(losses: number[]): boolean {
    if (losses.length < this.config.convergencePatience) return false;
    const recent = losses.slice(-this.config.convergencePatience);
    return recent.every(l => l < this.config.convergenceThreshold);
  }

  private checkOscillation(losses: number[]): boolean {
    if (losses.length < 6) return false;
    const recent = losses.slice(-6);
    let signChanges = 0;
    for (let i = 2; i < recent.length; i++) {
      const diff1 = recent[i - 1] - recent[i - 2];
      const diff2 = recent[i] - recent[i - 1];
      if (diff1 * diff2 < 0) signChanges++;
    }
    return signChanges >= 4;
  }
}
