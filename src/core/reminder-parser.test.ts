/**
 * ReminderParser 测试 — 正则快速解析 + LLM fallback
 */

import { describe, it, expect } from 'vitest';

describe('ReminderParser', () => {
  // ==================== 相对时间 ====================

  describe('相对时间解析', () => {
    it('X 分钟后', async () => {
      const { parseReminderFast } = await import('../core/reminder-parser.js');
      const now = Date.now();
      const result = parseReminderFast('30分钟后提醒我喝水', now);

      expect(result).not.toBeNull();
      expect(result!.triggerType).toBe('once');
      expect(result!.at).toBeGreaterThan(now);
      expect(result!.at).toBeLessThanOrEqual(now + 31 * 60 * 1000);
      expect(result!.content).toContain('水');
    });

    it('X 小时后', async () => {
      const { parseReminderFast } = await import('../core/reminder-parser.js');
      const now = Date.now();
      const result = parseReminderFast('2小时后提醒我开会', now);

      expect(result).not.toBeNull();
      expect(result!.triggerType).toBe('once');
      expect(result!.at).toBeGreaterThan(now + 60 * 60 * 1000);
      expect(result!.at).toBeLessThanOrEqual(now + 3 * 60 * 60 * 1000);
    });

    it('X 天后', async () => {
      const { parseReminderFast } = await import('../core/reminder-parser.js');
      const now = Date.now();
      const result = parseReminderFast('3天后提醒我体检', now);

      expect(result).not.toBeNull();
      expect(result!.triggerType).toBe('once');
      expect(result!.at).toBeGreaterThan(now + 2 * 24 * 60 * 60 * 1000);
      expect(result!.at).toBeLessThanOrEqual(now + 4 * 24 * 60 * 60 * 1000);
    });

    it('X 秒后', async () => {
      const { parseReminderFast } = await import('../core/reminder-parser.js');
      const now = Date.now();
      const result = parseReminderFast('60秒后提醒我', now);

      expect(result).not.toBeNull();
      expect(result!.triggerType).toBe('once');
      expect(result!.at).toBeGreaterThan(now + 50 * 1000);
      expect(result!.at).toBeLessThanOrEqual(now + 61 * 1000);
    });

    it('英文单位 min', async () => {
      const { parseReminderFast } = await import('../core/reminder-parser.js');
      const now = Date.now();
      const result = parseReminderFast('15 min later remind me', now);

      expect(result).not.toBeNull();
      expect(result!.triggerType).toBe('once');
    });
  });

  // ==================== 绝对时间 ====================

  describe('绝对时间解析', () => {
    it('明天上午10点', async () => {
      const { parseReminderFast } = await import('../core/reminder-parser.js');
      const now = Date.now();
      const result = parseReminderFast('明天上午10点提醒我开会', now);

      expect(result).not.toBeNull();
      expect(result!.triggerType).toBe('once');
      const target = new Date(result!.at!);
      expect(target.getHours()).toBe(10);
      expect(target.getMinutes()).toBe(0);
    });

    it('明天下午3点', async () => {
      const { parseReminderFast } = await import('../core/reminder-parser.js');
      const now = Date.now();
      const result = parseReminderFast('明天下午3点提醒我面试', now);

      expect(result).not.toBeNull();
      const target = new Date(result!.at!);
      expect(target.getHours()).toBe(15);
    });

    it('后天早上8点半', async () => {
      const { parseReminderFast } = await import('../core/reminder-parser.js');
      const now = Date.now();
      const result = parseReminderFast('后天早上8点半提醒我跑步', now);

      expect(result).not.toBeNull();
      const target = new Date(result!.at!);
      expect(target.getHours()).toBe(8);
      expect(target.getMinutes()).toBe(30);
    });

    it('晚上8点', async () => {
      const { parseReminderFast } = await import('../core/reminder-parser.js');
      const now = Date.now();
      const result = parseReminderFast('晚上8点提醒我健身', now);

      expect(result).not.toBeNull();
      const target = new Date(result!.at!);
      expect(target.getHours()).toBe(20);
    });

    it('中午12点', async () => {
      const { parseReminderFast } = await import('../core/reminder-parser.js');
      const now = Date.now();
      const result = parseReminderFast('中午12点提醒我吃饭', now);

      expect(result).not.toBeNull();
      const target = new Date(result!.at!);
      expect(target.getHours()).toBe(12);
    });
  });

  // ==================== 循环提醒 ====================

  describe('循环提醒解析', () => {
    it('每周五下午（完整格式）', async () => {
      const { parseReminderFast } = await import('../core/reminder-parser.js');
      const result = parseReminderFast('每周星期五下午提醒我写周报');

      expect(result).not.toBeNull();
      expect(result!.triggerType).toBe('recurring');
      expect(result!.cron).toContain('5'); // Friday
      expect(result!.cron).toContain('14'); // 下午默认14点
    });

    it('每天9点（带点号）', async () => {
      const { parseReminderFast } = await import('../core/reminder-parser.js');
      const result = parseReminderFast('每天9点提醒我打卡');

      expect(result).not.toBeNull();
      expect(result!.triggerType).toBe('recurring');
      expect(result!.cron).toBe('0 9 * * *');
    });

    it('每天14点提醒我喝水', async () => {
      const { parseReminderFast } = await import('../core/reminder-parser.js');
      const result = parseReminderFast('每天14点提醒我喝水');

      expect(result).not.toBeNull();
      expect(result!.triggerType).toBe('recurring');
      expect(result!.cron).toBe('0 14 * * *');
    });

    it('每周星期一上午9点站会', async () => {
      const { parseReminderFast } = await import('../core/reminder-parser.js');
      const result = parseReminderFast('每周星期一上午9点提醒我站会');

      expect(result).not.toBeNull();
      expect(result!.triggerType).toBe('recurring');
      expect(result!.cron).toContain('1'); // Monday
      expect(result!.cron).toContain('9');
    });
  });

  // ==================== 明确日期 ====================

  describe('明确日期解析', () => {
    it('ISO 格式日期', async () => {
      const { parseReminderFast } = await import('../core/reminder-parser.js');
      const now = new Date('2026-04-15T00:00:00').getTime();
      const result = parseReminderFast('2026-05-01 10:00 提醒我放假', now);

      expect(result).not.toBeNull();
      expect(result!.triggerType).toBe('once');
      const target = new Date(result!.at!);
      expect(target.getFullYear()).toBe(2026);
      expect(target.getMonth()).toBe(4); // May = 4 (0-indexed)
      expect(target.getDate()).toBe(1);
      expect(target.getHours()).toBe(10);
    });

    it('中文格式日期', async () => {
      const { parseReminderFast } = await import('../core/reminder-parser.js');
      const now = Date.now();
      const result = parseReminderFast('5月1日 10点 提醒我放假', now);

      if (result) {
        expect(result.triggerType).toBe('once');
      }
    });
  });

  // ==================== 内容提取 ====================

  describe('内容提取', () => {
    it('提取 "提醒我" 后的内容', async () => {
      const { parseReminderFast } = await import('../core/reminder-parser.js');
      const result = parseReminderFast('30分钟后提醒我喝水');
      expect(result).not.toBeNull();
      expect(result!.content).toContain('水');
    });

    it('提取 "别忘了" 后的内容', async () => {
      const { parseReminderFast } = await import('../core/reminder-parser.js');
      const now = Date.now();
      const result = parseReminderFast('明天10点别忘了开会', now);
      expect(result).not.toBeNull();
      expect(result!.content).toContain('开会');
    });

    it('提取 "记得" 后的内容', async () => {
      const { parseReminderFast } = await import('../core/reminder-parser.js');
      const now = Date.now();
      const result = parseReminderFast('下午3点记得交报告', now);
      expect(result).not.toBeNull();
      expect(result!.content).toContain('报告');
    });
  });

  // ==================== 无法解析 ====================

  describe('无法解析的情况', () => {
    it('普通对话返回 null', async () => {
      const { parseReminderFast } = await import('../core/reminder-parser.js');
      expect(parseReminderFast('今天天气不错')).toBeNull();
    });

    it('只有 "提醒" 关键词但无时间返回 null', async () => {
      const { parseReminderFast } = await import('../core/reminder-parser.js');
      expect(parseReminderFast('提醒')).toBeNull();
    });
  });

  // ==================== LLM Fallback ====================

  describe('LLM Fallback', () => {
    it('正则无法解析时使用 LLM', async () => {
      const { parseReminder } = await import('../core/reminder-parser.js');
      const now = Date.now();

      const mockLLM = async () => JSON.stringify({
        content: '健身',
        at: new Date(now + 3600000).toISOString(),
        type: 'once',
      });

      const result = await parseReminder('下个小时提醒我健身', mockLLM as any, now);
      expect(result).not.toBeNull();
      expect(result!.triggerType).toBe('once');
    });

    it('LLM 返回无效 JSON 时返回 null', async () => {
      const { parseReminder } = await import('../core/reminder-parser.js');
      const mockLLM = async () => '这不是JSON';

      const result = await parseReminder('随便什么文本', mockLLM as any);
      expect(result).toBeNull();
    });

    it('无 LLM 时正则失败返回 null', async () => {
      const { parseReminder } = await import('../core/reminder-parser.js');
      const result = await parseReminder('完全无法解析的文本');
      expect(result).toBeNull();
    });
  });
});
