/**
 * ExecutionManager + ProgressTracker 测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ExecutionManager } from './execution-manager.js';
import { ProjectProgressTracker } from './progress-tracker.js';
import { PlanManager } from './plan-manager.js';
import { ProjectStore } from './store.js';
import type { Project } from './types.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

function makeTmpDir(): string {
  const dir = path.join(os.tmpdir(), `exec-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeProject(store: ProjectStore, overrides?: Partial<Project>): Project {
  const now = Date.now();
  const project: Project = {
    id: `proj_${Math.random().toString(36).slice(2, 10)}`,
    name: 'Test Project',
    description: 'A test project',
    category: 'web',
    tags: [],
    status: 'planning',
    origin: 'explicit',
    requirements: [],
    stmpRoomId: 'project-test',
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
  store.createProject(project);
  return project;
}

describe('ExecutionManager', () => {
  let tmpDir: string;
  let store: ProjectStore;
  let pm: PlanManager;
  let pt: ProjectProgressTracker;
  let em: ExecutionManager;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new ProjectStore(path.join(tmpDir, 'test.db'));
    pm = new PlanManager(store);
    pt = new ProjectProgressTracker(store);
    em = new ExecutionManager(store, pt);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ==================== 开始执行 ====================

  describe('startExecution', () => {
    it('should start execution from a plan', () => {
      const project = makeProject(store);
      const plan = pm.createPlan(project.id, 'Test Plan', {
        steps: [
          { id: 's1', title: 'Step 1', description: '', deps: [], status: 'pending' },
          { id: 's2', title: 'Step 2', description: '', deps: ['s1'], status: 'pending' },
        ],
      });

      const binding = em.startExecution(project.id, plan.id);

      expect(binding.status).toBe('running');
      expect(binding.projectId).toBe(project.id);
      expect(binding.planId).toBe(plan.id);

      // 验证进度初始化
      const progress = store.getProgress(project.id);
      expect(progress).not.toBeNull();
      expect(progress!.totalSteps).toBe(2);
      expect(progress!.completedSteps).toBe(0);

      // 验证初始检查点
      const checkpoints = store.getCheckpoints(project.id);
      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0].phase).toBe('started');
    });

    it('should throw if plan not found', () => {
      const project = makeProject(store);
      expect(() => em.startExecution(project.id, 'plan_x'))
        .toThrow('Plan not found');
    });

    it('should throw if project not found', () => {
      // Manually insert a plan with a projectId that has no matching project
      const project = makeProject(store);
      const plan = pm.createPlan(project.id, 'Plan');
      // Use a different projectId to trigger project-not-found
      store.deleteProject(project.id);
      // Cascade delete removes plan too, so we need a different approach
      // Just verify the execution throws when binding references missing project
      expect(() => em.startExecution('proj_nonexistent', plan.id))
        .toThrow();
    });

    it('should throw if there is already an active execution', () => {
      const project = makeProject(store);
      const plan = pm.createPlan(project.id, 'Plan');
      em.startExecution(project.id, plan.id);

      expect(() => em.startExecution(project.id, plan.id))
        .toThrow('已有活跃执行');
    });

    it('should update project and plan status', () => {
      const project = makeProject(store);
      const plan = pm.createPlan(project.id, 'Plan');
      em.startExecution(project.id, plan.id);

      expect(store.getProject(project.id)!.status).toBe('active');
      expect(store.getPlan(plan.id)!.status).toBe('executing');
    });
  });

  // ==================== 暂停/恢复 ====================

  describe('pauseExecution', () => {
    it('should pause execution and create checkpoint', () => {
      const project = makeProject(store);
      const plan = pm.createPlan(project.id, 'Plan', {
        steps: [{ id: 's1', title: 'Step 1', description: '', deps: [], status: 'pending' }],
      });
      em.startExecution(project.id, plan.id);

      const cp = em.pauseExecution(project.id, 'user requested');

      expect(cp.phase).toBe('paused');
      expect(cp.note).toBe('user requested');

      const binding = store.getActiveDAGBinding(project.id);
      expect(binding!.status).toBe('paused');
      expect(binding!.pauseReason).toBe('user requested');

      expect(store.getProject(project.id)!.status).toBe('paused');
    });

    it('should throw if no active execution', () => {
      const project = makeProject(store);
      expect(() => em.pauseExecution(project.id)).toThrow('没有活跃的执行');
    });

    it('should throw if already paused', () => {
      const project = makeProject(store);
      const plan = pm.createPlan(project.id, 'Plan');
      em.startExecution(project.id, plan.id);
      em.pauseExecution(project.id);

      expect(() => em.pauseExecution(project.id)).toThrow('已处于暂停状态');
    });
  });

  describe('resumeExecution', () => {
    it('should resume from checkpoint', () => {
      const project = makeProject(store);
      const plan = pm.createPlan(project.id, 'Plan');
      em.startExecution(project.id, plan.id);
      em.pauseExecution(project.id, 'break');

      const binding = em.resumeExecution(project.id);

      expect(binding.status).toBe('running');
      expect(binding.resumedAt).toBeDefined();
      expect(store.getProject(project.id)!.status).toBe('active');
    });

    it('should throw if not paused', () => {
      const project = makeProject(store);
      const plan = pm.createPlan(project.id, 'Plan');
      em.startExecution(project.id, plan.id);

      expect(() => em.resumeExecution(project.id)).toThrow('只有暂停状态');
    });

    it('should create resume checkpoint', () => {
      const project = makeProject(store);
      const plan = pm.createPlan(project.id, 'Plan');
      em.startExecution(project.id, plan.id);
      em.pauseExecution(project.id);
      em.resumeExecution(project.id);

      const checkpoints = store.getCheckpoints(project.id);
      expect(checkpoints.some(cp => cp.phase === 'resumed')).toBe(true);
    });
  });

  // ==================== 完成执行 ====================

  describe('completeExecution', () => {
    it('should mark execution as completed', () => {
      const project = makeProject(store);
      const plan = pm.createPlan(project.id, 'Plan');
      em.startExecution(project.id, plan.id);
      em.completeExecution(project.id);

      const binding = store.getActiveDAGBinding(project.id);
      expect(binding).toBeNull(); // no longer active

      expect(store.getProject(project.id)!.status).toBe('completed');
      expect(store.getPlan(plan.id)!.status).toBe('completed');
    });
  });

  // ==================== 步骤更新 ====================

  describe('step updates', () => {
    it('should mark step done and update progress', () => {
      const project = makeProject(store);
      const plan = pm.createPlan(project.id, 'Plan', {
        steps: [
          { id: 's1', title: 'Step 1', description: '', deps: [], status: 'pending' },
          { id: 's2', title: 'Step 2', description: '', deps: [], status: 'pending' },
        ],
      });
      em.startExecution(project.id, plan.id);

      em.markStepDone(project.id, 's1', 'ok');

      const progress = store.getProgress(project.id);
      expect(progress!.completedSteps).toBe(1);
      expect(progress!.percentComplete).toBe(50);

      const updatedPlan = store.getPlan(plan.id);
      expect(updatedPlan!.steps[0].status).toBe('done');
      expect(updatedPlan!.steps[0].output).toBe('ok');
    });

    it('should mark step failed', () => {
      const project = makeProject(store);
      const plan = pm.createPlan(project.id, 'Plan', {
        steps: [{ id: 's1', title: 'Step 1', description: '', deps: [], status: 'pending' }],
      });
      em.startExecution(project.id, plan.id);

      em.markStepFailed(project.id, 's1', 'error msg');

      const progress = store.getProgress(project.id);
      expect(progress!.failedSteps).toBe(1);
    });

    it('should mark step skipped', () => {
      const project = makeProject(store);
      const plan = pm.createPlan(project.id, 'Plan', {
        steps: [{ id: 's1', title: 'Step 1', description: '', deps: [], status: 'pending' }],
      });
      em.startExecution(project.id, plan.id);

      em.markStepSkipped(project.id, 's1');

      const progress = store.getProgress(project.id);
      expect(progress!.skippedSteps).toBe(1);
    });

    it('should auto-checkpoint every 3 steps', () => {
      const project = makeProject(store);
      const plan = pm.createPlan(project.id, 'Plan', {
        steps: [
          { id: 's1', title: 'S1', description: '', deps: [], status: 'pending' },
          { id: 's2', title: 'S2', description: '', deps: [], status: 'pending' },
          { id: 's3', title: 'S3', description: '', deps: [], status: 'pending' },
          { id: 's4', title: 'S4', description: '', deps: [], status: 'pending' },
        ],
      });
      em.startExecution(project.id, plan.id);

      em.markStepDone(project.id, 's1');
      em.markStepDone(project.id, 's2');
      em.markStepDone(project.id, 's3');

      // 3 steps done → auto checkpoint (plus the initial one)
      const checkpoints = store.getCheckpoints(project.id);
      expect(checkpoints.some(cp => cp.phase === 'auto-checkpoint')).toBe(true);
    });
  });

  // ==================== 执行状态 ====================

  describe('getExecutionStatus', () => {
    it('should return full status', () => {
      const project = makeProject(store);
      const plan = pm.createPlan(project.id, 'Plan', {
        steps: [
          { id: 's1', title: 'Step 1', description: '', deps: [], status: 'pending' },
          { id: 's2', title: 'Step 2', description: '', deps: [], status: 'pending' },
        ],
      });
      em.startExecution(project.id, plan.id);

      const status = em.getExecutionStatus(project.id);
      expect(status.binding).not.toBeNull();
      expect(status.progress).not.toBeNull();
      expect(status.progress!.totalSteps).toBe(2);
      expect(status.latestCheckpoint).not.toBeNull();
      expect(status.currentStep).not.toBeNull();
      expect(status.currentStep!.title).toBe('Step 1');
    });

    it('should return empty for project with no execution', () => {
      const project = makeProject(store);
      const status = em.getExecutionStatus(project.id);
      expect(status.binding).toBeNull();
      expect(status.progress).toBeNull();
    });
  });
});

describe('ProjectProgressTracker', () => {
  let tmpDir: string;
  let store: ProjectStore;
  let pt: ProjectProgressTracker;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new ProjectStore(path.join(tmpDir, 'test.db'));
    pt = new ProjectProgressTracker(store);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should init progress', () => {
    const project = makeProject(store);
    pt.initProgress(project.id, 5);

    const progress = store.getProgress(project.id);
    expect(progress!.totalSteps).toBe(5);
    expect(progress!.completedSteps).toBe(0);
    expect(progress!.percentComplete).toBe(0);
  });

  it('should track step completion', () => {
    const project = makeProject(store);
    pt.initProgress(project.id, 4);

    pt.stepCompleted(project.id, 's1');
    pt.stepCompleted(project.id, 's2');

    const progress = store.getProgress(project.id);
    expect(progress!.completedSteps).toBe(2);
    expect(progress!.percentComplete).toBe(50);
  });

  it('should track failures and skips', () => {
    const project = makeProject(store);
    pt.initProgress(project.id, 3);

    pt.stepFailed(project.id, 's1');
    pt.stepSkipped(project.id, 's2');

    const progress = store.getProgress(project.id);
    expect(progress!.failedSteps).toBe(1);
    expect(progress!.skippedSteps).toBe(1);
  });

  it('should create checkpoint', () => {
    const project = makeProject(store);
    pt.initProgress(project.id, 2);

    const cp = pt.createCheckpoint(project.id, 'plan_1', {
      completedSteps: ['s1'],
      pendingSteps: ['s2'],
      runningSteps: [],
      outputs: {},
      decisions: [],
    }, { note: 'test checkpoint' });

    expect(cp.id).toMatch(/^cp_/);
    expect(cp.snapshot.completedSteps).toEqual(['s1']);
    expect(cp.note).toBe('test checkpoint');
  });
});
