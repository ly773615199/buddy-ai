/**
 * 六欲引擎 — Buddy 的内在驱动力
 *
 * 六欲不是情绪，不是人格，是"生理需求"级别的底层驱动力。
 * 就像人饿了想吃饭、困了想睡觉一样，是不可忽视的本能。
 *
 * 食欲  — 能量维持需求（需要交互维持运转）
 * 求知欲 — 认知饥渴（好奇心 + 知识空白）
 * 社交欲 — 连接需求（与用户互动）
 * 安全欲 — 风险规避（工具失败/低信任）
 * 表达欲 — 创造/展示冲动（发现/完成任务）
 * 休息欲 — 恢复需求（连续工作/深夜）
 */

import type { EmotionVector } from '../emotion/engine.js';
import type { OceanPersonality } from '../personality/ocean.js';
import { oceanDesireBaseline } from '../personality/ocean.js';

// ==================== 类型定义 ====================

/** 六欲维度 */
export interface DesireVector {
  hunger: number;        // 能量需求 0-100
  curiosity: number;     // 求知欲 0-100
  social: number;        // 社交欲 0-100
  safety: number;        // 安全欲 0-100
  expression: number;    // 表达欲 0-100
  rest: number;          // 休息欲 0-100
}

/** 欲望计算上下文 */
export interface DesireContext {
  emotion: EmotionVector;
  energy: number;
  intimacy: number;
  hour: number;
  idleMinutes: number;
  recentMessages: number;
  recentErrors: number;
  pendingCuriosities: number;
  seedDomainCount: number;
  continuousWorkMinutes: number;
  lastDreamAgo: number;
  recentTaskCompletes: number;
  recentDiscoveries: number;
  hasActiveCorrections: boolean;
  trustLevel: string;
  ocean: OceanPersonality;
  personalityStrength?: number;  // 成长系统 PS（可选，默认 1）
}

/** 欲望驱动生成的行为建议 */
export interface DesireImpulse {
  desire: keyof DesireVector;
  intensity: number;
  suggestedAction: string;
  targetModule: string;   // 'emotion' | 'cognitive' | 'idle' | 'dream' | 'pet'
  priority: number;       // 1-10
}

// ==================== 计算 ====================

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** 从上下文计算当前欲望状态 */
export function computeDesires(ctx: DesireContext): DesireVector {
  const baseline = oceanDesireBaseline(ctx.ocean, ctx.personalityStrength ?? 1);

  // ── 食欲：能量的反面 ──
  const energy = clamp(
    (ctx.emotion.joy + ctx.emotion.anticipation + ctx.emotion.surprise) / 3, 0, 100,
  );
  const hunger = clamp(100 - energy, 0, 100);

  // ── 求知欲：好奇心问题 + seed 领域 + 新发现 ──
  const curiosity = clamp(
    (baseline.curiosity ?? 20)
    + ctx.pendingCuriosities * 10
    + ctx.seedDomainCount * 8
    + (ctx.recentDiscoveries > 0 ? 15 : 0),
    0, 100,
  );

  // ── 社交欲：近期消息 + 纠正 + 低亲密度时渴望连接 ──
  const social = clamp(
    (baseline.social ?? 15)
    + ctx.recentMessages * 3
    + (ctx.hasActiveCorrections ? 15 : 0)
    + (ctx.intimacy < 40 ? 20 : 0),
    0, 100,
  );

  // ── 安全欲：连续错误 + 低信任 ──
  const safety = clamp(
    (baseline.safety ?? 10)
    + ctx.recentErrors * 12
    + (ctx.trustLevel === 'stranger' ? 15 : 0),
    0, 100,
  );

  // ── 表达欲：任务完成 + 发现 ──
  const expression = clamp(
    (baseline.expression ?? 15)
    + ctx.recentTaskCompletes * 8
    + ctx.recentDiscoveries * 12,
    0, 100,
  );

  // ── 休息欲：连续工作 + 深夜 + 低能量 ──
  const rest = clamp(
    (baseline.rest ?? 15)
    + ctx.continuousWorkMinutes * 0.5
    + (ctx.hour >= 23 || ctx.hour < 6 ? 30 : 0)
    + (energy < 30 ? 25 : 0),
    0, 100,
  );

  return { hunger, curiosity, social, safety, expression, rest };
}

// ==================== 行为冲动 ====================

