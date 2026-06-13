# Buddy 桌面端原生硬件补全计划

> 目标：补齐 Electron 桌面端缺失的硬件能力，让 Buddy 在电脑上拥有完整的感知和控制力。
> 原则：复用 Electron/Node.js 原生能力，零外部付费依赖。

---

## 总览

### 现状

| 已有能力 | 实现方式 |
|----------|---------|
| 麦克风/摄像头/音频播放 | Chromium Web API |
| 屏幕截图 | Electron desktopCapturer |
| 剪贴板/文件/网络/时间/窗口/通知 | Electron 主进程模块 |

### 待补全

| # | 模块 | 优先级 | 复杂度 | 说明 |
|---|------|--------|--------|------|
| 1 | 全局快捷键 | P0 | 低 | 系统级热键触发 Buddy |
| 2 | 系统信息 | P0 | 低 | CPU/GPU/内存/磁盘实时监控 |
| 3 | 系统音频捕获 (Loopback) | P1 | 中 | "听到电脑在放什么" |
| 4 | 媒体控制 | P1 | 中 | 锁屏/通知栏播放控制 |
| 5 | USB/串口设备 | P2 | 低 | 外接硬件访问 |
| 6 | 蓝牙设备 | P2 | 中 | 设备发现与连接 |
| 7 | 打印机 | P3 | 低 | 原生打印 |
| 8 | 地理位置 | P3 | 低 | WiFi/GPS 定位 |
| 9 | 屏幕标注叠加层 | P2 | 中 | 屏幕绘制标注 |

---

## 第一部分：⌨️ 全局快捷键

### 目标

注册系统级热键，即使 Buddy 不在前台也能触发。

### 预设快捷键

| 快捷键 | 功能 | 平台 |
|--------|------|------|
| `Cmd/Ctrl+Shift+B` | 唤出/隐藏 Buddy 主窗口 | 全平台 |
| `Cmd/Ctrl+Shift+Space` | 按住说话（Push-to-Talk） | 全平台 |
| `Cmd/Ctrl+Shift+M` | 静音/取消静音麦克风 | 全平台 |
| `Cmd/Ctrl+Shift+S` | 截图并分析 | 全平台 |
| `Cmd/Ctrl+Shift+V` | 读取剪贴板并分析 | 全平台 |

### 实现

**文件**：`electron/global-shortcuts.cjs`

```javascript
const { globalShortcut, app } = require('electron');

class GlobalShortcuts {
  constructor(options = {}) {
    this.onAction = options.onAction || (() => {});
    this.mainWindow = options.mainWindow || null;
    this._registered = new Map();
  }

  registerAll() {
    const isMac = process.platform === 'darwin';
    const mod = isMac ? 'Cmd' : 'Ctrl';

    const shortcuts = {
      [`${mod}+Shift+B`]:     'toggle_window',
      [`${mod}+Shift+Space`]: 'push_to_talk_start',
      [`${mod}+Shift+M`]:     'toggle_mute',
      [`${mod}+Shift+S`]:     'screenshot_analyze',
      [`${mod}+Shift+V`]:     'clipboard_analyze',
    };

    for (const [accelerator, action] of Object.entries(shortcuts)) {
      try {
        const ok = globalShortcut.register(accelerator, () => {
          console.log(`[Shortcuts] ${action} triggered`);
          this.onAction(action, { accelerator });

          // 特殊处理：push_to_talk 需要 keyup
          // 通过主窗口 webContents 发送
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('shortcut_action', action);
          }
        });

        if (ok) {
          this._registered.set(accelerator, action);
          console.log(`[Shortcuts] 注册成功: ${accelerator} → ${action}`);
        } else {
          console.warn(`[Shortcuts] 注册失败（可能被占用）: ${accelerator}`);
        }
      } catch (err) {
        console.error(`[Shortcuts] 注册异常: ${accelerator}`, err.message);
      }
    }
  }

  unregisterAll() {
    globalShortcut.unregisterAll();
    this._registered.clear();
    console.log('[Shortcuts] 已注销全部快捷键');
  }

  getStatus() {
    return {
      registered: Object.fromEntries(this._registered),
      count: this._registered.size,
    };
  }
}

module.exports = { GlobalShortcuts };
```

### Push-to-Talk 补充

`Cmd/Ctrl+Shift+Space` 需要区分按下和松开。Electron 的 `globalShortcut` 不支持 keyup，需要通过 `powerMonitor` 或注册两次（按下注册、松起注销再注册）来模拟。

替代方案：使用 `uiohook-napi`（纯 Node.js 全局键鼠钩子），可精确捕获 keydown/keyup。

### 集成

在 `main.cjs` 中：
```javascript
const { GlobalShortcuts } = require('./global-shortcuts.cjs');

// 在 app.whenReady() 中
const shortcuts = new GlobalShortcuts({
  mainWindow,
  onAction: (action) => handleShortcutAction(action),
});
shortcuts.registerAll();
```

### 工作量

