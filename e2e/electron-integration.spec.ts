/**
 * E2E: Electron 模块集成测试
 *
 * 验证 main.cjs 中引用的所有模块都能正确加载，
 * 且导出的 class 都是函数。
 */
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// ESM 中获取 CJS require
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ==================== Electron Mock ====================
// 覆盖所有被 main.cjs 子模块引用的 electron 子模块

function createElectronMock() {
  return {
    app: {
      getPath: () => '/tmp',
      getName: () => 'buddy-test',
      getVersion: () => '0.0.0',
      isReady: () => true,
      on: () => {},
      whenReady: () => Promise.resolve(),
    },
    BrowserWindow: class MockBrowserWindow {
      static getFocusedWindow() { return null; }
      static getAllWindows() { return []; }
      constructor() {}
      get webContents() {
        return {
          send: () => {},
          getPrintersAsync: () => Promise.resolve([]),
          on: () => {},
        };
      }
      isDestroyed() { return false; }
      on() {}
      show() {}
      hide() {}
      destroy() {}
      loadURL() {}
      loadFile() {}
      setIgnoreMouseEvents() {}
      setPosition() {}
      setSize() {}
      getBounds() { return { x: 0, y: 0, width: 800, height: 600 }; }
    },
    screen: {
      getPrimaryDisplay: () => ({
        workAreaSize: { width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      }),
      getAllDisplays: () => [],
      on: () => {},
    },
    ipcMain: {
      on: () => {},
      handle: () => {},
      removeHandler: () => {},
    },
    globalShortcut: {
      register: () => true,
      unregisterAll: () => {},
      isRegistered: () => false,
    },
    powerMonitor: {
      on: () => {},
    },
    Menu: {
      buildFromTemplate: () => ({}),
      setApplicationMenu: () => {},
    },
    nativeImage: {
      createFromDataURL: () => ({}),
      createFromBuffer: () => ({}),
    },
    Tray: class MockTray {
      setImage() {}
      setToolTip() {}
      setContextMenu() {}
      on() {}
      destroy() {}
    },
  };
}

/** 临时拦截 Module._load 以 mock electron，执行 fn 后恢复 */
async function withElectronMock<T>(fn: () => Promise<T> | T): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Module = require('module');
  const origLoad = Module._load;
  const electronMock = createElectronMock();

  Module._load = function (request: string, parent: any, isMain: boolean) {
    if (request === 'electron') {
      return electronMock;
    }
    return origLoad.call(this, request, parent, isMain);
  };

  try {
    return await fn();
  } finally {
    Module._load = origLoad;
  }
}

/** 动态 require 清除缓存后加载 */
function freshImport(modPath: string) {
  const resolved = require.resolve(modPath);
  delete require.cache[resolved];
  return require(resolved);
}

// ── 模块集成测试 ──

test.describe('Electron 模块集成', () => {
  test('main.cjs 中所有硬件模块可以被 require', async () => {
    await withElectronMock(() => {
      const modules = [
        '../electron/global-shortcuts.cjs',
        '../electron/system-info.cjs',
        '../electron/printer.cjs',
        '../electron/geolocation.cjs',
        '../electron/serial-device.cjs',
        '../electron/bluetooth.cjs',
        '../electron/screen-overlay.cjs',
        '../electron/system-audio.cjs',
        '../electron/media-control.cjs',
      ];

      for (const modPath of modules) {
        const mod = freshImport(path.resolve(__dirname, modPath));
        expect(Object.keys(mod).length).toBeGreaterThan(0);
      }
    });
  });

  test('main.cjs 中所有辅助模块可以被 require', async () => {
    await withElectronMock(() => {
      const modules = [
        '../electron/floating-window.cjs',
        '../electron/perception-manager.cjs',
        '../electron/autonomous-behavior.cjs',
        '../electron/window-awareness.cjs',
      ];

      for (const modPath of modules) {
        const mod = freshImport(path.resolve(__dirname, modPath));
        expect(Object.keys(mod).length).toBeGreaterThan(0);
      }
    });
  });

  test('所有硬件模块导出的 class 都是函数', async () => {
    await withElectronMock(() => {
      const expected = [
        { path: '../electron/global-shortcuts.cjs', name: 'GlobalShortcuts' },
        { path: '../electron/system-info.cjs', name: 'SystemInfoCollector' },
        { path: '../electron/printer.cjs', name: 'PrinterManager' },
        { path: '../electron/geolocation.cjs', name: 'GeolocationManager' },
        { path: '../electron/serial-device.cjs', name: 'SerialDeviceManager' },
        { path: '../electron/bluetooth.cjs', name: 'BluetoothManager' },
        { path: '../electron/screen-overlay.cjs', name: 'ScreenOverlay' },
        { path: '../electron/system-audio.cjs', name: 'SystemAudioCapture' },
        { path: '../electron/media-control.cjs', name: 'MediaControl' },
      ];

      for (const { path: modPath, name } of expected) {
        const mod = freshImport(path.resolve(__dirname, modPath));
        expect(typeof mod[name]).toBe('function');
      }
    });
  });

  test('所有辅助模块导出的 class 都是函数', async () => {
    await withElectronMock(() => {
      const expected = [
        { path: '../electron/floating-window.cjs', name: 'FloatingWindow' },
        { path: '../electron/perception-manager.cjs', name: 'PerceptionManager' },
        { path: '../electron/autonomous-behavior.cjs', name: 'AutonomousBehavior' },
        { path: '../electron/window-awareness.cjs', name: 'WindowAwareness' },
      ];

      for (const { path: modPath, name } of expected) {
        const mod = freshImport(path.resolve(__dirname, modPath));
        expect(typeof mod[name]).toBe('function');
      }
    });
  });
});
