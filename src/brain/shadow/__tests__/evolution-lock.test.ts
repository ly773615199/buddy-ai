/**
 * EvolutionLock 单元测试
 */

import { describe, it, expect } from 'vitest';
import { EvolutionLock } from '../evolution-lock.js';
import type { EvolutionProposal, ABTestResult } from '../types.js';

function makeProposal(level: 'L1' | 'L2' | 'L3' = 'L1'): EvolutionProposal {
  return {
    id: 'test-proposal',
    level,
    type: 'new_rule',
    description: 'Test rule',
    gap: {
      id: 'gap-1', fingerprint: 'code|medium|tools', description: 'test gap',
      failures: [], firstDetectedAt: Date.now(), failureCount: 3,
      avgConfidence: 0.2, relatedSamples: 100, priority: 'medium',
    },
    changes: [{ target: 'left', action: 'add', details: { condition: 'true', action: 'do', priority: 5 } }],
    expectedImpact: 'test',
    createdAt: Date.now(),
  };
}

function makeABResults(count: number, group: 'shadow' | 'production', successRate: number): ABTestResult[] {
  return Array.from({ length: count }, (_, i) => ({
    group,
    success: i < count * successRate,
    latencyMs: 100 + Math.random() * 50,
    cost: 0.01,
  }));
}

describe('EvolutionLock', () => {
  it('should pass when all locks pass (L1)', async () => {
    const lock = new EvolutionLock({ gdiThreshold: 0.44, requireHumanApproval: true });
    const shadow = { decisionEmbeddings: [], decisionDistribution: [], nnWeights: [], regressionTestFailures: 0 };
    const prod = { decisionEmbeddings: [], decisionDistribution: [], nnWeights: [] };
    const results = [
      ...makeABResults(100, 'shadow', 0.9),
      ...makeABResults(100, 'production', 0.8),
    ];

    const validation = await lock.validate(shadow, prod, results, makeProposal('L1'));
    // L1 doesn't require human approval
    expect(validation.allPassed).toBe(true);
    expect(validation.locks).toHaveLength(3);
  });

  it('should fail on L3 due to human approval', async () => {
    const lock = new EvolutionLock({ requireHumanApproval: true });
    const shadow = { decisionEmbeddings: [], decisionDistribution: [], nnWeights: [], regressionTestFailures: 0 };
    const prod = { decisionEmbeddings: [], decisionDistribution: [], nnWeights: [] };
    const results = [
      ...makeABResults(100, 'shadow', 0.9),
      ...makeABResults(100, 'production', 0.8),
    ];

    const validation = await lock.validate(shadow, prod, results, makeProposal('L3'));
    expect(validation.allPassed).toBe(false);
    expect(validation.locks.some(l => l.lockName === '人工审批' && !l.passed)).toBe(true);
  });

  it('should fail when regression test failures exist', async () => {
    const lock = new EvolutionLock({ requireHumanApproval: false });
    const shadow = { decisionEmbeddings: [], decisionDistribution: [], nnWeights: [], regressionTestFailures: 3 };
    const prod = { decisionEmbeddings: [], decisionDistribution: [], nnWeights: [] };
    const results = [
      ...makeABResults(100, 'shadow', 0.9),
      ...makeABResults(100, 'production', 0.8),
    ];

    const validation = await lock.validate(shadow, prod, results, makeProposal('L1'));
    expect(validation.allPassed).toBe(false);
    expect(validation.locks.find(l => l.lockName === '约束保护 (CPS)')?.passed).toBe(false);
  });

  it('should fail when insufficient test samples', async () => {
    const lock = new EvolutionLock({ requireHumanApproval: false });
    const shadow = { decisionEmbeddings: [], decisionDistribution: [], nnWeights: [], regressionTestFailures: 0 };
    const prod = { decisionEmbeddings: [], decisionDistribution: [], nnWeights: [] };
    const results = makeABResults(10, 'shadow', 0.9);

    const validation = await lock.validate(shadow, prod, results, makeProposal('L1'));
    const regressionLock = validation.locks.find(l => l.lockName === '回归风险评估');
    expect(regressionLock?.passed).toBe(false);
    expect(regressionLock?.details).toContain('样本不足');
  });

  it('should detect NN weight NaN', async () => {
    const lock = new EvolutionLock({ requireHumanApproval: false });
    const weights = [new Float32Array([1, 2, NaN])];
    const shadow = { decisionEmbeddings: [], decisionDistribution: [], nnWeights: weights, regressionTestFailures: 0 };
    const prod = { decisionEmbeddings: [], decisionDistribution: [], nnWeights: [new Float32Array([1, 2, 3])] };
    const results = [
      ...makeABResults(100, 'shadow', 0.9),
      ...makeABResults(100, 'production', 0.8),
    ];

    // Use nn_expand proposal type to trigger NN weight check
    const nnProposal = makeProposal('L1');
    nnProposal.type = 'nn_expand';
    nnProposal.changes = [{ target: 'right', action: 'modify', details: {} }];

    const validation = await lock.validate(shadow, prod, results, nnProposal);
    expect(validation.allPassed).toBe(false);
    const cps = validation.locks.find(l => l.lockName === '约束保护 (CPS)');
    expect(cps?.details).toContain('NaN');
  });
});
