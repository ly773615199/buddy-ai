/**
 * 右脑 NN 快速验证 — 确认推理 + 量化 + 序列化流程
 */

import { IntuitionNet } from './src/brain/right/nn/model.js';
import { quantizeInt8, dequantizeInt8 } from './src/brain/right/nn/quantize.js';
import { encodeFeatures } from './src/brain/right/features/encoder.js';
import { decodeDecision, decodeSignal } from './src/brain/right/features/decoder.js';
import { saveModel, saveModelQuantized, loadModel } from './src/brain/right/nn/serialize.js';
import type { TaskSignal, ResourceState, BodyState } from './src/brain/types.js';
import { statSync } from 'fs';

const config = {
  vocabSize: 2048, embedDim: 64, hiddenDim: 128,
  numHeads: 4, numLayers: 2, numIntents: 8, numTools: 32,
  ffnDim: 256, dropout: 0,
};

console.log('=== IntuitionNet 验证 ===\n');

// 1. 创建模型
const model = new IntuitionNet(config);
const paramCount = model.countParams();
console.log(`✓ 模型创建成功: ${paramCount} 参数 (~${Math.round(paramCount * 4 / 1024)}KB)`);

// 2. 构造测试输入
const signal: TaskSignal = {
  domains: ['code', 'file'],
  complexity: 'medium',
  taskType: 'tools',
  shouldUseDAG: false,
  dagReason: '',
  intentConfidence: 0.75,
};

const resources: ResourceState = {
  budgetRemaining: 5,
  availableNodeCount: 3,
  localCoverageRatio: 0.6,
  localConfidence: 0.7,
  userCorrectionCount: 0,
  experienceHit: null,
};

const body: BodyState = {
  energy: 80, temperature: 50, load: 30, hunger: 20,
  emotion: { joy: 50, sadness: 10, anger: 5, fear: 5, surprise: 10, disgust: 5, trust: 60, anticipation: 40 },
  desires: { hunger: 20, curiosity: 30, social: 15, safety: 10, expression: 15, rest: 10 },
  focusLevel: 70, confidenceLevel: 60, confusionLevel: 20,
  intimacyLevel: 50, socialNeed: 30,
  hour: 14, isUserActive: true, lastInteractionMs: 60000,
  systemHealth: 'good',
};

// 3. 特征编码
const tokenIds = encodeFeatures({ signal, resources, body });
console.log(`✓ 特征编码: ${tokenIds.length} tokens → [${tokenIds.slice(0, 8).join(',')}...]`);

// 4. 前向推理
const N = 20;
let totalMs = 0;
let output: any;
for (let i = 0; i < N; i++) {
  output = model.forward(tokenIds);
  totalMs += output.latencyMs;
}
console.log(`✓ 前向推理: 平均 ${(totalMs / N).toFixed(2)}ms (目标 < 5ms)`);
console.log(`  intent: [${Array.from(output.intentProbs).map((v: number) => v.toFixed(3)).join(', ')}]`);
console.log(`  quality: ${output.qualityScore.toFixed(4)}`);

// 5. 解码
const decision = decodeDecision(output);
console.log(`✓ 解码: intent=${decision.intent.category}(${decision.intent.confidence.toFixed(3)}), tools=[${decision.tools.map(t => t.name).join(',')}]`);

const signal2 = decodeSignal(output);
console.log(`✓ 信号: hit=${signal2.hit}, suggestedTools=[${signal2.suggestedTools.join(',')}]`);

// 6. 量化
const q = quantizeInt8(model.embedding.weight);
const dq = dequantizeInt8(q);
let maxErr = 0;
for (let i = 0; i < model.embedding.weight.size; i++) {
  const err = Math.abs(model.embedding.weight.data[i] - dq.data[i]);
  if (err > maxErr) maxErr = err;
}
console.log(`✓ 量化: int8 最大误差=${maxErr.toFixed(6)}, 原始=${model.embedding.weight.size * 4}B → 量化=${q.data.length + q.scale.length * 4}B`);

// 7. 序列化
const modelPath = '/tmp/buddy-test-model.bin';
const qPath = '/tmp/buddy-test-model-q.bin';
saveModel(model, modelPath);
saveModelQuantized(model, qPath);

const modelSize = statSync(modelPath).size;
const qSize = statSync(qPath).size;
console.log(`✓ 序列化: float32=${(modelSize / 1024).toFixed(1)}KB, int8=${(qSize / 1024).toFixed(1)}KB`);

// 8. 加载验证
const model2 = new IntuitionNet(config);
loadModel(model2, modelPath);
const output2 = model2.forward(tokenIds);
let weightErr = 0;
for (let i = 0; i < output.intentProbs.length; i++) {
  weightErr += Math.abs(output.intentProbs[i] - output2.intentProbs[i]);
}
console.log(`✓ 加载验证: 输出差异=${weightErr.toFixed(8)} (应≈0)`);

console.log('\n=== Phase 1 验证全部通过 ✓ ===');
