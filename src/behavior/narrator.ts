/**
 * 叙事引擎 — 让灵伴的"想法"可见
 *
 * 从内心独白、好奇心、情绪变化中生成叙述事件，
 * 通过 WS 推送到前端显示为灰色小字气泡。
 *
 * 不影响正常对话流程，属于"锦上添花"的表达层。
 */

import type { Mood } from '../emotion/engine.js';
import type { ScoringContext } from './utility-scorer.js';

// ==================== 类型 ====================

export interface NarrationEvent {
  /** 叙述类型 */
  type: 'thought' | 'curiosity' | 'mood_comment' | 'memory_flash' | 'realization';
  /** 内容文本 */
  content: string;
  /** 紧急度 0~1（越高越优先展示） */
  urgency: number;
  /** 视觉效果 */
  visual: {
    /** 面部表情提示 */
    expression?: string;
    /** 是否触发粒子特效 */
    particleBurst: boolean;
    /** 配套动作 */
    action?: string;
  };
  /** 时间戳 */
  timestamp: number;
}

// ==================== 情绪自评话术库 ====================

const MOOD_COMMENTS: Record<Mood, string[]> = {
  happy: ['心情不错~', '感觉很好呢', '嘿嘿~', '开心~'],
  excited: ['好兴奋！', '感觉充满能量！', '耶~'],
  tired: ['有点累了...', '需要休息一下', '眼皮好重...'],
  thinking: ['让我想想...', '嗯，有意思', '嗯...'],
  confused: ['嗯？', '这个有点奇怪', '啥？'],
  calm: ['...', '安静~', '嗯。'],
  energetic: ['精力充沛！', '来吧！', '准备好了！'],
  frustrated: ['有点烦...', '这个不太顺利', '唔...'],
  sleeping: ['zzZ...', '好困...'],
};

// ==================== 好奇心模板 ====================

const CURIOSITY_TEMPLATES = [
  '好奇这是什么呢',
  '想知道更多...',
  '这个好有意思',
  '咦？',
  '嗯？发生什么了',
  '想探索一下',
];

// ==================== 记忆闪回模板 ====================

const MEMORY_FLASH_TEMPLATES = [
  '想起之前...',
  '好像有过类似的经历',
  '这个感觉很熟悉',
  '记忆里有印象',
];

// ==================== NarratorEngine ====================

export class NarratorEngine {
  /** 最近一次叙述时间（防止过于频繁） */
  private lastNarrationTime = 0;
  /** 最小间隔（ms） */
  private minIntervalMs = 30_000;
  /** 最近叙述事件（防重复） */
  private recentContents: string[] = [];
  private maxRecent = 10;

  /**
   * 检查是否有叙述事件可以输出
   *
   * 调用时机：空闲行为选择前
   */
  checkForNarration(ctx: ScoringContext): NarrationEvent | null {
    const now = Date.now();
    if (now - this.lastNarrationTime < this.minIntervalMs) return null;

    // 按优先级检查
    return (
      this.checkMoodComment(ctx) ??
      this.checkCuriosity(ctx) ??
      this.checkMemoryFlash(ctx) ??
      null
    );
  }

  /** 情绪自评 */
  private checkMoodComment(ctx: ScoringContext): NarrationEvent | null {
    // 只在非平静状态且概率触发
    if (ctx.mood === 'calm') return null;
    if (Math.random() > 0.08) return null;

    const pool = MOOD_COMMENTS[ctx.mood] ?? ['...'];
    const content = this.pickUnique(pool);
    if (!content) return null;

    return {
      type: 'mood_comment',
      content,
      urgency: 0.3,
      visual: {
        expression: ctx.mood,
        particleBurst: false,
      },
      timestamp: Date.now(),
    };
  }

  /** 好奇心外化 */
  private checkCuriosity(ctx: ScoringContext): NarrationEvent | null {
    if (ctx.desires.curiosity < 55) return null;
    if (Math.random() > 0.05) return null;

    const content = this.pickUnique(CURIOSITY_TEMPLATES);
    if (!content) return null;

    return {
      type: 'curiosity',
      content,
      urgency: 0.4,
      visual: {
        expression: 'curious',
        particleBurst: true,
        action: 'look_around',
      },
      timestamp: Date.now(),
    };
  }

  /** 记忆闪回 */
  private checkMemoryFlash(ctx: ScoringContext): NarrationEvent | null {
    // 有声音事件或用户长时间不在时触发
    if (ctx.soundEvent == null && ctx.idleMinutes < 5) return null;
    if (Math.random() > 0.03) return null;

    const content = this.pickUnique(MEMORY_FLASH_TEMPLATES);
    if (!content) return null;

    return {
      type: 'memory_flash',
      content,
      urgency: 0.2,
      visual: {
        expression: 'thinking',
        particleBurst: false,
        action: 'think',
      },
      timestamp: Date.now(),
    };
  }

  /** 从池中选一个不重复的 */
  private pickUnique(pool: string[]): string | null {
    const available = pool.filter(c => !this.recentContents.includes(c));
    if (available.length === 0) {
      // 全部用过，清空历史
      this.recentContents = [];
      return pool[Math.floor(Math.random() * pool.length)];
    }
    const chosen = available[Math.floor(Math.random() * available.length)];
    this.recentContents.push(chosen);
    if (this.recentContents.length > this.maxRecent) this.recentContents.shift();
    this.lastNarrationTime = Date.now();
    return chosen;
  }

  /** 手动触发叙述（供外部事件调用） */
  forceNarration(type: NarrationEvent['type'], content: string, urgency = 0.5): NarrationEvent {
    this.lastNarrationTime = Date.now();
    return {
      type,
      content,
      urgency,
      visual: {
        particleBurst: urgency > 0.5,
      },
      timestamp: Date.now(),
    };
  }

  /** 重置冷却（用于特殊事件后立即允许叙述） */
  resetCooldown(): void {
    this.lastNarrationTime = 0;
  }
}
