/**
 * ExecutionSession — 执行会话管理
 *
 * 管理一次任务执行的完整生命周期：
 * 规划 → 执行 → 校验 → 确认 → 完成
 *
 * 核心原则：每一步都能被纠偏，而不是跑完才知道错了
 */

// ==================== 类型 ====================

export type AutonomyLevel = 0 | 1 | 2 | 3;
export type SessionStatus = 'planning' | 'executing' | 'paused' | 'done' | 'failed';

export interface ExecutionStep {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  result?: string;
  success?: boolean;
  verified?: boolean;
  retryCount: number;
  startedAt?: number;
  completedAt?: number;
}

export interface Checkpoint {
  stepIndex: number;
  question: string;
  autoVerify?: () => boolean;
  userConfirmed?: boolean;
}

export interface ExecutionSessionConfig {
  id: string;
  goal: string;
  autonomyLevel: AutonomyLevel;
  maxRetries: number;
  maxSteps: number;
  checkpointInterval: number; // 每 N 步设置一个检查点
}

export interface SessionSnapshot {
  id: string;
  goal: string;
  status: SessionStatus;
  autonomyLevel: AutonomyLevel;
  steps: ExecutionStep[];
  checkpoints: Checkpoint[];
  createdAt: number;
  updatedAt: number;
  totalMs: number;
}

// ==================== 自主等级判定 ====================

/**
 * 根据任务风险和用户历史决定自主等级
 */
export function decideAutonomyLevel(context: {
  taskRisk: 'low' | 'medium' | 'high';
  userCorrectionCount: number;  // 用户纠正次数
  sessionLength: number;        // 当前会话消息数
  isFirstSession: boolean;
}): AutonomyLevel {
  // 新用户 → L0
  if (context.isFirstSession) return 0;

  // 高风险任务 → 最多 L1
  if (context.taskRisk === 'high') {
    return context.userCorrectionCount < 3 ? 1 : 0;
  }

  // 用户纠正多 → 降低自主等级
  if (context.userCorrectionCount >= 5) return 0;
  if (context.userCorrectionCount >= 3) return 1;

  // 中等风险 + 纠正少 → L2
  if (context.taskRisk === 'medium') return 2;

  // 低风险 + 纠正少 + 长会话 → L3
  if (context.sessionLength > 20 && context.userCorrectionCount === 0) return 3;

  return 2;
}

/**
 * 评估任务风险等级
 */
export function assessTaskRisk(goal: string): 'low' | 'medium' | 'high' {
  const highRiskPatterns = /删除|deploy|rm\s|drop|truncate|push\s.*--force|format|mkfs|生产|production/i;
  const mediumRiskPatterns = /修改|创建|新建|update|write|create|install|配置|config|重启|restart/i;

  if (highRiskPatterns.test(goal)) return 'high';
  if (mediumRiskPatterns.test(goal)) return 'medium';
  return 'low';
}

// ==================== ExecutionSession ====================

export class ExecutionSession {
  readonly id: string;
  readonly goal: string;
  readonly autonomyLevel: AutonomyLevel;
  private status: SessionStatus = 'planning';
  private steps: ExecutionStep[] = [];
  private checkpoints: Checkpoint[] = [];
  private readonly maxRetries: number;
  private readonly maxSteps: number;
  private readonly checkpointInterval: number;
  private readonly createdAt: number;
  private updatedAt: number;
  private stepCounter = 0;

  constructor(config: ExecutionSessionConfig) {
    this.id = config.id;
    this.goal = config.goal;
    this.autonomyLevel = config.autonomyLevel;
    this.maxRetries = config.maxRetries;
    this.maxSteps = config.maxSteps;
    this.checkpointInterval = config.checkpointInterval;
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }

  // ==================== 状态管理 ====================

  start(): void {
    if (this.status !== 'planning') throw new Error('只能从 planning 状态开始');
    this.status = 'executing';
    this.updatedAt = Date.now();
  }

  pause(): void {
    this.status = 'paused';
    this.updatedAt = Date.now();
  }

  resume(): void {
    if (this.status !== 'paused') throw new Error('只能从 paused 状态恢复');
    this.status = 'executing';
    this.updatedAt = Date.now();
  }

  complete(): void {
    this.status = 'done';
    this.updatedAt = Date.now();
  }

