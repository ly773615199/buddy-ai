/**
 * 感知→情绪映射管线 — 让传感器数据影响灵伴情绪
 *
 * 策略：
 * - 语音情绪 → 映射到已有的 user_voice_* buff keys
 * - 环境声音/光照 → 新增 buff keys（需在 engine.ts BUFF_TEMPLATES 中注册）
 * - 用户交互 → 映射到已有的 buff keys
 * - 时间 → 映射到已有的 late_night/morning
 *
 * 通过 Cerebellum.bodyState.applyBuff(key) 注入
 */

import type { Cerebellum } from '../brain/cerebellum/index.js';

// ==================== 感知事件 ====================

export interface PerceptionEvent {
  source: 'voice' | 'sound' | 'environment' | 'user' | 'clock';
  type: string;
  data?: unknown;
  timestamp: number;
}

// ==================== 事件→Buff Key 映射 ====================

/** 语音情绪 → 已有 buff key */
const VOICE_BUFF_MAP: Record<string, string> = {
  excited: 'user_voice_excited',
  happy:   'user_voice_happy',
  sad:     'user_voice_sad',
  angry:   'user_voice_angry',
  anxious: 'user_voice_anxious',
  tired:   'user_voice_tired',
  neutral: 'user_voice_neutral',
  calm:    'user_voice_neutral',
};

/** 环境声音 → buff key（需在 engine.ts 注册） */
const SOUND_BUFF_MAP: Record<string, string> = {
  doorbell:    'sound_doorbell',
  knock:       'sound_doorbell',   // 复用
  alarm:       'sound_alarm',
  music:       'sound_music',
  speech:      'sound_speech',
  pet:         'sound_pet',
  glass_break: 'sound_glass_break',
  silence:     'sound_silence',
};

/** 环境数据 → buff key */
const ENV_BUFF_MAP: Record<string, string> = {
  dark:   'env_dark',
  bright: 'env_bright',
  noisy:  'env_noisy',
  quiet:  'env_quiet',
};

/** 用户交互 → buff key */
const USER_BUFF_MAP: Record<string, string> = {
  praise:       'user_praise',
  correction:   'user_voice_sad',     // 复用
  encouragement: 'user_voice_happy',  // 复用
  negation:     'user_voice_angry',   // 复用
  message:      'user_message',
};

// ==================== PerceptionBridge ====================

export class PerceptionBridge {
  private cerebellum: Cerebellum;
  private recentEvents: PerceptionEvent[] = [];
  private maxRecentEvents = 50;
  private userLastInteraction: number = Date.now();
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(cerebellum: Cerebellum) {
    this.cerebellum = cerebellum;
  }

  /** 启动定期 tick（每 60 秒检查一次） */
  start(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.tick(), 60_000);
  }

  /** 停止定期 tick */
  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /**
   * 处理感知事件 → 注入情绪 Buff
   */
  onPerception(event: PerceptionEvent): void {
    this.recentEvents.push(event);
    if (this.recentEvents.length > this.maxRecentEvents) {
      this.recentEvents.shift();
    }

    if (event.source === 'user') {
      this.userLastInteraction = event.timestamp;
    }

    // 查找对应的 buff key
    let buffKey: string | undefined;

    switch (event.source) {
      case 'voice':
        buffKey = VOICE_BUFF_MAP[event.type];
        break;
      case 'sound':
        buffKey = SOUND_BUFF_MAP[event.type];
        break;
      case 'environment':
        buffKey = ENV_BUFF_MAP[event.type];
        break;
      case 'user':
        buffKey = USER_BUFF_MAP[event.type];
        break;
      case 'clock':
        buffKey = event.type === 'late_night' ? 'late_night' : event.type === 'morning' ? 'morning' : undefined;
        break;
    }

    if (buffKey) {
      this.cerebellum.bodyState.applyBuff(buffKey);
    }
  }

  /**
   * 定期检查（每 60 秒自动调用，或手动调用）
   */
  tick(): void {
    const now = Date.now();

    // 用户长时间不在 → 孤独感
    const absentMs = now - this.userLastInteraction;
    if (absentMs > 30 * 60_000) {
      this.cerebellum.bodyState.applyBuff('continuous_work');
    }

    // 深夜/清晨
    const hour = new Date().getHours();
    if (hour >= 23 || hour < 6) {
      this.cerebellum.bodyState.applyBuff('late_night');
    } else if (hour >= 6 && hour < 9) {
      this.cerebellum.bodyState.applyBuff('morning');
    }
  }

  /** 设置用户上次交互时间 */
  setUserLastInteraction(timestamp: number): void {
    this.userLastInteraction = timestamp;
  }

  /** 获取最近事件（调试） */
  getRecentEvents(): PerceptionEvent[] {
    return [...this.recentEvents];
  }
}
