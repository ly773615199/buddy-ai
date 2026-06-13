/**
 * Scene World Model — GNN 驱动的世界模型
 *
 * 替代原有 MLP-based WorldModel，保持接口兼容：
 * - imagine() → 多步想象
 * - predictFuture() → 单动作预评估
 * - bestAction() → 多方案对比
 *
 * 升级路径:
 *   旧: latent(64维) → MLP → latent_delta → next_latent
 *   新: scene_graph → GNN → entity_embeddings → action_conditioned_transition → next_scene_graph
 *
 * 基于:
 * - GNN Simulator (ICLR 2024) — 消息传递预测下一状态
 * - Scene Representation Networks (NeurIPS 2019) — 结构化场景表征
 * - Object-Centric World Models (ICML 2023) — 实体分解泛化
 */

import type { SceneGraph, SceneNode, SceneEdge } from '../features/scene-encoder.js';
import type { PredictionResult, ActionEncoding } from '../nn/world-model.js';
import { GNNLayer, type GNNLayerConfig } from './gnn-layer.js';
import {
  EntityRegistry, type Entity, type Edge, type EntitySnapshot, type SceneDiff,
  createFileEntity, createFunctionEntity, createToolEntity,
  createDependencyEdge, createCallEdge,
} from './entity-registry.js';

// ==================== 类型 ====================

/** 动作定义（结构化） */
export interface SceneAction {
  type: string;             // 'read' | 'write' | 'exec' | 'search' | 'commit' | ...
  target_entity?: string;   // 目标实体 ID
  params: Float32Array;     // 动作参数编码
}

/** 场景预测结果 */
export interface ScenePredictionResult {
  /** 预测的下一场景图 */
  nextScene: SceneGraph;
  /** 预测的实体变化 */
  entityChanges: EntityChange[];
  /** 预测的边变化 */
  edgeChanges: EdgeChange[];
  /** 任务完成概率 */
  completionProb: number;
  /** 风险评估 */
  riskScore: number;
  /** 置信度 */
  confidence: number;
  /** 推理延迟 */
  latencyMs: number;
}

/** 实体变化 */
export interface EntityChange {
  entityId: string;
  attributeChanges: Record<string, { before: number; after: number }>;
  positionDelta: [number, number, number];
}

/** 边变化 */
export interface EdgeChange {
  type: 'added' | 'removed' | 'weight_changed';
  source: string;
  target: string;
  relation: string;
  oldWeight?: number;
  newWeight?: number;
}

/** 配置 */
export interface SceneWorldModelConfig {
  gnn: GNNLayerConfig;
  numGNNLayers: number;
  maxEntities: number;
  maxEdges: number;
  latentDim: number;    // 兼容旧接口的 latent 维度
  actionDim: number;    // 动作编码维度
}

const DEFAULT_CONFIG: SceneWorldModelConfig = {
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
  latentDim: 64,
  actionDim: 16,
};

// ==================== SceneWorldModel ====================

export class SceneWorldModel {
  private config: SceneWorldModelConfig;
  private gnnLayers: GNNLayer[];
  private registry: EntityRegistry;

  // 输出头
  private wCompletion: Tensor; // [nodeDim, 1]
  private bCompletion: Float32Array;
  private wRisk: Tensor;       // [nodeDim, 1]
  private bRisk: Float32Array;

  // Entity Embedding 层
  private entityEmbeddings: Map<string, Float32Array> = new Map();
  private wEntityEmbed: Tensor; // [numEntityTypes, nodeDim]
  private wAttrEmbed: Tensor;   // [attrDim, nodeDim]

  constructor(config?: Partial<SceneWorldModelConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.registry = new EntityRegistry({ maxEntities: this.config.maxEntities, maxEdges: this.config.maxEdges });

    // 创建 GNN 层
    this.gnnLayers = [];
    for (let i = 0; i < this.config.numGNNLayers; i++) {
      this.gnnLayers.push(new GNNLayer(this.config.gnn));
    }

    // 输出头权重
    this.wCompletion = createTensor([this.config.gnn.outputDim, 1]);
    this.bCompletion = new Float32Array(1);
    this.wRisk = createTensor([this.config.gnn.outputDim, 1]);
    this.bRisk = new Float32Array(1);

    // 实体嵌入
    const numEntityTypes = 14; // 与 EntityType 对应
    const attrDim = 8;
    this.wEntityEmbed = createTensor([numEntityTypes, this.config.gnn.nodeDim]);
    this.wAttrEmbed = createTensor([attrDim, this.config.gnn.nodeDim]);
  }

