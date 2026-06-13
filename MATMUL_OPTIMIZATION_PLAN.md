# Buddy 自研算力优化方案

> 版本: v1.0
> 日期: 2026-05-02
> 前置: THREE_BRAIN_ARCHITECTURE.md §Phase 8
> 目标: 纯 JS 零依赖，推理延迟从 11ms → 3ms（自研）→ 1.3ms（自研+WASM）

---

## 一、现状分析

### 1.1 热路径全景

单次 forward（文档配置 2 层 128d）的完整计算流：

```
输入 tokenIds [21]
    │
    ▼
Embedding.lookup()              0.07ms   (1%)     ← 非瓶颈
    │
    ▼
Projection [21,64]×[64,128]     0.3ms    (3%)     ← matmul #1
    │
    ▼
┌─── Encoder Block × 2 ────────────────────────────────────────────┐
│                                                                    │
│  LayerNorm                         0.02ms                          │
│    │                                                               │
│  Attention:                        4.1ms    (37%)   ← 瓶颈区域 A   │
│    ├─ Q proj: matmul [21,128]×[128,128]    0.6ms                   │
│    ├─ K proj: matmul [21,128]×[128,128]    0.6ms                   │
│    ├─ V proj: matmul [21,128]×[128,128]    0.6ms                   │
│    ├─ scores: 4× matmul [21,32]×[32,21]    0.1ms                   │
│    ├─ softmax                          0.05ms                      │
│    ├─ weightedSum: 4× matmul [21,21]×[21,32]  0.1ms               │
│    └─ O proj: matmul [21,128]×[128,128]    0.6ms                   │
│                                                                    │
│  LayerNorm + Residual              0.02ms                          │
│                                                                    │
│  FFN:                              5.2ms    (47%)   ← 瓶颈区域 B   │
│    ├─ w1: matmul [21,128]×[128,256] + GELU  2.6ms                 │
│    └─ w2: matmul [21,256]×[256,128]         2.6ms                 │
│                                                                    │
│  LayerNorm + Residual              0.02ms                          │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
    │
    ▼
Pool + 5 Output Heads             0.5ms    (4%)     ← 5× matmul [1,128]×[128,out]
    │
    ▼
Decode                            0.01ms   (0%)
    │
    ▼
总计: ~11.1ms (训练模式) / ~11.1ms (推理模式)
```

### 1.2 matmul 调用统计

| 调用位置 | 矩阵尺寸 | 次数/层 | 单次 FLOPS | 延迟占比 |
|----------|----------|---------|------------|----------|
| Q/K/V 投影 | [21,128]×[128,128] | 3 | 691K | 18% |
| O 投影 | [21,128]×[128,128] | 1 | 691K | 6% |
| Attention scores | [21,32]×[32,21] | 4 | 57K | 1% |
| Attention weightedSum | [21,21]×[21,32] | 4 | 57K | 1% |
| FFN w1 | [21,128]×[128,256] | 1 | 1.38M | 24% |
| FFN w2 | [21,256]×[256,128] | 1 | 1.38M | 24% |
| Output heads | [1,128]×[128,N] | 5 | 101K | 4% |
| Projection | [21,64]×[64,128] | 1 | 344K | 3% |

**2 层总计: 18 次 matmul, 12.1 MFLOPS, 1525 KB 内存访问**

### 1.3 瓶颈定位

```
算术强度 = 12.1 MFLOPS / 1.5 MB = 7.8 FLOPS/Byte

判断: < 10 → 内存延迟受限 (Memory-Latency Bound)

含义:
  - 不是浮点吞吐不够 (CPU 算得过来)
  - 是每次 matmul 的"启动开销"太高
  - 函数调用 + 边界检查 + 缓存未命中 占了大部分时间
```

### 1.4 当前 matmul 内核的问题

```typescript
// 当前实现 (tensor.ts)
for (i0...) for (k0...) for (j0...)        // ← 三层分块循环 (开销大)
  for (i...) for (k...) for (j...)          // ← 三层内循环 (无展开)
    out[i*N+j] += a[i*K+k] * b[k*N+j]      // ← 标量乘加 (无 SIMD)
    if (aik === 0) continue                 // ← 分支预测 (几乎不跳过)
```

