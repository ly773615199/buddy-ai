import fs from 'fs';
import path from 'path';
import type { PoolNode } from '../types.js';
import type { BodyState } from '../brain/types.js';
import type { ProviderCapabilities } from './provider-registry.js';
import { ProviderFactory } from './provider-registry.js';
import type { ModelPool, ModelRequirement, ModelSelection, ModelProfile } from './model-pool.js';
import type { ModelCategory } from './model-enrichment.js';
import type { DecisionRecorder } from './decision-recorder.js';

// ==================== 任务类型 ====================

export type TaskType = 'chat' | 'tools' | 'reasoning' | 'background' | 'domain'
  | 'image-gen' | 'image-edit' | 'video-gen'
  | 'tts' | 'asr' | 'embedding' | 'ocr' | 'translation';

export interface TaskContext {
  content: string;
  hasToolCalls?: boolean;
  isBackground?: boolean;
  domainMatch?: string;
  userOverride?: string;
  /** 小脑状态（Phase 2: 注入 load/energy 调节） */
  bodyState?: BodyState;
}

// ==================== 模型配置 ====================

export interface ModelConfig {
  /** 模型标识: 'local/<domain>' | '<provider>/<model>' */
  id: string;
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  capabilities?: ProviderCapabilities;
  /** 决策来源 */
  source: 'user_override' | 'user_preference' | 'local_expert' | 'learned' | 'default';
}

// ==================== 本地专家 ====================

export interface LocalExpert {
  domain: string;
  confidence: number;
  capabilities: ProviderCapabilities;
  query: (prompt: string) => Promise<string>;
}

// ==================== 调用结果 ====================

export interface RouteOutcome {
  taskType: TaskType;
  modelId: string;
  success: boolean;
  latencyMs: number;
  errorType?: 'timeout' | 'rate_limit' | 'quality' | 'unknown' | 'capability_mismatch' | 'prompt_too_long' | 'auth' | 'network' | 'cascade_penalty' | 'payment' | 'not_found';
  timestamp: number;
}

// ==================== 任务类型推断 ====================

const TOOL_KEYWORDS = [
  '执行', '运行', 'run', 'exec', '读取', 'read', '写入', 'write',
  '搜索', 'search', 'grep', 'find', 'git', '文件', 'file',
  '目录', 'folder', 'ls', 'cat', '部署', 'deploy', '安装', 'install',
];

const REASONING_KEYWORDS = [
  '分析', 'analyze', '为什么', 'why', '解释', 'explain', '比较', 'compare',
  '设计', 'design', '架构', 'architecture', '优化', 'optimize', '重构', 'refactor',
  '推导', '证明', 'prove', '算法', 'algorithm', '复杂', 'complex',
  '一步一步', 'step by step', '深度', 'deep',
];

// 多模态关键词
const IMAGE_GEN_KEYWORDS = ['画', '生成图', '画一张', '图片生成', 'draw', 'generate image', 'create image', 'illustration', '设计图', '做一张图'];
const VIDEO_GEN_KEYWORDS = ['生成视频', '视频生成', 'generate video', '做视频'];
const IMAGE_EDIT_KEYWORDS = ['编辑图片', '修图', 'image edit', 'p图'];
const TTS_KEYWORDS = ['念', '读出来', '语音', '朗读', 'speak', 'read aloud', 'tts', '语音合成'];
const ASR_KEYWORDS = ['听', '转录', '语音识别', 'transcribe', 'speech to text', 'stt', '听写'];
const EMBEDDING_KEYWORDS = ['向量化', '嵌入', 'embed', 'vectorize', 'embedding', '向量'];
const OCR_KEYWORDS = ['识别文字', 'ocr', '提取文字', 'read text from image', '图片里的字'];
const TRANSLATION_KEYWORDS = ['翻译', 'translate'];

/**
 * 根据内容和上下文推断任务类型
 */
