/**
 * UserStateInferrer — 用户状态推断器
 *
 * 纯规则推断，无 LLM 调用
 *
 * 7 种状态：focused / exploring / chatting / frustrated / rushed / learning / idle
 * 每种状态附带 recommendAction，影响回复风格和主动行为
 *
 * 增强（前沿调研补充 7.3）：
 * - 挫败感检测增加连续失败、消息长度骤降、重复请求等信号
 * - 多维信号加权融合
 */

// ==================== 类型定义 ====================

export type UserState = 'focused'
  | 'exploring'
  | 'chatting'
  | 'frustrated'
  | 'rushed'
  | 'learning'
  | 'idle';

export type RecommendAction = 'proceed'    // 正常处理
  | 'brief'       // 简短回复
  | 'detailed'    // 详细回复
  | 'wait'        // 不要主动打扰
  | 'help';       // 主动提供帮助

export interface UserStateSignal {
  state: UserState;
  confidence: number;           // 0-1
  signals: string[];            // 触发信号列表
  recommendAction: RecommendAction;
  sinceLastMessage: number;     // 距上次消息 ms
}

export interface UserStateContext {
  /** 当前消息内容 */
  content: string;
  /** 最近消息历史（从旧到新） */
  recentMessages: Array<{ role: string; content: string; timestamp: number }>;
  /** 最近工具调用次数（10 分钟内） */
  recentToolCalls?: number;
  /** 连续失败次数 */
  consecutiveFailures?: number;
  /** 是否有活跃的用户纠正 */
  hasActiveCorrections?: boolean;
  /** 当前时间戳 */
  now?: number;
}

// ==================== 关键词库 ====================

const NEGATION_WORDS = [
  '不对', '错了', '不不不', '不是', '不是这样', '重来', '再来',
  '不对劲', '有问题', '有bug', '有 bug', '不行',
  'wrong', 'no no', 'incorrect', 'not right', 'try again',
];

const URGENCY_WORDS = [
  '快', '赶紧', '马上', '立刻', '急', 'hurry', 'quick', 'asap',
  '快点', '赶时间', '来不及了',
];

const LEARNING_WORDS = [
  '为什么', '怎么', '如何', '原理', '区别', '对比', '是什么意思',
  '为什么是', '怎么回事', 'why', 'how', 'what', 'explain',
  '能详细', '能展开', '具体说说',
];

const EXPLORATION_MARKERS = [
  '有什么', '有哪些', '推荐', '建议', '方案', '选择',
  'what are', 'recommend', 'suggest', 'options', 'alternatives',
];

// ==================== 推断器 ====================

export class UserStateInferrer {
  /**
   * 推断用户状态
   */
  infer(ctx: UserStateContext): UserStateSignal {
    const now = ctx.now ?? Date.now();
    const content = ctx.content;
    const recentMessages = ctx.recentMessages ?? [];

    // 计算距上次消息的时间间隔
    const lastMessage = recentMessages[recentMessages.length - 1];
    const sinceLastMessage = lastMessage ? now - lastMessage.timestamp : Infinity;

    // 收集所有状态的置信度
    const candidates: Array<{ state: UserState; confidence: number; signals: string[] }> = [];

    // 1. idle 检测（最高优先级 — 长时间无消息）
    const idleResult = this.detectIdle(sinceLastMessage);
    if (idleResult) candidates.push(idleResult);

    // 2. frustrated 检测（增强版 — 多维信号融合）
    const frustratedResult = this.detectFrustrated(ctx, recentMessages, sinceLastMessage);
    if (frustratedResult) candidates.push(frustratedResult);

    // 3. rushed 检测
    const rushedResult = this.detectRushed(content, sinceLastMessage);
    if (rushedResult) candidates.push(rushedResult);

    // 4. focused 检测
    const focusedResult = this.detectFocused(content, ctx.recentToolCalls, sinceLastMessage);
    if (focusedResult) candidates.push(focusedResult);

    // 5. learning 检测
    const learningResult = this.detectLearning(content);
    if (learningResult) candidates.push(learningResult);

    // 6. exploring 检测
    const exploringResult = this.detectExploring(content);
    if (exploringResult) candidates.push(exploringResult);

    // 7. chatting 检测
    const chattingResult = this.detectChatting(content, ctx.recentToolCalls, sinceLastMessage);
    if (chattingResult) candidates.push(chattingResult);

    // 选置信度最高的
    candidates.sort((a, b) => b.confidence - a.confidence);
    const best = candidates[0] ?? {
      state: 'chatting' as UserState,
      confidence: 0.5,
      signals: ['默认状态'],
    };

    return {
      state: best.state,
      confidence: best.confidence,
      signals: best.signals,
      recommendAction: this.getRecommendAction(best.state, best.confidence),
      sinceLastMessage,
    };
  }

