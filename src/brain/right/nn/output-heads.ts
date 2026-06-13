/**
 * 三个输出头（共享 backbone）
 *
 * intent_head:  8 类意图分类
 * tool_head:    32 工具多标签选择
 * quality_head: 质量预判 0-1
 */

import {
  Tensor, zeros, xavierUniform,
  matmul, matmulAddBias, add, gelu, softmax, sigmoid, isInferenceMode,
} from './tensor.js';

/** Sigmoid 激活 */
function sigmoidTensor(a: Tensor): Tensor {
  const out = zeros([...a.shape]);
  for (let i = 0; i < a.size; i++) {
    out.data[i] = 1 / (1 + Math.exp(-a.data[i]));
  }
  return out;
}

export class OutputHead {
  w1: Tensor; // [dModel, hiddenDim]
  b1: Tensor;
  w2: Tensor; // [hiddenDim, outDim]
  b2: Tensor;
  outDim: number;
  activation: 'softmax' | 'sigmoid' | 'none';

  /** 反向传播缓存 */
  _cachedPooled: Tensor | null = null;
  _cachedH: Tensor | null = null;
  _cachedLogits: Tensor | null = null;

  constructor(dModel: number, hiddenDim: number, outDim: number, activation: 'softmax' | 'sigmoid' | 'none') {
    this.outDim = outDim;
    this.activation = activation;
    this.w1 = xavierUniform(dModel, hiddenDim);
    this.b1 = zeros([hiddenDim]);
    this.w2 = xavierUniform(hiddenDim, outDim);
    this.b2 = zeros([outDim]);
  }

  /** 输入: [dModel]（取序列最后一个 token 的表示）→ [outDim] */
  forward(pooled: Tensor): Tensor {
    if (!isInferenceMode()) {
      this._cachedPooled = pooled;
    }

    let h: Tensor, logits: Tensor;
    if (isInferenceMode()) {
      h = gelu(matmulAddBias(pooled, this.w1, this.b1));
      logits = matmulAddBias(h, this.w2, this.b2);
    } else {
      const hPre = add(matmul(pooled, this.w1), this.b1);
      h = gelu(hPre);
      logits = add(matmul(h, this.w2), this.b2);
      this._cachedH = h;
      this._cachedLogits = logits;
    }

    if (this.activation === 'softmax') return softmax(logits);
    if (this.activation === 'sigmoid') return sigmoidTensor(logits);
    return logits; // 'none' 用于 MSE loss
  }

  /**
   * 扩展输出维度 — 在末尾追加新类别的权重
   * 保留已有权重，新权重用 Xavier 初始化
   */
  expandOutputDim(newOutDim: number): void {
    if (newOutDim <= this.outDim) return;

    const hiddenDim = this.w2.shape[0];
    const added = newOutDim - this.outDim;

    // 新 w2: [hiddenDim, newOutDim]，前 outDim 列保留旧权重
    const newW2 = xavierUniform(hiddenDim, newOutDim);
    for (let h = 0; h < hiddenDim; h++) {
      for (let o = 0; o < this.outDim; o++) {
        newW2.data[h * newOutDim + o] = this.w2.data[h * this.outDim + o];
      }
    }

    // 新 b2: [newOutDim]，前 outDim 保留旧偏置
    const newB2 = zeros([newOutDim]);
    for (let o = 0; o < this.outDim; o++) {
      newB2.data[o] = this.b2.data[o];
    }

    this.w2 = newW2;
    this.b2 = newB2;
    this.outDim = newOutDim;
  }

  parameters(): Tensor[] {
    return [this.w1, this.b1, this.w2, this.b2];
  }
}

export class OutputHeads {
  intentHead: OutputHead;   // 8 类，softmax
  toolHead: OutputHead;     // 32 工具，sigmoid（多标签）
  qualityHead: OutputHead;  // 1 维，sigmoid
  spatialHead: OutputHead;  // 6 维空间坐标，sigmoid
  sceneHead: OutputHead;    // 拓扑节点 logits，softmax

  constructor(dModel: number, hiddenDim: number, numIntents: number, numTools: number,
              numSpatialBins = 6, numSceneNodes = 32) {
    this.intentHead = new OutputHead(dModel, hiddenDim, numIntents, 'softmax');
    this.toolHead = new OutputHead(dModel, hiddenDim, numTools, 'sigmoid');
    this.qualityHead = new OutputHead(dModel, hiddenDim, 1, 'none');
    this.spatialHead = new OutputHead(dModel, hiddenDim, numSpatialBins, 'sigmoid');
    this.sceneHead = new OutputHead(dModel, hiddenDim, numSceneNodes, 'softmax');
  }

  /** 输入: [dModel] → 五个输出 */
  forward(pooled: Tensor): {
    intent: Tensor; tools: Tensor; quality: Tensor;
    spatial: Tensor; scene: Tensor;
  } {
    return {
      intent: this.intentHead.forward(pooled),
      tools: this.toolHead.forward(pooled),
      quality: this.qualityHead.forward(pooled),
      spatial: this.spatialHead.forward(pooled),
      scene: this.sceneHead.forward(pooled),
    };
  }

  /** 扩展意图分类头的输出维度 */
  expandIntentHead(newNumIntents: number): void {
    this.intentHead.expandOutputDim(newNumIntents);
  }

  parameters(): Tensor[] {
    return [
      ...this.intentHead.parameters(),
      ...this.toolHead.parameters(),
      ...this.qualityHead.parameters(),
      ...this.spatialHead.parameters(),
      ...this.sceneHead.parameters(),
    ];
  }
}
