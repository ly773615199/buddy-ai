/**
 * Sprint 5 D1: 剪贴板感知
 *
 * 监听剪贴板变化，分析内容类型，驱动光灵反应。
 * - 复制代码 → 光灵"分析"姿态
 * - 复制 URL → 光灵"想去看看"姿态
 * - 复制错误信息 → 光灵"我来修"姿态
 * - 长时间不复制 → 光灵无聊飘动
 */

const { clipboard } = require('electron');

class ClipboardMonitor {
  constructor(options = {}) {
    this.intervalMs = options.intervalMs || 1500;
    this.onClip = options.onClip || (() => {});
    this.onIdle = options.onIdle || (() => {});

    this._timer = null;
    this._lastContent = '';
    this._lastClipTime = Date.now();
    this._idleThresholdMs = options.idleThresholdMs || 60000; // 1 分钟无复制视为无聊
    this._idleTimer = null;
    this._isRunning = false;
  }

  start() {
    if (this._isRunning) return;
    this._isRunning = true;
    this._lastContent = clipboard.readText();
    this._lastClipTime = Date.now();

    this._timer = setInterval(() => this._check(), this.intervalMs);
    this._idleTimer = setInterval(() => this._checkIdle(), 10000);
    console.log('[ClipboardMonitor] 已启动');
  }

  stop() {
    this._isRunning = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this._idleTimer) { clearInterval(this._idleTimer); this._idleTimer = null; }
    console.log('[ClipboardMonitor] 已停止');
  }

  _check() {
    try {
      const current = clipboard.readText();
      if (current && current !== this._lastContent) {
        this._lastContent = current;
        this._lastClipTime = Date.now();
        const analysis = this._analyze(current);
        this.onClip(analysis);
      }
    } catch (e) {
      // 剪贴板访问失败（可能被系统锁定）
    }
  }

  _checkIdle() {
    const idleMs = Date.now() - this._lastClipTime;
    if (idleMs > this._idleThresholdMs) {
      this.onIdle({ idleMs, bored: true });
    }
  }

  _analyze(text) {
    const trimmed = text.trim();
    const len = trimmed.length;

    // URL 检测
    if (/^https?:\/\/\S+$/i.test(trimmed)) {
      return { type: 'url', content: trimmed, length: len, reaction: 'curious', description: '发现链接' };
    }

    // 错误信息检测
    if (/\b(error|exception|traceback|fail|panic|fatal|errno)\b/i.test(trimmed) ||
        /^\s*at\s+\S+/m.test(trimmed) ||
        /Error:|Exception:|TypeError:|ReferenceError:/i.test(trimmed)) {
      return { type: 'error', content: trimmed.slice(0, 200), length: len, reaction: 'concerned', description: '发现错误信息' };
    }

    // 代码检测
    if (/[{}\[\]();]/.test(trimmed) &&
        (/\b(function|const|let|var|import|export|class|def|return|if|else|for|while)\b/.test(trimmed) ||
         /=>|->|::/.test(trimmed) ||
         /^\s*(import|from|const|let|var|function|class|def)\s/m.test(trimmed))) {
      return { type: 'code', content: trimmed.slice(0, 200), length: len, reaction: 'analyzing', description: '发现代码' };
    }

    // JSON 检测
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        JSON.parse(trimmed);
        return { type: 'json', content: trimmed.slice(0, 200), length: len, reaction: 'analyzing', description: '发现 JSON' };
      } catch { /* not json */ }
    }

    // 文件路径检测
    if (/^([A-Z]:\\|\/|~\/|\.\.?\/)\S+$/i.test(trimmed) || /^\S+\.\w{1,5}$/.test(trimmed)) {
      return { type: 'path', content: trimmed, length: len, reaction: 'curious', description: '发现文件路径' };
    }

    // 长文本
    if (len > 500) {
      return { type: 'long_text', content: trimmed.slice(0, 200), length: len, reaction: 'reading', description: '发现长文本' };
    }

    // 普通文本
    return { type: 'text', content: trimmed.slice(0, 100), length: len, reaction: 'neutral', description: '复制了文本' };
  }

  destroy() {
    this.stop();
  }
}

module.exports = { ClipboardMonitor };
