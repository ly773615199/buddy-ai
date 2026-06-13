/**
 * 空闲行为系统 v2 — Utility AI 驱动的自主行为
 *
 * v1: 加权随机（骰子模型）
 * v2: Utility AI 打分（意图模型）— 每个行为都有动机
 *
 * 打分维度：
 *   needUrgency      × 0.35  需求紧迫度（六欲）
 *   moodAffinity     × 0.25  情绪亲和度
 *   personalityBias  × 0.15  人格倾向（OCEAN）
 *   contextRelevance × 0.15  环境相关性
 *   noveltyFactor    × 0.10  新鲜感
 *   + noise(chaos)           微小随机
 */

import type { Mood } from '../emotion/engine.js';
import type { OceanPersonality } from '../personality/ocean.js';
import type { DesireVector } from '../desire/engine.js';
import { scoreAction, selectAction, type ScoringContext } from './utility-scorer.js';
import { ContextProvider, type PerceptionEvent } from './context-provider.js';

// ==================== 类型 ====================

export type IdleAction = 'blink' | 'look_around' | 'yawn' | 'stretch' | 'wave' | 'think' | 'sleep' | 'peek';

export interface IdleConfig {
  /** 眨眼间隔 (ms) */
  blinkInterval: number;
  /** 触发空闲行为的间隔 (ms) */
  actionInterval: number;
  /** 是否启用 */
  enabled: boolean;
}

const DEFAULT_CONFIG: IdleConfig = {
  blinkInterval: 3000,
  actionInterval: 8000,
  enabled: true,
};

/** 行为描述（用于日志/前端显示） */
export const ACTION_DESCRIPTIONS: Record<IdleAction, string> = {
  blink: '眨眼',
  look_around: '东张西望',
  yawn: '打哈欠',
  stretch: '伸懒腰',
  wave: '挥手',
  think: '思考',
  sleep: '犯困',
  peek: '偷看',
};

/** 行为参数 — 前端用于驱动视觉效果 */
export interface ActionParams {
  action: IdleAction;
  duration: number;   // ms
  intensity: number;  // 0-1
  /** Utility 分数（调试用） */
  score?: number;
  /** 选择原因（调试用） */
  reason?: string;
}

/** 行为默认参数 */
const ACTION_DEFAULTS: Record<IdleAction, { duration: number; baseIntensity: number }> = {
  blink:      { duration: 200,  baseIntensity: 0.8 },
  look_around: { duration: 4000, baseIntensity: 0.6 },
  yawn:       { duration: 3000, baseIntensity: 0.7 },
  stretch:    { duration: 1500, baseIntensity: 0.8 },
  wave:       { duration: 1000, baseIntensity: 0.7 },
  think:      { duration: 5000, baseIntensity: 0.5 },
  sleep:      { duration: 0,    baseIntensity: 0 },
  peek:       { duration: 2000, baseIntensity: 0.6 },
};

// ==================== 行为链 ====================

interface ActionChain {
  trigger: IdleAction;
  followUp: {
    action: IdleAction;
    condition: (ctx: ScoringContext) => boolean;
    delay: number;
    probability: number;
  }[];
}

const ACTION_CHAINS: ActionChain[] = [
  {
    trigger: 'yawn',
    followUp: [
      {
        action: 'stretch',
        condition: (ctx) => ctx.desires.rest > 60,
        delay: 2000,
        probability: 0.6,
      },
      {
        action: 'sleep',
        condition: (ctx) => ctx.desires.rest > 85 && !ctx.userPresent,
        delay: 5000,
        probability: 0.4,
      },
    ],
  },
  {
    trigger: 'look_around',
    followUp: [
      {
        action: 'peek',
        condition: (ctx) => ctx.soundEvent != null && ctx.soundEvent !== 'silence',
        delay: 1000,
        probability: 0.5,
      },
      {
        action: 'think',
        condition: (ctx) => ctx.desires.curiosity > 60,
        delay: 3000,
        probability: 0.3,
      },
    ],
  },
  {
    trigger: 'wave',
    followUp: [
      {
        action: 'peek',
        condition: (ctx) => ctx.userPresent,
        delay: 1500,
        probability: 0.4,
      },
    ],
  },
  {
    trigger: 'think',
    followUp: [
      {
        action: 'look_around',
        condition: (ctx) => ctx.desires.curiosity > 50,
        delay: 4000,
        probability: 0.3,
      },
    ],
  },
];

