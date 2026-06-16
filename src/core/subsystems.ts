import * as fs from 'fs';
import * as path from 'path';
import type { BuddyConfig, Message } from '../types.js';
import { LLMAdapter } from './llm.js';
import { DecisionRecorder } from './decision-recorder.js';
import { ModelPool } from './model-pool.js';
import { LLMCallService } from './llm-call-service.js';
import { ToolRegistry } from '../tools/registry.js';
import { ALL_TOOLS } from '../tools/builtin.js';
import { createVoiceTools } from '../tools/voice.js';
import { createMultimodalTools } from '../tools/multimodal.js';
import { createHttpApiTools } from '../tools/http-api.js';
import { MCPAdapter } from '../tools/mcp-adapter.js';
import { MemoryStore } from '../memory/store.js';
import { AuditLogger } from '../audit/logger.js';
import { TTSManager } from '../voice/tts.js';
import { EdgeTTSBackend } from '../voice/edge-tts.js';
import { STMPStore } from '../memory/stmp.js';
import { DreamEngine } from '../memory/dream.js';
import { CognitiveEngine } from '../cognitive/engine.js';
import { KnowledgeExtractor } from '../knowledge/extractor.js';
import { ExperienceEngine, type ToolExecutor } from '../intelligence/index.js';
import { CrossSessionLearner } from './cross-session-learner.js';
import { WorkflowManager, DAGPlanner, TaskExecutor } from '../orchestrate/index.js';
import { ToolRetriever } from '../tools/tool-retriever.js';
import { PetManager } from '../pet/index.js';
import { FileWatcher } from '../perception/fs-watcher.js';
import { globalToolCache, globalSemanticCache } from '../tools/cache.js';
import {
  ExperiencePackageManager, ExperienceScheduler, ExperienceEvaluator,
  ExperienceExporter, ExperienceVersionManager, QualityRadar,
  FeedbackLearner as SkillFeedbackLearner,
} from '../skills/index.js';
import { SkillManager } from '../skills/skill-manager.js';
import { SkillResolver } from '../skills/skill-resolver.js';
import { SubscriptionManager, EntitlementChecker, PaymentManager } from '../billing/index.js';
import { ShopCatalog } from '../shop/catalog.js';
import { FriendSystem, PlatformManager, CLIAdapter, TelegramAdapter, DiscordAdapter, FeishuAdapter, WeComAdapter, WeChatMPAdapter, DingTalkAdapter, BuddyInteractionSystem } from '../social/index.js';
import { LRUCache } from '../perf/cache.js';
import { LaunchReadiness } from '../launch/readiness.js';
import { DatabaseManager } from './db-manager.js';
import { EnvironmentObserver } from '../perception/observer.js';
import { DecisionExplainer } from './decision-explainer.js';
import { TaskProgressTracker } from '../orchestrate/progress-tracker.js';
import { FeedbackLearner } from '../feedback/learner.js';
import { BuddyLearn } from '../knowledge/learn.js';
import { KnowledgeSourceManager } from '../knowledge/source-manager.js';
import { LocalSource } from '../knowledge/local-source.js';
import { WebSource } from '../knowledge/web-source.js';
import { FeishuSource } from '../knowledge/feishu-source.js';
import { IdleBehavior } from '../behavior/idle.js';
import { LoRAService } from '../lora/index.js';
import { UnifiedInterviewer } from '../intelligence/unified-interviewer.js';
import { DataAugmentor } from '../intelligence/data-augmentor.js';
import { TernaryModelManager } from '../ternary/manager.js';
import { TernaryScheduler } from '../ternary/scheduler.js';
import { TernaryExpertRouter, createTernaryTools } from '../tools/ternary-expert.js';
import { ModelInstaller } from '../shop/installer.js';
import { ProactiveResearcher } from './proactive-researcher.js';
import { ModelHealthProber } from './model-health-prober.js';
import { BuddyClock } from './buddy-clock.js';
import { ExecutionSession, decideAutonomyLevel, assessTaskRisk, type ExecutionSessionConfig, type AutonomyLevel } from './execution-session.js';
import { ToolSynthesizer } from './tool-synthesizer.js';
import type { TrainingSample as TernaryTrainingSample } from '../ternary/trainer.js';
import { BeliefStore } from '../memory/belief-store.js';
import { EntityStore } from '../memory/entity-store.js';
import { PrivacyManager } from '../perception/privacy.js';
import { PerceptionEventBus } from '../perception/event-bus.js';
import { CloudTrainer } from '../ternary/cloud-trainer.js';
import { TernaryGrowth } from '../ternary/growth.js';
import { executeChain } from '../tools/tool-chain.js';
import { KnowledgeExporter } from '../intelligence/knowledge-export.js';
import { MCPRegistry } from '../tools/mcp-registry.js';
import { detectEnvironment } from '../env/detect.js';
import { PROJECT_TOOLS_ALL } from '../tools/project.js';
import { setIntegrationDeps } from '../project/tools.js';
import { z as zod } from 'zod';
import { syncAllSources } from '../brain/right/scene/entity-adapters.js';

// --- 三脑架构 ---
import { ThreeBrain } from '../brain/brain.js';
import type { LeftBrain } from '../brain/left/index.js';
import type { RightBrain } from '../brain/right/index.js';
import type { Cerebellum } from '../brain/cerebellum/index.js';
import { SignalConvergenceLayer } from '../brain/convergence/index.js';
import { synthesizeTrainingData } from '../brain/right/training/seed-synthesizer.js';
import { createSeedExperiences } from '../intelligence/seed-experiences.js';
import { LLMProfiler } from './llm-profiler.js';
import { GenerationCache } from './generation-cache.js';
import { CapabilityScheduler } from './capability-scheduler.js';
import { MultiPathExecutor } from './multi-path-executor.js';

/**
 * 所有子系统的容器 — 由工厂函数统一初始化
 */
export class Subsystems {
  private _llm: LLMAdapter;
  get llm(): LLMAdapter { return this._llm; }
  /** Phase 5: 直接暴露 ModelRouter，避免上层通过 llm 间接访问 */
  get router() { return this._llm.getRouter(); }
  readonly tools: ToolRegistry;
  readonly memory: MemoryStore;
  readonly pet: PetManager;
  readonly observer: EnvironmentObserver;
  readonly feedback: FeedbackLearner;
  readonly learn: BuddyLearn;
  readonly knowledgeSourceManager: KnowledgeSourceManager;
  readonly idle: IdleBehavior;
  readonly audit: AuditLogger;
  readonly tts: TTSManager;
  readonly stmp: STMPStore;
  readonly dream: DreamEngine;
  readonly cognitive: CognitiveEngine;
  readonly extractor: KnowledgeExtractor;
  readonly intelligence: ExperienceEngine;
  readonly experiencePackageManager: ExperiencePackageManager;
  readonly experienceScheduler: ExperienceScheduler;
  readonly experienceEvaluator: ExperienceEvaluator;
  readonly skillExporter: ExperienceExporter;
  readonly skillVersionManager: ExperienceVersionManager;
  readonly qualityRadar: QualityRadar;
  readonly skillFeedback: SkillFeedbackLearner;
  readonly subscriptionManager: SubscriptionManager;
  readonly paymentManager: PaymentManager;
  readonly entitlementChecker: EntitlementChecker;
  readonly shopCatalog: ShopCatalog;
  readonly friendSystem: FriendSystem;
  readonly platformManager: PlatformManager;
  readonly buddyInteraction: BuddyInteractionSystem;
  readonly memoryCache: LRUCache<string>;
  readonly launchReadiness: LaunchReadiness;
  readonly dbManager: DatabaseManager;
  readonly mcpAdapter: MCPAdapter;
  readonly skillManager: SkillManager;
  readonly loraService: LoRAService;
  readonly workflowManager: WorkflowManager;
  readonly dagPlanner: DAGPlanner;
  readonly taskExecutor: TaskExecutor;
  /** Phase 2: 步骤→工具+参数 的解析器（编排-执行分离桥梁） */
  readonly skillResolver: import('../skills/skill-resolver.js').SkillResolver;
  readonly toolRetriever: ToolRetriever;
  readonly interviewer: UnifiedInterviewer;
  readonly proactiveResearcher: ProactiveResearcher;
  readonly healthProber: ModelHealthProber | null;
  readonly dataAugmentor: DataAugmentor;
  readonly ternaryManager: TernaryModelManager;
  readonly ternaryRouter: TernaryExpertRouter;
  readonly ternaryScheduler: TernaryScheduler;
  readonly modelInstaller: ModelInstaller;
  readonly toolSynthesizer: ToolSynthesizer;
  readonly clock: BuddyClock | null;
  /** Phase 2: 决策可解释器 */
  readonly decisionExplainer: import('./decision-explainer.js').DecisionExplainer;
  /** Phase 2: 任务进度追踪器 */
  readonly progressTracker: import('../orchestrate/progress-tracker.js').TaskProgressTracker;
  // --- 接入的 10 个模块 ---
  readonly beliefStore: BeliefStore;
  readonly entityStore: EntityStore;
  readonly privacyManager: PrivacyManager;
  readonly perceptionBus: PerceptionEventBus;
  readonly cloudTrainer: CloudTrainer;
  readonly ternaryGrowth: TernaryGrowth;
  readonly knowledgeExporter: KnowledgeExporter;
  readonly mcpRegistry: MCPRegistry;

