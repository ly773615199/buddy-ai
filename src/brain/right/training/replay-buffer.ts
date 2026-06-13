/**
 * 经验回放缓冲 — FIFO 容量 1000
 *
 * 存储训练样本，支持随机采样
 */

import type { TrainingSample } from '../../types.js';

export class ReplayBuffer {
  private buffer: TrainingSample[] = [];
  private readonly capacity: number;

  constructor(capacity = 1000) {
    this.capacity = capacity;
  }

  /** 添加样本（自动计算 difficulty） */
  push(sample: TrainingSample): void {
    if (sample.difficulty === undefined) {
      sample.difficulty = ReplayBuffer.calcDifficulty(sample);
    }
    this.buffer.push(sample);
    if (this.buffer.length > this.capacity) {
      this.buffer.shift(); // FIFO 淘汰
    }
  }

  /** 批量添加 */
  pushBatch(samples: TrainingSample[]): void {
    for (const s of samples) this.push(s);
  }

  /** 随机采样 batch */
  sample(batchSize: number): TrainingSample[] {
    const n = Math.min(batchSize, this.buffer.length);
    const result: TrainingSample[] = [];
    const indices = new Set<number>();
    while (indices.size < n) {
      indices.add(Math.floor(Math.random() * this.buffer.length));
    }
    for (const idx of indices) {
      result.push(this.buffer[idx]);
    }
    return result;
  }

  /** 按权重采样（权重越高越容易被选中） */
  sampleWeighted(batchSize: number): TrainingSample[] {
    const n = Math.min(batchSize, this.buffer.length);
    const totalWeight = this.buffer.reduce((sum, s) => sum + s.weight, 0);
    const result: TrainingSample[] = [];
    const usedIndices = new Set<number>();

    for (let i = 0; i < n; i++) {
      let r = Math.random() * totalWeight;
      for (let j = 0; j < this.buffer.length; j++) {
        if (usedIndices.has(j)) continue;
        r -= this.buffer[j].weight;
        if (r <= 0) {
          result.push(this.buffer[j]);
          usedIndices.add(j);
          break;
        }
      }
    }
    return result;
  }

  get size(): number { return this.buffer.length; }
  get isFull(): boolean { return this.buffer.length >= this.capacity; }

  clear(): void { this.buffer = []; }

  /** 获取所有样本（用于蒸馏） */
  getAll(): TrainingSample[] { return [...this.buffer]; }

  // ==================== kNN 相似性采样 ====================

  /**
   * 按特征相似性采样（kNN）
   *
   * 给定目标特征，找最相似的 k 个样本
   * 使用余弦相似度
   */
  sampleBySimilarity(targetFeatures: Float32Array, k: number): TrainingSample[] {
    if (this.buffer.length === 0) return [];

    // 计算每个样本与目标的相似度
    const similarities: Array<{ index: number; sim: number }> = [];
    for (let i = 0; i < this.buffer.length; i++) {
      const sim = cosineSimilarity(targetFeatures, this.buffer[i].features);
      similarities.push({ index: i, sim });
    }

    // 按相似度降序排序
    similarities.sort((a, b) => b.sim - a.sim);

    // 取 top-k
    const result: TrainingSample[] = [];
    for (let i = 0; i < Math.min(k, similarities.length); i++) {
      result.push(this.buffer[similarities[i].index]);
    }
    return result;
  }

  /**
   * 按相似性加权采样
   *
   * 相似度越高的样本越容易被选中
   */
  sampleBySimilarityWeighted(targetFeatures: Float32Array, k: number): TrainingSample[] {
    if (this.buffer.length === 0) return [];

    // 计算相似度作为权重
    const weights: number[] = [];
    let totalWeight = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const sim = Math.max(0, cosineSimilarity(targetFeatures, this.buffer[i].features));
      weights.push(sim);
      totalWeight += sim;
    }

    if (totalWeight === 0) return this.sample(k);

