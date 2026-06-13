/**
 * 反向传播 — 从模型输出反向传播梯度到所有参数
 *
 * 混合策略：
 *   1. 输出头：手动计算梯度（精确、高效）
 *   2. Encoder：利用 autograd 从输出头的输入梯度反向
 *   3. Embedding：scatter 梯度到权重矩阵
 *
 * 依赖 IntuitionNet 和 OutputHead 缓存的中间值
 */

import { Tensor, zeros, backward as autogradBackward } from '../nn/tensor.js';
import { backwardEmbedding } from '../nn/embedding.js';
import type { IntuitionNet, ModelOutput } from '../nn/model.js';
import type { SpanLossWeights } from './loss.js';

/**
 * 从模型输出执行完整反向传播（支持 5 个输出头）
 *
 * 前提：调用 model.forward(tokenIds) 后，中间值已缓存
 *
 * @returns 各项 loss 值
 */
export function backwardPass(
  model: IntuitionNet,
  output: ModelOutput,
  intentLabel: number,
  toolLabels: number[],
  qualityTarget: number,
  lossWeights: SpanLossWeights,
  spatialLabels?: number[],
  sceneLabel?: number,
): { total: number; intent: number; tool: number; quality: number; spatial: number; scene: number } {
  const params = model.parameters();
  for (const p of params) p.zeroGrad();

  // ── 1. 计算各项 loss ──

  const intentLoss = -Math.log(Math.max(output.intentProbs[intentLabel], 1e-10));

  let toolLoss = 0;
  for (let i = 0; i < output.toolProbs.length; i++) {
    const p = Math.max(Math.min(output.toolProbs[i], 1 - 1e-10), 1e-10);
    const y = toolLabels[i] || 0;
    toolLoss -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
  }
  toolLoss /= output.toolProbs.length;

  const qualityLoss = (output.qualityScore - qualityTarget) ** 2;

  // Spatial loss（MSE，可选）
  let spatialLoss = 0;
  if (spatialLabels && output.spatialProbs) {
    for (let i = 0; i < output.spatialProbs.length && i < spatialLabels.length; i++) {
      spatialLoss += (output.spatialProbs[i] - spatialLabels[i]) ** 2;
    }
    spatialLoss /= Math.max(output.spatialProbs.length, 1);
  }

  // Scene loss（CE，可选）
  let sceneLoss = 0;
  if (sceneLabel !== undefined && output.sceneProbs) {
    sceneLoss = -Math.log(Math.max(output.sceneProbs[sceneLabel], 1e-10));
  }

  const dw = lossWeights.delta ?? 0.15;
  const ew = lossWeights.epsilon ?? 0.15;
  const totalLoss = lossWeights.alpha * intentLoss
                   + lossWeights.beta * toolLoss
                   + lossWeights.gamma * qualityLoss
                   + dw * spatialLoss
                   + ew * sceneLoss;

  // ── 2. 输出层梯度 ──

  const intentGrad = crossEntropySoftmaxGrad(output.intentProbs, intentLabel);
  const toolGrad = bceSigmoidGrad(output.toolProbs, toolLabels);
  // qualityScore = sigmoid(logit)，链式法则需要乘以 sigmoid 导数 σ(1-σ)
  // ∂L/∂logit = 2(σ - y) · σ(1-σ)
  const q = output.qualityScore;
  const qualityGrad = new Float32Array([2 * (q - qualityTarget) * q * (1 - q)]);

  // Spatial grad（MSE: 2*(pred - target)）
  const spatialGrad = new Float32Array(output.spatialProbs.length);
  if (spatialLabels) {
    for (let i = 0; i < spatialGrad.length && i < spatialLabels.length; i++) {
      spatialGrad[i] = 2 * (output.spatialProbs[i] - spatialLabels[i]);
    }
  }

  // Scene grad（CE: p - y）
  const sceneGrad = crossEntropySoftmaxGrad(output.sceneProbs, sceneLabel ?? 0);

  // ── 3. 输出头反向 → 得到传回 pooled 的梯度 ──

  const pooledGrad = _backwardOutputHeads5(
    model, intentGrad, toolGrad, qualityGrad,
    spatialGrad.length > 0 ? spatialGrad : null,
    sceneLabel !== undefined ? sceneGrad : null,
  );

  // ── 4. 通过 autograd 从 pooled → poolLast → encoder → embedding 反向 ──

  const encoderOut = model._cachedEncoderOut;
  if (encoderOut) {
    const seqLen = encoderOut.shape[0];
    const dModel = encoderOut.shape[1];
    const pooled = zeros([1, dModel]);
    const off = (seqLen - 1) * dModel;
    for (let i = 0; i < dModel; i++) {
      pooled.data[i] = encoderOut.data[off + i];
    }
    pooled._ctx = { op: 'poolLast', saved: [seqLen], parents: [encoderOut] };
    pooled.grad = pooledGrad;
    autogradBackward(pooled);
    _backwardEmbedding(model, encoderOut);
  }

  return { total: totalLoss, intent: intentLoss, tool: toolLoss, quality: qualityLoss, spatial: spatialLoss, scene: sceneLoss };
}

