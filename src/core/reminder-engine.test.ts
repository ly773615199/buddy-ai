/**
 * ReminderEngine 测试 — 创建 / 触发 / 取消 / 持久化
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ReminderEngine', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reminder-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function createEngine() {
    const { ReminderEngine } = await import('../core/reminder-engine.js');
    return new ReminderEngine(tmpDir);
  }

  // ==================== 创建 ====================

  it('创建一次性提醒', async () => {
    const engine = await createEngine();
    const at = Date.now() + 60000;
    const r = engine.createOnceReminder('喝水', at, 'cli');

    expect(r.content).toBe('喝水');
    expect(r.trigger.type).toBe('once');
    expect(r.trigger.at).toBe(at);
    expect(r.channel).toBe('cli');
    expect(r.createdBy).toBe('user');
    expect(r.active).toBe(true);
    expect(r.nextTrigger).toBe(at);
    expect(engine.activeCount).toBe(1);
  });

  it('创建循环提醒', async () => {
    const engine = await createEngine();
    const r = engine.createRecurringReminder('写周报', '0 14 * * 5', 'cli');

    expect(r.content).toBe('写周报');
    expect(r.trigger.type).toBe('recurring');
    expect(r.trigger.cron).toBe('0 14 * * 5');
    expect(r.nextTrigger).toBeDefined();
    expect(r.nextTrigger!).toBeGreaterThan(Date.now());
    expect(engine.activeCount).toBe(1);
  });

  it('创建模式提醒', async () => {
    const engine = await createEngine();
    const r = engine.createPatternReminder('打卡', 'every_workday_morning', 'cli');

    expect(r.trigger.type).toBe('pattern');
    expect(r.trigger.pattern).toBe('every_workday_morning');
    expect(r.nextTrigger).toBeDefined();
    expect(engine.activeCount).toBe(1);
  });

  it('Buddy 创建自主提醒', async () => {
    const engine = await createEngine();
    const at = Date.now() + 300000;
    const r = engine.createBuddyReminder('整理记忆', at);

    expect(r.createdBy).toBe('buddy');
    expect(r.content).toBe('整理记忆');
    expect(r.trigger.type).toBe('once');
    expect(r.channel).toBe('auto');
  });

  it('直接添加 Reminder 对象', async () => {
    const engine = await createEngine();
    engine.addReminder({
      id: 'custom_123',
      content: '自定义',
      createdBy: 'user',
      trigger: { type: 'once', at: Date.now() + 60000 },
      channel: 'cli',
      active: true,
      nextTrigger: Date.now() + 60000,
    });

    expect(engine.activeCount).toBe(1);
    expect(engine.getById('custom_123')).not.toBeNull();
  });

  // ==================== 查询 ====================

  it('getActive 只返回活跃提醒', async () => {
    const engine = await createEngine();
    const r1 = engine.createOnceReminder('活跃', Date.now() + 60000, 'cli');
    engine.createOnceReminder('取消', Date.now() + 60000, 'cli');
    engine.cancel(r1.id);

    const active = engine.getActive();
    expect(active).toHaveLength(1);
    expect(active[0].content).toBe('取消');
  });

  it('getAll 返回所有提醒', async () => {
    const engine = await createEngine();
    engine.createOnceReminder('1', Date.now() + 60000, 'cli');
    const r2 = engine.createOnceReminder('2', Date.now() + 60000, 'cli');
    engine.cancel(r2.id);

    expect(engine.getAll()).toHaveLength(2);
    expect(engine.activeCount).toBe(1);
  });

  it('getById 正确查找', async () => {
    const engine = await createEngine();
    const r = engine.createOnceReminder('查找我', Date.now() + 60000, 'cli');
    expect(engine.getById(r.id)?.content).toBe('查找我');
    expect(engine.getById('不存在')).toBeNull();
  });

  it('getByCreator 按创建者过滤', async () => {
    const engine = await createEngine();
    engine.createOnceReminder('用户', Date.now() + 60000, 'cli');
    engine.createBuddyReminder('Buddy', Date.now() + 60000);

    expect(engine.getByCreator('user')).toHaveLength(1);
    expect(engine.getByCreator('buddy')).toHaveLength(1);
  });

  // ==================== 修改 ====================

  it('取消提醒', async () => {
    const engine = await createEngine();
    const r = engine.createOnceReminder('取消我', Date.now() + 60000, 'cli');
    expect(engine.cancel(r.id)).toBe(true);
    expect(engine.getActive()).toHaveLength(0);
    // 取消的提醒仍可通过 getAll 获取
    expect(engine.getAll()).toHaveLength(1);
  });

  it('取消不存在的提醒返回 false', async () => {
    const engine = await createEngine();
    expect(engine.cancel('不存在')).toBe(false);
  });

  it('暂停和恢复提醒', async () => {
    const engine = await createEngine();
    const r = engine.createOnceReminder('暂停我', Date.now() + 60000, 'cli');
    expect(engine.pause(r.id)).toBe(true);
    expect(engine.activeCount).toBe(0);

    expect(engine.resume(r.id)).toBe(true);
    expect(engine.activeCount).toBe(1);
    expect(engine.getActive()[0].nextTrigger).toBeDefined();
  });

  it('恢复已活跃的提醒返回 false', async () => {
    const engine = await createEngine();
    const r = engine.createOnceReminder('已活跃', Date.now() + 60000, 'cli');
    expect(engine.resume(r.id)).toBe(false);
  });

  it('删除提醒', async () => {
    const engine = await createEngine();
    const r = engine.createOnceReminder('删除我', Date.now() + 60000, 'cli');
    expect(engine.remove(r.id)).toBe(true);
    expect(engine.getAll()).toHaveLength(0);
    expect(engine.getById(r.id)).toBeNull();
  });

  it('cleanup 清理已停用的一次性提醒', async () => {
    const engine = await createEngine();
    const r1 = engine.createOnceReminder('清理1', Date.now() - 1000, 'cli');
    const r2 = engine.createOnceReminder('保留', Date.now() + 60000, 'cli');
    const r3 = engine.createRecurringReminder('循环', '0 9 * * *', 'cli');

    // 触发过期提醒
    engine.checkDue(Date.now());
    expect(engine.getActive()).toHaveLength(2); // 保留 + 循环

    const cleaned = engine.cleanup();
    expect(cleaned).toBe(1); // 清理了 1 个
    expect(engine.getAll()).toHaveLength(2);
  });

  // ==================== 触发检查 ====================

  it('checkDue 触发到期的一次性提醒', async () => {
    const engine = await createEngine();
    const pastTime = Date.now() - 1000;
    engine.createOnceReminder('过期了', pastTime, 'cli');

    const due = engine.checkDue(Date.now());
    expect(due).toHaveLength(1);
    expect(due[0].content).toBe('过期了');
    // 一次性提醒触发后应该停用
    expect(engine.getActive()).toHaveLength(0);
  });

  it('checkDue 不触发未到期的提醒', async () => {
    const engine = await createEngine();
    engine.createOnceReminder('还没到', Date.now() + 60000, 'cli');

    const due = engine.checkDue(Date.now());
    expect(due).toHaveLength(0);
    expect(engine.activeCount).toBe(1);
  });

  it('checkDue 触发循环提醒并计算下次时间', async () => {
    const engine = await createEngine();
    // 设置一个已过期的循环提醒
    const r = engine.createRecurringReminder('每天打卡', '0 9 * * *', 'cli');
    // 手动设置 nextTrigger 为过去时间
    (r as any).nextTrigger = Date.now() - 1000;

    const due = engine.checkDue(Date.now());
    expect(due).toHaveLength(1);
    // 循环提醒触发后应该仍然活跃
    expect(engine.activeCount).toBe(1);
    // 应该有新的 nextTrigger
    expect(engine.getActive()[0].nextTrigger).toBeGreaterThan(Date.now());
  });

  it('checkDue 触发模式提醒', async () => {
    const engine = await createEngine();
    const r = engine.createPatternReminder('工作日问候', 'every_workday_morning', 'cli');
    // 手动设置 nextTrigger 为过去时间
    (r as any).nextTrigger = Date.now() - 1000;

    const due = engine.checkDue(Date.now());
    expect(due).toHaveLength(1);
    expect(engine.activeCount).toBe(1);
  });

  it('checkDue 无到期提醒返回空数组', async () => {
    const engine = await createEngine();
    engine.createOnceReminder('未来', Date.now() + 3600000, 'cli');
    engine.createRecurringReminder('循环', '0 9 * * *', 'cli');

    const due = engine.checkDue(Date.now());
    expect(due).toHaveLength(0);
  });

  // ==================== 持久化 ====================

  it('持久化和加载', async () => {
    const engine1 = await createEngine();
    engine1.createOnceReminder('持久化测试', Date.now() + 60000, 'cli');
    engine1.createRecurringReminder('循环持久化', '0 14 * * 5', 'cli');
    expect(engine1.activeCount).toBe(2);

    // 重新加载
    const engine2 = await createEngine();
    expect(engine2.activeCount).toBe(2);

    const active = engine2.getActive();
    const contents = active.map(r => r.content);
    expect(contents).toContain('持久化测试');
    expect(contents).toContain('循环持久化');
  });

  it('取消状态也持久化', async () => {
    const engine1 = await createEngine();
    const r = engine1.createOnceReminder('取消持久化', Date.now() + 60000, 'cli');
    engine1.cancel(r.id);

    const engine2 = await createEngine();
    expect(engine2.activeCount).toBe(0);
    expect(engine2.getAll()).toHaveLength(1);
    expect(engine2.getAll()[0].active).toBe(false);
  });

  // ==================== cron 计算 ====================

  it('cron 计算下一个匹配时间', async () => {
    const engine = await createEngine();
    const r = engine.createRecurringReminder('周五下午', '0 14 * * 5', 'cli');
    const next = r.nextTrigger!;
    const nextDate = new Date(next);

    expect(nextDate.getHours()).toBe(14);
    expect(nextDate.getMinutes()).toBe(0);
    expect(nextDate.getDay()).toBe(5); // Friday
  });

  it('每天模式的 cron 计算', async () => {
    const engine = await createEngine();
    const r = engine.createRecurringReminder('每天9点', '0 9 * * *', 'cli');
    const next = r.nextTrigger!;
    const nextDate = new Date(next);

    expect(nextDate.getHours()).toBe(9);
    expect(nextDate.getMinutes()).toBe(0);
  });

  // ==================== pattern 计算 ====================

  it('every_workday_morning 模式', async () => {
    const engine = await createEngine();
    const r = engine.createPatternReminder('工作日', 'every_workday_morning', 'cli');
    const next = r.nextTrigger!;
    const nextDate = new Date(next);

    expect(nextDate.getHours()).toBe(9);
    // 应该是工作日
    expect(nextDate.getDay()).toBeGreaterThanOrEqual(1);
    expect(nextDate.getDay()).toBeLessThanOrEqual(5);
  });

  it('every_evening 模式', async () => {
    const engine = await createEngine();
    const r = engine.createPatternReminder('晚上', 'every_evening', 'cli');
    const next = r.nextTrigger!;
    const nextDate = new Date(next);

    expect(nextDate.getHours()).toBe(20);
  });

  it('every_weekend 模式', async () => {
    const engine = await createEngine();
    const r = engine.createPatternReminder('周末', 'every_weekend', 'cli');
    const next = r.nextTrigger!;
    const nextDate = new Date(next);

    expect(nextDate.getHours()).toBe(10);
    expect(nextDate.getDay()).toBe(6); // Saturday
  });

  it('未知模式 fallback 到 24 小时后', async () => {
    const engine = await createEngine();
    const before = Date.now();
    const r = engine.createPatternReminder('未知', 'unknown_pattern', 'cli');
    const next = r.nextTrigger!;

    // 应该大约是 24 小时后
    const diff = next - before;
    expect(diff).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(diff).toBeLessThan(25 * 60 * 60 * 1000);
  });
});
