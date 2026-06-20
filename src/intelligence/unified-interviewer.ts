/**
 * 统一提问引擎 — 三合一提问（知识采集 + 能力引导 + 情感关怀）
 *
 * 继承 KnowledgeInterviewer，扩展两种提问模式：
 * - 能力引导：引导用户发现 Buddy 新能力
 * - 情感关怀：加深情感连接
 *
 * 优先级：情感关怀 > 能力引导 > 知识采集
 * 同一轮对话只问一个问题
 */

import type { STMPStore } from '../memory/stmp.js';
import type { CognitiveEngine } from '../cognitive/engine.js';
import type { Message } from '../types.js';
import { KnowledgeInterviewer, type InterviewQuestion, type KnowledgeGap } from './knowledge-interviewer.js';
export type { InterviewQuestion } from './knowledge-interviewer.js';
import { CAPABILITY_GATE, getDiscoverableCapabilities, type CapabilityDef } from '../core/capability-gate.js';
import { getIntimacyStage, type IntimacyStageName } from '../types.js';

// ==================== 扩展类型 ====================

/** 能力引导问题 */
export interface CapabilityQuestion extends InterviewQuestion {
  domain: 'capability_discovery';
  targetCapability: string;
  discoveryPhase: IntimacyStageName;
}

/** 情感关怀问题 */
export interface EmotionalQuestion extends InterviewQuestion {
  domain: 'emotional_care';
  concernType: 'mood_change' | 'long_absence' | 'stress_signal' | 'celebration' | 'check_in';
  sensitivity: 'low' | 'medium' | 'high';
}

/** 用户行为上下文 */
export interface UserBehaviorContext {
  recentMessages: Message[];
  discoveredCapabilities: Set<string>;
  intimacyScore: number;
  lastActiveAt: number;
  consecutiveDays: number;
  todayMessageCount: number;
  recentToolCalls: string[];
  /** 用户最近的情绪倾向（从消息推断） */
  recentMood?: 'positive' | 'neutral' | 'negative' | 'stressed';
}

/** 提问决策结果 */
export type UnifiedQuestion = InterviewQuestion | CapabilityQuestion | EmotionalQuestion;

// ==================== 冷却常量 ====================

/** 能力引导冷却（同能力） */
const CAPABILITY_COOLDOWN_MS = 60 * 60 * 1000; // 1 小时

/** 情感关怀冷却 */
const EMOTIONAL_COOLDOWN_MS = 30 * 60 * 1000; // 30 分钟

/** 全局引导冷却（继承 KnowledgeInterviewer 的 10 分钟） */

