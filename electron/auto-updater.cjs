/**
 * 自动更新管理器
 * 使用 electron-updater 实现应用自动更新
 */

const { autoUpdater } = require('electron-updater');
const { dialog, BrowserWindow } = require('electron');
const log = require('electron-log');

// 配置日志
log.transports.file.level = 'info';
autoUpdater.logger = log;

class AutoUpdater {
  constructor() {
    this.mainWindow = null;
    this.isChecking = false;

    // 更新配置
    autoUpdater.autoDownload = false; // 手动确认下载
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.fullChangelog = true;

    this._setupEvents();
  }

  /**
   * 设置主窗口引用（用于显示对话框）
   */
  setMainWindow(win) {
    this.mainWindow = win;
  }

  /**
   * 设置事件监听
   */
  _setupEvents() {
    // 检查更新中
    autoUpdater.on('checking-for-update', () => {
      log.info('[Updater] 正在检查更新...');
      this.isChecking = true;
      this._notifyRenderer('update-checking');
    });

    // 发现新版本
    autoUpdater.on('update-available', (info) => {
      log.info('[Updater] 发现新版本:', info.version);
      this.isChecking = false;
      this._notifyRenderer('update-available', {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes,
      });
      this._promptDownload(info);
    });

    // 没有新版本
    autoUpdater.on('update-not-available', (info) => {
      log.info('[Updater] 当前已是最新版本:', info.version);
      this.isChecking = false;
      this._notifyRenderer('update-not-available');
    });

    // 更新下载进度
    autoUpdater.on('download-progress', (progress) => {
      const percent = Math.round(progress.percent);
      log.info(`[Updater] 下载进度: ${percent}%`);
      this._notifyRenderer('update-download-progress', {
        percent,
        transferred: progress.transferred,
        total: progress.total,
        speed: progress.bytesPerSecond,
      });
    });

    // 更新下载完成
    autoUpdater.on('update-downloaded', (info) => {
      log.info('[Updater] 更新下载完成:', info.version);
      this._notifyRenderer('update-downloaded', {
        version: info.version,
      });
      this._promptInstall(info);
    });

    // 更新错误
    autoUpdater.on('error', (err) => {
      log.error('[Updater] 更新错误:', err.message);
      this.isChecking = false;
      this._notifyRenderer('update-error', {
        message: err.message,
      });
    });
  }

  /**
   * 检查更新（手动触发）
   */
  async checkForUpdates() {
    if (this.isChecking) {
      log.info('[Updater] 正在检查中，跳过');
      return;
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      log.error('[Updater] 检查更新失败:', err.message);
    }
  }

  /**
   * 下载更新
   */
  async downloadUpdate() {
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      log.error('[Updater] 下载更新失败:', err.message);
    }
  }

  /**
   * 安装更新并退出
   */
  quitAndInstall() {
    autoUpdater.quitAndInstall(false, true);
  }

  /**
   * 提示用户下载更新
   */
  async _promptDownload(info) {
    const win = this.mainWindow || BrowserWindow.getFocusedWindow();
    if (!win) return;

    const result = await dialog.showMessageBox(win, {
      type: 'info',
      title: '发现新版本',
      message: `Buddy ${info.version} 可用`,
      detail: info.releaseNotes
        ? `更新内容:\n${this._stripHtml(info.releaseNotes)}`
        : '是否现在下载更新？',
      buttons: ['下载更新', '稍后提醒'],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      this.downloadUpdate();
    }
  }

  /**
   * 提示用户安装更新
   */
  async _promptInstall(info) {
    const win = this.mainWindow || BrowserWindow.getFocusedWindow();
    if (!win) return;

    const result = await dialog.showMessageBox(win, {
      type: 'info',
      title: '更新已就绪',
      message: `Buddy ${info.version} 已下载完成`,
      detail: '是否立即重启应用以完成更新？',
      buttons: ['立即重启', '稍后重启'],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      this.quitAndInstall();
    }
  }

  /**
   * 通知渲染进程
   */
  _notifyRenderer(event, data = {}) {
    const win = this.mainWindow || BrowserWindow.getFocusedWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('updater-event', { event, ...data });
    }
  }

  /**
   * 移除 HTML 标签
   */
  _stripHtml(html) {
    return html.replace(/<[^>]*>/g, '').trim();
  }

  /**
   * 获取当前版本
   */
  getCurrentVersion() {
    return autoUpdater.currentVersion?.version || '0.0.0';
  }

  /**
   * 获取更新配置信息
   */
  getUpdateInfo() {
    return {
      currentVersion: this.getCurrentVersion(),
      updateServerUrl: autoUpdater.getFeedURL?.() || '未配置',
      autoDownload: autoUpdater.autoDownload,
      autoInstallOnAppQuit: autoUpdater.autoInstallOnAppQuit,
    };
  }
}

module.exports = { AutoUpdater };
