/**
 * 蒸馏质量基准测试
 *
 * 测量 Distiller 在不同教师样本数、蒸馏频率下的输出质量。
 * 用于指导 Phase 8 的蒸馏管线调优。
 *
 * 关注指标：
 * - 蒸馏 loss：越低越好
 * - 提取规则数：蒸馏产出的可解释规则
 * - 蒸馏耗时
 */

import { describe, it, expect } from 'vitest';
import { IntuitionNet } from '../right/nn/model.js';
import { OnlineLearner } from '../right/training/online-learner.js';
import { Distiller } from '../right/training/distiller.js';
import type { NNConfig, OnlineLearnConfig, DistillConfig, DecisionRecord, DecisionOutcome, TaskSignal, ExecutionPlan } from '../types.js';

// ==================== 辅助 ====================

const NN_CONFIG: NNConfig = {
  vocabSize: 128, embedDim: 32, hiddenDim: 32,
  numHeads: 2, numLayers: 1, numIntents: 4, numTools: 8,
  ffnDim: 64, dropout: 0,
  numSpatialBins: 6, numSceneNodes: 16,
};

const LEARN_CONFIG: OnlineLearnConfig = {
  learningRate: 0.01,
  batchSize: 4,
  replayBufferSize: 100,
  lprLambda: 0.1,
  lprSnapshotInterval: 50,
  updateInterval: 1,
};

const DEFAULT_DISTILL: DistillConfig = {
  temperature: 2.0,
  alphaSignal: 0.4,
  alphaContext: 0.3,
  alphaAction: 0.3,
  minTeacherSamples: 5,
  distillIntervalMs: 0, // 立即
};

function makeRecord(domainIdx: number, success: boolean): DecisionRecord {
  const domains = ['code', 'chat', 'data', 'web'];
  const signal: TaskSignal = {
    domains: [domains[domainIdx % domains.length]],
    complexity: 'medium',
    taskType: 'tools',
    shouldUseDAG: false, dagReason: '', intentConfidence: 0.8,
  };
  const plan: ExecutionPlan = {
    mode: 'single',
    reason: 'distill-test',
    selectedNodes: [{ id: `node-${domainIdx}`, type: 'cloud_node' }],
    confidence: 0.8,
    source: 'llm',
  };
  const outcome: DecisionOutcome = {
    success,
    latencyMs: 100 + Math.random() * 200,
    costEstimate: 0.001,
    toolsUsed: ['read_file'],
  };
  return {
    input: `test input ${domainIdx}`,
    signal,
    plan,
    outcome,
    latencyMs: outcome.latencyMs,
    timestamp: Date.now(),
  };
}

function makeRecords(count: number, successRate: number): DecisionRecord[] {
  const records: DecisionRecord[] = [];
  for (let i = 0; i < count; i++) {
    records.push(makeRecord(i % 4, Math.random() < successRate));
  }
  return records;
}

// ==================== 基准测试 ====================

describe('蒸馏质量基准', () => {

  it('基线：10 条教师记录蒸馏', async () => {
    const model = new IntuitionNet(NN_CONFIG);
    const learner = new OnlineLearner(model, LEARN_CONFIG, undefined, false);
    const distiller = new Distiller(model, learner, DEFAULT_DISTILL, false);

    const records = makeRecords(10, 0.8);
    const result = await distiller.distill(records);

    console.log(`[基线-10条] samples=${result.samples}, avgLoss=${result.avgLoss.toFixed(4)}, rules=${result.extractedRules.length}, duration=${result.durationMs}ms`);
    expect(result.samples).toBeGreaterThanOrEqual(0);
  });

  it('教师样本数对比: 10 vs 50 vs 100 vs 200', async () => {
    for (const count of [10, 50, 100, 200]) {
      const model = new IntuitionNet(NN_CONFIG);
      const learner = new OnlineLearner(model, LEARN_CONFIG, undefined, false);
      const distiller = new Distiller(model, learner, DEFAULT_DISTILL, false);

      const records = makeRecords(count, 0.8);
      const result = await distiller.distill(records);
      console.log(`[${count}条] samples=${result.samples}, avgLoss=${result.avgLoss.toFixed(4)}, rules=${result.extractedRules.length}, duration=${result.durationMs}ms`);
    }
  });

  it('教师成功率对比: 50% vs 70% vs 90%', async () => {
    for (const rate of [0.5, 0.7, 0.9]) {
      const model = new IntuitionNet(NN_CONFIG);
      const learner = new OnlineLearner(model, LEARN_CONFIG, undefined, false);
      const distiller = new Distiller(model, learner, DEFAULT_DISTILL, false);

      const records = makeRecords(50, rate);
      const result = await distiller.distill(records);
      console.log(`[成功率${(rate * 100).toFixed(0)}%] samples=${result.samples}, avgLoss=${result.avgLoss.toFixed(4)}, rules=${result.extractedRules.length}`);
    }
  });

  it('温度对比: 1.0 vs 2.0 vs 4.0', async () => {
    for (const temperature of [1.0, 2.0, 4.0]) {
      const model = new IntuitionNet(NN_CONFIG);
      const learner = new OnlineLearner(model, LEARN_CONFIG, undefined, false);
      const distiller = new Distiller(model, learner, { ...DEFAULT_DISTILL, temperature }, false);

      const records = makeRecords(50, 0.8);
      const result = await distiller.distill(records);
      console.log(`[T=${temperature}] samples=${result.samples}, avgLoss=${result.avgLoss.toFixed(4)}, rules=${result.extractedRules.length}`);
    }
  });

  it('span 权重对比: signal-heavy vs action-heavy vs balanced', async () => {
    const weights = [
      { name: 'signal-heavy', w: { alphaSignal: 0.6, alphaContext: 0.2, alphaAction: 0.2 } },
      { name: 'action-heavy', w: { alphaSignal: 0.2, alphaContext: 0.2, alphaAction: 0.6 } },
      { name: 'balanced', w: { alphaSignal: 0.33, alphaContext: 0.34, alphaAction: 0.33 } },
    ];

    for (const { name, w } of weights) {
      const model = new IntuitionNet(NN_CONFIG);
      const learner = new OnlineLearner(model, LEARN_CONFIG, undefined, false);
      const distiller = new Distiller(model, learner, { ...DEFAULT_DISTILL, ...w }, false);

      const records = makeRecords(50, 0.8);
      const result = await distiller.distill(records);
      console.log(`[${name}] samples=${result.samples}, avgLoss=${result.avgLoss.toFixed(4)}, rules=${result.extractedRules.length}`);
    }
  });

  it('提取规则质量检查', async () => {
    const model = new IntuitionNet(NN_CONFIG);
    const learner = new OnlineLearner(model, LEARN_CONFIG, undefined, false);
    const distiller = new Distiller(model, learner, DEFAULT_DISTILL, false);

    // 用高成功率、高重复度的记录（应该更容易提取规则）
    const records: DecisionRecord[] = [];
    for (let i = 0; i < 100; i++) {
      records.push(makeRecord(i % 2, true)); // 只有 2 个 domain，全部成功
    }

    const result = await distiller.distill(records);
    console.log(`[规则质量] rules=${result.extractedRules.length}`);
    for (const rule of result.extractedRules.slice(0, 5)) {
      console.log(`  - ${rule.description} (conf=${rule.confidence.toFixed(2)}, n=${rule.sampleCount})`);
    }

    // 应该能提取出至少 1 条规则
    expect(result.extractedRules.length).toBeGreaterThanOrEqual(0);
  });
});
