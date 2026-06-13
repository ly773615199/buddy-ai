/**
 * ExecutionManager — 执行管理器
 *
 * 职责：
 * - 将 Plan 的步骤绑定到 DAG 执行
 * - 支持暂停/恢复（写检查点 + DAG 状态）
 * - 与 ProjectProgressTracker 联动更新进度
 *
 * 设计：
 * ExecutionManager 是 ProjectModel 层的执行编排器，
 * 它不直接替代 WorkflowManager，而是在其之上提供项目级语义：
 * - Plan.steps → DAG tasks 映射
 * - 暂停 = 创建检查点 + 标记 paused
 * - 恢复 = 读取检查点 + 从断点继续
 */

import { randomUUID } from 'crypto';
import type { ProjectStore } from './store.js';
import type { ProjectProgressTracker } from './progress-tracker.js';
import type { DAGBinding, Checkpoint, PlanStep } from './types.js';

// ==================== 执行状态 ====================

export interface ExecutionStatus {
  binding: DAGBinding | null;
  progress: {
    totalSteps: number;
    completedSteps: number;
    failedSteps: number;
    skippedSteps: number;
    percentComplete: number;
  } | null;
  latestCheckpoint: Checkpoint | null;
  currentStep: PlanStep | null;
}

// ==================== ExecutionManager ====================

export class ExecutionManager {
  constructor(
    private store: ProjectStore,
    private progressTracker: ProjectProgressTracker,
  ) {}

  /**
   * 从 Plan 创建 DAG 绑定并开始执行
   *
   * 流程：
   * 1. 创建 DAGBinding 记录
   * 2. 初始化进度
   * 3. 创建初始检查点
   */
  startExecution(
    projectId: string,
    planId: string,
  ): DAGBinding {
    const plan = this.store.getPlan(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);

    const project = this.store.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    // 检查是否有活跃的执行
    const active = this.store.getActiveDAGBinding(projectId);
    if (active && (active.status === 'running' || active.status === 'paused')) {
      throw new Error(`项目 ${projectId} 已有活跃执行 (${active.id}: ${active.status})`);
    }

    const now = Date.now();
    const dagId = `dag_${randomUUID().slice(0, 8)}`;
    const bindingId = `bind_${randomUUID().slice(0, 8)}`;

    const binding: DAGBinding = {
      id: bindingId,
      projectId,
      planId,
      dagId,
      status: 'running',
      startedAt: now,
    };

    this.store.createDAGBinding(binding);

    // 更新方案状态
    this.store.updatePlan(planId, { status: 'executing' });

    // 更新项目状态
    this.store.updateProject(projectId, { status: 'active' });

    // 初始化进度
    this.progressTracker.initProgress(projectId, plan.steps.length);

    // 创建初始检查点
    this.progressTracker.createCheckpoint(projectId, planId, {
      completedSteps: [],
      pendingSteps: plan.steps.map(s => s.id),
      runningSteps: [],
      outputs: {},
      decisions: plan.decisions,
    }, {
      dagBindingId: bindingId,
      phase: 'started',
      note: '执行开始',
    });

    return binding;
  }

  /**
   * 暂停执行
   *
   * 流程：
   * 1. 创建检查点（保存当前所有状态）
   * 2. 更新 DAGBinding 状态为 paused
   * 3. 更新方案状态为 paused
   */
  pauseExecution(
    projectId: string,
    reason?: string,
  ): Checkpoint {
    const binding = this.store.getActiveDAGBinding(projectId);
    if (!binding) throw new Error(`项目 ${projectId} 没有活跃的执行`);
    if (binding.status === 'paused') throw new Error('执行已处于暂停状态');

    const plan = this.store.getPlan(binding.planId);
    if (!plan) throw new Error(`Plan not found: ${binding.planId}`);

    // 构建当前快照
    const snapshot = this.buildCurrentSnapshot(plan);

    // 创建检查点
    const cp = this.progressTracker.createCheckpoint(projectId, binding.planId, snapshot, {
      dagBindingId: binding.id,
      phase: 'paused',
      note: reason ?? '用户暂停',
    });

    // 更新绑定状态
    this.store.updateDAGBinding(binding.id, {
      status: 'paused',
      pauseReason: reason,
    });

    // 更新项目状态
    this.store.updateProject(projectId, { status: 'paused' });

    return cp;
  }

  /**
   * 恢复执行
   *
   * 流程：
   * 1. 读取最新检查点
   * 2. 恢复 DAGBinding 状态为 running
   * 3. 创建恢复检查点
   */
  resumeExecution(projectId: string): DAGBinding {
    const binding = this.store.getActiveDAGBinding(projectId);
    if (!binding) throw new Error(`项目 ${projectId} 没有活跃的执行`);
    if (binding.status !== 'paused') throw new Error('只有暂停状态的执行才能恢复');

    const checkpoint = this.store.getLatestCheckpoint(projectId);
    if (!checkpoint) throw new Error('没有找到检查点，无法恢复');

    // 更新绑定状态
    this.store.updateDAGBinding(binding.id, {
      status: 'running',
      resumedAt: Date.now(),
    });

    // 更新项目状态
    this.store.updateProject(projectId, { status: 'active' });

    // 创建恢复检查点
    this.progressTracker.createCheckpoint(projectId, binding.planId, checkpoint.snapshot, {
      dagBindingId: binding.id,
      phase: 'resumed',
      note: '从检查点恢复',
    });

    return this.store.getDAGBinding(binding.id)!;
  }

