/**
 * 信号采集器 — 纯语义分析 + 资源状态采集
 *
 * 从 agent.ts 提取，供编排/执行模块共用。
 * 职责：用户输入 → TaskSignal + ResourceState
 *
 * Phase 2: agent.ts 瘦身计划 Step 2
 * Step 3: 新增 collectPerceptionState() — 一次计算，全链路共享
 */

import type { TaskSignal, ResourceState } from './agent-types.js';
import type { OrchestrationNode } from '../types.js';
import type { BuddyConfig } from '../types.js';
import type { Subsystems } from './subsystems.js';
import {
  type PerceptionState,
  inferDomains,
  assessComplexity,
  assessDAG,
  mapTaskType,
} from './perception-state.js';

// ==================== 信号采集 ====================

/**
 * 领域检测 — 从右脑分类结果推断任务领域
 */
export function detectDomains(sys: Subsystems, content: string): string[] {
  const intent = sys.threeBrain!.right.classifyFromText(content);

  const CATEGORY_TO_DOMAIN: Record<string, string[]> = {
    file_operations: ['code'],
    code_operations: ['code'],
    git_operations: ['code'],
    web_operations: ['data'],
    system_operations: ['code'],
    knowledge_query: ['writing'],
    complex_task: ['code', 'architect'],
  };
  const domains = CATEGORY_TO_DOMAIN[intent.category] ?? [];
  if (intent.confidence < 0.3) {
    const domainKeywords: Record<string, string[]> = {
      architect: ['架构', '设计', '模式', 'architecture', 'design', 'pattern'],
      test: ['测试', 'test', 'coverage', '断言', 'assert'],
      review: ['审查', 'review', '规范', '安全', '性能', '质量', '优化'],
      data: ['数据', '分析', '统计', 'data', 'analyze', 'csv', 'sql', '图表'],
      writing: ['写', '文章', '文档', 'write', 'article', 'doc', '总结', '翻译'],
    };
    const lower = content.toLowerCase();
    for (const [domain, keywords] of Object.entries(domainKeywords)) {
      if (keywords.some(k => lower.includes(k)) && !domains.includes(domain)) {
        domains.push(domain);
      }
    }
  }
  return [...new Set(domains)];
}

/**
 * 统一复杂度评估
 */
export function assessTaskComplexity(sys: Subsystems, content: string): {
  complexity: 'simple' | 'medium' | 'complex';
  shouldUseDAG: boolean;
  dagReason: string;
  taskType: 'chat' | 'tools' | 'reasoning' | 'background' | 'domain';
} {
  if (content.length < 30) {
    return { complexity: 'simple', shouldUseDAG: false, dagReason: '', taskType: 'chat' };
  }

  const intent = sys.threeBrain!.right.classifyFromText(content);

  const lower = content.toLowerCase();
  const parallelMarkers = ['同时', '并且', '一边', '另外', '分别', 'also', 'and also', 'while', 'simultaneously'];
  const markerCount = parallelMarkers.filter(m => lower.includes(m)).length;
  const clauses = content.split(/[,，;；.。\n]+/).filter(s => s.trim().length > 3);
  const shouldUseDAG = markerCount >= 3 || clauses.length >= 4;
  const dagReason = shouldUseDAG
    ? (markerCount >= 3 ? `并行标记词 ${markerCount} 个` : `子句 ${clauses.length} 个`)
    : '';

  const CATEGORY_TO_TASK: Record<string, 'chat' | 'tools' | 'reasoning' | 'background' | 'domain'> = {
    file_operations: 'tools',
    code_operations: 'tools',
    git_operations: 'tools',
    web_operations: 'tools',
    system_operations: 'tools',
    knowledge_query: 'reasoning',
    conversation: 'chat',
    complex_task: 'reasoning',
  };
  const taskType = CATEGORY_TO_TASK[intent.category] ?? 'chat';

  let complexity: 'simple' | 'medium' | 'complex' = 'simple';
  if (intent.category === 'complex_task' || content.length > 200) {
    complexity = 'complex';
  } else if (intent.category !== 'conversation' || content.length > 80) {
    complexity = 'medium';
  }

  return { complexity, shouldUseDAG, dagReason, taskType };
}

/**
 * Stage 1: 统一感知采集 — 调用一次 classifyFromText()，结果供全链路使用
 *
 * 替代 detectDomains + assessTaskComplexity 各自独立调用 classifyFromText()
 */
export function collectPerceptionState(sys: Subsystems, content: string): PerceptionState {
  const t0 = performance.now();

  // 一次调用，获取完整意图信息
  const intent = sys.threeBrain!.right.classifyFromText(content);

  // 从意图推断领域
  const domains = inferDomains(intent);

  // 复杂度评估
  const complexity = assessComplexity(content, intent);

  // DAG 判断
  const { shouldUseDAG, dagReason } = assessDAG(content);

  // 任务类型映射
  const taskType = mapTaskType(intent.category);

  return {
    intent: {
      category: intent.category,
      confidence: intent.confidence,
      hit: intent.hit,
      suggestedTools: intent.suggestedTools,
    },
    domains,
    complexity,
    taskType,
    shouldUseDAG,
    dagReason,
    intentConfidence: intent.confidence,
    timestamp: Date.now(),
    computeMs: performance.now() - t0,
  };
}

/**
 * Stage 1: 信号采集 — 纯语义分析，不依赖资源状态
 *
 * 使用 collectPerceptionState 统一采集，避免重复调用 classifyFromText
 */
