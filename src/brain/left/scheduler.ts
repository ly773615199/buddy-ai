/**
 * 统一调度器 — 左脑的执行计划生成（v3.1 升级版）
 *
 * 整合：
 * - 四层新颖度路由（ExperienceRouter 思路）
 * - Thompson Sampling 探索/利用（ModelPoolScheduler 思路）
 * - 元认知控制信号（quality_head → 路由降级）
 * - 预算约束
 * - 多维反馈加权（延迟/成本/用户反馈）
 * - 小脑稳态注入
 *
 * 作为规则引擎未命中时的兜底调度
 */

import type {
  TaskSignal, ResourceState, ExecutionPlan, IntuitionSignal, BodyState,
  OrchestrationNode, FailureAnalysis,
} from '../types.js';
import type { ModelRouter, TaskType } from '../../core/model-router.js';

// ==================== 调度配置 ====================

export interface SchedulerConfig {
  /** 新颖度阈值：高于此值走 LLM 为主 */
  noveltyHighThreshold: number;
  /** 新颖度阈值：高于此值强制纯 LLM */
  noveltyExtremeThreshold: number;
  /** 高置信度阈值 */
  highConfidenceThreshold: number;
  /** 中置信度阈值 */
  mediumConfidenceThreshold: number;
  /** Thompson Sampling 探索系数（>1 更激进探索） */
  explorationFactor: number;
  /** 是否启用 Thompson Sampling */
  useThompsonSampling: boolean;
  /** 元认知：quality 低于此值强制走 LLM */
  metacognitiveForceLlm: number;
  /** 元认知：quality 低于此值要求 LLM 验证 */
  metacognitiveCaution: number;
  /** 冷启动探索系数（前 N 次决策时使用） */
  coldStartExplorationFactor: number;
  /** 冷启动阈值（决策次数低于此值时使用冷启动探索） */
  coldStartThreshold: number;
  /** 用户纠正后增加探索的系数 */
  correctionExplorationBoost: number;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  noveltyHighThreshold: 0.7,
  noveltyExtremeThreshold: 0.9,
  highConfidenceThreshold: 0.8,
  mediumConfidenceThreshold: 0.5,
  explorationFactor: 1.0,
  useThompsonSampling: true,
  metacognitiveForceLlm: 0.3,
  metacognitiveCaution: 0.5,
  coldStartExplorationFactor: 2.0,
  coldStartThreshold: 20,
  correctionExplorationBoost: 0.5,
};

// ==================== 路由路径 ====================

type RoutePath = 'exp_direct' | 'exp_verified' | 'llm_with_hint' | 'llm_only' | 'budget_fallback' | 'metacognitive_override' | 'pool_fallback';

// ==================== Thompson Sampling ====================

/**
 * Beta 分布采样（正态近似）
 * Beta(α, β) where α = successes + 1, β = failures + 1
 */
function betaSample(alpha: number, beta: number): number {
  if (alpha <= 1 || beta <= 1) {
    return Math.random(); // 小样本时均匀探索
  }
  const mean = alpha / (alpha + beta);
  const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
  const stdDev = Math.sqrt(variance);
  const u1 = Math.random() || 1e-10;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.min(1, mean + z * stdDev));
}

/**
 * 多维反馈加权成功分（借鉴 CQB-MNL 隐式反馈）
 *
 * 不只看 success/fail 二元，加入延迟、成本、用户反馈
 */
function weightedSuccessScore(
  success: boolean,
  latencyMs: number,
  costEstimate: number,
  userFeedback?: 'good' | 'bad',
): number {
  if (!success) return 0;
  let score = 1.0;
  if (latencyMs > 5000) score *= 0.7;
  else if (latencyMs > 2000) score *= 0.85;
  if (costEstimate > 0.1) score *= 0.8;
  else if (costEstimate > 0.05) score *= 0.9;
  if (userFeedback === 'bad') score *= 0.5;
  else if (userFeedback === 'good') score *= 1.1;
  return Math.min(1, Math.max(0, score));
}

