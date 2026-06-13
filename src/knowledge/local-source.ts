/**
 * 本地知识源 — 文件夹 FTS5 索引
 *
 * 功能：
 * - 指定 watchFolders，首次启动扫描建 FTS5 索引
 * - 支持增量更新（文件 mtime 对比）
 * - 支持 md / txt / pdf / ts / js 文件类型
 * - 代码文件按函数/类分块
 */

import * as fs from 'fs/promises';
import * as fss from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import type {
  KnowledgeSource, KnowledgeNode, KnowledgeContent,
  SearchOptions, SyncResult,
} from './source-manager.js';

// ==================== 类型 ====================

interface LocalSourceConfig {
  id?: string;
  watchFolders: string[];
  fileTypes?: string[];
  syncIntervalMs?: number;
  dbPath?: string;
  maxChunkSize?: number;
}

interface FileIndex {
  filePath: string;
  mtime: number;
  size: number;
  chunkCount: number;
}

// ==================== LocalSource ====================

export class LocalSource implements KnowledgeSource {
  readonly id: string;
  readonly type = 'local' as const;
  readonly name = '本地知识源';

  private watchFolders: string[];
  private fileTypes: Set<string>;
  private maxChunkSize: number;
  private db: Database.Database;
  private fileIndex: Map<string, FileIndex> = new Map();
  private totalChunks = 0;

  constructor(config: LocalSourceConfig) {
    this.id = config.id ?? 'local';
    this.watchFolders = config.watchFolders;
    this.fileTypes = new Set(config.fileTypes ?? ['md', 'txt', 'ts', 'js', 'json']);
    this.maxChunkSize = config.maxChunkSize ?? 2000;

    // 初始化 SQLite 数据库
    const dbPath = config.dbPath ?? path.join(process.env.HOME ?? '/tmp', '.buddy', 'knowledge-local.db');
    const dir = path.dirname(dbPath);
    if (!fss.existsSync(dir)) fss.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initDB();
  }

  // ==================== KnowledgeSource 接口 ====================

  /**
   * FTS5 全文搜索
   */
  async search(query: string, options?: SearchOptions): Promise<KnowledgeNode[]> {
    const limit = options?.limit ?? 10;
    const minScore = options?.minScore ?? 0;

    let stmt: Database.Statement;
    let rows: any[];

    if (options?.domain) {
      stmt = this.db.prepare(`
        SELECT c.id, c.file_path, c.title, c.content, c.domain, c.concepts, c.chunk_index,
               rank AS score
        FROM local_chunks_fts fts
        JOIN local_chunks c ON c.id = fts.rowid
        WHERE local_chunks_fts MATCH ? AND c.domain = ?
        ORDER BY rank
        LIMIT ?
      `);
      rows = stmt.all(query, options.domain, limit * 2) as any[];
    } else {
      stmt = this.db.prepare(`
        SELECT c.id, c.file_path, c.title, c.content, c.domain, c.concepts, c.chunk_index,
               rank AS score
        FROM local_chunks_fts fts
        JOIN local_chunks c ON c.id = fts.rowid
        WHERE local_chunks_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `);
      rows = stmt.all(query, limit * 2) as any[];
    }

    return rows
      .map(row => this.rowToNode(row))
      .filter(node => node.score >= minScore)
      .slice(0, limit);
  }

  /**
   * 读取完整内容
   */
  async read(nodeId: string): Promise<KnowledgeContent | null> {
    const row = this.db.prepare('SELECT * FROM local_chunks WHERE id = ?').get(nodeId) as any;
    if (!row) return null;

    return {
      id: String(row.id),
      content: row.content,
      metadata: {
        filePath: row.file_path,
        title: row.title,
        domain: row.domain,
        chunkIndex: row.chunk_index,
      },
    };
  }

