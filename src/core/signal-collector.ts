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
import { IntentClassifier } from './intent-classifier.js';

/** 全局细粒度意图分类器单例（零延迟关键词匹配，可复用） */
const _intentClassifier = new IntentClassifier();

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

  // Phase 2.2: 扩展 DAG 触发条件
  const intentCategory = intent.category;
  const suggestedTools = intent.suggestedTools ?? [];
  const multiToolNeed = suggestedTools.length >= 3;
  const complexAndLong = (intentCategory === 'complex_task') && content.length > 300;
  const multiDomain = intent.confidence < 0.5 && content.length > 150; // 意图不明确 + 长内容 = 可能跨领域

  const shouldUseDAG = markerCount >= 3 || clauses.length >= 4 || multiToolNeed || complexAndLong || multiDomain;
  const dagReason = shouldUseDAG
    ? (markerCount >= 3 ? `并行标记词 ${markerCount} 个`
      : clauses.length >= 4 ? `子句 ${clauses.length} 个`
      : multiToolNeed ? `多工具需求 ${suggestedTools.length} 个`
      : complexAndLong ? `复杂任务+长内容(${content.length}字)`
      : `跨领域+长内容`)
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
 * Step 4: 集成细粒度意图层 — 当主分类器置信度低时，用 IntentClassifier 补充
 */
export function collectPerceptionState(sys: Subsystems, content: string): PerceptionState {
  const t0 = performance.now();

  // 一次调用，获取完整意图信息（关键词 + TextEncoder + 原型匹配）
  const intent = sys.threeBrain!.right.classifyFromText(content);

  // Step 4: 细粒度意图层补充 — 当主分类器未命中或低置信度时
  let finalCategory = intent.category;
  let finalConfidence = intent.confidence;
  let finalTools = intent.suggestedTools;
  let finalHit = intent.hit;

  if (!intent.hit || intent.confidence < 0.5) {
    const fineResult = _intentClassifier.classify(content);
    // 细粒度命中且置信度更高 → 补充/覆盖
    if (fineResult.confidence > finalConfidence) {
      finalCategory = fineResult.category;
      finalConfidence = fineResult.confidence;
      finalTools = fineResult.suggestedTools;
      finalHit = true;
    }
  }

  // 从意图推断领域
  const domains = inferDomains({ category: finalCategory, suggestedTools: finalTools });

  // 复杂度评估
  const complexity = assessComplexity(content, { category: finalCategory, confidence: finalConfidence });

  // DAG 判断
  const { shouldUseDAG, dagReason } = assessDAG(content);

  // 任务类型映射
  const taskType = mapTaskType(finalCategory);

  return {
    intent: {
      category: finalCategory,
      confidence: finalConfidence,
      hit: finalHit,
      suggestedTools: finalTools,
      protoMatch: intent.protoMatch,
    },
    domains,
    complexity,
    taskType,
    shouldUseDAG,
    dagReason,
    intentConfidence: finalConfidence,
    embedding: intent.embedding,
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
 * Step 10: 优先从 ResourceHub 读取实时数据，fallback 到硬编码估算
 */
export function collectResourceState(
  sys: Subsystems,
  config: BuddyConfig,
  wsUserCorrectionCount: () => number,
  content: string,
  signal: TaskSignal,
): ResourceState {
  const hub = sys.resourceHub;

  // Step 10: 优先从 ResourceHub 读取资源状态
  let availableModelCount: number;
  let localCoverageRatio: number;
  let localConfidence: number;
  let budgetRemaining: number;

  if (hub) {
    // 从 ResourceHub 读取实时数据
    const allModels = hub.getActive('model');

    // 如果 ResourceHub 尚未同步（异步初始化中），fallback 到直接查询
    if (allModels.length === 0) {
      const pool = sys.router.getPool();
      availableModelCount = pool?.profileCount ?? 0;
    } else {
      availableModelCount = allModels.length;
    }

    const localExperts = hub.getActive('expert');
    const coveredDomains = signal.domains.filter(d =>
      localExperts.some(e => e.strengths.domains[d]?.successes > 0)
    );
    localCoverageRatio = signal.domains.length > 0 ? coveredDomains.length / signal.domains.length : 0;

    localConfidence = coveredDomains.length > 0
      ? Math.max(...coveredDomains.map(d => {
          const expert = localExperts.find(e => e.strengths.domains[d]);
          if (!expert) return 0;
          const stats = expert.strengths.domains[d];
          return stats.attempts >= 3 ? stats.successes / stats.attempts : 0.5;
        }))
      : 0;

    // 预算：从 ResourceHub 汇总
    const hourlyBudget = (config as any).hourlyBudget ?? 1.0;
    const recentCost = allModels.reduce((sum, m) => sum + m.stats.totalCost, 0);
    budgetRemaining = hourlyBudget - recentCost;
  } else {
    // fallback: 硬编码估算（原逻辑）
    const localExperts = sys.ternaryRouter.listExperts();
    const pool = sys.router.getPool();
    availableModelCount = pool?.profileCount ?? 0;

    const matureExperts = localExperts.filter(e => e.growthStage !== 'seed');
    const coveredDomains = signal.domains.filter(d =>
      matureExperts.some(e => e.domain.toLowerCase() === d)
    );
    localCoverageRatio = signal.domains.length > 0 ? coveredDomains.length / signal.domains.length : 0;

    const recorder = sys.router.getDecisionRecorder();
    localConfidence = coveredDomains.length > 0
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

    budgetRemaining = Infinity;
    if (recorder) {
      const oneHourAgo = Date.now() - 3600_000;
      const recent = recorder.getByTimeRange(oneHourAgo, Date.now());
      const recentCost = recent.reduce((sum, r) => sum + (r.costEstimate ?? 0), 0);
      const hourlyBudget = (config as any).hourlyBudget ?? 1.0;
      budgetRemaining = hourlyBudget - recentCost;
    }
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