| 任务 | 行数 | 时间 |
|------|------|------|
| global-shortcuts.cjs | ~80 行 | 0.5h |
| main.cjs 集成 | ~20 行 | 0.5h |
| Push-to-Talk 逻辑 | ~60 行 | 1h |
| 前端快捷键响应 | ~40 行 | 0.5h |
| **合计** | **~200 行** | **2.5h** |

---

## 第二部分：💻 系统信息监控

### 目标

实时监控 CPU/GPU/内存/磁盘/电池状态，驱动 Buddy 感知。

### 采集指标

| 指标 | 来源 | 更新频率 |
|------|------|---------|
| CPU 使用率 | `os.cpus()` | 5s |
| 内存使用 | `os.totalmem/freemem` | 5s |
| 磁盘使用 | `child_process` 调系统命令 | 30s |
| GPU 信息 | `child_process` (nvidia-smi / system_profiler) | 30s |
| 电池状态 | Electron `powerMonitor` | 60s |
| 系统负载 | `os.loadavg()` | 5s |
| 进程数 | `child_process` | 30s |

### 实现

**文件**：`electron/system-info.cjs`

```javascript
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
    this._state = {};
    this._prevCpuInfo = null;
  }

  start() {
    if (this._isRunning) return;
    this._isRunning = true;

    // 快速指标
    this._collectFast();
    this._fastTimer = setInterval(() => this._collectFast(), this.fastIntervalMs);

    // 慢速指标
    this._collectSlow();
    this._slowTimer = setInterval(() => this._collectSlow(), this.slowIntervalMs);

    // 电池事件
    this._setupBattery();

    console.log('[SystemInfo] 已启动');
  }

  stop() {
    this._isRunning = false;
    clearInterval(this._fastTimer);
    clearInterval(this._slowTimer);
  }

  getStatus() {
    return { running: this._isRunning, ...this._state };
  }

  // ── 快速指标 ──

  _collectFast() {
    const cpu = this._getCpuUsage();
    const memory = this._getMemory();
    const load = os.loadavg();

    this._state = {
      ...this._state,
      cpu: { usage: cpu, cores: os.cpus().length },
      memory,
      load: { '1m': load[0], '5m': load[1], '15m': load[2] },
      uptime: os.uptime(),
      timestamp: Date.now(),
    };

    this.onUpdate(this._state);
  }

  // ── 慢速指标 ──

  _collectSlow() {
    const disk = this._getDisk();
    const gpu = this._getGpu();
    const processes = this._getProcessCount();

    this._state = {
      ...this._state,
      disk,
      gpu,
      processes,
      timestamp: Date.now(),
    };

    this.onUpdate(this._state);
  }

  // ── CPU ──

  _getCpuUsage() {
    const cpus = os.cpus();
    let totalIdle = 0, totalTick = 0;

    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    }

    const current = { idle: totalIdle, total: totalTick };

    if (this._prevCpuInfo) {
      const idleDiff = current.idle - this._prevCpuInfo.idle;
      const totalDiff = current.total - this._prevCpuInfo.total;
      this._prevCpuInfo = current;
      return totalDiff > 0 ? Math.round((1 - idleDiff / totalDiff) * 100) : 0;
    }

    this._prevCpuInfo = current;
    return 0;
  }

  // ── 内存 ──

  _getMemory() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return {
      total: Math.round(total / 1024 / 1024 / 1024 * 10) / 10,  // GB
      used: Math.round(used / 1024 / 1024 / 1024 * 10) / 10,
      free: Math.round(free / 1024 / 1024 / 1024 * 10) / 10,
      percent: Math.round(used / total * 100),
    };
  }

  // ── 磁盘 ──

  _getDisk() {
    try {
      const platform = process.platform;
      let cmd;
      if (platform === 'darwin') {
        cmd = "df -g / | tail -1 | awk '{print $2,$3,$4,$5}'";
      } else if (platform === 'linux') {
        cmd = "df -BG / | tail -1 | awk '{print $2,$3,$4,$5}'";
      } else {
        cmd = 'wmic logicaldisk where "DeviceID=\'C:\'" get Size,FreeSpace /format:csv';
      }
      const out = execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim();
      const parts = out.split(/\s+/);
      return {
        total: parseInt(parts[0]) || 0,
        used: parseInt(parts[1]) || 0,
        free: parseInt(parts[2]) || 0,
        percent: parts[3] || '0%',
      };
    } catch {
      return { total: 0, used: 0, free: 0, percent: 'N/A' };
    }
  }

  // ── GPU ──

  _getGpu() {
    try {
      const platform = process.platform;
      if (platform === 'darwin') {
        const out = execSync(
          "system_profiler SPDisplaysDataType 2>/dev/null | grep 'Chipset Model' | head -1",
          { encoding: 'utf8', timeout: 5000 }
        ).trim();
        return { name: out.replace('Chipset Model:', '').trim() || 'Unknown' };
      } else {
        // 尝试 nvidia-smi
        const out = execSync(
          'nvidia-smi --query-gpu=name,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits 2>/dev/null',
          { encoding: 'utf8', timeout: 5000 }
        ).trim();
        if (out) {
          const [name, memUsed, memTotal, temp] = out.split(',').map(s => s.trim());
          return { name, memoryUsed: parseInt(memUsed), memoryTotal: parseInt(memTotal), temperature: parseInt(temp) };
        }
      }
    } catch {}
    return { name: 'N/A' };
  }

  // ── 进程数 ──

  _getProcessCount() {
    try {
      const platform = process.platform;
      if (platform === 'win32') {
        const out = execSync('tasklist /fo csv | find /c /v ""', { encoding: 'utf8', timeout: 5000 });
        return parseInt(out.trim()) || 0;
      }
      const out = execSync('ps aux | wc -l', { encoding: 'utf8', timeout: 5000 });
      return parseInt(out.trim()) || 0;
    } catch {
      return 0;
    }
  }

  // ── 电池 ──

  _setupBattery() {
    // Electron powerMonitor 提供 on-battery / on-ac 事件
    if (powerMonitor) {
      powerMonitor.on('on-battery', () => {
        this._state.battery = { charging: false };
        this.onUpdate(this._state);
      });
      powerMonitor.on('on-ac', () => {
        this._state.battery = { charging: true };
        this.onUpdate(this._state);
      });
    }
  }

  destroy() {
    this.stop();
  }
}

module.exports = { SystemInfoCollector };
```

