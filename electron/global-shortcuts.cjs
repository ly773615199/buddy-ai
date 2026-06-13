/**
 * 全局快捷键模块
 *
 * 使用 Electron 的 globalShortcut API 注册系统级热键，
 * 将快捷键动作统一回调给主进程。
 */

const { globalShortcut } = require('electron');

const IS_MAC = process.platform === 'darwin';
const MOD = IS_MAC ? 'CommandOrControl' : 'Control';

const SHORTCUT_DEFS = [
  { accelerator: `${MOD}+Shift+B`, action: 'toggle_window', description: '唤出/隐藏主窗口' },
  { accelerator: `${MOD}+Shift+Space`, action: 'push_to_talk', description: '按住说话' },
  { accelerator: `${MOD}+Shift+M`, action: 'toggle_mute', description: '静音麦克风' },
  { accelerator: `${MOD}+Shift+S`, action: 'screenshot_analyze', description: '截图分析' },
  { accelerator: `${MOD}+Shift+V`, action: 'clipboard_analyze', description: '剪贴板分析' },
];

class GlobalShortcuts {
  /**
   * @param {object} options
   * @param {function} options.onAction - (action: string) => void
   * @param {Electron.BrowserWindow} [options.mainWindow]
   */
  constructor(options = {}) {
    this.onAction = options.onAction || (() => {});
    this.mainWindow = options.mainWindow || null;

    this._registered = [];       // 成功注册的快捷键 accelerator 列表
    this._ptkTimer = null;       // push_to_talk 轮询定时器
    this._ptkActive = false;     // push_to_talk 当前是否激活
  }

  /** 注册所有预设快捷键 */
  registerAll() {
    for (const def of SHORTCUT_DEFS) {
      this._register(def);
    }
    console.log(`[GlobalShortcuts] 已注册 ${this._registered.length}/${SHORTCUT_DEFS.length} 个快捷键`);
  }

  /** 注销所有已注册的快捷键 */
  unregisterAll() {
    this._stopPtkPolling();
    globalShortcut.unregisterAll();
    this._registered = [];
    console.log('[GlobalShortcuts] 已注销所有快捷键');
  }

  /** 获取当前状态 */
  getStatus() {
    return {
      platform: process.platform,
      modifier: MOD,
      registered: this._registered.slice(),
      total: SHORTCUT_DEFS.length,
      pushToTalkActive: this._ptkActive,
    };
  }

  /** 设置主窗口引用 */
  setMainWindow(win) {
    this.mainWindow = win;
  }

  // ==================== 内部方法 ====================

  _register(def) {
    try {
      const ok = globalShortcut.register(def.accelerator, () => {
        if (def.action === 'push_to_talk') {
          this._handlePushToTalk();
        } else {
          this.onAction(def.action);
        }
      });

      if (ok) {
        this._registered.push(def.accelerator);
        console.log(`[GlobalShortcuts] 注册成功: ${def.accelerator} → ${def.action}`);
      } else {
        console.warn(`[GlobalShortcuts] 注册失败 (返回 false): ${def.accelerator} → ${def.action}`);
      }
    } catch (err) {
      console.warn(`[GlobalShortcuts] 注册异常: ${def.accelerator} → ${err.message}`);
    }
  }

  /**
   * push_to_talk 特殊处理：
   * globalShortcut 不支持 keyup 事件，所以用定时器轮询按键状态。
   * 按下时发送 'push_to_talk_start'，松开后发送 'push_to_talk_end'。
   */
  _handlePushToTalk() {
    if (this._ptkActive) {
      // 连续触发视为仍在按住，忽略
      return;
    }

    this._ptkActive = true;
    this.onAction('push_to_talk_start');

    // 每 100ms 检测按键是否仍被按住
    // 通过尝试重新注册来检测：如果原注册仍存在则按键仍在按住
    // 更实用的方案：用一个标记 + 定时器，假设单次触发是按下，
    // 在短暂无后续触发后判定为松开
    this._startPtkPolling();
  }

  _startPtkPolling() {
    this._stopPtkPolling();

    let missedCount = 0;
    const MAX_MISSED = 3; // 300ms 无新触发则视为松开

    // 用 globalShortcut.isRegistered 检测
    // 原理：在按键按住期间会持续触发回调，松开后停止触发
    // 我们在每次轮询时检查注册状态，并通过一个"最后触发时间"来判定
    this._ptkLastTrigger = Date.now();

    // 注册一个辅助快捷键来检测按键状态（不可靠，改用时间判定）
    this._ptkTimer = setInterval(() => {
      const elapsed = Date.now() - this._ptkLastTrigger;
      if (elapsed > 300) {
        // 超过 300ms 没有新触发，认为按键已松开
        this._ptkActive = false;
        this.onAction('push_to_talk_end');
        this._stopPtkPolling();
      }
    }, 100);
  }

  _stopPtkPolling() {
    if (this._ptkTimer) {
      clearInterval(this._ptkTimer);
      this._ptkTimer = null;
    }
  }
}

module.exports = { GlobalShortcuts };
