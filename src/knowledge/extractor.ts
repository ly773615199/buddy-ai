/**
 * 知识提取引擎 — 从对话中自动提取六类隐性知识
 * 
 * 六类隐性知识：
 * 1. 决策规则：什么情况下选A不选B
 * 2. 例外边界：常规方法不管用的时候怎么办
 * 3. 模式识别：一看就知道
 * 4. 风险判断：什么情况下会出事
 * 5. 人的因素：怎么跟人打交道
 * 6. 失败经验：判断失误的教训
 */

import type { Message } from '../types.js';
import type { STMPStore, MemoryNode as STMPNode } from '../memory/stmp.js';
import type { CognitiveEngine } from '../cognitive/engine.js';

// ==================== 数据结构 ====================

/** 隐性知识类型 */
export type TacitKnowledgeType =
  | 'decision_rule'       // 决策规则
  | 'exception'           // 例外边界
  | 'pattern_recognition' // 模式识别
  | 'risk_judgment'       // 风险判断
  | 'human_factor'        // 人的因素
  | 'failure_experience'; // 失败经验

/** 提取到的知识单元 */
export interface ExtractedKnowledge {
  type: TacitKnowledgeType;
  content: string;         // 提取的知识内容
  domain: string;          // 所属领域
  confidence: number;      // 置信度 0-1
  concepts: string[];      // 关联概念
  sourceMessages: string[]; // 来源消息摘要
}

/** 提取结果 */
export interface ExtractionResult {
  total: number;           // 提取总数
  extracted: ExtractedKnowledge[]; // 提取的知识
  stmpInserted: number;    // 成功写入 STMP 的数量
  domainUpdates: string[]; // 更新的领域
  skipped: number;         // 因置信度过滤跳过的数量
  duplicates: number;      // 因去重跳过的数量
}

/** 训练样本（Phase 4a: 问答对 + 判断力样本） */
export interface TrainingSample {
  instruction: string;
  input: string;
  output: string;
  domain: string;
  confidence: number;
  sourceType: 'conversation_qa' | 'judgment' | 'correction';
}

/** 领域画像 */
export interface DomainProfile {
  domain: string;
  domainType: 'rule_based' | 'pattern_recognition' | 'creative' | 'relational';
  knowledgeCount: number;
  depthScore: number;      // 0-1
  expertiseSignals: number;
  growthStage: 'seed' | 'sprout' | 'growing' | 'trainable' | 'mature';
  conversationCount: number;
  lastActiveAt: number;
  isActive: boolean;
}

// ==================== 知识类型描述 ====================

const KNOWLEDGE_TYPE_DESC: Record<TacitKnowledgeType, { name: string; desc: string; example: string }> = {
  decision_rule: {
    name: '决策规则',
    desc: '用户在特定条件下做出的选择判断，说明什么情况下选A不选B',
    example: '40岁以下骨折多为高能量损伤，要警惕合并伤',
  },
  exception: {
    name: '例外边界',
    desc: '常规方法/规则不管用时的特殊处理方式',
    example: '老年人Colles骨折，就算移位明显，保守治疗可能更好',
  },
  pattern_recognition: {
    name: '模式识别',
    desc: '用户通过经验形成的"一看就知道"的快速判断能力',
    example: '对方律师一直在外围试探，说明他没有实锤',
  },
  risk_judgment: {
    name: '风险判断',
    desc: '用户对潜在问题和风险的预判',
    example: '这个方案理论上没问题，但三年后这个连接处一定会出问题',
  },
  human_factor: {
    name: '人的因素',
    desc: '与人打交道的经验和判断',
    example: '这个学生不是不会，是不想学，得先解决情绪问题',
  },
  failure_experience: {
    name: '失败经验',
    desc: '判断失误后的教训和反思',
    example: '那次我按教科书做了，结果出了问题，后来我改变了做法',
  },
};

// ==================== 提取 Prompt ====================

function buildExtractionPrompt(messages: Array<{ role: string; content: string }>): string {
  const typeDescriptions = Object.entries(KNOWLEDGE_TYPE_DESC)
    .map(([key, val]) => `  ${key}: ${val.desc}\n    例: "${val.example}"`)
    .join('\n');

  const conversationText = messages
    .map(m => `[${m.role}] ${m.content}`)
    .join('\n');

  return `你是一个专业知识提取器。分析以下对话，从用户的发言中提取专业知识。

## 提取规则

1. 只提取用户（user）主动表达的判断、经验和观点
2. 不要提取通用知识（教科书上能查到的）或用户引用的他人观点
3. 不要提取简单的事实陈述（如"Python是一种语言"）
4. 重点关注用户的个人经验、独特判断和专业见解
5. 每条知识必须是独立完整的一句话判断

## 六类隐性知识

${typeDescriptions}

## 输出格式

返回 JSON 数组，每个元素包含：
- type: 知识类型（六类之一）
- content: 提取的知识内容（一句话）
- domain: 所属专业领域（如"骨科诊断"、"前端开发"）
- confidence: 置信度 0-1（你认为这确实是用户个人专业经验的概率）
- concepts: 关联概念标签数组（2-5个）

如果没有找到值得提取的知识，返回空数组 []。

## 对话

${conversationText}

## 输出（仅 JSON，不要其他内容）`;
}