// ==================== IdleBehavior v2 ====================

export class IdleBehavior {
  private config: IdleConfig;
  private blinkTimer: ReturnType<typeof setInterval> | null = null;
  private actionTimer: ReturnType<typeof setInterval> | null = null;
  private chainTimer: ReturnType<typeof setTimeout> | null = null;
  private onBlinkCallback?: () => void;
  private onActionCallback?: (action: IdleAction, params?: ActionParams) => void;

  /** 上下文聚合器（核心：替代原来的零散状态） */
  readonly contextProvider: ContextProvider;

  constructor(config?: Partial<IdleConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.contextProvider = new ContextProvider();
  }

  // ==================== 外部接口（保持向后兼容） ====================

  /** 设置情绪（影响行为权重） */
  setMood(mood: Mood): void {
    const emotion = this.contextProvider.getContext().emotion;
    this.contextProvider.updateEmotion(emotion, mood);
  }

  /** 设置 OCEAN 人格 */
  setOcean(ocean: OceanPersonality): void {
    this.contextProvider.updateOcean(ocean);
  }

  /** 设置欲望状态 */
  setDesires(desires: DesireVector): void {
    this.contextProvider.updateDesires(desires);
  }

  /** 设置 personalityStrength（成长系统） */
  setPersonalityStrength(ps: number): void {
    this.contextProvider.updatePersonalityStrength(ps);
  }

  /** 注册眨眼回调 */
  onBlink(callback: () => void): void {
    this.onBlinkCallback = callback;
  }

  /** 注册行为回调 */
  onAction(callback: (action: IdleAction, params?: ActionParams) => void): void {
    this.onActionCallback = callback;
  }

  // ==================== 感知接口（新增） ====================

  /** 接收感知事件（声音/语音情绪/环境/用户） */
  onPerception(event: PerceptionEvent): void {
    this.contextProvider.onPerception(event);
  }

  /** 设置用户在场状态 */
  setUserPresent(present: boolean): void {
    this.contextProvider.setUserPresent(present);
  }

  /** 记录用户交互 */
  recordUserInteraction(): void {
    this.contextProvider.recordUserInteraction();
  }

  // ==================== 生命周期 ====================

  /** 启动空闲行为循环 */
  start(): void {
    if (!this.config.enabled) return;
    this.stop();

    // 眨眼循环（保持原有逻辑，眨眼是生理行为不需要 Utility 打分）
    this.blinkTimer = setInterval(() => {
      this.onBlinkCallback?.();
    }, this.config.blinkInterval);

    // Utility AI 行为循环
    this.actionTimer = setInterval(() => {
      this.tick();
    }, this.config.actionInterval);
  }

  /** 停止 */
  stop(): void {
    if (this.blinkTimer) { clearInterval(this.blinkTimer); this.blinkTimer = null; }
    if (this.actionTimer) { clearInterval(this.actionTimer); this.actionTimer = null; }
    if (this.chainTimer) { clearTimeout(this.chainTimer); this.chainTimer = null; }
  }

  // ==================== 核心逻辑 ====================

  /** 单次行为选择 tick */
  private tick(): void {
    const ctx = this.contextProvider.getContext();

    // Utility AI 选择
    const action = selectAction(ctx);
    if (!action) return;

    // 计算行为参数
    const intensity = this.getMoodIntensity(ctx);
    const score = scoreAction(action, ctx);
    const params: ActionParams = {
      ...ACTION_DEFAULTS[action],
      action,
      intensity: clamp(ACTION_DEFAULTS[action].baseIntensity * (0.6 + intensity * 0.8), 0.3, 1.0),
      score,
      reason: this.explainChoice(action, ctx),
    };

    // 记录行为
    this.contextProvider.recordAction(action);

    // 触发回调
    this.onActionCallback?.(action, params);

    // 检查行为链
    this.scheduleChain(action, ctx);
  }

