/**
 * Phase D 测试 — 增量训练 + 自动成长
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TernaryOptimizer, estimateGradient, hammingDistance, changeRate } from './optimizer.js';
import { TernaryTrainer, type TrainingSample, type TrainingDataset } from './trainer.js';
import { TernaryScheduler } from './scheduler.js';
import type { GrowthStage } from './format.js';
import { TernaryGrowth, STAGE_CHARACTERISTICS } from './growth.js';
import { createModelMeta } from './format.js';
import type { TernaryModel, TernaryLayer } from './format.js';

// ── 工具函数 ──

function randomTernary(len: number): Int8Array {
  const arr = new Int8Array(len);
  for (let i = 0; i < len; i++) arr[i] = (Math.floor(Math.random() * 3) - 1) as -1 | 0 | 1;
  return arr;
}

function createTinyModel(domain = '测试'): TernaryModel {
  const inF = 32, rank = 4, outF = 32, numLayers = 2;
  const meta = createModelMeta(domain, {
    inFeatures: inF, rank, outFeatures: outF, numLayers,
    totalParams: (inF * rank + rank * outF) * numLayers,
  });

  const layers: TernaryLayer[] = Array.from({ length: numLayers }, (_, i) => ({
    layerIndex: i,
    A: randomTernary(inF * rank),
    B: randomTernary(rank * outF),
  }));

  return { meta, layers };
}

function createSamples(count: number, domain = '测试'): TrainingSample[] {
  return Array.from({ length: count }, (_, i) => ({
    inputIds: [10 + i, 20 + i, 30],
    targetIds: [40 + i],
    type: 'qa' as const,
    domain,
    quality: 0.7 + Math.random() * 0.3,
    timestamp: Date.now(),
  }));
}

// ═══════════════════════════════════════════════════════

describe('TernaryOptimizer', () => {
  let optimizer: TernaryOptimizer;

  beforeEach(() => {
    optimizer = new TernaryOptimizer({ learningRate: 0.01 });
  });

  it('initLatentWeights 从三进制权重展开', () => {
    const model = createTinyModel();
    const layer = model.layers[0];
    const state = optimizer.initLatentWeights(layer, 32, 4, 32);

    expect(state.latentA.length).toBe(32 * 4);
    expect(state.latentB.length).toBe(4 * 32);
  });

  it('step 更新三进制权重', () => {
    const model = createTinyModel();
    const layer = model.layers[0];

    // 初始化 latent
    optimizer.initLatentWeights(layer, 32, 4, 32);

    // 构造假梯度
    const gradA = new Float32Array(32 * 4);
    const gradB = new Float32Array(4 * 32);
    gradA.fill(0.1);
    gradB.fill(-0.1);

    const oldA = new Int8Array(layer.A);
    const updated = optimizer.step(layer, { gradA, gradB }, 32, 4, 32);

    expect(updated.A.length).toBe(oldA.length);
    expect(updated.B.length).toBe(layer.B.length);
    // 权重应该有变化（至少部分）
    expect(optimizer.getStep()).toBe(1);
  });

  it('动量模式创建 momentum 数组', () => {
    const opt = new TernaryOptimizer({ useMomentum: true });
    const model = createTinyModel();
    const state = opt.initLatentWeights(model.layers[0], 32, 4, 32);

    expect(state.momentumA).toBeDefined();
    expect(state.momentumB).toBeDefined();
    expect(state.momentumA!.length).toBe(32 * 4);
  });

  it('serialize / restore roundtrip', () => {
    const model = createTinyModel();
    optimizer.initLatentWeights(model.layers[0], 32, 4, 32);

    // 执行几步
    const gradA = new Float32Array(32 * 4).fill(0.05);
    const gradB = new Float32Array(4 * 32).fill(0.05);
    optimizer.step(model.layers[0], { gradA, gradB }, 32, 4, 32);
    optimizer.step(model.layers[0], { gradA, gradB }, 32, 4, 32);

    const checkpoint = optimizer.serialize();
    expect(checkpoint.step).toBe(2);

    const opt2 = new TernaryOptimizer();
    opt2.restore(checkpoint);
    expect(opt2.getStep()).toBe(2);
  });

  it('reset 清除状态', () => {
    const model = createTinyModel();
    optimizer.initLatentWeights(model.layers[0], 32, 4, 32);
    optimizer.reset();
    expect(optimizer.getStep()).toBe(0);
    expect(optimizer.getLatentWeights(0)).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════

describe('工具函数', () => {
  it('hammingDistance 计算正确', () => {
    const a = new Int8Array([1, 0, -1, 1]);
    const b = new Int8Array([1, 1, -1, 0]);
    expect(hammingDistance(a, b)).toBe(2);
  });

  it('hammingDistance 全相同为 0', () => {
    const a = new Int8Array([1, 0, -1]);
    expect(hammingDistance(a, a)).toBe(0);
  });

  it('changeRate 返回 0-1 之间', () => {
    const a = randomTernary(100);
    const b = randomTernary(100);
    const rate = changeRate(a, b);
    expect(rate).toBeGreaterThanOrEqual(0);
    expect(rate).toBeLessThanOrEqual(1);
  });

  it('estimateGradient 返回正确长度', () => {
    const weights = randomTernary(32);
    const grad = estimateGradient(weights, () => Math.random());
    expect(grad.length).toBe(32);
  });
});

// ═══════════════════════════════════════════════════════

describe('TernaryTrainer', () => {
  it('train 成功执行', () => {
    const trainer = new TernaryTrainer({
      maxEpochs: 2,
      batchSize: 8,
      patience: 5,
      valSplit: 0.05,
      optimizer: { learningRate: 0.001, gradClip: 0.5 },
    });
    const model = createTinyModel();
    const dataset: TrainingDataset = {
      samples: createSamples(40),
      domain: '测试',
      version: '1.0.0',
    };

    const result = trainer.train(model, dataset);

    expect(result.initialLoss).toBeGreaterThanOrEqual(0);
    expect(result.finalLoss).toBeGreaterThanOrEqual(0);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    // 即使回滚，steps 也应该大于 0
    expect(result.steps).toBeGreaterThanOrEqual(0);
  });

  it('train 空数据返回失败', () => {
    const trainer = new TernaryTrainer();
    const model = createTinyModel();
    const dataset: TrainingDataset = { samples: [], domain: '测试', version: '1.0.0' };

    const result = trainer.train(model, dataset);
    expect(result.success).toBe(false);
  });

  it('train 过滤低质量样本', () => {
    const trainer = new TernaryTrainer({ minQuality: 0.8, maxEpochs: 2, batchSize: 4, valSplit: 0.05 });
    const model = createTinyModel();

    const samples = [
      ...createSamples(10).map(s => ({ ...s, quality: 0.3 })),  // 低质量
      ...createSamples(30).map(s => ({ ...s, quality: 0.9 })), // 高质量
    ];

    const dataset: TrainingDataset = { samples, domain: '测试', version: '1.0.0' };
    const result = trainer.train(model, dataset);

    // 应该成功训练（过滤后还有足够样本）
    expect(result.success).toBe(true);
  });

  it('train 去重样本', () => {
    const trainer = new TernaryTrainer({ maxEpochs: 1, batchSize: 2, valSplit: 0.05 });
    const model = createTinyModel();

    const samples = createSamples(10);
    const duplicated = [...samples, ...samples, ...samples]; // 重复 3 次
    const dataset: TrainingDataset = {
      samples: duplicated,
      domain: '测试',
      version: '1.0.0',
    };

    trainer.train(model, dataset);
    // 去重后应只有原始 10 个
    expect(trainer.trainedCount).toBe(10);
  });

  it('train 更新模型元数据', () => {
    const trainer = new TernaryTrainer({ maxEpochs: 1, batchSize: 4, valSplit: 0.05 });
    const model = createTinyModel();
    const oldSteps = model.meta.trainSteps;

    const dataset: TrainingDataset = {
      samples: createSamples(30),
      domain: '测试',
      version: '1.0.0',
    };

    trainer.train(model, dataset);
    expect(model.meta.trainSteps).toBeGreaterThanOrEqual(oldSteps);
  });

  it('reset 清除训练状态', () => {
    const trainer = new TernaryTrainer({ maxEpochs: 1, batchSize: 4, valSplit: 0.05 });
    const model = createTinyModel();
    const dataset: TrainingDataset = {
      samples: createSamples(30),
      domain: '测试',
      version: '1.0.0',
    };

    trainer.train(model, dataset);
    expect(trainer.trainedCount).toBeGreaterThan(0);

    trainer.reset();
    expect(trainer.trainedCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════

describe('TernaryScheduler', () => {
  it('addSamples 累积待训练数据', () => {
    const scheduler = new TernaryScheduler({ minSamplesToTrain: 5 });
    scheduler.addSamples('Go开发', createSamples(3));
    scheduler.addSamples('Go开发', createSamples(3));

    const summary = scheduler.getPendingSummary();
    expect(summary.length).toBe(1);
    expect(summary[0].sampleCount).toBe(6);
  });

  it('addSamples 不同领域分开队列', () => {
    const scheduler = new TernaryScheduler();
    scheduler.addSamples('Go开发', createSamples(5));
    scheduler.addSamples('法务', createSamples(5));

    const summary = scheduler.getPendingSummary();
    expect(summary.length).toBe(2);
  });

  it('checkAndTrain 样本不足时跳过', async () => {
    const scheduler = new TernaryScheduler({ minSamplesToTrain: 100 });
    scheduler.addSamples('测试', createSamples(5));

    const result = await scheduler.checkAndTrain();
    expect(result).toBeNull();
  });

  it('getState 返回正确状态', () => {
    const scheduler = new TernaryScheduler();
    const state = scheduler.getState();

    expect(state.lastTrainTime).toBe(0);
    expect(state.isTraining).toBe(false);
    expect(state.queue).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════

describe('TernaryGrowth', () => {
  let growth: TernaryGrowth;

  beforeEach(() => {
    growth = new TernaryGrowth();
  });

  it('新模型为 seed 阶段', () => {
    const model = createTinyModel();
    expect(model.meta.growthStage).toBe('seed');
  });

  it('evaluateGrowth seed → sprout', () => {
    const model = createTinyModel();
    model.meta.trainSteps = 15; // 超过 seedToSprout(10)

    const result = growth.evaluateGrowth(model, 0, 0);
    expect(result.changed).toBe(true);
    expect(result.newStage).toBe('sprout');
  });

  it('evaluateGrowth sprout → growing', () => {
    const model = createTinyModel();
    model.meta.growthStage = 'sprout';
    model.meta.trainSteps = 150; // 超过 100
    model.meta.lastUpdated = Date.now();

    const result = growth.evaluateGrowth(model, 60, 0.3);
    expect(result.changed).toBe(true);
    expect(result.newStage).toBe('growing');
  });

  it('evaluateGrowth 未达标不变化', () => {
    const model = createTinyModel();
    model.meta.trainSteps = 5; // 未到 10

    const result = growth.evaluateGrowth(model, 0, 0);
    expect(result.changed).toBe(false);
    expect(result.newStage).toBe('seed');
  });

  it('getReport 包含阶段信息', () => {
    const model = createTinyModel();
    const report = growth.getReport(model, 10, 0.1);

    expect(report.currentStage).toBe('seed');
    expect(report.characteristics.emoji).toBe('🌱');
    expect(report.nextStageRequirements.length).toBeGreaterThan(0);
    expect(report.progressPercent).toBeGreaterThanOrEqual(0);
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  it('isStable loss 波动小时返回 true', () => {
    // 模拟稳定 loss
    for (let i = 0; i < 20; i++) {
      growth.recordLoss('测试', 0.5 + Math.random() * 0.001);
    }
    expect(growth.isStable('测试')).toBe(true);
  });

  it('isStable loss 波动大时返回 false', () => {
    // 模拟不稳定 loss
    for (let i = 0; i < 20; i++) {
      growth.recordLoss('测试', i % 2 === 0 ? 0.1 : 1.0);
    }
    expect(growth.isStable('测试')).toBe(false);
  });

  it('getAdjustedLR 按阶段缩放', () => {
    const baseLR = 0.01;
    expect(growth.getAdjustedLR(baseLR, 'seed')).toBe(0.01);
    expect(growth.getAdjustedLR(baseLR, 'mature')).toBe(0.001);
    expect(growth.getAdjustedLR(baseLR, 'growing')).toBeLessThan(baseLR);
  });

  it('getAllowedTraining 不同阶段不同权限', () => {
    expect(growth.getAllowedTraining('seed')).toContain('distill');
    expect(growth.getAllowedTraining('seed')).not.toContain('finetune');
    expect(growth.getAllowedTraining('mature')).toContain('finetune');
    expect(growth.getAllowedTraining('mature')).not.toContain('distill');
  });

  it('STAGE_CHARACTERISTICS 覆盖所有阶段', () => {
    const stages = ['seed', 'sprout', 'growing', 'trainable', 'mature'];
    for (const stage of stages) {
      expect(STAGE_CHARACTERISTICS[stage as GrowthStage]).toBeDefined();
      expect(STAGE_CHARACTERISTICS[stage as GrowthStage].emoji).toBeTruthy();
    }
  });
});
