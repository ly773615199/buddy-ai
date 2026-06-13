/**
 * Sprint 6 D1-D2: 自主行为系统
 *
 * 光灵不依赖用户操作，有自己的"生活"：
 *
 * idle 行为：
 * - 在屏幕上缓慢飘移
 * - 偶尔做出随机动作（闪烁/旋转/变色）
 * - 靠近窗口边缘时"折返"
 * - 长时间无操作 → 变小、变暗、进入"睡眠"
 *
 * 环境感知行为：
 * - 靠近代码编辑器 → 粒子变"代码绿"
 * - 靠近浏览器 → 粒子变"搜索蓝"
 * - 窗口最小化 → 光灵"失去依靠"，飘到屏幕中央
 * - 窗口最大化 → 光灵"被挤到边上"
 */

const { screen, BrowserWindow } = require('electron');

class AutonomousBehavior {
  constructor(options = {}) {
    this.floatingWindow = options.floatingWindow || null;
    this.onBehavior = options.onBehavior || (() => {});

    // 飘移参数
    this._drift = {
      x: 0, y: 0,           // 当前偏移（相对锚点）
      vx: 0, vy: 0,         // 速度
      targetX: 0, targetY: 0, // 目标点
      speed: 0.3,            // 基础速度
      wanderRadius: 80,      // 游荡半径
    };

    // 行为状态
    this._state = {
      phase: 'idle',         // idle/wander/sleep/curious/alert
      lastInteraction: Date.now(),
      sleepLevel: 0,         // 0-1，渐进睡眠
      energy: 1.0,           // 0-1
      boredom: 0,            // 0-1，无聊程度
    };

    // 随机行为计时
    this._randomActionTimer = null;
    this._driftTimer = null;
    this._sleepTimer = null;
    this._isRunning = false;

    // 行为预设
    this._actions = [
      { name: 'blink', weight: 3, duration: 500 },
      { name: 'spin', weight: 1, duration: 1000 },
      { name: 'stretch', weight: 2, duration: 800 },
      { name: 'look_around', weight: 2, duration: 1200 },
      { name: 'yawn', weight: 1, duration: 1500 },
      { name: 'bounce', weight: 2, duration: 600 },
      { name: 'wiggle', weight: 2, duration: 700 },
      { name: 'pulse', weight: 1, duration: 900 },
    ];
  }

  start() {
    if (this._isRunning) return;
    this._isRunning = true;
    this._state.lastInteraction = Date.now();

    // 飘移循环 (~60fps 等效，但用 setInterval 降低 CPU)
    this._driftTimer = setInterval(() => this._tickDrift(), 50);

    // 随机行为（每 5-15 秒）
    this._scheduleRandomAction();

    // 睡眠检测（每 10 秒）
    this._sleepTimer = setInterval(() => this._checkSleep(), 10000);

    console.log('[AutonomousBehavior] 已启动');
  }

  stop() {
    this._isRunning = false;
    if (this._driftTimer) { clearInterval(this._driftTimer); this._driftTimer = null; }
    if (this._randomActionTimer) { clearTimeout(this._randomActionTimer); this._randomActionTimer = null; }
    if (this._sleepTimer) { clearInterval(this._sleepTimer); this._sleepTimer = null; }
  }

  /** 用户交互时调用 — 重置睡眠/无聊 */
  onUserInteraction() {
    this._state.lastInteraction = Date.now();
    this._state.sleepLevel = 0;
    this._state.boredom = Math.max(0, this._state.boredom - 0.3);
    this._state.energy = Math.min(1, this._state.energy + 0.1);
    if (this._state.phase === 'sleep') {
      this._state.phase = 'idle';
      this.onBehavior({ type: 'wake', description: '光灵醒了' });
    }
  }

  /** 通知光灵窗口位置（用于边缘折返） */
  updateWindowPosition(x, y) {
    this._drift.x = x;
    this._drift.y = y;
  }

  // ==================== 内部方法 ====================

