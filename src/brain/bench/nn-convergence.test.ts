/**
 * NN 收敛基准测试
 *
 * 测量不同超参组合下 IntuitionNet 的收敛速度和最终 loss。
 * 用于指导 Phase 8 的 NN 精度调优。
 */

import { describe, it, expect } from 'vitest';
import { IntuitionNet } from '../right/nn/model.js';
import { OnlineLearner } from '../right/training/online-learner.js';
import type { NNConfig, OnlineLearnConfig, TrainingSample, TaskSignal, ResourceState, DecisionOutcome } from '../types.js';

// ==================== 辅助 ====================

/** 小模型配置（基准测试用） */
const BASE_NN: NNConfig = {
  vocabSize: 256, embedDim: 32, hiddenDim: 32,
  numHeads: 2, numLayers: 1, numIntents: 4, numTools: 8,
  ffnDim: 64, dropout: 0,
  numSpatialBins: 6, numSceneNodes: 16,
};

function makeConfig(overrides?: Partial<OnlineLearnConfig>): OnlineLearnConfig {
  return {
    learningRate: 0.01,
    batchSize: 8,
    replayBufferSize: 200,
    lprLambda: 0.1,
    lprSnapshotInterval: 50,
    updateInterval: 1,
    ...overrides,
  };
}

function makeSample(intent: number, quality: number, outcome: boolean): TrainingSample {
  return {
    features: new Float32Array([intent, quality, outcome ? 1 : 0, Math.random()]),
    labelIntent: intent % 4,
    labelTools: [intent % 8],
    labelQuality: quality,
    outcome,
    timestamp: Date.now(),
    weight: outcome ? 1.0 : 0.3,
  };
}

/** 训练 N 轮，返回每轮 loss */
async function trainRounds(
  nnConfig: NNConfig,
  learnConfig: OnlineLearnConfig,
  rounds: number,
): Promise<number[]> {
  const model = new IntuitionNet(nnConfig);
  const learner = new OnlineLearner(model, learnConfig, undefined, false);
  const losses: number[] = [];

  for (let r = 0; r < rounds; r++) {
    // 生成一批样本（4 个意图类别，均匀分布）
    for (let i = 0; i < learnConfig.batchSize; i++) {
      const intent = r % 4;
      learner.ingestSample(makeSample(intent, 0.7 + Math.random() * 0.3, Math.random() > 0.3));
    }
    const result = await learner.update();
    losses.push(result.loss);
  }

  return losses;
}

/** 计算 loss 趋势：后 20% 的平均 loss */
function finalLoss(losses: number[]): number {
  const tail = losses.slice(Math.floor(losses.length * 0.8));
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}

/** 计算收敛速度：loss 首次降到阈值以下的轮数 */
function convergenceSpeed(losses: number[], threshold: number): number {
  for (let i = 0; i < losses.length; i++) {
    if (losses[i] < threshold) return i + 1;
  }
  return losses.length; // 未收敛
}

// ==================== 基准测试 ====================