  // ==================== 状态检测 ====================

  /** 空闲检测 */
  private detectIdle(sinceLastMs: number): { state: UserState; confidence: number; signals: string[] } | null {
    if (sinceLastMs < 30 * 60 * 1000) return null; // < 30 分钟不算空闲
    return {
      state: 'idle',
      confidence: 0.9,
      signals: [`距上次消息 ${Math.round(sinceLastMs / 60000)} 分钟`],
    };
  }

  /**
   * 挫败感检测（增强版 — 前沿调研补充 7.3）
   *
   * 多维信号加权融合：
   * - 否定词 (0.3)
   * - 连续失败 ≥3 次 (0.3)
   * - 消息长度骤降 (0.2)
   * - 重复相似请求 (0.2)
   */
  private detectFrustrated(
    ctx: UserStateContext,
    recentMessages: Array<{ role: string; content: string; timestamp: number }>,
    _sinceLastMs: number,
  ): { state: UserState; confidence: number; signals: string[] } | null {
    const signals: string[] = [];
    let weightedScore = 0;

    // 信号 1: 否定词 (权重 0.5 — 需要高于 chatting 的基础分)
    const negationHits = NEGATION_WORDS.filter(w => ctx.content.includes(w));
    if (negationHits.length > 0) {
      weightedScore += 0.5;
      signals.push(`否定词: ${negationHits.join(', ')}`);
    }

    // 信号 2: 连续失败 (权重 0.3)
    if (ctx.consecutiveFailures && ctx.consecutiveFailures >= 3) {
      weightedScore += 0.3;
      signals.push(`连续失败 ${ctx.consecutiveFailures} 次`);
    }

    // 信号 3: 消息长度骤降 (权重 0.2)
    if (recentMessages.length >= 5) {
      const recent3 = recentMessages.slice(-3);
      const earlier = recentMessages.slice(-10, -3);
      const recent3Avg = recent3.reduce((s, m) => s + m.content.length, 0) / recent3.length;
      const earlierAvg = earlier.length > 0
        ? earlier.reduce((s, m) => s + m.content.length, 0) / earlier.length
        : recent3Avg;
      if (earlierAvg > 30 && recent3Avg < earlierAvg * 0.3) {
        weightedScore += 0.2;
        signals.push(`消息长度骤降 (${recent3Avg.toFixed(0)} vs ${earlierAvg.toFixed(0)})`);
      }
    }

    // 信号 4: 重复相似请求 (权重 0.2)
    if (recentMessages.length >= 2) {
      const lastUserMsgs = recentMessages
        .filter(m => m.role === 'user')
        .slice(-3);
      if (lastUserMsgs.length >= 2) {
        const last = lastUserMsgs[lastUserMsgs.length - 1].content;
        const prev = lastUserMsgs[lastUserMsgs.length - 2].content;
        const similarity = this.textSimilarity(last, prev);
        if (similarity > 0.6) {
          weightedScore += 0.2;
          signals.push(`重复相似请求 (相似度 ${(similarity * 100).toFixed(0)}%)`);
        }
      }
    }

    // 信号 5: 用户纠正 (额外加分)
    if (ctx.hasActiveCorrections) {
      weightedScore += 0.1;
      signals.push('有活跃的用户纠正');
    }

    if (weightedScore < 0.3) return null;

    return {
      state: 'frustrated',
      confidence: Math.min(1, weightedScore),
      signals,
    };
  }

  /** 赶时间检测 */
  private detectRushed(content: string, sinceLastMs: number): { state: UserState; confidence: number; signals: string[] } | null {
    const signals: string[] = [];
    let confidence = 0;

    const isShort = content.length < 15;
    const hasUrgency = URGENCY_WORDS.some(w => content.includes(w));
    const isRapidFire = sinceLastMs < 30_000;

    if (isShort) { confidence += 0.3; signals.push(`短消息 (${content.length} 字)`); }
    if (hasUrgency) { confidence += 0.4; signals.push('包含催促词'); }
    if (isRapidFire) { confidence += 0.2; signals.push('快速连发'); }

    if (confidence < 0.4) return null;

    return { state: 'rushed', confidence: Math.min(1, confidence), signals };
  }

