import { describe, it, expect, beforeEach } from 'vitest';
import { createDAG, createTask, addTask, getReadyTasks, isDAGComplete, dagStats, skipUnreachable, hasUnrecoverableFailure } from './orchestrate/dag.js';
import { TaskExecutor } from './orchestrate/executor.js';
import type { TaskDAG, Task, OrchestrateEvent } from './orchestrate/types.js';
import type { ToolRegistry } from './tools/registry.js';
import type { ToolDef } from './types.js';

// ── Mock ToolRegistry ──
function mockRegistry(tools: Record<string, (args: Record<string, unknown>) => Promise<string>>): ToolRegistry {
  const map = new Map<string, ToolDef>();
  for (const [name, fn] of Object.entries(tools)) {
    map.set(name, {
      name,
      description: `mock ${name}`,
      parameters: {} as any,
      execute: fn,
    } as ToolDef);
  }
  return {
    get: (name: string) => map.get(name),
    register: () => {},
    registerMany: () => {},
    list: () => Array.from(map.values()),
    listForPermissions: () => Array.from(map.values()),
  } as unknown as ToolRegistry;
}

// ── DAG 创建 ──
describe('orchestrate/dag — 创建', () => {
  it('createDAG 返回正确结构', () => {
    const dag = createDAG('测试任务');
    expect(dag.description).toBe('测试任务');
    expect(dag.status).toBe('planning');
    expect(dag.tasks).toBeInstanceOf(Map);
    expect(dag.tasks.size).toBe(0);
    expect(dag.id).toMatch(/^dag-/);
  });

  it('createTask 返回 pending 状态', () => {
    const task = createTask('读文件', 'read_file', { path: '/tmp/a' });
    expect(task.status).toBe('pending');
    expect(task.name).toBe('读文件');
    expect(task.tool).toBe('read_file');
    expect(task.deps).toEqual([]);
  });

  it('createTask 支持依赖', () => {
    const t1 = createTask('step1', 'tool1', {});
    const t2 = createTask('step2', 'tool2', {}, [t1.id]);
    expect(t2.deps).toContain(t1.id);
  });

  it('addTask 将任务加入 DAG', () => {
    const dag = createDAG('test');
    const t = createTask('t1', 'tool', {});
    addTask(dag, t);
    expect(dag.tasks.size).toBe(1);
    expect(dag.tasks.get(t.id)).toBe(t);
  });
});

// ── DAG 拓扑 ──
describe('orchestrate/dag — 拓扑操作', () => {
  let dag: TaskDAG;
  let t1: Task, t2: Task, t3: Task, t4: Task;

  beforeEach(() => {
    dag = createDAG('拓扑测试');
    t1 = createTask('fetch', 'http_get', { url: 'http://a' });
    t2 = createTask('parse', 'json_parse', {}, [t1.id]);
    t3 = createTask('log', 'write_file', {}, [t2.id]);
    t4 = createTask('notify', 'send_msg', {}); // 无依赖
    addTask(dag, t1);
    addTask(dag, t2);
    addTask(dag, t3);
    addTask(dag, t4);
  });

  it('getReadyTasks: 无依赖的任务立即就绪', () => {
    const ready = getReadyTasks(dag);
    const names = ready.map(t => t.name).sort();
    expect(names).toEqual(['fetch', 'notify']);
    expect(t1.status).toBe('ready');
    expect(t4.status).toBe('ready');
  });

  it('getReadyTasks: 依赖未完成时不就绪', () => {
    getReadyTasks(dag); // t1 → ready
    t1.status = 'done';
    const ready = getReadyTasks(dag);
    expect(ready.map(t => t.name)).toContain('parse');
    expect(ready.map(t => t.name)).not.toContain('log');
  });

  it('getReadyTasks: 依赖跳过时也视为完成', () => {
    t1.status = 'skipped';
    const ready = getReadyTasks(dag);
    expect(ready.map(t => t.name)).toContain('parse');
  });

  it('isDAGComplete: 全部 done 时返回 true', () => {
    for (const t of dag.tasks.values()) t.status = 'done';
    expect(isDAGComplete(dag)).toBe(true);
  });

  it('isDAGComplete: 有 pending 时返回 false', () => {
    t1.status = 'done';
    t2.status = 'done';
    t3.status = 'done';
    expect(isDAGComplete(dag)).toBe(false); // t4 still pending
  });

  it('isDAGComplete: failed 也算完成', () => {
    for (const t of dag.tasks.values()) t.status = 'failed';
    expect(isDAGComplete(dag)).toBe(true);
  });

  it('dagStats 统计正确', () => {
    t1.status = 'done';
    t2.status = 'running';
    t3.status = 'failed';
    // t4 pending
    const stats = dagStats(dag);
    expect(stats.total).toBe(4);
    expect(stats.done).toBe(1);
    expect(stats.running).toBe(1);
    expect(stats.failed).toBe(1);
  });

  it('skipUnreachable: 直接依赖失败的任务标记为 skipped', () => {
    t1.status = 'failed';
    skipUnreachable(dag);
    expect(t2.status).toBe('skipped'); // 直接依赖 t1
    expect(t3.status).toBe('pending'); // 依赖 t2 (skipped ≠ failed)，不跳过
    expect(t4.status).toBe('pending'); // 无依赖，不受影响
  });

  it('skipUnreachable: 不影响已完成的任务', () => {
    t1.status = 'failed';
    t2.status = 'done';
    skipUnreachable(dag);
    expect(t2.status).toBe('done'); // 已完成不变
  });

  it('hasUnrecoverableFailure: 有依赖链断裂时返回 true', () => {
    t1.status = 'failed';
    expect(hasUnrecoverableFailure(dag)).toBe(true);
  });

  it('hasUnrecoverableFailure: 无失败时返回 false', () => {
    expect(hasUnrecoverableFailure(dag)).toBe(false);
  });

  it('hasUnrecoverableFailure: 失败任务的后续已全部跳过时返回 false', () => {
    t1.status = 'failed';
    t2.status = 'skipped';
    t3.status = 'skipped';
    expect(hasUnrecoverableFailure(dag)).toBe(false);
  });
});

