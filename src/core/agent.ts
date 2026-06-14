import type { BuddyConfig, Attributes, Message, OrchestrationPlan, OrchestrationNode, ExecutionResult, CollaborationMode } from '../types.js';
import { getTrustLevel } from '../types.js';
import { buildSystemPrompt } from '../personality/prompt.js';
import { EventBus } from '../ws/server.js';
import { FileWatcher } from '../perception/fs-watcher.js';
import { logger } from '../audit/structured-logger.js';
import { parseReminderFast } from './reminder-parser.js';
import type { DreamSession } from '../memory/dream.js';
import type { ReadinessReport } from '../launch/readiness.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

import { describeToolCall, getFallbackReply } from './constants.js';
import { needsConfirmationCompat } from './capability-gate.js';
import { Subsystems } from './subsystems.js';
import { MessageProcessor } from './message-processor.js';
import { BehaviorTracker } from './behavior-tracker.js';
import { SkillOps } from './skill-ops.js';
import { WSHandler } from './ws-handler.js';
import { PerceptionBridge, type PerceptionEvent } from '../emotion/perception-bridge.js';
import { RuntimeCollector, KnowledgeBridge, toNNSample } from '../brain/right/scene/index.js';
import type { PendingSnapshot } from '../brain/right/scene/runtime-collector.js';

// Phase 2: 类型定义提取到 agent-types.ts
export type { SignalObserverEvent, SignalObserver, TaskSignal, ResourceState } from './agent-types.js';
import type { TaskSignal, ResourceState, SignalObserver } from './agent-types.js';

// Phase 2: 信号采集提取到 signal-collector.ts
import * as signalCollector from './signal-collector.js';

// Phase 2: 编排决策提取到 orchestrator.ts
import { decideCollaboration as decideCollab } from './orchestrator.js';

// Phase 2: 计划执行提取到 plan-executor.ts
import { executeByPlan as execByPlan, executeExperience as execExperience, fallbackPlan as fallbackPlanFn, type ExecutionContext } from './plan-executor.js';

// Phase 2: 反思层提取到 reflector.ts
import { reflect as reflectImpl } from './reflector.js';

// Phase 2: 经验闭环提取到 experience-loop.ts
import * as experienceLoop from './experience-loop.js';

// Phase 2: DAG 管线提取到 dag-pipeline.ts
import { resolveDAGPipeline as resolveDAGImpl, type DAGPipelineResult } from './dag-pipeline.js';

// ==================== Agent 类 ====================

export class BuddyAgent {
  // ISSUE-015: 命名常量
  private static readonly CONFIRM_TIMEOUT_MS = 30_000;    // 工具确认超时
  private static readonly MAX_DECISION_TRACE = 200;        // 决策追踪上限
  private static readonly CONTENT_PREVIEW_LEN = 200;       // 内容预览截断长度

  // 子系统容器
  private sys: Subsystems;
  private processor: MessageProcessor;
  private behavior: BehaviorTracker;
  private skillOps: SkillOps;
  private ws: WSHandler;
  private log = logger.child('Agent'); // ISSUE-018: 结构化日志

  // 基础状态
  private config: BuddyConfig;
  private systemPrompt: string;
  private verbose = false;

  // 决策追踪（内存，最近 100 条）
  private decisionTrace: Array<{
    /** 唯一追踪 ID，用于关联决策与结果 */
    traceId: string;
    timestamp: number;
    input: string;
    domains: string[];
    complexity: string;
    mode: string;
    reason: string;
    nodes: string[];
    localCoverageRatio: number;
    localConfidence: number;
    /** A/B 对比：走的哪条路径 */
    path: 'threeBrain' | 'legacy';
    /** A/B 对比：决策延迟 */
    latencyMs: number;
    /** 决策结果：是否成功（null = 尚未有结果） */
    success: boolean | null;
    /** 决策结果：错误信息 */
    error?: string;
    /** 决策结果：执行耗时（从决策到结果返回） */
    executionMs?: number;
  }> = [];
  private readonly MAX_TRACE = BuddyAgent.MAX_DECISION_TRACE;

  // Phase 2: 信号观察器（推送到前端的 brain_trace 事件）
  private signalObserver: SignalObserver | null = null;

  // A/B 对比配置
  private abTestEnabled = false;
  private abTestRatio = 0.5; // ThreeBrain 比例（0~1）

  // 文件监听
  private fsWatcher: FileWatcher | null = null;

  // Phase 4: 感知→情绪映射
  private perceptionBridge: PerceptionBridge | null = null;

  // CLI 确认回调
  private cliConfirmHandler: ((description: string) => Promise<boolean>) | null = null;

  // 提醒确认状态
  private pendingReminder: { content: string; at?: number; cron?: string; triggerType: string } | null = null;

  // Phase 3: 工具执行学习闭环
  private runtimeCollector: RuntimeCollector | null = null;
  private knowledgeBridge: KnowledgeBridge | null = null;
  private pendingSnapshots: Map<string, PendingSnapshot> = new Map();

  // Phase 7: 自动训练触发追踪（防止同一领域重复触发）
  private autoTrainingTriggered = new Set<string>();
  private autoTrainingTriggeredFile: string;

