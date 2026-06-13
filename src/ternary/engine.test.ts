/**
 * Phase C2 测试 — 矩阵运算 + 推理引擎 + Tokenizer
 */

import { describe, it, expect } from 'vitest';
import {
  matVecMul, loraForward, softmax, layerNorm, gelu,
  argmax, topPSample, vecAdd, vecScale,
} from './compute.js';
import { TernaryTokenizer } from './tokenizer.js';
import { TernaryEngine } from './engine.js';
import { createModelMeta } from './format.js';
import type { TernaryModel, TernaryLayer } from './format.js';

// ── 工具函数 ──

function randomTernary(len: number): Int8Array {
  const arr = new Int8Array(len);
  for (let i = 0; i < len; i++) arr[i] = (Math.floor(Math.random() * 3) - 1) as -1 | 0 | 1;
  return arr;
}

function createTinyModel(): TernaryModel {
  const inF = 32, rank = 4, outF = 32, numLayers = 2;
  const meta = createModelMeta('测试领域', {
    inFeatures: inF, rank, outFeatures: outF, numLayers,
    totalParams: (inF * rank + rank * outF) * numLayers,
  });

  const layers: TernaryLayer[] = Array.from({ length: numLayers }, (_, i) => ({
    layerIndex: i,
    A: randomTernary(inF * rank),
    B: randomTernary(rank * outF),
  }));

  return { meta, layers };
}

// ═══════════════════════════════════════════════════════

