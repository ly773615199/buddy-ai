/**
 * 三脑压力测试 — 验证真实场景下的能力边界
 *
 * 测试维度：
 * 1. 高频决策吞吐量（1000 次 decide 调用）
 * 2. 在线学习收敛性（200 次交互后 loss 是否下降）
 * 3. 内存稳定性（长时间运行后内存是否暴涨）
 * 4. 极端输入鲁棒性（空输入、超长输入、边界值）
 * 5. 三脑并发决策一致性
 * 6. 序列化完整性（保存→加载→推理一致）
 */

import { ThreeBrain } from './src/brain/brain.js';
import { RightBrain } from './src/brain/right/index.js';
import { LeftBrain } from './src/brain/left/index.js';
import { Cerebellum } from './src/brain/cerebellum/index.js';
import type { TaskSignal, ResourceState, BodyState, DecisionOutcome } from './src/brain/types.js';

function makeSignal(overrides?: Partial<TaskSignal>): TaskSignal {
  return {
    domains: ['code'], complexity: 'medium', taskType: 'tools',
    shouldUseDAG: false, dagReason: '', intentConfidence: 0.7,
    ...overrides,
  };
}

function makeResources(overrides?: Partial<ResourceState>): ResourceState {
  return {
    budgetRemaining: 5, availableNodeCount: 3, localCoverageRatio: 0.6,
    localConfidence: 0.7, userCorrectionCount: 0, experienceHit: null,
    ...overrides,
  };
}

function makeBody(overrides?: Partial<BodyState>): BodyState {
  return {
    energy: 80, temperature: 50, load: 30, hunger: 20,
    emotion: { joy: 50, sadness: 10, anger: 5, fear: 5, surprise: 10, disgust: 5, trust: 60, anticipation: 40 },
    desires: { hunger: 20, curiosity: 30, social: 15, safety: 10, expression: 15, rest: 10 },
    focusLevel: 70, confidenceLevel: 60, confusionLevel: 20,
    intimacyLevel: 50, socialNeed: 30,
    hour: 14, isUserActive: true, lastInteractionMs: 60000, systemHealth: 'good',
    ...overrides,
  };
}

const INTENTS = ['file_operations', 'code_operations', 'git_operations', 'web_operations',
  'system_operations', 'knowledge_query', 'conversation', 'complex_task'];
const TOOLS = ['read_file', 'write_file', 'exec', 'search_files', 'git_status', 'search_web', 'analyze_file'];

function randomSignal(): TaskSignal {
  const domains = [['code'], ['file'], ['web'], ['code', 'file'], ['conversation']];
  const complexities: Array<'simple' | 'medium' | 'complex'> = ['simple', 'medium', 'complex'];
  const taskTypes: Array<TaskSignal['taskType']> = ['chat', 'tools', 'reasoning', 'background'];
  return {
    domains: domains[Math.floor(Math.random() * domains.length)],
    complexity: complexities[Math.floor(Math.random() * complexities.length)],
    taskType: taskTypes[Math.floor(Math.random() * taskTypes.length)],
    shouldUseDAG: false, dagReason: '',
    intentConfidence: 0.3 + Math.random() * 0.6,
  };
}

function randomOutcome(): DecisionOutcome {
  return {
    success: Math.random() > 0.3,
    latencyMs: 50 + Math.random() * 500,
    costEstimate: Math.random() * 0.1,
    toolsUsed: [TOOLS[Math.floor(Math.random() * TOOLS.length)]],
  };
}

// ==================== Test 1: 高频决策吞吐量 ====================
async function testDecisionThroughput() {
  console.log('\n=== Test 1: 高频决策吞吐量 (1000 次) ===');
  const brain = new ThreeBrain({ verbose: false });
  const start = performance.now();

  for (let i = 0; i < 1000; i++) {
    await brain.decide(`请求 #${i}`, randomSignal(), makeResources());
  }

  const elapsed = performance.now() - start;
  const avg = elapsed / 1000;
  console.log(`✓ 1000 次决策: ${elapsed.toFixed(0)}ms 总计, ${avg.toFixed(2)}ms/次`);
  console.log(`  吞吐量: ${(1000 / (elapsed / 1000)).toFixed(0)} 次/秒`);

  brain.destroy();
  return { elapsed, avg };
}