  constructor(config: BuddyConfig, options?: { enableWs?: boolean; verbose?: boolean }) {
    this.config = config;
    this.verbose = options?.verbose ?? false;
    this.autoTrainingTriggeredFile = path.join(
      process.env.HOME ?? '/tmp', '.buddy', 'auto-training-triggered.json'
    );
    this.autoTrainingTriggered = experienceLoop.loadAutoTrainingTriggered(this.autoTrainingTriggeredFile);

    // 1. 初始化所有子系统
    this.sys = new Subsystems(config, this.verbose);
    this.systemPrompt = buildSystemPrompt(config, this.sys.tools.list().map(t => t.name));

    // 2. 初始化行为追踪
    this.behavior = new BehaviorTracker(this.sys.pet, this.verbose);

    // 3. 初始化能力包操作（并从 STMP 重建已有包）
    this.skillOps = new SkillOps(this.sys, this.verbose);
    this.skillOps.rebuildSkillPackages().catch(err => { if (this.verbose) console.warn('[Agent] rebuildSkillPackages 失败:', err.message); });

    // 4. 初始化消息处理器
    this.processor = new MessageProcessor(this.sys, this.skillOps, config, this.sys.memoryCache, this.verbose);

    // 4.5 接入 ReasoningChainStore → 信号汇聚层
    if (this.sys.convergenceLayer) {
      this.processor.reasoningChains.setConvergenceCallback((signal) => {
        this.sys.convergenceLayer?.ingestReasoning(signal);
      });
    }

    // 5. 初始化 WebSocket 处理器
    this.ws = new WSHandler(this.sys, this.processor, this.behavior, config, this.verbose);
    this.ws.setAgentRef(this);

    // 5.5 初始化感知→情绪映射管线
    if (this.sys.cerebellum) {
      this.perceptionBridge = new PerceptionBridge(this.sys.cerebellum);
      this.perceptionBridge.start();
      // 将感知总线事件转发到情绪管线
      this.sys.perceptionBus.onPerception((event) => {
        this.perceptionBridge?.onPerception({
          source: event.source as PerceptionEvent['source'],
          type: event.category,
          data: event.data,
          timestamp: event.timestamp,
        });
      });
      if (this.verbose) console.log('  [Perception] 感知→情绪映射管线已启动');
    }

    // 6. 设置工具执行前拦截
    this.setupToolInterception();

    // 6.5 Phase 3: 工具执行学习闭环 — RuntimeCollector + KnowledgeBridge
    if (this.sys.threeBrain) {
      const registry = this.sys.threeBrain.right.entityRegistry;
      this.runtimeCollector = new RuntimeCollector(
        registry,
        { maxBufferSize: 200, autoFlushThreshold: 100, collectFailures: true, minExecutionMs: 10 },
        (samples) => {
          // 缓冲区满 → 批量写入右脑训练（异步，不阻塞主流程）
          for (const s of samples) {
            this.sys.threeBrain!.right.ingestExternalSample(toNNSample(s.sample));
          }
          // Step 22 #2: 触发世界模型训练
          try {
            const worldModelSamples = samples.map(s => s.sample);
            const sceneWM = this.sys.threeBrain!.right['sceneWorldModel'];
            if (sceneWM && worldModelSamples.length > 0) {
              const lr = 0.001;
              const result = sceneWM.train(worldModelSamples, lr);
              if (this.verbose && result.trained > 0) {
                console.log(`[WorldModel] 训练 ${result.trained} 样本, loss=${result.loss.toFixed(4)}`);
              }
            }
          } catch (err) {
            if (this.verbose) console.warn('[WorldModel] 训练失败:', (err as Error).message);
          }
          if (this.verbose) {
            console.log(`[RuntimeCollector] flush ${samples.length} samples → SceneWorldModel`);
          }
        },
      );
      this.knowledgeBridge = new KnowledgeBridge({ minConfidence: 0.3 });
      if (this.verbose) console.log('  [Phase3] RuntimeCollector + KnowledgeBridge 已初始化');
    }

    // 7. WebSocket（可选）
    if (options?.enableWs !== false) {
      const wsToken = config.ws.token || crypto.randomBytes(24).toString('hex');
      if (!config.ws.token) {
        console.log(`\n🔑 WS Token (自动生成): ${wsToken}`);
        console.log(`   前端连接需在 URL 中附带 ?token=${wsToken}\n`);
      }
      const eventBus = new EventBus(config.ws.port, wsToken);
      eventBus.setLinkHandler(this.ws.getLinkHandler());
      this.ws.setEventBus(eventBus);
      this.ws.setupWebSocket();
      this.ws.setupIdleBehavior();
      this.ws.setupREST();
    }

    // 8.5 BuddyClock 回调注册
    if (this.sys.clock) {
      this.sys.clock.onReminderDue = (reminder) => {
        const platform = this.sys.platformManager.getActive();
        const msg = `⏰ 提醒：${reminder.content}`;
        platform?.send(msg).catch((err) => { if (this.verbose) console.debug('[DEBUG] 静默错误:', err?.message ?? err); });
        if (this.verbose) console.log(`[BuddyClock] 提醒触发: ${reminder.content}`);
      };
      this.sys.clock.onProactive = (intent) => {
        if (this.verbose) console.log(`[BuddyClock] 主动意图: ${intent.type} (priority=${intent.timing.priority})`);
      };
      this.sys.clock.onPhaseChange = (from, to) => {
        if (this.verbose) console.log(`[BuddyClock] 阶段变化: ${from} → ${to}`);
      };
    }

    // 8. 文件变更监听
    this.setupFileWatcher(config);

    console.log(`🦊 ${config.name} (${config.species}) 已就绪`);
    console.log(`   性格: 毒舌${config.personality.snark} 智慧${config.personality.wisdom} 混乱${config.personality.chaos} 耐心${config.personality.patience} 调试${config.personality.debugging}`);

    // 9. verbose 模式下自动健康检查
    if (this.verbose) {
      this.sys.launchReadiness.runAll().then((report) => {
        const status = report.ready ? '✅ 就绪' : '⚠️ 有问题';
        console.log(`  [Health] 上线检查: ${status} (${report.passed}通过 ${report.warned}警告 ${report.failed}失败)`);
        if (report.failed > 0) {
          for (const check of report.checks.filter(c => c.status === 'fail')) {
            console.log(`  [Health] ❌ ${check.name}: ${check.message}`);
          }
        }
      }).catch((err) => {
        if (this.verbose) console.warn('[Health] 检查失败:', err.message);
      });
    }
  }

  // ==================== 初始化辅助 ====================

  /** 设置工具执行前的安全拦截 */
  private setupToolInterception(): void {
    // 硬件工具 → PermissionType 映射
    const HARDWARE_TOOL_MAP: Record<string, import('../perception/types.js').PermissionType> = {
      camera_snap: 'camera', camera_list: 'camera', camera_clip: 'camera',
      screen_record: 'screen',
    };

    this.sys.llm.setBeforeToolExecute(async (toolName, args) => {
      const trust = this.sys.pet.getIntimacy();
      const trustLevel = getTrustLevel(trust);

      // Phase 3: 为所有工具捕获 before 快照（在权限检查之前）
      if (this.runtimeCollector) {
        const pending = this.runtimeCollector.captureBefore({ type: toolName, params: new Float32Array() });
        this.pendingSnapshots.set(toolName, pending);
      }

      // PrivacyManager: 硬件权限检查
      const permType = HARDWARE_TOOL_MAP[toolName];
      if (permType) {
        const access = this.sys.privacyManager.checkAccess(permType, trustLevel);
        if (!access.allowed) {
          this.sys.audit.logSecurityBlock(toolName, access.reason ?? '隐私权限拒绝');
          // 权限拒绝：清理 before 快照（不会有 after）
          this.pendingSnapshots.delete(toolName);
          return { allowed: false, reason: access.reason };
        }
      }

      if (!needsConfirmationCompat(toolName, trustLevel, trust)) {
        return { allowed: true };
      }

      const description = describeToolCall(toolName, args);
      this.sys.audit.logSecurityBlock(toolName, `需要确认 (信任度: ${trust}/${trustLevel})`);

      const eventBus = this.ws.getEventBus();
      const pendingConfirm = this.ws.getPendingConfirm();

      // WS 模式 — ISSUE-012: 不再拒绝并发确认，队列处理
      if (eventBus) {
        const confirmId = `confirm-${Date.now()}`;
        eventBus.emit({
          type: 'tool_confirm_request',
          id: confirmId, tool: toolName, description, trustLevel,
        });

        const allowed = await new Promise<boolean>((resolve) => {
          this.ws.setPendingConfirm({ id: confirmId, resolve });
          setTimeout(() => {
            if (this.ws.getPendingConfirm(confirmId)) {
              this.ws.removePendingConfirm(confirmId);
              resolve(false);
            }
          }, BuddyAgent.CONFIRM_TIMEOUT_MS);
        });

        if (!allowed) { this.pendingSnapshots.delete(toolName); return { allowed: false, reason: `用户拒绝了 ${toolName} 操作` }; }
        return { allowed: true };
      }

      // CLI 模式
      if (this.cliConfirmHandler) {
        const allowed = await this.cliConfirmHandler(description);
        if (!allowed) { this.pendingSnapshots.delete(toolName); return { allowed: false, reason: `用户拒绝了 ${toolName} 操作` }; }
        return { allowed: true };
      }

      this.pendingSnapshots.delete(toolName);
      return { allowed: false, reason: `信任度 ${trustLevel} 不足以执行 ${toolName}，且无法请求确认` };
    });
  }