  _tickDrift() {
    if (!this._isRunning || !this.floatingWindow?.window) return;
    if (this._state.phase === 'sleep') return; // 睡眠时不飘移

    const d = this._drift;
    const win = this.floatingWindow.window;

    // 获取屏幕工作区
    const display = screen.getDisplayNearestPoint(win.getBounds());
    const workArea = display.workArea;
    const spriteSize = this.floatingWindow.spriteSize || 160;

    // 当前窗口位置
    const bounds = win.getBounds();

    // 生成新目标点（如果到达目标或没有目标）
    const distToTarget = Math.sqrt((bounds.x - d.targetX) ** 2 + (bounds.y - d.targetY) ** 2);
    if (distToTarget < 10 || (d.targetX === 0 && d.targetY === 0)) {
      this._pickNewTarget(workArea, spriteSize);
    }

    // 朝目标移动
    const dx = d.targetX - bounds.x;
    const dy = d.targetY - bounds.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const speed = d.speed * (0.5 + this._state.energy * 0.5);

    d.vx = (dx / dist) * speed;
    d.vy = (dy / dist) * speed;

    // 边缘折返力
    const margin = 30;
    const left = workArea.x;
    const right = workArea.x + workArea.width - spriteSize;
    const top = workArea.y;
    const bottom = workArea.y + workArea.height - spriteSize;

    if (bounds.x < left + margin) d.vx += 0.5;
    if (bounds.x > right - margin) d.vx -= 0.5;
    if (bounds.y < top + margin) d.vy += 0.5;
    if (bounds.y > bottom - margin) d.vy -= 0.5;

    // 微小随机抖动（让运动更自然）
    d.vx += (Math.random() - 0.5) * 0.1;
    d.vy += (Math.random() - 0.5) * 0.1;

    // 应用位置
    const newX = Math.round(bounds.x + d.vx);
    const newY = Math.round(bounds.y + d.vy);

    // 钳制在屏幕内
    const clampedX = Math.max(left, Math.min(right, newX));
    const clampedY = Math.max(top, Math.min(bottom, newY));

    try {
      win.setPosition(clampedX, clampedY);
    } catch { /* window may be destroyed */ }
  }

  _pickNewTarget(workArea, spriteSize) {
    const d = this._drift;
    const margin = 60;

    // 随机目标点（在屏幕工作区内）
    d.targetX = workArea.x + margin + Math.random() * (workArea.width - spriteSize - margin * 2);
    d.targetY = workArea.y + margin + Math.random() * (workArea.height - spriteSize - margin * 2);

    // 偶尔飘到边缘（好奇心）
    if (Math.random() < 0.15) {
      const edge = Math.floor(Math.random() * 4);
      switch (edge) {
        case 0: d.targetX = workArea.x + 20; break;          // 左
        case 1: d.targetX = workArea.x + workArea.width - spriteSize - 20; break; // 右
        case 2: d.targetY = workArea.y + 20; break;          // 上
        case 3: d.targetY = workArea.y + workArea.height - spriteSize - 20; break; // 下
      }
    }
  }

  _scheduleRandomAction() {
    if (!this._isRunning) return;

    // 5-15 秒随机间隔
    const delay = 5000 + Math.random() * 10000;
    this._randomActionTimer = setTimeout(() => {
      this._performRandomAction();
      this._scheduleRandomAction();
    }, delay);
  }

  _performRandomAction() {
    if (!this._isRunning) return;

    // 加权随机选择行为
    const totalWeight = this._actions.reduce((s, a) => s + a.weight, 0);
    let roll = Math.random() * totalWeight;
    let action = this._actions[0];
    for (const a of this._actions) {
      roll -= a.weight;
      if (roll <= 0) { action = a; break; }
    }

    // 无聊时更频繁做动作
    this._state.boredom = Math.min(1, this._state.boredom + 0.05);

    this.onBehavior({
      type: 'random_action',
      action: action.name,
      duration: action.duration,
      description: this._getActionDescription(action.name),
      energy: this._state.energy,
      boredom: this._state.boredom,
    });
  }

  _checkSleep() {
    if (!this._isRunning) return;

    const idleMs = Date.now() - this._state.lastInteraction;
    const idleMinutes = idleMs / 60000;

    // 5 分钟无操作 → 开始变困
    if (idleMinutes > 5) {
      this._state.sleepLevel = Math.min(1, (idleMinutes - 5) / 10); // 5-15 分钟渐进
      this._state.energy = Math.max(0.1, 1 - this._state.sleepLevel * 0.8);

      if (this._state.sleepLevel > 0.3 && this._state.phase !== 'sleep') {
        this._state.phase = 'drowsy';
        this.onBehavior({
          type: 'drowsy',
          sleepLevel: this._state.sleepLevel,
          description: '光灵开始犯困',
        });
      }

      // 完全睡眠
      if (this._state.sleepLevel > 0.8 && this._state.phase !== 'sleep') {
        this._state.phase = 'sleep';
        this.onBehavior({
          type: 'sleep',
          sleepLevel: 1,
          description: '光灵睡着了',
        });
      }
    } else {
      this._state.sleepLevel = 0;
      this._state.energy = Math.min(1, this._state.energy + 0.02);
    }
  }

  _getActionDescription(name) {
    const descriptions = {
      blink: '眨了眨眼',
      spin: '转了个圈',
      stretch: '伸了个懒腰',
      look_around: '四处张望',
      yawn: '打了个哈欠',
      bounce: '蹦跶了一下',
      wiggle: '扭了扭身子',
      pulse: '发出柔和的光芒',
    };
    return descriptions[name] || '做了个动作';
  }

  destroy() {
    this.stop();
  }
}

module.exports = { AutonomousBehavior };
