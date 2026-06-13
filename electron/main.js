/**
 * Electron 主进程 — Buddy 系统托盘应用
 *
 * 功能:
 * - 系统托盘常驻，点击打开控制窗口
 * - 后台自动启动 WebSocket 服务
 * - 内嵌前端界面（Vite 构建产物）
 * - 开机自启（可选）
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// ── 配置 ──
const WS_PORT = process.env.BUDDY_WS_PORT || 3001;
const FRONTEND_PORT = process.env.BUDDY_FRONTEND_PORT || 5173;
const IS_DEV = !app.isPackaged;

let mainWindow = null;
let tray = null;
let wsProcess = null;

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
  // 清理后端进程
  if (wsProcess) {
    wsProcess.kill();
    wsProcess = null;
  }
});
