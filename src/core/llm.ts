import fs from 'fs';
import { generateText, generateObject, streamText, tool, stepCountIs, type ToolSet, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { Message, BuddyConfig, LLMConfig } from '../types.js';
import type { ToolDef } from '../types.js';
import { ToolExecutionMiddleware } from '../tools/execution-middleware.js';
import { ProviderFactory, type ProviderCapabilities, getPreprocessor, type ProviderAdapter, adapterRegistry } from './provider-registry.js';
import type { InternalMessage, ProcessedMessage } from './message-preprocessor.js';
import { ResponseNormalizer } from './response-normalizer.js';
import { UniversalToolCaller } from './universal-tool-caller.js';
import { ModelRouter, inferTaskType, type TaskType, type TaskContext, type ModelConfig } from './model-router.js';
import { DecisionRecorder } from './decision-recorder.js';
import { ModelPool } from './model-pool.js';
import { ModelPoolScheduler } from './model-pool-scheduler.js';
import { MultimodalExecutor, type MultimodalOptions, type MultimodalResult } from './multimodal-executor.js';

import { scoreByRules } from './quality-scorer.js';
import { friendlyError } from '../tools/error-messages.js';
import * as path from 'path';

/**
 * 工具执行前拦截回调
 */
export type BeforeToolExecute = (toolName: string, args: Record<string, unknown>) => Promise<{ allowed: boolean; reason?: string }>;

/** chat/streamChat 的可选参数 */
export interface LLMCallOptions {
  taskType?: TaskType;
  userOverride?: string;
}

/**
 * LLM 适配层 v3 — 多 Provider + Fallback + 任务路由
 *
 * 1. 使用 ProviderFactory 动态创建模型
 * 2. 集成 ModelRouter 智能选择模型
 * 3. 从 config.models.providers 解析 LLM 配置（唯一路径）
 * 4. 保留重试 + 熔断机制
 */

/** 降级模式使用的安全默认能力值 */
const DEFAULT_CAPABILITIES: import('./provider-adapter.js').ProviderCapabilities = {
  toolCalling: false,
  streaming: false,
  structuredOutput: false,
  vision: false,
  maxContextTokens: 4096,
  maxOutputTokens: 2048,
  toolChoice: false,
  parallelToolCalls: false,
  needsPromptToolCalling: false,
  preferredToolFormat: 'natural',
  supportsDeveloperRole: false,
};

export class LLMAdapter {
  private config: LLMConfig;
  private router: ModelRouter;
  private toolCaller: UniversalToolCaller;
  private beforeToolExecute: BeforeToolExecute | null = null;
  // Phase 3: decisionRecorder 已迁移到 ModelRouter，由 Subsystems 注入
  private poolScheduler: ModelPoolScheduler | null = null;

  // 最近一次模型选择结果（供 agent 读取并发 WS 事件）
  private lastSelection: import('./model-pool.js').ModelSelection | null = null;

  // 多模态执行器
  private multimodalExecutor: MultimodalExecutor = new MultimodalExecutor();

  // 当前活跃模型（由 router.select() 决定，每次调用可能不同）
  private currentModel!: LanguageModel;
  private currentCapabilities!: ProviderCapabilities;

  // 熔断器
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly CIRCUIT_OPEN_MS = 30_000;
  private readonly CIRCUIT_FAIL_THRESHOLD = 5;
  private circuitStatePath: string | null = null; // ISSUE-007: 持久化路径

  // 重试配置
  private readonly MAX_RETRIES = 3;
  private readonly BASE_DELAY_MS = 1000;

  // Phase 3: 执行验证器（可选）
  private executionVerifier: import('../tools/execution-verifier.js').ExecutionVerifier | null = null;

  /** 最近一次 API usage（供策略校准） */
  private lastActualUsage: { input: number; output: number } | null = null;

  /** 工具结果引用追踪（Task 8.3） */
  private toolResultMeta: Map<string, { toolName: string; turn: number; referenced: number }> = new Map();

  /** 初始化 Promise（构造函数无法 async，延迟到首次使用前完成） */
  private initPromise: Promise<void> | null = null;

  /** LLM 是否可用（provider 配置完整且模型创建成功） */
  public available: boolean = true;

  /** Task 8.1: 获取最近一次 API usage */
  public getLastUsage(): { input: number; output: number } | null {
    return this.lastActualUsage;
  }

  constructor(config: BuddyConfig, dataDir?: string) {
    const llmConfig = LLMAdapter.resolveLLMConfig(config);
    this.config = llmConfig;

    // 初始化路由器
    this.router = new ModelRouter(dataDir);

    // 设置选择回调（供 agent 读取并发 WS 事件）
    this.router.setOnSelection((selection) => {
      this.lastSelection = selection;
    });

    this.toolCaller = new UniversalToolCaller();

    // ISSUE-007: 加载熔断器持久化状态
    if (dataDir) {
      this.circuitStatePath = path.join(dataDir, 'circuit-breaker.json');
      this.loadCircuitState();
    }
    // Phase 3: DecisionRecorder 由 Subsystems 创建并注入 ModelRouter

    // 异步初始化（构造函数无法 await，存为 Promise 在首次 chat 时等待）
    this.initPromise = this.init();
  }

  /**
   * 异步初始化 — 创建默认模型（构造函数无法 async，提取为独立方法）
   */
  async init(): Promise<void> {
    const llmConfig = this.config;
    if (llmConfig.provider === 'none') {
      this.available = false;
      this.currentModel = null as unknown as LanguageModel;
      this.currentCapabilities = DEFAULT_CAPABILITIES;
      console.log('[LLM] 未配置 provider，降级模式启动（工具可用，LLM 不可用）');
    } else {
      const initResult = await ProviderFactory.create({
        provider: llmConfig.provider,
        model: llmConfig.model ?? '',
        apiKey: llmConfig.apiKey,
        baseUrl: llmConfig.baseUrl,
      });
      this.currentModel = initResult.model;
      this.currentCapabilities = initResult.capabilities;
      console.log(`[LLM] 模型: ${llmConfig.provider}/${llmConfig.model ?? '(自动发现)'}`);
    }
  }

  /**
   * 从 BuddyConfig 中解析出 LLM 配置
   * 唯一路径：config.models.providers[0]
   */
  private static resolveLLMConfig(config: BuddyConfig): LLMConfig {
    const providers = config.models?.providers;
    if (providers && providers.length > 0) {
      const first = providers[0];
      return {
        provider: first.type,
        model: first.model ?? '',
        apiKey: first.apiKey,
        baseUrl: first.baseUrl,
      };
    }
    // 降级：无 provider 时返回占位配置，允许系统启动（工具仍可用）
    return { provider: 'none', model: '' };
  }

  // ==================== 公开接口 ====================

  getRouter(): ModelRouter {
    return this.router;
  }

  getModelSummary() {
    return this.router.getSummary();
  }

  getCapabilities(): ProviderCapabilities {
    return { ...this.currentCapabilities };
  }

  setBeforeToolExecute(cb: BeforeToolExecute): void {
    this.beforeToolExecute = cb;
  }

  /**
   * Phase 3: 注入执行验证器
   * 工具执行后自动验证实际效果
   */
  setExecutionVerifier(verifier: import('../tools/execution-verifier.js').ExecutionVerifier): void {
    this.executionVerifier = verifier;
  }

  /**
   * 热更新 Provider 配置 — 只替换默认 fallback 模型，不动路由器/统一池
   *
   * 用于前端 LLM 配置变更时的热重载，避免重建 LLMAdapter 导致统一模型池丢失。
   */
  async updateProvider(config: LLMConfig): Promise<void> {
    this.config = config;
    if (config.model) {
      const result = await ProviderFactory.create({
        provider: config.provider,
        model: config.model,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      });
      this.currentModel = result.model;
      this.currentCapabilities = result.capabilities;
    }
    this.available = true;
  }

  // ==================== 消息预处理 ====================

  /**
   * 将 Buddy 内部消息格式预处理为 provider 兼容格式
   * 处理 role 映射、消息顺序、合并等
   */
  private preprocessMessages(messages: Message[]): ProcessedMessage[] {
    const preprocessor = getPreprocessor(this.config.provider);

    // 转为 InternalMessage 做预处理
    const internal: InternalMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      toolCalls: m.toolCalls,
    }));

    return preprocessor.process(internal);
  }

  /**
   * 从 ModelConfig 创建 provider 并预处理消息
   * 返回 [model, preprocessedMessages, capabilities]
   */
  private async prepareCall(
    config: ModelConfig,
    messages: Message[],
  ): Promise<{ model: LanguageModel; aiMessages: ProcessedMessage[]; capabilities: ProviderCapabilities }> {
    const { model, capabilities } = await ProviderFactory.create({
      provider: config.provider,
      model: config.model,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
    });

    const aiMessages = this.preprocessMessages(messages);

    return { model, aiMessages, capabilities };
  }

  // ==================== 核心调用 ====================

  /**
   * 批量生成（非流式）— 支持任务路由 + fallback
   */
  async chat(
    messages: Message[],
    tools: ToolDef[],
    maxSteps = 5,
    options?: LLMCallOptions,
  ): Promise<{ text: string; steps: number; toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }> }> {
    // 等待异步初始化完成
    if (this.initPromise) {
      await this.initPromise;
      this.initPromise = null;
    }
    // 动态检查：如果核心 LLM 未配置但模型池有 provider，自动启用
    if (!this.available) {
      const pool = this.router.getPool();
      if (pool && pool.profileCount > 0) {
        this.available = true;
      } else {
        return { text: '⚠️ LLM 未配置，无法处理消息。请运行 `npx tsx src/main.ts init` 配置模型。', steps: 0, toolCalls: [] };
      }
    }
    const taskType = options?.taskType ?? inferTaskType(
      messages.filter((m) => m.role === 'user').pop()?.content ?? '',
    );
    const context: TaskContext = {
      content: messages.filter((m) => m.role === 'user').pop()?.content ?? '',
      userOverride: options?.userOverride,
    };

    return this.executeWithFallback(taskType, context, async (model, capabilities) => {
      const aiMessages = this.preprocessMessages(messages) as import('ai').ModelMessage[];
      const genParams = this.buildGenParams();

      if (capabilities.toolCalling && !capabilities.needsPromptToolCalling) {
        return this.chatNative(model, aiMessages, tools, maxSteps, genParams);
      }
      return this.chatWithPromptTools(model, capabilities, aiMessages, tools, maxSteps, genParams);
    });
  }

  /**
   * 流式生成 — 用于用户对话场景
   */
  async streamChat(
    messages: Message[],
    tools: ToolDef[],
    maxSteps: number,
    onChunk: (chunk: string) => void,
    options?: LLMCallOptions,
  ): Promise<{ text: string; steps: number; toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }> }> {
    // 等待异步初始化完成
    if (this.initPromise) {
      await this.initPromise;
      this.initPromise = null;
    }
    // 动态检查：如果核心 LLM 未配置但模型池有 provider，自动启用
    if (!this.available) {
      const pool = this.router.getPool();
      if (pool && pool.profileCount > 0) {
        this.available = true;
      } else {
        const msg = '⚠️ LLM 未配置，无法处理消息。请运行 `npx tsx src/main.ts init` 配置模型。';
        onChunk(msg);
        return { text: msg, steps: 0, toolCalls: [] };
      }
    }
    const taskType = options?.taskType ?? inferTaskType(
      messages.filter((m) => m.role === 'user').pop()?.content ?? '',
    );
    const context: TaskContext = {
      content: messages.filter((m) => m.role === 'user').pop()?.content ?? '',
      userOverride: options?.userOverride,
    };

    // Prompt 模拟模式：流式不支持多轮工具，回退到批量
    const selected = await this.selectModel(taskType, context);
    const caps = selected.capabilities ?? this.currentCapabilities;
    if (!caps.toolCalling || caps.needsPromptToolCalling) {
      const result = await this.chat(messages, tools, maxSteps, options);
      for (const char of (result.text ?? '')) onChunk(char);
      return result;
    }

    return this.executeWithFallback(taskType, context, async (model, capabilities) => {
      const aiMessages = this.preprocessMessages(messages) as import('ai').ModelMessage[];
      const genParams = this.buildGenParams();
      const toolSet = this.buildToolSet(tools);

      const result = streamText({
        model,
        messages: aiMessages,
        tools: Object.keys(toolSet).length > 0 ? toolSet : undefined,
        stopWhen: stepCountIs(maxSteps),
        ...genParams,
      });

      let fullText = '';
      for await (const textPart of result.textStream) {
        fullText += textPart;
        onChunk(textPart);
      }

      const toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }> = [];
      try {
        const steps = await result.steps;
        for (const step of steps) {
          const stepToolCalls = step.toolCalls ?? [];
          const stepToolResults = step.toolResults ?? [];
          for (const tc of stepToolCalls) {
            const tr = stepToolResults.find(
              (r) => 'toolCallId' in r && r.toolCallId === tc.toolCallId,
            );
            toolCalls.push({
              name: tc.toolName,
              args: (tc.input ?? {}) as Record<string, unknown>,
              result: tr && 'output' in tr ? String(tr.output) : '',
            });
          }
        }
      } catch { /* 提取失败不影响主流程 */ }

      return { text: fullText, steps: toolCalls.length > 0 ? 1 : 0, toolCalls };
    });
  }

  /**
   * 结构化输出 — 支持任务路由 + fallback
   */
  async structuredOutput<T extends z.ZodType>(
    messages: Message[],
    schema: T,
    options?: {
      schemaName?: string;
      schemaDescription?: string;
      mode?: 'auto' | 'tool' | 'json';
      taskType?: TaskType;
    },
  ): Promise<z.infer<T>> {
    const taskType = options?.taskType ?? 'reasoning';
    const context: TaskContext = {
      content: messages.filter((m) => m.role === 'user').pop()?.content ?? '',
    };

    return this.executeWithFallback(taskType, context, async (model, capabilities) => {
      const aiMessages = this.preprocessMessages(messages) as import('ai').ModelMessage[];
      const genParams = this.buildGenParams();

      if (capabilities.structuredOutput) {
        const result = await generateObject({
          model,
          messages: aiMessages,
          schema,
          schemaName: options?.schemaName ?? 'response',
          schemaDescription: options?.schemaDescription,
          mode: options?.mode ?? 'auto',
          maxOutputTokens: genParams.maxOutputTokens as number | undefined,
          temperature: genParams.temperature as number | undefined,
        });
        return result.object as z.infer<T>;
      }

      // 不支持 → Prompt 模拟
      const schemaStr = JSON.stringify(this.zodToJsonSchema(schema), null, 2);
      const jsonPrompt = [
        ...aiMessages,
        { role: 'user' as const, content: `请严格按照以下 JSON Schema 格式返回结果，只输出 JSON，不要包含其他文字:\n\n${schemaStr}` },
      ];
      const result = await generateText({ model, messages: jsonPrompt, ...genParams });
      const jsonStr = this.extractJson(result.text ?? '');
      if (!jsonStr) throw new Error('结构化输出失败：LLM 未返回有效 JSON');
      return schema.parse(JSON.parse(jsonStr));
    });
  }

  getCircuitStatus() {
    return {
      open: this.isCircuitOpen(),
      failures: this.failureCount,
      lastFailure: this.lastFailureTime,
    };
  }

  // ==================== Fallback 执行引擎 ====================

  /**
   * 模型选择：委托 ModelRouter（统一池优先）
   */
  private async selectModel(taskType: TaskType, context: TaskContext): Promise<ModelConfig> {
    return this.router.select(taskType, context);
  }

  /**
   * 选模型 → 执行 → 失败则 fallback
   */
  /**
   * Phase 3: 结构化错误分类
   */
  private classifyErrorType(err: unknown, taskType?: TaskType): 'capability_mismatch' | 'prompt_too_long' | 'auth' | 'rate_limit' | 'network' | 'payment' | 'not_found' | 'unknown' {
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    if (msg.includes('400') || msg.includes('bad request')) return 'capability_mismatch';
    if (msg.includes('token') || msg.includes('too long') || msg.includes('context length')) return 'prompt_too_long';
    if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden')) {
      // FIX: 多模态端点的 403 可能是模型不支持该端点（capability_mismatch），而非认证失败
      // 例：chat 模型调 /v1/embeddings 返回 403 — 不应标记 auth/denied
      const MULTIMODAL_ENDPOINTS = ['embedding', 'audio', 'image', 'video', 'rerank', 'transcription', 'speech'];
      const MULTIMODAL_TASKS: TaskType[] = ['embedding', 'asr', 'image-gen', 'image-edit', 'video-gen', 'tts', 'ocr'];
      const hitsEndpoint = MULTIMODAL_ENDPOINTS.some(ep => msg.includes(ep));
      const isMultimodalTask = taskType ? MULTIMODAL_TASKS.includes(taskType) : false;
      if (hitsEndpoint && isMultimodalTask) return 'capability_mismatch';
      return 'auth';
    }
    if (msg.includes('402') || msg.includes('insufficient') || msg.includes('balance') || msg.includes('quota') || msg.includes('billing')) return 'payment';
    if (msg.includes('404') || msg.includes('not found') || msg.includes('does not exist')) return 'not_found';
    if (msg.includes('429') || msg.includes('rate limit')) return 'rate_limit';
    if (msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('econnreset') || msg.includes('fetch failed')) return 'network';
    return 'unknown';
  }

  /**
   * Phase 3: 级联到更强模型
   * 排除失败模型，重新选择一个更优模型
   */
  private async cascadeToStronger<T>(
    taskType: TaskType,
    context: TaskContext,
    fn: (model: LanguageModel, capabilities: ProviderCapabilities) => Promise<T>,
    failedModel: ModelConfig,
    errorType: string,
  ): Promise<T> {
    console.log(`[LLM] Cascade: ${failedModel.id} 失败(${errorType})，尝试级联到更强模型`);

    const stronger = await this.router.selectExcluding(taskType, context, [failedModel.id]);
    if (!stronger) {
      console.warn(`[LLM] Cascade: 无更强模型可用，抛出原始错误`);
      throw new Error(`模型 ${failedModel.id} 失败(${errorType})，且无更强模型可用`);
    }

    console.log(`[LLM] Cascade: 级联到 ${stronger.id}`);
    const strongerModel = await this.createModelFromConfig(stronger);

    try {
      const result = await fn(strongerModel, stronger.capabilities ?? this.currentCapabilities);
      // 记录级联成功
      this.router.recordOutcome({
        taskType, modelId: stronger.id, success: true,
        latencyMs: 0, timestamp: Date.now(),
        input: context.content, context, modelConfig: stronger,
      });
      // 阶段 4: cascade 触发 = 原模型能力不足，惩罚其 taskAffinity
      this.router.recordOutcome({
        taskType, modelId: failedModel.id, success: false,
        latencyMs: 0, errorType: 'cascade_penalty', timestamp: Date.now(),
        input: context.content, context, modelConfig: failedModel,
        fallbackTriggered: true, fallbackFrom: failedModel.id,
      });
      return result;
    } catch (cascadeErr) {
      // 级联也失败，记录并抛出
      this.router.recordOutcome({
        taskType, modelId: stronger.id, success: false,
        latencyMs: 0, errorType: this.classifyErrorType(cascadeErr, taskType), timestamp: Date.now(),
        input: context.content, context, modelConfig: stronger,
      });
      throw cascadeErr;
    }
  }

  private async executeWithFallback<T>(
    taskType: TaskType,
    context: TaskContext,
    fn: (model: LanguageModel, capabilities: ProviderCapabilities) => Promise<T>,
  ): Promise<T> {
    const selected = await this.selectModel(taskType, context);
    const startTime = Date.now();
    const inputContent = context.content;

    // 创建选中模型的 LanguageModel 实例
    const selectedModel = await this.createModelFromConfig(selected);

    try {
      const result = await this.withRetry(() => fn(selectedModel, selected.capabilities ?? this.currentCapabilities));
      const latencyMs = Date.now() - startTime;

      // Phase 3: 规则质量评分（零成本）
      // generateText 返回 GenerateTextResult，有 .text 和 .toolCalls 属性
      const outputText = (result as { text?: string }).text ?? '';
      const rawToolCalls = (result as { toolCalls?: Array<{ toolName: string; result?: string }> }).toolCalls;
      const quality = scoreByRules({
        input: inputContent,
        output: outputText,
        toolCalls: rawToolCalls?.map((tc) => ({ name: tc.toolName, success: !tc.result?.startsWith('[') })),
        latencyMs,
      });

      this.router.recordOutcome({
        taskType, modelId: selected.id, success: true,
        latencyMs, timestamp: Date.now(),
        input: inputContent, context, modelConfig: selected,
        qualityScore: quality.score,
      });

      return result;
    } catch (callErr) {
      const errorType = this.classifyErrorType(callErr, taskType);
      const latencyMs = Date.now() - startTime;

      // Phase 3: 能力不匹配（400）→ 级联到更强模型，而不是直接失败
      if (errorType === 'capability_mismatch') {
        console.warn(`[LLM] 模型 ${selected.id} 能力不匹配(${errorType})，尝试 Cascade Routing`);
        this.router.recordOutcome({
          taskType, modelId: selected.id, success: false,
          latencyMs, errorType, timestamp: Date.now(),
          input: inputContent, context, modelConfig: selected,
        });
        return this.cascadeToStronger(taskType, context, fn, selected, errorType);
      }

      // 其他错误：记录失败并抛出
      if (!this.isRetryable(callErr)) {
        this.router.recordOutcome({
          taskType, modelId: selected.id, success: false,
          latencyMs, errorType, timestamp: Date.now(),
          input: inputContent, context, modelConfig: selected,
        });
        throw callErr;
      }

      this.router.recordOutcome({
        taskType, modelId: selected.id, success: false,
        latencyMs, errorType: 'timeout', timestamp: Date.now(),
        input: inputContent, context, modelConfig: selected,
      });
      throw callErr;
    }
  }

  // ==================== ModelPool 集成 ====================
  // Phase 3: recordDecision() / getDecisionRecorder() 已移除，由 ModelRouter 直接管理

  /**
   * Phase 3: 由 Subsystems 调用，注入 ModelPool 到 ModelRouter
   */
  setPool(pool: import('./model-pool.js').ModelPool): void {
    this.router.setPool(pool);
  }

  /**
   * Phase 3: 由 Subsystems 调用，注入 DecisionRecorder 到 ModelRouter
   */
  setDecisionRecorder(recorder: DecisionRecorder): void {
    this.router.setDecisionRecorder(recorder);
  }

  /**
   * @deprecated Phase 3: ModelPool 由 Subsystems 创建，不再由 LLMAdapter 初始化
   */
  initPool(_poolConfig: NonNullable<BuddyConfig['pool']>): void {
    // no-op: Subsystems 直接创建 ModelPool 并通过 setPool() 注入
  }

  /**
   * 预热 ModelPool（异步，不阻塞启动）
   */
  async warmupPool(): Promise<void> {
    const pool = this.router.getPool();
    if (pool) await pool.warmup();
  }

  /**
   * @deprecated Phase 3: 使用 getPool()
   */
  getPoolScheduler(): ModelPoolScheduler | null {
    return this.poolScheduler;
  }

  /**
   * @deprecated Phase 3: ModelPool 由 Subsystems 创建，不再由 LLMAdapter 初始化
   */
  async initUnifiedPool(_modelsConfig: NonNullable<BuddyConfig['models']>): Promise<void> {
    // no-op: Subsystems 直接创建 ModelPool 并通过 setPool() 注入
  }

  /** 获取并清除最近的统一池选择结果 */
  consumeLastSelection(): import('./model-pool.js').ModelSelection | null {
    const sel = this.lastSelection;
    this.lastSelection = null;
    return sel;
  }

  /**
   * @deprecated 使用 consumeLastSelection()
   */
  consumeLastUnifiedSelection(): import('./model-pool.js').ModelSelection | null {
    return this.consumeLastSelection();
  }

  /** 获取统一模型池 */
  getPool(): import('./model-pool.js').ModelPool | null {
    return this.router.getPool();
  }

  /**
   * @deprecated 使用 getPool()
   */
  getUnifiedPool(): import('./model-pool.js').ModelPool | null {
    return this.router.getPool();
  }

  /**
   * 直接使用指定模型节点调用 LLM（绕过 ModelRouter 选择）
   *
   * 三脑决策 → 直接传入具体模型 → 跳过选择逻辑
   */
  async chatWithNode(
    node: { provider: string; model: string; apiKey?: string; baseUrl?: string; capabilities?: ProviderCapabilities },
    messages: Message[],
    tools: ToolDef[],
    maxSteps = 5,
  ): Promise<{ text: string; steps: number; toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }> }> {
    const { model, capabilities: staticCaps } = await ProviderFactory.create({
      provider: node.provider,
      model: node.model,
      apiKey: node.apiKey,
      baseUrl: node.baseUrl,
    });

    // 优先用传入的 capabilities（来自 ModelProfile → ModelRouter → agent），回退到静态推断
    const capabilities = node.capabilities ?? staticCaps;

    const aiMessages = this.preprocessMessages(messages) as import('ai').ModelMessage[];
    const genParams = this.buildGenParams();

    if (capabilities.toolCalling && !capabilities.needsPromptToolCalling) {
      return this.chatNative(model, aiMessages, tools, maxSteps, genParams);
    }
    return this.chatWithPromptTools(model, capabilities, aiMessages, tools, maxSteps, genParams);
  }

  /**
   * 从 ModelConfig 创建 LanguageModel 实例
   * 通过 AdapterRegistry 获取适配器
   */
  private async createModelFromConfig(config: ModelConfig): Promise<LanguageModel> {
    const { model } = await ProviderFactory.create({
      provider: config.provider,
      model: config.model,
      apiKey: config.apiKey ?? this.config.apiKey,      // fallback 到原始配置
      baseUrl: config.baseUrl ?? this.config.baseUrl,   // fallback 到原始配置
    });
    return model;
  }

  // ==================== 上下文预算控制 ====================

  /**
   * 粗略估算消息列表的 token 数
   * 中文 1 字 ≈ 2 token，英文 1 词 ≈ 1.3 token，取折中值 1 字 ≈ 3 字符
   */
  private estimateMessagesTokens(messages: Array<{ role: string; content: unknown }>): number {
    let total = 0;
    for (const m of messages) {
      if (typeof m.content === 'string') {
        total += Math.ceil(m.content.length / 3);
      }
    }
    return total;
  }

  /**
   * Task 7.2: 估算剩余上下文预算
   * 返回 maxContextTokens - 已用 tokens，用于主动压缩决策
   */
  private estimateRemainingBudget(messages: Array<{ role: string; content: unknown }>, maxContextTokens: number): number {
    const used = this.estimateMessagesTokens(messages);
    return maxContextTokens - used;
  }

  /**
   * Task 7.2: 信息生命周期管理 — hot/warm/cold 三级策略
   *
   * hot:  被引用过 或 最近1轮 → 原样保留
   * warm: 未引用 且 2-3轮前  → 语义压缩（按工具类型提取关键信息）
   * cold: 未引用 且 >3轮前   → 从上下文移除（关键工具保留摘要）
   *
   * 关键工具 (read_file/list_files/search_files/scan_project) 结果始终保留
   */
  private compressToolHistory(messages: Array<{ role: string; content: unknown; [key: string]: unknown }>, keepRecent: number = 2): void {
    const keepNames = new Set(['read_file', 'list_files', 'search_files', 'scan_project']);
    let toolMsgCount = 0;
    const currentTurn = toolMsgCount; // 用于计算 age

    // 先统计总工具消息数
    let totalToolMsgs = 0;
    for (const m of messages) {
      if (m.role === 'user' && typeof m.content === 'string'
          && m.content.startsWith('工具 ') && m.content.includes('返回:')) {
        totalToolMsgs++;
      }
    }

    let toolIdx = 0;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role !== 'user' || typeof m.content !== 'string'
          || !m.content.startsWith('工具 ') || !m.content.includes('返回:')) continue;

      toolIdx++;
      const resultIdx = m.content.indexOf('返回:');
      const toolName = m.content.slice(3, resultIdx).trim();

      // 关键工具结果始终保留
      if (keepNames.has(toolName)) continue;

      // 最近 keepRecent 条保留（hot）
      const age = totalToolMsgs - toolIdx;
      if (age < keepRecent) continue;

      // 查找引用追踪元数据
      const meta = this.findToolResultMeta(toolName, i);
      const isReferenced = meta && meta.referenced > 0;

      // hot: 被引用过的工具结果始终保留
      if (isReferenced) continue;

      const originalResult = m.content.slice(resultIdx + 3).trim();
      if (originalResult.length <= 100) continue;

      if (age > 3) {
        // cold: 移除，只保留一行摘要
        const summary = this.semanticCompress(originalResult, toolName);
        messages[i] = {
          ...m,
          content: `工具 ${toolName} 返回: [已归档, 原长 ${originalResult.length} 字符] ${summary.slice(0, 150)}`,
        };
      } else {
        // warm: 语义压缩
        const compressed = this.semanticCompress(originalResult, toolName);
        messages[i] = {
          ...m,
          content: `工具 ${toolName} 返回: [已压缩, 原长 ${originalResult.length} 字符] ${compressed}`,
        };
      }
    }

    // 清理过期的元数据
    this.gcToolResultMeta();
  }

  /**
   * 查找工具结果的引用追踪元数据
   */
  private findToolResultMeta(toolName: string, _messageIndex: number): { toolName: string; turn: number; referenced: number } | null {
    for (const meta of this.toolResultMeta.values()) {
      if (meta.toolName === toolName) return meta;
    }
    return null;
  }

  /**
   * 清理过期的工具结果元数据（保留最近 20 条）
   */
  private gcToolResultMeta(): void {
    if (this.toolResultMeta.size <= 20) return;
    const entries = [...this.toolResultMeta.entries()];
    // 按 turn 排序，删除最旧的
    entries.sort((a, b) => a[1].turn - b[1].turn);
    const toRemove = entries.length - 20;
    for (let i = 0; i < toRemove; i++) {
      this.toolResultMeta.delete(entries[i][0]);
    }
  }

  /**
   * 按工具类型做语义压缩，提取关键信息而非简单截断
   */
  private semanticCompress(content: string, toolName: string): string {
    switch (toolName) {
      case 'exec': {
        // 提取：退出状态 + 最后几行 + 错误信息
        const lines = content.split('\n');
        const lastLines = lines.slice(-5).join('\n');
        const hasError = /error|ENOENT|EACCES|failed|exception/i.test(content);
        const exitMatch = content.match(/exit (?:code|status):?\s*(\d+)/i);
        const exitInfo = exitMatch ? ` [exit ${exitMatch[1]}]` : '';
        const errorLine = lines.find(l => /error|Error|ERROR|fatal/i.test(l));
        return `${exitInfo}${errorLine ? `\n错误: ${errorLine.trim()}` : ''}\n末尾: ${lastLines}`.slice(0, 300);
      }
      case 'write_file': {
        // 提取：写入路径 + 字节数
        const pathMatch = content.match(/(?:写入|wrote|saved|created)\s+[`"']?([^\s`"']+)[`"']?/i);
        const sizeMatch = content.match(/(\d+)\s*(?:字节|bytes|字|chars)/i);
        return `${pathMatch ? `路径: ${pathMatch[1]}` : ''}${sizeMatch ? `, ${sizeMatch[1]} 字节` : ''}` || content.slice(0, 150);
      }
      case 'search_files': {
        // 提取：匹配文件列表 + 总数
        const files = content.match(/[^\s]+\.(?:ts|js|py|md|json|yaml|yml|css|html|vue|tsx|jsx)/g);
        const countMatch = content.match(/(\d+)\s*(?:个|matches|results|found)/i);
        const uniqueFiles = [...new Set(files ?? [])].slice(0, 10);
        return `匹配: ${uniqueFiles.join(', ')}${countMatch ? ` (${countMatch[1]}条)` : ''}`.slice(0, 300);
      }
      case 'web_search':
      case 'web_fetch': {
        // 提取：标题 + 前几句摘要
        const titleMatch = content.match(/(?:title|标题)[:：]\s*(.+)/i);
        const firstSentences = content.replace(/[\n\r]+/g, ' ').slice(0, 200);
        return `${titleMatch ? `标题: ${titleMatch[1]}\n` : ''}摘要: ${firstSentences}`.slice(0, 300);
      }
      case 'exec': return content.slice(0, 300); // fallback
      default: {
        // 通用：提取前 200 字 + 错误行（如有）
        const errorLine = content.split('\n').find(l => /error|Error|ERROR/i.test(l));
        return `${content.slice(0, 200)}${errorLine ? `\n[错误: ${errorLine.trim()}]` : ''}`.slice(0, 300);
      }
    }
  }

  // ==================== 内部调用路径 ====================

  private async chatNative(
    model: LanguageModel,
    aiMessages: import('ai').ModelMessage[],
    tools: ToolDef[],
    maxSteps: number,
    genParams: Record<string, unknown>,
  ) {
    const toolSet = this.buildToolSet(tools);

    const result = await generateText({
      model,
      messages: aiMessages,
      tools: Object.keys(toolSet).length > 0 ? toolSet : undefined,
      stopWhen: stepCountIs(maxSteps),
      experimental_repairToolCall: async ({ toolCall, tools, error }) => {
        console.log(`🔧 修复工具调用: ${toolCall.toolName} — ${error.message}`);
        const toolDef = (tools as Record<string, { description?: string }>)[toolCall.toolName];
        if (!toolDef) return null;
        try {
          // AI SDK v6 toolCall 有 .input 属性（stringified JSON）
          const originalArgs = toolCall.input ?? '{}';
          const repair = await generateText({
            model,
            messages: [{
              role: 'user' as const,
              content: `工具调用参数有误，请修复。\n\n工具: ${toolCall.toolName}\n工具描述: ${toolDef.description ?? ''}\n原始参数: ${originalArgs}\n错误: ${error.message}\n\n请只输出修复后的参数 JSON，不要其他文字。`,
            }],
            maxOutputTokens: 500,
          });
          const fixed = this.extractJson(repair.text);
          if (fixed) return { ...toolCall, input: fixed };
        } catch { /* 修复失败 */ }
        return null;
      },
      ...genParams,
    });
    // Task 8.1: 捕获 API usage
    if (result.usage) {
      this.lastActualUsage = { input: result.usage.inputTokens ?? 0, output: result.usage.outputTokens ?? 0 };
    }

    const toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }> = [];
    for (const step of result.steps) {
      // AI SDK v6 StepResult — 通过 unknown 中转避免类型不兼容
      const stepWithTools = step as unknown as { toolCalls?: Array<{ toolName: string; input: string; toolCallId: string }>; toolResults?: Array<{ toolCallId: string; result: unknown }> };
      for (const tc of stepWithTools.toolCalls ?? []) {
        const tr = stepWithTools.toolResults?.find((r) => r.toolCallId === tc.toolCallId);
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.input); } catch { /* 非 JSON input */ }
        toolCalls.push({ name: tc.toolName, args, result: tr ? String(tr.result) : '' });
      }
    }

    const normalized = ResponseNormalizer.normalizeAIStep(result);
    const finalText = normalized.content ?? result.text ?? '';
    if (!finalText) {
      console.warn(`[LLM] 空响应 provider=${this.config.provider} model=${this.config.model} steps=${result.steps.length}`);
    }
    return { text: finalText, steps: result.steps.length, toolCalls };
  }

  private async chatWithPromptTools(
    model: LanguageModel,
    capabilities: ProviderCapabilities,
    aiMessages: import('ai').ModelMessage[],
    tools: ToolDef[],
    maxSteps: number,
    genParams: Record<string, unknown>,
  ) {
    this.registerToolsForFallback(tools);

    const toolPrompt = this.toolCaller.buildToolSystemPrompt();
    const messagesWithTools = [...aiMessages];
    if (messagesWithTools.length > 0 && messagesWithTools[0].role === 'system') {
      messagesWithTools[0] = { ...messagesWithTools[0], content: messagesWithTools[0].content + '\n\n' + toolPrompt };
    } else {
      messagesWithTools.unshift({ role: 'system', content: toolPrompt });
    }

    const allToolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }> = [];
    let currentMessages = [...messagesWithTools];

    for (let step = 0; step < maxSteps; step++) {
      const result = await generateText({ model, messages: currentMessages, ...genParams });
      // Task 8.1: 捕获 API usage
      if (result.usage) {
        this.lastActualUsage = { input: result.usage.inputTokens ?? 0, output: result.usage.outputTokens ?? 0 };
      }
      const resultText = result.text ?? '';
      let normalized = ResponseNormalizer.extractFromText(resultText);

      // Task 2.2: 自纠错重试 — 模型输出看起来像工具调用但解析失败时，提示修正
      if (normalized.toolCalls.length === 0 && this.looksLikeToolCall(resultText)) {
        const correctionPrompt = this.buildCorrectionPrompt(resultText);
        currentMessages.push({ role: 'assistant' as const, content: resultText });
        currentMessages.push({ role: 'user' as const, content: correctionPrompt });

        try {
          const retryResult = await generateText({ model, messages: currentMessages, ...genParams });
          const retryText = retryResult.text ?? '';
          const retryNormalized = ResponseNormalizer.extractFromText(retryText);
          if (retryNormalized.toolCalls.length > 0) {
            normalized = retryNormalized;
            // 用修正后的内容替换原始内容
            currentMessages.pop(); // 移除 correction prompt
            currentMessages.push({ role: 'assistant' as const, content: retryText });
          } else {
            // 修正也失败了，按原逻辑返回文本
            currentMessages.pop(); // 移除 correction prompt
            return { text: resultText, steps: step + 1, toolCalls: allToolCalls };
          }
        } catch {
          // 修正调用失败，按原逻辑返回
          currentMessages.pop();
          return { text: resultText, steps: step + 1, toolCalls: allToolCalls };
        }
      }

      if (normalized.toolCalls.length === 0) {
        return { text: resultText, steps: step + 1, toolCalls: allToolCalls };
      }

      if (!currentMessages.some(m => m.role === 'assistant' && m.content === resultText)) {
        currentMessages.push({ role: 'assistant' as const, content: resultText });
      }

      // P5: 依赖感知的多工具执行 — Task 6.1: 统一中间件
      const llmMiddleware = new ToolExecutionMiddleware(
        this.toolCaller as unknown as import('../tools/registry.js').ToolRegistry,
        { beforeExecute: this.beforeToolExecute ?? undefined, defaultTimeoutMs: 30000 },
      );
      const executeSingleTool = async (tc: { name: string; arguments: Record<string, unknown> }) => {
        const repaired = this.toolCaller.repairArgs(tc.name, tc.arguments) ?? tc.arguments;
        const result = await llmMiddleware.execute({
          toolName: tc.name,
          args: repaired,
          source: 'llm',
        });
        return { name: tc.name, args: repaired, result: result.result };
      };

      // 依赖分析：B 的参数引用了 A 的名称 → B 依赖 A
      const batches = this.analyzeToolDependencies(normalized.toolCalls);
      const allResults: Array<{ name: string; args: Record<string, unknown>; result: string }> = [];

      // Task 7.2: 主动预算管理 — 每轮工具执行前检查剩余 token 预算
      const maxCtx = this.currentCapabilities.maxContextTokens ?? 32000;
      const remainingBefore = this.estimateRemainingBudget(currentMessages, maxCtx);
      if (remainingBefore < 2000) {
        this.compressToolHistory(currentMessages, 1);
        console.warn(`[LLM] 主动压缩: 剩余预算 ${remainingBefore} tokens < 2000, 已压缩历史工具结果`);
      }

      for (const batch of batches) {
        if (batch.length === 1) {
          allResults.push(await executeSingleTool(batch[0]));
        } else {
          const batchResults = await Promise.allSettled(batch.map(tc => executeSingleTool(tc)));
          for (const r of batchResults) {
            allResults.push(r.status === 'fulfilled' ? r.value : { name: 'unknown', args: {}, result: `[执行错误]` });
          }
        }
      }

      const results = allResults;

      // Task 8.3: 工具结果引用追踪 — 检查当前工具调用是否引用了之前的工具结果
      for (const tc of normalized.toolCalls) {
        const argsStr = JSON.stringify(tc.arguments ?? {});
        for (const [key, meta] of this.toolResultMeta) {
          if (argsStr.includes(meta.toolName) || argsStr.includes(key)) {
            meta.referenced++;
          }
        }
      }

      // P0: 上下文预算控制 — 注入工具结果前检查 token 量
      const estimatedTokens = this.estimateMessagesTokens(currentMessages);
      const maxContextTokens = this.currentCapabilities.maxContextTokens ?? 32000;
      const budgetThreshold = maxContextTokens * 0.6; // 60% 阈值触发压缩

      if (estimatedTokens > budgetThreshold) {
        this.compressToolHistory(currentMessages, 2); // 只保留最近 2 条工具结果不压缩
        console.warn(`[LLM] 上下文预算警告: ~${estimatedTokens} tokens, 阈值 ${budgetThreshold}, 已压缩历史工具结果`);
      }

      for (const r of results) {
        allToolCalls.push(r);
        const resultKey = `${r.name}_${step}_${allToolCalls.length}`;
        this.toolResultMeta.set(resultKey, { toolName: r.name, turn: step, referenced: 0 });

        // Phase 4: 工具被拒后的降级提示
        let resultContent = r.result;
        if (r.result.startsWith('[已拦截')) {
          resultContent += `\n💡 提示: ${r.name} 被用户拒绝。不要重试该工具，而是:\n1. 告诉用户为什么需要这个操作\n2. 询问用户是否愿意手动执行\n3. 尝试用其他方式完成任务（如果可能）`;
        }

        // Phase 3: 执行验证 — 工具成功后验证实际效果
        if (this.executionVerifier && !r.result.startsWith('[')) {
          try {
            const verification = await this.executionVerifier.verify(r.name, r.args, r.result);
            if (verification.discrepancy) {
              resultContent += `\n⚠️ 验证警告: ${verification.discrepancy}`;
            }
          } catch { /* 验证失败不阻塞 */ }
        }

        currentMessages.push({ role: 'user', content: `工具 ${r.name} 返回: ${resultContent}` });
      }
    }

    const finalResult = await generateText({ model, messages: currentMessages, ...genParams });
    // Task 8.1: 捕获 API usage
    if (finalResult.usage) {
      this.lastActualUsage = { input: finalResult.usage.inputTokens ?? 0, output: finalResult.usage.outputTokens ?? 0 };
    }
    return { text: finalResult.text ?? "", steps: maxSteps, toolCalls: allToolCalls };
  }

  /**
   * 依赖分析：将工具调用分批，无依赖的并行，有依赖的串行
   * 如果 B 的参数 JSON 引用了 A 的名称 → B 依赖 A
   */
  private analyzeToolDependencies(
    toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
  ): Array<Array<{ name: string; arguments: Record<string, unknown> }>> {
    if (toolCalls.length <= 1) return [toolCalls];

    const batches: Array<Array<{ name: string; arguments: Record<string, unknown> }>> = [];
    const remaining = [...toolCalls];
    const completed = new Set<string>();

    while (remaining.length > 0) {
      // 找出无依赖的批次：参数 JSON 不引用任何未完成工具的名称
      const batch = remaining.filter(tc => {
        const argsStr = JSON.stringify(tc.arguments);
        return !remaining.some(other =>
          other !== tc && argsStr.includes(other.name) && !completed.has(other.name),
        );
      });

      if (batch.length === 0) {
        // 全部有循环依赖，强制逐个执行
        batches.push([remaining.shift()!]);
        continue;
      }

      for (const tc of batch) {
        remaining.splice(remaining.indexOf(tc), 1);
        completed.add(tc.name);
      }
      batches.push(batch);
    }

    return batches;
  }

  /**
   * Task 2.2: 检测模型输出是否看起来像工具调用但解析失败
   */
  private looksLikeToolCall(text: string): boolean {
    const trimmed = text.trim();
    // 包含 { 但没被成功解析的
    if (trimmed.includes('{') && trimmed.includes('}')) {
      // 包含 tool/args/name 等关键词
      if (/\b(tool|args|function|invoke)\b/i.test(trimmed)) return true;
      // 包含 ```json 但格式不对
      if (trimmed.includes('```json')) return true;
    }
    // 包含 XML 工具标签
    if (/<tool\b|<action\b|<tool_call>/i.test(trimmed)) return true;
    return false;
  }

  /**
   * Task 2.2: 构建自纠错提示
   */
  private buildCorrectionPrompt(originalOutput: string): string {
    const toolNames = Array.from(this.toolCaller.listTools().map(t => t.name)).slice(0, 8);
    return `你的回复中包含工具调用，但格式无法解析。请严格按照以下格式重新输出工具调用：

\`\`\`json
{"tool": "工具名", "args": {"参数名": "参数值"}}
\`\`\`

可用工具: ${toolNames.join(', ')}

注意：
1. JSON 必须用 \`\`\`json 代码块包裹
2. tool 字段必须是上面列出的工具名
3. args 必须是 JSON 对象
4. 不要在 JSON 前后添加其他内容

你刚才的回复（仅供参考）：
${originalOutput.slice(0, 300)}

请重新输出工具调用：`;
  }

  // ==================== 熔断器 + 重试 ====================

  private isCircuitOpen(): boolean {
    if (this.failureCount < this.CIRCUIT_FAIL_THRESHOLD) return false;
    if (Date.now() - this.lastFailureTime > this.CIRCUIT_OPEN_MS) {
      this.failureCount = this.CIRCUIT_FAIL_THRESHOLD - 1;
      return false;
    }
    return true;
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.saveCircuitState();
  }
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.saveCircuitState();
  }

  // ISSUE-007: 熔断器状态持久化
  private loadCircuitState(): void {
    if (!this.circuitStatePath) return;
    try {
      if (fs.existsSync(this.circuitStatePath)) {
        const state = JSON.parse(fs.readFileSync(this.circuitStatePath, 'utf-8'));
        if (state.failureCount > 0 && Date.now() - state.lastFailureTime < 3_600_000) {
          // 只恢复 1 小时内的状态
          this.failureCount = state.failureCount;
          this.lastFailureTime = state.lastFailureTime;
        }
      }
    } catch (e) { console.debug('[llm] state load', e); }
  }

  private saveCircuitState(): void {
    if (!this.circuitStatePath) return;
    try {
      fs.writeFileSync(this.circuitStatePath, JSON.stringify({
        failureCount: this.failureCount,
        lastFailureTime: this.lastFailureTime,
      }));
    } catch (e) { console.debug('[llm] state write fail', e); }
  }

  private isRetryable(err: unknown): boolean {
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    // 先用 adapter 的分类器
    if (err instanceof Error) {
      try {
        const adapter = this.getCurrentAdapter();
        if (adapter) {
          const classification = adapter.classifyError(err);
          if (!classification.retryable) return false;
        }
      } catch { /* adapter 不可用时走通用逻辑 */ }
    }
    // 通用判断
    return msg.includes('429') || msg.includes('rate limit') ||
      msg.includes('500') || msg.includes('502') || msg.includes('503') ||
      msg.includes('timeout') || msg.includes('econnrefused') ||
      msg.includes('econnreset') || msg.includes('network') || msg.includes('fetch failed');
  }

  /**
   * 获取当前 provider 的适配器（用于错误分类等）
   */
  private getCurrentAdapter(): ProviderAdapter | null {
    return adapterRegistry.get(this.config.provider) ?? null;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isCircuitOpen()) throw new Error('LLM 服务暂时不可用（熔断中），请稍后重试');

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const result = await fn();
        this.onSuccess();
        return result;
      } catch (err) {
        lastError = err;
        this.onFailure();
        if (attempt < this.MAX_RETRIES && this.isRetryable(err)) {
          await new Promise((r) => setTimeout(r, this.BASE_DELAY_MS * Math.pow(2, attempt)));
        } else {
          throw err;
        }
      }
    }
    throw lastError;
  }

  // ==================== 工具 ====================

  private buildGenParams(): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    if (this.config.temperature !== undefined) params.temperature = this.config.temperature;
    if (this.config.maxOutputTokens !== undefined) params.maxOutputTokens = this.config.maxOutputTokens;
    if (this.config.topP !== undefined) params.topP = this.config.topP;
    if (this.config.frequencyPenalty !== undefined) params.frequencyPenalty = this.config.frequencyPenalty;
    if (this.config.presencePenalty !== undefined) params.presencePenalty = this.config.presencePenalty;
    if (this.config.stopSequences?.length) params.stopSequences = this.config.stopSequences;
    return params;
  }

  private buildToolSet(tools: ToolDef[]): ToolSet {
    const toolSet: ToolSet = {};
    for (const t of tools) {
      toolSet[t.name] = tool({
        description: t.description,
        inputSchema: t.parameters,
        execute: async (args: Record<string, unknown>) => {
          try {
            if (this.beforeToolExecute) {
              const check = await this.beforeToolExecute(t.name, args);
              if (!check.allowed) return `[已拦截: ${check.reason ?? '权限不足'}]`;
            }
            return await t.execute(args);
          } catch (err) {
            const rawMsg = `[工具执行错误: ${err instanceof Error ? err.message : String(err)}]`;
            return `${rawMsg}\n💡 ${friendlyError(rawMsg)}`;
          }
        },
      });
    }
    return toolSet;
  }

  private registerToolsForFallback(tools: ToolDef[]): void {
    this.toolCaller = new UniversalToolCaller();
    this.toolCaller.registerTools(tools);
  }

  private zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = this.zodFieldToJson(value as z.ZodType);
        if (!(value as z.ZodType).isOptional()) required.push(key);
      }
      return { type: 'object', properties, required: required.length > 0 ? required : undefined };
    }
    return { type: 'object' };
  }

  private zodFieldToJson(field: z.ZodType): Record<string, unknown> {
    const unwrapped = field instanceof z.ZodOptional ? field._def.innerType : field;
    if (unwrapped instanceof z.ZodString) return { type: 'string' };
    if (unwrapped instanceof z.ZodNumber) return { type: 'number' };
    if (unwrapped instanceof z.ZodBoolean) return { type: 'boolean' };
    if (unwrapped instanceof z.ZodArray) return { type: 'array', items: this.zodFieldToJson(unwrapped.element) };
    if (unwrapped instanceof z.ZodEnum) return { type: 'string', enum: unwrapped.options };
    if (unwrapped instanceof z.ZodObject) return this.zodToJsonSchema(unwrapped);
    return { type: 'string' };
  }

  private extractJson(text: string): string | null {
    const codeBlock = text.match(/```json\s*([\s\S]*?)```/);
    if (codeBlock) return codeBlock[1].trim();
    const genericBlock = text.match(/```\s*([\s\S]*?)```/);
    if (genericBlock) {
      const inner = genericBlock[1].trim();
      if (inner.startsWith('{') || inner.startsWith('[')) return inner;
    }
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return match[0];
    return null;
  }

  // ==================== 多模态执行 ====================

  /**
   * 多模态执行入口 — 根据 TaskType 路由到对应执行器
   *
   * 支持: image-gen, image-edit, asr, embedding, ocr
   * TTS 请使用 TTSManager 子系统
   */
  async executeMultimodal(
    taskType: TaskType,
    input: string | Buffer,
    options?: MultimodalOptions,
  ): Promise<MultimodalResult> {
    if (!this.available) {
      throw new Error('⚠️ LLM 未配置，无法执行多模态任务。');
    }

    // 选模型（多模态任务，模型池已按类别过滤）
    const context: TaskContext = { content: typeof input === 'string' ? input : '[binary]' };
    const selected = await this.selectModel(taskType, context);
    const startTime = Date.now();

    try {
      const result = await this.multimodalExecutor.execute(taskType, input, selected, options);
      const latencyMs = Date.now() - startTime;

      // 记录成功
      this.router.recordOutcome({
        taskType,
        modelId: selected.id,
        success: true,
        latencyMs,
        timestamp: Date.now(),
        input: context.content,
        context,
        modelConfig: selected,
      });

      return result;
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      this.router.recordOutcome({
        taskType,
        modelId: selected.id,
        success: false,
        latencyMs,
        errorType: this.classifyErrorType(err, taskType),
        timestamp: Date.now(),
        input: context.content,
        context,
        modelConfig: selected,
      });

      // 尝试级联到同类别其他模型
      const fallbackConfig = await this.router.selectExcluding(taskType, context, [selected.id]);
      if (fallbackConfig) {
        console.log(`[LLM] Multimodal cascade: ${selected.id} → ${fallbackConfig.id}`);
        return this.multimodalExecutor.execute(taskType, input, fallbackConfig, options);
      }

      throw err;
    }
  }
}