// ==================== 提取引擎 ====================

export class KnowledgeExtractor {
  private stmp: STMPStore;
  private cognitive: CognitiveEngine;
  private llmCall: ((messages: Array<{ role: string; content: string }>) => Promise<string>) | null = null;
  private recentExtractions: Map<string, number> = new Map(); // 去重用
  private totalExtracted = 0;

  constructor(stmp: STMPStore, cognitive: CognitiveEngine) {
    this.stmp = stmp;
    this.cognitive = cognitive;
  }

  /** 设置 LLM 调用函数（由 Agent 注入） */
  setLLMCaller(caller: (messages: Array<{ role: string; content: string }>) => Promise<string>): void {
    this.llmCall = caller;
  }

  /**
   * 从最近的对话中提取知识
   * @param messages 完整对话记录
   * @param recentCount 分析最近多少条消息（默认 10）
   */
  async extract(messages: Message[], recentCount = 10): Promise<ExtractionResult> {
    const result: ExtractionResult = {
      total: 0,
      extracted: [],
      stmpInserted: 0,
      domainUpdates: [],
      skipped: 0,
      duplicates: 0,
    };

    // 没有 LLM 调用器时使用规则提取
    if (!this.llmCall) {
      return this.extractByRules(messages, recentCount);
    }

    // 取最近的消息
    const recent = messages.slice(-recentCount);
    if (recent.length < 2) return result;

    // 只分析有用户消息的对话段
    const hasUserMessage = recent.some(m => m.role === 'user');
    if (!hasUserMessage) return result;

    try {
      const prompt = buildExtractionPrompt(
        recent.map(m => ({ role: m.role, content: m.content.slice(0, 500) }))
      );

      const response = await this.llmCall([
        { role: 'system', content: '你是专业知识提取器，只输出JSON。' },
        { role: 'user', content: prompt },
      ]);

      // 解析 LLM 返回的 JSON
      const extracted = this.parseExtractionResponse(response);
      result.total = extracted.length;

      // 处理每条提取的知识
      for (const knowledge of extracted) {
        // 置信度过滤
        if (knowledge.confidence < 0.6) {
          result.skipped++;
          continue;
        }

        // 去重检测
        const hash = this.hashKnowledge(knowledge);
        if (this.recentExtractions.has(hash)) {
          result.duplicates++;
          continue;
        }
        this.recentExtractions.set(hash, Date.now());

        // 清理过期的去重记录（保留最近 24 小时）
        if (this.recentExtractions.size > 500) {
          const cutoff = Date.now() - 24 * 60 * 60 * 1000;
          for (const [k, v] of this.recentExtractions) {
            if (v < cutoff) this.recentExtractions.delete(k);
          }
        }

        // 写入 STMP
        const inserted = this.insertToSTMP(knowledge);
        if (inserted) {
          result.stmpInserted++;
          result.extracted.push(knowledge);

          // 更新领域画像
          if (!result.domainUpdates.includes(knowledge.domain)) {
            result.domainUpdates.push(knowledge.domain);
            this.updateDomainProfile(knowledge);
          }
        }
      }

      this.totalExtracted += result.stmpInserted;
      return result;

    } catch {
      // LLM 提取失败时降级为规则提取
      return this.extractByRules(messages, recentCount);
    }
  }

