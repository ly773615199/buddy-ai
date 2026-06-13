/**
 * TaskProgressTracker — 任务进度感知器
 *
 * 包装 TaskExecutor，在每个任务状态变更时发射进度事件
 * 基于历史同类任务的平均耗时估算剩余时间
 * 卡住检测（>30s 无进度变更）
 *
 * 增强（前沿调研补充 7.4）：
 * - 冷启动策略：前 3 次用中位数，之后切换 EWMA
 */

import type { TaskDAG, Task, OrchestrateEvent, TaskStatus } from './types.js';
import { dagStats } from './dag.js';

// ==================== 类型定义 ====================

export interface TaskProgress {
  taskType: string;
  phase: 'planning' | 'executing' | 'verifying' | 'summarizing';
  steps: ProgressStep[];
  currentStep: number;
  totalSteps: number;
  percentComplete: number;        // 0-100
  estimatedRemainingMs: number;
  elapsedMs: number;
  stalled: boolean;
  stalledSinceMs?: number;
  stalledReason?: string;
}

export interface ProgressStep {
  name: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  startedAt?: number;
  finishedAt?: number;
  result?: string;
}

export interface ProgressEvent {
  type: 'task_progress';
  dagId: string;
  progress: TaskProgress;
  timestamp: number;
}

// ==================== 历史耗时统计 ====================

/** 按 taskType 统计的历史完成时间 */
const taskHistory = new Map<string, number[]>();
const MAX_HISTORY_PER_TYPE = 50;

function recordDuration(taskType: string, durationMs: number): void {
  let history = taskHistory.get(taskType);
  if (!history) {
    history = [];
    taskHistory.set(taskType, history);
  }
  history.push(durationMs);
  if (history.length > MAX_HISTORY_PER_TYPE) {
    history.shift();
  }
}

function estimateDuration(taskType: string, elapsedMs: number, completedSteps: number): number {
  const history = taskHistory.get(taskType);

  // 冷启动：无历史或不足 3 次，用当前进度推算
  if (!history || history.length < 3) {
    if (completedSteps > 0) {
      const avgPerStep = elapsedMs / completedSteps;
      return avgPerStep; // 返回每步平均耗时
    }
    return 5000; // 默认 5 秒/步
  }

  // 积累后：EWMA
  const alpha = 0.3;
  let ewma = history[0];
  for (let i = 1; i < history.length; i++) {
    ewma = alpha * history[i] + (1 - alpha) * ewma;
  }
  return ewma;
}

// ==================== 进度追踪器 ====================

export class TaskProgressTracker {
  private dagId: string = '';
  private startMs: number = 0;
  private steps: ProgressStep[] = [];
  private lastProgressMs: number = 0;
  private readonly STALL_THRESHOLD_MS = 30_000; // 30 秒无进度 = 卡住
  private onProgress: ((event: ProgressEvent) => void) | null = null;
  private verbose: boolean;

  constructor(verbose = false) {
    this.verbose = verbose;
  }

  /** 设置进度回调 */
  setOnProgress(cb: (event: ProgressEvent) => void): void {
    this.onProgress = cb;
  }

  /** 开始追踪一个 DAG */
  start(dag: TaskDAG): void {
    this.dagId = dag.id;
    this.startMs = Date.now();
    this.lastProgressMs = this.startMs;
    this.steps = [];

    for (const task of dag.tasks.values()) {
      this.steps.push({
        name: task.id,
        status: task.status === 'ready' ? 'pending' : task.status as ProgressStep['status'],
      });
    }

    this.emitProgress('executing');
  }

  /** 更新单个任务状态 */
  updateTask(taskId: string, status: TaskStatus, result?: string): void {
    const step = this.steps.find(s => s.name === taskId);
    if (!step) {
      // 尝试用索引匹配
      const idx = parseInt(taskId, 10);
      if (!isNaN(idx) && this.steps[idx]) {
        this.updateStep(this.steps[idx], status, result);
      }
      return;
    }
    this.updateStep(step, status, result);
  }

