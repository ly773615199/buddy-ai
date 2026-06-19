/**
 * 右脑：直觉学习脑
 *
 * 手写轻量 NN 内核，边跑边学边调权重
 * 只输出结构化决策建议，绝不闲聊生成
 */

import type {
  IntuitionSignal, IntuitionDecision,
  BodyState, TaskSignal, ResourceState, DecisionOutcome,
  NNConfig, OnlineLearnConfig, DistillConfig, TrainingSample, DecisionRecord,
} from '../types.js';
import { IntuitionNet } from './nn/model.js';
import { encodeFeatures, encodeFeaturesFast, type EncodeInput } from './features/encoder.js';
import { decodeDecision, decodeSignal } from './features/decoder.js';
import { saveModel, loadModel, saveModelQuantized } from './nn/serialize.js';
import { OnlineLearner } from './training/online-learner.js';
import { Distiller, type DistillResult } from './training/distiller.js';
import type { SpatialEncodeInput } from './features/spatial-encoder.js';
import type { RawImage } from './features/image-encoder.js';
import type { SceneGraph } from './features/scene-encoder.js';
import { SceneWorldModel, type SceneAction, type ScenePredictionResult, EntityRegistry } from './scene/index.js';

export interface RightBrainConfig {
  nn: NNConfig;
  online: OnlineLearnConfig;
  distill: DistillConfig;
}

const DEFAULT_CONFIG: RightBrainConfig = {
  nn: {
    vocabSize: 2048, embedDim: 64, hiddenDim: 128,
    numHeads: 4, numLayers: 2, numIntents: 13, numTools: 32,
    ffnDim: 256, dropout: 0,
    numSpatialBins: 6, numSceneNodes: 32,
  },
  online: {
    learningRate: 0.001, batchSize: 8, replayBufferSize: 1000,
    lprLambda: 0.1, lprSnapshotInterval: 100, updateInterval: 1,
  },
  distill: {
    temperature: 2.0, alphaSignal: 0.4, alphaContext: 0.3, alphaAction: 0.3,
    minTeacherSamples: 50, distillIntervalMs: 3600_000,
  },
};

import { WorldModel, type ActionEncoding, type PredictionResult } from './nn/world-model.js';
import { PrototypeMemory, type PrototypeMemoryConfig } from './prototype-memory.js';
import { TextEncoder } from './features/text-encoder.js';

export class RightBrain {
  private config: RightBrainConfig;
  private verbose: boolean;
  private model: IntuitionNet;
  private learner: OnlineLearner;
  private distiller: Distiller;
  private worldModel: WorldModel;
  /** GNN 驱动的场景世界模型（替代旧 WorldModel） */
  private sceneWorldModel: SceneWorldModel;
  /** 实体注册中心 */
  readonly entityRegistry: EntityRegistry;
  /** 原型记忆层 — 双通道意图表征 */
  readonly prototypeMemory: PrototypeMemory;
  /** 字节级文本编码器（可选，有则走 NN 路径） */
  private textEncoder: TextEncoder | null = null;
  private modelVersion = 0;
  private predictCount = 0;

  constructor(config?: Partial<RightBrainConfig>, verbose = false) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.verbose = verbose;
    this.model = new IntuitionNet(this.config.nn);
    this.learner = new OnlineLearner(this.model, this.config.online, undefined, verbose);
    this.distiller = new Distiller(this.model, this.learner, this.config.distill, verbose);
    this.worldModel = new WorldModel({
      latentDim: this.config.nn.hiddenDim,
      actionDim: 16,
      hiddenDim: this.config.nn.hiddenDim * 2,
      predictionSteps: 3,
    });

    // 保留旧 WorldModel（兼容）

    // 新 GNN 场景世界模型
    this.sceneWorldModel = new SceneWorldModel({
      gnn: {
        nodeDim: 32,
        edgeDim: 16,
        actionDim: 16,
        hiddenDim: 64,
        outputDim: 32,
      },
      numGNNLayers: 2,
      maxEntities: 32,
      maxEdges: 64,
      latentDim: this.config.nn.hiddenDim,
      actionDim: 16,
    });
    this.entityRegistry = this.sceneWorldModel.getRegistry();

    // 原型记忆层初始化（从 intentHead 权重提取种子原型）
    this.prototypeMemory = new PrototypeMemory({
      hiddenDim: this.config.nn.hiddenDim,
    });
    this.seedPrototypeMemory();