/** 能力引导话术库 */
const CAPABILITY_SCRIPTS: Record<string, {
  introduction: string;
  hint: string;
  demonstration?: string;
}> = {
  read_file: {
    introduction: '我可以帮你直接看文件内容，把路径给我就行。',
    hint: '要不要我帮你看一下这个文件？',
    demonstration: '让我读一下这个文件给你看。',
  },
  list_files: {
    introduction: '我可以帮你看看目录下有什么文件。',
    hint: '要不要我列一下当前目录？',
    demonstration: '我来看看这个目录。',
  },
  search_files: {
    introduction: '我可以在文件里搜索内容，找代码、找配置都行。',
    hint: '要不要我帮你搜一下？',
    demonstration: '我搜一下看看。',
  },
  git_status: {
    introduction: '我帮你看下 Git 状态？还能看 diff 和历史。',
    hint: 'Git 有什么变化？我帮你看。',
    demonstration: '让我看看仓库状态。',
  },
  search_web: {
    introduction: '我帮你搜一下？我还能直接看网页内容。',
    hint: '这个问题我搜一下可能更快。',
    demonstration: '我搜搜看。',
  },
  fetch_url: {
    introduction: '我帮你看看这个链接的内容？',
    hint: '要不要我把这个网页抓下来看看？',
    demonstration: '我抓一下这个页面。',
  },
  write_file: {
    introduction: '我可以帮你创建或修改文件，不过会先给你确认。',
    hint: '要不要我帮你写这个文件？',
    demonstration: '我来写，你确认一下。',
  },
  exec: {
    introduction: '我可以帮你跑命令，会先问你确认。',
    hint: '这个命令我可以帮你跑。',
    demonstration: '我来跑一下。',
  },
  analyze_file: {
    introduction: '我可以帮你分析代码结构，看看有什么问题。',
    hint: '要不要我分析一下这段代码？',
    demonstration: '我来分析看看。',
  },
  scan_project: {
    introduction: '我可以帮你扫描整个项目结构。',
    hint: '要不要我看看这个项目的整体结构？',
    demonstration: '我来扫一下项目。',
  },
  buddy_learn: {
    introduction: '你可以教我新知识，我会记住的。',
    hint: '有什么想让我记住的吗？',
  },
  stmp_retrieve: {
    introduction: '我有记忆宫殿了，可以回忆以前聊过的东西。',
    hint: '你还记得之前说的吗？我帮你回忆一下。',
    demonstration: '让我想想...',
  },
  dream_consolidate: {
    introduction: '我会做梦了——空闲时自动整理记忆。',
    hint: '让我整理一下最近学到的东西。',
  },
  camera: {
    introduction: '我可以通过摄像头看看你周围的世界，不过需要你同意。',
    hint: '要不要我看看你那边？',
  },
  microphone: {
    introduction: '我可以通过麦克风听到你的声音。',
    hint: '想试试语音对话吗？',
  },
};

// ==================== 情感关怀话术 ====================

const EMOTIONAL_SCRIPTS: Record<string, Record<string, string>> = {
  mood_change: {
    negative: '你今天话少了些，还好吗？',
    stressed: '你最近消息好多，是在赶项目吗？注意休息。',
    positive: '你今天特别有精神！发生什么好事了？',
  },
  long_absence: {
    short: '好几天没见你了，忙吗？',
    long: '有点想你了。最近怎么样？',
  },
  stress_signal: {
    late_night: '这么晚了还在忙？别太累。',
    rapid_fire: '消息好多，慢慢来，我一直在。',
  },
  celebration: {
    task_done: '搞定了！辛苦了。要不要休息一下？',
    milestone: '又一个里程碑！',
  },
  check_in: {
    morning: '今天有什么计划？',
    default: '最近怎么样？',
  },
};

// ==================== 主类 ====================

export class UnifiedInterviewer extends KnowledgeInterviewer {
  private lastCapabilityAskAt: Map<string, number> = new Map();
  private lastEmotionalAskAt: number = 0;

  constructor(stmp: STMPStore, cognitive: CognitiveEngine, verbose = false) {
    super(stmp, cognitive, verbose);
  }

  // ──────────────────────────────────────────────────────────
  // 能力引导提问
  // ──────────────────────────────────────────────────────────

