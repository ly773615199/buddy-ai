/**
 * GNN 消息传递层 — 基于现有 Tensor 基础设施
 *
 * Message Passing GNN:
 *   m_ij = MSG(h_i, h_j, e_ij, action)   — 边消息
 *   h_i' = UPDATE(h_i, AGG({m_ij}))       — 节点更新
 *
 * 纯 TypeScript，复用 tensor.ts 的 matmul/add/relu
 * CPU 推理 < 5ms（N≤32 实体，2层）
 */

import {
  Tensor, zeros, randn, xavierUniform,
  matmul, add, relu, gelu, sigmoid, softmax, layerNorm,
  isInferenceMode,
} from '../nn/tensor.js';

// ==================== 轻量 LayerNorm（纯 Float32Array，无 autograd） ====================

/**
 * 对单个向量做 LayerNorm（in-place 可选）
 *
 * norm = (x - mean) / sqrt(var + eps) * gamma + beta
 *
 * @param x 输入向量
 * @param gamma 缩放参数（learnable）
 * @param beta 偏移参数（learnable）
 * @param eps 数值稳定项
 * @returns 归一化后的新向量
 */
function layerNormArray(
  x: Float32Array,
  gamma: Float32Array,
  beta: Float32Array,
  eps = 1e-5,
): Float32Array {
  const n = x.length;
  // 单次遍历：同时计算均值和平方和
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    sum += x[i];
    sumSq += x[i] * x[i];
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  const invStd = 1 / Math.sqrt(variance + eps);
  // 归一化 + 仿射变换
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = (x[i] - mean) * invStd * gamma[i] + beta[i];
  }
  return out;
}

// ==================== 类型 ====================

export interface GNNLayerConfig {
  /** 节点特征维度 */
  nodeDim: number;
  /** 边特征维度 */
  edgeDim: number;
  /** 动作特征维度 */
  actionDim: number;
  /** 隐藏层维度 */
  hiddenDim: number;
  /** 输出维度（与 nodeDim 相同用于残差，或不同用于投影） */
  outputDim: number;
}

const DEFAULT_GNN_CONFIG: GNNLayerConfig = {
  nodeDim: 32,
  edgeDim: 16,
  actionDim: 16,
  hiddenDim: 64,
  outputDim: 32,
};

// ==================== 消息函数 ====================

/**
 * 简单消息函数: MSG(h_i, h_j, e_ij, action) → message
 *
 * 拼接 [h_i; h_j; e_ij; action] → MLP → message
 */
export class MessageFunction {
  w1: Tensor; // [nodeDim*2 + edgeDim + actionDim, hiddenDim]
  b1: Tensor;
  w2: Tensor; // [hiddenDim, hiddenDim]
  b2: Tensor;

  inputDim: number;

  constructor(config: GNNLayerConfig) {
    this.inputDim = config.nodeDim * 2 + config.edgeDim + config.actionDim;
    this.w1 = xavierUniform(this.inputDim, config.hiddenDim);
    this.b1 = zeros([config.hiddenDim]);
    this.w2 = xavierUniform(config.hiddenDim, config.hiddenDim);
    this.b2 = zeros([config.hiddenDim]);
  }

  /**
   * 计算单条边的消息
   * @param h_i 源节点特征 [nodeDim]
   * @param h_j 目标节点特征 [nodeDim]
   * @param e_ij 边特征 [edgeDim]
   * @param action 动作特征 [actionDim]
   * @returns 消息向量 [hiddenDim]
   */
  forward(
    h_i: Float32Array, h_j: Float32Array,
    e_ij: Float32Array, action: Float32Array,
  ): Float32Array {
    const { inputDim } = this;
    const hiddenDim = this.w1.shape[1];

    // 拼接输入: [h_i; h_j; e_ij; action]
    const input = new Float32Array(inputDim);
    let off = 0;
    input.set(h_i, off); off += h_i.length;
    input.set(h_j, off); off += h_j.length;
    input.set(e_ij, off); off += e_ij.length;
    input.set(action, off);

    // MLP: input → hidden → message
    const hidden = new Float32Array(hiddenDim);
    for (let j = 0; j < hiddenDim; j++) {
      let sum = this.b1.data[j];
      for (let i = 0; i < inputDim; i++) {
        sum += input[i] * this.w1.data[i * hiddenDim + j];
      }
      hidden[j] = Math.max(0, sum); // ReLU
    }

    const output = new Float32Array(hiddenDim);
    for (let j = 0; j < hiddenDim; j++) {
      let sum = this.b2.data[j];
      for (let i = 0; i < hiddenDim; i++) {
        sum += hidden[i] * this.w2.data[i * hiddenDim + j];
      }
      output[j] = sum;
    }

    return output;
  }

