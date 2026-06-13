/**
 * 系统音频捕获模块（Loopback）
 *
 * 捕获电脑正在播放的音频（系统声音）。
 * 使用 ffmpeg + 各平台原生 loopback 方案：
 * - Windows: WASAPI loopback (dshow)
 * - macOS:   avfoundation / BlackHole
 * - Linux:   PulseAudio monitor source
 */

const { spawn } = require('child_process');
const { ipcMain } = require('electron');

class SystemAudioCapture {
  constructor(options = {}) {
    this.onAudioData = options.onAudioData || (() => {});
    this.onError = options.onError || (() => {});
    this.sampleRate = options.sampleRate || 16000;

    this._ffmpeg = null;
    this._active = false;
    this._buffer = Buffer.alloc(0);
    this._frameSize = 1024; // PCM samples per frame
    this._bytesPerFrame = this._frameSize * 2; // 16-bit mono = 2 bytes/sample
  }

  /**
   * 是否正在捕获
   */
  get active() {
    return this._active;
  }

  /**
   * 启动系统音频捕获
   */
  async start() {
    if (this._active) {
      console.warn('[SystemAudioCapture] 已在运行中');
      return;
    }

    const platform = process.platform;
    try {
      if (platform === 'win32') {
        await this._startWindows();
      } else if (platform === 'darwin') {
        await this._startMacOS();
      } else if (platform === 'linux') {
        await this._startLinux();
      } else {
        throw new Error(`不支持的平台: ${platform}`);
      }
      this._active = true;
      console.log('[SystemAudioCapture] 已启动');
    } catch (err) {
      console.error('[SystemAudioCapture] 启动失败:', err.message);
      this.onError(err);
    }
  }

  /**
   * 停止音频捕获
   */
  stop() {
    if (this._ffmpeg) {
      this._ffmpeg.stdout?.removeAllListeners();
      this._ffmpeg.stderr?.removeAllListeners();
      this._ffmpeg.removeAllListeners();
      try { this._ffmpeg.kill('SIGTERM'); } catch (_) {}
      this._ffmpeg = null;
    }
    this._buffer = Buffer.alloc(0);
    this._active = false;
    console.log('[SystemAudioCapture] 已停止');
  }

  // ─── Windows: WASAPI loopback via dshow ───

  async _startWindows() {
    const device = await this._getWindowsLoopbackDevice();
    if (!device) {
      throw new Error('未找到系统音频 loopback 设备，请确认音频驱动支持 WASAPI loopback');
    }
    console.log(`[SystemAudioCapture] Windows 设备: ${device}`);
    this._spawnFfmpeg([
      '-f', 'dshow',
      '-i', `audio=${device}`,
      '-ac', '1',
      '-ar', String(this.sampleRate),
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      'pipe:1'
    ]);
  }

  /**
   * 枚举 dshow 设备，查找 loopback / stereo mix / 立体声混音
   */
  async _getWindowsLoopbackDevice() {
    return new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']);
      let stderr = '';
      proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      proc.on('close', () => {
        const lines = stderr.split('\n');
        const pattern = /loopback|stereo\s*mix|立体声混音/i;
        for (const line of lines) {
          const match = line.match(/"([^"]+)"\s*\(audio\)/);
          if (match && pattern.test(line)) {
            return resolve(match[1]);
          }
        }
        // 回退：尝试取第一个 audio 设备
        for (const line of lines) {
          const match = line.match(/"([^"]+)"\s*\(audio\)/);
          if (match) return resolve(match[1]);
        }
        resolve(null);
      });
      proc.on('error', (err) => reject(err));
    });
  }

  // ─── macOS: avfoundation ───

  async _startMacOS() {
    console.log('[SystemAudioCapture] macOS: 尝试 avfoundation');
    try {
      this._spawnFfmpeg([
        '-f', 'avfoundation',
        '-i', ':0',
        '-ac', '1',
        '-ar', String(this.sampleRate),
        '-f', 's16le',
        '-acodec', 'pcm_s16le',
        'pipe:1'
      ]);
    } catch (err) {
      throw new Error(
        'macOS 系统音频捕获失败。请安装 BlackHole (brew install blackhole-2ch) ' +
        '或确认 ffmpeg 已安装且支持 avfoundation。原始错误: ' + err.message
      );
    }
  }

  // ─── Linux: PulseAudio monitor source ───

  async _startLinux() {
    const monitorSource = await this._getLinuxMonitorSource();
    if (!monitorSource) {
      throw new Error('未找到 PulseAudio monitor 源。请确认 PulseAudio 正在运行并有音频输出设备。');
    }
    console.log(`[SystemAudioCapture] Linux monitor: ${monitorSource}`);
    this._spawnFfmpeg([
      '-f', 'pulse',
      '-i', monitorSource,
      '-ac', '1',
      '-ar', String(this.sampleRate),
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      'pipe:1'
    ]);
  }

  /**
   * 通过 pactl 查找 monitor 源
   */
  async _getLinuxMonitorSource() {
    return new Promise((resolve, reject) => {
      const proc = spawn('pactl', ['list', 'short', 'sources']);
      let stdout = '';
      proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      proc.on('close', () => {
        const lines = stdout.split('\n').filter(l => /monitor/i.test(l));
        if (lines.length > 0) {
          // 格式: <id> <name> <module> <sample> <state>
          const name = lines[0].split(/\s+/)[1];
          resolve(name || null);
        } else {
          resolve(null);
        }
      });
      proc.on('error', (err) => reject(err));
    });
  }

  // ─── ffmpeg 子进程管理 ───

  /**
   * 启动 ffmpeg 子进程并设置流解析
   */
  _spawnFfmpeg(args) {
    this._ffmpeg = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this._setupStreamParser();

    this._ffmpeg.on('error', (err) => {
      console.error('[SystemAudioCapture] ffmpeg 进程错误:', err.message);
      this.onError(err);
      this.stop();
    });

    this._ffmpeg.on('close', (code) => {
      if (this._active) {
        console.warn(`[SystemAudioCapture] ffmpeg 退出, code=${code}`);
        this._active = false;
        if (code !== 0 && code !== null) {
          this.onError(new Error(`ffmpeg 异常退出, code=${code}`));
        }
      }
    });
  }

  /**
   * 监听 ffmpeg stdout，按固定帧大小切分 PCM 数据
   */
  _setupStreamParser() {
    this._ffmpeg.stdout.on('data', (chunk) => {
      this._buffer = Buffer.concat([this._buffer, chunk]);

      while (this._buffer.length >= this._bytesPerFrame) {
        const frame = this._buffer.subarray(0, this._bytesPerFrame);
        this._buffer = this._buffer.subarray(this._bytesPerFrame);

        const pcm = frame.toString('base64');
        this.onAudioData({
          pcm,
          sampleRate: this.sampleRate,
          channels: 1,
          frameSize: this._frameSize,
          source: 'system'
        });
      }
    });
  }

  // ─── IPC 注册 ───

  /**
   * 注册 IPC 通信通道
   */
  static registerIPC(manager) {
    ipcMain.handle('system_audio_start', async (_event, options) => {
      return manager.start(options);
    });

    ipcMain.handle('system_audio_stop', () => {
      manager.stop();
    });

    ipcMain.handle('system_audio_status', () => {
      return { active: manager.active };
    });
  }

  /**
   * 销毁模块
   */
  destroy() {
    this.stop();
    this.onAudioData = null;
    this.onError = null;
    console.log('[SystemAudioCapture] 已销毁');
  }
}

module.exports = { SystemAudioCapture };
