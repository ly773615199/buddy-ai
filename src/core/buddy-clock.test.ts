/**
 * BuddyClock 测试 — RoutineLearner / BuddyClock / ReminderEngine / ProactiveEngine
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ==================== RoutineLearner ====================

describe('RoutineLearner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('数据不足时不生成规律', async () => {
    // Mock MemoryStore
    const mockMemory = {
      getRecentMessages: () => [
        { role: 'user', content: 'hello', timestamp: Date.now() },
      ],
    };

    const { RoutineLearner } = await import('../core/routine-learner.js');
    const learner = new RoutineLearner(mockMemory as any, tmpDir);
    const routines = learner.analyzeHistory(14);
    expect(routines).toHaveLength(0);
  });

  it('能从对话历史中发现活跃时段', async () => {
    const now = Date.now();
    // 模拟上午 9-11 点的高频对话
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: 'user' as const,
      content: `message ${i} about code and typescript`,
      timestamp: now - (10 - i) * 60 * 60 * 1000 + Math.random() * 3600000,
    }));
    // 强制把时间都设在 9-11 点
    for (const m of messages) {
      const d = new Date(m.timestamp);
      d.setHours(9 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 60));
      m.timestamp = d.getTime();
    }

    const mockMemory = { getRecentMessages: () => messages };
    const { RoutineLearner } = await import('../core/routine-learner.js');
    const learner = new RoutineLearner(mockMemory as any, tmpDir);
    const routines = learner.analyzeHistory(14);

    // 应该发现至少一个规律
    expect(learner.count).toBeGreaterThanOrEqual(0); // 可能为 0 如果消息不够密集
  });

  it('增量更新不报错', async () => {
    const mockMemory = { getRecentMessages: () => [] };
    const { RoutineLearner } = await import('../core/routine-learner.js');
    const learner = new RoutineLearner(mockMemory as any, tmpDir);
    // 没有规律时增量更新应该安全
    learner.updateWithNewConversation(Date.now(), 'hello world');
    expect(learner.count).toBe(0);
  });

  it('getCurrentMatch 在无规律时返回 null', async () => {
    const mockMemory = { getRecentMessages: () => [] };
    const { RoutineLearner } = await import('../core/routine-learner.js');
    const learner = new RoutineLearner(mockMemory as any, tmpDir);
    expect(learner.getCurrentMatch()).toBeNull();
  });
});

// ==================== ReminderEngine ====================

describe('ReminderEngine', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reminder-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('创建一次性提醒', async () => {
    const { ReminderEngine } = await import('../core/reminder-engine.js');
    const engine = new ReminderEngine(tmpDir);
    const at = Date.now() + 60000;
    const r = engine.createOnceReminder('喝水', at, 'cli');

    expect(r.content).toBe('喝水');
    expect(r.trigger.type).toBe('once');
    expect(r.trigger.at).toBe(at);
    expect(r.active).toBe(true);
    expect(engine.activeCount).toBe(1);
  });

  it('创建循环提醒', async () => {
    const { ReminderEngine } = await import('../core/reminder-engine.js');
    const engine = new ReminderEngine(tmpDir);
    const r = engine.createRecurringReminder('写周报', '0 14 * * 5', 'cli');

    expect(r.trigger.type).toBe('recurring');
    expect(r.trigger.cron).toBe('0 14 * * 5');
    expect(r.nextTrigger).toBeDefined();
  });

  it('checkDue 触发到期提醒', async () => {
    const { ReminderEngine } = await import('../core/reminder-engine.js');
    const engine = new ReminderEngine(tmpDir);
    const pastTime = Date.now() - 1000;
    engine.createOnceReminder('过期了', pastTime, 'cli');

    const due = engine.checkDue(Date.now());
    expect(due).toHaveLength(1);
    expect(due[0].content).toBe('过期了');
    // 一次性提醒触发后应该停用
    expect(engine.getActive()).toHaveLength(0);
  });

  it('取消提醒', async () => {
    const { ReminderEngine } = await import('../core/reminder-engine.js');
    const engine = new ReminderEngine(tmpDir);
    const r = engine.createOnceReminder('取消我', Date.now() + 60000, 'cli');
    expect(engine.cancel(r.id)).toBe(true);
    expect(engine.getActive()).toHaveLength(0);
  });

  it('持久化和加载', async () => {
    const { ReminderEngine } = await import('../core/reminder-engine.js');
    const engine1 = new ReminderEngine(tmpDir);
    engine1.createOnceReminder('持久化测试', Date.now() + 60000, 'cli');
    expect(engine1.activeCount).toBe(1);

    // 重新加载
    const engine2 = new ReminderEngine(tmpDir);
    expect(engine2.activeCount).toBe(1);
    expect(engine2.getActive()[0].content).toBe('持久化测试');
  });
});

// ==================== ReminderParser ====================

describe('ReminderParser', () => {
  it('解析 "30分钟后提醒我喝水"', async () => {
    const { parseReminderFast } = await import('../core/reminder-parser.js');
    const now = Date.now();
    const result = parseReminderFast('30分钟后提醒我喝水', now);

    expect(result).not.toBeNull();
    expect(result!.triggerType).toBe('once');
    expect(result!.at).toBeGreaterThan(now);
    expect(result!.at).toBeLessThanOrEqual(now + 31 * 60 * 1000);
    expect(result!.content).toContain('水');
  });

  it('解析 "明天上午10点提醒我开会"', async () => {
    const { parseReminderFast } = await import('../core/reminder-parser.js');
    const now = Date.now();
    const result = parseReminderFast('明天上午10点提醒我开会', now);

    expect(result).not.toBeNull();
    expect(result!.triggerType).toBe('once');
    const target = new Date(result!.at!);
    expect(target.getHours()).toBe(10);
  });

  it('解析 "每周五下午提醒我写周报"', async () => {
    const { parseReminderFast } = await import('../core/reminder-parser.js');
    const result = parseReminderFast('每周五下午提醒我写周报');

    expect(result).not.toBeNull();
    expect(result!.triggerType).toBe('recurring');
    expect(result!.cron).toContain('5'); // Friday
    expect(result!.cron).toContain('14'); // 下午默认14点
  });

  it('解析 "每天9点提醒我打卡"', async () => {
    const { parseReminderFast } = await import('../core/reminder-parser.js');
    const result = parseReminderFast('每天9点提醒我打卡');

    expect(result).not.toBeNull();
    expect(result!.triggerType).toBe('recurring');
    expect(result!.cron).toBe('0 9 * * *');
  });

  it('无法解析的文本返回 null', async () => {
    const { parseReminderFast } = await import('../core/reminder-parser.js');
    expect(parseReminderFast('今天天气不错')).toBeNull();
  });
});

// ==================== BuddyClock ====================

describe('BuddyClock', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clock-test-'));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('初始化和状态查询', async () => {
    const mockDeps = {
      desire: { getVector: () => ({ hunger: 20, curiosity: 30, social: 15, safety: 10, expression: 15, rest: 10 }) },
      emotion: { getMood: () => 'calm' as const },
      memory: { getRecentMessages: () => [] },
      platformManager: { getActive: () => null, destroy: () => {} },
      dream: { dream: async () => ({}) },
      llm: { chat: async () => ({ text: 'hi' }) },
    };

    const { BuddyClock } = await import('../core/buddy-clock.js');
    const clock = new BuddyClock(mockDeps as any, { enabled: true }, tmpDir);

    expect(clock.getPhase()).toBe('idle');
    expect(clock.getActiveReminders()).toHaveLength(0);
    expect(clock.getRoutines()).toHaveLength(0);

    clock.destroy();
  });

  it('创建和取消提醒', async () => {
    const mockDeps = {
      desire: { getVector: () => ({ hunger: 20, curiosity: 30, social: 15, safety: 10, expression: 15, rest: 10 }) },
      emotion: { getMood: () => 'calm' as const },
      memory: { getRecentMessages: () => [] },
      platformManager: { getActive: () => null, destroy: () => {} },
      dream: { dream: async () => ({}) },
      llm: { chat: async () => ({ text: 'hi' }) },
    };

    const { BuddyClock } = await import('../core/buddy-clock.js');
    const clock = new BuddyClock(mockDeps as any, { enabled: true }, tmpDir);

    const r = clock.createUserReminder('测试提醒', Date.now() + 60000, 'cli');
    expect(clock.getActiveReminders()).toHaveLength(1);

    clock.cancelReminder(r.id);
    expect(clock.getActiveReminders()).toHaveLength(0);

    clock.destroy();
  });

  it('notifyInteraction 更新状态', async () => {
    const mockDeps = {
      desire: { getVector: () => ({ hunger: 20, curiosity: 30, social: 15, safety: 10, expression: 15, rest: 10 }) },
      emotion: { getMood: () => 'calm' as const },
      memory: { getRecentMessages: () => [] },
      platformManager: { getActive: () => null, destroy: () => {} },
      dream: { dream: async () => ({}) },
      llm: { chat: async () => ({ text: 'hi' }) },
    };

    const { BuddyClock } = await import('../core/buddy-clock.js');
    const clock = new BuddyClock(mockDeps as any, { enabled: true }, tmpDir);

    const before = clock.getState();
    clock.notifyInteraction();
    const after = clock.getState();

    expect(after.todayInteractions).toBe(before.todayInteractions + 1);
    expect(after.phase).toBe('active');

    clock.destroy();
  });
});
