import { describe, it, expect, beforeEach } from 'vitest';
import { ToolSynthesizer } from './tool-synthesizer.js';
import type { ExperienceUnit } from '../intelligence/types.js';

// ==================== Mock 经验单元 ====================

function makeUnit(overrides: Partial<ExperienceUnit> = {}): ExperienceUnit {
  return {
    id: 'exp_test1234',
    name: '读取配置文件',
    description: '读取项目根目录的配置文件并返回内容',
    abstractionLevel: 'concrete',
    trigger: {
      intent: 'file_read',
      keywords: ['读取', '配置', 'config'],
      contextTags: ['file'],
      patterns: ['读取.*配置'],
    },
    steps: [
      { tool: 'read_file', args: { path: '/home/user/project/config.json' } },
    ],
    replyTemplate: {
      sharp: '配置内容：{{result}}',
      warm: '好的，配置内容是：{{result}}',
      chaotic: '给你看看配置~ {{result}}',
      default: '配置内容：{{result}}',
    },
    stats: {
      successCount: 10,
      failCount: 0,
      confidence: 0.92,
      avgExecutionMs: 150,
      lastUsed: Date.now(),
      createdAt: Date.now(),
      extractedFrom: ['conv-1', 'conv-2'],
      consolidatedAt: Date.now(),
      evolved: false,
    },
    ...overrides,
  };
}

// ==================== shouldSynthesize ====================

describe('ToolSynthesizer.shouldSynthesize 触发判断', () => {
  let synth: ToolSynthesizer;

  beforeEach(() => {
    synth = new ToolSynthesizer();
  });

  it('满足条件 → shouldSynthesize=true', () => {
    const unit = makeUnit();
    const result = synth.shouldSynthesize(unit);
    expect(result.shouldSynthesize).toBe(true);
  });

  it('置信度不足 → false', () => {
    const unit = makeUnit({ stats: { ...makeUnit().stats, confidence: 0.5 } });
    const result = synth.shouldSynthesize(unit);
    expect(result.shouldSynthesize).toBe(false);
    expect(result.reason).toContain('置信度');
  });

  it('成功次数不足 → false', () => {
    const unit = makeUnit({ stats: { ...makeUnit().stats, successCount: 2 } });
    const result = synth.shouldSynthesize(unit);
    expect(result.shouldSynthesize).toBe(false);
    expect(result.reason).toContain('成功次数');
  });

  it('步骤过多 → false', () => {
    const steps = Array.from({ length: 6 }, (_, i) => ({
      tool: 'exec', args: { command: `cmd-${i}` },
    }));
    const unit = makeUnit({ steps });
    const result = synth.shouldSynthesize(unit);
    expect(result.shouldSynthesize).toBe(false);
    expect(result.reason).toContain('步骤数');
  });

  it('strategy 级别 → false', () => {
    const unit = makeUnit({ abstractionLevel: 'strategy' });
    const result = synth.shouldSynthesize(unit);
    expect(result.shouldSynthesize).toBe(false);
    expect(result.reason).toContain('strategy');
  });

  it('包含未知工具 → false', () => {
    const unit = makeUnit({
      steps: [{ tool: 'some_custom_tool', args: {} }],
    });
    const result = synth.shouldSynthesize(unit);
    expect(result.shouldSynthesize).toBe(false);
    expect(result.reason).toContain('未知工具');
  });

  it('workflow 级别 → 允许', () => {
    const unit = makeUnit({ abstractionLevel: 'workflow' });
    const result = synth.shouldSynthesize(unit);
    expect(result.shouldSynthesize).toBe(true);
  });
});

// ==================== generalizeParams ====================

describe('ToolSynthesizer.generalizeParams 参数泛化', () => {
  let synth: ToolSynthesizer;

  beforeEach(() => {
    synth = new ToolSynthesizer();
  });

  it('路径参数被识别', () => {
    const unit = makeUnit();
    const params = synth.generalizeParams(unit);
    expect(params.some(p => p.type === 'string' && p.description.includes('路径'))).toBe(true);
  });

  it('数字参数被识别', () => {
    const unit = makeUnit({
      steps: [{ tool: 'exec', args: { command: 'sleep', count: '42' } }],
    });
    const params = synth.generalizeParams(unit);
    expect(params.some(p => p.type === 'number')).toBe(true);
  });

  it('去重同名参数', () => {
    const unit = makeUnit({
      steps: [
        { tool: 'read_file', args: { path: '/a.txt' } },
        { tool: 'read_file', args: { path: '/b.txt' } },
      ],
    });
    const params = synth.generalizeParams(unit);
    const pathParams = params.filter(p => p.name === 'path');
    expect(pathParams).toHaveLength(1);
  });

  it('不超过 maxParams', () => {
    const steps = Array.from({ length: 5 }, (_, i) => ({
      tool: 'exec',
      args: { [`arg${i}`]: `value${i}text`, [`num${i}`]: String(i + 10) },
    }));
    const unit = makeUnit({ steps });
    const params = synth.generalizeParams(unit);
    expect(params.length).toBeLessThanOrEqual(6);
  });
});

