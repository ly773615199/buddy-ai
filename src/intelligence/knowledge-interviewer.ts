/**
 * 主动提问引擎 — 知识缺口检测 + 追问问题生成 + 提问时机判断
 *
 * Phase A 核心模块：Buddy 能主动向用户追问专业知识，加速知识积累。
 * 与三进制微模型形成正反馈循环：微模型越聪明 → 越知道自己缺什么 → 问得越精准
 */

import type { STMPStore } from '../memory/stmp.js';
import type { CognitiveEngine } from '../cognitive/engine.js';
import type { Message } from '../types.js';

// ==================== 类型定义 ====================

/** 知识缺口 */
export interface KnowledgeGap {
  domain: string;
  topic: string;                           // 具体话题，如 "Go 并发模式"
  confidence: number;                      // 领域置信度 0-1 (越低越需要追问)
  gapType: 'coverage' | 'depth' | 'recency' | 'contradiction';
  priority: number;                        // 优先级 0-1
  lastSeen: number;                        // 上次遇到的时间戳
}

/** 追问问题 */
export interface InterviewQuestion {
  id: string;
  domain: string;
  question: string;
  gapType: KnowledgeGap['gapType'];
  contextHint: string;                     // 为什么问这个问题
  priority: number;
  generatedAt: number;
}

/** 提问时机评估 */
export interface InterviewTiming {
  shouldAsk: boolean;
  reason: string;
  question?: InterviewQuestion;
  cooldownRemaining: number;              // 剩余冷却时间 ms
}

/** 追问统计 */
export interface InterviewerStats {
  totalAsked: number;
  totalAnswered: number;
  gapCount: number;
  lastAskedAt: number;
  domains: Record<string, { asked: number; answered: number }>;
}

// ==================== 常量 ====================

/** 提问冷却时间（同一领域） */
const DOMAIN_COOLDOWN_MS = 30 * 60 * 1000;  // 30 分钟

/** 全局提问冷却 */
const GLOBAL_COOLDOWN_MS = 10 * 60 * 1000;  // 10 分钟

/** 每轮对话最多提问数 */
const MAX_QUESTIONS_PER_SESSION = 3;

/** 不适合提问的时段 (24h) */
const QUIET_HOURS: [number, number] = [23, 8]; // 23:00 - 08:00

// ==================== 主类 ====================

export class KnowledgeInterviewer {
  private stmp: STMPStore;
  private cognitive: CognitiveEngine;
  protected llmCall: ((messages: Array<{ role: string; content: string }>) => Promise<string>) | null = null;
  private verbose: boolean;

  // 追问状态追踪
  private lastGlobalAskAt: number = 0;
  private lastDomainAskAt: Map<string, number> = new Map();
  private sessionQuestionCount: number = 0;
  private totalAsked: number = 0;
  private totalAnswered: number = 0;
  private domainStats: Map<string, { asked: number; answered: number }> = new Map();

  constructor(stmp: STMPStore, cognitive: CognitiveEngine, verbose = false) {
    this.stmp = stmp;
    this.cognitive = cognitive;
    this.verbose = verbose;
  }

  /** 设置 LLM 调用器 */
  setLLMCaller(caller: (messages: Array<{ role: string; content: string }>) => Promise<string>): void {
    this.llmCall = caller;
  }

  /** 重置会话状态（每轮对话开始时调用） */
  resetSession(): void {
    this.sessionQuestionCount = 0;
  }

  // ──────────────────────────────────────────────────────────
  // 1. 知识缺口检测
  // ──────────────────────────────────────────────────────────

