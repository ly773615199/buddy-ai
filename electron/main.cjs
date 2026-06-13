/**
 * Electron 主进程 — Buddy 系统托盘应用
 *
 * 功能:
 * - 系统托盘常驻，点击打开控制窗口
 * - 后台自动启动 WebSocket 服务
 * - 内嵌前端界面（Vite 构建产物）
 * - 开机自启（可选）
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { FloatingWindow } = require('./floating-window.cjs');
const { PerceptionManager } = require('./perception-manager.cjs');
const { AutonomousBehavior } = require('./autonomous-behavior.cjs');
const { WindowAwareness } = require('./window-awareness.cjs');
const { GlobalShortcuts } = require('./global-shortcuts.cjs');
const { SystemInfoCollector } = require('./system-info.cjs');
const { PrinterManager } = require('./printer.cjs');
const { GeolocationManager } = require('./geolocation.cjs');
const { SerialDeviceManager } = require('./serial-device.cjs');
const { BluetoothManager } = require('./bluetooth.cjs');
const { ScreenOverlay } = require('./screen-overlay.cjs');
const { SystemAudioCapture } = require('./system-audio.cjs');
const { MediaControl } = require('./media-control.cjs');

// ── 配置 ──
const WS_PORT = process.env.BUDDY_WS_PORT || 8765;
const FRONTEND_PORT = process.env.BUDDY_FRONTEND_PORT || 5173;
const IS_DEV = !app.isPackaged;

let mainWindow = null;
let tray = null;
let wsProcess = null;
let floatingWindow = null; // Sprint 4: 桌面浮窗
let perceptionManager = null; // Sprint 5: 感知管理器
let autonomousBehavior = null; // Sprint 6: 自主行为
let windowAwareness = null;    // Sprint 6: 窗口感知
let globalShortcuts = null;    // Phase 1: 全局快捷键
let systemInfo = null;         // Phase 1: 系统信息
let geolocationManager = null; // Phase 1: 地理位置
let serialDevice = null;       // Phase 2: USB/串口
let bluetoothManager = null;   // Phase 2: 蓝牙
let screenOverlay = null;      // Phase 2: 屏幕标注
let systemAudio = null;        // Phase 3: 系统音频
let mediaControl = null;       // Phase 3: 媒体控制

// ── 托盘图标（内嵌 SVG → nativeImage）──
function createTrayIcon() {
  // 使用 emoji 生成简单图标
  const size = process.platform === 'darwin' ? 22 : 16;
  const canvas = {
    width: size,
    height: size,
    data: Buffer.alloc(size * size * 4),
  };

  // 简单的圆形图标
  const img = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAADJSURBVFhH7ZbBDQAgCARB73/pHIGYYgI4zcb+eIQdtwcAz+E4Z2YGd+AHXOcMALzOmQ/gug+A+l4A9L0A6HsB0PcCoO8FQN8LgL4XAH0vAPpeAPS9AOh7AdD3AqDvBUDfC4C+FwB9LwD6XgD0vQDoewHQ9wKg7wVA3wuAvhcAfS8A+l4A9L0A6HsB0PcCoO8FQN8LgL4XAH0vAPpeAPS9AOh7AdD3AqDvBUDfC4C+FwB9LwD6XgD0vQDoewHQ9wKg7wVA3wuAvhcAfS8A+l4A9L0A6HsB0PcCoO8FQN8LgL4XAH0vAPpe+C5r4AJiI0Rfyhn7bQAAAABJRU5ErkJggg=='
  );
  return img;
}

// ── 创建托盘 ──
function createTray() {
  // 尝试使用项目内图标，否则用默认
  let icon;
  const iconPath = path.join(__dirname, 'tray-icon.png');
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) throw new Error('empty');
  } catch {
    icon = createTrayIcon();
  }

  icon = icon.resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('🐾 Buddy — AI 助手');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '🐾 打开 Buddy',
      click: () => showWindow(),
    },
    { type: 'separator' },
    {
      label: '✨ 桌面浮窗',
      type: 'checkbox',
      checked: floatingWindow?.isVisible || false,
      click: (menuItem) => {
        if (!floatingWindow) {
          floatingWindow = new FloatingWindow({ mainWindow });
          floatingWindow.create();
        } else {
          floatingWindow.toggle();
        }
        menuItem.checked = floatingWindow.isVisible;
      },
    },
    { type: 'separator' },
    {
      label: `📡 服务端口: ${WS_PORT}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '🌐 打开浏览器访问',
      click: () => shell.openExternal(`http://localhost:${FRONTEND_PORT}`),
    },
    {
      label: '📂 打开数据目录',
      click: () => shell.openPath(app.getPath('userData')),
    },
    { type: 'separator' },
    {
      label: '⚙️ 开机自启',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (menuItem) => {
        app.setLoginItemSettings({ openAtLogin: menuItem.checked });
      },
    },
    { type: 'separator' },
    {
      label: '❌ 退出',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => showWindow());
}

// ── 创建窗口 ──
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 600,
    minHeight: 500,
    title: '🐾 Buddy',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // 加载前端
  if (IS_DEV) {
    mainWindow.loadURL(`http://localhost:${FRONTEND_PORT}`);
  } else {
    const indexPath = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on('close', (e) => {
    // 最小化到托盘而不是关闭
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 准备好后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Sprint 4: 主窗口就绪后，将引用传给浮窗
    if (floatingWindow) {
      floatingWindow.setMainWindow(mainWindow);
    }
    // Sprint 5: 感知管理器绑定主窗口
    if (perceptionManager) {
      perceptionManager.setMainWindow(mainWindow);
    }
    // Phase 1: 更新全局快捷键的主窗口引用
    if (globalShortcuts) {
      globalShortcuts.setMainWindow(mainWindow);
    }
  });
}

function showWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

// ── 启动 WS 后端 ──
function startBackend() {
  const backendScript = path.join(__dirname, '..', 'dist', 'start-ws.js');
  const tsScript = path.join(__dirname, '..', 'src', 'start-ws.ts');

  // 优先用编译产物，否则用 tsx 运行 TS
  const useCompiled = require('fs').existsSync(backendScript);

  try {
    if (useCompiled) {
      wsProcess = spawn('node', [backendScript], {
        cwd: path.join(__dirname, '..'),
        stdio: 'pipe',
        env: { ...process.env, WS_PORT: String(WS_PORT) },
      });
    } else {
      wsProcess = spawn('npx', ['tsx', tsScript], {
        cwd: path.join(__dirname, '..'),
        stdio: 'pipe',
        env: { ...process.env, WS_PORT: String(WS_PORT) },
      });
    }

    wsProcess.stdout?.on('data', (data) => {
      console.log(`[Backend] ${data.toString().trim()}`);
    });

    wsProcess.stderr?.on('data', (data) => {
      console.error(`[Backend ERR] ${data.toString().trim()}`);
    });

    wsProcess.on('close', (code) => {
      console.log(`[Backend] 进程退出，代码: ${code}`);
      wsProcess = null;
    });
  } catch (err) {
    console.error('[Backend] 启动失败:', err.message);
  }
}

// ── App 生命周期 ──
app.whenReady().then(() => {
  createTray();
  startBackend();

  // 创建浮窗
  floatingWindow = new FloatingWindow();
  floatingWindow.create();

  // 创建感知管理器
  perceptionManager = new PerceptionManager({ floatingWindow });
  perceptionManager.start();

  // Sprint 6: 自主行为
  autonomousBehavior = new AutonomousBehavior({
    floatingWindow,
    onBehavior: (event) => {
      // 推送行为事件到浮窗和主窗口
      if (floatingWindow?.window) {
        floatingWindow.window.webContents.send('behavior_event', event);
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('behavior_event', event);
      }
    },
  });
  autonomousBehavior.start();

  // Sprint 6: 窗口感知
  windowAwareness = new WindowAwareness({
    onWindowChange: (event) => {
      // 推送窗口感知事件
      if (floatingWindow?.window) {
        floatingWindow.window.webContents.send('window_awareness', event);
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('window_awareness', event);
      }
    },
  });
  windowAwareness.start();

  // Phase 1: 全局快捷键
  globalShortcuts = new GlobalShortcuts({
    mainWindow: null, // 窗口创建后更新
    onAction: (action) => {
      console.log(`[Main] 快捷键动作: ${action}`);
      if (floatingWindow?.window) {
        floatingWindow.window.webContents.send('shortcut_action', action);
      }
    },
  });
  globalShortcuts.registerAll();

  // Phase 1: 系统信息
  systemInfo = new SystemInfoCollector({
    onUpdate: (state) => {
      if (floatingWindow?.window) {
        floatingWindow.window.webContents.send('system_info', state);
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('system_info', state);
      }
    },
  });
  systemInfo.start();

  // Phase 1: 地理位置
  geolocationManager = new GeolocationManager({
    onLocation: (pos) => {
      if (floatingWindow?.window) {
        floatingWindow.window.webContents.send('geolocation', pos);
      }
    },
  });

  // Phase 1: 注册打印机和地理位置 IPC
  PrinterManager.registerIPC();
  GeolocationManager.registerIPC(geolocationManager);

  // Phase 2: USB/串口
  serialDevice = new SerialDeviceManager({
    onData: (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('serial_data', data);
      }
    },
    onDeviceList: (devices) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('serial_devices', devices);
      }
    },
  });
  SerialDeviceManager.registerIPC(serialDevice);

  // Phase 2: 蓝牙
  bluetoothManager = new BluetoothManager({
    onDevice: (device) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bluetooth_device_found', device);
      }
    },
  });
  BluetoothManager.registerIPC(bluetoothManager);

  // Phase 2: 屏幕标注
  screenOverlay = new ScreenOverlay({
    onAnnotation: (a) => console.log('[Overlay] 标注:', a),
  });
  screenOverlay.create();
  screenOverlay.hide(); // 默认隐藏

  // Phase 3: 系统音频捕获
  systemAudio = new SystemAudioCapture({
    onAudioData: (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('system_audio_frame', data);
      }
    },
    onError: (err) => console.error('[Main] 系统音频错误:', err.message),
  });
  SystemAudioCapture.registerIPC(systemAudio);

  // Phase 3: 媒体控制
  mediaControl = new MediaControl({
    onCommand: (cmd) => {
      console.log(`[Main] 媒体命令: ${cmd}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('media_command', cmd);
      }
    },
  });
  mediaControl.setup();
  MediaControl.registerIPC(mediaControl);

  // 延迟创建窗口（让托盘先出现）
  setTimeout(() => showWindow(), 500);
});

app.on('window-all-closed', () => {
  // macOS: 保持托盘运行
  if (process.platform !== 'darwin') {
    // 不退出，保持托盘
  }
});

app.on('activate', () => {
  showWindow();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('will-quit', () => {
  // 清理自主行为
  if (autonomousBehavior) {
    autonomousBehavior.destroy();
    autonomousBehavior = null;
  }
  // 清理窗口感知
  if (windowAwareness) {
    windowAwareness.destroy();
    windowAwareness = null;
  }
  // 清理感知管理器
  if (perceptionManager) {
    perceptionManager.destroy();
    perceptionManager = null;
  }
  // 清理浮窗
  if (floatingWindow) {
    floatingWindow.destroy();
    floatingWindow = null;
  }
  // Phase 1: 清理新模块
  if (globalShortcuts) {
    globalShortcuts.unregisterAll();
    globalShortcuts = null;
  }
  if (systemInfo) {
    systemInfo.destroy();
    systemInfo = null;
  }
  if (geolocationManager) {
    geolocationManager.destroy();
    geolocationManager = null;
  }
  if (serialDevice) {
    serialDevice.destroy();
    serialDevice = null;
  }
  if (bluetoothManager) {
    bluetoothManager.destroy();
    bluetoothManager = null;
  }
  if (screenOverlay) {
    screenOverlay.destroy();
    screenOverlay = null;
  }
  if (systemAudio) {
    systemAudio.destroy();
    systemAudio = null;
  }
  if (mediaControl) {
    mediaControl.destroy();
    mediaControl = null;
  }
  // 清理后端进程
  if (wsProcess) {
    wsProcess.kill();
    wsProcess = null;
  }
});

// ── 状态同步：主窗口 → 浮窗 ──
ipcMain.on('buddy_state_sync', (event, state) => {
  if (floatingWindow) {
    floatingWindow.updateState(state);
  }
});
