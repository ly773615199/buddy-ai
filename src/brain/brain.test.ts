import { describe, it, expect } from 'vitest';
import { ThreeBrain } from './brain.js';
import type { TaskSignal, ResourceState } from './types.js';

function makeSignal(overrides?: Partial<TaskSignal>): TaskSignal {
  return {
    domains: ['code'], complexity: 'medium', taskType: 'tools',
    shouldUseDAG: false, dagReason: '', intentConfidence: 0.8,
    ...overrides,
  };
}

function makeResources(overrides?: Partial<ResourceState>): ResourceState {
  return {
    budgetRemaining: 100, availableNodeCount: 3,
    localCoverageRatio: 0.5, localConfidence: 0.6,
    userCorrectionCount: 0, experienceHit: null,
    ...overrides,
  };
}

describe('ThreeBrain 集成', () => {
  it('初始化成功', () => {
    const brain = new ThreeBrain({ verbose: false });
    expect(brain.left).toBeDefined();
    expect(brain.right).toBeDefined();
    expect(brain.cerebellum).toBeDefined();
    brain.destroy();
  });

  it('decide 返回完整结果', async () => {
    const brain = new ThreeBrain({ verbose: false });
    const result = await brain.decide('帮我写代码', makeSignal(), makeResources());

    expect(result.plan).toBeDefined();
    expect(result.plan.mode).toBeDefined();
    expect(result.plan.selectedNodes.length).toBeGreaterThan(0);
    expect(result.bodyState).toBeDefined();
    expect(result.bodyState.energy).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.homeostasisActions)).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    brain.destroy();
  });

  it('直觉信号可能命中', async () => {
    const brain = new ThreeBrain({ verbose: false });
    const result = await brain.decide('简单问候', makeSignal({ domains: ['conversation'], complexity: 'simple' }), makeResources());

    // 直觉信号应该存在
    expect(result.intuition).toBeDefined();

    brain.destroy();
  });

  it('feedback 不抛错', async () => {
    const brain = new ThreeBrain({ verbose: false });
    const signal = makeSignal();
    const resources = makeResources();
    const result = await brain.decide('test', signal, resources);

    await brain.feedback(signal, resources, result.plan, {
      success: true, latencyMs: 100, costEstimate: 0, toolsUsed: ['read_file'],
    }, 'file_operations', ['read_file']);

    brain.destroy();
  });

  it('heartbeat 触发小脑衰减', () => {
    const brain = new ThreeBrain({ verbose: false });
    const bodyBefore = brain.cerebellum.getBodyState();

    brain.heartbeat();

    const bodyAfter = brain.cerebellum.getBodyState();
    // heartbeat 应该导致能量下降
    expect(bodyAfter.energy).toBeLessThanOrEqual(bodyBefore.energy);

    brain.destroy();
  });

  it('getStatus 返回三脑状态', async () => {
    const brain = new ThreeBrain({ verbose: false });
    await brain.decide('test', makeSignal(), makeResources());

    const status = brain.getStatus();
    expect(status.left).toBeDefined();
    expect(status.right).toBeDefined();
    expect(status.body).toBeDefined();
    expect(status.left.totalDecisions).toBeGreaterThanOrEqual(0);

    brain.destroy();
  });

  it('小脑感知融合集成', () => {
    const brain = new ThreeBrain({ verbose: false });

    // 注入感知数据
    brain.cerebellum.ingestPerception('user', 'hello', ['greeting']);
    brain.cerebellum.sensorFusion.flush();

    const fusionStatus = brain.cerebellum.sensorFusion.getStatus();
    expect(fusionStatus.totalIngested).toBe(1);

    brain.destroy();
  });

  it('多次决策保持一致性', async () => {
    const brain = new ThreeBrain({ verbose: false });
    const signal = makeSignal();
    const resources = makeResources();

    const r1 = await brain.decide('test1', signal, resources);
    const r2 = await brain.decide('test2', signal, resources);

    // 两次决策应该返回相同模式（相同输入信号）
    expect(r1.plan.mode).toBe(r2.plan.mode);

    brain.destroy();
  });
});
