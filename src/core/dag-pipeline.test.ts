/**
 * dag-pipeline.ts — resolveDAGPipeline 单元测试
 *
 * 覆盖 4 步管线 + 各步失败/拦截路径
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveDAGPipeline, type DAGPipelineResult } from './dag-pipeline.js';
import type { TaskSignal, ResourceState } from './agent-types.js';
import type { Subsystems } from './subsystems.js';
import type { DAGSkeleton, GateResult, ResolveResult } from '../orchestrate/types.js';

// ── Helpers ──

function makeSignal(): TaskSignal {
  return {
    domains: ['code'],
    complexity: 'medium',
    taskType: 'tools',
    shouldUseDAG: true,
    dagReason: '',
    intentConfidence: 0.8,
  };
}

function makeResources(): ResourceState {
  return {
    budgetRemaining: 100,
    availableNodeCount: 3,
    localCoverageRatio: 0,
    localConfidence: 0,
    userCorrectionCount: 0,
    experienceHit: null,
  };
}

const validSkeleton: DAGSkeleton = {
  id: 'skel-1',
  description: 'test',
  steps: [
    { id: 's1', name: 'Step 1', intent: 'do something', deps: [] },
  ],
  edges: [],
  parallelGroups: [],
  complexity: 'medium',
  detectedDomains: ['code'],
};

const validResolved: ResolveResult = {
  dag: { id: 'dag-1', tasks: [], edges: [] } as any,
  resolutionLog: [{ stepId: 's1', stepName: 'Step 1', resolvedTool: 'exec', source: 'builtin', confidence: 0.9 }],
  unresolvedSteps: [],
};

function passedGate(): GateResult {
  return { passed: true, violations: [], action: 'proceed' };
}

function blockedGate(action?: string): GateResult {
  return {
    passed: false,
    action: 'replan',
    violations: [{
      rule: 'test-rule',
      severity: 'block',
      description: 'blocked by test',
      action: action as any,
    }],
  };
}

function warnGate(): GateResult {
  return {
    passed: true,
    action: 'proceed',
    violations: [{
      rule: 'warn-rule',
      severity: 'warn',
      description: 'warning only',
    }],
  };
}

/** 构造最小 mock Subsystems */
function mockSys(overrides: Record<string, any> = {}): Subsystems {
  return {
    dagPlanner: {
      planSkeleton: vi.fn().mockResolvedValue(validSkeleton),
    },
    threeBrain: {
      left: {
        getRuleEngine: () => ({
          validateDAGSkeleton: vi.fn().mockReturnValue(passedGate()),
          validateResolvedDAG: vi.fn().mockReturnValue(passedGate()),
        }),
      },
    },
    skillResolver: {
      resolve: vi.fn().mockResolvedValue(validResolved),
    },
    tools: { list: () => [] },
    ...overrides,
  } as unknown as Subsystems;
}

// ==================== 成功路径 ====================

describe('成功路径', () => {
  it('4 步全部通过 → 返回 resolvedDAG', async () => {
    const sys = mockSys();
    const result = await resolveDAGPipeline(sys, 'test', makeSignal(), makeResources(), false);

    expect(result.resolvedDAG).toBe(validResolved.dag);
    expect(result.dagSkeleton).toBe(validSkeleton);
    expect(result.reason).toBe('DAG 管线完成');
  });

  it('无 ruleEngine 时跳过 Gate-1/Gate-2，仍能成功', async () => {
    const sys = mockSys({
      threeBrain: { left: { getRuleEngine: () => null } },
    });
    const result = await resolveDAGPipeline(sys, 'test', makeSignal(), makeResources(), false);

    expect(result.resolvedDAG).toBe(validResolved.dag);
    expect(result.reason).toBe('DAG 管线完成');
  });
});

// ==================== Step 1 失败 ====================

describe('Step 1: planSkeleton 失败', () => {
  it('planSkeleton 抛错 → 返回 null + 错误原因', async () => {
    const sys = mockSys({
      dagPlanner: {
        planSkeleton: vi.fn().mockRejectedValue(new Error('LLM 超时')),
      },
    });

    const result = await resolveDAGPipeline(sys, 'test', makeSignal(), makeResources(), false);

    expect(result.resolvedDAG).toBeNull();
    expect(result.dagSkeleton).toBeNull();
    expect(result.reason).toContain('骨架生成失败');
    expect(result.reason).toContain('LLM 超时');
  });
});

// ==================== Step 2: Gate-1 拦截 ====================