  /** 设置文件变更监听 */
  private setupFileWatcher(config: BuddyConfig): void {
    this.fsWatcher = new FileWatcher({
      rootPath: config.sandbox?.workspace ?? process.cwd(),
      debounceMs: 2000,
      maxDepth: 3,
      extensions: ['.ts', '.js', '.json', '.md', '.py', '.yaml', '.yml', '.toml'],
    });
    this.fsWatcher.onChange((event) => this.ws.handleFileChange(event));
    this.fsWatcher.start();
    if (this.verbose) {
      console.log(`  [FS] 文件监听已启动: ${config.sandbox?.workspace ?? process.cwd()}`);
    }
  }

  // ==================== 消息处理 ====================

  /** 处理用户消息（WebSocket 模式） */
  async handleUserMessage(content: string): Promise<void> {
    await this.ws.handleUserMessage(content);
  }

  /** CLI 模式 - 直接交互（Phase 3: 走编排决策路径） */
  async handleCLIMessage(content: string): Promise<string> {
    // 预处理（养成+反馈+行为+记忆）
    const correction = this.preprocessMessage(content);
    if (correction) {
      console.log(`\n  📝 记住了: ${correction.content}`);
    }

    const execStart = performance.now();

    try {
      const trust = this.sys.pet.getIntimacy();
      const trustLevel = getTrustLevel(trust);
      this.sys.cerebellum?.onThinking();

      // ── Phase 3: 走编排决策路径（与 WS 路径统一）──
      const plan = await this.orchestrate(content);

      if (this.verbose) {
        console.log(`  [Orchestrate] mode=${plan.mode} reason=${plan.reason} domains=[${plan.domains.join(',')}]`);
      }

      let result: { text: string; toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }> };

      // Step 14: 直接执行模式 — 规则引擎命中 + 可直接映射到工具，跳过 LLM
      if (plan.mode === 'direct' && plan.directTool) {
        const dt = plan.directTool;
        if (this.verbose) console.log(`  [Direct] 直接执行 ${dt.name}: ${JSON.stringify(dt.args).slice(0, 100)}`);
        const toolResult = await this.sys.tools.executeWithCache(dt.name, dt.args);
        const toolText = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
        result = { text: toolText, toolCalls: [{ name: dt.name, args: dt.args, result: toolText }] };
        process.stdout.write(toolText);
      } else {
        // 经验直连 / 经验+质检 / LLM+hint 走 executeByPlan
        const firstNode = plan.selectedNodes[0];
        if (firstNode?.type === 'experience' || firstNode?.routePath === 'llm_with_hint') {
          result = await this.executeByPlan(plan);
          // 经验直连无流式输出，直接打印
          if (plan.mode === 'local_only' || firstNode.routePath === 'exp_direct') {
            process.stdout.write(result.text);
          }
        } else {
          // 非经验路径：走 LLM 流式输出
          result = await this.processor.processStream(content, (chunk) => {
            process.stdout.write(chunk);
          }, null);
        }
      }

      // 工具追踪
      if (result.toolCalls.length > 0) {
        for (const tc of result.toolCalls) {
          this.sys.audit.logToolCall(tc.name, tc.args, trustLevel);
          if (needsConfirmationCompat(tc.name, trustLevel, trust)) {
            console.log(`\n  ⚠️  信任度 ${trust} (${trustLevel})：工具 ${tc.name} 需要确认`);
            this.sys.audit.logSecurityBlock(tc.name, `需要确认 (信任度: ${trust}/${trustLevel})`);
          }
          console.log(`\n  🔧 ${tc.name}(${JSON.stringify(tc.args).slice(0, 100)})`);
          this.sys.cerebellum?.onToolSuccess();
          this.sys.audit.logToolResult(tc.name, !tc.result.startsWith('['), tc.result.slice(0, 200));
          this.sys.pet.trackFeature(tc.name);
          this.sys.tools.recordUsage(tc.name);
          this.behavior.trackTool(tc.name);
        }
      }

      console.log('');
      this.postprocessResult(content, result);

      // ── Phase 3: 反思层 — 质量自评 + 经验编译 + 教训提取 + 幻觉检测 ──
      const signal = this.collectSignals(content);
      await this.reflect(plan, result, signal);

      // ── Step 8: 三脑反馈闭环 ──
      const threeBrain = this.sys.threeBrain;
      if (threeBrain) {
        try {
          const resources = this.collectResourceState(content, signal);
          const outcome = {
            success: result.toolCalls.every(tc => !tc.result?.startsWith('[')),
            latencyMs: performance.now() - execStart,
            toolsUsed: result.toolCalls.map(tc => tc.name),
            costEstimate: 0,
          };
          // 异步调用 feedback，不阻塞主流程
          threeBrain.feedback(signal, resources, plan as any, outcome, undefined, undefined, undefined, undefined, result.text)
            .catch(err => { if (this.verbose) console.warn('[Agent] feedback 失败:', err.message); });
        } catch (err) {
          if (this.verbose) console.warn('[Agent] feedback 构造失败:', (err as Error).message);
        }
      }

      if (this.verbose) {
        const moodEmoji = this.sys.cerebellum?.bodyState.getMoodEmoji() ?? "😶";
        console.log(`  [情绪] ${moodEmoji} ${this.sys.cerebellum?.inferMood() ?? "calm"} | 精力: ${this.sys.cerebellum?.getBodyState().energy ?? 0}`);
      }

      // 记录决策成功
      this.recordLastOutcome(true, undefined, performance.now() - execStart);

      return result.text;

    } catch (err: unknown) {
      const e = err as Error;
      if (this.verbose) console.error('详细错误:', e.stack);
      this.sys.cerebellum?.onLLMError();
      this.sys.cerebellum?.onToolError();
      const fallback = getFallbackReply(this.config.personality);
      this.sys.memory.addMessage('assistant', fallback);

      // 记录决策失败
      this.recordLastOutcome(false, e.message, performance.now() - execStart);

      return fallback;
    }
  }

  // ==================== 消息公共逻辑 ====================

  /**
   * 消息预处理 — 养成追踪 + 反馈检测 + 行为检测 + 记忆
   * CLI/WS 共用
   */
  preprocessMessage(content: string): { type: string; content: string } | null {
    // 养成系统追踪
    this.sys.pet.trackFeature('chat');
    this.sys.pet.trackMessage();
    this.sys.pet.updateConsecutiveDays();
    this.sys.pet.trackSpecialTimeFeature();

    // 反馈检测
    const correction = this.sys.feedback.detectCorrection(content);
    if (correction) {
      this.sys.feedback.applyCorrection(correction);
      this.behavior.trackFeedback(correction);
    }

    if (this.behavior.detectNegation(content)) {}
    if (this.behavior.detectRepeat(content)) {}
    this.behavior.setLastMessage(content);

    // 模式检测 + 认知推断
    this.sys.observer.detectPatterns(content);
    this.sys.cognitive.inferFromMessage(content, []);
    this.sys.cognitive.inferGoals(content, []);

    // EntityStore: 从对话中提取实体
    this.sys.entityStore.extractAndUpdate(content);

    // 感知事件总线：发布交互事件
    this.sys.perceptionBus.publish('interaction', 'touch', { subtype: 'tap', content: content.slice(0, 200) });

    // 存入对话
    this.sys.memory.addMessage('user', content);
    this.sys.memory.incrementInteraction();
    this.sys.observer.updateLastInteraction();

    // BuddyClock 通知
    if (this.sys.clock) {
      this.sys.clock.notifyInteraction();
      this.sys.clock.notifyMessage(content);
    }

    // 情绪更新
    this.sys.cerebellum?.onUserMessage();
    const timeCare = this.sys.observer.checkTimeCare();
    if (timeCare === 'late_night') this.sys.cerebellum?.onLateNight();
    else if (timeCare === 'morning') this.sys.cerebellum?.onMorning();

    // 提醒意图检测
    if (this.sys.clock) {
      const parsed = parseReminderFast(content);
      if (parsed) {
        const platform = this.sys.platformManager.getActive();
        const channel = platform?.platform ?? 'cli';
        if (parsed.triggerType === 'once' && parsed.at) {
          const reminder = this.sys.clock.createUserReminder(parsed.content, parsed.at, channel);
          this.pendingReminder = { content: parsed.content, at: parsed.at, triggerType: 'once' };
          if (this.verbose) console.log(`[Agent] 创建提醒: "${parsed.content}" @ ${new Date(parsed.at).toLocaleString()}`);
        } else if (parsed.triggerType === 'recurring' && parsed.cron) {
          const reminder = this.sys.clock.reminderEngine.createRecurringReminder(parsed.content, parsed.cron, channel);
          this.pendingReminder = { content: parsed.content, cron: parsed.cron, triggerType: 'recurring' };
          if (this.verbose) console.log(`[Agent] 创建循环提醒: "${parsed.content}" cron=${parsed.cron}`);
        }
      }
    }

    return correction ? { type: correction.type, content: correction.content } : null;
  }

  /** 获取并清除待确认的提醒（供消息流注入确认信息） */
  consumePendingReminder(): { content: string; at?: number; cron?: string; triggerType: string } | null {
    const r = this.pendingReminder;
    this.pendingReminder = null;
    return r;
  }

  // ==================== 编排决策：分析函数 ====================

  /** 统一领域检测 — 右脑分类 */
  // Phase 2: detectDomains / assessTaskComplexity 已迁移到 signal-collector.ts
  detectDomains(content: string): string[] {
    return signalCollector.detectDomains(this.sys, content);
  }

  assessTaskComplexity(content: string): ReturnType<typeof signalCollector.assessTaskComplexity> {
    return signalCollector.assessTaskComplexity(this.sys, content);
  }

  // ==================== 编排决策核心（SchedCP 解耦控制面） ====================

  /**
   * Stage 1: 信号采集 — 纯语义分析，不依赖资源状态
   * 借鉴 SchedCP 的 Goal-inference stage
   */
  // Phase 2: collectSignals / collectResourceState / collectToolHealth 已迁移到 signal-collector.ts
  collectSignals(content: string): TaskSignal {
    return signalCollector.collectSignals(this.sys, content);
  }

  collectResourceState(content: string, signal: TaskSignal): ResourceState {
    return signalCollector.collectResourceState(
      this.sys, this.config,
      () => this.ws?.getUserCorrectionCount?.() ?? 0,
      content, signal,
    );
  }

  // Phase 2: decideCollaboration 已迁移到 orchestrator.ts
  decideCollaboration(signal: TaskSignal, resources: ResourceState): {
    mode: CollaborationMode;
    reason: string;
    selectedNodes: OrchestrationNode[];
  } {
    return decideCollab(this.sys, signal, resources);
  }

  /**
   * orchestrate — 分析任务 + 选择协作模式 + 分配资源
   *
   * 拆分为三阶段（借鉴 SchedCP 解耦控制面）：
   * Stage 1: collectSignals() — 纯语义分析
   * Stage 1.5: collectResourceState() — 运行时资源状态
   * Stage 2: decideCollaboration() — 纯策略决策
   *
   * Phase 1: 优先查 ExperienceRouter（四层路由 + Thompson Sampling），
   * 命中高置信度经验则零 LLM 直接执行。
   *
   * 纯逻辑，无 LLM 调用，< 5ms。
   */
  async orchestrate(content: string): Promise<OrchestrationPlan> {
    // Stage 1: 信号采集
    const signal = this.collectSignals(content);

    // Stage 1.5: 资源状态
    const resources = this.collectResourceState(content, signal);

    // Phase 2: 生成预追踪 ID，供 signalObserver 关联整条链路
    const preTraceId = `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // ── Gate-0: 经验路由前置 ──
    // 在三脑决策之前，先查经验图谱。高置信度命中直接返回结果，零 LLM。
    const expEngine = this.sys.intelligence;
    if (expEngine && resources.experienceHit?.skill) {
      const expDecision = resources.experienceHit;
      const expSkill = expDecision.skill;

      // 高置信度经验直达：跳过编排，直接返回结果
      if (expDecision.path === 'exp_direct' && expSkill) {
        try {
          const expResult = await execExperience(this.getExecContext(), expSkill.id, content);
          // 轻量 sanity check
          if (expResult.text && expResult.text.length > 10 && expResult.source?.startsWith('exp/')) {
            if (this.verbose) {
              console.log(`  [Gate-0] 经验直达: ${expSkill.id} (置信度 ${(expDecision.confidence ?? 0).toFixed(2)})`);
            }
            return {
              content: expResult.text,
              mode: 'local_only',
              reason: `经验直达: ${expSkill.id} (置信度 ${(expDecision.confidence ?? 0).toFixed(2)})`,
              domains: signal.domains,
              complexity: signal.complexity,
              selectedNodes: [{
                id: `exp/${expSkill.id}`,
                type: 'experience',
                skillId: expSkill.id,
                routePath: 'exp_direct',
              }],
              useDAG: false,
              routeDecision: expDecision,
              meta: {
                localCoverageRatio: resources.localCoverageRatio,
                localConfidence: resources.localConfidence,
                budgetRemaining: resources.budgetRemaining,
                availableNodeCount: resources.availableNodeCount,
                userCorrectionCount: resources.userCorrectionCount,
                traceId: preTraceId,
              },
            };
          }
        } catch (err) {
          // 经验执行失败，继续走正常流程
          if (this.verbose) {
            console.log(`  [Gate-0] 经验直达失败，降级到编排: ${(err as Error).message}`);
          }
        }
      }

      // 中置信度经验：注入 hint 到后续流程
      if (expDecision.path === 'exp_verified' || expDecision.path === 'llm_with_hint') {
        resources.experienceHit = expDecision;
      }
    }

    // Phase 2: 推送 signal 阶段事件
    this.signalObserver?.({
      phase: 'signal',
      traceId: preTraceId,
      timestamp: Date.now(),
      data: {
        domains: signal.domains,
        complexity: signal.complexity,
        taskType: signal.taskType,
        shouldUseDAG: signal.shouldUseDAG,
        intentConfidence: signal.intentConfidence,
      },
    });

    // Phase 2: 推送 resource 阶段事件
    this.signalObserver?.({
      phase: 'resource',
      traceId: preTraceId,
      timestamp: Date.now(),
      data: {
        budgetRemaining: resources.budgetRemaining,
        availableNodeCount: resources.availableNodeCount,
        localCoverageRatio: resources.localCoverageRatio,
        localConfidence: resources.localConfidence,
        experienceHit: resources.experienceHit?.skill ?? null,
      },
    });

    // ── A/B 对比模式 ──
    const threeBrain = this.sys.threeBrain;
    if (threeBrain && this.abTestEnabled) {
      const useThreeBrain = Math.random() < this.abTestRatio;
      if (useThreeBrain) {
        return this.orchestrateWithThreeBrain(content, signal, resources, threeBrain, 'threeBrain');
      }
      return this.orchestrateLegacy(content, signal, resources, 'legacy');
    }

    // ── 三脑决策路径（优先） ──
    if (threeBrain) {
      return this.orchestrateWithThreeBrain(content, signal, resources, threeBrain, 'threeBrain');
    }

    // ── 旧决策路径（兜底） ──
    return this.orchestrateLegacy(content, signal, resources, 'legacy');
  }

  /**
   * 三脑协作决策路径
   *
   * 信号流：小脑(感知) → 右脑(直觉) → 左脑(规则+调度)
   */
  private async orchestrateWithThreeBrain(
    content: string,
    signal: TaskSignal,
    resources: ResourceState,
    threeBrain: import('../brain/brain.js').ThreeBrain,
    path: 'threeBrain' | 'legacy' = 'threeBrain',
  ): Promise<OrchestrationPlan> {
    const t0 = performance.now();

    // 注入用户消息到感知融合
    threeBrain.cerebellum.ingestPerception('user', content, signal.domains);

    // 三脑协作决策
    const decision = await threeBrain.decide(content, signal, resources);

    const latencyMs = performance.now() - t0;

    const traceId = `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // 决策追踪（含 A/B 路径标记）
    this.decisionTrace.push({
      traceId,
      timestamp: Date.now(),
      input: content.slice(0, 200),
      domains: signal.domains,
      complexity: signal.complexity,
      mode: decision.plan.mode,
      reason: decision.plan.reason,
      nodes: decision.plan.selectedNodes.map(n => n.id),
      localCoverageRatio: resources.localCoverageRatio,
      localConfidence: resources.localConfidence,
      path,
      latencyMs,
      success: null,
    });
    if (this.decisionTrace.length > this.MAX_TRACE) {
      this.decisionTrace.shift();
    }

    // ── 审议结果处理（Phase 1: 右脑审议环）──
    if (decision.plan.metaAction === 'refine') {
      const strategy = decision.plan.refineStrategy;

      if (strategy === 'ask_user') {
        // 审议判定需要追问用户（澄清模式 或 头脑风暴模式的结果）
        if (this.verbose) {
          console.log(`[Agent] 审议触发: refine/ask_user — ${decision.plan.reason}`);
        }

        // 构建追问内容：优先使用审议委员会生成的精确问题
        const clarificationQuestion = decision.deliberationResult?.clarificationQuestion;
        const proposals = decision.deliberationResult?.proposals;
        let replyContent = content;

        if (proposals && proposals.length > 0) {
          // 头脑风暴模式：呈现方案选项
          const { DeliberationCouncil } = await import('../brain/deliberation/council.js');
          replyContent = DeliberationCouncil.buildProposalsPresentation(proposals);
        } else if (clarificationQuestion) {
          replyContent = clarificationQuestion;
        }

        return {
          content: replyContent,
          mode: 'clarify',
          reason: decision.plan.reason,
          domains: signal.domains,
          complexity: signal.complexity,
          taskType: signal.taskType,
          selectedNodes: [],
          useDAG: false,
          routeDecision: undefined,
          meta: {
            localCoverageRatio: resources.localCoverageRatio,
            localConfidence: resources.localConfidence,
            budgetRemaining: resources.budgetRemaining,
            availableNodeCount: resources.availableNodeCount,
            userCorrectionCount: resources.userCorrectionCount,
            threeBrainLatencyMs: decision.latencyMs,
            intuition: decision.intuition,
            homeostasisActions: decision.homeostasisActions,
            traceId,
            deliberation: {
              action: decision.deliberationResult?.action ?? 'refine',
              strategy,
              reason: decision.plan.reason,
              clarificationQuestion,
              proposals,
              archiveId: decision.deliberationResult?.archiveId,
            },
          },
        };
      }

      if (strategy === 'multi_llm') {
        // 审议触发多模型讨论
        if (this.verbose) {
          console.log(`[Agent] 审议触发: refine/multi_llm — ${decision.plan.reason}`);
        }
        return {
          content,
          mode: 'debate' as const,
          reason: `审议触发多模型讨论: ${decision.plan.reason}`,
          domains: signal.domains,
          complexity: signal.complexity,
          selectedNodes: decision.plan.selectedNodes.length > 0
            ? decision.plan.selectedNodes as import('../types.js').OrchestrationNode[]
            : this.pickMultiExperts(signal.domains, signal.taskType),
          useDAG: false,
          routeDecision: undefined,
          meta: {
            localCoverageRatio: resources.localCoverageRatio,
            localConfidence: resources.localConfidence,
            budgetRemaining: resources.budgetRemaining,
            availableNodeCount: resources.availableNodeCount,
            userCorrectionCount: resources.userCorrectionCount,
            threeBrainLatencyMs: decision.latencyMs,
            intuition: decision.intuition,
            homeostasisActions: decision.homeostasisActions,
            traceId,
            deliberation: { action: 'refine', strategy, reason: decision.plan.reason },
          },
        };
      }
    }

    if (decision.plan.metaAction === 'concede') {
      // 审议判定信心不足，直接走 LLM（带或不带经验 hint）
      if (this.verbose) {
        console.log(`[Agent] 审议触发: concede/${decision.plan.refineStrategy} — ${decision.plan.reason}`);
      }
      // 继续走正常流程，但标记来源为 deliberation
      // 左脑调度器会看到 source='deliberation' 并适当降级
    }

    // Phase 2: 推送 decision 阶段事件
    this.signalObserver?.({
      phase: 'decision',
      traceId,
      timestamp: Date.now(),
      data: {
        path,
        mode: decision.plan.mode,
        reason: decision.plan.reason,
        nodes: decision.plan.selectedNodes.map(n => n.id),
        threeBrainLatencyMs: decision.latencyMs,
        intuition: decision.intuition,
        homeostasisActions: decision.homeostasisActions,
        metaAction: decision.plan.metaAction,
        refineStrategy: decision.plan.refineStrategy,
      },
    });

    // 持久化到 DecisionRecorder
    try {
      this.sys.router.getDecisionRecorder()?.record({
        input: content.slice(0, 500),
        intent: signal.domains.join(','),
        domain: signal.domains.length > 0 ? signal.domains[0] : null,
        novelty: resources.experienceHit?.novelty ?? (1 - resources.localCoverageRatio),
        complexity: signal.complexity,
        selectedNode: decision.plan.selectedNodes.map(n => n.id).join('+'),
        selectionReason: decision.plan.reason,
        selectionLayer: resources.experienceHit?.skill ? (resources.experienceHit.path === 'exp_direct' ? 1 : 2) : 1,
        outputTokenLimit: 0,
        success: true,
        latencyMs: decision.latencyMs,
        inputTokens: 0,
        outputTokens: 0,
        costEstimate: 0,
        fallbackTriggered: false,
        collaborationMode: decision.plan.mode,
        localCoverageRatio: resources.localCoverageRatio,
        localConfidence: resources.localConfidence,
      });
    } catch { /* 决策记录失败不影响主流程 */ }

    // 将三脑决策映射到模型层级提示（左脑 UnifiedScheduler → LLMAdapter）
    const primaryNode = decision.plan.selectedNodes[0];
    if (primaryNode) {
      // Phase 1: 统一模型池 — 如果节点携带了具体模型信息，直接使用
      if (primaryNode.type === 'cloud_node' && primaryNode.provider && primaryNode.model) {
        // 不再设置 modelTierHint，而是通过 OrchestrationNode 直接传递模型信息
        // agent.ts 的 execute 会检测到具体模型并调用 chatWithNode
        if (this.verbose) {
          console.log(`[Agent] 统一池选择: ${primaryNode.provider}/${primaryNode.model}`);
          this.log.info('统一池选择', { provider: primaryNode.provider, model: primaryNode.model });
        }
      } else {
        // 非统一池节点（local_expert / experience / primary fallback）
        // 不再使用 modelTierHint，由 ModelRouter 直接处理
        if (this.verbose) {
          console.log(`[Agent] 非统一池节点: ${primaryNode.type}, 由 ModelRouter 处理`);
        }
      }
    }

    const plan: import('../types.js').OrchestrationPlan = {
      content,
      mode: decision.plan.mode,
      reason: decision.plan.reason,
      domains: signal.domains,
      complexity: signal.complexity,
      taskType: signal.taskType,
      selectedNodes: decision.plan.selectedNodes as import('../types.js').OrchestrationNode[],
      useDAG: signal.shouldUseDAG,
      routeDecision: resources.experienceHit ?? undefined,
      directTool: decision.plan.directTool,  // Step 14: 直接执行工具
      meta: {
        localCoverageRatio: resources.localCoverageRatio,
        localConfidence: resources.localConfidence,
        budgetRemaining: resources.budgetRemaining,
        availableNodeCount: resources.availableNodeCount,
        userCorrectionCount: resources.userCorrectionCount,
        threeBrainLatencyMs: decision.latencyMs,
        intuition: decision.intuition,
        homeostasisActions: decision.homeostasisActions,
        traceId,
      },
    };

    // Phase 2: DAG 管线 — 当 useDAG=true 时生成骨架→门控→绑定→验证
    if (plan.useDAG && plan.mode !== 'clarify' && plan.mode !== 'brainstorm') {
      const dagResult = await this.resolveDAGPipeline(content, signal, resources);
      plan.resolvedDAG = dagResult.resolvedDAG ?? undefined;
      plan.dagSkeleton = dagResult.dagSkeleton ?? undefined;
      // Gate-1 拦截 → 降级 single
      if (!dagResult.resolvedDAG && dagResult.dagSkeleton) {
        plan.useDAG = false;
        plan.mode = 'single';
        plan.reason = `${plan.reason} | ${dagResult.reason}`;
      }
    }

    return plan;
  }

  /**
   * 旧决策路径（当 ThreeBrain 不可用时的兜底）
   */
  private async orchestrateLegacy(
    content: string,
    signal: TaskSignal,
    resources: ResourceState,
    path: 'threeBrain' | 'legacy' = 'legacy',
  ): Promise<OrchestrationPlan> {
    const t0 = performance.now();

    // Stage 2: 策略决策
    const decision = this.decideCollaboration(signal, resources);

    const latencyMs = performance.now() - t0;
    const traceId = `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // 决策追踪（含 A/B 路径标记）
    this.decisionTrace.push({
      traceId,
      timestamp: Date.now(),
      input: content.slice(0, 200),
      domains: signal.domains,
      complexity: signal.complexity,
      mode: decision.mode,
      reason: decision.reason,
      nodes: decision.selectedNodes.map(n => n.id),
      localCoverageRatio: resources.localCoverageRatio,
      localConfidence: resources.localConfidence,
      path,
      latencyMs,
      success: null,
    });
    if (this.decisionTrace.length > this.MAX_TRACE) {
      this.decisionTrace.shift();
    }

    // Phase 2: 推送 decision 阶段事件（legacy 路径）
    this.signalObserver?.({
      phase: 'decision',
      traceId,
      timestamp: Date.now(),
      data: {
        path,
        mode: decision.mode,
        reason: decision.reason,
        nodes: decision.selectedNodes.map(n => n.id),
        legacyLatencyMs: latencyMs,
      },
    });

    // 持久化到 DecisionRecorder
    try {
      this.sys.router.getDecisionRecorder()?.record({
        input: content.slice(0, 500),
        intent: signal.domains.join(','),
        domain: signal.domains.length > 0 ? signal.domains[0] : null,
        novelty: resources.experienceHit?.novelty ?? (1 - resources.localCoverageRatio),
        complexity: signal.complexity,
        selectedNode: decision.selectedNodes.map(n => n.id).join('+'),
        selectionReason: decision.reason,
        selectionLayer: resources.experienceHit?.skill ? (resources.experienceHit.path === 'exp_direct' ? 1 : 2) : 1,
        outputTokenLimit: 0,
        success: true,
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        costEstimate: 0,
        fallbackTriggered: false,
        collaborationMode: decision.mode,
        localCoverageRatio: resources.localCoverageRatio,
        localConfidence: resources.localConfidence,
      });
    } catch { /* 决策记录失败不影响主流程 */ }

    const plan: OrchestrationPlan = {
      content,
      mode: decision.mode,
      reason: decision.reason,
      domains: signal.domains,
      complexity: signal.complexity,
      selectedNodes: decision.selectedNodes,
      useDAG: signal.shouldUseDAG,
      routeDecision: resources.experienceHit ?? undefined,
      meta: {
        localCoverageRatio: resources.localCoverageRatio,
        localConfidence: resources.localConfidence,
        budgetRemaining: resources.budgetRemaining,
        availableNodeCount: resources.availableNodeCount,
        userCorrectionCount: resources.userCorrectionCount,
      },
    };

    // Phase 2: DAG 管线 — 当 useDAG=true 时生成骨架→门控→绑定→验证
    if (plan.useDAG) {
      const dagResult = await this.resolveDAGPipeline(content, signal, resources);
      plan.resolvedDAG = dagResult.resolvedDAG ?? undefined;
      plan.dagSkeleton = dagResult.dagSkeleton ?? undefined;
      if (!dagResult.resolvedDAG && dagResult.dagSkeleton) {
        plan.useDAG = false;
        plan.mode = 'single';
        plan.reason = `${plan.reason} | ${dagResult.reason}`;
      }
    }

    return plan;
  }

  /** 选择本地专家 */
  // Phase 2: pickLocalExperts / pickMultiExperts 已迁移到 signal-collector.ts
  private pickLocalExperts(domains: string[], content: string): OrchestrationNode[] {
    return signalCollector.pickLocalExperts(this.sys, domains, content);
  }

  private pickMultiExperts(domains: string[], content: string): OrchestrationNode[] {
    return signalCollector.pickMultiExperts(this.sys, domains, content);
  }

  // ==================== 编排执行 ====================

  /**
   * executeByPlan — 根据 orchestrate() 的决策执行
   *
   * 7 种模式：local_only / single / parallel / cascade / sequential / debate
   * Phase 1: 经验路由命中时优先走经验执行器
   */
  async executeByPlan(plan: OrchestrationPlan): Promise<ExecutionResult> {
    return execByPlan(this.getExecContext(), plan);
  }

  /**
   * Phase 2: DAG 管线 — planSkeleton → Gate-1 → SkillResolver → Gate-2
   *
   * 在 orchestrate() 返回前调用，当 useDAG=true 时触发。
   * 依赖：sys.dagPlanner, sys.skillResolver, sys.threeBrain.left.ruleEngine
   */
  private async resolveDAGPipeline(
    content: string,
    signal: TaskSignal,
    resources: ResourceState,
  ): Promise<DAGPipelineResult> {
    return resolveDAGImpl(this.sys, content, signal, resources, this.verbose);
  }

  /** 构造执行上下文（供 plan-executor 使用） */
  private getExecContext(): ExecutionContext {
    return {
      sys: this.sys,
      processor: this.processor,
      ws: this.ws,
      config: this.config,
      verbose: this.verbose,
    };
  }

  // ISSUE-010: 构造完整的 fallback OrchestrationPlan（保留，供外部调用）
  private fallbackPlan(content: string, reason = '经验降级'): OrchestrationPlan {
    return fallbackPlanFn(content, reason);
  }

  /**
   * 消息后处理 — 存回复 + 工具追踪 + 知识提取 + 学习
   * CLI/WS 共用
   */
  postprocessResult(
    content: string,
    result: { text: string; toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }> },
  ): void {
    experienceLoop.postprocessResult(
      this.sys, this.processor, this.behavior, content, result,
      this.runtimeCollector, this.knowledgeBridge, this.pendingSnapshots, this.verbose,
    );

    // Phase 7: 自动训练触发
    experienceLoop.autoTriggerTraining(
      this.sys, this.autoTrainingTriggered,
      () => experienceLoop.saveAutoTrainingTriggered(this.autoTrainingTriggeredFile, this.autoTrainingTriggered),
      this.verbose,
    ).catch(err => { if (this.verbose) console.warn('[Agent] autoTriggerTraining 失败:', err.message); });

    // Phase 5: 自动意图扩展
    experienceLoop.autoExpandIntents(this.sys, this.decisionTrace as any, this.verbose);

    // Phase 8: 工具健康注入
    experienceLoop.feedToolHealthToBrain(this.sys, this.verbose);
  }

  // ==================== Phase 3: 反思层 ====================

  /**
   * 反思 — 执行完成后的闭环学习
   *
   * 1. 质量自评（四维：完整/准确/简洁/可用）
   * 2. 经验编译（成功路径 → ExperienceUnit）
   * 3. 教训提取（失败路径 → Lesson）
   * 4. 幻觉检测（工具成功但结果无关）
   * 5. 三脑反馈
   */
  private async reflect(
    plan: OrchestrationPlan,
    result: { text: string; toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }> },
    signal: TaskSignal,
  ): Promise<import('./reflector.js').ReflectResult> {
    return reflectImpl(this.sys, plan, result, signal, this.verbose);
  }

  // ==================== Phase 4: 经验闭环辅助 ====================
  // ==================== Phase 4: 经验闭环辅助 ====================

  /**
   * Phase 7: 自动训练触发
   * 检查所有领域画像，达到 trainable 且未触发过的领域自动提交训练
   */
  // Phase 7-8: 经验闭环方法已迁移到 experience-loop.ts
  // autoTriggerTraining / autoExpandIntents / feedToolHealthToBrain / recordInteraction
  // 通过 postprocessResult 中的 experienceLoop.* 调用

  // ==================== 公开接口 ====================  // ==================== 公开接口 ====================

  setCLIConfirmHandler(handler: (description: string) => Promise<boolean>): void {
    this.cliConfirmHandler = handler;
  }

  /** Learn */
  async learnFromFile(filePath: string) { return this.sys.learn.learnFromFile(filePath); }
  async learnFromUrl(url: string) { return this.sys.learn.learnFromUrl(url); }
  learnFromText(text: string, source?: string) { return this.sys.learn.learnFromText(text, source); }
  getLearnedKnowledge() { return this.sys.learn.getLearnedKnowledge(); }
  getLearnedFiles() { return this.sys.learn.getLearnedFiles(); }

  async scanProject(rootPath: string) { return this.sys.observer.scanProject(rootPath); }
  getEmotion() { return this.sys.cerebellum?.bodyState as any; }

  getStatus() {
    const emotionState = this.sys.cerebellum?.getLegacyState()
      ?? { mood: 'calm' as const, energy: 50, satisfaction: 50, vector: {} as any, intensity: 0.5, isAuthentic: true };
    return {
      config: this.config,
      pet: this.sys.pet.getSummary(),
      emotion: emotionState,
      stats: this.sys.memory.getStats(),
    };
  }

  /** 获取决策追踪记录（最近 200 条） */
  getDecisionTrace() { return this.decisionTrace; }

  /** 记录决策结果（供 ws-handler 调用，桥接 recordLastOutcome） */
  recordOutcome(success: boolean, error?: string, executionMs?: number): void {
    this.recordLastOutcome(success, error, executionMs);
  }

  /** 设置信号观察器 — 决策信号流实时推送到前端 */
  setSignalObserver(observer: SignalObserver | null): void {
    this.signalObserver = observer;
  }

  /** 获取当前信号观察器 */
  getSignalObserver(): SignalObserver | null {
    return this.signalObserver;
  }

  /**
   * 记录决策结果 — 关联执行结果到决策追踪
   *
   * 供外部调用（WS/CLI 执行完毕后），或内部 handleCLIMessage 自动回写。
   * 影子大脑的 GapDetector 和回归风险评估依赖此数据。
   */
  recordDecisionOutcome(traceId: string, success: boolean, error?: string, executionMs?: number): void {
    const trace = this.decisionTrace.find(t => t.traceId === traceId);
    if (trace) {
      trace.success = success;
      if (error) trace.error = error;
      if (executionMs !== undefined) trace.executionMs = executionMs;
    }
  }

  /**
   * 记录最近一次决策的结果（简化版，无需 traceId）
   * 用于 handleCLIMessage 等自动回写场景
   */
  private recordLastOutcome(success: boolean, error?: string, executionMs?: number): void {
    const last = this.decisionTrace[this.decisionTrace.length - 1];
    if (last && last.success === null) {
      last.success = success;
      if (error) last.error = error;
      if (executionMs !== undefined) last.executionMs = executionMs;
    }
  }

  /** 启用/禁用 A/B 对比模式 */
  setABTest(enabled: boolean, ratio = 0.5): void {
    this.abTestEnabled = enabled;
    this.abTestRatio = Math.max(0, Math.min(1, ratio));
    if (this.verbose) {
      console.log(`[Agent] A/B 对比 ${enabled ? '已启用' : '已禁用'}, ThreeBrain 比例=${(this.abTestRatio * 100).toFixed(0)}%`);
    }
  }

  /** 获取 A/B 对比统计（含真实成功率） */
  getABStats(): {
    enabled: boolean;
    ratio: number;
    threeBrain: { count: number; avgLatencyMs: number; successRate: number; avgExecutionMs: number; modes: Record<string, number> };
    legacy: { count: number; avgLatencyMs: number; successRate: number; avgExecutionMs: number; modes: Record<string, number> };
  } {
    const tb = this.decisionTrace.filter(d => d.path === 'threeBrain');
    const lg = this.decisionTrace.filter(d => d.path === 'legacy');

    const calcStats = (traces: typeof this.decisionTrace) => {
      if (traces.length === 0) return { count: 0, avgLatencyMs: 0, successRate: 0, avgExecutionMs: 0, modes: {} };
      const avgLatency = traces.reduce((s, t) => s + t.latencyMs, 0) / traces.length;
      const modes: Record<string, number> = {};
      for (const t of traces) modes[t.mode] = (modes[t.mode] ?? 0) + 1;

      // 真实成功率：只统计有结果的决策
      const withOutcome = traces.filter(t => t.success !== null);
      const successRate = withOutcome.length > 0
        ? withOutcome.filter(t => t.success === true).length / withOutcome.length
        : 0;

      // 平均执行耗时
      const withExec = traces.filter(t => t.executionMs !== undefined);
      const avgExecutionMs = withExec.length > 0
        ? withExec.reduce((s, t) => s + t.executionMs!, 0) / withExec.length
        : 0;

      return {
        count: traces.length,
        avgLatencyMs: Math.round(avgLatency * 100) / 100,
        successRate: Math.round(successRate * 10000) / 10000,
        avgExecutionMs: Math.round(avgExecutionMs * 100) / 100,
        modes,
      };
    };

    return {
      enabled: this.abTestEnabled,
      ratio: this.abTestRatio,
      threeBrain: calcStats(tb),
      legacy: calcStats(lg),
    };
  }

  getPet() { return this.sys.pet; }
  getTTS() { return this.sys.tts; }
  getSTMP() { return this.sys.stmp; }
  getDream() { return this.sys.dream; }
  getCognitive() { return this.sys.cognitive; }
  getExtractor() { return this.sys.extractor; }
  getIntelligence() { return this.sys.intelligence; }
  getExperiencePackageManager() { return this.sys.experiencePackageManager; }
  getExperienceEvaluator() { return this.sys.experienceEvaluator; }
  getSkillExporter() { return this.sys.skillExporter; }
  getSkillVersionManager() { return this.sys.skillVersionManager; }
  getQualityRadar() { return this.sys.qualityRadar; }
  getSkillFeedback() { return this.sys.skillFeedback; }
  getSubscriptionManager() { return this.sys.subscriptionManager; }
  getEntitlementChecker() { return this.sys.entitlementChecker; }
  getShopCatalog() { return this.sys.shopCatalog; }
  getFriendSystem() { return this.sys.friendSystem; }
  getPlatformManager() { return this.sys.platformManager; }
  getBuddyInteraction() { return this.sys.buddyInteraction; }
  getMemoryCache() { return this.sys.memoryCache; }
  getDBManager() { return this.sys.dbManager; }
  getMCPAdapter() { return this.sys.mcpAdapter; }
  getToolRegistry() { return this.sys.tools; }
  getWorkflowManager() { return this.sys.workflowManager; }
  getDAGPlanner() { return this.sys.dagPlanner; }
  getLoRAService() { return this.sys.loraService; }
  getDataAugmentor() { return this.sys.dataAugmentor; }
  getTernaryManager() { return this.sys.ternaryManager; }
  getTernaryRouter() { return this.sys.ternaryRouter; }
  getTernaryScheduler() { return this.sys.ternaryScheduler; }
  feedTernaryScheduler() { return this.sys.feedTernaryScheduler(); }
  getModelInstaller() { return this.sys.modelInstaller; }
  getLLM() { return this.sys.llm; }
  // 接入的 10 个模块
  getBeliefStore() { return this.sys.beliefStore; }
  getEntityStore() { return this.sys.entityStore; }
  getPrivacyManager() { return this.sys.privacyManager; }
  getPerceptionBus() { return this.sys.perceptionBus; }
  getPerceptionBridge() { return this.perceptionBridge; }
  getCloudTrainer() { return this.sys.cloudTrainer; }
  getTernaryGrowth() { return this.sys.ternaryGrowth; }
  getKnowledgeExporter() { return this.sys.knowledgeExporter; }
  getMCPRegistry() { return this.sys.mcpRegistry; }

  async runReadinessCheck(): Promise<ReadinessReport> {
    return this.sys.launchReadiness.runAll();
  }

  getShopItems(filters?: { type?: string; rarity?: string; maxPrice?: number }) {
    return this.sys.shopCatalog.getAvailableItems(filters as any);
  }

  purchaseItem(userId: string, itemId: string) {
    return this.sys.shopCatalog.purchase(userId, itemId);
  }

  getUserInventory(userId: string) {
    return this.sys.shopCatalog.getInventory(userId);
  }

  getFriends(statusFilter?: string) {
    return this.sys.friendSystem.listFriends(statusFilter as any);
  }

  addFriend(id: string, name: string) {
    return this.sys.friendSystem.addFriend({ id, name, status: 'offline', lastSeen: Date.now() });
  }

  removeFriend(id: string) {
    return this.sys.friendSystem.removeFriend(id);
  }

  startVisit(targetBuddyId: string, targetName: string, targetSpecies: string) {
    const petData = this.sys.pet.getData();
    const stageMap: Record<string, number> = { egg: 1, hatching: 2, growing: 3, formed: 4, mature: 5, complete: 6, legendary: 7 };
    const guestProfile = {
      id: 'local', name: this.config.name, species: this.config.species,
      level: stageMap[petData.evolutionStage] ?? 1, stage: petData.evolutionStage,
      attributes: {} as Record<string, number>, ownerId: 'local', ownerName: '主人',
    };
    const hostProfile = {
      id: targetBuddyId, name: targetName, species: targetSpecies,
      level: 1, stage: 'egg',
      attributes: {} as Record<string, number>, ownerId: targetBuddyId, ownerName: targetName,
    };
    return this.sys.buddyInteraction.startVisit(guestProfile, hostProfile);
  }

  interactInVisit(visitId: string, type: 'greet' | 'play' | 'chat' | 'gift' | 'photo', content: string) {
    return this.sys.buddyInteraction.interact(visitId, type, content);
  }

  exportSkillPackage(domain: string): string | null {
    const pkg = this.sys.experiencePackageManager.findByDomain(domain);
    if (!pkg) return null;
    return this.sys.skillExporter.exportAsString(pkg);
  }

  getSkillFeedbackStats(domain: string) {
    const pkg = this.sys.experiencePackageManager.findByDomain(domain);
    if (!pkg) return null;
    return this.sys.skillFeedback.getStats(pkg.id);
  }

  async broadcastToPlatforms(message: string): Promise<void> {
    const adapter = this.sys.platformManager.getActive();
    if (adapter) {
      try { await adapter.send(message); }
      catch (err) { if (this.verbose) console.warn('[Platform] 广播失败:', (err as Error).message); }
    }
  }

  getRegisteredPlatforms(): string[] {
    return this.sys.platformManager.list();
  }

  async triggerDream(): Promise<DreamSession> {
    return this.sys.dream.dream('manual');
  }

  getLatestDreamJournal(): string | null {
    return this.sys.dream.getLatestJournal();
  }

  async speak(text: string, sentenceId?: string): Promise<void> {
    await this.ws.speak(text, sentenceId);
  }

  async speakLongText(text: string): Promise<void> {
    await this.ws.speakLongText(text);
  }

  watchDirectory(dirPath: string): void {
    this.fsWatcher?.stop();
    this.fsWatcher = new FileWatcher({
      rootPath: path.resolve(dirPath),
      debounceMs: 2000,
      maxDepth: 3,
      extensions: ['.ts', '.js', '.json', '.md', '.py', '.yaml', '.yml', '.toml'],
    });
    this.fsWatcher.onChange((event) => this.ws.handleFileChange(event));
    this.fsWatcher.start();
    console.log(`  👀 文件监听已切换到: ${dirPath}`);
  }

  async shutdown(): Promise<void> {
    this.perceptionBridge?.stop();
    // 持久化能力包状态（必须在 memory.close() 之前）
    this.skillOps.savePersisted();
    await this.sys.closeAll(
      this.ws.getEventBus(),
      this.ws.getDreamTimer(),
      this.fsWatcher,
      this.config.name,
    );
  }
}
