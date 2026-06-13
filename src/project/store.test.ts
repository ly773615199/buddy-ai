/**
 * ProjectStore 测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProjectStore } from './store.js';
import type { Project, Plan, Checkpoint, Artifact, Lesson } from './types.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

function makeTmpDir(): string {
  const dir = path.join(os.tmpdir(), `project-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeProject(overrides?: Partial<Project>): Project {
  const now = Date.now();
  return {
    id: `proj_${Math.random().toString(36).slice(2, 10)}`,
    name: 'Test Project',
    description: 'A test project',
    category: 'web',
    tags: ['test', 'vitest'],
    status: 'planning',
    origin: 'explicit',
    requirements: [],
    stmpRoomId: 'project-test',
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

function makePlan(projectId: string, overrides?: Partial<Plan>): Plan {
  const now = Date.now();
  return {
    id: `plan_${Math.random().toString(36).slice(2, 10)}`,
    projectId,
    title: 'Test Plan',
    description: 'A test plan',
    version: 1,
    status: 'draft',
    steps: [],
    decisions: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('ProjectStore', () => {
  let tmpDir: string;
  let store: ProjectStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new ProjectStore(path.join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ==================== 项目 CRUD ====================

  describe('projects', () => {
    it('should create and retrieve a project', () => {
      const project = makeProject({ name: 'My Project', category: 'web' });
      store.createProject(project);

      const retrieved = store.getProject(project.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('My Project');
      expect(retrieved!.category).toBe('web');
      expect(retrieved!.tags).toEqual(['test', 'vitest']);
      expect(retrieved!.origin).toBe('explicit');
    });

    it('should return null for non-existent project', () => {
      expect(store.getProject('proj_nonexistent')).toBeNull();
    });

    it('should update a project', () => {
      const project = makeProject();
      store.createProject(project);

      store.updateProject(project.id, { name: 'Updated Name', status: 'active' });
      const updated = store.getProject(project.id);
      expect(updated!.name).toBe('Updated Name');
      expect(updated!.status).toBe('active');
    });

    it('should delete a project', () => {
      const project = makeProject();
      store.createProject(project);
      expect(store.getProject(project.id)).not.toBeNull();

      store.deleteProject(project.id);
      expect(store.getProject(project.id)).toBeNull();
    });

    it('should list projects with filters', () => {
      store.createProject(makeProject({ name: 'Web', category: 'web', status: 'active' }));
      store.createProject(makeProject({ name: 'Mobile', category: 'mobile', status: 'planning' }));
      store.createProject(makeProject({ name: 'Data', category: 'data', status: 'active' }));

      expect(store.listProjects()).toHaveLength(3);
      expect(store.listProjects({ status: 'active' })).toHaveLength(2);
      expect(store.listProjects({ category: 'web' })).toHaveLength(1);
      expect(store.listProjects({ origin: 'implicit' })).toHaveLength(0);
    });

    it('should handle implicit origin', () => {
      const project = makeProject({ origin: 'implicit' });
      store.createProject(project);
      const retrieved = store.getProject(project.id);
      expect(retrieved!.origin).toBe('implicit');
    });

    it('should handle requirements', () => {
      const project = makeProject({
        requirements: [
          { id: 'req_1', title: 'Login', description: 'User login', priority: 'high', status: 'proposed', acceptanceCriteria: [], createdAt: Date.now() },
          { id: 'req_2', title: 'Dashboard', description: '', priority: 'medium', status: 'proposed', acceptanceCriteria: [], createdAt: Date.now() },
        ],
      });
      store.createProject(project);

      const retrieved = store.getProject(project.id);
      expect(retrieved!.requirements).toHaveLength(2);
      expect(retrieved!.requirements[0].title).toBe('Login');
    });
  });

  // ==================== 方案 ====================

  describe('plans', () => {
    it('should create and retrieve a plan', () => {
      const project = makeProject();
      store.createProject(project);

      const plan = makePlan(project.id, { title: 'v1 Plan', version: 1 });
      store.createPlan(plan);

      const retrieved = store.getPlan(plan.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.title).toBe('v1 Plan');
      expect(retrieved!.version).toBe(1);
    });

    it('should get plan versions', () => {
      const project = makeProject();
      store.createProject(project);

      store.createPlan(makePlan(project.id, { version: 1 }));
      store.createPlan(makePlan(project.id, { version: 2 }));
      store.createPlan(makePlan(project.id, { version: 3 }));

      const versions = store.getPlanVersions(project.id);
      expect(versions).toHaveLength(3);
      expect(versions[0].version).toBe(1);
      expect(versions[2].version).toBe(3);
    });

    it('should get latest plan version', () => {
      const project = makeProject();
      store.createProject(project);

      store.createPlan(makePlan(project.id, { version: 1, title: 'v1' }));
      store.createPlan(makePlan(project.id, { version: 3, title: 'v3' }));
      store.createPlan(makePlan(project.id, { version: 2, title: 'v2' }));

      const latest = store.getLatestPlanVersion(project.id);
      expect(latest!.version).toBe(3);
    });

    it('should supersede a plan', () => {
      const project = makeProject();
      store.createProject(project);
      const plan = makePlan(project.id);
      store.createPlan(plan);

      store.supersedePlan(plan.id);
      expect(store.getPlan(plan.id)!.status).toBe('superseded');
    });

    it('should store decisions in plan', () => {
      const project = makeProject();
      store.createProject(project);

      const plan = makePlan(project.id, {
        decisions: [
          { id: 'dec_1', question: 'Use React or Vue?', options: ['React', 'Vue'], chosen: 'React', reasoning: 'Team experience', timestamp: Date.now() },
        ],
      });
      store.createPlan(plan);

      const retrieved = store.getPlan(plan.id);
      expect(retrieved!.decisions).toHaveLength(1);
      expect(retrieved!.decisions[0].chosen).toBe('React');
    });
  });

  // ==================== DAG 绑定 ====================

  describe('DAG bindings', () => {
    it('should create and retrieve a DAG binding', () => {
      const project = makeProject();
      store.createProject(project);
      const plan = makePlan(project.id);
      store.createPlan(plan);

      store.createDAGBinding({
        id: 'bind_1',
        projectId: project.id,
        planId: plan.id,
        dagId: 'dag_1',
        status: 'running',
        startedAt: Date.now(),
      });

      const active = store.getActiveDAGBinding(project.id);
      expect(active).not.toBeNull();
      expect(active!.dagId).toBe('dag_1');
    });

    it('should update DAG binding status', () => {
      const project = makeProject();
      store.createProject(project);

      store.createDAGBinding({
        id: 'bind_2',
        projectId: project.id,
        planId: 'plan_1',
        dagId: 'dag_2',
        status: 'running',
        startedAt: Date.now(),
      });

      store.updateDAGBinding('bind_2', { status: 'paused', pauseReason: 'user request' });
      const binding = store.getDAGBinding('bind_2');
      expect(binding!.status).toBe('paused');
      expect(binding!.pauseReason).toBe('user request');
    });
  });

  // ==================== 检查点 ====================

  describe('checkpoints', () => {
    it('should create and retrieve checkpoints', () => {
      const project = makeProject();
      store.createProject(project);

      const cp: Checkpoint = {
        id: 'cp_1',
        projectId: project.id,
        planId: 'plan_1',
        phase: 'executing',
        snapshot: {
          completedSteps: ['step_1', 'step_2'],
          pendingSteps: ['step_3'],
          runningSteps: [],
          outputs: { step_1: 'done', step_2: 'ok' },
          decisions: [],
        },
        progressPercent: 66.7,
        timestamp: Date.now(),
        note: 'mid-point',
      };
      store.createCheckpoint(cp);

      const checkpoints = store.getCheckpoints(project.id);
      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0].snapshot.completedSteps).toEqual(['step_1', 'step_2']);
      expect(checkpoints[0].note).toBe('mid-point');
    });

    it('should get latest checkpoint', () => {
      const project = makeProject();
      store.createProject(project);

      store.createCheckpoint({ id: 'cp_a', projectId: project.id, planId: 'p', phase: 'exec', snapshot: { completedSteps: [], pendingSteps: [], runningSteps: [], outputs: {}, decisions: [] }, progressPercent: 0, timestamp: 1000 });
      store.createCheckpoint({ id: 'cp_b', projectId: project.id, planId: 'p', phase: 'exec', snapshot: { completedSteps: ['s1'], pendingSteps: [], runningSteps: [], outputs: {}, decisions: [] }, progressPercent: 50, timestamp: 2000 });

      const latest = store.getLatestCheckpoint(project.id);
      expect(latest!.id).toBe('cp_b');
    });
  });

  // ==================== 进度 ====================

  describe('progress', () => {
    it('should upsert and retrieve progress', () => {
      const project = makeProject();
      store.createProject(project);

      store.upsertProgress({
        projectId: project.id,
        totalSteps: 10,
        completedSteps: 3,
        failedSteps: 1,
        skippedSteps: 0,
        percentComplete: 30,
        estimatedRemainingMs: 7000,
        lastUpdated: Date.now(),
      });

      const progress = store.getProgress(project.id);
      expect(progress).not.toBeNull();
      expect(progress!.totalSteps).toBe(10);
      expect(progress!.completedSteps).toBe(3);
      expect(progress!.failedSteps).toBe(1);
    });

    it('should update progress on conflict', () => {
      const project = makeProject();
      store.createProject(project);

      store.upsertProgress({ projectId: project.id, totalSteps: 10, completedSteps: 0, failedSteps: 0, skippedSteps: 0, percentComplete: 0, estimatedRemainingMs: 10000, lastUpdated: Date.now() });
      store.upsertProgress({ projectId: project.id, totalSteps: 10, completedSteps: 5, failedSteps: 0, skippedSteps: 0, percentComplete: 50, estimatedRemainingMs: 5000, lastUpdated: Date.now() });

      const progress = store.getProgress(project.id);
      expect(progress!.completedSteps).toBe(5);
    });
  });

  // ==================== 产出物 ====================

  describe('artifacts', () => {
    it('should create and retrieve artifacts', () => {
      const project = makeProject();
      store.createProject(project);

      const art: Artifact = {
        id: 'art_1',
        projectId: project.id,
        name: 'api-spec',
        type: 'document',
        content: '# API Spec\n\nVersion 1',
        version: 1,
        createdBy: 'agent',
        createdAt: Date.now(),
        metadata: {},
      };
      store.createArtifact(art);

      const retrieved = store.getArtifact('art_1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('api-spec');
      expect(retrieved!.version).toBe(1);
    });

    it('should get artifact versions', () => {
      const project = makeProject();
      store.createProject(project);

      store.createArtifact({ id: 'art_v1', projectId: project.id, name: 'spec', type: 'document', version: 1, createdBy: 'agent', createdAt: 1000, metadata: {} });
      store.createArtifact({ id: 'art_v2', projectId: project.id, name: 'spec', type: 'document', version: 2, parentVersionId: 'art_v1', createdBy: 'agent', createdAt: 2000, metadata: {} });

      const versions = store.getArtifactVersions(project.id, 'spec');
      expect(versions).toHaveLength(2);
      expect(versions[0].version).toBe(1);
      expect(versions[1].version).toBe(2);
    });
  });

  // ==================== 教训 ====================

  describe('lessons', () => {
    it('should create and retrieve lessons', () => {
      const project = makeProject();
      store.createProject(project);

      const lesson: Lesson = {
        id: 'les_1',
        projectId: project.id,
        category: 'mistake',
        title: 'Push before pull',
        description: 'git push failed because local was behind',
        context: 'Working on feature branch',
        correction: 'Always pull --rebase before push',
        impact: 'medium',
        applicableCategories: ['web', 'devops'],
        createdAt: Date.now(),
        verified: false,
      };
      store.createLesson(lesson);

      const lessons = store.getLessons(project.id);
      expect(lessons).toHaveLength(1);
      expect(lessons[0].title).toBe('Push before pull');
      expect(lessons[0].correction).toBe('Always pull --rebase before push');
    });

    it('should get lessons by category', () => {
      const project = makeProject();
      store.createProject(project);

      store.createLesson({ id: 'l1', projectId: project.id, category: 'mistake', title: 'M1', description: '', context: '', impact: 'low', applicableCategories: [], createdAt: 1000, verified: false });
      store.createLesson({ id: 'l2', projectId: project.id, category: 'insight', title: 'I1', description: '', context: '', impact: 'low', applicableCategories: [], createdAt: 2000, verified: false });
      store.createLesson({ id: 'l3', projectId: project.id, category: 'mistake', title: 'M2', description: '', context: '', impact: 'low', applicableCategories: [], createdAt: 3000, verified: false });

      expect(store.getLessonsByCategory('mistake')).toHaveLength(2);
      expect(store.getLessonsByCategory('insight')).toHaveLength(1);
    });

    it('should link lesson to experience', () => {
      const project = makeProject();
      store.createProject(project);

      store.createLesson({ id: 'les_link', projectId: project.id, category: 'pattern', title: 'P1', description: '', context: '', impact: 'low', applicableCategories: [], createdAt: Date.now(), verified: false });
      store.linkLessonToExperience('les_link', 'exp_abc123');

      const lessons = store.getLessons(project.id);
      expect(lessons[0].experienceUnitId).toBe('exp_abc123');
    });
  });

  // ==================== FTS5 搜索 ====================

  describe('FTS5 search', () => {
    it('should search across projects', () => {
      store.createProject(makeProject({ name: 'React Dashboard', description: 'Admin dashboard with charts' }));
      store.createProject(makeProject({ name: 'Mobile App', description: 'iOS fitness tracker' }));

      const results = store.search('dashboard');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toContain('Dashboard');
    });

    it('should search across entity types', () => {
      const project = makeProject();
      store.createProject(project);
      store.createLesson({ id: 'les_fts', projectId: project.id, category: 'mistake', title: 'Memory Leak', description: 'Forgot to cleanup event listeners', context: '', impact: 'high', applicableCategories: [], createdAt: Date.now(), verified: false });

      const results = store.search('memory leak', { entityTypes: ['lesson'] });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entityType).toBe('lesson');
    });

    it('should filter by projectId', () => {
      const p1 = makeProject({ name: 'Project Alpha' });
      const p2 = makeProject({ name: 'Project Beta' });
      store.createProject(p1);
      store.createProject(p2);

      const results = store.search('project', { projectId: p1.id });
      expect(results.every(r => r.projectId === p1.id)).toBe(true);
    });
  });

  // ==================== 统计 ====================

  describe('stats', () => {
    it('should get project stats', () => {
      const project = makeProject();
      store.createProject(project);
      store.createPlan(makePlan(project.id));
      store.createPlan(makePlan(project.id));
      store.createLesson({ id: 'ls1', projectId: project.id, category: 'insight', title: 'I', description: '', context: '', impact: 'low', applicableCategories: [], createdAt: Date.now(), verified: true });

      const stats = store.getProjectStats(project.id);
      expect(stats.totalPlans).toBe(2);
      expect(stats.totalLessons).toBe(1);
      expect(stats.verifiedLessons).toBe(1);
    });

    it('should get global stats', () => {
      store.createProject(makeProject({ category: 'web' }));
      store.createProject(makeProject({ category: 'web' }));
      store.createProject(makeProject({ category: 'mobile', status: 'completed' }));

      const stats = store.getGlobalStats();
      expect(stats.totalProjects).toBe(3);
      expect(stats.completedProjects).toBe(1);
      expect(stats.categories.web).toBe(2);
      expect(stats.categories.mobile).toBe(1);
    });
  });
});
