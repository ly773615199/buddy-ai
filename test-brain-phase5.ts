/**
 * Phase 5 验证 — 三脑联调
 */

import { ThreeBrain } from './src/brain/brain.js';
import type { TaskSignal, ResourceState, DecisionOutcome } from './src/brain/types.js';

console.log('=== Phase 5: 三脑联调验证 ===\n');

const brain = new ThreeBrain({ verbose: true });

// 1. 完整决策流程
const signal: TaskSignal = {
  domains: ['code', 'file'], complexity: 'medium', taskType: 'tools',
  shouldUseDAG: false, dagReason: '', intentConfidence: 0.75,
};
const resources: ResourceState = {
  budgetRemaining: 5, availableNodeCount: 3, localCoverageRatio: 0.6,
  localConfidence: 0.7, userCorrectionCount: 0, experienceHit: null,
};

console.log('--- 决策 #1: 正常请求 ---');
const d1 = await brain.decide('帮我读一下 config.json', signal, resources);
console.log(`结果: mode=${d1.plan.mode}, source=${d1.plan.source}, ${d1.latencyMs.toFixed(2)}ms`);
console.log(`直觉: intent=${d1.intuition?.intent.category}(${d1.intuition?.intent.confidence.toFixed(3)}), hit=${d1.intuition?.hit}`);
console.log(`本体: energy=${d1.bodyState.energy}, load=${d1.bodyState.load}`);
console.log(`调节: ${d1.homeostasisActions.map(a => `${a.type}(${a.priority})`).join(', ') || '无'}`);

// 2. 反馈
console.log('\n--- 反馈: 成功 ---');
const outcome1: DecisionOutcome = { success: true, latencyMs: 150, costEstimate: 0.01, toolsUsed: ['read_file'] };
await brain.feedback(signal, resources, d1.plan, outcome1, 'file_operations', ['read_file']);
console.log('✓ 反馈已处理');

// 3. 多轮交互
console.log('\n--- 模拟 10 轮交互 ---');
for (let i = 0; i < 10; i++) {
  const s: TaskSignal = {
    domains: ['code'], complexity: i % 3 === 0 ? 'complex' : 'medium', taskType: 'tools',
    shouldUseDAG: false, dagReason: '', intentConfidence: 0.5 + Math.random() * 0.4,
  };
  const r: ResourceState = {
    budgetRemaining: 5, availableNodeCount: 3, localCoverageRatio: 0.6,
    localConfidence: 0.5 + Math.random() * 0.4, userCorrectionCount: 0, experienceHit: null,
  };
  const d = await brain.decide(`请求 #${i}`, s, r);
  const o: DecisionOutcome = { success: Math.random() > 0.2, latencyMs: 100, costEstimate: 0.01, toolsUsed: ['exec'] };
  await brain.feedback(s, r, d.plan, o, 'code_operations', ['exec']);
}

// 4. 心跳
console.log('\n--- 心跳 ---');
const heartbeatActions = brain.heartbeat();
console.log(`心跳调节: ${heartbeatActions.length} 动作`);

// 5. 全局状态
const status = brain.getStatus();
console.log('\n--- 全局状态 ---');
console.log(`左脑: ${status.left.totalRules} 规则, ${status.left.totalDecisions} 决策`);
console.log(`右脑: ${status.right.totalSamples} 样本, ${status.right.totalUpdates} 更新, avgLoss=${status.right.avgLoss.toFixed(4)}`);
console.log(`小脑: energy=${status.body.energy.toFixed(0)}, load=${status.body.load.toFixed(0)}, confusion=${status.body.confusionLevel.toFixed(0)}`);

// 6. 模型保存
const modelPath = '/tmp/buddy-threebrain-model.bin';
await brain.right.save(modelPath);
console.log(`\n✓ 模型已保存: ${modelPath}`);

brain.destroy();
console.log('\n=== Phase 5 验证全部通过 ✓ ===');