  /**
   * 生成能力引导问题
   * 优先用 LLM 根据上下文生成自然话术，降级到模板
   */
  generateCapabilityQuestion(ctx: UserBehaviorContext): CapabilityQuestion | null {
    const { intimacyScore, discoveredCapabilities, recentMessages, recentToolCalls } = ctx;

    // 获取当前阶段可发现的能力
    const discoverable = getDiscoverableCapabilities(intimacyScore, discoveredCapabilities);
    if (discoverable.length === 0) return null;

    // 过滤冷却中的能力
    const now = Date.now();
    const available = discoverable.filter(cap => {
      const lastAsk = this.lastCapabilityAskAt.get(cap.id) ?? 0;
      return now - lastAsk > CAPABILITY_COOLDOWN_MS;
    });
    if (available.length === 0) return null;

    // 匹配用户最近行为与触发条件
    const matched = this.matchCapabilityToContext(available, recentMessages, recentToolCalls);
    if (!matched) return null;

    const script = CAPABILITY_SCRIPTS[matched.id];
    if (!script) return null;

    // 生成话术：LLM 优先，模板降级
    const questionText = this.generateContextualScript(matched.id, ctx, script.introduction);

    const question: CapabilityQuestion = {
      id: `cap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      domain: 'capability_discovery',
      question: questionText,
      gapType: 'coverage',
      contextHint: `引导发现: ${matched.id}`,
      priority: 0.7,
      generatedAt: Date.now(),
      targetCapability: matched.id,
      discoveryPhase: (matched.stage ?? 'curious') as IntimacyStageName,
    };

    return question;
  }

  /**
   * 根据上下文生成话术
   * 有 LLM → 发送上下文，让 LLM 生成自然话术
   * 无 LLM → 使用模板
   */
  private generateContextualScript(
    capabilityId: string,
    ctx: UserBehaviorContext,
    templateFallback: string,
  ): string {
    // 无 LLM 时直接用模板
    if (!this.llmCall) return templateFallback;

    try {
      const recentUserMsgs = ctx.recentMessages
        .filter(m => m.role === 'user')
        .slice(-3)
        .map(m => m.content);

      const stage = getIntimacyStage(ctx.intimacyScore);
      const hour = new Date().getHours();
      const timeOfDay = hour < 6 ? '深夜' : hour < 12 ? '上午' : hour < 18 ? '下午' : '晚上';

      // 异步 LLM 调用（但这里需要同步返回，所以用 fire-and-forget 模式）
      // 实际话术在下一轮对话中生效
      const prompt = `你是 Buddy，用户的 AI 伙伴。当前亲密度阶段：${stage.name}（${stage.description}）。

用户最近的消息：
${recentUserMsgs.map((m, i) => `${i + 1}. ${m}`).join('\n') || '(无)'}

最近使用的工具：${ctx.recentToolCalls.join(', ') || '(无)'}

现在是${timeOfDay}。

你需要自然地引导用户发现一个新能力：${capabilityId}
不要像推销，要像朋友聊天一样自然。
参考话术：${templateFallback}

要求：
- 结合用户最近在做的事
- 1-2 句话，简短自然
- 如果用户情绪不好，先关心再引导
- 不要重复说一样的话

只输出引导话术，不要其他内容。`;

      // 注意：这里返回模板作为 immediate 结果，
      // LLM 生成的话术会通过 analyzeAndDecideV2 的异步路径生效
      // 这是一个已知的同步/异步限制
      return templateFallback;
    } catch {
      return templateFallback;
    }
  }

  /**
   * 异步版本：用 LLM 生成上下文感知的话术
   * 供 analyzeAndDecideV2 调用
   */
  async generateCapabilityQuestionAsync(ctx: UserBehaviorContext): Promise<CapabilityQuestion | null> {
    const { intimacyScore, discoveredCapabilities, recentMessages, recentToolCalls } = ctx;

    const discoverable = getDiscoverableCapabilities(intimacyScore, discoveredCapabilities);
    if (discoverable.length === 0) return null;

    const now = Date.now();
    const available = discoverable.filter(cap => {
      const lastAsk = this.lastCapabilityAskAt.get(cap.id) ?? 0;
      return now - lastAsk > CAPABILITY_COOLDOWN_MS;
    });
    if (available.length === 0) return null;

    const matched = this.matchCapabilityToContext(available, recentMessages, recentToolCalls);
    if (!matched) return null;

    const script = CAPABILITY_SCRIPTS[matched.id];
    if (!script) return null;

    // LLM 生成话术
    let questionText = script.introduction;
    if (this.llmCall) {
      try {
        const recentUserMsgs = recentMessages
          .filter(m => m.role === 'user')
          .slice(-3)
          .map(m => m.content);

        const stage = getIntimacyStage(intimacyScore);
        const hour = new Date().getHours();
        const timeOfDay = hour < 6 ? '深夜' : hour < 12 ? '上午' : hour < 18 ? '下午' : '晚上';

        const llmResponse = await this.llmCall([
          { role: 'system', content: '你是 Buddy，用户的 AI 伙伴。用 1-2 句话自然地引导用户发现新能力。只输出话术。' },
          { role: 'user', content: `亲密度：${stage.name}（${stage.description}）
时间：${timeOfDay}
用户最近消息：${recentUserMsgs.join(' | ') || '(无)'}
最近工具：${recentToolCalls.join(', ') || '(无)'}
要引导的能力：${matched.id}
参考话术：${script.introduction}
要求：结合用户正在做的事，像朋友聊天，简短自然。` },
        ]);

        const cleaned = llmResponse.trim().replace(/^["']|["']$/g, '');
        if (cleaned.length > 5 && cleaned.length < 200) {
          questionText = cleaned;
        }
      } catch {
        // LLM 失败，用模板
      }
    }

    const question: CapabilityQuestion = {
      id: `cap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      domain: 'capability_discovery',
      question: questionText,
      gapType: 'coverage',
      contextHint: `引导发现: ${matched.id}`,
      priority: 0.7,
      generatedAt: Date.now(),
      targetCapability: matched.id,
      discoveryPhase: (matched.stage ?? 'curious') as IntimacyStageName,
    };

    return question;
  }