// ==================== composeSkillmate ====================

describe('ToolSynthesizer.composeSkillmate 命令合成', () => {
  let synth: ToolSynthesizer;

  beforeEach(() => {
    synth = new ToolSynthesizer();
  });

  it('生成合法的 BuddySkillDef', () => {
    const unit = makeUnit();
    const params = synth.generalizeParams(unit);
    const result = synth.composeSkillmate(unit, params);

    expect(result.definition.name).toMatch(/^synth_/);
    expect(result.definition.description).toContain('[自动生成]');
    expect(result.definition.version).toBe('1.0.0');
    expect(result.definition.tags).toContain('synthesized');
    expect(result.sourceExperienceId).toBe('exp_test1234');
  });

  it('read_file 步骤生成 cat 命令', () => {
    const unit = makeUnit();
    const params = synth.generalizeParams(unit);
    const result = synth.composeSkillmate(unit, params);

    const commands = Array.isArray(result.definition.execute)
      ? result.definition.execute
      : [result.definition.execute];
    expect(commands[0].command).toContain('cat');
  });

  it('exec 步骤提取 command', () => {
    const unit = makeUnit({
      steps: [{ tool: 'exec', args: { command: 'npm test' } }],
    });
    const params = synth.generalizeParams(unit);
    const result = synth.composeSkillmate(unit, params);

    const commands = Array.isArray(result.definition.execute)
      ? result.definition.execute
      : [result.definition.execute];
    expect(commands[0].command).toBe('npm test');
  });

  it('多步骤生成链式命令', () => {
    const unit = makeUnit({
      steps: [
        { tool: 'exec', args: { command: 'npm run build' } },
        { tool: 'exec', args: { command: 'npm test' } },
      ],
    });
    const params = synth.generalizeParams(unit);
    const result = synth.composeSkillmate(unit, params);

    expect(Array.isArray(result.definition.execute)).toBe(true);
    expect((result.definition.execute as any[])).toHaveLength(2);
  });

  it('质量评分在 0-1 范围', () => {
    const unit = makeUnit();
    const params = synth.generalizeParams(unit);
    const result = synth.composeSkillmate(unit, params);

    expect(result.qualityScore).toBeGreaterThanOrEqual(0);
    expect(result.qualityScore).toBeLessThanOrEqual(1);
  });
});

// ==================== validate ====================

describe('ToolSynthesizer.validate 质量门', () => {
  let synth: ToolSynthesizer;

  beforeEach(() => {
    synth = new ToolSynthesizer();
  });

  it('合格工具通过质量门', () => {
    const unit = makeUnit();
    const params = synth.generalizeParams(unit);
    const synthesized = synth.composeSkillmate(unit, params);
    const gate = synth.validate(synthesized);

    expect(gate.passed).toBe(true);
    expect(gate.score).toBeGreaterThanOrEqual(0.6);
  });

  it('空命令被拦截', () => {
    const unit = makeUnit();
    const params = synth.generalizeParams(unit);
    const synthesized = synth.composeSkillmate(unit, params);
    // 注入空命令
    synthesized.definition.execute = { command: '   ', timeout: 30 };
    synthesized.qualityScore = 0.5; // 降低基础分
    const gate = synth.validate(synthesized);

    expect(gate.passed).toBe(false);
    expect(gate.issues.some(i => i.includes('空命令'))).toBe(true);
  });

  it('低质量分数被拦截', () => {
    const unit = makeUnit();
    const params = synth.generalizeParams(unit);
    const synthesized = synth.composeSkillmate(unit, params);
    synthesized.qualityScore = 0.3; // 强制低分
    const gate = synth.validate(synthesized);

    expect(gate.passed).toBe(false);
  });
});

// ==================== trySynthesize 完整流程 ====================

describe('ToolSynthesizer.trySynthesize 完整流程', () => {
  let synth: ToolSynthesizer;

  beforeEach(() => {
    synth = new ToolSynthesizer(true);
  });

  it('合格经验合成成功', () => {
    const unit = makeUnit();
    const result = synth.trySynthesize(unit);

    expect(result).not.toBeNull();
    expect(result!.synthesized.definition.name).toMatch(/^synth_/);
    expect(result!.gate.passed).toBe(true);
  });

  it('低置信度经验返回 null', () => {
    const unit = makeUnit({ stats: { ...makeUnit().stats, confidence: 0.5 } });
    const result = synth.trySynthesize(unit);
    expect(result).toBeNull();
  });

  it('低成功次数经验返回 null', () => {
    const unit = makeUnit({ stats: { ...makeUnit().stats, successCount: 1 } });
    const result = synth.trySynthesize(unit);
    expect(result).toBeNull();
  });

  it('多步骤经验正确合成', () => {
    const unit = makeUnit({
      steps: [
        { tool: 'exec', args: { command: 'npm run build' } },
        { tool: 'exec', args: { command: 'npm test' } },
      ],
    });
    const result = synth.trySynthesize(unit);
    expect(result).not.toBeNull();
    expect(Array.isArray(result!.synthesized.definition.execute)).toBe(true);
  });
});
