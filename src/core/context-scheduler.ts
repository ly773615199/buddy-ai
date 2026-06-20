/**
 * ContextScheduler — 三脑上下文调度器
 *
 * 核心思想：不是扩大上下文窗口，而是让三脑智能管理有限窗口。
 * 类比 MemGPT 的虚拟内存管理。
 *
 * 三脑分工：
 * - 小脑：感知当前上下文状态（L1 占用率、相关性、情绪）
 * - 右脑：预测需要什么上下文（NN 推断哪些记忆相关）
 * - 左脑：执行上下文调度（换入/换出/压缩/检索）
 */

import type { Message } from '../types.js';
import { ConversationSummarizer } from './conversation-summarizer.js';

export interface ContextState {
  /** L1 消息数 */
  messageCount: number;
  /** L1 token 估算占用率 (0-1) */
  l1Usage: number;
  /** 当前任务类型 */
  taskType: string;
  /** 情绪强度 (0-1) */
  emotionIntensity: number;
  /** 最近消息 */
  recentMessages: Array<{ role: string; content: string; timestamp: number }>;
}

export interface ContextPlan {
  /** 是否需要换入（从 L2 检索相关消息注入 L1） */
  shouldSwapIn: boolean;
  swapInQuery: string;
  swapInCount: number;
  /** 是否需要换出（L1 不相关内容 → 摘要 → 存 L2） */
  shouldSwapOut: boolean;
  keepRecent: number;
  /** 是否需要生成摘要 */
  shouldSummarize: boolean;
  messagesToSummarize: Message[];
  /** 是否需要检索增强（从 L3 检索相关记忆） */
  shouldRetrieve: boolean;
  retrieveQuery: string;
}

export interface SchedulingRule {
  name: string;
  condition: (state: ContextState) => boolean;
  action: string;
  priority: number;
  params?: Record<string, unknown>;
}

/**
 * 三脑上下文调度器
 */
export class ContextScheduler {
  private summarizer: ConversationSummarizer;
  private lastSummaryAt = 0;
  private verbose: boolean;

  constructor(options?: {
    summarizer?: ConversationSummarizer;
    verbose?: boolean;
  }) {
    this.summarizer = options?.summarizer ?? new ConversationSummarizer();
    this.verbose = options?.verbose ?? false;
  }

  /**
   * 三脑协作调度上下文
   *
   * 小脑感知 → 右脑预测 → 左脑执行
   */
  schedule(state: ContextState): ContextPlan {
    // ── 小脑：感知当前状态 ──
    const signals = this.cerebellumSense(state);

    // ── 右脑：预测上下文需求 ──
    const predictions = this.rightBrainPredict(state, signals);

    // ── 左脑：执行调度决策 ──
    return this.leftBrainExecute(state, signals, predictions);
  }

  /**
   * 小脑：感知上下文状态
   */
  private cerebellumSense(state: ContextState): {
    l1Pressure: 'low' | 'medium' | 'high' | 'critical';
    relevanceHint: string;
    urgency: number;
  } {
    const { l1Usage, taskType, emotionIntensity } = state;

    // L1 压力等级
    let l1Pressure: 'low' | 'medium' | 'high' | 'critical';
    if (l1Usage < 0.3) l1Pressure = 'low';
    else if (l1Usage < 0.5) l1Pressure = 'medium';
    else if (l1Usage < 0.7) l1Pressure = 'high';
    else l1Pressure = 'critical';

    // 相关性提示（基于任务类型）
    const relevanceHint = taskType === 'code' ? '代码上下文' :
      taskType === 'reasoning' ? '推理链' :
        taskType === 'writing' ? '写作风格' : '一般对话';

    // 紧急度（情绪激动时更高）
    const urgency = emotionIntensity > 0.7 ? 0.8 :
      l1Usage > 0.8 ? 0.9 : 0.3;

    return { l1Pressure, relevanceHint, urgency };
  }

  /**
   * 右脑：预测上下文需求
   */
  private rightBrainPredict(
    state: ContextState,
    signals: ReturnType<typeof this.cerebellumSense>,
  ): {
    needsMoreContext: boolean;
    suggestedKeepRecent: number;
    shouldRetrieve: boolean;
  } {
    const { messageCount, taskType } = state;

    // 代码/推理任务需要更多上下文
    const isComplexTask = taskType === 'code' || taskType === 'reasoning';
    const suggestedKeepRecent = isComplexTask ? 15 : 5;

    // 消息数多时需要检索增强
    const needsMoreContext = messageCount > 20;
    const shouldRetrieve = messageCount > 10 && signals.l1Pressure !== 'critical';

    return { needsMoreContext, suggestedKeepRecent, shouldRetrieve };
  }