### 集成到 PerceptionManager

```javascript
// perception-manager.cjs 中新增
const { SystemInfoCollector } = require('./system-info.cjs');

// 构造函数中
this.systemInfo = new SystemInfoCollector({
  onUpdate: (state) => this._dispatch('system', state),
});

// start() 中
this.systemInfo.start();
```

### 工作量

| 任务 | 行数 | 时间 |
|------|------|------|
| system-info.cjs | ~180 行 | 1h |
| PerceptionManager 集成 | ~15 行 | 0.5h |
| 前端展示（可选） | ~50 行 | 0.5h |
| **合计** | **~245 行** | **2h** |

---

## 第三部分：🔊 系统音频捕获 (Loopback)

### 目标

捕获系统正在播放的音频输出（"电脑在放什么"），而非麦克风输入。

### 技术路线

| 平台 | 方案 | 说明 |
|------|------|------|
| macOS | ScreenCaptureKit (macOS 12.3+) | 可同时捕获屏幕 + 系统音频 |
| macOS (旧) | `AVAudioEngine` + 虚拟音频设备 | 需要第三方虚拟音频驱动 (BlackHole) |
| Windows | WASAPI Loopback | Windows 原生支持，无需额外驱动 |
| Linux | PulseAudio monitor | 直接读取 `monitor` 源 |

### 实现

**文件**：`electron/system-audio.cjs`

```javascript
const { execSync, spawn } = require('child_process');
const os = require('os');
const { BrowserWindow } = require('electron');

class SystemAudioCapture {
  constructor(options = {}) {
    this.onAudioData = options.onAudioData || (() => {});
    this.onError = options.onError || (() => {});
    this.sampleRate = options.sampleRate || 16000;
    this._isCapturing = false;
    this._process = null;
    this._platform = process.platform;
  }

  async start() {
    if (this._isCapturing) return;

    try {
      if (this._platform === 'win32') {
        await this._startWindows();
      } else if (this._platform === 'darwin') {
        await this._startMacOS();
      } else {
        await this._startLinux();
      }
      this._isCapturing = true;
      console.log('[SystemAudio] 开始捕获系统音频');
    } catch (err) {
      this.onError(err);
    }
  }

  stop() {
    this._isCapturing = false;
    if (this._process) {
      this._process.kill();
      this._process = null;
    }
    console.log('[SystemAudio] 停止捕获');
  }

  get active() {
    return this._isCapturing;
  }

  // ── Windows: WASAPI Loopback via PowerShell ──

  async _startWindows() {
    // 使用 ffmpeg 的 dshow 设备捕获 WASAPI loopback
    // 需要先检测 loopback 设备名
    const deviceName = this._getWindowsLoopbackDevice();

    this._process = spawn('ffmpeg', [
      '-f', 'dshow',
      '-i', `audio="${deviceName}"`,
      '-ac', '1',
      '-ar', String(this.sampleRate),
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    this._setupStreamParser();
  }

  _getWindowsLoopbackDevice() {
    try {
      // 列出 DirectShow 音频设备，找到 loopback
      const out = execSync(
        'ffmpeg -list_devices true -f dshow -i dummy 2>&1',
        { encoding: 'utf8', timeout: 10000 }
      );
      // 查找 Stereo Mix 或 loopback 设备
      const match = out.match(/"(.*?(?:loopback|stereo mix|立体声混音).*?)"/i);
      if (match) return match[1];

      // fallback: 查找第一个音频输出设备
      const audioMatch = out.match(/"(.*?Audio.*?)"\s+\(audio\)/i);
      return audioMatch ? audioMatch[1] : 'default';
    } catch {
      return 'default';
    }
  }

  // ── macOS: ScreenCaptureKit (macOS 12.3+) ──

  async _startMacOS() {
    // 使用 swift 命令行工具调用 ScreenCaptureKit
    // 或者用 ffmpeg + avfoundation
    const swiftScript = `