  /**
   * 检测所有领域的知识缺口
   * 分析维度：覆盖度、深度、新鲜度、矛盾
   */
  async detectGaps(): Promise<KnowledgeGap[]> {
    const gaps: KnowledgeGap[] = [];
    const profiles = this.cognitive.getAllDomainProfiles();

    for (const profile of profiles) {
      if (profile.growthStage === 'seed') continue;

      // 1. 覆盖度缺口：知识节点太少
      if (profile.knowledgeCount < 50) {
        gaps.push({
          domain: profile.domain,
          topic: `${profile.domain}核心概念`,
          confidence: profile.depthScore,
          gapType: 'coverage',
          priority: 0.8,
          lastSeen: profile.lastActiveAt ?? 0,
        });
      }

      // 2. 深度缺口：有广度但不够深
      if (profile.knowledgeCount >= 20 && profile.depthScore < 0.4) {
        gaps.push({
          domain: profile.domain,
          topic: `${profile.domain}深层原理`,
          confidence: profile.depthScore,
          gapType: 'depth',
          priority: 0.7,
          lastSeen: profile.lastActiveAt ?? 0,
        });
      }

      // 3. 新鲜度缺口：长时间没有新知识
      const daysSinceActive = (Date.now() - (profile.lastActiveAt ?? 0)) / (24 * 60 * 60 * 1000);
      if (daysSinceActive > 7 && profile.knowledgeCount > 10) {
        gaps.push({
          domain: profile.domain,
          topic: `${profile.domain}近期变化`,
          confidence: profile.depthScore,
          gapType: 'recency',
          priority: 0.5,
          lastSeen: profile.lastActiveAt ?? 0,
        });
      }

      // 4. 概念覆盖度分析：通过 STMP 检查关键概念缺失
      const conceptGaps = await this.detectConceptGaps(profile.domain);
      gaps.push(...conceptGaps);
    }

    // 按优先级排序
    gaps.sort((a, b) => b.priority - a.priority);
    return gaps;
  }

  /**
   * 检测领域内关键概念的覆盖缺口
   */
  private async detectConceptGaps(domain: string): Promise<KnowledgeGap[]> {
    const gaps: KnowledgeGap[] = [];

    try {
      // 从 STMP 中获取该领域已有知识的概念分布
      const result = await this.stmp.retrieve(domain, { maxPrimary: 30, maxAssociative: 10 });
      const allNodes = [...result.primary, ...result.associative];

      // 统计概念出现频率
      const conceptFreq = new Map<string, number>();
      for (const node of allNodes) {
        for (const concept of node.concepts) {
          conceptFreq.set(concept, (conceptFreq.get(concept) ?? 0) + 1);
        }
      }

      // 如果知识节点很多但概念集中（少数概念反复出现），说明广度不够
      if (allNodes.length > 15 && conceptFreq.size < allNodes.length * 0.3) {
        gaps.push({
          domain,
          topic: `${domain}相关领域拓展`,
          confidence: 0.3,
          gapType: 'coverage',
          priority: 0.6,
          lastSeen: Date.now(),
        });
      }
    } catch {
      // STMP 查询失败时跳过
    }

    return gaps;
  }

  // ──────────────────────────────────────────────────────────
  // 2. 追问问题生成
  // ──────────────────────────────────────────────────────────

  /**
   * 从知识缺口中生成追问问题
   */
  async generateQuestions(gaps: KnowledgeGap[], maxCount = 3): Promise<InterviewQuestion[]> {
    if (gaps.length === 0) return [];

    // 取最高优先级的缺口
    const topGaps = gaps.slice(0, maxCount * 2);
    const questions: InterviewQuestion[] = [];

    if (this.llmCall) {
      // LLM 驱动：生成自然的追问问题
      try {
        const llmQuestions = await this.generateQuestionsWithLLM(topGaps);
        questions.push(...llmQuestions);
      } catch (err) {
        if (this.verbose) console.warn('[Interviewer] LLM 生成问题失败，降级为模板:', (err as Error).message);
        questions.push(...this.generateQuestionsFromTemplate(topGaps));
      }
    } else {
      // 模板降级
      questions.push(...this.generateQuestionsFromTemplate(topGaps));
    }

    return questions.slice(0, maxCount);
  }

