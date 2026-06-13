import type { TaskDAG, Task, OrchestrateResult, OrchestrateEvent, RetryConfig } from './types.js';
import {
  getReadyTasksWithConditions, isDAGComplete, dagStats,
  skipUnreachable, getRetryConfig, calcRetryDelay, isRetryable, hasFailureFallback,
} from './dag.js';
import type { ToolRegistry } from '../tools/registry.js';
import { ToolExecutionMiddleware } from '../tools/execution-middleware.js';

type EventCallback = (event: OrchestrateEvent) => void;

/** 超时错误类型 — 用类型判断替代字符串匹配 */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`任务执行超时 (${ms}ms)`);
    this.name = 'TimeoutError';
  }
}

// ==================== Phase 3: 执行监控接口 ====================

/** 监控动作 */
export interface MonitorAction {
  action: 'continue' | 'continue_with_warning' | 'skip' | 'abort';
  reason?: string;
  fallback?: string;
}

/** 执行监控器接口 — 小脑全程监控 */
export interface ExecutionMonitor {
  onTaskStart(taskId: string, taskName: string): MonitorAction;
  onTaskDone(taskId: string, result: string): MonitorAction;
  onTaskFail(taskId: string, error: string): MonitorAction;
  onTaskTimeout(taskId: string, timeoutMs: number): MonitorAction;
  shouldAbort(): { abort: boolean; reason: string };
}

/**
 * 小脑执行监控器 — 基于 BodyState 的实时监控
 *
 * 功能：
 * - 连续失败熔断（≥ 2 个任务连续失败）
 * - 系统过载中止（load > 90）
 * - 精力极低中止（energy < 10）
 * - 每个任务事件注入小脑感知
 */
export class CerebellumExecutionMonitor implements ExecutionMonitor {
  private consecutiveFailures = 0;
  private readonly MAX_CONSECUTIVE_FAILURES = 2;
  private taskLog: Array<{ id: string; status: string; ts: number }> = [];

  constructor(
    private cerebellum: {
      regulate: (event: { type: string; timestamp: number; data: Record<string, unknown> }) => void;
      getBodyState: () => { load: number; energy: number };
    },
    private verbose: boolean = false,
  ) {}

  onTaskStart(taskId: string, taskName: string): MonitorAction {
    this.taskLog.push({ id: taskId, status: 'start', ts: Date.now() });
    return { action: 'continue' };
  }

  onTaskDone(taskId: string, result: string): MonitorAction {
    this.consecutiveFailures = 0;
    this.taskLog.push({ id: taskId, status: 'done', ts: Date.now() });

    // 小脑感知事件：成功
    this.cerebellum.regulate({
      type: 'tool_result',
      timestamp: Date.now(),
      data: { success: true, taskId },
    });

    return { action: 'continue' };
  }

  onTaskFail(taskId: string, error: string): MonitorAction {
    this.consecutiveFailures++;
    this.taskLog.push({ id: taskId, status: 'failed', ts: Date.now() });

    // 小脑感知事件：失败
    this.cerebellum.regulate({
      type: 'tool_result',
      timestamp: Date.now(),
      data: { success: false, taskId, error },
    });

    // 连续失败熔断
    if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
      if (this.verbose) {
        console.log(`[Monitor] 连续 ${this.consecutiveFailures} 个任务失败，触发熔断`);
      }
      return {
        action: 'abort',
        reason: `连续 ${this.consecutiveFailures} 个任务失败`,
        fallback: 'single_llm',
      };
    }

    return { action: 'continue_with_warning', reason: error };
  }

  onTaskTimeout(taskId: string, timeoutMs: number): MonitorAction {
    this.taskLog.push({ id: taskId, status: 'timeout', ts: Date.now() });
    return {
      action: 'skip',
      reason: `任务超时 (${timeoutMs}ms)`,
    };
  }

  shouldAbort(): { abort: boolean; reason: string } {
    const bodyState = this.cerebellum.getBodyState();

    // 系统过载时中止
    if (bodyState.load > 90) {
      return { abort: true, reason: `系统过载 (${bodyState.load}%)` };
    }

    // 精力极低时中止
    if (bodyState.energy < 10) {
      return { abort: true, reason: `精力极低 (${bodyState.energy})` };
    }

    return { abort: false, reason: '' };
  }

  /** 获取任务执行日志 */
  getTaskLog() { return [...this.taskLog]; }
}