// ==================== 新颖度计算 ====================

/**
 * 计算输入相对于经验的新颖度 (0-1)
 *
 * 基于：
 * - domain 覆盖率（越低越新颖）
 * - 历史成功率（越低越新颖）
 * - intentConfidence（越低越新颖）
 */
function calcNovelty(signal: TaskSignal, resources: ResourceState): number {
  // domain 覆盖：经验命中的 domain 占请求 domain 的比例
  const domainCoverage = resources.experienceHit
    ? Math.min(1, resources.localCoverageRatio)
    : 0;

  // 成熟度：基于本地置信度
  const maturity = resources.localConfidence;

  // 意图确定性
  const intentCertainty = signal.intentConfidence;

  // 新颖度 = 1 - 加权平均
  const familiarity = domainCoverage * 0.4 + maturity * 0.3 + intentCertainty * 0.3;
  return Math.max(0, Math.min(1, 1 - familiarity));
}

// ==================== UnifiedScheduler ====================

export class UnifiedScheduler {
  private config: SchedulerConfig;
  private verbose: boolean;

  // Thompson Sampling 历史（按 fingerprint 聚合）
  private tsHistory: Map<string, { attempts: number; weightedSuccesses: number }> = new Map();

  // Phase 2: 通过 ModelRouter 统一选择模型
  private router: ModelRouter | null = null;

  // Phase 4: 右脑 predictDetailed 注入（可选）
  private _rightBrainPredictDetailed: ((signal: TaskSignal, resources: ResourceState, body?: BodyState) => Promise<{ tools: Array<{ name: string; probability: number }> }>) | null = null;

  // O4: 决策计数器（冷启动检测 + 探索系数动态调整）
  private decisionCount = 0;
  private userCorrectionCount = 0;

  // Phase 1.1: 当前调度的资源状态（供 selectViaRouter 读取排除列表）
  private _currentResources: ResourceState | null = null;

  // Phase 5: 资源画像系统（供能力校验使用）
  private _resourceHub: import('../../brain/hub/resource-hub.js').ResourceHub | null = null;

