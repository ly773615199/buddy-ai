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

  // ==================== Phase 1.3: 语义检索 ====================

  /**
   * 语义检索 — TF-IDF 向量 + 余弦相似度
   *
   * 轻量方案：零外部依赖，用分词 + TF-IDF 构建稀疏向量，
   * 余弦相似度排序。与 FTS5 互补：FTS5 擅长精确匹配，
   * 语义检索擅长模糊相关。
   */
  searchMemoriesSemantic(query: string, limit = 5): Array<{ key: string; value: string; similarity: number }> {
    // 1. 获取所有记忆
    const allMemories = this.db.prepare(
      'SELECT key, value FROM memories'
    ).all() as Array<{ key: string; value: string }>;

    if (allMemories.length === 0) return [];

    // 2. 构建 IDF（逆文档频率）
    const docCount = allMemories.length;
    const docFreq = new Map<string, number>();
    const docs = allMemories.map(m => {
      const tokens = tokenize(m.value);
      const uniqueTokens = new Set(tokens);
      for (const t of uniqueTokens) {
        docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
      }
      return { key: m.key, value: m.value, tokens };
    });

    // 3. 查询向量
    const queryTokens = tokenize(query);
    const queryVec = buildTfIdfVector(queryTokens, docFreq, docCount);

    // 4. 计算每个记忆的相似度
    const scored = docs.map(doc => {
      const docVec = buildTfIdfVector(doc.tokens, docFreq, docCount);
      const similarity = cosineSimilarity(queryVec, docVec);
      return { key: doc.key, value: doc.value, similarity };
    });

    // 5. 排序返回
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit).filter(r => r.similarity > 0.01);
  }

  /**
   * 混合检索 — FTS5 + 语义检索合并排序
   *
   * 两路结果加权合并：FTS5 精确匹配 + 语义模糊匹配
   */
  searchMemoriesHybrid(query: string, limit = 5): Array<{ key: string; value: string; score: number }> {
    const ftsResults = this.searchMemories(query, limit * 2);
    const semanticResults = this.searchMemoriesSemantic(query, limit * 2);

    // 合并：FTS5 权重 0.6，语义权重 0.4
    const scoreMap = new Map<string, { key: string; value: string; ftsScore: number; semScore: number }>();

    for (const r of ftsResults) {
      scoreMap.set(r.key, { key: r.key, value: r.value, ftsScore: Math.abs(r.rank), semScore: 0 });
    }
    for (const r of semanticResults) {
      const existing = scoreMap.get(r.key);
      if (existing) {
        existing.semScore = r.similarity;
      } else {
        scoreMap.set(r.key, { key: r.key, value: r.value, ftsScore: 0, semScore: r.similarity });
      }
    }

    // 归一化 + 加权
    const maxFts = Math.max(...[...scoreMap.values()].map(r => r.ftsScore), 0.001);
    const maxSem = Math.max(...[...scoreMap.values()].map(r => r.semScore), 0.001);

    const results = [...scoreMap.values()].map(r => ({
      key: r.key,
      value: r.value,
      score: (r.ftsScore / maxFts) * 0.6 + (r.semScore / maxSem) * 0.4,
    }));

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
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

// ==================== 语义检索辅助函数 ====================

/**
 * 分词器 — 中文按字符 bigram，英文按空格 + 小写
 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  // 提取英文单词
  const englishWords = text.toLowerCase().match(/[a-z][a-z0-9_]*/g) ?? [];
  tokens.push(...englishWords);

  // 中文字符 bigram（滑动窗口）
  const chineseChars = text.match(/[\u4e00-\u9fff]/g) ?? [];
  for (let i = 0; i < chineseChars.length - 1; i++) {
    tokens.push(chineseChars[i] + chineseChars[i + 1]);
  }
  // 单字也保留（低频但有意义）
  for (const c of chineseChars) {
    tokens.push(c);
  }

  return tokens.filter(t => t.length > 0);
}

/**
 * 构建 TF-IDF 稀疏向量
 */
function buildTfIdfVector(
  tokens: string[],
  docFreq: Map<string, number>,
  docCount: number,
): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }

  const vec = new Map<string, number>();
  for (const [term, count] of tf) {
    const df = docFreq.get(term) ?? 1;
    const idf = Math.log(docCount / df);
    vec.set(term, (count / tokens.length) * idf);
  }
  return vec;
}

/**
 * 余弦相似度 — 两个稀疏向量
 */
function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, val] of a) {
    normA += val * val;
    const bVal = b.get(term);
    if (bVal !== undefined) dot += val * bVal;
  }
  for (const val of b.values()) {
    normB += val * val;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
