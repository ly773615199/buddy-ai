import { describe, it, expect } from 'vitest';
import {
  Tensor, zeros, ones, randn, scalar, fromArray, xavierUniform,
  matmul, add, mul, scale, relu, gelu, softmax, sigmoid,
  layerNorm, reshape, transposeLast2, cat, causalMask,
  backward,
} from './tensor.js';

describe('Tensor 基础', () => {
  it('zeros 创建全零张量', () => {
    const t = zeros([2, 3]);
    expect(t.shape).toEqual([2, 3]);
    expect(t.size).toBe(6);
    expect(t.data.every(v => v === 0)).toBe(true);
  });

  it('ones 创建全一张量', () => {
    const t = ones([3]);
    expect(t.data.every(v => v === 1)).toBe(true);
  });

  it('randn 创建随机张量', () => {
    const t = randn([100]);
    expect(t.shape).toEqual([100]);
    const mean = t.data.reduce((a, b) => a + b, 0) / t.size;
    expect(Math.abs(mean)).toBeLessThan(0.5);
  });

  it('scalar 创建标量', () => {
    const t = scalar(42);
    expect(t.item()).toBe(42);
  });

  it('xavierUniform 初始化范围正确', () => {
    const t = xavierUniform(10, 20);
    const limit = Math.sqrt(6 / 30);
    for (let i = 0; i < t.size; i++) {
      expect(t.data[i]).toBeGreaterThanOrEqual(-limit);
      expect(t.data[i]).toBeLessThanOrEqual(limit);
    }
  });

  it('clone 深拷贝', () => {
    const t = fromArray([1, 2, 3], [3]);
    const c = t.clone();
    c.data[0] = 99;
    expect(t.data[0]).toBe(1);
    expect(c.data[0]).toBe(99);
  });
});

describe('Tensor 运算', () => {
  it('matmul [2,3] × [3,4] → [2,4]', () => {
    const a = fromArray([1, 2, 3, 4, 5, 6], [2, 3]);
    const b = fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [3, 4]);
    const c = matmul(a, b);
    expect(c.shape).toEqual([2, 4]);
    expect(c.data[0]).toBe(1*1 + 2*5 + 3*9);
    expect(c.data[1]).toBe(1*2 + 2*6 + 3*10);
  });

  it('add 同形加法', () => {
    const a = fromArray([1, 2, 3], [3]);
    const b = fromArray([4, 5, 6], [3]);
    const c = add(a, b);
    expect(Array.from(c.data)).toEqual([5, 7, 9]);
  });

  it('add 广播 bias [M,N] + [N]', () => {
    const a = fromArray([1, 2, 3, 4], [2, 2]);
    const b = fromArray([10, 20], [2]);
    const c = add(a, b);
    expect(Array.from(c.data)).toEqual([11, 22, 13, 24]);
  });

  it('relu 负值归零', () => {
    const a = fromArray([-2, -1, 0, 1, 2], [5]);
    const r = relu(a);
    expect(Array.from(r.data)).toEqual([0, 0, 0, 1, 2]);
  });

  it('gelu 近似正确', () => {
    const a = fromArray([0, 1, -1], [3]);
    const g = gelu(a);
    expect(g.data[0]).toBeCloseTo(0, 1);
    expect(g.data[1]).toBeCloseTo(0.841, 1);
    expect(g.data[2]).toBeCloseTo(-0.159, 1);
  });

  it('softmax 归一化', () => {
    const a = fromArray([1, 2, 3], [1, 3]);
    const s = softmax(a);
    const sum = s.data[0] + s.data[1] + s.data[2];
    expect(sum).toBeCloseTo(1, 5);
    expect(s.data[2]).toBeGreaterThan(s.data[0]);
  });

  it('sigmoid 范围 0-1', () => {
    const a = fromArray([-10, 0, 10], [3]);
    const s = sigmoid(a);
    expect(s.data[0]).toBeCloseTo(0, 2);
    expect(s.data[1]).toBeCloseTo(0.5, 2);
    expect(s.data[2]).toBeCloseTo(1, 2);
  });

  it('layerNorm 归一化', () => {
    const a = fromArray([1, 2, 3, 4], [2, 2]);
    const w = ones([2]);
    const b = zeros([2]);
    const out = layerNorm(a, w, b);
    const mean0 = (out.data[0] + out.data[1]) / 2;
    const mean1 = (out.data[2] + out.data[3]) / 2;
    expect(Math.abs(mean0)).toBeLessThan(0.01);
    expect(Math.abs(mean1)).toBeLessThan(0.01);
  });

  it('reshape 不改变数据', () => {
    const a = fromArray([1, 2, 3, 4, 5, 6], [2, 3]);
    const r = reshape(a, [3, 2]);
    expect(r.shape).toEqual([3, 2]);
    expect(r.data[0]).toBe(1);
    expect(r.data[5]).toBe(6);
  });

  it('transposeLast2 转置', () => {
    const a = fromArray([1, 2, 3, 4], [2, 2]);
    const t = transposeLast2(a);
    expect(t.shape).toEqual([2, 2]);
    expect(t.data[0]).toBe(1);
    expect(t.data[1]).toBe(3);
    expect(t.data[2]).toBe(2);
    expect(t.data[3]).toBe(4);
  });

  it('cat 拼接', () => {
    const a = fromArray([1, 2], [2]);
    const b = fromArray([3, 4, 5], [3]);
    const c = cat([a, b], 0);
    expect(c.shape).toEqual([5]);
    expect(Array.from(c.data)).toEqual([1, 2, 3, 4, 5]);
  });

  it('causalMask 上三角为 -10000', () => {
    const m = causalMask(3);
    expect(m.data[0]).toBe(0);
    expect(m.data[1]).toBe(-10000);
    expect(m.data[2]).toBe(-10000);
    expect(m.data[3]).toBe(0);
    expect(m.data[4]).toBe(0);
    expect(m.data[5]).toBe(-10000);
  });
});

