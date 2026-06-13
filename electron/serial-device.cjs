/**
 * Sprint ?: USB/串口设备管理
 *
 * 管理串口设备的发现、连接与通信。
 * serialport 是可选依赖，不存在时优雅降级。
 */

const { ipcMain } = require('electron');

let SerialPort, ReadlineParser;
try {
  ({ SerialPort } = require('serialport'));
  ({ ReadlineParser } = require('@serialport/parser-readline'));
} catch (_e) {
  // serialport 未安装，功能降级
}

class SerialDeviceManager {
  constructor(options = {}) {
    this.onData = options.onData || (() => {});
    this.onDeviceList = options.onDeviceList || (() => {});
    this.onConnect = options.onConnect || (() => {});
    this.onDisconnect = options.onDisconnect || (() => {});

    this._port = null;
    this._parser = null;
    this._connected = false;
  }

  /**
   * 列出可用串口设备
   * @returns {Promise<Array<{ path, manufacturer, serialNumber, vendorId, productId }>>}
   */
  async listDevices() {
    if (!SerialPort) {
      console.warn('[SerialDeviceManager] serialport 模块未安装，返回空列表');
      return [];
    }
    try {
      const devices = await SerialPort.list();
      const mapped = devices.map(d => ({
        path: d.path,
        manufacturer: d.manufacturer || '',
        serialNumber: d.serialNumber || '',
        vendorId: d.vendorId || '',
        productId: d.productId || '',
      }));
      this.onDeviceList(mapped);
      return mapped;
    } catch (err) {
      console.error('[SerialDeviceManager] 列举设备失败:', err.message);
      return [];
    }
  }

  /**
   * 连接到串口设备
   * @param {Object} options
   * @param {string} options.path - 串口路径
   * @param {number} [options.baudRate=9600]
   * @param {number} [options.dataBits=8]
   * @param {number} [options.stopBits=1]
   * @param {string} [options.parity='none']
   */
  async connect(options = {}) {
    if (!SerialPort) {
      throw new Error('serialport 模块未安装，无法连接');
    }
    if (this._connected) {
      this.disconnect();
    }

    const portPath = options.path;
    if (!portPath) {
      throw new Error('缺少串口路径 (options.path)');
    }

    return new Promise((resolve, reject) => {
      try {
        this._port = new SerialPort({
          path: portPath,
          baudRate: options.baudRate || 9600,
          dataBits: options.dataBits || 8,
          stopBits: options.stopBits || 1,
          parity: options.parity || 'none',
        });

        this._parser = this._port.pipe(new ReadlineParser({ delimiter: '\n' }));

        this._port.on('open', () => {
          this._connected = true;
          console.log(`[SerialDeviceManager] 已连接: ${portPath}`);
          this.onConnect({ path: portPath });
          resolve();
        });

        this._parser.on('data', (data) => {
          const line = data.toString().trim();
          if (line) {
            this.onData(line);
          }
        });

        this._port.on('error', (err) => {
          console.error('[SerialDeviceManager] 串口错误:', err.message);
          this._connected = false;
          reject(err);
        });

        this._port.on('close', () => {
          this._connected = false;
          console.log('[SerialDeviceManager] 串口已断开');
          this.onDisconnect();
        });
      } catch (err) {
        this._connected = false;
        reject(err);
      }
    });
  }

  /**
   * 发送数据到串口
   * @param {string} data
   */
  async send(data) {
    if (!this._port || !this._connected) {
      throw new Error('串口未连接');
    }
    return new Promise((resolve, reject) => {
      this._port.write(data + '\n', (err) => {
        if (err) {
          reject(err);
        } else {
          this._port.drain(resolve);
        }
      });
    });
  }

  /**
   * 断开串口连接
   */
  disconnect() {
    if (this._port) {
      try {
        this._port.close();
      } catch (_e) {
        // 忽略关闭时的错误
      }
      this._port = null;
      this._parser = null;
      this._connected = false;
    }
  }

  /**
   * 当前是否已连接
   */
  get connected() {
    return this._connected;
  }

  /**
   * 注册 IPC handler
   * @param {Object} manager - IPCManager 实例
   */
  static registerIPC(manager) {
    const instance = new SerialDeviceManager();

    manager.handle('serial_list', async () => {
      return instance.listDevices();
    });

    manager.handle('serial_connect', async (_event, options) => {
      await instance.connect(options);
      return { success: true };
    });

    manager.handle('serial_send', async (_event, data) => {
      await instance.send(data);
      return { success: true };
    });

    manager.handle('serial_disconnect', async () => {
      instance.disconnect();
      return { success: true };
    });

    return instance;
  }

  /**
   * 销毁实例，释放资源
   */
  destroy() {
    this.disconnect();
  }
}

module.exports = { SerialDeviceManager };
