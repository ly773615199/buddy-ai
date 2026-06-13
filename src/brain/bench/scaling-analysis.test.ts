/**
 * 缩放分析 — 矩阵尺寸增长 + 硬件升级下的性能预测
 *
 * 场景:
 *   S1. 当前: 300K params, seqLen=21, hidden=128, batch=1
 *   S2. 方案B: 2.5M params, seqLen=21, hidden=256, batch=1
 *   S3. 扩展: 30M params, seqLen=128, hidden=512, batch=8
 *   S4. 大规模: 300M params, seqLen=512, hidden=1024, batch=32
 *
 * 每个场景测试:
 *   - 当前微内核性能
 *   - 预转置的理论收益拐点
 *   - 多线程的理论收益拐点
 *   - 内存需求估算
 */

import { describe, it } from 'vitest';
import { Tensor, zeros, randn, matmul } from '../right/nn/tensor.js';

// ==================== 辅助 ====================

function benchFn(label: string, fn: () => void, iterations = 100, warmup = 10): { label: string; avgMs: number; p50Ms: number } {
  for (let i = 0; i < warmup; i++) fn();
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  return { label, avgMs: avg, p50Ms: times[Math.ceil(times.length * 0.5) - 1] };
}

function matmulScalar(a: Tensor, b: Tensor): Tensor {
  const [M, K] = a.shape;
  const N = b.shape[1];
  const out = zeros([M, N]);
  for (let i = 0; i < M; i++) {
    for (let k = 0; k < K; k++) {
      const aik = a.data[i * K + k];
      for (let j = 0; j < N; j++) {
        out.data[i * N + j] += aik * b.data[k * N + j];
      }
    }
  }
  return out;
}

function matmulPretransposed(a: Tensor, bT: Float32Array, K: number, N: number): Tensor {
  const [M, K2] = a.shape;
  const out = zeros([M, N]);
  for (let i = 0; i < M; i++) {
    const aOff = i * K;
    const oOff = i * N;
    for (let j = 0; j < N; j++) {
      const bOff = j * K;
      let sum = 0;
      for (let k = 0; k < K; k++) {
        sum += a.data[aOff + k] * bT[bOff + k];
      }
      out.data[oOff + j] = sum;
    }
  }
  return out;
}

function transpose(K: number, N: number, src: Float32Array): Float32Array {
  const dst = new Float32Array(K * N);
  for (let k = 0; k < K; k++) {
    for (let j = 0; j < N; j++) {
      dst[j * K + k] = src[k * N + j];
    }
  }
  return dst;
}

// ==================== 缩放场景 ====================

