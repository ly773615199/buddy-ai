/**
 * 屏幕标注叠加层 — 透明全屏窗口
 *
 * 在屏幕上绘制标注（箭头、框选、自由绘制、文字）。
 * 支持鼠标穿透与绘制模式切换。
 */

const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

class ScreenOverlay {
  /**
   * @param {Object} options
   * @param {Function} [options.onAnnotation] - 标注完成回调 (annotation) => {}
   * @param {Function} [options.onExport]     - 导出回调 (data) => {}
   */
  constructor(options = {}) {
    this.onAnnotation = options.onAnnotation || null;
    this.onExport = options.onExport || null;
    this.window = null;
    this.isVisible = false;
    this._isDrawing = false;
  }

  /**
   * 创建叠加层窗口
   */
  create() {
    if (this.window) return;

    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    this.window = new BrowserWindow({
      width,
      height,
      x: 0,
      y: 0,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focusable: false,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // 默认鼠标穿透
    this.window.setIgnoreMouseEvents(true, { forward: true });

    // 加载叠加层页面
    this.window.loadFile(path.join(__dirname, 'screen-overlay.html'));

    this._registerIpc();
  }

  /**
   * 注册 IPC 事件
   * @private
   */
  _registerIpc() {
    // 清除旧监听（防止重复注册）
    this._removeIpc();

    this._handlers = {};

    // 切换绘制模式
    this._handlers.overlay_draw_mode = (event, enabled) => {
      this.setDrawMode(enabled);
    };

    // 清除所有标注
    this._handlers.overlay_clear = () => {
      if (this.window && !this.window.isDestroyed()) {
        this.window.webContents.send('overlay_clear');
      }
    };

    // 导出标注数据
    this._handlers.overlay_export = (event, data) => {
      if (this.onExport) this.onExport(data);
    };

    // 单条标注完成
    this._handlers.overlay_annotation = (event, annotation) => {
      if (this.onAnnotation) this.onAnnotation(annotation);
    };

    for (const [channel, handler] of Object.entries(this._handlers)) {
      ipcMain.on(channel, handler);
    }
  }

  /**
   * 移除 IPC 监听
   * @private
   */
  _removeIpc() {
    if (!this._handlers) return;
    for (const [channel, handler] of Object.entries(this._handlers)) {
      ipcMain.removeListener(channel, handler);
    }
    this._handlers = {};
  }

  /**
   * 显示叠加层
   */
  show() {
    if (!this.window) this.create();
    this.window.showInactive();
    this.isVisible = true;
  }

  /**
   * 隐藏叠加层
   */
  hide() {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.hide();
    this.isVisible = false;
  }

  /**
   * 切换可见性
   */
  toggle() {
    this.isVisible ? this.hide() : this.show();
  }

  /**
   * 切换绘制模式（拦截 / 鼠标穿透）
   * @param {boolean} enabled - true=拦截鼠标, false=穿透
   */
  setDrawMode(enabled) {
    if (!this.window || this.window.isDestroyed()) return;
    this._isDrawing = !!enabled;
    this.window.setIgnoreMouseEvents(!enabled, { forward: !enabled });
    this.window.webContents.send('overlay_draw_mode_changed', enabled);
  }

  /**
   * 推送标注到渲染进程
   * @param {Object} annotation
   */
  addAnnotation(annotation) {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send('overlay_add_annotation', annotation);
  }

  /**
   * 清除所有标注
   */
  clearAnnotations() {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send('overlay_clear');
  }

  /**
   * 销毁窗口
   */
  destroy() {
    this._removeIpc();
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.window = null;
    this.isVisible = false;
  }
}

module.exports = { ScreenOverlay };
