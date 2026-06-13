/**
 * Subsystems 容器测试
 *
 * 由于 Subsystems 构造函数初始化 50+ 模块（依赖 DB、LLM 等），
 * 采用 vi.mock 重度依赖 + 测试类结构/关键方法的策略。
 *
 * 所有 vi.mock 使用工厂函数返回 class-like 函数
 * 以确保 `new Constructor()` 在 ESM 下正常工作。
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as path from 'path';

// ════════════════════════════════════════════════════════════════
// 1. Mock 所有重度依赖
// ════════════════════════════════════════════════════════════════

// Helper: 创建一个可用 new 调用的 mock 实例对象
function mockInstance(methods: Record<string, any> = {}) {
  return { ...methods };
}

// ─── LLM ───
const mockLLMInstance = mockInstance({
  chat: vi.fn().mockResolvedValue({ text: 'mock-response' }),
  initPool: vi.fn(),
  warmupPool: vi.fn().mockResolvedValue(undefined),
  getRouter: vi.fn().mockReturnValue({
    registerLocalExpert: vi.fn(),
    setOnSelection: vi.fn(),
    setPool: vi.fn(),
    getPool: vi.fn().mockReturnValue(null),
    setDecisionRecorder: vi.fn(),
    getDecisionRecorder: vi.fn().mockReturnValue(null),
    select: vi.fn(),
    recordOutcome: vi.fn(),
  }),
  getPoolScheduler: vi.fn().mockReturnValue(null),
  setDecisionRecorder: vi.fn(),
  setPool: vi.fn(),
  getPool: vi.fn().mockReturnValue(null),
  consumeLastUnifiedSelection: vi.fn().mockReturnValue(null),
  updateProvider: vi.fn(),
});

vi.mock('./llm.js', () => ({
  LLMAdapter: function MockLLMAdapter(..._args: any[]) {
    Object.assign(this, mockLLMInstance);
  },
}));

// ─── Tools ───
const mockToolRegistry = mockInstance({
  registerMany: vi.fn(),
  get: vi.fn(),
  getAll: vi.fn().mockReturnValue([]),
});

vi.mock('../tools/registry.js', () => ({
  ToolRegistry: function MockToolRegistry() {
    Object.assign(this, mockToolRegistry);
  },
}));
vi.mock('../tools/builtin.js', () => ({ ALL_TOOLS: [] }));
vi.mock('../tools/voice.js', () => ({ createVoiceTools: vi.fn().mockReturnValue([]) }));

const mockMCPAdapter = mockInstance({
  connect: vi.fn().mockResolvedValue([]),
  registerAsToolDefs: vi.fn().mockReturnValue([]),
  disconnectAll: vi.fn().mockResolvedValue(undefined),
});

vi.mock('../tools/mcp-adapter.js', () => ({
  MCPAdapter: function MockMCPAdapter() {
    Object.assign(this, mockMCPAdapter);
  },
}));
vi.mock('../tools/tool-retriever.js', () => ({
  ToolRetriever: function MockToolRetriever() {},
}));

const mockTernaryRouter = mockInstance({
  init: vi.fn().mockResolvedValue(undefined),
  listExperts: vi.fn().mockReturnValue([]),
  query: vi.fn().mockResolvedValue({ answer: '' }),
});

vi.mock('../tools/ternary-expert.js', () => ({
  TernaryExpertRouter: function MockTernaryRouter() {
    Object.assign(this, mockTernaryRouter);
  },
  createTernaryTools: vi.fn().mockReturnValue([]),
}));
vi.mock('../tools/cache.js', () => ({
  globalToolCache: { purge: vi.fn().mockReturnValue(0) },
  globalSemanticCache: { purge: vi.fn().mockReturnValue(0) },
}));
vi.mock('../tools/tool-chain.js', () => ({
  executeChain: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('../tools/mcp-registry.js', () => ({
  MCPRegistry: function MockMCPRegistry() {},
}));

// ─── Memory ───
const mockMemory = mockInstance({ close: vi.fn(), add: vi.fn().mockResolvedValue(undefined) });
vi.mock('../memory/store.js', () => ({
  MemoryStore: function MockMemoryStore() {
    Object.assign(this, mockMemory);
  },
}));

const mockSTMP = mockInstance({
  setLLMCaller: vi.fn(),
  retrieve: vi.fn().mockResolvedValue({ primary: [], associative: [] }),
  close: vi.fn(),
});
vi.mock('../memory/stmp.js', () => ({
  STMPStore: function MockSTMPStore() {
    Object.assign(this, mockSTMP);
  },
}));
vi.mock('../memory/dream.js', () => ({
  DreamEngine: function MockDreamEngine() {
    Object.assign(this, { setLLMCaller: vi.fn() });
  },
}));

const mockBeliefStore = mockInstance({ loadFromDisk: vi.fn(), saveToDisk: vi.fn(), size: 0 });
vi.mock('../memory/belief-store.js', () => ({
  BeliefStore: function MockBeliefStore() {
    Object.assign(this, mockBeliefStore);
  },
}));

const mockEntityStore = mockInstance({ loadFromDisk: vi.fn(), saveToDisk: vi.fn(), size: 0 });
vi.mock('../memory/entity-store.js', () => ({
  EntityStore: function MockEntityStore() {
    Object.assign(this, mockEntityStore);
  },
}));

// ─── Cognitive ───
const mockCognitive = mockInstance({
  getAllDomainProfiles: vi.fn().mockReturnValue([]),
  close: vi.fn(),
});
vi.mock('../cognitive/engine.js', () => ({
  CognitiveEngine: function MockCognitiveEngine() {
    Object.assign(this, mockCognitive);
  },
}));
vi.mock('../knowledge/extractor.js', () => ({
  KnowledgeExtractor: function MockKE() {
    Object.assign(this, { setLLMCaller: vi.fn() });
  },
}));
vi.mock('../knowledge/learn.js', () => ({
  BuddyLearn: function MockBuddyLearn() {
    Object.assign(this, { setConvergenceCallback: vi.fn() });
  },
}));

// ─── Intelligence ───
const mockEvolver = mockInstance({
  setConvergenceCallback: vi.fn(),
  getEvents: vi.fn().mockReturnValue([]),
  getStagnation: vi.fn().mockReturnValue(null),
});
const mockIntelligence = mockInstance({
  init: vi.fn().mockResolvedValue(undefined),
  save: vi.fn().mockResolvedValue(undefined),
  setToolSynthesizer: vi.fn(),
  evolver: mockEvolver,
});
vi.mock('../intelligence/index.js', () => ({
  ExperienceEngine: function MockExpEngine() {
    Object.assign(this, mockIntelligence);
  },
}));
vi.mock('../intelligence/knowledge-export.js', () => ({
  KnowledgeExporter: function MockKE() {},
}));
vi.mock('../intelligence/knowledge-interviewer.js', () => ({
  KnowledgeInterviewer: function MockKI() {
    Object.assign(this, { setLLMCaller: vi.fn() });
  },
}));
vi.mock('../intelligence/data-augmentor.js', () => ({
  DataAugmentor: function MockDA() {
    Object.assign(this, { setLLMCaller: vi.fn() });
  },
}));

// ─── Emotion / Desire / Idle ───
const mockEmotion = mockInstance({ destroy: vi.fn() });
vi.mock('../emotion/engine.js', () => ({
  EmotionEngine: function MockEmotionEngine() {
    Object.assign(this, mockEmotion);
  },
}));

const mockDesire = mockInstance({ destroy: vi.fn() });
vi.mock('../desire/engine.js', () => ({
  DesireEngine: function MockDesireEngine() {
    Object.assign(this, mockDesire);
  },
}));

const mockIdle = mockInstance({ stop: vi.fn() });
vi.mock('../behavior/idle.js', () => ({
  IdleBehavior: function MockIdleBehavior() {
    Object.assign(this, mockIdle);
  },
}));

// ─── Audit / Voice ───
const mockAudit = mockInstance({ close: vi.fn() });
vi.mock('../audit/logger.js', () => ({
  AuditLogger: function MockAuditLogger() {
    Object.assign(this, mockAudit);
  },
}));

const mockTTS = mockInstance({
  registerBackend: vi.fn(),
  setEnabled: vi.fn(),
  getVoiceForSpecies: vi.fn().mockReturnValue(null),
  setDefaultOptions: vi.fn(),
});
vi.mock('../voice/tts.js', () => ({
  TTSManager: function MockTTSManager() {
    Object.assign(this, mockTTS);
  },
}));
vi.mock('../voice/edge-tts.js', () => ({
  EdgeTTSBackend: function MockEdgeTTS() {},
}));

// ─── Orchestration ───
vi.mock('../orchestrate/index.js', () => ({
  WorkflowManager: function MockWM() {
    Object.assign(this, { init: vi.fn().mockResolvedValue(undefined) });
  },
  DAGPlanner: function MockDAG() {
    Object.assign(this, { setScheduler: vi.fn() });
  },
  TaskExecutor: function MockTE() {},
}));

// ─── Intent Classifier ───
vi.mock('./intent-classifier.js', () => ({
  IntentClassifier: function MockIC() {},
}));

// ─── Pet ───
const mockPet = mockInstance({
  getBehaviorSignals: vi.fn().mockReturnValue({
    snark: 0.5, wisdom: 0.5, chaos: 0.3, patience: 0.5, debugging: 0.5,
  }),
  getIntimacy: vi.fn().mockReturnValue(30),
  close: vi.fn(),
});
vi.mock('../pet/index.js', () => ({
  PetManager: function MockPetManager() {
    Object.assign(this, mockPet);
  },
}));

// ─── Perception ───
vi.mock('../perception/fs-watcher.js', () => ({
  FileWatcher: function MockFileWatcher() {
    Object.assign(this, { destroy: vi.fn() });
  },
}));
vi.mock('../perception/observer.js', () => ({
  EnvironmentObserver: function MockObserver() {},
}));
vi.mock('../perception/privacy.js', () => ({
  PrivacyManager: function MockPrivacy() {},
}));
vi.mock('../perception/event-bus.js', () => ({
  PerceptionEventBus: function MockEventBus() {
    Object.assign(this, { close: vi.fn() });
  },
}));

// ─── Feedback ───
vi.mock('../feedback/learner.js', () => ({
  FeedbackLearner: function MockFeedbackLearner() {
    Object.assign(this, { setPetManager: vi.fn(), setConvergenceCallback: vi.fn() });
  },
}));

// ─── Skills ───
vi.mock('../skills/index.js', () => ({
  ExperiencePackageManager: function MockEPM() {
    Object.assign(this, { getPackagesMap: vi.fn().mockReturnValue(new Map()) });
  },
  ExperienceScheduler: function MockES() {},
  ExperienceEvaluator: function MockEE() {},
  ExperienceExporter: function MockEX() {},
  ExperienceVersionManager: function MockEVM() {},
  QualityRadar: function MockQR() {},
  FeedbackLearner: function MockSFL() {},
}));
vi.mock('../skills/skill-manager.js', () => ({
  SkillManager: function MockSkillManager() {
    Object.assign(this, {
      scanAndLoad: vi.fn().mockResolvedValue([]),
      registerAll: vi.fn().mockResolvedValue(0),
    });
  },
}));

// ─── Billing ───
vi.mock('../billing/index.js', () => ({
  SubscriptionManager: function MockSub() {},
  EntitlementChecker: function MockEC() {},
  PaymentManager: function MockPM() {},
}));

// ─── Shop ───
vi.mock('../shop/catalog.js', () => ({
  ShopCatalog: function MockShopCatalog() {},
}));
vi.mock('../shop/installer.js', () => ({
  ModelInstaller: function MockModelInstaller() {
    Object.assign(this, { setManager: vi.fn(), init: vi.fn().mockResolvedValue(undefined) });
  },
}));

// ─── Social ───
const mockFriendSystem = mockInstance({ destroy: vi.fn() });
const mockPlatformManager = mockInstance({ register: vi.fn(), destroy: vi.fn(), getActive: vi.fn().mockReturnValue(null) });
const mockBuddyInteraction = mockInstance({ destroy: vi.fn() });

vi.mock('../social/index.js', () => ({
  FriendSystem: function MockFriendSystem() {
    Object.assign(this, mockFriendSystem);
  },
  PlatformManager: function MockPlatformManager() {
    Object.assign(this, mockPlatformManager);
  },
  CLIAdapter: function MockCLI() {},
  TelegramAdapter: function MockTG() {},
  DiscordAdapter: function MockDC() {},
  FeishuAdapter: function MockFeishu() {},
  WeComAdapter: function MockWeCom() {},
  WeChatMPAdapter: function MockWeChatMP() {},
  DingTalkAdapter: function MockDingTalk() {},
  BuddyInteractionSystem: function MockBIS() {
    Object.assign(this, mockBuddyInteraction);
  },
}));

// ─── Performance / Launch ───
vi.mock('../perf/cache.js', () => ({
  LRUCache: function MockLRU() {},
}));
vi.mock('../launch/readiness.js', () => ({
  LaunchReadiness: function MockLaunchReadiness() {},
}));

// ─── Core ───
vi.mock('../core/db-manager.js', () => ({
  DatabaseManager: function MockDB() {},
}));
vi.mock('../core/fusion-buffer.js', () => ({
  FusionBuffer: function MockFusionBuffer() {},
}));
vi.mock('../core/tool-synthesizer.js', () => ({
  ToolSynthesizer: function MockToolSynth() {},
}));

vi.mock('../core/buddy-clock.js', () => ({
  BuddyClock: function MockBuddyClock() {
    Object.assign(this, { start: vi.fn(), destroy: vi.fn() });
  },
}));

// ─── Execution Session ───
const mockAssessRisk = vi.fn().mockReturnValue('low');
const mockDecideAutonomy = vi.fn().mockReturnValue(2);

vi.mock('./execution-session.js', () => ({
  ExecutionSession: function MockExecutionSession(config: any) {
    this.id = config.id;
    this.goal = config.goal;
    this.autonomyLevel = config.autonomyLevel;
    this.maxRetries = config.maxRetries;
    this.maxSteps = config.maxSteps;
    this.checkpointInterval = config.checkpointInterval;
  },
  decideAutonomyLevel: mockDecideAutonomy,
  assessTaskRisk: mockAssessRisk,
}));

// ─── Ternary ───
const mockTernaryManager = mockInstance({
  load: vi.fn().mockResolvedValue(null),
  save: vi.fn().mockResolvedValue(undefined),
});
vi.mock('../ternary/manager.js', () => ({
  TernaryModelManager: function MockTMM() {
    Object.assign(this, mockTernaryManager);
  },
}));

const mockTernaryScheduler = mockInstance({
  setManager: vi.fn(),
  addSamples: vi.fn(),
  config: {},
});
vi.mock('../ternary/scheduler.js', () => ({
  TernaryScheduler: function MockTS() {
    Object.assign(this, mockTernaryScheduler);
  },
}));
vi.mock('../ternary/cloud-trainer.js', () => ({
  CloudTrainer: function MockCloudTrainer() {},
}));
vi.mock('../ternary/growth.js', () => ({
  TernaryGrowth: function MockTernaryGrowth() {
    Object.assign(this, { evaluateGrowth: vi.fn().mockReturnValue({ changed: false }) });
  },
}));

// ─── LoRA ───
vi.mock('../lora/index.js', () => ({
  LoRAService: function MockLoRA() {
    Object.assign(this, { init: vi.fn().mockResolvedValue(undefined) });
  },
}));

// ─── Env ───
vi.mock('../env/detect.js', () => ({
  detectEnvironment: vi.fn().mockResolvedValue([]),
}));

// ════════════════════════════════════════════════════════════════
// 2. Import AFTER mocks (vi.mock is auto-hoisted)
// ════════════════════════════════════════════════════════════════

const { Subsystems, initSubsystems } = await import('./subsystems.js');
const { DEFAULT_CONFIG } = await import('../types.js');

// ════════════════════════════════════════════════════════════════
// 3. Helpers
// ════════════════════════════════════════════════════════════════

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    ...DEFAULT_CONFIG,
    llm: { ...DEFAULT_CONFIG.llm, apiKey: 'test-key-123' },
    sandbox: { ...DEFAULT_CONFIG.sandbox, workspace: '/tmp/buddy-test-subsystems' },
    ...overrides,
  };
}

function createInstance(overrides: Record<string, unknown> = {}) {
  return new Subsystems(makeConfig(overrides) as any, false);
}

// ════════════════════════════════════════════════════════════════
// 4. Tests
// ════════════════════════════════════════════════════════════════

describe('Subsystems', () => {

  // ── Test 1: Class structure verification ──

  describe('class structure', () => {
    it('Subsystems 是一个 class（函数）', () => {
      expect(typeof Subsystems).toBe('function');
      expect(Subsystems.prototype.constructor).toBe(Subsystems);
    });

    it('initSubsystems 是一个工厂函数', () => {
      expect(typeof initSubsystems).toBe('function');
    });

    it('initSubsystems 返回 Subsystems 实例', () => {
      const instance = initSubsystems(makeConfig() as any, false);
      expect(instance).toBeInstanceOf(Subsystems);
    });

    it('实例化后拥有所有预期的属性', () => {
      const expectedProperties = [
        'tools', 'memory', 'pet', 'observer', 'feedback', 'learn',
        'emotion', 'desire', 'idle', 'audit', 'tts', 'stmp', 'dream',
        'cognitive', 'extractor', 'intelligence',
        'experiencePackageManager', 'experienceScheduler', 'experienceEvaluator',
        'skillExporter', 'skillVersionManager', 'qualityRadar', 'skillFeedback',
        'subscriptionManager', 'paymentManager', 'entitlementChecker',
        'shopCatalog', 'friendSystem', 'platformManager', 'buddyInteraction',
        'memoryCache', 'launchReadiness', 'dbManager', 'mcpAdapter',
        'skillManager', 'loraService', 'workflowManager', 'dagPlanner',
        'taskExecutor', 'toolRetriever', 'intentClassifier',
        'interviewer', 'dataAugmentor',
        'ternaryManager', 'ternaryRouter', 'ternaryScheduler',
        'modelInstaller', 'toolSynthesizer', 'fusionBuffer',
        'beliefStore', 'entityStore', 'privacyManager', 'perceptionBus',
        'cloudTrainer', 'ternaryGrowth', 'knowledgeExporter', 'mcpRegistry',
      ];

      const instance = createInstance();
      for (const prop of expectedProperties) {
        expect(instance).toHaveProperty(prop);
      }
    });

    it('closeAll 方法存在于原型上', () => {
      expect(typeof Subsystems.prototype.closeAll).toBe('function');
    });

    it('reconfigureLLM 方法存在于原型上', () => {
      expect(typeof Subsystems.prototype.reconfigureLLM).toBe('function');
    });

    it('createExecutionSession 方法存在于原型上', () => {
      expect(typeof Subsystems.prototype.createExecutionSession).toBe('function');
    });

    it('feedTernaryScheduler 方法存在于原型上', () => {
      expect(typeof Subsystems.prototype.feedTernaryScheduler).toBe('function');
    });

    it('clearSession 方法存在于原型上', () => {
      expect(typeof Subsystems.prototype.clearSession).toBe('function');
    });

    it('activeSession getter 存在', () => {
      const descriptor = Object.getOwnPropertyDescriptor(Subsystems.prototype, 'activeSession');
      expect(descriptor).toBeDefined();
      expect(descriptor!.get).toBeDefined();
    });
  });

  // ── Test 2: Subsystems property types ──

  describe('property types after instantiation', () => {
    let sys: InstanceType<typeof Subsystems>;

    beforeAll(() => {
      sys = createInstance();
    });

    it('tools 是对象且有 registerMany 方法', () => {
      expect(sys.tools).toBeDefined();
      expect(typeof (sys.tools as any).registerMany).toBe('function');
    });

    it('memory 存在', () => {
      expect(sys.memory).toBeDefined();
    });

    it('pet 存在', () => {
      expect(sys.pet).toBeDefined();
    });

    it('emotion 已废弃（由三脑小脑接管），应为 null', () => {
      expect(sys.emotion).toBeNull();
    });

    it('desire 已废弃（由三脑小脑接管），应为 null', () => {
      expect(sys.desire).toBeNull();
    });

    it('threeBrain 存在并有 destroy 方法', () => {
      expect(sys.threeBrain).toBeDefined();
      expect(typeof (sys.threeBrain as any).destroy).toBe('function');
    });

    it('idle 存在并有 stop 方法', () => {
      expect(sys.idle).toBeDefined();
      expect(typeof (sys.idle as any).stop).toBe('function');
    });

    it('audit 存在并有 close 方法', () => {
      expect(sys.audit).toBeDefined();
      expect(typeof (sys.audit as any).close).toBe('function');
    });

    it('tts 存在', () => {
      expect(sys.tts).toBeDefined();
    });

    it('stmp 存在并有 close 和 retrieve 方法', () => {
      expect(sys.stmp).toBeDefined();
      expect(typeof (sys.stmp as any).close).toBe('function');
      expect(typeof (sys.stmp as any).retrieve).toBe('function');
    });

    it('cognitive 存在并有 close 和 getAllDomainProfiles 方法', () => {
      expect(sys.cognitive).toBeDefined();
      expect(typeof (sys.cognitive as any).close).toBe('function');
      expect(typeof (sys.cognitive as any).getAllDomainProfiles).toBe('function');
    });

    it('ternaryScheduler 存在并有 addSamples 方法', () => {
      expect(sys.ternaryScheduler).toBeDefined();
      expect(typeof (sys.ternaryScheduler as any).addSamples).toBe('function');
    });

    it('intelligence 存在并有 save 和 setToolSynthesizer 方法', () => {
      expect(sys.intelligence).toBeDefined();
      expect(typeof (sys.intelligence as any).save).toBe('function');
      expect(typeof (sys.intelligence as any).setToolSynthesizer).toBe('function');
    });

    it('friendSystem 存在并有 destroy 方法', () => {
      expect(sys.friendSystem).toBeDefined();
      expect(typeof (sys.friendSystem as any).destroy).toBe('function');
    });

    it('platformManager 存在并有 destroy 和 register 方法', () => {
      expect(sys.platformManager).toBeDefined();
      expect(typeof (sys.platformManager as any).destroy).toBe('function');
      expect(typeof (sys.platformManager as any).register).toBe('function');
    });

    it('beliefStore 存在并有 saveToDisk/loadFromDisk 方法', () => {
      expect(sys.beliefStore).toBeDefined();
      expect(typeof (sys.beliefStore as any).saveToDisk).toBe('function');
      expect(typeof (sys.beliefStore as any).loadFromDisk).toBe('function');
    });

    it('entityStore 存在并有 saveToDisk/loadFromDisk 方法', () => {
      expect(sys.entityStore).toBeDefined();
      expect(typeof (sys.entityStore as any).saveToDisk).toBe('function');
      expect(typeof (sys.entityStore as any).loadFromDisk).toBe('function');
    });

    it('privacyManager 存在', () => {
      expect(sys.privacyManager).toBeDefined();
    });

    it('perceptionBus 存在', () => {
      expect(sys.perceptionBus).toBeDefined();
    });

    it('cloudTrainer 存在', () => {
      expect(sys.cloudTrainer).toBeDefined();
    });

    it('ternaryGrowth 存在', () => {
      expect(sys.ternaryGrowth).toBeDefined();
    });

    it('knowledgeExporter 存在', () => {
      expect(sys.knowledgeExporter).toBeDefined();
    });

    it('mcpRegistry 存在', () => {
      expect(sys.mcpRegistry).toBeDefined();
    });

    it('mcpAdapter 存在并有 disconnectAll 方法', () => {
      expect(sys.mcpAdapter).toBeDefined();
      expect(typeof (sys.mcpAdapter as any).disconnectAll).toBe('function');
    });

    it('clock 为 null（clock.enabled 默认 false）', () => {
      expect(sys.clock).toBeNull();
    });
  });

  // ── Test 3: closeAll cleanup ──

  describe('closeAll', () => {
    it('调用所有子系统的 destroy/close/stop 方法', async () => {
      vi.clearAllMocks();
      const sys = createInstance();

      await sys.closeAll(null, null, null, 'TestBuddy');

      expect(mockIdle.stop).toHaveBeenCalled();
      // emotion/desire 已废弃，由三脑架构接管
      expect(mockIntelligence.save).toHaveBeenCalled();
      expect(mockMCPAdapter.disconnectAll).toHaveBeenCalled();
      expect(mockFriendSystem.destroy).toHaveBeenCalled();
      expect(mockPlatformManager.destroy).toHaveBeenCalled();
      expect(mockBuddyInteraction.destroy).toHaveBeenCalled();
      expect(mockAudit.close).toHaveBeenCalled();
      expect(mockCognitive.close).toHaveBeenCalled();
      expect(mockSTMP.close).toHaveBeenCalled();
      expect(mockPet.close).toHaveBeenCalled();
      expect(mockMemory.close).toHaveBeenCalled();
      expect(mockBeliefStore.saveToDisk).toHaveBeenCalled();
      expect(mockEntityStore.saveToDisk).toHaveBeenCalled();
    });

    it('接受 eventBus 并调用其 close', async () => {
      const sys = createInstance();
      const mockEventBus = { close: vi.fn() };

      await sys.closeAll(mockEventBus, null, null, 'TestBuddy');

      expect(mockEventBus.close).toHaveBeenCalled();
    });

    it('接受 dreamTimer 并清除它', async () => {
      const sys = createInstance();
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
      const timer = setInterval(() => {}, 99999);

      await sys.closeAll(null, timer, null, 'TestBuddy');

      expect(clearIntervalSpy).toHaveBeenCalledWith(timer);
      clearIntervalSpy.mockRestore();
      clearInterval(timer);
    });

    it('是 async 函数（返回 Promise）', async () => {
      const sys = createInstance();
      const result = sys.closeAll(null, null, null, 'TestBuddy');
      expect(result).toBeInstanceOf(Promise);
      await result;
    });
  });

  // ── Test 4: createExecutionSession ──

  describe('createExecutionSession', () => {
    beforeEach(() => {
      mockAssessRisk.mockReturnValue('low');
      mockDecideAutonomy.mockReturnValue(2);
    });

    it('用 goal 创建一个 ExecutionSession', () => {
      const sys = createInstance();
      const session = sys.createExecutionSession('写一个 hello world 程序');

      expect(session).toBeDefined();
      expect(session.goal).toBe('写一个 hello world 程序');
    });

    it('session id 匹配 exec- 前缀格式', () => {
      const sys = createInstance();
      const session = sys.createExecutionSession('测试任务');

      expect(session.id).toMatch(/^exec-\d+-[a-z0-9]{4}$/);
    });

    it('使用 assessTaskRisk 评估风险', () => {
      const sys = createInstance();
      mockAssessRisk.mockClear();

      sys.createExecutionSession('部署到生产环境');

      expect(mockAssessRisk).toHaveBeenCalledWith('部署到生产环境');
    });

    it('使用 decideAutonomyLevel 决定自主等级', () => {
      const sys = createInstance();
      mockDecideAutonomy.mockClear();

      sys.createExecutionSession('删除临时文件');

      expect(mockDecideAutonomy).toHaveBeenCalled();
    });

    it('可以通过 options 覆盖 autonomyLevel', () => {
      mockDecideAutonomy.mockReturnValue(2);
      const sys = createInstance();
      const session = sys.createExecutionSession('普通任务', { autonomyLevel: 3 });

      expect(session.autonomyLevel).toBe(3);
    });

    it('默认 maxRetries 为 2', () => {
      const sys = createInstance();
      const session = sys.createExecutionSession('任务');
      expect(session.maxRetries).toBe(2);
    });

    it('可以通过 options 自定义 maxRetries', () => {
      const sys = createInstance();
      const session = sys.createExecutionSession('任务', { maxRetries: 5 });
      expect(session.maxRetries).toBe(5);
    });

    it('默认 maxSteps 为 20', () => {
      const sys = createInstance();
      const session = sys.createExecutionSession('任务');
      expect(session.maxSteps).toBe(20);
    });

    it('可以通过 options 自定义 maxSteps', () => {
      const sys = createInstance();
      const session = sys.createExecutionSession('任务', { maxSteps: 50 });
      expect(session.maxSteps).toBe(50);
    });

    it('默认 checkpointInterval 为 5', () => {
      const sys = createInstance();
      const session = sys.createExecutionSession('任务');
      expect(session.checkpointInterval).toBe(5);
    });

    it('activeSession getter 返回当前 session', () => {
      const sys = createInstance();
      expect(sys.activeSession).toBeNull();

      const session = sys.createExecutionSession('新任务');
      expect(sys.activeSession).toBe(session);
    });

    it('连续创建会覆盖上一个 session', () => {
      const sys = createInstance();
      const s1 = sys.createExecutionSession('任务一');
      const s2 = sys.createExecutionSession('任务二');

      expect(sys.activeSession).toBe(s2);
      expect(sys.activeSession).not.toBe(s1);
    });
  });

  // ── Test 5: clearSession ──

  describe('clearSession', () => {
    it('清除活跃 session', () => {
      const sys = createInstance();
      sys.createExecutionSession('要清除的任务');
      expect(sys.activeSession).not.toBeNull();

      sys.clearSession();
      expect(sys.activeSession).toBeNull();
    });

    it('在没有 session 时调用不会报错', () => {
      const sys = createInstance();
      expect(sys.activeSession).toBeNull();
      expect(() => sys.clearSession()).not.toThrow();
      expect(sys.activeSession).toBeNull();
    });
  });

  // ── Test 6: feedTernaryScheduler ──

  describe('feedTernaryScheduler', () => {
    beforeEach(() => {
      mockCognitive.getAllDomainProfiles.mockReset();
      mockSTMP.retrieve.mockReset();
      mockTernaryScheduler.addSamples.mockReset();
    });

    it('没有 domain profiles 时返回 0', async () => {
      mockCognitive.getAllDomainProfiles.mockReturnValue([]);
      const sys = createInstance();

      const count = await sys.feedTernaryScheduler();
      expect(count).toBe(0);
    });

    it('跳过 seed 阶段的 domain', async () => {
      mockCognitive.getAllDomainProfiles.mockReturnValue([
        { domain: 'math', growthStage: 'seed' },
        { domain: 'code', growthStage: 'seed' },
      ]);
      const sys = createInstance();

      const count = await sys.feedTernaryScheduler();
      expect(count).toBe(0);
      expect(mockSTMP.retrieve).not.toHaveBeenCalled();
    });

    it('跳过节点数 < 3 的 domain', async () => {
      mockCognitive.getAllDomainProfiles.mockReturnValue([
        { domain: 'science', growthStage: 'sprout' },
      ]);
      mockSTMP.retrieve.mockResolvedValueOnce({
        primary: [{ content: 'a'.repeat(20), timestamp: Date.now() }],
        associative: [],
      });
      const sys = createInstance();

      const count = await sys.feedTernaryScheduler();
      expect(count).toBe(0);
    });

    it('过滤内容长度 < 10 或 > 500 的节点', async () => {
      mockCognitive.getAllDomainProfiles.mockReturnValue([
        { domain: 'physics', growthStage: 'tree' },
      ]);
      mockSTMP.retrieve.mockResolvedValueOnce({
        primary: [
          { content: 'short', timestamp: Date.now() },              // < 10 → filtered
          { content: 'a'.repeat(600), timestamp: Date.now() },      // > 500 → filtered
          { content: 'valid content here for testing', timestamp: Date.now() }, // kept
          { content: 'another valid piece of content', timestamp: Date.now(), emotional: { importance: 8 } },
        ],
        associative: [
          { content: 'associative node content', timestamp: Date.now() },
        ],
      });
      const sys = createInstance();

      const count = await sys.feedTernaryScheduler();
      expect(count).toBe(3);
      expect(mockTernaryScheduler.addSamples).toHaveBeenCalledWith(
        'physics',
        expect.arrayContaining([
          expect.objectContaining({ domain: 'physics', type: 'instruct' }),
        ]),
      );
    });

    it('使用 emotional.importance / 10 作为 quality', async () => {
      mockCognitive.getAllDomainProfiles.mockReturnValue([
        { domain: 'biology', growthStage: 'tree' },
      ]);
      mockSTMP.retrieve.mockResolvedValueOnce({
        primary: [
          { content: 'valid content for quality check', timestamp: 1000, emotional: { importance: 8 } },
          { content: 'another valid primary content', timestamp: 2000 },
        ],
        associative: [
          { content: 'associative content node here', timestamp: 3000 },
        ],
      });
      const sys = createInstance();

      const count = await sys.feedTernaryScheduler();

      expect(count).toBe(3);
      expect(mockTernaryScheduler.addSamples).toHaveBeenCalledTimes(1);
      const [domain, samples] = mockTernaryScheduler.addSamples.mock.calls[0];
      expect(domain).toBe('biology');
      expect(samples).toHaveLength(3);
      expect(samples[0].quality).toBeCloseTo(0.8); // 8 / 10
      // Default importance is 5 when emotional is absent
      expect(samples[1].quality).toBeCloseTo(0.5);
      expect(samples[2].quality).toBeCloseTo(0.5);
    });

    it('stmp.retrieve 失败时不中断，继续处理其他 domain', async () => {
      mockCognitive.getAllDomainProfiles.mockReturnValue([
        { domain: 'fail-domain', growthStage: 'tree' },
        { domain: 'ok-domain', growthStage: 'tree' },
      ]);
      mockSTMP.retrieve
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce({
          primary: [
            { content: 'valid content for test', timestamp: Date.now() },
            { content: 'more valid content here', timestamp: Date.now() },
            { content: 'third valid content piece', timestamp: Date.now() },
          ],
          associative: [],
        });
      const sys = createInstance();

      const count = await sys.feedTernaryScheduler();
      expect(count).toBe(3);
    });
  });

  // ── Test 7: reconfigureLLM ──

  describe('reconfigureLLM', () => {
    it('将 _llm 替换为新实例', () => {
      const sys = createInstance();

      sys.reconfigureLLM({ provider: 'openai', model: 'gpt-4', apiKey: 'new-key' });

      expect(sys.llm).toBeDefined();
    });
  });

  // ── Test 8: 构造函数选项 ──

  describe('constructor options', () => {
    it('clock 在 config.clock.enabled=false 时为 null', () => {
      const sys = createInstance({ clock: { enabled: false } });
      expect(sys.clock).toBeNull();
    });

    it('tts 在 config.tts.backend=disabled 时被禁用', () => {
      mockTTS.setEnabled.mockClear();
      const sys = createInstance({ tts: { enabled: false, backend: 'disabled' } });
      expect(mockTTS.setEnabled).toHaveBeenCalledWith(false);
    });

    it('mcp.servers 为空时不调用 mcpAdapter.connect', () => {
      mockMCPAdapter.connect.mockClear();
      const sys = createInstance({ mcp: { servers: [] } });
      expect(mockMCPAdapter.connect).not.toHaveBeenCalled();
    });
  });
});
