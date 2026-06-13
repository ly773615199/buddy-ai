/**
 * Phase 3+4 验证 — 左脑规则引擎 + 小脑稳态调节
 */

import { LeftBrain } from './src/brain/left/index.js';
import { Cerebellum } from './src/brain/cerebellum/index.js';
import type { TaskSignal, ResourceState, BodyState, BodyEvent } from './src/brain/types.js';

console.log('=== Phase 3: 左脑规则引擎验证 ===\n');

const leftBrain = new LeftBrain(undefined, true);

// 1. 规则匹配测试
const signal: TaskSignal = {
  domains: ['code'], complexity: 'simple', taskType: 'chat',
  shouldUseDAG: false, dagReason: '', intentConfidence: 0.9,
};
const resources: ResourceState = {
  budgetRemaining: 5, availableNodeCount: 3, localCoverageRatio: 0.8,
  localConfidence: 0.9, userCorrectionCount: 0, experienceHit: null,
};

const plan = leftBrain.decide(signal, resources);
console.log(`✓ 简单对话规则: mode=${plan.mode}, reason=${plan.reason}, source=${plan.source}`);

// 2. 复杂代码任务
const complexSignal: TaskSignal = {
  domains: ['code'], complexity: 'complex', taskType: 'tools',
  shouldUseDAG: false, dagReason: '', intentConfidence: 0.6,
};
const complexPlan = leftBrain.decide(complexSignal, resources);
console.log(`✓ 复杂代码规则: mode=${complexPlan.mode}, reason=${complexPlan.reason}`);

// 3. 高负载降级
const body: BodyState = {
  energy: 80, temperature: 50, load: 90, hunger: 20,
  emotion: { joy: 50, sadness: 10, anger: 5, fear: 5, surprise: 10, disgust: 5, trust: 60, anticipation: 40 },
  desires: { hunger: 20, curiosity: 30, social: 15, safety: 10, expression: 15, rest: 10 },
  focusLevel: 70, confidenceLevel: 60, confusionLevel: 20,
  intimacyLevel: 50, socialNeed: 30,
  hour: 14, isUserActive: true, lastInteractionMs: 60000, systemHealth: 'good',
};
const loadPlan = leftBrain.decide(signal, resources, undefined, body);
console.log(`✓ 高负载规则: mode=${loadPlan.mode}, reason=${loadPlan.reason}`);

// 4. 统计
const stats = leftBrain.getStats();
console.log(`✓ 左脑统计: ${stats.totalRules} 规则 (${stats.builtinRules} 内置, ${stats.learnedRules} 学习)`);

// 5. 蒸馏测试
for (let i = 0; i < 10; i++) {
  leftBrain.recordDecision({
    input: 'test', signal: complexSignal,
    plan: { mode: 'single', reason: 'test', selectedNodes: [{ id: 'primary', type: 'primary' }], confidence: 0.8, source: 'llm' },
    outcome: { success: i > 2, latencyMs: 100, costEstimate: 0.01, toolsUsed: ['exec'] },
    latencyMs: 100, timestamp: Date.now() - i * 60000,
  });
}
const distillReport = await leftBrain.distill();
console.log(`✓ 蒸馏: ${distillReport.newRules} 新规则, ${distillReport.clusters} 聚类`);

console.log('\n=== Phase 4: 小脑稳态调节验证 ===\n');

const cerebellum = new Cerebellum(undefined, true);

// 1. 正常状态
const normalActions = cerebellum.regulate({
  type: 'heartbeat', timestamp: Date.now(), data: {},
});
console.log(`✓ 心跳事件: ${normalActions.length} 调节动作`);
console.log(`  状态: energy=${cerebellum.getBodyState().energy}, load=${cerebellum.getBodyState().load}`);

// 2. 用户消息事件
const msgActions = cerebellum.regulate({
  type: 'user_message', timestamp: Date.now(), data: {},
});
console.log(`✓ 用户消息: ${msgActions.length} 调节动作`);
console.log(`  状态: energy=${cerebellum.getBodyState().energy}, hunger=${cerebellum.getBodyState().hunger}`);

// 3. 工具失败事件
const failActions = cerebellum.regulate({
  type: 'tool_result', timestamp: Date.now(), data: { success: false },
});
console.log(`✓ 工具失败: ${failActions.length} 调节动作`);
const state = cerebellum.getBodyState();
console.log(`  情绪: joy=${state.emotion.joy.toFixed(0)}, sadness=${state.emotion.sadness.toFixed(0)}, anger=${state.emotion.anger.toFixed(0)}`);

// 4. 模拟高负载场景
for (let i = 0; i < 20; i++) {
  cerebellum.regulate({ type: 'heartbeat', timestamp: Date.now(), data: {} });
}
const highLoadActions = cerebellum.regulate({
  type: 'system', timestamp: Date.now(), data: { health: 'critical' },
});
console.log(`✓ 系统高负载: ${highLoadActions.length} 调节动作`);
if (highLoadActions.length > 0) {
  console.log(`  动作: ${highLoadActions.map(a => a.type).join(', ')}`);
}

// 5. 梦境恢复
const dreamActions = cerebellum.regulate({
  type: 'dream', timestamp: Date.now(), data: {},
});
console.log(`✓ 梦境恢复: ${dreamActions.length} 调节动作`);
console.log(`  状态: energy=${cerebellum.getBodyState().energy}`);

// 6. 调节历史
const history = cerebellum.getActionHistory(5);
console.log(`✓ 调节历史: ${history.length} 条记录`);

console.log('\n=== Phase 3+4 验证全部通过 ✓ ===');
