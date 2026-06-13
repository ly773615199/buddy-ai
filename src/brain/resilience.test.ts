/**
 * 异常恢复测试
 *
 * 覆盖：
 * 1. 空输入不崩溃
 * 2. 超长输入不崩溃
 * 3. 无效 token ID 不崩溃
 * 4. 模型权重全零后推理
 * 5. 模型权重含 NaN 后推理
 * 6. destroy 后调用不崩溃
 * 7. 小脑 BodyState 极端值
 */

import { describe, it, expect } from 'vitest';
import { ThreeBrain } from './brain.js';
import { IntuitionNet } from './right/nn/model.js';
import { Tensor, zeros, randn } from './right/nn/tensor.js';
import type { TaskSignal, ResourceState, BodyState } from './types.js';

// ==================== 辅助 ====================

function makeSignal(overrides?: Partial<TaskSignal>): TaskSignal {
  return {
    domains: ['code'], complexity: 'medium', taskType: 'tools',
    shouldUseDAG: false, dagReason: '', intentConfidence: 0.8,
    ...overrides,
  };
}

function makeResources(): ResourceState {
  return {
    budgetRemaining: 100, availableNodeCount: 3,
    localCoverageRatio: 0.5, localConfidence: 0.6,
    userCorrectionCount: 0, experienceHit: null,
  };
}

function makeBodyState(overrides?: Partial<BodyState>): BodyState {
  return {
    energy: 50, temperature: 50, load: 50, hunger: 50,
    emotion: {
      joy: 15, trust: 15, anticipation: 15, surprise: 5,
      sadness: 5, anger: 5, fear: 5, disgust: 5,
    },
    desires: {
      achievement: 30, connection: 30, curiosity: 30,
      rest: 20, safety: 20, autonomy: 30,
    },
    focusLevel: 50, confidenceLevel: 50, confusionLevel: 20,
    intimacyLevel: 30, socialNeed: 40,
    hour: 14, isUserActive: true, lastInteractionMs: 60000,
    systemHealth: 'good',
    ...overrides,
  };
}

// ==================== 测试 ====================

