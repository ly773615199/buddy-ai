/**
 * ModelPool — 统一模型池（数据面）
 *
 * 职责：
 * 1. 节点管理（注册/查询/熔断/EWMA 统计）— 旧 ModelPool 职责
 * 2. 模型画像存储（ModelProfile）— 从 ModelPoolUnified 合并
 * 3. 三级漏斗选择（静态裁剪 → 元数据快筛 → Thompson Sampling）— 从 ModelPoolUnified 合并
 * 4. 用户控制（黑名单/偏好/成本上限）— 从 ModelPoolUnified 合并
 * 5. 自动发现（ModelDiscovery）— 从 ModelPoolUnified 合并
 * 6. 反馈记录（Thompson Sampling 参数更新）— 从 ModelPoolUnified 合并
 *
 * 不做调度决策 — 那是 ModelRouter / UnifiedScheduler 的事
 */

import type { PoolNode, PoolNodeConfig, PoolNodeStats, ModelPoolConfig, NodeCapabilities } from '../types.js';
import type { DecisionRecorder } from './decision-recorder.js';
import type { TaskType } from './model-router.js';
import type { ModelCategory } from './model-enrichment.js';
import { lookupModelKnowledge, inferTier, inferCapabilities, type CapabilityKey } from './model-knowledge.js';
import {
  discoverModels, discoverAll, clearPlatformCache,
  type PlatformConfig, type DiscoveryResult,
} from './model-discovery.js';
import { ModelKnowledgeUpdater, type UpdaterConfig } from './model-knowledge-updater.js';
import * as fs from 'fs';
import * as path from 'path';

// ==================== 默认能力 ====================

const DEFAULT_CAPABILITIES: NodeCapabilities = {
  toolCalling: false,
  toolCallingMode: 'none',
  vision: false,
  streaming: true,
  structuredOutput: false,
  maxContextTokens: 4096,
  maxOutputTokens: 2048,
  preferredToolFormat: 'openai',
  parallelToolCalls: false,
};

// ==================== 去重辅助 ====================

/** 规范化模型名（去掉 Pro/Lora/Instruct 等后缀，用于去重分组） */
function normalizeBaseName(name: string): string {
  return name
    .replace(/[-_\s]?(Pro|Plus|Lora|Instruct|Chat|it|GGUF|AWQ|GPTQ|FP8|INT4|INT8)$/i, '')
    .replace(/[-_\s]?(v\d+(\.\d+)*)$/i, '')
    .trim()
    .toLowerCase();
}

/** 模型择优比较：有定价 > 无定价 → cost 低 > cost 高 → params 大 > params 小 */
function compareModelPriority(a: ModelProfile, b: ModelProfile): number {
  const aHasPricing = (a.costPer1kInput ?? 0) > 0 ? 1 : 0;
  const bHasPricing = (b.costPer1kInput ?? 0) > 0 ? 1 : 0;
  if (aHasPricing !== bHasPricing) return bHasPricing - aHasPricing;

  if (aHasPricing && bHasPricing) {
    if (a.costPer1kInput !== b.costPer1kInput) return a.costPer1kInput - b.costPer1kInput;
  }

  const aParams = a.parameters ?? 0;
  const bParams = b.parameters ?? 0;
  return bParams - aParams;
}

// ==================== EWMA 统计 ====================

function ewmaUpdate(current: number, newValue: number, alpha: number): number {
  return alpha * newValue + (1 - alpha) * current;
}

// ==================== 模型能力画像 ====================

export interface ModelProfile {
  id: string;                     // 'siliconflow/Qwen2.5-72B-Instruct'
  platform: string;               // 'siliconflow'
  displayName: string;            // 'Qwen2.5-72B'
  tier: 'premium' | 'standard' | 'budget' | 'free';

  capabilities: {
    reasoning: number;
    code: number;
    chinese: number;
    english: number;
    math: number;
    creative: number;
    toolCalling: boolean;
    /** 工具调用模式：native=原生函数调用，prompt=prompt 模拟，none=不支持 */
    toolCallingMode: 'native' | 'prompt' | 'none';
    vision: boolean;
    streaming: boolean;
  };

  maxContextTokens: number;
  maxOutputTokens: number;
  costPer1kInput: number;
  costPer1kOutput: number;

  stats: {
    totalCalls: number;
    successes: number;
    avgLatencyMs: number;
    byTaskType: Record<string, { attempts: number; successes: number; avgQuality?: number }>;
  };

  source: 'platform_api' | 'static_knowledge' | 'user_added';
  discoveredAt: number;

  // ── 模型可用性状态机（§2.7 ModelAccessVerifier） ──
  /** 访问状态：unknown → available / denied / broken */
  accessStatus?: import('./model-access-verifier.js').ModelAccessStatus;
  /** 连续失败次数 */
  failureStreak?: number;
  /** 最后一次成功时间 */
  lastSuccessAt?: number;
  /** 最后一次失败时间 */
  lastFailureAt?: number;
  /** 失败类型（仅永久性错误时记录） */
  failureType?: import('./model-access-verifier.js').ModelAccessErrorType;

  // ── HuggingFace 增强字段（可选，向后兼容） ──
  /** 模型分类 */
  category?: import('./model-enrichment.js').ModelCategory;
  /** 是否激活（参与调度）。默认 true，用户可随时 toggle */
  active?: boolean;
  /** 同基座变体数（去重后，被折叠的变体数） */
  variantCount?: number;
  /** 被折叠的变体 ID 列表（用户可展开查看） */
  variantIds?: string[];
  /** 参数量 */
  parameters?: number | null;
  /** 真实上下文长度（来自 HF README，替代硬编码默认值） */
  contextLength?: number | null;
  /** 真实最大输出长度 */
  realMaxOutput?: number | null;
  /** 架构族 (qwen2, deepseek_v3, ...) */
  modelType?: string | null;
  /** 许可证 */
  license?: string | null;
  /** HuggingFace pipeline_tag */
  pipelineTag?: string | null;
  /** HuggingFace repo ID */
  hfId?: string | null;
  /** enrichment 数据来源 */
  enrichmentSource?: 'catalog' | 'hf_api' | 'hf_readme' | 'inferred' | null;

  /** 从 category/pipelineTag/静态知识派生的能力硬约束（选择漏斗用） */
  derived?: {
    /** 能做聊天/对话 */
    chatCapable: boolean;
    /** 能做 function calling */
    toolCapable: boolean;
    /** 能做向量嵌入 */
    embedCapable: boolean;
    /** 能做视觉理解 */
    visionCapable: boolean;
  };
}

// ==================== 用户偏好 ====================

export interface UserPoolPreferences {
  /** 黑名单（硬排除），支持通配符 */
  excluded: string[];
  /** 按任务类型的偏好 */
  taskPreferences: Record<string, {
    prefer: string[];
    avoid: string[];
  }>;
  /** 全局偏好 */
  preferFree: boolean;
  preferLocal: boolean;
  maxCostPer1k: number;
  maxCostPerHour: number;
  /** 调度策略 */
  strategy: 'task_match' | 'cost_optimized' | 'quality_first';
}

const DEFAULT_PREFERENCES: UserPoolPreferences = {
  excluded: [],
  taskPreferences: {},
  preferFree: false,
  preferLocal: false,
  maxCostPer1k: 1.0,
  maxCostPerHour: 5.0,
  strategy: 'task_match',
};

// ==================== 能力需求（控制面输出） ====================

export interface ModelRequirement {
  /** 任务类型 */
  taskType: TaskType;
  /** 最低能力要求 */
  minCapabilities: Partial<Record<CapabilityKey, number>>;
  /** 必须支持的能力 */
  requiredFeatures: Array<'toolCalling' | 'vision' | 'streaming'>;
  /** 成本约束 */
  maxCostPer1k?: number;
  /** 上下文长度需求 */
  minContextTokens?: number;
  /** 语言偏好 */
  languagePreference?: 'chinese' | 'english' | 'any';
  /** 复杂度 */
  complexity: 'simple' | 'medium' | 'complex';
  /** 执行路径：native_tools=原生函数调用，prompt_tools=prompt 模拟，any=不限 */
  executionPath?: 'native_tools' | 'prompt_tools' | 'any';
  /** 优先匹配的模型类别（多模态路由核心） */
  preferredCategories?: ModelCategory[];
  /** 排除的模型类别 */
  excludedCategories?: ModelCategory[];
}

// ==================== 选择结果 ====================

export interface ModelSelection {
  profile: ModelProfile;
  /** 选择原因 */
  reason: string;
  /** 经过的漏斗层 */
  layer: 0 | 1 | 2;
  /** 候选数量 */
  candidateCount: number;
  /** Thompson Sampling 采样值（Layer 2） */
  tsSample?: number;
}

// ==================== Thompson Sampling 参数 ====================

export interface ThompsonParams {
  alpha: number;   // 加权成功次数 + 1
  beta: number;    // 加权失败次数 + 1
  totalCalls: number;   // 总调用次数
  avgQuality: number;   // 平均质量分（滑动窗口）
  lastUsed: number;     // 最后使用时间
}