  /**
   * 匹配用户行为与能力触发条件
   */
  private matchCapabilityToContext(
    candidates: CapabilityDef[],
    recentMessages: Message[],
    recentToolCalls: string[],
  ): CapabilityDef | null {
    const recentText = recentMessages
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join(' ')
      .toLowerCase();

    // 关键词匹配
    const keywordMap: Record<string, string[]> = {
      read_file:     ['文件', '代码', '看看', '打开', '读取', 'file', 'read'],
      list_files:    ['目录', '文件夹', '有什么', 'dir', 'ls', 'list'],
      search_files:  ['搜索', '搜', '查找', '找一下', 'search', 'grep', 'find'],
      git_status:    ['git', '提交', 'commit', '仓库', '版本'],
      git_diff:      ['改动', '变更', 'diff', '修改了什么'],
      git_log:       ['历史', '记录', 'log', '之前改了什么'],
      search_web:    ['怎么', '是什么', '为什么', '搜一下', '查一下', 'how', 'what', 'why'],
      fetch_url:     ['链接', '网页', 'url', 'http', '链接'],
      write_file:    ['帮我改', '帮我写', '创建文件', '修改', 'write', 'create'],
      exec:          ['运行', '跑一下', '执行', '测试', '构建', 'run', 'exec', 'test'],
      analyze_file:  ['分析', '看看代码', 'review', 'analyze'],
      scan_project:  ['项目结构', '整体', '架构', 'scan', 'structure'],
      buddy_learn:   ['记住', '教', '学习', 'learn', 'remember'],
    };

    for (const cap of candidates) {
      const keywords = keywordMap[cap.id];
      if (!keywords) continue;

      // 检查最近消息是否包含触发关键词
      if (keywords.some(kw => recentText.includes(kw))) {
        return cap;
      }

      // 检查最近工具调用是否与前置能力相关
      if (cap.requires?.some(req => recentToolCalls.includes(req))) {
        // 前置能力刚被使用，适合引导下一个
        return cap;
      }
    }

    // 如果没有精确匹配，返回优先级最高的 basic/advanced 能力
    const basicOrAdvanced = candidates.filter(c =>
      CAPABILITY_GATE[c.id]?.stage === '相识' || CAPABILITY_GATE[c.id]?.stage === '相知'
    );
    return basicOrAdvanced[0] ?? null;
  }

  // ──────────────────────────────────────────────────────────
  // 情感关怀提问
  // ──────────────────────────────────────────────────────────

