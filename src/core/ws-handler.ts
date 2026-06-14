import type { BuddyConfig, WSClientMessage, WSEvent } from '../types.js';
import { getTrustLevel, estimateMaxLimit } from '../types.js';
import type { IdleAction, ActionParams } from '../behavior/idle.js';
import type { FileChangeEvent } from '../perception/fs-watcher.js';
import { NarratorEngine } from '../behavior/narrator.js';
import type { Subsystems } from './subsystems.js';
import type { MessageProcessor } from './message-processor.js';
import type { BehaviorTracker } from './behavior-tracker.js';
import { getFallbackReply } from './constants.js';
import { TaskExecutor } from '../orchestrate/index.js';
import type { EventBus } from '../ws/server.js';
import { LinkHandler } from './link-handler.js';
import { AdaptiveTaskQueue } from './task-queue.js';
import { ExecutionSession, decideAutonomyLevel, assessTaskRisk, type AutonomyLevel } from './execution-session.js';
import { ExpertPool } from './expert-pool.js';
import { LinkDiagnostics } from './link-diagnostics.js';
import { WSProtocol, type PendingConfirm } from './ws-protocol.js';
import { I18nServerCache } from './i18n-cache.js';
import { AudioCache } from './audio-cache.js';
import { PanelHandlers } from './panel-handlers.js';
import { DreamTernaryHandler } from './dream-ternary.js';
import { TTSBridge } from './tts-bridge.js';
import { WSEventHandlers } from './ws-event-handlers.js';
import { OrchestrationHandler } from './orchestration-handler.js';
import { setupRESTAPI } from './rest-api.js';
import { reflect } from './reflector.js';
import { collectSignals, collectResourceState } from './signal-collector.js';

/** Agent 桥接接口 — 避免循环依赖 */
interface AgentBridge {
  preprocessMessage(content: string): { type: string; content: string } | null;
  postprocessResult(content: string, result: { text: string; toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }> }): void;
  orchestrate(content: string): Promise<import('../types.js').OrchestrationPlan>;
  executeByPlan(plan: import('../types.js').OrchestrationPlan): Promise<import('../types.js').ExecutionResult>;
  /** 记录决策结果（更新 success/executionMs） */
  recordOutcome(success: boolean, error?: string, executionMs?: number): void;
  getDecisionTrace(): Array<{
    traceId: string; timestamp: number; input: string;
    domains: string[]; complexity: string; mode: string; reason: string;
    nodes: string[]; localCoverageRatio: number; localConfidence: number;
    path: string; latencyMs: number; success: boolean | null;
    error?: string; executionMs?: number;
  }>;
  getABStats(): {
    enabled: boolean; ratio: number;
    threeBrain: { count: number; avgLatencyMs: number; successRate: number; avgExecutionMs: number; modes: Record<string, number> };
    legacy: { count: number; avgLatencyMs: number; successRate: number; avgExecutionMs: number; modes: Record<string, number> };
  };
  /** Phase 2: 设置信号观察器（brain_trace 推送） */
  setSignalObserver(observer: ((event: { phase: 'signal' | 'resource' | 'decision' | 'execution' | 'outcome'; traceId: string; timestamp: number; data: Record<string, unknown> }) => void) | null): void;
}

/**
 * WebSocket 事件处理 — 消息路由、广播、空闲行为、梦境、TTS
 */
export class WSHandler {
  private eventBus: EventBus | null = null;
  // ISSUE-012: 并发确认队列已移入 WSProtocol
  private dreamTimer: ReturnType<typeof setInterval> | null = null;
  private taskExecutor: TaskExecutor;
  private taskQueue: AdaptiveTaskQueue;
  private expertPool: ExpertPool;
  private currentSession: ExecutionSession | null = null;
  private sessionCounter = 0;
  private userCorrectionCount = 0;
  private sessionMessageCount = 0;
  // 分层超时：不同任务类型用不同超时阈值
  private readonly TIMEOUT_CHAT_MS = 30_000;        // 简单问答 30s
  private readonly TIMEOUT_ORCHESTRATE_MS = 120_000; // DAG 编排 120s
  private readonly TIMEOUT_EXPERT_MS = 90_000;       // 多专家 90s
  private agentRef: AgentBridge | null = null;
  private wsProtocol: WSProtocol;
  private narratorEngine: NarratorEngine = new NarratorEngine();
  private i18nCache: I18nServerCache;
  private audioCache: AudioCache;
  private panelHandlers: PanelHandlers;
  private dreamTernary: DreamTernaryHandler;
  private ttsBridge: TTSBridge;
  private eventHandlers: WSEventHandlers;
  private orchHandler: OrchestrationHandler;