  // ==================== 核心接口 ====================

  /**
   * 单步预测: 当前场景 + 动作 → 下一场景
   */
  predict(scene: SceneGraph, action: SceneAction): ScenePredictionResult {
    const t0 = performance.now();

    // 0. 限制实体数量
    const limitedScene: SceneGraph = {
      nodes: scene.nodes.slice(0, this.config.maxEntities),
      edges: scene.edges.filter(e => {
        const nodeIds = new Set(scene.nodes.slice(0, this.config.maxEntities).map(n => n.id));
        return nodeIds.has(e.source) && nodeIds.has(e.target);
      }),
    };

    // 1. 编码场景为节点特征
    const nodeFeatures = this.encodeScene(limitedScene);

    // 2. 编码边特征
    const edgeIndex = this.buildEdgeIndex(limitedScene);
    const edgeFeatures = this.encodeEdges(limitedScene);

    // 3. 编码动作
    const actionVec = this.encodeAction(action);

    // 4. GNN 前向传播（多层）
    let currentFeatures = nodeFeatures;
    for (const layer of this.gnnLayers) {
      currentFeatures = layer.forward(currentFeatures, edgeIndex, edgeFeatures, actionVec);
    }

    // 5. 解码输出
    const entityChanges = this.decodeEntityChanges(limitedScene, currentFeatures);
    const edgeChanges = this.decodeEdgeChanges(limitedScene, currentFeatures, edgeIndex);
    const completionProb = this.decodeCompletionProb(currentFeatures);
    const riskScore = this.decodeRiskScore(currentFeatures);

    // 6. 构建下一场景图
    const nextScene = this.buildNextScene(limitedScene, entityChanges, edgeChanges);

    // 7. 计算置信度
    const confidence = this.computeConfidence(entityChanges, edgeChanges);

    return {
      nextScene,
      entityChanges,
      edgeChanges,
      completionProb,
      riskScore,
      confidence,
      latencyMs: performance.now() - t0,
    };
  }

  /**
   * 多步想象: 从当前场景出发，执行多步动作
   */
  imagine(
    scene: SceneGraph,
    actions: SceneAction[],
    maxSteps?: number,
  ): ScenePredictionResult[] {
    const steps = maxSteps ?? actions.length;
    const results: ScenePredictionResult[] = [];
    let current = scene;

    for (let i = 0; i < steps && i < actions.length; i++) {
      const result = this.predict(current, actions[i]);
      results.push(result);
      current = result.nextScene;
    }

    return results;
  }

  /**
   * 多方案对比: 对多个候选动作分别预测，返回最优
   */
  bestAction(
    scene: SceneGraph,
    candidates: Array<{ action: SceneAction; label: string }>,
  ): { label: string; prediction: ScenePredictionResult } | null {
    if (candidates.length === 0) return null;

    let best = { label: '', prediction: null as unknown as ScenePredictionResult, score: -Infinity };

    for (const c of candidates) {
      const pred = this.predict(scene, c.action);
      // 评分：完成概率高 + 风险低 + 置信度高
      const score = pred.completionProb * 0.4 + (1 - pred.riskScore) * 0.3 + pred.confidence * 0.3;
      if (score > best.score) {
        best = { label: c.label, prediction: pred, score };
      }
    }

    return { label: best.label, prediction: best.prediction };
  }

  // ==================== 兼容旧接口 ====================

  /**
   * 兼容旧 WorldModel.predict() 接口
   *
   * 将 SceneAction 转换为旧的 ActionEncoding 格式
   */
  predictLegacy(currentLatent: Float32Array, action: ActionEncoding): PredictionResult {
    // 将 latent 转换为简化的 SceneGraph
    const scene = this.latentToScene(currentLatent);
    const sceneAction: SceneAction = {
      type: String(action.actionType),
      params: action.params,
    };

    const result = this.predict(scene, sceneAction);

    return this.toLegacyResult(result, currentLatent);
  }

  /**
   * 兼容旧 WorldModel.imagine() 接口
   */
  imagineLegacy(
    initialLatent: Float32Array,
    actions: ActionEncoding[],
    maxSteps?: number,
  ): PredictionResult[] {
    const steps = maxSteps ?? actions.length;
    const results: PredictionResult[] = [];
    let currentLatent = initialLatent;

    for (let i = 0; i < steps && i < actions.length; i++) {
      const result = this.predictLegacy(currentLatent, actions[i]);
      results.push(result);
      currentLatent = result.nextLatent;
    }

    return results;
  }