export function inferTaskType(content: string, context?: Partial<TaskContext>): TaskType {
  // 显式标记优先
  if (context?.isBackground) return 'background';
  if (context?.domainMatch) return 'domain';

  const lower = content.toLowerCase();

  // 工具调用（显式标记）
  if (context?.hasToolCalls) return 'tools';

  // 多模态优先检测（比文本任务更明确）
  if (IMAGE_GEN_KEYWORDS.some(k => lower.includes(k))) return 'image-gen';
  if (VIDEO_GEN_KEYWORDS.some(k => lower.includes(k))) return 'video-gen';
  if (IMAGE_EDIT_KEYWORDS.some(k => lower.includes(k))) return 'image-edit';
  if (TTS_KEYWORDS.some(k => lower.includes(k))) return 'tts';
  if (ASR_KEYWORDS.some(k => lower.includes(k))) return 'asr';
  if (EMBEDDING_KEYWORDS.some(k => lower.includes(k))) return 'embedding';
  if (OCR_KEYWORDS.some(k => lower.includes(k))) return 'ocr';
  if (TRANSLATION_KEYWORDS.some(k => lower.includes(k))) return 'translation';

  // 工具关键词（文本匹配，可能误匹配）
  const toolScore = TOOL_KEYWORDS.filter((k) => lower.includes(k)).length;
  if (toolScore >= 1) return 'tools';

  // 复杂推理（内容较长 + 推理关键词）
  const reasonScore = REASONING_KEYWORDS.filter((k) => lower.includes(k)).length;
  if (reasonScore >= 2 || (reasonScore >= 1 && content.length > 200)) return 'reasoning';

  // 短消息 → 闲聊
  if (content.length < 50) return 'chat';

  // 默认
  return 'chat';
}

// ==================== ModelRouter ====================

/**
 * 模型路由器 — 从统一模型池中智能选择模型
 *
 * Phase 2: 统一入口，直接依赖 ModelPool
 *
 * 决策链（按优先级）：
 * 1. 用户 per-message 指定
 * 2. 用户会话级覆盖
 * 3. 本地专家（领域匹配）
 * 4. 统一模型池（Thompson Sampling）
 * 5. MockLLM 模式
 * 6. 抛错
 *
 * 不再有 primary/lightweight 概念，所有模型平等进入统一模型池。
 * Thompson Sampling 参数由 ModelPool 统一管理，不再本地维护 learnedPrefs。
 */
export class ModelRouter {
  private localExperts = new Map<string, LocalExpert>();

  // 用户覆盖（会话级）
  private userOverride: string | null = null;

  // 统一模型池（Phase 2: 直接依赖 ModelPool，不再依赖 ModelPoolUnified/ModelPoolScheduler）
  private pool: ModelPool | null = null;

  // 决策记录器（Phase 3: 从 LLMAdapter 迁移到 ModelRouter）
  private decisionRecorder: DecisionRecorder | null = null;

  // 统一池选择结果回调（供 LLMAdapter 发 WS 事件）
  private onSelection: ((selection: ModelSelection) => void) | null = null;

  // 持久化路径（仅保留 outcomes 用于调试）
  private outcomes: RouteOutcome[] = [];
  private readonly MAX_OUTCOMES = 500;
  private dataFile: string | null = null;

  constructor(dataDir?: string) {
    if (dataDir) {
      this.dataFile = `${dataDir}/router-outcomes.json`;
      this.load();
    }
  }

  // ==================== ModelPool 集成（Phase 2 统一入口） ====================

  setPool(pool: ModelPool): void {
    this.pool = pool;
  }

  getPool(): ModelPool | null {
    return this.pool;
  }

  /**
   * Phase 3: 注入决策记录器（从 LLMAdapter 迁移）
   */
  setDecisionRecorder(recorder: DecisionRecorder): void {
    this.decisionRecorder = recorder;
  }

  getDecisionRecorder(): DecisionRecorder | null {
    return this.decisionRecorder;
  }

  setOnSelection(cb: (selection: ModelSelection) => void): void {
    this.onSelection = cb;
  }

  /**
   * @deprecated Phase 1 兼容 — 旧代码仍通过 setUnifiedPool 注入
   * 内部委托给 setPool
   */
  setUnifiedPool(pool: { isInitialized: boolean; select: Function; recordFeedback: Function }): void {
    // 兼容旧 ModelPoolUnified 接口，直接当 pool 用
    this.pool = pool as unknown as ModelPool;
  }

  /**
   * @deprecated Phase 1 兼容
   */
  getUnifiedPool(): ModelPool | null {
    return this.pool;
  }

  /**
   * @deprecated Phase 2 兼容 — 旧代码仍通过 setPoolScheduler 注入
   */
  setPoolScheduler(_scheduler: unknown): void {
    // no-op: Phase 2 不再需要 PoolScheduler
  }