| 问题 | 影响 | 优化方向 |
|------|------|----------|
| 内循环无展开 | 每次迭代 1 次 FMA，循环开销占比 ~30% | 微内核 4×4 |
| 无寄存器分块 | 累加器写内存，无法隐藏加法延迟 | 多累加器 |
| B 矩阵列访问 | `b[k*N+j]` 跨行访问，缓存不友好 | 预转置 |
| 零值跳过 | NN 权重稀疏率 < 1%，`if` 反而有害 | 移除 |
| TILE=32 过大 | 32×32×4 = 4KB，超出某些 L1 的关联度 | 缩小到 16 |
| 单线程 | 2 核只用 1 核 | Worker 并行 |
| 训练/推理共用一个函数 | 推理时 `_ctx` 缓存浪费 | 分离推理路径 |

---

## 二、优化方案详解

### 方案 A: 微内核 4×4 寄存器分块

> 改动文件: `src/brain/right/nn/tensor.ts`
> 改动量: ~120 行
> 预期收益: 1.11 → **2.5 GFLOPS** (2.3×)
> 原理: 16 个累加器并行计算，隐藏 V8 浮点加法延迟

#### 核心思想

当前内核每次迭代做 1 次 `out[oRow+j] += aik * b[bRow+j]`：
- 读 `out[oRow+j]` (1 次内存读)
- 读 `b[bRow+j]` (1 次内存读)
- 乘加 (1 次 FMA)
- 写 `out[oRow+j]` (1 次内存写)
- **每次 FMA 需要 3 次内存访问**

微内核用 16 个局部变量作为累加器：
- 16 个 `cXY` 在寄存器中（不访问内存）
- 内层循环只读 A 和 B（2 次内存读）
- 16 次 FMA 后才写回内存
- **每次 FMA 只需 0.125 次内存写**

#### 实现方案

```typescript
/**
 * 微内核 matmul: 4×4 寄存器分块
 *
 * 适用矩阵: M ≤ 32, K ≤ 256, N ≤ 256 (Buddy 的典型尺寸)
 * 大矩阵回退到分块版本
 */
function matmulMicro4x4(
  a: Float32Array, b: Float32Array, out: Float32Array,
  M: number, K: number, N: number,
): void {
  // 处理 4×4 对齐的块
  const M4 = M & ~3;  // 向下对齐到 4
  const N4 = N & ~3;

  for (let i0 = 0; i0 < M4; i0 += 4) {
    for (let j0 = 0; j0 < N4; j0 += 4) {
      // 16 个累加器 — V8 会分配到寄存器
      let c00 = 0, c01 = 0, c02 = 0, c03 = 0;
      let c10 = 0, c11 = 0, c12 = 0, c13 = 0;
      let c20 = 0, c21 = 0, c22 = 0, c23 = 0;
      let c30 = 0, c31 = 0, c32 = 0, c33 = 0;

      for (let k = 0; k < K; k++) {
        // 预加载 A 的 4 行
        const a0 = a[(i0)   * K + k];
        const a1 = a[(i0+1) * K + k];
        const a2 = a[(i0+2) * K + k];
        const a3 = a[(i0+3) * K + k];

        // 预加载 B 的 1 行 (4 列)
        const bOff = k * N + j0;
        const b0 = b[bOff];
        const b1 = b[bOff + 1];
        const b2 = b[bOff + 2];
        const b3 = b[bOff + 3];

        // 16 次 FMA — 无内存写入
        c00 += a0 * b0;  c01 += a0 * b1;  c02 += a0 * b2;  c03 += a0 * b3;
        c10 += a1 * b0;  c11 += a1 * b1;  c12 += a1 * b2;  c13 += a1 * b3;
        c20 += a2 * b0;  c21 += a2 * b1;  c22 += a2 * b2;  c23 += a2 * b3;
        c30 += a3 * b0;  c31 += a3 * b1;  c32 += a3 * b2;  c33 += a3 * b3;
      }

      // 写回 — 只有 16 次内存写
      const oOff0 = i0 * N + j0;
      const oOff1 = oOff0 + N;
      const oOff2 = oOff1 + N;
      const oOff3 = oOff2 + N;

      out[oOff0]     = c00; out[oOff0 + 1] = c01; out[oOff0 + 2] = c02; out[oOff0 + 3] = c03;
      out[oOff1]     = c10; out[oOff1 + 1] = c11; out[oOff1 + 2] = c12; out[oOff1 + 3] = c13;
      out[oOff2]     = c20; out[oOff2 + 1] = c21; out[oOff2 + 2] = c22; out[oOff2 + 3] = c23;
      out[oOff3]     = c30; out[oOff3 + 1] = c31; out[oOff3 + 2] = c32; out[oOff3 + 3] = c33;
    }
  }

  // 处理剩余行/列 (M%4 或 N%4 的尾部)
  // ... 用标量循环补齐
}
```