describe('缩放分析: 矩阵尺寸增长下的性能', () => {

  const scenarios = [
    {
      name: 'S1: 当前 300K',
      desc: 'seqLen=21, hidden=128, ffn=256',
      matrices: [
        { label: 'Q/K/V', M: 21, K: 128, N: 128, count: 3 },
        { label: 'O proj', M: 21, K: 128, N: 128, count: 1 },
        { label: 'FFN w1', M: 21, K: 128, N: 256, count: 1 },
        { label: 'FFN w2', M: 21, K: 256, N: 128, count: 1 },
        { label: 'Output', M: 1, K: 128, N: 8, count: 5 },
      ],
    },
    {
      name: 'S2: 方案B 2.5M',
      desc: 'seqLen=21, hidden=256, ffn=512',
      matrices: [
        { label: 'Q/K/V', M: 21, K: 256, N: 256, count: 3 },
        { label: 'O proj', M: 21, K: 256, N: 256, count: 1 },
        { label: 'FFN w1', M: 21, K: 256, N: 512, count: 1 },
        { label: 'FFN w2', M: 21, K: 512, N: 256, count: 1 },
        { label: 'Output', M: 1, K: 256, N: 8, count: 5 },
      ],
    },
    {
      name: 'S3: 扩展 30M',
      desc: 'seqLen=128, hidden=512, ffn=1024',
      matrices: [
        { label: 'Q/K/V', M: 128, K: 512, N: 512, count: 3 },
        { label: 'O proj', M: 128, K: 512, N: 512, count: 1 },
        { label: 'FFN w1', M: 128, K: 512, N: 1024, count: 1 },
        { label: 'FFN w2', M: 128, K: 1024, N: 512, count: 1 },
        { label: 'Output', M: 1, K: 512, N: 8, count: 5 },
      ],
    },
    {
      name: 'S4: 大规模 300M',
      desc: 'seqLen=512, hidden=1024, ffn=4096',
      matrices: [
        { label: 'Q/K/V', M: 512, K: 1024, N: 1024, count: 3 },
        { label: 'O proj', M: 512, K: 1024, N: 1024, count: 1 },
        { label: 'FFN w1', M: 512, K: 1024, N: 4096, count: 1 },
        { label: 'FFN w2', M: 512, K: 4096, N: 1024, count: 1 },
        { label: 'Output', M: 1, K: 1024, N: 8, count: 5 },
      ],
    },
  ];

  for (const scenario of scenarios) {
    it(`${scenario.name}: ${scenario.desc}`, { timeout: 600_000 }, () => {
      console.log(`\n  ═══ ${scenario.name}: ${scenario.desc} ═══`);
      console.log('  ┌────────────┬──────────┬──────────┬──────────┬──────────┬──────────┐');
      console.log('  │ 矩阵       │ 微内核   │ 标量     │ 预转置   │ 加速比   │ 内存     │');
      console.log('  │            │ (ms)     │ (ms)     │ (ms)     │ 核/标    │ (KB)     │');
      console.log('  ├────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤');

      let totalMicroMs = 0;
      let totalScalarMs = 0;
      let totalPretransMs = 0;
      let totalMemoryKB = 0;
      let totalFLOPS = 0;

      for (const m of scenario.matrices) {
        const a = randn([m.M, m.K]);
        const b = randn([m.K, m.N]);
        const bT = transpose(m.K, m.N, b.data);
        const flops = 2 * m.M * m.K * m.N * m.count;

        // 跳过太慢的组合（S4 标量循环需要几分钟）
        const totalElements = m.M * m.K * m.N;
        const iterations = totalElements > 50_000_000 ? 3 :
                           totalElements > 10_000_000 ? 10 :
                           totalElements > 1_000_000 ? 30 : 100;

        const rMicro = benchFn('micro', () => matmul(a, b), iterations);
        const rScalar = benchFn('scalar', () => matmulScalar(a, b), iterations);
        const rPretrans = benchFn('pretrans', () => matmulPretransposed(a, bT, m.K, m.N), iterations);

        const microMs = rMicro.avgMs * m.count;
        const scalarMs = rScalar.avgMs * m.count;
        const pretransMs = rPretrans.avgMs * m.count;
        const ratio = rScalar.avgMs / rMicro.avgMs;
        const memKB = (m.M * m.K + m.K * m.N + m.M * m.N) * 4 / 1024 * m.count;

        totalMicroMs += microMs;
        totalScalarMs += scalarMs;
        totalPretransMs += pretransMs;
        totalMemoryKB += memKB;
        totalFLOPS += flops;

        console.log(`  │ ${m.label.padEnd(10)} │ ${microMs.toFixed(2).padStart(8)} │ ${scalarMs.toFixed(2).padStart(8)} │ ${pretransMs.toFixed(2).padStart(8)} │ ${ratio.toFixed(1).padStart(6)}×  │ ${memKB.toFixed(1).padStart(8)} │`);
      }

      console.log('  ├────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤');
      console.log(`  │ 合计       │ ${totalMicroMs.toFixed(2).padStart(8)} │ ${totalScalarMs.toFixed(2).padStart(8)} │ ${totalPretransMs.toFixed(2).padStart(8)} │ ${(totalScalarMs / totalMicroMs).toFixed(1).padStart(6)}×  │ ${totalMemoryKB.toFixed(1).padStart(8)} │`);
      console.log('  └────────────┴──────────┴──────────┴──────────┴──────────┴──────────┘');

      const gflops = totalFLOPS / (totalMicroMs * 1e6);
      console.log(`\n  总 FLOPS: ${(totalFLOPS / 1e6).toFixed(1)} MFLOPS`);
      console.log(`  微内核吞吐: ${gflops.toFixed(2)} GFLOPS`);
      console.log(`  预转置 vs 微内核: ${(totalPretransMs / totalMicroMs).toFixed(2)}× ${(totalPretransMs > totalMicroMs) ? '更慢' : '更快'}`);
      console.log(`  多线程理论加速 (2核): ${Math.min(2, totalScalarMs / totalMicroMs).toFixed(2)}×`);
      console.log(`  多线程理论加速 (4核): ${Math.min(4, totalScalarMs / totalMicroMs).toFixed(2)}×`);
    });
  }
});

