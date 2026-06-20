/**
 * InfoNCE 对比损失 — SimCSE 核心
 *
 * InfoNCE = -log(exp(sim(z_i, z_j) / τ) / Σ_k exp(sim(z_i, z_k) / τ))
 *
 * 同一样本的两个增强视图互为正样本对，batch 内其他样本为负样本。
 * 温度 τ 控制分布的尖锐程度：τ 越小越尖锐（越严格区分正负样本）。
 *
 * SimCSE 核心洞察：用不同 dropout mask 做数据增强，比传统 NLP 增强更简单有效。
 */

import type { Tensor } from '../nn/tensor.js';

/**
 * 计算两个向量的余弦相似度
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/**
 * 批量余弦相似度矩阵：[N, D] × [N, D] → [N, N]
 */
export function cosineSimilarityMatrix(a: Float32Array[], b: Float32Array[]): Float32Array[] {
  const N = a.length;
  const matrix: Float32Array[] = [];
  for (let i = 0; i < N; i++) {
    const row = new Float32Array(N);
    for (let j = 0; j < N; j++) {
      row[j] = cosineSimilarity(a[i], b[j]);
    }
    matrix.push(row);
  }
  return matrix;
}

/**
 * InfoNCE 损失
 *
 * @param z1 [N, D] 第一组嵌入（增强视图 1）
 * @param z2 [N, D] 第二组嵌入（增强视图 2，z1[i] 和 z2[i] 是正样本对）
 * @param temperature 温度参数（默认 0.05）
 * @returns 标量损失
 */
export function infoNCELoss(
  z1: Float32Array[],
  z2: Float32Array[],
  temperature = 0.05,
): number {
  const N = z1.length;
  if (N === 0) return 0;

  // 计算相似度矩阵 [N, 2N]（z1 对 z1+z2 的相似度）
  const allZ = [...z1, ...z2];
  let totalLoss = 0;

  for (let i = 0; i < N; i++) {
    // 正样本对：z1[i] 和 z2[i]
    const posSim = cosineSimilarity(z1[i], z2[i]) / temperature;

    // 负样本：所有其他样本
    let logSumExp = 0;
    for (let j = 0; j < 2 * N; j++) {
      if (j === i || j === i + N) continue; // 跳过自身和正样本
      const sim = cosineSimilarity(z1[i], allZ[j]) / temperature;
      logSumExp += Math.exp(sim);
    }
    // 加上正样本
    logSumExp += Math.exp(posSim);

    // InfoNCE: -log(exp(pos) / sum_exp)
    totalLoss += -posSim + Math.log(logSumExp);
  }

  // 对称版本：也计算 z2→z1 的方向
  for (let i = 0; i < N; i++) {
    const posSim = cosineSimilarity(z2[i], z1[i]) / temperature;

    let logSumExp = 0;
    for (let j = 0; j < 2 * N; j++) {
      if (j === i + N || j === i) continue;
      const sim = cosineSimilarity(z2[i], allZ[j]) / temperature;
      logSumExp += Math.exp(sim);
    }
    logSumExp += Math.exp(posSim);

    totalLoss += -posSim + Math.log(logSumExp);
  }

  return totalLoss / (2 * N);
}

/**
 * InfoNCE 梯度
 *
 * ∂L/∂z1[i] = (1/τ) * (-z2[i] + Σ_j softmax(sim/τ)_j * z_j)
 *
 * @param z1 [N, D] 第一组嵌入
 * @param z2 [N, D] 第二组嵌入
 * @param temperature 温度参数
 * @returns [gradZ1, gradZ2] 梯度
 */
export function infoNCEGradient(
  z1: Float32Array[],
  z2: Float32Array[],
  temperature = 0.05,
): [Float32Array[], Float32Array[]] {
  const N = z1.length;
  const D = z1[0].length;
  const allZ = [...z1, ...z2];

  const gradZ1: Float32Array[] = [];
  const gradZ2: Float32Array[] = [];

  for (let i = 0; i < N; i++) {
    // z1[i] 的梯度
    const g1 = new Float32Array(D);

    // 计算 softmax 权重
    const sims: number[] = [];
    for (let j = 0; j < 2 * N; j++) {
      sims.push(cosineSimilarity(z1[i], allZ[j]) / temperature);
    }
    const maxSim = Math.max(...sims);
    let sumExp = 0;
    for (let j = 0; j < 2 * N; j++) {
      sims[j] = Math.exp(sims[j] - maxSim);
      sumExp += sims[j];
    }
    for (let j = 0; j < 2 * N; j++) {
      sims[j] /= sumExp;
    }

    // 梯度 = Σ_j w_j * (z_j - z1[i]) / (||z1[i]|| * ||z_j||)
    // 近似简化：忽略范数归一化，使用 softmax 加权
    for (let j = 0; j < 2 * N; j++) {
      const w = sims[j] - (j === i ? 1 : 0); // 减去自身（正样本位置）
      for (let d = 0; d < D; d++) {
        g1[d] += w * allZ[j][d];
      }
    }
    // 缩放
    for (let d = 0; d < D; d++) {
      g1[d] /= (temperature * N);
    }
    gradZ1.push(g1);
  }

  // z2 的梯度（对称）
  for (let i = 0; i < N; i++) {
    const g2 = new Float32Array(D);

    const sims: number[] = [];
    for (let j = 0; j < 2 * N; j++) {
      sims.push(cosineSimilarity(z2[i], allZ[j]) / temperature);
    }
    const maxSim = Math.max(...sims);
    let sumExp = 0;
    for (let j = 0; j < 2 * N; j++) {
      sims[j] = Math.exp(sims[j] - maxSim);
      sumExp += sims[j];
    }
    for (let j = 0; j < 2 * N; j++) {
      sims[j] /= sumExp;
    }

    for (let j = 0; j < 2 * N; j++) {
      const w = sims[j] - (j === i + N ? 1 : 0);
      for (let d = 0; d < D; d++) {
        g2[d] += w * allZ[j][d];
      }
    }
    for (let d = 0; d < D; d++) {
      g2[d] /= (temperature * N);
    }
    gradZ2.push(g2);
  }

  return [gradZ1, gradZ2];
}
