/**
 * PlanManager — 方案管理器
 *
 * 职责：
 * - 创建方案（从需求生成）
 * - 版本管理（修改时自动创建新版本，保留历史链）
 * - 决策记录（每个关键决策点自动记录）
 * - 方案比对（版本间 diff）
 */

import { randomUUID } from 'crypto';
import type { ProjectStore } from './store.js';
import type { Plan, PlanStep, Decision, Requirement } from './types.js';

// ==================== Diff 类型 ====================

export interface PlanDiff {
  planA: { id: string; version: number; title: string };
  planB: { id: string; version: number; title: string };
  titleChanged: boolean;
  descriptionChanged: boolean;
  addedSteps: PlanStep[];
  removedSteps: PlanStep[];
  modifiedSteps: Array<{
    stepId: string;
    field: string;
    before: unknown;
    after: unknown;
  }>;
  addedDecisions: Decision[];
  removedDecisions: Decision[];
  summary: string;
}

// ==================== PlanManager ====================

export class PlanManager {
  constructor(private store: ProjectStore) {}

  /**
   * 从需求列表创建初版方案
   */
  createPlan(
    projectId: string,
    title: string,
    options?: {
      description?: string;
      requirements?: Requirement[];
      steps?: PlanStep[];
      decisions?: Decision[];
      estimatedDurationMs?: number;
    },
  ): Plan {
    const now = Date.now();
    const id = `plan_${randomUUID().slice(0, 8)}`;

    // 如果有需求但没有步骤，自动从需求生成基础步骤
    const requirements = options?.requirements ?? this.store.getProject(projectId)?.requirements ?? [];
    const steps = options?.steps ?? (requirements.length
      ? this.requirementsToSteps(requirements)
      : []);

    const plan: Plan = {
      id,
      projectId,
      title,
      description: options?.description ?? '',
      version: 1,
      status: 'draft',
      steps,
      decisions: options?.decisions ?? [],
      estimatedDurationMs: options?.estimatedDurationMs,
      createdAt: now,
      updatedAt: now,
    };

    this.store.createPlan(plan);

    // 自动关联为项目当前方案
    this.store.updateProject(projectId, { currentPlanId: id });

    return plan;
  }

  /**
   * 创建方案的新版本（基于当前最新版本）
   */
  createNewVersion(
    planId: string,
    changes: {
      title?: string;
      description?: string;
      steps?: PlanStep[];
      decisions?: Decision[];
      reason: string;
    },
  ): Plan {
    const original = this.store.getPlan(planId);
    if (!original) throw new Error(`Plan not found: ${planId}`);

    // 将旧版本标记为 superseded
    this.store.supersedePlan(original.id);

    const now = Date.now();
    const newPlan: Plan = {
      id: `plan_${randomUUID().slice(0, 8)}`,
      projectId: original.projectId,
      title: changes.title ?? original.title,
      description: changes.description ?? original.description,
      version: original.version + 1,
      parentVersionId: original.id,
      status: 'draft',
      steps: changes.steps ?? [...original.steps],
      decisions: changes.decisions ?? [...original.decisions],
      estimatedDurationMs: original.estimatedDurationMs,
      createdAt: now,
      updatedAt: now,
    };

    // 在新版本的决策列表中追加变更原因
    newPlan.decisions.push({
      id: `dec_${randomUUID().slice(0, 8)}`,
      question: '为什么创建新版本？',
      options: [],
      chosen: changes.reason,
      reasoning: `基于 v${original.version} 创建 v${newPlan.version}`,
      timestamp: now,
    });

    this.store.createPlan(newPlan);

    // 更新项目当前方案
    this.store.updateProject(original.projectId, { currentPlanId: newPlan.id });

    return newPlan;
  }

  /**
   * 记录一个决策到方案
   */
  recordDecision(
    planId: string,
    decision: {
      question: string;
      options: string[];
      chosen: string;
      reasoning: string;
      consequences?: string[];
    },
  ): Decision {
    const plan = this.store.getPlan(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);

    const fullDecision: Decision = {
      id: `dec_${randomUUID().slice(0, 8)}`,
      question: decision.question,
      options: decision.options,
      chosen: decision.chosen,
      reasoning: decision.reasoning,
      consequences: decision.consequences,
      timestamp: Date.now(),
    };

    const updatedDecisions = [...plan.decisions, fullDecision];
    this.store.updatePlan(planId, { decisions: updatedDecisions });

    return fullDecision;
  }

