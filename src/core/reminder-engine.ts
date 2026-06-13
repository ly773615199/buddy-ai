/**
 * ReminderEngine — 提醒系统
 *
 * 支持用户设定 + Buddy 自主创建
 * 与 BuddyClock 心跳集成
 */

import type { Reminder, ReminderTriggerType } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

// ==================== 工具函数 ====================

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ==================== ReminderEngine ====================

export class ReminderEngine {
  private reminders: Map<string, Reminder> = new Map();
  private persistPath: string;

  constructor(dataDir: string) {
    this.persistPath = path.join(dataDir, 'reminders.json');
    this._load();
  }

  // ==================== 创建 ====================

  /** 直接添加一个 Reminder 对象 */
  addReminder(reminder: Reminder): void {
    this.reminders.set(reminder.id, reminder);
    this._save();
  }

  /** 用户创建一次性提醒 */
  createOnceReminder(content: string, at: number, channel: string, chatId?: string): Reminder {
    return this._create({
      content,
      createdBy: 'user',
      trigger: { type: 'once', at },
      channel,
      chatId,
      active: true,
      nextTrigger: at,
    });
  }

  /** 用户创建循环提醒（cron 表达式） */
  createRecurringReminder(content: string, cron: string, channel: string, chatId?: string): Reminder {
    const nextTrigger = this._calculateNextCron(cron);
    return this._create({
      content,
      createdBy: 'user',
      trigger: { type: 'recurring', cron },
      channel,
      chatId,
      active: true,
      nextTrigger,
    });
  }

  /** 用户创建模式提醒（基于规律） */
  createPatternReminder(content: string, pattern: string, channel: string, chatId?: string): Reminder {
    return this._create({
      content,
      createdBy: 'user',
      trigger: { type: 'pattern', pattern },
      channel,
      chatId,
      active: true,
      nextTrigger: this._calculateNextPattern(pattern),
    });
  }

  /** Buddy 自主创建提醒 */
  createBuddyReminder(content: string, at: number, channel = 'auto'): Reminder {
    return this._create({
      content,
      createdBy: 'buddy',
      trigger: { type: 'once', at },
      channel,
      active: true,
      nextTrigger: at,
    });
  }

  // ==================== 查询 ====================

  /** 获取所有活跃提醒 */
  getActive(): Reminder[] {
    return [...this.reminders.values()].filter(r => r.active);
  }

  /** 获取所有提醒（含已停用） */
  getAll(): Reminder[] {
    return [...this.reminders.values()];
  }

  /** 根据 ID 获取 */
  getById(id: string): Reminder | null {
    return this.reminders.get(id) ?? null;
  }

  /** 按创建者过滤 */
  getByCreator(createdBy: 'user' | 'buddy'): Reminder[] {
    return [...this.reminders.values()].filter(r => r.createdBy === createdBy && r.active);
  }

  // ==================== 修改 ====================

  /** 取消提醒 */
  cancel(id: string): boolean {
    const r = this.reminders.get(id);
    if (r) {
      r.active = false;
      this._save();
      return true;
    }
    return false;
  }

  /** 暂停提醒 */
  pause(id: string): boolean {
    const r = this.reminders.get(id);
    if (r && r.active) {
      r.active = false;
      this._save();
      return true;
    }
    return false;
  }

  /** 恢复提醒 */
  resume(id: string): boolean {
    const r = this.reminders.get(id);
    if (r && !r.active) {
      r.active = true;
      // 重新计算下次触发
      if (r.trigger.type === 'once' && r.trigger.at) {
        r.nextTrigger = r.trigger.at > Date.now() ? r.trigger.at : undefined;
      } else if (r.trigger.type === 'recurring' && r.trigger.cron) {
        r.nextTrigger = this._calculateNextCron(r.trigger.cron);
      } else if (r.trigger.type === 'pattern' && r.trigger.pattern) {
        r.nextTrigger = this._calculateNextPattern(r.trigger.pattern);
      }
      this._save();
      return true;
    }
    return false;
  }

  /** 删除提醒 */
  remove(id: string): boolean {
    const deleted = this.reminders.delete(id);
    if (deleted) this._save();
    return deleted;
  }

  /** 清理已停用的一次性提醒 */
  cleanup(): number {
    let count = 0;
    for (const [id, r] of this.reminders) {
      if (!r.active && r.trigger.type === 'once') {
        this.reminders.delete(id);
        count++;
      }
    }
    if (count > 0) this._save();
    return count;
  }

