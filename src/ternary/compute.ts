/**
 * 三进制矩阵运算核心
 *
 * 乘法变加法：权重为 {-1, 0, 1} 时，矩阵×向量 变为 加法/减法/跳过。
 * 纯 JS 整数运算，无需 GPU。
 */

// ────────────────────────────────────────────
// 核心运算
// ────────────────────────────────────────────

/**
 * 三进制矩阵 × 向量 (核心操作)
 *
 * output[i] = Σ_j A[i][j] * x[j]
 * 其中 A[i][j] ∈ {-1, 0, 1}
 *
 * 优化：将加法和减法分开累加，避免逐元素乘法
 *
 * @param weights 三进制权重矩阵 (row-major)，值 {-1, 0, 1}
 * @param input 输入向量
 * @param output 输出向量（预分配）
 * @param rows 矩阵行数
 * @param cols 矩阵列数
 */
export function matVecMul(
  weights: Int8Array,
  input: Float32Array,
  output: Float32Array,
  rows: number,
  cols: number,
): void {
  for (let i = 0; i < rows; i++) {
    const rowOffset = i * cols;
    let sum = 0;

    for (let j = 0; j < cols; j++) {
      const w = weights[rowOffset + j];
      if (w === 1) {
        sum += input[j];
      } else if (w === -1) {
        sum -= input[j];
      }
      // w === 0: 跳过
    }

    output[i] = sum;
  }
}

/**
 * LoRA 分解矩阵乘: output = A @ (B @ input)
 *
 * A: inFeatures × rank
 * B: rank × outFeatures
 *
 * 两步计算，中间向量复用
 */
export function loraForward(
  A: Int8Array,
  B: Int8Array,
  input: Float32Array,
  inFeatures: number,
  rank: number,
  outFeatures: number,
): Float32Array {
  // Step 1: intermediate = B @ input (rank × outFeatures @ outFeatures → rank)
  // 但通常 LoRA 是 A(in×rank) @ B(rank×out) @ x(out)
  // 所以先 B@x → rank维中间向量，再 A@中间 → in维输出

  // B: rank × outFeatures, input: outFeatures维
  const intermediate = new Float32Array(rank);
  matVecMul(B, input, intermediate, rank, outFeatures);

  // A: inFeatures × rank, intermediate: rank维
  const result = new Float32Array(inFeatures);
  matVecMul(A, intermediate, result, inFeatures, rank);

  return result;
}

/**
 * Softmax
 */
export function softmax(logits: Float32Array): Float32Array {
  let maxVal = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    if (logits[i] > maxVal) maxVal = logits[i];
  }

  const result = new Float32Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    result[i] = Math.exp(logits[i] - maxVal);
    sum += result[i];
  }

  for (let i = 0; i < result.length; i++) {
    result[i] /= sum;
  }

  return result;
}

/**
 * LayerNorm: (x - mean) / sqrt(var + eps) * gamma + beta
 */
export function layerNorm(
  x: Float32Array,
  gamma: Float32Array,
  beta: Float32Array,
  eps = 1e-5,
): Float32Array {
  const n = x.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;

  let variance = 0;
  for (let i = 0; i < n; i++) {
    const diff = x[i] - mean;
    variance += diff * diff;
  }
  variance /= n;

  const invStd = 1 / Math.sqrt(variance + eps);
  const result = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = (x[i] - mean) * invStd * gamma[i] + beta[i];
  }

  return result;
}

/**
 * 激活函数: GELU 近似
 */
export function gelu(x: Float32Array): Float32Array {
  const result = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    // tanh 近似
    result[i] = 0.5 * v * (1 + Math.tanh(0.7978845608 * (v + 0.044715 * v * v * v)));
  }
  return result;
}

/**
 * argmax: 返回最大值的索引
 */
export function argmax(logits: Float32Array): number {
  let maxIdx = 0;
  let maxVal = logits[0];
  for (let i = 1; i < logits.length; i++) {
    if (logits[i] > maxVal) {
      maxVal = logits[i];
      maxIdx = i;
    }
  }
  return maxIdx;
}

/**
 * Top-p (nucleus) 采样
 */
export function topPSample(logits: Float32Array, p = 0.9, temperature = 1.0): number {
  // 温度缩放
  const scaled = new Float32Array(logits.length);
  for (let i = 0; i < logits.length; i++) {
    scaled[i] = logits[i] / temperature;
  }

  const probs = softmax(scaled);

  // 按概率降序排列索引
  const indices = Array.from({ length: probs.length }, (_, i) => i);
  indices.sort((a, b) => probs[b] - probs[a]);

  // 累积概率达到 p 的截断
  let cumProb = 0;
  let cutoff = indices.length;
  for (let i = 0; i < indices.length; i++) {
    cumProb += probs[indices[i]];
    if (cumProb >= p) {
      cutoff = i + 1;
      break;
    }
  }

  // 从截断范围内采样
  const candidates = indices.slice(0, cutoff);
  const candidateProbs = candidates.map(i => probs[i]);
  const probSum = candidateProbs.reduce((a, b) => a + b, 0);

  const r = Math.random() * probSum;
  let accum = 0;
  for (let i = 0; i < candidates.length; i++) {
    accum += candidateProbs[i];
    if (r <= accum) return candidates[i];
  }

  return candidates[candidates.length - 1];
}
