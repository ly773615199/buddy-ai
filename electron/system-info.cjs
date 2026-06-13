/**
 * 系统信息采集模块
 *
 * 定时采集 CPU、内存、负载、磁盘、GPU、进程数、电池等系统信息，
 * 通过 onUpdate 回调推送状态更新。
 */

const os = require('os');
const { execSync } = require('child_process');
const { powerMonitor } = require('electron');

class SystemInfoCollector {
  constructor(options = {}) {
    this.onUpdate = options.onUpdate || (() => {});
    this.fastIntervalMs = options.fastIntervalMs || 5000;
    this.slowIntervalMs = options.slowIntervalMs || 30000;

    this._fastTimer = null;
    this._slowTimer = null;
    this._isRunning = false;

    // CPU 采样缓存（用于计算差值）
    this._prevCpuInfo = null;

    // 状态
    this._state = {
      cpu: { percent: 0 },
      memory: { total: 0, used: 0, free: 0, percent: 0 },
      load: { m1: 0, m5: 0, m15: 0 },
      uptime: 0,
      disk: { total: 0, used: 0, available: 0, percent: 0, mount: '/' },
      gpu: { name: 'N/A', memory: 'N/A', utilization: 'N/A' },
      processCount: 0,
      battery: { charging: false },
      timestamp: Date.now(),
    };

    this._setupBattery();
  }

  // ==================== 生命周期 ====================

  start() {
    if (this._isRunning) return;
    this._isRunning = true;

    // 立即采集一次
    this._collectFast();
    this._collectSlow();

    this._fastTimer = setInterval(() => this._collectFast(), this.fastIntervalMs);
    this._slowTimer = setInterval(() => this._collectSlow(), this.slowIntervalMs);

    console.log('[SystemInfoCollector] 已启动，fast=%dms slow=%dms', this.fastIntervalMs, this.slowIntervalMs);
  }

  stop() {
    this._isRunning = false;
    if (this._fastTimer) {
      clearInterval(this._fastTimer);
      this._fastTimer = null;
    }
    if (this._slowTimer) {
      clearInterval(this._slowTimer);
      this._slowTimer = null;
    }
    console.log('[SystemInfoCollector] 已停止');
  }

  getStatus() {
    return {
      running: this._isRunning,
      ...this._state,
    };
  }

  destroy() {
    this.stop();
    this._prevCpuInfo = null;
  }

  // ==================== 快速采集（CPU/内存/负载/uptime） ====================

  _collectFast() {
    try {
      // CPU 使用率：对比两次采样的 idle/total 差值
      const cpus = os.cpus();
      const currentInfo = { idle: 0, total: 0 };
      for (const cpu of cpus) {
        currentInfo.idle += cpu.times.idle;
        currentInfo.total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle;
      }

      if (this._prevCpuInfo) {
        const idleDelta = currentInfo.idle - this._prevCpuInfo.idle;
        const totalDelta = currentInfo.total - this._prevCpuInfo.total;
        this._state.cpu.percent = totalDelta > 0
          ? Math.round((1 - idleDelta / totalDelta) * 10000) / 100
          : 0;
      }
      this._prevCpuInfo = currentInfo;

      // 内存
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      this._state.memory = {
        total: Math.round((totalMem / 1073741824) * 100) / 100,
        used: Math.round((usedMem / 1073741824) * 100) / 100,
        free: Math.round((freeMem / 1073741824) * 100) / 100,
        percent: Math.round((usedMem / totalMem) * 10000) / 100,
      };

      // 系统负载
      const load = os.loadavg();
      this._state.load = {
        m1: Math.round(load[0] * 100) / 100,
        m5: Math.round(load[1] * 100) / 100,
        m15: Math.round(load[2] * 100) / 100,
      };

      // uptime
      this._state.uptime = os.uptime();

      this._state.timestamp = Date.now();
      this.onUpdate(this._state);
    } catch (err) {
      console.error('[SystemInfoCollector] _collectFast error:', err.message);
    }
  }

  // ==================== 慢速采集（磁盘/GPU/进程数） ====================

  _collectSlow() {
    try {
      this._collectDisk();
      this._collectGpu();
      this._collectProcessCount();

      this._state.timestamp = Date.now();
      this.onUpdate(this._state);
    } catch (err) {
      console.error('[SystemInfoCollector] _collectSlow error:', err.message);
    }
  }

