/**
 * ProactiveEngine 测试 — 六种行为 / 通道选择 / LLM 生成
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ProactiveEngine', () => {
  async function createEngine(overrides: Record<string, any> = {}) {
    const { ProactiveEngine } = await import('../core/proactive-engine.js');

    const mockPlatform = {
      send: vi.fn().mockResolvedValue(undefined),
      platform: 'cli',
      ...overrides.platform,
    };

    const mockPlatformManager = {
      getActive: vi.fn().mockReturnValue(mockPlatform),
      ...overrides.platformManager,
    };

    const mockMemory = {
      getRecentMessages: vi.fn().mockReturnValue([]),
      ...overrides.memory,
    };

    const mockDream = {
      dream: vi.fn().mockResolvedValue({}),
      ...overrides.dream,
    };

    const mockLLM = {
      chat: vi.fn().mockResolvedValue({ text: '测试消息' }),
      ...overrides.llm,
    };

    const engine = new ProactiveEngine(
      mockPlatformManager as any,
      mockMemory as any,
      mockDream as any,
      mockLLM as any,
      '测试主人',
    );

    return { engine, mockPlatform, mockPlatformManager, mockMemory, mockDream, mockLLM };
  }

  function buildContext(overrides: Record<string, any> = {}): any {
    return {
      hour: 10,
      mood: 'calm',
      desires: { hunger: 20, curiosity: 30, social: 15, safety: 10, expression: 15, rest: 10 },
      routine: null,
      clockState: {
        phase: 'idle',
        lastInteraction: Date.now() - 3600000,
        lastProactive: 0,
        lastDream: 0,
        todayInteractions: 5,
        todayProactives: 0,
        todayDreams: 0,
        routines: [],
        intentQueue: [],
        reminders: [],
      },
      recentTopics: ['typescript', 'react'],
      ownerName: '测试主人',
      ...overrides,
    };
  }

  function buildIntent(overrides: Record<string, any> = {}): any {
    return {
      id: 'test_intent_1',
      type: 'greeting',
      reason: { desire: 'social', trigger: 'test', confidence: 0.8 },
      action: { channel: 'auto', content: '', silent: false },
      timing: { earliest: Date.now(), deadline: Date.now() + 900000, priority: 8 },
      status: 'pending',
      createdAt: Date.now(),
      ...overrides,
    };
  }

  // ==================== 问候 ====================

  it('执行问候行为', async () => {
    const { engine, mockPlatform, mockLLM } = await createEngine();
    mockLLM.chat.mockResolvedValue({ text: '早上好 ☀️' });

    const intent = buildIntent({ type: 'greeting' });
    const ctx = buildContext({ hour: 9 });
    const result = await engine.execute(intent, ctx);

    expect(result).toBe(true);
    expect(mockPlatform.send).toHaveBeenCalledWith('早上好 ☀️');
    expect(intent.status).toBe('executed');
    expect(intent.executedAt).toBeDefined();
  });

  it('问候不发太长的消息', async () => {
    const { engine, mockPlatform, mockLLM } = await createEngine();
    // LLM 返回超过 200 字的消息
    mockLLM.chat.mockResolvedValue({ text: 'x'.repeat(201) });

    const intent = buildIntent({ type: 'greeting' });
    const ctx = buildContext();
    const result = await engine.execute(intent, ctx);

    expect(result).toBe(false);
    expect(mockPlatform.send).not.toHaveBeenCalled();
  });

  // ==================== 关心 ====================

  it('执行关心行为', async () => {
    const { engine, mockPlatform, mockLLM } = await createEngine();
    mockLLM.chat.mockResolvedValue({ text: '下午会议准备好了吗？' });

    const intent = buildIntent({
      type: 'care',
      reason: { desire: 'social', trigger: '下午有会议', confidence: 0.7 },
    });
    const ctx = buildContext();
    const result = await engine.execute(intent, ctx);

    expect(result).toBe(true);
    expect(mockPlatform.send).toHaveBeenCalledWith('下午会议准备好了吗？');
  });

  // ==================== 自我维护 ====================

  it('执行梦境巩固', async () => {
    const { engine, mockDream } = await createEngine();

    const intent = buildIntent({
      type: 'maintenance',
      action: { channel: 'silent', content: 'dream', silent: true },
    });
    const ctx = buildContext();
    const result = await engine.execute(intent, ctx);

    expect(result).toBe(true);
    expect(mockDream.dream).toHaveBeenCalledWith('idle');
    expect(intent.status).toBe('executed');
  });

  it('自我维护静默执行不发消息', async () => {
    const { engine, mockPlatform } = await createEngine();

    const intent = buildIntent({
      type: 'maintenance',
      action: { channel: 'silent', content: 'dream', silent: true },
    });
    const ctx = buildContext();
    await engine.execute(intent, ctx);

    expect(mockPlatform.send).not.toHaveBeenCalled();
  });

  // ==================== 学习 ====================

  it('执行学习行为（静默标记）', async () => {
    const { engine, mockPlatform } = await createEngine();

    const intent = buildIntent({ type: 'learning' });
    const ctx = buildContext();
    const result = await engine.execute(intent, ctx);

    expect(result).toBe(true);
    expect(intent.status).toBe('executed');
    // 学习行为不发消息
    expect(mockPlatform.send).not.toHaveBeenCalled();
  });

  // ==================== 反思 ====================

  it('执行反思行为', async () => {
    const { engine, mockPlatform, mockLLM } = await createEngine();
    mockLLM.chat.mockResolvedValue({ text: '今天帮了5个问题，辛苦了' });

    const intent = buildIntent({ type: 'reflection' });
    const ctx = buildContext({
      hour: 22,
      clockState: {
        phase: 'idle',
        lastInteraction: Date.now(),
        lastProactive: 0,
        lastDream: 0,
        todayInteractions: 10,
        todayProactives: 3,
        todayDreams: 0,
        routines: [],
        intentQueue: [],
        reminders: [],
      },
    });
    const result = await engine.execute(intent, ctx);

    expect(result).toBe(true);
    expect(mockPlatform.send).toHaveBeenCalled();
  });

  // ==================== 提醒（不处理） ====================

  it('提醒类型返回 false（由 ReminderEngine 处理）', async () => {
    const { engine } = await createEngine();

    const intent = buildIntent({ type: 'reminder' });
    const ctx = buildContext();
    const result = await engine.execute(intent, ctx);

    expect(result).toBe(false);
  });

  // ==================== 通道选择 ====================

  it('无活跃平台时返回 false', async () => {
    const { engine } = await createEngine({
      platformManager: { getActive: () => null },
    });

    const intent = buildIntent({ type: 'greeting' });
    const ctx = buildContext();
    const result = await engine.execute(intent, ctx);

    expect(result).toBe(false);
  });

  it('silent 意图不通过平台发送', async () => {
    const { engine, mockPlatform } = await createEngine();

    const intent = buildIntent({
      type: 'maintenance',
      action: { channel: 'silent', content: 'dream', silent: true },
    });
    const ctx = buildContext();
    await engine.execute(intent, ctx);

    expect(mockPlatform.send).not.toHaveBeenCalled();
  });

  // ==================== LLM 失败处理 ====================

  it('LLM 调用失败时返回 false', async () => {
    const { engine } = await createEngine({
      llm: { chat: vi.fn().mockRejectedValue(new Error('LLM 暂不可用')) },
    });

    const intent = buildIntent({ type: 'greeting' });
    const ctx = buildContext();
    const result = await engine.execute(intent, ctx);

    expect(result).toBe(false);
  });

  it('LLM 返回空文本时返回 false', async () => {
    const { engine } = await createEngine({
      llm: { chat: vi.fn().mockResolvedValue({ text: '' }) },
    });

    const intent = buildIntent({ type: 'greeting' });
    const ctx = buildContext();
    const result = await engine.execute(intent, ctx);

    expect(result).toBe(false);
  });

  // ==================== dream 失败处理 ====================

  it('梦境巩固失败时返回 false', async () => {
    const { engine } = await createEngine({
      dream: { dream: vi.fn().mockRejectedValue(new Error('dream failed')) },
    });

    const intent = buildIntent({
      type: 'maintenance',
      action: { channel: 'silent', content: 'dream', silent: true },
    });
    const ctx = buildContext();
    const result = await engine.execute(intent, ctx);

    expect(result).toBe(false);
  });

  // ==================== buildContext ====================

  it('buildContext 静态方法', async () => {
    const { ProactiveEngine } = await import('../core/proactive-engine.js');

    const mockMemory = {
      getRecentMessages: vi.fn().mockReturnValue([
        { role: 'user', content: 'typescript 代码重构', timestamp: Date.now() },
      ]),
    };

    const clockState = {
      phase: 'idle',
      lastInteraction: Date.now(),
      lastProactive: 0,
      lastDream: 0,
      todayInteractions: 5,
      todayProactives: 0,
      todayDreams: 0,
      routines: [{
        id: 'r1',
        name: 'morning_work',
        typicalStart: { hour: 9, minute: 0, confidence: 0.8 },
        typicalEnd: { hour: 12, minute: 0, confidence: 0.8 },
        weekdays: [1, 2, 3, 4, 5],
        commonTopics: ['typescript', 'code'],
        preferredChannel: 'cli',
        moodTrend: 'neutral',
        observations: 20,
        lastSeen: Date.now(),
      }],
      intentQueue: [],
      reminders: [],
    };

    const ctx = ProactiveEngine.buildContext(
      10,
      'calm',
      { hunger: 20, curiosity: 30, social: 15, safety: 10, expression: 15, rest: 10 },
      clockState as any,
      mockMemory as any,
      '测试',
    );

    expect(ctx.hour).toBe(10);
    expect(ctx.mood).toBe('calm');
    expect(ctx.routine).not.toBeNull();
    expect(ctx.routine!.name).toBe('morning_work');
    expect(ctx.ownerName).toBe('测试');
  });

  // ==================== 未知类型 ====================

  it('未知行为类型返回 false', async () => {
    const { engine } = await createEngine();

    const intent = buildIntent({ type: 'unknown_type' });
    const ctx = buildContext();
    const result = await engine.execute(intent, ctx);

    expect(result).toBe(false);
  });
});