/**
 * 任务调度执行器 v2
 * 支持：条件分支 / 重试 / 超时 / 并行
 */
export class TaskExecutor {
  private middleware: ToolExecutionMiddleware;

  constructor(
    private toolRegistry: ToolRegistry,
    private beforeToolExecute?: (name: string, args: Record<string, unknown>) => Promise<{ allowed: boolean; reason?: string }>,
    private verbose: boolean = false,
  ) {
    this.middleware = new ToolExecutionMiddleware(toolRegistry, {
      beforeExecute: beforeToolExecute,
      defaultTimeoutMs: 60000,
    });
  }

  /**
   * 执行整个 DAG
   */
  async execute(
    dag: TaskDAG,
    onEvent: EventCallback,
    maxParallel: number = 4,
    monitor?: ExecutionMonitor,
  ): Promise<OrchestrateResult> {
    const startMs = Date.now();
    dag.status = 'executing';

    const taskCount = dag.tasks.size;
    onEvent({
      type: 'orch_start',
      dagId: dag.id,
      description: dag.description,
      taskCount,
    });

    let sequentialEstimate = 0;
    let done = 0;

    while (!isDAGComplete(dag)) {
      // ── Phase 3: 监控检查 ──
      if (monitor) {
        const abortCheck = monitor.shouldAbort();
        if (abortCheck.abort) {
          dag.status = 'failed';
          const error = abortCheck.reason;
          onEvent({ type: 'orch_fail', dagId: dag.id, error });
          return {
            dagId: dag.id,
            success: false,
            summary: `执行中止: ${error}`,
            taskResults: [],
            totalMs: Date.now() - startMs,
            parallelismGain: 0,
          };
        }
      }

      // 跳过不可达任务（无 failure 边时生效）
      skipUnreachable(dag);

      // 获取就绪任务（考虑条件边）
      const ready = getReadyTasksWithConditions(dag);
      if (ready.length === 0) {
        const stats = dagStats(dag);
        if (stats.running === 0 && stats.retrying === 0 && stats.done + stats.failed + stats.skipped < stats.total) {
          dag.status = 'failed';
          const error = '任务编排死锁：存在无法满足的依赖';
          onEvent({ type: 'orch_fail', dagId: dag.id, error });
          return {
            dagId: dag.id,
            success: false,
            summary: error,
            taskResults: [],
            totalMs: Date.now() - startMs,
            parallelismGain: 0,
          };
        }
        // 有任务在运行或重试中，等待
        await new Promise(r => setTimeout(r, 50));
        continue;
      }

      // 并行执行就绪任务
      const batch = ready.slice(0, maxParallel);

      // ── Phase 3: 任务开始监控 ──
      for (const task of batch) {
        monitor?.onTaskStart(task.id, task.name);
      }

      const batchPromises = batch.map(task => this.executeTaskWithRetry(dag, task, onEvent, monitor));

      const results = await Promise.allSettled(batchPromises);

      for (let i = 0; i < results.length; i++) {
        const task = batch[i];
        const result = results[i];

        done++;
        sequentialEstimate += (task.finishedAt! - task.startedAt!);

        if (result.status === 'rejected') {
          task.status = 'failed';
          task.error = String(result.reason);
          onEvent({ type: 'orch_task_fail', dagId: dag.id, taskId: task.id, error: task.error });

          // ── Phase 3: 失败监控 + 熔断检查 ──
          if (monitor) {
            const failAction = monitor.onTaskFail(task.id, task.error);
            if (failAction.action === 'abort') {
              dag.status = 'failed';
              onEvent({ type: 'orch_fail', dagId: dag.id, error: failAction.reason ?? '熔断中止' });
              return {
                dagId: dag.id,
                success: false,
                summary: `熔断中止: ${failAction.reason}`,
                taskResults: [],
                totalMs: Date.now() - startMs,
                parallelismGain: 0,
              };
            }
          }
        } else {
          // ── Phase 3: 成功监控 ──
          monitor?.onTaskDone(task.id, task.result ?? '');
        }

        onEvent({ type: 'orch_progress', dagId: dag.id, done, total: taskCount });
      }
    }

    // 汇总结果
    const taskResults: OrchestrateResult['taskResults'] = [];
    for (const task of dag.tasks.values()) {
      taskResults.push({
        id: task.id,
        name: task.name,
        success: task.status === 'done',
        result: task.result || task.error || '',
        retries: 0, // retries tracked in execution
        durationMs: (task.finishedAt ?? 0) - (task.startedAt ?? 0),
      });
    }

    const totalMs = Date.now() - startMs;
    const parallelismGain = sequentialEstimate > 0 ? sequentialEstimate / totalMs : 1;
    const hasFailures = taskResults.some(r => !r.success && dag.tasks.get(r.id)?.status !== 'skipped');

    dag.status = hasFailures ? 'failed' : 'done';

    const summary = this.buildSummary(taskResults, totalMs, parallelismGain);
    onEvent({ type: 'orch_done', dagId: dag.id, summary, totalMs });

    return {
      dagId: dag.id,
      success: !hasFailures,
      summary,
      taskResults,
      totalMs,
      parallelismGain: Math.round(parallelismGain * 10) / 10,
    };
  }

