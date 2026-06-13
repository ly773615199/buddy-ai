/**
 * 补充模块测试
 * 覆盖: SkillManager, PromptInjector 配置, TrainingExporter 配置
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';

// ═══════════════════════════════════════════════════════
// SkillManager
// ═══════════════════════════════════════════════════════

describe('SkillManager', () => {
  const SKILL_DIR = '/tmp/buddy-test-skills';

  beforeEach(async () => {
    await fs.rm(SKILL_DIR, { recursive: true, force: true });
    await fs.mkdir(SKILL_DIR, { recursive: true });
  });

  it('扫描空目录返回空列表', async () => {
    const { SkillManager } = await import('./skills/skill-manager.js');
    const mgr = new SkillManager([SKILL_DIR]);
    const loaded = await mgr.scanAndLoad();
    expect(loaded).toHaveLength(0);
  });

  it('加载声明式 .skillmate 文件', async () => {
    const skillDef = {
      name: 'test_echo',
      description: '测试回声工具',
      version: '1.0.0',
      parameters: {
        message: { type: 'string', description: '消息内容', required: true },
      },
      execute: { command: 'echo ${message}', timeout: 10 },
      resultParser: 'text',
    };
    await fs.writeFile(path.join(SKILL_DIR, 'echo.skillmate'), JSON.stringify(skillDef));

    const { SkillManager } = await import('./skills/skill-manager.js');
    const mgr = new SkillManager([SKILL_DIR]);
    const loaded = await mgr.scanAndLoad();

    expect(loaded).toHaveLength(1);
    expect(loaded[0].def.name).toBe('test_echo');
    expect(loaded[0].def.description).toBe('测试回声工具');
  });

  it('跳过无效 JSON 文件', async () => {
    await fs.writeFile(path.join(SKILL_DIR, 'bad.skillmate'), '{invalid json');
    await fs.writeFile(path.join(SKILL_DIR, 'good.skillmate'), JSON.stringify({
      name: 'good', description: 'ok', version: '1.0',
      parameters: {}, execute: { command: 'echo ok' },
    }));

    const { SkillManager } = await import('./skills/skill-manager.js');
    const mgr = new SkillManager([SKILL_DIR]);
    const loaded = await mgr.scanAndLoad();

    expect(loaded).toHaveLength(1);
    expect(loaded[0].def.name).toBe('good');
  });

  it('忽略非 .skillmate 文件', async () => {
    await fs.writeFile(path.join(SKILL_DIR, 'readme.txt'), 'not a skill');
    await fs.writeFile(path.join(SKILL_DIR, 'config.json'), '{}');

    const { SkillManager } = await import('./skills/skill-manager.js');
    const mgr = new SkillManager([SKILL_DIR]);
    const loaded = await mgr.scanAndLoad();
    expect(loaded).toHaveLength(0);
  });

  it('listSkills 返回已加载的技能', async () => {
    await fs.writeFile(path.join(SKILL_DIR, 'a.skillmate'), JSON.stringify({
      name: 'alpha', description: 'A', version: '1.0',
      parameters: {}, execute: { command: 'echo a' },
    }));
    await fs.writeFile(path.join(SKILL_DIR, 'b.skillmate'), JSON.stringify({
      name: 'beta', description: 'B', version: '1.0',
      parameters: {}, execute: { command: 'echo b' },
    }));

    const { SkillManager } = await import('./skills/skill-manager.js');
    const mgr = new SkillManager([SKILL_DIR]);
    await mgr.scanAndLoad();

    const skills = mgr.listSkills();
    expect(skills).toHaveLength(2);
    expect(skills.map(s => s.name).sort()).toEqual(['skill_alpha', 'skill_beta']);
  });

  it('registerAll 注册到 ToolRegistry', async () => {
    await fs.writeFile(path.join(SKILL_DIR, 'reg.skillmate'), JSON.stringify({
      name: 'reg_tool', description: '注册测试', version: '1.0',
      parameters: { x: { type: 'string', description: '输入' } },
      execute: { command: 'echo ${x}' },
    }));

    const { SkillManager } = await import('./skills/skill-manager.js');
    const mgr = new SkillManager([SKILL_DIR]);
    await mgr.scanAndLoad();

    const registered: any[] = [];
    const mockRegistry = { register: (tool: any) => registered.push(tool) };
    const count = mgr.registerAll(mockRegistry);

    expect(count).toBe(1);
    expect(registered).toHaveLength(1);
    expect(registered[0].name).toBe('skill_reg_tool');
  });

  it('多目录扫描合并结果', async () => {
    const dir2 = '/tmp/buddy-test-skills2';
    await fs.rm(dir2, { recursive: true, force: true });
    await fs.mkdir(dir2, { recursive: true });

    await fs.writeFile(path.join(SKILL_DIR, 'a.skillmate'), JSON.stringify({
      name: 'from_dir1', description: 'A', version: '1.0',
      parameters: {}, execute: { command: 'echo a' },
    }));
    await fs.writeFile(path.join(dir2, 'b.skillmate'), JSON.stringify({
      name: 'from_dir2', description: 'B', version: '1.0',
      parameters: {}, execute: { command: 'echo b' },
    }));

    const { SkillManager } = await import('./skills/skill-manager.js');
    const mgr = new SkillManager([SKILL_DIR, dir2]);
    const loaded = await mgr.scanAndLoad();

    expect(loaded).toHaveLength(2);
    await fs.rm(dir2, { recursive: true, force: true });
  });
});

// ═══════════════════════════════════════════════════════
// PromptInjector 配置
// ═══════════════════════════════════════════════════════

describe('PromptInjector 配置', () => {
  it('默认配置值正确', async () => {
    const { PromptInjector } = await import('./intelligence/prompt-injector.js');
    // 需要 mock STMP 和 CognitiveEngine
    const mockStmp = {
      retrieve: async () => ({ primary: [], associative: [] }),
    };
    const mockCognitive = {
      getAllDomainProfiles: () => [],
      getDomainProfile: () => null,
    };

    const injector = new PromptInjector(mockStmp as any, mockCognitive as any);
    const config = injector.getConfig();

    expect(config.maxTokenBudget).toBe(2000);
    expect(config.minConfidence).toBe(0.6);
    expect(config.maxNodeLength).toBe(200);
    expect(config.maxNodesPerDomain).toBe(8);
    expect(config.enabled).toBe(true);
  });

  it('updateConfig 部分更新', async () => {
    const { PromptInjector } = await import('./intelligence/prompt-injector.js');
    const mockStmp = { retrieve: async () => ({ primary: [], associative: [] }) };
    const mockCognitive = { getAllDomainProfiles: () => [], getDomainProfile: () => null };

    const injector = new PromptInjector(mockStmp as any, mockCognitive as any);
    injector.updateConfig({ maxTokenBudget: 4000, minConfidence: 0.8 });

    const config = injector.getConfig();
    expect(config.maxTokenBudget).toBe(4000);
    expect(config.minConfidence).toBe(0.8);
    expect(config.maxNodeLength).toBe(200); // 未改的保持默认
  });

  it('禁用时返回 skipped', async () => {
    const { PromptInjector } = await import('./intelligence/prompt-injector.js');
    const mockStmp = { retrieve: async () => ({ primary: [], associative: [] }) };
    const mockCognitive = { getAllDomainProfiles: () => [{ domain: 'test', growthStage: 'mature', domainType: 'code' }] };

    const injector = new PromptInjector(mockStmp as any, mockCognitive as any, { enabled: false });
    const result = await injector.buildInjection('测试 test');

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('disabled');
  });

  it('无领域命中时返回 skipped', async () => {
    const { PromptInjector } = await import('./intelligence/prompt-injector.js');
    const mockStmp = { retrieve: async () => ({ primary: [], associative: [] }) };
    const mockCognitive = { getAllDomainProfiles: () => [], getDomainProfile: () => null };

    const injector = new PromptInjector(mockStmp as any, mockCognitive as any);
    const result = await injector.buildInjection('随便聊聊天');

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('no domain hit');
  });
});

// ═══════════════════════════════════════════════════════
// TrainingExporter 配置
// ═══════════════════════════════════════════════════════

describe('TrainingExporter', () => {
  it('无领域时返回空统计', async () => {
    const { TrainingExporter } = await import('./intelligence/training-exporter.js');
    const mockStmp = { searchNodes: () => [] };
    const mockCognitive = { getAllDomainProfiles: () => [] };

    const exporter = new TrainingExporter(mockStmp as any, mockCognitive as any);
    const stats = await exporter.getExportableStats();
    expect(stats).toHaveLength(0);
  });

  it('跳过 seed 阶段领域', async () => {
    const { TrainingExporter } = await import('./intelligence/training-exporter.js');
    const mockStmp = {
      retrieve: async () => ({ primary: [], associative: [] }),
      searchNodes: () => [],
    };
    const mockCognitive = {
      getAllDomainProfiles: () => [
        { domain: 'newbie', growthStage: 'seed', domainType: 'code' },
      ],
      getDomainProfile: () => null,
    };

    const exporter = new TrainingExporter(mockStmp as any, mockCognitive as any);
    const stats = await exporter.getExportableStats();
    // seed 阶段被跳过，返回空
    expect(stats).toHaveLength(0);
  });

  it('构造函数接受自定义配置', async () => {
    const { TrainingExporter } = await import('./intelligence/training-exporter.js');
    const mockStmp = { searchNodes: () => [] };
    const mockCognitive = { getAllDomainProfiles: () => [] };

    // 不抛错即通过
    const exporter = new TrainingExporter(
      mockStmp as any, mockCognitive as any,
      { minConfidence: 0.9, anonymize: false },
    );
    expect(exporter).toBeDefined();
  });
});
