/**
 * Sprint 5 D2: 文件系统感知
 *
 * 接入已有 fs-watcher.ts，监听文件变化驱动光灵反应。
 * - 新文件下载 → 光灵"发现新东西"
 * - 文件修改 → 光灵"注意到变化"
 * - 项目目录变化 → 光灵"整理"姿态
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

class FileMonitor {
  constructor(options = {}) {
    this.watchPaths = options.watchPaths || this._defaultPaths();
    this.onFileEvent = options.onFileEvent || (() => {});
    this.debounceMs = options.debounceMs || 500;

    this._watchers = [];
    this._isRunning = false;
    this._debounceTimer = null;
    this._pendingEvents = [];
  }

  _defaultPaths() {
    const home = os.homedir();
    return [
      path.join(home, 'Downloads'),
      path.join(home, 'Desktop'),
      path.join(home, 'Documents'),
    ].filter(p => {
      try { return fs.existsSync(p); } catch { return false; }
    });
  }

  start() {
    if (this._isRunning) return;
    this._isRunning = true;

    for (const watchPath of this.watchPaths) {
      try {
        const watcher = fs.watch(watchPath, { recursive: false }, (eventType, filename) => {
          if (!filename) return;
          this._handleEvent(watchPath, eventType, filename);
        });
        this._watchers.push({ watcher, path: watchPath });
        console.log(`[FileMonitor] 监听: ${watchPath}`);
      } catch (e) {
        console.warn(`[FileMonitor] 无法监听 ${watchPath}: ${e.message}`);
      }
    }
  }

  stop() {
    this._isRunning = false;
    for (const { watcher } of this._watchers) {
      try { watcher.close(); } catch { /* ignore */ }
    }
    this._watchers = [];
    if (this._debounceTimer) { clearTimeout(this._debounceTimer); this._debounceTimer = null; }
  }

  addWatchPath(dirPath) {
    if (!fs.existsSync(dirPath)) return false;
    try {
      const watcher = fs.watch(dirPath, { recursive: false }, (eventType, filename) => {
        if (!filename) return;
        this._handleEvent(dirPath, eventType, filename);
      });
      this._watchers.push({ watcher, path: dirPath });
      this.watchPaths.push(dirPath);
      return true;
    } catch { return false; }
  }

  removeWatchPath(dirPath) {
    const idx = this.watchPaths.indexOf(dirPath);
    if (idx !== -1) this.watchPaths.splice(idx, 1);
    const wIdx = this._watchers.findIndex(w => w.path === dirPath);
    if (wIdx !== -1) {
      try { this._watchers[wIdx].watcher.close(); } catch { /* ignore */ }
      this._watchers.splice(wIdx, 1);
    }
  }

  _handleEvent(dirPath, eventType, filename) {
    const fullPath = path.join(dirPath, filename);
    const ext = path.extname(filename).toLowerCase();

    // 忽略临时文件和隐藏文件
    if (filename.startsWith('.') || filename.endsWith('.tmp') || filename.endsWith('.crdownload')) return;

    const analysis = this._analyze(eventType, fullPath, ext);
    this._pendingEvents.push(analysis);

    // 防抖：批量处理短时间内的多次变化
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      const events = [...this._pendingEvents];
      this._pendingEvents = [];
      if (events.length > 0) {
        this.onFileEvent(events.length === 1 ? events[0] : {
          type: 'batch',
          events,
          count: events.length,
          reaction: events.some(e => e.isNew) ? 'excited' : 'noticing',
          description: `${events.length} 个文件变化`,
        });
      }
    }, this.debounceMs);
  }

  _analyze(eventType, fullPath, ext) {
    const isNew = eventType === 'rename' && !fs.existsSync(fullPath);
    const isCreated = eventType === 'rename' && fs.existsSync(fullPath);
    const isModified = eventType === 'change';

    // 文件类型分类
    let category = 'unknown';
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'].includes(ext)) category = 'image';
    else if (['.mp3', '.wav', '.ogg', '.flac', '.aac'].includes(ext)) category = 'audio';
    else if (['.mp4', '.mkv', '.avi', '.mov', '.webm'].includes(ext)) category = 'video';
    else if (['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'].includes(ext)) category = 'document';
    else if (['.zip', '.tar', '.gz', '.rar', '.7z', '.dmg'].includes(ext)) category = 'archive';
    else if (['.js', '.ts', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h'].includes(ext)) category = 'code';
    else if (['.json', '.yaml', '.yml', '.toml', '.xml', '.env'].includes(ext)) category = 'config';
    else if (['.txt', '.md', '.log', '.csv'].includes(ext)) category = 'text';

    // 反应映射
    let reaction = 'noticing';
    let description = '文件变化';

    if (isCreated) {
      reaction = 'curious';
      description = `新文件: ${path.basename(fullPath)}`;
      if (category === 'image') { reaction = 'excited'; description = '发现新图片'; }
      else if (category === 'archive') { reaction = 'excited'; description = '收到压缩包'; }
      else if (category === 'document') { reaction = 'reading'; description = '新文档'; }
    } else if (isModified) {
      reaction = 'noticing';
      description = `文件修改: ${path.basename(fullPath)}`;
      if (category === 'code') { reaction = 'analyzing'; description = '代码更新'; }
      else if (category === 'config') { reaction = 'concerned'; description = '配置变化'; }
    } else if (isNew) {
      reaction = 'noticing';
      description = `文件移除: ${path.basename(fullPath)}`;
    }

    return {
      type: isCreated ? 'created' : isModified ? 'modified' : 'deleted',
      path: fullPath,
      filename: path.basename(fullPath),
      ext,
      category,
      reaction,
      description,
      isNew: isCreated,
      timestamp: Date.now(),
    };
  }

  destroy() {
    this.stop();
  }
}

module.exports = { FileMonitor };