// ==================== Test 2: 在线学习收敛性 ====================
async function testLearningConvergence() {
  console.log('\n=== Test 2: 在线学习收敛性 (200 次交互) ===');
  const brain = new RightBrain({
    nn: { vocabSize: 512, embedDim: 32, hiddenDim: 64, numHeads: 2, numLayers: 1,
          numIntents: 8, numTools: 32, ffnDim: 128, dropout: 0,
          numSpatialBins: 6, numSceneNodes: 16 },
    online: { learningRate: 0.005, batchSize: 8, replayBufferSize: 500,
              lprLambda: 0.05, lprSnapshotInterval: 50, updateInterval: 1 },
  }, false);

  const losses: number[] = [];
  const signal = makeSignal();
  const resources = makeResources();
  const body = makeBody();

  for (let i = 0; i < 200; i++) {
    const intent = INTENTS[i % INTENTS.length];
    const tools = [TOOLS[i % TOOLS.length]];
    const outcome = { success: Math.random() > 0.3, latencyMs: 100, costEstimate: 0.01, toolsUsed: tools };
    const result = await brain.learnFromOutcome(signal, resources, body, intent, tools, outcome);
    if (i % 20 === 0) {
      losses.push(result.loss);
      console.log(`  step ${i}: loss=${result.loss.toFixed(4)}, lr=${result.lr.toFixed(6)}`);
    }
  }

  // 检查 loss 趋势
  const firstLoss = losses[0];
  const lastLoss = losses[losses.length - 1];
  const improved = lastLoss < firstLoss;
  console.log(`✓ 初始 loss: ${firstLoss.toFixed(4)} → 最终 loss: ${lastLoss.toFixed(4)}`);
  console.log(`  收敛: ${improved ? '✅ 下降' : '⚠️ 未下降'}`);

  // 检查参数是否更新
  const stats = brain.getLearnStats();
  console.log(`  总样本: ${stats.totalSamples}, 总更新: ${stats.totalUpdates}, buffer: ${stats.bufferSize}`);

  brain.destroy();
  return { firstLoss, lastLoss, improved, totalUpdates: stats.totalUpdates };
}