  /**
   * 批量计算所有边的消息
   * @param nodeFeatures [N, nodeDim] 所有节点特征
   * @param edgeIndex [2, E] 边索引 (source, target)
   * @param edgeFeatures [E, edgeDim] 边特征
   * @param action [actionDim] 动作特征
   * @returns [E, hiddenDim] 所有边的消息
   */
  forwardBatch(
    nodeFeatures: Float32Array[],
    edgeIndex: [number[], number[]],
    edgeFeatures: Float32Array[],
    action: Float32Array,
  ): Float32Array[] {
    const E = edgeIndex[0].length;
    const messages: Float32Array[] = [];
    for (let e = 0; e < E; e++) {
      const srcIdx = edgeIndex[0][e];
      const tgtIdx = edgeIndex[1][e];
      messages.push(this.forward(
        nodeFeatures[srcIdx],
        nodeFeatures[tgtIdx],
        edgeFeatures[e],
        action,
      ));
    }
    return messages;
  }

  parameters(): Tensor[] {
    return [this.w1, this.b1, this.w2, this.b2];
  }
}

// ==================== 聚合函数 ====================

/**
 * 均值聚合: AGG({m_ij}) = mean(messages)
 *
 * 支持加权均值（边权重）
 */
export function aggregateMessages(
  messages: Float32Array[],
  weights?: number[],
): Float32Array {
  if (messages.length === 0) {
    return new Float32Array(0);
  }

  const dim = messages[0].length;
  const result = new Float32Array(dim);

  if (weights) {
    let totalWeight = 0;
    for (let e = 0; e < messages.length; e++) {
      const w = weights[e] ?? 1;
      totalWeight += w;
      for (let d = 0; d < dim; d++) {
        result[d] += messages[e][d] * w;
      }
    }
    if (totalWeight > 0) {
      for (let d = 0; d < dim; d++) result[d] /= totalWeight;
    }
  } else {
    for (let e = 0; e < messages.length; e++) {
      for (let d = 0; d < dim; d++) {
        result[d] += messages[e][d];
      }
    }
    for (let d = 0; d < dim; d++) result[d] /= messages.length;
  }

  return result;
}

/**
 * 最大值聚合: AGG({m_ij}) = max(messages) (逐元素)
 */
export function aggregateMax(messages: Float32Array[]): Float32Array {
  if (messages.length === 0) return new Float32Array(0);

  const dim = messages[0].length;
  const result = new Float32Array(dim);
  result.fill(-Infinity);

  for (let e = 0; e < messages.length; e++) {
    for (let d = 0; d < dim; d++) {
      if (messages[e][d] > result[d]) result[d] = messages[e][d];
    }
  }

  return result;
}

// ==================== 更新函数 ====================

/**
 * 节点更新函数: UPDATE(h_i, aggregated) → h_i'
 *
 * GRU-style 更新: 拼接 [h_i; aggregated] → MLP → h_i'
 * 带残差连接 + Post-LayerNorm（防止数值发散）
 */
export class UpdateFunction {
  w1: Tensor; // [nodeDim + hiddenDim, hiddenDim]
  b1: Tensor;
  w2: Tensor; // [hiddenDim, outputDim]
  b2: Tensor;
  // Post-LayerNorm 参数
  lnGamma: Float32Array; // [outputDim]
  lnBeta: Float32Array;  // [outputDim]
  config: GNNLayerConfig;

  constructor(config: GNNLayerConfig) {
    this.config = config;
    const inputDim = config.nodeDim + config.hiddenDim;
    this.w1 = xavierUniform(inputDim, config.hiddenDim);
    this.b1 = zeros([config.hiddenDim]);
    this.w2 = xavierUniform(config.hiddenDim, config.outputDim);
    this.b2 = zeros([config.outputDim]);
    // LayerNorm: gamma=1, beta=0
    this.lnGamma = new Float32Array(config.outputDim).fill(1);
    this.lnBeta = new Float32Array(config.outputDim);
  }