#### 为什么 4×4 而不是 8×8？

| 分块 | 累加器 | V8 寄存器分配 | 实际收益 |
|------|--------|--------------|----------|
| 1×1 | 1 | ✅ 100% | 1× (当前) |
| 2×2 | 4 | ✅ 100% | ~1.5× |
| **4×4** | **16** | ✅ **~90%** | **~2.3×** |
| 8×8 | 64 | ❌ 溢出到栈 | ~1.8× (反而慢) |

V8 TurboFan 在 x64 上有 ~16 个通用浮点寄存器 (xmm0-xmm15)。
16 个累加器刚好用满，再多就溢出到栈，反而变慢。

---

### 方案 B: B 矩阵预转置

> 改动文件: `src/brain/right/nn/tensor.ts`
> 改动量: ~40 行
> 预期收益: 额外 **1.2-1.5×** (与 A 叠加)

#### 核心思想

当前 `b[k*N+j]` 沿 j 方向访问（行访问），但内层循环沿 k 方向。
导致 B 矩阵的每一行在 k 循环中被反复读取，但缓存行只预取 j 方向。

预转置后 `bT[j*K+k]`，两个数组都沿 k 方向顺序访问。

#### 实现方案

```typescript
/**
 * 预转置优化的 matmul
 *
 * 适用场景: 同一 B 矩阵被多次使用 (Q/K/V 投影共享输入)
 * 不适用: B 矩阵只用一次 (转置开销 > 收益)
 */
function matmulTransposed(
  a: Float32Array, b: Float32Array, out: Float32Array,
  M: number, K: number, N: number,
  bTransposed: Float32Array,  // 预转置的 B
): void {
  for (let i = 0; i < M; i++) {
    const aOff = i * K;
    const oOff = i * N;
    for (let j = 0; j < N; j++) {
      const bOff = j * K;
      let sum = 0;
      for (let k = 0; k < K; k++) {
        sum += a[aOff + k] * bTransposed[bOff + k];
      }
      out[oOff + j] = sum;
    }
  }
}

/**
 * 转置矩阵: [K, N] → [N, K]
 * 只需执行一次，后续所有 matmul 复用
 */
function transpose(K: number, N: number, src: Float32Array): Float32Array {
  const dst = new Float32Array(K * N);
  for (let k = 0; k < K; k++) {
    for (let j = 0; j < N; j++) {
      dst[j * K + k] = src[k * N + j];
    }
  }
  return dst;
}
```

#### 预转置的缓存复用

```
Q/K/V 投影: 3 次 matmul [21,128]×[128,128]
  → 输入 A 不同，权重 B 相同
  → 预转置 B 一次，3 次 matmul 复用
  → 转置开销: 128×128×4 = 64KB (一次性)
  → 节省: 3 次 × 缓存未命中改善 = 显著

FFN w1/w2: 权重不同，无法复用
  → 但仍受益于顺序访问模式
```

---

### 方案 C: 多线程并行

> 改动文件: 新增 `src/brain/right/nn/parallel-matmul.ts`
> 改动量: ~200 行
> 预期收益: 额外 **1.5-1.8×** (与 A+B 叠加)
> 限制: 需要 Node.js `worker_threads`

#### 核心思想

将 M 行分配给 N 个 worker 并行计算。每个 worker 独立计算行块，无锁竞争。

#### 实现方案

