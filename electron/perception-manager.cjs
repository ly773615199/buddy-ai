/**
 * Sprint 5: 感知管理器
 *
 * 统一管理所有感知模块，将感知事件聚合后驱动光灵反应。
 * 通过 IPC 将事件推送到前端和浮窗。
 */

const { ipcMain } = require('electron');
const { ClipboardMonitor } = require('./clipboard-monitor.cjs');
const { FileMonitor } = require('./file-monitor.cjs');
const { TimeAwareness } = require('./time-awareness.cjs');
const { NetworkAwareness } = require('./network-awareness.cjs');
const { NotificationManager } = require('./notification.cjs');

class PerceptionManager {
  constructor(options = {}) {
    this.mainWindow = options.mainWindow || null;
    this.floatingWindow = options.floatingWindow || null;

    // 感知模块
    this.clipboard = new ClipboardMonitor({
      onClip: (analysis) => this._dispatch('clipboard', analysis),
      onIdle: (data) => this._dispatch('clipboard_idle', data),
    });

    this.file = new FileMonitor({
      onFileEvent: (event) => this._dispatch('file', event),
    });

    this.time = new TimeAwareness({
      onTimeChange: (phase) => this._dispatch('time', phase),
    });

    this.network = new NetworkAwareness({
      onNetworkChange: (state) => this._dispatch('network', state),
    });

    this.notification = new NotificationManager({
      onNotify: (params) => this._dispatch('notification', params),
    });

    this._isRunning = false;
    this._eventHistory = [];
    this._maxHistory = 100;
  }

  start() {
    if (this._isRunning) return;
    this._isRunning = true;

    this.clipboard.start();
    this.file.start();
    this.time.start();
    this.network.start();
    this.notification.start();

    // 注册 IPC：前端请求感知状态
    ipcMain.handle('perception_status', () => this.getStatus());

    console.log('[PerceptionManager] 所有感知模块已启动');
  }

  stop() {
    this._isRunning = false;
    this.clipboard.stop();
    this.file.stop();
    this.time.stop();
    this.network.stop();
    this.notification.stop();
  }

  setMainWindow(win) {
    this.mainWindow = win;
  }

  setFloatingWindow(win) {
    this.floatingWindow = win;
  }

  /** 获取感知状态 */
  getStatus() {
    return {
      running: this._isRunning,
      clipboard: { monitoring: this.clipboard._isRunning },
      file: { watchPaths: this.file.watchPaths, monitoring: this.file._isRunning },
      time: this.time.getCurrentPhase(),
      network: this.network._currentState,
      recentEvents: this._eventHistory.slice(-10),
    };
  }

  /** 通知快捷方法 */
  notify(params) {
    this.notification.notify(params);
  }

  // ==================== 内部方法 ====================

  _dispatch(source, data) {
    const event = {
      source,
      timestamp: Date.now(),
      ...data,
    };

    // 记录历史
    this._eventHistory.push(event);
    if (this._eventHistory.length > this._maxHistory) {
      this._eventHistory = this._eventHistory.slice(-this._maxHistory);
    }

    // 推送到主窗口
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('perception_event', event);
    }

    // 推送到浮窗
    if (this.floatingWindow && this.floatingWindow.window) {
      this.floatingWindow.window.webContents.send('perception_event', event);
    }

    // 日志
    const reaction = data.reaction || data.mood || 'neutral';
    const desc = data.description || source;
    console.log(`[Perception] ${source}: ${desc} → ${reaction}`);
  }

  destroy() {
    this.stop();
    this.clipboard.destroy();
    this.file.destroy();
    this.time.destroy();
    this.network.destroy();
    this.notification.destroy();
  }
}

module.exports = { PerceptionManager };