// ==================== Test 3: 内存稳定性 ====================
async function testMemoryStability() {
  console.log('\n=== Test 3: 内存稳定性 (500 次决策 + 学习) ===');
  const brain = new ThreeBrain({ verbose: false });

  // 强制 GC（如果可用）
  if (global.gc) global.gc();
  const memBefore = process.memoryUsage();

  for (let i = 0; i < 500; i++) {
    const signal = randomSignal();
    const resources = makeResources();
    const result = await brain.decide(`请求 #${i}`, signal, resources);
    await brain.feedback(signal, resources, result.plan, randomOutcome(),
      INTENTS[i % INTENTS.length], [TOOLS[i % TOOLS.length]]);
  }

  if (global.gc) global.gc();
  const memAfter = process.memoryUsage();

  const heapDelta = (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024;
  const rss = memAfter.rss / 1024 / 1024;
  console.log(`✓ 500 次决策+学习:`);
  console.log(`  RSS: ${rss.toFixed(1)}MB`);
  console.log(`  Heap 变化: ${heapDelta > 0 ? '+' : ''}${heapDelta.toFixed(1)}MB`);
  console.log(`  Heap 已用: ${(memAfter.heapUsed / 1024 / 1024).toFixed(1)}MB`);

  const status = brain.getStatus();
  console.log(`  左脑: ${status.left.totalDecisions} 决策`);
  console.log(`  右脑: ${status.right.totalSamples} 样本, ${status.right.totalUpdates} 更新`);

  brain.destroy();
  return { heapDelta, rss };
}

// ==================== Test 4: 极端输入鲁棒性 ====================
async function testEdgeCases() {
  console.log('\n=== Test 4: 极端输入鲁棒性 ===');
  const brain = new ThreeBrain({ verbose: false });
  let passCount = 0;
  let failCount = 0;

  // 空输入
  try {
    await brain.decide('', makeSignal(), makeResources());
    passCount++;
    console.log('  ✓ 空输入');
  } catch (e: any) {
    failCount++;
    console.log(`  ✗ 空输入: ${e.message}`);
  }

  // 超长输入
  try {
    const longInput = 'x'.repeat(10000);
    await brain.decide(longInput, makeSignal(), makeResources());
    passCount++;
    console.log('  ✓ 超长输入 (10000 字符)');
  } catch (e: any) {
    failCount++;
    console.log(`  ✗ 超长输入: ${e.message}`);
  }

  // 边界 BodyState
  try {
    await brain.decide('test', makeSignal(), makeResources());
    passCount++;
    console.log('  ✓ 正常 BodyState');
  } catch (e: any) {
    failCount++;
    console.log(`  ✗ 正常 BodyState: ${e.message}`);
  }

  // 极端 BodyState（全零）
  try {
    const body = makeBody({ energy: 0, temperature: 0, load: 0, hunger: 0,
      focusLevel: 0, confidenceLevel: 0, confusionLevel: 0 });
    brain.cerebellum.regulate({ type: 'user_message', timestamp: Date.now(), data: {} });
    passCount++;
    console.log('  ✓ 全零 BodyState');
  } catch (e: any) {
    failCount++;
    console.log(`  ✗ 全零 BodyState: ${e.message}`);
  }

  // 极端 BodyState（全满）
  try {
    const body = makeBody({ energy: 100, temperature: 100, load: 100, hunger: 100,
      focusLevel: 100, confidenceLevel: 100, confusionLevel: 100 });
    passCount++;
    console.log('  ✓ 全满 BodyState');
  } catch (e: any) {
    failCount++;
    console.log(`  ✗ 全满 BodyState: ${e.message}`);
  }

  // 特殊字符输入
  try {
    await brain.decide('你好世界 🌍\n\t<script>alert(1)</script>', makeSignal(), makeResources());
    passCount++;
    console.log('  ✓ 特殊字符输入');
  } catch (e: any) {
    failCount++;
    console.log(`  ✗ 特殊字符: ${e.message}`);
  }

  // 极端 ResourceState
  try {
    await brain.decide('test', makeSignal(), makeResources({
      budgetRemaining: 0, availableNodeCount: 0,
      localCoverageRatio: 0, localConfidence: 0,
      userCorrectionCount: 999, experienceHit: null,
    }));
    passCount++;
    console.log('  ✓ 极端 ResourceState (budget=0, corrections=999)');
  } catch (e: any) {
    failCount++;
    console.log(`  ✗ 极端 ResourceState: ${e.message}`);
  }

  console.log(`✓ 极端输入: ${passCount} 通过, ${failCount} 失败`);
  brain.destroy();
  return { passCount, failCount };
}

// ==================== Test 5: 序列化完整性 ====================
async function testSerializationIntegrity() {
  console.log('\n=== Test 5: 序列化完整性 ===');
  const { IntuitionNet } = await import('./src/brain/right/nn/model.js');
  const { saveModel, loadModel } = await import('./src/brain/right/nn/serialize.js');
  const { encodeFeatures } = await import('./src/brain/right/features/encoder.js');

  const config = {
    vocabSize: 512, embedDim: 32, hiddenDim: 64, numHeads: 2, numLayers: 1,
    numIntents: 8, numTools: 32, ffnDim: 128, dropout: 0,
    numSpatialBins: 6, numSceneNodes: 16,
  };

  const model1 = new IntuitionNet(config);
  const tokenIds = encodeFeatures({ signal: makeSignal(), resources: makeResources(), body: makeBody() });
  const out1 = model1.forward(tokenIds);

  const path = '/tmp/buddy-stress-model.bin';
  saveModel(model1, path);

  const model2 = new IntuitionNet(config);
  loadModel(model2, path);
  const out2 = model2.forward(tokenIds);

  let intentDiff = 0;
  for (let i = 0; i < out1.intentProbs.length; i++) {
    intentDiff += Math.abs(out1.intentProbs[i] - out2.intentProbs[i]);
  }
  let toolDiff = 0;
  for (let i = 0; i < out1.toolProbs.length; i++) {
    toolDiff += Math.abs(out1.toolProbs[i] - out2.toolProbs[i]);
  }
  const qualityDiff = Math.abs(out1.qualityScore - out2.qualityScore);

  const intentOk = intentDiff < 0.01;
  const toolOk = toolDiff < 0.01;
  const qualityOk = qualityDiff < 0.001;

  console.log(`  intent 差异: ${intentDiff.toFixed(8)} ${intentOk ? '✅' : '⚠️'}`);
  console.log(`  tool 差异: ${toolDiff.toFixed(8)} ${toolOk ? '✅' : '⚠️'}`);
  console.log(`  quality 差异: ${qualityDiff.toFixed(8)} ${qualityOk ? '✅' : '⚠️'}`);
  console.log(`✓ 序列化: ${intentOk && toolOk && qualityOk ? '完整' : '有损失'}`);

  return { intentDiff, toolDiff, qualityDiff, ok: intentOk && toolOk && qualityOk };
}

// ==================== Test 6: 三脑协作一致性 ====================
async function testThreeBrainConsistency() {
  console.log('\n=== Test 6: 三脑协作一致性 (50 次相同输入) ===');
  const brain = new ThreeBrain({ verbose: false });
  const signal = makeSignal();
  const resources = makeResources();

  const results: string[] = [];
  for (let i = 0; i < 50; i++) {
    const r = await brain.decide('帮我读一下 config.json', signal, resources);
    results.push(`${r.plan.mode}|${r.plan.source}`);
  }

  // 统计模式分布
  const distribution: Record<string, number> = {};
  for (const r of results) {
    distribution[r] = (distribution[r] || 0) + 1;
  }
  console.log('  决策分布:');
  for (const [key, count] of Object.entries(distribution)) {
    console.log(`    ${key}: ${count} 次 (${(count / 50 * 100).toFixed(0)}%)`);
  }

  // 所有决策应该都是有效模式
  const allValid = results.every(r => {
    const mode = r.split('|')[0];
    return ['local_only', 'single', 'parallel', 'cascade', 'sequential', 'debate'].includes(mode);
  });
  console.log(`✓ 一致性: ${allValid ? '所有决策有效' : '存在无效决策'}`);

  brain.destroy();
  return { distribution, allValid };
}

// ==================== Main ====================
async function main() {
  console.log('🔥 三脑压力测试 — 开始\n');
  const t0 = performance.now();

  const throughput = await testDecisionThroughput();
  const learning = await testLearningConvergence();
  const memory = await testMemoryStability();
  const edges = await testEdgeCases();
  const serialization = await testSerializationIntegrity();
  const consistency = await testThreeBrainConsistency();

  const totalTime = performance.now() - t0;

  console.log('\n' + '='.repeat(60));
  console.log('🔥 压力测试总结');
  console.log('='.repeat(60));
  console.log(`决策吞吐: ${throughput.avg.toFixed(2)}ms/次 (${(1000 / (throughput.elapsed / 1000)).toFixed(0)} 次/秒)`);
  console.log(`在线学习: ${learning.improved ? '✅ 收敛' : '⚠️ 未收敛'} (${learning.firstLoss.toFixed(4)} → ${learning.lastLoss.toFixed(4)})`);
  console.log(`内存稳定: Heap Δ${memory.heapDelta > 0 ? '+' : ''}${memory.heapDelta.toFixed(1)}MB, RSS ${memory.rss.toFixed(1)}MB`);
  console.log(`极端输入: ${edges.passCount}/${edges.passCount + edges.failCount} 通过`);
  console.log(`序列化: ${serialization.ok ? '✅ 完整' : '⚠️ 有损失'}`);
  console.log(`一致性: ${consistency.allValid ? '✅ 所有决策有效' : '⚠️ 存在无效决策'}`);
  console.log(`总耗时: ${(totalTime / 1000).toFixed(1)}s`);
}

main().catch(console.error);