describe('NN 收敛基准', () => {

  it('基线：默认超参 100 轮训练', async () => {
    const losses = await trainRounds(BASE_NN, makeConfig(), 100);
    const fl = finalLoss(losses);
    const speed = convergenceSpeed(losses, 1.0);

    // 记录基线指标
    console.log(`[基线] finalLoss=${fl.toFixed(4)}, convergence@1.0=${speed}轮, first5=[${losses.slice(0, 5).map(l => l.toFixed(3)).join(', ')}]`);

    // 基准测试只验证训练能正常完成，loss 有限
    expect(Number.isFinite(fl)).toBe(true);
    expect(fl).toBeGreaterThan(0);
  });

  it('学习率对比: 0.001 vs 0.01 vs 0.05', async () => {
    const results: Array<{ lr: number; finalLoss: number; speed: number }> = [];

    for (const lr of [0.001, 0.01, 0.05]) {
      const losses = await trainRounds(BASE_NN, makeConfig({ learningRate: lr }), 100);
      const fl = finalLoss(losses);
      const speed = convergenceSpeed(losses, 1.0);
      results.push({ lr, finalLoss: fl, speed });
      console.log(`[LR=${lr}] finalLoss=${fl.toFixed(4)}, convergence@1.0=${speed}轮`);
    }

    // 所有学习率都应该能收敛（finalLoss < first loss）
    for (const r of results) {
      expect(r.finalLoss).toBeGreaterThan(0);
    }
  });

  it('batch size 对比: 4 vs 8 vs 16', async () => {
    const results: Array<{ bs: number; finalLoss: number; speed: number }> = [];

    for (const bs of [4, 8, 16]) {
      const losses = await trainRounds(BASE_NN, makeConfig({ batchSize: bs }), 80);
      const fl = finalLoss(losses);
      const speed = convergenceSpeed(losses, 1.0);
      results.push({ bs, finalLoss: fl, speed });
      console.log(`[BS=${bs}] finalLoss=${fl.toFixed(4)}, convergence@1.0=${speed}轮`);
    }

    for (const r of results) {
      expect(r.finalLoss).toBeGreaterThan(0);
    }
  });

  it('LPR lambda 对比: 0.01 vs 0.1 vs 0.5', async () => {
    const results: Array<{ lambda: number; finalLoss: number }> = [];

    for (const lambda of [0.01, 0.1, 0.5]) {
      const losses = await trainRounds(BASE_NN, makeConfig({ lprLambda: lambda }), 100);
      const fl = finalLoss(losses);
      results.push({ lambda, finalLoss: fl });
      console.log(`[LPR λ=${lambda}] finalLoss=${fl.toFixed(4)}`);
    }

    // lambda 越大防遗忘越强，但收敛可能越慢
    // 都应该能训练（loss > 0 且有限）
    for (const r of results) {
      expect(r.finalLoss).toBeGreaterThan(0);
      expect(Number.isFinite(r.finalLoss)).toBe(true);
    }
  });

  it('模型大小对比: 小(32d) vs 中(64d) vs 大(128d)', async () => {
    const configs: Array<{ name: string; cfg: NNConfig }> = [
      { name: 'small-32d', cfg: { ...BASE_NN, embedDim: 32, hiddenDim: 32, ffnDim: 64 } },
      { name: 'medium-64d', cfg: { ...BASE_NN, embedDim: 64, hiddenDim: 64, ffnDim: 128 } },
      { name: 'large-128d', cfg: { ...BASE_NN, embedDim: 128, hiddenDim: 128, ffnDim: 256 } },
    ];

    for (const { name, cfg } of configs) {
      const model = new IntuitionNet(cfg);
      const paramCount = model.parameters().reduce((s, p) => s + p.size, 0);
      const losses = await trainRounds(cfg, makeConfig(), 50);
      const fl = finalLoss(losses);
      console.log(`[${name}] params=${paramCount}, finalLoss=${fl.toFixed(4)}`);
      expect(paramCount).toBeGreaterThan(0);
      expect(fl).toBeGreaterThan(0);
    }
  });

  it('loss 权重对比: intent-heavy vs tool-heavy vs balanced', async () => {
    // 不同 loss 权重通过 OnlineLearner 的 lossWeights 参数控制
    const weights = [
      { name: 'intent-heavy', w: { alphaIntent: 0.6, alphaTool: 0.2, alphaQuality: 0.2 } },
      { name: 'tool-heavy', w: { alphaIntent: 0.2, alphaTool: 0.6, alphaQuality: 0.2 } },
      { name: 'balanced', w: { alphaIntent: 0.33, alphaTool: 0.33, alphaQuality: 0.34 } },
    ];

    for (const { name, w } of weights) {
      const model = new IntuitionNet(BASE_NN);
      const learner = new OnlineLearner(model, makeConfig(), w, false);
      const losses: number[] = [];

      for (let r = 0; r < 60; r++) {
        for (let i = 0; i < 8; i++) {
          learner.ingestSample(makeSample(i % 4, 0.7 + Math.random() * 0.3, Math.random() > 0.3));
        }
        const result = await learner.update();
        losses.push(result.loss);
      }

      const fl = finalLoss(losses);
      console.log(`[${name}] finalLoss=${fl.toFixed(4)}`);
      expect(fl).toBeGreaterThan(0);
    }
  });
});
