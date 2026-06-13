/**
 * NN 内核正确性测试
 *
 * 测试：
 * 1. Loss 函数正确性
 * 2. Attention 输入输出正确性
 * 3. FFN 前后维度一致
 * 4. 输出头概率分布约束
 * 5. Tensor 基础操作
 */

import { describe, it, expect } from 'vitest';
import { Tensor, zeros, randn, matmul, softmax, gelu, layerNorm, sigmoid } from './tensor.js';
import { MultiHeadAttention } from './attention.js';
import { FeedForward } from './ffn.js';
import { OutputHeads } from './output-heads.js';
import {
  crossEntropyLoss, crossEntropyGrad,
  binaryCrossEntropyLoss, binaryCrossEntropyGrad,
  mseLoss, mseGrad,
} from '../training/loss.js';

// ==================== Loss 函数 ====================

describe('Loss 函数', () => {
  it('crossEntropyGrad = p_i - y_i', () => {
    const probs = new Float32Array([0.1, 0.7, 0.2]);
    const target = 1;
    const grad = crossEntropyGrad(probs, target);

    expect(grad[0]).toBeCloseTo(0.1, 6);   // 0.1 - 0
    expect(grad[1]).toBeCloseTo(-0.3, 6);  // 0.7 - 1
    expect(grad[2]).toBeCloseTo(0.2, 6);   // 0.2 - 0
  });

  it('crossEntropyGrad 和为 0', () => {
    const probs = new Float32Array([0.2, 0.5, 0.3]);
    const grad = crossEntropyGrad(probs, 0);
    const sum = grad.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(0, 5);
  });

  it('binaryCrossEntropyGrad = (p_i - y_i) / n', () => {
    const probs = new Float32Array([0.3, 0.8, 0.5]);
    const targets = [1, 0, 1];
    const grad = binaryCrossEntropyGrad(probs, targets);

    expect(grad[0]).toBeCloseTo((0.3 - 1) / 3, 6);
    expect(grad[1]).toBeCloseTo((0.8 - 0) / 3, 6);
    expect(grad[2]).toBeCloseTo((0.5 - 1) / 3, 6);
  });

  it('mseGrad = 2 * (predicted - target)', () => {
    expect(mseGrad(0.6, 0.8)).toBeCloseTo(-0.4, 6);
    expect(mseGrad(1.0, 0.5)).toBeCloseTo(1.0, 6);
    expect(mseGrad(0.5, 0.5)).toBeCloseTo(0, 6);
  });

  it('crossEntropyLoss 在概率为 0 时不崩溃', () => {
    const probs = new Float32Array([0, 1, 0]);
    const loss = crossEntropyLoss(probs, 0);
    expect(loss).toBeGreaterThan(0);
    expect(Number.isFinite(loss)).toBe(true);
  });

  it('binaryCrossEntropyLoss 对称性', () => {
    const loss1 = binaryCrossEntropyLoss(new Float32Array([0.3]), [1]);
    const loss2 = binaryCrossEntropyLoss(new Float32Array([0.7]), [0]);
    expect(loss1).toBeCloseTo(loss2, 6);
  });

  it('crossEntropyLoss 最优预测 → 最低损失', () => {
    const probs = new Float32Array([0.05, 0.9, 0.05]);
    expect(crossEntropyLoss(probs, 1)).toBeLessThan(crossEntropyLoss(probs, 0));
  });

  it('mseLoss 非负', () => {
    expect(mseLoss(0, 1)).toBeGreaterThanOrEqual(0);
    expect(mseLoss(0.5, 0.5)).toBeGreaterThanOrEqual(0);
    expect(mseLoss(-1, 1)).toBeGreaterThanOrEqual(0);
  });

  it('crossEntropyLoss 单调性：p 越接近 target 损失越低', () => {
    const loss_low = crossEntropyLoss(new Float32Array([0.01, 0.98, 0.01]), 1);
    const loss_high = crossEntropyLoss(new Float32Array([0.4, 0.3, 0.3]), 1);
    expect(loss_low).toBeLessThan(loss_high);
  });
});

// ==================== Softmax 正确性 ====================

