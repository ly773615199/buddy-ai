/**
 * compute.ts 测试 — 三进制矩阵运算核心
 */

import { describe, it, expect } from 'vitest';
import {
  matVecMul, loraForward, batchMatVecMul,
  vecAdd, vecScale, softmax, layerNorm, gelu,
  argmax, topPSample, ternaryAttention,
} from './compute.js';

// ═══════════════════════════════════════════════════════

describe('matVecMul', () => {
  it('全零权重输出全零', () => {
    const weights = new Int8Array(6); // 2×3
    const input = new Float32Array([1, 2, 3]);
    const output = new Float32Array(2);

    matVecMul(weights, input, output, 2, 3);

    expect(Array.from(output)).toEqual([0, 0]);
  });

  it('全 1 权重 = 行求和', () => {
    const weights = new Int8Array([1, 1, 1, 1, 1, 1]); // 2×3
    const input = new Float32Array([1, 2, 3]);
    const output = new Float32Array(2);

    matVecMul(weights, input, output, 2, 3);

    expect(output[0]).toBeCloseTo(6);
    expect(output[1]).toBeCloseTo(6);
  });

  it('全 -1 权重 = 负行求和', () => {
    const weights = new Int8Array([-1, -1, -1, -1, -1, -1]);
    const input = new Float32Array([1, 2, 3]);
    const output = new Float32Array(2);

    matVecMul(weights, input, output, 2, 3);

    expect(output[0]).toBeCloseTo(-6);
    expect(output[1]).toBeCloseTo(-6);
  });

  it('混合权重正确计算', () => {
    // [1, 0, -1] · [2, 3, 4] = 2 + 0 - 4 = -2
    // [0, 1, 1]  · [2, 3, 4] = 0 + 3 + 4 = 7
    const weights = new Int8Array([1, 0, -1, 0, 1, 1]);
    const input = new Float32Array([2, 3, 4]);
    const output = new Float32Array(2);

    matVecMul(weights, input, output, 2, 3);

    expect(output[0]).toBeCloseTo(-2);
    expect(output[1]).toBeCloseTo(7);
  });

  it('单位矩阵行为', () => {
    // 1×1 "矩阵" = [1], 输入 [5] → 输出 [5]
    const weights = new Int8Array([1]);
    const input = new Float32Array([5]);
    const output = new Float32Array(1);

    matVecMul(weights, input, output, 1, 1);
    expect(output[0]).toBeCloseTo(5);
  });
});

// ═══════════════════════════════════════════════════════

describe('loraForward', () => {
  it('全 1 权重两步乘法', () => {
    // A: 2×3, B: 3×2
    // A 全 1, B 全 1
    // intermediate = B @ input = [sum(input), sum(input)]
    // result = A @ intermediate = [sum(intermediate), sum(intermediate)]
    const A = new Int8Array([1, 1, 1, 1, 1, 1]); // 2×3
    const B = new Int8Array([1, 1, 1, 1, 1, 1]); // 3×2
    const input = new Float32Array([1, 2]);

    const result = loraForward(A, B, input, 2, 3, 2);

    expect(result.length).toBe(2);
    // intermediate = [3, 3, 3], result = [9, 9]
    expect(result[0]).toBeCloseTo(9);
    expect(result[1]).toBeCloseTo(9);
  });

  it('零权重输出零', () => {
    const A = new Int8Array(6);
    const B = new Int8Array(6);
    const input = new Float32Array([1, 2]);

    const result = loraForward(A, B, input, 2, 3, 2);

    expect(Array.from(result)).toEqual([0, 0]);
  });
});

// ═══════════════════════════════════════════════════════

describe('batchMatVecMul', () => {
  it('批量处理多个输入', () => {
    const weights = new Int8Array([1, 0, -1, 0, 1, 1]); // 2×3
    const inputs = [
      new Float32Array([1, 2, 3]),
      new Float32Array([4, 5, 6]),
    ];

    const results = batchMatVecMul(weights, inputs, 2, 3);

    expect(results.length).toBe(2);
    expect(results[0][0]).toBeCloseTo(-2); // 1*1 + 0*2 + (-1)*3
    expect(results[1][0]).toBeCloseTo(-2); // 1*4 + 0*5 + (-1)*6
  });
});

// ═══════════════════════════════════════════════════════

describe('vecAdd / vecScale', () => {
  it('vecAdd', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([4, 5, 6]);
    const out = new Float32Array(3);
    vecAdd(a, b, out);
    expect(Array.from(out)).toEqual([5, 7, 9]);
  });

  it('vecScale', () => {
    const vec = new Float32Array([1, 2, 3]);
    const out = new Float32Array(3);
    vecScale(vec, 2.5, out);
    expect(out[0]).toBeCloseTo(2.5);
    expect(out[1]).toBeCloseTo(5);
    expect(out[2]).toBeCloseTo(7.5);
  });
});

// ═══════════════════════════════════════════════════════