describe('三进制矩阵运算', () => {
  it('matVecMul: 全 1 矩阵 = 行求和', () => {
    const rows = 3, cols = 4;
    const weights = new Int8Array(rows * cols).fill(1);
    const input = new Float32Array([1, 2, 3, 4]);
    const output = new Float32Array(rows);

    matVecMul(weights, input, output, rows, cols);
    expect(output).toEqual(new Float32Array([10, 10, 10]));
  });

  it('matVecMul: 全 0 矩阵输出为零', () => {
    const weights = new Int8Array(16).fill(0);
    const input = new Float32Array([1, 2, 3, 4]);
    const output = new Float32Array(4);

    matVecMul(weights, input, output, 4, 4);
    expect(output.every(v => v === 0)).toBe(true);
  });

  it('matVecMul: -1 值产生减法', () => {
    const weights = new Int8Array([1, -1, 0, 1]);
    const input = new Float32Array([5, 3, 2, 1]);
    const output = new Float32Array(1);

    matVecMul(weights, input, output, 1, 4);
    expect(output[0]).toBe(5 - 3 + 0 + 1); // 3
  });

  it('loraForward: 两步矩阵乘', () => {
    const inF = 8, rank = 4, outF = 8;
    const A = randomTernary(inF * rank);
    const B = randomTernary(rank * outF);
    const input = new Float32Array(outF);
    for (let i = 0; i < outF; i++) input[i] = Math.random();

    const result = loraForward(A, B, input, inF, rank, outF);
    expect(result.length).toBe(inF);
    expect(result.every(v => Number.isFinite(v))).toBe(true);
  });

  it('softmax: 输出和为 1', () => {
    const logits = new Float32Array([1.0, 2.0, 3.0]);
    const probs = softmax(logits);
    const sum = Array.from(probs).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('softmax: 最大值对应最大概率', () => {
    const logits = new Float32Array([1.0, 5.0, 2.0]);
    const probs = softmax(logits);
    expect(probs[1]).toBeGreaterThan(probs[0]);
    expect(probs[1]).toBeGreaterThan(probs[2]);
  });

  it('layerNorm: 输出均值≈0, 方差≈1', () => {
    const x = new Float32Array([1, 2, 3, 4, 5]);
    const gamma = new Float32Array(5).fill(1);
    const beta = new Float32Array(5).fill(0);
    const result = layerNorm(x, gamma, beta);

    const mean = Array.from(result).reduce((a, b) => a + b, 0) / 5;
    expect(Math.abs(mean)).toBeLessThan(0.01);
  });

  it('gelu: 负值趋近于 0', () => {
    const x = new Float32Array([-10, -5, 0, 5, 10]);
    const result = gelu(x);
    expect(result[0]).toBeCloseTo(0, 1);
    expect(result[2]).toBeCloseTo(0, 5);
    expect(result[4]).toBeGreaterThan(9);
  });

  it('argmax: 返回最大值索引', () => {
    expect(argmax(new Float32Array([1, 5, 3, 2]))).toBe(1);
    expect(argmax(new Float32Array([10, 2, 3, 4]))).toBe(0);
  });

  it('topPSample: 在 logits 范围内', () => {
    const logits = new Float32Array([1, 2, 3, 4, 5]);
    for (let i = 0; i < 20; i++) {
      const idx = topPSample(logits, 0.9);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(5);
    }
  });

  it('vecAdd / vecScale', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([4, 5, 6]);
    const out = new Float32Array(3);
    vecAdd(a, b, out);
    expect(out).toEqual(new Float32Array([5, 7, 9]));

    vecScale(a, 2, out);
    expect(out).toEqual(new Float32Array([2, 4, 6]));
  });
});

// ═══════════════════════════════════════════════════════

describe('TernaryTokenizer', () => {
  it('initBuiltin 设置词表', () => {
    const tok = new TernaryTokenizer();
    tok.initBuiltin();
    expect(tok.isLoaded).toBe(true);
    expect(tok.vocabSize).toBe(32000);
  });

  it('encode 包含 BOS/EOS', () => {
    const tok = new TernaryTokenizer();
    tok.initBuiltin();
    const ids = tok.encode('Hi');
    expect(ids[0]).toBe(1); // BOS
    expect(ids[ids.length - 1]).toBe(2); // EOS
  });

  it('encode/decode roundtrip', () => {
    const tok = new TernaryTokenizer();
    tok.initBuiltin();
    const text = 'Hello';
    const ids = tok.encode(text);
    const decoded = tok.decode(ids);
    expect(decoded).toBe(text);
  });

  it('decode 跳过特殊 token', () => {
    const tok = new TernaryTokenizer();
    tok.initBuiltin();
    const decoded = tok.decode([0, 1, 2]); // pad, bos, eos
    expect(decoded).toBe('');
  });

  it('中文 encode/decode', () => {
    const tok = new TernaryTokenizer();
    tok.initBuiltin();
    const text = '你好';
    const ids = tok.encode(text);
    expect(ids.length).toBeGreaterThan(2); // 至少 BOS + 字符 + EOS
    const decoded = tok.decode(ids);
    expect(decoded).toBe(text);
  });
});

// ═══════════════════════════════════════════════════════

describe('TernaryEngine', () => {
  it('loadFromModel 加载模型', () => {
    const engine = new TernaryEngine();
    expect(engine.isLoaded).toBe(false);

    engine.loadFromModel(createTinyModel());
    expect(engine.isLoaded).toBe(true);
    expect(engine.meta?.domain).toBe('测试领域');
  });

  it('unload 释放模型', () => {
    const engine = new TernaryEngine();
    engine.loadFromModel(createTinyModel());
    engine.unload();
    expect(engine.isLoaded).toBe(false);
  });

  it('decode 返回 logits 和 nextToken', () => {
    const engine = new TernaryEngine();
    engine.loadFromModel(createTinyModel());
    const result = engine.decode(42);
    expect(result.logits.length).toBeGreaterThan(0);
    expect(result.nextToken).toBeGreaterThanOrEqual(0);
  });

  it('generate 流式输出', async () => {
    const engine = new TernaryEngine();
    engine.loadFromModel(createTinyModel());

    const chunks: string[] = [];
    for await (const chunk of engine.generate('测试', { maxTokens: 5 })) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThanOrEqual(5);
  });

  it('complete 非流式输出', async () => {
    const engine = new TernaryEngine();
    engine.loadFromModel(createTinyModel());
    const result = await engine.complete('测试', { maxTokens: 3 });
    expect(typeof result).toBe('string');
  });

  it('getStats 返回统计', () => {
    const engine = new TernaryEngine();
    engine.loadFromModel(createTinyModel());
    const stats = engine.getStats();
    expect(stats.totalParams).toBeGreaterThan(0);
    expect(stats.memoryMB).toBeGreaterThanOrEqual(0);
  });

  it('未加载时抛出错误', async () => {
    const engine = new TernaryEngine();
    expect(() => engine.decode(0)).toThrow('not loaded');

    const gen = engine.generate('test') as AsyncGenerator<string>;
    await expect(gen.next()).rejects.toThrow('not loaded');
  });
});
