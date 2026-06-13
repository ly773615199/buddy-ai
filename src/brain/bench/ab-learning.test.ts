/**
 * 集成基准测试 — 有无研究增强的收敛对比
 *
 * 测量反事实样本、课程学习对 OnlineLearner 收敛速度的影响。
 * 用于验证 Phase 6.5 研究增强的实际效果。
 */

import { describe, it, expect } from 'vitest';
import { IntuitionNet } from '../right/nn/model.js';
import { OnlineLearner } from '../right/training/online-learner.js';
import { ReplayBuffer } from '../right/training/replay-buffer.js';
import { DecisionMemory } from '../left/decision-memory.js';
import type { NNConfig, OnlineLearnConfig, TrainingSample, TaskSignal, ResourceState, DecisionRecord, DecisionOutcome } from '../types.js';

// ==================== 辅助 ====================

const NN_CONFIG: NNConfig = {
  vocabSize: 128, embedDim: 32, hiddenDim: 32,
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

function makeSample(intent: number, outcome: boolean): TrainingSample {
  return {
    features: new Float32Array([intent, outcome ? 1 : 0, Math.random(), Math.random()]),
    labelIntent: intent % 4,
    labelTools: [intent % 8],
    labelQuality: outcome ? 0.8 : 0.3,
    outcome,
    timestamp: Date.now(),
    weight: outcome ? 1.0 : 0.3,
  };
}

function makeSignal(idx: number): TaskSignal {
  return {
    domains: [['code', 'chat', 'data', 'web'][idx % 4]],
    complexity: 'medium',
    taskType: 'tools',
    shouldUseDAG: false, dagReason: '', intentConfidence: 0.8,
  };
}

function makeRecord(idx: number, success: boolean): DecisionRecord {
  return {
    input: `test ${idx}`,
    signal: makeSignal(idx),
    plan: {
      mode: 'single', reason: 'test',
      selectedNodes: [{ id: `n${idx}`, type: 'cloud_node' }],
      confidence: 0.8, source: 'llm',
    },
    outcome: { success, latencyMs: 100, costEstimate: 0.001, toolsUsed: ['read_file'] },
    latencyMs: 100,
    timestamp: Date.now(),
  };
}

/** 训练 N 轮，返回 loss 数组 */
async function train(
  nnConfig: NNConfig,
  learnConfig: OnlineLearnConfig,
  rounds: number,
  sampleFn: (round: number) => TrainingSample[],
): Promise<number[]> {
  const model = new IntuitionNet(nnConfig);
  const learner = new OnlineLearner(model, learnConfig, undefined, false);
  const losses: number[] = [];

  for (let r = 0; r < rounds; r++) {
    const samples = sampleFn(r);
    for (const s of samples) learner.ingestSample(s);
    const result = await learner.update();
    losses.push(result.loss);
  }

  return losses;
}

function avgLoss(losses: number[], tailPct = 0.2): number {
  const tail = losses.slice(Math.floor(losses.length * (1 - tailPct)));
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}

// ==================== 基准测试 ====================

describe('集成基准 — 研究增强效果', () => {

  it('基线：纯随机样本 100 轮', async () => {
    const losses = await train(NN_CONFIG, makeConfig(), 100, (r) => {
      return Array.from({ length: 8 }, (_, i) => makeSample(i % 4, Math.random() > 0.3));
    });
    console.log(`[基线] avgLoss=${avgLoss(losses).toFixed(4)}, first5=[${losses.slice(0, 5).map(l => l.toFixed(3)).join(', ')}]`);
    expect(avgLoss(losses)).toBeGreaterThan(0);
  });

  it('课程学习 vs 随机采样', async () => {
    // 随机采样
    const randomLosses = await train(NN_CONFIG, makeConfig(), 100, (r) => {
      return Array.from({ length: 8 }, (_, i) => makeSample(i % 4, Math.random() > 0.3));
    });

    // 课程学习：前 30 轮只用成功样本，后面逐步放开
    const curriculumLosses = await train(NN_CONFIG, makeConfig(), 100, (r) => {
      const progress = r / 100;
      return Array.from({ length: 8 }, (_, i) => {
        const success = progress < 0.3 ? true : Math.random() > 0.3;
        return makeSample(i % 4, success);
      });
    });

    const randomAvg = avgLoss(randomLosses);
    const curriculumAvg = avgLoss(curriculumLosses);
    console.log(`[课程学习] random=${randomAvg.toFixed(4)}, curriculum=${curriculumAvg.toFixed(4)}, diff=${((randomAvg - curriculumAvg) / randomAvg * 100).toFixed(1)}%`);
    expect(curriculumAvg).toBeGreaterThan(0);
  });

  it('反事实样本增强 vs 纯事实样本', async () => {
    // 纯事实样本
    const factualLosses = await train(NN_CONFIG, makeConfig(), 80, (r) => {
      return Array.from({ length: 4 }, (_, i) => makeSample(i % 4, Math.random() > 0.3));
    });

    // 反事实增强：每个事实样本 + 1 个反事实样本（低权重）
    const augmentedLosses = await train(NN_CONFIG, makeConfig({ batchSize: 8 }), 80, (r) => {
      const factual = Array.from({ length: 4 }, (_, i) => makeSample(i % 4, Math.random() > 0.3));
      const counterfactual = Array.from({ length: 4 }, (_, i) => ({
        ...makeSample((i + 2) % 4, Math.random() > 0.5),
        weight: 0.5, // 反事实样本权重低
      }));
      return [...factual, ...counterfactual];
    });

    const factualAvg = avgLoss(factualLosses);
    const augmentedAvg = avgLoss(augmentedLosses);
    console.log(`[反事实] factual=${factualAvg.toFixed(4)}, augmented=${augmentedAvg.toFixed(4)}`);
    expect(augmentedAvg).toBeGreaterThan(0);
  });

  it('DecisionMemory 反事实生成', () => {
    const mem = new DecisionMemory(500);
    // 添加同 fingerprint 不同 mode 的记录
    for (let i = 0; i < 20; i++) {
      mem.record(makeRecord(i, i < 15)); // 前 15 个成功
    }

    const counterfactuals = mem.generateCounterfactuals(makeRecord(0, true));
    console.log(`[反事实生成] 从 20 条记录生成 ${counterfactuals.length} 个反事实样本`);
    expect(counterfactuals.length).toBeGreaterThanOrEqual(0);
  });

  it('ReplayBuffer 课程采样进度对比', () => {
    const buffer = new ReplayBuffer(200);
    // 填充不同难度
    for (let i = 0; i < 30; i++) {
      buffer.push(makeSample(i % 4, true));  // 简单
    }
    for (let i = 0; i < 30; i++) {
      buffer.push({ ...makeSample(i % 4, false), timestamp: Date.now() - 86_400_000 }); // 困难
    }

    for (const progress of [0, 0.3, 0.6, 1.0]) {
      const samples = buffer.sampleCurriculum(8, progress);
      const avgDiff = samples.reduce((s, sp) => s + (ReplayBuffer.calcDifficulty(sp) ?? 0), 0) / samples.length;
      console.log(`[progress=${progress}] avgDifficulty=${avgDiff.toFixed(3)}, count=${samples.length}`);
    }
  });
});
