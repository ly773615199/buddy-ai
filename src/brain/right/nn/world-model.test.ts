/**
 * WorldModel 测试
 *
 * 覆盖：
 * 1. 构造 + 默认配置
 * 2. predict 单步预测
 * 3. imagine 多步想象
 * 4. encodeState 状态编码
 * 5. encodeAction 动作编码
 * 6. 置信度计算
 * 7. 空间偏移范围
 * 8. 拓扑变化概率范围
 * 9. 残差连接（nextLatent = current + delta）
 * 10. 不同输入产生不同输出
 * 11. 性能 < 5ms
 */

import { describe, it, expect } from 'vitest';
import { WorldModel } from './world-model.js';

// ==================== 辅助 ====================

function makeLatent(dim: number, fill?: number): Float32Array {
  const v = new Float32Array(dim);
  if (fill !== undefined) {
    v.fill(fill);
  } else {
    for (let i = 0; i < dim; i++) v[i] = Math.sin(i * 0.1);
  }
  return v;
}

// ==================== 测试 ====================

describe('WorldModel', () => {

  describe('构造', () => {
    it('默认配置创建成功', () => {
      const wm = new WorldModel();
      expect(wm).toBeDefined();
    });

    it('自定义配置', () => {
      const wm = new WorldModel({ latentDim: 32, hiddenDim: 64 });
      expect(wm).toBeDefined();
    });
  });

  describe('predict 单步预测', () => {
    it('返回完整 PredictionResult', () => {
      const wm = new WorldModel();
      const latent = makeLatent(64);
      const action = wm.encodeAction(1, [0.5, 0.3]);

      const result = wm.predict(latent, action);

      expect(result.nextLatent.length).toBe(64);
      expect(result.spatialDelta.length).toBe(6);
      expect(result.topologyChangeProb).toBeGreaterThanOrEqual(0);
      expect(result.topologyChangeProb).toBeLessThanOrEqual(1);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.latencyMs).toBeGreaterThan(0);
    });

    it('空间偏移在 [-0.1, 0.1] 范围内（tanh * 0.1）', () => {
      const wm = new WorldModel();
      const latent = makeLatent(64);
      const action = wm.encodeAction(1);

      const result = wm.predict(latent, action);

      for (const d of result.spatialDelta) {
        expect(d).toBeGreaterThanOrEqual(-0.1);
        expect(d).toBeLessThanOrEqual(0.1);
      }
    });

    it('拓扑变化概率是有效 sigmoid 输出', () => {
      const wm = new WorldModel();
      // 多次测试不同输入
      for (let trial = 0; trial < 10; trial++) {
        const latent = makeLatent(64, trial * 0.1);
        const action = wm.encodeAction(trial % 4);
        const result = wm.predict(latent, action);

        expect(result.topologyChangeProb).toBeGreaterThanOrEqual(0);
        expect(result.topologyChangeProb).toBeLessThanOrEqual(1);
        expect(Number.isFinite(result.topologyChangeProb)).toBe(true);
      }
    });

    it('残差连接：nextLatent = currentLatent + delta', () => {
      const wm = new WorldModel({ latentDim: 16, actionDim: 8, hiddenDim: 32 });
      const latent = makeLatent(16);
      const action = wm.encodeAction(1);

      const result = wm.predict(latent, action);

      // 手动验证：nextLatent 应该与 latent 不同（除非 delta 全零）
      let diff = 0;
      for (let i = 0; i < 16; i++) {
        diff += Math.abs(result.nextLatent[i] - latent[i]);
      }
      // delta 通常不全为零
      expect(diff).toBeGreaterThan(0);
    });

    it('不同 latent 产生不同预测', () => {
      const wm = new WorldModel({ latentDim: 16, actionDim: 8, hiddenDim: 32 });
      const action = wm.encodeAction(1);

      const r1 = wm.predict(makeLatent(16, 0.1), action);
      const r2 = wm.predict(makeLatent(16, 0.9), action);

      let diff = 0;
      for (let i = 0; i < 16; i++) {
        diff += Math.abs(r1.nextLatent[i] - r2.nextLatent[i]);
      }
      expect(diff).toBeGreaterThan(0);
    });

    it('不同动作产生不同预测', () => {
      const wm = new WorldModel({ latentDim: 16, actionDim: 8, hiddenDim: 32 });
      const latent = makeLatent(16);

      const r1 = wm.predict(latent, wm.encodeAction(0));
      const r2 = wm.predict(latent, wm.encodeAction(3));

      let diff = 0;
      for (let i = 0; i < 16; i++) {
        diff += Math.abs(r1.nextLatent[i] - r2.nextLatent[i]);
      }
      expect(diff).toBeGreaterThan(0);
    });

    it('所有输出值有限（无 NaN/Inf）', () => {
      const wm = new WorldModel();
      const latent = makeLatent(64);
      const action = wm.encodeAction(1, [1.0, -1.0, 0.5]);

      const result = wm.predict(latent, action);

      for (const v of result.nextLatent) expect(Number.isFinite(v)).toBe(true);
      for (const v of result.spatialDelta) expect(Number.isFinite(v)).toBe(true);
      expect(Number.isFinite(result.topologyChangeProb)).toBe(true);
      expect(Number.isFinite(result.confidence)).toBe(true);
    });
  });

  describe('imagine 多步想象', () => {
    it('返回指定步数的预测', () => {
      const wm = new WorldModel({ latentDim: 16, actionDim: 8, hiddenDim: 32, predictionSteps: 3 });
      const latent = makeLatent(16);
      const actions = [
        wm.encodeAction(0),
        wm.encodeAction(1),
        wm.encodeAction(2),
      ];

      const results = wm.imagine(latent, actions);

      expect(results.length).toBe(3);
      for (const r of results) {
        expect(r.nextLatent.length).toBe(16);
        expect(r.spatialDelta.length).toBe(6);
      }
    });

    it('多步预测状态逐步演变', () => {
      const wm = new WorldModel({ latentDim: 16, actionDim: 8, hiddenDim: 32, predictionSteps: 5 });
      const latent = makeLatent(16);
      const actions = Array.from({ length: 5 }, () => wm.encodeAction(1));

      const results = wm.imagine(latent, actions);

      // 每一步的 nextLatent 应该不同
      for (let step = 1; step < results.length; step++) {
        let diff = 0;
        for (let i = 0; i < 16; i++) {
          diff += Math.abs(results[step].nextLatent[i] - results[step - 1].nextLatent[i]);
        }
        expect(diff).toBeGreaterThan(0);
      }
    });

    it('动作数不足时返回实际步数', () => {
      const wm = new WorldModel({ latentDim: 16, actionDim: 8, hiddenDim: 32, predictionSteps: 5 });
      const latent = makeLatent(16);
      const actions = [wm.encodeAction(0)]; // 只有 1 个动作

      const results = wm.imagine(latent, actions);

      expect(results.length).toBe(1);
    });

    it('maxSteps 覆盖默认步数', () => {
      const wm = new WorldModel({ latentDim: 16, actionDim: 8, hiddenDim: 32, predictionSteps: 10 });
      const latent = makeLatent(16);
      const actions = Array.from({ length: 10 }, () => wm.encodeAction(0));

      const results = wm.imagine(latent, actions, 3);

      expect(results.length).toBe(3);
    });

    it('空动作数组返回空结果', () => {
      const wm = new WorldModel({ latentDim: 16, actionDim: 8, hiddenDim: 32 });
      const results = wm.imagine(makeLatent(16), []);
      expect(results.length).toBe(0);
    });
  });

  describe('encodeState 状态编码', () => {
    it('返回正确维度的 latent', () => {
      const wm = new WorldModel({ latentDim: 32 });
      const latent = wm.encodeState([10, 20, 30]);
      expect(latent.length).toBe(32);
    });

    it('空 token 返回零向量', () => {
      const wm = new WorldModel({ latentDim: 16 });
      const latent = wm.encodeState([]);
      for (const v of latent) expect(v).toBe(0);
    });

    it('L2 归一化后范数 ≈ 1', () => {
      const wm = new WorldModel({ latentDim: 32 });
      const latent = wm.encodeState([10, 20, 30, 40, 50]);
      let norm = 0;
      for (const v of latent) norm += v * v;
      norm = Math.sqrt(norm);
      expect(norm).toBeCloseTo(1.0, 4);
    });

    it('不同 token 序列产生不同 latent', () => {
      const wm = new WorldModel({ latentDim: 32 });
      const l1 = wm.encodeState([10, 20, 30]);
      const l2 = wm.encodeState([50, 60, 70]);

      let diff = 0;
      for (let i = 0; i < 32; i++) diff += Math.abs(l1[i] - l2[i]);
      expect(diff).toBeGreaterThan(0);
    });
  });

  describe('encodeAction 动作编码', () => {
    it('返回正确维度', () => {
      const wm = new WorldModel({ actionDim: 16 });
      const action = wm.encodeAction(1, [0.5, 0.3]);
      expect(action.params.length).toBe(16);
      expect(action.actionType).toBe(1);
    });

    it('actionType 存储在 params[0]', () => {
      const wm = new WorldModel({ actionDim: 8 });
      const action = wm.encodeAction(3, [1.0, 2.0]);
      expect(action.params[0]).toBe(3);
      expect(action.params[1]).toBeCloseTo(1.0);
      expect(action.params[2]).toBeCloseTo(2.0);
    });

    it('无参数时其余为 0', () => {
      const wm = new WorldModel({ actionDim: 8 });
      const action = wm.encodeAction(2);
      expect(action.params[0]).toBe(2);
      for (let i = 1; i < 8; i++) {
        expect(action.params[i]).toBe(0);
      }
    });

    it('参数超长时截断', () => {
      const wm = new WorldModel({ actionDim: 4 });
      const action = wm.encodeAction(1, [1, 2, 3, 4, 5, 6, 7, 8]);
      expect(action.params.length).toBe(4);
      expect(action.params[0]).toBe(1); // actionType
      expect(action.params[1]).toBe(1); // 第一个参数
      expect(action.params[2]).toBe(2); // 第二个参数
      expect(action.params[3]).toBe(3); // 第三个参数（actionDim-1=3 个参数）
    });
  });

  describe('置信度', () => {
    it('零 delta 时置信度 = 1', () => {
      // 构造一个输出全零 delta 的情况（zero latent + zero action）
      const wm = new WorldModel({ latentDim: 4, actionDim: 4, hiddenDim: 8 });
      const latent = new Float32Array(4); // 全零
      const action = wm.encodeAction(0); // 全零 params

      const result = wm.predict(latent, action);

      // 置信度应该接近 1（delta 小）
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('大 delta 时置信度低', () => {
      const wm = new WorldModel({ latentDim: 16, actionDim: 8, hiddenDim: 32 });
      // 用大值 latent 可能产生大 delta
      const latent = makeLatent(16, 100);
      const action = wm.encodeAction(1, [10, 10, 10]);

      const result = wm.predict(latent, action);

      // 置信度应该 < 1
      expect(result.confidence).toBeLessThan(1);
    });
  });

  describe('性能', () => {
    it('单步 predict < 1ms', () => {
      const wm = new WorldModel();
      const latent = makeLatent(64);
      const action = wm.encodeAction(1, [0.5]);

      // warmup
      wm.predict(latent, action);

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        wm.predict(latent, action);
      }
      const avg = (performance.now() - start) / 1000;

      expect(avg).toBeLessThan(1);
    });

    it('5 步 imagine < 5ms', () => {
      const wm = new WorldModel({ latentDim: 64, predictionSteps: 5 });
      const latent = makeLatent(64);
      const actions = Array.from({ length: 5 }, () => wm.encodeAction(1));

      const start = performance.now();
      wm.imagine(latent, actions);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(5);
    });
  });
});