  // ==================== 触发检查 ====================

  /** 检查到期的提醒（由 BuddyClock 心跳调用） */
  checkDue(now = Date.now()): Reminder[] {
    const due: Reminder[] = [];
    for (const r of this.reminders.values()) {
      if (!r.active) continue;
      if (r.nextTrigger && r.nextTrigger <= now) {
        due.push(r);
        r.lastTriggered = now;

        if (r.trigger.type === 'once') {
          r.active = false;
        } else if (r.trigger.type === 'recurring' && r.trigger.cron) {
          r.nextTrigger = this._calculateNextCron(r.trigger.cron, now);
        } else if (r.trigger.type === 'pattern' && r.trigger.pattern) {
          r.nextTrigger = this._calculateNextPattern(r.trigger.pattern, now);
        }
      }
    }
    if (due.length > 0) this._save();
    return due;
  }

  /** 活跃提醒数量 */
  get activeCount(): number {
    return [...this.reminders.values()].filter(r => r.active).length;
  }

  // ==================== 内部方法 ====================

  private _create(partial: Omit<Reminder, 'id'>): Reminder {
    const reminder: Reminder = { id: generateId('reminder'), ...partial };
    this.reminders.set(reminder.id, reminder);
    this._save();
    return reminder;
  }

  /** 简单 cron 解析（支持 hour 和 day-of-week） */
  private _calculateNextCron(cron: string, after = Date.now()): number {
    // 格式: "MIN HOUR DOM MON DOW" — 简化处理
    const parts = cron.split(' ');
    if (parts.length < 5) return after + 24 * 60 * 60 * 1000;

    const [minStr, hourStr, , , dowStr] = parts;
    const targetMin = minStr === '*' ? -1 : parseInt(minStr, 10);
    const targetHour = hourStr === '*' ? -1 : parseInt(hourStr, 10);
    const targetDow = dowStr === '*' ? -1 : parseInt(dowStr, 10);

    // 从下一分钟开始搜索，最多搜 7 天
    const search = new Date(after + 60 * 1000);
    search.setSeconds(0, 0);

    for (let i = 0; i < 7 * 24 * 60; i++) {
      const dow = search.getDay();
      const hour = search.getHours();
      const min = search.getMinutes();

      const dowMatch = targetDow === -1 || dow === targetDow;
      const hourMatch = targetHour === -1 || hour === targetHour;
      const minMatch = targetMin === -1 || min === targetMin;

      if (dowMatch && hourMatch && minMatch) {
        return search.getTime();
      }

      search.setTime(search.getTime() + 60 * 1000);
    }

    // Fallback: 24 小时后
    return after + 24 * 60 * 60 * 1000;
  }

  /** 模式提醒的下次触发计算 */
  private _calculateNextPattern(pattern: string, after = Date.now()): number {
    const now = new Date(after);
    switch (pattern) {
      case 'every_workday_morning': {
        // 下一个工作日早上 9 点
        const next = new Date(now);
        next.setHours(9, 0, 0, 0);
        if (next.getTime() <= after) next.setDate(next.getDate() + 1);
        while (next.getDay() === 0 || next.getDay() === 6) {
          next.setDate(next.getDate() + 1);
        }
        return next.getTime();
      }
      case 'every_evening': {
        const next = new Date(now);
        next.setHours(20, 0, 0, 0);
        if (next.getTime() <= after) next.setDate(next.getDate() + 1);
        return next.getTime();
      }
      case 'every_weekend': {
        const next = new Date(now);
        next.setHours(10, 0, 0, 0);
        // 找下一个周六
        while (next.getDay() !== 6) {
          next.setDate(next.getDate() + 1);
        }
        if (next.getTime() <= after) {
          next.setDate(next.getDate() + 7);
        }
        return next.getTime();
      }
      default:
        return after + 24 * 60 * 60 * 1000;
    }
  }

  // ==================== 持久化 ====================

  private _save(): void {
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data = [...this.reminders.values()];
      fs.writeFileSync(this.persistPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) { console.debug('[reminder-engine] fail', e); }
  }

  private _load(): void {
    try {
      if (fs.existsSync(this.persistPath)) {
        const data = fs.readFileSync(this.persistPath, 'utf-8');
        const arr = JSON.parse(data) as Reminder[];
        for (const r of arr) {
          this.reminders.set(r.id, r);
        }
      }
    } catch {
      // 静默
    }
  }
}
