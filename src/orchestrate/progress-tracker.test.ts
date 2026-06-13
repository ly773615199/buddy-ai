import { describe, it, expect } from 'vitest';
import { TaskProgressTracker } from './progress-tracker.js';
import type { TaskDAG, OrchestrateEvent } from './types.js';

function makeDag(taskCount: number): TaskDAG {
  const tasks = new Map();
  for (let i = 0; i < taskCount; i++) {
    tasks.set(`task-${i}`, {
      id: `task-${i}`,
      name: `Task ${i}`,
      tool: 'test',
      args: {},
      deps: [],
      status: 'pending',
    });
  }
  return {
    id: 'dag-test',
    description: '测试 DAG',
    tasks,
    edges: [],
    parallelGroups: [],
    createdAt: Date.now(),
    status: 'executing',
    defaultTimeoutMs: 30000,
  };
}

describe('TaskProgressTracker', () => {
  it('初始化后进度为 0%', () => {
    const tracker = new TaskProgressTracker();
    const dag = makeDag(5);
    tracker.start(dag);
    const progress = tracker.getProgress();
    expect(progress.percentComplete).toBe(0);
    expect(progress.totalSteps).toBe(5);
    expect(progress.currentStep).toBe(0);
    expect(progress.stalled).toBe(false);
  });

  it('任务完成后进度更新', () => {
    const tracker = new TaskProgressTracker();
    const dag = makeDag(4);
    tracker.start(dag);

    tracker.onEvent({ type: 'orch_task_start', dagId: 'dag-test', taskId: 'task-0' });
    tracker.onEvent({ type: 'orch_task_done', dagId: 'dag-test', taskId: 'task-0', result: 'ok' });

    const progress = tracker.getProgress();
    expect(progress.percentComplete).toBe(25);
    expect(progress.currentStep).toBe(1);
  });

  it('任务失败不影响进度计数', () => {
    const tracker = new TaskProgressTracker();
    const dag = makeDag(3);
    tracker.start(dag);

    tracker.onEvent({ type: 'orch_task_start', dagId: 'dag-test', taskId: 'task-0' });
    tracker.onEvent({ type: 'orch_task_fail', dagId: 'dag-test', taskId: 'task-0', error: 'fail' });

    const progress = tracker.getProgress();
    // failed 不算 done，所以还是 0%
    expect(progress.percentComplete).toBe(0);
    expect(progress.steps[0].status).toBe('failed');
  });

  it('全部完成 → 100%', () => {
    const tracker = new TaskProgressTracker();
    const dag = makeDag(3);
    tracker.start(dag);

    for (let i = 0; i < 3; i++) {
      tracker.onEvent({ type: 'orch_task_start', dagId: 'dag-test', taskId: `task-${i}` });
      tracker.onEvent({ type: 'orch_task_done', dagId: 'dag-test', taskId: `task-${i}`, result: 'ok' });
    }

    const progress = tracker.getProgress();
    expect(progress.percentComplete).toBe(100);
    expect(progress.currentStep).toBe(3);
  });

  it('进度回调触发', () => {
    const tracker = new TaskProgressTracker();
    const events: any[] = [];
    tracker.setOnProgress(e => events.push(e));

    const dag = makeDag(2);
    tracker.start(dag);

    tracker.onEvent({ type: 'orch_task_start', dagId: 'dag-test', taskId: 'task-0' });
    tracker.onEvent({ type: 'orch_task_done', dagId: 'dag-test', taskId: 'task-0', result: 'ok' });

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0].type).toBe('task_progress');
  });
});
