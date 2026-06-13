/**
 * Loss 函数 — CrossEntropy + MSE + Span-level 组合
 */

/**
 * 多分类交叉熵损失
 * @param probs softmax 后的概率 [numClasses]
 * @param target 目标类别 index
 */
export function crossEntropyLoss(probs: Float32Array, target: number): number {
  const p = Math.max(probs[target], 1e-10);
  return -Math.log(p);
}

/**
 * 交叉熵梯度（softmax 后）
 * ∂L/∂z_i = p_i - y_i
 */
export function crossEntropyGrad(probs: Float32Array, target: number): Float32Array {
  const grad = new Float32Array(probs.length);
  for (let i = 0; i < probs.length; i++) {
    grad[i] = probs[i] - (i === target ? 1 : 0);
  }
  return grad;
}

/**
 * 二分类交叉熵（多标签）
 * @param probs sigmoid 后的概率 [numLabels]
 * @param targets 目标标签 [numLabels] (0 或 1)
 */
export function binaryCrossEntropyLoss(probs: Float32Array, targets: number[]): number {
  let loss = 0;
  for (let i = 0; i < probs.length; i++) {
    const p = Math.max(Math.min(probs[i], 1 - 1e-10), 1e-10);
    const y = targets[i];
    loss -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
  }
  return loss / probs.length;
}

/**
 * 二分类交叉熵梯度
 * ∂L/∂z_i = p_i - y_i (sigmoid 后)
 */
export function binaryCrossEntropyGrad(probs: Float32Array, targets: number[]): Float32Array {
  const grad = new Float32Array(probs.length);
  for (let i = 0; i < probs.length; i++) {
    grad[i] = (probs[i] - targets[i]) / probs.length;
  }
  return grad;
}

/**
 * MSE 损失
 */
export function mseLoss(predicted: number, target: number): number {
  const diff = predicted - target;
  return diff * diff;
}

/**
 * MSE 梯度
 */
export function mseGrad(predicted: number, target: number): number {
  return 2 * (predicted - target);
}

/**
 * Span-level 组合损失（借鉴 Structured Agent Distillation）
 *
 * L = α * L_intent + β * L_tool + γ * L_quality + δ * L_spatial + ε * L_scene
 */
export interface SpanLossWeights {
  alpha: number;  // intent 权重
  beta: number;   // tool 权重
  gamma: number;  // quality 权重
  delta: number;  // spatial 权重
  epsilon: number; // scene 权重
}

export function spanLevelLoss(
  intentProbs: Float32Array,
  intentTarget: number,
  toolProbs: Float32Array,
  toolTargets: number[],
  qualityScore: number,
  qualityTarget: number,
  weights: SpanLossWeights,
  spatialProbs?: Float32Array,
  spatialTargets?: number[],
  sceneProbs?: Float32Array,
  sceneTarget?: number,
): { total: number; intent: number; tool: number; quality: number; spatial: number; scene: number } {
  const intentLoss = crossEntropyLoss(intentProbs, intentTarget);
  const toolLoss = binaryCrossEntropyLoss(toolProbs, toolTargets);
  const qualityLoss = mseLoss(qualityScore, qualityTarget);

  let spatialLoss = 0;
  if (spatialProbs && spatialTargets) {
    for (let i = 0; i < spatialProbs.length && i < spatialTargets.length; i++) {
      spatialLoss += mseLoss(spatialProbs[i], spatialTargets[i]);
    }
    spatialLoss /= spatialProbs.length;
  }

  let sceneLoss = 0;
  if (sceneProbs && sceneTarget !== undefined) {
    sceneLoss = crossEntropyLoss(sceneProbs, sceneTarget);
  }

  return {
    total: weights.alpha * intentLoss + weights.beta * toolLoss + weights.gamma * qualityLoss
         + (weights.delta ?? 0.15) * spatialLoss + (weights.epsilon ?? 0.15) * sceneLoss,
    intent: intentLoss,
    tool: toolLoss,
    quality: qualityLoss,
    spatial: spatialLoss,
    scene: sceneLoss,
  };
}
