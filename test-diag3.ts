/**
 * 大模型学习发散诊断
 */
import { RightBrain } from './src/brain/right/index.js';
import type { TaskSignal, ResourceState, BodyState, DecisionOutcome, NNConfig, OnlineLearnConfig } from './src/brain/types.js';

// 生产配置 — 2.98M 参数
const nnLarge: NNConfig = {
  vocabSize: 4096, embedDim: 128, hiddenDim: 256, numHeads: 4, numLayers: 4,
  numIntents: 8, numTools: 32, ffnDim: 512, dropout: 0,
  numSpatialBins: 6, numSceneNodes: 32,
};

// 小配置 — 75K 参数
const nnSmall: NNConfig = {
  vocabSize: 512, embedDim: 32, hiddenDim: 64, numHeads: 2, numLayers: 1,
  numIntents: 8, numTools: 32, ffnDim: 128, dropout: 0,
  numSpatialBins: 6, numSceneNodes: 16,
};

const online: OnlineLearnConfig = {
  learningRate: 0.001, batchSize: 8, replayBufferSize: 500,
  lprLambda: 0.1, lprSnapshotInterval: 50, updateInterval: 1,
};

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

const INTENTS = ['file_operations', 'code_operations', 'git_operations', 'web_operations',
  'system_operations', 'knowledge_query', 'conversation', 'complex_task'];
const TOOLS = ['read_file', 'write_file', 'exec', 'search_files', 'git_status', 'search_web', 'analyze_file'];

async function testConfig(name: string, nn: NNConfig, opts: Partial<OnlineLearnConfig> = {}) {
  const brain = new RightBrain({ nn, online: { ...online, ...opts } }, false);
  console.log(`\n--- ${name}: ${brain.getModelInfo().params} 参数 ---`);

  for (let i = 0; i < 30; i++) {
    const result = await brain.learnFromOutcome(signal, resources, body,
      INTENTS[i % INTENTS.length], [TOOLS[i % TOOLS.length]],
      { success: i % 3 !== 0, latencyMs: 100, costEstimate: 0.01, toolsUsed: [] });
    if (i === 0 || i === 9 || i === 29) {
      console.log(`  step ${i}: loss=${result.loss.toFixed(4)} lr=${result.lr.toFixed(6)}`);
    }
  }
  brain.destroy();
}

await testConfig('小模型 默认', nnSmall);
await testConfig('大模型 默认', nnLarge);
await testConfig('大模型 无LPR', nnLarge, { lprLambda: 0 });
await testConfig('大模型 低LPR', nnLarge, { lprLambda: 0.01 });
await testConfig('大模型 高梯度裁剪', nnLarge, { lprLambda: 0 });
await testConfig('大模型 低学习率', nnLarge, { lprLambda: 0, learningRate: 0.0001 });
