/**
 * E2E: Electron 主进程硬件模块测试
 *
 * 测试策略：
 * - 通过 Module._load 拦截 mock electron 模块
 * - 对纯逻辑部分直接测试
 * - 对依赖 BrowserWindow/IPC 的部分用 mock 或跳过
 */
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// ESM 中获取 CJS require
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ==================== Electron Mock 工厂 ====================

function createElectronMock() {
  const mockRegistered = new Set<string>();

  const mockGlobalShortcut = {
    register: (accelerator: string, _callback: () => void) => {
      mockRegistered.add(accelerator);
      return true;
    },
    unregisterAll: () => {
      mockRegistered.clear();
    },
    isRegistered: (accelerator: string) => mockRegistered.has(accelerator),
  };

  const mockIpcMain = {
    on: () => {},
    handle: () => {},
    removeHandler: () => {},
  };

  const mockBrowserWindow = {
    getFocusedWindow: () => null,
    getAllWindows: () => [],
  };

  const mockScreen = {
    getPrimaryDisplay: () => ({
      workAreaSize: { width: 1920, height: 1080 },
    }),
  };

  const mockPowerMonitor = {
    on: () => {},
  };

  return {
    globalShortcut: mockGlobalShortcut,
    ipcMain: mockIpcMain,
    BrowserWindow: mockBrowserWindow,
    screen: mockScreen,
    powerMonitor: mockPowerMonitor,
    _mockRegistered: mockRegistered,
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

// ── 全局快捷键 ──

test.describe('GlobalShortcuts', () => {
  test('模块可以被 require', async () => {
    await withElectronMock(() => {
      const mod = freshImport(path.resolve(__dirname, '../electron/global-shortcuts.cjs'));
      expect(mod.GlobalShortcuts).toBeDefined();
      expect(typeof mod.GlobalShortcuts).toBe('function');
    });
  });

  test('getStatus 返回正确结构', async () => {
    await withElectronMock(() => {
      const { GlobalShortcuts } = freshImport(path.resolve(__dirname, '../electron/global-shortcuts.cjs'));
      const gs = new GlobalShortcuts({
        onAction: () => {},
        mainWindow: null,
      });

      const status = gs.getStatus();
      expect(typeof status).toBe('object');
      expect(status.platform).toBe(process.platform);
      expect(typeof status.modifier).toBe('string');
      expect(Array.isArray(status.registered)).toBe(true);
      expect(typeof status.total).toBe('number');
      expect(status.total).toBe(5);
      expect(status.registered.length).toBe(0);
      expect(status.pushToTalkActive).toBe(false);
    });
  });

  test('registerAll 后 registered 数量正确', async () => {
    await withElectronMock(() => {
      const { GlobalShortcuts } = freshImport(path.resolve(__dirname, '../electron/global-shortcuts.cjs'));
      const gs = new GlobalShortcuts({ onAction: () => {}, mainWindow: null });
      gs.registerAll();

      const status = gs.getStatus();
      expect(status.registered.length).toBe(5);

      gs.unregisterAll();
      const status2 = gs.getStatus();
      expect(status2.registered.length).toBe(0);
    });
  });

  test('onAction 回调正常工作', async () => {
    await withElectronMock(() => {
      const actions: string[] = [];
      const { GlobalShortcuts } = freshImport(path.resolve(__dirname, '../electron/global-shortcuts.cjs'));
      const gs = new GlobalShortcuts({
        onAction: (action: string) => actions.push(action),
        mainWindow: null,
      });

      gs.onAction('test_action');
      expect(actions).toContain('test_action');
    });
  });
});

// ── 系统信息 ──

test.describe('SystemInfoCollector', () => {
  test('模块可以被 require', async () => {
    await withElectronMock(() => {
      const mod = freshImport(path.resolve(__dirname, '../electron/system-info.cjs'));
      expect(mod.SystemInfoCollector).toBeDefined();
      expect(typeof mod.SystemInfoCollector).toBe('function');
    });
  });

  test('实例化后未启动状态', async () => {
    await withElectronMock(() => {
      const { SystemInfoCollector } = freshImport(path.resolve(__dirname, '../electron/system-info.cjs'));
      const collector = new SystemInfoCollector();

      expect(collector._isRunning).toBe(false);
      expect(collector._fastTimer).toBeNull();
      expect(collector._slowTimer).toBeNull();
    });
  });

  test('getState 返回合理结构', async () => {
    await withElectronMock(() => {
      const { SystemInfoCollector } = freshImport(path.resolve(__dirname, '../electron/system-info.cjs'));
      const collector = new SystemInfoCollector();

      const state = collector._state;
      expect(state).toBeDefined();
      expect(state.cpu).toBeDefined();
      expect(typeof state.cpu.percent).toBe('number');
      expect(state.memory).toBeDefined();
      expect(typeof state.memory.total).toBe('number');
      expect(state.load).toBeDefined();
      expect(typeof state.load.m1).toBe('number');
      expect(state.timestamp).toBeDefined();
    });
  });
});

// ── 打印机 ──

test.describe('PrinterManager', () => {
  test('模块可以被 require，静态方法存在', async () => {
    await withElectronMock(() => {
      const mod = freshImport(path.resolve(__dirname, '../electron/printer.cjs'));
      expect(mod.PrinterManager).toBeDefined();
      expect(typeof mod.PrinterManager).toBe('function');
      expect(typeof mod.PrinterManager.listPrinters).toBe('function');
      expect(typeof mod.PrinterManager.print).toBe('function');
      expect(typeof mod.PrinterManager.exportPDF).toBe('function');
      expect(typeof mod.PrinterManager.registerIPC).toBe('function');
    });
  });
});

// ── 地理位置 ──

test.describe('GeolocationManager', () => {
  test('模块可以被 require', async () => {
    await withElectronMock(() => {
      const mod = freshImport(path.resolve(__dirname, '../electron/geolocation.cjs'));
      expect(mod.GeolocationManager).toBeDefined();
      expect(typeof mod.GeolocationManager).toBe('function');
    });
  });

  test('实例化后 _lastKnown 为 null', async () => {
    await withElectronMock(() => {
      const { GeolocationManager } = freshImport(path.resolve(__dirname, '../electron/geolocation.cjs'));
      const geo = new GeolocationManager();
      expect(geo._lastKnown).toBeNull();
    });
  });
});

// ── USB/串口 ──

test.describe('SerialDeviceManager', () => {
  test('模块可以被 require（无 serialport 时优雅降级）', async () => {
    await withElectronMock(() => {
      const mod = freshImport(path.resolve(__dirname, '../electron/serial-device.cjs'));
      expect(mod.SerialDeviceManager).toBeDefined();
      expect(typeof mod.SerialDeviceManager).toBe('function');
    });
  });

  test('实例化后未连接', async () => {
    await withElectronMock(() => {
      const { SerialDeviceManager } = freshImport(path.resolve(__dirname, '../electron/serial-device.cjs'));
      const sm = new SerialDeviceManager();
      expect(sm._connected).toBe(false);
      expect(sm._port).toBeNull();
    });
  });

  test('listDevices 在无 serialport 时返回空数组', async () => {
    await withElectronMock(async () => {
      const { SerialDeviceManager } = freshImport(path.resolve(__dirname, '../electron/serial-device.cjs'));
      const sm = new SerialDeviceManager();
      const devices = await sm.listDevices();
      expect(Array.isArray(devices)).toBe(true);
      expect(devices.length).toBe(0);
    });
  });
});

// ── 蓝牙 ──

test.describe('BluetoothManager', () => {
  test('模块可以被 require', async () => {
    await withElectronMock(() => {
      const mod = freshImport(path.resolve(__dirname, '../electron/bluetooth.cjs'));
      expect(mod.BluetoothManager).toBeDefined();
      expect(typeof mod.BluetoothManager).toBe('function');
    });
  });

  test('初始状态未在扫描', async () => {
    await withElectronMock(() => {
      const { BluetoothManager } = freshImport(path.resolve(__dirname, '../electron/bluetooth.cjs'));
      const bt = new BluetoothManager();
      expect(bt._isScanning).toBe(false);
    });
  });

  test('getDevices 初始为空', async () => {
    await withElectronMock(() => {
      const { BluetoothManager } = freshImport(path.resolve(__dirname, '../electron/bluetooth.cjs'));
      const bt = new BluetoothManager();
      expect(bt._devices.size).toBe(0);
    });
  });
});

// ── 屏幕标注 ──

test.describe('ScreenOverlay', () => {
  test('模块可以被 require', async () => {
    await withElectronMock(() => {
      const mod = freshImport(path.resolve(__dirname, '../electron/screen-overlay.cjs'));
      expect(mod.ScreenOverlay).toBeDefined();
      expect(typeof mod.ScreenOverlay).toBe('function');
    });
  });

  test('实例化后初始状态正确', async () => {
    await withElectronMock(() => {
      const { ScreenOverlay } = freshImport(path.resolve(__dirname, '../electron/screen-overlay.cjs'));
      const overlay = new ScreenOverlay();
      expect(overlay.window).toBeNull();
      expect(overlay.isVisible).toBe(false);
      expect(overlay._isDrawing).toBe(false);
    });
  });
});

// ── 系统音频 ──

test.describe('SystemAudioCapture', () => {
  test('模块可以被 require', async () => {
    await withElectronMock(() => {
      const mod = freshImport(path.resolve(__dirname, '../electron/system-audio.cjs'));
      expect(mod.SystemAudioCapture).toBeDefined();
      expect(typeof mod.SystemAudioCapture).toBe('function');
    });
  });

  test('初始状态未在捕获', async () => {
    await withElectronMock(() => {
      const { SystemAudioCapture } = freshImport(path.resolve(__dirname, '../electron/system-audio.cjs'));
      const capture = new SystemAudioCapture();
      expect(capture.active).toBe(false);
      expect(capture._active).toBe(false);
      expect(capture._ffmpeg).toBeNull();
    });
  });

  test('sampleRate 默认值正确', async () => {
    await withElectronMock(() => {
      const { SystemAudioCapture } = freshImport(path.resolve(__dirname, '../electron/system-audio.cjs'));
      const capture = new SystemAudioCapture();
      expect(capture.sampleRate).toBe(16000);
    });
  });
});

// ── 媒体控制 ──

test.describe('MediaControl', () => {
  test('模块可以被 require', async () => {
    await withElectronMock(() => {
      const mod = freshImport(path.resolve(__dirname, '../electron/media-control.cjs'));
      expect(mod.MediaControl).toBeDefined();
      expect(typeof mod.MediaControl).toBe('function');
    });
  });

  test('实例化后未 setup', async () => {
    await withElectronMock(() => {
      const { MediaControl } = freshImport(path.resolve(__dirname, '../electron/media-control.cjs'));
      const mc = new MediaControl();
      expect(mc._isSetup).toBe(false);
      expect(mc._currentInfo).toBeNull();
    });
  });

  test('_platform 反映当前系统', async () => {
    await withElectronMock(() => {
      const { MediaControl } = freshImport(path.resolve(__dirname, '../electron/media-control.cjs'));
      const mc = new MediaControl();
      expect(mc._platform).toBe(process.platform);
    });
  });
});