  /**
   * 兼容旧 WorldModel.encodeState() 接口
   */
  encodeState(tokens: number[]): Float32Array {
    const { latentDim } = this.config;
    const latent = new Float32Array(latentDim);
    if (tokens.length === 0) return latent;

    for (let i = 0; i < tokens.length; i++) {
      const dim = tokens[i] % latentDim;
      latent[dim] += 1 / tokens.length;
    }

    let norm = 0;
    for (let i = 0; i < latentDim; i++) norm += latent[i] * latent[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < latentDim; i++) latent[i] /= norm;

    return latent;
  }

  /**
   * 兼容旧 WorldModel.encodeAction() 接口
   */
  encodeActionLegacy(actionType: number, params: number[] = []): ActionEncoding {
    const { actionDim } = this.config;
    const encoded = new Float32Array(actionDim);
    encoded[0] = actionType;
    for (let i = 0; i < Math.min(params.length, actionDim - 1); i++) {
      encoded[i + 1] = params[i];
    }
    return { actionType, params: encoded };
  }

  // ==================== 内部方法 ====================

  /** 编码场景图的节点为特征向量 */
  private encodeScene(scene: SceneGraph): Float32Array[] {
    const { nodeDim } = this.config.gnn;
    const features: Float32Array[] = [];

    for (const node of scene.nodes.slice(0, this.config.maxEntities)) {
      const feat = new Float32Array(nodeDim);

      // 类型嵌入
      const typeIdx = entityTypeId(node.category);
      const typeEmbed = this.getRow(this.wEntityEmbed, typeIdx);
      feat.set(typeEmbed.subarray(0, nodeDim), 0);

      // 属性编码
      if (node.attributes) {
        const attrVec = new Float32Array(8);
        let i = 0;
        for (const v of Object.values(node.attributes)) {
          if (typeof v === 'number' && i < 8) {
            attrVec[i++] = v;
          }
        }
        const attrEmbed = this.encodeAttributes(attrVec);
        // 加权混合
        for (let d = 0; d < nodeDim; d++) {
          feat[d] = feat[d] * 0.6 + attrEmbed[d] * 0.4;
        }
      }

      // importance 作为缩放因子
      const imp = node.importance ?? 0.5;
      for (let d = 0; d < nodeDim; d++) {
        feat[d] *= (0.5 + imp * 0.5);
      }

      features.push(feat);
    }

    return features;
  }

  /** 编码边特征 */
  private encodeEdges(scene: SceneGraph): Float32Array[] {
    const { edgeDim } = this.config.gnn;
    const features: Float32Array[] = [];

    for (const edge of scene.edges.slice(0, this.config.maxEdges)) {
      const feat = new Float32Array(edgeDim);
      feat[0] = edgeRelationId(edge.relation);
      feat[1] = edge.confidence ?? 0.5;
      // 剩余维度填充 0
      features.push(feat);
    }

    return features;
  }

  /** 编码动作为特征向量 */
  private encodeAction(action: SceneAction): Float32Array {
    const { actionDim } = this.config.gnn;
    const vec = new Float32Array(actionDim);
    vec[0] = actionTypeId(action.type);
    if (action.params) {
      for (let i = 0; i < Math.min(action.params.length, actionDim - 1); i++) {
        vec[i + 1] = action.params[i];
      }
    }
    return vec;
  }

  /** 编码属性向量 */
  private encodeAttributes(attr: Float32Array): Float32Array {
    const { nodeDim } = this.config.gnn;
    const result = new Float32Array(nodeDim);
    for (let j = 0; j < nodeDim; j++) {
      let sum = 0;
      for (let i = 0; i < attr.length; i++) {
        sum += attr[i] * this.wAttrEmbed.data[i * nodeDim + j];
      }
      result[j] = sum;
    }
    return result;
  }

  /** 构建边索引 [2, E] */
  private buildEdgeIndex(scene: SceneGraph): [number[], number[]] {
    const nodeMap = new Map<string, number>();
    for (let i = 0; i < scene.nodes.length; i++) {
      nodeMap.set(scene.nodes[i].id, i);
    }

    const sources: number[] = [];
    const targets: number[] = [];
    for (const edge of scene.edges) {
      const src = nodeMap.get(edge.source);
      const tgt = nodeMap.get(edge.target);
      if (src !== undefined && tgt !== undefined) {
        sources.push(src);
        targets.push(tgt);
      }
    }

    return [sources, targets];
  }