// ── TaskExecutor ──
describe('orchestrate/executor — 串行执行', () => {
  it('执行单个任务并返回结果', async () => {
    const registry = mockRegistry({
      greet: async () => 'hello world',
    });
    const executor = new TaskExecutor(registry);
    const dag = createDAG('单任务');
    const t = createTask('say hi', 'greet', { name: 'test' });
    addTask(dag, t);

    const events: OrchestrateEvent[] = [];
    const result = await executor.execute(dag, e => events.push(e));

    expect(result.success).toBe(true);
    expect(result.taskResults).toHaveLength(1);
    expect(result.taskResults[0].result).toBe('hello world');
    expect(events.some(e => e.type === 'orch_start')).toBe(true);
    expect(events.some(e => e.type === 'orch_done')).toBe(true);
  });

  it('依赖链顺序执行', async () => {
    const order: string[] = [];
    const registry = mockRegistry({
      step1: async () => { order.push('1'); return 'r1'; },
      step2: async () => { order.push('2'); return 'r2'; },
      step3: async () => { order.push('3'); return 'r3'; },
    });
    const executor = new TaskExecutor(registry);
    const dag = createDAG('链式');
    const t1 = createTask('s1', 'step1', {});
    const t2 = createTask('s2', 'step2', {}, [t1.id]);
    const t3 = createTask('s3', 'step3', {}, [t2.id]);
    addTask(dag, t1);
    addTask(dag, t2);
    addTask(dag, t3);

    const result = await executor.execute(dag, () => {});

    expect(result.success).toBe(true);
    expect(order).toEqual(['1', '2', '3']);
  });
});

describe('orchestrate/executor — 并行执行', () => {
  it('无依赖任务并行执行', async () => {
    const startTimes: Record<string, number> = {};
    const registry = mockRegistry({
      fast: async () => { startTimes.fast = Date.now(); return 'done'; },
      slow: async () => { startTimes.slow = Date.now(); await new Promise(r => setTimeout(r, 50)); return 'done'; },
    });
    const executor = new TaskExecutor(registry);
    const dag = createDAG('并行');
    addTask(dag, createTask('fast', 'fast', {}));
    addTask(dag, createTask('slow', 'slow', {}));

    const result = await executor.execute(dag, () => {});

    expect(result.success).toBe(true);
    expect(result.taskResults.every(r => r.success)).toBe(true);
    // 并行执行，启动时间应非常接近
    expect(Math.abs(startTimes.fast - startTimes.slow)).toBeLessThan(20);
  });

  it('maxParallel 限制并发数', async () => {
    let maxConcurrent = 0;
    let current = 0;
    const makeTool = async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise(r => setTimeout(r, 30));
      current--;
      return 'ok';
    };
    const registry = mockRegistry({ t: makeTool });
    const executor = new TaskExecutor(registry);
    const dag = createDAG('限并发');
    for (let i = 0; i < 6; i++) addTask(dag, createTask(`t${i}`, 't', {}));

    await executor.execute(dag, () => {}, 2);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });
});

