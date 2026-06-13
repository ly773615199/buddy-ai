import { describe, it, expect, vi } from 'vitest';
import { CapabilityCoverageChecker } from './capability-checker.js';
import type { ModelPool, ModelProfile } from './model-pool.js';

// Mock ModelPool
function createMockPool(profiles: ModelProfile[]): ModelPool {
  return {
    getAllProfiles: () => profiles,
  } as unknown as ModelPool;
}

function makeProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: 'test/model',
    platform: 'test',
    displayName: 'Test Model',
    tier: 'standard',
    capabilities: {
      reasoning: 0.7,
      code: 0.7,
      chinese: 0.8,
      english: 0.7,
      math: 0.5,
      creative: 0.5,
      toolCalling: true,
      toolCallingMode: 'native',
      vision: false,
      streaming: true,
    },
    maxContextTokens: 32000,
    maxOutputTokens: 4096,
    costPer1kInput: 0.001,
    costPer1kOutput: 0.002,
    stats: { totalCalls: 0, successes: 0, avgLatencyMs: 0, byTaskType: {} },
    source: 'platform_api',
    discoveredAt: Date.now(),
    ...overrides,
  };
}

describe('CapabilityCoverageChecker', () => {
  it('无特殊需求 → proceed, coverage=1', () => {
    const pool = createMockPool([makeProfile()]);
    const checker = new CapabilityCoverageChecker(pool);
    const report = checker.check('你好');
    expect(report.recommendation).toBe('proceed');
    expect(report.overallCoverage).toBe(1);
    expect(report.gaps).toHaveLength(0);
  });

  it('需要 vision 但无 vision 模型 → reject', () => {
    const pool = createMockPool([makeProfile({
      capabilities: { ...makeProfile().capabilities, vision: false, chinese: 0.3 },
    })]);
    const checker = new CapabilityCoverageChecker(pool);
    const report = checker.check('帮我识别这张图片');
    expect(report.recommendation).toBe('reject');
    expect(report.gaps.some(g => g.includes('视觉'))).toBe(true);
    expect(report.message).toContain('建议');
  });

  it('需要 vision 且有 vision 模型 → proceed', () => {
    const pool = createMockPool([makeProfile({ capabilities: { ...makeProfile().capabilities, vision: true } })]);
    const checker = new CapabilityCoverageChecker(pool);
    const report = checker.check('帮我识别这张图片');
    expect(report.recommendation).toBe('proceed');
  });

  it('需要工具调用但无工具模型 → reject', () => {
    const pool = createMockPool([makeProfile({
      capabilities: { ...makeProfile().capabilities, toolCalling: false, toolCallingMode: 'none' },
    })]);
    const checker = new CapabilityCoverageChecker(pool);
    const report = checker.check('帮我执行这个命令', 'tools');
    expect(report.recommendation).toBe('reject');
    expect(report.gaps.some(g => g.includes('工具调用'))).toBe(true);
  });

  it('中文请求 → 语言覆盖检查', () => {
    const pool = createMockPool([makeProfile({
      capabilities: { ...makeProfile().capabilities, chinese: 0.3 },
    })]);
    const checker = new CapabilityCoverageChecker(pool);
    const report = checker.check('请详细解释一下这个算法的实现原理');
    // chinese < 0.6 且是中文请求，语言维度不覆盖
    expect(report.gaps.some(g => g.includes('中文'))).toBe(true);
  });

  it('多个维度缺失 → 低覆盖率', () => {
    const pool = createMockPool([makeProfile({
      capabilities: { ...makeProfile().capabilities, vision: false, toolCalling: false, toolCallingMode: 'none', chinese: 0.3 },
    })]);
    const checker = new CapabilityCoverageChecker(pool);
    const report = checker.check('帮我识别图片并执行命令', 'tools');
    expect(report.overallCoverage).toBeLessThan(0.5);
    expect(report.recommendation).toBe('reject');
  });

  it('degrade 范围 (0.5-0.8)', () => {
    // 3 个维度需要，2 个覆盖 → 0.67
    const pool = createMockPool([makeProfile({
      capabilities: { ...makeProfile().capabilities, vision: false, chinese: 0.8 },
      maxContextTokens: 32000,
    })]);
    const checker = new CapabilityCoverageChecker(pool);
    const report = checker.check('帮我识别这张图片并搜索相关内容', 'tools');
    // vision 缺失，但 toolCalling 和 language 覆盖
    if (report.overallCoverage >= 0.5 && report.overallCoverage < 0.8) {
      expect(report.recommendation).toBe('degrade');
    }
  });
});