  /**
   * 更新节点特征
   * @param h_i 当前节点特征 [nodeDim]
   * @param aggregated 聚合消息 [hiddenDim]
   * @returns 更新后的节点特征 [outputDim]
   */
  forward(h_i: Float32Array, aggregated: Float32Array): Float32Array {
    const { nodeDim, hiddenDim, outputDim } = {
      nodeDim: this.config.nodeDim,
      hiddenDim: this.config.hiddenDim,
      outputDim: this.config.outputDim,
    };

    // 拼接
    const input = new Float32Array(nodeDim + hiddenDim);
    input.set(h_i, 0);
    input.set(aggregated, nodeDim);

    // MLP: input → hidden → output
    const h = new Float32Array(hiddenDim);
    for (let j = 0; j < hiddenDim; j++) {
      let sum = this.b1.data[j];
      for (let i = 0; i < nodeDim + hiddenDim; i++) {
        sum += input[i] * this.w1.data[i * hiddenDim + j];
      }
      h[j] = Math.max(0, sum); // ReLU
    }

    const out = new Float32Array(outputDim);
    for (let j = 0; j < outputDim; j++) {
      let sum = this.b2.data[j];
      for (let i = 0; i < hiddenDim; i++) {
        sum += h[i] * this.w2.data[i * outputDim + j];
      }
      out[j] = sum;
    }

    // 残差连接（仅当 nodeDim === outputDim 时）
    if (nodeDim === outputDim) {
      for (let i = 0; i < outputDim; i++) {
        out[i] += h_i[i];
      }
    }

    // Post-LayerNorm: 防止残差叠加后数值发散
    return layerNormArray(out, this.lnGamma, this.lnBeta);
  }

  parameters(): Tensor[] {
    return [this.w1, this.b1, this.w2, this.b2];
  }
}

// ==================== GNN 层 ====================

/**
 * 单层 GNN: 消息传递 + 聚合 + 更新
 *
 * 一个完整的消息传递步骤：
 * 1. 对每条边计算消息
 * 2. 对每个节点聚合邻居消息
 * 3. 更新节点特征
 */
export class GNNLayer {
  messageFn: MessageFunction;
  updateFn: UpdateFunction;
  config: GNNLayerConfig;

  constructor(config?: Partial<GNNLayerConfig>) {
    this.config = { ...DEFAULT_GNN_CONFIG, ...config };
    this.messageFn = new MessageFunction(this.config);
    this.updateFn = new UpdateFunction(this.config);
  }

  /**
   * 单层前向传播
   *
   * @param nodeFeatures [N, nodeDim] 节点特征
   * @param edgeIndex [2, E] 边索引
   * @param edgeFeatures [E, edgeDim] 边特征
   * @param action [actionDim] 动作特征
   * @returns [N, outputDim] 更新后的节点特征
   */
  forward(
    nodeFeatures: Float32Array[],
    edgeIndex: [number[], number[]],
    edgeFeatures: Float32Array[],
    action: Float32Array,
  ): Float32Array[] {
    const N = nodeFeatures.length;
    const E = edgeIndex[0].length;

    // Step 1: 计算所有边的消息
    const messages = this.messageFn.forwardBatch(nodeFeatures, edgeIndex, edgeFeatures, action);

    // Step 2: 对每个节点聚合来自入边的消息
    const aggregated: Float32Array[] = [];
    for (let i = 0; i < N; i++) {
      const incoming: Float32Array[] = [];
      const weights: number[] = [];
      for (let e = 0; e < E; e++) {
        if (edgeIndex[1][e] === i) {
          incoming.push(messages[e]);
          weights.push(1.0); // 可以用边权重
        }
      }
      if (incoming.length > 0) {
        aggregated.push(aggregateMessages(incoming, weights));
      } else {
        // 没有入边：零向量
        aggregated.push(new Float32Array(this.config.hiddenDim));
      }
    }

    // Step 3: 更新每个节点
    const updated: Float32Array[] = [];
    for (let i = 0; i < N; i++) {
      updated.push(this.updateFn.forward(nodeFeatures[i], aggregated[i]));
    }

    return updated;
  }

  parameters(): Tensor[] {
    return [...this.messageFn.parameters(), ...this.updateFn.parameters()];
  }
}