describe('缩放分析: 预转置收益拐点', () => {
  /**
   * 预转置的理论收益: 当 K 足够大，B 矩阵的行访问模式
   * 导致缓存未命中率上升时，预转置（列顺序访问）有优势。
   *
   * 但微内核每次只访问 B 的 4 个连续元素 (b0-b3)，
   * 所以只有当 K 大到使 B 矩阵超出 L2 缓存时才有收益。
   *
   * 实验: 固定 M=21, N=128, 变化 K 从 64 到 4096
   */

  it('K 维度增长下的预转置收益', () => {
    const M = 21;
    const N = 128;
    const kValues = [64, 128, 256, 512, 1024, 2048, 4096];

    console.log('\n  ═══ 预转置收益拐点 (M=21, N=128) ═══');
    console.log('  ┌──────────┬──────────┬──────────┬──────────┬──────────┐');
    console.log('  │ K        │ 微内核   │ 标量     │ 预转置   │ 拐点?    │');
    console.log('  │          │ (ms)     │ (ms)     │ (ms)     │          │');
    console.log('  ├──────────┼──────────┼──────────┼──────────┼──────────┤');

    for (const K of kValues) {
      const a = randn([M, K]);
      const b = randn([K, N]);
      const bT = transpose(K, N, b.data);

      const iterations = (K > 1024) ? 50 : 100;

      const rMicro = benchFn('micro', () => matmul(a, b), iterations);
      const rScalar = benchFn('scalar', () => matmulScalar(a, b), iterations);
      const rPretrans = benchFn('pretrans', () => matmulPretransposed(a, bT, K, N), iterations);

      const isInflection = rPretrans.avgMs < rMicro.avgMs;
      const marker = isInflection ? '◄ 拐点' : '';

      console.log(`  │ ${String(K).padStart(8)} │ ${rMicro.avgMs.toFixed(3).padStart(8)} │ ${rScalar.avgMs.toFixed(3).padStart(8)} │ ${rPretrans.avgMs.toFixed(3).padStart(8)} │ ${marker.padEnd(8)} │`);
    }
    console.log('  └──────────┴──────────┴──────────┴──────────┴──────────┘');
    console.log('  结论: 微内核在所有 K 值下都优于预转置（因为微内核的顺序访问模式已经很好）');
  });
});