  /**
   * @deprecated Phase 2 兼容
   */
  getPoolScheduler(): null {
    return null;
  }

  // ==================== 核心选择 ====================

  /**
   * 选择模型 — 决策链按优先级执行
   *
   * Phase 2: 新增 bodyState 参数，注入小脑状态（load/energy）到模型需求
   */
  async select(taskType: TaskType, context?: TaskContext): Promise<ModelConfig> {
    // 1. 用户 per-message 指定
    if (context?.userOverride) {
      const resolved = this.resolveModel(context.userOverride);
      if (resolved) return { ...resolved, source: 'user_override' };
    }

    // 2. 用户会话级覆盖
    if (this.userOverride) {
      const resolved = this.resolveModel(this.userOverride);
      if (resolved) return { ...resolved, source: 'user_override' };
    }

    // 3. 本地专家（领域匹配 + 置信度够）— 优先于统一池
    if (taskType === 'domain' && context?.domainMatch) {
      const local = this.tryLocalExpert(context.domainMatch);
      if (local) return local;
    }

    // 4. 统一模型池（知情决策：先查 pool 再选）
    if (this.pool && this.pool.isInitialized) {
      try {
        // 4a. 查询 pool 中该任务类型的可用模型，记录决策上下文
        if (typeof this.pool.queryCapableModels === 'function') {
          const capable = this.pool.queryCapableModels(taskType);
          if (capable.length > 0) {
            const best = capable.reduce((a, b) =>
              a.taskSuccessRate > b.taskSuccessRate ? a : b
            );
            const cheapest = capable.reduce((a, b) =>
              a.costPer1kInput < b.costPer1kInput ? a : b
            );
            console.log(
              `[ModelRouter] 知情决策: taskType=${taskType}, ` +
              `可用模型=${capable.length}, ` +
              `最可靠=${best.displayName}(${(best.taskSuccessRate * 100).toFixed(0)}%), ` +
              `最便宜=${cheapest.displayName}`
            );
          }
        }

        const requirement = this.buildModelRequirement(taskType, context);
        const selection = this.pool.select(requirement);
        if (selection) {
          // 通知回调
          if (this.onSelection) {
            this.onSelection(selection);
          }

          // 从 ModelPool 获取 provider 凭据注入到 ModelConfig
          const creds = this.pool.getProviderCredentials(selection.profile.platform);

          // 将 ModelProfile 转换为 ModelConfig
          return {
            id: selection.profile.id,
            provider: selection.profile.platform,
            model: selection.profile.id.split('/').slice(1).join('/'),
            apiKey: creds?.apiKey,
            baseUrl: creds?.baseUrl,
            source: 'default',
            capabilities: await this.profileToCapabilities(selection.profile),
          };
        }
      } catch (err) {
        console.warn(`[ModelRouter] 统一池选择失败: ${(err as Error).message}`);
      }
    }

    // 5. MockLLM 模式：返回 mock 模型配置（不依赖模型池）
    if (process.env.BUDDY_MOCK_LLM === '1') {
      return {
        id: 'mock/mock-model',
        provider: 'mock',
        model: 'mock-model',
        source: 'default',
      };
    }

    // 6. 所有路径都不可用 → 抛错
    throw new Error(
      '[ModelRouter] 无可用模型：统一模型池未初始化。' +
      '请在 config.models 中配置 providers。',
    );
  }

  // ==================== 用户覆盖 ====================

  /**
   * 获取 fallback 链 — 已废弃，统一模型池内部处理 fallback
   * 保留此方法仅为向后兼容
   */
  getFallbacks(_current?: { id: string }): ModelConfig[] {
    return [];
  }

  /**
   * Phase 2: 选择排除指定模型后的最优模型
   * 用于 Cascade Routing — 当选中模型失败时，排除它再选一个
   */
  async selectExcluding(taskType: TaskType, context: TaskContext, excludeIds: string[]): Promise<ModelConfig | null> {
    if (!this.pool || !this.pool.isInitialized) return null;

    try {
      const requirement = this.buildModelRequirement(taskType, context);
      const selection = this.pool.selectExcluding(requirement, excludeIds);
      if (!selection) return null;

      const creds = this.pool.getProviderCredentials(selection.profile.platform);
      return {
        id: selection.profile.id,
        provider: selection.profile.platform,
        model: selection.profile.id.split('/').slice(1).join('/'),
        apiKey: creds?.apiKey,
        baseUrl: creds?.baseUrl,
        source: 'default',
        capabilities: await this.profileToCapabilities(selection.profile),
      };
    } catch {
      return null;
    }
  }

