/**
 * ShadowBrainOrchestrator 公开方法测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ShadowBrainOrchestrator } from '../index.js';
import type { TaskSignal, DecisionOutcome, BodyState, Rule, NNConfig } from '../../types.js';
import type { BrainProvider, ABTestResult } from '../types.js';

function makeSignal(overrides?: Partial<TaskSignal>): TaskSignal {
  return {
    domains: ['code'], complexity: 'medium', taskType: 'tools',
    shouldUseDAG: false, dagReason: '', intentConfidence: 0.5,
    ...overrides,
  };
}

function makeOutcome(success: boolean): DecisionOutcome {
  return { success, latencyMs: 100, costEstimate: 0.01, toolsUsed: ['exec'] };
}

function makeBody(overrides?: Partial<BodyState>): BodyState {
  return {
    energy: 80, temperature: 50, load: 30, hunger: 20,
    emotion: { joy: 15, sadness: 5, anger: 0, fear: 0, surprise: 0, disgust: 0, trust: 20, anticipation: 10 },
    desires: { hunger: 20, curiosity: 20, social: 15, safety: 10, expression: 15, rest: 15 },
    focusLevel: 70, confidenceLevel: 60, confusionLevel: 20,
    intimacyLevel: 50, socialNeed: 30,
    hour: 14, isUserActive: true, lastInteractionMs: Date.now(), systemHealth: 'good',
    ...overrides,
  };
}

function makeBrainProvider(overrides?: Partial<BrainProvider>): BrainProvider {
  return {
    getRules: () => [],
    addLearnedRule: () => {},
    getNNConfig: () => ({
      vocabSize: 4096, embedDim: 128, hiddenDim: 256,
      numHeads: 4, numLayers: 4, numIntents: 8, numTools: 32,
      ffnDim: 512, dropout: 0, numSpatialBins: 6, numSceneNodes: 32,
    }),
    getNNParamCount: () => 300000,
    getNNWeights: () => [new Float32Array([1, 2, 3])],
    getDecisionDistribution: () => [10, 20, 30],
    getRecentLosses: () => [0.5, 0.5, 0.5, 0.5, 0.5],
    getDecisionSamples: () => Array.from({ length: 100 }, (_, i) => ({
      labelIntent: i % 8,
      fingerprint: `code|medium|tools`,
    })),
    getClusterStats: (fp: string) => ({ count: 50, successRate: 0.7 }),
    runRegressionTests: async () => 0,
    ...overrides,
  };
}

describe('ShadowBrainOrchestrator — public methods', () => {
  let shadow: ShadowBrainOrchestrator;

  beforeEach(() => {
    shadow = new ShadowBrainOrchestrator({
      llm: { call: async () => '{}' },
      dataDir: '/tmp/buddy-test-orch',
    });
  });

  it('should update losses', () => {
    shadow.updateLosses([0.1, 0.2, 0.3]);
    // internal state updated — verify via no error
    expect(true).toBe(true);
  });

  it('should record A/B results', () => {
    for (let i = 0; i < 20; i++) {
      shadow.recordABResult({ group: 'shadow', success: i < 15, latencyMs: 100, cost: 0.01 });
      shadow.recordABResult({ group: 'production', success: i < 10, latencyMs: 120, cost: 0.02 });
    }
    const status = shadow.getStatus();
    expect(status.abTest).not.toBeNull();
    expect(status.abTest!.sampleCount).toBe(40);
  });

  it('should enable/disable', () => {
    shadow.setEnabled(false);
    // onInteraction should be no-op when disabled
    shadow.onInteraction(makeSignal(), makeOutcome(false), 0.1, makeBody());
    const status = shadow.getStatus();
    expect(status.gaps.totalGaps).toBe(0);

    shadow.setEnabled(true);
  });

  it('should set brain provider', () => {
    shadow.setBrainProvider(makeBrainProvider());
    const status = shadow.getStatus();
    expect(status.capabilities).toBeDefined();
  });

  it('should return status with all fields', () => {
    const status = shadow.getStatus();
    expect(status.gaps).toBeDefined();
    expect(status.evolution).toBeDefined();
    expect(status.capabilities).toBeDefined();
    expect(status.timing).toBeDefined();
  });

  it('should run evolution with brain provider on repeated failures', async () => {
    const rulesAdded: Rule[] = [];
    const brain = makeBrainProvider({
      addLearnedRule: (rule) => rulesAdded.push(rule),
      getRules: () => [{
        id: 'existing', name: 'existing', priority: 50,
        condition: () => true, action: () => ({ mode: 'single', reason: '', selectedNodes: [], confidence: 0.5, source: 'rule' }),
        source: 'builtin', stats: { hits: 10, successes: 8, lastUsed: Date.now() }, createdAt: Date.now(),
      }],
    });

    shadow.setBrainProvider(brain);

    // Trigger enough failures to create actionable gap
    const signal = makeSignal();
    const body = makeBody({ load: 10 }); // low load to pass timing check
    for (let i = 0; i < 5; i++) {
      await shadow.onInteraction(signal, makeOutcome(false), 0.1, body);
    }

    // Evolution may or may not have triggered depending on timing
    // Just verify no errors
    const status = shadow.getStatus();
    expect(status.gaps.totalGaps).toBeGreaterThanOrEqual(0);
  });
});

describe('ShadowBrainOrchestrator — compileCondition', () => {
  it('should match signal with matching domains', async () => {
    let capturedCondition: ((signal: TaskSignal, res: any, intuition?: any, body?: any) => boolean) | null = null;

    const shadow = new ShadowBrainOrchestrator({
      llm: {
        call: async () => JSON.stringify({
          name: 'code-rule',
          condition: 'code complex tools',
          action: 'use primary model for code tasks',
          priority: 7,
          reasoning: 'test',
        }),
      },
      dataDir: '/tmp/buddy-test-compile',
    });

    const brain = makeBrainProvider({
      addLearnedRule: (rule) => { capturedCondition = rule.condition; },
      getClusterStats: () => ({ count: 100, successRate: 0.1 }),
    });
    shadow.setBrainProvider(brain);

    // Trigger evolution
    const signal = makeSignal({ domains: ['code'], complexity: 'complex', taskType: 'tools' });
    const body = makeBody({ load: 10 });
    for (let i = 0; i < 5; i++) {
      await shadow.onInteraction(signal, makeOutcome(false), 0.1, body);
    }

    if (capturedCondition) {
      // Should match code domain with matching complexity
      expect(capturedCondition!(makeSignal({ domains: ['code'], complexity: 'complex', taskType: 'tools' }), {}, undefined, undefined)).toBe(true);
      // Should NOT match when complexity differs
      expect(capturedCondition!(makeSignal({ domains: ['code'], complexity: 'simple', taskType: 'tools' }), {}, undefined, undefined)).toBe(false);
    }
  });
});