  constructor(
    private sys: Subsystems,
    private processor: MessageProcessor,
    private behavior: BehaviorTracker,
    private config: BuddyConfig,
    private verbose: boolean,
  ) {
    this.taskExecutor = new TaskExecutor(sys.tools, undefined, verbose);
    const linkHandler = new LinkHandler(verbose);
    const linkDiag = new LinkDiagnostics();
    this.wsProtocol = new WSProtocol({ linkHandler, linkDiag, verbose });
    this.taskQueue = new AdaptiveTaskQueue({
      initialLimit: parseInt(process.env.BUDDY_MAX_CONCURRENT ?? '', 10) || (config.ws.maxConcurrent ?? 3),
      maxLimit: estimateMaxLimit(config.models?.providers?.[0]?.type ?? 'openai'),
      maxWaitMs: parseInt(process.env.BUDDY_TASK_QUEUE_WAIT_MS ?? '', 10) || 60_000,
      verbose,
    });
    // ExpertPool: 多专家并行调用（LLM 适配器延迟绑定，对接 ModelRouter）
    this.expertPool = new ExpertPool(
      {
        chat: async (messages, model, options) => {
          const aiMessages = messages.map(m => ({
            role: m.role as 'system' | 'user' | 'assistant',
            content: m.content,
            timestamp: Date.now(),
          }));
          const result = await this.sys.llm.chat(aiMessages, [], 1, {
            userOverride: model,
          });
          return { text: result.text ?? '' };
        },
      },
      this.eventBus,
      // 对接 ModelRouter，让不同专家可以选不同模型
      this.sys.llm.getRouter(),
    );
    // 初始化配置 hash
    this.wsProtocol.getLinkHandler().updateConfigHash(config);
    // 初始化 i18n 翻译缓存
    this.i18nCache = new I18nServerCache(verbose);
    this.i18nCache.init();
    // 初始化音频缓存
    this.audioCache = new AudioCache();
    // 初始化面板处理（eventBus 延迟绑定，在 setEventBus 中更新）
    this.panelHandlers = null!;
    this.dreamTernary = null!;
    this.ttsBridge = null!;
    this.eventHandlers = null!;
    this.orchHandler = null!;
  }

  /** 获取用户纠正次数（供 orchestrate() 使用） */
  getUserCorrectionCount(): number { return this.userCorrectionCount; }

  /** 获取 eventBus（供 Agent 使用） */
  getEventBus(): EventBus | null { return this.eventBus; }

  /** 设置 eventBus（同时初始化依赖 eventBus 的子模块） */
  setEventBus(eb: EventBus): void {
    this.eventBus = eb;
    this.panelHandlers = new PanelHandlers({ sys: this.sys, eventBus: eb, verbose: this.verbose });
    this.dreamTernary = new DreamTernaryHandler({
      sys: this.sys, eventBus: eb, behavior: this.behavior, config: this.config, verbose: this.verbose,
      broadcastEmotion: () => this.broadcastEmotion(),
      broadcastStatus: () => this.broadcastStatus(),
      checkAndEmitEvolution: (r) => this.checkAndEmitEvolution(r),
      emitGuidanceIfAny: () => this.emitGuidanceIfAny(),
    });
    this.ttsBridge = new TTSBridge({ sys: this.sys, eventBus: eb, audioCache: this.audioCache, verbose: this.verbose });
    this.eventHandlers = new WSEventHandlers({
      sys: this.sys, eventBus: eb, verbose: this.verbose,
      broadcastEmotion: () => this.broadcastEmotion(),
      broadcastStatus: () => this.broadcastStatus(),
      checkAndEmitEvolution: (r) => this.checkAndEmitEvolution(r),
      emitGuidanceIfAny: () => this.emitGuidanceIfAny(),
      handleOrchestrate: (c) => this.orchHandler.handleOrchestrate(c),
      syncPersonalityToEmotion: () => this.syncPersonalityToEmotion(),
      recordUserCorrection: () => this.recordUserCorrection(),
    });
    this.orchHandler = new OrchestrationHandler({
      sys: this.sys, eventBus: eb, verbose: this.verbose,
      taskExecutor: this.taskExecutor, taskQueue: this.taskQueue,
      expertPool: this.expertPool, linkDiag: this.wsProtocol.getDiagnostics(),
      broadcastEmotion: () => this.broadcastEmotion(),
      broadcastStatus: () => this.broadcastStatus(),
      checkAndEmitEvolution: (r) => this.checkAndEmitEvolution(r),
      emitGuidanceIfAny: () => this.emitGuidanceIfAny(),
    });
  }

  /** 获取 pendingConfirm（供确认拦截使用）— ISSUE-012: 支持并发（委托 WSProtocol） */
  getPendingConfirm(id?: string): PendingConfirm | null {
    return this.wsProtocol.getPendingConfirm(id);
  }
  setPendingConfirm(pc: PendingConfirm | null): void {
    this.wsProtocol.setPendingConfirm(pc);
  }
  /** 移除指定确认（ISSUE-012） */
  removePendingConfirm(id: string): void { this.wsProtocol.removePendingConfirm(id); }

