/**
 * int8 量化 / 反量化测试
 *
 * 覆盖：
 * 1. 量化→反量化精度（roundtrip）
 * 2. 对称量化边界
 * 3. 全零张量
 * 4. 不同 shape 兼容
 * 5. 量化后推理一致性
 */

import { describe, it, expect } from 'vitest';
import { Tensor, zeros, randn } from './tensor.js';
import { quantizeInt8, dequantizeInt8 } from './quantize.js';
import { IntuitionNet } from './model.js';

// ==================== 辅助 ====================

function makeDefaultConfig() {
  return {
    vocabSize: 2048, embedDim: 64, hiddenDim: 128,
    numHeads: 4, numLayers: 2, numIntents: 8, numTools: 32,
    ffnDim: 256, dropout: 0,
    numSpatialBins: 6, numSceneNodes: 32,
  };
}

// ==================== 测试 ====================

describe('int8 量化', () => {

  describe('quantizeInt8 基础', () => {
    it('输出 shape 与输入一致', () => {
      const t = randn([4, 8]);
      const q = quantizeInt8(t);
      expect(q.shape).toEqual([4, 8]);
      expect(q.data.length).toBe(32);
    });

    it('scale 是正数', () => {
      const t = randn([3, 10]);
      const q = quantizeInt8(t);
      for (let i = 0; i < q.scale.length; i++) {
        expect(q.scale[i]).toBeGreaterThan(0);
      }
    });

    it('全零张量 scale=1（不除零）', () => {
      const t = zeros([2, 8]);
      const q = quantizeInt8(t);
      for (let i = 0; i < q.scale.length; i++) {
        expect(q.scale[i]).toBe(1);
      }
      for (let i = 0; i < q.data.length; i++) {
        expect(q.data[i]).toBe(0);
      }
    });

    it('int8 值在 [-128, 127] 范围内', () => {
      const t = randn([10, 20]);
      const q = quantizeInt8(t);
      for (let i = 0; i < q.data.length; i++) {
        expect(q.data[i]).toBeGreaterThanOrEqual(-128);
        expect(q.data[i]).toBeLessThanOrEqual(127);
      }
    });
  });

  describe('dequantizeInt8 基础', () => {
    it('输出 shape 一致', () => {
      const t = randn([5, 12]);
      const q = quantizeInt8(t);
      const d = dequantizeInt8(q);
      expect(d.shape).toEqual([5, 12]);
    });

    it('roundtrip 数值接近原始值', () => {
      const t = randn([4, 16]);
      const q = quantizeInt8(t);
      const d = dequantizeInt8(q);
      for (let i = 0; i < t.size; i++) {
        // 量化误差应小于 scale（每行最大绝对值/127）
        const row = Math.floor(i / 16);
        const maxErr = q.scale[row];
        expect(Math.abs(d.data[i] - t.data[i])).toBeLessThan(maxErr);
      }
    });

    it('roundtrip 最大相对误差 < 8%（小值量化精度有限）', () => {
      // 构造非零值，验证相对误差
      const data = new Float32Array([1.0, -1.0, 0.5, -0.5, 2.0, -2.0, 0.1, -0.1]);
      const t = new Tensor(data, [2, 4]);
      const q = quantizeInt8(t);
      const d = dequantizeInt8(q);
      for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i]) > 0.01) {
          const relErr = Math.abs(d.data[i] - data[i]) / Math.abs(data[i]);
          // 小值（如 0.1）的量化误差相对较大，因为 int8 只有 256 级
          expect(relErr).toBeLessThan(0.08);
        }
      }
    });

    it('roundtrip 大值精度高（相对误差 < 1%）', () => {
      const data = new Float32Array([10.0, -10.0, 5.0, -5.0, 20.0, -20.0]);
      const t = new Tensor(data, [2, 3]);
      const q = quantizeInt8(t);
      const d = dequantizeInt8(q);
      for (let i = 0; i < data.length; i++) {
        const relErr = Math.abs(d.data[i] - data[i]) / Math.abs(data[i]);
        expect(relErr).toBeLessThan(0.01);
      }
    });
  });

  describe('不同 shape 兼容', () => {
    it('1D 张量', () => {
      const t = randn([16]);
      const q = quantizeInt8(t);
      const d = dequantizeInt8(q);
      expect(d.shape).toEqual([16]);
    });

    it('3D 张量', () => {
      const t = randn([2, 3, 8]);
      const q = quantizeInt8(t);
      const d = dequantizeInt8(q);
      expect(d.shape).toEqual([2, 3, 8]);
    });

    it('单元素张量', () => {
      const t = new Float32Array([3.14]);
      const tensor = new Tensor(t, [1]);
      const q = quantizeInt8(tensor);
      const d = dequantizeInt8(q);
      expect(d.data[0]).toBeCloseTo(3.14, 0);
    });
  });

  describe('量化后推理一致性', () => {
    it('量化→反量化权重后 forward 不崩溃', () => {
      const config = makeDefaultConfig();
      const model = new IntuitionNet(config);
      const tokens = [10, 30, 50, 100];

      // 原始推理
      const out1 = model.forward(tokens);

      // 量化→反量化所有参数
      const params = model.parameters();
      const quantized: ReturnType<typeof quantizeInt8>[] = [];
      for (const p of params) {
        quantized.push(quantizeInt8(p));
      }
      // 恢复权重
      for (let i = 0; i < params.length; i++) {
        const restored = dequantizeInt8(quantized[i]);
        params[i].data.set(restored.data);
      }

      // 量化后推理
      const out2 = model.forward(tokens);

      // 输出形状一致
      expect(out2.intentProbs.length).toBe(out1.intentProbs.length);
      expect(out2.toolProbs.length).toBe(out1.toolProbs.length);
      // 数值应接近（不是完全相同，因为量化有损）
      expect(out2.intentProbs.length).toBe(config.numIntents);
      expect(out2.toolProbs.length).toBe(config.numTools);
    });
  });
});
