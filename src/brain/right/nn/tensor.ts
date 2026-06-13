/**
 * 张量运算内核 — 纯 TypeScript，零依赖
 *
 * 支持前向推理 + 反向传播（用于在线学习）
 * 数据布局：row-major，Float32Array
 */

import { globalPool } from './pool.js';

// ==================== 全局推理模式 ====================

let _inferenceMode = false;
let _inferenceBuffers: Array<{ shape: number[]; data: Float32Array }> = [];

/** 进入推理模式：使用对象池 + 跳过 _ctx 缓存 */
export function enterInferenceMode(): void {
  _inferenceMode = true;
  _inferenceBuffers = [];
}

/** 退出推理模式：恢复训练模式 + 释放所有池化 buffer */
export function exitInferenceMode(): void {
  globalPool.releaseAll(_inferenceBuffers);
  _inferenceBuffers = [];
  _inferenceMode = false;
}

export function isInferenceMode(): boolean {
  return _inferenceMode;
}

// ==================== Tensor 类 ====================

export class Tensor {
  data: Float32Array;
  shape: number[];
  grad: Float32Array | null = null;

  /** 前向时缓存的中间值，反向传播时使用 */
  _ctx: TensorContext | null = null;

  constructor(data: Float32Array, shape: number[]) {
    this.data = data;
    this.shape = shape;
  }

  get rank(): number { return this.shape.length; }
  get size(): number { return this.shape.reduce((a, b) => a * b, 1); }

  clone(): Tensor {
    const t = new Tensor(new Float32Array(this.data), [...this.shape]);
    if (this.grad) t.grad = new Float32Array(this.grad);
    return t;
  }

  zeroGrad(): void {
    if (this.grad) this.grad.fill(0);
  }

  ensureGrad(): Float32Array {
    if (!this.grad) this.grad = new Float32Array(this.size);
    return this.grad;
  }

  item(): number {
    return this.data[0];
  }

  toString(): string {
    return `Tensor(shape=[${this.shape.join(',')}], data=[${this.data.slice(0, 8).join(', ')}${this.size > 8 ? '...' : ''}])`;
  }
}

/** 反向传播上下文：缓存前向时需要的中间值 */
export interface TensorContext {
  op: string;
  saved: (Tensor | Float32Array | number[] | number)[];
  parents: Tensor[];
}

// ==================== 工厂函数 ====================

export function zeros(shape: number[]): Tensor {
  if (_inferenceMode) {
    const data = globalPool.acquire(shape);
    _inferenceBuffers.push({ shape, data });
    return new Tensor(data, shape);
  }
  return new Tensor(new Float32Array(shape.reduce((a, b) => a * b, 1)), shape);
}

/** 将 Tensor 的底层 buffer 归还到对象池（仅推理模式使用） */
export function releaseToPool(t: Tensor): void {
  if (t.data && t.data.length > 0) {
    globalPool.release(t.shape, t.data);
  }
}

export function ones(shape: number[]): Tensor {
  const size = shape.reduce((a, b) => a * b, 1);
  const data = new Float32Array(size);
  data.fill(1);
  return new Tensor(data, shape);
}

export function randn(shape: number[], scale = 1): Tensor {
  const size = shape.reduce((a, b) => a * b, 1);
  const data = new Float32Array(size);
  // Box-Muller 变换生成正态分布
  for (let i = 0; i < size; i += 2) {
    const u1 = Math.random() || 1e-10;
    const u2 = Math.random();
    const r = Math.sqrt(-2 * Math.log(u1));
    data[i] = r * Math.cos(2 * Math.PI * u2) * scale;
    if (i + 1 < size) data[i + 1] = r * Math.sin(2 * Math.PI * u2) * scale;
  }
  return new Tensor(data, shape);
}

export function fromArray(data: number[], shape: number[]): Tensor {
  return new Tensor(new Float32Array(data), shape);
}

export function scalar(value: number): Tensor {
  return new Tensor(new Float32Array([value]), [1]);
}

/** Xavier 均匀初始化 */
export function xavierUniform(fanIn: number, fanOut: number): Tensor {
  const limit = Math.sqrt(6 / (fanIn + fanOut));
  const size = fanIn * fanOut;
  const data = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    data[i] = (Math.random() * 2 - 1) * limit;
  }
  return new Tensor(data, [fanIn, fanOut]);
}

// ==================== 前向运算 ====================

/**
 * 4×4 微内核：寄存器分块矩阵乘法
 *
 * 每次处理 4 行 × 4 列，使用 16 个累加器变量。
 * V8 TurboFan 会将这 16 个变量分配到 xmm 寄存器，避免内存写入。
 * 相比标量内核约 2.3× 提速。
 *
 * @param a 数据矩阵（行优先）
 * @param b 权重矩阵（行优先）
 * @param out 输出矩阵（行优先）
 * @param M 行数
 * @param K 内维
 * @param N 列数
 */
