/**
 * 蓝牙设备管理模块
 *
 * 通过 Electron 的 Web Bluetooth API（渲染进程）扫描和管理 BLE 设备，
 * 主进程通过 IPC 协调设备发现与管理。
 */

const { ipcMain, BrowserWindow } = require('electron');

class BluetoothManager {
  constructor(options = {}) {
    this.onDevice = options.onDevice || (() => {});
    this.onScanStart = options.onScanStart || (() => {});
    this.onScanStop = options.onScanStop || (() => {});

    this._devices = new Map();
    this._isScanning = false;
    this._win = options.win || null;
  }

  /**
   * 开始扫描蓝牙设备
   * 通过 IPC 通知渲染进程发起 Web Bluetooth 扫描
   */
  async startScan(options = {}) {
    if (this._isScanning) return;
    this._isScanning = true;
    this.onScanStart();

    // 通知渲染进程开始扫描
    if (this._win && !this._win.isDestroyed()) {
      try {
        this._win.webContents.send('bluetooth_scan_start', options);
      } catch (err) {
        console.warn('[BluetoothManager] 通知渲染进程失败:', err.message);
      }
    }

    console.log('[BluetoothManager] 扫描已启动');
  }

  /**
   * 停止扫描
   */
  stopScan() {
    if (!this._isScanning) return;
    this._isScanning = false;
    this.onScanStop();

    if (this._win && !this._win.isDestroyed()) {
      try {
        this._win.webContents.send('bluetooth_scan_stop');
      } catch (err) {
        console.warn('[BluetoothManager] 通知渲染进程停止失败:', err.message);
      }
    }

    console.log('[BluetoothManager] 扫描已停止');
  }

  /**
   * 获取已发现设备列表
   */
  getDevices() {
    return Array.from(this._devices.values());
  }

  /**
   * 添加设备到已发现列表
   */
  addDevice(device) {
    const entry = {
      id: device.id,
      name: device.name || null,
      rssi: device.rssi ?? null,
      serviceUUIDs: device.serviceUUIDs || [],
      lastSeen: device.lastSeen || Date.now(),
    };

    const existing = this._devices.get(entry.id);
    if (existing) {
      // 更新已有设备信息
      Object.assign(existing, entry);
    } else {
      this._devices.set(entry.id, entry);
      this.onDevice(entry);
    }

    return entry;
  }

  /**
   * 移除设备
   */
  removeDevice(id) {
    return this._devices.delete(id);
  }

  /**
   * 是否正在扫描
   */
  get isScanning() {
    return this._isScanning;
  }

  /**
   * 注册 IPC handler，供渲染进程调用
   * - bluetooth_start_scan: 开始扫描
   * - bluetooth_stop_scan: 停止扫描
   * - bluetooth_get_devices: 获取设备列表
   * - bluetooth_device_found: 渲染进程上报发现的设备
   */
  static registerIPC(manager) {
    ipcMain.handle('bluetooth_start_scan', async (_event, options) => {
      return manager.startScan(options);
    });

    ipcMain.handle('bluetooth_stop_scan', () => {
      manager.stopScan();
    });

    ipcMain.handle('bluetooth_get_devices', () => {
      return manager.getDevices();
    });

    ipcMain.on('bluetooth_device_found', (_event, device) => {
      manager.addDevice(device);
    });
  }

  /**
   * 销毁管理器
   */
  destroy() {
    this.stopScan();
    this._devices.clear();
    this._win = null;
    console.log('[BluetoothManager] 已销毁');
  }
}

module.exports = { BluetoothManager };