  /**
   * LLM 驱动的问题生成
   */
  private async generateQuestionsWithLLM(gaps: KnowledgeGap[]): Promise<InterviewQuestion[]> {
    if (!this.llmCall) return [];

    const gapDescriptions = gaps.map((g, i) =>
      `${i + 1}. 领域: ${g.domain} | 缺口类型: ${this.gapTypeLabel(g.gapType)} | 话题: ${g.topic} | 当前置信度: ${g.confidence.toFixed(2)}`
    ).join('\n');

    const prompt = `你是一个知识采集助手。根据以下知识缺口，为用户生成自然的追问问题。

## 要求
- 问题要像朋友聊天一样自然，不要像考试
- 每个问题附带简短的"为什么问"说明
- 问题要具体、可操作，不要泛泛而谈
- 如果缺口类型是 coverage，问"还有什么重要的概念/场景"
- 如果缺口类型是 depth，问"某个具体概念的深层原理或边界条件"
- 如果缺口类型是 recency，问"这个领域最近有什么变化/新趋势"

## 知识缺口

${gapDescriptions}

## 输出格式

返回 JSON 数组：
[
  {
    "gapIndex": 1,
    "question": "你的问题",
    "contextHint": "为什么问这个问题"
  }
]

最多 ${gaps.length} 个问题。仅输出 JSON，不要其他内容。`;

    const response = await this.llmCall([
      { role: 'system', content: '你是知识采集助手，生成自然的追问问题。只输出 JSON。' },
      { role: 'user', content: prompt },
    ]);

    return this.parseQuestionsResponse(response, gaps);
  }

  /**
   * 解析 LLM 返回的问题
   */
  private parseQuestionsResponse(response: string, gaps: KnowledgeGap[]): InterviewQuestion[] {
    try {
      let jsonStr = response.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      const start = jsonStr.indexOf('[');
      const end = jsonStr.lastIndexOf(']');
      if (start >= 0 && end > start) {
        jsonStr = jsonStr.slice(start, end + 1);
      }

      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((item: any) => item && item.question)
        .map((item: any) => {
          const gapIndex = typeof item.gapIndex === 'number' ? item.gapIndex - 1 : 0;
          const gap = gaps[Math.min(gapIndex, gaps.length - 1)];
          return {
            id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            domain: gap.domain,
            question: String(item.question).slice(0, 200),
            gapType: gap.gapType,
            contextHint: String(item.contextHint || '补充领域知识').slice(0, 100),
            priority: gap.priority,
            generatedAt: Date.now(),
          } as InterviewQuestion;
        });
    } catch {
      return [];
    }
  }

  /**
   * 模板降级生成问题
   */
  private generateQuestionsFromTemplate(gaps: KnowledgeGap[]): InterviewQuestion[] {
    return gaps.map(gap => {
      let question: string;

      switch (gap.gapType) {
        case 'coverage':
          question = `关于 ${gap.domain}，你觉得还有哪些重要的概念或场景是我应该了解的？`;
          break;
        case 'depth':
          question = `在 ${gap.domain} 中，有没有哪个概念你觉得"表面懂但实际操作起来坑很多"的？`;
          break;
        case 'recency':
          question = `${gap.domain} 最近有什么新变化或者你关注的趋势吗？`;
          break;
        case 'contradiction':
          question = `我注意到 ${gap.domain} 里有些信息不太一致，能帮我理清一下吗？`;
          break;
        default:
          question = `能聊聊 ${gap.domain} 里你认为最重要的经验吗？`;
      }

      return {
        id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        domain: gap.domain,
        question,
        gapType: gap.gapType,
        contextHint: `补充${this.gapTypeLabel(gap.gapType)}`,
        priority: gap.priority,
        generatedAt: Date.now(),
      };
    });
  }

  // ──────────────────────────────────────────────────────────
  // 3. 提问时机判断
  // ──────────────────────────────────────────────────────────

  /**
   * 综合判断是否应该在此刻提问
   */
  evaluateTiming(question: InterviewQuestion): InterviewTiming {
    const now = Date.now();

    // 1. 会话上限检查
    if (this.sessionQuestionCount >= MAX_QUESTIONS_PER_SESSION) {
      return {
        shouldAsk: false,
        reason: '本轮对话已提问足够多次',
        cooldownRemaining: 0,
      };
    }

    // 2. 全局冷却检查
    const globalElapsed = now - this.lastGlobalAskAt;
    if (globalElapsed < GLOBAL_COOLDOWN_MS) {
      return {
        shouldAsk: false,
        reason: '距上次提问时间太短',
        cooldownRemaining: GLOBAL_COOLDOWN_MS - globalElapsed,
      };
    }

    // 3. 领域冷却检查
    const lastDomainAsk = this.lastDomainAskAt.get(question.domain) ?? 0;
    const domainElapsed = now - lastDomainAsk;
    if (domainElapsed < DOMAIN_COOLDOWN_MS) {
      return {
        shouldAsk: false,
        reason: `领域 ${question.domain} 冷却中`,
        cooldownRemaining: DOMAIN_COOLDOWN_MS - domainElapsed,
      };
    }

    // 4. 安静时段检查
    const hour = new Date().getHours();
    if (hour >= QUIET_HOURS[0] || hour < QUIET_HOURS[1]) {
      return {
        shouldAsk: false,
        reason: '当前为安静时段（23:00-08:00）',
        cooldownRemaining: 0,
      };
    }

    // 5. 优先级门槛
    if (question.priority < 0.4) {
      return {
        shouldAsk: false,
        reason: '缺口优先级不足以打断用户',
        cooldownRemaining: 0,
      };
    }

    return {
      shouldAsk: true,
      reason: '条件满足，可以提问',
      question,
      cooldownRemaining: 0,
    };
  }

