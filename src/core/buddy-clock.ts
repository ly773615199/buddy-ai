/**
 * BuddyClock — Buddy 的生物钟
 *
 * 不是 cron，是自主意识的时钟。
 * 心跳机制：每 5 分钟检查一次（像生物的脉搏）
 * 根据当前状态决定做什么，与 DesireEngine 协作决定优先级
 */

import type {
  ClockState, ClockPhase, ProactiveIntent, ProactiveType,
  Reminder, UserRoutine, BuddyConfig,
} from '../types.js';
import type { DesireVector } from '../desire/engine.js';
import type { Mood } from '../emotion/engine.js';
import type { Cerebellum } from '../brain/cerebellum/index.js';
import type { MemoryStore } from '../memory/store.js';
import type { PlatformManager } from '../social/platform.js';
import type { DreamEngine } from '../memory/dream.js';
import { RoutineLearner } from './routine-learner.js';
import { ReminderEngine } from './reminder-engine.js';
import { ProactiveEngine, type ProactiveContext } from './proactive-engine.js';
import { DesireDecay } from '../desire/decay.js';
import * as fs from 'fs';
import * as path from 'path';

// ==================== 工具函数 ====================

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ==================== BuddyClock ====================

export interface BuddyClockDeps {
  cerebellum: Cerebellum;
  memory: MemoryStore;
  platformManager: PlatformManager;
  dream: DreamEngine;
  llm: import('./llm.js').LLMAdapter;
}

export class BuddyClock {
  private state: ClockState;
  private routineLearner: RoutineLearner;
  readonly reminderEngine: ReminderEngine;
  readonly proactiveEngine: ProactiveEngine;
  /** 需求衰减系统 — 六欲自然增长 */
  readonly desireDecay: DesireDecay;
  private deps: BuddyClockDeps;
  private config: NonNullable<BuddyConfig['clock']>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private persistPath: string;
  private verbose: boolean;

  /** 事件回调（供 Subsystems / Agent 注册） */
  onProactive: ((intent: ProactiveIntent) => void) | null = null;
  onReminderDue: ((reminder: Reminder) => void) | null = null;
  onPhaseChange: ((from: ClockPhase, to: ClockPhase) => void) | null = null;
  onHeartbeat: ((state: ClockState) => void) | null = null;

  /** Phase 4: 注入 LLMCallService 调用器（透传到 ProactiveEngine） */
  setLLMCaller(caller: (prompt: string) => Promise<string>): void {
    this.proactiveEngine.setLLMCaller(caller);
  }

  constructor(deps: BuddyClockDeps, config: NonNullable<BuddyConfig['clock']>, dataDir: string, verbose = false) {
    this.deps = deps;
    this.config = config;
    this.verbose = verbose;
    this.persistPath = path.join(dataDir, 'clock-state.json');
    this.routineLearner = new RoutineLearner(deps.memory, dataDir);
    this.reminderEngine = new ReminderEngine(dataDir);
    this.proactiveEngine = new ProactiveEngine(
      deps.platformManager, deps.memory, deps.dream, deps.llm,
    );
    this.desireDecay = new DesireDecay();
    this.state = this._load() ?? this._defaultState();
  }

  // ==================== 生命周期 ====================

  /** 启动时钟 */
  start(): void {
    if (this.timer) return;

    // 首次启动：分析历史，学习规律
    this.routineLearner.analyzeHistory(14);

    // 启动心跳
    const interval = this.config.heartbeatMs ?? 5 * 60 * 1000;
    this.timer = setInterval(() => this._heartbeat(), interval);

    // 立即执行一次心跳
    this._heartbeat();

    if (this.verbose) {
      console.log(`[BuddyClock] 已启动，心跳间隔 ${interval / 1000}s，已学习 ${this.routineLearner.count} 条规律`);
    }
  }

  /** 停止时钟 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this._save();
  }

  /** 销毁 */
  destroy(): void {
    this.stop();
  }

  // ==================== 外部事件通知 ====================

  /** 用户发来消息 */
  notifyInteraction(timestamp = Date.now()): void {
    this.state.lastInteraction = timestamp;
    this.state.todayInteractions++;
    this.state.phase = 'active';

    // 需求衰减：交互降低社交欲/饥饿感
    this.desireDecay.onInteraction();

    // 增量更新规律学习
    // 话题提取由 RoutineLearner 内部处理
  }

  /** 记录消息内容（用于规律学习） */
  notifyMessage(content: string, timestamp = Date.now()): void {
    this.routineLearner.updateWithNewConversation(timestamp, content);
  }

  /** 梦境完成 */
  notifyDreamComplete(): void {
    this.state.lastDream = Date.now();
    this.state.todayDreams++;
  }

  // ==================== 提醒管理（委托给 ReminderEngine） ====================

  /** 添加提醒 */
  addReminder(reminder: Reminder): void {
    this.reminderEngine.addReminder(reminder);
  }

