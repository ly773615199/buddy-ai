/**
 * ArtifactManager + LessonSystem 测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ArtifactManager } from './artifact-manager.js';
import { LessonSystem } from './lesson-system.js';
import { ProjectStore } from './store.js';
import type { Project } from './types.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

function makeTmpDir(): string {
  const dir = path.join(os.tmpdir(), `sprint4-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

describe('ArtifactManager', () => {
  let tmpDir: string;
  let store: ProjectStore;
  let am: ArtifactManager;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new ProjectStore(path.join(tmpDir, 'test.db'));
    am = new ArtifactManager(store);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('create', () => {
    it('should create an artifact', async () => {
      const project = makeProject(store);
      const art = await am.create({
        projectId: project.id,
        name: 'api-spec',
        type: 'document',
        content: '# API Spec v1',
      });

      expect(art.id).toMatch(/^art_/);
      expect(art.name).toBe('api-spec');
      expect(art.version).toBe(1);
      expect(art.content).toBe('# API Spec v1');
    });

    it('should create with metadata', async () => {
      const project = makeProject(store);
      const art = await am.create({
        projectId: project.id,
        name: 'config',
        type: 'config',
        metadata: { format: 'yaml', env: 'production' },
      });

      expect(art.metadata.format).toBe('yaml');
    });
  });

  describe('update', () => {
    it('should create new version on update', async () => {
      const project = makeProject(store);
      const v1 = await am.create({
        projectId: project.id,
        name: 'spec',
        type: 'document',
        content: 'v1 content',
      });

      const v2 = await am.update(v1.id, { content: 'v2 content' });

      expect(v2.version).toBe(2);
      expect(v2.parentVersionId).toBe(v1.id);
      expect(v2.content).toBe('v2 content');
      expect(v2.name).toBe('spec');
    });

    it('should throw for non-existent artifact', async () => {
      await expect(am.update('art_x', { content: 'x' }))
        .rejects.toThrow('Artifact not found');
    });
  });

  describe('getVersions', () => {
    it('should return all versions', async () => {
      const project = makeProject(store);
      const v1 = await am.create({ projectId: project.id, name: 'doc', type: 'document', content: 'v1' });
      await am.update(v1.id, { content: 'v2' });
      await am.update(v1.id, { content: 'v3' });

      const versions = am.getVersions(project.id, 'doc');
      expect(versions).toHaveLength(3);
      expect(versions[0].version).toBe(1);
      expect(versions[2].version).toBe(3);
    });
  });

  describe('getLatest', () => {
    it('should return latest version', async () => {
      const project = makeProject(store);
      const v1 = await am.create({ projectId: project.id, name: 'file', type: 'code', content: 'old' });
      await am.update(v1.id, { content: 'new' });

      const latest = am.getLatest(project.id, 'file');
      expect(latest!.content).toBe('new');
      expect(latest!.version).toBe(2);
    });

    it('should return null for non-existent', () => {
      expect(am.getLatest('proj_x', 'nothing')).toBeNull();
    });
  });

  describe('listLatest', () => {
    it('should list only latest versions', async () => {
      const project = makeProject(store);
      const a = await am.create({ projectId: project.id, name: 'doc-a', type: 'document', content: 'a1' });
      await am.update(a.id, { content: 'a2' });
      await am.create({ projectId: project.id, name: 'doc-b', type: 'document', content: 'b1' });

      const list = am.listLatest(project.id);
      expect(list).toHaveLength(2);
      expect(list.find(a => a.name === 'doc-a')!.version).toBe(2);
    });

    it('should filter by type', async () => {
      const project = makeProject(store);
      await am.create({ projectId: project.id, name: 'doc', type: 'document', content: '' });
      await am.create({ projectId: project.id, name: 'code', type: 'code', content: '' });

      expect(am.listLatest(project.id, 'document')).toHaveLength(1);
      expect(am.listLatest(project.id, 'code')).toHaveLength(1);
    });
  });

  describe('diff', () => {
    it('should detect content changes', async () => {
      const project = makeProject(store);
      const v1 = await am.create({ projectId: project.id, name: 'x', type: 'document', content: 'old' });
      const v2 = await am.update(v1.id, { content: 'new' });

      const d = am.diff(v1.id, v2.id);
      expect(d.contentChanged).toBe(true);
      expect(d.summary).toContain('内容已变更');
    });

    it('should detect path changes', async () => {
      const project = makeProject(store);
      const v1 = await am.create({ projectId: project.id, name: 'x', type: 'code', path: '/old/path' });
      const v2 = await am.update(v1.id, { path: '/new/path' });

      const d = am.diff(v1.id, v2.id);
      expect(d.pathChanged).toBe(true);
    });
  });

  describe('deleteAll', () => {
    it('should delete all versions', async () => {
      const project = makeProject(store);
      const v1 = await am.create({ projectId: project.id, name: 'tmp', type: 'other', content: '1' });
      await am.update(v1.id, { content: '2' });

      const deleted = am.deleteAll(project.id, 'tmp');
      expect(deleted).toBe(2);
      expect(am.getLatest(project.id, 'tmp')).toBeNull();
    });
  });
});

describe('LessonSystem', () => {
  let tmpDir: string;
  let store: ProjectStore;
  let ls: LessonSystem;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new ProjectStore(path.join(tmpDir, 'test.db'));
    ls = new LessonSystem(store);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('extractFromFailure', () => {
    it('should extract lesson from failed task', () => {
      const project = makeProject(store);
      const lesson = ls.extractFromFailure(project.id, {
        name: 'Deploy',
        error: 'ECONNREFUSED connection timeout',
        tool: 'deploy_tool',
        args: { target: 'production' },
      }, 'Deploying to prod');

      expect(lesson.id).toMatch(/^les_/);
      expect(lesson.category).toBe('mistake');
      expect(lesson.title).toContain('Deploy');
      expect(lesson.correction).toContain('超时');
    });

    it('should assess impact correctly', () => {
      const project = makeProject(store);
      const high = ls.extractFromFailure(project.id, { name: 'x', error: 'security vulnerability found', tool: 't', args: {} }, '');
      const low = ls.extractFromFailure(project.id, { name: 'y', error: 'minor formatting issue', tool: 't', args: {} }, '');

      expect(high.impact).toBe('high');
      expect(low.impact).toBe('low');
    });
  });

  describe('extractFromOptimization', () => {
    it('should extract optimization lesson', () => {
      const project = makeProject(store);
      const lesson = ls.extractFromOptimization(
        project.id,
        'Used caching to speed up queries',
        'Query took 2s',
        'Query took 50ms with cache',
      );

      expect(lesson.category).toBe('optimization');
      expect(lesson.context).toContain('2s');
      expect(lesson.context).toContain('50ms');
    });
  });

  describe('record', () => {
    it('should record a manual lesson', () => {
      const project = makeProject(store);
      const lesson = ls.record({
        projectId: project.id,
        category: 'insight',
        title: 'Always use WAL mode',
        description: 'SQLite WAL mode improves concurrent read performance',
        impact: 'medium',
        applicableCategories: ['data', 'devops'],
      });

      expect(lesson.category).toBe('insight');
      expect(lesson.applicableCategories).toEqual(['data', 'devops']);
    });
  });

  describe('compileToExperience', () => {
    it('should compile and verify lesson', () => {
      const project = makeProject(store);
      const lesson = ls.record({
        projectId: project.id,
        category: 'pattern',
        title: 'Pattern A',
        description: 'Use pattern A for X',
      });

      const result = ls.compileToExperience(lesson.id);
      expect(result.success).toBe(true);
      expect(result.experienceUnitId).toMatch(/^exp_/);

      // Verify lesson is now verified
      const lessons = ls.getLessons(project.id);
      expect(lessons[0].verified).toBe(true);
      expect(lessons[0].experienceUnitId).toBe(result.experienceUnitId);
    });

    it('should return already compiled for verified lesson', () => {
      const project = makeProject(store);
      const lesson = ls.record({
        projectId: project.id,
        category: 'pattern',
        title: 'P1',
        description: '',
      });
      ls.compileToExperience(lesson.id);

      const result = ls.compileToExperience(lesson.id);
      expect(result.reason).toBe('Already compiled');
    });
  });

  describe('getLessons with filters', () => {
    it('should filter by category', () => {
      const project = makeProject(store);
      ls.record({ projectId: project.id, category: 'mistake', title: 'M1', description: '' });
      ls.record({ projectId: project.id, category: 'insight', title: 'I1', description: '' });
      ls.record({ projectId: project.id, category: 'mistake', title: 'M2', description: '' });

      expect(ls.getLessons(project.id, { category: 'mistake' })).toHaveLength(2);
      expect(ls.getLessons(project.id, { category: 'insight' })).toHaveLength(1);
    });

    it('should filter by verified status', () => {
      const project = makeProject(store);
      const l1 = ls.record({ projectId: project.id, category: 'pattern', title: 'P1', description: '' });
      ls.record({ projectId: project.id, category: 'pattern', title: 'P2', description: '' });
      ls.compileToExperience(l1.id);

      expect(ls.getLessons(project.id, { verified: true })).toHaveLength(1);
      expect(ls.getLessons(project.id, { verified: false })).toHaveLength(1);
    });
  });
});