  /**
   * 规则提取（降级方案，不依赖 LLM）
   */
  private async extractByRules(messages: Message[], recentCount: number): Promise<ExtractionResult> {
    const result: ExtractionResult = {
      total: 0,
      extracted: [],
      stmpInserted: 0,
      domainUpdates: [],
      skipped: 0,
      duplicates: 0,
    };

    const recent = messages.slice(-recentCount);
    const userMessages = recent.filter(m => m.role === 'user');

    for (const msg of userMessages) {
      const content = msg.content;
      const lower = content.toLowerCase();

      // 规则 1：检测纠正信号 → 高价值知识
      if (/不对|不是这个意思|应该这样|你搞错了|错了|实际上/.test(content)) {
        const domain = await this.inferDomainAsync(content);
        const knowledge: ExtractedKnowledge = {
          type: 'decision_rule',
          content: content.slice(0, 200),
          domain,
          confidence: 0.7,
          concepts: this.extractConceptsSimple(content),
          sourceMessages: [content.slice(0, 100)],
        };

        if (this.insertToSTMP(knowledge)) {
          result.stmpInserted++;
          result.extracted.push(knowledge);
          result.total++;
          if (!result.domainUpdates.includes(domain)) {
            result.domainUpdates.push(domain);
            this.updateDomainProfile(knowledge);
          }
        }
      }

      // 规则 2：检测经验表述 → "我发现/我通常/我习惯/经验上"
      if (/我发现|我通常|我习惯|经验上|实践中|实际操作|一般来说|最好|建议/.test(content) && content.length > 20) {
        const domain = await this.inferDomainAsync(content);
        const knowledge: ExtractedKnowledge = {
          type: 'pattern_recognition',
          content: content.slice(0, 200),
          domain,
          confidence: 0.65,
          concepts: this.extractConceptsSimple(content),
          sourceMessages: [content.slice(0, 100)],
        };

        if (this.insertToSTMP(knowledge)) {
          result.stmpInserted++;
          result.extracted.push(knowledge);
          result.total++;
          if (!result.domainUpdates.includes(domain)) {
            result.domainUpdates.push(domain);
            this.updateDomainProfile(knowledge);
          }
        }
      }

      // 规则 3：检测风险/失败表述 → "要注意/小心/容易出/之前犯过"
      if (/要注意|小心|容易出|之前犯过|踩过坑|别犯|教训|失误|失败/.test(content) && content.length > 15) {
        const domain = await this.inferDomainAsync(content);
        const knowledge: ExtractedKnowledge = {
          type: content.includes('教训') || content.includes('失败') || content.includes('犯过')
            ? 'failure_experience'
            : 'risk_judgment',
          content: content.slice(0, 200),
          domain,
          confidence: 0.65,
          concepts: this.extractConceptsSimple(content),
          sourceMessages: [content.slice(0, 100)],
        };

        if (this.insertToSTMP(knowledge)) {
          result.stmpInserted++;
          result.extracted.push(knowledge);
          result.total++;
          if (!result.domainUpdates.includes(domain)) {
            result.domainUpdates.push(domain);
            this.updateDomainProfile(knowledge);
          }
        }
      }
    }

    return result;
  }

