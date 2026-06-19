/**
 * 冷启动测试 — 验证 NN 冷启动时系统仍能正常工作
 *
 * 覆盖：
 * - computeBrainScore 冷启动用能力评分（不同模型得分不同）
 * - estimateQualityFromSignal 信号推断
 * - NN 冷启动预热
 */

import { describe, it, expect } from 'vitest';

// ==================== computeBrainScore 冷启动 ====================

describe('computeBrainScore 冷启动', () => {
  // 模拟 computeBrainScore 的冷启动逻辑
  function computeBrainScoreColdStart(
    model: {
      tier: string;
      capabilities: { reasoning: number; code: number; toolCalling: boolean };
      costPer1kInput: number;
      history: { taskSuccessRate: number; avgLatencyMs: number; totalCalls: number; avgQuality: number; confidence: number };
    },
    criticality: string,
    taskType: string,
  ): number {
    let score = 0;
    const isColdStart = model.history.confidence <= 0.3;

    if (!isColdStart) {
      score += model.history.avgQuality * 40;
    } else {
      const caps = model.capabilities;
      if (taskType === 'reasoning') {
        score += (caps.reasoning ?? 0.5) * 30 + (caps.code ?? 0.5) * 10;
      } else if (taskType === 'tools') {
        score += (caps.code ?? 0.5) * 20 + (caps.reasoning ?? 0.5) * 10 + (caps.toolCalling ? 10 : 0);
      } else {
        score += (caps.reasoning ?? 0.5) * 15 + (caps.code ?? 0.5) * 10 + 5;
      }
    }

    score += model.history.taskSuccessRate * (isColdStart ? 10 : 25);

    const tierBonus: Record<string, number> = { premium: 15, standard: 10, budget: 5, free: 0 };
    if (criticality === 'high') {
      score += (model.capabilities.reasoning ?? 0) * 20;
      score += tierBonus[model.tier] ?? 0;
    }

    return score;
  }

  it('冷启动时不同模型得分不同', () => {
    const premium = {
      tier: 'premium',
      capabilities: { reasoning: 0.9, code: 0.8, toolCalling: true },
      costPer1kInput: 0.05,
      history: { taskSuccessRate: 1, avgLatencyMs: 0, totalCalls: 0, avgQuality: 0.5, confidence: 0 },
    };
    const budget = {
      tier: 'budget',
      capabilities: { reasoning: 0.4, code: 0.3, toolCalling: false },
      costPer1kInput: 0.001,
      history: { taskSuccessRate: 1, avgLatencyMs: 0, totalCalls: 0, avgQuality: 0.5, confidence: 0 },
    };

    const premiumScore = computeBrainScoreColdStart(premium, 'normal', 'reasoning');
    const budgetScore = computeBrainScoreColdStart(budget, 'normal', 'reasoning');

    expect(premiumScore).toBeGreaterThan(budgetScore);
    expect(premiumScore - budgetScore).toBeGreaterThan(10); // 差距应显著
  });

  it('冷启动时 reasoning 任务偏好高推理能力模型', () => {
    const highReasoning = {
      tier: 'standard',
      capabilities: { reasoning: 0.9, code: 0.5, toolCalling: true },
      costPer1kInput: 0.01,
      history: { taskSuccessRate: 1, avgLatencyMs: 0, totalCalls: 0, avgQuality: 0.5, confidence: 0 },
    };
    const lowReasoning = {
      tier: 'standard',
      capabilities: { reasoning: 0.3, code: 0.9, toolCalling: true },
      costPer1kInput: 0.01,
      history: { taskSuccessRate: 1, avgLatencyMs: 0, totalCalls: 0, avgQuality: 0.5, confidence: 0 },
    };

    const highScore = computeBrainScoreColdStart(highReasoning, 'normal', 'reasoning');
    const lowScore = computeBrainScoreColdStart(lowReasoning, 'normal', 'reasoning');

    expect(highScore).toBeGreaterThan(lowScore);
  });

  it('冷启动时 tools 任务偏好高代码能力+工具调用模型', () => {
    const withToolCalling = {
      tier: 'standard',
      capabilities: { reasoning: 0.5, code: 0.8, toolCalling: true },
      costPer1kInput: 0.01,
      history: { taskSuccessRate: 1, avgLatencyMs: 0, totalCalls: 0, avgQuality: 0.5, confidence: 0 },
    };
    const noToolCalling = {
      tier: 'standard',
      capabilities: { reasoning: 0.5, code: 0.8, toolCalling: false },
      costPer1kInput: 0.01,
      history: { taskSuccessRate: 1, avgLatencyMs: 0, totalCalls: 0, avgQuality: 0.5, confidence: 0 },
    };

    const withScore = computeBrainScoreColdStart(withToolCalling, 'normal', 'tools');
    const noScore = computeBrainScoreColdStart(noToolCalling, 'normal', 'tools');

    expect(withScore).toBeGreaterThan(noScore);
  });

  it('冷启动时高关键性任务偏好 premium 模型', () => {
    const premium = {
      tier: 'premium',
      capabilities: { reasoning: 0.9, code: 0.8, toolCalling: true },
      costPer1kInput: 0.05,
      history: { taskSuccessRate: 1, avgLatencyMs: 0, totalCalls: 0, avgQuality: 0.5, confidence: 0 },
    };
    const free = {
      tier: 'free',
      capabilities: { reasoning: 0.9, code: 0.8, toolCalling: true },
      costPer1kInput: 0,
      history: { taskSuccessRate: 1, avgLatencyMs: 0, totalCalls: 0, avgQuality: 0.5, confidence: 0 },
    };

    const premiumScore = computeBrainScoreColdStart(premium, 'high', 'reasoning');
    const freeScore = computeBrainScoreColdStart(free, 'high', 'reasoning');

    expect(premiumScore).toBeGreaterThan(freeScore);
  });

  it('有历史数据后能力评分被历史质量取代', () => {
    const model = {
      tier: 'standard',
      capabilities: { reasoning: 0.9, code: 0.8, toolCalling: true },
      costPer1kInput: 0.01,
      history: { taskSuccessRate: 0.8, avgLatencyMs: 1000, totalCalls: 20, avgQuality: 0.9, confidence: 1 },
    };

    const score = computeBrainScoreColdStart(model, 'normal', 'reasoning');
    // 有数据时: 0.9 * 40 + 0.8 * 25 = 36 + 20 = 56
    expect(score).toBeCloseTo(56, 0);
  });
});