  /** 手动触发一次行为（调试用） */
  triggerRandom(): IdleAction | null {
    const ctx = this.contextProvider.getContext();
    const action = selectAction(ctx);
    if (action) {
      const intensity = this.getMoodIntensity(ctx);
      const score = scoreAction(action, ctx);
      const params: ActionParams = {
        ...ACTION_DEFAULTS[action],
        action,
        intensity: clamp(ACTION_DEFAULTS[action].baseIntensity * (0.6 + intensity * 0.8), 0.3, 1.0),
        score,
        reason: this.explainChoice(action, ctx),
      };
      this.contextProvider.recordAction(action);
      this.onActionCallback?.(action, params);
    }
    return action;
  }

  // ==================== 行为链 ====================

  /** 检查并调度行为链 */
  private scheduleChain(triggeredAction: IdleAction, ctx: ScoringContext): void {
    const chain = ACTION_CHAINS.find(c => c.trigger === triggeredAction);
    if (!chain) return;

    for (const followUp of chain.followUp) {
      if (followUp.condition(ctx) && Math.random() < followUp.probability) {
        // 清除之前的链（避免堆积）
        if (this.chainTimer) {
          clearTimeout(this.chainTimer);
          this.chainTimer = null;
        }

        this.chainTimer = setTimeout(() => {
          const currentCtx = this.contextProvider.getContext();
          // 再次检查条件（上下文可能已变化）
          if (followUp.condition(currentCtx)) {
            const intensity = this.getMoodIntensity(currentCtx);
            const params: ActionParams = {
              ...ACTION_DEFAULTS[followUp.action],
              action: followUp.action,
              intensity: clamp(ACTION_DEFAULTS[followUp.action].baseIntensity * (0.6 + intensity * 0.8), 0.3, 1.0),
              score: scoreAction(followUp.action, currentCtx),
              reason: `chain: ${triggeredAction} → ${followUp.action}`,
            };
            this.contextProvider.recordAction(followUp.action);
            this.onActionCallback?.(followUp.action, params);
          }
        }, followUp.delay);

        break; // 只执行第一个匹配的链
      }
    }
  }

  // ==================== 辅助 ====================

  /** 获取情绪强度 (0-1) */
  private getMoodIntensity(ctx: ScoringContext): number {
    const highEnergy = new Set<Mood>(['energetic', 'excited', 'happy']);
    const lowEnergy = new Set<Mood>(['tired', 'calm']);
    if (highEnergy.has(ctx.mood)) return 0.8;
    if (lowEnergy.has(ctx.mood)) return 0.4;
    return 0.6;
  }

  /** 解释选择原因（调试/日志用） */
  private explainChoice(action: IdleAction, ctx: ScoringContext): string {
    const reasons: string[] = [];

    // 需求驱动
    const d = ctx.desires;
    if (action === 'yawn' && d.rest > 60) reasons.push(`rest=${d.rest}`);
    if (action === 'wave' && d.social > 60) reasons.push(`social=${d.social}`);
    if (action === 'look_around' && d.curiosity > 60) reasons.push(`curiosity=${d.curiosity}`);
    if (action === 'peek' && d.hunger > 60) reasons.push(`hunger=${d.hunger}`);
    if (action === 'think' && d.curiosity > 50) reasons.push(`curiosity=${d.curiosity}`);
    if (action === 'sleep' && d.rest > 70) reasons.push(`rest=${d.rest}`);

    // 情绪驱动
    if (ctx.mood === 'excited' && action === 'wave') reasons.push('mood=excited');
    if (ctx.mood === 'tired' && action === 'yawn') reasons.push('mood=tired');
    if (ctx.mood === 'thinking' && action === 'think') reasons.push('mood=thinking');

    // 环境驱动
    if (ctx.soundEvent && action === 'look_around') reasons.push(`sound=${ctx.soundEvent}`);
    if (ctx.userPresent && action === 'wave') reasons.push('userPresent');
    if (ctx.hour >= 23 && action === 'sleep') reasons.push(`hour=${ctx.hour}`);

    return reasons.length > 0 ? reasons.join('+') : 'default';
  }
}

// ==================== 工具 ====================

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
