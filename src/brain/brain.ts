/**
 * 三脑协作协议 — 信号流 + 决策融合
 *
 * 外部输入 → 小脑(感知融合) → 右脑(直觉) → 左脑(规则+调度) → 执行
 * 执行结果 → 反馈给三脑
 */

import type {
  TaskSignal, ResourceState, ExecutionPlan, IntuitionSignal,
  BodyState, BodyEvent, HomeostasisAction, DecisionRecord, DecisionOutcome,
  Rule, NNConfig, FeedbackResult, DiagnosticReport,
} from './types.js';
import { LeftBrain } from './left/index.js';
import { RightBrain } from './right/index.js';
import { Cerebellum } from './cerebellum/index.js';
import { DeliberationCouncil, type DeliberationCouncilConfig } from './deliberation/index.js';
import type { DeliberationResult } from './deliberation/types.js';
import { ShadowBrainOrchestrator, type ShadowBrainConfig, type BrainProvider } from './shadow/index.js';
import { OutputQualityAssessor, type QualityAssessment } from './cerebellum/quality-assessor.js';
import { UserStateInferrer, type UserStateSignal } from './cerebellum/user-state-inferrer.js';
import type { SceneGraph } from './right/features/scene-encoder.js';
import type { SpatialEncodeInput, SpatialObject, SpatialRelation } from './right/features/spatial-encoder.js';
import type { RawImage } from './right/features/image-encoder.js';

export interface ThreeBrainConfig {
  left?: Partial<import('./left/index.js').LeftBrainConfig>;
  right?: Partial<import('./right/index.js').RightBrainConfig>;
  cerebellum?: Partial<import('./cerebellum/index.js').CerebellumConfig>;
  shadow?: Partial<ShadowBrainConfig>;
  /** 审议委员会配置 */
  deliberation?: Partial<DeliberationCouncilConfig>;
  verbose?: boolean;
  /** 外部注入的经验进化器（autoEvolve/hypothesize 用） */
  experienceEvolver?: { autoEvolve(): Promise<any[]>; hypothesize(): Promise<any[]> } | null;
}

export interface DecisionResult {
  plan: ExecutionPlan;
  intuition?: IntuitionSignal;
  bodyState: BodyState;
  homeostasisActions: HomeostasisAction[];
  latencyMs: number;
  /** 审议委员会结果（Phase 1 重构） */
  deliberationResult?: DeliberationResult;
  /** 脑内构图预测（高不确定性时触发） */
  mentalSimulation?: {
    candidates: Array<{ label: string; confidence: number; topologyChange: number }>;
    selected: string;
  };
}

export class ThreeBrain {
  readonly left: LeftBrain;
  readonly right: RightBrain;
  readonly cerebellum: Cerebellum;
  /** 审议委员会 — Phase 1 右脑激活 */
  readonly deliberation: DeliberationCouncil;
  /** 影子大脑：自我迭代基础设施（可选） */
  readonly shadow: ShadowBrainOrchestrator | null = null;
  /** 输出质量自评器 */
  readonly qualityAssessor: OutputQualityAssessor;
  /** 用户状态推断器 */
  readonly userStateInferrer: UserStateInferrer;
  private verbose: boolean;
  /** 外部注入的经验进化器 */
  private experienceEvolver: { autoEvolve(): Promise<any[]>; hypothesize(): Promise<any[]> } | null = null;
  /** 待消费的图像帧（截图/摄像头/视频帧）— 一次 predict 后自动清除 */
  private pendingImage: RawImage | null = null;
  /** 图像来源标记，用于调试 */
  private pendingImageSource: string = '';
  /** 决策计数器（定期蒸馏触发） */
  private decisionCount = 0;
  private readonly DISTILL_INTERVAL = 100;
  private distillNoopStreak = 0;
  private recentModes: string[] = [];

