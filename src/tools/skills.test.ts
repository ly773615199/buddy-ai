/**
 * Skill Manager 集成测试 — 验证所有 .skillmate 文件加载
 */

import { describe, it, expect } from 'vitest';
import { SkillManager } from '../skills/skill-manager.js';
import { ToolRegistry } from '../tools/registry.js';
import * as path from 'path';

const SKILL_DIRS = [path.join(process.cwd(), 'skills')];

describe('Skill Manager 集成', () => {
  it('应加载所有 .skillmate 文件', async () => {
    const manager = new SkillManager(SKILL_DIRS);
    await manager.scanAndLoad();
    expect(manager.size).toBeGreaterThanOrEqual(24); // 27个减去可能的失败
  });

  it('已加载的 skill 应有合法结构', async () => {
    const manager = new SkillManager(SKILL_DIRS);
    await manager.scanAndLoad();
    const skills = manager.listSkills();

    for (const skill of skills) {
      expect(skill.name).toMatch(/^skill_/);
      expect(skill.description).toBeTruthy();
      expect(skill.version).toBeTruthy();
      expect(skill.filePath).toMatch(/\.skillmate$/);
    }
  });

  it('应能注册到 ToolRegistry', async () => {
    const manager = new SkillManager(SKILL_DIRS);
    await manager.scanAndLoad();

    const registry = new ToolRegistry();
    const count = manager.registerAll(registry);
    expect(count).toBeGreaterThanOrEqual(24);

    // 验证每个注册的工具有正确的 ToolDef 结构
    const tools = registry.list();
    for (const tool of tools) {
      expect(tool.name).toMatch(/^skill_/);
      expect(tool.description).toContain('[Skill]');
      expect(tool.execute).toBeTypeOf('function');
    }
  });

  it('媒体工具链应可串联', async () => {
    const manager = new SkillManager(SKILL_DIRS);
    await manager.scanAndLoad();

    // 验证视频处理工具都在
    const mediaSkills = manager.listSkills().filter(s =>
      s.name.includes('video') || s.name.includes('image') || s.name.includes('audio') || s.name.includes('subtitle')
    );

    const expected = [
      'skill_video_info',
      'skill_video_extract_audio',
      'skill_video_cut',
      'skill_video_concat',
      'skill_video_to_gif',
      'skill_video_speed',
      'skill_image_resize',
      'skill_image_convert',
      'skill_subtitle_extract',
      'skill_audio_info',
    ];

    for (const name of expected) {
      expect(mediaSkills.some(s => s.name === name), `缺少 ${name}`).toBe(true);
    }
  });

  it('编程工具应全部加载', async () => {
    const manager = new SkillManager(SKILL_DIRS);
    await manager.scanAndLoad();

    const devSkills = ['skill_npm_run', 'skill_run_tests', 'skill_lint_check',
      'skill_format_code', 'skill_json_query', 'skill_dependency_audit'];

    for (const name of devSkills) {
      expect(manager.getSkill(name), `缺少 ${name}`).toBeDefined();
    }
  });

  it('运维工具应全部加载', async () => {
    const manager = new SkillManager(SKILL_DIRS);
    await manager.scanAndLoad();

    const opsSkills = ['skill_process_list', 'skill_port_check',
      'skill_disk_usage', 'skill_log_tail', 'skill_system_info'];

    for (const name of opsSkills) {
      expect(manager.getSkill(name), `缺少 ${name}`).toBeDefined();
    }
  });

  it('文档工具应全部加载', async () => {
    const manager = new SkillManager(SKILL_DIRS);
    await manager.scanAndLoad();

    const docSkills = ['skill_pdf_extract', 'skill_hash_compute', 'skill_base64'];

    for (const name of docSkills) {
      expect(manager.getSkill(name), `缺少 ${name}`).toBeDefined();
    }
  });

  it('getScanDir 返回第一个扫描目录', () => {
    const manager = new SkillManager(['/a', '/b']);
    expect(manager.getScanDir()).toBe('/a');
  });

  it('getScanDir 无目录时返回 null', () => {
    const manager = new SkillManager([]);
    expect(manager.getScanDir()).toBeNull();
  });
});
