/**
 * orchestrator.ts — decideCollaboration 单元测试
 *
 * 覆盖 8 条决策规则 + 边界条件
 */
import { describe, it, expect } from 'vitest';
import { decideCollaboration } from './orchestrator.js';
import type { TaskSignal, ResourceState } from './agent-types.js';
import type { Subsystems } from './subsystems.js';

// ── Mock helpers ──

function makeSignal(overrides: Partial<TaskSignal> = {}): TaskSignal {
  return {
    domains: ['code'],
    complexity: 'medium',
    taskType: 'tools',
    shouldUseDAG: false,
    dagReason: '',
    intentConfidence: 0.8,
    ...overrides,
  };
}

function makeResources(overrides: Partial<ResourceState> = {}): ResourceState {
  return {
    budgetRemaining: 100,
    availableNodeCount: 3,
    localCoverageRatio: 0,
    localConfidence: 0,
    userCorrectionCount: 0,
    experienceHit: null,
    ...overrides,
  };
}

/** 最小 mock Subsystems — 只需满足 pickLocalExperts / pickMultiExperts 不崩 */
function mockSys(overrides: Record<string, any> = {}): Subsystems {
  return {
    tools: {
      list: () => [],
      listForPermissions: () => [],
    },
    threeBrain: {
      left: {
        getLocalExperts: () => [],
        getMultiExperts: () => [],
      },
    },
    ternaryRouter: {
      listExperts: () => [],
      selectDomain: () => null,
    },
    router: {
      getPool: () => ({
        getAllProfiles: () => [],
      }),
    },
    ...overrides,
  } as unknown as Subsystems;
}

// ── 规则 0: 经验路由命中 ──

describe('规则 0: 经验路由', () => {
  it('exp_direct → local_only', () => {
    const signal = makeSignal();
    const resources = makeResources({
      experienceHit: {
        path: 'exp_direct',
        skill: { id: 'skill-a' } as any,
        confidence: 0.9,
        novelty: 0.1,
      },
    });

    const result = decideCollaboration(mockSys(), signal, resources);

    expect(result.mode).toBe('local_only');
    expect(result.reason).toContain('经验路由');
    expect(result.reason).toContain('exp_direct');
    expect(result.selectedNodes).toHaveLength(1);
    expect(result.selectedNodes[0].type).toBe('experience');
    expect(result.selectedNodes[0].skillId).toBe('skill-a');
  });

  it('exp_verified → cascade', () => {
    const signal = makeSignal();
    const resources = makeResources({
      experienceHit: {
        path: 'exp_verified',
        skill: { id: 'skill-b' } as any,
        confidence: 0.75,
        novelty: 0.3,
      },
    });

    const result = decideCollaboration(mockSys(), signal, resources);

    expect(result.mode).toBe('cascade');
    expect(result.reason).toContain('exp_verified');
    expect(result.selectedNodes[0].routePath).toBe('exp_verified');
  });
});

// ── 规则 0b: 经验 hint ──

describe('规则 0b: 经验 hint', () => {
  it('llm_with_hint → single', () => {
    const signal = makeSignal();
    const resources = makeResources({
      experienceHit: {
        path: 'llm_with_hint',
        skill: { id: 'skill-c' } as any,
        novelty: 0.5,
      },
    });

    const result = decideCollaboration(mockSys(), signal, resources);

    expect(result.mode).toBe('single');
    expect(result.reason).toContain('经验 hint');
    expect(result.selectedNodes[0].skillId).toBe('skill-c');
    expect(result.selectedNodes[0].routePath).toBe('llm_with_hint');
  });
});

// ── 规则 1: 预算耗尽 ──

describe('规则 1: 预算耗尽', () => {
  it('budgetRemaining <= 0 → local_only', () => {
    const signal = makeSignal({ domains: ['math'] });
    const resources = makeResources({ budgetRemaining: 0 });

    const result = decideCollaboration(mockSys(), signal, resources);

    expect(result.mode).toBe('local_only');
    expect(result.reason).toContain('预算耗尽');
  });

  it('budgetRemaining < 0 → local_only', () => {
    const signal = makeSignal();
    const resources = makeResources({ budgetRemaining: -5 });

    const result = decideCollaboration(mockSys(), signal, resources);

    expect(result.mode).toBe('local_only');
  });
});