  _collectDisk() {
    const platform = os.platform();
    try {
      let output;
      if (platform === 'darwin') {
        output = execSync('df -g /', { encoding: 'utf8', timeout: 5000 });
      } else if (platform === 'linux') {
        output = execSync('df -BG /', { encoding: 'utf8', timeout: 5000 });
      } else if (platform === 'win32') {
        output = execSync(
          'wmic logicaldisk where "DeviceID=\'C:\'" get FreeSpace,Size /format:csv',
          { encoding: 'utf8', timeout: 5000 }
        );
      } else {
        return;
      }

      const lines = output.trim().split('\n');

      if (platform === 'darwin' || platform === 'linux') {
        // df 输出第二行：Filesystem 1G-blocks Used Available Capacity Mounted
        const parts = lines[1].trim().split(/\s+/);
        const sizeKey = platform === 'darwin' ? 1 : 1; // 1G-blocks / 1G-blocks
        const total = parseInt(parts[sizeKey], 10);
        const used = parseInt(parts[2], 10);
        const available = parseInt(parts[3], 10);
        const percentStr = parts[4]; // "45%"
        const percent = parseInt(percentStr, 10);

        this._state.disk = { total, used, available, percent: isNaN(percent) ? 0 : percent, mount: '/' };
      } else if (platform === 'win32') {
        // CSV 输出：Node,FreeSpace,Size
        const dataLine = lines.find((l) => l.includes(','));
        if (dataLine) {
          const parts = dataLine.split(',');
          const size = parseInt(parts[2], 10) || 0;
          const free = parseInt(parts[1], 10) || 0;
          const used = size - free;
          const totalGB = Math.round(size / 1073741824);
          const usedGB = Math.round(used / 1073741824);
          const freeGB = Math.round(free / 1073741824);
          const percent = totalGB > 0 ? Math.round((usedGB / totalGB) * 100) : 0;
          this._state.disk = { total: totalGB, used: usedGB, available: freeGB, percent, mount: 'C:' };
        }
      }
    } catch (err) {
      console.error('[SystemInfoCollector] disk collect error:', err.message);
      this._state.disk = { total: 0, used: 0, available: 0, percent: 0, mount: '/', error: err.message };
    }
  }

  _collectGpu() {
    const platform = os.platform();
    try {
      let output;
      if (platform === 'darwin') {
        output = execSync('system_profiler SPDisplaysDataType', { encoding: 'utf8', timeout: 10000 });
        // 解析 Chipset Model 和 VRAM
        const nameMatch = output.match(/Chipset Model:\s*(.+)/);
        const vramMatch = output.match(/VRAM[^:]*:\s*(.+)/);
        this._state.gpu = {
          name: nameMatch ? nameMatch[1].trim() : 'N/A',
          memory: vramMatch ? vramMatch[1].trim() : 'N/A',
          utilization: 'N/A',
        };
      } else {
        // Linux / Windows: nvidia-smi
        output = execSync(
          'nvidia-smi --query-gpu=name,memory.total,utilization.gpu --format=csv,noheader,nounits',
          { encoding: 'utf8', timeout: 10000 }
        );
        const parts = output.trim().split(',').map((s) => s.trim());
        this._state.gpu = {
          name: parts[0] || 'N/A',
          memory: parts[1] ? `${parts[1]} MiB` : 'N/A',
          utilization: parts[2] ? `${parts[2]}%` : 'N/A',
        };
      }
    } catch {
      this._state.gpu = { name: 'N/A', memory: 'N/A', utilization: 'N/A' };
    }
  }

  _collectProcessCount() {
    const platform = os.platform();
    try {
      if (platform === 'win32') {
        const output = execSync('tasklist /fo csv /nh', { encoding: 'utf8', timeout: 5000 });
        // 每行是一个进程（CSV 格式）
        const count = output.trim().split('\n').filter((l) => l.trim()).length;
        this._state.processCount = count;
      } else {
        // macOS / Linux
        const output = execSync('ps aux | wc -l', { encoding: 'utf8', timeout: 5000 });
        // 减去 header 行
        this._state.processCount = Math.max(0, parseInt(output.trim(), 10) - 1);
      }
    } catch (err) {
      console.error('[SystemInfoCollector] process count error:', err.message);
      this._state.processCount = 0;
    }
  }

  // ==================== 电池监听 ====================

  _setupBattery() {
    try {
      powerMonitor.on('on-battery', () => {
        this._state.battery = { charging: false };
        if (this._isRunning) {
          this._state.timestamp = Date.now();
          this.onUpdate(this._state);
        }
        console.log('[SystemInfoCollector] 切换到电池供电');
      });

      powerMonitor.on('on-ac', () => {
        this._state.battery = { charging: true };
        if (this._isRunning) {
          this._state.timestamp = Date.now();
          this.onUpdate(this._state);
        }
        console.log('[SystemInfoCollector] 切换到交流供电');
      });
    } catch (err) {
      console.error('[SystemInfoCollector] battery setup error:', err.message);
    }
  }
}

module.exports = { SystemInfoCollector };