  setUserOverride(modelRef: string): void {
    this.userOverride = modelRef;
  }

  clearUserOverride(): void {
    this.userOverride = null;
  }

  getUserOverride(): string | null {
    return this.userOverride;
  }

  // ==================== 本地专家 ====================

  registerLocalExpert(expert: LocalExpert): void {
    this.localExperts.set(expert.domain, expert);
  }

  unregisterLocalExpert(domain: string): void {
    this.localExperts.delete(domain);
  }

  private tryLocalExpert(domain: string): ModelConfig | null {
    const expert = this.localExperts.get(domain);
    if (!expert || expert.confidence < 0.7) return null;

    return {
      id: `local/${domain}`,
      provider: 'local',
      model: domain,
      capabilities: expert.capabilities,
      source: 'local_expert',
    };
  }

  updateExpertConfidence(domain: string, delta: number): void {
    const expert = this.localExperts.get(domain);
    if (expert) {
      expert.confidence = Math.max(0, Math.min(1, expert.confidence + delta));
    }
  }

  // ==================== 结果记录（Phase 2: 委托给 ModelPool；Phase 3: 整合 DecisionRecorder） ====================

  recordOutcome(outcome: RouteOutcome & {
    input?: string;
    context?: TaskContext;
    modelConfig?: ModelConfig;
    fallbackTriggered?: boolean;
    fallbackFrom?: string;
    qualityScore?: number;
  }): void {
    this.outcomes.push(outcome);
    if (this.outcomes.length > this.MAX_OUTCOMES) {
      this.outcomes = this.outcomes.slice(-this.MAX_OUTCOMES);
    }

    // 委托给 ModelPool 统一管理 Thompson Sampling 参数
    if (this.pool && this.pool.isInitialized) {
      this.pool.recordFeedback(
        outcome.modelId,
        outcome.taskType,
        outcome.success,
        outcome.latencyMs,
        0,
        outcome.qualityScore,
      );

      // §2.7: 更新模型访问状态
      if (outcome.success) {
        this.pool.recordAccessSuccess(outcome.modelId);
      } else if (outcome.errorType) {
        // 将 RouteOutcome 的 errorType 映射为 ModelAccessErrorType
        const ACCESS_ERROR_MAP: Record<string, import('./model-access-verifier.js').ModelAccessErrorType> = {
          'auth': 'auth',
          'payment': 'payment',
          'not_found': 'not_found',
          'timeout': 'timeout',
          'rate_limit': 'rate_limited',
          'network': 'network',
          'quality': 'unknown',
          'capability_mismatch': 'unknown',
          'prompt_too_long': 'unknown',
          'cascade_penalty': 'unknown',
        };
        const mapped = ACCESS_ERROR_MAP[outcome.errorType] ?? 'unknown';
        // 只对可能导致状态变更的错误类型更新状态
        if (mapped !== 'unknown') {
          this.pool.recordAccessFailure(outcome.modelId, mapped);

          // §2.7 错误升级：连续 3 个模型都 payment 失败 → 端点级余额不足
          if (mapped === 'payment') {
            const profile = this.pool.getProfile(outcome.modelId);
            if (profile) {
              const count = this.pool.getEndpointPaymentFailureCount(profile.platform);
              if (count >= 3) {
                console.warn(`[ModelRouter] 端点 ${profile.platform} 余额不足升级: ${count} 个模型 payment 失败`);
              }
            }
          }
        }
      }
    }

    // Phase 3: 记录到 DecisionRecorder（从 LLMAdapter.recordDecision 迁移）
    if (this.decisionRecorder && outcome.input) {
      try {
        this.decisionRecorder.record({
          input: outcome.input.slice(0, 500),
          intent: outcome.taskType,
          domain: outcome.context?.domainMatch ?? null,
          novelty: 0,
          complexity: this.inferComplexity(outcome.input, outcome.taskType),
          selectedNode: outcome.modelId,
          selectionReason: outcome.modelConfig?.source ?? 'default',
          selectionLayer: outcome.modelConfig?.source === 'local_expert' ? 1
            : outcome.modelConfig?.source === 'learned' ? 2 : 1,
          outputTokenLimit: 4096,
          success: outcome.success,
          latencyMs: outcome.latencyMs,
          inputTokens: 0,
          outputTokens: 0,
          costEstimate: 0,
          fallbackTriggered: outcome.fallbackTriggered ?? false,
          fallbackFrom: outcome.fallbackFrom,
        });
      } catch { /* 记录失败不影响主流程 */ }
    }

    this.save();
  }