import ScreenCaptureKit
import AVFoundation

// 简化：使用 ffmpeg + 虚拟音频设备
// 生产环境应使用 ScreenCaptureKit API
`;

    // 方案 A：尝试 ffmpeg + screen capture
    this._process = spawn('ffmpeg', [
      '-f', 'avfoundation',
      '-i', ':0',  // 系统音频设备
      '-ac', '1',
      '-ar', String(this.sampleRate),
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    this._setupStreamParser();
  }

  // ── Linux: PulseAudio Monitor ──

  async _startLinux() {
    // 找到默认输出的 monitor 源
    let monitorSource = 'auto_null.monitor';
    try {
      const out = execSync(
        'pactl list short sources | grep monitor',
        { encoding: 'utf8', timeout: 5000 }
      );
      const first = out.trim().split('\n')[0];
      if (first) monitorSource = first.split('\t')[1];
    } catch {}

    this._process = spawn('ffmpeg', [
      '-f', 'pulse',
      '-i', monitorSource,
      '-ac', '1',
      '-ar', String(this.sampleRate),
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    this._setupStreamParser();
  }

  // ── 通用：解析 PCM 流 ──

  _setupStreamParser() {
    if (!this._process?.stdout) return;

    const FRAME_SIZE = 1024 * 2; // 1024 samples * 2 bytes (Int16)
    let buffer = Buffer.alloc(0);

    this._process.stdout.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= FRAME_SIZE) {
        const frame = buffer.subarray(0, FRAME_SIZE);
        buffer = buffer.subarray(FRAME_SIZE);

        // 推送 base64 PCM 帧
        this.onAudioData({
          pcm: frame.toString('base64'),
          sampleRate: this.sampleRate,
          channels: 1,
          frameSize: 1024,
          source: 'system',
        });
      }
    });

    this._process.on('close', (code) => {
      console.log(`[SystemAudio] 进程退出: ${code}`);
      this._isCapturing = false;
    });

    this._process.on('error', (err) => {
      console.error('[SystemAudio] 进程错误:', err.message);
      this.onError(err);
    });
  }

  destroy() {
    this.stop();
  }
}

module.exports = { SystemAudioCapture };
```

### 前端集成

在 `NativeAudioBridge` 中增加 `system` 源：

```typescript
// native-audio-bridge.ts 新增
private systemAudioHandle: PluginListenerHandle | null = null;

async startSystemCapture(): Promise<void> {
  // 通过 IPC 通知主进程启动系统音频捕获
  // 主进程通过 Capacitor 事件推送 PCM 帧
}
```

### 依赖

| 依赖 | 平台 | 是否必须 |
|------|------|---------|
| ffmpeg | 全平台 | ✅ 用户需自行安装 |
| ScreenCaptureKit | macOS 12.3+ | 替代方案 |
| BlackHole (虚拟音频) | macOS 旧版 | 可选 |

### 工作量

| 任务 | 行数 | 时间 |
|------|------|------|
| system-audio.cjs | ~200 行 | 2h |
| ffmpeg 设备检测 | ~40 行 | 1h |
| 前端 IPC 桥接 | ~60 行 | 1h |
| 测试（3 平台） | — | 3h |
| **合计** | **~300 行** | **7h** |

---

## 第四部分：🎮 媒体控制

### 目标

在系统锁屏/通知栏显示 Buddy 播放信息，支持播放/暂停/上一首/下一首控制。

### 平台 API

| 平台 | API | 功能 |
|------|-----|------|
| macOS | `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter` | 显示信息 + 接收控制 |
| Windows | `SystemMediaTransportControls` (SMTC) | 显示信息 + 接收控制 |
| Linux | MPRIS (D-Bus) | 显示信息 + 接收控制 |

### 实现

**文件**：`electron/media-control.cjs`

