/**
 * ProjectProgressTracker — 项目进度追踪器
 *
 * 职责：
 * - 初始化项目进度
 * - 步骤完成/失败/跳过时更新
 * - 创建检查点（快照当前完整状态）
 * - 估算剩余时间
 */

import { randomUUID } from 'crypto';
import type { ProjectStore } from './store.js';
import type { Checkpoint, ProgressCounter, Decision } from './types.js';

export class ProjectProgressTracker {
  constructor(private store: ProjectStore) {}

  /**
   * 初始化项目进度
   */
  initProgress(projectId: string, totalSteps: number): void {
    this.store.upsertProgress({
      projectId,
      totalSteps,
      completedSteps: 0,
      failedSteps: 0,
      skippedSteps: 0,
      percentComplete: 0,
      estimatedRemainingMs: 0,
      lastUpdated: Date.now(),
    });
  }

  /**
   * 步骤完成时更新
   */
  stepCompleted(projectId: string, _stepId: string): void {
    const progress = this.store.getProgress(projectId);
    if (!progress) return;

    const completedSteps = progress.completedSteps + 1;
    const percentComplete = progress.totalSteps > 0
      ? (completedSteps / progress.totalSteps) * 100
      : 0;

    this.store.upsertProgress({
      ...progress,
      completedSteps,
      percentComplete,
      estimatedRemainingMs: this.estimateRemaining(projectId, completedSteps),
      lastUpdated: Date.now(),
    });
  }

  /**
   * 步骤失败时更新
   */
  stepFailed(projectId: string, _stepId: string): void {
    const progress = this.store.getProgress(projectId);
    if (!progress) return;

    this.store.upsertProgress({
      ...progress,
      failedSteps: progress.failedSteps + 1,
      lastUpdated: Date.now(),
    });
  }

  /**
   * 步骤跳过时更新
   */
  stepSkipped(projectId: string, _stepId: string): void {
    const progress = this.store.getProgress(projectId);
    if (!progress) return;

    this.store.upsertProgress({
      ...progress,
      skippedSteps: progress.skippedSteps + 1,
      lastUpdated: Date.now(),
    });
  }

  /**
   * 创建检查点
   */
  createCheckpoint(
    projectId: string,
    planId: string,
    snapshot: Checkpoint['snapshot'],
    options?: {
      dagBindingId?: string;
      phase?: string;
      note?: string;
    },
  ): Checkpoint {
    const progress = this.store.getProgress(projectId);
    const progressPercent = progress?.percentComplete ?? 0;

    const cp: Checkpoint = {
      id: `cp_${randomUUID().slice(0, 8)}`,
      projectId,
      planId,
      dagBindingId: options?.dagBindingId,
      phase: options?.phase ?? 'executing',
      snapshot,
      progressPercent,
      timestamp: Date.now(),
      note: options?.note,
    };

    this.store.createCheckpoint(cp);
    return cp;
  }

  /**
   * 获取当前进度
   */
  getProgress(projectId: string): ProgressCounter | null {
    return this.store.getProgress(projectId);
  }

  /**
   * 估算剩余时间（EWMA）
   * 基于已完成步骤的平均耗时
   */
  private estimateRemaining(projectId: string, completedSteps: number): number {
    const progress = this.store.getProgress(projectId);
    if (!progress || completedSteps === 0) return 0;

    const elapsed = Date.now() - (progress.lastUpdated - (progress.estimatedRemainingMs || 0));
    const avgPerStep = completedSteps > 0 ? elapsed / completedSteps : 0;
    const remaining = progress.totalSteps - completedSteps;

    return Math.max(0, Math.round(avgPerStep * remaining));
  }
}