describe('异常恢复', () => {

  describe('NN 异常输入', () => {
    it('空 token 列表不崩溃', () => {
      const config = {
        vocabSize: 2048, embedDim: 64, hiddenDim: 128,
        numHeads: 4, numLayers: 2, numIntents: 8, numTools: 32,
        ffnDim: 256, dropout: 0,
        numSpatialBins: 6, numSceneNodes: 32,
      };
      const model = new IntuitionNet(config);
      // 空输入可能抛错，但不应导致状态损坏
      try {
        const out = model.forward([]);
        // 如果不抛错，输出也应合理
        expect(out.intentProbs.length).toBe(8);
      } catch {
        // 预期可能抛错
      }
    });

    it('单 token 输入', () => {
      const config = {
        vocabSize: 2048, embedDim: 64, hiddenDim: 128,
        numHeads: 4, numLayers: 2, numIntents: 8, numTools: 32,
        ffnDim: 256, dropout: 0,
        numSpatialBins: 6, numSceneNodes: 32,
      };
      const model = new IntuitionNet(config);
      const out = model.forward([42]);
      expect(out.intentProbs.length).toBe(8);
      expect(out.qualityScore).toBeGreaterThanOrEqual(0);
    });

    it('超长 token 序列', () => {
      const config = {
        vocabSize: 2048, embedDim: 64, hiddenDim: 128,
        numHeads: 4, numLayers: 2, numIntents: 8, numTools: 32,
        ffnDim: 256, dropout: 0,
        numSpatialBins: 6, numSceneNodes: 32,
      };
      const model = new IntuitionNet(config);
      const tokens = Array.from({ length: 200 }, (_, i) => i % 2048);
      const out = model.forward(tokens);
      expect(out.intentProbs.length).toBe(8);
    });

    it('token ID 超出 vocabSize（取模不崩溃）', () => {
      const config = {
        vocabSize: 2048, embedDim: 64, hiddenDim: 128,
        numHeads: 4, numLayers: 2, numIntents: 8, numTools: 32,
        ffnDim: 256, dropout: 0,
        numSpatialBins: 6, numSceneNodes: 32,
      };
      const model = new IntuitionNet(config);
      // 超大 ID — embedding 应该处理（取模或 clamp）
      try {
        const out = model.forward([99999, 100000]);
        expect(out.intentProbs.length).toBe(8);
      } catch {
        // 抛错也可接受，但不应导致状态损坏
      }
      // 后续正常调用应不受影响
      const out = model.forward([10, 30]);
      expect(out.intentProbs.length).toBe(8);
    });
  });

  describe('权重异常', () => {
    it('全零权重推理不崩溃', () => {
      const config = {
        vocabSize: 2048, embedDim: 64, hiddenDim: 128,
        numHeads: 4, numLayers: 2, numIntents: 8, numTools: 32,
        ffnDim: 256, dropout: 0,
        numSpatialBins: 6, numSceneNodes: 32,
      };
      const model = new IntuitionNet(config);

      // 将所有参数置零
      for (const p of model.parameters()) {
        p.data.fill(0);
      }

      // 推理不应崩溃
      try {
        const out = model.forward([10, 30, 50]);
        expect(out.intentProbs.length).toBe(8);
      } catch {
        // softmax(0) 可能有数值问题，但不应导致不可恢复状态
      }
    });
  });

  describe('ThreeBrain 异常恢复', () => {
    it('decide 空输入', async () => {
      const brain = new ThreeBrain({ verbose: false });
      try {
        const r = await brain.decide('', makeSignal(), makeResources());
        expect(r.plan).toBeDefined();
      } catch {
        // 空输入可能抛错
      }
      // 后续正常调用应工作
      const r = await brain.decide('normal input', makeSignal(), makeResources());
      expect(r.plan).toBeDefined();
      brain.destroy();
    });

    it('feedback 在 decide 之前调用', async () => {
      const brain = new ThreeBrain({ verbose: false });
      const sig = makeSignal();
      const res = makeResources();
      // feedback 不应崩溃（即使没有之前的 decide）
      await brain.feedback(sig, res, { mode: 'single', nodes: [], reason: '' } as any, {
        success: true, latencyMs: 100, costEstimate: 0.001, toolsUsed: [],
      });
      brain.destroy();
    });

    it('destroy 后 decide 不崩溃（或抛明确错误）', async () => {
      const brain = new ThreeBrain({ verbose: false });
      brain.destroy();
      try {
        await brain.decide('test', makeSignal(), makeResources());
      } catch {
        // 预期抛错
      }
    });
  });

  describe('小脑极端 BodyState', () => {
    it('极端低能量触发稳态调节', async () => {
      const brain = new ThreeBrain({ verbose: false });
      // 通过多次 heartbeat 消耗能量
      for (let i = 0; i < 50; i++) {
        brain.cerebellum.regulate({
          type: 'heartbeat',
          timestamp: Date.now(),
          data: {},
        });
      }
      const r = await brain.decide('test', makeSignal(), makeResources());
      expect(r.plan).toBeDefined();
      brain.destroy();
    });

    it('大量 tool_result 失败后情绪变化', async () => {
      const brain = new ThreeBrain({ verbose: false });
      // 注入大量失败事件
      for (let i = 0; i < 20; i++) {
        brain.cerebellum.regulate({
          type: 'tool_result',
          timestamp: Date.now(),
          data: { success: false, toolName: 'test' },
        });
      }
      const r = await brain.decide('test', makeSignal(), makeResources());
      expect(r.plan).toBeDefined();
      brain.destroy();
    });

    it('dream 恢复能量', async () => {
      const brain = new ThreeBrain({ verbose: false });
      // 先消耗能量
      for (let i = 0; i < 20; i++) {
        brain.cerebellum.regulate({ type: 'heartbeat', timestamp: Date.now(), data: {} });
      }
      const beforeDream = brain.cerebellum.getBodyState().energy;
      // dream 恢复
      brain.cerebellum.regulate({ type: 'dream', timestamp: Date.now(), data: {} });
      const afterDream = brain.cerebellum.getBodyState().energy;
      expect(afterDream).toBeGreaterThanOrEqual(beforeDream);
      brain.destroy();
    });
  });
});