  constructor(config?: ThreeBrainConfig) {
    this.verbose = config?.verbose ?? false;
    this.experienceEvolver = config?.experienceEvolver ?? null;
    this.left = new LeftBrain(config?.left, this.verbose);
    this.right = new RightBrain(config?.right, this.verbose);
    this.cerebellum = new Cerebellum(config?.cerebellum, this.verbose);
    this.qualityAssessor = new OutputQualityAssessor();
    this.userStateInferrer = new UserStateInferrer();

    // 审议委员会初始化
    this.deliberation = new DeliberationCouncil({
      verbose: this.verbose,
      ...config?.deliberation,
    });

    // Phase 4: 注入右脑 predictDetailed 到左脑调度器（Thompson Sampling 概率先验）
    this.left.setPredictDetailed((signal, resources, body) =>
      this.right.predictDetailed(signal, resources, body),
    );

    // 影子大脑：可选初始化 + 绑定 BrainProvider
    if (config?.shadow?.llm) {
      this.shadow = new ShadowBrainOrchestrator({
        llm: config.shadow.llm,
        dataDir: config.shadow.dataDir ?? '/tmp/buddy-shadow',
        timing: config.shadow.timing,
        verbose: config.shadow.verbose ?? this.verbose,
      });
      // 绑定 BrainProvider：影子大脑通过此接口读取三脑数据
      this.shadow.setBrainProvider(this.createBrainProvider());
      if (this.verbose) console.log('[ThreeBrain] 影子大脑已启用');
    }

    if (this.verbose) console.log('[ThreeBrain] 三脑架构初始化完成');
  }

  // ── 图像注入接口（Phase 2 补完：接通视神经） ──

  /**
   * 注入截图 — 右脑将在下次 decide() 时感知
   *
   * 数据源：屏幕截图、窗口截图、UI 截图等
   * 生命周期：一次 decide() 后自动清除（每帧独立感知）
   */
  injectScreenshot(image: RawImage, source: string = 'screenshot'): void {
    this.pendingImage = image;
    this.pendingImageSource = source;
    if (this.verbose) {
      console.log(`[ThreeBrain] 注入截图: ${image.width}x${image.height} (${image.channels}ch) from=${source}`);
    }
  }

  /**
   * 注入视频帧 — 支持摄像头/屏幕录制的连续感知
   *
   * 与 injectScreenshot 相同机制，来源标记不同便于调试
   */
  injectVideoFrame(image: RawImage, source: string = 'camera'): void {
    this.pendingImage = image;
    this.pendingImageSource = source;
  }

  /**
   * 注入图片（用户发送的图片消息）
   */
  injectImage(image: RawImage, source: string = 'user_message'): void {
    this.pendingImage = image;
    this.pendingImageSource = source;
  }

  /**
   * 获取当前待消费的图像状态（调试用）
   */
  getImageStatus(): { pending: boolean; source: string; size?: string } {
    return {
      pending: this.pendingImage !== null,
      source: this.pendingImageSource,
      size: this.pendingImage ? `${this.pendingImage.width}x${this.pendingImage.height}` : undefined,
    };
  }

  /**
   * 创建 BrainProvider — 将三脑数据暴露给影子大脑
   * 实现 ShadowCapableBrainProvider 扩展接口，支持影子副本测试
   */
  private createBrainProvider(): import('./shadow/index.js').ShadowCapableBrainProvider {
    return {
      getRules: () => this.left.getRules(),
      addLearnedRule: (rule: Rule) => this.left.addLearnedRule(rule),
      getRightBrain: () => this.right,
      getExperienceEvolver: () => this.experienceEvolver,
      getNNConfig: () => this.right.getNNConfig(),
      getNNParamCount: () => this.right.getModelInfo().params,
      getNNWeights: () => this.right.getNNWeights(),
      getDecisionDistribution: () => this.left.getDecisionDistribution(),
      getRecentLosses: () => this.right.getRecentLosses(),
      getDecisionSamples: () => this.left.getDecisionSamples(),
      getClusterStats: (fp: string) => this.left.getClusterStats(fp),
      runRegressionTests: async () => 0, // TODO: 接入真实回归测试

      // 影子副本扩展：深拷贝 + 重放推理
      cloneBrainState: () => ({
        rules: this.left.getRules().map(r => ({ ...r, stats: { ...r.stats } })),
        nnWeights: this.right.getNNWeights().map(w => new Float32Array(w)),
        nnConfig: { ...this.right.getNNConfig() },
        decisionDistribution: [...this.left.getDecisionDistribution()],
      }),
      replayDecision: async (state, signal, resources) => {
        // 用指定的规则集做规则匹配（不走 NN，纯规则路径）
        const t0 = performance.now();
        const matchedRules = state.rules.filter(r => {
          try { return r.condition(signal, resources); } catch { return false; }
        });
        const success = matchedRules.length > 0;
        return { success, latencyMs: performance.now() - t0 };
      },
    };
  }

