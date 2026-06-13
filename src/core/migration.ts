/**
 * 轻量数据库 Schema Migration 工具
 *
 * 用法：
 *   import { runMigrations } from './migration.js';
 *   runMigrations(db, 'pet', PET_MIGRATIONS);
 *
 * 每个 migration 是 { version: number, description: string, up: (db) => void }
 * 版本从 1 开始递增，只执行尚未运行的 migration。
 */

import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

/**
 * 执行数据库迁移
 * @param db better-sqlite3 实例
 * @param moduleName 模块名（用于日志）
 * @param migrations 迁移列表（按 version 升序）
 */
export function runMigrations(
  db: Database.Database,
  moduleName: string,
  migrations: Migration[],
): void {
  // 确保 schema_version 表存在
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      module TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
  `);

  // 获取当前版本
  const row = db.prepare('SELECT version FROM schema_version WHERE module = ?').get(moduleName) as { version: number } | undefined;
  const currentVersion = row?.version ?? 0;

  // 按版本排序
  const sorted = [...migrations].sort((a, b) => a.version - b.version);

  // 执行未运行的 migration
  const pending = sorted.filter(m => m.version > currentVersion);
  if (pending.length === 0) return;

  const runMigration = db.transaction(() => {
    for (const m of pending) {
      console.log(`[migration][${moduleName}] v${m.version}: ${m.description}`);
      m.up(db);
    }
    // 更新版本号
    db.prepare(`
      INSERT INTO schema_version (module, version, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(module) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at
    `).run(moduleName, pending[pending.length - 1].version, Date.now());
  });

  runMigration();
  console.log(`[migration][${moduleName}] 完成：${currentVersion} → ${pending[pending.length - 1].version}`);
}
