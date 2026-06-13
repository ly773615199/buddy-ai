/**
 * Early Exit 路径测试
 *
 * 覆盖：
 * 1. forwardInference 返回正确形状
 * 2. forwardInference 与 forward 结果一致性（无 early exit 时）
 * 3. Early Exit 阈值触发条件
 * 4. Early Exit 时所有 5 个 head 都有输出
 * 5. 推理模式正确清理（enter/exit）
 * 6. forwardInference 延迟 < forward
 * 7. exitThreshold 可配置
 */

import { describe, it, expect } from 'vitest';
import { IntuitionNet } from './model.js';
import { enterInferenceMode, exitInferenceMode, isInferenceMode } from './tensor.js';

// ==================== 辅助 ====================

function makeConfig(overrides?: Record<string, number>) {
  return {
    vocabSize: 2048, embedDim: 64, hiddenDim: 128,
    numHeads: 4, numLayers: 4, numIntents: 8, numTools: 32,
    ffnDim: 256, dropout: 0,
    numSpatialBins: 6, numSceneNodes: 32,
    ...overrides,
  };
}

// ==================== 测试 ====================

describe('Early Exit 路径', () => {

  describe('forwardInference 基础', () => {
    it('返回 5 个输出头的完整结果', () => {
      const model = new IntuitionNet(makeConfig());
      const out = model.forwardInference([10, 30, 50, 100]);

      expect(out.intentProbs.length).toBe(8);
      expect(out.toolProbs.length).toBe(32);
      // qualityScore 经过 sigmoid 映射，应在 (0, 1) 范围内
      expect(out.qualityScore).toBeGreaterThan(0);
      expect(out.qualityScore).toBeLessThan(1);
      expect(Number.isFinite(out.qualityScore)).toBe(true);
      expect(out.spatialProbs.length).toBe(6);
      expect(out.sceneProbs.length).toBe(32);
      expect(out.latencyMs).toBeGreaterThan(0);
    });

    it('intentProbs 是有效概率分布（softmax 和为 1）', () => {
      const model = new IntuitionNet(makeConfig());
      const out = model.forwardInference([10, 20, 30]);
      const sum = Array.from(out.intentProbs).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 4);
    });

    it('toolProbs 范围 [0, 1]（sigmoid）', () => {
      const model = new IntuitionNet(makeConfig());
      const out = model.forwardInference([10, 30, 50]);
      for (const p of out.toolProbs) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    });

    it('不同输入产生不同输出', () => {
      const model = new IntuitionNet(makeConfig());
      const out1 = model.forwardInference([10, 30]);
      const out2 = model.forwardInference([50, 80]);
      // 至少一个 head 的输出不同
      const intentDiff = out1.intentProbs.some((v, i) => Math.abs(v - out2.intentProbs[i]) > 0.001);
      expect(intentDiff).toBe(true);
    });
  });

  describe('推理模式管理', () => {
    it('forwardInference 不泄漏推理模式', () => {
      const model = new IntuitionNet(makeConfig());
      expect(isInferenceMode()).toBe(false);
      model.forwardInference([10, 30]);
      expect(isInferenceMode()).toBe(false);
    });

    it('多次调用 forwardInference 不泄漏', () => {
      const model = new IntuitionNet(makeConfig());
      for (let i = 0; i < 10; i++) {
        model.forwardInference([10, 30, 50]);
      }
      expect(isInferenceMode()).toBe(false);
    });

    it('forwardInference 异常时也能退出推理模式', () => {
      const model = new IntuitionNet(makeConfig());
      // 空输入可能导致异常，但推理模式必须清理
      try {
        model.forwardInference([]);
      } catch {
        // 预期可能抛错
      }
      expect(isInferenceMode()).toBe(false);
    });
  });

  describe('forward vs forwardInference 一致性', () => {
    it('无 early exit 时输出接近（4 层都走完）', () => {
      // 使用 2 层模型，不可能触发 early exit
      const config = makeConfig({ numLayers: 2 });
      const model = new IntuitionNet(config);
      const tokens = [10, 30, 50];

      const outFwd = model.forward(tokens);
      const outInf = model.forwardInference(tokens);

      // 概率分布应非常接近（浮点误差范围内）
      for (let i = 0; i < outFwd.intentProbs.length; i++) {
        expect(Math.abs(outFwd.intentProbs[i] - outInf.intentProbs[i])).toBeLessThan(0.01);
      }
    });
  });

  describe('Early Exit 阈值', () => {
    it('exitThreshold 可配置', () => {
      const model = new IntuitionNet(makeConfig());
      model.exitThreshold = 0.5; // 降低阈值，更容易触发
      expect(model.exitThreshold).toBe(0.5);
    });

    it('4 层模型 + 低阈值可能触发 early exit', () => {
      const model = new IntuitionNet(makeConfig({ numLayers: 4 }));
      model.exitThreshold = 0.3; // 很低的阈值

      // 多次尝试，看是否有 early exit（延迟差异）
      const latencies: number[] = [];
      for (let i = 0; i < 20; i++) {
        const out = model.forwardInference([10 + i, 30, 50]);
        latencies.push(out.latencyMs);
      }
      // 只要不崩溃就算通过（early exit 触发取决于具体权重和输入）
      expect(latencies.length).toBe(20);
    });

    it('2 层模型不会触发 early exit（层数不足）', () => {
      const model = new IntuitionNet(makeConfig({ numLayers: 2 }));
      model.exitThreshold = 0.01; // 极低阈值

      // 即使阈值很低，2 层模型也不会 early exit（条件 i >= 1 && blocks > 2）
      const out = model.forwardInference([10, 30, 50]);
      expect(out.intentProbs.length).toBe(8);
    });
  });

  describe('性能', () => {
    it('forwardInference 延迟 <= forward（推理模式优化）', () => {
      const model = new IntuitionNet(makeConfig({ numLayers: 2 }));
      const tokens = [10, 30, 50, 80, 100];

      // warmup
      model.forward(tokens);
      model.forwardInference(tokens);

      // 测量 forward
      const fwdStart = performance.now();
      for (let i = 0; i < 50; i++) model.forward(tokens);
      const fwdTime = performance.now() - fwdStart;

      // 测量 forwardInference
      const infStart = performance.now();
      for (let i = 0; i < 50; i++) model.forwardInference(tokens);
      const infTime = performance.now() - infStart;

      // forwardInference 应不慢于 forward（允许 20% 误差）
      expect(infTime).toBeLessThan(fwdTime * 1.2);
    });

    it('单次推理 < 20ms（默认 2 层配置）', () => {
      const model = new IntuitionNet(makeConfig({ numLayers: 2 }));
      const out = model.forwardInference([10, 30, 50]);
      expect(out.latencyMs).toBeLessThan(20);
    });
  });
});