  // ==================== 任务级完成度反馈（阶段 4） ====================

  /**
   * 记录任务级完成度 — 一次用户请求可能涉及多次 LLM 调用
   * 聚合所有参与模型的表现，按贡献度更新 taskAffinity
   */
  recordTaskOutcome(task: {
    taskType: TaskType;
    modelIds: string[];           // 本次任务涉及的所有模型
    success: boolean;             // 任务是否完成
    latencyMs: number;            // 总耗时
    cascadeTriggered: boolean;    // 是否触发了 cascade
    toolCallCount: number;        // 工具调用次数
    toolSuccessCount: number;     // 工具成功次数
    retryCount: number;           // 重试次数
  }): void {
    if (!this.pool?.isInitialized) return;

    // 任务级质量分：综合客观指标
    let taskQuality = 1.0;
    if (!task.success) taskQuality *= 0.3;
    if (task.cascadeTriggered) taskQuality *= 0.7;  // cascade = 原模型不行
    if (task.toolCallCount > 0) {
      const toolRate = task.toolSuccessCount / task.toolCallCount;
      taskQuality *= (0.5 + toolRate * 0.5);  // 工具成功率影响质量
    }
    if (task.retryCount > 0) taskQuality *= Math.max(0.3, 1 - task.retryCount * 0.2);
    if (task.latencyMs > 30000) taskQuality *= 0.8;  // 超时惩罚

    // 按贡献度更新每个模型的 taskAffinity
    for (const modelId of task.modelIds) {
      this.pool.recordFeedback(
        modelId,
        task.taskType,
        task.success,
        task.latencyMs / Math.max(1, task.modelIds.length),  // 平均分配延迟
        0,
        taskQuality,
      );
    }

    console.log(
      `[ModelRouter] 任务完成: type=${task.taskType}, success=${task.success}, ` +
      `quality=${taskQuality.toFixed(2)}, models=[${task.modelIds.join(',')}], ` +
      `cascade=${task.cascadeTriggered}, tools=${task.toolSuccessCount}/${task.toolCallCount}`
    );
  }

  // ==================== ModelProfile → ProviderCapabilities ====================

  /**
   * 从 ModelProfile 构建 ProviderCapabilities
   *
   * 关键：用 ModelProfile 的 toolCallingMode 覆盖 ProviderFactory 的静态推断，
   * 打通 ModelPool → ModelRouter → LLMAdapter 的能力信息流。
   */
  private async profileToCapabilities(profile: ModelProfile): Promise<ProviderCapabilities> {
    // 从 ProviderFactory 获取基础静态 capabilities
    // 传递 baseUrl 以支持自定义 OpenAI 兼容端点（如 NVIDIA NIM）
    const creds = this.pool?.getProviderCredentials(profile.platform);
    const base = (await ProviderFactory.create({
      provider: profile.platform,
      model: profile.id.split('/').slice(1).join('/'),
      apiKey: creds?.apiKey,
      baseUrl: creds?.baseUrl,
    })).capabilities;

    // 用 ModelProfile 的运行时信息覆盖
    return {
      ...base,
      toolCalling: profile.capabilities.toolCallingMode !== 'none',
      needsPromptToolCalling: profile.capabilities.toolCallingMode === 'prompt',
      vision: profile.capabilities.vision ?? base.vision,
    };
  }

  // ==================== 模型解析 ====================

