/**
 * ProjectStore — 项目大脑的存储引擎
 *
 * SQLite + Migration，与 STMP / ExperienceGraph / CognitiveEngine 一致。
 * 8 张表 + FTS5 全文索引。
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { runMigrations, type Migration } from '../core/migration.js';
import type {
  Project, Requirement, Plan, PlanStep, Decision,
  DAGBinding, Checkpoint, ProgressCounter,
  Artifact, Lesson, SearchResult,
  ProjectStats, GlobalProjectStats,
} from './types.js';

// ==================== Migrations ====================

const PROJECT_MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: '初始化 ProjectModel 全部表结构',
    up(db) {
      db.exec(`
        -- 项目表
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT DEFAULT '',
          category TEXT DEFAULT 'other',
          tags TEXT DEFAULT '[]',
          status TEXT DEFAULT 'planning',
          origin TEXT DEFAULT 'explicit',
          requirements TEXT DEFAULT '[]',
          current_plan_id TEXT,
          stmp_room_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          completed_at INTEGER,
          metadata TEXT DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
        CREATE INDEX IF NOT EXISTS idx_projects_category ON projects(category);
        CREATE INDEX IF NOT EXISTS idx_projects_origin ON projects(origin);

        -- 方案表（含版本链）
        CREATE TABLE IF NOT EXISTS plans (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT DEFAULT '',
          version INTEGER NOT NULL DEFAULT 1,
          parent_version_id TEXT,
          status TEXT DEFAULT 'draft',
          steps TEXT DEFAULT '[]',
          decisions TEXT DEFAULT '[]',
          estimated_duration_ms INTEGER,
          actual_duration_ms INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_plans_project ON plans(project_id);
        CREATE INDEX IF NOT EXISTS idx_plans_version ON plans(project_id, version);

        -- DAG 绑定表
        CREATE TABLE IF NOT EXISTS dag_bindings (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          plan_id TEXT NOT NULL,
          dag_id TEXT NOT NULL,
          status TEXT DEFAULT 'pending',
          pause_reason TEXT,
          resumed_at INTEGER,
          started_at INTEGER NOT NULL,
          finished_at INTEGER,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_dag_bindings_project ON dag_bindings(project_id);

        -- 检查点表
        CREATE TABLE IF NOT EXISTS checkpoints (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          plan_id TEXT NOT NULL,
          dag_binding_id TEXT,
          phase TEXT NOT NULL,
          snapshot TEXT NOT NULL,
          progress_percent REAL DEFAULT 0,
          timestamp INTEGER NOT NULL,
          note TEXT,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_checkpoints_project ON checkpoints(project_id, timestamp);

        -- 进度计数器表
        CREATE TABLE IF NOT EXISTS progress_counters (
          project_id TEXT PRIMARY KEY,
          total_steps INTEGER DEFAULT 0,
          completed_steps INTEGER DEFAULT 0,
          failed_steps INTEGER DEFAULT 0,
          skipped_steps INTEGER DEFAULT 0,
          percent_complete REAL DEFAULT 0,
          estimated_remaining_ms INTEGER DEFAULT 0,
          last_updated INTEGER NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        -- 产出物表
        CREATE TABLE IF NOT EXISTS artifacts (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          plan_id TEXT,
          name TEXT NOT NULL,
          type TEXT DEFAULT 'other',
          path TEXT,
          content TEXT,
          version INTEGER NOT NULL DEFAULT 1,
          parent_version_id TEXT,
          created_by TEXT DEFAULT 'agent',
          created_at INTEGER NOT NULL,
          metadata TEXT DEFAULT '{}',
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_artifacts_project ON artifacts(project_id);
        CREATE INDEX IF NOT EXISTS idx_artifacts_name ON artifacts(project_id, name);

        -- 教训表
        CREATE TABLE IF NOT EXISTS lessons (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          category TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          context TEXT DEFAULT '',
          correction TEXT,
          impact TEXT DEFAULT 'medium',
          applicable_categories TEXT DEFAULT '[]',
          experience_unit_id TEXT,
          created_at INTEGER NOT NULL,
          verified INTEGER DEFAULT 0,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_lessons_project ON lessons(project_id);
        CREATE INDEX IF NOT EXISTS idx_lessons_category ON lessons(category);
        CREATE INDEX IF NOT EXISTS idx_lessons_impact ON lessons(impact);

        -- FTS5 全文搜索索引
        CREATE VIRTUAL TABLE IF NOT EXISTS project_search_fts USING fts5(
          entity_type,
          entity_id,
          title,
          content,
          tags,
          project_id
        );
      `);
    },
  },
];

// ==================== 行类型 ====================

interface ProjectRow {
  id: string; name: string; description: string; category: string;
  tags: string; status: string; origin: string; requirements: string;
  current_plan_id: string | null; stmp_room_id: string;
  created_at: number; updated_at: number; completed_at: number | null; metadata: string;
}

interface PlanRow {
  id: string; project_id: string; title: string; description: string;
  version: number; parent_version_id: string | null; status: string;
  steps: string; decisions: string;
  estimated_duration_ms: number | null; actual_duration_ms: number | null;
  created_at: number; updated_at: number;
}

interface DAGBindingRow {
  id: string; project_id: string; plan_id: string; dag_id: string;
  status: string; pause_reason: string | null; resumed_at: number | null;
  started_at: number; finished_at: number | null;
}

interface CheckpointRow {
  id: string; project_id: string; plan_id: string; dag_binding_id: string | null;
  phase: string; snapshot: string; progress_percent: number;
  timestamp: number; note: string | null;
}

interface ProgressRow {
  project_id: string; total_steps: number; completed_steps: number;
  failed_steps: number; skipped_steps: number; percent_complete: number;
  estimated_remaining_ms: number; last_updated: number;
}

interface ArtifactRow {
  id: string; project_id: string; plan_id: string | null; name: string;
  type: string; path: string | null; content: string | null;
  version: number; parent_version_id: string | null;
  created_by: string; created_at: number; metadata: string;
}

interface LessonRow {
  id: string; project_id: string; category: string; title: string;
  description: string; context: string; correction: string | null;
  impact: string; applicable_categories: string; experience_unit_id: string | null;
  created_at: number; verified: number;
}

interface CountRow { c: number }

interface FTSRow {
  entity_type: string; entity_id: string; project_id: string;
  title: string; rank: number;
}

// ==================== Store ====================

export class ProjectStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    runMigrations(this.db, 'project', PROJECT_MIGRATIONS);
  }

  // ==================== 项目 CRUD ====================

  createProject(project: Project): void {
    this.db.prepare(`
      INSERT INTO projects (id, name, description, category, tags, status, origin,
        requirements, current_plan_id, stmp_room_id, created_at, updated_at, completed_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      project.id, project.name, project.description, project.category,
      JSON.stringify(project.tags), project.status, project.origin,
      JSON.stringify(project.requirements), project.currentPlanId ?? null,
      project.stmpRoomId, project.createdAt, project.updatedAt,
      project.completedAt ?? null, JSON.stringify(project.metadata),
    );

    // 索引到 FTS
    this.indexForSearch('project', project.id, project.name, project.description, project.tags, project.id);
  }

  getProject(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
    return row ? this.rowToProject(row) : null;
  }

  updateProject(id: string, updates: Partial<Project>): void {
    const existing = this.getProject(id);
    if (!existing) return;

    const merged = { ...existing, ...updates, updatedAt: Date.now() };
    this.db.prepare(`
      UPDATE projects SET
        name = ?, description = ?, category = ?, tags = ?, status = ?,
        origin = ?, requirements = ?, current_plan_id = ?, stmp_room_id = ?,
        updated_at = ?, completed_at = ?, metadata = ?
      WHERE id = ?
    `).run(
      merged.name, merged.description, merged.category,
      JSON.stringify(merged.tags), merged.status, merged.origin,
      JSON.stringify(merged.requirements), merged.currentPlanId ?? null,
      merged.stmpRoomId, merged.updatedAt, merged.completedAt ?? null,
      JSON.stringify(merged.metadata), id,
    );

    // 更新 FTS
    this.indexForSearch('project', id, merged.name, merged.description, merged.tags, id);
  }

  deleteProject(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    this.db.prepare("DELETE FROM project_search_fts WHERE entity_id = ? AND entity_type = 'project'").run(id);
  }

  listProjects(filter?: { status?: string; category?: string; origin?: string }): Project[] {
    let sql = 'SELECT * FROM projects WHERE 1=1';
    const params: unknown[] = [];

    if (filter?.status) {
      sql += ' AND status = ?';
      params.push(filter.status);
    }
    if (filter?.category) {
      sql += ' AND category = ?';
      params.push(filter.category);
    }
    if (filter?.origin) {
      sql += ' AND origin = ?';
      params.push(filter.origin);
    }

    sql += ' ORDER BY updated_at DESC';
    const rows = this.db.prepare(sql).all(...params) as ProjectRow[];
    return rows.map(r => this.rowToProject(r));
  }

  // ==================== 方案 ====================

  createPlan(plan: Plan): void {
    this.db.prepare(`
      INSERT INTO plans (id, project_id, title, description, version, parent_version_id,
        status, steps, decisions, estimated_duration_ms, actual_duration_ms, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      plan.id, plan.projectId, plan.title, plan.description, plan.version,
      plan.parentVersionId ?? null, plan.status,
      JSON.stringify(plan.steps), JSON.stringify(plan.decisions),
      plan.estimatedDurationMs ?? null, plan.actualDurationMs ?? null,
      plan.createdAt, plan.updatedAt,
    );

    this.indexForSearch('plan', plan.id, plan.title, plan.description, [], plan.projectId);
  }

  getPlan(id: string): Plan | null {
    const row = this.db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as PlanRow | undefined;
    return row ? this.rowToPlan(row) : null;
  }

  getPlanVersions(projectId: string): Plan[] {
    const rows = this.db.prepare(
      'SELECT * FROM plans WHERE project_id = ? ORDER BY version ASC',
    ).all(projectId) as PlanRow[];
    return rows.map(r => this.rowToPlan(r));
  }

  getLatestPlanVersion(projectId: string): Plan | null {
    const row = this.db.prepare(
      'SELECT * FROM plans WHERE project_id = ? ORDER BY version DESC LIMIT 1',
    ).get(projectId) as PlanRow | undefined;
    return row ? this.rowToPlan(row) : null;
  }

  updatePlan(id: string, updates: Partial<Plan>): void {
    const existing = this.getPlan(id);
    if (!existing) return;

    const merged = { ...existing, ...updates, updatedAt: Date.now() };
    this.db.prepare(`
      UPDATE plans SET
        title = ?, description = ?, version = ?, parent_version_id = ?,
        status = ?, steps = ?, decisions = ?,
        estimated_duration_ms = ?, actual_duration_ms = ?, updated_at = ?
      WHERE id = ?
    `).run(
      merged.title, merged.description, merged.version, merged.parentVersionId ?? null,
      merged.status, JSON.stringify(merged.steps), JSON.stringify(merged.decisions),
      merged.estimatedDurationMs ?? null, merged.actualDurationMs ?? null,
      merged.updatedAt, id,
    );
  }

  supersedePlan(id: string): void {
    this.db.prepare("UPDATE plans SET status = 'superseded', updated_at = ? WHERE id = ?")
      .run(Date.now(), id);
  }

  // ==================== DAG 绑定 ====================

  createDAGBinding(binding: DAGBinding): void {
    this.db.prepare(`
      INSERT INTO dag_bindings (id, project_id, plan_id, dag_id, status, pause_reason, resumed_at, started_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      binding.id, binding.projectId, binding.planId, binding.dagId,
      binding.status, binding.pauseReason ?? null, binding.resumedAt ?? null,
      binding.startedAt, binding.finishedAt ?? null,
    );
  }

  getDAGBinding(id: string): DAGBinding | null {
    const row = this.db.prepare('SELECT * FROM dag_bindings WHERE id = ?').get(id) as DAGBindingRow | undefined;
    return row ? this.rowToDAGBinding(row) : null;
  }

  getActiveDAGBinding(projectId: string): DAGBinding | null {
    const row = this.db.prepare(
      "SELECT * FROM dag_bindings WHERE project_id = ? AND status IN ('pending', 'running', 'paused') ORDER BY started_at DESC LIMIT 1",
    ).get(projectId) as DAGBindingRow | undefined;
    return row ? this.rowToDAGBinding(row) : null;
  }

  updateDAGBinding(id: string, updates: Partial<DAGBinding>): void {
    const existing = this.getDAGBinding(id);
    if (!existing) return;

    const merged = { ...existing, ...updates };
    this.db.prepare(`
      UPDATE dag_bindings SET
        status = ?, pause_reason = ?, resumed_at = ?, finished_at = ?
      WHERE id = ?
    `).run(
      merged.status, merged.pauseReason ?? null, merged.resumedAt ?? null,
      merged.finishedAt ?? null, id,
    );
  }

  // ==================== 检查点 ====================

  createCheckpoint(cp: Checkpoint): void {
    this.db.prepare(`
      INSERT INTO checkpoints (id, project_id, plan_id, dag_binding_id, phase, snapshot, progress_percent, timestamp, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cp.id, cp.projectId, cp.planId, cp.dagBindingId ?? null,
      cp.phase, JSON.stringify(cp.snapshot), cp.progressPercent,
      cp.timestamp, cp.note ?? null,
    );
  }

  getCheckpoints(projectId: string, limit = 20): Checkpoint[] {
    const rows = this.db.prepare(
      'SELECT * FROM checkpoints WHERE project_id = ? ORDER BY timestamp DESC LIMIT ?',
    ).all(projectId, limit) as CheckpointRow[];
    return rows.map(r => this.rowToCheckpoint(r));
  }

  getLatestCheckpoint(projectId: string): Checkpoint | null {
    const row = this.db.prepare(
      'SELECT * FROM checkpoints WHERE project_id = ? ORDER BY timestamp DESC LIMIT 1',
    ).get(projectId) as CheckpointRow | undefined;
    return row ? this.rowToCheckpoint(row) : null;
  }

  // ==================== 进度计数器 ====================

  upsertProgress(counter: ProgressCounter): void {
    this.db.prepare(`
      INSERT INTO progress_counters (project_id, total_steps, completed_steps, failed_steps, skipped_steps,
        percent_complete, estimated_remaining_ms, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        total_steps = excluded.total_steps,
        completed_steps = excluded.completed_steps,
        failed_steps = excluded.failed_steps,
        skipped_steps = excluded.skipped_steps,
        percent_complete = excluded.percent_complete,
        estimated_remaining_ms = excluded.estimated_remaining_ms,
        last_updated = excluded.last_updated
    `).run(
      counter.projectId, counter.totalSteps, counter.completedSteps,
      counter.failedSteps, counter.skippedSteps, counter.percentComplete,
      counter.estimatedRemainingMs, counter.lastUpdated,
    );
  }

  getProgress(projectId: string): ProgressCounter | null {
    const row = this.db.prepare('SELECT * FROM progress_counters WHERE project_id = ?')
      .get(projectId) as ProgressRow | undefined;
    if (!row) return null;
    return {
      projectId: row.project_id,
      totalSteps: row.total_steps,
      completedSteps: row.completed_steps,
      failedSteps: row.failed_steps,
      skippedSteps: row.skipped_steps,
      percentComplete: row.percent_complete,
      estimatedRemainingMs: row.estimated_remaining_ms,
      lastUpdated: row.last_updated,
    };
  }

  // ==================== 产出物 ====================

  createArtifact(artifact: Artifact): void {
    this.db.prepare(`
      INSERT INTO artifacts (id, project_id, plan_id, name, type, path, content,
        version, parent_version_id, created_by, created_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      artifact.id, artifact.projectId, artifact.planId ?? null,
      artifact.name, artifact.type, artifact.path ?? null, artifact.content ?? null,
      artifact.version, artifact.parentVersionId ?? null,
      artifact.createdBy, artifact.createdAt, JSON.stringify(artifact.metadata),
    );

    this.indexForSearch('artifact', artifact.id, artifact.name, artifact.content ?? '', [], artifact.projectId);
  }

  getArtifact(id: string): Artifact | null {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as ArtifactRow | undefined;
    return row ? this.rowToArtifact(row) : null;
  }

  getArtifactVersions(projectId: string, name: string): Artifact[] {
    const rows = this.db.prepare(
      'SELECT * FROM artifacts WHERE project_id = ? AND name = ? ORDER BY version ASC',
    ).all(projectId, name) as ArtifactRow[];
    return rows.map(r => this.rowToArtifact(r));
  }

  listArtifacts(projectId: string, type?: string): Artifact[] {
    let sql = 'SELECT * FROM artifacts WHERE project_id = ?';
    const params: unknown[] = [projectId];
    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }
    sql += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all(...params) as ArtifactRow[];
    return rows.map(r => this.rowToArtifact(r));
  }

  deleteArtifact(id: string): void {
    this.db.prepare('DELETE FROM artifacts WHERE id = ?').run(id);
    this.db.prepare("DELETE FROM project_search_fts WHERE entity_id = ? AND entity_type = 'artifact'").run(id);
  }

  // ==================== 教训 ====================

  createLesson(lesson: Lesson): void {
    this.db.prepare(`
      INSERT INTO lessons (id, project_id, category, title, description, context,
        correction, impact, applicable_categories, experience_unit_id, created_at, verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      lesson.id, lesson.projectId, lesson.category, lesson.title,
      lesson.description, lesson.context, lesson.correction ?? null,
      lesson.impact, JSON.stringify(lesson.applicableCategories),
      lesson.experienceUnitId ?? null, lesson.createdAt, lesson.verified ? 1 : 0,
    );

    this.indexForSearch('lesson', lesson.id, lesson.title, lesson.description, lesson.applicableCategories, lesson.projectId);
  }

  getLessons(projectId: string): Lesson[] {
    const rows = this.db.prepare(
      'SELECT * FROM lessons WHERE project_id = ? ORDER BY created_at DESC',
    ).all(projectId) as LessonRow[];
    return rows.map(r => this.rowToLesson(r));
  }

  getLessonsByCategory(category: string, limit = 20): Lesson[] {
    const rows = this.db.prepare(
      'SELECT * FROM lessons WHERE category = ? ORDER BY created_at DESC LIMIT ?',
    ).all(category, limit) as LessonRow[];
    return rows.map(r => this.rowToLesson(r));
  }

  getVerifiedLessons(): Lesson[] {
    const rows = this.db.prepare(
      'SELECT * FROM lessons WHERE verified = 1 ORDER BY created_at DESC',
    ).all() as LessonRow[];
    return rows.map(r => this.rowToLesson(r));
  }

  linkLessonToExperience(lessonId: string, experienceUnitId: string): void {
    this.db.prepare('UPDATE lessons SET experience_unit_id = ? WHERE id = ?')
      .run(experienceUnitId, lessonId);
  }

  getLessonById(id: string): Lesson | null {
    const row = this.db.prepare('SELECT * FROM lessons WHERE id = ?').get(id) as LessonRow | undefined;
    return row ? this.rowToLesson(row) : null;
  }

  getAllLessons(): Lesson[] {
    const rows = this.db.prepare('SELECT * FROM lessons ORDER BY created_at DESC').all() as LessonRow[];
    return rows.map(r => this.rowToLesson(r));
  }

  verifyLesson(id: string): void {
    this.db.prepare('UPDATE lessons SET verified = 1 WHERE id = ?').run(id);
  }

  // ==================== FTS5 搜索 ====================

  indexForSearch(entityType: string, entityId: string, title: string, content: string, tags: string[] | string, projectId: string): void {
    // 先删除旧索引
    this.db.prepare(
      'DELETE FROM project_search_fts WHERE entity_id = ? AND entity_type = ?',
    ).run(entityId, entityType);

    const tagStr = Array.isArray(tags) ? tags.join(' ') : tags;
    this.db.prepare(
      'INSERT INTO project_search_fts (entity_type, entity_id, title, content, tags, project_id) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(entityType, entityId, title, content.slice(0, 5000), tagStr, projectId);
  }

  clearFTSIndex(): void {
    this.db.prepare('DELETE FROM project_search_fts').run();
  }

  search(query: string, options?: {
    entityTypes?: string[];
    projectId?: string;
    limit?: number;
  }): SearchResult[] {
    const limit = options?.limit ?? 20;

    try {
      let sql = `
        SELECT entity_type, entity_id, project_id, title,
               snippet(project_search_fts, 3, '<b>', '</b>', '...', 32) as snippet,
               rank
        FROM project_search_fts
        WHERE project_search_fts MATCH ?
      `;
      const params: unknown[] = [query];

      if (options?.entityTypes && options.entityTypes.length > 0) {
        const placeholders = options.entityTypes.map(() => '?').join(',');
        sql += ` AND entity_type IN (${placeholders})`;
        params.push(...options.entityTypes);
      }
      if (options?.projectId) {
        sql += ' AND project_id = ?';
        params.push(options.projectId);
      }

      sql += ' ORDER BY rank LIMIT ?';
      params.push(limit);

      const rows = this.db.prepare(sql).all(...params) as Array<{
        entity_type: string; entity_id: string; project_id: string;
        title: string; snippet: string; rank: number;
      }>;

      return rows.map(r => ({
        entityType: r.entity_type as SearchResult['entityType'],
        entityId: r.entity_id,
        projectId: r.project_id,
        title: r.title,
        snippet: r.snippet,
        rank: r.rank,
      }));
    } catch {
      return [];
    }
  }

  // ==================== 统计 ====================

  getProjectStats(projectId: string): ProjectStats {
    const totalPlans = (this.db.prepare(
      'SELECT COUNT(*) as c FROM plans WHERE project_id = ?',
    ).get(projectId) as CountRow).c;

    const totalDecisions = (() => {
      const plans = this.getPlanVersions(projectId);
      return plans.reduce((sum, p) => sum + p.decisions.length, 0);
    })();

    const totalCheckpoints = (this.db.prepare(
      'SELECT COUNT(*) as c FROM checkpoints WHERE project_id = ?',
    ).get(projectId) as CountRow).c;

    const totalArtifacts = (this.db.prepare(
      'SELECT COUNT(*) as c FROM artifacts WHERE project_id = ?',
    ).get(projectId) as CountRow).c;

    const totalLessons = (this.db.prepare(
      'SELECT COUNT(*) as c FROM lessons WHERE project_id = ?',
    ).get(projectId) as CountRow).c;

    const verifiedLessons = (this.db.prepare(
      'SELECT COUNT(*) as c FROM lessons WHERE project_id = ? AND verified = 1',
    ).get(projectId) as CountRow).c;

    return {
      projectId,
      totalPlans,
      totalDecisions,
      totalCheckpoints,
      totalArtifacts,
      totalLessons,
      verifiedLessons,
      currentProgress: this.getProgress(projectId),
    };
  }

  getGlobalStats(): GlobalProjectStats {
    const totalProjects = (this.db.prepare('SELECT COUNT(*) as c FROM projects').get() as CountRow).c;
    const activeProjects = (this.db.prepare(
      "SELECT COUNT(*) as c FROM projects WHERE status = 'active'",
    ).get() as CountRow).c;
    const completedProjects = (this.db.prepare(
      "SELECT COUNT(*) as c FROM projects WHERE status = 'completed'",
    ).get() as CountRow).c;
    const totalPlans = (this.db.prepare('SELECT COUNT(*) as c FROM plans').get() as CountRow).c;
    const totalLessons = (this.db.prepare('SELECT COUNT(*) as c FROM lessons').get() as CountRow).c;

    const categoryRows = this.db.prepare(
      'SELECT category, COUNT(*) as c FROM projects GROUP BY category',
    ).all() as Array<{ category: string; c: number }>;
    const categories: Record<string, number> = {};
    for (const r of categoryRows) categories[r.category] = r.c;

    return { totalProjects, activeProjects, completedProjects, totalPlans, totalLessons, categories };
  }

  // ==================== 内部转换 ====================

  private rowToProject(row: ProjectRow): Project {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      tags: JSON.parse(row.tags),
      status: row.status as Project['status'],
      origin: row.origin as Project['origin'],
      requirements: JSON.parse(row.requirements),
      currentPlanId: row.current_plan_id ?? undefined,
      stmpRoomId: row.stmp_room_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at ?? undefined,
      metadata: JSON.parse(row.metadata),
    };
  }

  private rowToPlan(row: PlanRow): Plan {
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      version: row.version,
      parentVersionId: row.parent_version_id ?? undefined,
      status: row.status as Plan['status'],
      steps: JSON.parse(row.steps),
      decisions: JSON.parse(row.decisions),
      estimatedDurationMs: row.estimated_duration_ms ?? undefined,
      actualDurationMs: row.actual_duration_ms ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToDAGBinding(row: DAGBindingRow): DAGBinding {
    return {
      id: row.id,
      projectId: row.project_id,
      planId: row.plan_id,
      dagId: row.dag_id,
      status: row.status as DAGBinding['status'],
      pauseReason: row.pause_reason ?? undefined,
      resumedAt: row.resumed_at ?? undefined,
      startedAt: row.started_at,
      finishedAt: row.finished_at ?? undefined,
    };
  }

  private rowToCheckpoint(row: CheckpointRow): Checkpoint {
    return {
      id: row.id,
      projectId: row.project_id,
      planId: row.plan_id,
      dagBindingId: row.dag_binding_id ?? undefined,
      phase: row.phase,
      snapshot: JSON.parse(row.snapshot),
      progressPercent: row.progress_percent,
      timestamp: row.timestamp,
      note: row.note ?? undefined,
    };
  }

  private rowToArtifact(row: ArtifactRow): Artifact {
    return {
      id: row.id,
      projectId: row.project_id,
      planId: row.plan_id ?? undefined,
      name: row.name,
      type: row.type as Artifact['type'],
      path: row.path ?? undefined,
      content: row.content ?? undefined,
      version: row.version,
      parentVersionId: row.parent_version_id ?? undefined,
      createdBy: row.created_by,
      createdAt: row.created_at,
      metadata: JSON.parse(row.metadata),
    };
  }

  private rowToLesson(row: LessonRow): Lesson {
    return {
      id: row.id,
      projectId: row.project_id,
      category: row.category as Lesson['category'],
      title: row.title,
      description: row.description,
      context: row.context,
      correction: row.correction ?? undefined,
      impact: row.impact as Lesson['impact'],
      applicableCategories: JSON.parse(row.applicable_categories),
      experienceUnitId: row.experience_unit_id ?? undefined,
      createdAt: row.created_at,
      verified: row.verified === 1,
    };
  }

  close(): void {
    this.db.close();
  }
}