    if (this.verbose) {
      const params = this.model.countParams();
      const sceneParams = this.sceneWorldModel.countParams();
      const protoCount = this.prototypeMemory.getPrototypes().length;
      console.log(`[RightBrain] 初始化: NN=${params}参数, SceneWM=${sceneParams}参数, ProtoMem=${protoCount}种子原型, 在线学习就绪`);
    }
  }

  /**
   * 预测：输入结构化特征，输出直觉信号
   * 目标 < 5ms（无多模态）/ < 20ms（含多模态）
   *
   * Phase 4 优化：简单任务走快速路径
   * - encodeFeaturesFast(): 8-10 tokens vs 20-60+ tokens
   * - forwardInferenceFast(): 低阈值 early exit + 跳过 spatial/scene heads
   */

  /**
   * 冷启动预热 — 用合成数据训练 NN，让 hit 在合理输入上为 true
   *
   * 在系统初始化时调用，用常见模式的合成样本预训练 NN。
   * 这样即使没有真实用户交互，NN 也能产生有意义的输出。
   *
   * 每个意图类别生成 5 个样本，共 40 个样本，训练 3 轮。
   * 耗时约 50-100ms，不影响启动速度。
   */
  async warmupWithSyntheticData(): Promise<{ trained: number; loss: number }> {
    const INTENT_LABELS = [
      'file_operations', 'code_operations', 'git_operations', 'web_operations',
      'system_operations', 'knowledge_query', 'conversation', 'complex_task',
    ];

    // 合成训练样本：每个意图 5 个典型输入
    const SYNTHETIC_SAMPLES: Array<{ intent: number; tools: number[]; quality: number; signal: TaskSignal }> = [
      // file_operations
      { intent: 0, tools: [0, 1], quality: 0.8, signal: { domains: ['file'], complexity: 'simple', taskType: 'tools', shouldUseDAG: false, dagReason: '', intentConfidence: 0.8, criticality: 'normal' } },
      { intent: 0, tools: [0], quality: 0.9, signal: { domains: ['file'], complexity: 'simple', taskType: 'tools', shouldUseDAG: false, dagReason: '', intentConfidence: 0.9, criticality: 'low' } },
      { intent: 0, tools: [1, 3], quality: 0.7, signal: { domains: ['file'], complexity: 'medium', taskType: 'tools', shouldUseDAG: false, dagReason: '', intentConfidence: 0.7, criticality: 'normal' } },
      { intent: 0, tools: [0, 2], quality: 0.85, signal: { domains: ['file'], complexity: 'simple', taskType: 'tools', shouldUseDAG: false, dagReason: '', intentConfidence: 0.85, criticality: 'low' } },
      { intent: 0, tools: [1], quality: 0.75, signal: { domains: ['file'], complexity: 'simple', taskType: 'tools', shouldUseDAG: false, dagReason: '', intentConfidence: 0.75, criticality: 'normal' } },
      // code_operations
      { intent: 1, tools: [0, 4, 14], quality: 0.6, signal: { domains: ['code'], complexity: 'medium', taskType: 'tools', shouldUseDAG: false, dagReason: '', intentConfidence: 0.7, criticality: 'normal' } },
      { intent: 1, tools: [4, 15], quality: 0.5, signal: { domains: ['code'], complexity: 'complex', taskType: 'reasoning', shouldUseDAG: false, dagReason: '', intentConfidence: 0.6, criticality: 'high' } },
      { intent: 1, tools: [0, 3], quality: 0.8, signal: { domains: ['code'], complexity: 'simple', taskType: 'tools', shouldUseDAG: false, dagReason: '', intentConfidence: 0.85, criticality: 'low' } },
      { intent: 1, tools: [4], quality: 0.7, signal: { domains: ['code'], complexity: 'medium', taskType: 'tools', shouldUseDAG: false, dagReason: '', intentConfidence: 0.75, criticality: 'normal' } },
      { intent: 1, tools: [0, 4], quality: 0.65, signal: { domains: ['code'], complexity: 'medium', taskType: 'tools', shouldUseDAG: false, dagReason: '', intentConfidence: 0.7, criticality: 'normal' } },
      // git_operations
      { intent: 2, tools: [5, 7], quality: 0.9, signal: { domains: ['git'], complexity: 'simple', taskType: 'tools', shouldUseDAG: false, dagReason: '', intentConfidence: 0.9, criticality: 'low' } },
      { intent: 2, tools: [8, 9], quality: 0.85, signal: { domains: ['git'], complexity: 'simple', taskType: 'tools', shouldUseDAG: false, dagReason: '', intentConfidence: 0.85, criticality: 'normal' } },
      { intent: 2, tools: [5, 6, 7], quality: 0.8, signal: { domains: ['git'], complexity: 'simple', taskType: 'tools', shouldUseDAG: false, dagReason: '', intentConfidence: 0.8, criticality: 'low' } },
      { intent: 2, tools: [10, 11], quality: 0.7, signal: { domains: ['git'], complexity: 'medium', taskType: 'tools', shouldUseDAG: false, dagReason: '', intentConfidence: 0.7, criticality: 'normal' } },
      { intent: 2, tools: [9, 11], quality: 0.75, signal: { domains: ['git'], complexity: 'simple', taskType: 'tools', shouldUseDAG: false, dagReason: '', intentConfidence: 0.8, criticality: 'normal' } },
      // web_operations
      { intent: 3, tools: [12, 13], quality: 0.7, signal: { domains: ['web'], complexity: 'simple', taskType: 'tools', shouldUseDAG: false, dagReason: '', intentConfidence: 0.8, criticality: 'low' } },
      { intent: 3, tools: [12], quality: 0.8, signal: { domains: ['web'], complexity: 'simple', taskType: 'tools', shouldUseDAG: false, dagReason: '', intentConfidence: 0.85, criticality: 'low' } },
      { intent: 3, tools: [13], quality: 0.75, signal: { domains: ['web'], complexity: 'simple', taskType: 'tools', shouldUseDAG: false, dagReason: '', intentConfidence: 0.75, criticality: 'normal' } },
      { intent: 3, tools: [12, 13, 4], quality: 0.6, signal: { domains: ['web'], complexity: 'medium', taskType: 'tools', shouldUseDAG: false, dagReason: '', intentConfidence: 0.7, criticality: 'normal' } },
      { intent: 3, tools: [12], quality: 0.85, signal: { domains: ['web'], complexity: 'simple', taskType: 'tools', shouldUseDAG: false, dagReason: '', intentConfidence: 0.9, criticality: 'low' } },
      // system_operations
      { intent: 4, tools: [4], quality: 0.8, signal: { domains: ['system'], complexity: 'simple', taskType: 'tools', shouldUseDAG: false, dagReason: '', intentConfidence: 0.8, criticality: 'normal' } },
      { intent: 4, tools: [4, 27], quality: 0.85, signal: { domains: ['system'], complexity: 'simple', taskType: 'tools', shouldUseDAG: false, dagReason: '', intentConfidence: 0.85, criticality: 'low' } },
      { intent: 4, tools: [4], quality: 0.7, signal: { domains: ['system'], complexity: 'medium', taskType: 'tools', shouldUseDAG: false, dagReason: '', intentConfidence: 0.7, criticality: 'normal' } },
      { intent: 4, tools: [4, 0], quality: 0.75, signal: { domains: ['system'], complexity: 'simple', taskType: 'tools', shouldUseDAG: false, dagReason: '', intentConfidence: 0.8, criticality: 'normal' } },
      { intent: 4, tools: [4], quality: 0.9, signal: { domains: ['system'], complexity: 'simple', taskType: 'tools', shouldUseDAG: false, dagReason: '', intentConfidence: 0.9, criticality: 'low' } },
      // knowledge_query
      { intent: 5, tools: [12], quality: 0.8, signal: { domains: ['knowledge'], complexity: 'simple', taskType: 'reasoning', shouldUseDAG: false, dagReason: '', intentConfidence: 0.8, criticality: 'normal' } },
      { intent: 5, tools: [], quality: 0.9, signal: { domains: ['knowledge'], complexity: 'simple', taskType: 'chat', shouldUseDAG: false, dagReason: '', intentConfidence: 0.9, criticality: 'low' } },
      { intent: 5, tools: [12], quality: 0.7, signal: { domains: ['knowledge'], complexity: 'medium', taskType: 'reasoning', shouldUseDAG: false, dagReason: '', intentConfidence: 0.7, criticality: 'normal' } },
      { intent: 5, tools: [], quality: 0.85, signal: { domains: ['knowledge'], complexity: 'simple', taskType: 'chat', shouldUseDAG: false, dagReason: '', intentConfidence: 0.85, criticality: 'low' } },
      { intent: 5, tools: [12], quality: 0.75, signal: { domains: ['knowledge'], complexity: 'simple', taskType: 'reasoning', shouldUseDAG: false, dagReason: '', intentConfidence: 0.8, criticality: 'normal' } },
      // conversation
      { intent: 6, tools: [], quality: 0.9, signal: { domains: ['conversation'], complexity: 'simple', taskType: 'chat', shouldUseDAG: false, dagReason: '', intentConfidence: 0.9, criticality: 'low' } },
      { intent: 6, tools: [], quality: 0.85, signal: { domains: ['conversation'], complexity: 'simple', taskType: 'chat', shouldUseDAG: false, dagReason: '', intentConfidence: 0.85, criticality: 'low' } },
      { intent: 6, tools: [], quality: 0.95, signal: { domains: ['conversation'], complexity: 'simple', taskType: 'chat', shouldUseDAG: false, dagReason: '', intentConfidence: 0.95, criticality: 'low' } },
      { intent: 6, tools: [], quality: 0.8, signal: { domains: ['conversation'], complexity: 'simple', taskType: 'chat', shouldUseDAG: false, dagReason: '', intentConfidence: 0.8, criticality: 'low' } },
      { intent: 6, tools: [], quality: 0.9, signal: { domains: ['conversation'], complexity: 'simple', taskType: 'chat', shouldUseDAG: false, dagReason: '', intentConfidence: 0.9, criticality: 'low' } },
      // complex_task
      { intent: 7, tools: [0, 4, 12, 14], quality: 0.5, signal: { domains: ['code', 'system'], complexity: 'complex', taskType: 'reasoning', shouldUseDAG: true, dagReason: 'multi-step', intentConfidence: 0.6, criticality: 'high' } },
      { intent: 7, tools: [0, 1, 4], quality: 0.6, signal: { domains: ['code', 'file'], complexity: 'complex', taskType: 'reasoning', shouldUseDAG: false, dagReason: '', intentConfidence: 0.65, criticality: 'high' } },
      { intent: 7, tools: [12, 0, 4], quality: 0.55, signal: { domains: ['web', 'code'], complexity: 'complex', taskType: 'reasoning', shouldUseDAG: false, dagReason: '', intentConfidence: 0.6, criticality: 'high' } },
      { intent: 7, tools: [0, 3, 4], quality: 0.45, signal: { domains: ['code'], complexity: 'complex', taskType: 'reasoning', shouldUseDAG: true, dagReason: 'multi-step', intentConfidence: 0.55, criticality: 'high' } },
      { intent: 7, tools: [4, 12, 13], quality: 0.5, signal: { domains: ['system', 'web'], complexity: 'complex', taskType: 'reasoning', shouldUseDAG: false, dagReason: '', intentConfidence: 0.6, criticality: 'high' } },
    ];

    // 构建训练样本并写入 ReplayBuffer
    const defaultResources: ResourceState = {
      budgetRemaining: 100, availableNodeCount: 5,
      localCoverageRatio: 0.5, localConfidence: 0.5,
      userCorrectionCount: 0, experienceHit: null,
    };
    const defaultOutcome: DecisionOutcome = {
      success: true, latencyMs: 1000, toolsUsed: [], costEstimate: 0,
    };

    for (const s of SYNTHETIC_SAMPLES) {
      const toolLabels = new Array(32).fill(0);
      for (const t of s.tools) toolLabels[t] = 1;
      this.learner.collectSample(
        '', s.signal, defaultResources,
        s.intent, toolLabels, s.quality,
        { ...defaultOutcome, success: s.quality > 0.5 },
      );
    }

    // 训练 3 轮
    let totalLoss = 0;
    let trainCount = 0;
    for (let epoch = 0; epoch < 3; epoch++) {
      // 每轮重新写入样本（buffer 可能被采样消耗）
      for (const s of SYNTHETIC_SAMPLES) {
        const toolLabels = new Array(32).fill(0);
        for (const t of s.tools) toolLabels[t] = 1;
        this.learner.collectSample(
          '', s.signal, defaultResources,
          s.intent, toolLabels, s.quality,
          { ...defaultOutcome, success: s.quality > 0.5 },
        );
      }
      const result = await this.learner.update();
      totalLoss += result.loss;
      trainCount++;
    }

    if (this.verbose) {
      console.log(`[RightBrain] 冷启动预热完成: ${SYNTHETIC_SAMPLES.length} 样本 × 3 轮, loss=${(totalLoss / trainCount).toFixed(4)}`);
    }

    return { trained: SYNTHETIC_SAMPLES.length * 3, loss: totalLoss / trainCount };
  }

  async predict(
    input: string,
    signal: TaskSignal,
    resources: ResourceState,
    body?: BodyState,
    multimodal?: {
      spatial?: SpatialEncodeInput;
      image?: RawImage;
      sceneGraph?: SceneGraph;
    },
  ): Promise<IntuitionSignal> {
    const encodeInput: EncodeInput = { signal, resources, body };
    if (multimodal) {
      encodeInput.spatial = multimodal.spatial;
      encodeInput.image = multimodal.image;
      encodeInput.sceneGraph = multimodal.sceneGraph;
    }

    // Phase 4: 简单任务快速路径
    const isSimple = signal.complexity === 'simple' || input.length < 30;
    const hasMultimodal = !!(multimodal?.spatial || multimodal?.image || multimodal?.sceneGraph);
    // 安全阀：有经验命中时走标准推理（调度器 Layer 1 依赖 qualityEstimate 精度）
    const hasExperience = !!resources.experienceHit;

    let output;
    if (isSimple && !hasMultimodal && !hasExperience) {
      // 快速编码 + 快速推理（低阈值 early exit + 跳过冗余 heads）
      const tokenIds = encodeFeaturesFast(encodeInput);
      output = this.model.forwardInferenceFast(tokenIds);
    } else if (isSimple || !hasMultimodal) {
      // 标准编码 + 推理模式（跳过 _ctx + 对象池，但不降阈值）
      const tokenIds = encodeFeatures(encodeInput);
      output = this.model.forwardInference(tokenIds);
    } else {
      // 完整路径（多模态需要 spatial/scene heads 的输出）
      const tokenIds = encodeFeatures(encodeInput);
      output = this.model.forward(tokenIds);
    }

    this.predictCount++;

    const result = decodeSignal(output, this.prototypeMemory);
    if (this.verbose && this.predictCount % 100 === 0) {
      console.log(`[RightBrain] 预测 #${this.predictCount}: ${output.latencyMs.toFixed(2)}ms, hit=${result.hit}, fastPath=${isSimple && !hasMultimodal}, protoNovel=${result.protoMatch?.isNovel ?? 'N/A'}`);
    }
    return result;
  }

  /**
   * 获取详细预测结果（含工具概率）
   *
   * Phase 4 优化：此方法只用于调度决策，不参与训练
   * 始终走 forwardInference()（跳过 _ctx + 对象池）
   *
   * Phase 3: 双通道 — 原型工具先验注入 NN 工具概率
   */
  async predictDetailed(
    signal: TaskSignal,
    resources: ResourceState,
    body?: BodyState,
  ): Promise<IntuitionDecision> {
    const tokenIds = encodeFeatures({ signal, resources, body });
    const output = this.model.forwardInference(tokenIds);
    const decision = decodeDecision(output);

    // 原型通道：如果有匹配的原型，用工具先验增强 NN 概率
    if (output._hidden) {
      const match = this.prototypeMemory.findNearest(output._hidden);
      if (match && !match.isNovel) {
        const protoTools = match.prototype.topTools(8);
        const protoDist = match.prototype.toolDist;
        const totalUses = [...protoDist.values()].reduce((a, b) => a + b, 0) || 1;

        // P2-3: 增强匹配 — 用 domainOverlap + intentKeyword 评分获取 top3 候选
        const enhanced = this.prototypeMemory.findBestEnhanced(
          output._hidden,
          signal.domains,
          signal.content ?? '',
          3,
        );
        // 从增强结果中提取额外的工具先验（权重 0.15）
        const enhancedToolBoost = new Map<string, number>();
        for (const candidate of enhanced) {
          if (candidate.score > 0.5) {
            const tools = candidate.prototype.topTools(5);
            for (const tool of tools) {
              enhancedToolBoost.set(tool, (enhancedToolBoost.get(tool) ?? 0) + candidate.score);
            }
          }
        }

        // 将原型工具先验注入 NN 工具概率（加权融合）
        for (const tool of decision.tools) {
          const protoCount = protoDist.get(tool.name) ?? 0;
          if (protoCount > 0) {
            const protoProb = protoCount / totalUses;
            // 融合：NN 概率先验 + 原型频率先验（原型权重 0.3）
            tool.probability = tool.probability * 0.7 + protoProb * 0.3;
          }
          // P2-3: 增强匹配加成
          const boost = enhancedToolBoost.get(tool.name);
          if (boost) {
            tool.probability += boost * 0.15;
          }
        }

        // 补充 NN 没覆盖但原型推荐的工具
        const existingNames = new Set(decision.tools.map(t => t.name));
        for (const toolName of protoTools) {
          if (!existingNames.has(toolName)) {
            const protoCount = protoDist.get(toolName) ?? 0;
            const protoProb = protoCount / totalUses;
            if (protoProb > 0.1) {
              decision.tools.push({ name: toolName, probability: protoProb * 0.3 });
            }
          }
        }

        // 重新排序
        decision.tools.sort((a, b) => b.probability - a.probability);
      }
    }

    return decision;
  }

  /**
   * 在线学习：每次交互后收集样本并更新权重
   */
  async learn(sample: TrainingSample): Promise<void> {
    this.learner.collectSample(
      '', { domains: [], complexity: 'medium', taskType: 'chat', shouldUseDAG: false, dagReason: '', intentConfidence: 0 },
      { budgetRemaining: 0, availableNodeCount: 0, localCoverageRatio: 0, localConfidence: 0, userCorrectionCount: 0, experienceHit: null },
      sample.labelIntent, sample.labelTools, sample.labelQuality,
      { success: sample.outcome, latencyMs: 0, costEstimate: 0, toolsUsed: [] },
    );
    await this.learner.update();
  }

  /**
   * 从交互结果中学习（推荐方式）
   */
  async learnFromOutcome(
    signal: TaskSignal,
    resources: ResourceState,
    body: BodyState | undefined,
    actualIntent: string,
    actualTools: string[],
    outcome: DecisionOutcome,
  ): Promise<{ loss: number; lr: number }> {
    this.learner.collectFromOutcome(signal, resources, body, actualIntent, actualTools, outcome);
    const result = await this.learner.update();
    return { loss: result.loss, lr: result.lr };
  }

  /**
   * 从 DecisionMemory 蒸馏
   */
  async distill(records: DecisionRecord[]): Promise<DistillResult> {
    return this.distiller.distill(records);
  }

  /**
   * 外部样本写入（仅入 Buffer，不触发权重更新）
   * 供信号汇聚层等外部通道使用
   */
  ingestExternalSample(sample: TrainingSample): void {
    this.learner.ingestSample(sample);
  }

  /** 获取学习统计 */
  getLearnStats() {
    return {
      ...this.learner.stats,
      safetyValve: this.learner.safetyValveStatus,
    };
  }

  /** 获取模型信息 */
  getModelInfo(): { params: number; sizeBytes: number; version: number } {
    const params = this.model.countParams();
    return { params, sizeBytes: params * 4, version: this.modelVersion };
  }

  /** 获取场景世界模型（供训练循环使用） */
  getSceneWorldModel(): SceneWorldModel {
    return this.sceneWorldModel;
  }

  /** 获取 Distiller（供外部触发蒸馏） */
  getDistiller(): Distiller {
    return this.distiller;
  }

  /**
   * 扩展意图分类头 — L2 写回入口
   *
   * 新增意图类别，保留已有权重，新类别用 Xavier 初始化
   * 扩展后的训练由在线学习循环自动覆盖
   *
   * @param newIntents 新意图列表
   * @param _samples 预留：相关训练样本（当前由在线学习自动处理）
   */
  async expandIntentHead(
    newIntents: Array<{ label: string; description: string; estimatedSamples: number }>,
    _samples?: Array<{ features: Float32Array; labelIntent: number }>,
  ): Promise<void> {
    const oldCount = this.model.getConfig().numIntents;
    const newCount = oldCount + newIntents.length;

    // 扩展模型的分类头维度（保留已有权重）
    this.model.expandIntentHead(newCount);

    if (this.verbose) {
      console.log(`[RightBrain] 意图分类头扩展: ${oldCount} → ${newCount} (${newIntents.map(i => i.label).join(', ')})`);
    }
  }

  /** 保存模型权重 */
  async save(path: string): Promise<void> {
    saveModel(this.model, path);
    this.modelVersion++;
    if (this.verbose) console.log(`[RightBrain] 模型已保存: ${path} (v${this.modelVersion})`);
  }

  /** 保存量化模型 */
  async saveQuantized(path: string): Promise<void> {
    saveModelQuantized(this.model, path);
    if (this.verbose) console.log(`[RightBrain] 量化模型已保存: ${path}`);
  }

  /** 加载模型权重 */
  async load(path: string): Promise<void> {
    loadModel(this.model, path);
    if (this.verbose) console.log(`[RightBrain] 模型已加载: ${path}`);
  }

  /**
   * 轻量文本分类（兼容 IntentClassifier 接口）
   *
   * 四信号融合：关键词规则 + 原型匹配 + TextEncoder 语义向量 + IntuitionNet
   * 不需要 TaskSignal/ResourceState，用于 collectSignals() 和 message-processor.ts
   *
   * 融合策略：
   *   关键词命中 → 直接用（高精确度）
   *   关键词未命中 + 原型匹配 → 用原型（扩展覆盖）
   *   全未命中 → conversation
   */
  classifyFromText(input: string): {
    category: string;
    confidence: number;
    suggestedTools: string[];
    hit: boolean;
    /** 原型匹配结果（可选） */
    protoMatch?: { prototypeId: string; distance: number; confidence: number };
    /** TextEncoder 输出的池化语义向量（可选，供下游复用） */
    embedding?: Float32Array;
  } {
    // 信号 1: 关键词规则匹配（始终执行，高精确度）
    const keywordResult = this.classifyFromTextRules(input);

    // 信号 2+3: TextEncoder + 原型匹配（有 TextEncoder 时）
    let protoResult: { prototypeId: string; distance: number; confidence: number } | null = null;
    let embedding: Float32Array | undefined;

    if (this.textEncoder) {
      try {
        const textEmb = this.textEncoder.forwardPooled(input); // [1, 128]
        embedding = new Float32Array(textEmb.data);

        // 原型匹配
        const match = this.prototypeMemory.findNearest(embedding);
        if (match && !match.isNovel) {
          protoResult = {
            prototypeId: match.prototype.label,
            distance: match.distance,
            confidence: Math.min(1, match.confidence),
          };
        }
      } catch {
        // TextEncoder/原型匹配失败，降级到纯关键词
      }
    }

    // 融合决策
    return this.fuseSignals(keywordResult, protoResult, embedding);
  }

  /**
   * 四信号融合决策
   */
  private fuseSignals(
    keyword: { category: string; confidence: number; suggestedTools: string[]; hit: boolean },
    proto: { prototypeId: string; distance: number; confidence: number } | null,
    embedding?: Float32Array,
  ): {
    category: string;
    confidence: number;
    suggestedTools: string[];
    hit: boolean;
    protoMatch?: { prototypeId: string; distance: number; confidence: number };
    embedding?: Float32Array;
  } {
    // 关键词命中 → 直接用（高精确度）
    if (keyword.hit && keyword.confidence >= 0.6) {
      return { ...keyword, protoMatch: proto ?? undefined, embedding };
    }

    // 原型匹配命中 → 用原型（扩展覆盖）
    if (proto && proto.confidence > 0.3) {
      const protoTools = this.prototypeMemory.findNearest(embedding!)?.prototype.topTools(4) ?? keyword.suggestedTools;
      return {
        category: proto.prototypeId,
        confidence: proto.confidence,
        suggestedTools: protoTools,
        hit: true,
        protoMatch: proto,
        embedding,
      };
    }

    // 关键词低置信度命中 → 降级使用
    if (keyword.hit) {
      return { ...keyword, protoMatch: proto ?? undefined, embedding };
    }

    // 全未命中 → conversation
    return {
      category: 'conversation',
      confidence: 0.2,
      suggestedTools: [],
      hit: false,
      protoMatch: proto ?? undefined,
      embedding,
    };
  }

  /**
   * 关键词规则匹配（兜底路径，零延迟）
   * 基于 intent-classifier.ts 的相同逻辑
   */
  private classifyFromTextRules(input: string): {
    category: string;
    confidence: number;
    suggestedTools: string[];
    hit: boolean;
  } {
    const lower = input.toLowerCase();

    const rules: Array<{ category: string; keywords: string[]; tools: string[] }> = [
      { category: 'file_operations', keywords: ['读', '查看', '打开', '写', '创建', '保存', '删除', '移动', '复制', 'read', 'cat', 'write', 'create', 'save', 'delete', 'move', 'copy', '文件', 'file', '目录', 'folder', 'ls', 'dir'], tools: ['read_file', 'write_file', 'list_files', 'exec'] },
      { category: 'code_operations', keywords: ['代码', 'code', '函数', 'function', '类', 'class', '模块', 'module', '分析', 'analyze', '重构', 'refactor', '搜索', 'search', 'grep', '测试', 'test', '构建', 'build', '编译', 'compile', 'lint', '快排', '排序', '算法', 'bug', 'debug', '修复', 'fix'], tools: ['read_file', 'write_file', 'exec', 'search_files', 'code_intel'] },
      { category: 'git_operations', keywords: ['git', '提交', 'commit', '分支', 'branch', '合并', 'merge', '推送', 'push', '拉取', 'pull', 'diff', 'log', 'checkout', 'stash', 'rebase'], tools: ['git_status', 'git_diff', 'git_commit', 'git_branch', 'exec'] },
      { category: 'web_operations', keywords: ['搜', '搜索', 'search', 'google', '百度', 'bing', '网页', 'web', 'url', '链接', '抓取', 'fetch', '爬', '天气', 'weather', '访问', 'visit', 'browse'], tools: ['search_web', 'fetch_url', 'browse'] },
      { category: 'system_operations', keywords: ['运行', 'run', '执行', 'exec', '命令', 'command', '进程', 'process', '端口', 'port', '服务', 'service', '安装', 'install', '配置', 'config', 'docker', 'npm', 'pip', 'yarn', 'ps', 'top'], tools: ['exec', 'get_time'] },
      { category: 'knowledge_query', keywords: ['是什么', '什么是', '为什么', '怎么', '如何', '区别', '原理', 'what is', 'why', 'how to', 'explain', 'difference', '推荐', 'recommend', '建议', 'suggest', '对比', '比较', 'compare'], tools: ['search_web'] },
      { category: 'data_analysis', keywords: ['数据', 'data', '统计', '图表', 'chart', '画图', 'plot', 'csv', 'excel', '表格', 'table', '指标', 'metric', '趋势', 'trend', '聚合', 'aggregate', '可视化', 'visualize'], tools: ['read_file', 'exec', 'code_intel'] },
      { category: 'devops', keywords: ['docker', '容器', 'container', '部署', 'deploy', 'ci/cd', 'pipeline', 'nginx', 'k8s', 'kubernetes', '镜像', 'image', 'compose', '服务器', 'server', '域名', 'domain', 'ssl'], tools: ['exec', 'read_file', 'write_file'] },
      { category: 'writing', keywords: ['写', 'write', '文档', 'document', '文章', 'article', '润色', 'polish', '翻译', 'translate', '总结', 'summarize', '摘要', 'abstract', '报告', 'report', 'readme', '文案'], tools: ['read_file', 'write_file', 'search_web'] },
      { category: 'debugging', keywords: ['debug', '调试', '排查', 'troubleshoot', '报错', 'error', '异常', 'exception', '日志', 'log', '崩溃', 'crash', '堆栈', 'stack', 'trace', '内存泄漏', 'memory leak', '性能', 'performance'], tools: ['exec', 'read_file', 'search_files', 'code_intel'] },
      { category: 'planning', keywords: ['规划', 'plan', '架构', 'architecture', '设计', 'design', '方案', 'proposal', '需求', 'requirement', '拆解', 'breakdown', '排期', 'schedule', '评审', 'review', '技术选型'], tools: ['read_file', 'write_file', 'search_web'] },
    ];

    let bestCategory = 'conversation';
    let bestConfidence = 0.2;
    let bestTools: string[] = [];
    let bestHit = false;

    for (const rule of rules) {
      const matchedKeywords = rule.keywords.filter(k => lower.includes(k));
      if (matchedKeywords.length > 0) {
        const confidence = Math.min(0.95, 0.5 + matchedKeywords.length * 0.15);
        if (confidence > bestConfidence) {
          bestCategory = rule.category;
          bestConfidence = confidence;
          bestTools = rule.tools;
          bestHit = true;
        }
      }
    }

    return { category: bestCategory, confidence: bestConfidence, suggestedTools: bestTools, hit: bestHit };
  }

  /**
   * 设置 TextEncoder（外部注入，可选）
   */
  setTextEncoder(encoder: TextEncoder): void {
    this.textEncoder = encoder;
    if (this.verbose) {
      console.log(`[RightBrain] TextEncoder 已注入: ${encoder.countParams()} 参数`);
    }
  }

  /** 获取 TextEncoder 实例（可为 null） */
  getTextEncoder(): TextEncoder | null {
    return this.textEncoder;
  }

  // ── 影子大脑数据接口 ──

  /** 获取 NN 配置（供影子大脑读取） */
  getNNConfig(): NNConfig {
    return { ...this.config.nn };
  }

  /** 获取 NN 权重快照（每个 Tensor 的 Float32Array 副本） */
  getNNWeights(): Float32Array[] {
    return this.model.parameters().map(t => new Float32Array(t.data));
  }

  /** 获取最近的训练 loss（供时机控制器判断稳定性） */
  getRecentLosses(): number[] {
    return this.learner.getRecentLosses();
  }

  // ── 脑内构图（World Model）──

  /**
   * 脑内构图：给定当前场景 + 动作序列，预测未来状态
   *
   * 使用 GNN 场景世界模型，支持结构化实体预测
   *
   * @param scene 当前场景图（可选，无则从 tokens 构建）
   * @param tokens 当前状态的 token 序列（兼容旧接口）
   * @param actions 候选动作序列
   * @returns 每一步的预测结果
   */
  imagine(
    tokens: number[],
    actions: Array<{ type: number; params?: number[] }>,
    scene?: SceneGraph,
  ): PredictionResult[] {
    // 优先使用 SceneWorldModel
    const targetScene = scene ?? this.buildSceneFromTokens(tokens);
    const sceneActions: SceneAction[] = actions.map(a => ({
      type: String(a.type),
      params: new Float32Array(a.params ?? []),
    }));

    const sceneResults = this.sceneWorldModel.imagine(targetScene, sceneActions);

    // 转换为旧格式（兼容）
    return sceneResults.map((r, i) => ({
      nextLatent: this.sceneToLatent(r.nextScene),
      spatialDelta: this.extractSpatialDelta(r),
      topologyChangeProb: r.edgeChanges.length > 0 ? 0.8 : 0.1,
      confidence: r.confidence,
      latencyMs: r.latencyMs,
    }));
  }

  /**
   * 快速预评估：预测单一动作的后果
   */
  predictFuture(tokens: number[], actionType: number, params?: number[]): PredictionResult {
    const scene = this.buildSceneFromTokens(tokens);
    const action: SceneAction = {
      type: String(actionType),
      params: new Float32Array(params ?? []),
    };

    const result = this.sceneWorldModel.predict(scene, action);

    return {
      nextLatent: this.sceneToLatent(result.nextScene),
      spatialDelta: this.extractSpatialDelta(result),
      topologyChangeProb: result.edgeChanges.length > 0 ? 0.8 : 0.1,
      confidence: result.confidence,
      latencyMs: result.latencyMs,
    };
  }

  /**
   * 多方案对比：对多个候选动作分别预测，返回置信度最高的
   */
  bestAction(
    tokens: number[],
    candidates: Array<{ type: number; params?: number[]; label: string }>,
  ): { label: string; prediction: PredictionResult } | null {
    if (candidates.length === 0) return null;

    const scene = this.buildSceneFromTokens(tokens);
    const sceneCandidates = candidates.map(c => ({
      action: {
        type: String(c.type),
        params: new Float32Array(c.params ?? []),
      } as SceneAction,
      label: c.label,
    }));

    const best = this.sceneWorldModel.bestAction(scene, sceneCandidates);
    if (!best) return null;

    return {
      label: best.label,
      prediction: {
        nextLatent: this.sceneToLatent(best.prediction.nextScene),
        spatialDelta: this.extractSpatialDelta(best.prediction),
        topologyChangeProb: best.prediction.edgeChanges.length > 0 ? 0.8 : 0.1,
        confidence: best.prediction.confidence,
        latencyMs: best.prediction.latencyMs,
      },
    };
  }

  /**
   * 场景世界模型预测（新接口，返回结构化结果）
   */
  predictScene(scene: SceneGraph, action: SceneAction): ScenePredictionResult {
    return this.sceneWorldModel.predict(scene, action);
  }

  /**
   * 场景世界模型多步想象（新接口）
   */
  imagineScene(scene: SceneGraph, actions: SceneAction[]): ScenePredictionResult[] {
    return this.sceneWorldModel.imagine(scene, actions);
  }

  // ── 内部辅助 ──

  /** 从 token 序列构建简化 SceneGraph */
  private buildSceneFromTokens(tokens: number[]): SceneGraph {
    const nodes = [];
    const seen = new Set<number>();
    for (const token of tokens) {
      const dim = token % 64;
      if (!seen.has(dim) && nodes.length < 32) {
        seen.add(dim);
        nodes.push({
          id: `token_${dim}`,
          category: 'unknown',
          attributes: { token_value: token },
          importance: Math.abs(Math.sin(token)),
        });
      }
    }
    const edges = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      edges.push({
        source: nodes[i].id,
        target: nodes[i + 1].id,
        relation: 'similar_to',
        confidence: 0.5,
      });
    }
    return { nodes, edges };
  }

  /** SceneGraph → latent（兼容旧接口） */
  private sceneToLatent(scene: SceneGraph): Float32Array {
    const dim = this.config.nn.hiddenDim;
    const latent = new Float32Array(dim);
    for (const node of scene.nodes) {
      const hash = this.hashString(node.id);
      latent[hash % dim] += (node.importance ?? 0.5) / scene.nodes.length;
    }
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += latent[i] * latent[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++) latent[i] /= norm;
    return latent;
  }

  /** 提取空间偏移 */
  private extractSpatialDelta(result: ScenePredictionResult): Float32Array {
    const delta = new Float32Array(6);
    for (let i = 0; i < Math.min(6, result.entityChanges.length); i++) {
      const change = result.entityChanges[i];
      delta[i] = change.positionDelta[i % 3] ?? 0;
    }
    return delta;
  }

  /** 字符串哈希 */
  private hashString(s: string): number {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) - hash) + s.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  /**
   * 从 intentHead 权重提取种子原型
   *
   * intentHead 的 w2 矩阵 [hiddenDim, numIntents] 的每一列
   * 代表一个意图类别在 hidden 空间的方向，用作种子原型的 centroid。
   */
  private seedPrototypeMemory(): void {
    const INTENT_LABELS = [
      'file_operations', 'code_operations', 'git_operations', 'web_operations',
      'system_operations', 'knowledge_query', 'conversation', 'complex_task',
    ];

    // 从 OutputHeads 获取 intentHead 的 w2 权重
    const intentHead = (this.model as any).heads.intentHead;
    const w2 = intentHead.w2; // Tensor [hiddenDim, numIntents]
    const hiddenDim = w2.shape[0];
    const numIntents = w2.shape[1];

    for (let i = 0; i < numIntents; i++) {
      // 提取第 i 列（第 i 个意图的方向向量）
      const col = new Float32Array(hiddenDim);
      for (let h = 0; h < hiddenDim; h++) {
        col[h] = w2.data[h * numIntents + i];
      }

      // L2 归一化
      let norm = 0;
      for (let h = 0; h < hiddenDim; h++) norm += col[h] * col[h];
      norm = Math.sqrt(norm) || 1;
      for (let h = 0; h < hiddenDim; h++) col[h] /= norm;

      // Phase 1-B2: 从意图-工具映射填充种子原型的 toolDist
      const DOMAIN_TOOLS: Record<string, string[]> = {
        'file_operations': ['read_file', 'write_file', 'list_files', 'search_files'],
        'code_operations': ['read_file', 'write_file', 'exec', 'search_files', 'analyze_file'],
        'git_operations': ['exec', 'git_status', 'git_log', 'git_diff', 'git_commit'],
        'web_operations': ['search_web', 'fetch_url'],
        'system_operations': ['exec'],
        'knowledge_query': ['fetch_url', 'search_web'],
        'conversation': [],
        'complex_task': ['exec'],
      };
      const protoLabel = INTENT_LABELS[i] ?? `intent_${i}`;
      const seedToolDist = new Map<string, number>();
      const seedToolSuccess = new Map<string, { attempts: number; successes: number }>();
      for (const tool of DOMAIN_TOOLS[protoLabel] ?? []) {
        seedToolDist.set(tool, 1);
        seedToolSuccess.set(tool, { attempts: 1, successes: 1 });
      }

      this.prototypeMemory.addPrototype({
        id: `seed_${INTENT_LABELS[i] ?? i}`,
        label: protoLabel,
        centroid: col,
        count: 0,
        toolDist: seedToolDist,
        toolSuccess: seedToolSuccess,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        isSeed: true,
        tags: ['seed', 'intent_head'],
        qualityScore: 1.0,   // 种子初始满分
        failureStreak: 0,
      });
    }
  }

  destroy(): void {}
}