  /** 创建用户提醒 */
  createUserReminder(content: string, triggerAt: number, channel: string, chatId?: string): Reminder {
    return this.reminderEngine.createOnceReminder(content, triggerAt, channel, chatId);
  }

  /** 创建 Buddy 自主提醒 */
  createBuddyReminder(content: string, at: number, _reason: string): Reminder {
    return this.reminderEngine.createBuddyReminder(content, at);
  }

  /** 取消提醒 */
  cancelReminder(id: string): boolean {
    return this.reminderEngine.cancel(id);
  }

  /** 获取活跃提醒列表 */
  getActiveReminders(): Reminder[] {
    return this.reminderEngine.getActive();
  }

  // ==================== 状态查询 ====================

  getState(): Readonly<ClockState> {
    return { ...this.state };
  }

  getPhase(): ClockPhase {
    return this.state.phase;
  }

  getRoutines(): UserRoutine[] {
    return this.routineLearner.getRoutines();
  }

  // ==================== 核心心跳 ====================

  private async _heartbeat(): Promise<void> {
    const now = Date.now();
    const hour = new Date(now).getHours();
    const prevPhase = this.state.phase;

    // 1. 日期变更检查 — 重置每日计数器
    this._checkDayReset();

    // 2. 更新当前阶段
    this._updatePhase(now, hour);

    // 3. 阶段变化通知
    if (this.state.phase !== prevPhase) {
      this.onPhaseChange?.(prevPhase, this.state.phase);
    }

    // 4. 检查到期提醒
    await this._checkReminders(now);

    // 5. 根据阶段决定行为
    if (this.state.phase === 'active' || this.state.phase === 'idle') {
      await this._considerProactiveAction(now, hour);
    }

    if (this.state.phase === 'sleeping' || this.state.phase === 'away') {
      await this._scheduleMaintenance(now);
    }

    // 6. 清理过期意图
    this._cleanupExpiredIntents(now);

    // 7. 需求衰减 — 六欲自然增长
    this.desireDecay.tick();

    // 8. 通知 & 持久化
    this.onHeartbeat?.(this.state);
    this._save();
  }

  /** 判断当前阶段 */
  private _updatePhase(now: number, hour: number): void {
    const timeSinceInteraction = now - this.state.lastInteraction;

    // 深夜（23:00 - 7:00）+ 长时间没互动 → sleeping
    if ((hour >= 23 || hour < 7) && timeSinceInteraction > 30 * 60 * 1000) {
      this.state.phase = 'sleeping';
    }
    // 长时间没互动 → away
    else if (timeSinceInteraction > 2 * 60 * 60 * 1000) {
      this.state.phase = 'away';
    }
    // 刚互动过 → active
    else if (timeSinceInteraction < 15 * 60 * 1000) {
      this.state.phase = 'active';
    }
    // 其他 → idle
    else {
      this.state.phase = 'idle';
    }
  }

  /** 检查到期提醒 */
  private async _checkReminders(now: number): Promise<void> {
    const due = this.reminderEngine.checkDue(now);
    for (const r of due) {
      this.onReminderDue?.(r);
    }
  }

  /** 考虑是否发起主动行为 */
  private async _considerProactiveAction(now: number, hour: number): Promise<void> {
    const maxDaily = this.config.maxProactivesPerDay ?? 5;
    const minInterval = this.config.minProactiveIntervalMs ?? 30 * 60 * 1000;

    // 频率控制
    const timeSinceProactive = now - this.state.lastProactive;
    if (timeSinceProactive < minInterval) return;
    if (this.state.todayProactives >= maxDaily) return;

    // 时间窗口：不在深夜主动
    if (hour >= 23 || hour < 7) return;

    // 情绪过滤：frustrated/confused 时不打扰
    const mood = this.deps.cerebellum.inferMood();
    if (mood === 'frustrated' || mood === 'confused') return;

    // 获取欲望状态
    const desires = this.deps.cerebellum.getDesires();

    // 计算各行为类型的得分
    const scores = this._calculateActionScores(desires, mood, hour, now);

    // 选最高分的行为
    const best = this._selectBestAction(scores, now);

    if (best && best.score > 0.5) {
      this.state.intentQueue.push(best.intent);
      this.state.lastProactive = now;
      this.state.todayProactives++;

      // 立即执行意图
      const ctx = ProactiveEngine.buildContext(
        hour, mood, desires, this.state, this.deps.memory,
      );
      const executed = await this.proactiveEngine.execute(best.intent, ctx);
      if (executed) {
        this.onProactive?.(best.intent);
      }
    }
  }

