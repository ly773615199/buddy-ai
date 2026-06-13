/**
 * 学习发散诊断 — 在线学习流程追踪
 */
import { RightBrain } from './src/brain/right/index.js';
import type { TaskSignal, ResourceState, BodyState, DecisionOutcome, NNConfig, OnlineLearnConfig } from './src/brain/types.js';

const nn: NNConfig = {
  vocabSize: 512, embedDim: 32, hiddenDim: 64, numHeads: 2, numLayers: 1,
  numIntents: 8, numTools: 32, ffnDim: 128, dropout: 0,
  numSpatialBins: 6, numSceneNodes: 16,
};

const online: OnlineLearnConfig = {
  learningRate: 0.001, batchSize: 8, replayBufferSize: 500,
  lprLambda: 0.1, lprSnapshotInterval: 50, updateInterval: 1,
};

const brain = new RightBrain({ nn, online }, false);

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

console.log('--- 逐步追踪在线学习 ---');
for (let i = 0; i < 30; i++) {
  const intent = INTENTS[i % INTENTS.length];
  const tools = [TOOLS[i % TOOLS.length]];
  const outcome: DecisionOutcome = {
    success: i % 3 !== 0,
    latencyMs: 100,
    costEstimate: 0.01,
    toolsUsed: tools,
  };
  const result = await brain.learnFromOutcome(signal, resources, body, intent, tools, outcome);
  if (i < 10 || i % 5 === 0) {
    const stats = brain.getLearnStats();
    console.log(`step ${i}: loss=${result.loss.toFixed(4)} lr=${result.lr.toFixed(6)} buffer=${stats.bufferSize} updates=${stats.totalUpdates} avgLoss=${stats.avgLoss.toFixed(4)}`);
  }
}

console.log('\n--- 不同 lprLambda 对比 ---');
for (const lambda of [0, 0.01, 0.05, 0.1, 0.5]) {
  const b = new RightBrain({
    nn,
    online: { ...online, lprLambda: lambda },
  }, false);

  let lastLoss = 0;
  for (let i = 0; i < 20; i++) {
    const result = await b.learnFromOutcome(signal, resources, body,
      INTENTS[i % INTENTS.length], [TOOLS[i % TOOLS.length]],
      { success: true, latencyMs: 100, costEstimate: 0.01, toolsUsed: [] });
    lastLoss = result.loss;
  }
  const stats = b.getLearnStats();
  console.log(`lprLambda=${lambda}: lastLoss=${lastLoss.toFixed(4)} avgLoss=${stats.avgLoss.toFixed(4)} updates=${stats.totalUpdates}`);
  b.destroy();
}