// ==================== 任务类型 → 能力需求映射 ====================

const TASK_CAPABILITY_MAP: Record<TaskType, Partial<Record<CapabilityKey, number>>> = {
  chat: { chinese: 0.5, creative: 0.5 },
  tools: { code: 0.6, toolCalling: 0.5 },
  reasoning: { reasoning: 0.7, math: 0.5 },
  background: {},
  domain: { reasoning: 0.6 },
  'image-gen': {},
  'image-edit': {},
  'video-gen': {},
  tts: {},
  asr: {},
  embedding: {},
  ocr: {},
  translation: {},
};

// ==================== ModelPool ====================

export class ModelPool {
  // ── 旧 ModelPool：节点管理 ──
  private nodes = new Map<string, PoolNode>();
  private circuitBroken = new Set<string>();
  private readonly CIRCUIT_BREAK_THRESHOLD = 3;
  private readonly CIRCUIT_RECOVERY_MS = 60_000;
  private circuitBrokenAt = new Map<string, number>();
  private readonly statsFile: string;
  private readonly ewmaAlpha = 0.3;

  // ── 新增：统一模型池 ──
  /** 所有模型画像（id → profile） */
  private profiles = new Map<string, ModelProfile>();
  /** Thompson Sampling 参数（按 taskType:modelId 聚合） */
  private tsParams = new Map<string, ThompsonParams>();
  /** 用户偏好 */
  private preferences: UserPoolPreferences;
  /** 持久化目录 */
  private readonly dataDir: string;
  /** 是否已初始化（统一池模式） */
  private unifiedInitialized = false;
  /** 后台知识更新器 */
  private updater: ModelKnowledgeUpdater | null = null;
  /** P2-7: 反馈回调（CrossSessionLearner 接入点） */
  private _feedbackCallback: ((taskType: string, modelId: string, success: boolean, latencyMs: number) => void) | null = null;
  /** O4: 探索参数配置 */
  private explorationConfig = {
    coldStartThreshold: 20,           // 冷启动阈值（决策次数低于此值时使用冷启动探索）
    coldStartExplorationFactor: 2.0,  // 冷启动探索系数
    correctionExplorationBoost: 0.5,  // 每次用户纠正增加的探索系数
    maxExplorationFactor: 3.0,        // 探索系数上限
  };
  /** 用户纠正计数（由外部通过 recordUserCorrection 更新） */
  private userCorrectionCount = 0;

  constructor(
    private config: ModelPoolConfig | null,
    dataDir: string,
    private decisionRecorder?: DecisionRecorder,
  ) {
    this.dataDir = dataDir;
    this.statsFile = path.join(dataDir, 'pool-stats.json');
    this.preferences = { ...DEFAULT_PREFERENCES };

    // 旧池模式：从 config.nodes 初始化
    if (config) {
      this.initNodes();
      this.loadStats();
    }

    // 加载统一池持久化状态
    this.loadUnifiedState();
  }

  /** 是否已初始化（有模型画像） */
  get isInitialized(): boolean {
    return this.profiles.size > 0;
  }

  // ==================== Provider 凭据存储 ====================

  /** Provider 凭据映射（platform → { apiKey, baseUrl }） */
  private providerCredentials = new Map<string, { apiKey?: string; baseUrl?: string }>();

  /** 获取 provider 凭据 — 供 ModelRouter 注入到 ModelConfig */
  getProviderCredentials(platformId: string): { apiKey?: string; baseUrl?: string } | null {
    return this.providerCredentials.get(platformId) ?? null;
  }

  /** 获取所有已配置的 provider ID 列表 */
  getProviderIds(): string[] {
    return [...this.providerCredentials.keys()];
  }

  /** 更新 provider 凭据 — 热重载时调用 */
  updateProviderCredentials(platformId: string, creds: { apiKey?: string; baseUrl?: string }): void {
    this.providerCredentials.set(platformId, creds);
  }

  /**
   * Provider 余额预检（P2-2）
   *
   * 启动时调用，检测各 provider 的账户余额。
   * 支持 SiliconFlow 等提供余额查询 API 的平台。
   * 余额不足时标记 provider 状态，避免后续请求级联失败。
   */
  async checkBalances(): Promise<Map<string, { ok: boolean; balance?: number; error?: string }>> {
    const results = new Map<string, { ok: boolean; balance?: number; error?: string }>();

    for (const [platformId, creds] of this.providerCredentials) {
      if (!creds.apiKey) {
        results.set(platformId, { ok: true }); // 无 key，跳过检测
        continue;
      }

      try {
        const result = await this.queryProviderBalance(platformId, creds.apiKey, creds.baseUrl);
        results.set(platformId, result);

        if (!result.ok) {
          console.warn(`[ModelPool] ⚠️ ${platformId} 余额不足: ${result.balance ?? 'unknown'}`);
          // 标记该平台所有模型为 denied
          this.markPlatformDenied(platformId, 'balance');
        }
      } catch (err) {
        results.set(platformId, { ok: true, error: (err as Error).message }); // 无法检测时假设正常
      }
    }

    return results;
  }