function _matmulMicro4x4(
  a: Float32Array, b: Float32Array, out: Float32Array,
  M: number, K: number, N: number,
): void {
  const M4 = M & ~3;  // 向下对齐到 4
  const N4 = N & ~3;

  for (let i0 = 0; i0 < M4; i0 += 4) {
    for (let j0 = 0; j0 < N4; j0 += 4) {
      // 16 个累加器 — V8 会分配到 xmm0-xmm15 寄存器
      let c00 = 0, c01 = 0, c02 = 0, c03 = 0;
      let c10 = 0, c11 = 0, c12 = 0, c13 = 0;
      let c20 = 0, c21 = 0, c22 = 0, c23 = 0;
      let c30 = 0, c31 = 0, c32 = 0, c33 = 0;

      for (let k = 0; k < K; k++) {
        // 预加载 A 的 4 行同一列
        const a0 = a[i0       * K + k];
        const a1 = a[(i0 + 1) * K + k];
        const a2 = a[(i0 + 2) * K + k];
        const a3 = a[(i0 + 3) * K + k];

        // 预加载 B 的 1 行 4 列
        const bOff = k * N + j0;
        const b0 = b[bOff];
        const b1 = b[bOff + 1];
        const b2 = b[bOff + 2];
        const b3 = b[bOff + 3];

        // 16 次 FMA — 纯寄存器操作，无内存写入
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

  // 处理剩余：M%4 的尾行（所有列）
  for (let i = M4; i < M; i++) {
    for (let j = 0; j < N; j++) {
      let sum = 0;
      for (let k = 0; k < K; k++) {
        sum += a[i * K + k] * b[k * N + j];
      }
      out[i * N + j] = sum;
    }
  }

  // 处理剩余：N%4 的尾列（仅对 4 对齐的行，尾行已在上面处理）
  for (let i = 0; i < M4; i++) {
    for (let j = N4; j < N; j++) {
      let sum = 0;
      for (let k = 0; k < K; k++) {
        sum += a[i * K + k] * b[k * N + j];
      }
      out[i * N + j] = sum;
    }
  }
}

/**
 * 带分块的 4×4 微内核：用于较大矩阵
 *
 * 按 16×16 分块，每个块内用 4×4 微内核。
 * TILE=16 使每个块的 A 子矩阵 = 16×K×4B，B 子矩阵 = K×16×4B，
 * 在 K=128 时约 8KB+8KB = 16KB，适配大多数 L1 缓存。
 */
function _matmulTiled4x4(
  a: Float32Array, b: Float32Array, out: Float32Array,
  M: number, K: number, N: number,
): void {
  const TILE = 16;

  for (let i0 = 0; i0 < M; i0 += TILE) {
    const iEnd = Math.min(i0 + TILE, M);
    const iAligned = iEnd & ~3;  // 对齐到 4（微内核要求）
    for (let j0 = 0; j0 < N; j0 += TILE) {
      const jEnd = Math.min(j0 + TILE, N);
      const jAligned = jEnd & ~3;

      // 4×4 微内核处理对齐部分
      const mAligned = iAligned - i0;
      const nAligned = jAligned - j0;
      if (mAligned > 0 && nAligned > 0) {
        // 提取子矩阵视图（不拷贝，直接用偏移计算）
        _matmulMicro4x4Block(a, b, out, i0, j0, K, N, mAligned, nAligned);
      }

      // 处理尾行（< 4 行）
      for (let i = iAligned; i < iEnd; i++) {
        for (let j = j0; j < jEnd; j++) {
          let sum = 0;
          for (let k = 0; k < K; k++) {
            sum += a[i * K + k] * b[k * N + j];
          }
          out[i * N + j] += sum;
        }
      }

      // 处理尾列（< 4 列，仅对齐行）
      for (let i = i0; i < iAligned; i++) {
        for (let j = jAligned; j < jEnd; j++) {
          let sum = 0;
          for (let k = 0; k < K; k++) {
            sum += a[i * K + k] * b[k * N + j];
          }
          out[i * N + j] += sum;
        }
      }
    }
  }
}

/** 4×4 微内核的子矩阵块版本（带偏移，累加到 out） */
function _matmulMicro4x4Block(
  a: Float32Array, b: Float32Array, out: Float32Array,
  iOff: number, jOff: number, K: number, N: number,
  M: number, NJ: number,
): void {
  const M4 = M & ~3;
  const N4 = NJ & ~3;

  for (let i0 = 0; i0 < M4; i0 += 4) {
    const absI = iOff + i0;
    for (let j0 = 0; j0 < N4; j0 += 4) {
      const absJ = jOff + j0;

      let c00 = 0, c01 = 0, c02 = 0, c03 = 0;
      let c10 = 0, c11 = 0, c12 = 0, c13 = 0;
      let c20 = 0, c21 = 0, c22 = 0, c23 = 0;
      let c30 = 0, c31 = 0, c32 = 0, c33 = 0;

      for (let k = 0; k < K; k++) {
        const a0 = a[absI       * K + k];
        const a1 = a[(absI + 1) * K + k];
        const a2 = a[(absI + 2) * K + k];
        const a3 = a[(absI + 3) * K + k];

        const bOff = k * N + absJ;
        const b0 = b[bOff];
        const b1 = b[bOff + 1];
        const b2 = b[bOff + 2];
        const b3 = b[bOff + 3];

        c00 += a0 * b0;  c01 += a0 * b1;  c02 += a0 * b2;  c03 += a0 * b3;
        c10 += a1 * b0;  c11 += a1 * b1;  c12 += a1 * b2;  c13 += a1 * b3;
        c20 += a2 * b0;  c21 += a2 * b1;  c22 += a2 * b2;  c23 += a2 * b3;
        c30 += a3 * b0;  c31 += a3 * b1;  c32 += a3 * b2;  c33 += a3 * b3;
      }

      const oOff0 = absI * N + absJ;
      const oOff1 = oOff0 + N;
      const oOff2 = oOff1 + N;
      const oOff3 = oOff2 + N;

      // 累加到 out（分块模式下多个块可能写同一位置）
      out[oOff0]     += c00; out[oOff0 + 1] += c01; out[oOff0 + 2] += c02; out[oOff0 + 3] += c03;
      out[oOff1]     += c10; out[oOff1 + 1] += c11; out[oOff1 + 2] += c12; out[oOff1 + 3] += c13;
      out[oOff2]     += c20; out[oOff2 + 1] += c21; out[oOff2 + 2] += c22; out[oOff2 + 3] += c23;
      out[oOff3]     += c30; out[oOff3 + 1] += c31; out[oOff3 + 2] += c32; out[oOff3 + 3] += c33;
    }
  }

  // 尾行（所有列）
  for (let i = M4; i < M; i++) {
    const absI = iOff + i;
    for (let j = 0; j < NJ; j++) {
      let sum = 0;
      for (let k = 0; k < K; k++) {
        sum += a[absI * K + k] * b[k * N + (jOff + j)];
      }
      out[absI * N + (jOff + j)] += sum;
    }
  }

  // 尾列（仅对齐行）
  for (let i = 0; i < M4; i++) {
    const absI = iOff + i;
    for (let j = N4; j < NJ; j++) {
      let sum = 0;
      for (let k = 0; k < K; k++) {
        sum += a[absI * K + k] * b[k * N + (jOff + j)];
      }
      out[absI * N + (jOff + j)] += sum;
    }
  }
}

/**
 * 矩阵乘法：[M, K] × [K, N] → [M, N]
 *
 * 自动选择最优内核：
 * - 小矩阵 (M≤32, K≤256, N≤256): 4×4 微内核，无分块开销
 * - 中矩阵: 16×16 分块 + 4×4 微内核
 * - 大矩阵: 同上（可扩展到多线程）
 */
export function matmul(a: Tensor, b: Tensor): Tensor {
  const [M, K] = a.shape;
  const [K2, N] = b.shape;
  if (K !== K2) throw new Error(`matmul shape mismatch: [${M},${K}] × [${K2},${N}]`);

  const out = zeros([M, N]);

  // 小矩阵：直接用微内核，无分块开销
  if (M <= 32 && K <= 256 && N <= 256) {
    _matmulMicro4x4(a.data, b.data, out.data, M, K, N);
  } else {
    // 中/大矩阵：分块 + 微内核
    _matmulTiled4x4(a.data, b.data, out.data, M, K, N);
  }

  if (!_inferenceMode) {
    out._ctx = { op: 'matmul', saved: [], parents: [a, b] };
  }
  return out;
}

/**
 * 融合 matmul + bias: [M,K]×[K,N] + [N] → [M,N]
 * 使用 4×4 微内核 + 融合 bias 加法
 */
export function matmulAddBias(a: Tensor, b: Tensor, bias: Tensor): Tensor {
  const [M, K] = a.shape;
  const N = b.shape[1];
  const out = zeros([M, N]);

  // 先做 matmul（微内核）
  if (M <= 32 && K <= 256 && N <= 256) {
    _matmulMicro4x4(a.data, b.data, out.data, M, K, N);
  } else {
    _matmulTiled4x4(a.data, b.data, out.data, M, K, N);
  }

  // 融合 bias 加法
  for (let i = 0; i < M; i++) {
    const oRow = i * N;
    for (let j = 0; j < N; j++) {
      out.data[oRow + j] += bias.data[j];
    }
  }

  if (!_inferenceMode) {
    out._ctx = { op: 'add', saved: [], parents: [matmul(a, b), bias] };
  }
  return out;
}

/**
 * 融合 matmul + bias + GELU: [M,K]×[K,N] + [N] → GELU → [M,N]
 *
 * 将三次遍历合并为一次，消除 1 个中间 Tensor。
 * FFN 推理热路径专用。
 */
export function matmulAddBiasGelu(a: Tensor, b: Tensor, bias: Tensor): Tensor {
  const [M, K] = a.shape;
  const N = b.shape[1];
  const out = zeros([M, N]);

  // matmul（微内核）
  if (M <= 32 && K <= 256 && N <= 256) {
    _matmulMicro4x4(a.data, b.data, out.data, M, K, N);
  } else {
    _matmulTiled4x4(a.data, b.data, out.data, M, K, N);
  }

  // 融合 bias + GELU（原地，单次遍历）
  const SQRT_2_OVER_PI = 0.7978845608;
  const COEFF = 0.044715;
  for (let i = 0; i < M; i++) {
    const oRow = i * N;
    for (let j = 0; j < N; j++) {
      const x = out.data[oRow + j] + bias.data[j];
      const x3 = x * x * x;
      const inner = SQRT_2_OVER_PI * (x + COEFF * x3);
      out.data[oRow + j] = 0.5 * x * (1 + Math.tanh(inner));
    }
  }

  if (!_inferenceMode) {
    out._ctx = { op: 'gelu', saved: [], parents: [matmulAddBias(a, b, bias)] };
  }
  return out;
}

/**
 * 三合一 matmul+bias: 共享 A 矩阵，一次遍历计算三个投影
 *
 * [M,K]×[K,N1]+[N1], [M,K]×[K,N2]+[N2], [M,K]×[K,N3]+[N3]
 *
 * Attention 的 Q/K/V 投影专用。读取 A 矩阵 1 次而非 3 次，
 * 减少 2 次 A 矩阵的内存读取 + 2 次中间 Tensor 分配。
 */
export function matmulAddBias3(
  a: Tensor,
  b1: Tensor, bias1: Tensor,
  b2: Tensor, bias2: Tensor,
  b3: Tensor, bias3: Tensor,
): [Tensor, Tensor, Tensor] {
  const [M, K] = a.shape;
  const N1 = b1.shape[1];
  const N2 = b2.shape[1];
  const N3 = b3.shape[1];

  const out1 = zeros([M, N1]);
  const out2 = zeros([M, N2]);
  const out3 = zeros([M, N3]);

  // 三个 matmul 共享 A 的遍历
  // 使用标量循环（矩阵通常较小 M≤32, K≤256）
  for (let i = 0; i < M; i++) {
    const aRow = i * K;
    const oRow1 = i * N1;
    const oRow2 = i * N2;
    const oRow3 = i * N3;

    // 初始化为 bias
    for (let j = 0; j < N1; j++) out1.data[oRow1 + j] = bias1.data[j];
    for (let j = 0; j < N2; j++) out2.data[oRow2 + j] = bias2.data[j];
    for (let j = 0; j < N3; j++) out3.data[oRow3 + j] = bias3.data[j];

    // 共享 k 循环
    for (let k = 0; k < K; k++) {
      const aik = a.data[aRow + k];
      if (aik === 0) continue;

      const bRow1 = k * N1;
      const bRow2 = k * N2;
      const bRow3 = k * N3;

      for (let j = 0; j < N1; j++) {
        out1.data[oRow1 + j] += aik * b1.data[bRow1 + j];
      }
      for (let j = 0; j < N2; j++) {
        out2.data[oRow2 + j] += aik * b2.data[bRow2 + j];
      }
      for (let j = 0; j < N3; j++) {
        out3.data[oRow3 + j] += aik * b3.data[bRow3 + j];
      }
    }
  }

  if (!_inferenceMode) {
    out1._ctx = { op: 'add', saved: [], parents: [matmul(a, b1), bias1] };
    out2._ctx = { op: 'add', saved: [], parents: [matmul(a, b2), bias2] };
    out3._ctx = { op: 'add', saved: [], parents: [matmul(a, b3), bias3] };
  }
  return [out1, out2, out3];
}

/**
 * 融合 LayerNorm + 残差连接: LayerNorm(x) + residual
 *
 * 合并 layerNorm 和 add 为单次遍历，消除 1 个中间 Tensor。
 * Attention/FFN 的 Pre-LN + Residual 路径专用。
 */
export function fusedLayerNormResidual(
  x: Tensor, residual: Tensor,
  weight: Tensor, bias: Tensor, eps = 1e-5,
): Tensor {
  const lastDim = x.shape[x.shape.length - 1];
  const outerSize = x.size / lastDim;
  const out = zeros([...x.shape]);

  for (let i = 0; i < outerSize; i++) {
    const offset = i * lastDim;
    let mean = 0;
    for (let j = 0; j < lastDim; j++) mean += x.data[offset + j];
    mean /= lastDim;
    let variance = 0;
    for (let j = 0; j < lastDim; j++) {
      const diff = x.data[offset + j] - mean;
      variance += diff * diff;
    }
    variance /= lastDim;
    const invStd = 1 / Math.sqrt(variance + eps);
    for (let j = 0; j < lastDim; j++) {
      const norm = (x.data[offset + j] - mean) * invStd;
      out.data[offset + j] = norm * weight.data[j] + bias.data[j] + residual.data[offset + j];
    }
  }

  if (!_inferenceMode) {
    out._ctx = { op: 'layerNorm', saved: [eps], parents: [x, weight, bias] };
  }
  return out;
}

/**
 * 批量矩阵乘法：[B, M, K] × [K, N] → [B, M, N]
 *
 * 支持 batch 维度，weight 矩阵共享
 * 每个 batch 独立使用微内核
 */
export function batchMatmul(a: Tensor, b: Tensor): Tensor {
  if (a.shape.length === 2) return matmul(a, b);

  const [B, M, K] = a.shape;
  const [K2, N] = b.shape;
  if (K !== K2) throw new Error(`batchMatmul shape mismatch: [${B},${M},${K}] × [${K2},${N}]`);

  const out = zeros([B, M, N]);

  for (let batch = 0; batch < B; batch++) {
    const aOff = batch * M * K;
    const oOff = batch * M * N;

    // 提取 batch 的子矩阵数据
    const aSub = a.data.subarray(aOff, aOff + M * K);
    const outSub = out.data.subarray(oOff, oOff + M * N);

    if (M <= 32 && K <= 256 && N <= 256) {
      _matmulMicro4x4(aSub, b.data, outSub, M, K, N);
    } else {
      _matmulTiled4x4(aSub, b.data, outSub, M, K, N);
    }
  }

  if (!_inferenceMode) {
    out._ctx = { op: 'matmul', saved: [], parents: [a, b] };
  }
  return out;
}

/** 逐元素加法（支持广播 bias: [N] → [M, N]） */
export function add(a: Tensor, b: Tensor): Tensor {
  const out = zeros([...a.shape]);

  if (a.shape.length === 1 && b.shape.length === 1 && a.shape[0] === b.shape[0]) {
    // 向量加法
    for (let i = 0; i < a.size; i++) {
      out.data[i] = a.data[i] + b.data[i];
    }
  } else if (a.shape.length === 2 && b.shape.length === 1 && b.shape[0] === a.shape[1]) {
    // 广播 bias
    const [M, N] = a.shape;
    for (let i = 0; i < M; i++) {
      for (let j = 0; j < N; j++) {
        out.data[i * N + j] = a.data[i * N + j] + b.data[j];
      }
    }
  } else if (a.shape.length === 3 && b.shape.length === 1 && b.shape[0] === a.shape[2]) {
    // 广播 bias for [B, S, D]
    const [B, S, D] = a.shape;
    for (let i = 0; i < B * S; i++) {
      for (let j = 0; j < D; j++) {
        out.data[i * D + j] = a.data[i * D + j] + b.data[j];
      }
    }
  } else if (a.shape.length === 2 && b.shape.length === 2 && a.shape[0] === b.shape[0] && a.shape[1] === b.shape[1]) {
    // 同形加法
    for (let i = 0; i < a.size; i++) {
      out.data[i] = a.data[i] + b.data[i];
    }
  } else if (a.shape.length === 3 && b.shape.length === 3 && a.shape[0] === b.shape[0] &&
             a.shape[1] === b.shape[1] && a.shape[2] === b.shape[2]) {
    for (let i = 0; i < a.size; i++) {
      out.data[i] = a.data[i] + b.data[i];
    }
  } else {
    throw new Error(`add: incompatible shapes [${a.shape}] + [${b.shape}]`);
  }

  if (!_inferenceMode) {
    out._ctx = { op: 'add', saved: [], parents: [a, b] };
  }
  return out;
}

/** 逐元素乘法 */
export function mul(a: Tensor, b: Tensor): Tensor {
  const out = zeros([...a.shape]);
  for (let i = 0; i < a.size; i++) {
    out.data[i] = a.data[i] * b.data[i];
  }
  if (!_inferenceMode) {
    out._ctx = { op: 'mul', saved: [], parents: [a, b] };
  }
  return out;
}

/** 标量乘法 */
export function scale(a: Tensor, s: number): Tensor {
  const out = zeros([...a.shape]);
  for (let i = 0; i < a.size; i++) {
    out.data[i] = a.data[i] * s;
  }
  if (!_inferenceMode) {
    out._ctx = { op: 'scale', saved: [s], parents: [a] };
  }
  return out;
}

/** ReLU */
export function relu(a: Tensor): Tensor {
  const out = zeros([...a.shape]);
  for (let i = 0; i < a.size; i++) {
    out.data[i] = a.data[i] > 0 ? a.data[i] : 0;
  }
  if (!_inferenceMode) {
    out._ctx = { op: 'relu', saved: [], parents: [a] };
  }
  return out;
}

/** GELU 近似：0.5 * x * (1 + tanh(√(2/π) * (x + 0.044715 * x³))) */
export function gelu(a: Tensor): Tensor {
  const out = zeros([...a.shape]);
  const sqrt2OverPi = 0.7978845608;
  const coeff = 0.044715;
  for (let i = 0; i < a.size; i++) {
    const x = a.data[i];
    const inner = sqrt2OverPi * (x + coeff * x * x * x);
    // tanh 近似
    const tanhInner = Math.tanh(inner);
    out.data[i] = 0.5 * x * (1 + tanhInner);
  }
  if (!_inferenceMode) {
    out._ctx = { op: 'gelu', saved: [], parents: [a] };
  }
  return out;
}

/** Softmax（沿最后一维） */
export function softmax(a: Tensor): Tensor {
  if (a.shape.length === 2) {
    const [rows, cols] = a.shape;
    const out = zeros([rows, cols]);
    for (let i = 0; i < rows; i++) {
      let max = -Infinity;
      for (let j = 0; j < cols; j++) {
        const v = a.data[i * cols + j];
        if (v > max) max = v;
      }
      let sum = 0;
      for (let j = 0; j < cols; j++) {
        const v = Math.exp(a.data[i * cols + j] - max);
        out.data[i * cols + j] = v;
        sum += v;
      }
      for (let j = 0; j < cols; j++) {
        out.data[i * cols + j] /= sum;
      }
    }
    if (!_inferenceMode) {
      out._ctx = { op: 'softmax', saved: [], parents: [a] };
    }
    return out;
  } else if (a.shape.length === 3) {
    // [B, S, S] — 对每个 batch 的每行做 softmax
    const [B, S, C] = a.shape;
    const out = zeros([B, S, C]);
    for (let b = 0; b < B; b++) {
      for (let i = 0; i < S; i++) {
        let max = -Infinity;
        for (let j = 0; j < C; j++) {
          const v = a.data[(b * S + i) * C + j];
          if (v > max) max = v;
        }
        let sum = 0;
        for (let j = 0; j < C; j++) {
          const v = Math.exp(a.data[(b * S + i) * C + j] - max);
          out.data[(b * S + i) * C + j] = v;
          sum += v;
        }
        for (let j = 0; j < C; j++) {
          out.data[(b * S + i) * C + j] /= sum;
        }
      }
    }
    if (!_inferenceMode) {
      out._ctx = { op: 'softmax', saved: [], parents: [a] };
    }
    return out;
  } else if (a.shape.length === 4) {
    // [B, H, S, S] — 对每个 batch×head 的每行做 softmax
    const [B, H, S, C] = a.shape;
    const out = zeros([B, H, S, C]);
    for (let b = 0; b < B; b++) {
      for (let h = 0; h < H; h++) {
        for (let i = 0; i < S; i++) {
          let max = -Infinity;
          for (let j = 0; j < C; j++) {
            const v = a.data[((b * H + h) * S + i) * C + j];
            if (v > max) max = v;
          }
          let sum = 0;
          for (let j = 0; j < C; j++) {
            const v = Math.exp(a.data[((b * H + h) * S + i) * C + j] - max);
            out.data[((b * H + h) * S + i) * C + j] = v;
            sum += v;
          }
          for (let j = 0; j < C; j++) {
            out.data[((b * H + h) * S + i) * C + j] /= sum;
          }
        }
      }
    }
    if (!_inferenceMode) {
      out._ctx = { op: 'softmax', saved: [], parents: [a] };
    }
    return out;
  }
  throw new Error(`softmax: unsupported rank ${a.shape.length}`);
}

/** LayerNorm：对最后一维归一化 */
export function layerNorm(a: Tensor, weight: Tensor, bias: Tensor, eps = 1e-5): Tensor {
  const lastDim = a.shape[a.shape.length - 1];
  const outerSize = a.size / lastDim;
  const out = zeros([...a.shape]);

  for (let i = 0; i < outerSize; i++) {
    const offset = i * lastDim;
    // 计算均值
    let mean = 0;
    for (let j = 0; j < lastDim; j++) mean += a.data[offset + j];
    mean /= lastDim;
    // 计算方差
    let variance = 0;
    for (let j = 0; j < lastDim; j++) {
      const diff = a.data[offset + j] - mean;
      variance += diff * diff;
    }
    variance /= lastDim;
    const invStd = 1 / Math.sqrt(variance + eps);
    // 归一化 + 缩放偏移
    for (let j = 0; j < lastDim; j++) {
      const norm = (a.data[offset + j] - mean) * invStd;
      out.data[offset + j] = norm * weight.data[j] + bias.data[j];
    }
  }

  if (!_inferenceMode) {
    out._ctx = { op: 'layerNorm', saved: [eps], parents: [a, weight, bias] };
  }
  return out;
}

/** 缩放点积注意力的分数计算：Q × K^T / √d_k */
export function scaledDotProductScores(q: Tensor, k: Tensor): Tensor {
  // q: [B, H, S, D], k: [B, H, S, D]
  const [B, H, S, D] = q.shape;
  const scale = 1 / Math.sqrt(D);
  const out = zeros([B, H, S, S]);

  for (let b = 0; b < B; b++) {
    for (let h = 0; h < H; h++) {
      for (let i = 0; i < S; i++) {
        for (let j = 0; j < S; j++) {
          let dot = 0;
          for (let d = 0; d < D; d++) {
            dot += q.data[((b * H + h) * S + i) * D + d] * k.data[((b * H + h) * S + j) * D + d];
          }
          out.data[((b * H + h) * S + i) * S + j] = dot * scale;
        }
      }
    }
  }

  if (!_inferenceMode) {
    out._ctx = { op: 'scores', saved: [scale], parents: [q, k] };
  }
  return out;
}

/** 注意力加权求和：weights × V */
export function attentionWeightedSum(weights: Tensor, v: Tensor): Tensor {
  // weights: [B, H, S, S], v: [B, H, S, D]
  const [B, H, S, S2] = weights.shape;
  const D = v.shape[3];
  const out = zeros([B, H, S, D]);

  for (let b = 0; b < B; b++) {
    for (let h = 0; h < H; h++) {
      for (let i = 0; i < S; i++) {
        for (let d = 0; d < D; d++) {
          let sum = 0;
          for (let j = 0; j < S2; j++) {
            sum += weights.data[((b * H + h) * S + i) * S2 + j] *
                   v.data[((b * H + h) * S + j) * D + d];
          }
          out.data[((b * H + h) * S + i) * D + d] = sum;
        }
      }
    }
  }

  if (!_inferenceMode) {
    out._ctx = { op: 'weightedSum', saved: [], parents: [weights, v] };
  }
  return out;
}

// ==================== 反向传播 ====================

/** 反向传播：从 loss Tensor 开始，计算所有梯度 */
export function backward(loss: Tensor): void {
  // 初始化 loss 的梯度为 1
  loss.grad = new Float32Array(loss.size);
  loss.grad.fill(1);

  // 拓扑排序（BFS）
  const visited = new Set<Tensor>();
  const order: Tensor[] = [];
  const queue: Tensor[] = [loss];

  while (queue.length > 0) {
    const t = queue.shift()!;
    if (visited.has(t)) continue;
    visited.add(t);
    order.push(t);
    if (t._ctx) {
      for (const p of t._ctx.parents) {
        if (!visited.has(p)) queue.push(p);
      }
    }
  }

  // 反向执行
  for (const t of order) {
    if (!t._ctx || !t.grad) continue;
    _backwardOp(t);
  }
}

function _backwardOp(t: Tensor): void {
  const ctx = t._ctx!;
  const g = t.grad!;

  switch (ctx.op) {
    case 'matmul': {
      const [a, b] = ctx.parents;
      backwardMatmul(a, b, g);
      break;
    }
    case 'add': {
      const [a, b] = ctx.parents;
      backwardAdd(a, b, g);
      break;
    }
    case 'mul': {
      const [a, b] = ctx.parents;
      backwardMul(a, b, g);
      break;
    }
    case 'scale': {
      const s = ctx.saved[0] as number;
      const a = ctx.parents[0];
      backwardScale(a, g, s);
      break;
    }
    case 'relu': {
      const a = ctx.parents[0];
      backwardRelu(a, g);
      break;
    }
    case 'gelu': {
      const a = ctx.parents[0];
      backwardGelu(a, g);
      break;
    }
    case 'softmax': {
      const a = ctx.parents[0];
      backwardSoftmax(a, g);
      break;
    }
    case 'layerNorm': {
      const eps = ctx.saved[0] as number;
      const [a, weight, bias] = ctx.parents;
      backwardLayerNorm(a, weight, bias, g, eps);
      break;
    }
    case 'scores': {
      const s = ctx.saved[0] as number;
      const [q, k] = ctx.parents;
      backwardScores(q, k, g, s);
      break;
    }
    case 'weightedSum': {
      const [w, v] = ctx.parents;
      backwardWeightedSum(w, v, g);
      break;
    }
    case 'view':
    case 'transpose':
    case 'contiguous': {
      // 这些操作只是改变视图，梯度直接传给父节点
      const a = ctx.parents[0];
      _accumulateGrad(a, g);
      break;
    }
    case 'poolLast': {
      // 池化梯度：支持 batch 和非 batch
      const a = ctx.parents[0];
      if (a.shape.length === 3) {
        // batch 模式：[B, S, dModel] → [B, dModel]
        const [B, S, dModel] = a.shape;
        if (!a.grad) a.grad = new Float32Array(a.size);
        for (let b = 0; b < B; b++) {
          const lastPos = S - 1;
          const srcOff = b * dModel;
          const dstOff = (b * S + lastPos) * dModel;
          for (let i = 0; i < dModel; i++) {
            a.grad[dstOff + i] += g[srcOff + i];
          }
        }
      } else {
        // 非 batch：[S, dModel] → [1, dModel]
        const seqLen = ctx.saved[0] as number;
        const dModel = a.shape[1];
        if (!a.grad) a.grad = new Float32Array(a.size);
        const off = (seqLen - 1) * dModel;
        for (let i = 0; i < dModel; i++) {
          a.grad[off + i] += g[i];
        }
      }
      break;
    }
    case 'cat': {
      const dim = ctx.saved[0] as number;
      const parents = ctx.parents;
      backwardCat(parents, g, dim);
      break;
    }
  }
}

function _accumulateGrad(t: Tensor, g: Float32Array): void {
  if (!t.grad) {
    t.grad = new Float32Array(g);
  } else {
    for (let i = 0; i < g.length; i++) t.grad[i] += g[i];
  }
}

function backwardMatmul(a: Tensor, b: Tensor, g: Float32Array): void {
  const [M, K] = a.shape;
  const N = b.shape[1];
  const ga = new Float32Array(a.size);
  const gb = new Float32Array(b.size);

  for (let i = 0; i < M; i++) {
    for (let k = 0; k < K; k++) {
      let sum = 0;
      for (let j = 0; j < N; j++) {
        sum += g[i * N + j] * b.data[k * N + j];
        gb[k * N + j] += g[i * N + j] * a.data[i * K + k];
      }
      ga[i * K + k] = sum;
    }
  }

  _accumulateGrad(a, ga);
  _accumulateGrad(b, gb);
}

function backwardAdd(a: Tensor, b: Tensor, g: Float32Array): void {
  _accumulateGrad(a, g);
  if (a.shape.length === 2 && b.shape.length === 1) {
    const gb = new Float32Array(b.size);
    const [M, N] = a.shape;
    for (let i = 0; i < M; i++) {
      for (let j = 0; j < N; j++) {
        gb[j] += g[i * N + j];
      }
    }
    _accumulateGrad(b, gb);
  } else if (a.shape.length === 3 && b.shape.length === 1) {
    const gb = new Float32Array(b.size);
    const D = a.shape[2];
    for (let i = 0; i < a.size / D; i++) {
      for (let j = 0; j < D; j++) {
        gb[j] += g[i * D + j];
      }
    }
    _accumulateGrad(b, gb);
  } else {
    _accumulateGrad(b, g);
  }
}

function backwardMul(a: Tensor, b: Tensor, g: Float32Array): void {
  const ga = new Float32Array(a.size);
  const gb = new Float32Array(b.size);
  for (let i = 0; i < a.size; i++) {
    ga[i] = g[i] * b.data[i];
    gb[i] = g[i] * a.data[i];
  }
  _accumulateGrad(a, ga);
  _accumulateGrad(b, gb);
}

function backwardScale(a: Tensor, g: Float32Array, s: number): void {
  const ga = new Float32Array(a.size);
  for (let i = 0; i < a.size; i++) ga[i] = g[i] * s;
  _accumulateGrad(a, ga);
}

function backwardRelu(a: Tensor, g: Float32Array): void {
  const ga = new Float32Array(a.size);
  for (let i = 0; i < a.size; i++) {
    ga[i] = a.data[i] > 0 ? g[i] : 0;
  }
  _accumulateGrad(a, ga);
}

function backwardGelu(a: Tensor, g: Float32Array): void {
  const ga = new Float32Array(a.size);
  const sqrt2OverPi = 0.7978845608;
  const coeff = 0.044715;
  for (let i = 0; i < a.size; i++) {
    const x = a.data[i];
    const x3 = x * x * x;
    const inner = sqrt2OverPi * (x + coeff * x3);
    const tanhInner = Math.tanh(inner);
    const sech2 = 1 - tanhInner * tanhInner;
    const derivative = 0.5 * (1 + tanhInner) + 0.5 * x * sech2 * sqrt2OverPi * (1 + 3 * coeff * x * x);
    ga[i] = g[i] * derivative;
  }
  _accumulateGrad(a, ga);
}

function backwardSoftmax(a: Tensor, g: Float32Array): void {
  const out = softmax(a); // 重算前向值
  const ga = new Float32Array(a.size);

  if (a.shape.length === 2) {
    const [rows, cols] = a.shape;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        let sum = 0;
        for (let k = 0; k < cols; k++) {
          const s = out.data[i * cols + k];
          const indicator = j === k ? 1 : 0;
          sum += g[i * cols + k] * s * (indicator - out.data[i * cols + j]);
        }
        ga[i * cols + j] = sum;
      }
    }
  } else if (a.shape.length === 3) {
    const [B, S, C] = a.shape;
    for (let b = 0; b < B; b++) {
      for (let i = 0; i < S; i++) {
        for (let j = 0; j < C; j++) {
          let sum = 0;
          for (let k = 0; k < C; k++) {
            const s = out.data[(b * S + i) * C + k];
            const indicator = j === k ? 1 : 0;
            sum += g[(b * S + i) * C + k] * s * (indicator - out.data[(b * S + i) * C + j]);
          }
          ga[(b * S + i) * C + j] = sum;
        }
      }
    }
  }

  _accumulateGrad(a, ga);
}

function backwardLayerNorm(a: Tensor, weight: Tensor, bias: Tensor, g: Float32Array, eps: number): void {
  const lastDim = a.shape[a.shape.length - 1];
  const outerSize = a.size / lastDim;
  const ga = new Float32Array(a.size);
  const gw = new Float32Array(weight.size);
  const gb = new Float32Array(bias.size);

  for (let i = 0; i < outerSize; i++) {
    const off = i * lastDim;
    let mean = 0;
    for (let j = 0; j < lastDim; j++) mean += a.data[off + j];
    mean /= lastDim;
    let variance = 0;
    for (let j = 0; j < lastDim; j++) {
      const diff = a.data[off + j] - mean;
      variance += diff * diff;
    }
    variance /= lastDim;
    const invStd = 1 / Math.sqrt(variance + eps);

    const xNorm = new Float32Array(lastDim);
    for (let j = 0; j < lastDim; j++) {
      xNorm[j] = (a.data[off + j] - mean) * invStd;
    }

    for (let j = 0; j < lastDim; j++) {
      gw[j] += g[off + j] * xNorm[j];
      gb[j] += g[off + j];
    }

    let dotGxNorm = 0;
    for (let j = 0; j < lastDim; j++) {
      dotGxNorm += g[off + j] * weight.data[j] * xNorm[j];
    }
    let dotGw = 0;
    for (let j = 0; j < lastDim; j++) {
      dotGw += g[off + j] * weight.data[j];
    }
    for (let j = 0; j < lastDim; j++) {
      ga[off + j] = invStd * weight.data[j] * (
        g[off + j] - dotGw / lastDim - xNorm[j] * dotGxNorm / lastDim
      );
    }
  }

  _accumulateGrad(a, ga);
  _accumulateGrad(weight, gw);
  _accumulateGrad(bias, gb);
}

function backwardScores(q: Tensor, k: Tensor, g: Float32Array, scaleVal: number): void {
  const [B, H, S, D] = q.shape;
  const gq = new Float32Array(q.size);
  const gk = new Float32Array(k.size);

  for (let b = 0; b < B; b++) {
    for (let h = 0; h < H; h++) {
      for (let i = 0; i < S; i++) {
        for (let j = 0; j < S; j++) {
          const gij = g[((b * H + h) * S + i) * S + j] * scaleVal;
          for (let d = 0; d < D; d++) {
            gq[((b * H + h) * S + i) * D + d] += gij * k.data[((b * H + h) * S + j) * D + d];
            gk[((b * H + h) * S + j) * D + d] += gij * q.data[((b * H + h) * S + i) * D + d];
          }
        }
      }
    }
  }

  _accumulateGrad(q, gq);
  _accumulateGrad(k, gk);
}

function backwardWeightedSum(w: Tensor, v: Tensor, g: Float32Array): void {
  const [B, H, S, S2] = w.shape;
  const D = v.shape[3];
  const gw = new Float32Array(w.size);
  const gv = new Float32Array(v.size);

  for (let b = 0; b < B; b++) {
    for (let h = 0; h < H; h++) {
      for (let i = 0; i < S; i++) {
        for (let d = 0; d < D; d++) {
          const gid = g[((b * H + h) * S + i) * D + d];
          for (let j = 0; j < S2; j++) {
            gw[((b * H + h) * S + i) * S2 + j] += gid * v.data[((b * H + h) * S + j) * D + d];
            gv[((b * H + h) * S + j) * D + d] += gid * w.data[((b * H + h) * S + i) * S2 + j];
          }
        }
      }
    }
  }

  _accumulateGrad(w, gw);
  _accumulateGrad(v, gv);
}

function backwardCat(parents: Tensor[], g: Float32Array, dim: number): void {
  let offset = 0;
  for (const p of parents) {
    const pSize = p.size;
    const pg = g.slice(offset, offset + pSize);
    _accumulateGrad(p, pg);
    offset += pSize;
  }
}

// ==================== 辅助运算（无需反向） ====================

/** Reshape */
export function reshape(a: Tensor, shape: number[]): Tensor {
  const out = new Tensor(a.data, shape);
  if (!_inferenceMode) {
    out._ctx = { op: 'view', saved: [], parents: [a] };
  }
  return out;
}

/** 转置最后两维 */
export function transposeLast2(a: Tensor): Tensor {
  if (a.shape.length < 2) throw new Error('transposeLast2 requires rank >= 2');
  const shape = [...a.shape];
  const last = shape.length - 1;
  [shape[last - 1], shape[last]] = [shape[last], shape[last - 1]];

  const out = zeros(shape);
  const rows = shape[last - 1];
  const cols = shape[last];
  const outerSize = a.size / (rows * cols);

  for (let b = 0; b < outerSize; b++) {
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        out.data[(b * rows + i) * cols + j] = a.data[(b * cols + j) * rows + i];
      }
    }
  }

  if (!_inferenceMode) {
    out._ctx = { op: 'transpose', saved: [], parents: [a] };
  }
  return out;
}