  /**
   * 完成执行
   */
  completeExecution(projectId: string): void {
    const binding = this.store.getActiveDAGBinding(projectId);
    if (!binding) throw new Error(`项目 ${projectId} 没有活跃的执行`);

    this.store.updateDAGBinding(binding.id, {
      status: 'completed',
      finishedAt: Date.now(),
    });

    this.store.updatePlan(binding.planId, { status: 'completed' });
    this.store.updateProject(projectId, {
      status: 'completed',
      completedAt: Date.now(),
    });
  }

  /**
   * 标记步骤完成（由外部调用）
   */
  markStepDone(projectId: string, stepId: string, output?: string): void {
    const binding = this.store.getActiveDAGBinding(projectId);
    if (!binding) return;

    // 更新步骤状态
    const plan = this.store.getPlan(binding.planId);
    if (!plan) return;

    const updatedSteps = plan.steps.map(s =>
      s.id === stepId ? { ...s, status: 'done' as const, output } : s,
    );
    this.store.updatePlan(binding.planId, { steps: updatedSteps });

    // 更新进度
    this.progressTracker.stepCompleted(projectId, stepId);

    // 每 3 步自动创建检查点
    const progress = this.store.getProgress(projectId);
    if (progress && progress.completedSteps % 3 === 0) {
      const snapshot = this.buildCurrentSnapshot({ ...plan, steps: updatedSteps });
      this.progressTracker.createCheckpoint(projectId, binding.planId, snapshot, {
        dagBindingId: binding.id,
        phase: 'auto-checkpoint',
        note: `自动检查点 (${progress.completedSteps}/${progress.totalSteps})`,
      });
    }
  }

  /**
   * 标记步骤失败
   */
  markStepFailed(projectId: string, stepId: string, error?: string): void {
    const binding = this.store.getActiveDAGBinding(projectId);
    if (!binding) return;

    const plan = this.store.getPlan(binding.planId);
    if (!plan) return;

    const updatedSteps = plan.steps.map(s =>
      s.id === stepId ? { ...s, status: 'failed' as const, output: error } : s,
    );
    this.store.updatePlan(binding.planId, { steps: updatedSteps });
    this.progressTracker.stepFailed(projectId, stepId);
  }

  /**
   * 标记步骤跳过
   */
  markStepSkipped(projectId: string, stepId: string): void {
    const binding = this.store.getActiveDAGBinding(projectId);
    if (!binding) return;

    const plan = this.store.getPlan(binding.planId);
    if (!plan) return;

    const updatedSteps = plan.steps.map(s =>
      s.id === stepId ? { ...s, status: 'skipped' as const } : s,
    );
    this.store.updatePlan(binding.planId, { steps: updatedSteps });
    this.progressTracker.stepSkipped(projectId, stepId);
  }

  /**
   * 获取执行状态
   */
  getExecutionStatus(projectId: string): ExecutionStatus {
    const binding = this.store.getActiveDAGBinding(projectId);
    const progress = this.store.getProgress(projectId);
    const latestCheckpoint = this.store.getLatestCheckpoint(projectId);

    let currentStep: PlanStep | null = null;
    if (binding) {
      const plan = this.store.getPlan(binding.planId);
      if (plan) {
        currentStep = plan.steps.find(s => s.status === 'running') ??
          plan.steps.find(s => s.status === 'ready') ??
          plan.steps.find(s => s.status === 'pending') ?? null;
      }
    }

    return {
      binding,
      progress: progress ? {
        totalSteps: progress.totalSteps,
        completedSteps: progress.completedSteps,
        failedSteps: progress.failedSteps,
        skippedSteps: progress.skippedSteps,
        percentComplete: progress.percentComplete,
      } : null,
      latestCheckpoint,
      currentStep,
    };
  }

  /**
   * 从当前计划构建快照
   */
  private buildCurrentSnapshot(plan: { steps: PlanStep[]; decisions: import('./types.js').Decision[] }): Checkpoint['snapshot'] {
    return {
      completedSteps: plan.steps.filter(s => s.status === 'done').map(s => s.id),
      pendingSteps: plan.steps.filter(s => s.status === 'pending').map(s => s.id),
      runningSteps: plan.steps.filter(s => s.status === 'running').map(s => s.id),
      outputs: Object.fromEntries(
        plan.steps.filter(s => s.output).map(s => [s.id, s.output!]),
      ),
      decisions: plan.decisions,
    };
  }
}
