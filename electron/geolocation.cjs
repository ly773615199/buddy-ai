/**
 * 地理位置管理模块
 *
 * 优先通过渲染进程的 navigator.geolocation 获取 GPS/WiFi 定位，
 * 失败时回退到 IP 定位。支持缓存最近一次位置。
 */

const https = require('https');
const { ipcMain } = require('electron');

class GeolocationManager {
  constructor(options = {}) {
    this.onLocation = options.onLocation || (() => {});
    this._lastKnown = null;
    this._win = options.win || null;
  }

  /**
   * 获取当前位置
   * 1. 优先通过渲染进程 navigator.geolocation
   * 2. 回退到 IP 定位
   * 3. 都失败返回 { error }
   */
  async getCurrentPosition() {
    // 方案一：渲染进程 GPS/WiFi 定位
    try {
      const pos = await this._getFromRenderer();
      this._lastKnown = { ...pos, source: 'renderer', timestamp: Date.now() };
      this.onLocation(this._lastKnown);
      return this._lastKnown;
    } catch (err) {
      console.warn('[GeolocationManager] 渲染进程定位失败，回退到 IP:', err.message);
    }

    // 方案二：IP 定位 fallback
    try {
      const pos = await this._getFromIP();
      this._lastKnown = { ...pos, source: 'ip', accuracy: 10000, timestamp: Date.now() };
      this.onLocation(this._lastKnown);
      return this._lastKnown;
    } catch (err) {
      console.warn('[GeolocationManager] IP 定位失败:', err.message);
    }

    return { error: '无法获取位置信息' };
  }

  /**
   * 通过渲染进程的 navigator.geolocation.getCurrentPosition 获取定位
   * 超时 10 秒
   */
  async _getFromRenderer() {
    if (!this._win || this._win.isDestroyed()) {
      throw new Error('无可用的 BrowserWindow');
    }

    const js = `
      new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          return reject(new Error('geolocation API 不可用'));
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            altitude: pos.coords.altitude,
          }),
          (err) => reject(new Error(err.message || '定位失败')),
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
        );
      })
    `;

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('渲染进程定位超时 (10s)')), 10000);
    });

    return Promise.race([
      this._win.webContents.executeJavaScript(js),
      timeoutPromise,
    ]);
  }

  /**
   * 通过 IP 地址获取大致位置
   */
  _getFromIP() {
    return new Promise((resolve, reject) => {
      const req = https.get('https://ipapi.co/json/', { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.latitude && json.longitude) {
              resolve({
                latitude: json.latitude,
                longitude: json.longitude,
                city: json.city || '',
                country: json.country_name || '',
              });
            } else {
              reject(new Error('IP 定位返回数据无效'));
            }
          } catch (e) {
            reject(new Error('IP 定位 JSON 解析失败'));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('IP 定位请求超时'));
      });
    });
  }

  /** 最近一次缓存的位置 */
  get lastKnown() {
    return this._lastKnown;
  }

  /**
   * 注册 IPC handler，供渲染进程调用
   * - geolocation_get: 获取当前位置
   * - geolocation_last: 获取缓存位置
   */
  static registerIPC(manager) {
    ipcMain.handle('geolocation_get', async () => {
      return manager.getCurrentPosition();
    });

    ipcMain.handle('geolocation_last', () => {
      return manager.lastKnown;
    });
  }

  destroy() {
    this._lastKnown = null;
    this._win = null;
    console.log('[GeolocationManager] 已销毁');
  }
}

module.exports = { GeolocationManager };
