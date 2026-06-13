/**
 * 编排决策器 — 策略决策纯逻辑
 *
 * 从 agent.ts 提取。
 * 职责：TaskSignal + ResourceState → 协作模式 + 节点分配
 *
 * Phase 2: agent.ts 瘦身计划 Step 3
 */

import type { CollaborationMode, OrchestrationNode } from '../types.js';
import type { TaskSignal, ResourceState } from './agent-types.js';
import { pickLocalExperts, pickMultiExperts } from './signal-collector.js';
import type { Subsystems } from './subsystems.js';

/**
 * Stage 2: 策略决策 — 纯函数，Signal + Resource → Plan
 *
 * 8 条规则，按优先级匹配：
 * 0. 经验路由命中 → local_only / cascade
 * 0b. 经验 hint → single
 * 1. 预算耗尽 → local_only
 * 2. 用户连续纠正 → local_only
 * 3. 本地完全覆盖 + 置信度高 → local_only
 * 4. 无领域 / 简单任务 → single
 * 5. 多领域 + 可用节点 >= 2 → parallel
 * 6. 可用节点不足 → single
 * 7. 默认 → cascade
 */
export function decideCollaboration(
  sys: Subsystems,
  signal: TaskSignal,
  resources: ResourceState,
): {
  mode: CollaborationMode;
  reason: string;
  selectedNodes: OrchestrationNode[];
} {
  const { domains, complexity } = signal;
  const { budgetRemaining, availableNodeCount, localCoverageRatio, localConfidence, userCorrectionCount, experienceHit: routeDecision } = resources;
  const needsMulti = domains.length >= 2 && complexity !== 'simple';

  let mode: CollaborationMode;
  let reason: string;
  let selectedNodes: OrchestrationNode[] = [];

  // 规则 0: 经验路由命中
  if (routeDecision?.skill && (routeDecision.path === 'exp_direct' || routeDecision.path === 'exp_verified')) {
    mode = routeDecision.path === 'exp_direct' ? 'local_only' : 'cascade';
    reason = `经验路由: ${routeDecision.path} → ${routeDecision.skill.id} (置信度=${(routeDecision.confidence ?? 0).toFixed(2)}, 新颖度=${(routeDecision.novelty ?? 0).toFixed(2)})`;
    selectedNodes = [{
      id: `exp/${routeDecision.skill.id}`,
      type: 'experience',
      skillId: routeDecision.skill.id,
      novelty: routeDecision.novelty,
      routePath: routeDecision.path,
    }];
  }
  // 规则 0b: 经验 hint
  else if (routeDecision?.skill && routeDecision.path === 'llm_with_hint') {
    mode = 'single';
    reason = `经验 hint: ${routeDecision.skill.id} (新颖度=${(routeDecision.novelty ?? 0).toFixed(2)})`;
    selectedNodes = [{ id: 'fallback', type: 'cloud_node', skillId: routeDecision.skill.id, routePath: 'llm_with_hint' }];
  }
  // 规则 1: 预算耗尽
  else if (budgetRemaining <= 0) {
    mode = 'local_only';
    reason = '预算耗尽';
    selectedNodes = pickLocalExperts(sys, domains, signal.taskType as any);
  }
  // 规则 2: 用户连续纠正
  else if (userCorrectionCount >= 3) {
    mode = 'local_only';
    reason = `用户纠正 ${userCorrectionCount} 次，降级到本地`;
    selectedNodes = pickLocalExperts(sys, domains, signal.taskType as any);
  }
  // 规则 3: 本地完全覆盖 + 置信度高
  else if (domains.length > 0 && localCoverageRatio >= 1 && localConfidence >= 0.7) {
    mode = 'local_only';
    reason = `本地完全覆盖（${domains.join(',')}），置信度 ${localConfidence.toFixed(2)}`;
    selectedNodes = pickLocalExperts(sys, domains, signal.taskType as any);
  }
  // 规则 4: 无领域 or 简单任务
  else if (domains.length === 0 || complexity === 'simple') {
    mode = 'single';
    reason = domains.length === 0 ? '无明确领域' : '简单任务';
    selectedNodes = [{ id: 'fallback', type: 'cloud_node' }];
  }
  // 规则 5: 多领域 + 可用节点 >= 2
  else if (needsMulti && availableNodeCount >= 2) {
    mode = 'parallel';
    reason = `多领域（${domains.join(',')}），${availableNodeCount} 个可用节点`;
    selectedNodes = pickMultiExperts(sys, domains, signal.taskType as any);
  }
  // 规则 6: 可用节点不足
  else if (availableNodeCount <= 1) {
    mode = 'single';
    reason = `可用节点不足（${availableNodeCount}），降级到单模型`;
    selectedNodes = [{ id: 'fallback', type: 'cloud_node' }];
  }
  // 规则 7: 默认 cascade
  else {
    mode = 'cascade';
    reason = `单领域（${domains.join(',')}），统一池选择`;
    selectedNodes = [{ id: 'fallback', type: 'cloud_node' }];
  }

  // 节点数限制
  if (selectedNodes.length > 3) {
    selectedNodes = selectedNodes.slice(0, 3);
  }

  return { mode, reason, selectedNodes };
}