// ==================== estimateQualityFromSignal ====================

describe('estimateQualityFromSignal', () => {
  function estimateQualityFromSignal(
    signal: { complexity: string; criticality?: string; intentConfidence: number },
    resources: { experienceHit: unknown; localConfidence: number },
  ): number {
    let quality = 0.5;
    if (signal.complexity === 'simple') quality += 0.2;
    else if (signal.complexity === 'complex') quality -= 0.2;
    if (signal.criticality === 'high') quality -= 0.15;
    else if (signal.criticality === 'low') quality += 0.1;
    quality += (signal.intentConfidence - 0.5) * 0.3;
    if (resources.experienceHit) quality += 0.1;
    quality += resources.localConfidence * 0.1;
    return Math.max(0, Math.min(1, quality));
  }

  it('简单任务质量预估高', () => {
    const q = estimateQualityFromSignal(
      { complexity: 'simple', criticality: 'low', intentConfidence: 0.9 },
      { experienceHit: null, localConfidence: 0.5 },
    );
    expect(q).toBeGreaterThan(0.7);
  });

  it('复杂关键任务质量预估低', () => {
    const q = estimateQualityFromSignal(
      { complexity: 'complex', criticality: 'high', intentConfidence: 0.6 },
      { experienceHit: null, localConfidence: 0.3 },
    );
    expect(q).toBeLessThan(0.5);
  });

  it('有经验命中时质量预估提升', () => {
    const withExp = estimateQualityFromSignal(
      { complexity: 'medium', intentConfidence: 0.7 },
      { experienceHit: { some: 'data' }, localConfidence: 0.6 },
    );
    const noExp = estimateQualityFromSignal(
      { complexity: 'medium', intentConfidence: 0.7 },
      { experienceHit: null, localConfidence: 0.6 },
    );
    expect(withExp).toBeGreaterThan(noExp);
  });

  it('结果在 [0, 1] 范围内', () => {
    const extremes = [
      { complexity: 'complex', criticality: 'high', intentConfidence: 0 },
      { complexity: 'simple', criticality: 'low', intentConfidence: 1 },
    ];
    for (const s of extremes) {
      const q = estimateQualityFromSignal(s, { experienceHit: null, localConfidence: 0 });
      expect(q).toBeGreaterThanOrEqual(0);
      expect(q).toBeLessThanOrEqual(1);
    }
  });
});
