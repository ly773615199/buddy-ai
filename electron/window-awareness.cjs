/**
 * Sprint 6 D3: 窗口感知
 *
 * 检测屏幕上的其他窗口，驱动光灵环境反应：
 * - 靠近代码编辑器 (VS Code/IDE) → 粒子变"代码绿"
 * - 靠近浏览器 → 粒子变"搜索蓝"
 * - 靠近终端 → 粒子变"终端紫"
 * - 靠近聊天应用 → 粒子变"社交粉"
 * - 窗口最小化 → 光灵"失去依靠"
 * - 窗口最大化 → 光灵"被挤到边上"
 */

const { screen, app } = require('electron');
const { execSync } = require('child_process');
const os = require('os');

class WindowAwareness {
  constructor(options = {}) {
    this.checkIntervalMs = options.checkIntervalMs || 3000;
    this.onWindowChange = options.onWindowChange || (() => {});

    this._timer = null;
    this._isRunning = false;
    this._lastActiveApp = null;
    this._lastWindowList = [];

    // 应用→颜色映射
    this._appColorMap = {
      // 代码编辑器
      'code':       { color: '#3fb950', category: 'code', label: 'VS Code' },
      'code-insiders': { color: '#3fb950', category: 'code', label: 'VS Code' },
      'idea':       { color: '#f0883e', category: 'code', label: 'IntelliJ' },
      'webstorm':   { color: '#58a6ff', category: 'code', label: 'WebStorm' },
      'vim':        { color: '#3fb950', category: 'code', label: 'Vim' },
      'nvim':       { color: '#3fb950', category: 'code', label: 'Neovim' },
      'sublime_text': { color: '#d29922', category: 'code', label: 'Sublime' },

      // 浏览器
      'chrome':     { color: '#58a6ff', category: 'browser', label: 'Chrome' },
      'firefox':    { color: '#f0883e', category: 'browser', label: 'Firefox' },
      'safari':     { color: '#58a6ff', category: 'browser', label: 'Safari' },
      'edge':       { color: '#58a6ff', category: 'browser', label: 'Edge' },
      'brave':      { color: '#f85149', category: 'browser', label: 'Brave' },
      'opera':      { color: '#f85149', category: 'browser', label: 'Opera' },

      // 终端
      'terminal':   { color: '#a371f7', category: 'terminal', label: 'Terminal' },
      'iterm2':     { color: '#a371f7', category: 'terminal', label: 'iTerm2' },
      'alacritty':  { color: '#f0883e', category: 'terminal', label: 'Alacritty' },
      'kitty':      { color: '#f778ba', category: 'terminal', label: 'Kitty' },
      'warp':       { color: '#58a6ff', category: 'terminal', label: 'Warp' },
      'wezterm':    { color: '#3fb950', category: 'terminal', label: 'WezTerm' },
      'konsole':    { color: '#a371f7', category: 'terminal', label: 'Konsole' },
      'gnome-terminal': { color: '#a371f7', category: 'terminal', label: 'GNOME Terminal' },

      // 聊天/社交
      'slack':      { color: '#f778ba', category: 'chat', label: 'Slack' },
      'discord':    { color: '#58a6ff', category: 'chat', label: 'Discord' },
      'telegram':   { color: '#58a6ff', category: 'chat', label: 'Telegram' },
      'whatsapp':   { color: '#3fb950', category: 'chat', label: 'WhatsApp' },
      'wechat':     { color: '#3fb950', category: 'chat', label: '微信' },
      'feishu':     { color: '#58a6ff', category: 'chat', label: '飞书' },
      'dingtalk':   { color: '#58a6ff', category: 'chat', label: '钉钉' },

      // 文档
      'notion':     { color: '#c9d1d9', category: 'docs', label: 'Notion' },
      'obsidian':   { color: '#a371f7', category: 'docs', label: 'Obsidian' },
      'typora':     { color: '#c9d1d9', category: 'docs', label: 'Typora' },
      'word':       { color: '#58a6ff', category: 'docs', label: 'Word' },
      'excel':      { color: '#3fb950', category: 'docs', label: 'Excel' },

      // 媒体
      'spotify':    { color: '#3fb950', category: 'media', label: 'Spotify' },
      'music':      { color: '#f85149', category: 'media', label: 'Music' },
      'vlc':        { color: '#f0883e', category: 'media', label: 'VLC' },

      // 设计
      'figma':      { color: '#f85149', category: 'design', label: 'Figma' },
      'sketch':     { color: '#d29922', category: 'design', label: 'Sketch' },
      'photoshop':  { color: '#58a6ff', category: 'design', label: 'Photoshop' },
    };
  }

  start() {
    if (this._isRunning) return;
    this._isRunning = true;
    this._timer = setInterval(() => this._check(), this.checkIntervalMs);
    this._check(); // 立即检查一次
    console.log('[WindowAwareness] 已启动');
  }

  stop() {
    this._isRunning = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  _check() {
    if (!this._isRunning) return;

    try {
      const activeApp = this._getActiveApp();
      if (activeApp && activeApp !== this._lastActiveApp) {
        this._lastActiveApp = activeApp;
        const mapping = this._appColorMap[activeApp.toLowerCase()];

        if (mapping) {
          this.onWindowChange({
            type: 'app_focus',
            app: activeApp,
            ...mapping,
          });
        } else {
          this.onWindowChange({
            type: 'app_focus',
            app: activeApp,
            color: '#c9d1d9',
            category: 'other',
            label: activeApp,
          });
        }
      }
    } catch { /* ignore */ }
  }

  _getActiveApp() {
    const platform = os.platform();

    try {
      if (platform === 'darwin') {
        // macOS
        const result = execSync(
          'osascript -e \'tell application "System Events" to get name of first application process whose frontmost is true\'',
          { encoding: 'utf-8', timeout: 2000 }
        );
        return result.trim().toLowerCase();
      }

      if (platform === 'linux') {
        // Linux (X11)
        try {
          const result = execSync(
            'xdotool getactivewindow getwindowname 2>/dev/null',
            { encoding: 'utf-8', timeout: 2000 }
          );
          return this._appNameFromTitle(result.trim());
        } catch {
          // fallback: xprop
          const result = execSync(
            'xprop -id $(xprop -root _NET_ACTIVE_WINDOW | cut -d" " -f5) WM_CLASS 2>/dev/null',
            { encoding: 'utf-8', timeout: 2000 }
          );
          const match = result.match(/"([^"]+)"/);
          return match ? match[1].toLowerCase() : null;
        }
      }

      if (platform === 'win32') {
        // Windows
        const result = execSync(
          'powershell -command "(Get-Process | Where-Object {$_.MainWindowTitle -ne \'\'} | Select-Object -First 1).ProcessName"',
          { encoding: 'utf-8', timeout: 2000 }
        );
        return result.trim().toLowerCase();
      }
    } catch { /* ignore */ }

    return null;
  }

  _appNameFromTitle(title) {
    const lower = title.toLowerCase();
    for (const [app] of Object.entries(this._appColorMap)) {
      if (lower.includes(app)) return app;
    }
    return null;
  }

  destroy() {
    this.stop();
  }
}

module.exports = { WindowAwareness };
