/**
 * 三进制模型成长系统
 *
 * 管理模型从 seed → sprout → growing → trainable → mature 的生命周期。
 *
 * 每个阶段有不同的训练策略：
 * - seed:     初始状态，无训练，等待蒸馏注入
 * - sprout:   蒸馏完成，开始少量增量训练
 * - growing:  活跃训练期，夜间自动训练
 * - trainable: 知识积累充分，可进行深度微调
 * - mature:   稳定期，仅微调，核心冻结
 */

import type { TernaryModel, TernaryModelMeta, GrowthStage } from './format.js';
import type { TrainResult } from './trainer.js';

// ── 成长阈值 ──

export interface GrowthThresholds {
  /** seed → sprout: 最少训练步数 */
  seedToSprout: number;
  /** sprout → growing: 最少训练步数 + 知识样本数 */
  sproutToGrowing: { steps: number; samples: number };
  /** growing → trainable: 知识覆盖度 */
  growingToTrainable: { steps: number; coverage: number };
  /** trainable → mature: 稳定性指标 */
  trainableToMature: { steps: number; stableEpochs: number };
}

const DEFAULT_THRESHOLDS: GrowthThresholds = {
  seedToSprout: 10,
  sproutToGrowing: { steps: 100, samples: 50 },
  growingToTrainable: { steps: 1000, coverage: 0.6 },
  trainableToMature: { steps: 5000, stableEpochs: 10 },
};

// ── 阶段特性 ──

export interface StageCharacteristics {
  /** 阶段名 */
  stage: GrowthStage;
  /** 显示标签 */
  label: string;
  /** 描述 */
  description: string;
  /** emoji */
  emoji: string;
  /** 允许的训练类型 */
  allowedTraining: ('distill' | 'incremental' | 'finetune')[];
  /** 最大训练步数/轮 (防止过度训练) */
  maxStepsPerSession: number;
  /** 学习率乘数 */
  lrMultiplier: number;
  /** 是否允许冻结层 */
  freezeAllowed: boolean;
}

export const STAGE_CHARACTERISTICS: Record<GrowthStage, StageCharacteristics> = {
  seed: {
    stage: 'seed',
    label: '种子',
    description: '初始状态，等待蒸馏注入知识',
    emoji: '🌱',
    allowedTraining: ['distill'],
    maxStepsPerSession: 50,
    lrMultiplier: 1.0,
    freezeAllowed: false,
  },
  sprout: {
    stage: 'sprout',
    label: '萌芽',
    description: '已注入基础知识，开始少量增量训练',
    emoji: '🌿',
    allowedTraining: ['distill', 'incremental'],
    maxStepsPerSession: 200,
    lrMultiplier: 0.8,
    freezeAllowed: false,
  },
  growing: {
    stage: 'growing',
    label: '成长中',
    description: '活跃训练期，夜间自动增量训练',
    emoji: '🌳',
    allowedTraining: ['incremental'],
    maxStepsPerSession: 500,
    lrMultiplier: 0.5,
    freezeAllowed: true,
  },
  trainable: {
    stage: 'trainable',
    label: '可训练',
    description: '知识积累充分，可深度微调',
    emoji: '🔬',
    allowedTraining: ['incremental', 'finetune'],
    maxStepsPerSession: 1000,
    lrMultiplier: 0.3,
    freezeAllowed: true,
  },
  mature: {
    stage: 'mature',
    label: '成熟',
    description: '稳定期，仅微调，核心冻结',
    emoji: '🏆',
    allowedTraining: ['finetune'],
    maxStepsPerSession: 200,
    lrMultiplier: 0.1,
    freezeAllowed: true,
  },
};

// ── 成长报告 ──

export interface GrowthReport {
  /** 当前阶段 */
  currentStage: GrowthStage;
  /** 当前阶段特性 */
  characteristics: StageCharacteristics;
  /** 距离下一阶段还需什么 */
  nextStageRequirements: string[];
  /** 进度百分比 (0-100) */
  progressPercent: number;
  /** 模型统计 */
  stats: {
    trainSteps: number;
    lastUpdated: number;
    totalParams: number;
  };
  /** 建议操作 */
  recommendations: string[];
}

// ════════════════════════════════════════════════════════
// 成长系统
// ════════════════════════════════════════════════════════

export class TernaryGrowth {
  private thresholds: GrowthThresholds;
  private lossHistory: Map<string, number[]> = new Map();

  constructor(thresholds?: Partial<GrowthThresholds>) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  /**
   * 检查并更新成长阶段
   *
   * @param model 模型（会被修改 meta.growthStage）
   * @param sampleCount 累计知识样本数
   * @param coverage 知识覆盖度 (0-1)
   * @returns 是否发生了阶段变化
   */
  evaluateGrowth(
    model: TernaryModel,
    sampleCount: number,
    coverage: number,
  ): { changed: boolean; oldStage: GrowthStage; newStage: GrowthStage } {
    const oldStage = model.meta.growthStage;
    const newStage = this.determineStage(model.meta, sampleCount, coverage);

    if (newStage !== oldStage) {
      model.meta.growthStage = newStage;
      return { changed: true, oldStage, newStage };
    }

    return { changed: false, oldStage, newStage };
  }

  /**
   * 判断应处于哪个阶段
   */
  determineStage(meta: TernaryModelMeta, sampleCount: number, coverage: number): GrowthStage {
    const steps = meta.trainSteps;
    const t = this.thresholds;

    if (steps >= t.trainableToMature.steps) return 'mature';
    if (steps >= t.growingToTrainable.steps && coverage >= t.growingToTrainable.coverage) return 'trainable';
    if (steps >= t.sproutToGrowing.steps && sampleCount >= t.sproutToGrowing.samples) return 'growing';
    if (steps >= t.seedToSprout) return 'sprout';
    return 'seed';
  }

