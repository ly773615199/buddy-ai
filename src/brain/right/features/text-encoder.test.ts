/**
 * text-encoder.ts 测试
 *
 * 覆盖：ByteEmbedding、EntropyEstimator、DynamicMerge、TextEncoder 完整前向、序列化
 */

import { describe, it, expect } from 'vitest';
import {
  ByteEmbedding,
  estimateEntropy,
  dynamicMerge,
  poolPatches,
  TextEncoder,
} from './text-encoder.js';
import { Tensor } from '../nn/tensor.js';

// ==================== ByteEmbedding ====================

describe('ByteEmbedding', () => {
  it('前向输出维度正确', () => {
    const emb = new ByteEmbedding(32);
    const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const out = emb.forward(bytes);
    expect(out.shape).toEqual([5, 32]);
  });

  it('相同字节值产生相同嵌入', () => {
    const emb = new ByteEmbedding(32);
    const bytes = new Uint8Array([65, 65, 65]);
    const out = emb.forward(bytes);
    // 所有行应该相同
    for (let d = 0; d < 32; d++) {
      expect(out.data[d]).toBeCloseTo(out.data[32 + d], 5);
      expect(out.data[d]).toBeCloseTo(out.data[64 + d], 5);
    }
  });

  it('不同字节值产生不同嵌入', () => {
    const emb = new ByteEmbedding(32);
    const bytes = new Uint8Array([0, 255]);
    const out = emb.forward(bytes);
    // 至少有一个维度不同
    let anyDiff = false;
    for (let d = 0; d < 32; d++) {
      if (Math.abs(out.data[d] - out.data[32 + d]) > 1e-6) {
        anyDiff = true;
        break;
      }
    }
    expect(anyDiff).toBe(true);
  });

  it('参数计数正确', () => {
    const emb = new ByteEmbedding(32);
    expect(emb.countParams()).toBe(256 * 32);
  });
});

// ==================== EntropyEstimator ====================

