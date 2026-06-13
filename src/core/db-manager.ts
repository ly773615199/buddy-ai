/**
 * 数据库统一管理 — 备份/恢复/状态查询
 *
 * 管理 Buddy 的所有 SQLite 数据库：
 * - memory.db (对话记忆)
 * - pet.db (养成数据)
 * - stmp.db (时空记忆宫殿)
 * - cognitive.db (认知引擎)
 * - shop.db (商城)
 * - experience-graph.json (经验图谱，JSON 文件)
 * - experience-events.jsonl (经验进化事件日志)
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import Database from 'better-sqlite3';

export interface DBInfo {
  name: string;
  path: string;
  sizeBytes: number;
  tables: string[];
  walMode: boolean;
}

export interface BackupResult {
  success: boolean;
  backupDir: string;
  files: string[];
  totalSizeBytes: number;
  timestamp: number;
  error?: string;
}

export interface RestoreResult {
  success: boolean;
  restoredFiles: string[];
  error?: string;
}

export class DatabaseManager {
  private dbDir: string;
  private dbNames = ['memory.db', 'pet.db', 'stmp.db', 'cognitive.db', 'shop.db'];
  private jsonFiles = ['experience-graph.json', 'experience-events.jsonl'];

  constructor(dbDir?: string) {
    this.dbDir = dbDir ?? path.join(process.env.HOME ?? '/tmp', '.buddy');
  }

  /** 获取所有数据库信息 */
  getInfo(): DBInfo[] {
    const infos: DBInfo[] = [];

    for (const name of this.dbNames) {
      const dbPath = path.join(this.dbDir, name);
      if (!fs.existsSync(dbPath)) continue;

      const stat = fs.statSync(dbPath);
      let tables: string[] = [];
      let walMode = false;

      try {
        const db = new Database(dbPath, { readonly: true });
        const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
        tables = rows.map(r => r.name);
        const wal = db.pragma('journal_mode', { simple: true });
        walMode = wal === 'wal';
        db.close();
      } catch { /* skip unreadable db */ }

      infos.push({ name, path: dbPath, sizeBytes: stat.size, tables, walMode });
    }

    // JSON 文件
    for (const name of this.jsonFiles) {
      const filePath = path.join(this.dbDir, name);
      if (!fs.existsSync(filePath)) continue;
      const stat = fs.statSync(filePath);
      infos.push({ name, path: filePath, sizeBytes: stat.size, tables: [], walMode: false });
    }

    return infos;
  }

  /** 获取总大小 */
  getTotalSize(): number {
    return this.getInfo().reduce((sum, db) => sum + db.sizeBytes, 0);
  }

  /**
   * 备份所有数据库到指定目录
   * 使用 SQLite backup API（安全，不阻塞写入）
   */
  async backup(backupDir?: string): Promise<BackupResult> {
    const timestamp = Date.now();
    const dir = backupDir ?? path.join(this.dbDir, 'backups', `backup-${timestamp}`);
    const ts = new Date(timestamp).toISOString().replace(/[:.]/g, '-');

    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const files: string[] = [];
      let totalSize = 0;

      // SQLite 数据库 — 使用 backup API（WAL 安全）
      for (const name of this.dbNames) {
        const srcPath = path.join(this.dbDir, name);
        if (!fs.existsSync(srcPath)) continue;

        const destPath = path.join(dir, name);

        try {
          const src = new Database(srcPath, { readonly: true });
          await fsp.copyFile(srcPath, destPath);
          // 复制 WAL 和 SHM 文件（如果存在）
          for (const ext of ['-wal', '-shm']) {
            const sidecar = srcPath + ext;
            if (fs.existsSync(sidecar)) {
              await fsp.copyFile(sidecar, destPath + ext);
            }
          }
          src.close();
        } catch {
          // fallback: 直接文件复制
          await fsp.copyFile(srcPath, destPath);
        }

        const stat = fs.statSync(destPath);
        files.push(name);
        totalSize += stat.size;
      }

      // JSON 文件
      for (const name of this.jsonFiles) {
        const srcPath = path.join(this.dbDir, name);
        if (!fs.existsSync(srcPath)) continue;

        const destPath = path.join(dir, name);
        await fsp.copyFile(srcPath, destPath);
        const stat = fs.statSync(destPath);
        files.push(name);
        totalSize += stat.size;
      }

      // 写入备份元数据
      const meta = {
        timestamp,
        date: new Date(timestamp).toISOString(),
        files,
        totalSizeBytes: totalSize,
        buddyDir: this.dbDir,
      };
      await fsp.writeFile(path.join(dir, 'backup-meta.json'), JSON.stringify(meta, null, 2));

      return { success: true, backupDir: dir, files, totalSizeBytes: totalSize, timestamp };
    } catch (err) {
      return {
        success: false,
        backupDir: dir,
        files: [],
        totalSizeBytes: 0,
        timestamp,
        error: (err as Error).message,
      };
    }
  }

  /**
   * 从备份目录恢复
   * 恢复前自动创建当前状态的备份
   */
  async restore(backupDir: string): Promise<RestoreResult> {
    try {
      // 先备份当前状态
      const safetyBackup = await this.backup();
      if (!safetyBackup.success) {
        return { success: false, restoredFiles: [], error: '安全备份失败，中止恢复' };
      }

      const restoredFiles: string[] = [];

      // 恢复 SQLite 数据库
      for (const name of this.dbNames) {
        const srcPath = path.join(backupDir, name);
        if (!fs.existsSync(srcPath)) continue;

        const destPath = path.join(this.dbDir, name);
        await fsp.copyFile(srcPath, destPath);
        restoredFiles.push(name);
      }

      // 恢复 JSON 文件
      for (const name of this.jsonFiles) {
        const srcPath = path.join(backupDir, name);
        if (!fs.existsSync(srcPath)) continue;

        const destPath = path.join(this.dbDir, name);
        await fsp.copyFile(srcPath, destPath);
        restoredFiles.push(name);
      }

      return { success: true, restoredFiles };
    } catch (err) {
      return { success: false, restoredFiles: [], error: (err as Error).message };
    }
  }

  /** 列出所有备份 */
  listBackups(): Array<{ dir: string; date: string; files: number; sizeBytes: number }> {
    const backupsDir = path.join(this.dbDir, 'backups');
    if (!fs.existsSync(backupsDir)) return [];

    const entries = fs.readdirSync(backupsDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.startsWith('backup-'))
      .sort((a, b) => b.name.localeCompare(a.name));

    return entries.map(entry => {
      const dir = path.join(backupsDir, entry.name);
      const metaPath = path.join(dir, 'backup-meta.json');
      let date = entry.name;
      let files = 0;
      let sizeBytes = 0;

      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        date = meta.date;
        files = meta.files?.length ?? 0;
        sizeBytes = meta.totalSizeBytes ?? 0;
      } catch {
        // 无元数据，统计目录内容
        const contents = fs.readdirSync(dir);
        files = contents.filter(f => !f.startsWith('.')).length;
        for (const f of contents) {
          try { sizeBytes += fs.statSync(path.join(dir, f)).size; } catch {}
        }
      }

      return { dir, date, files, sizeBytes };
    });
  }

  /** 清理旧备份（保留最近 N 个） */
  cleanupBackups(keepCount = 5): number {
    const backups = this.listBackups();
    if (backups.length <= keepCount) return 0;

    let removed = 0;
    for (const backup of backups.slice(keepCount)) {
      try {
        fs.rmSync(backup.dir, { recursive: true, force: true });
        removed++;
      } catch { /* 清理旧备份失败，不影响主流程 */ }
    }
    return removed;
  }
}