describe('softmax', () => {
  it('输出概率和为 1', () => {
    const logits = new Float32Array([1, 2, 3]);
    const probs = softmax(logits);

    const sum = probs[0] + probs[1] + probs[2];
    expect(sum).toBeCloseTo(1);
  });

  it('最大 logit 对应最大概率', () => {
    const logits = new Float32Array([1, 5, 3]);
    const probs = softmax(logits);

    expect(probs[1]).toBeGreaterThan(probs[0]);
    expect(probs[1]).toBeGreaterThan(probs[2]);
  });

  it('相同 logit 输出均匀分布', () => {
    const logits = new Float32Array([3, 3, 3]);
    const probs = softmax(logits);

    expect(probs[0]).toBeCloseTo(1 / 3);
    expect(probs[1]).toBeCloseTo(1 / 3);
    expect(probs[2]).toBeCloseTo(1 / 3);
  });

  it('极端值不溢出', () => {
    const logits = new Float32Array([1000, 1001, 999]);
    const probs = softmax(logits);

    const sum = probs[0] + probs[1] + probs[2];
    expect(sum).toBeCloseTo(1);
    expect(Number.isNaN(sum)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════

describe('layerNorm', () => {
  it('输出均值接近 0', () => {
    const x = new Float32Array([1, 2, 3, 4, 5]);
    const gamma = new Float32Array([1, 1, 1, 1, 1]);
    const beta = new Float32Array([0, 0, 0, 0, 0]);

    const result = layerNorm(x, gamma, beta);

    const mean = Array.from(result).reduce((a, b) => a + b, 0) / result.length;
    expect(mean).toBeCloseTo(0, 5);
  });

  it('gamma=1, beta=0 标准化', () => {
    const x = new Float32Array([2, 4, 6]);
    const gamma = new Float32Array([1, 1, 1]);
    const beta = new Float32Array([0, 0, 0]);

    const result = layerNorm(x, gamma, beta);

    // 标准化后应有正负值
    expect(result[0]).toBeLessThan(0); // 最小值标准化后为负
    expect(result[2]).toBeGreaterThan(0); // 最大值标准化后为正
  });

  it('gamma=2, beta=1 缩放和平移', () => {
    const x = new Float32Array([1, 2, 3]);
    const gamma = new Float32Array([2, 2, 2]);
    const beta = new Float32Array([1, 1, 1]);

    const result = layerNorm(x, gamma, beta);

    // 均值应接近 1 (beta)
    const mean = Array.from(result).reduce((a, b) => a + b, 0) / result.length;
    expect(mean).toBeCloseTo(1, 5);
  });
});

// ═══════════════════════════════════════════════════════

describe('gelu', () => {
  it('零输入输出接近零', () => {
    const x = new Float32Array([0]);
    const result = gelu(x);
    expect(result[0]).toBeCloseTo(0, 2);
  });

  it('大正数接近恒等', () => {
    const x = new Float32Array([10]);
    const result = gelu(x);
    expect(result[0]).toBeCloseTo(10, 1);
  });

  it('大负数接近零', () => {
    const x = new Float32Array([-10]);
    const result = gelu(x);
    expect(Math.abs(result[0])).toBeLessThan(0.01);
  });

  it('正数区间单调递增', () => {
    const x = new Float32Array([0, 0.5, 1, 1.5, 2]);
    const result = gelu(x);

    for (let i = 1; i < result.length; i++) {
      expect(result[i]).toBeGreaterThan(result[i - 1]);
    }
  });
});

// ═══════════════════════════════════════════════════════

describe('argmax', () => {
  it('返回最大值索引', () => {
    expect(argmax(new Float32Array([1, 5, 3]))).toBe(1);
    expect(argmax(new Float32Array([5, 1, 3]))).toBe(0);
    expect(argmax(new Float32Array([1, 3, 5]))).toBe(2);
  });

  it('相同值返回第一个', () => {
    expect(argmax(new Float32Array([3, 3, 3]))).toBe(0);
  });

  it('单元素', () => {
    expect(argmax(new Float32Array([42]))).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════

describe('topPSample', () => {
  it('返回有效索引', () => {
    const logits = new Float32Array([1, 2, 3, 4, 5]);
    const idx = topPSample(logits, 0.9, 1.0);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(5);
  });

  it('temperature=0.01 近似 argmax', () => {
    const logits = new Float32Array([0, 0, 0, 0, 100]);
    // 极低温度应几乎总是选 index 4
    const results = new Set<number>();
    for (let i = 0; i < 50; i++) {
      results.add(topPSample(logits, 0.9, 0.01));
    }
    expect(results.size).toBe(1);
    expect(results.has(4)).toBe(true);
  });

  it('p=1.0 可选任意', () => {
    const logits = new Float32Array([1, 1, 1, 1]);
    const idx = topPSample(logits, 1.0, 1.0);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(4);
  });
});

// ═══════════════════════════════════════════════════════

describe('ternaryAttention', () => {
  it('返回正确维度', () => {
    const headDim = 8;
    const inputDim = 16;
    const Q = new Int8Array(headDim * inputDim);
    const K = new Int8Array(headDim * inputDim);
    const V = new Int8Array(headDim * inputDim);

    // 填充 V 为全 1 使其非零
    V.fill(1);

    const input = new Float32Array(inputDim);
    input.fill(1);

    const result = ternaryAttention(Q, K, V, input, 1, headDim);
    expect(result.length).toBe(headDim);
  });
});