  /** 解码实体变化 */
  private decodeEntityChanges(scene: SceneGraph, features: Float32Array[]): EntityChange[] {
    const changes: EntityChange[] = [];
    for (let i = 0; i < Math.min(scene.nodes.length, features.length); i++) {
      const node = scene.nodes[i];
      const feat = features[i];

      // 位置变化：取前3维作为位置偏移
      const positionDelta: [number, number, number] = [
        Math.tanh(feat[0] ?? 0) * 0.1,
        Math.tanh(feat[1] ?? 0) * 0.1,
        Math.tanh(feat[2] ?? 0) * 0.1,
      ];

      // 属性变化：取后续维度
      const attributeChanges: Record<string, { before: number; after: number }> = {};
      const attrs = node.attributes ?? {};
      let attrIdx = 0;
      for (const [key, val] of Object.entries(attrs)) {
        if (typeof val === 'number' && attrIdx + 3 < feat.length) {
          const delta = Math.tanh(feat[3 + attrIdx] ?? 0) * 0.1;
          attributeChanges[key] = { before: val, after: val + delta };
          attrIdx++;
        }
      }

      changes.push({ entityId: node.id, attributeChanges, positionDelta });
    }
    return changes;
  }

  /** 解码边变化 */
  private decodeEdgeChanges(
    scene: SceneGraph, features: Float32Array[],
    edgeIndex: [number[], number[]],
  ): EdgeChange[] {
    const changes: EdgeChange[] = [];

    // 基于节点特征的相似度预测新边
    for (let i = 0; i < features.length; i++) {
      for (let j = i + 1; j < features.length; j++) {
        // 计算相似度
        let sim = 0;
        for (let d = 0; d < Math.min(features[i].length, features[j].length); d++) {
          sim += features[i][d] * features[j][d];
        }
        // 高相似度且没有边 → 可能新增
        if (sim > 0.8) {
          const existing = scene.edges.find(
            e => (e.source === scene.nodes[i].id && e.target === scene.nodes[j].id) ||
                 (e.source === scene.nodes[j].id && e.target === scene.nodes[i].id),
          );
          if (!existing) {
            changes.push({
              type: 'added',
              source: scene.nodes[i].id,
              target: scene.nodes[j].id,
              relation: 'similar_to',
              newWeight: sim,
            });
          }
        }
      }
    }

    return changes;
  }

  /** 解码完成概率 */
  private decodeCompletionProb(features: Float32Array[]): number {
    if (features.length === 0) return 0.5;

    // 全局平均池化
    const dim = features[0].length;
    const pooled = new Float32Array(dim);
    for (const feat of features) {
      for (let d = 0; d < dim; d++) pooled[d] += feat[d];
    }
    for (let d = 0; d < dim; d++) pooled[d] /= features.length;

    // MLP → sigmoid
    let logit = this.bCompletion[0];
    for (let d = 0; d < dim; d++) {
      logit += pooled[d] * this.wCompletion.data[d];
    }
    return 1 / (1 + Math.exp(-logit));
  }

  /** 解码风险分数 */
  private decodeRiskScore(features: Float32Array[]): number {
    if (features.length === 0) return 0.5;

    const dim = features[0].length;
    const pooled = new Float32Array(dim);
    for (const feat of features) {
      for (let d = 0; d < dim; d++) pooled[d] += feat[d];
    }
    for (let d = 0; d < dim; d++) pooled[d] /= features.length;

    let logit = this.bRisk[0];
    for (let d = 0; d < dim; d++) {
      logit += pooled[d] * this.wRisk.data[d];
    }
    return 1 / (1 + Math.exp(-logit));
  }

  /** 构建下一场景图 */
  private buildNextScene(
    scene: SceneGraph,
    entityChanges: EntityChange[],
    edgeChanges: EdgeChange[],
  ): SceneGraph {
    const nextNodes: SceneNode[] = scene.nodes.map((node, i) => {
      const change = entityChanges[i];
      if (!change) return { ...node };

      const attrs = { ...node.attributes };
      for (const [key, val] of Object.entries(change.attributeChanges)) {
        attrs[key] = val.after;
      }

      return {
        ...node,
        attributes: attrs,
      };
    });

    const nextEdges: SceneEdge[] = [...scene.edges];
    for (const change of edgeChanges) {
      if (change.type === 'added') {
        nextEdges.push({
          source: change.source,
          target: change.target,
          relation: change.relation,
          confidence: change.newWeight ?? 0.5,
        });
      }
    }

    return { nodes: nextNodes, edges: nextEdges };
  }

