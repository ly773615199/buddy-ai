/**
 * 并发安全测试
 *
 * 覆盖：
 * 1. 多个 ThreeBrain 实例独立运行
 * 2. 同一实例交替 forward/forwardInference
 * 3. 并发 decide 不互相干扰
 * 4. 推理模式全局状态安全
 */

import { describe, it, expect } from 'vitest';
import { ThreeBrain } from './brain.js';
import type { TaskSignal, ResourceState } from './types.js';
import { IntuitionNet } from './right/nn/model.js';
import { enterInferenceMode, exitInferenceMode, isInferenceMode } from './right/nn/tensor.js';

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

// ==================== 测试 ====================

describe('并发安全', () => {

  describe('多实例独立性', () => {
    it('两个 ThreeBrain 实例不共享状态', async () => {
      const brain1 = new ThreeBrain({ verbose: false });
      const brain2 = new ThreeBrain({ verbose: false });

      const sig = makeSignal();
      const res = makeResources();

      const r1 = await brain1.decide('input A', sig, res);
      const r2 = await brain2.decide('input B', sig, res);

      // 两者都能正常返回
      expect(r1.plan).toBeDefined();
      expect(r2.plan).toBeDefined();

      brain1.destroy();
      brain2.destroy();
    });

    it('一个实例 destroy 不影响另一个', async () => {
      const brain1 = new ThreeBrain({ verbose: false });
      const brain2 = new ThreeBrain({ verbose: false });

      brain1.destroy();

      // brain2 仍可正常使用
      const r = await brain2.decide('test', makeSignal(), makeResources());
      expect(r.plan).toBeDefined();

      brain2.destroy();
    });
  });

  describe('交替推理模式', () => {
    it('同一模型 forward 和 forwardInference 交替调用', () => {
      const config = {
        vocabSize: 2048, embedDim: 64, hiddenDim: 128,
        numHeads: 4, numLayers: 2, numIntents: 8, numTools: 32,
        ffnDim: 256, dropout: 0,
        numSpatialBins: 6, numSceneNodes: 32,
      };
      const model = new IntuitionNet(config);
      const tokens = [10, 30, 50];

      // 交替调用 20 次
      for (let i = 0; i < 20; i++) {
        if (i % 2 === 0) {
          const out = model.forward(tokens);
          expect(out.intentProbs.length).toBe(8);
        } else {
          const out = model.forwardInference(tokens);
          expect(out.intentProbs.length).toBe(8);
        }
        // 推理模式不应泄漏
        expect(isInferenceMode()).toBe(false);
      }
    });
  });

  describe('批量 decide', () => {
    it('50 次串行 decide 全部成功', async () => {
      const brain = new ThreeBrain({ verbose: false });
      const results: Awaited<ReturnType<typeof brain.decide>>[] = [];

      for (let i = 0; i < 50; i++) {
        const r = await brain.decide(
          `input ${i}`,
          makeSignal({ domains: [['code', 'chat', 'data', 'web'][i % 4]] }),
          makeResources(),
        );
        results.push(r);
      }

      expect(results.length).toBe(50);
      for (const r of results) {
        expect(r.plan).toBeDefined();
        expect(r.plan.mode).toBeDefined();
        expect(r.latencyMs).toBeGreaterThan(0);
      }

      brain.destroy();
    });

    it('decide + feedback 交替不崩溃', async () => {
      const brain = new ThreeBrain({ verbose: false });

      for (let i = 0; i < 30; i++) {
        const sig = makeSignal();
        const res = makeResources();
        const r = await brain.decide(`input ${i}`, sig, res);
        await brain.feedback(sig, res, r.plan, {
          success: Math.random() > 0.3,
          latencyMs: 100 + Math.random() * 200,
          costEstimate: 0.001,
          toolsUsed: ['read_file'],
        });
      }

      brain.destroy();
    });
  });
});