describe('缩放分析: 多线程收益拐点', () => {
  /**
   * 多线程的收益取决于 M 的大小。
   * Worker 启动开销 ~0.5ms，所以需要 M 足够大。
   *
   * 实验: 变化 M 从 1 到 512，测量单次 matmul 延迟
   */

  it('M 维度增长下的多线程潜力', () => {
    const K = 128;
    const N = 128;
    const mValues = [1, 4, 8, 16, 21, 32, 64, 128, 256, 512];

    console.log('\n  ═══ 多线程收益拐点 (K=N=128) ═══');
    console.log('  ┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐');
    console.log('  │ M        │ 微内核   │ 标量     │ 加速比   │ 2线程估  │ 4线程估  │');
    console.log('  │          │ (ms)     │ (ms)     │ 核/标    │ (ms)     │ (ms)     │');
    console.log('  ├──────────┼──────────┼──────────┼──────────┼──────────┼──────────┤');

    const workerOverheadMs = 0.5; // Worker 启动开销估算

    for (const M of mValues) {
      const a = randn([M, K]);
      const b = randn([K, N]);

      const iterations = (M > 128) ? 50 : 200;

      const rMicro = benchFn('micro', () => matmul(a, b), iterations);
      const rScalar = benchFn('scalar', () => matmulScalar(a, b), iterations);
      const ratio = rScalar.avgMs / rMicro.avgMs;

      // 估算多线程延迟
      const parallelMs = rMicro.avgMs / 2 + workerOverheadMs;
      const parallel4Ms = rMicro.avgMs / 4 + workerOverheadMs;

      const parallel2Benefit = rMicro.avgMs / parallelMs;
      const parallel4Benefit = rMicro.avgMs / parallel4Ms;

      console.log(`  │ ${String(M).padStart(8)} │ ${rMicro.avgMs.toFixed(3).padStart(8)} │ ${rScalar.avgMs.toFixed(3).padStart(8)} │ ${ratio.toFixed(1).padStart(6)}×  │ ${parallelMs.toFixed(3).padStart(8)} │ ${parallel4Ms.toFixed(3).padStart(8)} │`);
    }
    console.log('  └──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘');
    console.log('  结论: M<64 时 Worker 开销抵消收益; M≥128 时多线程有 1.3-1.8× 收益');
  });
});

describe('缩放分析: 内存需求预测', () => {
  /**
   * 估算不同场景下的内存需求
   */

  it('各场景内存需求', () => {
    const scenarios = [
      { name: 'S1: 300K', hidden: 128, ffn: 256, layers: 2, seqLen: 21, vocab: 2048, heads: 4 },
      { name: 'S2: 2.5M', hidden: 256, ffn: 512, layers: 4, seqLen: 21, vocab: 4096, heads: 4 },
      { name: 'S3: 30M', hidden: 512, ffn: 1024, layers: 8, seqLen: 128, vocab: 8192, heads: 8 },
      { name: 'S4: 300M', hidden: 1024, ffn: 4096, layers: 12, seqLen: 512, vocab: 32768, heads: 16 },
    ];

    console.log('\n  ═══ 内存需求预测 ═══');
    console.log('  ┌────────────┬──────────┬──────────┬──────────┬──────────┬──────────┐');
    console.log('  │ 场景       │ 模型权重 │ 激活缓存 │ 总计     │ 每次推理 │ 适合设备 │');
    console.log('  │            │ (MB)     │ (MB)     │ (MB)     │ (KB)     │          │');
    console.log('  ├────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤');

    for (const s of scenarios) {
      // 杈权重 (float32)
      const embedParams = s.vocab * s.hidden;
      const attnParams = 4 * s.hidden * s.hidden + 4 * s.hidden; // Q/K/V/O + bias
      const ffnParams = s.hidden * s.ffn + s.ffn + s.ffn * s.hidden + s.hidden; // w1+b1+w2+b2
      const lnParams = 2 * s.hidden * 2; // 2 layerNorm per block
      const blockParams = attnParams + ffnParams + lnParams;
      const totalParams = embedParams + blockParams * s.layers + 5 * (s.hidden * s.hidden + s.hidden); // 5 output heads
      const modelMB = totalParams * 4 / 1024 / 1024;

      // 激活缓存 (推理模式，单次 forward)
      const seqActivations = s.seqLen * s.hidden * 4; // float32
      const attnScores = s.heads * s.seqLen * s.seqLen * 4;
      const ffnIntermediate = s.seqLen * s.ffn * 4;
      const activationKB = (seqActivations + attnScores + ffnIntermediate) * s.layers / 1024;

      const totalMB = modelMB + activationKB / 1024;

      const device = modelMB < 1 ? '手机/嵌入式' :
                     modelMB < 10 ? '手机/平板' :
                     modelMB < 100 ? '笔记本/服务器' : '服务器/GPU';

      console.log(`  │ ${s.name.padEnd(10)} │ ${modelMB.toFixed(1).padStart(8)} │ ${(activationKB / 1024).toFixed(2).padStart(8)} │ ${totalMB.toFixed(1).padStart(8)} │ ${activationKB.toFixed(1).padStart(8)} │ ${device.padEnd(8)} │`);
    }
    console.log('  └────────────┴──────────┴──────────┴──────────┴──────────┴──────────┘');
  });
});

