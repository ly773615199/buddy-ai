/**
 * core/constants.ts 测试
 * 覆盖：formatToolResult, getPersonalityKey, getFallbackReply, describeToolCall
 */
import { describe, it, expect } from 'vitest';
import {
  formatToolResult,
  getPersonalityKey,
  getFallbackReply,
  describeToolCall,
  FALLBACK_REPLIES,
  TOOL_CATEGORIES,
  NEGATION_PATTERNS,
} from './constants.js';
import { needsConfirmationCompat } from './capability-gate.js';
import type { Attributes } from '../types.js';

describe('formatToolResult', () => {
  it('短文本不截断', () => {
    expect(formatToolResult('hello')).toBe('hello');
  });

  it('正好 10000 字符不截断', () => {
    const exact = 'x'.repeat(10000);
    expect(formatToolResult(exact)).toBe(exact);
  });

  it('超过 10000 字符截断并提示', () => {
    const long = 'x'.repeat(10001);
    const result = formatToolResult(long);
    expect(result).toContain('已截断');
    expect(result).toContain('10001');
  });

  it('超过 100 行截断并提示行数', () => {
    // 每行 80 字符 * 150 行 = 12000 字符 > 10000 限制
    const manyLines = Array.from({ length: 150 }, (_, i) => `line ${String(i).padStart(70, 'x')}`).join('\n');
    const result = formatToolResult(manyLines);
    expect(result.length).toBeLessThan(manyLines.length);
  });

  it('空字符串不崩溃', () => {
    expect(formatToolResult('')).toBe('');
  });
});

describe('getPersonalityKey', () => {
  it('snark > 60 && wisdom > 60 → sharp_mentor', () => {
    const attrs: Attributes = { snark: 75, wisdom: 85, chaos: 15, patience: 40, debugging: 90 };
    expect(getPersonalityKey(attrs)).toBe('sharp_mentor');
  });

  it('chaos > 60 → chaotic_friend', () => {
    const attrs: Attributes = { snark: 30, wisdom: 40, chaos: 80, patience: 50, debugging: 30 };
    expect(getPersonalityKey(attrs)).toBe('chaotic_friend');
  });

  it('默认 → warm_companion', () => {
    const attrs: Attributes = { snark: 20, wisdom: 30, chaos: 20, patience: 60, debugging: 50 };
    expect(getPersonalityKey(attrs)).toBe('warm_companion');
  });

  it('snark > 60 但 wisdom <= 60 → 不是 sharp_mentor', () => {
    const attrs: Attributes = { snark: 75, wisdom: 50, chaos: 20, patience: 40, debugging: 90 };
    expect(getPersonalityKey(attrs)).not.toBe('sharp_mentor');
  });
});

describe('getFallbackReply', () => {
  it('返回非空字符串', () => {
    const attrs: Attributes = { snark: 75, wisdom: 85, chaos: 15, patience: 40, debugging: 90 };
    const reply = getFallbackReply(attrs);
    expect(typeof reply).toBe('string');
    expect(reply.length).toBeGreaterThan(0);
  });

  it('sharp_mentor 返回对应列表中的回复', () => {
    const attrs: Attributes = { snark: 75, wisdom: 85, chaos: 15, patience: 40, debugging: 90 };
    const reply = getFallbackReply(attrs);
    expect(FALLBACK_REPLIES.sharp_mentor).toContain(reply);
  });

  it('warm_companion 返回对应列表中的回复', () => {
    const attrs: Attributes = { snark: 10, wisdom: 30, chaos: 10, patience: 80, debugging: 50 };
    const reply = getFallbackReply(attrs);
    expect(FALLBACK_REPLIES.warm_companion).toContain(reply);
  });

  it('chaotic_friend 返回对应列表中的回复', () => {
    const attrs: Attributes = { snark: 30, wisdom: 40, chaos: 80, patience: 30, debugging: 30 };
    const reply = getFallbackReply(attrs);
    expect(FALLBACK_REPLIES.chaotic_friend).toContain(reply);
  });
});