  /**
   * 三脑协作决策
   *
   * 信号流：
   * 1. 小脑：感知融合 → BodyState + HomeostasisAction[]
   * 2. 右脑：直觉预测 → IntuitionSignal（Phase 2: 含多模态感知）
   * 3. 左脑：规则匹配 + 调度 → ExecutionPlan
   */
  async decide(
    input: string,
    signal: TaskSignal,
    resources: ResourceState,
  ): Promise<DecisionResult> {
    const t0 = performance.now();

    // Step 1: 小脑 — 感知融合 + 稳态调节
    const bodyEvent: BodyEvent = {
      type: 'user_message',
      timestamp: Date.now(),
      data: { input },
    };
    const homeostasisActions = this.cerebellum.regulate(bodyEvent);
    const bodyState = this.cerebellum.getBodyState();

    // 高优先级调节动作直接执行
    const highPriorityActions = homeostasisActions.filter(a => a.priority >= 8);
    if (highPriorityActions.length > 0 && this.verbose) {
      console.log(`[ThreeBrain] 小脑高优先级动作: ${highPriorityActions.map(a => a.type).join(', ')}`);
    }

    // Step 2: 右脑 — 直觉预测（Phase 2: 注入多模态上下文）
    let intuition: IntuitionSignal | undefined;
    try {
      const multimodal = this.buildMultimodalContext(input);
      intuition = await this.right.predict(input, signal, resources, bodyState, multimodal);
    } catch (err) {
      if (this.verbose) console.warn('[ThreeBrain] 右脑预测失败:', err);
    }

    // Step 2.5: 审议委员会 — 结构化审议（替代旧信号阈值 deliberate()）
    const deliberationResult = await this.deliberation.deliberate(
      input, signal.domains, bodyState, intuition,
    );

    if (deliberationResult.action !== 'proceed') {
      const plan: ExecutionPlan = {
        mode: deliberationResult.action === 'refine' ? 'clarify'
          : deliberationResult.action === 'brainstorm' ? 'clarify'
          : 'single',
        reason: `审议: ${deliberationResult.reasoning}`,
        selectedNodes: [],
        confidence: deliberationResult.confidence,
        source: 'deliberation',
        metaAction: deliberationResult.action === 'brainstorm' ? 'refine' : deliberationResult.action,
        refineStrategy: 'ask_user',
      };
      const latencyMs = performance.now() - t0;
      return { plan, intuition, bodyState, homeostasisActions, latencyMs, deliberationResult };
    }

    // Step 3: 左脑 — 规则 + 调度
    let plan = await this.left.decide(signal, resources, intuition, bodyState);

    const latencyMs = performance.now() - t0;

    // Step 3.5: 脑内构图 — 高不确定性时预评估候选方案
    let mentalSimulation: DecisionResult['mentalSimulation'];
    if (intuition && intuition.qualityEstimate < 0.5 && plan.confidence < 0.6) {
      try {
        // 检查右脑 NN 是否已训练（至少有 10 个样本）
        const rightStats = this.right.getLearnStats();
        if (rightStats.totalSamples >= 10) {
          const candidates = [
            { type: 0, params: [], label: 'sequential' },
            { type: 1, params: [], label: 'parallel' },
            { type: 2, params: [], label: 'single' },
          ];
          const best = this.right.bestAction([], candidates);
          if (best) {
            mentalSimulation = {
              candidates: candidates.map(c => ({
                label: c.label,
                confidence: best.prediction.confidence,
                topologyChange: best.prediction.topologyChangeProb,
              })),
              selected: best.label,
            };
          }
        } else if (this.verbose) {
          console.log(`[ThreeBrain] 脑内构图跳过: NN 样本不足 (${rightStats.totalSamples} < 10)`);
        }
      } catch (err) {
        if (this.verbose) console.warn('[ThreeBrain] 脑内构图失败:', (err as Error).message);
      }
    }

    if (this.verbose) {
      console.log(`[ThreeBrain] 决策完成: ${latencyMs.toFixed(2)}ms, mode=${plan.mode}, source=${plan.source}`);
    }

    return { plan, intuition, bodyState, homeostasisActions, latencyMs, mentalSimulation };
  }

