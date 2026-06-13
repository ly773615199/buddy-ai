/**
 * Sprint 6: 媒体控制模块
 *
 * 在系统锁屏/通知栏显示 Buddy 播放信息，支持播放/暂停控制。
 * - macOS: osascript / MPNowPlayingInfoCenter（生产环境建议使用 Swift 原生模块）
 * - Windows: PowerShell Windows.Media.Control（生产环境建议使用 C# 原生模块）
 * - Linux: MPRIS (D-Bus) 通过 dbus-send
 */

const { execFile, spawn } = require('child_process');
const os = require('os');

class MediaControl {
  constructor(options = {}) {
    this.onCommand = options.onCommand || (() => {});
    this.onUpdate = options.onUpdate || (() => {});

    this._currentInfo = null;
    this._isSetup = false;
    this._platform = os.platform();
    this._mprisProcess = null;
  }

  // ── 生命周期 ──────────────────────────────────────────

  async setup() {
    if (this._isSetup) return;
    try {
      switch (this._platform) {
        case 'darwin':
          await this._setupMacOS();
          break;
        case 'win32':
          await this._setupWindows();
          break;
        case 'linux':
          await this._setupLinux();
          break;
        default:
          console.warn(`[MediaControl] 不支持的平台: ${this._platform}`);
          return;
      }
      this._isSetup = true;
      console.log(`[MediaControl] 已初始化 (${this._platform})`);
    } catch (e) {
      console.error('[MediaControl] 初始化失败:', e.message);
    }
  }

  destroy() {
    this.clearNowPlaying();
    this._isSetup = false;
    this._currentInfo = null;
    console.log('[MediaControl] 已销毁');
  }

  // ── 公开接口 ──────────────────────────────────────────

  /**
   * 更新系统 NowPlaying 信息
   * @param {Object} info
   * @param {string} info.title
   * @param {string} [info.artist]
   * @param {string} [info.album]
   * @param {number} [info.duration] - 秒
   * @param {number} [info.position] - 秒
   * @param {boolean} [info.isPlaying]
   * @param {string} [info.artwork] - 图片路径或 URL
   */
  updateNowPlaying(info) {
    if (!info || !info.title) {
      console.warn('[MediaControl] updateNowPlaying 缺少 title');
      return;
    }

    this._currentInfo = {
      title: info.title,
      artist: info.artist || 'Unknown',
      album: info.album || '',
      duration: info.duration || 0,
      position: info.position || 0,
      isPlaying: !!info.isPlaying,
      artwork: info.artwork || '',
    };

    try {
      switch (this._platform) {
        case 'darwin':
          this._updateMacOS(this._currentInfo);
          break;
        case 'win32':
          this._updateWindows(this._currentInfo);
          break;
        case 'linux':
          this._updateLinux(this._currentInfo);
          break;
      }
    } catch (e) {
      console.error('[MediaControl] 更新播放信息失败:', e.message);
    }

    this.onUpdate(this._currentInfo);
  }

  clearNowPlaying() {
    this._currentInfo = null;

    try {
      switch (this._platform) {
        case 'darwin':
          this._clearMacOS();
          break;
        case 'win32':
          this._clearWindows();
          break;
        case 'linux':
          this._clearLinux();
          break;
      }
    } catch (e) {
      console.error('[MediaControl] 清除播放信息失败:', e.message);
    }
  }

  get isPlaying() {
    return this._currentInfo ? this._currentInfo.isPlaying : false;
  }

  /**
   * 处理来自系统的播放控制命令
   * @param {'play'|'pause'|'toggle'|'next'|'previous'} command
   */
  handleCommand(command) {
    const valid = ['play', 'pause', 'toggle', 'next', 'previous'];
    if (!valid.includes(command)) {
      console.warn(`[MediaControl] 未知命令: ${command}`);
      return;
    }
    console.log(`[MediaControl] 收到命令: ${command}`);
    this.onCommand(command);

    // 同步本地播放状态
    if (this._currentInfo) {
      if (command === 'play') this._currentInfo.isPlaying = true;
      else if (command === 'pause') this._currentInfo.isPlaying = false;
      else if (command === 'toggle') this._currentInfo.isPlaying = !this._currentInfo.isPlaying;
    }
  }

  // ── IPC ───────────────────────────────────────────────

  /**
   * 注册 IPC handler
   * @param {Object} manager - ipcMain 或类似对象
   */
  static registerIPC(manager) {
    if (!manager) return;

    manager.handle('media_update', (_event, info) => {
      // 由外部实例调用
      return { ok: true, info };
    });

    manager.handle('media_clear', () => {
      return { ok: true };
    });

    manager.handle('media_command', (_event, command) => {
      return { ok: true, command };
    });

    console.log('[MediaControl] IPC handlers 已注册');
  }

  // ── macOS 实现 ────────────────────────────────────────

  async _setupMacOS() {
    // 检查 osascript 可用性
    await this._exec('osascript', ['-e', 'return "ok"']);
  }