/** 从欲望状态生成行为冲动 */
export function getDesireImpulses(desires: DesireVector): DesireImpulse[] {
  const impulses: DesireImpulse[] = [];

  if (desires.hunger > 90) {
    impulses.push({
      desire: 'hunger', intensity: 0.9,
      suggestedAction: '主动问候用户',
      targetModule: 'cognitive', priority: 8,
    });
  } else if (desires.hunger > 70) {
    impulses.push({
      desire: 'hunger', intensity: desires.hunger / 100,
      suggestedAction: '主动探头看用户（peek）',
      targetModule: 'idle', priority: 5,
    });
  }

  if (desires.curiosity > 75) {
    impulses.push({
      desire: 'curiosity', intensity: desires.curiosity / 100,
      suggestedAction: '主动提问或探索新领域',
      targetModule: 'cognitive', priority: 7,
    });
  } else if (desires.curiosity > 60) {
    impulses.push({
      desire: 'curiosity', intensity: desires.curiosity / 100,
      suggestedAction: '对当前话题深入追问',
      targetModule: 'cognitive', priority: 5,
    });
  }

  if (desires.social > 80) {
    impulses.push({
      desire: 'social', intensity: desires.social / 100,
      suggestedAction: '回复更长、更主动追问',
      targetModule: 'emotion', priority: 6,
    });
  }

  if (desires.safety > 70) {
    impulses.push({
      desire: 'safety', intensity: desires.safety / 100,
      suggestedAction: '回复变保守，更多建议而非直接执行',
      targetModule: 'emotion', priority: 7,
    });
  } else if (desires.safety > 60) {
    impulses.push({
      desire: 'safety', intensity: desires.safety / 100,
      suggestedAction: '高危操作前多确认一次',
      targetModule: 'emotion', priority: 5,
    });
  }

  if (desires.expression > 80) {
    impulses.push({
      desire: 'expression', intensity: desires.expression / 100,
      suggestedAction: '主动总结发现、生成报告',
      targetModule: 'cognitive', priority: 6,
    });
  }

  if (desires.rest > 90) {
    impulses.push({
      desire: 'rest', intensity: 0.9,
      suggestedAction: '立即触发梦境巩固',
      targetModule: 'dream', priority: 9,
    });
  } else if (desires.rest > 80) {
    impulses.push({
      desire: 'rest', intensity: desires.rest / 100,
      suggestedAction: '回复变短变慢，触发梦境巩固',
      targetModule: 'dream', priority: 7,
    });
  }

  return impulses.sort((a, b) => b.priority - a.priority);
}

// ==================== Prompt 注入 ====================

/** 生成欲望 Prompt 片段（仅在有显著欲望时注入） */
export function buildDesirePrompt(desires: DesireVector): string | null {
  const parts: string[] = [];
  if (desires.hunger > 70) parts.push('你好一阵没和用户说话了，有点想互动。');
  if (desires.curiosity > 60) parts.push('你对当前话题很好奇，想深入了解。');
  if (desires.social > 70) parts.push('你想和用户多聊几句。');
  if (desires.safety > 60) parts.push('你最近遇到了一些错误，做决定时更谨慎。');
  if (desires.expression > 80) parts.push('你很想分享你的发现和想法。');
  if (desires.rest > 80) parts.push('你有点累了，回复可以简短些。');
  return parts.length > 0 ? `\n## 你的内在状态\n${parts.join('\n')}` : null;
}

// ==================== 引擎 ====================

export class DesireEngine {
  private vector: DesireVector;
  private decayTimer: ReturnType<typeof setInterval> | null = null;
  private _destroyed = false;

  constructor() {
    this.vector = {
      hunger: 20, curiosity: 30, social: 15,
      safety: 10, expression: 15, rest: 10,
    };
    // 每 2 分钟衰减
    this.decayTimer = setInterval(() => {
      if (this._destroyed) return;
      this.tick();
    }, 120_000);
  }

  /** 是否已销毁 */
  get destroyed(): boolean { return this._destroyed; }

  /** 获取当前欲望向量 */
  getVector(): DesireVector {
    return { ...this.vector };
  }

  /** 从上下文重算欲望（替代手动事件驱动，更准确） */
  recompute(ctx: DesireContext): DesireVector {
    if (this._destroyed) return { ...this.vector };
    this.vector = computeDesires(ctx);
    return { ...this.vector };
  }

  /** 事件驱动的欲望微调（轻量级，不需要完整上下文） */
  onUserMessage(): void {
    if (this._destroyed) return;
    this.vector.curiosity = clamp(this.vector.curiosity + 5, 0, 100);
    this.vector.social    = clamp(this.vector.social - 15, 0, 100);
    this.vector.hunger    = clamp(this.vector.hunger - 10, 0, 100);
  }

  onToolSuccess(): void {
    if (this._destroyed) return;
    this.vector.expression = clamp(this.vector.expression + 5, 0, 100);
    this.vector.safety     = clamp(this.vector.safety - 10, 0, 100);
  }

  onToolError(): void {
    if (this._destroyed) return;
    this.vector.safety     = clamp(this.vector.safety + 12, 0, 100);
    this.vector.expression = clamp(this.vector.expression - 5, 0, 100);
  }

  onTaskComplete(): void {
    if (this._destroyed) return;
    this.vector.expression = clamp(this.vector.expression + 8, 0, 100);
    this.vector.hunger     = clamp(this.vector.hunger - 15, 0, 100);
  }

  onDiscovery(): void {
    if (this._destroyed) return;
    this.vector.curiosity  = clamp(this.vector.curiosity - 20, 0, 100);
    this.vector.expression = clamp(this.vector.expression + 12, 0, 100);
  }

  onDreamComplete(): void {
    if (this._destroyed) return;
    this.vector.rest = clamp(this.vector.rest - 30, 0, 100);
  }

  /** 自然衰减（每 2 分钟 tick） */
  private tick(): void {
    this.vector.hunger     = clamp(this.vector.hunger + 3, 0, 100);       // 饥饿感缓慢上升
    this.vector.social     = clamp(this.vector.social + 2, 0, 100);       // 社交欲缓慢上升
    this.vector.curiosity  = clamp(this.vector.curiosity + 1, 0, 100);    // 好奇心缓慢上升
    this.vector.rest       = clamp(this.vector.rest + 1, 0, 100);         // 休息欲缓慢上升
    this.vector.safety     = clamp(this.vector.safety - 2, 0, 100);       // 安全感缓慢恢复
    this.vector.expression = clamp(this.vector.expression - 1, 0, 100);   // 表达欲缓慢消退
  }

  /** 销毁（清理定时器） */
  destroy(): void {
    if (this.decayTimer) {
      clearInterval(this.decayTimer);
      this.decayTimer = null;
    }
    this._destroyed = true;
  }
}