export function collectSignals(sys: Subsystems, content: string): TaskSignal {
  const ps = collectPerceptionState(sys, content);
  return {
    domains: ps.domains,
    complexity: ps.complexity,
    taskType: ps.taskType,
    shouldUseDAG: ps.shouldUseDAG,
    dagReason: ps.dagReason,
    intentConfidence: ps.intentConfidence,
    content,
  };
}

// ==================== 资源状态采集 ====================

/**
 * 收集工具健康度摘要
 */
export function collectToolHealth(sys: Subsystems): import('../brain/types.js').ToolHealthSummary {
  const growth = sys.skillManager.growth;
  const allHealth = growth.getAllHealth();

  const scores: Record<string, number> = {};
  const unreliableTools: string[] = [];
  const slowTools: string[] = [];
  let recentFailures = 0;

  for (const h of allHealth) {
    const cleanName = h.name.replace(/^skill_/, '');
    scores[cleanName] = h.healthScore;
    scores[h.name] = h.healthScore;

    if (h.reliability < 50) {
      unreliableTools.push(cleanName);
      unreliableTools.push(h.name);
    }
    if (h.efficiency < 30) {
      slowTools.push(cleanName);
      slowTools.push(h.name);
    }
  }

  for (const h of allHealth) {
    const metric = growth.getMetric(h.name);
    if (!metric) continue;
    for (const [_date, _count] of Object.entries(metric.dailyUsage)) {
      recentFailures += metric.failureCount;
    }
  }

  return { scores, unreliableTools, slowTools, recentFailures };
}

/**
 * Stage 1.5: 资源状态采集 — 运行时状态，依赖外部系统
 */
export function collectResourceState(
  sys: Subsystems,
  config: BuddyConfig,
  wsUserCorrectionCount: () => number,
  content: string,
  signal: TaskSignal,
): ResourceState {
  const localExperts = sys.ternaryRouter.listExperts();
  const pool = sys.router.getPool();
  const availableModelCount = pool?.profileCount ?? 0;

  const matureExperts = localExperts.filter(e => e.growthStage !== 'seed');
  const coveredDomains = signal.domains.filter(d =>
    matureExperts.some(e => e.domain.toLowerCase() === d)
  );
  const localCoverageRatio = signal.domains.length > 0 ? coveredDomains.length / signal.domains.length : 0;

  const recorder = sys.router.getDecisionRecorder();
  const localConfidence = coveredDomains.length > 0
    ? Math.max(...coveredDomains.map(d => {
        const expert = matureExperts.find(e => e.domain.toLowerCase() === d);
        if (!expert) return 0;
        if (recorder) {
          const stats = recorder.getNodeStats(`ternary/${d}`, 'domain');
          if (stats.attempts >= 3) return stats.successRate;
        }
        return 0.5;
      }))
    : 0;

  let budgetRemaining = Infinity;
  if (recorder) {
    const oneHourAgo = Date.now() - 3600_000;
    const recent = recorder.getByTimeRange(oneHourAgo, Date.now());
    const recentCost = recent.reduce((sum, r) => sum + (r.costEstimate ?? 0), 0);
    const hourlyBudget = (config as any).hourlyBudget ?? 1.0;
    budgetRemaining = hourlyBudget - recentCost;
  }

  let experienceHit: import('../intelligence/types.js').RouteDecision | null = null;
  if (!sys.intelligence.evolver.isStagnant()) {
    try {
      experienceHit = sys.intelligence.router.route(content) ?? null;
    } catch { /* 路由失败走原有逻辑 */ }
  }

  return {
    budgetRemaining,
    availableNodeCount: availableModelCount,
    localCoverageRatio,
    localConfidence,
    userCorrectionCount: wsUserCorrectionCount(),
    experienceHit,
    toolHealth: collectToolHealth(sys),
  };
}

// ==================== 节点选择 ====================

/**
 * 选择本地专家节点
 */
export function pickLocalExperts(sys: Subsystems, domains: string[], content: string): OrchestrationNode[] {
  if (domains.length === 0) {
    const selected = sys.ternaryRouter.selectDomain(content);
    if (selected) {
      return [{ id: `ternary/${selected}`, type: 'local_expert', domain: selected }];
    }
    return [{ id: 'fallback', type: 'cloud_node' }];
  }
  return domains.map(d => ({
    id: `ternary/${d}`,
    type: 'local_expert' as const,
    domain: d,
  }));
}

/**
 * 选择多领域专家节点（并行）
 */
export function pickMultiExperts(sys: Subsystems, domains: string[], content: string): OrchestrationNode[] {
  const nodes: OrchestrationNode[] = [];

  for (const d of domains) {
    const expert = sys.ternaryRouter.listExperts().find(e => e.domain.toLowerCase() === d && e.growthStage !== 'seed');
    if (expert) {
      nodes.push({ id: `ternary/${d}`, type: 'local_expert', domain: d });
    }
  }

  const poolForNodes = sys.router.getPool();
  const cloudProfiles = poolForNodes?.getAllProfiles() ?? [];
  for (const profile of cloudProfiles) {
    if (nodes.length >= 3) break;
    if (!nodes.some(n => n.id === profile.id)) {
      nodes.push({ id: profile.id, type: 'cloud_node', model: profile.id.split('/').slice(1).join('/') });
    }
  }

  if (nodes.length < 2) {
    nodes.push({ id: 'fallback', type: 'cloud_node' });
  }

  return nodes;
}