describe('Softmax 正确性', () => {
  it('输出和为 1（2D tensor）', () => {
    const t = new Tensor(new Float32Array([1, 2, 3, 4, 5]), [1, 5]);
    const s = softmax(t);
    const sum = Array.from(s.data).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it('所有值在 [0, 1]', () => {
    const t = new Tensor(new Float32Array([-10, 0, 10, 100]), [1, 4]);
    const s = softmax(t);
    for (const v of s.data) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('大数值不溢出', () => {
    const t = new Tensor(new Float32Array([1000, 1001, 1002]), [1, 3]);
    const s = softmax(t);
    for (const v of s.data) {
      expect(Number.isFinite(v)).toBe(true);
    }
    const sum = Array.from(s.data).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 3);
  });

  it('均匀输入 → 均匀输出', () => {
    const t = new Tensor(new Float32Array([5, 5, 5, 5]), [1, 4]);
    const s = softmax(t);
    for (const v of s.data) {
      expect(v).toBeCloseTo(0.25, 5);
    }
  });

  it('单调性：最大输入 → 最大输出', () => {
    const t = new Tensor(new Float32Array([1, 5, 3, 2, 4]), [1, 5]);
    const s = softmax(t);
    const maxIdx = Array.from(t.data).indexOf(Math.max(...t.data));
    const maxOutIdx = Array.from(s.data).indexOf(Math.max(...s.data));
    expect(maxOutIdx).toBe(maxIdx);
  });
});

// ==================== GELU 正确性 ====================

describe('GELU 激活', () => {
  it('gelu(0) ≈ 0', () => {
    const t = new Tensor(new Float32Array([0]), [1]);
    const out = gelu(t);
    expect(out.data[0]).toBeCloseTo(0, 3);
  });

  it('大正数 ≈ 恒等', () => {
    const t = new Tensor(new Float32Array([10]), [1]);
    const out = gelu(t);
    expect(out.data[0]).toBeCloseTo(10, 2);
  });

  it('大负数 ≈ 0', () => {
    const t = new Tensor(new Float32Array([-10]), [1]);
    const out = gelu(t);
    expect(out.data[0]).toBeCloseTo(0, 2);
  });

  it('单调递增（正数区间）', () => {
    const t = new Tensor(new Float32Array([0, 1, 2, 3, 4]), [5]);
    const out = gelu(t);
    for (let i = 1; i < 5; i++) {
      expect(out.data[i]).toBeGreaterThan(out.data[i - 1]);
    }
  });
});

// ==================== LayerNorm 正确性 ====================

describe('LayerNorm 正确性', () => {
  it('输出均值 ≈ 0', () => {
    const x = new Tensor(new Float32Array([1, 2, 3, 4, 5]), [5]);
    const w = new Tensor(new Float32Array([1, 1, 1, 1, 1]), [5]);
    const b = new Tensor(new Float32Array([0, 0, 0, 0, 0]), [5]);
    const out = layerNorm(x, w, b);
    const mean = Array.from(out.data).reduce((a, c) => a + c, 0) / 5;
    expect(mean).toBeCloseTo(0, 4);
  });

  it('输出方差 ≈ 1', () => {
    const x = new Tensor(new Float32Array([10, 20, 30, 40, 50]), [5]);
    const w = new Tensor(new Float32Array([1, 1, 1, 1, 1]), [5]);
    const b = new Tensor(new Float32Array([0, 0, 0, 0, 0]), [5]);
    const out = layerNorm(x, w, b);
    const mean = Array.from(out.data).reduce((a, c) => a + c, 0) / 5;
    const variance = Array.from(out.data).reduce((s, v) => s + (v - mean) ** 2, 0) / 5;
    expect(variance).toBeCloseTo(1, 2);
  });

  it('常数输入 → 输出为 0', () => {
    const x = new Tensor(new Float32Array([7, 7, 7, 7]), [4]);
    const w = new Tensor(new Float32Array([1, 1, 1, 1]), [4]);
    const b = new Tensor(new Float32Array([0, 0, 0, 0]), [4]);
    const out = layerNorm(x, w, b);
    for (const v of out.data) expect(v).toBeCloseTo(0, 5);
  });
});

// ==================== MultiHeadAttention ====================

describe('MultiHeadAttention', () => {
  it('输出形状正确', () => {
    const attn = new MultiHeadAttention(32, 2);
    const x = randn([4, 32]);
    const out = attn.forward(x, false);
    expect(out.shape).toEqual([4, 32]);
  });

  it('输出不含 NaN/Inf', () => {
    const attn = new MultiHeadAttention(32, 2);
    const out = attn.forward(randn([6, 32]), false);
    for (const v of out.data) expect(Number.isFinite(v)).toBe(true);
  });

  it('causal mask：位置 i 只看到 ≤i', () => {
    const attn = new MultiHeadAttention(16, 2);
    const x1 = randn([3, 16]);
    const x2 = randn([3, 16]);
    for (let i = 0; i < 2 * 16; i++) x2.data[i] = x1.data[i];

    const out1 = attn.forward(x1, true);
    const out2 = attn.forward(x2, true);

    // 位置 0 和 1 的输出应该相同
    for (let d = 0; d < 16; d++) {
      expect(out1.data[d]).toBeCloseTo(out2.data[d], 5);
      expect(out1.data[16 + d]).toBeCloseTo(out2.data[16 + d], 5);
    }
  });

  it('parameters() 数量正确', () => {
    expect(new MultiHeadAttention(32, 4).parameters().length).toBe(10);
  });

  it('不同输入 → 不同输出', () => {
    const attn = new MultiHeadAttention(32, 2);
    const out1 = attn.forward(randn([3, 32]), false);
    const out2 = attn.forward(randn([3, 32]), false);
    let anyDiff = false;
    for (let i = 0; i < out1.size; i++) {
      if (Math.abs(out1.data[i] - out2.data[i]) > 1e-6) { anyDiff = true; break; }
    }
    expect(anyDiff).toBe(true);
  });
});

// ==================== FeedForward ====================

describe('FeedForward', () => {
  it('输入输出维度一致', () => {
    const ffn = new FeedForward(32, 64);
    const out = ffn.forward(randn([4, 32]));
    expect(out.shape).toEqual([4, 32]);
  });

  it('输出不含 NaN', () => {
    const out = new FeedForward(32, 64).forward(randn([4, 32]));
    for (const v of out.data) expect(Number.isNaN(v)).toBe(false);
  });

  it('parameters() 数量正确', () => {
    expect(new FeedForward(32, 64).parameters().length).toBe(6);
  });
});

// ==================== OutputHeads ====================

describe('OutputHeads', () => {
  it('intent head softmax 和为 1', () => {
    const heads = new OutputHeads(32, 16, 8, 4, 6, 16);
    const out = heads.forward(randn([1, 32])); // 2D: [batch, dModel]
    const sum = Array.from(out.intent.data).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 4);
    for (const v of out.intent.data) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('tool head sigmoid 范围 [0, 1]', () => {
    const heads = new OutputHeads(32, 16, 8, 4, 6, 16);
    const out = heads.forward(randn([1, 32]));
    for (const v of out.tools.data) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('5 个输出头形状正确', () => {
    const heads = new OutputHeads(32, 16, 8, 4, 6, 16);
    const out = heads.forward(randn([1, 32]));
    // 输入是 [1, 32]，输出 pooled 取最后一个 token → [32]
    // 但 forward 内部可能保留 batch 维度
    expect(out.intent.shape[out.intent.shape.length - 1]).toBe(8);
    expect(out.tools.shape[out.tools.shape.length - 1]).toBe(4);
    expect(out.quality.shape[out.quality.shape.length - 1]).toBe(1);
    expect(out.spatial.shape[out.spatial.shape.length - 1]).toBe(6);
    expect(out.scene.shape[out.scene.shape.length - 1]).toBe(16);
  });

  it('parameters 总数 = 5 × 4', () => {
    expect(new OutputHeads(32, 16, 8, 4, 6, 16).parameters().length).toBe(20);
  });
});

// ==================== Tensor 基础 ====================

describe('Tensor 基础操作', () => {
  it('matmul 维度正确', () => {
    const a = new Tensor(new Float32Array([1, 2, 3, 4, 5, 6]), [2, 3]);
    const b = new Tensor(new Float32Array([7, 8, 9, 10, 11, 12]), [3, 2]);
    const c = matmul(a, b);
    expect(c.shape).toEqual([2, 2]);
    expect(c.data[0]).toBeCloseTo(58, 5);
    expect(c.data[1]).toBeCloseTo(64, 5);
  });

  it('matmul 单位矩阵不变', () => {
    const a = randn([3, 3]);
    const eye = new Tensor(new Float32Array([1,0,0, 0,1,0, 0,0,1]), [3, 3]);
    const c = matmul(a, eye);
    for (let i = 0; i < 9; i++) expect(c.data[i]).toBeCloseTo(a.data[i], 5);
  });

  it('Tensor sigmoid 范围 (0, 1]', () => {
    const t = new Tensor(new Float32Array([-100, -1, 0, 1, 100]), [5]);
    const out = sigmoid(t);
    for (const v of out.data) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1); // sigmoid(100) ≈ 1.0
    }
  });

  it('Tensor sigmoid(0) = 0.5', () => {
    const out = sigmoid(new Tensor(new Float32Array([0]), [1]));
    expect(out.data[0]).toBeCloseTo(0.5, 6);
  });

  it('Tensor sigmoid 对称性', () => {
    for (const x of [0.5, 1, 2, 5]) {
      const pos = sigmoid(new Tensor(new Float32Array([x]), [1])).data[0];
      const neg = sigmoid(new Tensor(new Float32Array([-x]), [1])).data[0];
      expect(neg).toBeCloseTo(1 - pos, 5);
    }
  });
});
