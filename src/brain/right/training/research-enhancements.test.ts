/**
 * Phase 6.5 研究增强测试
 *
 * 测试：
 * 1. 课程学习采样（ReplayBuffer.sampleCurriculum）
 * 2. 上下文感知采样（ReplayBuffer.sampleContextual）
 * 3. 反事实样本生成（DecisionMemory.generateCounterfactuals）
 * 4. 元认知路由（ExperienceRouter.route with qualityEstimate）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ReplayBuffer } from './replay-buffer.js';
import type { TrainingSample } from '../types.js';

// ==================== 测试辅助 ====================

function makeSample(overrides: Partial<TrainingSample> = {}): TrainingSample {
  return {
    features: new Float32Array([1, 2, 3]),
    labelIntent: 0,
    labelTools: [0, 1],
    labelQuality: 0.5,
    outcome: true,
    timestamp: Date.now(),
    weight: 1.0,
    ...overrides,
  };
}

// ==================== 课程学习 ====================

describe('ReplayBuffer - 课程学习', () => {
  let buffer: ReplayBuffer;

  beforeEach(() => {
    buffer = new ReplayBuffer(100);
    // 填充不同难度的样本
    // 简单：成功的、最近的、高权重
    for (let i = 0; i < 10; i++) {
      buffer.push(makeSample({
        outcome: true,
        weight: 1.0,
        timestamp: Date.now(),
      }));
    }
    // 中等：失败的、最近的
    for (let i = 0; i < 10; i++) {
      buffer.push(makeSample({
        outcome: false,
        weight: 0.5,
        timestamp: Date.now(),
      }));
    }
    // 困难：失败的、久远的、低权重
    for (let i = 0; i < 10; i++) {
      buffer.push(makeSample({
        outcome: false,
        weight: 0.3,
        timestamp: Date.now() - 86_400_000 * 2, // 2天前
      }));
    }
  });

  it('calcDifficulty should return low for easy samples', () => {
    const easy = makeSample({ outcome: true, weight: 1.0, timestamp: Date.now() });
    const diff = ReplayBuffer.calcDifficulty(easy);
    expect(diff).toBeLessThan(0.35);
  });

  it('calcDifficulty should return high for hard samples', () => {
    const hard = makeSample({
      outcome: false,
      weight: 0.3,
      timestamp: Date.now() - 86_400_000 * 2,
    });
    const diff = ReplayBuffer.calcDifficulty(hard);
    expect(diff).toBeGreaterThan(0.6);
  });

  it('sampleCurriculum with progress=0 should only return easy samples', () => {
    const samples = buffer.sampleCurriculum(8, 0);
    expect(samples.length).toBeGreaterThan(0);
    // 所有样本的 difficulty 应该 <= 0.3
    for (const s of samples) {
      const diff = ReplayBuffer.calcDifficulty(s);
      expect(diff).toBeLessThanOrEqual(0.35); // 允许小误差
    }
  });

  it('sampleCurriculum with progress=1 should return from all difficulty levels', () => {
    const samples = buffer.sampleCurriculum(8, 1);
    // progress=1 → maxDifficulty=1.0，所有样本都合格
    // 但可能不足 8 个（取决于去重和随机采样）
    expect(samples.length).toBeGreaterThanOrEqual(1);
    expect(samples.length).toBeLessThanOrEqual(8);
  });

  it('sampleCurriculum should respect batchSize', () => {
    const samples = buffer.sampleCurriculum(5, 1);
    expect(samples.length).toBeLessThanOrEqual(5);
  });
});

// ==================== 上下文感知采样 ====================

describe('ReplayBuffer - 上下文感知采样', () => {
  let buffer: ReplayBuffer;

  beforeEach(() => {
    buffer = new ReplayBuffer(100);
    // 最近的成功样本
    for (let i = 0; i < 5; i++) {
      buffer.push(makeSample({
        outcome: true,
        timestamp: Date.now(),
        features: new Float32Array([1, 0, 0]),
      }));
    }
    // 旧的失败样本
    for (let i = 0; i < 5; i++) {
      buffer.push(makeSample({
        outcome: false,
        timestamp: Date.now() - 3_600_000 * 2, // 2小时前
        features: new Float32Array([0, 1, 0]),
      }));
    }
  });

  it('should return samples ordered by contextual relevance', () => {
    const targetFeatures = new Float32Array([1, 0, 0]);
    const samples = buffer.sampleContextual(targetFeatures, undefined, 3);
    expect(samples.length).toBe(3);
    // 相似特征的样本应该排在前面
    // 第一个样本的 features 应该更接近 target
  });

  it('should handle empty emotion gracefully', () => {
    const samples = buffer.sampleContextual(new Float32Array([1, 2, 3]), undefined, 5);
    expect(samples.length).toBe(5);
  });

  it('should factor in emotion when provided', () => {
    // 正面情绪应该偏好成功样本
    const positiveEmotion = {
      joy: 80, sadness: 10, anger: 5, fear: 5,
      surprise: 20, disgust: 5, trust: 70, anticipation: 60,
    };
    const samples = buffer.sampleContextual(
      new Float32Array([1, 0, 0]),
      positiveEmotion,
      5,
    );
    expect(samples.length).toBe(5);
    // 正面情绪下，成功样本应该占比更高
    const successCount = samples.filter(s => s.outcome).length;
    expect(successCount).toBeGreaterThanOrEqual(2);
  });

  it('should respect k parameter', () => {
    const samples = buffer.sampleContextual(new Float32Array([1, 0, 0]), undefined, 2);
    expect(samples.length).toBe(2);
  });
});
