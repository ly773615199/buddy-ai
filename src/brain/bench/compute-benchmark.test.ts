/**
 * 算力能力基准测试 — 测量 NN 在当前硬件上的实际性能
 */
import { describe, it, expect } from 'vitest';
import { IntuitionNet } from '../right/nn/model.js';
import { Tensor, zeros, matmul } from '../right/nn/tensor.js';
import { WorldModel } from '../right/nn/world-model.js';

function percentile(sorted: number[], p: number): number {
  return sorted[Math.ceil(sorted.length * p / 100) - 1];
}

function avg(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

describe('算力能力基准', () => {

  it('NN 两种配置的推理延迟对比', () => {
    const configs = [
      {
        name: '文档配置 (~300K params)',
        cfg: {
          vocabSize: 2048, embedDim: 64, hiddenDim: 128,
          numHeads: 4, numLayers: 2, numIntents: 8, numTools: 32,
          ffnDim: 256, dropout: 0, numSpatialBins: 6, numSceneNodes: 32,
        },
      },
      {
        name: '默认配置 (~3M params)',
        cfg: {
          vocabSize: 4096, embedDim: 128, hiddenDim: 256,
          numHeads: 4, numLayers: 4, numIntents: 8, numTools: 32,
          ffnDim: 512, dropout: 0, numSpatialBins: 6, numSceneNodes: 32,
        },
      },
    ];

    const tokenIds = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 100, 150, 200, 250, 300, 350];

    for (const { name, cfg } of configs) {
      const model = new IntuitionNet(cfg);
      const params = model.countParams();

      // Warmup
      for (let i = 0; i < 10; i++) {
        model.forward(tokenIds);
        model.forwardInference(tokenIds);
      }

      const N = 50;
      const tFwd: number[] = [];
      const tInf: number[] = [];

      for (let i = 0; i < N; i++) {
        tFwd.push(model.forward(tokenIds).latencyMs);
        tInf.push(model.forwardInference(tokenIds).latencyMs);
      }

      tFwd.sort((a, b) => a - b);
      tInf.sort((a, b) => a - b);

      console.log(`\n=== ${name} ===`);
      console.log(`  参数量: ${params.toLocaleString()} (${(params * 4 / 1024 / 1024).toFixed(2)} MB float32, ~${(params / 1024).toFixed(0)} KB int8)`);
      console.log(`  forward (训练模式):   avg=${avg(tFwd).toFixed(2)}ms  p50=${percentile(tFwd, 50).toFixed(2)}ms  p90=${percentile(tFwd, 90).toFixed(2)}ms  p99=${percentile(tFwd, 99).toFixed(2)}ms`);
      console.log(`  inference (推理模式): avg=${avg(tInf).toFixed(2)}ms  p50=${percentile(tInf, 50).toFixed(2)}ms  p90=${percentile(tInf, 90).toFixed(2)}ms`);
      console.log(`  推理模式加速: ${((1 - avg(tInf) / avg(tFwd)) * 100).toFixed(1)}%`);

      expect(avg(tFwd)).toBeGreaterThan(0);
      expect(avg(tInf)).toBeGreaterThan(0);
    }
  });

  it('matmul 吞吐量测试', () => {
    const sizes = [
      { M: 21, K: 128, N: 128, label: '小矩阵 [21,128]×[128,128]' },
      { M: 21, K: 256, N: 256, label: '中矩阵 [21,256]×[256,256]' },
      { M: 21, K: 256, N: 512, label: 'FFN 矩阵 [21,256]×[256,512]' },
    ];

    for (const { M, K, N, label } of sizes) {
      const a = zeros([M, K]);
      const b = zeros([K, N]);
      // 填充随机值
      for (let i = 0; i < a.data.length; i++) a.data[i] = Math.random();
      for (let i = 0; i < b.data.length; i++) b.data[i] = Math.random();

      // Warmup
      for (let i = 0; i < 5; i++) matmul(a, b);

      const iterations = 200;
      const t0 = performance.now();
      for (let i = 0; i < iterations; i++) {
        matmul(a, b);
      }
      const elapsed = performance.now() - t0;
      const avgMs = elapsed / iterations;
      const flops = 2 * M * K * N; // multiply-add
      const gflops = (flops / (avgMs * 1e6));

      console.log(`\n  ${label}: avg=${avgMs.toFixed(3)}ms  throughput=${gflops.toFixed(2)} GFLOPS`);

      expect(avgMs).toBeGreaterThan(0);
    }
  });

  it('World Model 推理延迟', () => {
    const wm = new WorldModel({
      latentDim: 128,
      actionDim: 16,
      hiddenDim: 256,
      predictionSteps: 3,
    });

    // Warmup
    for (let i = 0; i < 5; i++) {
      wm.encodeState([10, 20, 30, 40, 50]);
    }

    const N = 100;
    const times: number[] = [];

    for (let i = 0; i < N; i++) {
      const latent = wm.encodeState([10, 20, 30, 40, 50]);
      const action = wm.encodeAction(1, [0.5, 0.3]);
      const t0 = performance.now();
      wm.predict(latent, action);
      times.push(performance.now() - t0);
    }

    times.sort((a, b) => a - b);
    console.log(`\n  World Model predict: avg=${avg(times).toFixed(2)}ms  p50=${percentile(times, 50).toFixed(2)}ms  p90=${percentile(times, 90).toFixed(2)}ms`);

    expect(avg(times)).toBeGreaterThan(0);
  });

  it('内存分配压力测试', () => {
    const model = new IntuitionNet({
      vocabSize: 2048, embedDim: 64, hiddenDim: 128,
      numHeads: 4, numLayers: 2, numIntents: 8, numTools: 32,
      ffnDim: 256, dropout: 0, numSpatialBins: 6, numSceneNodes: 32,
    });

    const tokenIds = [10, 20, 30, 40, 50];

    // 测量 1000 次 forward 的 GC 压力
    if (global.gc) global.gc();
    const memBefore = process.memoryUsage();

    for (let i = 0; i < 500; i++) {
      model.forward(tokenIds);
    }

    const memAfter = process.memoryUsage();
    const heapGrowth = (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024;

    console.log(`\n  500 次 forward 内存增长: ${heapGrowth.toFixed(2)} MB`);
    console.log(`  每次 forward 平均分配: ${(heapGrowth * 1024 * 1024 / 500 / 1024).toFixed(1)} KB`);

    expect(heapGrowth).toBeLessThan(100); // 不应增长超过 100MB
  });

  it('并发推理延迟', async () => {
    const model = new IntuitionNet({
      vocabSize: 2048, embedDim: 64, hiddenDim: 128,
      numHeads: 4, numLayers: 2, numIntents: 8, numTools: 32,
      ffnDim: 256, dropout: 0, numSpatialBins: 6, numSceneNodes: 32,
    });

    const tokenSets = [
      [10, 20, 30],
      [40, 50, 60, 70],
      [80, 90, 100, 110, 120],
      [130, 140, 150],
    ];

    // Warmup
    for (const ids of tokenSets) model.forward(ids);

    const t0 = performance.now();
    const results = tokenSets.map(ids => model.forward(ids));
    const totalMs = performance.now() - t0;

    console.log(`\n  4 条并发推理总延迟: ${totalMs.toFixed(2)}ms (avg ${(totalMs / 4).toFixed(2)}ms/条)`);

    for (const r of results) {
      expect(r.latencyMs).toBeGreaterThan(0);
      expect(r.intentProbs.length).toBe(8);
    }
  });
});
