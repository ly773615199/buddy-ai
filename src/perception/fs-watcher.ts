/**
 * 文件变更监听器
 * 监听工作目录文件变化，实时感知 → 事件总线
 */

import * as fs from 'fs';
import * as path from 'path';

export interface FileChangeEvent {
  type: 'add' | 'change' | 'unlink';
  path: string;
  relativePath: string;
  timestamp: number;
  extension: string;
}

export interface FileWatcherOptions {
  rootPath: string;            // 监听根目录
  ignorePatterns?: RegExp[];   // 忽略的文件模式
  extensions?: string[];       // 只监听这些扩展名，空 = 全部
  debounceMs?: number;         // 防抖间隔，默认 500ms
  maxDepth?: number;           // 最大监听深度，默认 3
}

export type FileChangeCallback = (event: FileChangeEvent) => void;

const DEFAULT_IGNORE = [
  /node_modules/,
  /\.git/,
  /\.next/,
  /dist/,
  /build/,
  /__pycache__/,
  /\.cache/,
  /\.DS_Store/,
];

export class FileWatcher {
  private rootPath: string;
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private callbacks: Set<FileChangeCallback> = new Set();
  private ignorePatterns: RegExp[];
  private extensions: Set<string> | null;
  private debounceMs: number;
  private maxDepth: number;
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private active = false;

  constructor(options: FileWatcherOptions) {
    this.rootPath = path.resolve(options.rootPath);
    this.ignorePatterns = [...DEFAULT_IGNORE, ...(options.ignorePatterns ?? [])];
    this.extensions = options.extensions ? new Set(options.extensions.map(e => e.toLowerCase())) : null;
    this.debounceMs = options.debounceMs ?? 500;
    this.maxDepth = options.maxDepth ?? 3;
  }

  /** 开始监听 */
  start(): void {
    if (this.active) return;
    this.active = true;
    this._watchDir(this.rootPath, 0);
  }

  /** 停止监听 */
  stop(): void {
    this.active = false;
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  /** 订阅变更 */
  onChange(callback: FileChangeCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /** 是否正在监听 */
  get isWatching(): boolean {
    return this.active;
  }

  /** 获取监听的目录数 */
  get watchedCount(): number {
    return this.watchers.size;
  }

  /** 销毁 */
  destroy(): void {
    this.stop();
    this.callbacks.clear();
  }

  // ==================== 内部方法 ====================

  private _watchDir(dirPath: string, depth: number): void {
    if (!this.active || depth > this.maxDepth) return;
    if (this._shouldIgnore(dirPath)) return;

    try {
      const watcher = fs.watch(dirPath, (eventType, filename) => {
        if (!filename) return;
        const fullPath = path.join(dirPath, filename.toString());

        if (this._shouldIgnore(fullPath)) return;

        // 防抖
        const key = fullPath;
        const existing = this.debounceTimers.get(key);
        if (existing) clearTimeout(existing);

        this.debounceTimers.set(key, setTimeout(() => {
          this.debounceTimers.delete(key);
          this._handleChange(fullPath, eventType);
        }, this.debounceMs));
      });

      this.watchers.set(dirPath, watcher);

      // 递归监听子目录
      if (depth < this.maxDepth) {
        try {
          const entries = fs.readdirSync(dirPath, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const subDir = path.join(dirPath, entry.name);
              if (!this._shouldIgnore(subDir)) {
                this._watchDir(subDir, depth + 1);
              }
            }
          }
        } catch { /* 权限不足等，忽略 */ }
      }
    } catch { /* 监听失败，忽略 */ }
  }

  private _handleChange(fullPath: string, eventType: string): void {
    const relativePath = path.relative(this.rootPath, fullPath);
    const ext = path.extname(fullPath).toLowerCase();

    // 扩展名过滤
    if (this.extensions && !this.extensions.has(ext)) return;

    let changeType: FileChangeEvent['type'];
    if (eventType === 'rename') {
      // rename 事件：文件存在则为 add，不存在则为 unlink
      try {
        fs.accessSync(fullPath);
        changeType = 'add';
      } catch {
        changeType = 'unlink';
      }
    } else {
      changeType = 'change';
    }

    const event: FileChangeEvent = {
      type: changeType,
      path: fullPath,
      relativePath,
      timestamp: Date.now(),
      extension: ext,
    };

    for (const cb of this.callbacks) {
      try { cb(event); } catch { /* ignore */ }
    }

    // 如果是新目录，尝试递归监听
    if (changeType === 'add') {
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          const depth = relativePath.split(path.sep).length;
          this._watchDir(fullPath, depth);
        }
      } catch { /* ignore */ }
    }
  }

  private _shouldIgnore(filePath: string): boolean {
    return this.ignorePatterns.some(p => p.test(filePath));
  }
}