```typescript
// parallel-matmul.ts — 主线程
import { Worker } from 'worker_threads';

export async function matmulParallel(
  a: Float32Array, b: Float32Array,
  M: number, K: number, N: number,
  numWorkers = 2,
): Promise<Float32Array> {
  const out = new Float32Array(M * N);
  const rowsPerWorker = Math.ceil(M / numWorkers);

  const promises: Promise<void>[] = [];

  for (let w = 0; w < numWorkers; w++) {
    const startRow = w * rowsPerWorker;
    const endRow = Math.min(startRow + rowsPerWorker, M);
    if (startRow >= M) break;

    promises.push(new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./matmul-worker.js', import.meta.url), {
        workerData: { a, b, startRow, endRow, K, N },
      });
      worker.on('message', (result: { out: Float32Array }) => {
        out.set(result.out, startRow * N);
        resolve();
      });
      worker.on('error', reject);
    }));
  }

  await Promise.all(promises);
  return out;
}

// matmul-worker.js — Worker 线程
import { parentPort, workerData } from 'worker_threads';

const { a, b, startRow, endRow, K, N } = workerData;
const out = new Float32Array((endRow - startRow) * N);

// 使用微内核计算行块
matmulMicro4x4(
  a.subarray(startRow * K, endRow * K),
  b, out,
  endRow - startRow, K, N,
);

parentPort.postMessage({ out });
```

#### 多线程的限制

| 因素 | 影响 |
|------|------|
| 矩阵太小 | M=21 行分 2 线程 → 每线程 10-11 行，启动开销可能抵消收益 |
| Worker 创建开销 | 首次 ~5ms，需预创建 Worker 池 |
| 共享内存 | Float32Array 传递有拷贝开销 (除非用 SharedArrayBuffer) |

**建议: 方案 C 在矩阵 M≥64 时才有明显收益。对 M=21 的小矩阵，A+B 已足够。**

---

### 方案 D: 推理模式优化

> 改动文件: `src/brain/right/nn/model.ts`, `attention.ts`, `ffn.ts`
> 改动量: ~60 行
> 预期收益: 推理延迟 **-10-15%**

#### 核心思想

推理时不需要反向传播，可以跳过所有 `_ctx` 缓存和中间值保存。

#### 实现方案

```typescript
// tensor.ts — 推理模式下的 matmul (跳过 _ctx)
export function matmul(a: Tensor, b: Tensor, inference = false): Tensor {
  // ... 计算 ...

  // 只在训练模式下缓存
  if (!inference && !_inferenceMode) {
    out._ctx = { op: 'matmul', saved: [], parents: [a, b] };
  }
  return out;
}

// model.ts — forwardInference 已有此模式，但需要扩散到所有子模块
forwardInference(tokenIds: number[]): ModelOutput {
  enterInferenceMode();  // 设置全局标志
  try {
    // 所有子模块检查 isInferenceMode() 跳过 _ctx
  } finally {
    exitInferenceMode();
  }
}
```

#### 跳过 _ctx 的收益

| 操作 | 训练模式 | 推理模式 | 节省 |
|------|----------|----------|------|
| matmul _ctx 创建 | ~0.02ms/次 | 跳过 | 18×0.02 = 0.36ms |
| 中间 Tensor 缓存 | ~0.01ms/次 | 跳过 | ~0.2ms |
| 临时 Float32Array | ~1.9KB/次 | 复用池 | GC 减少 |
| **总计** | | | **~0.5-0.8ms** |

---

### 方案 E: 融合算子扩展

> 改动文件: `src/brain/right/nn/tensor.ts`
> 改动量: ~80 行
> 预期收益: **-5-8%** 延迟

#### 核心思想

当前 `gelu(matmulAddBias(...))` 创建了 2 个中间 Tensor。
融合为一个操作，减少内存分配和写入。

#### 融合列表

| 当前 | 融合后 | 节省 |
|------|--------|------|
| `gelu(matmulAddBias(a, w, b))` | `matmulAddBiasGelu(a, w, b)` | 1 次 zeros + 1 次全量遍历 |
| `add(matmul(a, b), bias)` | `matmulAddBias(a, b, bias)` | ✅ 已有 |
| `layerNorm(residual + sublayer(x))` | `fusedLayerNormResidual(...)` | 1 次 add + 1 次遍历 |