  fail(reason: string): void {
    this.status = 'failed';
    this.updatedAt = Date.now();
  }

  getStatus(): SessionStatus {
    return this.status;
  }

  // ==================== 步骤管理 ====================

  addStep(tool: string, args: Record<string, unknown>): ExecutionStep {
    if (this.steps.length >= this.maxSteps) {
      throw new Error(`超过最大步骤数 (${this.maxSteps})`);
    }

    const step: ExecutionStep = {
      id: `step-${++this.stepCounter}`,
      tool,
      args,
      retryCount: 0,
      startedAt: Date.now(),
    };
    this.steps.push(step);
    this.updatedAt = Date.now();

    // 自动设置检查点
    if (this.steps.length % this.checkpointInterval === 0) {
      this.addCheckpoint(this.steps.length - 1, `已完成 ${this.steps.length} 步，确认继续？`);
    }

    return step;
  }

  completeStep(stepId: string, result: string, success: boolean): void {
    const step = this.steps.find(s => s.id === stepId);
    if (!step) return;

    step.result = result;
    step.success = success;
    step.completedAt = Date.now();
    this.updatedAt = Date.now();
  }

  retryStep(stepId: string): boolean {
    const step = this.steps.find(s => s.id === stepId);
    if (!step || step.retryCount >= this.maxRetries) return false;

    step.retryCount++;
    step.result = undefined;
    step.success = undefined;
    step.verified = undefined;
    step.startedAt = Date.now();
    step.completedAt = undefined;
    this.updatedAt = Date.now();
    return true;
  }

  verifyStep(stepId: string, verified: boolean): void {
    const step = this.steps.find(s => s.id === stepId);
    if (step) {
      step.verified = verified;
      this.updatedAt = Date.now();
    }
  }

  getSteps(): readonly ExecutionStep[] {
    return this.steps;
  }

  getCurrentStep(): ExecutionStep | undefined {
    return this.steps[this.steps.length - 1];
  }

  // ==================== 检查点 ====================

  addCheckpoint(stepIndex: number, question: string, autoVerify?: () => boolean): void {
    this.checkpoints.push({ stepIndex, question, autoVerify });
    this.updatedAt = Date.now();
  }

  confirmCheckpoint(stepIndex: number): void {
    const cp = this.checkpoints.find(c => c.stepIndex === stepIndex);
    if (cp) {
      cp.userConfirmed = true;
      this.updatedAt = Date.now();
    }
  }

  getPendingCheckpoints(): Checkpoint[] {
    return this.checkpoints.filter(c => !c.userConfirmed);
  }

  hasPendingCheckpoint(): boolean {
    return this.checkpoints.some(c => !c.userConfirmed);
  }

  // ==================== 决策：是否需要用户确认 ====================

  /**
   * 根据自主等级决定是否需要暂停让用户确认
   */
  shouldPauseForConfirmation(tool: string, args: Record<string, unknown>): boolean {
    switch (this.autonomyLevel) {
      case 0: // 每步都确认
        return true;
      case 1: { // 高风险确认
        const risk = assessTaskRisk(`${tool} ${JSON.stringify(args)}`);
        return risk === 'high';
      }
      case 2: // 只在检查点确认
        return this.hasPendingCheckpoint();
      case 3: // 全自动
        return false;
      default:
        return true;
    }
  }

  // ==================== 快照 ====================

  getSnapshot(): SessionSnapshot {
    return {
      id: this.id,
      goal: this.goal,
      status: this.status,
      autonomyLevel: this.autonomyLevel,
      steps: [...this.steps],
      checkpoints: [...this.checkpoints],
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      totalMs: Date.now() - this.createdAt,
    };
  }

  // ==================== Phase 1.2: 检查点持久化 ====================