  /**
   * 解析 LLM 返回的提取结果
   */
  private parseExtractionResponse(response: string): ExtractedKnowledge[] {
    try {
      // 尝试从回复中提取 JSON
      let jsonStr = response.trim();
      // 去掉 markdown 代码块
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      // 找到第一个 [ 和最后一个 ]
      const start = jsonStr.indexOf('[');
      const end = jsonStr.lastIndexOf(']');
      if (start >= 0 && end > start) {
        jsonStr = jsonStr.slice(start, end + 1);
      }

      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((item: any) => item && item.type && item.content && item.domain)
        .map((item: any) => ({
          type: item.type as TacitKnowledgeType,
          content: String(item.content).slice(0, 500),
          domain: String(item.domain).slice(0, 100),
          confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0.5)),
          concepts: Array.isArray(item.concepts) ? item.concepts.map(String).slice(0, 5) : [],
          sourceMessages: [],
        }));
    } catch {
      return [];
    }
  }

  /**
   * 将提取的知识写入 STMP
   */
  private insertToSTMP(knowledge: ExtractedKnowledge): boolean {
    try {
      // 去重检查
      const hash = this.hashKnowledge(knowledge);
      if (this.recentExtractions.has(hash)) {
        return false;
      }
      this.recentExtractions.set(hash, Date.now());

      // 清理过期的去重记录
      if (this.recentExtractions.size > 500) {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        for (const [k, v] of this.recentExtractions) {
          if (v < cutoff) this.recentExtractions.delete(k);
        }
      }

      const roomId = this.getOrCreateRoom(knowledge.domain);

      const node: STMPNode = {
        id: `ext-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        content: `[${KNOWLEDGE_TYPE_DESC[knowledge.type].name}] ${knowledge.content}`,
        room: roomId,
        timestamp: Date.now(),
        temporalContext: { before: [], after: [] },
        concepts: knowledge.concepts,
        relations: knowledge.concepts.map(c => ({
          target: c,
          type: 'relates_to' as const,
          strength: knowledge.confidence,
        })),
        emotional: {
          valence: 0.2,
          importance: Math.round(knowledge.confidence * 8) + 2, // 2-10
        },
        lifecycle: {
          createdAt: Date.now(),
          lastAccessed: Date.now(),
          accessCount: 1,
          decay: 1.0,
          compressed: false,
          hibernated: false,
        },
        source: 'extracted',
      };

      this.stmp.insertNode(node);

      // 建立概念之间的星图边
      for (let i = 0; i < knowledge.concepts.length; i++) {
        for (let j = i + 1; j < knowledge.concepts.length; j++) {
          this.stmp.upsertEdge(knowledge.concepts[i], knowledge.concepts[j], knowledge.confidence * 0.5);
        }
      }

      this.totalExtracted++;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取或创建领域对应的 STMP 房间
   */
  private getOrCreateRoom(domain: string): string {
    const roomId = domain.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '-');
    const existing = this.stmp.getRoom(roomId);
    if (existing) return roomId;

    this.stmp.createRoom(roomId, domain, [domain], false);
    return roomId;
  }

  /**
   * 更新领域画像（通过认知引擎存储）
   */
  private updateDomainProfile(knowledge: ExtractedKnowledge): void {
    const profile = this.cognitive.getDomainProfile(knowledge.domain);
    const newCount = profile.knowledgeCount + 1;

    // 计算成长阶段（Phase 4a: 新增 trainable 阶段）
    let stage: DomainProfile['growthStage'] = 'seed';
    if (newCount >= 500 && profile.depthScore > 0.85) stage = 'mature';
    else if (newCount >= 100 && profile.depthScore > 0.5) stage = 'trainable'; // 可试跑 LoRA
    else if (newCount >= 100) stage = 'growing';
    else if (newCount >= 20) stage = 'sprout';

    this.cognitive.updateDomainProfile(knowledge.domain, {
      knowledgeCount: newCount,
      growthStage: stage,
      expertiseSignals: profile.expertiseSignals + 1,
      depthScore: Math.min(1, profile.depthScore + 0.01),
      lastActiveAt: Date.now(),
    });
  }

  /**
   * 简单概念提取（不依赖 LLM）
   */
  private extractConceptsSimple(text: string): string[] {
    const stopwords = new Set([
      '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一',
      '这个', '那个', '什么', '怎么', '可以', '应该', '需要', '如果', '但是',
      'the', 'a', 'an', 'is', 'are', 'was', 'to', 'for', 'of', 'and', 'or', 'it',
    ]);
    return [...new Set(
      text.replace(/[，。！？、；：""''（）\[\]{}<>,.!?;:()\[\]{}<>]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length >= 2 && !stopwords.has(t))
    )].slice(0, 5);
  }

  /**
   * 推断文本所属领域
   * 优先使用 LLM，失败时降级为规则推断
   */
  private async inferDomainAsync(text: string): Promise<string> {
    if (this.llmCall && text.length > 20) {
      try {
        const response = await this.llmCall([
          { role: 'system', content: '你是领域分类器。根据文本内容判断所属专业领域，只返回领域名（2-6个字），不要其他内容。' },
          { role: 'user', content: `判断以下文本属于什么专业领域：\n\n${text.slice(0, 300)}\n\n领域：` },
        ]);
        const domain = response.trim().replace(/[""''。，.]/g, '').slice(0, 20);
        if (domain && domain.length >= 2 && domain.length <= 20 && !domain.includes('\n')) {
          return domain;
        }
      } catch {
        // LLM 失败降级
      }
    }
    return this.inferDomain(text);
  }

  /**
   * 规则推断文本所属领域（降级方案）
   */
  private inferDomain(text: string): string {
    const lower = text.toLowerCase();
    const domainKeywords: Array<[string, string[]]> = [
      ['前端开发', ['react', 'vue', 'css', 'html', '前端', '页面', '组件']],
      ['后端开发', ['node', 'python', 'java', 'go ', 'rust', '后端', '服务', 'api', '接口']],
      ['数据库', ['mysql', 'postgres', 'sqlite', 'redis', '数据库', 'sql', '索引']],
      ['运维部署', ['docker', 'k8s', 'nginx', '部署', '上线', 'ci/cd', '运维']],
      ['机器学习', ['模型', '训练', '数据集', 'loss', 'epoch', 'embedding', '向量']],
      ['产品设计', ['用户', '需求', '体验', '交互', 'ui', 'ux', '设计']],
      ['项目管理', ['排期', '迭代', '优先级', '复盘', '项目']],
    ];

    for (const [domain, keywords] of domainKeywords) {
      for (const kw of keywords) {
        if (lower.includes(kw)) return domain;
      }
    }

    return '通用';
  }

  /** 获取知识哈希（用于去重） */
  private hashKnowledge(k: ExtractedKnowledge): string {
    return `${k.type}:${k.content.slice(0, 50)}`;
  }

  /** 获取提取统计 */
  getStats(): { totalExtracted: number; recentCacheSize: number } {
    return {
      totalExtracted: this.totalExtracted,
      recentCacheSize: this.recentExtractions.size,
    };
  }

  // ── Phase 4a: 问答对提取 + 判断力样本 ──

  /** 预检：对话是否包含专业知识 */
  containsExpertKnowledge(messages: Message[]): boolean {
    const expertSignals = [
      /应该|必须|建议|推荐|最好|不应该|避免/i,
      /我发现|我通常|我习惯|经验上|实践中/i,
      /要注意|小心|容易出|踩过坑|教训/i,
      /不对|不是这个意思|应该这样|你搞错了|实际上/i,
      /因为.*所以|原因是|本质上|关键在于/i,
    ];

    const userMessages = messages.filter(m => m.role === 'user');
    for (const msg of userMessages) {
      for (const signal of expertSignals) {
        if (signal.test(msg.content)) return true;
      }
    }
    return false;
  }

  /** 从对话段提取问答对 */
  async extractQAPairs(messages: Message[]): Promise<TrainingSample[]> {
    const samples: TrainingSample[] = [];

    // 找到「用户问 → assistant 专业回答」的对话段
    for (let i = 0; i < messages.length - 1; i++) {
      if (messages[i].role !== 'user' || messages[i + 1].role !== 'assistant') continue;

      const question = messages[i].content;
      const answer = messages[i + 1].content;

      // 过滤：问题太短、回答太短、回答是通用模板
      if (question.length < 10 || answer.length < 30) continue;
      if (/^(好的|嗯|是的|没问题|当然|OK)/i.test(answer.trim())) continue;

      // 检测回答中是否包含专业知识
      const hasExpertise = /因为|由于|原因|关键|注意|建议|应该|最好|不要|避免|实际上|本质上/i.test(answer);
      if (!hasExpertise) continue;

      const domain = this.inferDomain(question + ' ' + answer);
      samples.push({
        instruction: `作为${domain}领域的专家，回答以下问题。`,
        input: question.slice(0, 200),
        output: answer.slice(0, 500),
        domain,
        confidence: 0.8,
        sourceType: 'conversation_qa',
      });
    }

    return samples;
  }

  /** 提取判断力样本（核心：情境→判断→原因） */
  async extractJudgmentPatterns(messages: Message[]): Promise<TrainingSample[]> {
    const samples: TrainingSample[] = [];

    for (let i = 0; i < messages.length - 1; i++) {
      const user = messages[i];
      const assistant = messages[i + 1];
      if (user.role !== 'user' || assistant?.role !== 'assistant') continue;

      // 类型 1：纠正样本 — 用户纠正 assistant
      if (/不对|不是这样|你搞错了|错了|实际上|应该是|应该是这样|换个思路/i.test(user.content)) {
        const domain = this.inferDomain(user.content + ' ' + (assistant?.content ?? ''));
        samples.push({
          instruction: `以下方案有误，请给出正确方案并解释为什么原方案不行。`,
          input: `之前的方案：${(assistant?.content ?? '').slice(0, 150)}\n用户反馈：${user.content.slice(0, 150)}`,
          output: user.content.slice(0, 500),
          domain,
          confidence: 0.9, // 纠正信号 = 高价值
          sourceType: 'correction',
        });
      }

      // 类型 2：踩坑→修正样本
      if (/之前.*错|踩过坑|犯过|教训|后来改|调整后/i.test(user.content) && user.content.length > 20) {
        const domain = this.inferDomain(user.content);
        samples.push({
          instruction: `作为${domain}领域专家，分析以下情境并给出最佳方案及原因。`,
          input: user.content.slice(0, 200),
          output: user.content.slice(0, 500),
          domain,
          confidence: 0.85,
          sourceType: 'judgment',
        });
      }

      // 类型 3：决策过程样本 — 用户描述为什么选A不选B
      if (/选.*而不是|相比.*更|之所以.*是因为|权衡/i.test(user.content) && user.content.length > 30) {
        const domain = this.inferDomain(user.content);
        samples.push({
          instruction: `分析以下技术选型决策，说明各方案优劣和推荐理由。`,
          input: user.content.slice(0, 200),
          output: user.content.slice(0, 500),
          domain,
          confidence: 0.85,
          sourceType: 'judgment',
        });
      }
    }

    return samples;
  }
}
