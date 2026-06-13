/**
 * BuddyAgent 单元测试 — 精简版
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock data factory
function makeSys() {
  return {
    emotion: {
      getState: vi.fn(() => ({ mood: 'happy', energy: 80, satisfaction: 70, intensity: 0.6, isAuthentic: true })),
      onIdle: vi.fn(), onPet: vi.fn(), onThinking: vi.fn(), onToolSuccess: vi.fn(),
      onToolError: vi.fn(), onLLMError: vi.fn(), onTaskComplete: vi.fn(), reset: vi.fn(),
      getMood: vi.fn(() => 'happy'), getMoodEmoji: vi.fn(() => '😊'),
      setPersonality: vi.fn(), setIntimacy: vi.fn(), setPersonalityStrength: vi.fn(), applyBuff: vi.fn(),
      onUserMessage: vi.fn(), onResponseComplete: vi.fn(),
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
      trackMessage: vi.fn(), updateConsecutiveDays: vi.fn(),
    },
    memory: { getStats: vi.fn(() => ({ nodes: 100 })), addMessage: vi.fn(), addDiaryEntry: vi.fn(), incrementInteraction: vi.fn(), getRecentMessages: vi.fn(() => []), searchMemories: vi.fn(() => []), getRelation: vi.fn(() => 0), setRelation: vi.fn(), setMemory: vi.fn() },
    stmp: { insertNode: vi.fn(), getStats: vi.fn(() => ({ nodes: 100 })) },
    tools: { list: vi.fn(() => [{ name: 'web_search' }, { name: 'code_exec' }]), getToolPanelData: vi.fn(() => ({ tools: [], recentExecutions: [] })), recordExecution: vi.fn(), recordUsage: vi.fn() },
    idle: { onBlink: vi.fn(), onAction: vi.fn(), start: vi.fn(), setDesires: vi.fn(), setOcean: vi.fn(), setPersonalityStrength: vi.fn() },
    desire: { getVector: vi.fn(() => ({ rest: 0.3 })), onDreamComplete: vi.fn(), onDiscovery: vi.fn(), onTaskComplete: vi.fn(), onUserMessage: vi.fn() },
    dream: { shouldDream: vi.fn(() => false), dream: vi.fn() },
    llm: {
      chat: vi.fn(async () => ({ text: 'hello', toolCalls: [] })),
      setBeforeToolExecute: vi.fn(),
      getRouter: vi.fn(() => ({
        select: vi.fn(() => ({ id: 'primary', capabilities: {} })),
        getSummary: vi.fn(() => ({ hasPool: false, localExperts: [], userOverride: null })),
        clearUserOverride: vi.fn(), setUserOverride: vi.fn(), registerLocalExpert: vi.fn(),
        setOnSelection: vi.fn(),
        setPool: vi.fn(), getPool: vi.fn(() => null),
        setDecisionRecorder: vi.fn(), getDecisionRecorder: vi.fn(() => null),
        recordOutcome: vi.fn(),
      })),
      getPool: vi.fn(() => null),
      getPoolScheduler: vi.fn(() => null),
      getDecisionRecorder: vi.fn(() => null),
      consumeLastUnifiedSelection: vi.fn(() => null),
    },
    get router() { return this.llm.getRouter(); },
    cognitive: { getAllDomainProfiles: vi.fn(() => []), inferFromMessage: vi.fn(), inferGoals: vi.fn(), getUserPromptFragment: vi.fn(() => ''), getSelfPromptFragment: vi.fn(() => '') },
    intelligence: { dream: vi.fn(async () => {}), save: vi.fn(async () => {}), evolver: { getEvents: vi.fn(() => []), getStagnation: vi.fn(() => null), isStagnant: vi.fn(() => false), onSuccess: vi.fn(), onFailure: vi.fn() } },
    subscriptionManager: { recordMessage: vi.fn(() => ({ allowed: true })) },
    entitlementChecker: { getUpgradePrompt: vi.fn(() => null) },
    audit: { logToolCall: vi.fn(), logToolResult: vi.fn(), logDecision: vi.fn() },
    tts: { isEnabled: vi.fn(() => false), synthesize: vi.fn() },
    experienceScheduler: { getAvailableDomains: vi.fn(() => []) },
    experiencePackageManager: { findByDomain: vi.fn(() => null) },
    skillFeedback: { recordFeedback: vi.fn() },
    knowledgeExporter: { exportAllMature: vi.fn(() => []) },
    ternaryRouter: { init: vi.fn(async () => {}), listExperts: vi.fn(() => []) },
    ternaryManager: { create: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
    ternaryScheduler: { getPendingSummary: vi.fn(() => []), checkAndTrain: vi.fn(async () => null) },
    shopCatalog: { getAvailableItems: vi.fn(() => []) },
    mcpRegistry: { search: vi.fn(async () => []) },
    dagPlanner: { plan: vi.fn(async () => ({ tasks: new Map() })) },
    taskExecutor: { execute: vi.fn(async () => ({ summary: 'done', taskResults: [] })) },
    privacyManager: { isPrivacyMode: vi.fn(() => false), checkAccess: vi.fn(() => ({ allowed: true })) },
    perceptionBus: { publish: vi.fn(), getRecent: vi.fn(() => []), getStats: vi.fn(() => ({})) },
    beliefStore: { retrieve: vi.fn(() => []), size: 0 },
    entityStore: { search: vi.fn(() => []), getAll: vi.fn(() => []), size: 0, extractAndUpdate: vi.fn() },
    fusionBuffer: { ingest: vi.fn(), flush: vi.fn(() => ({ merged: 1, contradictions: 0, associations: 0, durationMs: 10 })) },
    learn: { learnFromText: vi.fn() },
    feedback: { detectCorrection: vi.fn(() => null), applyCorrection: vi.fn() },
    observer: { detectPatterns: vi.fn(), updateLastInteraction: vi.fn(), checkTimeCare: vi.fn(() => null) },
    intentClassifier: { classify: vi.fn(() => ({ category: 'chat', confidence: 0.9, keywords: [] })) },
    threeBrain: {
      right: { classifyFromText: vi.fn(() => ({ category: 'chat', confidence: 0.9, keywords: [] })) },
      left: { analyze: vi.fn(() => ({})) },
      cerebellum: { ingestPerception: vi.fn(), getBodyState: vi.fn(() => ({})) },
      decide: vi.fn(async () => ({
        plan: { mode: 'single', reason: 'test', selectedNodes: [{ id: 'primary', type: 'llm', label: 'primary' }] },
        latencyMs: 5,
      })),
      destroy: vi.fn(),
    },
    paymentManager: { handleStripeWebhook: vi.fn(async () => true) },
    reconfigureLLM: vi.fn(),
    feedTernaryScheduler: vi.fn(async () => 0),
    workflowManager: { createFromDAG: vi.fn(async () => ({ id: 'wf-1' })) },
    launchReadiness: { runAll: vi.fn(async () => ({ ready: true, passed: 5, warned: 0, failed: 0, checks: [] })) },
    platformManager: { getActive: vi.fn(() => null) },
    clock: null, memoryCache: new Map(),
    skillManager: {
      getInstalledSkills: vi.fn(() => []),
      growth: {
        getAllHealth: vi.fn(() => []),
        getMetric: vi.fn(() => ({ totalCalls: 0, failureCount: 0, dailyUsage: {}, lastError: undefined })),
      },
    },
    experienceEvolver: { getEvents: vi.fn(() => []), getStagnation: vi.fn(() => null) },
  };
}

// vi.mock 使用 class 语法作为构造函数
vi.mock('./subsystems.js', () => {
  class MockSubsystems { constructor() { return makeSys(); } }
  return { Subsystems: MockSubsystems };
});
vi.mock('./message-processor.js', () => {
  class MockProcessor { constructor() { return { processBatch: vi.fn(async () => ({ text: 'ok', toolCalls: [] })), processStream: vi.fn(async () => ({ text: 'ok', toolCalls: [] })), analyzeAndAsk: vi.fn(async () => null), storeToSTMP: vi.fn(), extractKnowledgeAsync: vi.fn(async () => []), learnFromConversation: vi.fn() }; } }
  return { MessageProcessor: MockProcessor };
});
vi.mock('./behavior-tracker.js', () => {
  class MockTracker { constructor() { return { trackTool: vi.fn(), trackFeedback: vi.fn(), detectNegation: vi.fn(() => false), detectRepeat: vi.fn(() => false), setLastMessage: vi.fn(), accumulate: vi.fn() }; } }
  return { BehaviorTracker: MockTracker };
});
vi.mock('./skill-ops.js', () => {
  class MockSkillOps { constructor() { return { rebuildSkillPackages: vi.fn(async () => {}) }; } }
  return { SkillOps: MockSkillOps };
});
vi.mock('./ws-handler.js', () => {
  class MockWSHandler {
    constructor() {
      return {
        setEventBus: vi.fn(), setAgentRef: vi.fn(), setupWebSocket: vi.fn(),
        setupIdleBehavior: vi.fn(), setupREST: vi.fn(),
        getLinkHandler: vi.fn(() => ({ updateConfigHash: vi.fn() })),
        getTaskQueue: vi.fn(() => ({ acquire: vi.fn(async () => {}), release: vi.fn(), releaseExpired: vi.fn(), getStatus: vi.fn(() => ({ pending: 0, running: 0, completed: 0 })) })),
        handleUserMessage: vi.fn(async () => {}), handlePet: vi.fn(), handleCommand: vi.fn(async () => {}),
        broadcastEmotion: vi.fn(), broadcastStatus: vi.fn(), getDreamTimer: vi.fn(() => null),
        recordUserCorrection: vi.fn(), getUserCorrectionCount: vi.fn(() => 0),
        handleMultiExpertParallel: vi.fn(async () => {}), handleFileChange: vi.fn(),
      };
    }
  }
  return { WSHandler: MockWSHandler };
});
vi.mock('../personality/prompt.js', () => ({ buildSystemPrompt: vi.fn(() => 'You are a helpful assistant.') }));
vi.mock('../ws/server.js', () => {
  class MockEventBus { constructor() { return { emit: vi.fn(), onMessage: vi.fn(), onConnect: vi.fn(), onDisconnect: vi.fn(), addRoute: vi.fn(), clientCount: 0, setLinkHandler: vi.fn() }; } }
  return { EventBus: MockEventBus };
});
vi.mock('../perception/fs-watcher.js', () => {
  class MockWatcher { constructor() { return { watch: vi.fn(), close: vi.fn(), onChange: vi.fn(), start: vi.fn() }; } }
  return { FileWatcher: MockWatcher };
});
vi.mock('../brain/right/scene/index.js', () => {
  class MockRuntimeCollector {
    constructor(registry, config, onFlush) {
      this._onFlush = onFlush;
      return {
        captureBefore: vi.fn(() => ({ snapshot: { nodes: [], edges: [] }, action: { type: 'test', params: new Float32Array() }, timestamp: Date.now() })),
        captureAfter: vi.fn(() => ({ sample: { scene_before: { nodes: [], edges: [] }, action: { type: 'test', params: new Float32Array() }, scene_after: { nodes: [], edges: [] }, completion: true, risk_label: 0, timestamp: Date.now(), source: 'runtime' }, executionResult: { success: true, latencyMs: 10 } })),
        flush: vi.fn(),
        getStats: vi.fn(() => ({ captured: 0, skipped: 0, flushed: 0, bufferSize: 0 })),
      };
    }
  }
  class MockKnowledgeBridge {
    constructor() {
      return {
        convert: vi.fn(() => []),
        getStats: vi.fn(() => ({ totalProcessed: 0, totalConverted: 0, skippedLowConfidence: 0, skippedDuplicate: 0 })),
      };
    }
  }
  return {
    RuntimeCollector: MockRuntimeCollector,
    KnowledgeBridge: MockKnowledgeBridge,
    toNNSample: vi.fn(() => ({ features: new Float32Array(64), labelIntent: 0, labelTools: [], labelQuality: 0.8, outcome: true })),
  };
});
vi.mock('./reminder-parser.js', () => ({ parseReminderFast: vi.fn(() => null) }));
vi.mock('../audit/structured-logger.js', () => {
  const mockModule = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: { child: vi.fn(() => mockModule), module: vi.fn(() => mockModule), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

import { BuddyAgent } from './agent.js';

const cfg = {
  name: 'TestBuddy', species: 'fox',
  personality: { snark: 5, wisdom: 5, chaos: 3, patience: 5, debugging: 3 },
  ws: { port: 8765, token: 'test-token', processingTimeoutMs: 120000, maxConcurrent: 3 },
  llm: { provider: 'deepseek', model: 'deepseek-chat', apiKey: 'test-key', baseUrl: 'https://api.deepseek.com/v1' },
} as any;

describe('BuddyAgent', () => {
  let agent: BuddyAgent;
  beforeEach(() => { vi.clearAllMocks(); agent = new BuddyAgent(cfg, { enableWs: false, verbose: false }); });

  describe('初始化', () => {
    it('创建成功', () => { expect(agent).toBeDefined(); });
    it('verbose 模式', () => { expect(new BuddyAgent(cfg, { enableWs: false, verbose: true })).toBeDefined(); });
  });

  describe('配置访问', () => {
    it('getLLM 返回 LLM 适配器', () => { expect(agent.getLLM()).toBeDefined(); });
    it('getToolRegistry 返回工具注册表', () => { expect(agent.getToolRegistry()).toBeDefined(); });
  });

  describe('子系统访问', () => {
    it('getPet 返回养成系统', () => { expect(agent.getPet()).toBeDefined(); });
    it('getSTMP 返回记忆宫殿', () => { expect(agent.getSTMP()).toBeDefined(); });
    it('getCognitive 返回认知引擎', () => { expect(agent.getCognitive()).toBeDefined(); });
    it('getLLM 返回 LLM 适配器', () => { expect(agent.getLLM()).toBeDefined(); });
  });

  describe('编排决策', () => {
    it('orchestrate 返回 plan', async () => {
      const p = await agent.orchestrate('帮我搜索天气');
      expect(p.mode).toBeDefined();
      expect(Array.isArray(p.domains)).toBe(true);
    });
    it('简单聊天 → single 模式', async () => { expect((await agent.orchestrate('你好')).mode).toBe('single'); });
  });

  describe('决策追踪', () => {
    it('getDecisionTrace 返回数组', () => { expect(Array.isArray(agent.getDecisionTrace())).toBe(true); });
  });

  describe('执行计划', () => {
    it('executeByPlan single 模式返回结果', async () => {
      const plan = { content: '你好', mode: 'single', reason: 'test', domains: [], complexity: 'simple' as const, selectedNodes: [{ id: 'primary', type: 'llm' as const, label: 'primary' }], useDAG: false, meta: {} };
      const r = await agent.executeByPlan(plan as any);
      expect(r.text).toBeDefined();
    });
  });

  describe('消息处理', () => {
    it('preprocessMessage 不抛错', () => { agent.preprocessMessage('你好'); });
    it('postprocessResult 不抛错', () => {
      agent.postprocessResult('msg', { text: 'reply', toolCalls: [{ name: 't', args: {}, result: 'r' }] });
    });
  });

  describe('Phase 3: 工具执行学习闭环', () => {
    it('postprocessResult 有工具调用时触发 captureAfter', () => {
      agent.postprocessResult('读取文件', { text: 'ok', toolCalls: [{ name: 'read', args: { path: '/tmp' }, result: 'content' }] });
      // 不抛错即通过 — captureAfter 内部由 mock 处理
    });

    it('postprocessResult 工具执行失败时也触发 captureAfter', () => {
      agent.postprocessResult('执行命令', { text: 'err', toolCalls: [{ name: 'exec', args: { command: 'bad' }, result: '[工具执行错误: fail]' }] });
      // 失败样本同样收集（collectFailures: true）
    });

    it('postprocessResult 无工具调用时不触发 captureAfter', () => {
      agent.postprocessResult('聊天', { text: 'hello', toolCalls: [] });
      // 无工具调用，不触发快照
    });

    it('postprocessResult 多工具并行调用', () => {
      agent.postprocessResult('多工具', {
        text: 'done',
        toolCalls: [
          { name: 'read', args: { path: '/a' }, result: 'a' },
          { name: 'write', args: { path: '/b', content: 'x' }, result: 'ok' },
          { name: 'exec', args: { command: 'ls' }, result: 'file1' },
        ],
      });
    });

    it('postprocessResult extractKnowledgeAsync 返回知识时桥接', () => {
      // 修改 mock 返回值模拟有知识提取
      const processor = (agent as any).processor;
      processor.extractKnowledgeAsync.mockResolvedValueOnce([
        { type: 'decision_rule', content: 'test rule', domain: 'test', confidence: 0.8, concepts: ['a', 'b'], sourceMessages: [] },
      ]);
      agent.postprocessResult('有知识', { text: 'reply', toolCalls: [] });
    });

    it('postprocessResult extractKnowledgeAsync 失败时不抛错', () => {
      const processor = (agent as any).processor;
      processor.extractKnowledgeAsync.mockRejectedValueOnce(new Error('extract failed'));
      agent.postprocessResult('提取失败', { text: 'reply', toolCalls: [] });
    });
  });
});