  /** 从 DAG 事件更新 */
  onEvent(event: OrchestrateEvent): void {
    switch (event.type) {
      case 'orch_task_start': {
        const step = this.findStepByTaskId(event.taskId);
        if (step) this.updateStep(step, 'running');
        break;
      }
      case 'orch_task_done': {
        const step = this.findStepByTaskId(event.taskId);
        if (step) {
          this.updateStep(step, 'done', event.result);
          // 记录历史耗时
          if (step.startedAt && step.finishedAt) {
            recordDuration('default', step.finishedAt - step.startedAt);
          }
        }
        break;
      }
      case 'orch_task_fail': {
        const step = this.findStepByTaskId(event.taskId);
        if (step) this.updateStep(step, 'failed', event.error);
        break;
      }
      case 'orch_task_skipped': {
        const step = this.findStepByTaskId(event.taskId);
        if (step) this.updateStep(step, 'skipped');
        break;
      }
      case 'orch_progress':
        this.lastProgressMs = Date.now();
        this.emitProgress('executing');
        break;
      case 'orch_done':
        this.emitProgress('summarizing');
        break;
    }
  }

  /** 获取当前进度 */
  getProgress(): TaskProgress {
    const now = Date.now();
    const elapsedMs = now - this.startMs;
    const doneCount = this.steps.filter(s => s.status === 'done' || s.status === 'skipped').length;
    const totalSteps = this.steps.length;
    const percentComplete = totalSteps > 0 ? Math.round((doneCount / totalSteps) * 100) : 0;

    // 估算剩余时间
    const avgDuration = estimateDuration('default', elapsedMs, doneCount);
    const remainingSteps = totalSteps - doneCount;
    const estimatedRemainingMs = doneCount > 0
      ? avgDuration * remainingSteps
      : avgDuration * totalSteps;

    // 卡住检测
    const stalled = (now - this.lastProgressMs) > this.STALL_THRESHOLD_MS;

    return {
      taskType: 'default',
      phase: 'executing',
      steps: [...this.steps],
      currentStep: doneCount,
      totalSteps,
      percentComplete,
      estimatedRemainingMs: stalled ? Infinity : estimatedRemainingMs,
      elapsedMs,
      stalled,
      stalledSinceMs: stalled ? this.lastProgressMs : undefined,
      stalledReason: stalled ? `${Math.round((now - this.lastProgressMs) / 1000)}s 无进度变更` : undefined,
    };
  }

  // ==================== 内部 ====================

  private updateStep(step: ProgressStep, status: TaskStatus, result?: string): void {
    const prevStatus = step.status;
    step.status = status as ProgressStep['status'];

    if (status === 'running' && prevStatus !== 'running') {
      step.startedAt = Date.now();
    }
    if ((status === 'done' || status === 'failed' || status === 'skipped') && !step.finishedAt) {
      step.finishedAt = Date.now();
    }
    if (result !== undefined) {
      step.result = result;
    }

    this.lastProgressMs = Date.now();
    this.emitProgress('executing');
  }

  private findStepByTaskId(taskId: string): ProgressStep | undefined {
    // 先按 name 匹配
    let step = this.steps.find(s => s.name === taskId);
    if (step) return step;

    // 按 DAG task 顺序匹配（taskId 可能是 step.0, step.1 等）
    const match = taskId.match(/step\.(\d+)/);
    if (match) {
      const idx = parseInt(match[1], 10);
      return this.steps[idx];
    }

    return undefined;
  }

  private emitProgress(phase: TaskProgress['phase']): void {
    if (!this.onProgress) return;

    const progress = this.getProgress();
    progress.phase = phase;

    this.onProgress({
      type: 'task_progress',
      dagId: this.dagId,
      progress,
      timestamp: Date.now(),
    });

    if (this.verbose && progress.stalled) {
      console.warn(`[Progress] ⚠️ 任务卡住: ${progress.stalledReason}`);
    }
  }
}
