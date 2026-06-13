/**
 * 学习发散诊断 — 检查梯度范数和 loss 变化
 */
import { IntuitionNet } from './src/brain/right/nn/model.js';
import { backwardPass } from './src/brain/right/training/backward.js';
import { encodeFeatures } from './src/brain/right/features/encoder.js';
import { SGD } from './src/brain/right/training/optimizer.js';
import type { TaskSignal, ResourceState, BodyState, NNConfig } from './src/brain/types.js';

const config: NNConfig = {
  vocabSize: 512, embedDim: 32, hiddenDim: 64, numHeads: 2, numLayers: 1,
  numIntents: 8, numTools: 32, ffnDim: 128, dropout: 0,
  numSpatialBins: 6, numSceneNodes: 16,
};

const model = new IntuitionNet(config);
const signal: TaskSignal = {
  domains: ['code'], complexity: 'medium', taskType: 'tools',
  shouldUseDAG: false, dagReason: '', intentConfidence: 0.7,
};
const resources: ResourceState = {
  budgetRemaining: 5, availableNodeCount: 3, localCoverageRatio: 0.6,
  localConfidence: 0.7, userCorrectionCount: 0, experienceHit: null,
};
const body: BodyState = {
  energy: 80, temperature: 50, load: 30, hunger: 20,
  emotion: { joy: 50, sadness: 10, anger: 5, fear: 5, surprise: 10, disgust: 5, trust: 60, anticipation: 40 },
  desires: { hunger: 20, curiosity: 30, social: 15, safety: 10, expression: 15, rest: 10 },
  focusLevel: 70, confidenceLevel: 60, confusionLevel: 20,
  intimacyLevel: 50, socialNeed: 30,
  hour: 14, isUserActive: true, lastInteractionMs: 60000, systemHealth: 'good',
};

const tokenIds = encodeFeatures({ signal, resources, body });
console.log('Token IDs:', tokenIds);
console.log('Token count:', tokenIds.length);
console.log('Model params:', model.countParams());

const optimizer = new SGD({
  learningRate: 0.001, momentum: 0.9, weightDecay: 0,
  maxGradNorm: 1.0, schedule: 'constant', scheduleParams: {},
});

const lossWeights = { alpha: 0.3, beta: 0.3, gamma: 0.1, delta: 0.15, epsilon: 0.15 };

console.log('\n--- 10 步手动训练，监控梯度范数 ---');
for (let step = 0; step < 10; step++) {
  const output = model.forward(tokenIds);
  
  // 随机标签
  const intentLabel = step % 8;
  const toolLabels = new Array(32).fill(0);
  toolLabels[step % 32] = 1;
  const qualityTarget = 0.5;
  
  const loss = backwardPass(model, output, intentLabel, toolLabels, qualityTarget, lossWeights);
  
  let gradNorm = 0;
  let paramNorm = 0;
  let maxGrad = 0;
  for (const p of model.parameters()) {
    if (p.grad) {
      for (let i = 0; i < p.size; i++) {
        gradNorm += p.grad[i] * p.grad[i];
        if (Math.abs(p.grad[i]) > maxGrad) maxGrad = Math.abs(p.grad[i]);
      }
    }
    for (let i = 0; i < p.size; i++) {
      paramNorm += p.data[i] * p.data[i];
    }
  }
  gradNorm = Math.sqrt(gradNorm);
  paramNorm = Math.sqrt(paramNorm);
  
  console.log(`step ${step}: loss=${loss.total.toFixed(6)} intent=${loss.intent.toFixed(4)} tool=${loss.tool.toFixed(4)} quality=${loss.quality.toFixed(4)} | gradNorm=${gradNorm.toFixed(4)} maxGrad=${maxGrad.toFixed(6)} paramNorm=${paramNorm.toFixed(4)} ratio=${(gradNorm/paramNorm).toFixed(6)}`);
  
  optimizer.step_update(model.parameters());
}

console.log('\n--- 检查学习率敏感度 ---');
// 重置模型
const model2 = new IntuitionNet(config);
const opt2 = new SGD({
  learningRate: 0.0001, momentum: 0, weightDecay: 0,
  maxGradNorm: 0.5, schedule: 'constant', scheduleParams: {},
});

for (let step = 0; step < 10; step++) {
  const output = model2.forward(tokenIds);
  const loss = backwardPass(model2, output, 2, toolLabels(), 0.8, lossWeights);
  opt2.step_update(model2.parameters());
  if (step % 2 === 0) {
    console.log(`lr=0.0001 step ${step}: loss=${loss.total.toFixed(6)}`);
  }
}

function toolLabels(): number[] {
  const t = new Array(32).fill(0);
  t[4] = 1;
  return t;
}
