/**
 * PlanManager 测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PlanManager } from './plan-manager.js';
import { ProjectStore } from './store.js';
import type { Project, Plan, Requirement } from './types.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

function makeTmpDir(): string {
  const dir = path.join(os.tmpdir(), `plan-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

describe('PlanManager', () => {
  let tmpDir: string;
  let store: ProjectStore;
  let pm: PlanManager;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new ProjectStore(path.join(tmpDir, 'test.db'));
    pm = new PlanManager(store);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ==================== 创建方案 ====================

  describe('createPlan', () => {
    it('should create a plan with manual steps', () => {
      const project = makeProject(store);
      const plan = pm.createPlan(project.id, 'Initial Plan', {
        description: 'Test plan',
        steps: [
          { id: 's1', title: 'Step 1', description: 'First step', deps: [], status: 'pending' },
          { id: 's2', title: 'Step 2', description: 'Second step', deps: ['s1'], status: 'pending' },
        ],
      });

      expect(plan.id).toMatch(/^plan_/);
      expect(plan.version).toBe(1);
      expect(plan.status).toBe('draft');
      expect(plan.steps).toHaveLength(2);
      expect(plan.steps[1].deps).toEqual(['s1']);
    });

    it('should auto-generate steps from requirements', () => {
      const project = makeProject(store, {
        requirements: [
          { id: 'req_1', title: 'Login', description: 'User auth', priority: 'high', status: 'proposed', acceptanceCriteria: [], createdAt: Date.now() },
          { id: 'req_2', title: 'Dashboard', description: '', priority: 'medium', status: 'proposed', acceptanceCriteria: [], createdAt: Date.now() },
        ],
      });

      const plan = pm.createPlan(project.id, 'Auto Plan');
      expect(plan.steps).toHaveLength(2);
      expect(plan.steps[0].title).toContain('Login');
      expect(plan.steps[1].title).toContain('Dashboard');
    });

    it('should set plan as currentPlanId on project', () => {
      const project = makeProject(store);
      const plan = pm.createPlan(project.id, 'My Plan');

      const updated = store.getProject(project.id);
      expect(updated!.currentPlanId).toBe(plan.id);
    });

    it('should create empty plan when no steps or requirements', () => {
      const project = makeProject(store);
      const plan = pm.createPlan(project.id, 'Empty Plan');
      expect(plan.steps).toHaveLength(0);
    });
  });

  // ==================== 版本管理 ====================

  describe('createNewVersion', () => {
    it('should create a new version from existing plan', () => {
      const project = makeProject(store);
      const v1 = pm.createPlan(project.id, 'Plan v1', {
        steps: [
          { id: 's1', title: 'Step 1', description: '', deps: [], status: 'pending' },
        ],
      });

      const v2 = pm.createNewVersion(v1.id, {
        reason: 'Added new step',
        steps: [
          { id: 's1', title: 'Step 1', description: '', deps: [], status: 'pending' },
          { id: 's2', title: 'Step 2 (new)', description: '', deps: ['s1'], status: 'pending' },
        ],
      });

      expect(v2.version).toBe(2);
      expect(v2.parentVersionId).toBe(v1.id);
      expect(v2.steps).toHaveLength(2);
      expect(v2.status).toBe('draft');
    });

    it('should supersede the old version', () => {
      const project = makeProject(store);
      const v1 = pm.createPlan(project.id, 'Plan v1');
      pm.createNewVersion(v1.id, { reason: 'update' });

      const old = store.getPlan(v1.id);
      expect(old!.status).toBe('superseded');
    });

    it('should append change reason as decision', () => {
      const project = makeProject(store);
      const v1 = pm.createPlan(project.id, 'Plan v1');
      const v2 = pm.createNewVersion(v1.id, { reason: 'Refined approach' });

      expect(v2.decisions).toHaveLength(1);
      expect(v2.decisions[0].chosen).toBe('Refined approach');
    });

    it('should update project currentPlanId', () => {
      const project = makeProject(store);
      const v1 = pm.createPlan(project.id, 'Plan v1');
      const v2 = pm.createNewVersion(v1.id, { reason: 'update' });

      const updated = store.getProject(project.id);
      expect(updated!.currentPlanId).toBe(v2.id);
    });

    it('should throw for non-existent plan', () => {
      expect(() => pm.createNewVersion('plan_nonexistent', { reason: 'x' }))
        .toThrow('Plan not found');
    });
  });

  // ==================== 决策记录 ====================

  describe('recordDecision', () => {
    it('should record a decision to a plan', () => {
      const project = makeProject(store);
      const plan = pm.createPlan(project.id, 'Plan');

      const decision = pm.recordDecision(plan.id, {
        question: 'Use React or Vue?',
        options: ['React', 'Vue', 'Svelte'],
        chosen: 'React',
        reasoning: 'Team has most experience with React',
        consequences: ['Need to learn hooks patterns'],
      });

      expect(decision.id).toMatch(/^dec_/);
      expect(decision.question).toBe('Use React or Vue?');
      expect(decision.chosen).toBe('React');

      const updated = store.getPlan(plan.id);
      expect(updated!.decisions).toHaveLength(1);
      expect(updated!.decisions[0].id).toBe(decision.id);
    });

    it('should throw for non-existent plan', () => {
      expect(() => pm.recordDecision('plan_nonexistent', {
        question: 'x', options: [], chosen: 'y', reasoning: 'z',
      })).toThrow('Plan not found');
    });
  });

  // ==================== 版本链 ====================

  describe('getVersionChain', () => {
    it('should return version chain in order', () => {
      const project = makeProject(store);
      const v1 = pm.createPlan(project.id, 'v1');
      const v2 = pm.createNewVersion(v1.id, { reason: 'update 1' });
      const v3 = pm.createNewVersion(v2.id, { reason: 'update 2' });

      const chain = pm.getVersionChain(project.id);
      expect(chain).toHaveLength(3);
      expect(chain[0].version).toBe(1);
      expect(chain[1].version).toBe(2);
      expect(chain[2].version).toBe(3);
    });

    it('should return empty for project with no plans', () => {
      const project = makeProject(store);
      expect(pm.getVersionChain(project.id)).toHaveLength(0);
    });
  });

  // ==================== Diff ====================

  describe('diffVersions', () => {
    it('should detect added steps', () => {
      const project = makeProject(store);
      const v1 = pm.createPlan(project.id, 'v1', {
        steps: [{ id: 's1', title: 'Step 1', description: '', deps: [], status: 'pending' }],
      });
      const v2 = pm.createNewVersion(v1.id, {
        reason: 'added step',
        steps: [
          { id: 's1', title: 'Step 1', description: '', deps: [], status: 'pending' },
          { id: 's2', title: 'Step 2', description: '', deps: [], status: 'pending' },
        ],
      });

      const diff = pm.diffVersions(v1.id, v2.id);
      expect(diff.addedSteps).toHaveLength(1);
      expect(diff.addedSteps[0].title).toBe('Step 2');
      expect(diff.removedSteps).toHaveLength(0);
    });

    it('should detect removed steps', () => {
      const project = makeProject(store);
      const v1 = pm.createPlan(project.id, 'v1', {
        steps: [
          { id: 's1', title: 'Step 1', description: '', deps: [], status: 'pending' },
          { id: 's2', title: 'Step 2', description: '', deps: [], status: 'pending' },
        ],
      });
      const v2 = pm.createNewVersion(v1.id, {
        reason: 'removed step',
        steps: [{ id: 's1', title: 'Step 1', description: '', deps: [], status: 'pending' }],
      });

      const diff = pm.diffVersions(v1.id, v2.id);
      expect(diff.removedSteps).toHaveLength(1);
      expect(diff.removedSteps[0].title).toBe('Step 2');
    });

    it('should detect modified steps', () => {
      const project = makeProject(store);
      const v1 = pm.createPlan(project.id, 'v1', {
        steps: [{ id: 's1', title: 'Old Title', description: '', deps: [], status: 'pending' }],
      });
      const v2 = pm.createNewVersion(v1.id, {
        reason: 'renamed',
        steps: [{ id: 's1', title: 'New Title', description: '', deps: [], status: 'pending' }],
      });

      const diff = pm.diffVersions(v1.id, v2.id);
      expect(diff.modifiedSteps.length).toBeGreaterThan(0);
      expect(diff.modifiedSteps.some(m => m.field === 'title')).toBe(true);
    });

    it('should detect added decisions', () => {
      const project = makeProject(store);
      const v1 = pm.createPlan(project.id, 'v1');
      const v2 = pm.createNewVersion(v1.id, { reason: 'new decision' });
      pm.recordDecision(v2.id, {
        question: 'Database choice?',
        options: ['SQLite', 'Postgres'],
        chosen: 'SQLite',
        reasoning: 'Simpler',
      });

      const diff = pm.diffVersions(v1.id, v2.id);
      // v2 has the auto-generated change reason decision + the new manual decision
      // v1 has none, but v1 is superseded so we compare its original state
      expect(diff.addedDecisions.length).toBeGreaterThan(0);
    });

    it('should generate meaningful summary', () => {
      const project = makeProject(store);
      const v1 = pm.createPlan(project.id, 'v1', {
        steps: [{ id: 's1', title: 'Step 1', description: '', deps: [], status: 'pending' }],
      });
      const v2 = pm.createNewVersion(v1.id, {
        reason: 'added step',
        steps: [
          { id: 's1', title: 'Step 1', description: '', deps: [], status: 'pending' },
          { id: 's2', title: 'Step 2', description: '', deps: [], status: 'pending' },
        ],
      });

      const diff = pm.diffVersions(v1.id, v2.id);
      expect(diff.summary).toContain('+1 步骤');
    });
  });

  // ==================== 步骤状态更新 ====================

  describe('updateStepStatus', () => {
    it('should update step status', () => {
      const project = makeProject(store);
      const plan = pm.createPlan(project.id, 'Plan', {
        steps: [{ id: 's1', title: 'Step 1', description: '', deps: [], status: 'pending' }],
      });

      pm.updateStepStatus(plan.id, 's1', 'done', 'completed successfully');

      const updated = store.getPlan(plan.id);
      expect(updated!.steps[0].status).toBe('done');
      expect(updated!.steps[0].output).toBe('completed successfully');
    });

    it('should throw for non-existent plan', () => {
      expect(() => pm.updateStepStatus('plan_x', 's1', 'done'))
        .toThrow('Plan not found');
    });
  });
});