```typescript
/** 融合 matmul + bias + GELU: [M,K]×[K,N] + [N] → GELU → [M,N] */
export function matmulAddBiasGelu(a: Tensor, b: Tensor, bias: Tensor): Tensor {
  const [M, K] = a.shape;
  const N = b.shape[1];
  const out = zeros([M, N]);

  // ... matmul 计算 (同 matmulAddBias) ...
  // ... bias 加法 ...

  // 融合 GELU (原地)
  const SQRT_2_OVER_PI = 0.7978845608;
  const COEFF = 0.044715;
  for (let i = 0; i < out.size; i++) {
    const x = out.data[i];
    const x3 = x * x * x;
    const inner = SQRT_2_OVER_PI * (x + COEFF * x3);
    out.data[i] = 0.5 * x * (1 + Math.tanh(inner));
  }

  return out;
}
```

---

## 三、组合方案与延迟预测

### 3.1 逐步叠加

| 步骤 | 方案 | 累计提速 | 延迟 | 改动量 |
|------|------|----------|------|--------|
| 0 | 当前 | 1× | 11.1ms | — |
| 1 | +A 微内核 | 2.3× | 4.8ms | 120 行 |
| 2 | +B 预转置 | 3.0× | 3.7ms | 40 行 |
| 3 | +D 推理模式 | 3.4× | 3.3ms | 60 行 |
| 4 | +E 融合算子 | 3.7× | 3.0ms | 80 行 |
| 5 | +C 多线程 (可选) | 4.5× | 2.5ms | 200 行 |

**A+B+D+E = 300 行改动，3.0ms，3.7× 提速。零依赖。**

### 3.2 推荐执行顺序

```
Phase 8.1: 微内核 (A)           ← 最高 ROI，独立生效
Phase 8.2: 推理模式分离 (D)     ← 低风险，立即生效
Phase 8.3: 融合算子 (E)         ← 中等 ROI
Phase 8.4: 预转置 (B)           ← 需要修改调用方
Phase 8.5: 多线程 (C)           ← 可选，矩阵小时收益有限
Phase 8.6: WASM (可选)          ← 自研不够时的后备
```

---

## 四、详细实施计划

### Phase 8.1: 微内核 4×4 (Day 1-2)

| # | 任务 | 文件 | 产出 | 耗时 |
|---|------|------|------|------|
| 1 | 实现 `matmulMicro4x4()` | `tensor.ts` | 4×4 寄存器分块内核 | 2h |
| 2 | 实现尾部处理 (M%4, N%4) | `tensor.ts` | 标量循环补齐 | 1h |
| 3 | 集成到 `matmul()` | `tensor.ts` | 矩阵尺寸判断 + 路由 | 1h |
| 4 | 集成到 `matmulAddBias()` | `tensor.ts` | 融合版本的微内核 | 1h |
| 5 | 集成到 `batchMatmul()` | `tensor.ts` | 批量版本的微内核 | 1h |
| 6 | 单元测试 | `tensor.test.ts` | 数值正确性验证 (vs 当前实现) | 1h |
| 7 | 性能基准 | `compute-benchmark.test.ts` | 吞吐量对比 | 30min |
| 8 | 提交 | commit | Phase 8.1 | 10min |

**验收标准:**
- 数值正确: 与当前实现的输出差 < 1e-5 (浮点误差)
- 性能提升: matmul 吞吐 ≥ 2.0 GFLOPS (当前 1.11)
- 推理延迟: ≤ 6ms (当前 11.1ms)
- 训练兼容: backward pass 梯度正确

### Phase 8.2: 推理模式分离 (Day 3)

| # | 任务 | 文件 | 产出 | 耗时 |
|---|------|------|------|------|
| 1 | `matmul()` 接受 `inference` 参数 | `tensor.ts` | 跳过 _ctx | 30min |
| 2 | `matmulAddBias()` 同上 | `tensor.ts` | 跳过 _ctx | 20min |
| 3 | `add/sub/relu/gelu/softmax/layerNorm` 同上 | `tensor.ts` | 跳过 _ctx | 1h |
| 4 | `Attention.forward()` 接受 inference | `attention.ts` | 跳过缓存 | 30min |
| 5 | `FFN.forward()` 同上 | `ffn.ts` | 跳过缓存 | 20min |
| 6 | `OutputHeads.forward()` 同上 | `output-heads.ts` | 跳过缓存 | 20min |
| 7 | `forwardInference()` 传播 inference 标志 | `model.ts` | 全链路 | 30min |
| 8 | 测试: forward 和 forwardInference 输出一致 | 测试 | 回归验证 | 30min |
| 9 | 基准: 推理模式 vs 训练模式延迟对比 | 基准 | 量化收益 | 15min |