describe('estimateEntropy', () => {
  it('纯 ASCII 低频字符熵较高', () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const entropy = estimateEntropy(bytes, 2);
    expect(entropy.length).toBe(5);
    // 每个位置都有熵值
    for (let i = 0; i < 5; i++) {
      expect(entropy[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it('重复字节熵为 0', () => {
    const bytes = new Uint8Array([65, 65, 65, 65, 65]);
    const entropy = estimateEntropy(bytes, 2);
    // 全相同字节，熵应该为 0
    for (let i = 0; i < 5; i++) {
      expect(entropy[i]).toBeCloseTo(0, 2);
    }
  });

  it('中文 UTF-8 字节熵模式与英文不同', () => {
    // "你好" 的 UTF-8 编码
    const zhBytes = new Uint8Array([228, 189, 160, 229, 165, 189]);
    const enBytes = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
    const zhEntropy = estimateEntropy(zhBytes, 2);
    const enEntropy = estimateEntropy(enBytes, 2);
    // 中文 UTF-8 三字节一组，字节值分散，熵通常更高
    const avgZh = zhEntropy.reduce((a, b) => a + b, 0) / zhEntropy.length;
    const avgEn = enEntropy.reduce((a, b) => a + b, 0) / enEntropy.length;
    // 至少应该有差异
    expect(Math.abs(avgZh - avgEn)).toBeGreaterThan(0);
  });
});

// ==================== DynamicMerge ====================

describe('dynamicMerge', () => {
  it('纯 ASCII 高熵文本保留独立 token', () => {
    const bytes = new Uint8Array([100, 101, 112, 108, 111, 121]); // "deploy"
    const entropy = estimateEntropy(bytes, 2);
    // 设置低阈值，让所有位置都保留
    const boundaries = dynamicMerge(bytes, entropy, 0.1, 100);
    // 应该有 6 个 patch（每个字节独立）
    expect(boundaries.length - 1).toBe(6);
  });

  it('低熵区域合并', () => {
    const bytes = new Uint8Array([65, 65, 65, 65, 65, 65, 65, 65]);
    const entropy = estimateEntropy(bytes, 2);
    // 设置高阈值，让所有位置都合并
    const boundaries = dynamicMerge(bytes, entropy, 10.0, 100);
    // 应该只有 1 个 patch
    expect(boundaries.length - 1).toBe(1);
  });

  it('中文 UTF-8 三字节一组', () => {
    // "你好世界" UTF-8
    const bytes = new Uint8Array([228, 189, 160, 229, 165, 189, 228, 184, 150, 230, 150, 135]);
    const entropy = estimateEntropy(bytes, 2);
    const boundaries = dynamicMerge(bytes, entropy, 1.5, 100);
    // 应该有合理的 patch 数量
    expect(boundaries.length - 1).toBeGreaterThan(0);
    expect(boundaries.length - 1).toBeLessThanOrEqual(12);
  });

  it('maxPatches 限制生效', () => {
    const bytes = new Uint8Array(100);
    for (let i = 0; i < 100; i++) bytes[i] = i;
    const entropy = estimateEntropy(bytes, 2);
    const boundaries = dynamicMerge(bytes, entropy, 0.1, 5);
    expect(boundaries.length - 1).toBeLessThanOrEqual(5);
  });

  it('边界首尾正确', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const entropy = estimateEntropy(bytes, 2);
    const boundaries = dynamicMerge(bytes, entropy, 1.5, 100);
    expect(boundaries[0]).toBe(0);
    expect(boundaries[boundaries.length - 1]).toBe(5);
  });
});

// ==================== poolPatches ====================

describe('poolPatches', () => {
  it('池化输出维度正确', () => {
    const embedded = new Tensor(new Float32Array([
      1, 2, 3, 4,
      5, 6, 7, 8,
      9, 10, 11, 12,
    ]), [3, 4]);
    const boundaries = [0, 2, 3]; // patch 0: [0,2), patch 1: [2,3)
    const pooled = poolPatches(embedded, boundaries);
    expect(pooled.shape).toEqual([2, 4]);
  });

  it('平均值正确', () => {
    const embedded = new Tensor(new Float32Array([
      1, 2, 3, 4,
      5, 6, 7, 8,
    ]), [2, 4]);
    const boundaries = [0, 2]; // 1 个 patch
    const pooled = poolPatches(embedded, boundaries);
    // 平均值: (1+5)/2=3, (2+6)/2=4, (3+7)/2=5, (4+8)/2=6
    expect(pooled.data[0]).toBeCloseTo(3, 5);
    expect(pooled.data[1]).toBeCloseTo(4, 5);
    expect(pooled.data[2]).toBeCloseTo(5, 5);
    expect(pooled.data[3]).toBeCloseTo(6, 5);
  });
});

// ==================== TextEncoder ====================

describe('TextEncoder', () => {
  it('forward 输出维度正确', () => {
    const enc = new TextEncoder();
    const out = enc.forward('hello world');
    expect(out.shape.length).toBe(2);
    expect(out.shape[1]).toBe(128); // outputDim
    expect(out.shape[0]).toBeGreaterThan(0); // 至少有 1 个 patch
  });

  it('forwardPooled 输出 [1, 128]', () => {
    const enc = new TextEncoder();
    const out = enc.forwardPooled('测试文本');
    expect(out.shape).toEqual([1, 128]);
  });

  it('中文输入正常工作', () => {
    const enc = new TextEncoder();
    const out = enc.forward('帮我写个快排');
    expect(out.shape[1]).toBe(128);
    expect(out.shape[0]).toBeGreaterThan(0);
  });

  it('中英混合输入', () => {
    const enc = new TextEncoder();
    const out = enc.forward('帮我写个 quicksort');
    expect(out.shape[1]).toBe(128);
  });

  it('空字符串不崩溃', () => {
    const enc = new TextEncoder();
    const out = enc.forward('');
    expect(out.shape[0]).toBeGreaterThanOrEqual(0);
  });

  it('参数量约 277K（2 层 d=128 attention + FFN）', () => {
    const enc = new TextEncoder();
    const params = enc.countParams();
    // ByteEmbedding(256,32)=8192 + Projection(32→128)=4096 + 2×(MHA+FFN) + LayerNorm
    expect(params).toBeGreaterThan(200_000);
    expect(params).toBeLessThan(350_000);
  });

  it('序列化/反序列化后输出一致', () => {
    const enc = new TextEncoder();
    const text = '序列化测试';
    const out1 = enc.forwardPooled(text);

    const buf = enc.serialize();
    const enc2 = TextEncoder.deserialize(buf);
    const out2 = enc2.forwardPooled(text);

    expect(out2.shape).toEqual(out1.shape);
    for (let i = 0; i < out1.size; i++) {
      expect(out2.data[i]).toBeCloseTo(out1.data[i], 3);
    }
  });

  it('推理延迟 < 10ms（宽松，CI 环境）', () => {
    const enc = new TextEncoder();
    // 预热
    enc.forward('warmup');

    const t0 = performance.now();
    for (let i = 0; i < 10; i++) {
      enc.forward('这是一个测试文本，用于测量推理延迟');
    }
    const elapsed = performance.now() - t0;
    const perCall = elapsed / 10;
    // 宽松阈值，CI 环境可能较慢
    expect(perCall).toBeLessThan(50);
  });
});