```javascript
const os = require('os');

class MediaControl {
  constructor(options = {}) {
    this.onCommand = options.onCommand || (() => {});
    this._platform = process.platform;
    this._isSetup = false;
    this._currentInfo = {};
  }

  setup() {
    if (this._isSetup) return;

    if (this._platform === 'darwin') {
      this._setupMacOS();
    } else if (this._platform === 'win32') {
      this._setupWindows();
    } else {
      this._setupLinux();
    }

    this._isSetup = true;
    console.log('[MediaControl] 已初始化');
  }

  /**
   * 更新当前播放信息
   */
  updateNowPlaying(info) {
    this._currentInfo = info;
    // 信息通过 IPC 推送到渲染进程
    // 渲染进程使用 Electron 的原生模块设置系统媒体信息
    if (this._platform === 'darwin') {
      this._updateMacOS(info);
    } else if (this._platform === 'win32') {
      this._updateWindows(info);
    } else {
      this._updateLinux(info);
    }
  }

  clearNowPlaying() {
    this.updateNowPlaying({ title: '', artist: '', isPlaying: false });
  }

  // ── macOS 实现 ──

  _setupMacOS() {
    // 使用 node-bridge 调用 Swift 代码
    // 或使用 electron-builder 的 native module
    // 简化方案：通过 child_process 调用 osascript
  }

  _updateMacOS(info) {
    if (!info.title) return;
    // 通过 osascript 设置 NowPlaying 信息（有限制）
    // 生产环境应使用 @aspect-build/electron-media-info 等原生模块
    try {
      const script = `
        tell application "System Events"
          -- 设置媒体信息（需要辅助功能权限）
        end tell
      `;
      // 注：完整实现需要 Swift 原生模块
    } catch {}
  }

  // ── Windows 实现 ──

  _setupWindows() {
    // Windows SMTC 需要 C# 或 C++ 原生模块
    // 简化方案：使用 PowerShell
  }

  _updateWindows(info) {
    if (!info.title) return;
    // 通过 node-hide 或原生模块设置 SMTC
    // 生产环境推荐使用 windows-media-controller npm 包
  }

  // ── Linux 实现 ──

  _setupLinux() {
    // MPRIS 通过 D-Bus 实现
    // 可使用 node-dbus 模块
  }

  _updateLinux(info) {
    if (!info.title) return;
    // 通过 dbus-send 设置 MPRIS 信息
    try {
      const { execSync } = require('child_process');
      const escaped = info.title.replace(/"/g, '\\"');
      execSync(
        `dbus-send --print-reply --dest=org.mpris.MediaPlayer2.buddy ` +
        `/org/mpris/MediaPlayer2 ` +
        `org.freedesktop.DBus.Properties.Set string:org.mpris.MediaPlayer2.Player ` +
        `string:Metadata dict:string:variant:string:"${escaped}"`,
        { timeout: 3000 }
      );
    } catch {}
  }

  destroy() {
    this.clearNowPlaying();
    this._isSetup = false;
  }
}

module.exports = { MediaControl };
```

### 依赖

| 依赖 | 用途 | 平台 |
|------|------|------|
| node-dbus / dbus-next | MPRIS D-Bus 通信 | Linux |
| windows-media-controller | SMTC 控制 | Windows |
| @aspect-build/electron-media-info | NowPlaying | macOS |

**注意**：完整媒体控制需要原生 Node.js 模块（需编译），建议作为可选依赖。

### 工作量

| 任务 | 行数 | 时间 |
|------|------|------|
| media-control.cjs | ~250 行 | 2h |
| 原生模块适配（3 平台） | ~200 行 | 4h |
| 前端控制 UI | ~80 行 | 1h |
| **合计** | **~530 行** | **7h** |

---

## 第五部分：🔌 USB/串口设备

### 目标

访问 USB 串口设备（Arduino、传感器、智能家居控制器等）。

### 实现

**文件**：`electron/serial-device.cjs`

```javascript
class SerialDeviceManager {
  constructor(options = {}) {
    this.onData = options.onData || (() => {});
    this.onDeviceList = options.onDeviceList || (() => {});
    this._connection = null;
    this._isConnected = false;
  }

  /**
   * 列出可用串口设备
   */
  async listDevices() {
    try {
      // 动态加载（可选依赖）
      const { SerialPort } = require('serialport');
      const ports = await SerialPort.list();
      const devices = ports.map(p => ({
        path: p.path,
        manufacturer: p.manufacturer || 'Unknown',
        serialNumber: p.serialNumber || '',
        vendorId: p.vendorId || '',
        productId: p.productId || '',
      }));
      this.onDeviceList(devices);
      return devices;
    } catch (err) {
      console.warn('[Serial] serialport 模块未安装:', err.message);
      return [];
    }
  }

  /**
   * 连接到串口设备
   */
  async connect(options = {}) {
    try {
      const { SerialPort } = require('serialport');
      const { ReadlineParser } = require('@serialport/parser-readline');

      this._connection = new SerialPort({
        path: options.path || '/dev/ttyUSB0',
        baudRate: options.baudRate || 9600,
        dataBits: options.dataBits || 8,
        stopBits: options.stopBits || 1,
        parity: options.parity || 'none',
      });

      const parser = this._connection.pipe(new ReadlineParser({ delimiter: '\n' }));

      parser.on('data', (line) => {
        this.onData({
          device: options.path,
          data: line.trim(),
          timestamp: Date.now(),
        });
      });

      this._connection.on('open', () => {
        this._isConnected = true;
        console.log(`[Serial] 已连接: ${options.path}`);
      });

      this._connection.on('error', (err) => {
        console.error('[Serial] 错误:', err.message);
        this._isConnected = false;
      });

      this._connection.on('close', () => {
        this._isConnected = false;
        console.log('[Serial] 已断开');
      });

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * 发送数据
   */
  async send(data) {
    if (!this._connection || !this._isConnected) {
      throw new Error('未连接');
    }
    return new Promise((resolve, reject) => {
      this._connection.write(data + '\n', (err) => {
        if (err) reject(err);
        else resolve({ sent: data.length });
      });
    });
  }

  disconnect() {
    if (this._connection) {
      this._connection.close();
      this._connection = null;
    }
  }

  get connected() {
    return this._isConnected;
  }

  destroy() {
    this.disconnect();
  }
}

module.exports = { SerialDeviceManager };
```

