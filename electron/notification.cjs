/**
 * Sprint 5 D5: 主动通知系统
 *
 * 系统事件 → 光灵闪烁/声音/弹窗
 * - 新邮件/消息 → 光灵闪烁、飘到屏幕角落
 * - 日历事件快到 → 光灵做出"提醒"姿态
 * - 工具执行完成 → 光灵做出"搞定了"姿态
 * - 系统异常 → 光灵做出"警报"姿态
 */

const { Notification, shell } = require('electron');

class NotificationManager {
  constructor(options = {}) {
    this.onNotify = options.onNotify || (() => {});
    this.enableSystemNotifications = options.enableSystemNotifications !== false;
    this.enableSound = options.enableSound !== false;
    this.enableFlash = options.enableFlash !== false;

    this._isRunning = false;
    this._notificationQueue = [];
    this._lastNotification = 0;
    this._throttleMs = 2000; // 最短 2 秒间隔
  }

  start() {
    this._isRunning = true;
    console.log('[NotificationManager] 已启动');
  }

  stop() {
    this._isRunning = false;
    this._notificationQueue = [];
  }

  /**
   * 发送通知
   * @param {object} params
   * @param {string} params.type - 通知类型: calendar/tool/email/system/buddy/custom
   * @param {string} params.title - 标题
   * @param {string} params.body - 内容
   * @param {string} params.reaction - 光灵反应: alert/remind/celebrate/warn
   * @param {string} params.mood - 情绪影响
   * @param {string} params.urgency - 紧急度: low/normal/high/critical
   * @param {string} [params.url] - 点击打开的 URL
   * @param {Function} [params.onClick] - 点击回调
   */
  notify(params) {
    if (!this._isRunning) return;

    const now = Date.now();
    const urgency = params.urgency || 'normal';

    // 节流（紧急通知跳过节流）
    if (urgency !== 'critical' && now - this._lastNotification < this._throttleMs) {
      this._notificationQueue.push(params);
      return;
    }

    this._lastNotification = now;

    // 光灵反应
    const reaction = this._getReaction(params);
    this.onNotify({ ...params, ...reaction });

    // 系统通知
    if (this.enableSystemNotifications && urgency !== 'low') {
      this._showSystemNotification(params);
    }
  }

  /**
   * 日历提醒快捷方法
   */
  calendarReminder(eventTitle, minutesLeft) {
    this.notify({
      type: 'calendar',
      title: '📅 日程提醒',
      body: `${eventTitle} — ${minutesLeft} 分钟后开始`,
      reaction: 'remind',
      mood: 'curious',
      urgency: minutesLeft <= 5 ? 'high' : 'normal',
    });
  }

  /**
   * 工具完成快捷方法
   */
  toolComplete(toolName, success) {
    this.notify({
      type: 'tool',
      title: success ? '✅ 任务完成' : '❌ 任务失败',
      body: toolName,
      reaction: success ? 'celebrate' : 'warn',
      mood: success ? 'happy' : 'concerned',
      urgency: success ? 'low' : 'normal',
    });
  }

  /**
   * Buddy 主动对话快捷方法
   */
  buddyMessage(message) {
    this.notify({
      type: 'buddy',
      title: '🐾 Buddy',
      body: message,
      reaction: 'attention',
      mood: 'curious',
      urgency: 'low',
    });
  }

  /**
   * 系统异常快捷方法
   */
  systemAlert(message) {
    this.notify({
      type: 'system',
      title: '⚠️ 系统警告',
      body: message,
      reaction: 'alert',
      mood: 'anxious',
      urgency: 'high',
    });
  }

  _getReaction(params) {
    const reactions = {
      calendar: {
        particleEffect: 'pulse',
        particleColor: '#ffd700',
        flashCount: 3,
        particleSpeedMul: 1.2,
      },
      tool: {
        particleEffect: params.reaction === 'celebrate' ? 'burst' : 'shake',
        particleColor: params.reaction === 'celebrate' ? '#3fb950' : '#f85149',
        flashCount: params.reaction === 'celebrate' ? 5 : 2,
        particleSpeedMul: 1.3,
      },
      buddy: {
        particleEffect: 'gentle_pulse',
        particleColor: '#58a6ff',
        flashCount: 1,
        particleSpeedMul: 1.0,
      },
      system: {
        particleEffect: 'alert_flash',
        particleColor: '#f85149',
        flashCount: 8,
        particleSpeedMul: 1.5,
      },
      email: {
        particleEffect: 'pulse',
        particleColor: '#a371f7',
        flashCount: 2,
        particleSpeedMul: 1.1,
      },
    };

    return reactions[params.type] || reactions.buddy;
  }

  _showSystemNotification(params) {
    try {
      const notification = new Notification({
        title: params.title,
        body: params.body,
        silent: !this.enableSound,
        urgency: params.urgency === 'critical' ? 'critical' : params.urgency === 'high' ? 'normal' : 'low',
      });

      notification.on('click', () => {
        if (params.url) shell.openExternal(params.url);
        if (params.onClick) params.onClick();
      });

      notification.show();
    } catch (e) {
      console.warn('[NotificationManager] 系统通知失败:', e.message);
    }
  }

  destroy() {
    this.stop();
  }
}

module.exports = { NotificationManager };
