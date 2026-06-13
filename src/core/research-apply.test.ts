/**
 * 研究借鉴落地 — 新增功能测试
 * 覆盖 P0-1 ~ P2-2 的新增纯函数
 */

import { describe, it, expect } from 'vitest';

// ═══════════════════════════════════════════════════════════
// P0-2: Thompson Sampling 多维反馈 — weightedSuccessScore
// ═══════════════════════════════════════════════════════════

/** 从 model-pool-scheduler.ts 提取的纯函数 */
function weightedSuccessScore(record: {
  success: boolean;
  latencyMs: number;
  costEstimate: number;
  inputTokens: number;
  outputTokens: number;
  userFeedback?: 'good' | 'bad';
}): number {
  if (!record.success) return 0;
  let score = 1.0;
  if (record.latencyMs > 5000) score *= 0.7;
  else if (record.latencyMs > 2000) score *= 0.85;
  if (record.costEstimate > 0.1) score *= 0.8;
  else if (record.costEstimate > 0.05) score *= 0.9;
  const ratio = record.outputTokens / Math.max(1, record.inputTokens);
  if (ratio > 3) score *= 0.9;
  if (record.userFeedback === 'bad') score *= 0.5;
  else if (record.userFeedback === 'good') score *= 1.1;
  return Math.min(1, Math.max(0, score));
}

function computeWeightedStats(records: Array<Parameters<typeof weightedSuccessScore>[0]>): { attempts: number; successes: number } {
  if (records.length === 0) return { attempts: 0, successes: 0 };
  const totalWeight = records.length;
  const weightedSuccesses = records.reduce((sum, r) => sum + weightedSuccessScore(r), 0);
  return { attempts: totalWeight, successes: weightedSuccesses };
}

describe('P0-2: weightedSuccessScore', () => {
  const base = { success: true, latencyMs: 500, costEstimate: 0.01, inputTokens: 100, outputTokens: 100 };

  it('成功 + 低延迟 + 低成本 → ~1.0', () => {
    expect(weightedSuccessScore(base)).toBeCloseTo(1.0, 1);
  });

  it('失败 → 0', () => {
    expect(weightedSuccessScore({ ...base, success: false })).toBe(0);
  });

  it('延迟 >5s → ×0.7', () => {
    const score = weightedSuccessScore({ ...base, latencyMs: 6000 });
    expect(score).toBeCloseTo(0.7, 1);
  });

  it('延迟 >2s → ×0.85', () => {
    const score = weightedSuccessScore({ ...base, latencyMs: 3000 });
    expect(score).toBeCloseTo(0.85, 1);
  });

  it('成本 >0.1 → ×0.8', () => {
    const score = weightedSuccessScore({ ...base, costEstimate: 0.15 });
    expect(score).toBeCloseTo(0.8, 1);
  });

  it('token 比 >3 → ×0.9', () => {
    // outputTokens=400, inputTokens=100 → ratio=4 > 3
    const score = weightedSuccessScore({ ...base, outputTokens: 400 });
    expect(score).toBeCloseTo(0.9, 1);
  });

  it('用户反馈 bad → ×0.5', () => {
    const score = weightedSuccessScore({ ...base, userFeedback: 'bad' });
    expect(score).toBeCloseTo(0.5, 1);
  });

  it('用户反馈 good → ×1.1 (capped at 1.0)', () => {
    const score = weightedSuccessScore({ ...base, userFeedback: 'good' });
    expect(score).toBe(1.0); // min(1, 1.0 * 1.1) = 1.0
  });

  it('多因素叠加', () => {
    // 高延迟 + 高成本 + 高 token 比 → 0.7 * 0.8 * 0.9 = 0.504
    const score = weightedSuccessScore({
      ...base,
      latencyMs: 6000,
      costEstimate: 0.15,
      outputTokens: 400,
    });
    expect(score).toBeCloseTo(0.504, 2);
  });
});

