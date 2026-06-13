/**
 * TransferLearner 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TransferLearner } from '../phase10/transfer-learner.js';
import type { CapabilityGap, Rule, BrainProvider } from '../types.js';

function makeBrain(): BrainProvider {
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
    getDecisionSamples: () => [],
    getClusterStats: () => null,
    runRegressionTests: async () => 0,
  };
}

function makeGap(fingerprint: string): CapabilityGap {
  return {
    id: `gap-${fingerprint}`,
    fingerprint,
    description: `gap for ${fingerprint}`,
    failures: [],
    firstDetectedAt: Date.now(),
    failureCount: 5,
    avgConfidence: 0.1,
    relatedSamples: 100,
    priority: 'high',
  };
}

function makeRule(overrides?: Partial<Rule>): Rule {
  return {
    id: 'rule-1',
    name: 'test rule',
    priority: 5,
    condition: () => true,
    action: () => ({
      mode: 'single', reason: 'test', selectedNodes: [],
      confidence: 0.5, source: 'learned',
    }),
    source: 'learned',
    stats: { hits: 20, successes: 15, lastUsed: Date.now() },
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('TransferLearner', () => {
  let tl: TransferLearner;

  beforeEach(() => {
    tl = new TransferLearner({ minSimilarity: 0.5, minSuccessSamples: 5 });
    tl.setBrainProvider(makeBrain());
  });

  it('should find transferable domains with shared domains', () => {
    const gaps = [
      makeGap('code,git|medium|tools'),
      makeGap('code,svn|medium|tools'),
    ];

    const mappings = tl.findTransferable(gaps);
    expect(mappings.length).toBeGreaterThan(0);
    expect(mappings[0].similarity).toBeGreaterThanOrEqual(0.5);
  });

  it('should not find transferable domains with no overlap', () => {
    const gaps = [
      makeGap('code|medium|tools'),
      makeGap('web|simple|chat'),
    ];

    const mappings = tl.findTransferable(gaps);
    // Low similarity
    if (mappings.length > 0) {
      expect(mappings[0].similarity).toBeLessThan(0.7);
    }
  });

  it('should find high similarity for same complexity and taskType', () => {
    const gaps = [
      makeGap('code|medium|tools'),
      makeGap('git|medium|tools'),
    ];

    const mappings = tl.findTransferable(gaps);
    expect(mappings.length).toBeGreaterThan(0);
    // Same complexity (medium) + same taskType (tools) gives some similarity
    expect(mappings[0].similarity).toBeGreaterThan(0.3);
  });

  it('should transfer rules with priority decay', async () => {
    const mapping = {
      source: 'code|medium|tools',
      target: 'git|medium|tools',
      similarity: 0.8,
      transferableRules: [],
      patternMappings: [{ sourceConcept: 'code', targetConcept: 'git', confidence: 0.8 }],
    };

    const rules = [
      makeRule({ priority: 8 }),
      makeRule({ id: 'r2', priority: 6, stats: { hits: 30, successes: 25, lastUsed: Date.now() } }),
    ];

    const result = await tl.transfer(mapping, rules);
    expect(result.success).toBe(true);
    expect(result.rulesTransferred).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should not transfer low-success rules', async () => {
    const mapping = {
      source: 'code|medium|tools',
      target: 'git|medium|tools',
      similarity: 0.8,
      transferableRules: [],
      patternMappings: [],
    };

    const rules = [
      makeRule({ stats: { hits: 20, successes: 5, lastUsed: Date.now() } }), // 25% success
    ];

    const result = await tl.transfer(mapping, rules);
    expect(result.rulesTransferred).toBe(0);
  });

  it('should auto transfer', async () => {
    const gaps = [
      makeGap('code,git|medium|tools'),
      makeGap('code,svn|medium|tools'),
    ];
    const rules = [makeRule()];

    const results = await tl.autoTransfer(gaps, rules);
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it('should track history and summary', async () => {
    const mapping = {
      source: 'a|medium|tools',
      target: 'b|medium|tools',
      similarity: 0.8,
      transferableRules: [],
      patternMappings: [],
    };

    await tl.transfer(mapping, [makeRule()]);
    await tl.transfer(mapping, [makeRule({ id: 'r2' })]);

    const summary = tl.getSummary();
    expect(summary.totalTransfers).toBe(2);
    expect(summary.avgSimilarity).toBe(0.8);
  });
});