    // 加权采样
    const result: TrainingSample[] = [];
    const used = new Set<number>();
    for (let i = 0; i < Math.min(k, this.buffer.length); i++) {
      let r = Math.random() * totalWeight;
      for (let j = 0; j < this.buffer.length; j++) {
        if (used.has(j)) continue;
        r -= weights[j];
        if (r <= 0) {
          result.push(this.buffer[j]);
          used.add(j);
          totalWeight -= weights[j];
          break;
        }
      }
    }
    return result;
  }
  // ==================== 课程学习采样 ====================

  /**
   * 计算样本难度
   *
   * 难度 = f(outcome, weight, age)
   * - 成功的简单(0.2)，失败的难(0.8)
   * - 权重高的简单，权重低的难
   * - 最近的简单，久远的难
   */
  static calcDifficulty(sample: TrainingSample): number {
    const outcomeDiff = sample.outcome ? 0.2 : 0.8;
    const weightDiff = 1 - Math.min(1, sample.weight);
    const ageMs = Date.now() - sample.timestamp;
    const ageDiff = Math.min(1, ageMs / 86_400_000); // 1天=1.0
    return outcomeDiff * 0.4 + weightDiff * 0.3 + ageDiff * 0.3;
  }

  /**
   * 课程学习采样 — 从易到难
   *
   * @param batchSize 批大小
   * @param progress 训练进度 0~1（前30%只采简单样本，后70%逐步放开）
   */
  sampleCurriculum(batchSize: number, progress: number): TrainingSample[] {
    if (this.buffer.length === 0) return [];

    // 确保所有样本有 difficulty
    for (const s of this.buffer) {
      if (s.difficulty === undefined) {
        s.difficulty = ReplayBuffer.calcDifficulty(s);
      }
    }

    // 进度 → 最大难度阈值
    const maxDifficulty = 0.3 + Math.max(0, Math.min(1, progress)) * 0.7;

    // 过滤符合难度的样本
    const eligible = this.buffer.filter(s => (s.difficulty ?? 0) <= maxDifficulty);
    if (eligible.length === 0) return this.sample(batchSize);

    // 从合格样本中加权采样
    const n = Math.min(batchSize, eligible.length);
    const result: TrainingSample[] = [];
    const used = new Set<number>();
    const totalWeight = eligible.reduce((s, e) => s + e.weight, 0);

    for (let i = 0; i < n; i++) {
      let r = Math.random() * totalWeight;
      for (let j = 0; j < eligible.length; j++) {
        if (used.has(j)) continue;
        r -= eligible[j].weight;
        if (r <= 0) {
          result.push(eligible[j]);
          used.add(j);
          break;
        }
      }
    }
    return result;
  }

  // ==================== 上下文感知采样（再注意力重放） ====================

  /**
   * 上下文感知采样 — 结合特征相似度 + 时效性 + 情绪亲和度
   *
   * 基于 Re-attentive Experience Replay (ML 2024)：
   * 重放旧经验时用当前状态重新计算注意力权重
   *
   * @param targetFeatures 当前输入特征
   * @param emotion 当前情绪向量（8维，可选）
   * @param k 采样数量
   */
  sampleContextual(
    targetFeatures: Float32Array,
    emotion?: { joy: number; sadness: number; anger: number; fear: number;
                surprise: number; disgust: number; trust: number; anticipation: number },
    k = 8,
  ): TrainingSample[] {
    if (this.buffer.length === 0) return [];

    const now = Date.now();
    const scored: Array<{ sample: TrainingSample; score: number }> = [];

    for (const sample of this.buffer) {
      // 特征相似度 (50%)
      const sim = cosineSimilarity(targetFeatures, sample.features);

      // 时效性 (20%): 半衰期 1 小时
      const ageMs = now - sample.timestamp;
      const recency = Math.exp(-ageMs / 3_600_000);

      // 情绪亲和度 (30%): 如果有情绪信息
      let emotionScore = 0.5; // 默认中性
      if (emotion) {
        // 正面情绪时偏好成功样本，负面情绪时偏好失败样本
        const valence = (emotion.joy + emotion.trust + emotion.anticipation)
                      - (emotion.sadness + emotion.anger + emotion.fear);
        const normalizedValence = valence / 300; // 归一化到 -1~1
        const sampleOutcome = sample.outcome ? 1 : -1;
        emotionScore = 0.5 + normalizedValence * sampleOutcome * 0.5;
      }

      const score = sim * 0.5 + recency * 0.2 + emotionScore * 0.3;
      scored.push({ sample, score });
    }

    // 按综合分数排序取 top-k
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.min(k, scored.length)).map(s => s.sample);
  }
}

// ==================== 工具函数 ====================

/**
 * 余弦相似度
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || b.length === 0) return 0;
  const len = Math.min(a.length, b.length);
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}
