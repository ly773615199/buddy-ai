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
  {
    version: 2,
    description: '记忆 embedding 向量表',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS memory_embeddings (
          memory_id INTEGER PRIMARY KEY,
          vector BLOB NOT NULL,
          dimensions INTEGER NOT NULL,
          model TEXT NOT NULL DEFAULT 'unknown',
          created_at INTEGER NOT NULL,
          FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
        );
      `);
    },
  },
];

/**
 * 记忆存储系统 - SQLite + FTS5 全文搜索
 */
export class MemoryStore {
  private db: Database.Database;
  private embedCaller: ((text: string) => Promise<{ vector: number[]; dimensions: number; model: string }>) | null = null;

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

    // 异步生成 embedding（不阻塞调用方）
    if (this.embedCaller) {
      const row = this.db.prepare('SELECT id FROM memories WHERE category = ? AND key = ?').get(category, key) as { id: number } | undefined;
      if (row) {
        this.embedMemory(row.id, key, value).catch(() => {});
      }
    }
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

  // ==================== Phase Embedding: 向量检索 ====================

  /**
   * 设置 embedding 调用函数（外部注入 LLM embedding 通道）
   */
  setEmbedCaller(caller: (text: string) => Promise<{ vector: number[]; dimensions: number; model: string }>): void {
    this.embedCaller = caller;
  }

  /**
   * 为单条记忆生成 embedding 并存储
   */
  async embedMemory(id: number, key: string, value: string): Promise<void> {
    if (!this.embedCaller) return;
    try {
      const text = `${key} ${value}`.slice(0, 2000); // 截断避免过长
      const result = await this.embedCaller(text);
      const vector = Buffer.from(new Float32Array(result.vector).buffer);
      this.db.prepare(`
        INSERT INTO memory_embeddings (memory_id, vector, dimensions, model, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(memory_id) DO UPDATE SET
          vector = excluded.vector,
          dimensions = excluded.dimensions,
          model = excluded.model,
          created_at = excluded.created_at
      `).run(id, vector, result.dimensions, result.model, Date.now());
    } catch (err) {
      console.warn('[MemoryStore] embedMemory failed:', (err as Error).message);
    }
  }

  /**
   * 批量补全缺失的 embedding
   */
  async embedBatch(batchSize = 50): Promise<number> {
    if (!this.embedCaller) return 0;
    const rows = this.db.prepare(`
      SELECT m.id, m.key, m.value FROM memories m
      LEFT JOIN memory_embeddings e ON e.memory_id = m.id
      WHERE e.memory_id IS NULL
      LIMIT ?
    `).all(batchSize) as Array<{ id: number; key: string; value: string }>;

    let count = 0;
    for (const row of rows) {
      await this.embedMemory(row.id, row.key, row.value);
      count++;
    }
    return count;
  }

  /**
   * Embedding 向量检索 — 余弦相似度
   */
  searchMemoriesEmbedding(query: string, limit = 5): Array<{ key: string; value: string; similarity: number }> {
    if (!this.embedCaller) return [];

    // 同步方式：查询向量需要异步获取，这里用一个 workaround
    // 实际调用在 searchMemoriesHybridAsync 中
    return [];
  }

  /**
   * 异步混合检索 — FTS5 + TF-IDF + Embedding + 时序衰减
   *
   * 三路结果加权合并：FTS5(0.25) + TF-IDF(0.15) + Embedding(0.60)
   * 时序衰减：半衰期 ~14 天
   */
  async searchMemoriesHybridAsync(query: string, limit = 5): Promise<Array<{ key: string; value: string; score: number }>> {
    const ftsResults = this.searchMemories(query, limit * 2);
    const tfidfResults = this.searchMemoriesSemantic(query, limit * 2);

    // Embedding 检索
    let embedResults: Array<{ key: string; value: string; similarity: number }> = [];
    if (this.embedCaller) {
      try {
        const queryResult = await this.embedCaller(query.slice(0, 2000));
        const queryVec = new Float32Array(queryResult.vector);

        // 获取所有有 embedding 的记忆
        const rows = this.db.prepare(`
          SELECT m.key, m.value, m.created_at, e.vector, e.dimensions
          FROM memory_embeddings e
          JOIN memories m ON m.id = e.memory_id
        `).all() as Array<{ key: string; value: string; created_at: number; vector: Buffer; dimensions: number }>;

        const scored = rows.map(row => {
          const docVec = new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4);
          const similarity = cosineSimilarityDense(queryVec, docVec);
          // 时序衰减：半衰期 ~14 天
          const ageHours = (Date.now() - row.created_at) / (1000 * 60 * 60);
          const timeDecay = Math.exp(-0.002 * ageHours);
          return { key: row.key, value: row.value, similarity: similarity * timeDecay };
        });

        scored.sort((a, b) => b.similarity - a.similarity);
        embedResults = scored.slice(0, limit * 2).filter(r => r.similarity > 0.01);
      } catch (err) {
        console.warn('[MemoryStore] embedding search failed:', (err as Error).message);
      }
    }

    // 三路合并
    const scoreMap = new Map<string, { key: string; value: string; ftsScore: number; tfidfScore: number; embedScore: number; createdAt: number }>();

    // 获取所有记忆的 created_at 用于衰减
    const allKeys = new Set<string>();
    for (const r of ftsResults) allKeys.add(r.key);
    for (const r of tfidfResults) allKeys.add(r.key);
    for (const r of embedResults) allKeys.add(r.key);

    const timeMap = new Map<string, number>();
    if (allKeys.size > 0) {
      const placeholders = [...allKeys].map(() => '?').join(',');
      const timeRows = this.db.prepare(
        `SELECT key, created_at FROM memories WHERE key IN (${placeholders})`
      ).all(...allKeys) as Array<{ key: string; created_at: number }>;
      for (const r of timeRows) timeMap.set(r.key, r.created_at);
    }

    for (const r of ftsResults) {
      scoreMap.set(r.key, { key: r.key, value: r.value, ftsScore: Math.abs(r.rank), tfidfScore: 0, embedScore: 0, createdAt: timeMap.get(r.key) ?? Date.now() });
    }
    for (const r of tfidfResults) {
      const existing = scoreMap.get(r.key);
      if (existing) { existing.tfidfScore = r.similarity; } else {
        scoreMap.set(r.key, { key: r.key, value: r.value, ftsScore: 0, tfidfScore: r.similarity, embedScore: 0, createdAt: timeMap.get(r.key) ?? Date.now() });
      }
    }
    for (const r of embedResults) {
      const existing = scoreMap.get(r.key);
      if (existing) { existing.embedScore = r.similarity; } else {
        scoreMap.set(r.key, { key: r.key, value: r.value, ftsScore: 0, tfidfScore: 0, embedScore: r.similarity, createdAt: timeMap.get(r.key) ?? Date.now() });
      }
    }

    // 归一化 + 加权（FTS5:0.25, TF-IDF:0.15, Embedding:0.60）
    const values = [...scoreMap.values()];
    const maxFts = Math.max(...values.map(r => r.ftsScore), 0.001);
    const maxTfidf = Math.max(...values.map(r => r.tfidfScore), 0.001);
    const maxEmbed = Math.max(...values.map(r => r.embedScore), 0.001);

    // 无 embedding 数据时回退到两路：FTS5(0.6) + TF-IDF(0.4)
    const hasEmbedding = embedResults.length > 0;
    const ftsWeight = hasEmbedding ? 0.25 : 0.6;
    const tfidfWeight = hasEmbedding ? 0.15 : 0.4;
    const embedWeight = hasEmbedding ? 0.60 : 0;

    const results = values.map(r => {
      const baseScore = (r.ftsScore / maxFts) * ftsWeight
        + (r.tfidfScore / maxTfidf) * tfidfWeight
        + (r.embedScore / maxEmbed) * embedWeight;
      // 时序衰减
      const ageHours = (Date.now() - r.createdAt) / (1000 * 60 * 60);
      const timeDecay = Math.exp(-0.002 * ageHours);
      return { key: r.key, value: r.value, score: baseScore * timeDecay };
    });

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

/**
 * 稠密向量余弦相似度 — Float32Array
 */
function cosineSimilarityDense(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