### 依赖

```json
{
  "optionalDependencies": {
    "serialport": "^12.0.0",
    "@serialport/parser-readline": "^12.0.0"
  }
}
```

### 工作量

| 任务 | 行数 | 时间 |
|------|------|------|
| serial-device.cjs | ~150 行 | 1h |
| IPC 桥接 | ~40 行 | 0.5h |
| 前端设备管理 UI | ~100 行 | 1h |
| **合计** | **~290 行** | **2.5h** |

---

## 第六部分：📡 蓝牙设备

### 目标

发现附近蓝牙设备，支持连接和基础通信。

### 技术路线

| 平台 | 方案 |
|------|------|
| 全平台 | Web Bluetooth API (Electron 原生支持) |
| 备选 | noble (Node.js BLE 库) |

### 实现

**文件**：`electron/bluetooth.cjs`

```javascript
const { BrowserWindow, ipcMain } = require('electron');

class BluetoothManager {
  constructor(options = {}) {
    this.onDevice = options.onDevice || (() => {});
    this._isScanning = false;
    this._devices = new Map();
  }

  /**
   * 扫描 BLE 设备
   * 通过渲染进程的 Web Bluetooth API 实现
   */
  async startScan(options = {}) {
    if (this._isScanning) return;

    // Web Bluetooth 需要在渲染进程中调用
    // 主进程通过 IPC 触发
    this._isScanning = true;
    console.log('[Bluetooth] 开始扫描');

    return { status: 'scanning' };
  }

  stopScan() {
    this._isScanning = false;
    console.log('[Bluetooth] 停止扫描');
  }

  /**
   * 获取已发现设备列表
   */
  getDevices() {
    return Array.from(this._devices.values());
  }

  /**
   * 通过 Web Bluetooth 在渲染进程连接设备
   * 主进程处理 GATT 数据交互
   */
  async connect(deviceId) {
    // 由渲染进程通过 Web Bluetooth API 完成
    return { status: 'connecting', deviceId };
  }

  destroy() {
    this.stopScan();
    this._devices.clear();
  }
}

module.exports = { BluetoothManager };
```

### 前端渲染进程

```typescript
// bluetooth-bridge.ts
export class BluetoothBridge {
  async requestDevice(filters?: BluetoothLEScanFilter[]): Promise<BluetoothDevice | null> {
    if (!navigator.bluetooth) {
      console.warn('Web Bluetooth 不可用');
      return null;
    }
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: filters || [{ acceptAllDevices: true }],
        optionalServices: ['battery_service', 'device_information'],
      });
      return device;
    } catch (err) {
      console.error('蓝牙请求失败:', err);
      return null;
    }
  }

  async connectGATT(device: BluetoothDevice): Promise<BluetoothRemoteGATTServer | null> {
    try {
      return await device.gatt?.connect() || null;
    } catch {
      return null;
    }
  }
}
```

### 依赖

| 依赖 | 用途 | 必须 |
|------|------|------|
| Web Bluetooth API | Electron 内置 | ✅ |
| noble | 备选 BLE 库 | ❌ 可选 |

### 工作量

| 任务 | 行数 | 时间 |
|------|------|------|
| bluetooth.cjs | ~100 行 | 1h |
| bluetooth-bridge.ts | ~80 行 | 1h |
| IPC 桥接 | ~30 行 | 0.5h |
| 设备管理 UI | ~120 行 | 1.5h |
| **合计** | **~330 行** | **4h** |

---

## 第七部分：🖨️ 打印机

### 目标

支持原生打印对话框和静默打印。

### 实现

**文件**：`electron/printer.cjs`

```javascript
const { BrowserWindow } = require('electron');

class PrinterManager {
  /**
   * 打印渲染进程内容
   */
  static async print(options = {}) {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (!win) return { success: false, error: '无可用窗口' };

    return new Promise((resolve) => {
      win.webContents.print(
        {
          silent: options.silent || false,
          printBackground: options.printBackground || false,
          deviceName: options.deviceName || '',
          copies: options.copies || 1,
          pageSize: options.pageSize || 'A4',
        },
        (success, failureReason) => {
          resolve({ success, error: failureReason || null });
        }
      );
    });
  }

  /**
   * 导出为 PDF
   */
  static async exportPDF(options = {}) {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (!win) return { success: false, error: '无可用窗口' };

    const pdfData = await win.webContents.printToPDF({
      printBackground: options.printBackground !== false,
      pageSize: options.pageSize || 'A4',
      margins: options.margins || { marginType: 'default' },
    });

    return { success: true, data: pdfData };
  }

  /**
   * 获取可用打印机列表
   */
  static async listPrinters() {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return [];
    const printers = await win.webContents.getPrintersAsync();
    return printers.map(p => ({
      name: p.name,
      displayName: p.displayName,
      description: p.description,
      status: p.status,
      isDefault: p.isDefault,
    }));
  }
}

module.exports = { PrinterManager };
```

### 工作量