describe('needsConfirmationCompat (capability-gate)', () => {
  it('stranger 执行 write_file 需要确认', () => {
    expect(needsConfirmationCompat('write_file', 'stranger')).toBe(true);
  });

  it('acquaintance 执行 write_file 需要确认', () => {
    expect(needsConfirmationCompat('write_file', 'acquaintance')).toBe(true);
  });

  it('friend 执行 write_file 不需要确认', () => {
    expect(needsConfirmationCompat('write_file', 'friend')).toBe(false);
  });

  it('stranger 执行 exec 需要确认', () => {
    expect(needsConfirmationCompat('exec', 'stranger')).toBe(true);
  });

  it('acquaintance 执行 exec 需要确认', () => {
    expect(needsConfirmationCompat('exec', 'acquaintance')).toBe(true);
  });

  it('friend 执行 exec 需要确认', () => {
    expect(needsConfirmationCompat('exec', 'friend')).toBe(true);
  });

  it('close_friend 执行 exec 不需要确认', () => {
    expect(needsConfirmationCompat('exec', 'close_friend')).toBe(false);
  });

  it('不在 CAPABILITY_GATE 中的工具不需要确认', () => {
    expect(needsConfirmationCompat('read_file', 'stranger')).toBe(false);
    expect(needsConfirmationCompat('list_files', 'stranger')).toBe(false);
    expect(needsConfirmationCompat('get_time', 'stranger')).toBe(false);
  });

  it('有亲密度分数时使用新系统', () => {
    // 亲密度 80 = 相伴阶段，write_file/exec 不需要确认
    expect(needsConfirmationCompat('write_file', 'stranger', 80)).toBe(false);
    expect(needsConfirmationCompat('exec', 'stranger', 80)).toBe(false);
    // 亲密度 10 = 初见阶段，需要确认
    expect(needsConfirmationCompat('write_file', 'stranger', 10)).toBe(true);
    expect(needsConfirmationCompat('exec', 'stranger', 10)).toBe(true);
  });
});

describe('describeToolCall', () => {
  it('exec 显示命令内容', () => {
    const desc = describeToolCall('exec', { command: 'ls -la' });
    expect(desc).toContain('执行命令');
    expect(desc).toContain('ls -la');
  });

  it('exec 命令超过 120 字符截断', () => {
    const longCmd = 'x'.repeat(200);
    const desc = describeToolCall('exec', { command: longCmd });
    expect(desc.length).toBeLessThan(200);
  });

  it('write_file 显示文件路径', () => {
    const desc = describeToolCall('write_file', { path: '/tmp/test.txt' });
    expect(desc).toContain('写入文件');
    expect(desc).toContain('/tmp/test.txt');
  });

  it('search_files 显示搜索模式和路径', () => {
    const desc = describeToolCall('search_files', { pattern: '*.ts', path: '/src' });
    expect(desc).toContain('搜索文件');
    expect(desc).toContain('*.ts');
  });

  it('未知工具显示工具名和参数', () => {
    const desc = describeToolCall('my_tool', { key: 'value' });
    expect(desc).toContain('my_tool');
  });
});

describe('TOOL_CATEGORIES', () => {
  it('基础工具分类正确', () => {
    expect(TOOL_CATEGORIES.chat).toBe('basic');
    expect(TOOL_CATEGORIES.read_file).toBe('basic');
    expect(TOOL_CATEGORIES.list_files).toBe('basic');
    expect(TOOL_CATEGORIES.exec).toBe('basic');
  });

  it('进阶工具分类正确', () => {
    expect(TOOL_CATEGORIES.write_file).toBe('advanced');
    expect(TOOL_CATEGORIES.search_web).toBe('advanced');
    expect(TOOL_CATEGORIES.git_diff).toBe('advanced');
  });

  it('专家工具分类正确', () => {
    expect(TOOL_CATEGORIES.stmp_retrieve).toBe('expert');
    expect(TOOL_CATEGORIES.dream_consolidate).toBe('expert');
    expect(TOOL_CATEGORIES.knowledge_extract).toBe('expert');
  });

  it('隐藏工具分类正确', () => {
    expect(TOOL_CATEGORIES.pet_headpat).toBe('hidden');
    expect(TOOL_CATEGORIES.midnight_chat).toBe('hidden');
  });
});

describe('NEGATION_PATTERNS', () => {
  it('匹配中文否定', () => {
    expect(NEGATION_PATTERNS.test('别说了')).toBe(true);
    expect(NEGATION_PATTERNS.test('够了')).toBe(true);
    expect(NEGATION_PATTERNS.test('烦了')).toBe(true);
    expect(NEGATION_PATTERNS.test('闭嘴')).toBe(true);
  });

  it('匹配英文否定', () => {
    expect(NEGATION_PATTERNS.test('stop')).toBe(true);
    expect(NEGATION_PATTERNS.test('enough')).toBe(true);
    expect(NEGATION_PATTERNS.test('shut up')).toBe(true);
  });

  it('不匹配正常对话', () => {
    expect(NEGATION_PATTERNS.test('你好')).toBe(false);
    expect(NEGATION_PATTERNS.test('帮我看看这个文件')).toBe(false);
  });
});