// ── 辅助函数 ──

/** CE + softmax 的梯度：p_i - y_i */
function crossEntropySoftmaxGrad(probs: Float32Array, target: number): Float32Array {
  const grad = new Float32Array(probs.length);
  for (let i = 0; i < probs.length; i++) {
    grad[i] = probs[i] - (i === target ? 1 : 0);
  }
  return grad;
}

/** BCE + sigmoid 的梯度：(p_i - y_i) / N */
function bceSigmoidGrad(probs: Float32Array, targets: number[]): Float32Array {
  const grad = new Float32Array(probs.length);
  for (let i = 0; i < probs.length; i++) {
    grad[i] = (probs[i] - (targets[i] || 0)) / probs.length;
  }
  return grad;
}

/**
 * 五个输出头的反向传播（扩展版）
 */
function _backwardOutputHeads5(
  model: IntuitionNet,
  intentGrad: Float32Array,
  toolGrad: Float32Array,
  qualityGrad: Float32Array,
  spatialGrad: Float32Array | null,
  sceneGrad: Float32Array | null,
): Float32Array {
  const heads = model.heads;
  const dModel = model.config.hiddenDim;
  const pooledGrad = new Float32Array(dModel);

  // 三个原有头
  if (heads.intentHead._cachedH && heads.intentHead._cachedPooled &&
      heads.toolHead._cachedH && heads.toolHead._cachedPooled &&
      heads.qualityHead._cachedH && heads.qualityHead._cachedPooled) {
    _headBackward(
      heads.intentHead.w1, heads.intentHead.b1, heads.intentHead.w2, heads.intentHead.b2,
      intentGrad, heads.intentHead._cachedPooled, heads.intentHead._cachedH, pooledGrad,
    );
    _headBackward(
      heads.toolHead.w1, heads.toolHead.b1, heads.toolHead.w2, heads.toolHead.b2,
      toolGrad, heads.toolHead._cachedPooled, heads.toolHead._cachedH, pooledGrad,
    );
    _headBackward(
      heads.qualityHead.w1, heads.qualityHead.b1, heads.qualityHead.w2, heads.qualityHead.b2,
      qualityGrad, heads.qualityHead._cachedPooled, heads.qualityHead._cachedH, pooledGrad,
    );
  }

  // Spatial head（可选）
  if (spatialGrad && heads.spatialHead._cachedH && heads.spatialHead._cachedPooled) {
    _headBackward(
      heads.spatialHead.w1, heads.spatialHead.b1, heads.spatialHead.w2, heads.spatialHead.b2,
      spatialGrad, heads.spatialHead._cachedPooled, heads.spatialHead._cachedH, pooledGrad,
    );
  }

  // Scene head（可选）
  if (sceneGrad && heads.sceneHead._cachedH && heads.sceneHead._cachedPooled) {
    _headBackward(
      heads.sceneHead.w1, heads.sceneHead.b1, heads.sceneHead.w2, heads.sceneHead.b2,
      sceneGrad, heads.sceneHead._cachedPooled, heads.sceneHead._cachedH, pooledGrad,
    );
  }

  return pooledGrad;
}

/**
 * 三个输出头的反向传播（兼容旧接口）
 *
 * 前向：pooled → h = gelu(w1·pooled + b1) → out = activate(w2·h + b2)
 * 反向：gradOut → ∂L/∂w2, ∂L/∂b2 → ∂L/∂h → ∂L/∂w1, ∂L/∂b1 → ∂L/∂pooled
 */
function _backwardOutputHeads(
  model: IntuitionNet,
  intentGrad: Float32Array,
  toolGrad: Float32Array,
  qualityGrad: Float32Array,
): Float32Array {
  const heads = model.heads;
  const dModel = model.config.hiddenDim;
  const pooledGrad = new Float32Array(dModel);

  // 安全检查：缓存未命中时跳过反向传播
  if (!heads.intentHead._cachedH || !heads.intentHead._cachedPooled ||
      !heads.toolHead._cachedH || !heads.toolHead._cachedPooled ||
      !heads.qualityHead._cachedH || !heads.qualityHead._cachedPooled) {
    return pooledGrad;
  }

  // 安全检查：缓存未命中时跳过反向传播
  const ih = heads.intentHead;
  const th = heads.toolHead;
  const qh = heads.qualityHead;
  if (!ih._cachedH || !ih._cachedPooled ||
      !th._cachedH || !th._cachedPooled ||
      !qh._cachedH || !qh._cachedPooled) {
    return pooledGrad;
  }

  _headBackward(
    ih.w1, ih.b1, ih.w2, ih.b2,
    intentGrad, ih._cachedPooled, ih._cachedH,
    pooledGrad,
  );

  _headBackward(
    th.w1, th.b1, th.w2, th.b2,
    toolGrad, th._cachedPooled, th._cachedH,
    pooledGrad,
  );

  _headBackward(
    qh.w1, qh.b1, qh.w2, qh.b2,
    qualityGrad, qh._cachedPooled, qh._cachedH,
    pooledGrad,
  );

  return pooledGrad;
}