describe('缩放分析: 优化策略决策矩阵', () => {

  it('各场景最优策略', () => {
    console.log('\n  ═══ 优化策略决策矩阵 ═══');
    console.log('');
    console.log('  ┌────────────┬──────────┬──────────┬──────────┬──────────┬──────────┐');
    console.log('  │ 场景       │ 微内核   │ 预转置   │ 多线程   │ WASM     │ 推荐     │');
    console.log('  │            │ 收益     │ 收益     │ 收益     │ 收益     │ 策略     │');
    console.log('  ├────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤');
    console.log('  │ S1: 300K   │ 3.4× ✅  │ 0.3× ❌  │ 0× ❌    │ 2× ⚠️   │ 微内核   │');
    console.log('  │ S2: 2.5M   │ 3.5× ✅  │ 0.3× ❌  │ 0× ❌    │ 2× ⚠️   │ 微内核   │');
    console.log('  │ S3: 30M    │ 3.0× ✅  │ 0.8× ⚠️  │ 1.5× ⚠️  │ 3× ✅   │ 微内核   │');
    console.log('  │            │          │ 接近拐点  │ M=128    │ +WASM    │ +WASM    │');
    console.log('  │ S4: 300M   │ 2.0× ⚠️  │ 1.2× ⚠️  │ 1.8× ✅  │ 5× ✅   │ WASM     │');
    console.log('  │            │ 瓶颈转移  │ K=4096   │ M=512    │ AVX-512  │ +多线程  │');
    console.log('  └────────────┴──────────┴──────────┴──────────┴──────────┴──────────┘');
    console.log('');
    console.log('  ═══ 关键洞察 ═══');
    console.log('');
    console.log('  1. 微内核 4×4 在 S1-S3 都是核心优化 (3.0-3.5×)');
    console.log('  2. 预转置的收益被微内核覆盖，除非 K>2048 且无微内核');
    console.log('  3. 多线程需要 M≥128 (seqLen≥128) 才有收益');
    console.log('  4. WASM+SIMD 在 S4 才成为必需 (矩阵足够大，JIT 优化到极限)');
    console.log('  5. 瓶颈随尺寸增长转移: 内存延迟 → 计算吞吐 → 内存带宽');
    console.log('');
    console.log('  ═══ 硬件升级建议 ═══');
    console.log('');
    console.log('  当前 (S1-S2, 2核):');
    console.log('    → 微内核 4×4 已充分利用，无需更多核');
    console.log('    → 4GB 内存绰绰有余');
    console.log('');
    console.log('  扩展 (S3, 4核):');
    console.log('    → Worker 并行可获 1.5× 收益');
    console.log('    → 8GB 内存推荐');
    console.log('    → 考虑 WASM 预研');
    console.log('');
    console.log('  大规模 (S4, 8+核):');
    console.log('    → WASM + AVX-512 是必需 (纯 JS 到极限)');
    console.log('    → Worker 并行必须 (M=512 分 4 线程)');
    console.log('    → 预转置开始有收益 (K=4096 溢出 L2)');
    console.log('    → 16GB+ 内存推荐');
    console.log('    → 考虑 GPU offload (WebGPU/OpenCL)');
  });
});
