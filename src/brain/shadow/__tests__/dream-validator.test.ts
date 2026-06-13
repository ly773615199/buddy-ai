/**
 * DreamValidator 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DreamValidator } from '../phase10/dream-validator.js';
import type { EvolutionProposal, BrainProvider } from '../types.js';

function makeProposal(level: 'L1' | 'L2' | 'L3' = 'L1', id?: string): EvolutionProposal {
  return {
    id: id ?? `p-${level}`,
    level,
    type: 'new_rule',
    description: 'test',
    gap: {
      id: 'g-1', fingerprint: 'code|medium|tools', description: 'test',
      failures: [], firstDetectedAt: Date.now(), failureCount: 5,
      avgConfidence: 0.1, relatedSamples: 100, priority: 'high',
    },
    changes: [],
    expectedImpact: 'test',
    createdAt: Date.now(),
  };
}

function makeBrain(overrides?: Partial<BrainProvider>): BrainProvider {
  return {
    getRules: () => [],
    addLearnedRule: () => {},
    getNNConfig: () => ({
      vocabSize: 4096, embedDim: 128, hiddenDim: 256,
      numHeads: 4, numLayers: 4, numIntents: 8, numTools: 32,
      ffnDim: 512, dropout: 0, numSpatialBins: 6, numSceneNodes: 32,
    }),
    getNNParamCount: () => 1000,
    getNNWeights: () => [],
    getDecisionDistribution: () => Array(8).fill(0.125),
    getRecentLosses: () => [0.1],
    getDecisionSamples: () => Array(100).fill({ labelIntent: 0, fingerprint: 'code|medium|tools' }),
    getClusterStats: () => ({ count: 100, successRate: 0.8 }),
    runRegressionTests: async () => 0,
    ...overrides,
  };
}

describe('DreamValidator', () => {
  let dv: DreamValidator;

  beforeEach(() => {
    dv = new DreamValidator({ minSamples: 10, confidenceWeight: 0.7 });
  });

  it('should return empty result without brain provider', async () => {
    const result = await dv.validateInDream(makeProposal());
    expect(result.sampleCount).toBe(0);
    expect(result.passed).toBe(false);
  });

  it('should validate with sufficient samples', async () => {
    dv.setBrainProvider(makeBrain());
    const result = await dv.validateInDream(makeProposal());
    expect(result.sampleCount).toBeGreaterThan(0);
    expect(result.confidence).toBe(0.7);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should return empty result with insufficient samples', async () => {
    dv.setBrainProvider(makeBrain({
      getDecisionSamples: () => Array(5).fill({ labelIntent: 0, fingerprint: 'code|medium|tools' }),
    }));
    const result = await dv.validateInDream(makeProposal());
    expect(result.sampleCount).toBe(0);
  });

  it('should batch validate multiple proposals', async () => {
    dv.setBrainProvider(makeBrain());
    const proposals = [makeProposal('L1'), makeProposal('L2'), makeProposal('L3')];
    const results = await dv.validateBatch(proposals);
    expect(results.size).toBe(3);
  });

  it('should track history', async () => {
    dv.setBrainProvider(makeBrain());
    await dv.validateInDream(makeProposal());
    await dv.validateInDream(makeProposal('L2'));

    const history = dv.getHistory();
    expect(history).toHaveLength(2);

    const summary = dv.getSummary();
    expect(summary.totalValidations).toBe(2);
  });

  it('should handle empty brain provider gracefully', async () => {
    dv.setBrainProvider(makeBrain({
      getClusterStats: () => null,
    }));
    const result = await dv.validateInDream(makeProposal());
    // Should still work with default 0.5 base rate
    expect(result.sampleCount).toBeGreaterThan(0);
  });
});