// ── 规则 2: 用户连续纠正 ──

describe('规则 2: 用户连续纠正', () => {
  it('userCorrectionCount >= 3 → local_only', () => {
    const signal = makeSignal();
    const resources = makeResources({ userCorrectionCount: 3 });

    const result = decideCollaboration(mockSys(), signal, resources);

    expect(result.mode).toBe('local_only');
    expect(result.reason).toContain('用户纠正');
    expect(result.reason).toContain('3');
  });

  it('userCorrectionCount > 3 → local_only', () => {
    const signal = makeSignal();
    const resources = makeResources({ userCorrectionCount: 5 });

    const result = decideCollaboration(mockSys(), signal, resources);

    expect(result.mode).toBe('local_only');
  });
});

// ── 规则 3: 本地完全覆盖 + 置信度高 ──

describe('规则 3: 本地完全覆盖', () => {
  it('coverage=1 + confidence>=0.7 → local_only', () => {
    const signal = makeSignal({ domains: ['code', 'math'] });
    const resources = makeResources({
      localCoverageRatio: 1,
      localConfidence: 0.8,
    });

    const result = decideCollaboration(mockSys(), signal, resources);

    expect(result.mode).toBe('local_only');
    expect(result.reason).toContain('本地完全覆盖');
  });

  it('coverage=1 + confidence=0.7 → local_only (边界)', () => {
    const signal = makeSignal({ domains: ['code'] });
    const resources = makeResources({
      localCoverageRatio: 1,
      localConfidence: 0.7,
    });

    const result = decideCollaboration(mockSys(), signal, resources);

    expect(result.mode).toBe('local_only');
  });

  it('coverage=1 + confidence<0.7 → 不命中此规则', () => {
    const signal = makeSignal({ domains: ['code'] });
    const resources = makeResources({
      localCoverageRatio: 1,
      localConfidence: 0.69,
      budgetRemaining: 100,
      userCorrectionCount: 0,
    });

    const result = decideCollaboration(mockSys(), signal, resources);

    // 不应命中规则 3，而是继续往下匹配
    expect(result.mode).not.toBe('local_only');
  });

  it('domains 为空 → 不命中此规则', () => {
    const signal = makeSignal({ domains: [] });
    const resources = makeResources({
      localCoverageRatio: 1,
      localConfidence: 0.9,
    });

    const result = decideCollaboration(mockSys(), signal, resources);

    // domains.length === 0 会命中规则 4
    expect(result.mode).toBe('single');
  });
});

// ── 规则 4: 无领域 / 简单任务 ──

describe('规则 4: 无领域 / 简单任务', () => {
  it('无领域 → single', () => {
    const signal = makeSignal({ domains: [] });
    const resources = makeResources();

    const result = decideCollaboration(mockSys(), signal, resources);

    expect(result.mode).toBe('single');
    expect(result.reason).toContain('无明确领域');
  });

  it('简单任务 → single', () => {
    const signal = makeSignal({ complexity: 'simple', domains: ['code'] });
    const resources = makeResources();

    const result = decideCollaboration(mockSys(), signal, resources);

    expect(result.mode).toBe('single');
    expect(result.reason).toContain('简单任务');
  });
});

// ── 规则 5: 多领域 + 节点充足 ──

describe('规则 5: 多领域并行', () => {
  it('2+ 领域 + 复杂非 simple + 节点>=2 → parallel', () => {
    const signal = makeSignal({
      domains: ['code', 'math'],
      complexity: 'complex',
    });
    const resources = makeResources({ availableNodeCount: 3 });

    const result = decideCollaboration(mockSys(), signal, resources);

    expect(result.mode).toBe('parallel');
    expect(result.reason).toContain('多领域');
  });

  it('simple 复杂度 → 不命中此规则', () => {
    const signal = makeSignal({
      domains: ['code', 'math'],
      complexity: 'simple',
    });
    const resources = makeResources({ availableNodeCount: 3 });

    const result = decideCollaboration(mockSys(), signal, resources);

    // simple 命中规则 4
    expect(result.mode).toBe('single');
  });
});

