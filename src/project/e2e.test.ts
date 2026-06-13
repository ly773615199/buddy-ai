/**
 * ProjectModel E2E 测试 — 完整生命周期
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProjectStore } from './store.js';
import { PlanManager } from './plan-manager.js';
import { ProjectProgressTracker } from './progress-tracker.js';
import { ExecutionManager } from './execution-manager.js';
import { ArtifactManager } from './artifact-manager.js';
import { LessonSystem } from './lesson-system.js';
import { CrossProjectManager } from './cross-project.js';
import { ProjectSearch } from './search.js';
import { IntegrationManager } from './integration.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

function makeTmpDir(): string {
  const dir = path.join(os.tmpdir(), `e2e-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('ProjectModel E2E', () => {
  let tmpDir: string;
  let store: ProjectStore;
  let pm: PlanManager;
  let pt: ProjectProgressTracker;
  let em: ExecutionManager;
  let am: ArtifactManager;
  let ls: LessonSystem;
  let cpm: CrossProjectManager;
  let search: ProjectSearch;
  let im: IntegrationManager;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new ProjectStore(path.join(tmpDir, 'test.db'));
    pm = new PlanManager(store);
    pt = new ProjectProgressTracker(store);
    em = new ExecutionManager(store, pt);
    am = new ArtifactManager(store);
    ls = new LessonSystem(store);
    cpm = new CrossProjectManager(store);
    search = new ProjectSearch(store);
    im = new IntegrationManager(store);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('complete project lifecycle', () => {
    // === 1. 创建项目 ===
    const project = (() => {
      const now = Date.now();
      const p = {
        id: 'proj_e2e_001',
        name: 'E2E Test Project',
        description: '测试完整项目生命周期',
        category: 'web',
        tags: ['test', 'e2e'],
        status: 'planning' as const,
        origin: 'explicit' as const,
        requirements: [
          { id: 'req_1', title: '用户登录', description: '支持邮箱登录', priority: 'high' as const, status: 'proposed' as const, acceptanceCriteria: [], createdAt: now },
          { id: 'req_2', title: '数据看板', description: '展示统计图表', priority: 'medium' as const, status: 'proposed' as const, acceptanceCriteria: [], createdAt: now },
        ],
        stmpRoomId: 'project-proj_e2e_001',
        createdAt: now,
        updatedAt: now,
        metadata: {},
      };
      store.createProject(p);
      im.onProjectCreated(p);
      return p;
    })();
    expect(project.id).toBeTruthy();

    // === 2. 创建方案 ===
    const plan = pm.createPlan(project.id, '初版方案', {
      steps: [
        { id: 'step_1', title: '搭建项目框架', deps: [], status: 'pending' },
        { id: 'step_2', title: '实现登录模块', deps: ['step_1'], status: 'pending' },
        { id: 'step_3', title: '实现数据看板', deps: ['step_1'], status: 'pending' },
        { id: 'step_4', title: '集成测试', deps: ['step_2', 'step_3'], status: 'pending' },
      ],
    });
    expect(plan.steps).toHaveLength(4);

    // === 3. 记录决策 ===
    const decision = pm.recordDecision(plan.id, {
      question: '前端框架选择？',
      options: ['React', 'Vue', 'Svelte'],
      chosen: 'React',
      reasoning: '团队最熟悉',
    });
    expect(decision.chosen).toBe('React');

    // === 4. 创建方案新版本 ===
    const planV2 = pm.createNewVersion(plan.id, {
      reason: '增加性能优化步骤',
      steps: [
        ...plan.steps,
        { id: 'step_5', title: '性能优化', deps: ['step_4'], status: 'pending' },
      ],
    });
    expect(planV2.version).toBe(2);

    // === 5. 开始执行 ===
    const binding = em.startExecution(project.id, planV2.id);
    expect(binding.status).toBe('running');
    expect(store.getProject(project.id)!.status).toBe('active');

    // === 6. 逐步执行 ===
    em.markStepDone(project.id, 'step_1', '框架搭建完成');
    em.markStepDone(project.id, 'step_2', '登录模块完成');
    em.markStepDone(project.id, 'step_3', '看板完成');

    // 第 3 步完成时自动创建检查点
    const cps = store.getCheckpoints(project.id);
    expect(cps.some(cp => cp.phase === 'auto-checkpoint')).toBe(true);

    // === 7. 暂停执行 ===
    const pauseCp = em.pauseExecution(project.id, '需要 review');
    expect(pauseCp.phase).toBe('paused');
    expect(store.getProject(project.id)!.status).toBe('paused');

    // === 8. 恢复执行 ===
    em.resumeExecution(project.id);
    expect(store.getProject(project.id)!.status).toBe('active');

    // === 9. 继续执行 ===
    em.markStepDone(project.id, 'step_4', '测试通过');
    em.markStepDone(project.id, 'step_5', '优化完成');

    // === 10. 创建产出物 ===
    const doc = am.create({
      projectId: project.id,
      name: 'API 文档',
      type: 'document',
      content: '# API 文档\n\n## 登录接口\nPOST /api/login',
    });
    expect(doc.version).toBe(1);

    const docV2 = am.update(doc.id, { content: '# API 文档 v2\n\n## 登录接口\n## 看板接口' });
    expect(docV2.version).toBe(2);

    // === 11. 记录教训 ===
    const lesson = ls.record({
      projectId: project.id,
      category: 'insight',
      title: 'React + TypeScript 组合最佳',
      description: '类型安全提升开发效率',
      impact: 'medium',
      applicableCategories: ['web'],
    });

    // 编译教训
    const compiled = ls.compileToExperience(lesson.id);
    expect(compiled.success).toBe(true);

    // === 12. 完成执行 ===
    em.completeExecution(project.id);
    expect(store.getProject(project.id)!.status).toBe('completed');

    // === 13. 验证最终状态 ===
    const stats = store.getProjectStats(project.id);
    expect(stats.totalPlans).toBe(2); // v1 + v2
    expect(stats.totalArtifacts).toBe(2); // v1 + v2
    expect(stats.totalLessons).toBe(1);
    expect(stats.verifiedLessons).toBe(1);
    expect(stats.currentProgress!.completedSteps).toBe(5);
    expect(stats.currentProgress!.percentComplete).toBe(100);

    // === 14. 搜索验证 ===
    search.rebuildIndex();
    const results = search.search('E2E');
    expect(results.length).toBeGreaterThan(0);

    // === 15. 跨项目查找 ===
    const p2 = (() => {
      const now = Date.now();
      const p = {
        id: 'proj_e2e_002',
        name: 'Another Web Project',
        description: '另一个 web 项目',
        category: 'web',
        tags: ['test'],
        status: 'planning' as const,
        origin: 'explicit' as const,
        requirements: [],
        stmpRoomId: 'project-proj_e2e_002',
        createdAt: now,
        updatedAt: now,
        metadata: {},
      };
      store.createProject(p);
      return p;
    })();

    const similar = cpm.findSimilarProjects(p2.id, { minSimilarity: 0.05 });
    expect(similar.length).toBeGreaterThan(0);

    // === 16. 注入教训 ===
    const injected = cpm.injectLessons(p2.id);
    expect(injected.injected.length).toBeGreaterThan(0);

    // === 17. 全局统计 ===
    const global = store.getGlobalStats();
    expect(global.totalProjects).toBe(2);
    expect(global.completedProjects).toBe(1);
    expect(global.totalLessons).toBeGreaterThanOrEqual(1);
  });

  it('implicit project lifecycle (Layer 2)', () => {
    // 隐式项目：Agent 自动创建，多步工作
    const now = Date.now();
    const project = {
      id: 'proj_implicit_001',
      name: '自动重构任务',
      description: '重构 auth 模块',
      category: 'web',
      tags: ['refactor'],
      status: 'planning' as const,
      origin: 'implicit' as const,
      requirements: [],
      stmpRoomId: 'project-proj_implicit_001',
      createdAt: now,
      updatedAt: now,
      metadata: {},
    };
    store.createProject(project);

    const plan = pm.createPlan(project.id, '重构方案', {
      steps: [
        { id: 's1', title: '分析现有代码', deps: [], status: 'pending' },
        { id: 's2', title: '提取接口', deps: ['s1'], status: 'pending' },
        { id: 's3', title: '重写实现', deps: ['s2'], status: 'pending' },
      ],
    });

    em.startExecution(project.id, plan.id);
    em.markStepDone(project.id, 's1');
    em.markStepDone(project.id, 's2');
    em.markStepDone(project.id, 's3');
    em.completeExecution(project.id);

    // 隐式项目可升级为显式
    store.updateProject(project.id, { origin: 'explicit' });
    expect(store.getProject(project.id)!.origin).toBe('explicit');
  });

  it('version diff lifecycle', () => {
    const now = Date.now();
    store.createProject({
      id: 'proj_diff',
      name: 'Diff Test',
      description: '',
      category: 'web',
      tags: [],
      status: 'planning',
      origin: 'explicit',
      requirements: [],
      stmpRoomId: 'project-proj_diff',
      createdAt: now,
      updatedAt: now,
      metadata: {},
    });

    const v1 = pm.createPlan('proj_diff', 'Plan v1', {
      steps: [
        { id: 's1', title: 'Step A', deps: [], status: 'pending' },
        { id: 's2', title: 'Step B', deps: [], status: 'pending' },
      ],
    });

    const v2 = pm.createNewVersion(v1.id, {
      reason: '优化步骤',
      steps: [
        { id: 's1', title: 'Step A (优化)', deps: [], status: 'pending' },
        { id: 's3', title: 'Step C (新增)', deps: ['s1'], status: 'pending' },
      ],
    });

    const diff = pm.diffVersions(v1.id, v2.id);
    expect(diff.addedSteps.some(s => s.title === 'Step C (新增)')).toBe(true);
    expect(diff.removedSteps.some(s => s.title === 'Step B')).toBe(true);
    expect(diff.modifiedSteps.some(m => m.field === 'title')).toBe(true);
    expect(diff.summary).toContain('+1 步骤');
    expect(diff.summary).toContain('-1 步骤');
  });
});