  /** 序列化为 ExecutionCheckpoint，供 ProjectStore 持久化 */
  toCheckpoint(): import('../project/types.js').ExecutionCheckpoint {
    const completedSteps = this.steps
      .filter(s => s.completedAt && s.success !== undefined)
      .map(s => ({ tool: s.tool, result: s.result ?? '', success: s.success! }));
    const failedSteps = this.steps
      .filter(s => s.completedAt && s.success === false)
      .map(s => ({ tool: s.tool, error: s.result ?? 'unknown' }));
    const pendingSteps = this.steps
      .filter(s => !s.completedAt)
      .map(s => ({ tool: s.tool, args: s.args }));

    // 结构化续做信息
    const nextStep = this.steps.find(s => !s.completedAt);
    const resumePlan = nextStep ? {
      nextStep: `${nextStep.tool}(${JSON.stringify(nextStep.args).slice(0, 100)})`,
      requiredContext: this.extractRequiredContext(nextStep),
      estimatedRemaining: pendingSteps.length,
    } : undefined;

    const progress = {
      total: this.steps.length,
      done: completedSteps.length,
      failed: failedSteps.length,
      current: nextStep?.tool ?? '已完成',
      percent: this.steps.length > 0 ? Math.round(completedSteps.length / this.steps.length * 100) : 100,
    };

    return {
      id: this.id,
      goal: this.goal,
      status: this.status === 'done' ? 'completed' : this.status === 'failed' ? 'failed' : 'in_progress',
      autonomyLevel: this.autonomyLevel,
      completedSteps,
      failedSteps,
      pendingSteps,
      lessons: [],
      context: {},
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      resumeCount: 0,
      resumePlan,
      progress,
    };
  }

  /** 从 ExecutionCheckpoint 恢复会话 */
  /** 从步骤中提取需要的上下文信息 */
  private extractRequiredContext(step: ExecutionStep): string[] {
    const context: string[] = [];
    // 从 args 中提取文件路径、关键参数
    for (const [key, val] of Object.entries(step.args)) {
      if (typeof val === 'string') {
        if (val.includes('/') || val.includes('\\') || val.includes('.')) {
          context.push(`${key}: ${val}`); // 可能是文件路径
        } else if (val.length > 10 && val.length < 200) {
          context.push(`${key}: ${val.slice(0, 80)}`);
        }
      }
    }
    return context;
  }

  static fromCheckpoint(cp: import('../project/types.js').ExecutionCheckpoint): ExecutionSession {
    const session = new ExecutionSession({
      id: cp.id,
      goal: cp.goal,
      autonomyLevel: cp.autonomyLevel as AutonomyLevel,
      maxRetries: 2,
      maxSteps: 20,
      checkpointInterval: 5,
    });
    // 恢复状态
    (session as any).status = cp.status === 'completed' ? 'done' : cp.status === 'failed' ? 'failed' : 'paused';
    (session as any).createdAt = cp.createdAt;
    (session as any).updatedAt = cp.updatedAt;

    // 恢复 steps（从 checkpoint 的 completedSteps + failedSteps + pendingSteps 重建）
    const steps: ExecutionStep[] = [];
    for (const cs of cp.completedSteps) {
      steps.push({
        id: `restored-${steps.length}`,
        tool: cs.tool,
        args: {},
        result: cs.result,
        success: cs.success,
        retryCount: 0,
        completedAt: cp.updatedAt,
      });
    }
    for (const fs of cp.failedSteps) {
      steps.push({
        id: `restored-${steps.length}`,
        tool: fs.tool,
        args: {},
        result: fs.error,
        success: false,
        retryCount: 0,
        completedAt: cp.updatedAt,
      });
    }
    for (const ps of cp.pendingSteps) {
      steps.push({
        id: `restored-${steps.length}`,
        tool: ps.tool,
        args: ps.args,
        retryCount: 0,
      });
    }
    (session as any).steps = steps;

    return session;
  }

  // ==================== 统计 ====================

  getStats(): {
    totalSteps: number;
    completedSteps: number;
    successfulSteps: number;
    failedSteps: number;
    retriedSteps: number;
    avgLatencyMs: number;
  } {
    const completed = this.steps.filter(s => s.completedAt);
    const successful = completed.filter(s => s.success);
    const failed = completed.filter(s => !s.success);
    const retried = this.steps.filter(s => s.retryCount > 0);

    const latencies = completed
      .filter(s => s.startedAt && s.completedAt)
      .map(s => s.completedAt! - s.startedAt!);

    return {
      totalSteps: this.steps.length,
      completedSteps: completed.length,
      successfulSteps: successful.length,
      failedSteps: failed.length,
      retriedSteps: retried.length,
      avgLatencyMs: latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 0,
    };
  }
}
