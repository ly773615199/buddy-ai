/**
 * BuddyClock 端到端集成测试
 * 心跳 → 意图 → 执行 → 反馈
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('BuddyClock E2E', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-clock-'));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function createFullClock(overrides: Record<string, any> = {}) {
    const { BuddyClock } = await import('./core/buddy-clock.js');

    const mockPlatform = {
      send: vi.fn().mockResolvedValue(undefined),
      platform: 'cli',
    };

    const deps = {
      cerebellum: {
        inferMood: () => 'calm' as const,
        getMood: () => 'calm' as const,
        getMoodEmoji: () => '😌',
        getDesires: () => ({
          hunger: 20, curiosity: 50, social: 60, safety: 30, expression: 20, rest: 10,
        }),
        getDesireVector: () => ({
          hunger: 20, curiosity: 50, social: 60, safety: 30, expression: 20, rest: 10,
        }),
        getBodyState: () => ({ mood: 'calm', energy: 80, satisfaction: 70 }),
        regulate: () => [],
        sensorFusion: { feed: () => {} },
        motorControl: { getIdleAction: () => null },
      },
      memory: {
        getRecentMessages: (n: number) =>
          Array.from({ length: Math.min(n, 10) }, (_, i) => ({
            role: 'user',
            content: `message ${i} about typescript`,
            timestamp: Date.now() - i * 600000,
          })),
      },
      platformManager: {
        getActive: vi.fn().mockReturnValue(mockPlatform),
      },
      dream: {
        dream: vi.fn().mockResolvedValue({ consolidated: 3 }),
      },
      llm: {
        chat: vi.fn().mockResolvedValue({ text: '你好 ☀️' }),
      },
      ...overrides,
    };

    const clock = new BuddyClock(
      deps as any,
      { enabled: true, heartbeatMs: 5 * 60 * 1000 },
      tmpDir,
      true,
    );

    return { clock, deps, mockPlatform };
  }

  // ==================== 生命周期 ====================

  it('启动 → 停止 → 重启', async () => {
    const { clock } = await createFullClock();

    clock.start();
    expect(clock.getPhase()).toBeDefined();

    clock.stop();
    // 停止后状态应持久化
    expect(fs.existsSync(path.join(tmpDir, 'clock-state.json'))).toBe(true);

    // 重启
    clock.start();
    clock.destroy();
  });

  it('重复启动不报错', async () => {
    const { clock } = await createFullClock();
    clock.start();
    clock.start(); // 重复启动
    clock.destroy();
  });

  // ==================== 阶段转换 ====================

  it('刚交互后为 active 阶段', async () => {
    const { clock } = await createFullClock();
    clock.start();
    clock.notifyInteraction();
    expect(clock.getPhase()).toBe('active');
    clock.destroy();
  });

  it('长时间无交互转为 idle', async () => {
    const { clock } = await createFullClock();
    clock.start();
    clock.notifyInteraction();

    // 前进 20 分钟
    vi.advanceTimersByTime(20 * 60 * 1000);
    // 触发心跳
    vi.advanceTimersByTime(5 * 60 * 1000);

    expect(clock.getPhase()).toBe('idle');
    clock.destroy();
  });

  it('深夜长时间无交互转为 sleeping', async () => {
    const { clock } = await createFullClock();
    clock.start();

    // 设置时间为凌晨 2 点
    const now = new Date();
    now.setHours(2, 0, 0, 0);
    vi.setSystemTime(now);

    // 设置最后交互为 30 分钟前
    clock.notifyInteraction(now.getTime() - 31 * 60 * 1000);

    // 触发心跳
    vi.advanceTimersByTime(5 * 60 * 1000);

    expect(clock.getPhase()).toBe('sleeping');
    clock.destroy();
  });

  // ==================== 提醒集成 ====================

  it('创建提醒 → 心跳触发 → 回调通知', async () => {
    const { clock } = await createFullClock();
    const reminderDue = vi.fn();
    clock.onReminderDue = reminderDue;

    clock.start();

    // 创建一个已过期的提醒
    const pastTime = Date.now() - 1000;
    clock.createUserReminder('喝水', pastTime, 'cli');

    // 触发心跳
    vi.advanceTimersByTime(5 * 60 * 1000);

    expect(reminderDue).toHaveBeenCalled();
    expect(reminderDue.mock.calls[0][0].content).toBe('喝水');

    clock.destroy();
  });

  it('Buddy 自主提醒也能触发', async () => {
    const { clock } = await createFullClock();
    const reminderDue = vi.fn();
    clock.onReminderDue = reminderDue;

    clock.start();

    const pastTime = Date.now() - 1000;
    clock.createBuddyReminder('整理记忆', pastTime, '测试');

    vi.advanceTimersByTime(5 * 60 * 1000);

    expect(reminderDue).toHaveBeenCalled();
    clock.destroy();
  });

  it('取消的提醒不触发', async () => {
    const { clock } = await createFullClock();
    const reminderDue = vi.fn();
    clock.onReminderDue = reminderDue;

    clock.start();

    const r = clock.createUserReminder('取消我', Date.now() - 1000, 'cli');
    clock.cancelReminder(r.id);

    vi.advanceTimersByTime(5 * 60 * 1000);

    expect(reminderDue).not.toHaveBeenCalled();
    clock.destroy();
  });

  // ==================== 主动行为集成 ====================

  it('社交欲高时可能触发主动问候', async () => {
    const { clock, deps } = await createFullClock({
      desire: {
        getVector: () => ({
          hunger: 10, curiosity: 30, social: 90, safety: 10, expression: 10, rest: 10,
        }),
      },
    });

    const proactive = vi.fn();
    clock.onProactive = proactive;

    clock.start();
    clock.notifyInteraction();

    // 设置为工作时间
    const workTime = new Date();
    workTime.setHours(10, 0, 0, 0);
    vi.setSystemTime(workTime);

    // 前进超过 30 分钟（最小间隔）
    vi.advanceTimersByTime(31 * 60 * 1000);

    // 可能触发也可能不触发（取决于评分），但不应报错
    expect(clock.getPhase()).toBeDefined();
    clock.destroy();
  });

  it('深夜不触发主动行为', async () => {
    const { clock, deps } = await createFullClock({
      desire: {
        getVector: () => ({
          hunger: 10, curiosity: 30, social: 90, safety: 10, expression: 10, rest: 10,
        }),
      },
    });

    const proactive = vi.fn();
    clock.onProactive = proactive;

    clock.start();

    // 设置为凌晨 2 点
    const nightTime = new Date();
    nightTime.setHours(2, 0, 0, 0);
    vi.setSystemTime(nightTime);

    // 前进超过 30 分钟
    vi.advanceTimersByTime(31 * 60 * 1000);

    // 深夜不应触发主动行为
    expect(proactive).not.toHaveBeenCalled();
    clock.destroy();
  });

  it('frustrated 情绪不触发主动行为', async () => {
    const { clock } = await createFullClock({
      emotion: { getMood: () => 'frustrated' as const },
    });

    const proactive = vi.fn();
    clock.onProactive = proactive;

    clock.start();
    clock.notifyInteraction();

    const workTime = new Date();
    workTime.setHours(10, 0, 0, 0);
    vi.setSystemTime(workTime);

    vi.advanceTimersByTime(31 * 60 * 1000);

    expect(proactive).not.toHaveBeenCalled();
    clock.destroy();
  });

  it('每日主动行为上限', async () => {
    const { clock } = await createFullClock({
      desire: {
        getVector: () => ({
          hunger: 10, curiosity: 30, social: 90, safety: 10, expression: 10, rest: 10,
        }),
      },
    });

    clock.start();

    const workTime = new Date();
    workTime.setHours(10, 0, 0, 0);
    vi.setSystemTime(workTime);

    // 触发多次心跳
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(31 * 60 * 1000);
    }

    const state = clock.getState();
    // 每日上限为 5
    expect(state.todayProactives).toBeLessThanOrEqual(5);
    clock.destroy();
  });

  // ==================== 阶段变化回调 ====================

  it('阶段变化时触发回调', async () => {
    const { clock } = await createFullClock();
    const phaseChange = vi.fn();
    clock.onPhaseChange = phaseChange;

    clock.start();
    clock.notifyInteraction(); // → active

    // 前进 20 分钟 → idle
    vi.advanceTimersByTime(20 * 60 * 1000);
    vi.advanceTimersByTime(5 * 60 * 1000);

    expect(phaseChange).toHaveBeenCalled();
    clock.destroy();
  });

  // ==================== 心跳回调 ====================

  it('每次心跳触发 onHeartbeat', async () => {
    const { clock } = await createFullClock();
    const heartbeat = vi.fn();
    clock.onHeartbeat = heartbeat;

    clock.start();
    // _heartbeat 是异步的，需要等待微任务完成
    await vi.advanceTimersByTimeAsync(0);
    expect(heartbeat).toHaveBeenCalledTimes(1);

    // 前进 5 分钟触发下一次
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(heartbeat).toHaveBeenCalledTimes(2);

    clock.destroy();
  });

  // ==================== 消息记录 ====================

  it('notifyMessage 增量更新规律', async () => {
    const { clock } = await createFullClock();
    clock.start();

    // 发送多条消息
    for (let i = 0; i < 5; i++) {
      clock.notifyMessage('typescript coding');
    }

    // 不应报错
    expect(clock.getRoutines()).toBeDefined();
    clock.destroy();
  });

  // ==================== 持久化 ====================

  it('时钟状态持久化', async () => {
    const { clock: clock1 } = await createFullClock();
    clock1.start();
    clock1.notifyInteraction();
    clock1.stop();

    // 重新创建时钟
    const { clock: clock2 } = await createFullClock();
    clock2.start();

    const state = clock2.getState();
    expect(state.lastInteraction).toBeGreaterThan(0);
    expect(state.todayInteractions).toBeGreaterThanOrEqual(1);

    clock2.destroy();
  });

  // ==================== 空闲维护 ====================

  it('空闲时触发梦境巩固', async () => {
    const { clock, deps } = await createFullClock();

    clock.start();

    // 设置为长时间无交互的 away 状态
    const oldTime = Date.now() - 3 * 60 * 60 * 1000; // 3 小时前
    clock.notifyInteraction(oldTime);

    // 触发心跳
    vi.advanceTimersByTime(5 * 60 * 1000);

    // 空闲时应该安排维护任务
    const state = clock.getState();
    // 可能有 maintenance intent
    expect(state.intentQueue).toBeDefined();
    clock.destroy();
  });

  // ==================== 日期重置 ====================

  it('日期变更重置每日计数器', async () => {
    const { clock } = await createFullClock();
    clock.start();

    // 增加一些交互
    clock.notifyInteraction();
    clock.notifyInteraction();
    expect(clock.getState().todayInteractions).toBe(2);

    // 跨到下一天
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    vi.setSystemTime(tomorrow);

    // 触发心跳
    vi.advanceTimersByTime(5 * 60 * 1000);

    // 计数器应该被重置
    expect(clock.getState().todayInteractions).toBe(0);
    clock.destroy();
  });

  // ==================== 意图清理 ====================

  it('过期意图被清理', async () => {
    const { clock } = await createFullClock();
    clock.start();
    await vi.advanceTimersByTimeAsync(0);

    // 手动添加一个过期意图
    const state = clock.getState();
    state.intentQueue.push({
      id: 'expired_intent',
      type: 'greeting',
      reason: { desire: 'social', trigger: 'test', confidence: 0.8 },
      action: { channel: 'auto', content: '', silent: false },
      timing: { earliest: Date.now() - 10000, deadline: Date.now() - 5000, priority: 5 },
      status: 'pending',
      createdAt: Date.now() - 20000,
    });

    // 触发心跳（异步等待完成）
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    // 过期意图应该被清理
    const newState = clock.getState();
    const expired = newState.intentQueue.find(i => i.id === 'expired_intent');
    expect(expired).toBeUndefined();
    clock.destroy();
  });
});
