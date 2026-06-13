/**
 * ProactiveEngine — 主动行为引擎
 *
 * 把 BuddyClock 生成的意图变成实际的消息/动作
 * 六种行为类型：问候/关心/自我维护/学习/提醒/反思
 * 所有生成都经过 LLM，不用模板
 */

import type {
  ProactiveIntent, ProactiveType, ClockState, UserRoutine,
} from '../types.js';
import type { DesireVector } from '../desire/engine.js';
import type { Mood } from '../emotion/engine.js';
import type { PlatformManager, PlatformAdapter } from '../social/platform.js';
import type { MemoryStore } from '../memory/store.js';
import type { DreamEngine } from '../memory/dream.js';
import type { LLMAdapter } from './llm.js';
import type { Message } from '../types.js';

// ==================== 类型 ====================

export interface ProactiveContext {
  hour: number;
  mood: Mood;
  desires: DesireVector;
  routine: UserRoutine | null;
  clockState: ClockState;
  recentTopics: string[];
  ownerName: string;
}

type LLMCaller = (messages: Message[]) => Promise<{ text: string }>;

// ==================== Prompt 构建 ====================

function buildGreetingPrompt(ctx: ProactiveContext): string {
  const timeStr = ctx.hour < 12 ? '早上' : ctx.hour < 18 ? '下午' : '晚上';
  const moodHint = ctx.mood === 'happy' ? '主人心情不错' : ctx.mood === 'tired' ? '主人可能有点累' : '';
  const routineHint = ctx.routine ? `主人通常在这个时段${ctx.routine.commonTopics.join('、')}` : '';

  return `你是 ${ctx.ownerName} 的 AI 伙伴。现在是${timeStr}。${moodHint}。${routineHint}
生成一条简短自然的问候，像朋友发的消息。不要正式，不要"您好"。
要求：10-30字，自然口语化，可以带1个 emoji。只返回消息内容。`;
}

function buildCarePrompt(ctx: ProactiveContext, trigger: string): string {
  return `你是 ${ctx.ownerName} 的 AI 伙伴。根据以下上下文，发一条自然的关心消息。
触发原因：${trigger}
${ctx.routine ? `主人的日常：${ctx.routine.name}，常见话题：${ctx.routine.commonTopics.join(', ')}` : ''}
要求：15-40字，像朋友关心，不要机器人感。只返回消息内容。`;
}

function buildReflectionPrompt(ctx: ProactiveContext, stats: { interactions: number; proactives: number }): string {
  return `你是 ${ctx.ownerName} 的 AI 伙伴。现在是深夜，做一条简短的今日回顾。
今天交互了 ${stats.interactions} 次，主动发起了 ${stats.proactives} 次。
生成一条轻松的晚安/总结消息。要求：15-40字，温暖但不煽情。只返回消息内容。`;
}

// ==================== ProactiveEngine ====================

export class ProactiveEngine {
  private platformManager: PlatformManager;
  private memory: MemoryStore;
  private dream: DreamEngine;
  private llm: LLMAdapter;
  private ownerName: string;
  /** Phase 4: 注入的 LLM 调用器，优先使用 */
  private _llmCaller: ((prompt: string) => Promise<string>) | null = null;

  constructor(
    platformManager: PlatformManager,
    memory: MemoryStore,
    dream: DreamEngine,
    llm: LLMAdapter,
    ownerName = '主人',
  ) {
    this.platformManager = platformManager;
    this.memory = memory;
    this.dream = dream;
    this.llm = llm;
    this.ownerName = ownerName;
  }

  /** Phase 4: 注入 LLMCallService 调用器 */
  setLLMCaller(caller: (prompt: string) => Promise<string>): void {
    this._llmCaller = caller;
  }

  /**
   * 执行一个主动意图
   * 返回是否成功执行
   */
  async execute(intent: ProactiveIntent, ctx: ProactiveContext): Promise<boolean> {
    try {
      switch (intent.type) {
        case 'greeting':
          return this.executeGreeting(intent, ctx);
        case 'care':
          return this.executeCare(intent, ctx);
        case 'maintenance':
          return this.executeMaintenance(intent, ctx);
        case 'learning':
          return this.executeLearning(intent, ctx);
        case 'reflection':
          return this.executeReflection(intent, ctx);
        case 'reminder':
          // 提醒由 ReminderEngine 单独处理
          return false;
        default:
          return false;
      }
    } catch (err) {
      console.warn(`[ProactiveEngine] 执行 ${intent.type} 失败:`, (err as Error).message);
      return false;
    }
  }

  // ==================== 行为执行器 ====================