**验收标准:**
- forwardInference 输出与 forward 一致 (差 < 1e-6)
- 推理延迟比训练模式低 ≥ 8%

### Phase 8.3: 融合算子 (Day 4)

| # | 任务 | 文件 | 产出 | 耗时 |
|---|------|------|------|------|
| 1 | 实现 `matmulAddBiasGelu()` | `tensor.ts` | 融合 FFN 的 3 步 | 1.5h |
| 2 | FFN 使用融合算子 | `ffn.ts` | 减少中间 Tensor | 30min |
| 3 | 实现 `fusedLayerNormResidual()` | `tensor.ts` | 融合 LN + 残差 | 1h |
| 4 | Encoder 使用融合 LN | `encoder.ts` | 减少中间 Tensor | 30min |
| 5 | 测试: 融合 vs 分离输出一致 | 测试 | 回归验证 | 30min |
| 6 | 基准: 融合后的延迟对比 | 基准 | 量化收益 | 15min |

**验收标准:**
- 融合后输出与分离一致 (差 < 1e-5)
- 延迟降低 ≥ 5%

### Phase 8.4: 预转置 (Day 5-6)

| # | 任务 | 文件 | 产出 | 耗时 |
|---|------|------|------|------|
| 1 | 实现 `transpose()` | `tensor.ts` | 矩阵转置 | 30min |
| 2 | 实现 `matmulPretransposed()` | `tensor.ts` | 用预转置 B 的 matmul | 1.5h |
| 3 | Attention 中 Q/K/V 投影使用预转置 | `attention.ts` | 3 次 matmul 共享转置 B | 1h |
| 4 | OutputHeads 使用预转置 | `output-heads.ts` | 5 个 head 共享转置 | 1h |
| 5 | 权重变更时重新转置 | `model.ts` | loadModel/OnlineLearner 后 | 30min |
| 6 | 测试: 预转置 vs 原始输出一致 | 测试 | 回归验证 | 30min |
| 7 | 基准: 预转置后的延迟对比 | 基准 | 量化收益 | 15min |

**验收标准:**
- 预转置后输出与原始一致 (差 < 1e-5)
- 延迟在微内核基础上再降低 ≥ 10%

### Phase 8.5: 多线程 (Day 7-8, 可选)

| # | 任务 | 文件 | 产出 | 耗时 |
|---|------|------|------|------|
| 1 | 实现 Worker 池 | `parallel-matmul.ts` | 预创建 2 个 Worker | 2h |
| 2 | 实现 `matmulParallel()` | `parallel-matmul.ts` | 行块分配 + 结果合并 | 2h |
| 3 | 实现 Worker 内的微内核 | `matmul-worker.ts` | Worker 内用 4×4 | 1h |
| 4 | 集成到 `forward()` | `model.ts` | 大矩阵用并行 | 1h |
| 5 | 测试: 并行 vs 串行输出一致 | 测试 | 回归验证 | 1h |
| 6 | 基准: 并行后的延迟对比 | 基准 | 量化收益 | 30min |

**验收标准:**
- 并行输出与串行一致 (差 < 1e-5, 因浮点顺序不同)
- M≥64 时延迟降低 ≥ 20%
- M<32 时回退到串行 (避免 Worker 开销)

---

## 五、测试策略

### 5.1 数值正确性

```typescript
// 每个优化方案都必须通过此测试
function assertMatmulCorrect(
  optimized: Float32Array,
  reference: Float32Array,
  tolerance = 1e-5,
): void {
  expect(optimized.length).toBe(reference.length);
  for (let i = 0; i < reference.length; i++) {
    const diff = Math.abs(optimized[i] - reference[i]);
    const relDiff = diff / (Math.abs(reference[i]) + 1e-8);
    expect(relDiff).toBeLessThan(tolerance);
  }
}
```

### 5.2 性能回归