  /**
   * 查询单个 provider 的余额
   * 支持 SiliconFlow API，其他平台可扩展
   */
  private async queryProviderBalance(
    platformId: string,
    apiKey: string,
    baseUrl?: string,
  ): Promise<{ ok: boolean; balance?: number }> {
    // SiliconFlow 余额查询
    if (platformId === 'siliconflow' || (baseUrl ?? '').includes('siliconflow')) {
      const url = `${baseUrl ?? 'https://api.siliconflow.cn'}/v1/user/info`;
      const resp = await fetch(url, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const data = await resp.json() as { data?: { balance?: number | string } };
        const balance = Number(data.data?.balance ?? 0);
        return { ok: balance > 0, balance };
      }
      // 非 200 但不一定是余额问题
      return { ok: true };
    }

    // 通用 OpenAI 兼容平台：尝试 /models 探活
    const testUrl = `${baseUrl ?? 'https://api.openai.com'}/models`;
    const resp = await fetch(testUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    // 401/403 = 认证失败，可能余额耗尽
    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, balance: 0 };
    }
    return { ok: true };
  }

  /**
   * 标记某平台所有模型为 denied（余额不足/认证失败）
   */
  private markPlatformDenied(platformId: string, reason: string): void {
    for (const [id, profile] of this.profiles) {
      if (profile.platform === platformId) {
        profile.accessStatus = 'denied';
        profile.failureType = reason as any;
      }
    }
    console.log(`[ModelPool] ${platformId} 平台 ${reason}，已标记所有模型为 denied`);
  }

  // ====================================================================
  // 旧 ModelPool：节点管理（保留，向后兼容）
  // ====================================================================

  private initNodes(): void {
    if (!this.config) return;
    for (const nodeCfg of this.config.nodes) {
      const node: PoolNode = {
        id: nodeCfg.id,
        type: nodeCfg.type,
        provider: nodeCfg.provider,
        model: nodeCfg.model,
        apiKey: nodeCfg.apiKey,
        baseUrl: nodeCfg.baseUrl,
        domain: nodeCfg.domain,
        tags: nodeCfg.tags,
        tier: nodeCfg.tier,
        warm: false,
        costPer1kInput: nodeCfg.costPer1kInput ?? 0,
        costPer1kOutput: nodeCfg.costPer1kOutput ?? 0,
        stats: {
          totalCalls: 0,
          successRate: 1.0,
          avgLatencyMs: 0,
          consecutiveFailures: 0,
          byTaskType: {},
        },
        capabilities: {
          ...DEFAULT_CAPABILITIES,
          ...this.resolveCapabilities(nodeCfg),
          ...nodeCfg.capabilities,
        },
      };
      this.nodes.set(node.id, node);
    }
  }

  private resolveCapabilities(nodeCfg: PoolNodeConfig): Partial<NodeCapabilities> {
    if (nodeCfg.type === 'local_expert') {
      return {
        toolCalling: false,
        toolCallingMode: 'none',
        vision: false,
        streaming: true,
        maxContextTokens: 4096,
        maxOutputTokens: 2048,
      };
    }

    const provider = nodeCfg.provider?.toLowerCase() ?? '';
    const model = nodeCfg.model?.toLowerCase() ?? '';

    const providerCaps: Record<string, Partial<NodeCapabilities>> = {
      openai: { toolCalling: true, toolCallingMode: 'native', vision: true, streaming: true, structuredOutput: true, maxContextTokens: 128000, maxOutputTokens: 16384, parallelToolCalls: true },
      anthropic: { toolCalling: true, toolCallingMode: 'native', vision: true, streaming: true, structuredOutput: true, maxContextTokens: 200000, maxOutputTokens: 8192, parallelToolCalls: true },
      google: { toolCalling: true, toolCallingMode: 'native', vision: true, streaming: true, structuredOutput: true, maxContextTokens: 1000000, maxOutputTokens: 8192 },
      deepseek: { toolCalling: true, toolCallingMode: 'native', vision: false, streaming: true, maxContextTokens: 64000, maxOutputTokens: 8192, parallelToolCalls: true },
      siliconflow: { toolCalling: true, toolCallingMode: 'prompt', vision: true, streaming: true, maxContextTokens: 32000, maxOutputTokens: 8192, preferredToolFormat: 'qwen_tags' },
      mimo: { toolCalling: true, toolCallingMode: 'native', vision: true, streaming: true, maxContextTokens: 32000, maxOutputTokens: 8192 },
      ollama: { toolCalling: true, toolCallingMode: 'prompt', vision: true, streaming: true, maxContextTokens: 32000, maxOutputTokens: 4096, preferredToolFormat: 'json_block' },
    };

    const base = providerCaps[provider] ?? {};

    if (model.includes('gpt-4o') || model.includes('o1') || model.includes('o3')) {
      base.maxContextTokens = 128000;
      base.structuredOutput = true;
    }
    if (model.includes('claude')) {
      base.maxContextTokens = 200000;
    }
    if (model.includes('deepseek-r1') || model.includes('deepseek-reasoner')) {
      base.maxOutputTokens = 16384;
    }
    if (model.includes('vision') || model.includes('gpt-4o') || model.includes('claude')) {
      base.vision = true;
    }

    // SiliconFlow 模型级覆盖：DeepSeek 和 GLM 支持原生工具调用
    if (provider === 'siliconflow') {
      if (model.includes('deepseek') || model.includes('glm')) {
        base.toolCallingMode = 'native';
        base.preferredToolFormat = 'openai';
      }
    }

    return base;
  }

  // ── 节点查询 ──

  getNode(id: string): PoolNode | undefined {
    return this.nodes.get(id);
  }

  getAvailableNodes(): PoolNode[] {
    const now = Date.now();
    return [...this.nodes.values()].filter(n => {
      if (this.circuitBroken.has(n.id)) {
        const brokenAt = this.circuitBrokenAt.get(n.id) ?? 0;
        if (now - brokenAt > this.CIRCUIT_RECOVERY_MS) {
          this.circuitBroken.delete(n.id);
          this.circuitBrokenAt.delete(n.id);
          n.stats.consecutiveFailures = 0;
          return true;
        }
        return false;
      }
      return true;
    });
  }

  getNodesByTier(tier: PoolNode['tier']): PoolNode[] {
    return this.getAvailableNodes().filter(n => n.tier === tier);
  }

  getNodesByTag(tag: string): PoolNode[] {
    return this.getAvailableNodes().filter(n => n.tags.includes(tag));
  }

  getNodesByType(type: PoolNode['type']): PoolNode[] {
    return this.getAvailableNodes().filter(n => n.type === type);
  }

  getLocalExperts(): PoolNode[] {
    return this.getNodesByType('local_expert');
  }

  getCloudNodes(): PoolNode[] {
    return this.getNodesByType('cloud');
  }

  getAllNodes(): PoolNode[] {
    return [...this.nodes.values()];
  }

  /**
   * Phase 2: 检查是否有满足特定能力的模型
   * 用于路由决策：判断是否有 native tool calling 模型可用
   */
  hasModelWithCapability(cap: 'toolCallingMode', value: string): boolean {
    for (const profile of this.profiles.values()) {
      if (profile.active === false) continue;
      if (profile.capabilities[cap] === value) return true;
    }
    return false;
  }

  // ── 注册 / 动态管理 ──

  registerNode(config: PoolNodeConfig): void {
    if (this.nodes.has(config.id)) return;
    const node: PoolNode = {
      id: config.id,
      type: config.type,
      provider: config.provider,
      model: config.model,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      domain: config.domain,
      tags: config.tags,
      tier: config.tier,
      warm: false,
      costPer1kInput: config.costPer1kInput ?? 0,
      costPer1kOutput: config.costPer1kOutput ?? 0,
      stats: { totalCalls: 0, successRate: 1.0, avgLatencyMs: 0, consecutiveFailures: 0, byTaskType: {} },
      capabilities: {
        ...DEFAULT_CAPABILITIES,
        ...this.resolveCapabilities(config),
        ...config.capabilities,
      },
    };
    this.nodes.set(node.id, node);
  }

  unregisterNode(id: string): void {
    this.nodes.delete(id);
    this.circuitBroken.delete(id);
    this.circuitBrokenAt.delete(id);
  }

  // ── 预热 ──

  async warmup(): Promise<void> {
    const cloudNodes = this.getCloudNodes();
    await Promise.allSettled(
      cloudNodes.map(async (node) => {
        try {
          if (node.provider && node.model) {
            const { ProviderFactory } = await import('./provider-registry.js');
            const creds = this.providerCredentials.get(node.provider);
            await ProviderFactory.create({ provider: node.provider, model: node.model, apiKey: node.apiKey ?? creds?.apiKey, baseUrl: node.baseUrl ?? creds?.baseUrl });
            node.warm = true;
          }
        } catch {
          node.warm = false;
        }
      }),
    );
    console.log(`[ModelPool] 预热完成: ${cloudNodes.filter(n => n.warm).length}/${cloudNodes.length} 云端节点就绪`);
  }

  // ── 熔断 / 恢复 ──

  recordSuccess(nodeId: string, latencyMs: number, taskType?: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    node.stats.totalCalls++;
    node.stats.consecutiveFailures = 0;
    node.stats.successRate = ewmaUpdate(node.stats.successRate, 1, this.ewmaAlpha);
    node.stats.avgLatencyMs = node.stats.avgLatencyMs === 0
      ? latencyMs
      : ewmaUpdate(node.stats.avgLatencyMs, latencyMs, this.ewmaAlpha);

    if (taskType) {
      if (!node.stats.byTaskType[taskType]) {
        node.stats.byTaskType[taskType] = { attempts: 0, successes: 0, avgLatency: 0 };
      }
      const bucket = node.stats.byTaskType[taskType];
      bucket.attempts++;
      bucket.successes++;
      bucket.avgLatency = bucket.avgLatency === 0
        ? latencyMs
        : ewmaUpdate(bucket.avgLatency, latencyMs, this.ewmaAlpha);
    }

    this.circuitBroken.delete(nodeId);
    this.circuitBrokenAt.delete(nodeId);
  }

  recordFailure(nodeId: string, latencyMs: number, taskType?: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    node.stats.totalCalls++;
    node.stats.consecutiveFailures++;
    node.stats.successRate = ewmaUpdate(node.stats.successRate, 0, this.ewmaAlpha);
    node.stats.avgLatencyMs = node.stats.avgLatencyMs === 0
      ? latencyMs
      : ewmaUpdate(node.stats.avgLatencyMs, latencyMs, this.ewmaAlpha);

    if (taskType) {
      if (!node.stats.byTaskType[taskType]) {
        node.stats.byTaskType[taskType] = { attempts: 0, successes: 0, avgLatency: 0 };
      }
      const bucket = node.stats.byTaskType[taskType];
      bucket.attempts++;
      bucket.avgLatency = bucket.avgLatency === 0
        ? latencyMs
        : ewmaUpdate(bucket.avgLatency, latencyMs, this.ewmaAlpha);
    }

    if (node.stats.consecutiveFailures >= this.CIRCUIT_BREAK_THRESHOLD) {
      this.circuitBroken.add(nodeId);
      this.circuitBrokenAt.set(nodeId, Date.now());
      console.warn(`[ModelPool] 节点 ${nodeId} 熔断（连续 ${node.stats.consecutiveFailures} 次失败）`);
    }
  }

  // ── 级联升级 ──

  selectUpgraded(current: PoolNode): PoolNode | null {
    const tierOrder: PoolNode['tier'][] = ['free', 'budget', 'standard', 'premium'];
    const currentIdx = tierOrder.indexOf(current.tier);
    const candidates = this.getAvailableNodes()
      .filter(n => n.id !== current.id && tierOrder.indexOf(n.tier) > currentIdx)
      .sort((a, b) => tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier));
    return candidates[0] ?? null;
  }

  // ── 统计查询 ──

  getStats(nodeId: string): PoolNodeStats | null {
    return this.nodes.get(nodeId)?.stats ?? null;
  }

  getTaskTypeStats(nodeId: string, taskType: string): { attempts: number; successes: number; avgLatency: number } | null {
    const node = this.nodes.get(nodeId);
    return node?.stats.byTaskType[taskType] ?? null;
  }

  getHistoricalStats(nodeId: string, taskType?: string): { attempts: number; successRate: number; avgLatency: number } | null {
    if (!this.decisionRecorder) return null;
    const stats = this.decisionRecorder.getNodeStats(nodeId, taskType);
    if (stats.attempts === 0) return null;
    return stats;
  }

  // ── 持久化（旧池） ──

  saveStats(): void {
    try {
      const data: Record<string, PoolNodeStats> = {};
      for (const [id, node] of this.nodes) {
        data[id] = node.stats;
      }
      fs.mkdirSync(path.dirname(this.statsFile), { recursive: true });
      fs.writeFileSync(this.statsFile, JSON.stringify(data, null, 2));
    } catch (e) { console.debug('[model-pool] stats 持久化失败', e); }
  }

  private loadStats(): void {
    try {
      if (!fs.existsSync(this.statsFile)) return;
      const data = JSON.parse(fs.readFileSync(this.statsFile, 'utf-8'));
      for (const [id, stats] of Object.entries(data as Record<string, PoolNodeStats>)) {
        const node = this.nodes.get(id);
        if (node) {
          node.stats = stats as PoolNodeStats;
        }
      }
    } catch (e) { console.debug('[model-pool] load fail', e); }
  }

  // ── 状态摘要 ──

  getSummary(): {
    total: number;
    available: number;
    circuitBroken: string[];
    byTier: Record<string, number>;
    byType: Record<string, number>;
  } {
    const available = this.getAvailableNodes();
    const byTier: Record<string, number> = {};
    const byType: Record<string, number> = {};
    for (const n of available) {
      byTier[n.tier] = (byTier[n.tier] ?? 0) + 1;
      byType[n.type] = (byType[n.type] ?? 0) + 1;
    }
    return {
      total: this.nodes.size,
      available: available.length,
      circuitBroken: [...this.circuitBroken],
      byTier,
      byType,
    };
  }

  // ====================================================================
  // 新增：统一模型池（从 ModelPoolUnified 合并）
  // ====================================================================

  // ==================== 初始化 ====================

  /**
   * 从 providers 配置初始化统一模型池
   *
   * 启动流程（优化版）：
   * 1. 加载本地缓存（毫秒级，立即可用）
   * 2. 标记已初始化（用户可以开始使用）
   * 3. 后台异步刷新（不阻塞启动）
   * 4. 启动定时更新器
   */
  async initializeFromProviders(providers: PlatformConfig[], updaterConfig?: Partial<UpdaterConfig>): Promise<void> {
    // 0. 存储 provider 凭据（按 id 聚合，供 ModelRouter 注入）
    for (const p of providers) {
      this.providerCredentials.set(p.id, { apiKey: p.apiKey, baseUrl: p.baseUrl });
    }

    // 0.5 余额预检（P2-2）— 异步执行，不阻塞后续初始化
    this.checkBalances().catch(err => {
      console.debug('[ModelPool] 余额预检异常:', (err as Error).message);
    });

    // 1. 加载本地缓存（快速路径）
    const cachedCount = this.loadCachedProfiles();

    if (cachedCount > 0) {
      console.log(`[ModelPool] 从缓存加载 ${cachedCount} 个模型`);
    }

    // 2. 如果有缓存数据，先标记已初始化（用户可立即使用）
    if (this.profiles.size > 0) {
      this.unifiedInitialized = true;
    }

    // 3. 启动后台更新器
    this.updater = new ModelKnowledgeUpdater(this.dataDir, updaterConfig);
    this.updater.setOnRefreshComplete((profiles) => {
      // 刷新完成：合并新数据到画像池
      for (const [id, profile] of profiles) {
        const existing = this.profiles.get(id);
        // 保留运行时统计
        if (existing && existing.stats.totalCalls > 0) {
          profile.stats = existing.stats;
        }
        this.profiles.set(id, profile);
      }
      this.unifiedInitialized = true;
      this.dedupeAndOptimize();
      this.saveUnifiedState();
      const activeCount = [...this.profiles.values()].filter(p => p.active !== false).length;
      console.log(`[ModelPool] 后台刷新完成，当前 ${this.profiles.size} 个模型, 激活 ${activeCount} 个`);

      // 异步补全缺少 enrichment 数据的模型（不阻塞）
      this.enrichMissingProfiles().catch((err) => {
        console.debug('[ModelPool] enrichment 补全失败:', (err as Error).message);
      });
    });

    // 异步启动刷新（不阻塞）
    this.updater.start(providers);

    // 4. 如果没有缓存，等待首次刷新完成
    if (!this.unifiedInitialized) {
      try {
        await this.updater.refresh(providers);
      } catch (err) {
        console.warn('[ModelPool] 首次刷新失败:', (err as Error).message);
      }

      if (this.profiles.size === 0) {
        // 最后手段：直接同步发现
        const results = await discoverAll(providers);
        for (const result of results) {
          for (const profile of result.models) {
            this.profiles.set(profile.id, profile);
          }
        }
      }

      this.unifiedInitialized = true;
      this.dedupeAndOptimize();
      this.saveUnifiedState();
    }

    // 首次加载也做一次去重
    this.dedupeAndOptimize();

    const activeCount = [...this.profiles.values()].filter(p => p.active !== false).length;
    const platforms = new Set([...this.profiles.values()].map(p => p.platform));
    console.log(`[ModelPool] 统一池初始化完成: ${this.profiles.size} 个模型, 激活 ${activeCount} 个, ${platforms.size} 个平台`);
  }

  /**
   * 从本地缓存加载画像
   */
  private loadCachedProfiles(): number {
    try {
      const cacheFile = path.join(this.dataDir, 'model-knowledge-cache.json');
      if (!fs.existsSync(cacheFile)) return 0;

      const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      const profiles = raw.profiles as Record<string, ModelProfile> | undefined;
      if (!profiles) return 0;

      let count = 0;
      for (const [id, profile] of Object.entries(profiles)) {
        if (!this.profiles.has(id)) {
          this.profiles.set(id, profile);
          count++;
        }
      }
      return count;
    } catch {
      return 0;
    }
  }

  /**
   * 获取后台更新器
   */
  getUpdater(): ModelKnowledgeUpdater | null {
    return this.updater;
  }

  /**
   * 从旧 ModelPoolConfig 迁移初始化
   */
  initializeFromLegacyConfig(poolConfig: ModelPoolConfig): void {
    for (const node of poolConfig.nodes) {
      if (node.type === 'cloud' && node.provider && node.model) {
        const id = node.id;
        const knowledge = lookupModelKnowledge(`${node.provider}/${node.model}`);

        this.profiles.set(id, {
          id,
          platform: node.provider,
          displayName: knowledge?.displayName ?? node.model,
          tier: node.tier,
          capabilities: knowledge?.capabilities ?? inferCapabilities(node.model),
          maxContextTokens: 4096,  // 由 API 发现更新
          maxOutputTokens: 2048,   // 由 API 发现更新
          costPer1kInput: node.costPer1kInput ?? 0,
          costPer1kOutput: node.costPer1kOutput ?? 0,
          stats: { totalCalls: 0, successes: 0, avgLatencyMs: 0, byTaskType: {} },
          source: 'user_added',
          discoveredAt: Date.now(),
        });
      }
    }

    this.unifiedInitialized = true;
    this.saveUnifiedState();
  }

  /** 是否已初始化统一池 */
  get isUnifiedInitialized(): boolean {
    return this.unifiedInitialized;
  }

  // ==================== 三级漏斗选择 ====================

  /**
   * 三级漏斗选择（select 别名，Phase 2 统一入口）
   */
  select(requirement: ModelRequirement): ModelSelection | null {
    return this.selectFromUnified(requirement);
  }

  /**
   * 从统一池中选择最优模型
   *
   * 三级漏斗：
   * - Layer 0: 静态裁剪（黑名单 + streaming + 成本硬上限）→ ~40 候选
   * - Layer 1: 元数据快筛（能力 + 任务匹配 + 语言 + 上下文）→ ~10-15 匹配
   * - Layer 2: Thompson Sampling 加权选择 → 1 最优
   */
  selectFromUnified(requirement: ModelRequirement): ModelSelection | null {
    if (this.profiles.size === 0) return null;

    // Layer 0: 静态裁剪（传入 taskType 过滤不兼容的模型）
    let candidates = this.layer0StaticFilter(requirement.taskType);
    if (candidates.length === 0) {
      // 降级：taskType 过滤后无候选 → 不传 taskType 重试
      candidates = this.layer0StaticFilter();
      if (candidates.length === 0) {
        // 最后手段：允许 denied/broken 模型（可能只是临时 404）
        candidates = this.layer0StaticFilter(requirement.taskType, true);
        if (candidates.length === 0) candidates = this.layer0StaticFilter(undefined, true);
        if (candidates.length === 0) return null;
        console.warn(`[ModelPool] 最后手段: 使用 denied/broken 模型 (${candidates.length} 个)`);
      }
    }

    // Layer 1: 元数据快筛
    candidates = this.layer1MetadataFilter(candidates, requirement);
    if (candidates.length === 0) {
      console.log(`[ModelPool] layer1(${requirement.taskType}): 0 候选, 降级到无 taskType`);
      // 降级：放宽约束重试（不传 taskType）
      candidates = this.layer0StaticFilter();
      if (candidates.length === 0) {
        // 最后手段：允许 denied/broken 模型
        candidates = this.layer0StaticFilter(undefined, true);
        if (candidates.length === 0) return null;
        console.warn(`[ModelPool] 最后手段(layer1): 使用 denied/broken 模型 (${candidates.length} 个)`);
      }
    }

    // Layer 2: Thompson Sampling
    return this.layer2ThompsonSelect(candidates, requirement);
  }

  /**
   * Phase 2: 排除指定模型后的选择
   * 用于 Cascade Routing — 失败模型排除后再选
   */
  selectExcluding(requirement: ModelRequirement, excludeIds: string[]): ModelSelection | null {
    if (this.profiles.size === 0) return null;

    let candidates = this.layer0StaticFilter(requirement.taskType);
    candidates = candidates.filter((p) => !excludeIds.includes(p.id));
    if (candidates.length === 0) return null;

    candidates = this.layer1MetadataFilter(candidates, requirement);
    if (candidates.length === 0) return null;

    return this.layer2ThompsonSelect(candidates, requirement);
  }

  // ── Layer 0: 静态裁剪 ──

  private layer0StaticFilter(taskType?: TaskType, allowDenied = false): ModelProfile[] {
    const result: ModelProfile[] = [];
    let filteredByTask = 0;
    for (const profile of this.profiles.values()) {
      if (profile.active === false) continue;
      if (this.isExcluded(profile.id)) continue;
      // §2.7: 过滤已确认不可用的模型（denied/broken），但允许 unknown 和 available
      if (!allowDenied && (profile.accessStatus === 'denied' || profile.accessStatus === 'broken')) continue;
      if (!profile.capabilities.streaming) continue;
      if (profile.costPer1kInput > this.preferences.maxCostPer1k * 2) continue;

      // 按任务类型过滤不兼容的模型（derived 来自 category/pipelineTag/静态知识）
      if (taskType && profile.derived) {
        const needsChat = taskType === 'chat' || taskType === 'tools'
          || taskType === 'reasoning' || taskType === 'domain' || taskType === 'background';
        if (needsChat && !profile.derived.chatCapable) {
          filteredByTask++;
          continue;
        }
        if (taskType === 'embedding' && !profile.derived.embedCapable) {
          filteredByTask++;
          continue;
        }
      }

      result.push(profile);
    }
    if (taskType && filteredByTask > 0) {
      console.log(`[ModelPool] layer0(${taskType}): 过滤 ${filteredByTask} 个不兼容模型, 剩余 ${result.length}`);
    }
    return result;
  }

  // ── Layer 1: 元数据快筛 ──

  private layer1MetadataFilter(candidates: ModelProfile[], req: ModelRequirement): ModelProfile[] {
    return candidates.filter((p) => {
      // 类别匹配（多模态路由核心）
      if (req.preferredCategories?.length) {
        const pCat = p.category ?? 'unknown';
        if (!req.preferredCategories.includes(pCat as ModelCategory)) return false;
      }
      if (req.excludedCategories?.length) {
        const pCat = p.category ?? 'unknown';
        if (req.excludedCategories.includes(pCat as ModelCategory)) return false;
      }

      if (req.minCapabilities.reasoning && (p.capabilities.reasoning ?? 0) < req.minCapabilities.reasoning) return false;
      if (req.minCapabilities.code && (p.capabilities.code ?? 0) < req.minCapabilities.code) return false;
      if (req.minCapabilities.chinese && (p.capabilities.chinese ?? 0) < req.minCapabilities.chinese) return false;
      if (req.minCapabilities.english && (p.capabilities.english ?? 0) < req.minCapabilities.english) return false;
      if (req.minCapabilities.math && (p.capabilities.math ?? 0) < req.minCapabilities.math) return false;

      for (const feat of req.requiredFeatures) {
        if (!p.capabilities[feat]) return false;
      }

      // Phase 2: 执行路径过滤 — toolCallingMode 必须兼容
      if (req.executionPath === 'native_tools') {
        if (p.capabilities.toolCallingMode !== 'native') return false;
      } else if (req.executionPath === 'prompt_tools') {
        if (p.capabilities.toolCallingMode === 'none') return false;
      }

      if (req.minContextTokens && p.maxContextTokens < req.minContextTokens) return false;
      if (req.maxCostPer1k && p.costPer1kInput > req.maxCostPer1k) return false;

      if (req.languagePreference === 'chinese' && p.capabilities.chinese < 0.6) return false;
      if (req.languagePreference === 'english' && p.capabilities.english < 0.6) return false;

      return true;
    });
  }

  // ── Layer 2: Thompson Sampling ──

  private layer2ThompsonSelect(candidates: ModelProfile[], req: ModelRequirement): ModelSelection {
    const scored = candidates.map((p) => {
      const key = `${req.taskType}:${p.id}`;
      const params = this.tsParams.get(key) ?? { alpha: 1, beta: 1, totalCalls: 0, avgQuality: 0.5, lastUsed: 0 };

      let sample = this.betaSample(params.alpha, params.beta);

      // Phase 2: 工具任务优先选 native 模型（避免 prompt 膨胀导致 400）
      if (req.taskType === 'tools' && p.capabilities.toolCallingMode === 'native') {
        sample *= 1.5;
      }

      // O4: 动态探索系数 — 冷启动 + 用户纠正
      const explorationFactor = this.getExplorationFactor(params.totalCalls);

      // 冷启动保护：per-task-type 调用次数越少，探索奖励越大
      if (params.totalCalls < this.explorationConfig.coldStartThreshold) {
        sample *= explorationFactor + (this.explorationConfig.coldStartThreshold - params.totalCalls) * 0.05;
      }

      // 任务亲和度加权（基于 avgQuality 滑动平均）
      if (params.totalCalls >= 5) {
        const quality = params.avgQuality;
        const confidence = Math.min(1, params.totalCalls / 20);
        const affinityFactor = 1.0 - confidence * (1.0 - (0.5 + quality * 0.5));
        sample *= affinityFactor;
      }

      // 策略加权
      if (this.preferences.strategy === 'cost_optimized') {
        const costFactor = p.costPer1kInput > 0
          ? Math.max(0.3, 1 - p.costPer1kInput / this.preferences.maxCostPer1k)
          : 1.0;
        sample *= costFactor;
      } else if (this.preferences.strategy === 'quality_first') {
        const qualityFactor = this.computeQualityScore(p, req);
        sample *= qualityFactor;
      } else {
        // task_match（默认）: 轻度质量加权，避免纯随机导致小模型主导
        const qualityHint = this.computeQualityScore(p, req);
        sample *= (0.7 + 0.3 * qualityHint); // 质量影响 30%，保留探索空间
      }

      // 偏好加权
      const pref = this.preferences.taskPreferences[req.taskType];
      if (pref) {
        if (pref.prefer.some((pat) => this.matchPattern(p.id, pat))) sample *= 1.3;
        if (pref.avoid.some((pat) => this.matchPattern(p.id, pat))) sample *= 0.5;
      }

      // 免费/本地偏好
      if (this.preferences.preferFree && p.tier === 'free') sample *= 1.2;
      if (this.preferences.preferLocal && p.platform === 'ollama') sample *= 1.2;

      return { profile: p, sample };
    });

    scored.sort((a, b) => b.sample - a.sample);
    const best = scored[0];

    return {
      profile: best.profile,
      reason: `Thompson Sampling 选中 (sample=${best.sample.toFixed(3)}, 候选=${candidates.length})`,
      layer: 2,
      candidateCount: candidates.length,
      tsSample: best.sample,
    };
  }

  // ── Beta 分布采样 ──

  private betaSample(alpha: number, beta: number): number {
    if (alpha <= 1 || beta <= 1) return Math.random();

    const mean = alpha / (alpha + beta);
    const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
    const stdDev = Math.sqrt(variance);
    const u1 = Math.random() || 1e-10;
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, Math.min(1, mean + z * stdDev));
  }

  // ── O4: 探索系数计算 ──

  /**
   * 获取动态探索系数
   * 冷启动阶段更激进探索，用户纠正后增加探索
   */
  private getExplorationFactor(taskTypeCallCount: number): number {
    let factor = 1.0;

    // 冷启动阶段: 更激进探索
    if (taskTypeCallCount < this.explorationConfig.coldStartThreshold) {
      factor = this.explorationConfig.coldStartExplorationFactor;
    }

    // 用户纠正后: 增加探索
    factor += this.userCorrectionCount * this.explorationConfig.correctionExplorationBoost;

    return Math.min(factor, this.explorationConfig.maxExplorationFactor);
  }

  /**
   * 记录用户纠正（由 Agent 的 feedback 系统调用）
   * 纠正后自动增加探索系数，促使系统尝试其他模型
   */
  recordUserCorrection(): void {
    this.userCorrectionCount++;
  }

  /**
   * 获取当前探索状态（用于调试/仪表盘）
   */
  getExplorationState(): {
    userCorrectionCount: number;
    coldStartThreshold: number;
    explorationFactor: number;
  } {
    return {
      userCorrectionCount: this.userCorrectionCount,
      coldStartThreshold: this.explorationConfig.coldStartThreshold,
      explorationFactor: 1 + this.userCorrectionCount * this.explorationConfig.correctionExplorationBoost,
    };
  }

  /**
   * 更新探索配置（运行时调优）
   */
  setExplorationConfig(config: Partial<typeof this.explorationConfig>): void {
    Object.assign(this.explorationConfig, config);
  }

  // ── 质量评分 ──

  private computeQualityScore(profile: ModelProfile, req: ModelRequirement): number {
    const caps = profile.capabilities;
    const weights: Record<string, number> = {};

    switch (req.taskType) {
      case 'reasoning':
        weights.reasoning = 0.4; weights.math = 0.3; weights.code = 0.2; weights.chinese = 0.1;
        break;
      case 'tools':
        weights.code = 0.4; weights.reasoning = 0.3; weights.toolCalling = 0.2; weights.chinese = 0.1;
        break;
      case 'chat':
        weights.chinese = 0.3; weights.creative = 0.3; weights.reasoning = 0.2; weights.english = 0.2;
        break;
      case 'domain':
        weights.reasoning = 0.3; weights.code = 0.3; weights.chinese = 0.2; weights.math = 0.2;
        break;
      // 多模态任务：只要匹配类别就满分，无质量评分维度
      case 'image-gen':
      case 'image-edit':
      case 'video-gen':
      case 'tts':
      case 'asr':
      case 'embedding':
      case 'ocr':
      case 'translation':
        return 1.0;
      default:
        weights.reasoning = 0.25; weights.code = 0.25; weights.chinese = 0.25; weights.creative = 0.25;
    }

    let score = 0;
    let totalWeight = 0;
    for (const [key, weight] of Object.entries(weights)) {
      const val = caps[key as keyof typeof caps];
      if (typeof val === 'number') {
        score += val * weight;
        totalWeight += weight;
      }
    }

    return totalWeight > 0 ? score / totalWeight : 0.5;
  }

  // ==================== 反馈更新 ====================

  /**
   * 记录模型调用结果，更新 Thompson Sampling 参数
   */
  /** P2-7: 设置反馈回调（CrossSessionLearner 接入） */
  setFeedbackCallback(cb: (taskType: string, modelId: string, success: boolean, latencyMs: number) => void): void {
    this._feedbackCallback = cb;
  }

  recordFeedback(modelId: string, taskType: TaskType, success: boolean, latencyMs: number, costEstimate: number, qualityScore?: number): void {
    const key = `${taskType}:${modelId}`;
    const params = this.tsParams.get(key) ?? { alpha: 1, beta: 1, totalCalls: 0, avgQuality: 0.5, lastUsed: 0 };

    // 多维加权成功分
    const quality = qualityScore ?? 0.5;
    let weightedSuccess = 0;
    if (success) {
      // 质量加权的成功：质量越高，alpha 增量越大
      weightedSuccess = 0.5 + quality * 0.5;  // 范围 0.5 ~ 1.0
      if (latencyMs > 5000) weightedSuccess *= 0.7;
      else if (latencyMs > 2000) weightedSuccess *= 0.85;
      if (costEstimate > 0.1) weightedSuccess *= 0.8;
    } else {
      // 失败但质量高（可能是工具问题而非模型问题）→ 减少惩罚
      weightedSuccess = 0.3 * quality;  // 范围 0 ~ 0.3
    }

    params.alpha += weightedSuccess;
    params.beta += (1 - weightedSuccess);
    params.totalCalls++;
    params.avgQuality = params.avgQuality * 0.9 + quality * 0.1;  // 滑动平均
    params.lastUsed = Date.now();
    this.tsParams.set(key, params);

    // 更新画像统计
    const profile = this.profiles.get(modelId);
    if (profile) {
      profile.stats.totalCalls++;
      if (success) profile.stats.successes++;
      // EWMA 延迟
      const alpha = 0.3;
      profile.stats.avgLatencyMs = profile.stats.avgLatencyMs === 0
        ? latencyMs
        : alpha * latencyMs + (1 - alpha) * profile.stats.avgLatencyMs;

      if (!profile.stats.byTaskType[taskType]) {
        profile.stats.byTaskType[taskType] = { attempts: 0, successes: 0, avgQuality: 0 };
      }
      const taskStats = profile.stats.byTaskType[taskType];
      taskStats.attempts++;
      if (success) taskStats.successes++;
      // EWMA 质量分数（0-1）
      if (qualityScore !== undefined) {
        const current = taskStats.avgQuality ?? 0;
        taskStats.avgQuality = current === 0
          ? qualityScore
          : alpha * qualityScore + (1 - alpha) * current;
      }
    }

    // P2-7: 通知 CrossSessionLearner
    this._feedbackCallback?.(taskType, modelId, success, latencyMs);

    this.saveUnifiedState();
  }

  // ==================== §2.7 模型访问状态管理 ====================

  /**
   * 记录模型访问成功 — 状态恢复为 available
   *
   * 每次 LLM 调用成功时由 LLMAdapter 调用，
   * 之前 denied 的模型也可能恢复（如充值后）。
   */
  recordAccessSuccess(modelId: string): void {
    const profile = this.profiles.get(modelId);
    if (!profile) return;

    const wasDenied = profile.accessStatus === 'denied' || profile.accessStatus === 'broken';
    profile.accessStatus = 'available';
    profile.lastSuccessAt = Date.now();
    profile.failureStreak = 0;

    if (wasDenied) {
      console.log(`[ModelPool] 模型 ${modelId} 状态恢复: denied/broken → available`);
    }

    this.saveUnifiedState();
  }

  /**
   * 记录模型访问失败 — 根据错误类型更新状态
   *
   * - 永久性错误 (auth/payment/permission/not_found) → denied
   * - 临时性错误 (rate_limited/network/timeout) → 连续 3 次后标记 broken
   */
  recordAccessFailure(modelId: string, errorType: import('./model-access-verifier.js').ModelAccessErrorType): void {
    const profile = this.profiles.get(modelId);
    if (!profile) return;

    profile.lastFailureAt = Date.now();
    profile.failureStreak = (profile.failureStreak ?? 0) + 1;
    profile.failureType = errorType;

    const PERMANENT_ERRORS = new Set(['auth', 'payment', 'permission', 'not_found']);
    const TEMPORARY_ERRORS = new Set(['rate_limited', 'network', 'timeout']);

    if (PERMANENT_ERRORS.has(errorType)) {
      // 永久性问题 → 立即标记 denied
      profile.accessStatus = 'denied';
      console.warn(`[ModelPool] 模型 ${modelId} 标记 denied: ${errorType} (${profile.failureStreak} 次连续失败)`);
    } else if (TEMPORARY_ERRORS.has(errorType)) {
      // 临时故障 → 连续 3 次后标记 broken
      if (profile.failureStreak >= 3) {
        profile.accessStatus = 'broken';
        console.warn(`[ModelPool] 模型 ${modelId} 标记 broken: 连续 ${profile.failureStreak} 次 ${errorType}`);
      } else if (!profile.accessStatus || profile.accessStatus === 'unknown') {
        // 首次临时失败不改变状态，等积累到 3 次
      }
    }

    this.saveUnifiedState();
  }

  /**
   * 获取模型访问状态
   */
  getModelAccessStatus(modelId: string): import('./model-access-verifier.js').ModelAccessStatus {
    return this.profiles.get(modelId)?.accessStatus ?? 'unknown';
  }

  /**
   * 手动设置模型访问状态（供预验证结果写入）
   */
  setModelAccessStatus(modelId: string, status: import('./model-access-verifier.js').ModelAccessStatus): void {
    const profile = this.profiles.get(modelId);
    if (profile) {
      profile.accessStatus = status;
      this.saveUnifiedState();
    }
  }

  /**
   * 尝试恢复 denied 模型 — 每小时/每天重试一次
   * 返回需要重试的模型列表
   */
  getModelsForRetry(): ModelProfile[] {
    const now = Date.now();
    const RETRY_INTERVAL_MS = 60 * 60 * 1000; // 1 小时
    const result: ModelProfile[] = [];

    for (const profile of this.profiles.values()) {
      if (profile.accessStatus !== 'denied') continue;
      // auth 错误不自动重试（需要用户更新 Key）
      if (profile.failureType === 'auth') continue;
      // 距上次失败超过 1 小时 → 允许重试
      if (profile.lastFailureAt && now - profile.lastFailureAt > RETRY_INTERVAL_MS) {
        profile.accessStatus = 'unknown'; // 重置为 unknown，允许再次尝试
        result.push(profile);
      }
    }

    if (result.length > 0) {
      this.saveUnifiedState();
    }

    return result;
  }

  /**
   * 批量更新模型访问状态（供预验证结果批量写入）
   */
  batchUpdateAccessStatus(updates: Array<{ modelId: string; status: import('./model-access-verifier.js').ModelAccessStatus }>): void {
    for (const { modelId, status } of updates) {
      const profile = this.profiles.get(modelId);
      if (profile) {
        profile.accessStatus = status;
      }
    }
    this.saveUnifiedState();
  }

  /**
   * 获取端点级错误统计 — 连续多个模型 payment 失败 → 升级为端点级余额不足
   */
  getEndpointPaymentFailureCount(platform: string): number {
    let count = 0;
    for (const profile of this.profiles.values()) {
      if (profile.platform === platform &&
          profile.accessStatus === 'denied' &&
          profile.failureType === 'payment') {
        count++;
      }
    }
    return count;
  }

  // ==================== Thompson 参数外部读写（CrossSession 恢复用） ====================

  /** 获取指定 key 的 Thompson 参数（供 CrossSession 恢复用） */
  getThompsonParamByKey(key: string): ThompsonParams | null {
    return this.tsParams.get(key) ?? null;
  }

  /** 设置指定 key 的 Thompson 参数（供 CrossSession 恢复用） */
  setThompsonParamByKey(key: string, params: ThompsonParams): void {
    this.tsParams.set(key, params);
  }

  /** 导出所有 Thompson 参数（供 CrossSession 合并用） */
  exportThompsonParams(): Record<string, ThompsonParams> {
    const result: Record<string, ThompsonParams> = {};
    for (const [key, params] of this.tsParams) {
      result[key] = params;
    }
    return result;
  }

  // ==================== 用户控制 ====================

  addExclusion(pattern: string): void {
    if (!this.preferences.excluded.includes(pattern)) {
      this.preferences.excluded.push(pattern);
      this.saveUnifiedState();
    }
  }

  removeExclusion(pattern: string): void {
    this.preferences.excluded = this.preferences.excluded.filter((p) => p !== pattern);
    this.saveUnifiedState();
  }

  setTaskPreference(taskType: string, prefer: string[], avoid: string[]): void {
    this.preferences.taskPreferences[taskType] = { prefer, avoid };
    this.saveUnifiedState();
  }

  updatePreferences(updates: Partial<UserPoolPreferences>): void {
    Object.assign(this.preferences, updates);
    this.saveUnifiedState();
  }

  getPreferences(): UserPoolPreferences {
    return { ...this.preferences };
  }

  // ==================== 画像查询 ====================

  getAllProfiles(): ModelProfile[] {
    return [...this.profiles.values()];
  }

  getProfile(id: string): ModelProfile | null {
    return this.profiles.get(id) ?? null;
  }

  getProfilesByPlatform(platform: string): ModelProfile[] {
    return [...this.profiles.values()].filter((p) => p.platform === platform);
  }

  getProfilesByTier(tier: ModelProfile['tier']): ModelProfile[] {
    return [...this.profiles.values()].filter((p) => p.tier === tier);
  }

  getThompsonParams(): Record<string, ThompsonParams> {
    const result: Record<string, ThompsonParams> = {};
    for (const [key, params] of this.tsParams) {
      result[key] = { ...params };
    }
    return result;
  }

  // ==================== 决策信息查询（阶段 2） ====================

  /**
   * 查询指定任务类型的可用模型列表 + 能力摘要
   * 三脑决策前调用，了解"pool 里谁能做这件事"
   */
  queryCapableModels(taskType: TaskType): Array<{
    id: string;
    displayName: string;
    tier: string;
    category: string;
    chatCapable: boolean;
    toolCapable: boolean;
    costPer1kInput: number;
    avgLatencyMs: number;
    successRate: number;
    taskSuccessRate: number;
  }> {
    const candidates = this.layer0StaticFilter(taskType);
    return candidates.map((p) => {
      const taskStats = p.stats.byTaskType[taskType];
      return {
        id: p.id,
        displayName: p.displayName,
        tier: p.tier,
        category: p.category ?? 'unknown',
        chatCapable: p.derived?.chatCapable ?? true,
        toolCapable: p.derived?.toolCapable ?? false,
        costPer1kInput: p.costPer1kInput,
        avgLatencyMs: p.stats.avgLatencyMs,
        successRate: p.stats.totalCalls > 0 ? p.stats.successes / p.stats.totalCalls : 1,
        taskSuccessRate: taskStats ? taskStats.successes / Math.max(1, taskStats.attempts) : 1,
        taskQuality: taskStats?.avgQuality ?? 0,
      };
    });
  }

  /**
   * 获取模型对特定任务的历史表现（EWMA 质量分数）
   * 用于 Thompson Sampling 加权
   */
  getModelAffinity(modelId: string, taskType: TaskType): {
    taskSuccessRate: number;
    avgLatencyMs: number;
    totalCalls: number;
    confidence: number;
  } {
    const profile = this.profiles.get(modelId);
    if (!profile) return { taskSuccessRate: 0, avgLatencyMs: 0, totalCalls: 0, confidence: 0 };

    const taskStats = profile.stats.byTaskType[taskType];
    const totalCalls = taskStats?.attempts ?? 0;
    const successes = taskStats?.successes ?? 0;

    return {
      taskSuccessRate: totalCalls > 0 ? successes / totalCalls : 1,
      avgLatencyMs: profile.stats.avgLatencyMs,
      totalCalls,
      confidence: Math.min(1, totalCalls / 10), // 10 次以上调用 = 高置信度
    };
  }

  /**
   * 按任务类型返回模型池摘要
   * 三脑做 BodyState 调整时参考
   */
  getPoolSummary(taskType: TaskType): {
    capableCount: number;
    cheapestModel: string | null;
    fastestModel: string | null;
    mostReliable: string | null;
    avgCost: number;
    avgLatency: number;
  } {
    const capable = this.queryCapableModels(taskType);
    if (capable.length === 0) {
      return { capableCount: 0, cheapestModel: null, fastestModel: null, mostReliable: null, avgCost: 0, avgLatency: 0 };
    }

    const cheapest = capable.reduce((a, b) => a.costPer1kInput < b.costPer1kInput ? a : b);
    const fastest = capable.reduce((a, b) => a.avgLatencyMs < b.avgLatencyMs ? a : b);
    const reliable = capable.reduce((a, b) => a.taskSuccessRate > b.taskSuccessRate ? a : b);

    return {
      capableCount: capable.length,
      cheapestModel: cheapest.id,
      fastestModel: fastest.id,
      mostReliable: reliable.id,
      avgCost: capable.reduce((s, m) => s + m.costPer1kInput, 0) / capable.length,
      avgLatency: capable.reduce((s, m) => s + m.avgLatencyMs, 0) / capable.length,
    };
  }

  get profileCount(): number {
    return this.profiles.size;
  }

  // ==================== 画像管理 ====================

  addProfile(profile: ModelProfile): void {
    this.profiles.set(profile.id, profile);
    this.saveUnifiedState();
  }

  removeProfile(id: string): void {
    this.profiles.delete(id);
    // 同步清理 Thompson Sampling 参数
    for (const key of this.tsParams.keys()) {
      if (key.endsWith(`:${id}`) || key === id) {
        this.tsParams.delete(key);
      }
    }
    this.saveUnifiedState();
  }

  /** 清理指定平台的 Thompson Sampling 参数 */
  removeThompsonByPlatform(platform: string): number {
    let removed = 0;
    for (const key of [...this.tsParams.keys()]) {
      // key 格式: taskType:modelId 或 modelId
      const modelId = key.includes(':') ? key.split(':').slice(1).join(':') : key;
      if (modelId.startsWith(platform + '/')) {
        this.tsParams.delete(key);
        removed++;
      }
    }
    if (removed > 0) this.saveUnifiedState();
    return removed;
  }

  /** 切换模型激活状态，返回新状态 */
  toggleActive(id: string): boolean {
    const profile = this.profiles.get(id);
    if (!profile) return false;
    profile.active = profile.active === false ? true : false;
    this.saveUnifiedState();
    return profile.active;
  }

  /** 设置模型激活状态，返回新状态 */
  setActive(id: string, active: boolean): boolean {
    const profile = this.profiles.get(id);
    if (!profile) return false;
    profile.active = active;
    this.saveUnifiedState();
    return true;
  }

  /** 按平台批量设置激活状态 */
  setActiveByPlatform(platform: string, active: boolean): number {
    let changed = 0;
    for (const profile of this.profiles.values()) {
      if (profile.platform === platform) {
        profile.active = active;
        changed++;
      }
    }
    if (changed > 0) this.saveUnifiedState();
    return changed;
  }

  /** 全部激活 */
  setAllActive(): number {
    let changed = 0;
    for (const profile of this.profiles.values()) {
      if (profile.active === false) {
        profile.active = true;
        changed++;
      }
    }
    if (changed > 0) this.saveUnifiedState();
    return changed;
  }

  /**
   * 去重优化：同名同类型模型只保留择优的一个（active），其余折叠为待激活
   */
  dedupeAndOptimize(): void {
    const all = [...this.profiles.values()];
    const groups = new Map<string, ModelProfile[]>();

    for (const p of all) {
      const key = `${normalizeBaseName(p.displayName)}:${p.category ?? 'unknown'}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }

    for (const [, variants] of groups) {
      if (variants.length <= 1) continue;

      // 择优：有定价 > 无定价 → cost 低 > cost 高 → params 大 > params 小
      variants.sort((a, b) => compareModelPriority(a, b));
      const winner = variants[0];

      winner.active = true;
      winner.variantCount = variants.length;
      winner.variantIds = variants.slice(1).map(v => v.id);

      for (let i = 1; i < variants.length; i++) {
        variants[i].active = false;
      }
    }

    this.saveUnifiedState();
  }

  async refreshPlatform(config: PlatformConfig): Promise<DiscoveryResult> {
    // 优先使用 updater（它会自动持久化）
    if (this.updater) {
      const result = await this.updater.refreshPlatform(config);
      for (const profile of result.models) {
        this.profiles.set(profile.id, profile);
      }
      this.dedupeAndOptimize();
      this.saveUnifiedState();
      return result;
    }

    // fallback: 直接发现
    clearPlatformCache(config.id);
    const result = await discoverModels(config);
    for (const profile of result.models) {
      this.profiles.set(profile.id, profile);
    }
    this.dedupeAndOptimize();
    this.saveUnifiedState();
    return result;
  }

  /** 关闭统一池（停止后台更新器） */
  shutdown(): void {
    if (this.updater) {
      this.updater.stop();
      this.updater = null;
    }
  }

  /**
   * 异步补全缺少 enrichment 数据的模型画像
   *
   * 后台运行，不阻塞主流程。对没有 category/pipelineTag 的模型
   * 尝试从 HuggingFace 补全元数据，并重新派生 derived 能力。
   */
  async enrichMissingProfiles(): Promise<number> {
    const { getModelEnricher } = await import('./model-enrichment.js');
    const enricher = getModelEnricher(this.dataDir);

    const needEnrich: ModelProfile[] = [];
    for (const profile of this.profiles.values()) {
      // 跳过已有 enrichment 数据的模型
      if (profile.category && profile.pipelineTag) continue;
      // 跳过非平台 API 来源的
      if (profile.source !== 'platform_api') continue;
      needEnrich.push(profile);
    }

    if (needEnrich.length === 0) return 0;

    console.log(`[ModelPool] 异步补全 ${needEnrich.length} 个模型的 enrichment 数据...`);

    let updated = 0;
    const CONCURRENCY = 3;
    const DELAY_MS = 500;

    for (let i = 0; i < needEnrich.length; i += CONCURRENCY) {
      const batch = needEnrich.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (profile) => {
          // 从 profile.id 中提取原始模型 ID（去掉 platform 前缀）
          const rawId = profile.id.includes('/') ? profile.id.split('/').slice(1).join('/') : profile.id;
          const enrichment = await enricher.enrichOne(rawId);
          return { profile, enrichment };
        }),
      );

      for (const r of results) {
        if (r.status !== 'fulfilled' || !r.value) continue;
        const { profile, enrichment } = r.value;

        // 只在有有效 enrichment 数据时更新
        if (enrichment.category && enrichment.category !== 'unknown') {
          profile.category = enrichment.category;
          profile.pipelineTag = enrichment.pipelineTag;
          profile.parameters = enrichment.parameters ?? profile.parameters;
          profile.contextLength = enrichment.contextLength ?? profile.contextLength;
          profile.realMaxOutput = enrichment.maxOutput ?? profile.realMaxOutput;
          profile.modelType = enrichment.modelType ?? profile.modelType;
          profile.license = enrichment.license ?? profile.license;
          profile.hfId = enrichment.hfId ?? profile.hfId;
          profile.enrichmentSource = enrichment.source;

          // 重新派生 derived 能力（用新 enrichment 数据）
          profile.derived = this.deriveCapabilitiesFromProfile(profile);
          updated++;
        }
      }

      if (i + CONCURRENCY < needEnrich.length) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    }

    if (updated > 0) {
      this.saveUnifiedState();
      console.log(`[ModelPool] enrichment 补全完成: ${updated}/${needEnrich.length} 个模型已更新`);
    }

    return updated;
  }

  /**
   * 从 ModelProfile 派生能力硬约束（供异步补全使用）
   * 逻辑与 model-discovery.ts 的 deriveCapabilities 一致
   */
  private deriveCapabilitiesFromProfile(profile: ModelProfile): ModelProfile['derived'] {
    // 复用 model-discovery 的逻辑：构造临时 profile 调用
    // 由于 deriveCapabilities 是 model-discovery 的内部函数，这里内联关键逻辑
    const pipelineTag = profile.pipelineTag ?? null;
    const category = profile.category ?? null;

    const CHAT_TAGS = new Set(['text-generation', 'image-text-to-text', 'any-to-any',
      'conversational', 'question-answering', 'visual-question-answering']);
    const NON_CHAT_TAGS = new Set(['feature-extraction', 'sentence-similarity', 'sentence-transformers',
      'text-ranking', 'text-classification', 'fill-mask', 'text-to-image', 'image-to-image',
      'image-to-video', 'text-to-video', 'text-to-speech', 'audio-to-audio', 'audio-to-text',
      'object-detection', 'image-segmentation', 'depth-estimation', 'table-question-answering',
      'translation', 'summarization', 'zero-shot-classification', 'token-classification',
      'video-classification', 'reinforcement-learning']);
    const CHAT_CATS = new Set(['chat', 'vl-chat', 'omni-chat']);
    const EMBED_CATS = new Set(['embedding']);
    const EMBED_TAGS = new Set(['feature-extraction', 'sentence-similarity', 'sentence-transformers']);

    let chatCapable: boolean;
    if (pipelineTag) {
      if (CHAT_TAGS.has(pipelineTag)) chatCapable = true;
      else if (NON_CHAT_TAGS.has(pipelineTag)) chatCapable = false;
      else chatCapable = true;
    } else if (category) {
      if (CHAT_CATS.has(category)) chatCapable = true;
      else if (EMBED_CATS.has(category) || category === 'reranker') chatCapable = false;
      else if (['image-gen', 'image-edit', 'video-gen', 'tts', 'asr', 'ocr'].includes(category)) chatCapable = false;
      else chatCapable = true;
    } else {
      chatCapable = profile.capabilities.toolCallingMode !== 'none';
    }

    const toolCapable = chatCapable && profile.capabilities.toolCalling && profile.capabilities.toolCallingMode !== 'none';
    const embedCapable = (category && EMBED_CATS.has(category)) || (pipelineTag && EMBED_TAGS.has(pipelineTag)) || false;
    const visionCapable = category === 'vl-chat' || category === 'omni-chat' || profile.capabilities.vision
      || pipelineTag === 'image-text-to-text' || pipelineTag === 'visual-question-answering' || false;

    return { chatCapable, toolCapable, embedCapable, visionCapable };
  }

  // ==================== 内部工具 ====================

  private isExcluded(id: string): boolean {
    return this.preferences.excluded.some((pattern) => this.matchPattern(id, pattern));
  }

  private matchPattern(id: string, pattern: string): boolean {
    if (pattern === id) return true;
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2);
      return id.startsWith(prefix + '/') || id === prefix;
    }
    // 通配符模式：*MiniMax* → 转换为 .*MiniMax.* 正则
    if (pattern.includes('*')) {
      try {
        const regexStr = '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
        return new RegExp(regexStr, 'i').test(id);
      } catch { return false; }
    }
    try {
      return new RegExp(pattern).test(id);
    } catch (e) { console.debug('[model-pool] matchPattern 失败', e); return false; }
  }

  // ==================== 持久化（统一池） ====================

  private saveUnifiedState(): void {
    try {
      const dir = path.join(this.dataDir, 'model-pool-unified');
      fs.mkdirSync(dir, { recursive: true });

      // 保存画像
      const profiles: Record<string, ModelProfile> = {};
      for (const [id, p] of this.profiles) profiles[id] = p;
      fs.writeFileSync(path.join(dir, 'profiles.json'), JSON.stringify(profiles, null, 2));

      // 保存 Thompson Sampling 参数
      const ts: Record<string, ThompsonParams> = {};
      for (const [key, params] of this.tsParams) ts[key] = params;
      fs.writeFileSync(path.join(dir, 'thompson.json'), JSON.stringify(ts, null, 2));

      // 保存用户偏好
      fs.writeFileSync(path.join(dir, 'preferences.json'), JSON.stringify(this.preferences, null, 2));
    } catch (e) { console.debug('[model-pool] persist fail', e); }
  }

  private loadUnifiedState(): void {
    try {
      const dir = path.join(this.dataDir, 'model-pool-unified');

      // 加载画像
      const profilesFile = path.join(dir, 'profiles.json');
      if (fs.existsSync(profilesFile)) {
        const raw = JSON.parse(fs.readFileSync(profilesFile, 'utf-8'));
        for (const [id, p] of Object.entries(raw)) {
          this.profiles.set(id, p as ModelProfile);
        }
        if (this.profiles.size > 0) this.unifiedInitialized = true;
      }

      // 加载 Thompson Sampling 参数
      const tsFile = path.join(dir, 'thompson.json');
      if (fs.existsSync(tsFile)) {
        const raw = JSON.parse(fs.readFileSync(tsFile, 'utf-8'));
        for (const [key, params] of Object.entries(raw)) {
          const p = params as Record<string, unknown>;
          this.tsParams.set(key, {
            alpha: (p.alpha as number) ?? 1,
            beta: (p.beta as number) ?? 1,
            totalCalls: (p.totalCalls as number) ?? 0,
            avgQuality: (p.avgQuality as number) ?? 0.5,
            lastUsed: (p.lastUsed as number) ?? 0,
          });
        }
      }

      // 加载用户偏好
      const prefsFile = path.join(dir, 'preferences.json');
      if (fs.existsSync(prefsFile)) {
        const raw = JSON.parse(fs.readFileSync(prefsFile, 'utf-8'));
        this.preferences = { ...DEFAULT_PREFERENCES, ...raw };
      }
    } catch (e) { console.debug('[model-pool] load fail', e); }
  }
}