| 任务 | 行数 | 时间 |
|------|------|------|
| printer.cjs | ~80 行 | 0.5h |
| IPC 桥接 | ~30 行 | 0.5h |
| **合计** | **~110 行** | **1h** |

---

## 第八部分：📍 地理位置

### 目标

获取设备位置（笔记本 WiFi 定位 / GPS）。

### 实现

**文件**：`electron/geolocation.cjs`

```javascript
const { BrowserWindow, systemPreferences } = require('electron');
const os = require('os');
const { execSync } = require('child_process');

class GeolocationManager {
  constructor(options = {}) {
    this.onLocation = options.onLocation || (() => {});
    this._lastKnown = null;
  }

  /**
   * 获取当前位置
   * 优先使用系统 API，fallback 到 IP 定位
   */
  async getCurrentPosition() {
    // 方案 1：通过渲染进程的 Geolocation API
    try {
      const pos = await this._getFromRenderer();
      this._lastKnown = pos;
      this.onLocation(pos);
      return pos;
    } catch {}

    // 方案 2：IP 定位（fallback）
    try {
      const pos = await this._getFromIP();
      this._lastKnown = pos;
      this.onLocation(pos);
      return pos;
    } catch {}

    return { error: '无法获取位置' };
  }

  async _getFromRenderer() {
    return new Promise((resolve, reject) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return reject(new Error('无窗口'));

      // 通过渲染进程获取 GPS/WiFi 定位
      win.webContents.executeJavaScript(`
        new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            pos => resolve({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              altitude: pos.coords.altitude,
              timestamp: pos.timestamp,
            }),
            err => reject(err.message),
            { enableHighAccuracy: true, timeout: 10000 }
          );
        })
      `).then(resolve).catch(reject);
    });
  }

  async _getFromIP() {
    const https = require('https');
    return new Promise((resolve, reject) => {
      https.get('https://ipapi.co/json/', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve({
              latitude: json.latitude,
              longitude: json.longitude,
              city: json.city,
              country: json.country_name,
              source: 'ip',
              accuracy: 10000, // IP 定位精度低
            });
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
  }

  get lastKnown() {
    return this._lastKnown;
  }

  destroy() {}
}

module.exports = { GeolocationManager };
```

### 工作量

| 任务 | 行数 | 时间 |
|------|------|------|
| geolocation.cjs | ~100 行 | 1h |
| IPC 桥接 | ~20 行 | 0.5h |
| **合计** | **~120 行** | **1.5h** |

---

## 第九部分：🎯 屏幕标注叠加层

### 目标

在屏幕上绘制标注（箭头、框选、文字），用于截图标注或远程协助。

### 技术方案

- 创建透明全屏窗口（`transparent: true, frame: false`）
- 鼠标穿透（`setIgnoreMouseEvents` + `forward: true`）
- Canvas 绘制标注
- 通过 IPC 接收标注指令

### 实现

**文件**：`electron/screen-overlay.cjs`

```javascript
const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

class ScreenOverlay {
  constructor(options = {}) {
    this.window = null;
    this._isVisible = false;
    this._drawMode = false; // 是否拦截鼠标事件进行绘制
  }

  create() {
    if (this.window) return;

    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    this.window = new BrowserWindow({
      width,
      height,
      x: 0,
      y: 0,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focusable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // 默认鼠标穿透
    this.window.setIgnoreMouseEvents(true, { forward: true });

    // 加载标注界面
    const overlayHtml = path.join(__dirname, 'screen-overlay.html');
    this.window.loadFile(overlayHtml);

    // IPC: 切换绘制模式
    ipcMain.on('overlay_draw_mode', (event, enabled) => {
      this._drawMode = enabled;
      if (this.window) {
        this.window.setIgnoreMouseEvents(!enabled, { forward: !enabled });
      }
    });

    ipcMain.on('overlay_clear', () => {
      this.window?.webContents.send('overlay_clear');
    });

    ipcMain.on('overlay_export', () => {
      this.window?.webContents.send('overlay_export');
    });

    this._isVisible = true;
    console.log('[Overlay] 已创建');
  }

  show() {
    this.window?.show();
    this._isVisible = true;
  }

  hide() {
    this.window?.hide();
    this._isVisible = false;
  }

  toggle() {
    if (this._isVisible) this.hide();
    else this.show();
  }

  /**
   * 在指定位置添加标注
   */
  addAnnotation(annotation) {
    this.window?.webContents.send('overlay_annotation', annotation);
  }

  destroy() {
    if (this.window) {
      this.window.destroy();
      this.window = null;
    }
    this._isVisible = false;
  }
}

module.exports = { ScreenOverlay };
```

### 标注 HTML

**文件**：`electron/screen-overlay.html`

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; }
    html, body {
      width: 100%; height: 100%;
      background: transparent;
      overflow: hidden;
    }
    canvas {
      position: fixed; top: 0; left: 0;
      width: 100%; height: 100%;
    }
  </style>
