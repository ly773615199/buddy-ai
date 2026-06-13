/**
 * Sprint 5 D3: 时间感知
 *
 * 根据一天中的时间驱动光灵行为变化：
 * - 早上 (6-9) → 光灵阳光色、活跃
 * - 上午 (9-12) → 专注模式
 * - 午饭 (12-13) → 光灵"饿了"
 * - 下午 (13-17) → 正常工作
 * - 傍晚 (17-19) → 光灵"想走"
 * - 晚上 (19-22) → 放松模式
 * - 深夜 (22-6) → 光灵变暗、安静、打瞌睡
 */

class TimeAwareness {
  constructor(options = {}) {
    this.timezone = options.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    this.onTimeChange = options.onTimeChange || (() => {});
    this.checkIntervalMs = options.checkIntervalMs || 60000; // 每分钟检查

    this._timer = null;
    this._currentPhase = null;
    this._isRunning = false;
  }

  start() {
    if (this._isRunning) return;
    this._isRunning = true;
    this._check();
    this._timer = setInterval(() => this._check(), this.checkIntervalMs);
    console.log(`[TimeAwareness] 已启动 (${this.timezone})`);
  }

  stop() {
    this._isRunning = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  _check() {
    const now = new Date();
    const hour = now.getHours();
    const phase = this._getPhase(hour);

    if (phase.name !== this._currentPhase) {
      this._currentPhase = phase.name;
      this.onTimeChange({
        ...phase,
        hour,
        timestamp: now.getTime(),
        timezone: this.timezone,
      });
    }
  }

  _getPhase(hour) {
    if (hour >= 6 && hour < 9) {
      return {
        name: 'morning',
        label: '☀️ 早晨',
        energy: 0.8,
        mood: 'happy',
        colorShift: { hue: 15, sat: 1.2, bright: 1.1 },  // 暖色偏亮
        particleSpeed: 1.2,
        description: '新的一天开始了',
      };
    }
    if (hour >= 9 && hour < 12) {
      return {
        name: 'morning_work',
        label: '🎯 上午',
        energy: 0.9,
        mood: 'calm',
        colorShift: { hue: 0, sat: 1.0, bright: 1.0 },
        particleSpeed: 1.0,
        description: '专注工作时间',
      };
    }
    if (hour >= 12 && hour < 13) {
      return {
        name: 'lunch',
        label: '🍚 午饭',
        energy: 0.5,
        mood: 'tired',
        colorShift: { hue: 20, sat: 0.9, bright: 0.9 },
        particleSpeed: 0.7,
        description: '该吃饭了',
      };
    }
    if (hour >= 13 && hour < 17) {
      return {
        name: 'afternoon',
        label: '☕ 下午',
        energy: 0.7,
        mood: 'neutral',
        colorShift: { hue: -5, sat: 1.0, bright: 0.95 },
        particleSpeed: 0.9,
        description: '下午继续',
      };
    }
    if (hour >= 17 && hour < 19) {
      return {
        name: 'evening',
        label: '🌅 傍晚',
        energy: 0.6,
        mood: 'calm',
        colorShift: { hue: 25, sat: 1.1, bright: 0.85 },  // 暖色偏暗
        particleSpeed: 0.8,
        description: '快到下班时间了',
      };
    }
    if (hour >= 19 && hour < 22) {
      return {
        name: 'night',
        label: '🌙 晚上',
        energy: 0.5,
        mood: 'calm',
        colorShift: { hue: -20, sat: 0.8, bright: 0.7 },  // 冷色偏暗
        particleSpeed: 0.6,
        description: '放松时间',
      };
    }
    // 深夜 22-6
    return {
      name: 'late_night',
      label: '😴 深夜',
      energy: 0.2,
      mood: 'tired',
      colorShift: { hue: -30, sat: 0.5, bright: 0.4 },  // 很暗
      particleSpeed: 0.3,
      description: '该休息了',
    };
  }

  /** 获取当前阶段（外部查询用） */
  getCurrentPhase() {
    const hour = new Date().getHours();
    return this._getPhase(hour);
  }

  destroy() {
    this.stop();
  }
}

module.exports = { TimeAwareness };