  /**
   * 记录提问事件
   */
  recordAsked(question: InterviewQuestion): void {
    const now = Date.now();
    this.lastGlobalAskAt = now;
    this.lastDomainAskAt.set(question.domain, now);
    this.sessionQuestionCount++;
    this.totalAsked++;

    const stats = this.domainStats.get(question.domain) ?? { asked: 0, answered: 0 };
    stats.asked++;
    this.domainStats.set(question.domain, stats);

    if (this.verbose) {
      console.log(`  [Interviewer] 追问 ${question.domain}: ${question.question}`);
    }
  }

  /**
   * 记录用户回答事件
   */
  recordAnswered(domain: string): void {
    this.totalAnswered++;
    const stats = this.domainStats.get(domain) ?? { asked: 0, answered: 0 };
    stats.answered++;
    this.domainStats.set(domain, stats);
  }

  // ──────────────────────────────────────────────────────────
  // 4. 对话流集成
  // ──────────────────────────────────────────────────────────

  /**
   * 在对话结束后分析是否应该追问
   * 供 MessageProcessor 调用
   */
  async analyzeAndDecide(): Promise<InterviewQuestion | null> {
    // 1. 检测缺口
    const gaps = await this.detectGaps();
    if (gaps.length === 0) return null;

    // 2. 生成问题
    const questions = await this.generateQuestions(gaps, 1);
    if (questions.length === 0) return null;

    // 3. 评估时机
    const timing = this.evaluateTiming(questions[0]);
    if (!timing.shouldAsk) {
      if (this.verbose) console.log(`  [Interviewer] 跳过提问: ${timing.reason}`);
      return null;
    }

    // 4. 记录并返回
    this.recordAsked(questions[0]);
    return questions[0];
  }

  /**
   * 检查用户消息是否是对之前追问的回答
   * 用于识别用户正在回答知识追问
   */
  isAnswerToInterview(userMessage: string, lastQuestion: InterviewQuestion | null): boolean {
    if (!lastQuestion) return false;

    // 回答通常比普通消息长，且包含专业术语
    if (userMessage.length < 15) return false;

    // 检查是否与追问领域相关
    const domainMatch = userMessage.toLowerCase().includes(lastQuestion.domain.toLowerCase());
    const hasExpertSignal = /因为|首先|其次|主要|关键是|本质上|一般来说|实际上|通常|方法是|做法是/i.test(userMessage);

    return domainMatch || hasExpertSignal;
  }

  // ──────────────────────────────────────────────────────────
  // 辅助方法
  // ──────────────────────────────────────────────────────────

  private gapTypeLabel(type: KnowledgeGap['gapType']): string {
    const labels: Record<KnowledgeGap['gapType'], string> = {
      coverage: '覆盖度不足',
      depth: '深度不够',
      recency: '知识过时',
      contradiction: '信息矛盾',
    };
    return labels[type];
  }

  /** 获取统计 */
  getStats(): InterviewerStats {
    const domainStatsObj: Record<string, { asked: number; answered: number }> = {};
    for (const [k, v] of this.domainStats) {
      domainStatsObj[k] = v;
    }
    return {
      totalAsked: this.totalAsked,
      totalAnswered: this.totalAnswered,
      gapCount: 0, // 需要调用 detectGaps 获取实时值
      lastAskedAt: this.lastGlobalAskAt,
      domains: domainStatsObj,
    };
  }
}