  /**
   * 执行单个任务（带重试 + 超时）
   */
  private async executeTaskWithRetry(
    dag: TaskDAG,
    task: Task,
    onEvent: EventCallback,
    monitor?: ExecutionMonitor,
  ): Promise<void> {
    const retryConfig = getRetryConfig(task, dag);
    const timeoutMs = task.timeoutMs ?? dag.defaultTimeoutMs;
    let attempt = 0;
    const maxAttempts = retryConfig ? retryConfig.max + 1 : 1;

    while (attempt < maxAttempts) {
      attempt++;

      if (attempt > 1) {
        // 重试前等待
        const delayMs = calcRetryDelay(attempt - 1, retryConfig!);
        task.status = 'retrying';
        onEvent({
          type: 'orch_task_retry',
          dagId: dag.id,
          taskId: task.id,
          attempt,
          maxRetry: retryConfig!.max,
          delayMs,
        });
        await new Promise(r => setTimeout(r, delayMs));
      }

      try {
        await this.executeSingleTask(dag, task, onEvent, timeoutMs);
        return; // 成功，退出重试循环
      } catch (err) {
        const errorMsg = (err as Error).message;
        task.error = errorMsg;

        // 检查是否是超时（类型判断，非字符串匹配）
        if (err instanceof TimeoutError) {
          onEvent({
            type: 'orch_task_timeout',
            dagId: dag.id,
            taskId: task.id,
            timeoutMs,
          });
          // ── Phase 3: 超时监控 ──
          if (monitor) {
            const timeoutAction = monitor.onTaskTimeout(task.id, timeoutMs);
            if (timeoutAction.action === 'skip') {
              task.status = 'skipped';
              task.finishedAt = Date.now();
              return;
            }
          }
        }

        // 检查是否可重试
        if (retryConfig && attempt < maxAttempts && isRetryable(errorMsg, retryConfig)) {
          if (this.verbose) {
            console.log(`  [Orch] 🔄 ${task.name} 第${attempt}次失败，准备重试: ${errorMsg.slice(0, 60)}`);
          }
          continue; // 继续重试
        }

        // 不可重试或已用尽重试
        task.status = 'failed';
        task.finishedAt = Date.now();

        // 检查是否有 failure fallback 边
        if (hasFailureFallback(dag, task.id)) {
          if (this.verbose) {
            console.log(`  [Orch] ⚠️ ${task.name} 失败，但有 fallback 路径`);
          }
          // 不抛出异常，让条件边处理后续
          return;
        }

        throw err;
      }
    }
  }