  /** 计算各行为类型的得分 */
  private _calculateActionScores(
    desires: DesireVector,
    mood: Mood,
    hour: number,
    now: number,
  ): Map<ProactiveType, number> {
    const scores = new Map<ProactiveType, number>();
    const socialScore = desires.social / 100;
    const timeAppropriate = (hour >= 8 && hour <= 22) ? 1 : 0.3;

    // 情绪因子：心情好时更活跃，心情差时收敛
    const moodMultiplier: Record<string, number> = {
      happy: 1.3, energetic: 1.4, calm: 1.0, excited: 1.2,
      thinking: 0.8, tired: 0.6, confused: 0.3, frustrated: 0.2,
    };
    const moodFactor = moodMultiplier[mood] ?? 0.8;

    // 问候：社交欲 × 时间 × 情绪
    scores.set('greeting', socialScore * timeAppropriate * moodFactor);

    // 关心：规律匹配 × 社交欲 × 情绪
    const routineMatch = this.routineLearner.getCurrentMatch(now);
    scores.set('care', (routineMatch?.typicalStart.confidence ?? 0) * socialScore * moodFactor);

    // 自我维护：安全欲 × 空闲时间（不受情绪影响）
    const safetyScore = desires.safety / 100;
    const idleTime = now - this.state.lastInteraction;
    const idleFactor = Math.min(1, idleTime / (60 * 60 * 1000));
    scores.set('maintenance', safetyScore * idleFactor);

    // 学习：好奇心 × 情绪
    const curiosityScore = desires.curiosity / 100;
    scores.set('learning', curiosityScore * 0.5 * moodFactor);

    // 反思：深夜时段 + 有交互时
    const hasInteractions = this.state.todayInteractions > 0;
    const reflectionScore = (hour >= 21 && hour <= 23 && hasInteractions) ? 0.7 : 0.2;
    scores.set('reflection', reflectionScore);

    return scores;
  }

  /** 选择最佳行为 */
  private _selectBestAction(
    scores: Map<ProactiveType, number>,
    now: number,
  ): { intent: ProactiveIntent; score: number } | null {
    let bestType: ProactiveType | null = null;
    let bestScore = 0;

    for (const [type, score] of scores) {
      if (score > bestScore) {
        bestScore = score;
        bestType = type;
      }
    }

    if (!bestType || bestScore <= 0.5) return null;

    const intent: ProactiveIntent = {
      id: generateId('intent'),
      type: bestType,
      reason: {
        desire: bestType,
        trigger: `score=${bestScore.toFixed(2)}`,
        confidence: bestScore,
      },
      action: {
        channel: 'auto',
        content: '', // 由 ProactiveEngine 填充
        silent: false,
      },
      timing: {
        earliest: now,
        deadline: now + 15 * 60 * 1000, // 15 分钟内执行
        priority: Math.round(bestScore * 10),
      },
      status: 'pending',
      createdAt: now,
    };

    return { intent, score: bestScore };
  }

  /** 空闲时安排自我维护 */
  private async _scheduleMaintenance(now: number): Promise<void> {
    // 每天空闲时触发一次梦境巩固
    const dreamCooldown = 4 * 60 * 60 * 1000; // 4 小时
    if (now - this.state.lastDream > dreamCooldown) {
      const intent: ProactiveIntent = {
        id: generateId('maintenance'),
        type: 'maintenance',
        reason: { desire: 'rest', trigger: 'dream_consolidation', confidence: 0.8 },
        action: { channel: 'silent', content: 'dream', silent: true },
        timing: { earliest: now, deadline: now + 60 * 60 * 1000, priority: 5 },
        status: 'pending',
        createdAt: now,
      };
      this.state.intentQueue.push(intent);
    }
  }

  /** 清理过期意图 */
  private _cleanupExpiredIntents(now: number): void {
    this.state.intentQueue = this.state.intentQueue.filter(intent => {
      if (intent.status === 'pending' && intent.timing.deadline < now) {
        intent.status = 'expired';
        return false;
      }
      return intent.status === 'pending';
    });
  }

  /** 日期变更检查 — 重置每日计数器 */
  private _checkDayReset(): void {
    const today = new Date().toDateString();
    const lastDate = this.state.lastInteraction
      ? new Date(this.state.lastInteraction).toDateString()
      : '';

    if (today !== lastDate && this.state.todayInteractions > 0) {
      this.state.todayInteractions = 0;
      this.state.todayProactives = 0;
      this.state.todayDreams = 0;
    }
  }

  // ==================== 持久化 ====================

  private _defaultState(): ClockState {
    return {
      phase: 'idle',
      lastInteraction: Date.now(),
      lastProactive: 0,
      lastDream: 0,
      todayInteractions: 0,
      todayProactives: 0,
      todayDreams: 0,
      routines: [],
      intentQueue: [],
      reminders: [],
    };
  }

  private _save(): void {
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.persistPath, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch {
      // 静默失败
    }
  }

  private _load(): ClockState | null {
    try {
      if (fs.existsSync(this.persistPath)) {
        const data = fs.readFileSync(this.persistPath, 'utf-8');
        return JSON.parse(data) as ClockState;
      }
    } catch { /* ignore */ }
    return null;
  }
}