describe('orchestrate/executor — 错误处理', () => {
  it('工具不存在时任务失败', async () => {
    const registry = mockRegistry({});
    const executor = new TaskExecutor(registry);
    const dag = createDAG('无工具');
    addTask(dag, createTask('missing', 'no_such_tool', {}));

    const events: OrchestrateEvent[] = [];
    const result = await executor.execute(dag, e => events.push(e));

    expect(result.success).toBe(false);
    expect(events.some(e => e.type === 'orch_task_fail')).toBe(true);
  });

  it('工具抛异常时标记失败', async () => {
    const registry = mockRegistry({
      bad: async () => { throw new Error('boom'); },
    });
    const executor = new TaskExecutor(registry);
    const dag = createDAG('异常');
    addTask(dag, createTask('will fail', 'bad', {}));

    const result = await executor.execute(dag, () => {});
    expect(result.success).toBe(false);
    expect(result.taskResults[0].result).toContain('boom');
  });

  it('依赖失败导致后续任务跳过', async () => {
    const registry = mockRegistry({
      fail: async () => { throw new Error('fail!'); },
      next: async () => 'should not run',
    });
    const executor = new TaskExecutor(registry);
    const dag = createDAG('级联');
    const t1 = createTask('will fail', 'fail', {});
    const t2 = createTask('skip me', 'next', {}, [t1.id]);
    addTask(dag, t1);
    addTask(dag, t2);

    const result = await executor.execute(dag, () => {});
    expect(result.success).toBe(false);
    expect(result.taskResults[1].success).toBe(false);
  });
});

describe('orchestrate/executor — 参数引用解析', () => {
  it('解析 ${taskId.result} 引用', async () => {
    let capturedArgs: Record<string, unknown> = {};
    const registry = mockRegistry({
      produce: async () => 'hello',
      consume: async (args) => { capturedArgs = args; return 'ok'; },
    });
    const executor = new TaskExecutor(registry);
    const dag = createDAG('引用');
    const producer = createTask('producer', 'produce', {});
    const consumer = createTask('consumer', 'consume', { content: `\${${producer.id}.result}` }, [producer.id]);
    addTask(dag, producer);
    addTask(dag, consumer);

    await executor.execute(dag, () => {});
    expect(capturedArgs.content).toBe('hello');
  });
});

describe('orchestrate/executor — 事件流', () => {
  it('事件类型完整覆盖', async () => {
    const registry = mockRegistry({
      work: async () => 'done',
    });
    const executor = new TaskExecutor(registry);
    const dag = createDAG('事件');
    addTask(dag, createTask('do work', 'work', {}));

    const events: OrchestrateEvent[] = [];
    await executor.execute(dag, e => events.push(e));

    const types = events.map(e => e.type);
    expect(types).toContain('orch_start');
    expect(types).toContain('orch_task_start');
    expect(types).toContain('orch_task_done');
    expect(types).toContain('orch_progress');
    expect(types).toContain('orch_done');
  });

  it('orch_progress 报告正确的计数', async () => {
    const registry = mockRegistry({
      a: async () => 'a',
      b: async () => 'b',
    });
    const executor = new TaskExecutor(registry);
    const dag = createDAG('进度');
    addTask(dag, createTask('a', 'a', {}));
    addTask(dag, createTask('b', 'b', {}));

    const progresses: Array<{ done: number; total: number }> = [];
    await executor.execute(dag, e => {
      if (e.type === 'orch_progress') progresses.push({ done: e.done, total: e.total });
    });

    expect(progresses.length).toBeGreaterThan(0);
    expect(progresses[progresses.length - 1].done).toBe(2);
    expect(progresses[0].total).toBe(2);
  });
});