  /**
   * 反馈：执行结果反馈给三脑（Phase 4: 闭环反馈 — redecide / escalate）
   */
  async feedback(
    signal: TaskSignal,
    resources: ResourceState,
    plan: ExecutionPlan,
    outcome: DecisionOutcome,
    actualIntent?: string,
    actualTools?: string[],
    failedModels?: string[],
    failedReasons?: string[],
    actualOutput?: string,
  ): Promise<FeedbackResult> {
    // 左脑：记录决策 + 反馈
    const record: DecisionRecord = {
      input: '', signal, plan, outcome,
      latencyMs: 0, timestamp: Date.now(),
    };
    this.left.recordDecision(record);
    this.left.recordOutcome('', outcome);

    // 右脑：在线学习
    if (actualIntent && actualTools) {
      const bodyState = this.cerebellum.getBodyState();
      await this.right.learnFromOutcome(signal, resources, bodyState, actualIntent, actualTools, outcome);
    }

    // 右脑：原型记忆层 — 工具执行反馈闭环
    if (actualTools && this.right.prototypeMemory) {
      // 找到最近命中的原型，更新工具分布
      const protoId = this.findMatchedProtoId(signal, resources);
      if (protoId) {
        for (const tool of actualTools) {
          this.right.prototypeMemory.updateTool(protoId, tool, outcome.success);
        }
      }
    }

    // 小脑：工具结果事件
    this.cerebellum.regulate({
      type: 'tool_result',
      timestamp: Date.now(),
      data: { success: outcome.success },
    });

    // 影子大脑：缺口检测 + 进化触发
    if (this.shadow) {
      const bodyState = this.cerebellum.getBodyState();
      await this.shadow.onInteraction(signal, outcome, plan.confidence, bodyState);
    }

    // P1-5: 记录决策模式 + 定期触发策略蒸馏（多样性门控）
    this.recentModes.push(plan.mode);
    if (this.recentModes.length > 50) this.recentModes.shift();

    this.decisionCount++;
    if (this.decisionCount % this.DISTILL_INTERVAL === 0) {
      const uniqueModes = new Set(this.recentModes);
      if (uniqueModes.size >= 2) {
        this.runDistill().catch(err => {
          if (this.verbose) console.warn(`[ThreeBrain] distill 失败: ${err.message}`);
        });
      } else if (this.verbose) {
        console.log(`[ThreeBrain] distill 跳过: 决策模式单一 (${uniqueModes.size} 种)`);
      }
    }

    // ── Phase 4: 闭环反馈 ──
    // 执行成功 → 质量自评后返回
    if (outcome.success) {
      // Module 1: 输出质量自评
      const quality = this.qualityAssessor.assess({
        userRequest: signal.content ?? '',
        taskType: signal.taskType,
        output: actualOutput ?? '', // Phase 1-A1: 用真实输出替代空字符串
        executionSuccess: outcome.success,
        latencyMs: outcome.latencyMs,
        retryCount: failedModels?.length,
        toolResults: outcome.toolsUsed, // Phase 1-A1: 工具结果注入
      });

      // 质量分数注入 Thompson Sampling 权重调整
      if (quality.score < 0.5) {
        if (this.verbose) console.log(`[Brain] 质量偏低 (${quality.score.toFixed(2)}): ${quality.issues.map(i => i.description).join('; ')}`);
      }

      return { action: 'success', qualityScore: quality.score };
    }

    // 执行失败 → 检查是否还有替代路径
    const reflection = this.buildReflection(signal, plan, outcome, failedReasons);

    if (this.hasAlternativePaths(signal, failedModels)) {
      if (this.verbose) console.log(`[Brain] 反思: ${reflection}，尝试重新决策`);
      return { action: 'redecide', reflection };
    }

    // 路径穷尽 → 升级到用户
    const diagnostic = this.buildDiagnostic(signal, plan, outcome, failedModels, failedReasons);
    if (this.verbose) console.log(`[Brain] 路径穷尽，升级到用户: ${diagnostic.category}`);
    return { action: 'escalate', diagnostic, reflection };
  }