  /**
   * 左脑：执行调度决策
   */
  private leftBrainExecute(
    state: ContextState,
    signals: ReturnType<typeof this.cerebellumSense>,
    predictions: ReturnType<typeof this.rightBrainPredict>,
  ): ContextPlan {
    const plan: ContextPlan = {
      shouldSwapIn: false,
      swapInQuery: '',
      swapInCount: 0,
      shouldSwapOut: false,
      keepRecent: predictions.suggestedKeepRecent,
      shouldSummarize: false,
      messagesToSummarize: [],
      shouldRetrieve: false,
      retrieveQuery: '',
    };

    // 规则 1: L1 压力 critical → 强制换出 + 摘要
    if (signals.l1Pressure === 'critical') {
      plan.shouldSwapOut = true;
      plan.keepRecent = predictions.suggestedKeepRecent;
      plan.shouldSummarize = true;
      plan.messagesToSummarize = state.recentMessages.slice(0, -plan.keepRecent) as Message[];

      if (this.verbose) {
        console.log(`  [ContextScheduler] L1 压力 critical → 换出 + 摘要 (保留最近 ${plan.keepRecent} 条)`);
      }
    }

    // 规则 2: L1 压力 high → 换出（不摘要）
    if (signals.l1Pressure === 'high' && !plan.shouldSwapOut) {
      plan.shouldSwapOut = true;
      plan.keepRecent = predictions.suggestedKeepRecent;

      if (this.verbose) {
        console.log(`  [ContextScheduler] L1 压力 high → 换出 (保留最近 ${plan.keepRecent} 条)`);
      }
    }

    // 规则 3: 消息数 >30 → 生成增量摘要
    if (state.messageCount > 30 && !plan.shouldSummarize) {
      plan.shouldSummarize = true;
      plan.messagesToSummarize = state.recentMessages.slice(0, -10) as Message[];

      if (this.verbose) {
        console.log(`  [ContextScheduler] 消息数 ${state.messageCount} > 30 → 生成摘要`);
      }
    }

    // 规则 4: 需要检索增强
    if (predictions.shouldRetrieve) {
      plan.shouldRetrieve = true;
      plan.retrieveQuery = signals.relevanceHint;

      if (this.verbose) {
        console.log(`  [ContextScheduler] 检索增强: ${plan.retrieveQuery}`);
      }
    }

    // 规则 5: 情绪激动 → 保留更多上下文
    if (state.emotionIntensity > 0.7) {
      plan.keepRecent = Math.max(plan.keepRecent, 20);

      if (this.verbose) {
        console.log(`  [ContextScheduler] 情绪激动 → 保留更多上下文 (${plan.keepRecent} 条)`);
      }
    }

    return plan;
  }

  /**
   * 执行调度计划
   */
  async executePlan(
    plan: ContextPlan,
    messages: Array<{ role: string; content: string; timestamp: number }>,
    onSummary?: (summary: string) => void,
  ): Promise<{
    keptMessages: Array<{ role: string; content: string; timestamp: number }>;
    summary: string | null;
  }> {
    let keptMessages = [...messages];
    let summary: string | null = null;

    // 执行换出
    if (plan.shouldSwapOut && keptMessages.length > plan.keepRecent) {
      const toSwap = keptMessages.slice(0, -plan.keepRecent);
      keptMessages = keptMessages.slice(-plan.keepRecent);

      // 生成摘要
      if (plan.shouldSummarize && toSwap.length > 0) {
        const existingSummary = this.summarizer.getLatestSummary()?.summary ?? '';
        summary = await this.summarizer.incrementalSummarize(
          existingSummary,
          toSwap as Message[],
        );
        this.lastSummaryAt = messages.length;

        if (onSummary) onSummary(summary);
      }
    }

    return { keptMessages, summary };
  }

  /**
   * Token 精确计算
   *
   * 中文: 1 字 ≈ 1.5 token
   * 英文: 1 词 ≈ 1.3 token
   * 代码: 1 字符 ≈ 0.4 token
   */
  estimateTokens(text: string): number {
    const chinese = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
    const english = (text.match(/[a-zA-Z]+/g) ?? []).length;
    const code = text.length - chinese - english;
    return Math.ceil(chinese * 1.5 + english * 1.3 + code * 0.4);
  }

  /**
   * 计算 L1 占用率
   */
  calculateL1Usage(
    messages: Array<{ role: string; content: string }>,
    maxTokens: number,
  ): number {
    let totalTokens = 0;
    for (const msg of messages) {
      totalTokens += this.estimateTokens(msg.content);
    }
    return totalTokens / maxTokens;
  }
}