  /**
   * 获取成长报告
   */
  getReport(model: TernaryModel, sampleCount: number, coverage: number): GrowthReport {
    const stage = model.meta.growthStage;
    const chars = STAGE_CHARACTERISTICS[stage];

    return {
      currentStage: stage,
      characteristics: chars,
      nextStageRequirements: this.getNextRequirements(model.meta, sampleCount, coverage),
      progressPercent: this.computeProgress(model.meta, sampleCount, coverage),
      stats: {
        trainSteps: model.meta.trainSteps,
        lastUpdated: model.meta.lastUpdated,
        totalParams: model.meta.totalParams,
      },
      recommendations: this.getRecommendations(model.meta, sampleCount, coverage),
    };
  }

  /**
   * 记录训练 loss（用于稳定性判断）
   */
  recordLoss(domain: string, loss: number): void {
    if (!this.lossHistory.has(domain)) {
      this.lossHistory.set(domain, []);
    }
    const history = this.lossHistory.get(domain)!;
    history.push(loss);
    // 保留最近 100 个
    if (history.length > 100) history.shift();
  }

  /**
   * 检查模型是否稳定（loss 波动小）
   */
  isStable(domain: string, windowSize = 10): boolean {
    const history = this.lossHistory.get(domain);
    if (!history || history.length < windowSize) return false;

    const recent = history.slice(-windowSize);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((sum, v) => sum + (v - mean) ** 2, 0) / recent.length;
    const cv = Math.sqrt(variance) / (mean + 1e-8); // 变异系数

    return cv < 0.1; // 变异系数 < 10% 认为稳定
  }

  /**
   * 获取阶段允许的训练类型
   */
  getAllowedTraining(stage: GrowthStage): string[] {
    return STAGE_CHARACTERISTICS[stage].allowedTraining;
  }

  /**
   * 获取推荐学习率
   */
  getAdjustedLR(baseLR: number, stage: GrowthStage): number {
    return baseLR * STAGE_CHARACTERISTICS[stage].lrMultiplier;
  }

  // ── 内部方法 ──

  private getNextRequirements(meta: TernaryModelMeta, sampleCount: number, coverage: number): string[] {
    const reqs: string[] = [];
    const steps = meta.trainSteps;
    const t = this.thresholds;

    switch (meta.growthStage) {
      case 'seed':
        reqs.push(`训练步数: ${steps}/${t.seedToSprout}`);
        break;
      case 'sprout':
        reqs.push(`训练步数: ${steps}/${t.sproutToGrowing.steps}`);
        reqs.push(`知识样本: ${sampleCount}/${t.sproutToGrowing.samples}`);
        break;
      case 'growing':
        reqs.push(`训练步数: ${steps}/${t.growingToTrainable.steps}`);
        reqs.push(`知识覆盖度: ${(coverage * 100).toFixed(1)}%/${(t.growingToTrainable.coverage * 100).toFixed(0)}%`);
        break;
      case 'trainable':
        reqs.push(`训练步数: ${steps}/${t.trainableToMature.steps}`);
        reqs.push(`需要连续 ${t.trainableToMature.stableEpochs} 轮稳定`);
        break;
      case 'mature':
        reqs.push('已达到成熟阶段 🏆');
        break;
    }

    return reqs;
  }

  private computeProgress(meta: TernaryModelMeta, sampleCount: number, coverage: number): number {
    const stages: GrowthStage[] = ['seed', 'sprout', 'growing', 'trainable', 'mature'];
    const stageIdx = stages.indexOf(meta.growthStage);
    const baseProgress = (stageIdx / (stages.length - 1)) * 100;

    // 同一阶段内的细分进度
    const steps = meta.trainSteps;
    const t = this.thresholds;

    let intraProgress = 0;
    switch (meta.growthStage) {
      case 'seed':
        intraProgress = Math.min(steps / t.seedToSprout, 1) * (100 / 4);
        break;
      case 'sprout':
        intraProgress = Math.min(
          (steps / t.sproutToGrowing.steps + sampleCount / t.sproutToGrowing.samples) / 2,
          1,
        ) * (100 / 4);
        break;
      case 'growing':
        intraProgress = Math.min(
          (steps / t.growingToTrainable.steps + coverage / t.growingToTrainable.coverage) / 2,
          1,
        ) * (100 / 4);
        break;
      case 'trainable':
        intraProgress = Math.min(steps / t.trainableToMature.steps, 1) * (100 / 4);
        break;
      case 'mature':
        intraProgress = 100 / 4;
        break;
    }

    return Math.min(Math.round(baseProgress + intraProgress), 100);
  }

  private getRecommendations(meta: TernaryModelMeta, sampleCount: number, coverage: number): string[] {
    const recs: string[] = [];

    switch (meta.growthStage) {
      case 'seed':
        recs.push('等待蒸馏流程注入初始知识');
        recs.push('准备领域训练数据');
        break;
      case 'sprout':
        recs.push('开始增量训练，积累知识样本');
        recs.push('关注 loss 趋势，确保训练有效');
        break;
      case 'growing':
        recs.push('启用夜间自动训练');
        recs.push('持续采集专业知识，提升覆盖度');
        break;
      case 'trainable':
        recs.push('可进行深度微调，优化特定任务');
        recs.push('考虑冻结底层，只训练上层');
        break;
      case 'mature':
        recs.push('核心权重冻结，仅微调输出层');
        recs.push('关注推理速度和准确率');
        break;
    }

    if (sampleCount < 100) {
      recs.push('⚠️ 知识样本较少，建议加强知识采集');
    }

    return recs;
  }
}