  /**
   * macOS: 通过 osascript 更新 NowPlaying 信息
   *
   * 注意：osascript 对 NowPlaying 控制有限。
   * 完整的 MPNowPlayingInfoCenter 集成需要 Swift 原生模块，
   * 生产环境建议编译一个 swift CLI 工具或使用 node-addon-api 桥接。
   *
   * 这里提供基础的 osascript 方案用于开发/演示。
   */
  _updateMacOS(info) {
    const esc = (s) => String(s).replace(/"/g, '\\"').replace(/\\/g, '\\\\');

    // 通过 AppleScript 设置 Spotify/iTunes 风格的媒体信息
    // 实际的系统 NowPlaying 需要原生模块
    const script = `
      try
        -- 尝试更新系统媒体信息（需要原生模块支持）
        -- 这里仅打印信息用于调试
        log "NowPlaying: ${esc(info.title)} - ${esc(info.artist)} (${info.isPlaying ? 'Playing' : 'Paused'})"
      end try
    `;

    execFile('osascript', ['-e', script.trim()], (err) => {
      if (err) {
        // 非致命错误，静默处理
      }
    });

    // TODO: 生产环境应使用 Swift 原生模块
    // 例如编译一个 buddy-media-bridge CLI:
    //   swift buddy-media-bridge.swift update --title "..." --artist "..." --playing
    //
    // Swift 核心代码：
    //   import MediaPlayer
    //   let center = MPNowPlayingInfoCenter.default()
    //   center.nowPlayingInfo = [
    //     MPMediaItemPropertyTitle: title,
    //     MPMediaItemPropertyArtist: artist,
    //     MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0
    //   ]
  }

  _clearMacOS() {
    const script = `
      try
        log "NowPlaying: cleared"
      end try
    `;
    execFile('osascript', ['-e', script.trim()], () => {});
  }

  // ── Windows 实现 ──────────────────────────────────────

  async _setupWindows() {
    // 检查 PowerShell 可用性
    await this._exec('powershell', ['-Command', 'echo ok']);
  }

  /**
   * Windows: 通过 PowerShell 调用 Windows.Media.Control API
   *
   * Windows 10+ 的 SystemMediaTransportControls 需要 UWP/WinRT API。
   * 完整实现需要 C# 命令行工具或 node-addon-api 桥接 WinRT。
   *
   * 这里提供基础的 PowerShell 方案用于开发/演示。
   */
  _updateWindows(info) {
    const esc = (s) => String(s).replace(/'/g, "''");

    const psScript = `
      # Windows Media Control 更新
      # 生产环境应使用 C# CLI 工具调用 SystemMediaTransportControls
      Write-Host "NowPlaying: ${esc(info.title)} - ${esc(info.artist)} (${
        info.isPlaying ? 'Playing' : 'Paused'
      })"

      # TODO: 生产环境推荐使用 C# 原生模块
      # 参考: Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager
      # 或 SystemMediaTransportControls (需要注册为媒体应用)
    `;

    spawn('powershell', ['-NoProfile', '-Command', psScript], {
      stdio: 'ignore',
      windowsHide: true,
    });
  }

  _clearWindows() {
    spawn('powershell', ['-NoProfile', '-Command', 'Write-Host "NowPlaying: cleared"'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  }

  // ── Linux 实现 (MPRIS / D-Bus) ───────────────────────

  async _setupLinux() {
    // 检查 dbus-send 可用性
    try {
      await this._exec('which', ['dbus-send']);
    } catch {
      console.warn('[MediaControl] dbus-send 不可用，Linux 媒体控制将受限');
    }
  }

  /**
   * Linux: 通过 MPRIS (D-Bus) 设置媒体信息
   *
   * MPRIS 规范: https://specifications.freedesktop.org/mpris-spec/
   * 系统通知栏和锁屏会自动读取 MPRIS 元数据。
   *
   * 注意：dbus-send 对复杂数据类型支持有限。
   * 生产环境建议使用 dbus-native 或 node-dbus 包。
   */
  _updateLinux(info) {
    const iface = 'org.mpris.MediaPlayer2.Player';
    const busName = 'org.mpris.MediaPlayer2.Buddy';
    const objectPath = '/org/mpris/MediaPlayer2';

    // 设置播放状态
    const status = info.isPlaying ? 'Playing' : 'Paused';
    this._dbusSend(
      busName,
      objectPath,
      `${iface}.PlaybackStatus`,
      `string:${status}`
    );

    // 设置元数据 (MPRIS metadata 使用 dict)
    // dbus-send 对 dict 支持有限，使用多次调用模拟
    // 生产环境建议使用 dbus-native 构建完整的 a{sv} dict
    const metadata = {
      'xesam:title': info.title,
      'xesam:artist': info.artist,
      'xesam:album': info.album || '',
      'mpris:length': Math.floor((info.duration || 0) * 1000000), // 微秒
    };

    // 逐个设置元数据字段（简化方案）
    // 完整方案需要发送 dict{string, variant} 类型
    for (const [key, value] of Object.entries(metadata)) {
      if (!value && value !== 0) continue;
      const variantType = typeof value === 'number' ? 'int64' : 'string';
      this._dbusSend(
        busName,
        objectPath,
        `org.freedesktop.DBus.Properties.Set`,
        `string:${iface}`,
        `string:${key}`,
        `variant:${variantType}:${value}`
      );
    }
  }

  _clearLinux() {
    const busName = 'org.mpris.MediaPlayer2.Buddy';
    const objectPath = '/org/mpris/MediaPlayer2';

    this._dbusSend(
      busName,
      objectPath,
      'org.mpris.MediaPlayer2.Player.PlaybackStatus',
      'string:Stopped'
    );
  }

  /**
   * 发送 D-Bus 消息
   */
  _dbusSend(dest, path, method, ...args) {
    try {
      const cmdArgs = [
        '--session',
        '--type=method_call',
        '--dest', dest,
        path,
        method,
        ...args,
      ];
      execFile('dbus-send', cmdArgs, { timeout: 3000 }, (err) => {
        if (err) {
          // D-Bus 发送失败，可能目标不存在
        }
      });
    } catch {
      // 静默处理
    }
  }

  // ── 工具方法 ──────────────────────────────────────────

  _exec(cmd, args = []) {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: 5000 }, (err, stdout, stderr) => {
        if (err) reject(err);
        else resolve(stdout.trim());
      });
    });
  }
}

module.exports = { MediaControl };