  /**
   * 列出所有文件
   */
  async list(): Promise<KnowledgeNode[]> {
    const rows = this.db.prepare(`
      SELECT id, file_path, title, content, domain, concepts, chunk_index, 1.0 AS score
      FROM local_chunks ORDER BY file_path, chunk_index
    `).all() as any[];

    return rows.map(row => this.rowToNode(row));
  }

  /**
   * 同步：扫描文件夹，增量更新索引
   */
  async sync(): Promise<SyncResult> {
    const startTime = Date.now();
    let added = 0;
    let updated = 0;
    let deleted = 0;

    // 扫描所有文件
    const currentFiles = new Map<string, number>();
    for (const folder of this.watchFolders) {
      try {
        await this.scanFolder(folder, currentFiles);
      } catch {
        // 文件夹不存在或无权限，跳过
      }
    }

    // 检查删除的文件
    for (const [filePath] of this.fileIndex) {
      if (!currentFiles.has(filePath)) {
        this.removeFile(filePath);
        this.fileIndex.delete(filePath);
        deleted++;
      }
    }

    // 检查新增和更新的文件
    for (const [filePath, mtime] of currentFiles) {
      const existing = this.fileIndex.get(filePath);
      if (!existing) {
        // 新文件
        const chunks = await this.indexFile(filePath);
        if (chunks > 0) {
          this.fileIndex.set(filePath, { filePath, mtime, size: 0, chunkCount: chunks });
          added += chunks;
        }
      } else if (existing.mtime < mtime) {
        // 更新的文件
        this.removeFile(filePath);
        const chunks = await this.indexFile(filePath);
        this.fileIndex.set(filePath, { filePath, mtime, size: 0, chunkCount: chunks });
        updated += chunks;
      }
    }

    // 重建 FTS 索引
    this.db.exec('INSERT INTO local_chunks_fts(local_chunks_fts) VALUES("rebuild")');

    return {
      sourceId: this.id,
      synced: added + updated + deleted,
      added,
      updated,
      deleted,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * 是否可用
   */
  isAvailable(): boolean {
    return this.watchFolders.length > 0;
  }

  /**
   * 获取统计
   */
  getStats(): { totalFiles: number; totalChunks: number; watchFolders: string[] } {
    return {
      totalFiles: this.fileIndex.size,
      totalChunks: this.totalChunks,
      watchFolders: [...this.watchFolders],
    };
  }

  // ==================== 内部方法 ====================

  private initDB(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS local_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        domain TEXT NOT NULL DEFAULT '通用',
        concepts TEXT NOT NULL DEFAULT '[]',
        mtime INTEGER NOT NULL DEFAULT 0,
        UNIQUE(file_path, chunk_index)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS local_chunks_fts USING fts5(
        title, content, domain, concepts,
        content='local_chunks',
        content_rowid='id'
      );

      CREATE TRIGGER IF NOT EXISTS local_chunks_ai AFTER INSERT ON local_chunks BEGIN
        INSERT INTO local_chunks_fts(rowid, title, content, domain, concepts)
        VALUES (new.id, new.title, new.content, new.domain, new.concepts);
      END;

      CREATE TRIGGER IF NOT EXISTS local_chunks_ad AFTER DELETE ON local_chunks BEGIN
        INSERT INTO local_chunks_fts(local_chunks_fts, rowid, title, content, domain, concepts)
        VALUES ('delete', old.id, old.title, old.content, old.domain, old.concepts);
      END;

      CREATE TRIGGER IF NOT EXISTS local_chunks_au AFTER UPDATE ON local_chunks BEGIN
        INSERT INTO local_chunks_fts(local_chunks_fts, rowid, title, content, domain, concepts)
        VALUES ('delete', old.id, old.title, old.content, old.domain, old.concepts);
        INSERT INTO local_chunks_fts(rowid, title, content, domain, concepts)
        VALUES (new.id, new.title, new.content, new.domain, new.concepts);
      END;

      CREATE INDEX IF NOT EXISTS idx_local_chunks_path ON local_chunks(file_path);
      CREATE INDEX IF NOT EXISTS idx_local_chunks_domain ON local_chunks(domain);
    `);

    // 加载已有文件索引
    const rows = this.db.prepare('SELECT file_path, MAX(mtime) as mtime, COUNT(*) as cnt FROM local_chunks GROUP BY file_path').all() as any[];
    for (const row of rows) {
      this.fileIndex.set(row.file_path, {
        filePath: row.file_path,
        mtime: row.mtime,
        size: 0,
        chunkCount: row.cnt,
      });
      this.totalChunks += row.cnt;
    }
  }

  /**
   * 递归扫描文件夹
   */
  private async scanFolder(folder: string, result: Map<string, number>): Promise<void> {
    try {
      const stat = await fs.stat(folder);
      if (!stat.isDirectory()) {
        // 单个文件
        if (this.isSupported(folder)) {
          result.set(path.resolve(folder), stat.mtimeMs);
        }
        return;
      }

      const entries = await fs.readdir(folder, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(folder, entry.name);
        if (entry.isDirectory()) {
          // 跳过 node_modules, .git, dist 等
          if (['node_modules', '.git', 'dist', 'build', '.next', '__pycache__'].includes(entry.name)) continue;
          await this.scanFolder(fullPath, result);
        } else if (entry.isFile() && this.isSupported(entry.name)) {
          try {
            const stat = await fs.stat(fullPath);
            result.set(path.resolve(fullPath), stat.mtimeMs);
          } catch {
            // 无权限，跳过
          }
        }
      }
    } catch {
      // 无权限，跳过
    }
  }

  /**
   * 检查文件类型是否支持
   */
  private isSupported(filePath: string): boolean {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    return this.fileTypes.has(ext);
  }

  /**
   * 索引单个文件，返回分块数
   */
  private async indexFile(filePath: string): Promise<number> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      if (!content.trim()) return 0;

      const ext = path.extname(filePath).slice(1);
      const fileName = path.basename(filePath);
      const domain = this.inferDomain(filePath, content);
      const chunks = this.chunkContent(content, ext);

      const insert = this.db.prepare(`
        INSERT INTO local_chunks (file_path, chunk_index, title, content, domain, concepts, mtime)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const stat = await fs.stat(filePath);
      let count = 0;

      const tx = this.db.transaction(() => {
        for (const chunk of chunks) {
          const title = chunk.title || fileName;
          const concepts = this.extractConcepts(chunk.content).join(',');
          insert.run(filePath, chunk.index, title, chunk.content, domain, concepts, stat.mtimeMs);
          count++;
        }
      });
      tx();

      this.totalChunks += count;
      return count;
    } catch {
      return 0;
    }
  }

  /**
   * 删除文件的所有分块
   */
  private removeFile(filePath: string): void {
    const existing = this.fileIndex.get(filePath);
    if (existing) {
      this.totalChunks -= existing.chunkCount;
    }
    this.db.prepare('DELETE FROM local_chunks WHERE file_path = ?').run(filePath);
  }

  /**
   * 分块策略
   * - md/txt: 按标题（#）分块
   * - ts/js: 按函数/类分块
   * - 其他: 等分
   */
  private chunkContent(content: string, ext: string): Array<{ index: number; title: string; content: string }> {
    const chunks: Array<{ index: number; title: string; content: string }> = [];

    if (ext === 'md' || ext === 'txt') {
      // 按标题分块
      const sections = content.split(/\n(?=#)/);
      let idx = 0;
      for (const section of sections) {
        if (!section.trim()) continue;
        const titleMatch = section.match(/^#+\s*(.+)/);
        const title = titleMatch ? titleMatch[1].trim() : '';
        chunks.push({
          index: idx++,
          title,
          content: section.trim().slice(0, this.maxChunkSize),
        });
      }
    } else if (ext === 'ts' || ext === 'js') {
      // 按函数/类/注释块分块
      const blocks = content.split(/\n\n+/);
      let idx = 0;
      let buffer = '';
      let currentTitle = '';

      for (const block of blocks) {
        // 检测函数/类名
        const fnMatch = block.match(/(?:export\s+)?(?:class|function|const|let|var)\s+(\w+)/);
        if (fnMatch) {
          if (buffer.trim()) {
            chunks.push({ index: idx++, title: currentTitle, content: buffer.trim().slice(0, this.maxChunkSize) });
          }
          buffer = block;
          currentTitle = fnMatch[1];
        } else if (buffer.length + block.length > this.maxChunkSize && buffer) {
          chunks.push({ index: idx++, title: currentTitle, content: buffer.trim().slice(0, this.maxChunkSize) });
          buffer = block;
        } else {
          buffer += (buffer ? '\n\n' : '') + block;
        }
      }
      if (buffer.trim()) {
        chunks.push({ index: idx++, title: currentTitle, content: buffer.trim().slice(0, this.maxChunkSize) });
      }
    } else {
      // 等分
      const total = Math.ceil(content.length / this.maxChunkSize);
      for (let i = 0; i < total; i++) {
        chunks.push({
          index: i,
          title: '',
          content: content.slice(i * this.maxChunkSize, (i + 1) * this.maxChunkSize),
        });
      }
    }

    return chunks.length > 0 ? chunks : [{ index: 0, title: '', content: content.slice(0, this.maxChunkSize) }];
  }

  /**
   * 推断文件领域
   */
  private inferDomain(filePath: string, content: string): string {
    const lower = filePath.toLowerCase() + ' ' + content.slice(0, 500).toLowerCase();

    const domainMap: Array<[string, string[]]> = [
      ['前端', ['react', 'vue', 'css', 'html', 'tsx', 'jsx', 'frontend']],
      ['后端', ['node', 'express', 'fastify', 'api', 'server', 'backend']],
      ['数据库', ['sql', 'sqlite', 'postgres', 'mysql', 'redis', 'database']],
      ['机器学习', ['model', 'train', 'loss', 'epoch', 'embedding', 'ml']],
      ['DevOps', ['docker', 'k8s', 'nginx', 'deploy', 'ci/cd', 'devops']],
      ['文档', ['readme', 'changelog', 'license', 'todo', 'doc']],
      ['测试', ['test', 'spec', 'assert', 'expect', 'vitest', 'jest']],
      ['配置', ['config', 'env', 'setting', '.json', '.yaml', '.toml']],
    ];

    for (const [domain, keywords] of domainMap) {
      for (const kw of keywords) {
        if (lower.includes(kw)) return domain;
      }
    }

    return '通用';
  }

  /**
   * 简单概念提取
   */
  private extractConcepts(text: string): string[] {
    const stopwords = new Set([
      '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一',
      '这个', '那个', '什么', '怎么', '可以', '应该', '需要', '如果', '但是',
      'the', 'a', 'an', 'is', 'are', 'was', 'to', 'for', 'of', 'and', 'or', 'it',
    ]);
    return [...new Set(
      text.replace(/[，。！？、；：""''（）\[\]{}<>,.!?;:()\[\]{}<>]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length >= 2 && !stopwords.has(t))
    )].slice(0, 5);
  }

  /**
   * 数据库行转 KnowledgeNode
   */
  private rowToNode(row: any): KnowledgeNode {
    // FTS5 rank 是负数，越小越好，转换为 0-1 正分
    const rawScore = row.score ?? 0;
    const score = Math.min(1, Math.max(0, 1 + rawScore / 10));

    return {
      id: String(row.id),
      sourceId: this.id,
      sourceType: 'local',
      title: row.title || path.basename(row.file_path),
      content: row.content,
      summary: row.content.slice(0, 200),
      domain: row.domain,
      concepts: row.concepts ? row.concepts.split(',') : [],
      score,
      createdAt: 0,
      updatedAt: 0,
    };
  }
}