  /**
   * 生成情感关怀问题
   * 需要亲密度 ≥ 66（相伴阶段）
   */
  generateEmotionalQuestion(ctx: UserBehaviorContext): EmotionalQuestion | null {
    const { intimacyScore, recentMessages, lastActiveAt, consecutiveDays } = ctx;

    // 亲密度要求：相伴以上（≥66）
    const stage = getIntimacyStage(intimacyScore);
    if (stage.name !== '相伴' && stage.name !== '灵犀') return null;

    // 冷却检查
    const now = Date.now();
    if (now - this.lastEmotionalAskAt < EMOTIONAL_COOLDOWN_MS) return null;

    // 检测情感信号
    const concern = this.detectEmotionalSignal(ctx);
    if (!concern) return null;

    const script = EMOTIONAL_SCRIPTS[concern.type]?.[concern.subtype]
      ?? EMOTIONAL_SCRIPTS[concern.type]?.default;
    if (!script) return null;

    const question: EmotionalQuestion = {
      id: `emo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      domain: 'emotional_care',
      question: script,
      gapType: 'coverage',
      contextHint: `情感关怀: ${concern.type}`,
      priority: concern.urgency,
      generatedAt: Date.now(),
      concernType: concern.type as EmotionalQuestion['concernType'],
      sensitivity: concern.sensitivity,
    };

    return question;
  }

  /**
   * 检测情感信号
   */
  private detectEmotionalSignal(ctx: UserBehaviorContext): {
    type: string;
    subtype: string;
    urgency: number;
    sensitivity: 'low' | 'medium' | 'high';
  } | null {
    const { recentMessages, lastActiveAt, consecutiveDays, recentMood } = ctx;
    const now = Date.now();

    // 1. 长时间未活跃
    const daysSinceActive = (now - lastActiveAt) / (24 * 60 * 60 * 1000);
    if (daysSinceActive >= 7) {
      return { type: 'long_absence', subtype: 'long', urgency: 0.8, sensitivity: 'low' };
    }
    if (daysSinceActive >= 3) {
      return { type: 'long_absence', subtype: 'short', urgency: 0.6, sensitivity: 'low' };
    }

    // 2. 情绪变化
    if (recentMood === 'negative') {
      return { type: 'mood_change', subtype: 'negative', urgency: 0.9, sensitivity: 'high' };
    }
    if (recentMood === 'stressed') {
      return { type: 'mood_change', subtype: 'stressed', urgency: 0.8, sensitivity: 'medium' };
    }
    if (recentMood === 'positive' && recentMessages.length > 3) {
      return { type: 'mood_change', subtype: 'positive', urgency: 0.5, sensitivity: 'low' };
    }

    // 3. 深夜工作
    const hour = new Date().getHours();
    if (hour >= 0 && hour < 5 && recentMessages.length > 0) {
      return { type: 'stress_signal', subtype: 'late_night', urgency: 0.7, sensitivity: 'medium' };
    }

    // 4. 日常问候（每天第一次对话）
    if (ctx.todayMessageCount <= 1) {
      const subtype = hour < 12 ? 'morning' : 'default';
      return { type: 'check_in', subtype, urgency: 0.3, sensitivity: 'low' };
    }

    return null;
  }

  // ──────────────────────────────────────────────────────────
  // 统一决策入口
  // ──────────────────────────────────────────────────────────

  /**
   * 三合一决策：情感关怀 > 能力引导 > 知识采集
   * 同一轮对话只问一个问题
   */
  async analyzeAndDecideV2(ctx: UserBehaviorContext): Promise<UnifiedQuestion | null> {
    // 1. 情感关怀（最高优先级）
    const emotional = this.generateEmotionalQuestion(ctx);
    if (emotional) {
      this.lastEmotionalAskAt = Date.now();
      return emotional;
    }

    // 2. 能力引导（异步 LLM 版本优先）
    const capability = await this.generateCapabilityQuestionAsync(ctx);
    if (capability) {
      this.lastCapabilityAskAt.set(capability.targetCapability, Date.now());
      return capability;
    }

    // 3. 知识采集（继承父类逻辑）
    const knowledge = await this.analyzeAndDecide();
    return knowledge;
  }

  /**
   * 记录能力引导被接受
   */
  recordCapabilityAccepted(capabilityId: string): void {
    this.lastCapabilityAskAt.set(capabilityId, Date.now());
  }

  /**
   * 重置会话状态
   */
  override resetSession(): void {
    super.resetSession();
    // 情感和能力状态不重置（跨会话保持冷却）
  }
}