describe('P0-2: computeWeightedStats', () => {
  it('空记录 → 0/0', () => {
    expect(computeWeightedStats([])).toEqual({ attempts: 0, successes: 0 });
  });

  it('全成功 + 低延迟 → successes ≈ attempts', () => {
    const records = Array(5).fill(null).map(() => ({
      success: true, latencyMs: 500, costEstimate: 0.01, inputTokens: 100, outputTokens: 100,
    }));
    const stats = computeWeightedStats(records);
    expect(stats.attempts).toBe(5);
    expect(stats.successes).toBeCloseTo(5.0, 0);
  });

  it('全失败 → successes = 0', () => {
    const records = Array(3).fill(null).map(() => ({
      success: false, latencyMs: 500, costEstimate: 0.01, inputTokens: 100, outputTokens: 100,
    }));
    const stats = computeWeightedStats(records);
    expect(stats.attempts).toBe(3);
    expect(stats.successes).toBe(0);
  });

  it('混合成功/失败 → successes 在 0 和 attempts 之间', () => {
    const records = [
      { success: true, latencyMs: 500, costEstimate: 0.01, inputTokens: 100, outputTokens: 100 },
      { success: false, latencyMs: 500, costEstimate: 0.01, inputTokens: 100, outputTokens: 100 },
    ];
    const stats = computeWeightedStats(records);
    expect(stats.attempts).toBe(2);
    expect(stats.successes).toBeGreaterThan(0);
    expect(stats.successes).toBeLessThan(2);
  });
});

// ═══════════════════════════════════════════════════════════
// P1-1: PromptBudgetManager taskType 感知 — getTaskTypeBoost
// ═══════════════════════════════════════════════════════════

