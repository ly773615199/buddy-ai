/**
 * 蓝牙桥接模块（渲染进程）
 *
 * 封装 Web Bluetooth API，提供设备发现、GATT 连接、
 * 特征值读写和 LE 扫描能力。
 */

export interface BLEDevice {
  id: string;
  name: string | null;
  rssi: number | null;
  serviceUUIDs: string[];
  lastSeen: number;
}

export class BluetoothBridge {
  private _scanActive = false;

  /**
   * 检测当前环境是否支持 Web Bluetooth
   */
  static isAvailable(): boolean {
    return !!navigator.bluetooth;
  }

  /**
   * 请求用户选择一个蓝牙设备
   * filters 为空时接受所有设备
   */
  async requestDevice(filters?: BluetoothLEScanFilter[]): Promise<BluetoothDevice | null> {
    if (!BluetoothBridge.isAvailable()) {
      console.warn('[BluetoothBridge] Web Bluetooth 不可用');
      return null;
    }

    try {
      const options: RequestDeviceOptions = filters && filters.length > 0
        ? { filters }
        : { acceptAllDevices: true };

      const device = await navigator.bluetooth.requestDevice(options);
      return device;
    } catch (err) {
      if ((err as Error).name !== 'NotFoundError') {
        console.error('[BluetoothBridge] requestDevice 失败:', err);
      }
      return null;
    }
  }

  /**
   * 连接设备的 GATT 服务器
   */
  async connectGATT(device: BluetoothDevice): Promise<BluetoothRemoteGATTServer | null> {
    try {
      if (!device.gatt) {
        console.warn('[BluetoothBridge] 设备无 GATT 接口');
        return null;
      }

      const server = await device.gatt.connect();
      return server;
    } catch (err) {
      console.error('[BluetoothBridge] GATT 连接失败:', err);
      return null;
    }
  }

  /**
   * 读取特征值
   */
  async readCharacteristic(characteristic: BluetoothRemoteGATTCharacteristic): Promise<DataView | null> {
    try {
      const value = await characteristic.readValue();
      return value;
    } catch (err) {
      console.error('[BluetoothBridge] 读取特征值失败:', err);
      return null;
    }
  }

  /**
   * 写入特征值
   */
  async writeCharacteristic(
    characteristic: BluetoothRemoteGATTCharacteristic,
    value: BufferSource
  ): Promise<void> {
    try {
      await characteristic.writeValue(value);
    } catch (err) {
      console.error('[BluetoothBridge] 写入特征值失败:', err);
    }
  }

  /**
   * 开始 LE 扫描（需要 Web Bluetooth Scanning API 支持）
   */
  async startLEScan(options?: { filters?: BluetoothLEScanFilter[] }): Promise<void> {
    if (!BluetoothBridge.isAvailable()) {
      console.warn('[BluetoothBridge] Web Bluetooth 不可用');
      return;
    }

    try {
      const scanOptions: BluetoothLEScanOptions = {
        acceptAllAdvertisements: !options?.filters || options.filters.length === 0,
        ...(options?.filters && options.filters.length > 0 ? { filters: options.filters } : {}),
      };

      const scan = await (navigator.bluetooth as any).requestLEScan(scanOptions);
      this._scanActive = true;

      navigator.bluetooth.addEventListener('advertisementreceived', (event: any) => {
        console.log('[BluetoothBridge] 广播:', event);
      });

      console.log('[BluetoothBridge] LE 扫描已启动');
    } catch (err) {
      console.error('[BluetoothBridge] LE 扫描启动失败:', err);
    }
  }

  /**
   * 停止 LE 扫描
   */
  stopLEScan(): void {
    this._scanActive = false;
    console.log('[BluetoothBridge] LE 扫描已停止');
  }
}