describe('Step 2: Gate-1 拦截', () => {
  it('Gate-1 block + downgrade_to_single → 返回 null + 降级原因', async () => {
    const sys = mockSys({
      threeBrain: {
        left: {
          getRuleEngine: () => ({
            validateDAGSkeleton: vi.fn().mockReturnValue(blockedGate('downgrade_to_single')),
            validateResolvedDAG: vi.fn().mockReturnValue(passedGate()),
          }),
        },
      },
    });

    const result = await resolveDAGPipeline(sys, 'test', makeSignal(), makeResources(), false);

    expect(result.resolvedDAG).toBeNull();
    expect(result.dagSkeleton).toBe(validSkeleton);
    expect(result.reason).toContain('Gate-1 拦截');
    expect(result.reason).toContain('降级 single');
  });

  it('Gate-1 block 无 downgrade action → 返回 null', async () => {
    const sys = mockSys({
      threeBrain: {
        left: {
          getRuleEngine: () => ({
            validateDAGSkeleton: vi.fn().mockReturnValue(blockedGate()),
            validateResolvedDAG: vi.fn().mockReturnValue(passedGate()),
          }),
        },
      },
    });

    const result = await resolveDAGPipeline(sys, 'test', makeSignal(), makeResources(), false);

    expect(result.resolvedDAG).toBeNull();
    expect(result.reason).toContain('Gate-1 拦截');
  });

  it('Gate-1 有 warn 但 passed → 继续后续步骤', async () => {
    const sys = mockSys({
      threeBrain: {
        left: {
          getRuleEngine: () => ({
            validateDAGSkeleton: vi.fn().mockReturnValue(warnGate()),
            validateResolvedDAG: vi.fn().mockReturnValue(passedGate()),
          }),
        },
      },
    });

    const result = await resolveDAGPipeline(sys, 'test', makeSignal(), makeResources(), false);

    expect(result.resolvedDAG).toBe(validResolved.dag);
    expect(result.reason).toBe('DAG 管线完成');
  });
});

// ==================== Step 3: SkillResolver 失败 ====================

describe('Step 3: SkillResolver 失败', () => {
  it('resolve 抛错 → 返回 skeleton + 错误原因', async () => {
    const sys = mockSys({
      skillResolver: {
        resolve: vi.fn().mockRejectedValue(new Error('工具匹配失败')),
      },
    });

    const result = await resolveDAGPipeline(sys, 'test', makeSignal(), makeResources(), false);

    expect(result.resolvedDAG).toBeNull();
    expect(result.dagSkeleton).toBe(validSkeleton);
    expect(result.reason).toContain('SkillResolver 失败');
    expect(result.reason).toContain('工具匹配失败');
  });
});

// ==================== Step 4: Gate-2 拦截 ====================

describe('Step 4: Gate-2 拦截', () => {
  it('Gate-2 block → 返回 null + 拦截原因', async () => {
    const sys = mockSys({
      threeBrain: {
        left: {
          getRuleEngine: () => ({
            validateDAGSkeleton: vi.fn().mockReturnValue(passedGate()),
            validateResolvedDAG: vi.fn().mockReturnValue(blockedGate()),
          }),
        },
      },
    });

    const result = await resolveDAGPipeline(sys, 'test', makeSignal(), makeResources(), false);

    expect(result.resolvedDAG).toBeNull();
    expect(result.dagSkeleton).toBe(validSkeleton);
    expect(result.reason).toContain('Gate-2 拦截');
  });

  it('Gate-2 有 warn 但 passed → 成功', async () => {
    const sys = mockSys({
      threeBrain: {
        left: {
          getRuleEngine: () => ({
            validateDAGSkeleton: vi.fn().mockReturnValue(passedGate()),
            validateResolvedDAG: vi.fn().mockReturnValue(warnGate()),
          }),
        },
      },
    });

    const result = await resolveDAGPipeline(sys, 'test', makeSignal(), makeResources(), false);

    expect(result.resolvedDAG).toBe(validResolved.dag);
  });
});

// ==================== V2: 多级降级策略测试 ====================

describe('V2: 多级降级策略', () => {
  it('Step 3.5 未匹配步骤触发降级', async () => {
    // 构造一个 resourceSystem 但 skillResolver 不匹配任何步骤
    const hub = new (await import('../brain/hub/unified-resource-hub.js')).UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'gpt' });
    hub.markState('m1', 'active');

    const mockSys = {
      dagPlanner: {
        planSkeleton: vi.fn().mockResolvedValue({
          id: 'skel-1', description: 'test',
          steps: [{ id: 's1', name: 'do', intent: 'do something', deps: [] }],
          edges: [], parallelGroups: [], complexity: 'simple', detectedDomains: [],
        }),
      },
      threeBrain: { left: { getRuleEngine: () => null } },
      skillResolver: {
        resolve: vi.fn().mockResolvedValue({
          dag: {
            id: 'dag-1',
            tasks: new Map([['s1', { id: 's1', name: 'do', tool: 'exec', args: {}, deps: [], status: 'pending' }]]),
            edges: [], parallelGroups: [], createdAt: Date.now(), status: 'executing', defaultTimeoutMs: 30000,
          },
          resolutionLog: [{ stepId: 's1', stepName: 'do', resolvedTool: 'exec', source: 'builtin', confidence: 0.5 }],
          unresolvedSteps: [],
        }),
        setResourceHub: vi.fn(),
        matchExecutors: vi.fn().mockReturnValue(new Map()), // 不匹配任何步骤
      },
      resourceSystem: { hub },
      waitForResourceSystem: vi.fn().mockResolvedValue(true),
      tools: { list: () => [] },
    } as any;

    const result = await resolveDAGPipeline(mockSys, 'test', makeSignal(), makeResources(), false);

    // 应有 executorMatches（降级匹配到 m1）
    expect(result.executorMatches).toBeDefined();
    expect(result.executorMatches!.size).toBeGreaterThan(0);
    // 降级来源应为 fallback
    const firstMatch = [...result.executorMatches!.values()][0];
    expect(firstMatch.source).toBe('fallback');
  });
});