  constructor(config?: Partial<SchedulerConfig>, verbose = false) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.verbose = verbose;
  }

  /**
   * Phase 5: 注入资源画像系统
   * 能力校验需要查询模型的能力标签和亲和度
   */
  setResourceHub(hub: import('../../brain/hub/resource-hub.js').ResourceHub): void {
    this._resourceHub = hub;
  }

  /**
   * Phase 4: 注入右脑 predictDetailed 函数
   * Thompson Sampling 将使用其概率分布做加权选择
   */
  setPredictDetailed(fn: (signal: TaskSignal, resources: ResourceState, body?: BodyState) => Promise<{ tools: Array<{ name: string; probability: number }> }>): void {
    this._rightBrainPredictDetailed = fn;
  }

  /**
   * Phase 2: 设置模型路由器（替代直接持有 unifiedPool）
   */
  setRouter(router: ModelRouter): void {
    this.router = router;
  }

  getRouter(): ModelRouter | null {
    return this.router;
  }

  /**
   * O4: 获取当前探索系数（动态调整）
   *
   * 三阶段策略：
   * 1. 冷启动阶段（decisionCount < coldStartThreshold）：使用 coldStartExplorationFactor
   * 2. 稳定阶段：使用基础 explorationFactor
   * 3. 用户纠正后：额外增加 correctionExplorationBoost * 纠正次数
   *
   * 上限 3.0，防止过度探索
   */
  getExplorationFactor(): number {
    let factor = this.config.explorationFactor;

    // 冷启动阶段：更激进探索
    if (this.decisionCount < this.config.coldStartThreshold) {
      factor = this.config.coldStartExplorationFactor;
    }

    // 用户纠正后：增加探索
    factor += this.userCorrectionCount * this.config.correctionExplorationBoost;

    return Math.min(factor, 3.0);
  }

  /**
   * O4: 记录一次调度决策（用于冷启动检测）
   */
  recordDecision(): void {
    this.decisionCount++;
  }

  /**
   * O4: 记录用户纠正（增加探索系数）
   *
   * 当用户对模型选择不满或主动切换模型时调用
   */
  recordCorrection(): void {
    this.userCorrectionCount++;
    if (this.verbose) {
      console.log(`[Scheduler] 用户纠正 #${this.userCorrectionCount}，探索系数 → ${this.getExplorationFactor().toFixed(2)}`);
    }
  }

  /**
   * 重置纠正计数器（稳定运行一段时间后可调用）
   */
  resetCorrections(): void {
    this.userCorrectionCount = 0;
  }

  /**
   * 调度决策 — 四层路由 + 元认知 + Thompson Sampling + 小脑稳态
   *
   * Phase 1.1: 新增 failureContext 参数，失败时换路走而非重跑同样流程
   *
   * Fix C: router 作为模型来源嵌入各策略层，不再替代策略。
   * 每一层决定"走什么路由"，selectViaRouter() 负责"用什么模型"。
   *
   * 信号流：
   * 0. 失败上下文注入（Phase 1.1）
   * 1. 预算检查（硬约束）
   * 2. 元认知检查（quality_head 控制信号）
   * 3. 新颖度分层路由
   * 4. Thompson Sampling 选择
   * 5. 小脑稳态注入
   * 6. 默认兜底
   */
  async schedule(
    signal: TaskSignal,
    resources: ResourceState,
    intuition?: IntuitionSignal,
    body?: BodyState,
    failureContext?: FailureAnalysis,
  ): Promise<ExecutionPlan> {
    // O4: 记录决策次数（冷启动检测）
    this.recordDecision();

    // Phase 1.1: 存储当前资源状态供 selectViaRouter 读取排除列表
    this._currentResources = resources;

    // ── Layer 0: 失败上下文注入（Phase 1.1）──
    // 上次执行失败时，根据失败分析调整本次调度策略
    if (failureContext) {
      if (this.verbose) {
        console.log(`[Scheduler] 失败感知: category=${failureContext.category}, strategy=${failureContext.suggestedStrategy}`);
      }

      // 策略 1: 换模型 — 排除失败模型，让 Thompson Sampling 选别的
      if (failureContext.suggestedStrategy === 'switch_model' && failureContext.failedModelId) {
        // 在 selectViaRouter 时注入排除列表（通过 resources 传递）
        (resources as any)._excludeModelIds = [failureContext.failedModelId];
      }

      // 策略 2: 换工具 — 降级失败工具，让规则引擎换路径
      if (failureContext.suggestedStrategy === 'switch_tools' && failureContext.failedTools) {
        (resources as any)._failedTools = failureContext.failedTools;
        (resources as any)._retryStrategy = 'switch_tools';
      }

      // 策略 3: 简化 — 降低复杂度，走轻量路径
      if (failureContext.suggestedStrategy === 'simplify') {
        return this.makePlan('budget_fallback', 'local_only',
          `失败降级: ${failureContext.detail} → 简化重试`,
          Math.max(0.3, failureContext.qualityScore * 0.8), [
            { id: 'local', type: 'local_expert' },
          ]);
      }

      // 策略 4: 注入知识 — 走经验 + LLM 验证路径
      if (failureContext.suggestedStrategy === 'inject_knowledge') {
        if (resources.experienceHit) {
          return this.makePlan('exp_verified', 'cascade',
            `失败降级: ${failureContext.detail} → 经验+LLM验证`,
            Math.max(0.4, resources.localConfidence * 0.8), [
              { id: 'experience', type: 'experience' },
              { id: 'local', type: 'local_expert' },
            ]);
        }
        // 无经验可用，走纯 LLM
        return await this.selectViaRouter('llm_only', signal, body,
          `失败降级: ${failureContext.detail} → 纯LLM`);
      }

      // 策略 5: 分解任务 — 标记 useDAG
      if (failureContext.suggestedStrategy === 'decompose_task') {
        (signal as any).shouldUseDAG = true;
        (signal as any).dagReason = `失败驱动分解: ${failureContext.detail}`;
      }
    }

    // ── Layer 0.5: 经验资源偏好注入（Phase 3.2）──
    const expHit = resources.experienceHit as { resourceHints?: { preferredModels?: string[]; avoidModels?: string[] } } | null;
    const expHints = expHit?.resourceHints;
    if (expHints) {
      // 经验推荐排除某些模型
      if (expHints.avoidModels && expHints.avoidModels.length > 0) {
        const existing = (resources as any)._excludeModelIds as string[] ?? [];
        (resources as any)._excludeModelIds = [...existing, ...expHints.avoidModels];
      }
      if (this.verbose && expHints.preferredModels?.length) {
        console.log(`[Scheduler] 经验偏好: 推荐模型=${expHints.preferredModels.join(',')}`);
      }
    }

    // ── Layer 1: 预算硬约束 ──
    if (resources.budgetRemaining <= 0) {
      return this.makePlan('budget_fallback', 'local_only', '预算耗尽，使用本地模型', 0.6, [
        { id: 'local', type: 'local_expert' },
      ]);
    }

    // ── Layer 1: 元认知控制信号 ──
    if (intuition?.hit) {
      const quality = intuition.qualityEstimate;

      // 极低信心 → 强制 LLM（跳过所有经验路由）
      if (quality < this.config.metacognitiveForceLlm) {
        return await this.selectViaRouter('metacognitive_override', signal, body,
          `元认知降级: quality=${quality.toFixed(2)} < ${this.config.metacognitiveForceLlm}`);
      }

      // 中等信心 → 走经验但要求 LLM 验证
      if (quality < this.config.metacognitiveCaution) {
        if (resources.experienceHit && resources.localConfidence >= this.config.mediumConfidenceThreshold) {
          return this.makePlan('exp_verified', 'cascade',
            `元认知谨慎: quality=${quality.toFixed(2)}，经验+本地验证`,
            quality, [
              { id: 'experience', type: 'experience' },
              { id: 'local', type: 'local_expert' },
            ]);
        }
      }
    }

    // ── Layer 2: 新颖度分层路由 ──
    const novelty = calcNovelty(signal, resources);

    // 极高新颖度 → LLM 为主
    if (novelty >= this.config.noveltyExtremeThreshold) {
      return await this.selectViaRouter('llm_only', signal, body,
        `极高新颖度(${novelty.toFixed(2)})`);
    }

    // 极低新颖度 + 高置信度经验 → 零 LLM 直接执行
    // 但如果工具不可靠或能力不匹配，降级到验证路径
    if (
      novelty < this.config.noveltyHighThreshold &&
      resources.experienceHit &&
      resources.localConfidence >= this.config.highConfidenceThreshold
    ) {
      // 新增：能力校验 — 经验推荐的模型是否适合当前任务
      const capabilityIssue = this.validateExperienceCapability(signal, resources);
      if (capabilityIssue) {
        return await this.selectViaRouter('llm_with_hint', signal, body,
          `能力校验失败: ${capabilityIssue}，路由器重选`);
      }

      // 工具健康检查：不可靠时跳过直连
      const toolHealth = resources.toolHealth;
      if (toolHealth && toolHealth.unreliableTools.length > 0) {
        const hit = resources.experienceHit as { skill?: string; tools?: string[] };
        const targetTools = [hit.skill, ...(hit.tools ?? [])].filter(Boolean);
        const hasUnreliable = targetTools.some(t =>
          toolHealth.unreliableTools.includes(t!) || toolHealth.unreliableTools.includes(`skill_${t}`)
        );
        if (hasUnreliable) {
          // 降级到验证路径
          return this.makePlan('exp_verified', 'cascade',
            `极低新颖度但工具不可靠，降级到验证路径`,
            resources.localConfidence * 0.7, [
              { id: 'experience', type: 'experience' },
              { id: 'local', type: 'local_expert' },
            ]);
        }
      }

      return this.makePlan('exp_direct', 'local_only',
        `极低新颖度(${novelty.toFixed(2)}) + 高置信度(${resources.localConfidence.toFixed(2)})，经验直连`,
        resources.localConfidence, [{ id: 'experience', type: 'experience' }]);
    }

    // 中等新颖度 + 中置信度 → 经验执行 + LLM 验证
    if (
      novelty < this.config.noveltyHighThreshold &&
      resources.experienceHit &&
      resources.localConfidence >= this.config.mediumConfidenceThreshold
    ) {
      // 新增：能力校验
      const capabilityIssue2 = this.validateExperienceCapability(signal, resources);
      if (capabilityIssue2) {
        return await this.selectViaRouter('llm_with_hint', signal, body,
          `能力校验失败: ${capabilityIssue2}，路由器重选`);
      }

      return this.makePlan('exp_verified', 'cascade',
        `中等新颖度(${novelty.toFixed(2)})，经验+本地验证`,
        resources.localConfidence, [
          { id: 'experience', type: 'experience' },
          { id: 'local', type: 'local_expert' },
        ]);
    }

    // ── Layer 3: Thompson Sampling 选择 ──
    if (intuition?.hit && this.config.useThompsonSampling) {
      // Phase 4: 优先用 predictDetailed 的概率分布加权
      const tsResult = this._rightBrainPredictDetailed
        ? await this.thompsonSelectWithProbs(signal, resources, body)
        : await this.thompsonSelect(signal, resources, intuition, body);
      if (tsResult) return tsResult;
    }

    // ── Layer 4: 右脑直觉信号注入 ──
    if (intuition?.hit && intuition.intent.confidence > 0.7) {
      return await this.selectViaRouter('llm_with_hint', signal, body,
        `直觉推荐: ${intuition.intent.category} (conf=${intuition.intent.confidence.toFixed(2)})`);
    }

    // ── Layer 5: 小脑稳态注入 ──
    if (body) {
      // 高负载 → 降级到轻量模型
      if (body.load > 80) {
        return await this.selectViaRouter('budget_fallback', signal, body,
          `高负载降级(load=${body.load})`);
      }

      // 低精力 → 简化回复
      if (body.energy < 30) {
        return await this.selectViaRouter('budget_fallback', signal, body,
          `低精力(energy=${body.energy})`);
      }

      // 高困惑度 → 强模型详细解释
      if (body.confusionLevel > 70) {
        return await this.selectViaRouter('llm_only', signal, body,
          `高困惑度(confusion=${body.confusionLevel})`);
      }
    }

    // ── Layer 5.5: 工具健康度检查 ──
    if (resources.toolHealth) {
      const { unreliableTools, slowTools } = resources.toolHealth;

      // 检查经验路由命中的工具是否可靠
      if (resources.experienceHit) {
        const hit = resources.experienceHit as { skill?: string; tools?: string[] };
        const targetTools = [hit.skill, ...(hit.tools ?? [])].filter(Boolean);

        const hasUnreliable = targetTools.some(t =>
          unreliableTools.includes(t!) || unreliableTools.includes(`skill_${t}`)
        );
        const hasSlow = targetTools.some(t =>
          slowTools.includes(t!) || slowTools.includes(`skill_${t}`)
        );

        // 工具不可靠 → 强制 LLM 路径，经验仅作参考
        if (hasUnreliable) {
          return await this.selectViaRouter('llm_with_hint', signal, body,
            `工具不可靠(${targetTools.filter(t => unreliableTools.includes(t!)).join(',')}), 经验降级为参考`);
        }

        // 工具慢 → 经验+LLM 验证（不走直连）
        if (hasSlow && signal.complexity !== 'simple') {
          return this.makePlan('exp_verified', 'cascade',
            `工具慢(${targetTools.filter(t => slowTools.includes(t!)).join(',')}), 走验证路径`,
            resources.localConfidence * 0.8, [
              { id: 'experience', type: 'experience' },
              { id: 'local', type: 'local_expert' },
            ]);
        }
      }
    }

    // ── Layer 6: 默认兜底 ──
    return await this.selectViaRouter('llm_only', signal, body, '默认调度');
  }

  /**
   * Thompson Sampling 选择（基础版：从直觉推荐的工具中采样）
   *
   * 从直觉推荐的工具中，用 Thompson Sampling 选出最优组合
   * 平衡探索（尝试新工具）和利用（使用已知好工具）
   */
  private async thompsonSelect(
    signal: TaskSignal,
    resources: ResourceState,
    intuition: IntuitionSignal,
    body?: BodyState,
  ): Promise<ExecutionPlan | null> {
    if (!intuition.suggestedTools || intuition.suggestedTools.length === 0) {
      return null;
    }

    const fp = this.fingerprint(signal);

    // 对每个推荐工具做 Thompson Sampling
    const toolScores: Array<{ tool: string; sample: number }> = [];

    for (const tool of intuition.suggestedTools.slice(0, 5)) {
      const key = `${fp}|${tool}`;
      const hist = this.tsHistory.get(key) ?? { attempts: 0, weightedSuccesses: 0 };

      const alpha = hist.weightedSuccesses + 1;
      const beta = hist.attempts - hist.weightedSuccesses + 1;
      const sample = betaSample(alpha, beta) * this.getExplorationFactor();

      toolScores.push({ tool, sample });
    }

    if (toolScores.length === 0) return null;

    // 选最高分
    toolScores.sort((a, b) => b.sample - a.sample);
    const best = toolScores[0];

    return await this.selectViaRouter('llm_with_hint', signal, body,
      `Thompson Sampling: ${best.tool} (sample=${best.sample.toFixed(3)})`);
  }

  /**
   * Phase 4: Thompson Sampling + 右脑概率先验
   *
   * 用 predictDetailed 获取工具概率分布，将概率作为先验注入 Thompson Sampling：
   *   alpha = hist_weightedSuccesses + 1 + probability * 5
   *
   * 高概率工具在采样时天然占优，但仍保留探索空间
   */
  private async thompsonSelectWithProbs(
    signal: TaskSignal,
    resources: ResourceState,
    body?: BodyState,
  ): Promise<ExecutionPlan | null> {
    if (!this._rightBrainPredictDetailed) return null;

    try {
      const detailed = await this._rightBrainPredictDetailed(signal, resources, body);
      if (!detailed.tools || detailed.tools.length === 0) return null;

      const fp = this.fingerprint(signal);
      const toolScores: Array<{ tool: string; sample: number; prob: number }> = [];

      for (const tool of detailed.tools.slice(0, 5)) {
        const key = `${fp}|${tool.name}`;
        const hist = this.tsHistory.get(key) ?? { attempts: 0, weightedSuccesses: 0 };

        // 概率先验：右脑给的 probability 乘以 5 作为额外 alpha
        const alpha = hist.weightedSuccesses + 1 + tool.probability * 5;
        const beta = hist.attempts - hist.weightedSuccesses + 1;
        const sample = betaSample(alpha, beta) * this.getExplorationFactor();

        toolScores.push({ tool: tool.name, sample, prob: tool.probability });
      }

      if (toolScores.length === 0) return null;

      toolScores.sort((a, b) => b.sample - a.sample);
      const best = toolScores[0];

      if (this.verbose) {
        console.log(`[Scheduler] Thompson+Prob: ${best.tool} (sample=${best.sample.toFixed(3)}, prob=${best.prob.toFixed(2)})`);
      }

      return await this.selectViaRouter('llm_with_hint', signal, body,
        `Thompson+Prob: ${best.tool} (sample=${best.sample.toFixed(3)}, prob=${best.prob.toFixed(2)})`);
    } catch (err) {
      if (this.verbose) console.warn('[Scheduler] predictDetailed 失败，降级基础 TS:', (err as Error).message);
      return null;  // 降级到基础 thompsonSelect（调用方会 fallback）
    }
  }

  /**
   * Phase 2.1: 多候选方案生成 — 生成 2-3 个备选方案
   *
   * 主方案失败时，直接切换到备选方案，无需重新编排。
   * 候选来源：
   * 1. 主方案（Thompson Sampling 选的）
   * 2. 经验路由（如果有）
   * 3. 本地专家（兜底）
   */
  async scheduleMultiple(
    signal: TaskSignal,
    resources: ResourceState,
    intuition?: IntuitionSignal,
    body?: BodyState,
    count = 3,
  ): Promise<{ primary: ExecutionPlan; candidates: ExecutionPlan['candidates'] }> {
    const primary = await this.schedule(signal, resources, intuition, body);
    const candidates: NonNullable<ExecutionPlan['candidates']> = [];

    // 候选 1: 如果主方案走 LLM，尝试经验路由作为备选
    if (primary.source === 'scheduler' && resources.experienceHit) {
      candidates.push({
        mode: 'cascade',
        reason: `备选: 经验+LLM验证 (主方案: ${primary.reason})`,
        selectedNodes: [
          { id: 'experience', type: 'experience' },
          { id: 'local', type: 'local_expert' },
        ],
        confidence: resources.localConfidence * 0.8,
        source: 'candidate-exp',
      });
    }

    // 候选 2: 本地专家（最稳的兜底）
    if (primary.mode !== 'local_only') {
      candidates.push({
        mode: 'local_only',
        reason: `备选: 本地专家兜底 (主方案: ${primary.reason})`,
        selectedNodes: [{ id: 'local', type: 'local_expert' }],
        confidence: 0.5,
        source: 'candidate-local',
      });
    }

    // 候选 3: 如果主方案走经验，尝试 LLM 作为备选
    if (primary.mode === 'local_only' && primary.source !== 'scheduler') {
      try {
        const llmPlan = await this.selectViaRouter('llm_only', signal, body, '备选: LLM 路径');
        candidates.push({
          mode: llmPlan.mode,
          reason: `备选: LLM 路径 (主方案: ${primary.reason})`,
          selectedNodes: llmPlan.selectedNodes,
          confidence: llmPlan.confidence,
          source: 'candidate-llm',
        });
      } catch { /* LLM 不可用，跳过 */ }
    }

    return { primary, candidates: candidates.length > 0 ? candidates : undefined };
  }

  /**
   * 记录 Thompson Sampling 结果（供外部调用）
   */
  recordOutcome(signal: TaskSignal, tool: string, success: boolean, latencyMs: number, costEstimate: number): void {
    const fp = this.fingerprint(signal);
    const key = `${fp}|${tool}`;
    const hist = this.tsHistory.get(key) ?? { attempts: 0, weightedSuccesses: 0 };

    hist.attempts++;
    hist.weightedSuccesses += weightedSuccessScore(success, latencyMs, costEstimate);
    this.tsHistory.set(key, hist);

    // 限制历史大小
    if (this.tsHistory.size > 1000) {
      const oldest = this.tsHistory.keys().next().value;
      if (oldest) this.tsHistory.delete(oldest);
    }
  }

  /**
   * 获取调度统计
   */
  getStats() {
    return {
      tsHistorySize: this.tsHistory.size,
      config: { ...this.config },
    };
  }

  // ==================== 内部工具 ====================

  /**
   * 通过 ModelRouter 选择模型 — router 作为模型来源，不替代调度策略
   *
   * 调度层决定路由路径（exp_direct / llm_only / budget_fallback 等），
   * 本方法负责从统一池选出具体模型节点。
   * router 不可用时降级到本地专家。
   */
  private async selectViaRouter(
    routePath: RoutePath,
    signal: TaskSignal,
    body: BodyState | undefined,
    reason: string,
  ): Promise<ExecutionPlan> {
    if (this.router) {
      try {
        const taskType = signal.taskType as TaskType;
        const context = { content: signal.content ?? '', bodyState: body };

        // Phase 1.1: 检查是否有排除列表（失败感知重试注入）
        const excludeIds = (this._currentResources as any)?._excludeModelIds as string[] | undefined;

        let selection;
        if (excludeIds && excludeIds.length > 0) {
          // 排除失败模型后选择
          selection = await this.router.selectExcluding(taskType, context, excludeIds);
          if (this.verbose && selection) {
            console.log(`[Scheduler] 排除模型 [${excludeIds.join(',')}] 后选择: ${selection.id}`);
          }
        } else {
          selection = await this.router.select(taskType, context);
        }

        if (selection) {
          const creds = this.router.getPool()?.getProviderCredentials(selection.provider);
          const node: OrchestrationNode = {
            id: selection.id,
            type: 'cloud_node',
            model: selection.model,
            provider: selection.provider,
            apiKey: creds?.apiKey,
            baseUrl: creds?.baseUrl,
          };
          if (this.verbose) {
            console.log(`[Scheduler] ${routePath}: ${reason} → ModelRouter: ${selection.id} (${selection.source})`);
          }
          return {
            mode: 'single',
            reason: `[${routePath}] ${reason} → ${selection.id} (${selection.source})`,
            selectedNodes: [node],
            confidence: 0.8,
            source: 'scheduler',
          };
        }
      } catch (err) {
        if (this.verbose) {
          console.warn(`[Scheduler] ModelRouter 选择失败: ${(err as Error).message}`);
        }
      }
    }

    // router 不可用或无选择结果 → 降级到本地专家
    return this.makePlan(routePath, 'local_only', `${reason} → 本地模型`, 0.5, [
      { id: 'local', type: 'local_expert' },
    ]);
  }

  private makePlan(
    routePath: RoutePath,
    mode: ExecutionPlan['mode'],
    reason: string,
    confidence: number,
    nodes: OrchestrationNode[],
  ): ExecutionPlan {
    if (this.verbose) {
      console.log(`[Scheduler] ${routePath}: ${reason}`);
    }
    return {
      mode,
      reason: `[${routePath}] ${reason}`,
      selectedNodes: nodes,
      confidence,
      source: 'scheduler',
    };
  }

  /**
   * 经验路由能力校验 — 检查经验推荐的模型是否适合当前任务
   *
   * 校验维度：
   * 1. 亲和度 ≥ 0.3（模型对此类任务的成功率）
   * 2. 工具任务需要 toolCalling 支持
   * 3. 推理任务不能选弱推理模型
   *
   * @returns null 表示校验通过，否则返回降级原因
   */
  private validateExperienceCapability(
    signal: TaskSignal,
    resources: ResourceState,
  ): string | null {
    const expHit = resources.experienceHit as { skill?: { id?: string }; model?: string } | null;
    if (!expHit) return null;

    const taskType = signal.taskType;
    const resourceHub = this._resourceHub;
    if (!resourceHub) return null;

    // 获取经验推荐的模型画像
    const recommendedModelId = expHit.model;
    if (!recommendedModelId) return null;

    const modelProfile = resourceHub.getById(recommendedModelId);
    if (!modelProfile) return null;

    // 校验 1: 亲和度过低
    const affinity = modelProfile.affinity[taskType] ?? 0.5;
    if (affinity < 0.3) {
      return `经验推荐 ${recommendedModelId} 但亲和度 ${affinity.toFixed(2)} 过低(${taskType})`;
    }

    // 校验 2: 任务需要工具调用但模型不支持
    if (taskType === 'tools' && !modelProfile.capabilities.toolCalling) {
      return `经验推荐 ${recommendedModelId} 但不支持工具调用`;
    }

    // 校验 3: 任务需要推理但模型推理能力弱
    if (taskType === 'reasoning' && modelProfile.capabilities.weakAt?.includes('reasoning')) {
      return `经验推荐 ${recommendedModelId} 但推理能力弱`;
    }

    return null; // 校验通过
  }

  private fingerprint(signal: TaskSignal): string {
    return `${signal.domains.sort().join(',')}|${signal.complexity}|${signal.taskType}`;
  }
}