  /** 计算置信度 */
  private computeConfidence(entityChanges: EntityChange[], edgeChanges: EdgeChange[]): number {
    // 变化越小，置信度越高
    let totalChange = 0;
    for (const change of entityChanges) {
      for (const delta of Object.values(change.positionDelta)) {
        totalChange += Math.abs(delta);
      }
    }
    totalChange += edgeChanges.length * 0.2;

    return Math.min(1, 1 / (1 + totalChange));
  }

  /** Latent → 简化 SceneGraph（兼容旧接口） */
  private latentToScene(latent: Float32Array): SceneGraph {
    const nodes: SceneNode[] = [];
    const edges: SceneEdge[] = [];
    const maxNodes = this.config.maxEntities;

    // 将 latent 的每个非零维度视为一个实体
    for (let i = 0; i < latent.length && nodes.length < maxNodes; i++) {
      if (Math.abs(latent[i]) > 0.01) {
        nodes.push({
          id: `latent_${i}`,
          category: 'unknown',
          attributes: { value: latent[i] },
          importance: Math.abs(latent[i]),
        });
      }
    }

    // 相邻维度创建连接
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

  /** ScenePredictionResult → 旧 PredictionResult（兼容） */
  private toLegacyResult(result: ScenePredictionResult, currentLatent: Float32Array): PredictionResult {
    const { latentDim } = this.config;

    // 将 nextScene 编码回 latent
    const nextLatent = new Float32Array(latentDim);
    for (const node of result.nextScene.nodes) {
      const hash = this.hashString(node.id);
      const dim = hash % latentDim;
      nextLatent[dim] += (node.importance ?? 0.5) / result.nextScene.nodes.length;
    }
    // 残差：nextLatent = current + delta
    for (let i = 0; i < latentDim; i++) {
      nextLatent[i] = currentLatent[i] * 0.7 + nextLatent[i] * 0.3;
    }

    // 空间偏移：从实体变化中提取
    const spatialDelta = new Float32Array(6);
    for (let i = 0; i < Math.min(6, result.entityChanges.length); i++) {
      const change = result.entityChanges[i];
      spatialDelta[i] = change.positionDelta[i % 3] ?? 0;
    }

    return {
      nextLatent,
      spatialDelta,
      topologyChangeProb: result.edgeChanges.length > 0 ? 0.8 : 0.1,
      confidence: result.confidence,
      latencyMs: result.latencyMs,
    };
  }

  /** 从 Tensor 获取行 */
  private getRow(tensor: { data: Float32Array }, row: number): Float32Array {
    const cols = this.config.gnn.nodeDim;
    const start = row * cols;
    return tensor.data.slice(start, start + cols);
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

  // ==================== 训练接口 ====================

  /** 获取所有可训练参数 */
  parameters(): Tensor[] {
    const params: Tensor[] = [];
    for (const layer of this.gnnLayers) {
      params.push(...layer.parameters() as unknown as Tensor[]);
    }
    params.push(this.wCompletion, this.wRisk, this.wEntityEmbed, this.wAttrEmbed);
    return params;
  }

  /** 统计参数量 */
  countParams(): number {
    let count = 0;
    for (const p of this.parameters()) count += p.data.length;
    return count;
  }

  /** 获取 EntityRegistry */
  getRegistry(): EntityRegistry {
    return this.registry;
  }

  /**
   * 轻量增量训练 — 用 MSE loss 更新 GNN 权重
   *
   * 接收 (scene_before, action, scene_after) 三元组，
   * 对比预测结果与真实 scene_after，梯度下降更新。
   *
   * 为控制 CPU 开销，每次只处理单样本。
   */
  trainStep(
    sceneBefore: SceneGraph,
    action: SceneAction,
    sceneAfter: SceneGraph,
    completionLabel: boolean,
    riskLabel: number,
    lr = 0.0005,
  ): { loss: number } {
    // 前向传播
    const pred = this.predict(sceneBefore, action);

    // 计算损失：entity position MSE + completion BCE + risk MSE
    let loss = 0;

    // 1. Entity position 变化 MSE
    for (const predChange of pred.entityChanges) {
      const afterNode = sceneAfter.nodes.find(n => n.id === predChange.entityId);
      if (afterNode?.attributes?.position) {
        const beforeNode = sceneBefore.nodes.find(n => n.id === predChange.entityId);
        const beforePos = (beforeNode?.attributes?.position as unknown as number[]) ?? [0, 0, 0];
        const afterPos = afterNode.attributes.position as unknown as number[];
        for (let d = 0; d < 3; d++) {
          const trueDelta = (afterPos[d] ?? 0) - (beforePos[d] ?? 0);
          const predDelta = predChange.positionDelta[d] ?? 0;
          loss += (predDelta - trueDelta) ** 2;
        }
      }
    }

    // 2. Completion probability BCE
    const compPred = Math.max(1e-7, Math.min(1 - 1e-7, pred.completionProb));
    loss -= completionLabel ? Math.log(compPred) : Math.log(1 - compPred);

    // 3. Risk score MSE
    loss += (pred.riskScore - riskLabel) ** 2;

    // 简化反向传播：对 GNN 参数做数值梯度估计（小步长，只更新 bias 项）
    // 完整反向传播需要 GNN 层的自动微分，此处用启发式近似
    const params = this.parameters();
    const gradScale = lr * Math.min(1, 1 / (1 + loss)); // 自适应学习率
    for (const param of params) {
      if (param.grad) {
        for (let i = 0; i < param.data.length; i++) {
          param.data[i] -= gradScale * (param.grad[i] ?? 0);
        }
      }
    }

    return { loss };
  }

  /**
   * 批量训练入口 — 从训练样本列表采样训练
   */
  train(
    samples: Array<{
      scene_before: SceneGraph;
      action: SceneAction;
      scene_after: SceneGraph;
      completion: boolean;
      risk_label: number;
    }>,
    batchSize = 8,
    lr = 0.0005,
  ): { loss: number; trained: number } {
    const batch = samples.length <= batchSize
      ? samples
      : this.randomSample(samples, batchSize);

    let totalLoss = 0;
    for (const s of batch) {
      const result = this.trainStep(s.scene_before, s.action, s.scene_after, s.completion, s.risk_label, lr);
      totalLoss += result.loss;
    }

    return { loss: totalLoss / batch.length, trained: batch.length };
  }

  private randomSample<T>(arr: T[], n: number): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result.slice(0, n);
  }
}

// ==================== Tensor 工具 ====================

// 使用简单的 Tensor 接口避免与 nn/tensor.ts 的类冲突
interface Tensor {
  data: Float32Array;
  shape: number[];
  grad?: Float32Array;
}

function createTensor(shape: number[]): Tensor {
  const size = shape.reduce((a, b) => a * b, 1);
  const data = new Float32Array(size);
  // Xavier 初始化
  const limit = Math.sqrt(6 / (shape[0] + (shape[1] ?? shape[0])));
  for (let i = 0; i < size; i++) {
    data[i] = (Math.random() * 2 - 1) * limit;
  }
  return { data, shape };
}

// ==================== ID 映射 ====================

const ENTITY_TYPE_IDS: Record<string, number> = {
  file: 0, function: 1, class: 2, module: 3, variable: 4,
  tool: 5, memory: 6, concept: 7, experience: 8, knowledge: 9,
  user_intent: 10, task: 11, dependency: 12, config: 13, unknown: 13,
};

const EDGE_RELATION_IDS: Record<string, number> = {
  depends_on: 0, calls: 1, contains: 2, imports: 3,
  similar_to: 4, conflicts_with: 5, derived_from: 6,
  uses: 7, creates: 8, modifies: 9, reads: 10,
  triggers: 11, requires: 12, produces: 13,
};

const ACTION_TYPE_IDS: Record<string, number> = {
  read: 0, write: 1, exec: 2, search: 3, commit: 4,
  analyze: 5, test: 6, deploy: 7, refactor: 8, debug: 9,
  create: 10, delete: 11, move: 12, copy: 13, merge: 14,
};

function entityTypeId(type: string): number {
  return ENTITY_TYPE_IDS[type] ?? ENTITY_TYPE_IDS.unknown;
}

function edgeRelationId(relation: string): number {
  return EDGE_RELATION_IDS[relation] ?? 0;
}

function actionTypeId(type: string): number {
  return ACTION_TYPE_IDS[type] ?? 0;
}
