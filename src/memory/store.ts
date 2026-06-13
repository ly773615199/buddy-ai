import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { runMigrations, type Migration } from '../core/migration.js';

const MEMORY_MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: '初始化记忆存储表结构',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          session_id TEXT NOT NULL DEFAULT 'default'
        );
        CREATE TABLE IF NOT EXISTS memories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          importance INTEGER DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_mem_cat_key ON memories(category, key);
        CREATE TABLE IF NOT EXISTS diary (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL UNIQUE,
          content TEXT NOT NULL,
          mood TEXT DEFAULT 'neutral',
          created_at INTEGER NOT NULL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
          key, value, content='memories', content_rowid='id'
        );
        CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
          INSERT INTO memories_fts(rowid, key, value) VALUES (new.id, new.key, new.value);
        END;
        CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, key, value) VALUES('delete', old.id, old.key, old.value);
        END;
        CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, key, value) VALUES('delete', old.id, old.key, old.value);
          INSERT INTO memories_fts(rowid, key, value) VALUES (new.id, new.key, new.value);
        END;
        CREATE TABLE IF NOT EXISTS relationship (
          key TEXT PRIMARY KEY,
          value INTEGER NOT NULL DEFAULT 0
        );
      `);
      // 初始化关系值
      db.prepare('INSERT OR IGNORE INTO relationship(key, value) VALUES (?, ?)').run('total_interactions', 0);
    },
  },
];

/**
 * 记忆存储系统 - SQLite + FTS5 全文搜索
 */
export class MemoryStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    runMigrations(this.db, 'memory', MEMORY_MIGRATIONS);
  }

  // ==================== 消息历史 ====================

  addMessage(role: string, content: string, sessionId = 'default'): void {
    const stmt = this.db.prepare(
      'INSERT INTO messages(role, content, timestamp, session_id) VALUES (?, ?, ?, ?)'
    );
    stmt.run(role, content, Date.now(), sessionId);
  }

  getRecentMessages(count = 20, sessionId = 'default'): Array<{ role: string; content: string; timestamp: number }> {
    const stmt = this.db.prepare(
      'SELECT role, content, timestamp FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?'
    );
    return (stmt.all(sessionId, count) as Array<{ role: string; content: string; timestamp: number }>).reverse();
  }

  // ==================== 长期记忆 ====================

  setMemory(category: string, key: string, value: string, importance = 1): void {
    const stmt = this.db.prepare(`
      INSERT INTO memories(category, key, value, importance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(category, key) DO UPDATE SET
        value = excluded.value,
        importance = excluded.importance,
        updated_at = excluded.updated_at
    `);
    const now = Date.now();
    stmt.run(category, key, value, importance, now, now);
  }

  getMemory(category: string, key: string): string | null {
    const row = this.db.prepare(
      'SELECT value FROM memories WHERE category = ? AND key = ?'
    ).get(category, key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  getMemoriesByCategory(category: string): Array<{ key: string; value: string; importance: number }> {
    return this.db.prepare(
      'SELECT key, value, importance FROM memories WHERE category = ? ORDER BY importance DESC'
    ).all(category) as Array<{ key: string; value: string; importance: number }>;
  }

  /**
   * FTS5 全文搜索记忆
   */
  searchMemories(query: string, limit = 5): Array<{ key: string; value: string; rank: number }> {
    try {
      return this.db.prepare(`
        SELECT m.key, m.value, rank
        FROM memories_fts fts
        JOIN memories m ON m.id = fts.rowid
        WHERE memories_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(query, limit) as Array<{ key: string; value: string; rank: number }>;
    } catch {
      return [];
    }
  }

  // ==================== 日记 ====================

  addDiaryEntry(content: string, mood = 'neutral', date?: string): void {
    const d = date ?? new Date().toISOString().split('T')[0];
    const stmt = this.db.prepare(`
      INSERT INTO diary(date, content, mood, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        content = content || '\n' || excluded.content,
        mood = excluded.mood
    `);
    stmt.run(d, content, mood, Date.now());
  }

  getDiaryEntry(date: string): { content: string; mood: string } | null {
    const row = this.db.prepare(
      'SELECT content, mood FROM diary WHERE date = ?'
    ).get(date) as { content: string; mood: string } | undefined;
    return row ?? null;
  }

  // ==================== 关系数据 ====================

  getRelation(key: string): number {
    const row = this.db.prepare(
      'SELECT value FROM relationship WHERE key = ?'
    ).get(key) as { value: number } | undefined;
    return row?.value ?? 0;
  }

  setRelation(key: string, value: number): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO relationship(key, value) VALUES (?, ?)'
    ).run(key, value);
  }

  addRelation(key: string, delta: number): number {
    const current = this.getRelation(key);
    const newVal = Math.max(0, Math.min(100, current + delta));
    this.setRelation(key, newVal);
    return newVal;
  }

  incrementInteraction(): number {
    const stmt = this.db.prepare(
      'UPDATE relationship SET value = value + 1 WHERE key = ? RETURNING value'
    );
    const row = stmt.get('total_interactions') as { value: number } | undefined;
    return row?.value ?? 0;
  }

  // ==================== 统计 ====================

  getStats(): {
    messages: number;
    memories: number;
    diaryEntries: number;
    interactions: number;
  } {
    const msgCount = (this.db.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number }).c;
    const memCount = (this.db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number }).c;
    const diaryCount = (this.db.prepare('SELECT COUNT(*) as c FROM diary').get() as { c: number }).c;
    return {
      messages: msgCount,
      memories: memCount,
      diaryEntries: diaryCount,
      interactions: this.getRelation('total_interactions'),
    };
  }

  close(): void {
    this.db.close();
  }
}