  /**
   * 获取方案版本链（从最早到最新）
   */
  getVersionChain(projectId: string): Plan[] {
    return this.store.getPlanVersions(projectId);
  }

  /**
   * 版本间 diff
   */
  diffVersions(planIdA: string, planIdB: string): PlanDiff {
    const planA = this.store.getPlan(planIdA);
    const planB = this.store.getPlan(planIdB);
    if (!planA) throw new Error(`Plan not found: ${planIdA}`);
    if (!planB) throw new Error(`Plan not found: ${planIdB}`);

    // 步骤变更
    const stepsA = new Map(planA.steps.map(s => [s.id, s]));
    const stepsB = new Map(planB.steps.map(s => [s.id, s]));

    const addedSteps = planB.steps.filter(s => !stepsA.has(s.id));
    const removedSteps = planA.steps.filter(s => !stepsB.has(s.id));

    const modifiedSteps: PlanDiff['modifiedSteps'] = [];
    for (const [id, stepB] of stepsB) {
      const stepA = stepsA.get(id);
      if (!stepA) continue;

      const fields: Array<keyof PlanStep> = ['title', 'description', 'tool', 'status', 'output'];
      for (const field of fields) {
        if (JSON.stringify(stepA[field]) !== JSON.stringify(stepB[field])) {
          modifiedSteps.push({ stepId: id, field, before: stepA[field], after: stepB[field] });
        }
      }
      // deps 比较
      if (JSON.stringify(stepA.deps) !== JSON.stringify(stepB.deps)) {
        modifiedSteps.push({ stepId: id, field: 'deps', before: stepA.deps, after: stepB.deps });
      }
    }

    // 决策变更
    const decA = new Set(planA.decisions.map(d => d.id));
    const decB = new Set(planB.decisions.map(d => d.id));
    const addedDecisions = planB.decisions.filter(d => !decA.has(d.id));
    const removedDecisions = planA.decisions.filter(d => !decB.has(d.id));

    // 生成摘要
    const parts: string[] = [];
    if (planA.title !== planB.title) parts.push(`标题: "${planA.title}" → "${planB.title}"`);
    if (planA.description !== planB.description) parts.push('描述已变更');
    if (addedSteps.length) parts.push(`+${addedSteps.length} 步骤`);
    if (removedSteps.length) parts.push(`-${removedSteps.length} 步骤`);
    if (modifiedSteps.length) parts.push(`~${modifiedSteps.length} 步骤变更`);
    if (addedDecisions.length) parts.push(`+${addedDecisions.length} 决策`);
    if (removedDecisions.length) parts.push(`-${removedDecisions.length} 决策`);

    return {
      planA: { id: planA.id, version: planA.version, title: planA.title },
      planB: { id: planB.id, version: planB.version, title: planB.title },
      titleChanged: planA.title !== planB.title,
      descriptionChanged: planA.description !== planB.description,
      addedSteps,
      removedSteps,
      modifiedSteps,
      addedDecisions,
      removedDecisions,
      summary: parts.length > 0 ? parts.join(' | ') : '无变更',
    };
  }

  /**
   * 更新方案步骤状态
   */
  updateStepStatus(
    planId: string,
    stepId: string,
    status: PlanStep['status'],
    output?: string,
  ): void {
    const plan = this.store.getPlan(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);

    const steps = plan.steps.map(s => {
      if (s.id !== stepId) return s;
      return { ...s, status, output: output ?? s.output };
    });

    this.store.updatePlan(planId, { steps });
  }

  /**
   * 从需求自动生成基础步骤
   */
  private requirementsToSteps(requirements: Requirement[]): PlanStep[] {
    return requirements.map((req, i) => ({
      id: `step_${randomUUID().slice(0, 8)}`,
      title: `实现: ${req.title}`,
      description: req.description || `满足需求: ${req.title}`,
      deps: i > 0 ? [`step_prev`] : [], // 简单线性依赖
      status: 'pending' as const,
    }));
  }
}
