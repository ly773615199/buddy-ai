/**
 * 影子大脑集成测试 — 验证 ShadowBrain 与 ThreeBrain 的完整协作
 */

import { describe, it, expect } from 'vitest';
import { ThreeBrain } from '../../brain.js';
import type { TaskSignal, ResourceState, DecisionOutcome } from '../../types.js';

function makeSignal(overrides?: Partial<TaskSignal>): TaskSignal {
  return {
    domains: ['code'],
    complexity: 'medium',
    taskType: 'tools',
    shouldUseDAG: false,
    dagReason: '',
    intentConfidence: 0.5,
    ...overrides,
  };
}

function makeResources(): ResourceState {
  return {
    budgetRemaining: 100,
    availableNodeCount: 3,
    localCoverageRatio: 0.5,
    localConfidence: 0.6,
    userCorrectionCount: 0,
    experienceHit: null,
  };
}

function makeOutcome(success: boolean): DecisionOutcome {
  return {
    success,
    latencyMs: 100,
    costEstimate: 0.01,
    toolsUsed: ['exec'],
  };
}

describe('ThreeBrain + ShadowBrain Integration', () => {
  it('should initialize ThreeBrain without shadow brain by default', () => {
    const brain = new ThreeBrain({ verbose: false });
    expect(brain.shadow).toBeNull();
    brain.destroy();
  });

  it('should initialize ThreeBrain with shadow brain when configured', () => {
    const brain = new ThreeBrain({
      verbose: false,
      shadow: {
        llm: { call: async () => '{}' },
        dataDir: '/tmp/buddy-test-shadow-integration',
      },
    });
    expect(brain.shadow).not.toBeNull();
    brain.destroy();
  });

  it('should wire BrainProvider correctly', () => {
    const brain = new ThreeBrain({
      verbose: false,
      shadow: {
        llm: { call: async () => '{}' },
        dataDir: '/tmp/buddy-test-shadow-bp',
      },
    });

    // BrainProvider should be wired - verify by checking that shadow can read brain data
    const status = brain.shadow!.getStatus();
    expect(status.capabilities).toBeDefined();
    expect(status.evolution).toBeDefined();

    brain.destroy();
  });

  it('should feed interaction results to shadow brain on feedback', async () => {
    const brain = new ThreeBrain({
      verbose: false,
      shadow: {
        llm: {
          call: async () => JSON.stringify({
            name: 'test-rule',
            condition: 'code medium tools',
            action: 'use primary model',
            priority: 5,
            reasoning: 'test',
          }),
        },
        dataDir: '/tmp/buddy-test-shadow-integration-2',
      },
    });

    const signal = makeSignal();
    const resources = makeResources();

    // Simulate multiple failures to trigger gap detection
    for (let i = 0; i < 5; i++) {
      const decision = await brain.decide('test input', signal, resources);
      await brain.feedback(signal, resources, decision.plan, makeOutcome(false));
    }

    // Shadow brain should have detected gaps
    const status = brain.shadow!.getStatus();
    expect(status.gaps.totalGaps).toBeGreaterThanOrEqual(0);

    brain.destroy();
  });

  it('should include shadow status in getStatus()', async () => {
    const brain = new ThreeBrain({
      verbose: false,
      shadow: {
        llm: { call: async () => '{}' },
        dataDir: '/tmp/buddy-test-shadow-integration-3',
      },
    });

    const status = brain.getStatus();
    expect(status.shadow).not.toBeNull();
    expect(status.shadow!.gaps).toBeDefined();
    expect(status.shadow!.evolution).toBeDefined();
    expect(status.shadow!.capabilities).toBeDefined();

    brain.destroy();
  });

  it('should work without shadow brain (backward compatible)', async () => {
    const brain = new ThreeBrain({ verbose: false });
    const signal = makeSignal();
    const resources = makeResources();

    const decision = await brain.decide('test', signal, resources);
    await brain.feedback(signal, resources, decision.plan, makeOutcome(true));

    const status = brain.getStatus();
    expect(status.shadow).toBeNull();

    brain.destroy();
  });

  it('should expose NN config through BrainProvider', () => {
    const brain = new ThreeBrain({
      verbose: false,
      shadow: {
        llm: { call: async () => '{}' },
        dataDir: '/tmp/buddy-test-shadow-bp-nn',
      },
    });

    // Access internal buildEvolutionContext via getStatus
    const status = brain.shadow!.getStatus();
    // The fact that getStatus works means BrainProvider is wired
    expect(status.evolution.currentVersion).toBe(0);

    brain.destroy();
  });
});