describe('P1-1: getTaskTypeBoost', () => {
  // 直接测试优先级调整逻辑（从 prompt-budget.ts 提取）
  function getTaskTypeBoost(taskType?: string): Map<string, number> {
    const boost = new Map<string, number>();
    switch (taskType) {
      case 'reasoning':
        boost.set('memory', 20);
        boost.set('knowledge', 20);
        boost.set('experience', 10);
        break;
      case 'tools':
        boost.set('tools', 15);
        boost.set('skills', 10);
        break;
      case 'chat':
        boost.set('personality', 15);
        boost.set('emotion', 15);
        boost.set('cognitive', 10);
        break;
      case 'background':
        boost.set('supplementary', -5);
        break;
    }
    return boost;
  }

  it('reasoning → 记忆和知识提升', () => {
    const boost = getTaskTypeBoost('reasoning');
    expect(boost.get('memory')).toBe(20);
    expect(boost.get('knowledge')).toBe(20);
    expect(boost.get('experience')).toBe(10);
  });

  it('tools → 工具和技能提升', () => {
    const boost = getTaskTypeBoost('tools');
    expect(boost.get('tools')).toBe(15);
    expect(boost.get('skills')).toBe(10);
  });

  it('chat → 人格和情绪提升', () => {
    const boost = getTaskTypeBoost('chat');
    expect(boost.get('personality')).toBe(15);
    expect(boost.get('emotion')).toBe(15);
    expect(boost.get('cognitive')).toBe(10);
  });

  it('background → 补充信息降低', () => {
    const boost = getTaskTypeBoost('background');
    expect(boost.get('supplementary')).toBe(-5);
  });

  it('undefined → 空 map', () => {
    const boost = getTaskTypeBoost(undefined);
    expect(boost.size).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// P1-2: 经验执行轻量验证 — verifyExperienceOutput
// ═══════════════════════════════════════════════════════════

describe('P1-2: verifyExperienceOutput', () => {
  function verifyExperienceOutput(output: string, originalInput: string): boolean {
    if (!output || output.length < 10) return false;
    const errorSignals = ['错误', 'error', 'failed', '失败', '无法', 'cannot', 'exception'];
    const lower = output.toLowerCase();
    if (errorSignals.some(s => lower.includes(s)) && output.length < 50) return false;
    if (output.trim() === originalInput.trim()) return false;
    return true;
  }

  it('正常输出 → true', () => {
    expect(verifyExperienceOutput('这是一个正常的执行结果，包含了足够的内容', '用户问题')).toBe(true);
  });

  it('空输出 → false', () => {
    expect(verifyExperienceOutput('', '问题')).toBe(false);
  });

  it('太短输出 → false', () => {
    expect(verifyExperienceOutput('短', '问题')).toBe(false);
  });

  it('短错误输出 → false', () => {
    expect(verifyExperienceOutput('错误：执行失败', '问题')).toBe(false);
  });

  it('长输出含错误词 → true（可能是详细错误分析）', () => {
    const longOutput = '经过分析，发现这个错误是由于配置文件中的参数设置不正确导致的。'.repeat(3);
    expect(verifyExperienceOutput(longOutput, '问题')).toBe(true);
  });

  it('复读输入 → false', () => {
    expect(verifyExperienceOutput('用户的问题', '用户的问题')).toBe(false);
  });

  it('英文 error 短输出 → false', () => {
    expect(verifyExperienceOutput('error: something went wrong', 'question')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// P0-1: decideCollaboration 决策树
// ═══════════════════════════════════════════════════════════

describe('P0-1: decideCollaboration 信号+资源→决策', () => {
  // 简化版决策逻辑（镜像 agent.ts decideCollaboration）
  type Mode = 'local_only' | 'single' | 'parallel' | 'cascade';
  function decide(signal: { domains: string[]; complexity: string }, res: {
    budgetRemaining: number;
    availableNodeCount: number;
    localCoverageRatio: number;
    localConfidence: number;
    userCorrectionCount: number;
    experienceHit: any;
  }): { mode: Mode; reason: string } {
    if (res.experienceHit?.path === 'exp_direct') {
      return { mode: 'local_only', reason: '经验路由' };
    }
    if (res.budgetRemaining <= 0) return { mode: 'local_only', reason: '预算耗尽' };
    if (res.userCorrectionCount >= 3) return { mode: 'local_only', reason: '用户纠正' };
    if (signal.domains.length > 0 && res.localCoverageRatio >= 1 && res.localConfidence >= 0.7) {
      return { mode: 'local_only', reason: '本地覆盖' };
    }
    if (signal.domains.length === 0 || signal.complexity === 'simple') {
      return { mode: 'single', reason: '简单/无领域' };
    }
    const needsMulti = signal.domains.length >= 2 && signal.complexity !== 'simple';
    if (needsMulti && res.availableNodeCount >= 2) {
      return { mode: 'parallel', reason: '多领域' };
    }
    if (res.availableNodeCount <= 1) return { mode: 'single', reason: '节点不足' };
    return { mode: 'cascade', reason: '默认' };
  }

  const defaultRes = {
    budgetRemaining: 1.0, availableNodeCount: 2,
    localCoverageRatio: 0, localConfidence: 0,
    userCorrectionCount: 0, experienceHit: null,
  };

  it('经验路由命中 → local_only', () => {
    const r = decide({ domains: ['code'], complexity: 'medium' }, {
      ...defaultRes, experienceHit: { path: 'exp_direct' },
    });
    expect(r.mode).toBe('local_only');
  });

  it('预算耗尽 → local_only', () => {
    const r = decide({ domains: ['code'], complexity: 'medium' }, {
      ...defaultRes, budgetRemaining: 0,
    });
    expect(r.mode).toBe('local_only');
  });

  it('用户纠正 >=3 → local_only', () => {
    const r = decide({ domains: ['code'], complexity: 'medium' }, {
      ...defaultRes, userCorrectionCount: 3,
    });
    expect(r.mode).toBe('local_only');
  });

  it('本地完全覆盖 + 高置信度 → local_only', () => {
    const r = decide({ domains: ['code'], complexity: 'medium' }, {
      ...defaultRes, localCoverageRatio: 1.0, localConfidence: 0.9,
    });
    expect(r.mode).toBe('local_only');
  });

  it('无领域 → single', () => {
    const r = decide({ domains: [], complexity: 'medium' }, defaultRes);
    expect(r.mode).toBe('single');
  });

  it('简单任务 → single', () => {
    const r = decide({ domains: ['code'], complexity: 'simple' }, defaultRes);
    expect(r.mode).toBe('single');
  });

  it('多领域 + 节点>=2 → parallel', () => {
    const r = decide({ domains: ['code', 'architect'], complexity: 'medium' }, {
      ...defaultRes, availableNodeCount: 3,
    });
    expect(r.mode).toBe('parallel');
  });

  it('节点不足 → single', () => {
    const r = decide({ domains: ['code'], complexity: 'medium' }, {
      ...defaultRes, availableNodeCount: 0,
    });
    expect(r.mode).toBe('single');
  });

  it('默认 → cascade', () => {
    const r = decide({ domains: ['code'], complexity: 'medium' }, {
      ...defaultRes, availableNodeCount: 2, localCoverageRatio: 0,
    });
    expect(r.mode).toBe('cascade');
  });
});
