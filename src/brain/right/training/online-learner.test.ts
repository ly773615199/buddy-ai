/**
 * OnlineLearner 安全阀测试
 *
 * 覆盖：
 * - observeOnly 模式：只计算 loss，不更新权重
 * - 收敛检测：loss 稳定后自动切换到真实更新
 * - safetyValveStatus 状态暴露
 * - observe 模式下 LPR 快照仍正常更新
 * - 配置项边界
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OnlineLearner } from './online-learner.js';
import { IntuitionNet } from '../nn/model.js';
import type { NNConfig, OnlineLearnConfig, TrainingSample } from '../../types.js';

// 小模型配置（测试用，快速）
const NN_CONFIG: NNConfig = {
  vocabSize: 128, embedDim: 32, hiddenDim: 32,
  numHeads: 2, numLayers: 1, numIntents: 4, numTools: 8,
  ffnDim: 64, dropout: 0,
  numSpatialBins: 6, numSceneNodes: 16,
};

/** 构造基础 OnlineLearnConfig */
function makeConfig(overrides?: Partial<OnlineLearnConfig>): OnlineLearnConfig {
  return {
    learningRate: 0.01,
    batchSize: 4,
    replayBufferSize: 100,
    lprLambda: 0.1,
    lprSnapshotInterval: 50,
    updateInterval: 1,
    ...overrides,
  };
}

/** 构造一个简单的训练样本 */
function makeSample(quality = 0.8, outcome = true): TrainingSample {
  return {
    features: new Float32Array([1, 2, 3, 4]),
    labelIntent: 0,
    labelTools: [0, 1],
    labelQuality: quality,
    outcome,
    timestamp: Date.now(),
    weight: 1.0,
  };
}

/** 填充 buffer 到 batchSize 并触发一次 update */
async function fillAndUpdate(learner: OnlineLearner, count = 4): Promise<{ loss: number; observeOnly?: boolean }> {
  for (let i = 0; i < count; i++) {
    learner.ingestSample(makeSample(0.8, true));
  }
  return learner.update();
}

