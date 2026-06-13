import type { Task, TaskDAG, TaskStatus, ConditionEdge, EdgeCondition, RetryConfig } from './types.js';

let dagCounter = 0;
let taskCounter = 0;

export function createDAG(
  description: string,
  options?: { defaultTimeoutMs?: number; defaultRetry?: RetryConfig },
): TaskDAG {
  return {
    id: `dag-${++dagCounter}-${Date.now()}`,
    description,
    tasks: new Map(),
    edges: [],
    parallelGroups: [],
    createdAt: Date.now(),
    status: 'planning',
    defaultTimeoutMs: options?.defaultTimeoutMs ?? 30000,
    defaultRetry: options?.defaultRetry,
  };
}

export function createTask(
  name: string,
  tool: string,
  args: Record<string, unknown>,
  deps: string[] = [],
  options?: { retry?: RetryConfig; timeoutMs?: number; outputVar?: string },
): Task {
  return {
    id: `t${++taskCounter}`,
    name,
    tool,
    args,
    deps,
    status: 'pending',
    retry: options?.retry,
    timeoutMs: options?.timeoutMs,
    outputVar: options?.outputVar,
  };
}

export function addTask(dag: TaskDAG, task: Task): void {
  dag.tasks.set(task.id, task);
}

export function addEdge(dag: TaskDAG, edge: ConditionEdge): void {
  dag.edges.push(edge);
}

export function addParallelGroup(dag: TaskDAG, taskIds: string[]): void {
  dag.parallelGroups.push(taskIds);
}

/** 获取所有就绪的任务（依赖已全部完成） */
export function getReadyTasks(dag: TaskDAG): Task[] {
  const ready: Task[] = [];
  for (const task of dag.tasks.values()) {
    if (task.status !== 'pending') continue;
    const allDepsDone = task.deps.every(depId => {
      const dep = dag.tasks.get(depId);
      return dep && (dep.status === 'done' || dep.status === 'skipped');
    });
    if (allDepsDone) {
      task.status = 'ready';
      ready.push(task);
    }
  }
  return ready;
}

/**
 * 获取就绪任务（考虑条件边）
 * 如果 DAG 有 condition edges，则按条件边过滤，否则回退到 deps 逻辑
 */
export function getReadyTasksWithConditions(dag: TaskDAG): Task[] {
  if (dag.edges.length === 0) {
    return getReadyTasks(dag);
  }

  const ready: Task[] = [];
  for (const task of dag.tasks.values()) {
    if (task.status !== 'pending') continue;

    // 找所有指向此 task 的条件边
    const incomingEdges = dag.edges.filter(e => e.to === task.id);
    if (incomingEdges.length === 0) {
      // 没有条件边，回退到 deps 检查
      const allDepsDone = task.deps.every(depId => {
        const dep = dag.tasks.get(depId);
        return dep && (dep.status === 'done' || dep.status === 'skipped');
      });
      if (allDepsDone) {
        task.status = 'ready';
        ready.push(task);
      }
      continue;
    }

    // 检查条件边是否满足
    const canExecute = incomingEdges.some(edge => {
      const source = dag.tasks.get(edge.from);
      if (!source) return false;
      return evaluateEdgeCondition(source, edge.condition, edge.targetValue);
    });

    if (canExecute) {
      task.status = 'ready';
      ready.push(task);
    }
  }
  return ready;
}

/** 评估边条件 */
function evaluateEdgeCondition(source: Task, condition: EdgeCondition, targetValue?: string): boolean {
  switch (condition) {
    case 'success':
      return source.status === 'done';
    case 'failure':
      return source.status === 'failed';
    case 'always':
      return source.status === 'done' || source.status === 'failed' || source.status === 'skipped';
    case 'output_equals':
      if (source.status !== 'done' || !source.result) return false;
      return targetValue !== undefined && source.result === targetValue;
    case 'output_contains':
      if (source.status !== 'done' || !source.result) return false;
      return targetValue !== undefined && source.result.includes(targetValue);
    default:
      return source.status === 'done';
  }
}

/** 检查 DAG 是否全部完成 */
export function isDAGComplete(dag: TaskDAG): boolean {
  for (const task of dag.tasks.values()) {
    if (task.status !== 'done' && task.status !== 'skipped' && task.status !== 'failed') {
      return false;
    }
  }
  return true;
}

/** 检查是否有任务失败导致后续任务不可达 */
export function hasUnrecoverableFailure(dag: TaskDAG): boolean {
  // 如果有条件边，失败可能有 fallback 路径，不算不可恢复
  if (dag.edges.some(e => e.condition === 'failure')) {
    return false;
  }

  for (const task of dag.tasks.values()) {
    if (task.status === 'failed') {
      for (const other of dag.tasks.values()) {
        if (other.deps.includes(task.id) && other.status === 'pending') {
          return true;
        }
      }
    }
  }
  return false;
}

/** 统计 */
export function dagStats(dag: TaskDAG): { total: number; done: number; failed: number; running: number; pending: number; skipped: number; retrying: number } {
  let total = 0, done = 0, failed = 0, running = 0, pending = 0, skipped = 0, retrying = 0;
  for (const t of dag.tasks.values()) {
    total++;
    switch (t.status) {
      case 'done': done++; break;
      case 'failed': failed++; break;
      case 'running': case 'retrying': running++; break;
      case 'pending': pending++; break;
      case 'skipped': skipped++; break;
    }
  }
  return { total, done, failed, running, pending, skipped, retrying };
}

/** 跳过因依赖失败而不可达的任务 */
export function skipUnreachable(dag: TaskDAG): void {
  // 如果有条件边（有 failure fallback），不跳过
  if (dag.edges.some(e => e.condition === 'failure')) {
    return;
  }

  for (const task of dag.tasks.values()) {
    if (task.status !== 'pending') continue;
    const depFailed = task.deps.some(depId => {
      const dep = dag.tasks.get(depId);
      return dep && dep.status === 'failed';
    });
    if (depFailed) {
      task.status = 'skipped';
    }
  }
}

/** 获取任务的重试配置（任务级覆盖，否则用全局默认） */
export function getRetryConfig(task: Task, dag: TaskDAG): RetryConfig | null {
  return task.retry ?? dag.defaultRetry ?? null;
}

/** 计算重试延迟 */
export function calcRetryDelay(attempt: number, config: RetryConfig): number {
  const base = config.delayMs;
  const maxDelay = config.maxDelayMs ?? 30000;
  if (config.backoff === 'fixed') return Math.min(base, maxDelay);
  // exponential (default)
  return Math.min(base * Math.pow(2, attempt - 1), maxDelay);
}

/** 判断错误是否可重试 */
export function isRetryable(error: string, config: RetryConfig): boolean {
  if (!config.retryOn || config.retryOn.length === 0) return true;
  const errorLower = error.toLowerCase();
  return config.retryOn.some(kw => errorLower.includes(kw.toLowerCase()));
}

/** 检查是否有失败但还可以走 failure 边的任务 */
export function hasFailureFallback(dag: TaskDAG, taskId: string): boolean {
  return dag.edges.some(e => e.from === taskId && e.condition === 'failure');
}