  /** 问候 */
  private async executeGreeting(intent: ProactiveIntent, ctx: ProactiveContext): Promise<boolean> {
    const platform = this._getTargetPlatform(intent);
    if (!platform) return false;

    const prompt = buildGreetingPrompt(ctx);
    const response = await this._callLLM(prompt);
    if (!response) return false;

    await platform.send(response);
    intent.status = 'executed';
    intent.executedAt = Date.now();
    return true;
  }

  /** 关心 */
  private async executeCare(intent: ProactiveIntent, ctx: ProactiveContext): Promise<boolean> {
    const platform = this._getTargetPlatform(intent);
    if (!platform) return false;

    const prompt = buildCarePrompt(ctx, intent.reason.trigger);
    const response = await this._callLLM(prompt);
    if (!response) return false;

    await platform.send(response);
    intent.status = 'executed';
    intent.executedAt = Date.now();
    return true;
  }

  /** 自我维护（静默执行） */
  private async executeMaintenance(intent: ProactiveIntent, _ctx: ProactiveContext): Promise<boolean> {
    const action = intent.action.content;

    if (action === 'dream') {
      try {
        await this.dream.dream('idle');
        intent.status = 'executed';
        intent.executedAt = Date.now();
        return true;
      } catch {
        return false;
      }
    }

    // 其他维护任务（memory cleanup 等）
    intent.status = 'executed';
    intent.executedAt = Date.now();
    return true;
  }

  /** 学习 */
  private async executeLearning(intent: ProactiveIntent, ctx: ProactiveContext): Promise<boolean> {
    // 学习行为目前标记为执行，不发消息
    intent.status = 'executed';
    intent.executedAt = Date.now();
    return true;
  }

  /** 反思 */
  private async executeReflection(intent: ProactiveIntent, ctx: ProactiveContext): Promise<boolean> {
    const platform = this._getTargetPlatform(intent);
    if (!platform) return false;

    const stats = {
      interactions: ctx.clockState.todayInteractions,
      proactives: ctx.clockState.todayProactives,
    };
    const prompt = buildReflectionPrompt(ctx, stats);
    const response = await this._callLLM(prompt);
    if (!response) return false;

    await platform.send(response);
    intent.status = 'executed';
    intent.executedAt = Date.now();
    return true;
  }

  // ==================== 内部方法 ====================

  /** 获取目标平台（通道感知：优先用最近活跃的） */
  private _getTargetPlatform(intent: ProactiveIntent): PlatformAdapter | null {
    if (intent.action.silent) return null;
    // 优先使用 intent 指定的通道
    if (intent.action.channel && intent.action.channel !== 'auto' && intent.action.channel !== 'silent') {
      const specific = this.platformManager.getActive();
      if (specific && specific.platform === intent.action.channel) return specific;
    }
    // 默认用当前活跃平台
    return this.platformManager.getActive();
  }

  /** 调用 LLM 生成内容 */
  private async _callLLM(prompt: string): Promise<string | null> {
    try {
      // Phase 4: 优先使用注入的 LLMCallService
      if (this._llmCaller) {
        const text = await this._llmCaller(prompt);
        if (!text || text.trim().length > 200) return null;
        return text.trim();
      }
      // fallback: 直接使用 LLMAdapter
      const messages: Message[] = [
        { role: 'system', content: '你是自然语言生成器，只输出消息内容，不要任何前缀或解释。', timestamp: Date.now() },
        { role: 'user', content: prompt, timestamp: Date.now() },
      ];
      const result = await this.llm.chat(messages, [], 1, { taskType: 'background' });
      const text = result.text.trim();
      if (!text || text.length > 200) return null;
      return text;
    } catch {
      return null;
    }
  }

  /**
   * 从欲望和时钟状态构建上下文
   * 供 BuddyClock 调用
   */
  static buildContext(
    hour: number,
    mood: Mood,
    desires: DesireVector,
    clockState: ClockState,
    memory: MemoryStore,
    ownerName = '主人',
  ): ProactiveContext {
    // 找当前匹配的规律
    const routine = clockState.routines.find(r => {
      const hourMatch = r.typicalStart.hour <= r.typicalEnd.hour
        ? (hour >= r.typicalStart.hour && hour < r.typicalEnd.hour)
        : (hour >= r.typicalStart.hour || hour < r.typicalEnd.hour);
      return hourMatch;
    }) ?? null;

    // 最近话题
    const recentMessages = memory.getRecentMessages(10);
    const recentTopics: string[] = [];
    for (const m of recentMessages) {
      const words = m.content.match(/\b\w{3,}\b/g);
      if (words) recentTopics.push(...words.slice(0, 3));
    }

    return {
      hour,
      mood,
      desires,
      routine,
      clockState,
      recentTopics: [...new Set(recentTopics)].slice(0, 10),
      ownerName,
    };
  }
}