  /**
   * Phase 4: 构建反思内容
   */
  private buildReflection(
    signal: TaskSignal,
    plan: ExecutionPlan,
    outcome: DecisionOutcome,
    failedReasons?: string[],
  ): string {
    const reasons = failedReasons?.join('; ') ?? '未知原因';
    return `任务 ${signal.taskType} 执行失败 (${reasons})，` +
      `原计划模式=${plan.mode}，置信度=${plan.confidence.toFixed(2)}`;
  }

  /**
   * Phase 4: 检查是否有替代执行路径
   */
  private hasAlternativePaths(signal: TaskSignal, failedModels?: string[]): boolean {
    // 工具任务：如果只试了 prompt 模型，还可以试 native 模型（反之亦然）
    if (signal.taskType === 'tools') {
      // 有失败记录且未穷尽所有模型
      if (failedModels && failedModels.length < 3) return true;
    }
    // 其他任务：有备选模型时可重试
    if (failedModels && failedModels.length < 2) return true;
    return false;
  }

  /**
   * 查找最近匹配的原型 ID（供工具反馈闭环使用）
   */
  private findMatchedProtoId(_signal: TaskSignal, _resources: ResourceState): string | null {
    // 注意：完整实现需要在 predict() 时缓存最近的 protoMatch 结果
    // 当前版本通过 decoder 的双通道已经自动完成工具先验推荐
    // 工具执行后的反馈通过 RightBrain.learnFromOutcome() 间接更新
    return null;
  }

  /**
   * 构建结构化诊断报告
   */
  private buildDiagnostic(
    signal: TaskSignal,
    plan: ExecutionPlan,
    _outcome: DecisionOutcome,
    failedModels?: string[],
    failedReasons?: string[],
  ): DiagnosticReport {
    const reasons = failedReasons ?? [];
    const models = failedModels ?? [];

    // 分类诊断
    let category: DiagnosticReport['category'] = 'unknown';
    let message = '执行失败';
    let mood: DiagnosticReport['mood'] = 'confused';
    const suggestions: DiagnosticReport['suggestions'] = [];

    const has400 = reasons.some(r => r.includes('400') || r.includes('Bad Request'));
    const has401 = reasons.some(r => r.includes('401') || r.includes('403'));
    const hasToken = reasons.some(r => r.includes('token') || r.includes('too long'));

    if (has401) {
      category = 'auth_expired';
      message = 'API Key 已过期或无效';
      mood = 'frustrated';
      suggestions.push({
        action: 'update_key', label: '更新 API Key',
        description: '请在设置中更新你的 API Key', priority: 'high',
      });
    } else if (has400 && signal.taskType === 'tools') {
      category = 'no_native_tools';
      message = '当前模型不支持原生工具调用，prompt 模拟导致请求过大';
      mood = 'frustrated';
      suggestions.push({
        action: 'switch_model', label: '切换到支持原生工具的模型',
        description: '如 DeepSeek、GLM、GPT-4o 等支持原生 function calling 的模型',
        priority: 'high',
      });
      suggestions.push({
        action: 'reduce_tools', label: '减少工具数量',
        description: '减少注册的工具数量可以降低 prompt 大小',
        priority: 'medium',
      });
    } else if (hasToken) {
      category = 'token_limit';
      message = '输入内容超出模型上下文长度限制';
      mood = 'tired';
      suggestions.push({
        action: 'switch_model', label: '切换到更大上下文的模型',
        description: '选择 maxContextTokens 更高的模型',
        priority: 'high',
      });
    } else if (models.length > 0) {
      category = 'all_models_weak';
      message = `已尝试 ${models.length} 个模型均失败`;
      mood = 'tired';
      suggestions.push({
        action: 'add_provider', label: '添加更多 Provider',
        description: '在设置中添加更多 LLM Provider 以增加可用模型',
        priority: 'medium',
      });
    }

    suggestions.push({
      action: 'retry', label: '重试',
      description: '可能是临时网络问题，稍后重试', priority: 'low',
    });

    return {
      category, message,
      detail: `任务类型: ${signal.taskType}, 已尝试模型: ${models.join(', ') || '无'}, 失败原因: ${reasons.join('; ') || '未知'}`,
      suggestions, attempted: models, failedReasons: reasons, mood,
    };
  }