  /**
   * 等待用户确认（阻塞式）
   * 通过 pendingConfirm 队列实现：创建 Promise，等前端 tool_confirm_response 回传后 resolve
   */
  private waitForConfirmation(id: string, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.wsProtocol.removePendingConfirm(id);
        resolve(false); // 超时视为拒绝
      }, timeoutMs);

      this.wsProtocol.setPendingConfirm({
        id,
        resolve: (allowed: boolean) => {
          clearTimeout(timer);
          resolve(allowed);
        },
      });
    });
  }

  /** 设置 Agent 引用（用于共享消息处理逻辑） */
  setAgentRef(agent: AgentBridge): void {
    this.agentRef = agent;
    // Phase 2: 注册信号观察器 → brain_trace WS 事件
    agent.setSignalObserver((event) => {
      this.eventBus?.emit({
        type: 'brain_trace',
        phase: event.phase,
        traceId: event.traceId,
        timestamp: event.timestamp,
        data: event.data,
      });
    });
  }

  /** 获取 dreamTimer（供 shutdown 使用） */
  getDreamTimer(): ReturnType<typeof setInterval> | null { return this.dreamTimer; }

  /** 获取 LinkHandler（供外部集成使用） */
  getLinkHandler(): LinkHandler { return this.wsProtocol.getLinkHandler(); }

  /** 获取 TaskQueue（供状态查询使用） */
  getTaskQueue(): AdaptiveTaskQueue { return this.taskQueue; }

  /** 获取当前 ExecutionSession（供状态查询使用） */
  getCurrentSession(): ExecutionSession | null { return this.currentSession; }

  /** 获取 ExpertPool（供状态查询使用） */
  getExpertPool(): ExpertPool { return this.expertPool; }

  /** 获取缓存的音频数据（供 REST 端点和测试使用） */
  getAudio(id: string): { data: string; format: string } | null {
    return this.audioCache.get(id);
  }

  /**
   * 多专家并行处理入口
   * 1. 根据任务类型选择专家
   * 2. 并行调用所有专家
  /** 记录用户纠正（降低自主等级） */
  recordUserCorrection(): void {
    this.userCorrectionCount++;
    if (this.verbose) console.log(`  [Session] 用户纠正 #${this.userCorrectionCount}`);
  }

  /** 初始化 WebSocket 消息路由 */
  setupWebSocket(): void {
    if (!this.eventBus) return;

    // 通信层诊断：连接/断连事件
    this.wsProtocol.setupConnectionEvents(this.eventBus);

    this.eventBus.onMessage((msg: WSClientMessage, ws?: import('ws').WebSocket) => {
      // 协议层处理（心跳、重连、确认、ACK）
      if (this.wsProtocol.handleProtocolMessage(msg, this.eventBus!, ws)) return;

      // 幂等检查 + ACK
      if (this.wsProtocol.handleIdempotency(msg, this.eventBus!)) return;

      switch (msg.type) {
        case 'chat':
          this.handleUserMessage(msg.content, msg.id);
          break;
        case 'pet':
          this.eventHandlers.handlePet();
          break;
        case 'command':
          this.eventHandlers.handleCommand(msg.command, msg.args);
          break;
        case 'status_request':
          this.broadcastStatus();
          break;
        case 'visual_seed':
          this.eventHandlers.handleVisualSeed(msg);
          break;
        case 'orchestrate':
          if (msg.content) this.orchHandler.handleOrchestrate(String(msg.content));
          break;
        case 'evolution_log':
          this.eventHandlers.handleEvolutionLog(msg);
          break;
        case 'sensor_update':
          this.eventHandlers.handleSensorUpdate(msg);
          break;
        case 'tool_panel_request':
          this.panelHandlers.handleToolPanelRequest();
          break;
        case 'memory_panel_request':
          this.panelHandlers.handleMemoryPanelRequest();
          break;
        case 'knowledge_panel_request':
          this.panelHandlers.handleKnowledgePanelRequest();
          break;
        case 'multi_expert':
          if (msg.content) this.orchHandler.handleMultiExpertParallel(
            String(msg.content),
            (results, msg) => this.orchHandler.handleMultiExpert(results, msg),
            this.TIMEOUT_EXPERT_MS,
          );
          break;
        case 'emotion_source':
          this.eventHandlers.handleEmotionSource(msg);
          break;
      }

      // 标记消息已处理
      this.wsProtocol.markProcessed(msg);
    });
  }

  /** 初始化空闲行为 + 梦境定时器 */
  setupIdleBehavior(): void {
    if (!this.eventBus) return;

    // ── 感知事件推送到前端 ──
    this.sys.perceptionBus.onPerception((event) => {
      this.eventBus?.emit({
        type: 'perception_event',
        id: event.id,
        category: event.category,
        source: event.source,
        data: (event.data ?? {}) as Record<string, unknown>,
        timestamp: event.timestamp,
      });
    });

    this.sys.idle.onBlink(() => {});

    this.sys.idle.onAction((action: IdleAction, params?: ActionParams) => {
      this.sys.cerebellum?.onIdle(1);
      this.eventBus?.emit({
        type: 'idle_action',
        action,
        duration: params?.duration ?? 2000,
        intensity: params?.intensity ?? 0.5,
      });
      this.broadcastEmotion();

      // Phase 5: 叙事引擎 — 检查是否有内心独白
      try {
        const ctx = this.sys.idle.contextProvider.getContext();
        const narration = this.narratorEngine.checkForNarration(ctx);
        if (narration) {
          this.eventBus?.emit({
            ...narration,
            type: 'narration',
            narrationType: narration.type,
          });
        }
      } catch (err) {
        // 叙事失败不影响主流程
        if (this.verbose) console.warn('[Narrator] 叙事检查失败:', (err as Error).message);
      }

      // Phase 6: 空闲时调度经验执行
      try {
        const domains = this.sys.experienceScheduler?.getAvailableDomains?.();
        if (domains && domains.length > 0 && this.verbose) {
          console.log(`  [Scheduler] 可用经验领域: ${domains.length} 个`);
        }
      } catch (err) {
        // scheduler 可能未完全初始化，忽略
      }
    });

    this.dreamTimer = setInterval(() => {
      this.dreamTernary.tryDream('idle');
      this.dreamTernary.tryTernaryTrain();
    }, 10 * 60 * 1000);

    // 定期更新 maxLimit（每 60 秒根据运行时 RPM 重新估算）
    setInterval(() => {
      const limiter = this.taskQueue.getLimiter?.();
      if (limiter) {
        const runtimeRPM = limiter.estimateRPM();
        if (runtimeRPM > 0) {
          const newMaxLimit = estimateMaxLimit(this.config.models?.providers?.[0]?.type ?? 'openai', 3000, 10, runtimeRPM);
          this.taskQueue.updateMaxLimit?.(newMaxLimit);
          if (this.verbose) {
            console.log(`  [Adaptive] maxLimit 更新: runtimeRPM=${runtimeRPM} → maxLimit=${newMaxLimit}`);
          }
        }
      }
    }, 60_000);

    // ISSUE-013: 定期清理过期音频缓存（每 30 秒）
    setInterval(() => { this.audioCache.purge(); }, 30_000);

    this.sys.idle.start();
  }

  /** 初始化 REST API 路由 */
  setupREST(): void {
    if (!this.eventBus) return;

    setupRESTAPI({
      sys: this.sys,
      config: this.config,
      eventBus: this.eventBus,
      verbose: this.verbose,
      agentRef: this.agentRef,
      linkHandler: this.wsProtocol.getLinkHandler(),
      linkDiag: this.wsProtocol.getDiagnostics(),
      taskQueue: this.taskQueue,
      getAudio: (id) => this.audioCache.get(id),
      i18nCacheLookup: (texts, lang) => this.i18nCache.lookup(texts, lang),
      i18nCacheWrite: (lang, translations) => this.i18nCache.write(lang, translations),
      handleUserMessage: (content, msgId) => this.handleUserMessage(content, msgId),
    });
  }

  /* ── 以下原有代码已提取到 rest-api.ts ──
    const eb = this.eventBus;

    // 辅助：读取 POST body

  /** 同步人格到小脑（每 100 条交互调用，成长系统：引入 PS） */
  syncPersonalityToEmotion(): void {
    const signals = this.sys.pet.getBehaviorSignals();
    const intimacy = this.sys.pet.getIntimacy();
    this.sys.cerebellum?.setPersonality({
      snark: signals.snark, wisdom: signals.wisdom, chaos: signals.chaos,
      patience: signals.patience, debugging: signals.debugging,
    });
    this.sys.cerebellum?.setIntimacy(intimacy);

    // ── OCEAN + PS → 小脑调制 ──
    const ocean = this.sys.pet.getOcean?.();
    if (ocean) {
      this.sys.cerebellum?.setPersonality(ocean);
    }
    const ps = this.sys.pet.getPersonalityStrength?.() ?? 1;
    this.sys.cerebellum?.setPersonalityStrength(ps);

    // ── 同步欲望到空闲行为 ──
    const desires = this.sys.cerebellum?.getDesires();
    if (desires) this.sys.idle.setDesires(desires);
    if (ocean) {
      this.sys.idle.setOcean(ocean);
    }
    this.sys.idle.setPersonalityStrength(ps);
  }

  broadcastEmotion(): void {
    const state = this.sys.cerebellum?.getLegacyState();
    if (!state) return;
    this.eventBus?.emit({
      type: 'emotion',
      mood: state.mood,
      energy: state.energy,
      satisfaction: state.satisfaction,
      intensity: state.intensity,
      isAuthentic: state.isAuthentic,
    });
  }

  /** 检查并广播进化事件 */
  checkAndEmitEvolution(result: { evolved?: boolean; previousStage?: string; newStage?: string }): void {
    if (result.evolved && this.eventBus) {
      this.eventBus.emit({
        type: 'evolution',
        from: result.previousStage ?? 'unknown',
        to: result.newStage ?? 'unknown',
      });
      this.broadcastStatus();
    }
  }

  /** 广播完整状态（含成长系统 PS + OCEAN） */
  broadcastStatus(): void {
    const emotionState = this.sys.cerebellum?.getLegacyState();
    const petSummary = this.sys.pet.getSummary();
    const ocean = this.sys.pet.getOcean?.();
    const ps = this.sys.pet.getPersonalityStrength?.();

    this.eventBus?.emit({
      type: 'status',
      data: {
        name: petSummary.name,
        species: petSummary.species,
        emoji: petSummary.emoji,
        rarity: petSummary.rarity,
        rarityColor: petSummary.rarityColor,
        evolutionStage: petSummary.evolutionStage,
        stageName: petSummary.stageName,
        stageEmoji: petSummary.stageEmoji,
        stageDescription: petSummary.stageDescription,
        intimacy: petSummary.intimacy,
        intimacyDescription: petSummary.intimacyDescription,
        behaviorSignals: petSummary.behaviorSignals,
        stats: petSummary.battleStats,
        features: petSummary.features,
        exploration: petSummary.exploration,
        guidance: petSummary.guidance,
        petStats: petSummary.stats,
        emotion: emotionState,
        visualSeed: petSummary.visualSeed,
        formProgress: petSummary.formProgress,
        visualStage: petSummary.visualStage,
        // 成长系统
        ocean: ocean ?? undefined,
        personalityStrength: ps ?? undefined,
        // 基因系统
        genome: this.sys.pet.getGenome(this.sys.cognitive ? {
          getUserProfile: () => this.sys.cognitive.getUserProfile(),
          getAllDomainProfiles: () => this.sys.cognitive.getAllDomainProfiles(),
        } : undefined),
        // 商城装备
        equippedItems: this.sys.shopCatalog.getEquippedItems('default'),
      },
    });
  }

  /** 检查并推送引导消息 */
  emitGuidanceIfAny(): void {
    const guidance = this.sys.pet.getNextGuidance();
    if (guidance && this.eventBus) {
      this.eventBus.emit({
        type: 'bubble',
        text: `💡 ${guidance.hint}`,
      });
      this.sys.pet.markGuidanceShown(guidance.id);
    }
  }

  /**
   * 处理用户消息（WebSocket 模式）
   * 复用 Agent 的 preprocessMessage/postprocessResult 减少重复
   */
  async handleUserMessage(content: string, msgId?: string): Promise<void> {
    const taskId = msgId ?? `msg-${Date.now()}`;

    // 通过 TaskQueue 获取执行权（超时自动拒绝，不再阻塞新消息）
    try {
      await this.taskQueue.acquire(taskId);
    } catch (err) {
      this.eventBus?.emit({ type: 'error', message: '系统繁忙，请稍后重试' });
      return;
    }

    // 安全超时：强制释放超时任务（兜底机制）
    this.taskQueue.releaseExpired(this.TIMEOUT_CHAT_MS);

    const taskStartTime = Date.now();
    let taskSuccess = true;
    let taskErrorCode: number | undefined;

    // 阶段 4: 任务级反馈追踪
    const taskModelsUsed = new Set<string>();
    let taskCascadeTriggered = false;
    let taskToolCallCount = 0;
    let taskToolSuccessCount = 0;

    // 设置模型选择追踪回调
    const router = this.sys.llm.getRouter();
    const prevOnSelection = (router as any).onSelection;
    router.setOnSelection((sel: any) => {
      taskModelsUsed.add(sel.profile?.id ?? sel.id ?? 'unknown');
    });

    // 创建 ExecutionSession — 每条消息有完整的生命周期管理
    this.sessionMessageCount++;
    const autonomyLevel = decideAutonomyLevel({
      taskRisk: assessTaskRisk(content),
      userCorrectionCount: this.userCorrectionCount,
      sessionLength: this.sessionMessageCount,
      isFirstSession: this.sessionMessageCount <= 1,
    });

    const session = new ExecutionSession({
      id: `session-${++this.sessionCounter}-${Date.now()}`,
      goal: content.slice(0, 200),
      autonomyLevel,
      maxRetries: 2,
      maxSteps: 20,
      checkpointInterval: 5,
    });
    session.start();
    this.currentSession = session;

    if (this.verbose) console.log(`  [Session] ${session.id} 开始 (自主等级 L${autonomyLevel})`);

    this.eventBus?.emit({ type: 'user_message' });
    this.syncPersonalityToEmotion();
    this.broadcastEmotion();

    // 订阅限制
    const userId = 'local';
    const msgQuota = this.sys.subscriptionManager.recordMessage(userId);
    if (!msgQuota.allowed) {
      const prompt = this.sys.entitlementChecker.getUpgradePrompt(userId, 'chat.unlimited');
      this.eventBus?.emit({ type: 'bubble', text: prompt || '今日消息数已用完' });
      this.taskQueue.release(taskId);
      return;
    }

    let promptTokens = 0;
    try {
      // 预处理（养成+反馈+行为+记忆+情绪）— 统一走 preprocessMessage，避免重复调用
      const correction = this.agentRef?.preprocessMessage(content);
      if (correction && (correction.type === 'remember' || correction.type === 'correction')) {
        this.eventBus?.emit({ type: 'bubble', text: `📝 记住了: ${(correction.content ?? '').slice(0, 50)}` });
      }
      // preprocessMessage 内部已调用 pet.trackFeature，进化检测在工具执行后触发
      this.broadcastEmotion();

      this.broadcastEmotion();
      this.eventBus?.emit({ type: 'thinking' });
      this.sys.cerebellum?.onThinking();
      this.broadcastEmotion();

      // ExecutionSession: LLM 调用步骤
      const llmStep = session.addStep('llm_call', { content });

      // 高风险操作自动暂停确认（L0/L1 自主等级）
      if (session.shouldPauseForConfirmation('llm_call', { content })) {
        const confirmId = `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        this.eventBus?.emit({
          type: 'confirm_required',
          id: confirmId,
          question: `确认执行: ${content.slice(0, 50)}${content.length > 50 ? '...' : ''}?`,
        } as WSEvent);
        // L0: 每步都等确认；L1: 高风险等确认
        if (autonomyLevel <= 1) {
          const allowed = await this.waitForConfirmation(confirmId, 60_000);
          if (!allowed) {
            this.eventBus?.emit({ type: 'bubble', text: '🚫 操作已取消' });
            this.eventBus?.emit({ type: 'idle' });
            session.fail('用户取消');
            this.taskQueue.release(taskId);
            return;
          }
        }
      }

      // ── 编排决策 + 执行 ──
      let result: { text: string; toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }> };
      let planRef: import('../types.js').OrchestrationPlan | null = null;

      if (this.agentRef) {
        // 走 orchestrate() 决策路径
        const plan = await this.agentRef.orchestrate(content);
        planRef = plan;
        const execTraceId = plan.meta?.traceId;

        // Phase 2: 推送 execution 阶段事件
        if (execTraceId) {
          this.eventBus?.emit({
            type: 'brain_trace',
            phase: 'execution',
            traceId: execTraceId,
            timestamp: Date.now(),
            data: {
              mode: plan.mode,
              nodes: plan.selectedNodes.map(n => n.id),
              useDAG: plan.useDAG,
            },
          });
        }

        if (this.verbose) {
          console.log(`  [Orchestrate] mode=${plan.mode} reason=${plan.reason} domains=[${plan.domains.join(',')}] dag=${plan.useDAG}`);
        }

        // 决策追踪
        this.sys.audit.logDecision?.({
          mode: plan.mode,
          reason: plan.reason,
          domains: plan.domains,
          complexity: plan.complexity,
          nodes: plan.selectedNodes.map(n => n.id),
        });

        // DAG 编排检测（orchestrate 标记 + message-processor 内部也检测）
        if (plan.useDAG) {
          try {
            const dag = await this.sys.dagPlanner.plan(content);
            if (dag.tasks.size >= 2) {
              if (this.verbose) console.log(`  [Orchestrate] DAG 命中 (${plan.useDAG}), ${dag.tasks.size} 个任务`);
              const dagResult = await this.sys.taskExecutor.execute(dag, () => {});
              this.sys.pet.trackFeature('dag_orchestrate');
              result = {
                text: dagResult.summary,
                toolCalls: dagResult.taskResults.map(r => ({
                  name: r.name, args: {}, result: r.result ?? '',
                })),
              };
              promptTokens = 0;
            } else {
              result = await this.agentRef.executeByPlan(plan);
            }
          } catch (err) {
            if (this.verbose) console.warn('[Orchestrate] DAG 规划失败，降级:', (err as Error).message);
            result = await this.agentRef.executeByPlan(plan);
          }
        } else {
          result = await this.agentRef.executeByPlan(plan);
        }
        promptTokens = 0;
      } else {
        // fallback: agentRef 未设置，走旧路径
        // 创建 signal 以统一 taskType 推断，避免 LLMAdapter 重新推断
        const fallbackSignal = collectSignals(this.sys, content);
        const batchResult = await this.processor.processBatch(content, this.eventBus, {
          taskType: fallbackSignal.taskType,
        });
        result = batchResult;
        promptTokens = batchResult.promptTokens ?? 0;
      }
      session.completeStep(llmStep.id, result.text.slice(0, 500), true);

      // 工具追踪（WS 特有：广播 + 反馈记录 + 执行日志 + ExecutionSession 步骤记录）
      const traceSteps: Array<{ type: 'thinking' | 'tool_call' | 'tool_result' | 'response'; content: string; tool?: string; args?: Record<string, unknown>; success?: boolean; timestamp: number }> = [];
      traceSteps.push({ type: 'thinking', content: '开始处理...', timestamp: Date.now() });

      for (const tc of result.toolCalls) {
        const tcResult = tc.result ?? '';
        const success = !tcResult.startsWith('[');
        const toolStart = Date.now();

        // 阶段 4: 工具调用追踪
        taskToolCallCount++;
        if (success) taskToolSuccessCount++;

        // ExecutionSession: 工具调用步骤
        const toolStep = session.addStep(tc.name, tc.args as Record<string, unknown>);

        this.sys.audit.logToolCall(tc.name, tc.args, getTrustLevel(this.sys.pet.getIntimacy()));
        this.eventBus?.emit({ type: 'tool_call', tool: tc.name, args: tc.args });
        this.eventBus?.emit({ type: 'tool_result', tool: tc.name, success, preview: tcResult.slice(0, 200) });
        this.sys.audit.logToolResult(tc.name, success, tcResult.slice(0, 200));

        // ExecutionSession: 完成工具步骤
        session.completeStep(toolStep.id, tcResult.slice(0, 500), success);

        // 记录执行日志
        this.sys.tools.recordExecution(tc.name, tc.args, tcResult, success, Date.now() - toolStart);
        traceSteps.push({ type: 'tool_call', content: tc.name, tool: tc.name, args: tc.args, timestamp: toolStart });
        traceSteps.push({ type: 'tool_result', content: tcResult.slice(0, 200), tool: tc.name, success, timestamp: Date.now() });

        // 三进制推理事件 + 正反馈闭环
        if (tc.name === 'ternary_expert_query' && success) {
          const confidenceMatch = tcResult.match(/置信度\s+([\d.]+)%/);
          const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) / 100 : 0;
          const domain = tc.args?.domain as string ?? 'unknown';
          this.eventBus?.emit({ type: 'ternary_inference', domain, confidence });

          // 正反馈闭环: 低置信度 → 记录知识缺口
          if (confidence < 0.3 && domain !== 'unknown') {
            this.sys.ternaryScheduler.addSamples(domain, [], 1); // 提升优先级
            if (this.verbose) console.log(`[Ternary] 低置信度 ${(confidence * 100).toFixed(1)}% → 提升 ${domain} 训练优先级`);
          }
        }
        if (success) {
          this.sys.cerebellum?.onToolSuccess();
          const trackResult = this.sys.pet.trackFeature(tc.name);
          this.sys.pet.trackToolCall();
          this.sys.tools.recordUsage(tc.name);
          this.checkAndEmitEvolution(trackResult);
          this.behavior.trackTool(tc.name);
          if (trackResult.isNewDiscovery) {
            this.sys.cerebellum?.onDiscovery();
          }
          try {
            const matchedPkgs = this.sys.experiencePackageManager.findByDomain(tc.name);
            if (matchedPkgs) {
              this.sys.skillFeedback.recordFeedback({
                packageId: matchedPkgs.id, query: content, answer: tcResult.slice(0, 200),
                rating: 4, helpfulKnowledge: [], unhelpfulKnowledge: [],
              });
            }
          } catch (err) { if (this.verbose) console.warn('[Feedback] 记录失败:', (err as Error).message); }
        } else {
          this.sys.cerebellum?.onToolError();
          try {
            const matchedPkgs = this.sys.experiencePackageManager.findByDomain(tc.name);
            if (matchedPkgs) {
              this.sys.skillFeedback.recordFeedback({
                packageId: matchedPkgs.id, query: content, answer: tcResult.slice(0, 200),
                rating: 2, helpfulKnowledge: [], unhelpfulKnowledge: [],
              });
            }
          } catch (err) { if (this.verbose) console.warn('[Feedback] 记录失败:', (err as Error).message); }
        }
      }

      // 后处理 — 复用 Agent 公共逻辑
      this.agentRef?.postprocessResult(content, result);

      // ── 反思层 — 实时质量评估 + 重决策循环 ──
      const MAX_REFLECT_RETRIES = 2;
      let reflectAttempt = 0;
      let reflectResult: import('./reflector.js').ReflectResult | null = null;

      while (reflectAttempt <= MAX_REFLECT_RETRIES) {
        try {
          if (planRef) {
            const signal = collectSignals(this.sys, content);
            reflectResult = await reflect(this.sys, planRef, result, signal, this.verbose);
            this.agentRef?.recordOutcome(!reflectResult.shouldRetry, undefined, Date.now() - taskStartTime);

            // 质量达标或已达最大重试次数 → 退出循环
            if (!reflectResult.shouldRetry || reflectAttempt >= MAX_REFLECT_RETRIES) {
              if (reflectResult.shouldRetry && this.verbose) {
                console.log(`  [Reflect] 达到最大重试次数(${MAX_REFLECT_RETRIES})，接受当前结果`);
              }
              break;
            }

            // ── 重决策：质量不足，重新编排 + 执行 ──
            reflectAttempt++;
            if (this.verbose) {
              console.log(`  [Reflect] 第${reflectAttempt}次重决策: ${reflectResult.reason}`);
            }

            // 推送重决策 trace
            this.eventBus?.emit({
              type: 'brain_trace',
              phase: 'signal',
              traceId: `retry-${Date.now()}-${reflectAttempt}`,
              timestamp: Date.now(),
              data: { retry: reflectAttempt, reason: reflectResult.reason, quality: reflectResult.quality },
            });

            // 重新编排（三脑已从 feedback 中学习，参数已更新）
            if (!this.agentRef) break;
            const newPlan = await this.agentRef.orchestrate(content);
            planRef = newPlan;

            // 推送 execution trace
            this.eventBus?.emit({
              type: 'brain_trace',
              phase: 'execution',
              traceId: newPlan.meta?.traceId ?? `retry-exec-${Date.now()}`,
              timestamp: Date.now(),
              data: { mode: newPlan.mode, nodes: newPlan.selectedNodes.map((n: { id: string }) => n.id), retry: reflectAttempt },
            });

            // 重新执行
            result = await this.agentRef!.executeByPlan(newPlan);

            // 重新后处理
            this.agentRef!.postprocessResult(content, result);

          } else {
            break;
          }
        } catch (err) {
          if (this.verbose) console.warn('[Reflect] 重决策失败:', (err as Error).message);
          this.agentRef?.recordOutcome(false, (err as Error).message, Date.now() - taskStartTime);
          break;
        }
      }

      // Phase 6: 对话结束后自动提取知识（BuddyLearn）
      try {
        if (this.sys.learn && result.text && result.text.length > 50) {
          // 从对话结果中学习知识
          const learnResult = this.sys.learn.learnFromText(result.text, 'conversation');
          if (learnResult && this.verbose) {
            console.log(`  [Learn] 知识提取: ${learnResult.chunks} 个片段`);
          }
        }
      } catch (err) {
        // learn 可能未完全初始化，忽略
      }

      // ── Step 8: 三脑反馈闭环（WS 路径）──
      try {
        const threeBrain = this.sys.threeBrain;
        if (threeBrain && planRef) {
          const signal = collectSignals(this.sys, content);
          const resources = collectResourceState(this.sys, this.config, () => this.userCorrectionCount, content, signal);
          const outcome = {
            success: result.toolCalls.every(tc => !tc.result?.startsWith('[')),
            latencyMs: Date.now() - taskStartTime,
            toolsUsed: result.toolCalls.map(tc => tc.name),
            costEstimate: 0,
          };
          threeBrain.feedback(signal, resources, planRef as any, outcome, undefined, undefined, undefined, undefined, result.text)
            .catch(err => { if (this.verbose) console.warn('[WS] feedback 失败:', err.message); });
        }
      } catch (err) {
        if (this.verbose) console.warn('[WS] feedback 构造失败:', (err as Error).message);
      }

      // Phase 6: 用户纠正检测（FeedbackLearner）
      try {
        if (this.sys.feedback) {
          const correction = this.sys.feedback.detectCorrection(content);
          if (correction) {
            this.sys.feedback.applyCorrection(correction);
            if (this.verbose) console.log(`  [Feedback] 检测到用户纠正: ${correction.type}`);
          }
        }
      } catch (err) {
        // feedback 可能未完全初始化，忽略
      }

      // WS 特有：广播 + TTS
      const responseText = result.text ?? '';

      // Phase 2: 推送 outcome 阶段事件
      const outcomeTraceId = planRef?.meta?.traceId;
      if (outcomeTraceId) {
        this.eventBus?.emit({
          type: 'brain_trace',
          phase: 'outcome',
          traceId: outcomeTraceId,
          timestamp: Date.now(),
          data: {
            success: !responseText.startsWith('['),
            responseLength: responseText.length,
            toolCalls: result.toolCalls?.length ?? 0,
            executionMs: Date.now() - taskStartTime,
          },
        });
      }

      this.eventBus?.emit({ type: 'llm_response', content: responseText });
      this.eventBus?.emit({ type: 'response_end', content: responseText, toolCalls: result.toolCalls?.length ?? 0 });

      // Agent 执行轨迹
      traceSteps.push({ type: 'response', content: responseText.slice(0, 500), timestamp: Date.now() });
      this.eventBus?.emit({ type: 'agent_trace', trace: traceSteps });

      this.ttsBridge.speakLongText(responseText).catch(err => { if (this.verbose) console.warn('[TTS] speakLongText 失败:', err.message); });
      this.emitGuidanceIfAny();
      this.broadcastStatus();

      // Phase 5: 主动提问引擎 — 对话结束后异步分析是否追问
      try {
        const question = await this.processor.analyzeAndAsk();
        if (question) {
          this.eventBus?.emit({ type: 'bubble', text: question });
        }
      } catch { /* 追问失败不影响主流程 */ }

      this.eventBus?.emit({ type: 'idle' });
      this.broadcastEmotion();

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Agent 处理错误:', msg);
      this.wsProtocol.recordError(msg);
      session.fail(msg);
      taskSuccess = false;
      this.sys.cerebellum?.onLLMError();
      this.broadcastEmotion();
      const fallback = getFallbackReply(this.config.personality);
      this.eventBus?.emit({ type: 'error', message: fallback });
      this.eventBus?.emit({ type: 'response_end', content: fallback, toolCalls: 0 });
      this.eventBus?.emit({ type: 'idle' });
    } finally {
      // 完成 ExecutionSession 并输出统计
      if (session.getStatus() === 'executing') {
        session.complete();
      }
      const stats = session.getStats();
      if (this.verbose) {
        console.log(`  [Session] ${session.id} 结束: ${stats.completedSteps}/${stats.totalSteps} 步完成, 平均延迟 ${stats.avgLatencyMs.toFixed(0)}ms`);
      }
      this.currentSession = null;
      this.taskQueue.release(taskId, {
        id: taskId,
        latencyMs: Date.now() - taskStartTime,
        success: taskSuccess,
        errorCode: taskErrorCode,
        timestamp: Date.now(),
        promptTokens,
      });

      // 阶段 4: 记录任务级完成度反馈
      try {
        // 检查本次任务是否有 cascade 触发
        const recentOutcomes = (router as any).outcomes ?? [];
        const taskStartTimeMs = taskStartTime;
        const cascadeInTask = recentOutcomes.some(
          (o: any) => o.timestamp >= taskStartTimeMs && o.fallbackTriggered
        );

        if (taskModelsUsed.size > 0) {
          router.recordTaskOutcome({
            taskType: 'chat', // TODO: 从编排结果获取实际 taskType
            modelIds: [...taskModelsUsed],
            success: taskSuccess,
            latencyMs: Date.now() - taskStartTime,
            cascadeTriggered: cascadeInTask,
            toolCallCount: taskToolCallCount,
            toolSuccessCount: taskToolSuccessCount,
            retryCount: 0,
          });
        }
      } catch { /* 任务反馈失败不影响主流程 */ }

      // 恢复原有回调
      router.setOnSelection(prevOnSelection ?? null);
    }
  }

  /** 处理文件变更事件（代理到 WSEventHandlers） */
  handleFileChange(event: FileChangeEvent): void {
    this.eventHandlers.handleFileChange(event);
  }

  /** 处理视觉种子（代理） */
  handleVisualSeed(msg: Record<string, unknown>): void {
    this.eventHandlers.handleVisualSeed(msg);
  }

  /** 处理摸头事件（代理） */
  handlePet(): void {
    this.eventHandlers.handlePet();
  }

  /** 处理语音情绪源（代理） */
  handleEmotionSource(msg: Record<string, unknown>): void {
    this.eventHandlers.handleEmotionSource(msg);
  }

  /** 概念提取（代理到 OrchestrationHandler，供测试使用） */
  private extractConcepts(text: string): string[] {
    return (this.orchHandler as any).extractConcepts(text);
  }

  /** TTS 语音合成（代理到 TTSBridge） */
  async speak(text: string, sentenceId?: string): Promise<void> {
    return this.ttsBridge.speak(text, sentenceId);
  }

  /** 按句子分段合成语音（代理到 TTSBridge） */
  async speakLongText(text: string): Promise<void> {
    return this.ttsBridge.speakLongText(text);
  }
}