  /** 专注检测 */
  private detectFocused(content: string, toolCalls = 0, sinceLastMs: number): { state: UserState; confidence: number; signals: string[] } | null {
    const signals: string[] = [];
    let confidence = 0;

    const isShort = content.length < 30;
    const isToolHeavy = toolCalls > 3;
    const isRapid = sinceLastMs < 60_000;

    if (isShort) { confidence += 0.2; signals.push('短消息'); }
    if (isToolHeavy) { confidence += 0.4; signals.push(`工具密集 (${toolCalls} 次/10min)`); }
    if (isRapid) { confidence += 0.2; signals.push('连续交互'); }

    if (confidence < 0.5) return null;

    return { state: 'focused', confidence: Math.min(1, confidence), signals };
  }

  /** 学习检测 */
  private detectLearning(content: string): { state: UserState; confidence: number; signals: string[] } | null {
    const signals: string[] = [];
    let confidence = 0;

    const learningHits = LEARNING_WORDS.filter(w => content.toLowerCase().includes(w));
    if (learningHits.length >= 2) {
      confidence = 0.7;
      signals.push(`学习关键词: ${learningHits.slice(0, 3).join(', ')}`);
    } else if (learningHits.length === 1 && content.length > 100) {
      confidence = 0.5;
      signals.push(`学习关键词: ${learningHits[0]}`);
    }

    if (confidence < 0.5) return null;

    return { state: 'learning', confidence, signals };
  }

  /** 探索检测 */
  private detectExploring(content: string): { state: UserState; confidence: number; signals: string[] } | null {
    const signals: string[] = [];
    let confidence = 0;

    const explorationHits = EXPLORATION_MARKERS.filter(w => content.toLowerCase().includes(w));
    if (explorationHits.length > 0 && content.length > 30) {
      confidence = 0.6;
      signals.push(`探索关键词: ${explorationHits.slice(0, 2).join(', ')}`);
    }

    // 多问号
    const questionMarks = (content.match(/[？?]/g) ?? []).length;
    if (questionMarks >= 2) {
      confidence += 0.2;
      signals.push(`多个问号 (${questionMarks})`);
    }

    if (confidence < 0.5) return null;

    return { state: 'exploring', confidence: Math.min(1, confidence), signals };
  }

  /** 闲聊检测 */
  private detectChatting(content: string, toolCalls = 0, sinceLastMs: number): { state: UserState; confidence: number; signals: string[] } | null {
    const signals: string[] = [];
    let confidence = 0;

    const isShort = content.length < 50;
    const noTools = toolCalls === 0;
    const hasEmoji = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/u.test(content);
    const isSpaced = sinceLastMs > 5 * 60 * 1000;

    if (isShort) { confidence += 0.3; signals.push('短消息'); }
    if (noTools) { confidence += 0.2; signals.push('无工具调用'); }
    if (hasEmoji) { confidence += 0.2; signals.push('包含表情'); }
    if (isSpaced) { confidence += 0.1; signals.push('间隔 >5min'); }

    if (confidence < 0.4) return null;

    return { state: 'chatting', confidence: Math.min(1, confidence), signals };
  }

  // ==================== 建议动作 ====================

  /** 根据状态推荐动作 */
  private getRecommendAction(state: UserState, confidence: number): RecommendAction {
    switch (state) {
      case 'focused':   return 'proceed';
      case 'exploring': return 'detailed';
      case 'chatting':  return 'proceed';
      case 'frustrated':return confidence > 0.7 ? 'help' : 'brief';
      case 'rushed':    return 'brief';
      case 'learning':  return 'detailed';
      case 'idle':      return 'wait';
      default:          return 'proceed';
    }
  }

  // ==================== 工具 ====================

  /** 简单文本相似度（字符级 Jaccard） */
  private textSimilarity(a: string, b: string): number {
    if (a.length === 0 || b.length === 0) return 0;
    const setA = new Set(a.split(''));
    const setB = new Set(b.split(''));
    const intersection = new Set([...setA].filter(c => setB.has(c)));
    const union = new Set([...setA, ...setB]);
    return intersection.size / union.size;
  }
}