  private resolveModel(ref: string): ModelConfig | null {
    // 'local/<domain>'
    if (ref.startsWith('local/')) {
      const domain = ref.slice(6);
      const expert = this.localExperts.get(domain);
      if (expert) {
        return {
          id: ref,
          provider: 'local',
          model: domain,
          capabilities: expert.capabilities,
          source: 'local_expert',
        };
      }
    }

    // '<provider>/<model>' — 从统一模型池中查找（支持并行/辩论路径的 userOverride）
    if (this.pool && this.pool.isInitialized) {
      const profile = this.pool.getProfile(ref);
      if (profile) {
        const creds = this.pool.getProviderCredentials(profile.platform);
        return {
          id: profile.id,
          provider: profile.platform,
          model: profile.id.split('/').slice(1).join('/'),
          apiKey: creds?.apiKey,
          baseUrl: creds?.baseUrl,
          source: 'user_override',
        };
      }
      // 也尝试用 ref 作为 model 名在池中搜索（如 "Qwen/Qwen3.6-27B"）
      for (const p of this.pool.getAllProfiles()) {
        if (p.id.endsWith(`/${ref}`) || p.id === ref) {
          const creds = this.pool.getProviderCredentials(p.platform);
          return {
            id: p.id,
            provider: p.platform,
            model: p.id.split('/').slice(1).join('/'),
            apiKey: creds?.apiKey,
            baseUrl: creds?.baseUrl,
            source: 'user_override',
          };
        }
      }
    }

    return null;
  }

  /** 推断复杂度 */
  inferComplexity(input: string, taskType: TaskType): 'simple' | 'medium' | 'complex' {
    if (taskType === 'reasoning') return 'complex';
    if (taskType === 'tools') return 'medium';
    if (taskType === 'background') return 'simple';
    // 多模态任务：API 调用为主，复杂度 simple
    if (['image-gen', 'image-edit', 'video-gen', 'tts', 'asr', 'embedding', 'ocr', 'translation'].includes(taskType)) return 'simple';
    const COMPLEX_INPUT_LEN = 500;
    const MEDIUM_INPUT_LEN = 100;
    if (input.length > COMPLEX_INPUT_LEN) return 'complex';
    if (input.length > MEDIUM_INPUT_LEN) return 'medium';
    return 'simple';
  }