</head>
<body>
  <canvas id="canvas"></canvas>
  <script>
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    let drawing = false;
    let annotations = [];

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      redraw();
    }
    window.addEventListener('resize', resize);
    resize();

    // 鼠标绘制
    canvas.addEventListener('mousedown', (e) => {
      drawing = true;
      annotations.push({
        type: 'freehand',
        points: [{ x: e.clientX, y: e.clientY }],
        color: '#ff4444',
        width: 3,
      });
    });

    canvas.addEventListener('mousemove', (e) => {
      if (!drawing) return;
      const last = annotations[annotations.length - 1];
      if (last) last.points.push({ x: e.clientX, y: e.clientY });
      redraw();
    });

    canvas.addEventListener('mouseup', () => { drawing = false; });

    // IPC 清除
    if (window.electronAPI) {
      window.electronAPI.onOverlayClear(() => { annotations = []; redraw(); });
      window.electronAPI.onOverlayAnnotation((a) => { annotations.push(a); redraw(); });
    }

    function redraw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const a of annotations) {
        if (a.type === 'freehand' && a.points.length > 1) {
          ctx.beginPath();
          ctx.strokeStyle = a.color || '#ff4444';
          ctx.lineWidth = a.width || 3;
          ctx.lineCap = 'round';
          ctx.moveTo(a.points[0].x, a.points[0].y);
          for (let i = 1; i < a.points.length; i++) {
            ctx.lineTo(a.points[i].x, a.points[i].y);
          }
          ctx.stroke();
        } else if (a.type === 'rect') {
          ctx.strokeStyle = a.color || '#ff4444';
          ctx.lineWidth = a.width || 3;
          ctx.strokeRect(a.x, a.y, a.w, a.h);
        } else if (a.type === 'arrow') {
          ctx.strokeStyle = a.color || '#ff4444';
          ctx.lineWidth = a.width || 3;
          drawArrow(ctx, a.x1, a.y1, a.x2, a.y2);
        } else if (a.type === 'text') {
          ctx.fillStyle = a.color || '#ff4444';
          ctx.font = `${a.fontSize || 20}px sans-serif`;
          ctx.fillText(a.text, a.x, a.y);
        }
      }
    }

    function drawArrow(ctx, x1, y1, x2, y2) {
      const headLen = 15;
      const dx = x2 - x1, dy = y2 - y1;
      const angle = Math.atan2(dy, dx);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI/6), y2 - headLen * Math.sin(angle - Math.PI/6));
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI/6), y2 - headLen * Math.sin(angle + Math.PI/6));
      ctx.stroke();
    }
  </script>
</body>
</html>
```

### 工作量

| 任务 | 行数 | 时间 |
|------|------|------|
| screen-overlay.cjs | ~100 行 | 1h |
| screen-overlay.html | ~120 行 | 1.5h |
| IPC 桥接 | ~40 行 | 0.5h |
| **合计** | **~260 行** | **3h** |

---

## 总工作量汇总

| # | 模块 | 代码量 | 时间 | 依赖 |
|---|------|--------|------|------|
| 1 | 全局快捷键 | ~200 行 | 2.5h | 无 |
| 2 | 系统信息 | ~245 行 | 2h | 无 |
| 3 | 系统音频 (Loopback) | ~300 行 | 7h | ffmpeg |
| 4 | 媒体控制 | ~530 行 | 7h | 原生模块(可选) |
| 5 | USB/串口 | ~290 行 | 2.5h | serialport(可选) |
| 6 | 蓝牙 | ~330 行 | 4h | 无 (Web Bluetooth) |
| 7 | 打印机 | ~110 行 | 1h | 无 |
| 8 | 地理位置 | ~120 行 | 1.5h | 无 |
| 9 | 屏幕标注 | ~260 行 | 3h | 无 |
| **合计** | | **~2385 行** | **30.5h** | |

## 实施顺序

```
Phase 1（立即可做，零依赖）：全局快捷键 + 系统信息 + 打印机 + 地理位置
  → 产出：热键触发、系统监控、打印、定位
  → 工作量：~675 行 / 7h

Phase 2（中等复杂度）：USB/串口 + 蓝牙 + 屏幕标注
  → 产出：外接硬件访问、蓝牙设备、屏幕标注
  → 工作量：~880 行 / 9.5h

Phase 3（需要 ffmpeg / 原生模块）：系统音频 + 媒体控制
  → 产出：听到电脑声音、锁屏播放控制
  → 工作量：~830 行 / 14h
```

## 集成架构

```
electron/
├── main.cjs                 ← 现有，需新增模块引入
├── perception-manager.cjs   ← 现有，需注册新模块
├── global-shortcuts.cjs     ← 新增
├── system-info.cjs          ← 新增
├── system-audio.cjs         ← 新增
├── media-control.cjs        ← 新增
├── serial-device.cjs        ← 新增
├── bluetooth.cjs            ← 新增
├── printer.cjs              ← 新增
├── geolocation.cjs          ← 新增
├── screen-overlay.cjs       ← 新增
├── screen-overlay.html      ← 新增
└── ... (现有文件不变)
```

## 零外部付费依赖

所有功能均使用 Electron/Node.js 原生能力或开源库实现，零付费 API。