```typescript
// 每次改动后运行，确保不退步
it('matmul 吞吐量不低于基线', () => {
  const throughput = benchmarkMatmul();
  expect(throughput).toBeGreaterThan(1.1); // 至少保持当前水平
});
```

### 5.3 训练兼容性

```typescript
// 微内核 + backward 的端到端验证
it('微内核训练收敛', async () => {
  const model = new IntuitionNet(config);
  const learner = new OnlineLearner(model, learnConfig);

  // 100 步训练，loss 应下降
  for (let i = 0; i < 100; i++) {
    await learner.update();
  }

  expect(learner.stats.avgLoss).toBeLessThan(initialLoss);
});
```

---

## 六、风险与回退

| 风险 | 影响 | 缓解 |
|------|------|------|
| V8 不将累加器分配到寄存器 | 微内核收益减半 | 检查 V8 生成的机器码 (`--print-opt-code`) |
| 浮点精度差异 | 训练不收敛 | 用相对误差而非绝对误差，设合理容忍度 |
| 多线程 Worker 创建开销 | 小矩阵反而变慢 | 矩阵尺寸阈值，M<64 回退串行 |
| 预转置的内存开销 | 额外 64KB/权重矩阵 | 只对高频复用的权重转置 |
| 推理模式跳过 _ctx 后无法 backward | 训练崩溃 | inference 标志只在 forwardInference 中使用 |

### 回退方案

```typescript
// matmul 入口：根据矩阵尺寸自动选择最优路径
export function matmul(a: Tensor, b: Tensor): Tensor {
  const [M, K] = a.shape;
  const [_, N] = b.shape;

  // 小矩阵: 微内核
  if (M <= 32 && K <= 256 && N <= 256) {
    return matmulMicro4x4(a, b);
  }

  // 中矩阵: 分块 + 微内核
  if (M <= 128) {
    return matmulTiled(a, b, TILE_16);
  }

  // 大矩阵: 分块
  return matmulTiled(a, b, TILE_32);
}
```

---

## 七、WASM 预留接口

> 当自研优化到极限（~3ms）仍不够时，用 WASM 替换 matmul 内核。

### 接口设计

```typescript
// tensor.ts — matmul 入口自动选择后端
let _backend: 'js' | 'wasm' = 'js';

export function setBackend(backend: 'js' | 'wasm'): void {
  _backend = backend;
}

export function matmul(a: Tensor, b: Tensor): Tensor {
  if (_backend === 'wasm' && _wasmMatmul) {
    return _wasmMatmul(a, b);  // 调用 WASM 模块
  }
  return matmulJS(a, b);       // 纯 JS 实现
}
```

### WASM 实现路径

```
Phase 8.6 (可选): WASM matmul
  1. 用 C 实现 4×4 微内核 + AVX2 SIMD
  2. 编译为 .wasm (emscripten 或 wasm-pack)
  3. 通过 WebAssembly.instantiate() 加载
  4. 通过 SharedArrayBuffer 共享 Float32Array 内存
  5. tensor.ts 的 matmul() 自动路由到 WASM

预期: 3ms → 1.3ms (再提速 2.3×)
```

---

## 八、度量指标

| 指标 | 当前 | Phase 8.1 | Phase 8.1-8.4 | Phase 8.1-8.5 | +WASM |
|------|------|-----------|---------------|---------------|-------|
| matmul 吞吐 | 1.11 GFLOPS | 2.5 | 3.5 | 4.0 | 6.0 |
| 推理延迟 (300K) | 11.1ms | 4.8ms | 3.0ms | 2.5ms | 1.3ms |
| 推理延迟 (3M) | 83ms | 36ms | 23ms | 19ms | 10ms |
| 三脑决策延迟 | ~12ms | ~6ms | ~4ms | ~3.5ms | ~2ms |
| 内存分配/次 | 1.9KB | 1.5KB | 0.8KB | 0.8KB | 0.5KB |
| 外部依赖 | 0 | 0 | 0 | 0 | 1 (.wasm) |

---

## 九、与 THREE_BRAIN_ARCHITECTURE.md 的关系

本文档是 §Phase 8 的详细实施方案。

- THREE_BRAIN_ARCHITECTURE.md §Phase 8 提供总览和优先级
- 本文档提供每个方案的完整实现细节
- 实施时以本文档为准
