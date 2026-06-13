import { MemoryStore } from '../memory/store.js';
import type { PetManager } from '../pet/manager.js';
import type { FeedbackSignal } from '../brain/convergence/feedback-sink.js';

/**
 * 反馈学习器 — 从用户的纠正和反馈中学习
 */

export interface Correction {
  type: 'correction' | 'remember' | 'preference' | 'encouragement';
  content: string;
  importance: number;
  negative?: boolean;
}

const CORRECTION_PATTERNS: Array<{ regex: RegExp; type: Correction['type']; importance: number; negative?: boolean }> = [
  // 纠正
  { regex: /^(不对|错了|不是这样|不不不|不是的)/, type: 'correction', importance: 7 },
  { regex: /^(你应该|你得|正确的是|应该是)/, type: 'correction', importance: 7 },
  { regex: /^(no|wrong|incorrect|that's not)/i, type: 'correction', importance: 7 },

  // 记住
  { regex: /^(记住|记下来|以后记住|别忘了)/, type: 'remember', importance: 9 },
  { regex: /^(remember|note that|keep in mind)/i, type: 'remember', importance: 9 },

  // 偏好（正面）
  { regex: /^(我喜欢|我偏好|以后就|以后都)/, type: 'preference', importance: 6 },
  { regex: /^(我喜欢你|好的|不错|很好|这样对)/, type: 'encouragement', importance: 3 },

  // 偏好（负面）
  { regex: /^(以后别|不要|别再|停止|别这样)/, type: 'preference', importance: 8, negative: true },
  { regex: /^(别说了|够了|烦了|少说点)/, type: 'preference', importance: 8, negative: true },
];

export class FeedbackLearner {
  private memory: MemoryStore;
  private pet: PetManager | null = null;
  /** 信号汇聚层回调（v3.1） */
  private onConverge: ((signal: FeedbackSignal) => void) | null = null;

  constructor(memory: MemoryStore) {
    this.memory = memory;
  }

  /** 注入 PetManager（养成 v2 统一亲密度管理） */
  setPetManager(pet: PetManager): void {
    this.pet = pet;
  }

  /** 注入信号汇聚层回调（v3.1） */
  setConvergenceCallback(callback: (signal: FeedbackSignal) => void): void {
    this.onConverge = callback;
  }

  /**
   * 检测用户消息中的反馈信号
   */
  detectCorrection(userMessage: string): Correction | null {
    const trimmed = userMessage.trim();

    for (const pattern of CORRECTION_PATTERNS) {
      if (pattern.regex.test(trimmed)) {
        return {
          type: pattern.type,
          content: trimmed,
          importance: pattern.importance,
          negative: pattern.negative,
        };
      }
    }

    return null;
  }

  /**
   * 应用反馈到记忆系统
   */
  applyCorrection(correction: Correction, previousTopic?: string): void {
    const category = `feedback_${correction.type}`;
    const key = previousTopic ?? 'general';

    // 存入记忆
    this.memory.setMemory(category, key, correction.content, correction.importance);

    // 养成 v2：亲密度由 PetManager 统一管理
    if (correction.negative) {
      this.pet?.addIntimacy(-2);
      this.memory.addDiaryEntry(`用户纠正了我: ${correction.content.slice(0, 100)}`, 'corrected');
    } else if (correction.type === 'encouragement') {
      this.pet?.addIntimacy(1);
    } else if (correction.type === 'remember') {
      // 高重要度记忆
      this.memory.setMemory('user_teaching', key, correction.content, 9);
      this.memory.addDiaryEntry(`用户教了我: ${correction.content.slice(0, 100)}`, 'learning');
    }

    // v3.1: 接入信号汇聚层
    this.onConverge?.({
      type: correction.type,
      content: correction.content,
      importance: correction.importance,
      negative: correction.negative,
    });
  }

  /**
   * 获取用户的偏好列表
   */
  getUserPreferences(): Array<{ key: string; value: string }> {
    const prefs = this.memory.getMemoriesByCategory('feedback_preference');
    const corrections = this.memory.getMemoriesByCategory('feedback_correction');
    return [...prefs, ...corrections].map(m => ({ key: m.key, value: m.value }));
  }

  /**
   * 获取用户教过我的东西
   */
  getUserTeachings(): Array<{ key: string; value: string }> {
    return this.memory.getMemoriesByCategory('user_teaching').map(m => ({ key: m.key, value: m.value }));
  }
}