  /**
   * 构建模型需求 — 将任务上下文转换为统一池的 ModelRequirement
   *
   * Phase 2: 接受 BodyState，注入 load/energy 调节
   */
  buildModelRequirement(taskType: TaskType, context?: TaskContext): ModelRequirement {
    const content = context?.content ?? '';
    const complexity = this.inferComplexity(content, taskType);
    const body = context?.bodyState;

    const req: ModelRequirement = {
      taskType,
      minCapabilities: {},
      requiredFeatures: [],
      complexity,
    };

    switch (taskType) {
      case 'reasoning':
        req.minCapabilities = { reasoning: 0.7, math: 0.5 };
        break;
      case 'tools':
        req.requiredFeatures = ['toolCalling'];
        req.minCapabilities = { code: 0.6 };
        // Phase 2: 优先选 native 模型，避免 prompt 膨胀导致 400
        if (this.pool?.hasModelWithCapability('toolCallingMode', 'native')) {
          req.executionPath = 'native_tools';
        } else {
          req.executionPath = 'prompt_tools';
        }
        break;
      case 'chat':
        break;
      case 'domain':
        req.minCapabilities = { reasoning: 0.6 };
        break;
      case 'background':
        break;
      case 'image-gen':
        req.preferredCategories = ['image-gen'];
        break;
      case 'image-edit':
        req.preferredCategories = ['image-edit'];
        break;
      case 'video-gen':
        req.preferredCategories = ['video-gen'];
        break;
      case 'tts':
        req.preferredCategories = ['tts'];
        break;
      case 'asr':
        req.preferredCategories = ['asr'];
        break;
      case 'embedding':
        req.preferredCategories = ['embedding'];
        break;
      case 'ocr':
        req.preferredCategories = ['ocr', 'vl-chat'];
        break;
      case 'translation':
        req.preferredCategories = ['translation'];
        break;
    }

    if (complexity === 'complex') {
      req.minCapabilities.reasoning = Math.max(req.minCapabilities.reasoning ?? 0, 0.7);
    }

    // 成本感知：简单任务限制成本，避免用贵模型做简单事
    if (taskType === 'chat' && complexity === 'simple') {
      req.maxCostPer1k = 2.0; // 简单对话限制低成本模型
    } else if (taskType === 'tools' && complexity === 'medium') {
      req.maxCostPer1k = 5.0; // 工具调用限制中等成本
    }
    // reasoning/complex 不设限，允许使用最贵的推理模型

    // 小脑状态调节（Phase 2: 池感知版本 — 先查再调）
    if (this.pool?.isInitialized) {
      if (typeof this.pool.queryCapableModels === 'function') {
        const capable = this.pool.queryCapableModels(taskType);

        if (body && capable.length > 0) {
          const avgCost = capable.reduce((s, m) => s + m.costPer1kInput, 0) / capable.length;
          const avgLatency = capable.reduce((s, m) => s + m.avgLatencyMs, 0) / capable.length;
          const reliableCount = capable.filter((m) => m.taskSuccessRate >= 0.8).length;

          // 高负载 → 优先选便宜快速的，而非盲目清空约束
          if (body.load > 80) {
            req.maxCostPer1k = avgCost * 0.5; // 限制成本在均值一半以下
            req.minCapabilities = {}; // 放宽能力约束
            req.requiredFeatures = [];
            console.log(`[ModelRouter] BodyState: load=${body.load}, 池内${capable.length}模型, 限成本≤${req.maxCostPer1k.toFixed(4)}`);
          }
          // 低精力 → 放宽约束，但保留基本能力要求
          if (body.energy < 30) {
            // 只在有可靠模型时才保留约束，否则全部放宽
            if (reliableCount >= 2) {
              // 保留一半的能力约束
              for (const key of Object.keys(req.minCapabilities)) {
                req.minCapabilities[key as keyof typeof req.minCapabilities] =
                  Math.max(0, (req.minCapabilities[key as keyof typeof req.minCapabilities] ?? 0) * 0.5);
              }
            } else {
              req.minCapabilities = {};
            }
            console.log(`[ModelRouter] BodyState: energy=${body.energy}, 可靠模型${reliableCount}个`);
          }
        }

        // 池感知 — 无可用模型时降级
        if (capable.length === 0) {
          req.minCapabilities = {};
          req.requiredFeatures = [];
          console.warn(`[ModelRouter] 任务 ${taskType} 无可用模型，放宽所有约束`);
        } else if (capable.length <= 2) {
          // 可选模型很少 → 略微放宽能力约束
          for (const key of Object.keys(req.minCapabilities)) {
            req.minCapabilities[key as keyof typeof req.minCapabilities] =
              Math.max(0, (req.minCapabilities[key as keyof typeof req.minCapabilities] ?? 0) - 0.1);
          }
        }
      }
    }

    const chineseChars = (content.match(/[\u4e00-\u9fff]/g) ?? []).length;
    const totalChars = content.length;
    if (totalChars > 0 && chineseChars / totalChars > 0.3) {
      req.languagePreference = 'chinese';
      req.minCapabilities.chinese = 0.6;
    }

    return req;
  }

  // ==================== 状态查询 ====================

  getSummary(): {
    localExperts: string[];
    userOverride: string | null;
    hasPool: boolean;
    hasUnifiedPool: boolean;
    hasPoolScheduler: boolean;
    learnedPrefs: Record<string, unknown>;
  } {
    return {
      localExperts: [...this.localExperts.keys()],
      userOverride: this.userOverride,
      hasPool: !!(this.pool && this.pool.isInitialized),
      hasUnifiedPool: !!(this.pool && this.pool.isInitialized),
      hasPoolScheduler: false, // Phase 2: 已合并到 ModelPool，不再需要独立 scheduler
      learnedPrefs: {}, // Thompson Sampling 参数由 ModelPool 统一管理
    };
  }

  // ==================== 持久化（仅 outcomes） ====================

  private save(): void {
    if (!this.dataFile) return;
    try {
      const data = { outcomes: this.outcomes.slice(-100), savedAt: Date.now() };
      fs.mkdirSync(path.dirname(this.dataFile), { recursive: true });
      fs.writeFileSync(this.dataFile, JSON.stringify(data, null, 2));
    } catch (e) { console.debug('[model-router] persist fail', e); }
  }

  private load(): void {
    if (!this.dataFile) return;
    try {
      if (!fs.existsSync(this.dataFile)) return;
      const raw = JSON.parse(fs.readFileSync(this.dataFile, 'utf-8'));
      if (raw.outcomes) {
        this.outcomes = raw.outcomes;
      }
    } catch (e) { console.debug('[model-router] load fail', e); }
  }
}
