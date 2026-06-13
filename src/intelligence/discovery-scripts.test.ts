/**
 * intelligence/discovery-scripts.ts 测试
 * 覆盖：DISCOVERY_SCRIPTS 结构完整性、阶段覆盖、触发词、前置能力引用
 */
import { describe, it, expect } from 'vitest';
import { DISCOVERY_SCRIPTS, type DiscoveryScript } from './discovery-scripts.js';
import { CAPABILITY_GATE } from '../core/capability-gate.js';

describe('DISCOVERY_SCRIPTS', () => {
  it('话术数量 >= 10', () => {
    expect(DISCOVERY_SCRIPTS.length).toBeGreaterThanOrEqual(10);
  });

  it('每个话术都有必填字段', () => {
    for (const script of DISCOVERY_SCRIPTS) {
      expect(script.capabilityId).toBeTruthy();
      expect(script.stage).toBeTruthy();
      expect(script.introduction).toBeTruthy();
      expect(script.hint).toBeTruthy();
      expect(script.triggers.length).toBeGreaterThan(0);
    }
  });

  it('capabilityId 都在 CAPABILITY_GATE 中存在', () => {
    for (const script of DISCOVERY_SCRIPTS) {
      expect(CAPABILITY_GATE[script.capabilityId]).toBeDefined();
    }
  });

  it('stage 与 CAPABILITY_GATE 中的阶段一致', () => {
    for (const script of DISCOVERY_SCRIPTS) {
      const cap = CAPABILITY_GATE[script.capabilityId];
      expect(script.stage).toBe(cap.stage);
    }
  });

  it('requires 引用的能力都在 CAPABILITY_GATE 中存在', () => {
    for (const script of DISCOVERY_SCRIPTS) {
      if (script.requires) {
        for (const req of script.requires) {
          expect(CAPABILITY_GATE[req]).toBeDefined();
        }
      }
    }
  });

  it('没有重复的 capabilityId', () => {
    const ids = DISCOVERY_SCRIPTS.map(s => s.capabilityId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('话术内容不为空白', () => {
    for (const script of DISCOVERY_SCRIPTS) {
      expect(script.introduction.trim()).toBe(script.introduction);
      expect(script.introduction.length).toBeGreaterThan(5);
      expect(script.hint.trim()).toBe(script.hint);
      expect(script.hint.length).toBeGreaterThan(3);
    }
  });

  it('相识阶段话术覆盖主要功能', () => {
    const xiangShiScripts = DISCOVERY_SCRIPTS.filter(s => s.stage === '相识');
    const capIds = xiangShiScripts.map(s => s.capabilityId);
    // 至少覆盖 read_file, list_files, search_files
    expect(capIds).toContain('read_file');
    expect(capIds).toContain('list_files');
    expect(capIds).toContain('search_files');
  });

  it('话术包含自然语言，不像系统提示', () => {
    for (const script of DISCOVERY_SCRIPTS) {
      // 不能包含典型系统提示词
      expect(script.introduction).not.toMatch(/\[SYSTEM\]|ERROR|FATAL|TODO/i);
      expect(script.hint).not.toMatch(/\[SYSTEM\]|ERROR|FATAL|TODO/i);
    }
  });
});