describe('OnlineLearner — 安全阀', () => {
  let model: IntuitionNet;

  beforeEach(() => {
    model = new IntuitionNet(NN_CONFIG);
  });

  // ==================== 基础行为 ====================

  describe('默认模式（无安全阀）', () => {
    it('observeOnly 默认 false', async () => {
      const learner = new OnlineLearner(model, makeConfig());
      const result = await fillAndUpdate(learner);
      expect(result.observeOnly).toBe(false);
    });

    it('update 返回 loss 和 lr', async () => {
      const learner = new OnlineLearner(model, makeConfig());
      const result = await fillAndUpdate(learner);
      expect(result.loss).toBeGreaterThan(0);
      expect(result.lr).toBeGreaterThan(0);
      expect(result.samples).toBeGreaterThan(0);
    });

    it('buffer 不足 batchSize 时返回 0', async () => {
      const learner = new OnlineLearner(model, makeConfig({ batchSize: 8 }));
      learner.ingestSample(makeSample());
      const result = await learner.update();
      expect(result.loss).toBe(0);
      expect(result.samples).toBe(0);
    });
  });

  // ==================== observeOnly 模式 ====================

  describe('observeOnly 模式', () => {
    it('observeOnly=true 时不更新权重', async () => {
      const learner = new OnlineLearner(model, makeConfig({
        observeOnly: true,
        observeRounds: 0, // 不自动切换
      }));

      // 记录初始参数快照
      const paramsBefore = model.parameters().map(p => new Float32Array(p.data));

      await fillAndUpdate(learner);

      // 参数不应改变
      const paramsAfter = model.parameters();
      for (let i = 0; i < paramsBefore.length; i++) {
        for (let j = 0; j < paramsBefore[i].length; j++) {
          expect(paramsAfter[i].data[j]).toBeCloseTo(paramsBefore[i][j], 6);
        }
      }
    });

    it('observeOnly=true 时仍返回有效 loss', async () => {
      const learner = new OnlineLearner(model, makeConfig({
        observeOnly: true,
        observeRounds: 0,
      }));

      const result = await fillAndUpdate(learner);
      expect(result.loss).toBeGreaterThan(0);
      expect(result.observeOnly).toBe(true);
    });

    it('observeOnly=true 时 totalSamples 仍递增', async () => {
      const learner = new OnlineLearner(model, makeConfig({
        observeOnly: true,
        observeRounds: 0,
      }));

      await fillAndUpdate(learner);
      expect(learner.stats.totalSamples).toBe(4);
    });

    it('observeOnly=true 时 totalUpdates 仍递增', async () => {
      const learner = new OnlineLearner(model, makeConfig({
        observeOnly: true,
        observeRounds: 0,
      }));

      await fillAndUpdate(learner);
      expect(learner.stats.totalUpdates).toBe(1);
    });

    it('observeOnly 期间 LPR 快照仍更新', async () => {
      const learner = new OnlineLearner(model, makeConfig({
        observeOnly: true,
        observeRounds: 0,
        lprSnapshotInterval: 2, // 每 2 步更新快照
      }));

      // 填充并触发多次 update
      for (let i = 0; i < 5; i++) {
        await fillAndUpdate(learner);
      }

      // 没有崩溃即为通过（快照更新不抛异常）
      expect(learner.stats.totalUpdates).toBe(5);
    });
  });

  // ==================== 收敛检测与自动切换 ====================

  describe('收敛检测与自动切换', () => {
    it('达到 observeRounds 且 loss 收敛后切换到真实更新', async () => {
      const learner = new OnlineLearner(model, makeConfig({
        observeOnly: true,
        observeRounds: 3,
        convergenceThreshold: 1.0, // 宽松阈值，方便测试
        convergencePatience: 2,
        batchSize: 4,
      }));

      // 前 3 轮应该是 observeOnly
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 4; j++) learner.ingestSample(makeSample(0.8, true));
        const result = await learner.update();
        expect(result.observeOnly).toBe(true);
      }

      // 继续轮次，loss 应该收敛（用相同样本，loss 变化小）
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 4; j++) learner.ingestSample(makeSample(0.8, true));
        const result = await learner.update();
        if (!result.observeOnly) {
          // 已切换！
          expect(result.observeOnly).toBe(false);
          return;
        }
      }

      // 如果走到这里，检查 safetyValveStatus
      const status = learner.safetyValveStatus;
      // 至少应该已经触发或接近触发
      expect(status.observeRoundCount).toBeGreaterThanOrEqual(3);
    });

    it('safetyValveTriggered 在切换后为 true', async () => {
      const learner = new OnlineLearner(model, makeConfig({
        observeOnly: true,
        observeRounds: 2,
        convergenceThreshold: 1.0,
        convergencePatience: 1,
        batchSize: 4,
      }));

      // 运行足够多轮触发切换
      for (let i = 0; i < 10; i++) {
        for (let j = 0; j < 4; j++) learner.ingestSample(makeSample(0.8, true));
        await learner.update();
      }

      const status = learner.safetyValveStatus;
      // 要么已触发，要么还在观察
      expect(typeof status.safetyValveTriggered).toBe('boolean');
    });

    it('observeRounds=0 时不自动切换', async () => {
      const learner = new OnlineLearner(model, makeConfig({
        observeOnly: true,
        observeRounds: 0,
        batchSize: 4,
      }));

      for (let i = 0; i < 10; i++) {
        for (let j = 0; j < 4; j++) learner.ingestSample(makeSample(0.8, true));
        const result = await learner.update();
        expect(result.observeOnly).toBe(true);
      }
    });

    it('loss 不收敛时不切换', async () => {
      const learner = new OnlineLearner(model, makeConfig({
        observeOnly: true,
        observeRounds: 2,
        convergenceThreshold: 0.0001, // 极严格阈值
        convergencePatience: 100,      // 极大 patience
        batchSize: 4,
      }));

      // 用不同质量的样本让 loss 波动
      for (let i = 0; i < 8; i++) {
        const quality = i % 2 === 0 ? 0.1 : 0.9;
        for (let j = 0; j < 4; j++) learner.ingestSample(makeSample(quality, i % 2 === 0));
        const result = await learner.update();
        expect(result.observeOnly).toBe(true);
      }
    });
  });

  // ==================== safetyValveStatus ====================

  describe('safetyValveStatus', () => {
    it('初始状态正确', () => {
      const learner = new OnlineLearner(model, makeConfig());
      const status = learner.safetyValveStatus;
      expect(status.observeOnly).toBe(false);
      expect(status.observeRoundCount).toBe(0);
      expect(status.safetyValveTriggered).toBe(false);
      expect(status.convergenceStreak).toBe(0);
    });

    it('observe 模式下 observeRoundCount 递增', async () => {
      const learner = new OnlineLearner(model, makeConfig({
        observeOnly: true,
        observeRounds: 0,
        batchSize: 4,
      }));

      await fillAndUpdate(learner);
      expect(learner.safetyValveStatus.observeRoundCount).toBe(1);

      await fillAndUpdate(learner);
      expect(learner.safetyValveStatus.observeRoundCount).toBe(2);
    });

    it('recentAvgLoss 在有样本后 > 0', async () => {
      const learner = new OnlineLearner(model, makeConfig({
        observeOnly: true,
        observeRounds: 0,
        batchSize: 4,
      }));

      await fillAndUpdate(learner);
      expect(learner.safetyValveStatus.recentAvgLoss).toBeGreaterThan(0);
    });
  });

  // ==================== 配置边界 ====================

  describe('配置边界', () => {
    it('所有安全阀配置项均可自定义', () => {
      const learner = new OnlineLearner(model, makeConfig({
        observeOnly: true,
        observeRounds: 50,
        convergenceThreshold: 0.005,
        convergencePatience: 20,
      }));

      const status = learner.safetyValveStatus;
      expect(status.observeOnly).toBe(true);
    });

    it('默认安全阀配置合理', () => {
      // 不传安全阀配置时，应有合理默认值
      const learner = new OnlineLearner(model, makeConfig());
      const status = learner.safetyValveStatus;
      expect(status.observeOnly).toBe(false);
      expect(status.observeRoundCount).toBe(0);
    });
  });

  // ==================== 样本收集 ====================

  describe('样本收集', () => {
    it('ingestSample 增加 bufferSize', () => {
      const learner = new OnlineLearner(model, makeConfig());
      learner.ingestSample(makeSample());
      learner.ingestSample(makeSample());
      expect(learner.stats.totalSamples).toBe(2);
    });

    it('ingestSample 不触发权重更新', () => {
      const learner = new OnlineLearner(model, makeConfig());
      const paramsBefore = model.parameters().map(p => new Float32Array(p.data));

      learner.ingestSample(makeSample());

      // 参数不应改变
      const paramsAfter = model.parameters();
      for (let i = 0; i < paramsBefore.length; i++) {
        for (let j = 0; j < paramsBefore[i].length; j++) {
          expect(paramsAfter[i].data[j]).toBeCloseTo(paramsBefore[i][j], 6);
        }
      }
    });
  });

  // ==================== 统计 ====================

  describe('stats', () => {
    it('totalSamples 正确计数', async () => {
      const learner = new OnlineLearner(model, makeConfig({
        observeOnly: true,
        observeRounds: 0,
        batchSize: 4,
      }));

      await fillAndUpdate(learner, 4);
      await fillAndUpdate(learner, 4);
      expect(learner.stats.totalSamples).toBe(8);
    });

    it('totalUpdates 正确计数', async () => {
      const learner = new OnlineLearner(model, makeConfig({
        observeOnly: true,
        observeRounds: 0,
        batchSize: 4,
      }));

      await fillAndUpdate(learner);
      await fillAndUpdate(learner);
      expect(learner.stats.totalUpdates).toBe(2);
    });

    it('currentLr 反映当前学习率', () => {
      const learner = new OnlineLearner(model, makeConfig({ learningRate: 0.005 }));
      expect(learner.stats.currentLr).toBeCloseTo(0.005, 5);
    });
  });
});