/** 沿指定维度拼接 */
export function cat(tensors: Tensor[], dim: number): Tensor {
  if (tensors.length === 0) throw new Error('cat: empty tensor list');
  const shape = [...tensors[0].shape];
  let totalDim = 0;
  for (const t of tensors) totalDim += t.shape[dim];
  shape[dim] = totalDim;

  const out = zeros(shape);
  const stride = shape.slice(dim + 1).reduce((a, b) => a * b, 1);
  let offset = 0;

  for (const t of tensors) {
    const tDimSize = t.shape[dim] * stride;
    out.data.set(t.data.subarray(0, tDimSize), offset);
    offset += tDimSize;
  }

  if (!_inferenceMode) {
    out._ctx = { op: 'cat', saved: [dim], parents: [...tensors] };
  }
  return out;
}

/** 创建 causal mask：[S, S]，上三角为 -10000 */
export function causalMask(S: number): Tensor {
  const data = new Float32Array(S * S);
  for (let i = 0; i < S; i++) {
    for (let j = 0; j < S; j++) {
      data[i * S + j] = j > i ? -10000 : 0;
    }
  }
  return new Tensor(data, [S, S]);
}

/** Sigmoid 激活 */
export function sigmoid(a: Tensor): Tensor {
  const out = zeros([...a.shape]);
  for (let i = 0; i < a.size; i++) {
    out.data[i] = 1 / (1 + Math.exp(-a.data[i]));
  }
  return out;
}

/** 带 mask 的 softmax（2D） */
export function maskedSoftmax(a: Tensor, mask: Tensor): Tensor {
  const [rows, cols] = a.shape;
  const out = zeros([rows, cols]);
  for (let i = 0; i < rows; i++) {
    let max = -Infinity;
    for (let j = 0; j < cols; j++) {
      const v = a.data[i * cols + j] + mask.data[i * cols + j];
      if (v > max) max = v;
    }
    let sum = 0;
    for (let j = 0; j < cols; j++) {
      const v = Math.exp(a.data[i * cols + j] + mask.data[i * cols + j] - max);
      out.data[i * cols + j] = v;
      sum += v;
    }
    for (let j = 0; j < cols; j++) {
      out.data[i * cols + j] /= sum;
    }
  }
  if (!_inferenceMode) {
    out._ctx = { op: 'softmax', saved: [], parents: [a] };
  }
  return out;
}