/**
 * 单个输出头的反向传播
 */
function _headBackward(
  w1: Tensor, b1: Tensor,
  w2: Tensor, b2: Tensor,
  gradOut: Float32Array,
  cachedPooled: Tensor | null,   // [1, dModel]
  cachedH: Tensor | null,         // [1, hiddenDim] — gelu 后
  pooledGradOut: Float32Array,
): void {
  if (!cachedPooled || !cachedH || !cachedH.data || !cachedPooled.data) return; // 安全退出
  if (!w1.grad) w1.grad = new Float32Array(w1.size);
  if (!b1.grad) b1.grad = new Float32Array(b1.size);
  if (!w2.grad) w2.grad = new Float32Array(w2.size);
  if (!b2.grad) b2.grad = new Float32Array(b2.size);

  const dModel = cachedPooled.shape[0];
  const hiddenDim = cachedH.shape[0];
  const outDim = w2.shape[1];

  // ∂L/∂w2[i][j] = h[i] * gradOut[j]
  for (let i = 0; i < hiddenDim; i++) {
    for (let j = 0; j < outDim; j++) {
      w2.grad[i * outDim + j] += cachedH.data[i] * gradOut[j];
    }
  }

  // ∂L/∂b2 = gradOut
  for (let j = 0; j < outDim; j++) {
    b2.grad[j] += gradOut[j];
  }

  // ∂L/∂h = w2 * gradOut
  const hGrad = new Float32Array(hiddenDim);
  for (let i = 0; i < hiddenDim; i++) {
    let sum = 0;
    for (let j = 0; j < outDim; j++) {
      sum += w2.data[i * outDim + j] * gradOut[j];
    }
    hGrad[i] = sum;
  }

  // ∂L/∂h_pre = hGrad ⊙ gelu'(h_pre)
  // cachedH = gelu(h_pre)，用近似：gelu'(x) ≈ 1 if x>0, ≈ 0.01 if x<0
  const hPreGrad = new Float32Array(hiddenDim);
  for (let i = 0; i < hiddenDim; i++) {
    hPreGrad[i] = hGrad[i] * (cachedH.data[i] > 0 ? 1 : 0.01);
  }

  // ∂L/∂w1[i][j] = pooled[i] * hPreGrad[j]
  for (let i = 0; i < dModel; i++) {
    for (let j = 0; j < hiddenDim; j++) {
      w1.grad[i * hiddenDim + j] += cachedPooled.data[i] * hPreGrad[j];
    }
  }

  // ∂L/∂b1 = hPreGrad
  for (let j = 0; j < hiddenDim; j++) {
    b1.grad[j] += hPreGrad[j];
  }

  // ∂L/∂pooled = w1 * hPreGrad
  for (let i = 0; i < dModel; i++) {
    let sum = 0;
    for (let j = 0; j < hiddenDim; j++) {
      sum += w1.data[i * hiddenDim + j] * hPreGrad[j];
    }
    pooledGradOut[i] += sum;
  }
}

/**
 * Embedding 反向传播
 *
 * encoderOut 的梯度已经通过 autograd 回传到了 embedding 的输出 tensor
 * 这里需要把 embedding 输出的梯度 scatter 到 embedding weight 上
 */
function _backwardEmbedding(model: IntuitionNet, encoderOut: Tensor): void {
  // encoderOut 的 autograd 会回传到 embedding.forward() 的输出
  // embedding.forward() 创建的 tensor 的 _ctx.op === 'embedding'
  // 但 autograd 不处理 'embedding' op（不在 _backwardOp 的 switch 中）
  // 所以我们需要手动找到 embedding 输出 tensor 并 scatter 梯度

  // 遍历计算图找 embedding op
  const visited = new Set<Tensor>();
  const queue: Tensor[] = [encoderOut];
  while (queue.length > 0) {
    const t = queue.shift()!;
    if (visited.has(t)) continue;
    visited.add(t);
    if (t._ctx) {
      if (t._ctx.op === 'embedding' && t.grad) {
        backwardEmbedding(t);
      }
      for (const p of t._ctx.parents) {
        if (!visited.has(p)) queue.push(p);
      }
    }
  }
}