  /**
   * 执行单个任务（无重试逻辑）— 通过统一中间件
   */
  private async executeSingleTask(
    dag: TaskDAG,
    task: Task,
    onEvent: EventCallback,
    timeoutMs: number,
  ): Promise<void> {
    task.status = 'running';
    task.startedAt = Date.now();
    onEvent({ type: 'orch_task_start', dagId: dag.id, taskId: task.id });

    // 解析参数中的任务引用
    const resolvedArgs = this.resolveArgs(task.args, dag);

    // Task 6.1: 通过统一中间件执行（权限检查 + 参数校验 + 超时 + 结果截断）
    const result = await this.middleware.execute({
      toolName: task.tool,
      args: resolvedArgs,
      source: 'dag',
      timeoutMs,
    });

    if (!result.success) {
      throw new Error(result.result);
    }

    task.result = result.result;
    task.status = 'done';
    task.finishedAt = Date.now();

    if (this.verbose) {
      console.log(`  [Orch] ✅ ${task.name}: ${task.result.slice(0, 100)} (${result.durationMs}ms)`);
    }

    onEvent({
      type: 'orch_task_done',
      dagId: dag.id,
      taskId: task.id,
      result: task.result,
    });
  }

  /**
   * 解析参数中的任务结果引用
   * ${taskId.result}  → 任务的完整结果
   * ${taskId.output}   → 同 result（别名）
   * ${taskId.error}    → 任务的错误信息
   * ${step.N}          → 第 N 个任务的结果
   */
  private resolveArgs(args: Record<string, unknown>, dag: TaskDAG): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string') {
        resolved[key] = this.resolveString(value, dag);
      } else if (Array.isArray(value)) {
        resolved[key] = value.map(v =>
          typeof v === 'string' ? this.resolveString(v, dag) : v,
        );
      } else if (typeof value === 'object' && value !== null) {
        // 递归解析嵌套对象
        resolved[key] = this.resolveArgs(value as Record<string, unknown>, dag);
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  private resolveString(str: string, dag: TaskDAG): string {
    return str.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
      // 支持 ${taskId.field} 和 ${step.N.field}
      const parts = expr.split('.');
      if (parts.length < 2) {
        // 简写 ${taskId} → 返回 result
        const depTask = dag.tasks.get(expr);
        return depTask?.result || '';
      }

      const [taskId, ...fields] = parts;

      // step.N 引用
      if (taskId === 'step') {
        const idx = parseInt(fields[0], 10);
        const tasks = Array.from(dag.tasks.values());
        const task = tasks[idx];
        if (!task) return '';
        const field = fields[1] || 'result';
        return field === 'result' ? (task.result || '') : field === 'error' ? (task.error || '') : '';
      }

      const depTask = dag.tasks.get(taskId);
      if (!depTask) return '';

      const field = fields[0];
      if (field === 'result' || field === 'output') return depTask.result || '';
      if (field === 'error') return depTask.error || '';

      // 尝试 JSON 字段提取
      if (depTask.result) {
        try {
          const parsed = JSON.parse(depTask.result);
          const val = fields.reduce((obj, f) => obj?.[f], parsed as any);
          return val !== undefined ? String(val) : '';
        } catch {
          return '';
        }
      }

      return '';
    });
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    if (ms <= 0) return promise;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
      promise.then(
        (val) => { clearTimeout(timer); resolve(val); },
        (err) => { clearTimeout(timer); reject(err); },
      );
    });
  }

  private buildSummary(
    results: OrchestrateResult['taskResults'],
    totalMs: number,
    gain: number,
  ): string {
    const success = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const sec = (totalMs / 1000).toFixed(1);

    let summary = `编排完成：${success}/${results.length} 个任务成功`;
    if (failed > 0) summary += `，${failed} 个失败`;
    summary += `（${sec}s`;
    if (gain > 1.2) summary += `，并行加速 ${gain.toFixed(1)}x`;
    summary += '）';

    const keyResults = results.filter(r => r.success && r.result.length > 0).slice(0, 3);
    if (keyResults.length > 0) {
      summary += '\n' + keyResults.map(r => `  • ${r.name}: ${r.result.slice(0, 80)}`).join('\n');
    }

    return summary;
  }
}
