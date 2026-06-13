/**
 * EvolutionEngine 单元测试
 */

import { describe, it, expect } from 'vitest';
import { EvolutionEngine } from '../evolution-engine.js';
import type { CapabilityGap, EvolutionContext } from '../types.js';

function makeGap(overrides?: Partial<CapabilityGap>): CapabilityGap {
  return {
    id: 'gap-1',
    fingerprint: 'code|medium|tools',
    description: 'test gap: code complexity tasks',
    failures: [{ timestamp: Date.now(), error: 'exec failed', confidence: 0.1 }],
    firstDetectedAt: Date.now(),
    failureCount: 3,
    avgConfidence: 0.15,
    relatedSamples: 100,
    priority: 'medium',
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

describe('EvolutionEngine', () => {
  it('should generate L1 rule proposal', async () => {
    const mockLLM = {
      call: async () => JSON.stringify({
        name: 'test-rule',
        condition: 'when code is complex',
        action: 'use primary model',
        priority: 7,
        reasoning: 'fills the gap',
      }),
    };

    const engine = new EvolutionEngine(mockLLM);
    const proposals = await engine.generateProposals(makeGap(), makeContext());

    expect(proposals).toHaveLength(1);
    expect(proposals[0].level).toBe('L1');
    expect(proposals[0].type).toBe('new_rule');
    expect(proposals[0].changes[0].target).toBe('left');
  });

  it('should generate L1 + L2 for high failure count', async () => {
    let callCount = 0;
    const mockLLM = {
      call: async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            name: 'test-rule',
            condition: 'test',
            action: 'test',
            priority: 5,
            reasoning: 'test',
          });
        }
        return JSON.stringify({
          newIntents: [{ label: 'new-category', description: 'desc', estimatedSamples: 30 }],
          reasoning: 'need new category',
        });
      },
    };

    const engine = new EvolutionEngine(mockLLM);
    const ctx = makeContext();
    ctx.samples = Array.from({ length: 30 }, (_, i) => ({
      labelIntent: 10 + i,
      fingerprint: `sample-${i}`,
    }));

    const proposals = await engine.generateProposals(makeGap({ failureCount: 5, priority: 'high' }), ctx);
    expect(proposals.length).toBeGreaterThanOrEqual(2);
  });

  it('should handle LLM errors gracefully', async () => {
    const mockLLM = {
      call: async () => { throw new Error('LLM error'); },
    };

    const engine = new EvolutionEngine(mockLLM);
    const proposals = await engine.generateProposals(makeGap(), makeContext());
    expect(proposals).toHaveLength(0);
  });

  it('should handle invalid JSON from LLM', async () => {
    const mockLLM = {
      call: async () => 'this is not json at all',
    };

    const engine = new EvolutionEngine(mockLLM);
    const proposals = await engine.generateProposals(makeGap(), makeContext());
    expect(proposals).toHaveLength(0);
  });

  it('should track proposal history', async () => {
    const mockLLM = {
      call: async () => JSON.stringify({
        name: 'r', condition: 'c', action: 'a', priority: 5, reasoning: 'r',
      }),
    };

    const engine = new EvolutionEngine(mockLLM);
    await engine.generateProposals(makeGap(), makeContext());
    expect(engine.getHistory()).toHaveLength(1);
  });
});