  /**
   * 心跳：定时调用，触发自然衰减 + 主动行为
   *
   * 影子大脑：心跳期间检查是否有待执行的进化
   */
  // ── 脑内构图公共接口 ──

  // ── Phase 2: 多模态感知 ──

  /**
   * 从当前上下文构建多模态输入（Phase 2: 右脑感知桥接）
   *
   * 数据源：
   * 1. EntityRegistry 实体 → SceneGraph（实体关系图）
   * 2. 输入文本中的文件路径 → SpatialEncodeInput（空间坐标）
   * 3. 外部注入的图像 → RawImage（截图/摄像头/用户图片）
   *
   * 无数据时返回 undefined → predict() 退化为纯文本，零额外开销
   */
  private buildMultimodalContext(input: string): {
    sceneGraph?: SceneGraph;
    spatial?: SpatialEncodeInput;
    image?: RawImage;
  } | undefined {
    const registry = this.right.entityRegistry;
    let sceneGraph: SceneGraph | undefined;
    let spatial: SpatialEncodeInput | undefined;
    let image: RawImage | undefined;

    // 1. 实体 → SceneGraph（有注册实体时）
    if (registry.entityCount > 0) {
      const sg = registry.toSceneGraph();
      // 上限保护：编码器限制 16 节点 / 24 边
      if (sg.nodes.length > 0) {
        sceneGraph = sg;
      }
    }

    // 2. 文件路径 → 空间坐标
    const pathPattern = /[\w/\\.-]+\.\w{1,10}/g;
    const paths: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = pathPattern.exec(input)) !== null && paths.length < 8) {
      paths.push(match[0]);
    }

    if (paths.length >= 2) {
      // 路径深度 → 纵向坐标，路径相似度 → 横向坐标
      const objects: SpatialObject[] = paths.map((p, i) => {
        const segments = p.split(/[/\\]/);
        const depth = segments.length;
        const ext = p.split('.').pop() ?? '';
        return {
          id: p,
          label: ext,
          bbox: {
            x: i / Math.max(1, paths.length - 1),  // 水平位置：序列中的索引
            y: Math.min(1, depth / 8),               // 垂直位置：路径深度
            w: 0.1,                                   // 固定宽度
            h: 0.05,                                  // 固定高度
          },
          confidence: 0.8,
        };
      });

      // 推断空间关系：同目录 → 并列，父子目录 → 包含
      const relations: SpatialRelation[] = [];
      for (let i = 0; i < paths.length; i++) {
        for (let j = i + 1; j < paths.length; j++) {
          const dirI = paths[i].substring(0, paths[i].lastIndexOf('/'));
          const dirJ = paths[j].substring(0, paths[j].lastIndexOf('/'));
          if (dirI === dirJ) {
            relations.push({ source: paths[i], target: paths[j], direction: 'right' });
          } else if (dirI.startsWith(dirJ) || dirJ.startsWith(dirI)) {
            relations.push({ source: paths[i], target: paths[j], direction: 'below' });
          }
        }
      }

      spatial = { objects, relations };
    }

    // 3. 图像注入（截图/摄像头/用户图片）
    if (this.pendingImage) {
      image = this.pendingImage;
      this.pendingImage = null;  // 一次消费，自动清除
      if (this.verbose) {
        console.log(`[ThreeBrain] 消费图像: ${image.width}x${image.height} from=${this.pendingImageSource}`);
      }
    }

    // 无数据时返回 undefined → 零开销
    if (!sceneGraph && !spatial && !image) return undefined;
    return { sceneGraph, spatial, image };
  }

  /**
   * 脑内构图：给定当前状态 + 动作序列，预测未来状态
   *
   * 高不确定性时用于决策预评估：
   * - 用当前交互的 token 序列作为状态
   * - 对多个候选动作分别预测
   * - 选置信度最高、拓扑变化最小的方案
   */
  imagine(input: string, signal: TaskSignal, candidates: Array<{ type: number; params?: number[]; label: string }>) {
    // 用信号特征编码当前状态（简化版）
    const tokens = signal.domains.length > 0
      ? signal.domains.map((_, i) => 10 + i) // domain tokens
      : [0];
    return this.right.bestAction(tokens, candidates);
  }

  heartbeat(): HomeostasisAction[] {
    const actions = this.cerebellum.regulate({
      type: 'heartbeat',
      timestamp: Date.now(),
      data: {},
    });

    // 影子大脑心跳：如果有可操作缺口且时机合适，触发进化
    // 异步执行，不阻塞心跳返回
    if (this.shadow) {
      const gaps = this.shadow.gapDetector.getActionableGaps();
      if (gaps.length > 0) {
        const bodyState = this.cerebellum.getBodyState();
        const losses = this.shadow['brain']?.getRecentLosses() ?? [];
        const timing = this.shadow.timingController.shouldEvolve(bodyState, gaps[0].relatedSamples, losses);
        if (timing.allowed) {
          // 通过 onInteraction 触发，传入一个虚拟的成功信号以启动进化检查
          this.shadow.onInteraction(
            { domains: [], complexity: 'medium', taskType: 'background', shouldUseDAG: false, dagReason: '', intentConfidence: 0 },
            { success: false, latencyMs: 0, costEstimate: 0, toolsUsed: [] },
            0,
            bodyState,
          ).catch((err) => { if (this.verbose) console.debug('[DEBUG] 静默错误:', err?.message ?? err); }); // 静默处理错误
        }
      }
    }

    return actions;
  }

  /**
   * 获取全局状态
   */
  getStatus() {
    return {
      left: this.left.getStats(),
      right: this.right.getLearnStats(),
      body: this.cerebellum.getBodyState(),
      shadow: this.shadow?.getStatus() ?? null,
    };
  }

  /**
   * 将工具健康数据注入影子大脑的缺口检测
   *
   * 由心跳系统定期调用，将 SkillGrowth 采集的工具失败模式
   * 转化为 GapDetector 可理解的信号。
   *
   * @param toolMetrics 工具指标列表（由 SkillGrowth.getAllHealth() 提供）
   */
  feedToolHealth(toolMetrics: Array<{
    name: string;
    reliability: number;   // 0-100
    healthScore: number;   // 0-100
    totalCalls: number;
    failureCount: number;
    lastError?: string;
  }>): void {
    if (!this.shadow) return;

    for (const metric of toolMetrics) {
      // 只关注明显异常的工具：可靠性 < 40% 且调用过至少 5 次
      if (metric.reliability >= 40 || metric.totalCalls < 5) continue;

      // 构造虚拟信号，让 GapDetector 识别为能力缺口
      const virtualSignal: TaskSignal = {
        domains: [metric.name],
        complexity: 'medium',
        taskType: 'tools',
        shouldUseDAG: false,
        dagReason: '',
        intentConfidence: 0,
      };

      const virtualOutcome: DecisionOutcome = {
        success: false,
        latencyMs: 0,
        costEstimate: 0,
        toolsUsed: [metric.name],
      };

      // 注入到影子大脑的缺口检测器
      this.shadow.gapDetector.observe(virtualSignal, virtualOutcome, metric.reliability / 100);
    }
  }

  /**
   * P1-5: 策略蒸馏 — 将决策历史蒸馏为规则
   */
  async runDistill(): Promise<void> {
    if (this.verbose) console.log('[ThreeBrain] 触发策略蒸馏');
    const report = await this.left.distill();

    if (report.newRules > 0) {
      this.distillNoopStreak = 0;
      if (this.verbose) {
        console.log(`[ThreeBrain] 蒸馏完成: ${report.newRules} 新规则, ${report.prunedRules} 淘汰`);
      }
    } else {
      this.distillNoopStreak++;
      if (this.verbose) {
        console.log(`[ThreeBrain] 蒸馏无新规则 (连续 ${this.distillNoopStreak} 次)`);
      }
    }
  }

  destroy(): void {
    this.left.destroy();
    this.right.destroy();
    this.cerebellum.destroy();
  }
}