  // --- 三脑架构 ---
  /** 三脑协作实例 */
  threeBrain: ThreeBrain | null = null;
  /** Step 6: 统一资源画像系统（向后兼容接口） */
  resourceHub: import('../brain/hub/resource-hub.js').ResourceHub | null = null;
  /** Step 7: ModelPool ↔ ResourceHub 双向同步桥 */
  modelPoolBridge: import('../brain/hub/model-pool-bridge.js').ModelPoolResourceBridge | null = null;
  /** P7: 统一资源管理系统（新） */
  resourceSystem: {
    hub: import('../brain/hub/unified-resource-hub.js').UnifiedResourceHub;
    adapter: import('../brain/hub/resource-hub-adapter.js').ResourceHubAdapter;
    scheduler: import('../brain/hub/batch-probe-scheduler.js').BatchProbeScheduler;
    auditor: import('../brain/hub/marginal-auditor.js').MarginalAuditor;
    graph: import('../brain/hub/capability-graph.js').CapabilityGraph;
  } | null = null;
  /** 左脑：理性决策脑（规则+调度+策略蒸馏） */
  leftBrain: LeftBrain | null = null;
  /** 右脑：直觉学习脑（轻量NN+在线学习+蒸馏） */
  rightBrain: RightBrain | null = null;
  /** 小脑：本体感知+稳态调节脑 */
  cerebellum: Cerebellum | null = null;
  /** 信号汇聚层：打通外围通道 → 右脑训练循环 */
  convergenceLayer: SignalConvergenceLayer | null = null;
  /** Phase 4: LLM 能力实时探测器 */
  llmProfiler: LLMProfiler | null = null;
  /** Phase 4: 生成缓存 */
  generationCache: GenerationCache | null = null;
  /** Phase 4: 能力协同调度器 */
  capabilityScheduler: CapabilityScheduler | null = null;
  /** Phase 4: 多路执行器 */
  multiPathExecutor: MultiPathExecutor | null = null;
  /** 全资源类型桥接器（非模型资源同步到 UnifiedResourceHub） */
  _resourceBridge: import('../brain/hub/unified-resource-bridge.js').UnifiedResourceBridge | null = null;
  /** World Model 训练缓冲区 */
  private _worldModelBuffer: Array<{
    scene_before: any; action: any; scene_after: any;
    completion: boolean; risk_label: number;
  }> = [];
  /** P2-7: 跨会话学习器 */
  crossSession: CrossSessionLearner | null = null;