// ── 规则 6: 节点不足 ──

describe('规则 6: 可用节点不足', () => {
  it('availableNodeCount <= 1 → single', () => {
    const signal = makeSignal({ domains: ['code'] });
    const resources = makeResources({ availableNodeCount: 1 });

    const result = decideCollaboration(mockSys(), signal, resources);

    expect(result.mode).toBe('single');
    expect(result.reason).toContain('可用节点不足');
  });

  it('availableNodeCount = 0 → single', () => {
    const signal = makeSignal({ domains: ['code'] });
    const resources = makeResources({ availableNodeCount: 0 });

    const result = decideCollaboration(mockSys(), signal, resources);

    expect(result.mode).toBe('single');
  });
});

// ── 规则 7: 默认 cascade ──

describe('规则 7: 默认 cascade', () => {
  it('单领域 + 节点充足 + 无本地覆盖 → cascade', () => {
    const signal = makeSignal({ domains: ['code'], complexity: 'medium' });
    const resources = makeResources({
      availableNodeCount: 2,
      localCoverageRatio: 0,
      localConfidence: 0,
    });

    const result = decideCollaboration(mockSys(), signal, resources);

    expect(result.mode).toBe('cascade');
    expect(result.reason).toContain('单领域');
  });
});

// ── 节点数限制 ──

describe('节点数限制', () => {
  it('selectedNodes 不超过 3', () => {
    const sys = mockSys();
    // pickLocalExperts / pickMultiExperts 可能返回多于 3 个
    // 但 decideCollaboration 会 slice(0, 3)
    const signal = makeSignal({ domains: ['a', 'b', 'c', 'd'] });
    const resources = makeResources({ availableNodeCount: 5 });

    const result = decideCollaboration(sys, signal, resources);

    expect(result.selectedNodes.length).toBeLessThanOrEqual(3);
  });
});

// ── 优先级验证：规则 0 > 规则 1 > 规则 2 > 规则 3 ──

describe('规则优先级', () => {
  it('经验路由优先于预算耗尽', () => {
    const signal = makeSignal();
    const resources = makeResources({
      budgetRemaining: 0,
      experienceHit: {
        path: 'exp_direct',
        skill: { id: 'skill-x' } as any,
        confidence: 0.9,
        novelty: 0.1,
      },
    });

    const result = decideCollaboration(mockSys(), signal, resources);

    expect(result.mode).toBe('local_only');
    expect(result.reason).toContain('经验路由');
  });

  it('预算耗尽优先于用户纠正', () => {
    const signal = makeSignal();
    const resources = makeResources({
      budgetRemaining: 0,
      userCorrectionCount: 5,
    });

    const result = decideCollaboration(mockSys(), signal, resources);

    expect(result.reason).toContain('预算耗尽');
  });

  it('用户纠正优先于本地覆盖', () => {
    const signal = makeSignal({ domains: ['code'] });
    const resources = makeResources({
      userCorrectionCount: 3,
      localCoverageRatio: 1,
      localConfidence: 0.95,
    });

    const result = decideCollaboration(mockSys(), signal, resources);

    expect(result.reason).toContain('用户纠正');
  });
});

// ── experienceHit 路径不在已知值时的降级 ──

describe('experienceHit 路径降级', () => {
  it('path=llm 且有 skill → 不命中规则 0/0b，继续后续规则', () => {
    const signal = makeSignal({ domains: [] });
    const resources = makeResources({
      experienceHit: {
        path: 'llm',
        skill: { id: 'some-skill' } as any,
      },
    });

    const result = decideCollaboration(mockSys(), signal, resources);

    // path=llm 不命中规则 0（需要 exp_direct/exp_verified）
    // 也不命中规则 0b（需要 llm_with_hint）
    // domains=[] 命中规则 4
    expect(result.mode).toBe('single');
    expect(result.reason).toContain('无明确领域');
  });
});
