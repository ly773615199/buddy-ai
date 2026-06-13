/**
 * Sprint 5 测试：跨项目 + 搜索 + 集成
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CrossProjectManager } from './cross-project.js';
import { ProjectSearch } from './search.js';
import { IntegrationManager } from './integration.js';
import { ProjectStore } from './store.js';
import { PlanManager } from './plan-manager.js';
import type { Project } from './types.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

function makeTmpDir(): string {
  const dir = path.join(os.tmpdir(), `sprint5-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

describe('CrossProjectManager', () => {
  let tmpDir: string;
  let store: ProjectStore;
  let cpm: CrossProjectManager;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new ProjectStore(path.join(tmpDir, 'test.db'));
    cpm = new CrossProjectManager(store);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('findSimilarProjects', () => {
    it('should find projects with same category', () => {
      const p1 = makeProject(store, { name: 'Web App 1', category: 'web', tags: ['react'] });
      const p2 = makeProject(store, { name: 'Web App 2', category: 'web', tags: ['vue'] });
      makeProject(store, { name: 'Mobile App', category: 'mobile' });

      const similar = cpm.findSimilarProjects(p1.id);
      expect(similar.length).toBeGreaterThan(0);
      expect(similar[0].project.id).toBe(p2.id);
    });

    it('should find projects with overlapping tags', () => {
      const p1 = makeProject(store, { name: 'A', category: 'web', tags: ['react', 'typescript'] });
      const p2 = makeProject(store, { name: 'B', category: 'mobile', tags: ['react', 'node'] });

      const similar = cpm.findSimilarProjects(p1.id, { minSimilarity: 0.05 });
      expect(similar.length).toBeGreaterThan(0);
      expect(similar[0].matchedBy).toBe('tags');
    });

    it('should return empty for project with no matches', () => {
      const p1 = makeProject(store, { category: 'research', tags: ['quantum'] });
      makeProject(store, { category: 'mobile', tags: ['swift'] });

      const similar = cpm.findSimilarProjects(p1.id, { minSimilarity: 0.5 });
      expect(similar).toHaveLength(0);
    });

    it('should include relevant lessons', () => {
      const p1 = makeProject(store, { name: 'A', category: 'web' });
      const p2 = makeProject(store, { name: 'B', category: 'web' });
      store.createLesson({ id: 'les_1', projectId: p2.id, category: 'mistake', title: 'Lesson 1', description: '', context: '', impact: 'low', applicableCategories: [], createdAt: Date.now(), verified: false });

      const similar = cpm.findSimilarProjects(p1.id);
      expect(similar[0].relevantLessons).toHaveLength(1);
    });
  });

  describe('injectLessons', () => {
    it('should inject lessons from similar projects', () => {
      const p1 = makeProject(store, { name: 'A', category: 'web' });
      const p2 = makeProject(store, { name: 'B', category: 'web' });
      store.createLesson({ id: 'les_src', projectId: p2.id, category: 'mistake', title: 'Avoid X', description: 'X is bad', context: '', impact: 'high', applicableCategories: [], createdAt: Date.now(), verified: false });

      const result = cpm.injectLessons(p1.id);
      expect(result.injected.length).toBeGreaterThan(0);
      expect(result.injected[0].projectId).toBe(p1.id);
      expect(result.sourceProjects).toContain(p2.id);
    });

    it('should filter by impact', () => {
      const p1 = makeProject(store, { name: 'A', category: 'web' });
      const p2 = makeProject(store, { name: 'B', category: 'web' });
      store.createLesson({ id: 'les_low', projectId: p2.id, category: 'insight', title: 'Low', description: '', context: '', impact: 'low', applicableCategories: [], createdAt: Date.now(), verified: false });

      const result = cpm.injectLessons(p1.id, { minImpact: 'high' });
      expect(result.injected).toHaveLength(0);
    });
  });

  describe('getCrossProjectContext', () => {
    it('should return formatted context', () => {
      const p1 = makeProject(store, { name: 'A', category: 'web' });
      makeProject(store, { name: 'B', category: 'web' });

      const context = cpm.getCrossProjectContext(p1.id);
      expect(context).toContain('跨项目经验参考');
    });

    it('should return empty for no matches', () => {
      const p1 = makeProject(store, { category: 'research', tags: ['unique'] });
      expect(cpm.getCrossProjectContext(p1.id)).toBe('');
    });
  });
});

describe('ProjectSearch', () => {
  let tmpDir: string;
  let store: ProjectStore;
  let search: ProjectSearch;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new ProjectStore(path.join(tmpDir, 'test.db'));
    search = new ProjectSearch(store);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should search and format results', () => {
    makeProject(store, { name: 'React Dashboard', description: 'Admin panel with charts' });
    makeProject(store, { name: 'Mobile App', description: 'iOS fitness tracker' });

    const result = search.searchFormatted('dashboard');
    expect(result).toContain('React Dashboard');
    expect(result).not.toContain('Mobile App');
  });

  it('should return no results message', () => {
    makeProject(store, { name: 'Test' });
    expect(search.searchFormatted('nonexistent_xyz')).toContain('未找到');
  });

  it('should rebuild index', () => {
    makeProject(store, { name: 'Test Project' });
    search.rebuildIndex();
    const results = search.search('Test');
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('IntegrationManager', () => {
  let tmpDir: string;
  let store: ProjectStore;
  let im: IntegrationManager;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new ProjectStore(path.join(tmpDir, 'test.db'));
    im = new IntegrationManager(store);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should get integration status', () => {
    const project = makeProject(store);
    const status = im.getIntegrationStatus(project.id);
    expect(status.stmpRoomId).toBe(project.stmpRoomId);
    expect(status.lessonCount).toBe(0);
  });

  it('should record project memory', () => {
    const project = makeProject(store);
    // Should not throw
    im.recordProjectMemory(project.id, 'Test memory', ['concept1'], 5);
  });

  it('should handle onProjectCreated', () => {
    const project = makeProject(store);
    // Should not throw
    im.onProjectCreated(project);
  });
});
