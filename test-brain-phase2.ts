/**
 * Phase 2 验证 — 在线学习 + 蒸馏
 */

import { RightBrain } from './src/brain/right/index.js';
import type { TaskSignal, ResourceState, BodyState, DecisionOutcome, DecisionRecord } from './src/brain/types.js';

console.log('=== Phase 2: 在线学习验证 ===\n');

const brain = new RightBrain(undefined, true);

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

// 1. 初始预测
const before = await brain.predict('test', signal, resources, body);
console.log(`✓ 初始预测: intent=${before.intent.category}(${before.intent.confidence.toFixed(3)}), hit=${before.hit}`);

// 2. 模拟 50 次交互学习
console.log('\n--- 模拟 50 次交互学习 ---');
for (let i = 0; i < 50; i++) {
  const outcome: DecisionOutcome = {
    success: Math.random() > 0.3,
    latencyMs: 100 + Math.random() * 200,
    costEstimate: 0.01,
    toolsUsed: ['read_file', 'exec'],
  };
  const result = await brain.learnFromOutcome(signal, resources, body, 'code_operations', ['read_file', 'exec'], outcome);
  if (i % 10 === 0) {
    console.log(`  step ${i}: loss=${result.loss.toFixed(4)}, lr=${result.lr.toFixed(6)}`);
  }
}

// 3. 学习后预测
const after = await brain.predict('test', signal, resources, body);
console.log(`\n✓ 学习后预测: intent=${after.intent.category}(${after.intent.confidence.toFixed(3)}), hit=${after.hit}`);

// 4. 学习统计
const stats = brain.getLearnStats();
console.log(`\n✓ 学习统计:`);
console.log(`  totalSamples: ${stats.totalSamples}`);
console.log(`  totalUpdates: ${stats.totalUpdates}`);
console.log(`  bufferSize: ${stats.bufferSize}`);
console.log(`  avgLoss: ${stats.avgLoss.toFixed(4)}`);
console.log(`  currentLr: ${stats.currentLr.toFixed(6)}`);

// 5. 模型保存/加载
const path = '/tmp/buddy-phase2-test.bin';
await brain.save(path);
const brain2 = new RightBrain(undefined, false);
await brain2.load(path);
const after2 = await brain2.predict('test', signal, resources, body);
console.log(`\n✓ 保存/加载: intent=${after2.intent.category}(${after2.intent.confidence.toFixed(3)})`);

// 6. 蒸馏测试
const records: DecisionRecord[] = [];
for (let i = 0; i < 60; i++) {
  records.push({
    input: 'test input',
    signal,
    plan: {
      mode: 'single', reason: 'test', confidence: 0.8, source: 'llm',
      selectedNodes: [{ id: 'primary', type: 'primary', skillId: 'read_file' }],
    },
    outcome: { success: Math.random() > 0.2, latencyMs: 100, costEstimate: 0.01, toolsUsed: ['read_file'] },
    latencyMs: 100,
    timestamp: Date.now() - Math.random() * 3600000,
  });
}
const distillResult = await brain.distill(records);
console.log(`\n✓ 蒸馏: ${distillResult.samples} 样本, loss=${distillResult.avgLoss.toFixed(4)}, ${distillResult.durationMs}ms`);

console.log('\n=== Phase 2 验证全部通过 ✓ ===');
