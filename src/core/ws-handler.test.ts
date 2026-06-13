/**
 * WSHandler 单元测试 — 精简版
 * 覆盖：构造、消息路由、心跳、情绪广播、确认拦截、音频缓存
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 先 mock 所有依赖（vi.mock 会被提升到顶部）
vi.mock('./subsystems.js');
vi.mock('./message-processor.js');
vi.mock('./behavior-tracker.js');
vi.mock('./link-handler.js');
vi.mock('./task-queue.js');
vi.mock('./expert-pool.js');
vi.mock('./link-diagnostics.js');
vi.mock('./execution-session.js');
vi.mock('./concurrency-limiter.js');
// 不 mock constants.js — 使用真实模块
vi.mock('../config.js', () => ({
  patchConfig: vi.fn(async () => {}),
}));

import { WSHandler } from './ws-handler.js';
import { Subsystems } from './subsystems.js';
import { MessageProcessor } from './message-processor.js';
import { BehaviorTracker } from './behavior-tracker.js';

// 获取 mock 构造函数
const MockSubsystems = vi.mocked(Subsystems);
const MockMessageProcessor = vi.mocked(MessageProcessor);
const MockBehaviorTracker = vi.mocked(BehaviorTracker);

function createMockSys() {
  return {
    emotion: {
      getState: vi.fn(() => ({ mood: 'happy', energy: 80, satisfaction: 70, intensity: 0.6, isAuthentic: true })),
      onIdle: vi.fn(), onPet: vi.fn(), onThinking: vi.fn(), onToolSuccess: vi.fn(),
      onToolError: vi.fn(), onLLMError: vi.fn(), onTaskComplete: vi.fn(), reset: vi.fn(),
      getMood: vi.fn(() => 'happy'), getMoodEmoji: vi.fn(() => '😊'),
      setPersonality: vi.fn(), setIntimacy: vi.fn(), setPersonalityStrength: vi.fn(), applyBuff: vi.fn(),
    },
    pet: {
      getSummary: vi.fn(() => ({
        name: 'TestBuddy', species: 'fox', emoji: '🦊', evolutionStage: 'youth',
        stageName: '少年', stageEmoji: '🌱', stageDescription: 'desc', intimacy: 50,
        intimacyDescription: '朋友', behaviorSignals: {}, battleStats: {}, features: [],
        exploration: {}, guidance: null, stats: {}, visualSeed: {}, formProgress: 0,
        visualStage: 'default', rarity: 'common', rarityColor: '#aaa',
      })),
      getIntimacy: vi.fn(() => 50), trackFeature: vi.fn(() => ({ evolved: false, isNewDiscovery: false })),
      addIntimacy: vi.fn(), trackSpecialTimeFeature: vi.fn(), trackToolCall: vi.fn(),
      registerVisualSeed: vi.fn(), getNextGuidance: vi.fn(() => null), markGuidanceShown: vi.fn(),
      getBehaviorSignals: vi.fn(() => ({})), getOcean: vi.fn(() => null), getPersonalityStrength: vi.fn(() => 1),
      getGenome: vi.fn(() => ({
        species: 'fox', temperament: 'warm', texture: 'fluffy',
        colorPalette: ['#ff9900', '#ffffff'], pattern: 'solid',
        bodyShape: 'round', size: 'medium', eyeStyle: 'bright',
        personalityTraits: ['curious', 'friendly'],
        visualEffects: [], evolutionHints: [],
      })),
    },
    memory: { getStats: vi.fn(() => ({ nodes: 100 })), addMessage: vi.fn(), addDiaryEntry: vi.fn(), incrementInteraction: vi.fn() },
    stmp: { insertNode: vi.fn(), getStats: vi.fn(() => ({ nodes: 100 })) },
    tools: { list: vi.fn(() => []), getToolPanelData: vi.fn(() => ({ tools: [], recentExecutions: [] })), recordExecution: vi.fn(), recordUsage: vi.fn() },
    idle: { onBlink: vi.fn(), onAction: vi.fn(), start: vi.fn(), setDesires: vi.fn(), setOcean: vi.fn(), setPersonalityStrength: vi.fn() },
    desire: { getVector: vi.fn(() => ({ rest: 0.3 })), onDreamComplete: vi.fn(), onDiscovery: vi.fn() },
    cerebellum: {
      getLegacyState: vi.fn(() => ({ mood: 'happy', energy: 80, satisfaction: 70, intensity: 0.6, isAuthentic: true })),
      onIdle: vi.fn(), onPet: vi.fn(), onThinking: vi.fn(), onToolSuccess: vi.fn(),
      onToolError: vi.fn(), onLLMError: vi.fn(), onTaskComplete: vi.fn(), onDiscovery: vi.fn(),
      onDreamComplete: vi.fn(), reset: vi.fn(),
      getMood: vi.fn(() => 'happy'), getMoodEmoji: vi.fn(() => '😊'),
      setPersonality: vi.fn(), setIntimacy: vi.fn(), setPersonalityStrength: vi.fn(),
      applyBuff: vi.fn(), getDesires: vi.fn(() => ({ rest: 0.3, hunger: 20, curiosity: 20, social: 15, safety: 10, expression: 15 })),
    },
    dream: { shouldDream: vi.fn(() => false), dream: vi.fn() },
    llm: {
      chat: vi.fn(async () => ({ text: 'hello', toolCalls: [] })),
      getRouter: vi.fn(() => ({
        select: vi.fn(() => ({ id: 'primary', capabilities: {} })),
        getSummary: vi.fn(() => ({ primary: { provider: 'test', model: 'test' }, lightweight: null, fallbacks: [], localExperts: [], userOverride: null, learnedPrefs: {} })),
        clearUserOverride: vi.fn(), setUserOverride: vi.fn(), registerLocalExpert: vi.fn(),
      })),
      getPoolScheduler: vi.fn(() => null),
    },
    cognitive: { getAllDomainProfiles: vi.fn(() => []) },
    intelligence: { dream: vi.fn(async () => {}), save: vi.fn(async () => {}), evolver: { getEvents: vi.fn(() => []), getStagnation: vi.fn(() => null) } },
    subscriptionManager: { recordMessage: vi.fn(() => ({ allowed: true })) },
    entitlementChecker: { getUpgradePrompt: vi.fn(() => null) },
    audit: { logToolCall: vi.fn(), logToolResult: vi.fn(), logDecision: vi.fn() },
    tts: { isEnabled: vi.fn(() => false), synthesize: vi.fn() },
    experienceScheduler: { getAvailableDomains: vi.fn(() => []) },
    experiencePackageManager: { findByDomain: vi.fn(() => null) },
    skillFeedback: { recordFeedback: vi.fn() },
    knowledgeExporter: { exportAllMature: vi.fn(() => []) },
    ternaryRouter: { init: vi.fn(async () => {}), listExperts: vi.fn(() => []), query: vi.fn() },
    ternaryManager: { create: vi.fn(async () => {}), delete: vi.fn(async () => {}), getModelSizeEstimate: vi.fn(() => '1MB') },
    ternaryScheduler: { getPendingSummary: vi.fn(() => []), checkAndTrain: vi.fn(async () => null), addSamples: vi.fn() },
    ternaryGrowth: { getReport: vi.fn() },
    shopCatalog: { getAvailableItems: vi.fn(() => []), getEquippedItems: vi.fn(() => []) },
    mcpRegistry: { search: vi.fn(async () => []) },
    dagPlanner: { plan: vi.fn(async () => ({ tasks: new Map() })) },
    taskExecutor: { execute: vi.fn(async () => ({ summary: 'done', taskResults: [] })) },
    privacyManager: { isPrivacyMode: vi.fn(() => false), getActiveIndicators: vi.fn(() => []), getAuditLog: vi.fn(() => []), togglePrivacyMode: vi.fn(() => false) },
    perceptionBus: { publish: vi.fn(), getRecent: vi.fn(() => []), getStats: vi.fn(() => ({})) },
    beliefStore: { retrieve: vi.fn(() => []), size: 0 },
    entityStore: { search: vi.fn(() => []), getAll: vi.fn(() => []), size: 0 },
    fusionBuffer: { ingest: vi.fn(), flush: vi.fn(() => ({ merged: 1, contradictions: 0, associations: 0, durationMs: 10 })) },
    learn: { learnFromText: vi.fn() },
    feedback: { detectCorrection: vi.fn(() => null), applyCorrection: vi.fn() },
    paymentManager: { handleStripeWebhook: vi.fn(async () => true), handleAlipayWebhook: vi.fn(async () => true), handleWechatWebhook: vi.fn(async () => true) },
    reconfigureLLM: vi.fn(),
    feedTernaryScheduler: vi.fn(async () => 0),
    workflowManager: { createFromDAG: vi.fn(async () => ({ id: 'wf-1' })) },
  };
}

function createMockEventBus() {
  const handlers: Record<string, Function[]> = {};
  return {
    emit: vi.fn((event: any) => {
      const type = typeof event === 'string' ? event : event?.type;
      (handlers[type] ?? []).forEach(fn => fn(event));
    }),
    onMessage: vi.fn((fn: Function) => { (handlers['message'] ??= []).push(fn); }),
    onConnect: vi.fn((fn: Function) => { (handlers['connect'] ??= []).push(fn); }),
    onDisconnect: vi.fn((fn: Function) => { (handlers['disconnect'] ??= []).push(fn); }),
    addRoute: vi.fn(),
    clientCount: 1,
    _handlers: handlers,
  };
}

function createHandler() {
  const sys = createMockSys();
  MockSubsystems.mockImplementation(() => sys as any);
  MockMessageProcessor.mockImplementation(() => ({
    processBatch: vi.fn(async () => ({ text: 'ok', toolCalls: [] })),
    analyzeAndAsk: vi.fn(async () => null),
  } as any));
  MockBehaviorTracker.mockImplementation(() => ({ trackTool: vi.fn() } as any));

  const handler = new WSHandler(
    sys as any,
    { processBatch: vi.fn(async () => ({ text: 'ok', toolCalls: [] })), analyzeAndAsk: vi.fn(async () => null) } as any,
    { trackTool: vi.fn() } as any,
    {
      name: 'Test', species: 'fox', personality: { snark: 5, wisdom: 5, chaos: 3, patience: 5, debugging: 3 },
      ws: { port: 8765, processingTimeoutMs: 120000, maxConcurrent: 3 },
      llm: { provider: 'deepseek', model: 'deepseek-chat' },
    } as any,
    false,
  );
  return { handler, sys };
}

describe('WSHandler', () => {
  let handler: WSHandler;
  let sys: ReturnType<typeof createMockSys>;
  let eb: ReturnType<typeof createMockEventBus>;

  beforeEach(() => {
    vi.clearAllMocks();
    const created = createHandler();
    handler = created.handler;
    sys = created.sys;
    eb = createMockEventBus() as any;
    handler.setEventBus(eb as any);
  });

  describe('构造函数', () => {
    it('初始化成功', () => {
      expect(handler).toBeDefined();
      expect(handler.getTaskQueue()).toBeDefined();
      expect(handler.getExpertPool()).toBeDefined();
    });
    it('初始状态无 currentSession', () => {
      expect(handler.getCurrentSession()).toBeNull();
    });
    it('初始 userCorrectionCount 为 0', () => {
      expect(handler.getUserCorrectionCount()).toBe(0);
    });
  });

  describe('EventBus 管理', () => {
    it('getEventBus 返回设置的 eventBus', () => {
      expect(handler.getEventBus()).toBe(eb);
    });
    it('setEventBus 更新 eventBus', () => {
      const newEb = createMockEventBus();
      handler.setEventBus(newEb as any);
      expect(handler.getEventBus()).toBe(newEb);
    });
  });

  describe('确认拦截', () => {
    it('pendingConfirm 初始为 null', () => {
      expect(handler.getPendingConfirm()).toBeNull();
    });
    it('setPendingConfirm 更新确认状态', () => {
      const confirm = { id: 'c-1', resolve: vi.fn() };
      handler.setPendingConfirm(confirm);
      expect(handler.getPendingConfirm()).toBe(confirm);
    });
    it('tool_confirm_response 解除确认', () => {
      const resolve = vi.fn();
      handler.setPendingConfirm({ id: 'c-1', resolve });
      handler.setupWebSocket();
      const msgHandler = (eb.onMessage as any).mock.calls[0]?.[0];
      msgHandler?.({ type: 'tool_confirm_response', allowed: true });
      expect(resolve).toHaveBeenCalledWith(true);
      expect(handler.getPendingConfirm()).toBeNull();
    });

    it('waitForConfirmation: 收到 allowed=true 时 resolve(true)', async () => {
      handler.setupWebSocket();
      const msgHandler = (eb.onMessage as any).mock.calls[0]?.[0];

      // 通过 private 访问触发 waitForConfirmation
      const promise = (handler as any).waitForConfirmation('test-confirm-1', 5000);

      // 确认 pendingConfirm 已设置
      expect(handler.getPendingConfirm('test-confirm-1')).not.toBeNull();

      // 模拟前端回复
      msgHandler?.({ type: 'tool_confirm_response', id: 'test-confirm-1', allowed: true });

      const result = await promise;
      expect(result).toBe(true);
      expect(handler.getPendingConfirm('test-confirm-1')).toBeNull();
    });

    it('waitForConfirmation: 收到 allowed=false 时 resolve(false)', async () => {
      handler.setupWebSocket();
      const msgHandler = (eb.onMessage as any).mock.calls[0]?.[0];

      const promise = (handler as any).waitForConfirmation('test-confirm-2', 5000);
      msgHandler?.({ type: 'tool_confirm_response', id: 'test-confirm-2', allowed: false });

      const result = await promise;
      expect(result).toBe(false);
    });

    it('waitForConfirmation: 超时后 resolve(false)', async () => {
      // 用极短超时测试
      const promise = (handler as any).waitForConfirmation('test-confirm-3', 50);

      // 不发送任何回复，等待超时
      const result = await promise;
      expect(result).toBe(false);
      expect(handler.getPendingConfirm('test-confirm-3')).toBeNull();
    });

    it('waitForConfirmation: 无 id 匹配时不影响其他确认', async () => {
      handler.setupWebSocket();
      const msgHandler = (eb.onMessage as any).mock.calls[0]?.[0];

      const promise1 = (handler as any).waitForConfirmation('confirm-a', 5000);
      const promise2 = (handler as any).waitForConfirmation('confirm-b', 5000);

      // 只回复 confirm-b
      msgHandler?.({ type: 'tool_confirm_response', id: 'confirm-b', allowed: true });

      const result2 = await promise2;
      expect(result2).toBe(true);

      // confirm-a 仍然 pending
      expect(handler.getPendingConfirm('confirm-a')).not.toBeNull();

      // 超时清理
      const result1 = await promise1;
      // promise1 还没 resolve（超时 5s），手动回复
      msgHandler?.({ type: 'tool_confirm_response', id: 'confirm-a', allowed: true });
    });
  });

  describe('消息路由', () => {
    it('setupWebSocket 注册消息处理器', () => {
      handler.setupWebSocket();
      expect(eb.onMessage).toHaveBeenCalled();
    });
    it('ping 消息回复 pong', () => {
      handler.setupWebSocket();
      const msgHandler = (eb.onMessage as any).mock.calls[0][0];
      msgHandler({ type: 'ping', ts: 12345 });
      expect(eb.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'status' }));
    });
    it('pong 消息被忽略', () => {
      handler.setupWebSocket();
      const msgHandler = (eb.onMessage as any).mock.calls[0][0];
      msgHandler({ type: 'pong' }); // 不应抛错
    });
    it('带 id 的消息触发处理', () => {
      handler.setupWebSocket();
      const msgHandler = (eb.onMessage as any).mock.calls[0][0];
      // 带 id 的消息不应抛错（ACK 由 LinkHandler 内部处理）
      msgHandler({ type: 'pet', id: 'msg-123' });
      // 有 id 的消息会经过 shouldProcess 和 createAck，不抛错即通过
    });
    it('command 消息路由到 handleCommand', () => {
      handler.setupWebSocket();
      const msgHandler = (eb.onMessage as any).mock.calls[0][0];
      msgHandler({ type: 'command', command: 'status' });
      expect(eb.emit).toHaveBeenCalled();
    });
  });

  describe('情绪广播', () => {
    it('broadcastEmotion 发送 emotion 事件', () => {
      handler.broadcastEmotion();
      expect(eb.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'emotion', mood: 'happy', energy: 80 }));
    });
    it('broadcastStatus 发送完整状态', () => {
      handler.broadcastStatus();
      expect(eb.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'status',
        data: expect.objectContaining({ name: 'TestBuddy', species: 'fox' }),
      }));
    });
  });

  describe('用户纠正', () => {
    it('recordUserCorrection 增加计数', () => {
      handler.recordUserCorrection();
      expect(handler.getUserCorrectionCount()).toBe(1);
      handler.recordUserCorrection();
      expect(handler.getUserCorrectionCount()).toBe(2);
    });
  });

  describe('音频缓存', () => {
    it('getAudio 返回 null 对于不存在的 id', () => {
      expect(handler.getAudio('nonexistent')).toBeNull();
    });
    it('getAudio 取出后删除（一次性）', () => {
      (handler as any).audioCache.set('audio-1', 'base64data', 'mp3');
      const result = handler.getAudio('audio-1');
      expect(result).toEqual({ data: 'base64data', format: 'mp3' });
      expect(handler.getAudio('audio-1')).toBeNull();
    });
  });

  describe('概念提取', () => {
    it('extractConcepts 提取中文关键词', () => {
      const concepts = (handler as any).extractConcepts('今天天气很好适合出去玩');
      expect(concepts.some((c: string) => c.includes('天气') || c.includes('今天'))).toBe(true);
    });
    it('extractConcepts 提取英文单词', () => {
      const concepts = (handler as any).extractConcepts('Hello World Test');
      expect(concepts).toContain('hello');
      expect(concepts).toContain('world');
    });
    it('extractConcepts 去重', () => {
      const concepts = (handler as any).extractConcepts('测试 测试 测试');
      const testCount = concepts.filter((c: string) => c === '测试').length;
      expect(testCount).toBe(1);
    });
    it('extractConcepts 限制 20 个', () => {
      const longText = Array.from({ length: 50 }, (_, i) => `词${i}`).join(' ');
      const concepts = (handler as any).extractConcepts(longText);
      expect(concepts.length).toBeLessThanOrEqual(20);
    });
  });

  describe('REST 路由', () => {
    it('setupREST 注册 API 路由', () => {
      handler.setupREST();
      const registeredPaths = (eb.addRoute as any).mock.calls.map((c: any[]) => `${c[0]} ${c[1]}`);
      expect(registeredPaths).toContain('GET /api/status');
      expect(registeredPaths).toContain('GET /api/health');
      expect(registeredPaths).toContain('POST /api/chat');
      expect(registeredPaths).toContain('GET /api/config');
      expect(registeredPaths).toContain('GET /api/diagnostics');
    });
  });

  describe('文件变更', () => {
    it('handleFileChange 记录到 STMP', () => {
      handler.handleFileChange({ type: 'change', path: 'src/main.ts', relativePath: 'src/main.ts', extension: '.ts', timestamp: Date.now() });
      expect(eb.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'bubble' }));
    });
  });

  describe('情绪源处理', () => {
    it('handleEmotionSource 高置信度注入 buff', () => {
      handler.handleEmotionSource({ mood: 'happy', confidence: 0.8 });
      expect(sys.cerebellum.applyBuff).toHaveBeenCalled();
    });
    it('handleEmotionSource 低置信度忽略', () => {
      handler.handleEmotionSource({ mood: 'happy', confidence: 0.1 });
      expect(sys.cerebellum.applyBuff).not.toHaveBeenCalled();
    });
  });

  describe('视觉种子', () => {
    it('handleVisualSeed 注册视觉种子', () => {
      handler.handleVisualSeed({ primaryColor: '#ff0000', texture: 'sharp', temperament: 'cool', seed: 42 });
      expect(sys.pet.registerVisualSeed).toHaveBeenCalled();
    });
  });

  describe('宠物交互', () => {
    it('handlePet 触发情绪和状态广播', () => {
      handler.handlePet();
      expect(eb.emit).toHaveBeenCalled();
    });
  });
});
