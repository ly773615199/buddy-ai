/**
 * Sprint 5 D4: 网络感知
 *
 * 监听网络状态变化驱动光灵反应：
 * - 网断了 → 光灵"被困住了"，粒子被框住
 * - 网速慢 → 光灵移动变慢
 * - 连上 VPN → 光灵"换了个地方"
 */

const { net } = require('electron');
const os = require('os');
const dns = require('dns');
const { execSync } = require('child_process');

class NetworkAwareness {
  constructor(options = {}) {
    this.checkIntervalMs = options.checkIntervalMs || 5000;
    this.onNetworkChange = options.onNetworkChange || (() => {});
    this.testHosts = options.testHosts || ['github.com', 'baidu.com', 'google.com'];

    this._timer = null;
    this._isRunning = false;
    this._currentState = {
      online: true,
      latencyMs: 0,
      connectionType: 'unknown',
      vpnActive: false,
      previousState: null,
    };
  }

  start() {
    if (this._isRunning) return;
    this._isRunning = true;
    this._check();
    this._timer = setInterval(() => this._check(), this.checkIntervalMs);
    console.log('[NetworkAwareness] 已启动');
  }

  stop() {
    this._isRunning = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  _check() {
    const prevState = { ...this._currentState };

    // DNS 解析测试（最快判断网络是否通）
    this._testDNS()
      .then(latency => {
        const online = latency > 0;
        const connectionType = this._detectConnectionType();
        const vpnActive = this._detectVPN();

        const newState = {
          online,
          latencyMs: latency,
          connectionType,
          vpnActive,
          speed: this._classifySpeed(latency),
          previousState: prevState.online !== online ? prevState : prevState.previousState,
        };

        // 状态变化时触发回调
        if (newState.online !== prevState.online ||
            newState.vpnActive !== prevState.vpnActive ||
            newState.speed !== prevState.speed) {
          const reaction = this._getReaction(newState, prevState);
          this.onNetworkChange({ ...newState, ...reaction });
        }

        this._currentState = newState;
      })
      .catch(() => {
        if (this._currentState.online) {
          this._currentState = {
            ...this._currentState,
            online: false,
            previousState: prevState,
          };
          this.onNetworkChange({
            ...this._currentState,
            reaction: 'trapped',
            mood: 'anxious',
            description: '网络断开了',
            particleEffect: 'cage', // 粒子被框住
          });
        }
      });
  }

  _testDNS() {
    return new Promise((resolve) => {
      const start = Date.now();
      const host = this.testHosts[Math.floor(Math.random() * this.testHosts.length)];
      dns.resolve(host, (err) => {
        if (err) resolve(0);
        else resolve(Date.now() - start);
      });
    });
  }

  _detectConnectionType() {
    try {
      const interfaces = os.networkInterfaces();
      for (const [name, addrs] of Object.entries(interfaces)) {
        if (!addrs || name.includes('lo')) continue;
        if (name.includes('en0') || name.includes('eth') || name.includes('Ethernet')) return 'ethernet';
        if (name.includes('wlan') || name.includes('Wi-Fi') || name.includes('wifi')) return 'wifi';
        if (name.includes('utun') || name.includes('tun') || name.includes('ppp')) return 'vpn';
      }
    } catch { /* ignore */ }
    return 'unknown';
  }

  _detectVPN() {
    try {
      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        if (/utun|tun|ppp|wg|tap/i.test(name)) return true;
      }
      // Linux: check routing table
      if (process.platform === 'linux') {
        const result = execSync('ip route show default 2>/dev/null', { encoding: 'utf-8', timeout: 2000 });
        if (result.includes('tun') || result.includes('wg')) return true;
      }
    } catch { /* ignore */ }
    return false;
  }

  _classifySpeed(latencyMs) {
    if (latencyMs === 0) return 'offline';
    if (latencyMs < 50) return 'fast';
    if (latencyMs < 200) return 'normal';
    if (latencyMs < 500) return 'slow';
    return 'very_slow';
  }

  _getReaction(newState, prevState) {
    // 网断了
    if (!newState.online && prevState.online) {
      return {
        reaction: 'trapped',
        mood: 'anxious',
        description: '网络断开了',
        particleEffect: 'cage',
        particleSpeedMul: 0.3,
      };
    }

    // 网恢复了
    if (newState.online && !prevState.online) {
      return {
        reaction: 'relieved',
        mood: 'happy',
        description: '网络恢复了',
        particleEffect: 'burst',
        particleSpeedMul: 1.5,
      };
    }

    // VPN 连接
    if (newState.vpnActive && !prevState.vpnActive) {
      return {
        reaction: 'curious',
        mood: 'curious',
        description: '检测到 VPN',
        particleEffect: 'warp',
        particleSpeedMul: 1.0,
      };
    }

    // VPN 断开
    if (!newState.vpnActive && prevState.vpnActive) {
      return {
        reaction: 'noticing',
        mood: 'neutral',
        description: 'VPN 断开了',
        particleEffect: 'normal',
        particleSpeedMul: 1.0,
      };
    }

    // 网速变慢
    if (newState.speed === 'slow' || newState.speed === 'very_slow') {
      return {
        reaction: 'sluggish',
        mood: 'tired',
        description: `网速较慢 (${newState.latencyMs}ms)`,
        particleEffect: 'slow',
        particleSpeedMul: 0.5,
      };
    }

    return {
      reaction: 'neutral',
      mood: 'neutral',
      description: '网络正常',
      particleEffect: 'normal',
      particleSpeedMul: 1.0,
    };
  }

  destroy() {
    this.stop();
  }
}

module.exports = { NetworkAwareness };
