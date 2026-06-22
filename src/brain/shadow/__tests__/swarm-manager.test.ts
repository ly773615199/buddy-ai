/**
 * SwarmManager 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SwarmManager } from '../phase10/swarm-manager.js';
import { EvolutionEngine } from '../evolution-engine.js';
import { EvolutionLock } from '../evolution-lock.js';
import type { CapabilityGap, EvolutionContext, BrainProvider } from '../types.js';

function makeGap(overrides?: Partial<CapabilityGap>): CapabilityGap {
  return {
    id: 'gap-1',
    fingerprint: 'code|medium|tools',
    description: 'test gap',
    failures: [],
    firstDetectedAt: Date.now(),
    failureCount: 5,
    avgConfidence: 0.1,
    relatedSamples: 100,
    priority: 'high',
    ...overrides,
  };
}

function makeContext(): EvolutionContext {
  return {
    existingRules: [],
    currentIntentCount: 8,
    nnConfig: {
      vocabSize: 4096, embedDim: 128, hiddenDim: 256,
      numHeads: 4, numLayers: 4, numIntents: 8, numTools: 32,
      ffnDim: 512, dropout: 0, numSpatialBins: 6, numSceneNodes: 32,
    },
    samples: [],
  };
}

describe('SwarmManager', () => {
  let swarm: SwarmManager;
  let engine: EvolutionEngine;
  let lock: EvolutionLock;

  beforeEach(() => {
    engine = new EvolutionEngine({ call: async () => '{"name":"test","condition":"code","action":"use exec","priority":5,"reasoning":"test"}' });
    lock = new EvolutionLock();
    swarm = new SwarmManager(engine, lock, { maxParallel: 2, abTestRounds: 10 });
  });

  it('should return null best when no proposals generated', async () => {
    const emptyEngine = new EvolutionEngine({ call: async () => { throw new Error('fail'); } });
    const emptySwarm = new SwarmManager(emptyEngine, lock, { maxParallel: 2 });

    const result = await emptySwarm.explore(makeGap(), makeContext());
    expect(result.bestProposal).toBeNull();
    expect(result.results).toHaveLength(0);
    expect(result.reason).toContain('无有效');
  });

  it('should track active swarms', async () => {
    // Set up brain provider
    const mockBrain: BrainProvider = {
      getRules: () => [],
      addLearnedRule: () => {},
      getNNConfig: () => makeContext().nnConfig,
      getNNParamCount: () => 1000,
      getNNWeights: () => [],
      getDecisionDistribution: () => Array(8).fill(0.125),
      getRecentLosses: () => [0.1],
      getDecisionSamples: () => [],
      getClusterStats: () => ({ count: 100, successRate: 0.8 }),
      runRegressionTests: async () => 0,
    };
    swarm.setBrainProvider(mockBrain);

    // The explore should complete without error
    const result = await swarm.explore(makeGap(), makeContext());
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should calculate similarity correctly', () => {
    const a = { level: 'L1', type: 'new_rule', description: 'test rule', changes: [{ target: 'left' }] } as any;
    const b = { level: 'L1', type: 'new_rule', description: 'test rule', changes: [{ target: 'left' }] } as any;
    const c = { level: 'L2', type: 'new_intent', description: 'different thing', changes: [{ target: 'right' }] } as any;

    // Same proposals should have high similarity
    const simAB = swarm['calcSimilarity'](a, b);
    expect(simAB).toBeGreaterThan(0.5);

    // Different proposals should have low similarity
    const simAC = swarm['calcSimilarity'](a, c);
    expect(simAC).toBeLessThan(simAB);
  });

  it('should ensure diversity in proposals', () => {
    const proposals = [
      { level: 'L1', type: 'new_rule', description: 'rule A', changes: [{ target: 'left' }] },
      { level: 'L1', type: 'new_rule', description: 'rule B', changes: [{ target: 'left' }] },
      { level: 'L2', type: 'new_intent', description: 'intent C', changes: [{ target: 'right' }] },
    ] as any[];

    const diverse = swarm['ensureDiversity'](proposals);
    // Should keep at least the first and the different one
    expect(diverse.length).toBeGreaterThanOrEqual(2);
    expect(diverse.some(p => p.level === 'L2')).toBe(true);
  });

  it('should select best by score', () => {
    const candidates = [
      { proposal: { id: 'a' } as any, offlineResults: [], replayResults: null, offlineScore: 0, replayScore: null, lockResult: { passed: true } as any, score: 0.3, rank: 0 },
      { proposal: { id: 'b' } as any, offlineResults: [], replayResults: null, offlineScore: 0, replayScore: null, lockResult: { passed: true } as any, score: 0.8, rank: 0 },
      { proposal: { id: 'c' } as any, offlineResults: [], replayResults: null, offlineScore: 0, replayScore: null, lockResult: { passed: true } as any, score: 0.5, rank: 0 },
    ];

    const best = swarm['selectBest'](candidates);
    expect(best!.proposal.id).toBe('b');
  });

  it('should exclude failed lock results from best selection', () => {
    const candidates = [
      { proposal: { id: 'a' } as any, offlineResults: [], replayResults: null, offlineScore: 0, replayScore: null, lockResult: { passed: false } as any, score: 0.9, rank: 0 },
      { proposal: { id: 'b' } as any, offlineResults: [], replayResults: null, offlineScore: 0, replayScore: null, lockResult: { passed: true } as any, score: 0.5, rank: 0 },
    ];

    const best = swarm['selectBest'](candidates);
    expect(best!.proposal.id).toBe('b');
  });

  it('should return null when all candidates fail lock', () => {
    const candidates = [
      { proposal: { id: 'a' } as any, offlineResults: [], replayResults: null, offlineScore: 0, replayScore: null, lockResult: { passed: false } as any, score: 0.9, rank: 0 },
    ];

    const best = swarm['selectBest'](candidates);
    expect(best).toBeNull();
  });

  it('should calculate A/B test score correctly', () => {
    const results = [
      ...Array(60).fill(null).map(() => ({ group: 'shadow' as const, success: true, latencyMs: 50, cost: 0 })),
      ...Array(40).fill(null).map(() => ({ group: 'shadow' as const, success: false, latencyMs: 50, cost: 0 })),
      ...Array(50).fill(null).map(() => ({ group: 'production' as const, success: true, latencyMs: 80, cost: 0 })),
      ...Array(50).fill(null).map(() => ({ group: 'production' as const, success: false, latencyMs: 80, cost: 0 })),
    ];

    const score = swarm['calcScore'](results);
    // shadow success=0.6, prod success=0.5, improvement=0.1
    // shadow latency=50, prod latency=80, improvement=0.375
    // score = 0.1 * 0.7 + 0.375 * 0.3 = 0.07 + 0.1125 = 0.1825
    expect(score).toBeCloseTo(0.1825, 2);
  });

  it('should handle ensemble selection strategy', async () => {
    const ensembleSwarm = new SwarmManager(engine, lock, {
      maxParallel: 3,
      mergeStrategy: 'ensemble',
      abTestRounds: 10,
    });

    // Verify ensemble strategy exists in config
    expect(ensembleSwarm['config'].mergeStrategy).toBe('ensemble');
  });

  it('should handle vote selection strategy', async () => {
    const voteSwarm = new SwarmManager(engine, lock, {
      maxParallel: 3,
      mergeStrategy: 'vote',
      abTestRounds: 10,
    });

    expect(voteSwarm['config'].mergeStrategy).toBe('vote');
  });
});
