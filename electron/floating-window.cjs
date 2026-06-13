/**
 * Electron 桌面浮窗 — 透明无边框窗口
 *
 * 光灵在屏幕上自由移动，响应鼠标交互。
 * 双击打开主窗口，右键显示快捷菜单，拖拽移动位置。
 *
 * Sprint 4 D1-D3: 透明窗口 + 鼠标交互 + 窗口检测
 */

const { BrowserWindow, screen, ipcMain, Menu, nativeImage } = require('electron');
const path = require('path');

class FloatingWindow {
  constructor(options = {}) {
    this.mainWindow = options.mainWindow || null;
    this.window = null;
    this.spriteSize = options.spriteSize || 160;
    this.alwaysOnTop = options.alwaysOnTop !== false;
    this.position = options.position || null; // { x, y }
    this.isVisible = false;

    // 拖拽状态
    this._isDragging = false;
    this._dragOffset = { x: 0, y: 0 };

    // 窗口检测
    this._windowCheckInterval = null;
    this._nearbyWindows = [];
  }

  /**
   * 创建浮窗
   */
  create() {
    if (this.window) return;

    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

    // 默认位置：右下角
    const defaultX = screenWidth - this.spriteSize - 40;
    const defaultY = screenHeight - this.spriteSize - 40;
    const pos = this.position || { x: defaultX, y: defaultY };

    this.window = new BrowserWindow({
      width: this.spriteSize,
      height: this.spriteSize,
      x: pos.x,
      y: pos.y,
      frame: false,           // 无边框
      transparent: true,      // 透明背景
      alwaysOnTop: this.alwaysOnTop,
      resizable: false,
      skipTaskbar: true,      // 不在任务栏显示
      hasShadow: false,
      focusable: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'floating-preload.cjs'),
      },
    });

    // 加载浮窗页面
    this.window.loadFile(path.join(__dirname, 'sprite-window.html'));

    // 窗口层级设置
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // 鼠标穿透 — 非光灵区域点击穿透到下层窗口
    this.window.setIgnoreMouseEvents(false);

    // IPC 事件处理
    this._setupIPC();

    // 窗口检测（每 2 秒）
    this._startWindowDetection();

    this.window.on('closed', () => {
      this.window = null;
      this.isVisible = false;
      this._stopWindowDetection();
    });

    this.isVisible = true;
    console.log('[FloatingWindow] 已创建');
  }

  /**
   * 显示浮窗
   */
  show() {
    if (!this.window) {
      this.create();
      return;
    }
    this.window.show();
    this.isVisible = true;
  }

  /**
   * 隐藏浮窗
   */
  hide() {
    if (!this.window) return;
    this.window.hide();
    this.isVisible = false;
  }

  /**
   * 切换显示/隐藏
   */
  toggle() {
    if (this.isVisible) this.hide();
    else this.show();
  }

  /**
   * 销毁浮窗
   */
  destroy() {
    this._stopWindowDetection();
    if (this.window) {
      this.window.destroy();
      this.window = null;
    }
    this.isVisible = false;
  }

  /**
   * 同步状态到浮窗（情绪/阶段/颜色）
   */
  updateState(state) {
    if (!this.window || !this.window.webContents) return;
    this.window.webContents.send('state_update', state);
  }

  /**
   * 设置主窗口引用（双击时打开）
   */
  setMainWindow(win) {
    this.mainWindow = win;
  }

  // ==================== 内部方法 ====================

  _setupIPC() {
    // 打开主窗口
    ipcMain.on('floating_open_main', () => {
      if (this.mainWindow) {
        this.mainWindow.show();
        this.mainWindow.focus();
      }
    });

    // 右键菜单
    ipcMain.on('floating_context_menu', (event) => {
      const menu = Menu.buildFromTemplate([
        {
          label: '💬 打开对话',
          click: () => {
            if (this.mainWindow) {
              this.mainWindow.show();
              this.mainWindow.focus();
            }
          },
        },
        { type: 'separator' },
        {
          label: '📌 置顶',
          type: 'checkbox',
          checked: this.alwaysOnTop,
          click: (item) => {
            this.alwaysOnTop = item.checked;
            if (this.window) this.window.setAlwaysOnTop(this.alwaysOnTop);
          },
        },
        {
          label: '👁️ 隐藏光灵',
          click: () => this.hide(),
        },
        { type: 'separator' },
        {
          label: '⚙️ 设置',
          click: () => {
            if (this.mainWindow) {
              this.mainWindow.show();
              this.mainWindow.focus();
              // 通知主窗口切换到设置 tab
              this.mainWindow.webContents.send('switch_tab', 'settings');
            }
          },
        },
      ]);
      menu.popup({ window: this.window });
    });

    // 拖拽移动 — 通过 IPC 传递偏移
    ipcMain.on('floating_drag_start', (event, offset) => {
      this._isDragging = true;
      this._dragOffset = offset;
    });

    ipcMain.on('floating_drag_move', (event, mousePos) => {
      if (!this._isDragging || !this.window) return;
      const { x: screenX, y: screenY } = screen.getCursorScreenPoint();
      this.window.setPosition(
        screenX - this._dragOffset.x,
        screenY - this._dragOffset.y,
      );
    });

    ipcMain.on('floating_drag_end', () => {
      this._isDragging = false;
      // 保存位置
      if (this.window) {
        const [x, y] = this.window.getPosition();
        this.position = { x, y };
      }
    });
  }

  _startWindowDetection() {
    // 每 2 秒检测附近窗口位置
    this._windowCheckInterval = setInterval(() => {
      if (!this.window || !this.isVisible) return;

      const [winX, winY] = this.window.getPosition();
      const displays = screen.getAllDisplays();

      // 检查浮窗是否在屏幕可见区域
      let onScreen = false;
      for (const display of displays) {
        const { x, y, width, height } = display.workArea;
        if (winX >= x && winX <= x + width && winY >= y && winY <= y + height) {
          onScreen = true;
          break;
        }
      }

      // 如果超出屏幕，拉回来
      if (!onScreen) {
        const { width, height } = screen.getPrimaryDisplay().workAreaSize;
        this.window.setPosition(width - this.spriteSize - 40, height - this.spriteSize - 40);
      }
    }, 2000);
  }

  _stopWindowDetection() {
    if (this._windowCheckInterval) {
      clearInterval(this._windowCheckInterval);
      this._windowCheckInterval = null;
    }
  }
}

module.exports = { FloatingWindow };