describe('反向传播', () => {
  it('matmul 梯度正确', () => {
    const a = fromArray([1, 2, 3, 4], [2, 2]);
    const b = fromArray([5, 6, 7, 8], [2, 2]);
    const c = matmul(a, b);
    // backward() 将 loss.grad 设为 1（等价于 loss = sum(c)）
    backward(c);

    // ∂sum/∂a = ones @ b^T = [[5+6],[7+8]] = [[11],[15]]？不对
    // ∂L/∂a[i][k] = Σ_j b[k][j] (因为 ∂L/∂c[i][j] = 1)
    // a[0][0]: b[0][0]+b[0][1] = 5+6 = 11
    // a[0][1]: b[1][0]+b[1][1] = 7+8 = 15
    // a[1][0]: b[0][0]+b[0][1] = 11
    // a[1][1]: b[1][0]+b[1][1] = 15
    expect(a.grad).toBeTruthy();
    expect(a.grad![0]).toBe(11);
    expect(a.grad![1]).toBe(15);
    expect(a.grad![2]).toBe(11);
    expect(a.grad![3]).toBe(15);

    // ∂L/∂b[k][j] = Σ_i a[i][k]
    // b[0][0]: a[0][0]+a[1][0] = 1+3 = 4
    // b[0][1]: a[0][0]+a[1][0] = 4
    // b[1][0]: a[0][1]+a[1][1] = 2+4 = 6
    // b[1][1]: a[0][1]+a[1][1] = 6
    expect(b.grad).toBeTruthy();
    expect(b.grad![0]).toBe(4);
    expect(b.grad![1]).toBe(4);
    expect(b.grad![2]).toBe(6);
    expect(b.grad![3]).toBe(6);
  });

  it('relu 梯度：正值传、负值截', () => {
    const a = fromArray([-1, 0, 1, 2], [4]);
    const r = relu(a);
    // backward() 将 r.grad 初始化为 [1,1,1,1]
    backward(r);
    // relu': x>0 → 1, x<=0 → 0
    expect(a.grad![0]).toBe(0);  // -1 → 0
    expect(a.grad![1]).toBe(0);  // 0 → 0
    expect(a.grad![2]).toBe(1);  // 1 → 1
    expect(a.grad![3]).toBe(1);  // 2 → 1
  });

  it('add 梯度分发', () => {
    const a = fromArray([1, 2], [2]);
    const b = fromArray([3, 4], [2]);
    const c = add(a, b);
    backward(c);
    // add 梯度直接传递
    expect(Array.from(a.grad!)).toEqual([1, 1]);
    expect(Array.from(b.grad!)).toEqual([1, 1]);
  });

  it('scale 梯度', () => {
    const a = fromArray([2, 3], [2]);
    const s = scale(a, 5);
    backward(s);
    expect(a.grad![0]).toBe(5);
    expect(a.grad![1]).toBe(5);
  });
});