  constructor(config: BuddyConfig, verbose: boolean) {
    const dbDir = path.join(process.env.HOME ?? '/tmp', '.buddy');

    // --- E2E Mock LLM: 强制使用 mock provider ---
    if (process.env.BUDDY_MOCK_LLM === '1') {
      config = {
        ...config,
        llm: undefined,
        models: {
          providers: [{ id: 'mock', type: 'custom' as const, model: 'mock-model', apiKey: 'mock-key' }],
        },
      };
      if (verbose) console.log('[MockLLM] 使用 Mock LLM provider');
    }

    // --- 核心 ---
    this._llm = new LLMAdapter(config, dbDir);
    this.tools = new ToolRegistry();
    this.tools.registerMany(ALL_TOOLS);

    // --- Phase 3: Subsystems 直接创建 ModelPool + DecisionRecorder ---
    const dataDir = path.join(process.env.HOME ?? '/tmp', '.buddy');
    const decisionRecorder = new DecisionRecorder(dataDir);
    this._llm.setDecisionRecorder(decisionRecorder);

    // 统一模型池 — 始终创建，确保首次配置 API 端点时 getUnifiedPool() 不返回 null
    const pool = new ModelPool(null, dataDir, decisionRecorder);
    if (config.models?.preferences) {
      const prefs = config.models.preferences;
      pool.updatePreferences({
        excluded: prefs.excluded ?? [],
        preferFree: prefs.preferFree ?? false,
        preferLocal: prefs.preferLocal ?? false,
        maxCostPer1k: prefs.maxCostPer1k ?? 1.0,
        strategy: config.models?.strategy ?? 'task_match',
      });
      if (prefs.taskPreferences) {
        for (const [key, val] of Object.entries(prefs.taskPreferences)) {
          pool.setTaskPreference(key, val.prefer ?? [], val.avoid ?? []);
        }
      }
    }
    // 立即注入到 LLM，确保运行时动态添加端点时池已可用
    this._llm.setPool(pool);

    // P2-7: 跨会话学习器 — 持久化 Thompson 参数，新 session 自动加载
    this.crossSession = new CrossSessionLearner(dataDir, `session-${Date.now()}`, verbose);
    if (verbose) {
      const stats = this.crossSession.getGlobalStats();
      console.log(`[CrossSession] 已加载 ${stats.totalKeys} 个全局参数 (${stats.totalSamples} 样本)`);
    }
    // 接入 ModelPool 反馈 → 同步到全局 Thompson
    pool.setFeedbackCallback((taskType, modelId, success, latencyMs) => {
      this.crossSession?.reportOutcome(taskType, modelId, success, latencyMs);
    });
    if (config.models?.providers?.length) {
      pool.initializeFromProviders(config.models.providers).then(() => {
        // P2-7 FIX: 从 CrossSession 恢复全局 Thompson 参数到 ModelPool
        if (this.crossSession) {
          const globalParams = this.crossSession.getAllParams();
          let restored = 0;
          for (const gp of globalParams) {
            const decayed = this.crossSession.initializeLocal(gp.key);
            if (decayed) {
              // 只恢复 pool 中尚无数据或数据更少的 key
              const existing = pool.getThompsonParamByKey(gp.key);
              if (!existing || (existing.alpha + existing.beta) < (decayed.alpha + decayed.beta)) {
                pool.setThompsonParamByKey(gp.key, {
                  ...decayed,
                  totalCalls: 0,
                  avgQuality: 0,
                  lastUsed: Date.now(),
                });
                restored++;
              }
            }
          }
          if (verbose && restored > 0) {
            console.log(`[UnifiedPool] 从 CrossSession 恢复 ${restored} 个 Thompson 参数`);
          }
        }
        if (verbose) console.log(`[UnifiedPool] 已初始化: ${pool.profileCount} 个模型`);
        // 模型池加载完成后，重新同步到 ResourceHub
        if (this.modelPoolBridge) {
          const reSynced = this.modelPoolBridge.fullSync();
          if (verbose && reSynced > 0) console.log(`[ResourceHub] 重新同步: ${reSynced} 个模型资源`);
        }
        // 异步补全缺少 enrichment 数据的模型（不阻塞启动）
        pool.enrichMissingProfiles().then((updated) => {
          if (verbose && updated > 0) {
            console.log(`[UnifiedPool] enrichment 补全: ${updated} 个模型已更新`);
            // 补全后再次同步到 ResourceHub（derived 能力可能变化）
            if (this.modelPoolBridge) {
              this.modelPoolBridge.fullSync();
            }
          }
        }).catch((err) => {
          if (verbose) console.debug('[UnifiedPool] enrichment 补全跳过:', err.message);
        });
      }).catch((err) => {
        if (verbose) console.warn('[UnifiedPool] 初始化失败:', err.message);
      });
    } else {
      if (verbose) console.log('[UnifiedPool] 已创建（空池），等待 API 端点配置');
    }

    // 模型健康探测器 — 后台定期探测模型可用性
    // 注入真实 prober：通过 GET /v1/models 端点级探活 + 实际调用测试
    const realProber = async (modelId: string): Promise<{ reachable: boolean; latencyMs: number; error?: string }> => {
      const profile = pool.getProfile(modelId);
      if (!profile) return { reachable: false, latencyMs: 0, error: '模型不在池中' };

      const creds = pool.getProviderCredentials(profile.platform);
      if (!creds?.apiKey) return { reachable: false, latencyMs: 0, error: '无 API Key' };

      const baseUrl = (creds.baseUrl ?? 'https://api.openai.com/v1').replace(/\/v1\/?$/, '');
      const startMs = Date.now();

      try {
        // 轻量探测：GET /v1/models/{model_id} 确认模型存在
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const resp = await fetch(`${baseUrl}/v1/models/${encodeURIComponent(modelId.replace(profile.platform + '/', ''))}`, {
          headers: { 'Authorization': `Bearer ${creds.apiKey}` },
          signal: controller.signal,
        });
        clearTimeout(timer);
        const latencyMs = Date.now() - startMs;

        if (resp.ok) return { reachable: true, latencyMs };
        if (resp.status === 401 || resp.status === 403) return { reachable: false, latencyMs, error: 'auth' };
        if (resp.status === 404) return { reachable: false, latencyMs, error: 'not_found' };
        if (resp.status === 429) return { reachable: true, latencyMs, error: 'rate_limited' };
        return { reachable: true, latencyMs, error: `HTTP ${resp.status}` };
      } catch (err) {
        return { reachable: false, latencyMs: Date.now() - startMs, error: (err as Error).message };
      }
    };
    this.healthProber = new ModelHealthProber(pool, { enabled: true, intervalMs: 10 * 60 * 1000 }, { prober: realProber }, verbose);
    this.healthProber.start();

    // §2.7: denied 模型自动重试定时器 — 每小时检查一次
    setInterval(() => {
      const retryModels = pool.getModelsForRetry();
      if (retryModels.length > 0 && verbose) {
        console.log(`[ModelPool] ${retryModels.length} 个 denied 模型已重置为 unknown，允许重试`);
      }
    }, 60 * 60 * 1000);

    // --- Phase 4: LLMCallService 统一子系统 LLM 调用 ---
    const llmCallService = new LLMCallService(this._llm);

    // --- 记忆 ---
    this.memory = new MemoryStore(path.join(dbDir, 'memory.db'));
    // 注入 embedding 调用器（用于记忆向量检索）
    this.memory.setEmbedCaller(async (text: string) => {
      const result = await this._llm.executeMultimodal('embedding', text);
      if (result.type !== 'embedding' || !result.embeddings[0]) {
        throw new Error('Embedding failed');
      }
      return { vector: result.embeddings[0], dimensions: result.dimensions, model: result.model ?? 'unknown' };
    });
    // 异步补全缺失的 embedding（不阻塞启动）
    this.memory.embedBatch(50).catch(() => {});
    this.pet = new PetManager(path.join(dbDir, 'pet.db'));

    this.stmp = new STMPStore(path.join(dbDir, 'stmp.db'));
    this.stmp.setLLMCaller((prompt) => llmCallService.call(prompt, {
      systemPrompt: '你是记忆叙述组装器，用自然语言简洁回答。',
    }));

    this.dream = new DreamEngine(this.stmp);
    this.dream.setLLMCaller((msgs) => llmCallService.callMessages(msgs));

    // --- 认知 ---
    this.cognitive = new CognitiveEngine(path.join(dbDir, 'cognitive.db'));
    this.extractor = new KnowledgeExtractor(this.stmp, this.cognitive);
    this.extractor.setLLMCaller((msgs) => llmCallService.callMessages(msgs));

    // --- 主动提问引擎 (Phase A) ---
    this.interviewer = new UnifiedInterviewer(this.stmp, this.cognitive, verbose);
    this.interviewer.setLLMCaller((msgs) => llmCallService.callMessages(msgs));

    // --- 主动信息获取器 (Phase 1) ---
    this.proactiveResearcher = new ProactiveResearcher({}, verbose);
    this.proactiveResearcher.setSearchFn(async (query) => {
      try {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        const data = await res.json() as any;
        const sources = (data.RelatedTopics ?? []).slice(0, 3).map((t: any) => ({
          title: t.Text?.slice(0, 80) ?? '',
          url: t.FirstURL ?? '',
          snippet: t.Text ?? '',
          relevance: 0.7,
        }));
        return {
          query,
          sources,
          summary: data.AbstractText?.slice(0, 500) ?? '',
          fetchedAt: Date.now(),
          cacheHit: false,
        };
      } catch {
        return { query, sources: [], summary: '', fetchedAt: Date.now(), cacheHit: false };
      }
    });

    // --- 数据扩增器 (Phase 0) ---
    this.dataAugmentor = new DataAugmentor(undefined, verbose);
    this.dataAugmentor.setLLMCaller((msgs) => llmCallService.callMessages(msgs));

    // --- 三进制模型管理 + 推理 + 调度 (Phase 1 & 2) ---
    this.ternaryManager = new TernaryModelManager(path.join(dbDir, 'models'));
    this.ternaryRouter = new TernaryExpertRouter(path.join(dbDir, 'models'));
    this.ternaryScheduler = new TernaryScheduler();
    this.ternaryScheduler.setManager(this.ternaryManager);
    this.modelInstaller = new ModelInstaller();
    this.modelInstaller.setManager(this.ternaryManager);
    this.modelInstaller.init().catch((err) => {
      if (verbose) console.warn('[ModelInstaller] 初始化失败:', err.message);
    });
    this.toolSynthesizer = new ToolSynthesizer(verbose);
    this.ternaryRouter.init().then(() => {
      const experts = this.ternaryRouter.listExperts();
      if (experts.length > 0) {
        this.tools.registerMany(createTernaryTools(this.ternaryRouter));

        // 注册本地专家到 ModelRouter
        const llmRouter = this._llm.getRouter();
        for (const expert of experts) {
          const routerRef = this.ternaryRouter;
          llmRouter.registerLocalExpert({
            domain: expert.domain,
            confidence: 0.75,  // 初始置信度，后续通过推理反馈调整
            capabilities: {
              toolCalling: false,
              streaming: false,
              structuredOutput: false,
              vision: false,
              maxContextTokens: 512,
              maxOutputTokens: 256,
              toolChoice: false,
              parallelToolCalls: false,
              needsPromptToolCalling: true,
              preferredToolFormat: 'natural',
              supportsDeveloperRole: false,
            },
            query: async (prompt: string) => {
              const result = await routerRef.query(expert.domain, prompt);
              return result.answer;
            },
          });
        }

        if (verbose) console.log(`[Ternary] 已加载 ${experts.length} 个三进制专家模型并注册到路由器`);

        // 注册项目管理工具
        this.tools.registerMany(PROJECT_TOOLS_ALL);
        if (verbose) console.log(`[Tools] 已注册 ${PROJECT_TOOLS_ALL.length} 个项目管理工具`);

        // 注册本地专家到 ModelPool（如果启用）
        const poolScheduler = this._llm.getPoolScheduler();
        if (poolScheduler) {
          const pool = poolScheduler.getPool();
          for (const expert of experts) {
            pool.registerNode({
              id: `ternary/${expert.domain}`,
              type: 'local_expert',
              domain: expert.domain,
              tags: [expert.domain, 'ternary', 'local'],
              tier: 'free',
            });
          }
          if (verbose) console.log(`[ModelPool] 已注册 ${experts.length} 个三进制专家到池中`);
        }
      }
    }).catch((err) => {
      if (verbose) console.warn('[Ternary] 初始化失败:', err.message);
    });

    // --- 自产智能 ---
    const toolExecutor: ToolExecutor = async (toolName, args) => {
      const tool = this.tools.get(toolName);
      if (!tool) throw new Error(`Tool not found: ${toolName}`);
      return tool.execute(args);
    };
    this.intelligence = new ExperienceEngine(toolExecutor, {
      dataDir: dbDir,
      defaultPersonality: 'warm',
    });
    this.intelligence.init().catch((err) => {
      if (verbose) console.warn('[Intelligence] 初始化失败:', err.message);
    });

    // 接通项目集成桥接 — STMP / Dream / Cognitive / ExperienceCompiler
    setIntegrationDeps({
      stmp: this.stmp,
      dream: this.dream,
      cognitive: this.cognitive,
      experienceCompiler: this.intelligence.compiler,
    });

    // --- 能力包 ---
    this.experiencePackageManager = new ExperiencePackageManager();
    this.experienceScheduler = new ExperienceScheduler(this.experiencePackageManager.getPackagesMap());
    this.experienceEvaluator = new ExperienceEvaluator();
    this.skillExporter = new ExperienceExporter();
    this.skillVersionManager = new ExperienceVersionManager();
    this.qualityRadar = new QualityRadar();
    this.skillFeedback = new SkillFeedbackLearner();

    // --- 商业化 ---
    this.subscriptionManager = new SubscriptionManager(path.join(dbDir, 'billing.db'));
    this.paymentManager = new PaymentManager(
      { provider: 'stripe', sandbox: true },
      path.join(dbDir, 'billing.db'),
    );
    this.entitlementChecker = new EntitlementChecker(this.subscriptionManager);
    this.shopCatalog = new ShopCatalog();

    // --- 社交 ---
    this.friendSystem = new FriendSystem(path.join(dbDir, 'social.db'));
    this.platformManager = new PlatformManager();
    this.buddyInteraction = new BuddyInteractionSystem();
    this.platformManager.register(new CLIAdapter());

    // --- Telegram ---
    if (config.platforms?.telegram?.enabled && config.platforms.telegram.token) {
      const tgAdapter = new TelegramAdapter(config.platforms.telegram.token);
      this.platformManager.register(tgAdapter);
      tgAdapter.connect().catch(err => {
        if (verbose) console.warn('[Platform] Telegram 连接失败:', err.message);
      });
      if (verbose) console.log('[Platform] Telegram 适配器已注册并连接');
    }

    // --- Discord ---
    if (config.platforms?.discord?.enabled && config.platforms.discord.token) {
      const dcAdapter = new DiscordAdapter(config.platforms.discord.token);
      this.platformManager.register(dcAdapter);
      dcAdapter.connect().catch(err => {
        if (verbose) console.warn('[Platform] Discord 连接失败:', err.message);
      });
      if (verbose) console.log('[Platform] Discord 适配器已注册并连接');
    }

    // --- 飞书 ---
    if (config.platforms?.feishu?.enabled && config.platforms.feishu.appId && config.platforms.feishu.appSecret) {
      const feishuAdapter = new FeishuAdapter({
        appId: config.platforms.feishu.appId,
        appSecret: config.platforms.feishu.appSecret,
        webhookPort: config.platforms.feishu.webhookPort,
      });
      this.platformManager.register(feishuAdapter);
      feishuAdapter.connect().catch(err => {
        if (verbose) console.warn('[Platform] 飞书连接失败:', err.message);
      });
      if (verbose) console.log('[Platform] 飞书适配器已注册并连接');
    }

    // --- 企业微信 ---
    if (config.platforms?.wecom?.enabled && config.platforms.wecom.corpId && config.platforms.wecom.secret) {
      const wecomAdapter = new WeComAdapter({
        corpId: config.platforms.wecom.corpId,
        agentId: config.platforms.wecom.agentId,
        secret: config.platforms.wecom.secret,
        token: config.platforms.wecom.token,
        encodingAESKey: config.platforms.wecom.encodingAESKey,
        webhookPort: config.platforms.wecom.webhookPort,
      });
      this.platformManager.register(wecomAdapter);
      wecomAdapter.connect().catch(err => {
        if (verbose) console.warn('[Platform] 企业微信连接失败:', err.message);
      });
      if (verbose) console.log('[Platform] 企业微信适配器已注册并连接');
    }

    // --- 微信公众号 ---
    if (config.platforms?.wechat_mp?.enabled && config.platforms.wechat_mp.appId && config.platforms.wechat_mp.appSecret) {
      const wechatMpAdapter = new WeChatMPAdapter({
        appId: config.platforms.wechat_mp.appId,
        appSecret: config.platforms.wechat_mp.appSecret,
        token: config.platforms.wechat_mp.token,
        encodingAESKey: config.platforms.wechat_mp.encodingAESKey,
        webhookPort: config.platforms.wechat_mp.webhookPort,
      });
      this.platformManager.register(wechatMpAdapter);
      wechatMpAdapter.connect().catch(err => {
        if (verbose) console.warn('[Platform] 微信公众号连接失败:', err.message);
      });
      if (verbose) console.log('[Platform] 微信公众号适配器已注册并连接');
    }

    // --- 钉钉 ---
    if (config.platforms?.dingtalk?.enabled && config.platforms.dingtalk.appKey && config.platforms.dingtalk.appSecret) {
      const dingtalkAdapter = new DingTalkAdapter({
        appKey: config.platforms.dingtalk.appKey,
        appSecret: config.platforms.dingtalk.appSecret,
        robotCode: config.platforms.dingtalk.robotCode,
        mode: config.platforms.dingtalk.mode,
        webhookPort: config.platforms.dingtalk.webhookPort,
      });
      this.platformManager.register(dingtalkAdapter);
      dingtalkAdapter.connect().catch(err => {
        if (verbose) console.warn('[Platform] 钉钉连接失败:', err.message);
      });
      if (verbose) console.log('[Platform] 钉钉适配器已注册并连接');
    }

    // --- 性能 ---
    this.memoryCache = new LRUCache<string>({ maxSize: 200, ttlMs: 5 * 60 * 1000 });
    this.launchReadiness = new LaunchReadiness();
    this.dbManager = new DatabaseManager(dbDir);
    this.mcpAdapter = new MCPAdapter(verbose);

    // --- LoRA 微调服务 ---
    this.loraService = new LoRAService(this.stmp, this.cognitive, undefined, verbose);
    this.loraService.init().catch((err) => {
      if (verbose) console.warn('[LoRA] 初始化失败:', err.message);
    });

    // --- DAG 工作流管理 ---
    this.toolRetriever = new ToolRetriever({ maxTools: 12, minScore: 0.05 });
    this.workflowManager = new WorkflowManager(this.tools, dbDir, verbose);
    this.workflowManager.init().catch((err) => {
      if (verbose) console.warn('[Workflow] 初始化失败:', err.message);
    });
    this.dagPlanner = new DAGPlanner(
      (msgs) => llmCallService.callForPlanning(msgs),
      this.tools,
      this.toolRetriever,
      { maxToolsForPrompt: 12, maxTasks: 10 },
    );
    // Phase 4: 注入领域知识包调度器到 Planner
    this.dagPlanner.setScheduler(this.experienceScheduler);
    this.taskExecutor = new TaskExecutor(this.tools, undefined, verbose);

    // --- Phase 2: 三脑能力补全 ---
    this.decisionExplainer = new DecisionExplainer();
    this.progressTracker = new TaskProgressTracker(verbose);

    // --- 动态 Skill 加载 ---
    const skillDirs = [
      path.join(dbDir, 'skills'),               // 用户安装的 skill
      path.join(process.cwd(), 'skills'),        // 项目内置的 skill 示例
    ];
    this.skillManager = new SkillManager(skillDirs, verbose);
    this.skillManager.scanAndLoad()
      .then(() => this.skillManager.registerAll(this.tools))
      .then((count) => {
        if (verbose && count > 0) console.log(`[Subsystems] 动态加载 ${count} 个 Skill`);
      })
      .catch((err) => {
        if (verbose) console.warn('[SkillManager] 初始化失败:', err.message);
      });

    // Phase 2: SkillResolver — 步骤→工具+参数 的解析器（编排-执行分离桥梁）
    this.skillResolver = new SkillResolver(this.tools, {
      experience: this.intelligence,
      toolRetriever: this.toolRetriever,
      skillManager: this.skillManager,
      llmCaller: (msgs) => llmCallService.callForPlanning(msgs),
    });

    // Sprint 3: 连接 ToolSynthesizer 到经验学习循环
    this.intelligence.setToolSynthesizer(this.toolSynthesizer, this.skillManager);

    // --- MCP Server 连接 ---
    if (config.mcp?.servers?.length) {
      this._connectMCPServers(config.mcp.servers, verbose);
    }

    // --- 感知/反馈/学习 ---
    this.observer = new EnvironmentObserver(this.memory);
    this.feedback = new FeedbackLearner(this.memory);
    this.feedback.setPetManager(this.pet);
    this.learn = new BuddyLearn(this.memory);

    // --- 知识源统一接入 ---
    this.knowledgeSourceManager = new KnowledgeSourceManager();

    // 本地知识源（始终注册，如果配置了 watchFolders 则可用）
    if (config.knowledge?.local?.watchFolders?.length) {
      const localSource = new LocalSource({
        watchFolders: config.knowledge.local.watchFolders,
        fileTypes: config.knowledge.local.fileTypes,
        syncIntervalMs: config.knowledge.local.syncIntervalMs,
      });
      this.knowledgeSourceManager.register(localSource);
      // 首次同步（异步，不阻塞启动）
      localSource.sync().then(result => {
        if (verbose) console.log(`[KnowledgeSource] 本地源同步完成: +${result.added} 更新${result.updated} 删除${result.deleted} (${result.durationMs}ms)`);
      }).catch(err => {
        if (verbose) console.warn('[KnowledgeSource] 本地源同步失败:', err.message);
      });
      if (verbose) console.log(`[KnowledgeSource] 本地知识源已注册: ${config.knowledge.local.watchFolders.join(', ')}`);
    }

    // 网络知识源（DuckDuckGo 免费，无需 key 也可注册）
    if (config.knowledge?.web) {
      const webSource = new WebSource(this.learn, this.memory, {
        searchEngine: config.knowledge.web.searchEngine,
        apiKey: config.knowledge.web.apiKey,
        maxResults: config.knowledge.web.maxResults,
        cooldownMs: config.knowledge.web.cooldownMs,
      });
      this.knowledgeSourceManager.register(webSource);
      if (verbose) console.log(`[KnowledgeSource] 网络知识源已注册: ${config.knowledge.web.searchEngine ?? 'duckduckgo'}`);
    }

    // 飞书知识源（需要 appId + appSecret + spaces）
    if (config.knowledge?.feishu?.appId && config.knowledge.feishu.appSecret && config.knowledge.feishu.spaces?.length) {
      const feishuSource = new FeishuSource(this.memory, {
        appId: config.knowledge.feishu.appId,
        appSecret: config.knowledge.feishu.appSecret,
        spaces: config.knowledge.feishu.spaces,
        syncIntervalMs: config.knowledge.feishu.syncIntervalMs,
      });
      this.knowledgeSourceManager.register(feishuSource);
      if (verbose) console.log(`[KnowledgeSource] 飞书知识源已注册: ${config.knowledge.feishu.spaces.length} 个空间`);
    }

    // --- 情绪/审计/空闲 ---
    this.audit = new AuditLogger();

    this.tts = new TTSManager();
    if (config.tts?.backend !== 'disabled') {
      this.tts.registerBackend(new EdgeTTSBackend());
      this.tts.setEnabled(config.tts?.enabled ?? true);
      const speciesVoice = this.tts.getVoiceForSpecies(config.species);
      if (speciesVoice) {
        this.tts.setDefaultOptions({ voice: speciesVoice });
      } else if (config.tts?.voice) {
        this.tts.setDefaultOptions({ voice: config.tts.voice });
      }
    } else {
      this.tts.setEnabled(false);
    }

    // 注册语音工具（需 TTSManager 实例）
    this.tools.registerMany(createVoiceTools(this.tts));

    // 注册多模态工具（需 LLMAdapter 实例）
    this.tools.registerMany(createMultimodalTools(this._llm));

    // 注册自定义 HTTP API 工具（ComfyUI、Whisper 等本地服务）
    const httpTools = createHttpApiTools(config.customTools);
    if (httpTools.length > 0) {
      this.tools.registerMany(httpTools);
      console.log(`[Tools] 已注册 ${httpTools.length} 个自定义 HTTP API 工具`);
    }

    this.idle = new IdleBehavior({
      blinkInterval: config.idle?.blinkMs ?? 3000,
      actionInterval: config.idle?.actionMs ?? 8000,
      enabled: config.idle?.enabled ?? true,
    });

    // --- BuddyClock 自主时钟 ---
    if (config.clock?.enabled) {
      const clockConfig = {
        enabled: true,
        heartbeatMs: config.clock.heartbeatMs,
        maxProactivesPerDay: config.clock.maxProactivesPerDay,
        minProactiveIntervalMs: config.clock.minProactiveIntervalMs,
      };
      this.clock = new BuddyClock(
        {
          cerebellum: this.cerebellum!,
          memory: this.memory,
          platformManager: this.platformManager,
          dream: this.dream,
          llm: this._llm,
        },
        clockConfig,
        dbDir,
        verbose,
      );
      // Phase 4: 注入 LLMCallService 到 BuddyClock → ProactiveEngine
      this.clock.setLLMCaller((prompt) => llmCallService.call(prompt, {
        systemPrompt: '你是自然语言生成器，只输出消息内容，不要任何前缀或解释。',
      }));
      this.clock.start();
      if (verbose) console.log('[BuddyClock] 自主时钟已启用');
    } else {
      this.clock = null;
    }

    // ═══════════════════════════════════════════════════════
    // 接入的 10 个模块
    // ═══════════════════════════════════════════════════════

    // 1. BeliefStore — 信念存储（持久化到 ~/.buddy/belief-store.json）
    this.beliefStore = new BeliefStore();
    this.beliefStore.loadFromDisk(dbDir);
    if (verbose) console.log(`[BeliefStore] 已加载 ${this.beliefStore.size} 条信念`);

    // 2. EntityStore — 实体存储（持久化到 ~/.buddy/entity-store.json）
    this.entityStore = new EntityStore();
    this.entityStore.loadFromDisk(dbDir);
    if (verbose) console.log(`[EntityStore] 已加载 ${this.entityStore.size} 个实体`);

    // 3. PrivacyManager — 硬件权限框架（控制 LLM 工具链中的硬件访问）
    this.privacyManager = new PrivacyManager();
    if (verbose) console.log('[PrivacyManager] 硬件权限框架已初始化');

    // 4. PerceptionEventBus — 感知事件总线
    this.perceptionBus = new PerceptionEventBus();
    if (verbose) console.log('[PerceptionEventBus] 已初始化');

    // 5. CloudTrainer — 云端训练对接器
    this.cloudTrainer = new CloudTrainer();
    if (verbose) console.log('[CloudTrainer] 已初始化（无 provider 时为待机状态）');

    // 6. TernaryGrowth — 三进制模型成长系统
    this.ternaryGrowth = new TernaryGrowth();
    // 将成长评估接入训练回调
    const existingOnTrainComplete = this.ternaryScheduler['config']?.onTrainComplete;
    this.ternaryScheduler['config'] = {
      ...this.ternaryScheduler['config'],
      onTrainComplete: async (domain: string, result: any) => {
        // 成长评估
        try {
          const model = await this.ternaryManager.load(domain);
          if (model) {
            const growthResult = this.ternaryGrowth.evaluateGrowth(model, 0, 0);
            if (growthResult.changed && verbose) {
              console.log(`[TernaryGrowth] ${domain}: ${growthResult.oldStage} → ${growthResult.newStage}`);
            }
            if (growthResult.changed) {
              await this.ternaryManager.save(model);
            }
          }
        } catch (err) {
          if (verbose) console.warn(`[TernaryGrowth] 评估失败: ${(err as Error).message}`);
        }
        // 原有回调
        if (existingOnTrainComplete) await existingOnTrainComplete(domain, result);
      },
    };
    if (verbose) console.log('[TernaryGrowth] 已初始化并接入训练回调');

    // 7. KnowledgeExporter — 知识包导出（延迟绑定 getExperiences）
    this.knowledgeExporter = new KnowledgeExporter(
      this.cognitive,
      () => this.intelligence.getExperiences(),
    );
    if (verbose) console.log('[KnowledgeExporter] 已初始化');

    // 8. MCPRegistry — MCP 市场搜索
    this.mcpRegistry = new MCPRegistry();
    if (verbose) console.log('[MCPRegistry] 已初始化');

    // 9. executeChain 工具注册
    const toolChainTool: import('../types.js').ToolDef = {
      name: 'execute_chain',
      description: '执行工具链：将多个工具串联执行，前一步输出自动传给下一步。用 JSON 定义链。',
      parameters: zod.object({
        chainId: zod.string().describe('链 ID'),
        name: zod.string().describe('链名称'),
        steps: zod.array(zod.object({
          tool: zod.string().describe('工具名'),
          args: zod.record(zod.unknown()).describe('参数'),
        })).describe('步骤列表，支持 ${prev} 引用上一步输出'),
      }),
      permission: 'exec_safe',
      execute: async (args) => {
        const chain = {
          id: String(args.chainId ?? `chain-${Date.now()}`),
          name: String(args.name ?? 'unnamed'),
          steps: (args.steps as any[]).map((s) => ({
            tool: s.tool,
            args: s.args ?? {},
          })),
        };
        const result = await executeChain(chain, this.tools);
        return JSON.stringify(result, null, 2);
      },
    };
    this.tools.registerMany([toolChainTool]);

    // 10. detectEnvironment — 环境检测（异步运行，不阻塞启动）
    detectEnvironment().then((checks) => {
      const failed = checks.filter(c => !c.ok);
      if (verbose) {
        console.log(`[EnvDetect] 环境检测完成: ${checks.length - failed.length}/${checks.length} 通过`);
        for (const c of failed) console.log(`  ⚠️ ${c.name}: ${c.value} — ${c.suggestion ?? ''}`);
      }
    }).catch(err => {
      if (verbose) console.warn('[EnvDetect] 检测失败:', err.message);
    });

    // ═══════════════════════════════════════════════════════
    // 三脑架构（Phase 1-6 完成）+ 影子大脑（Phase 9）
    // ═══════════════════════════════════════════════════════
    this.threeBrain = new ThreeBrain({
      verbose,
      experienceEvolver: this.intelligence.evolver,
      shadow: {
        llm: { call: (prompt: string) => llmCallService.call(prompt, {
          systemPrompt: '你是一个 AI Agent 的规则生成器。',
        }) },
        dataDir: dbDir,
        verbose,
      },
    });
    this.leftBrain = this.threeBrain.left;
    this.rightBrain = this.threeBrain.right;
    this.cerebellum = this.threeBrain.cerebellum;

    // Step 18: 注入 TextEncoder 全局单例到 RightBrain
    import('../brain/right/features/text-encoder-singleton.js').then(({ getGlobalTextEncoder }) => {
      const textEnc = getGlobalTextEncoder();
      this.rightBrain?.setTextEncoder(textEnc);
      if (verbose) console.log(`[ThreeBrain] TextEncoder 单例已注入: ${textEnc.countParams()} 参数`);
    }).catch(err => {
      if (verbose) console.warn('[ThreeBrain] TextEncoder 单例注入失败:', err.message);
    });

    // 同步注入 ModelRouter 到 UnifiedScheduler（消除异步竞态）
    // ModelPool 可能尚未初始化，但 router.select() 内部已处理 pool=null 的情况
    const llmRouter = this._llm.getRouter();
    this.threeBrain.left.scheduler.setRouter(llmRouter);
    if (verbose) console.log('[ThreeBrain] ModelRouter 已同步注入 UnifiedScheduler');

    // Step 19: EntityRegistry 数据同步 — 从 STMP/ExperienceGraph 灌入实体
    this._syncEntityRegistry(verbose);

    // Step 6+7: ResourceHub + ModelPoolResourceBridge 初始化（P7 升级：统一资源系统）
    import('../brain/hub/index.js').then(({ createResourceSystem }) => {
      return import('../brain/hub/model-pool-bridge.js').then(({ ModelPoolResourceBridge }) => {
        const system = createResourceSystem({
          schedulerAutoRefresh: false,
        });
        this.resourceSystem = system;
        this.resourceHub = system.adapter as any; // 向后兼容

        // 生命周期事件监听
        system.hub.onLifecycleEvent((event) => {
          if (event.to === 'degraded') {
            console.warn(`[ResourceHub] ⚠️ 资源降级: ${event.resourceId} (${event.reason})`);
          }
          if (event.to === 'deprecated') {
            console.warn(`[ResourceHub] 🗑️ 资源淘汰: ${event.resourceId} (${event.reason})`);
          }
          if (event.from === 'degraded' && event.to === 'active') {
            console.log(`[ResourceHub] ✅ 资源恢复: ${event.resourceId}`);
          }
        });

        const pool = llmRouter?.getPool?.();
        if (pool) {
          this.modelPoolBridge = new ModelPoolResourceBridge(pool as any, system.adapter as any);
          const synced = this.modelPoolBridge.fullSync();
          // 将同步的模型也注册到 UnifiedResourceHub
          for (const profile of pool.getAllProfiles()) {
            system.hub.register({
              id: `model/${profile.id}`,
              type: 'model',
              name: profile.displayName ?? profile.id,
              metadata: {
                provider: profile.platform,
                model: profile.id,
                active: profile.active,
              },
            });
            // 直接设置状态，避免 discovered → active 双重转换
            if (profile.active) {
              const r = system.hub.get(`model/${profile.id}`);
              if (r && r.state === 'discovered') {
                r.state = 'active';
                r.lastStateChange = Date.now();
              }
            }
          }
          if (verbose) console.log(`[ResourceHub] 已同步 ${synced} 个模型资源（统一资源系统）`);
        }

        // 启动探测调度器（延迟 60s，等系统稳定）
        setTimeout(() => {
          system.scheduler.start();
          if (verbose) console.log('[ResourceHub] 探测调度器已启动');
        }, 60_000);

        // 定期审计（每 6 小时）
        setInterval(() => {
          try {
            const report = system.hub.runAudit();
            if (report.retired.length > 0) {
              console.log(`[ResourceHub] 审计: ${report.retired.length} 个资源被淘汰`);
            }
          } catch (e: any) {
            if (verbose) console.warn('[ResourceHub] 审计异常:', e.message);
          }
        }, 6 * 60 * 60 * 1000);

        // Step: UnifiedResourceBridge — 全资源类型桥接
        import('../brain/hub/unified-resource-bridge.js').then(({ UnifiedResourceBridge }) => {
          const bridge = new UnifiedResourceBridge(system.hub);
          bridge
            .setToolRegistry(this.tools, this.skillManager.growth)
            .setKnowledgeSourceManager(this.knowledgeSourceManager)
            .setPlatformManager(this.platformManager)
            .setTTSManager(this.tts)
            .setTernaryExpertRouter(this.ternaryRouter)
            .setSkillManager(this.skillManager);

          const totalSynced = bridge.fullSync();
          if (verbose) console.log(`[UnifiedResourceBridge] 全量同步完成: ${totalSynced} 个非模型资源`);

          // 挂载到 subsystems 供外部调用
          (this as any)._resourceBridge = bridge;
        }).catch(err => {
          if (verbose) console.warn('[UnifiedResourceBridge] 初始化失败:', err.message);
        });
      });
    }).catch(err => {
      if (verbose) console.warn('[ResourceHub] 初始化失败:', err.message);
    });

    // Step 12: 三层知识管线初始化
    import('../brain/right/features/text-encoder-singleton.js').then(({ getGlobalTextEncoder }) => {
      return import('../intelligence/knowledge-convergence.js').then(({ KnowledgeConvergence }) => {
        return import('../intelligence/collision-engine.js').then(({ CollisionEngine }) => {
          return import('../intelligence/knowledge-assembler.js').then(({ KnowledgeAssembler }) => {
            let textEncoder = null;
            try { textEncoder = getGlobalTextEncoder(); } catch { /* 可能未初始化 */ }
            const convergence = new KnowledgeConvergence(
              this.stmp,
              this.intelligence.graph,
              this.knowledgeSourceManager,
              this.ternaryRouter ?? null,
              textEncoder,
              verbose,
            );
            const collision = new CollisionEngine();
            const assembler = new KnowledgeAssembler();
            this.threeBrain?.setEditingPipeline(convergence, collision, assembler);
          });
        });
      });
    }).catch(err => {
      if (verbose) console.warn('[Pipeline] 三层知识管线初始化失败:', err.message);
    });

    // 将 SensorFusion 的 STMP 写入桥接（替代 FusionBuffer）
    this.cerebellum.sensorFusion.setStmpWriter((entry) => {
      this.stmp.insertNode({
        id: `sf-${entry.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
        content: entry.content,
        room: 'default',
        timestamp: entry.timestamp,
        temporalContext: { before: [], after: [] },
        concepts: entry.concepts,
        relations: entry.relations.map(r => ({
          target: r.target,
          type: r.type === 'extends' ? 'relates_to' as const : r.type as any,
          strength: 0.5,
        })),
        emotional: {
          valence: entry.emotional?.valence ?? 0,
          importance: (entry.emotional?.importance ?? 5) * 10,
        },
        lifecycle: {
          createdAt: entry.timestamp,
          lastAccessed: entry.timestamp,
          accessCount: 1,
          decay: 0,
          compressed: false,
          hibernated: false,
        },
        source: 'observed' as const,
      });
    });

    if (verbose) console.log('[ThreeBrain] 三脑架构初始化完成');

    // Phase 2: 冷启动合成数据注入 — NN 从首次交互即有分类能力
    try {
      const seedExperiences = createSeedExperiences();
      const syntheticSamples = synthesizeTrainingData(seedExperiences);
      for (const sample of syntheticSamples) {
        this.rightBrain?.ingestExternalSample(sample);
      }
      if (verbose) console.log(`[ThreeBrain] 冷启动: 注入 ${syntheticSamples.length} 个合成训练样本`);
    } catch (err) {
      if (verbose) console.warn('[ThreeBrain] 合成数据注入失败:', (err as Error).message);
    }

    // Phase 4: 能力协同调度器初始化
    this.llmProfiler = new LLMProfiler();
    this.generationCache = new GenerationCache(dbDir);
    this.capabilityScheduler = new CapabilityScheduler();
    this.multiPathExecutor = new MultiPathExecutor();
    this.generationCache.load().catch(err => {
      if (verbose) console.warn('[CapabilityScheduler] 缓存加载失败:', err.message);
    });
    if (verbose) console.log('[CapabilityScheduler] 能力协同调度器已初始化');

    // ═══════════════════════════════════════════════════════
    // 信号汇聚层 — 打通外围通道 → 右脑训练循环
    // ═══════════════════════════════════════════════════════
    this.convergenceLayer = new SignalConvergenceLayer({ enabled: true, verbose });

    // 汇聚层输出 → 右脑 ReplayBuffer（仅入 Buffer，不触发权重更新）
    this.convergenceLayer.setOnSample((sample) => {
      this.rightBrain?.ingestExternalSample(sample);
    });

    // 接入 FeedbackLearner（用户纠正 → 高权重训练样本）
    this.feedback.setConvergenceCallback((signal) => {
      this.convergenceLayer?.ingestFeedback(signal);
      // O4: 用户纠正时增加调度器探索系数
      if (signal.type === 'correction') {
        this.leftBrain?.scheduler?.recordCorrection();
      }
    });

    // 接入 BuddyLearn（知识注入 → 中权重训练样本）
    this.learn.setConvergenceCallback((signal) => {
      this.convergenceLayer?.ingestKnowledge(signal);
    });

    // 接入 ExperienceEvolver（经验进化 → 训练样本）
    this.intelligence.evolver.setConvergenceCallback((signal) => {
      this.convergenceLayer?.ingestEvolution(signal);
    });

    if (verbose) console.log('[Convergence] 信号汇聚层已接入: FeedbackLearner, BuddyLearn, ExperienceEvolver');

    // H1: 全局缓存自动清理（每 60 秒清理过期条目，防止内存泄漏）
    setInterval(() => {
      const purged = globalToolCache.purge() + globalSemanticCache.purge();
      if (verbose && purged > 0) console.log(`[Cache] 清理 ${purged} 条过期缓存`);
    }, 60_000);

    // 定期持久化信念和实体存储（每 5 分钟）
    setInterval(() => {
      this.beliefStore.saveToDisk(dbDir);
      this.entityStore.saveToDisk(dbDir);
      this.generationCache?.save(); // Phase 4: 持久化生成缓存
    }, 5 * 60 * 1000);

    // P2-7: CrossSession → ModelPool 参数同步已通过 pool.setFeedbackCallback 实时接入

    // P2-7: CrossSession → ModelPool 参数同步已通过 pool.setFeedbackCallback 实时接入

    // World Model 自适应训练（1 分钟检查 + urgency 驱动）
    // 从磁盘恢复缓冲区
    const wmBufferFile = path.join(dbDir, 'world-model-buffer.json');
    this._worldModelBuffer = [];
    try {
      if (fs.existsSync(wmBufferFile)) {
        const raw = JSON.parse(fs.readFileSync(wmBufferFile, 'utf-8'));
        if (Array.isArray(raw)) {
          this._worldModelBuffer = raw.slice(-200);
          if (verbose && this._worldModelBuffer.length > 0) {
            console.log(`[WorldModel] 加载 ${this._worldModelBuffer.length} 条缓冲样本`);
          }
        }
      }
    } catch (e) { console.debug('[subsystems] load fail', e); }

    // 自适应训练配置
    let wmLastTrainAt = 0;
    let wmConsecutiveNoop = 0;
    const WM_BASE_INTERVAL = 60_000;   // 基础检查间隔 1 分钟
    const WM_BATCH_SIZE = 8;
    const WM_MIN_SAMPLES = 16;
    const WM_TRAIN_THRESHOLD = 32;

    setInterval(() => {
      if (this._worldModelBuffer.length < WM_MIN_SAMPLES || !this.rightBrain) return;

      // 自适应：缓冲区接近满时立即训练，少时等待积累
      const urgency = this._worldModelBuffer.length / 200; // 0~1
      const interval = WM_BASE_INTERVAL * (1 - urgency * 0.8); // 最短 12 秒
      if (Date.now() - wmLastTrainAt < interval) return;

      const sceneWM = this.rightBrain.getSceneWorldModel();
      if (!sceneWM) return;

      // 取全部可用样本（不只 32 条）
      const available = Math.min(this._worldModelBuffer.length, 64);
      const batch = this._worldModelBuffer.splice(0, available);

      // 多轮训练：每轮 batch_size=8，用完所有样本
      const epochs = Math.ceil(batch.length / WM_BATCH_SIZE);
      let lastLoss = Infinity;
      let totalTrained = 0;

      for (let e = 0; e < epochs; e++) {
        const result = sceneWM.train(batch, WM_BATCH_SIZE);
        totalTrained += result.trained;

        // loss 门控：loss 暴涨 50% 则停止
        if (lastLoss < Infinity && result.loss > lastLoss * 1.5) {
          if (verbose) console.log(`[WorldModel] loss 暴涨 ${lastLoss.toFixed(4)}→${result.loss.toFixed(4)}，提前停止`);
          break;
        }
        lastLoss = result.loss;
      }

      wmLastTrainAt = Date.now();

      if (totalTrained > 0) {
        wmConsecutiveNoop = 0;
        if (verbose) console.log(`[WorldModel] 训练: loss=${lastLoss.toFixed(4)}, samples=${totalTrained}/${batch.length}, epochs=${epochs}`);
      } else {
        wmConsecutiveNoop++;
      }

      // 持久化
      try { fs.writeFileSync(wmBufferFile, JSON.stringify(this._worldModelBuffer)); } catch (e) { console.debug('[subsystems] op fail', e); }
    }, WM_BASE_INTERVAL);
  }

  private wmSampleCounter = 0;
  private readonly WM_SAMPLE_RATE = 3; // 每 3 次交互采样 1 次

  /** 喂入 World Model 训练样本（运行时采集，降采样） */
  feedWorldModelSample(sample: {
    scene_before: any; action: any; scene_after: any;
    completion: boolean; risk_label: number;
  }): void {
    this.wmSampleCounter++;
    if (this.wmSampleCounter % this.WM_SAMPLE_RATE !== 0) return; // 降采样

    this._worldModelBuffer.push(sample);
    // 缓冲区上限，防止内存膨胀
    if (this._worldModelBuffer.length > 200) {
      this._worldModelBuffer.splice(0, this._worldModelBuffer.length - 200);
    }
  }

  /** 热重载 LLM 配置 — 只更新 fallback provider，不动统一模型池 */
  reconfigureLLM(config: import('../types.js').LLMConfig): void {
    // 直接在现有 LLMAdapter 上热更新 provider，避免新建实例丢失统一池
    this._llm.updateProvider(config);
  }

  /** 连接配置的 MCP Server 并注册工具 */
  private async _connectMCPServers(
    servers: NonNullable<BuddyConfig['mcp']['servers']>,
    verbose: boolean,
  ): Promise<void> {
    for (const serverCfg of servers) {
      try {
        const tools = await this.mcpAdapter.connect({
          name: serverCfg.name,
          command: serverCfg.command,
          args: serverCfg.args,
          env: serverCfg.env,
          description: serverCfg.description,
        });
        const toolDefs = this.mcpAdapter.registerAsToolDefs(serverCfg.name);
        this.tools.registerMany(toolDefs);
        if (verbose) {
          console.log(`[MCP] 已连接: ${serverCfg.name} (${tools.length} 个工具)`);
        }
      } catch (err) {
        if (verbose) console.warn(`[MCP] 连接失败: ${serverCfg.name} — ${(err as Error).message}`);
      }
    }
  }

  /** 将 STMP 知识注入三进制训练调度器 */
  async feedTernaryScheduler(): Promise<number> {
    const profiles = this.cognitive.getAllDomainProfiles();
    let totalFed = 0;

    for (const profile of profiles) {
      if (profile.growthStage === 'seed') continue;

      try {
        const result = await this.stmp.retrieve(profile.domain, { maxPrimary: 30, maxAssociative: 10 });
        const nodes = [...result.primary, ...result.associative];
        if (nodes.length < 3) continue;

        // 转换为三进制训练样本
        const samples: TernaryTrainingSample[] = nodes
          .filter(n => n.content.length >= 10 && n.content.length <= 500)
          .map(n => ({
            inputIds: [],  // tokenizer 会在训练时处理
            targetIds: [],
            type: 'instruct' as const,
            domain: profile.domain,
            quality: (n.emotional?.importance ?? 5) / 10,
            timestamp: n.timestamp,
          }));

        if (samples.length > 0) {
          this.ternaryScheduler.addSamples(profile.domain, samples);
          totalFed += samples.length;
        }
      } catch {
        // 跳过失败的领域
      }
    }

    return totalFed;
  }

  // ==================== ExecutionSession 工厂 ====================

  private _activeSession: ExecutionSession | null = null;

  /** 创建或获取当前执行会话 */
  createExecutionSession(goal: string, options?: {
    autonomyLevel?: AutonomyLevel;
    maxRetries?: number;
    maxSteps?: number;
    checkpointInterval?: number;
  }): ExecutionSession {
    const risk = assessTaskRisk(goal);
    const autonomyLevel = options?.autonomyLevel
      ?? decideAutonomyLevel({
        taskRisk: risk,
        userCorrectionCount: 0,
        sessionLength: 0,
        isFirstSession: false,
      });

    this._activeSession = new ExecutionSession({
      id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      goal,
      autonomyLevel,
      maxRetries: options?.maxRetries ?? 2,
      maxSteps: options?.maxSteps ?? 20,
      checkpointInterval: options?.checkpointInterval ?? 5,
    });

    return this._activeSession;
  }

  /** 获取当前活跃的执行会话 */
  get activeSession(): ExecutionSession | null {
    return this._activeSession;
  }

  /** 清除当前执行会话 */
  clearSession(): void {
    this._activeSession = null;
  }

  /** 关闭所有子系统 */
  async closeAll(eventBus: { close: () => void } | null, dreamTimer: ReturnType<typeof setInterval> | null, fsWatcher: FileWatcher | null, name: string): Promise<void> {
    this.idle.stop();
    this.clock?.destroy();
    fsWatcher?.destroy();
    if (dreamTimer) clearInterval(dreamTimer);

    // 三脑架构清理（threeBrain.destroy() 内部已调用 left/right/cerebellum.destroy()）
    this.threeBrain?.destroy();

    // 先保存异步数据
    await this.intelligence.save().catch(err => console.warn('[Subsystems] intelligence.save 失败:', err.message));
    await this.mcpAdapter.disconnectAll().catch(err => console.warn('[Subsystems] mcpAdapter.disconnectAll 失败:', err.message));

    // 持久化信念和实体存储
    const dbDir = path.join(process.env.HOME ?? '/tmp', '.buddy');
    this.beliefStore.saveToDisk(dbDir);
    this.entityStore.saveToDisk(dbDir);

    // 持久化 World Model 训练缓冲区
    try {
      const wmBufferFile = path.join(dbDir, 'world-model-buffer.json');
      fs.writeFileSync(wmBufferFile, JSON.stringify(this._worldModelBuffer));
    } catch (e) { console.debug('[subsystems] op fail', e); }

    this.friendSystem.destroy();
    this.platformManager.destroy();
    this.buddyInteraction.destroy();
    this.audit.close();
    eventBus?.close();
    this.cognitive.close();
    this.stmp.close();
    this.pet.close();
    this.memory.close();
    console.log(`👋 ${name} 已关闭`);
  }

  /**
   * EntityRegistry 数据同步 — 从 STMP/ExperienceGraph 灌入实体
   *
   * 设计来源: RIGHT_BRAIN_ACTIVATION_PLAN.md Phase 2
   * 断裂点修复: entity-adapters.ts 的 extractFrom* 从未被调用
   */
  private _syncEntityRegistry(verbose: boolean): void {
    if (!this.rightBrain) return;

    const registry = this.rightBrain.entityRegistry;
    if (!registry) return;

    try {
      // 适配 STMPStore → STMPSource 接口
      const stmpAdapter = {
        getMemoriesInRoom: (roomId: string, limit = 50) => {
          const nodes = this.stmp.getRecentInRoom(roomId, limit);
          return nodes.map(n => ({
            id: n.id,
            content: n.content,
            room: n.room,
            concepts: n.concepts,
            importance: (n.emotional?.importance ?? 5) / 10, // 归一化到 0-1
            timestamp: n.timestamp,
            accessCount: n.lifecycle?.accessCount ?? 0,
            decay: n.lifecycle?.decay ?? 0,
          }));
        },
        searchMemories: (query: string, limit = 20) => {
          const nodes = this.stmp.searchNodes(query, limit);
          return nodes.map(n => ({
            id: n.id,
            content: n.content,
            room: n.room,
            concepts: n.concepts,
            importance: (n.emotional?.importance ?? 5) / 10,
            timestamp: n.timestamp,
            accessCount: n.lifecycle?.accessCount ?? 0,
            decay: n.lifecycle?.decay ?? 0,
          }));
        },
        getRooms: () => {
          return this.stmp.listRooms().map(r => ({
            id: r.id,
            name: r.name,
            tags: r.tags,
            memoryCount: r.memoryCount,
          }));
        },
      };

      // 适配 ExperienceGraph → ExperienceSource 接口
      const experienceGraph = this.intelligence?.graph;
      const experienceAdapter = experienceGraph ? {
        getAllNodes: () => {
          return experienceGraph.getAllNodes().map(n => ({
            id: n.id,
            name: n.name,
            description: n.description,
            trigger: {
              keywords: n.trigger?.keywords ?? [],
              contextTags: n.trigger?.contextTags ?? [],
            },
            stats: {
              successCount: n.stats?.successCount ?? 0,
              failCount: n.stats?.failCount ?? 0,
              confidence: n.stats?.confidence ?? 0,
            },
          }));
        },
        getAllEdges: () => {
          // ExperienceGraph 没有 getAllEdges，用 getEdges 遍历
          const nodes = experienceGraph.getAllNodes();
          const edgeSet = new Set<string>();
          const edges: Array<{ from: string; to: string; type: string; weight: number }> = [];
          for (const node of nodes) {
            for (const edge of experienceGraph.getEdges(node.id)) {
              const key = `${edge.from}->${edge.to}:${edge.type}`;
              if (!edgeSet.has(key)) {
                edgeSet.add(key);
                edges.push({ from: edge.from, to: edge.to, type: edge.type, weight: edge.weight });
              }
            }
          }
          return edges;
        },
      } : undefined;

      const result = syncAllSources(registry, {
        stmp: stmpAdapter,
        experience: experienceAdapter,
      });

      if (verbose) {
        console.log(`[EntityRegistry] 同步完成: ${result.totalEntities} 实体, ${result.totalEdges} 边`);
        if (result.stmp.entityCount > 0) console.log(`  STMP: ${result.stmp.entityCount} 实体`);
        if (result.experience.entityCount > 0) console.log(`  Experience: ${result.experience.entityCount} 实体`);
      }

      // 定期重新同步（每 30 分钟）
      setInterval(() => {
        try {
          const r = syncAllSources(registry, { stmp: stmpAdapter, experience: experienceAdapter });
          if (verbose && r.totalEntities > 0) {
            console.log(`[EntityRegistry] 重新同步: ${r.totalEntities} 实体`);
          }
        } catch (e: any) {
          if (verbose) console.warn('[EntityRegistry] 重新同步失败:', e.message);
        }
      }, 30 * 60 * 1000);

    } catch (err: any) {
      if (verbose) console.warn('[EntityRegistry] 同步失败:', err.message);
    }
  }
}

/**
 * 工厂函数：初始化所有子系统
 */
export function initSubsystems(config: BuddyConfig, verbose: boolean): Subsystems {
  return new Subsystems(config, verbose);
}
