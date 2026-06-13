/**
 * Prompt 注入引擎 — 将 STMP 积累的领域知识注入对话上下文
 *
 * 核心理念：不需要等 LoRA 微调，知识积累到一定程度后，
 * 通过 Prompt 注入让 LLM 立即获得领域专业判断力。
 *
 * 流程：
 * 1. 检测用户意图是否命中已有领域
 * 2. 从 STMP 检索命中领域的知识节点
 * 3. 按置信度/重要性排序，组装领域 Prompt
 * 4. 注入到系统 Prompt 中（控制 Token 预算）
 */

import type { STMPStore } from '../memory/stmp.js';
import type { CognitiveEngine } from '../cognitive/engine.js';

// ── 知识节点类型 ──

export interface KnowledgeNode {
  id: string;
  content: string;
  domain: string;
  type: 'decision_rule' | 'exception' | 'pattern' | 'risk' | 'best_practice' | 'general';
  confidence: number;       // 0-1
  importance: number;       // 1-5
  accessCount: number;
  timestamp: number;
}

// ── 注入配置 ──

export interface InjectorConfig {
  /** 最大 Token 预算（估算字符数） */
  maxTokenBudget: number;
  /** 最低置信度阈值 */
  minConfidence: number;
  /** 单个知识节点最大长度 */
  maxNodeLength: number;
  /** 每个领域最多注入节点数 */
  maxNodesPerDomain: number;
  /** 是否启用 */
  enabled: boolean;
}

const DEFAULT_CONFIG: InjectorConfig = {
  maxTokenBudget: 2000,     // ~500 tokens
  minConfidence: 0.6,
  maxNodeLength: 200,
  maxNodesPerDomain: 8,
  enabled: true,
};

// ── 领域知识包 ──

export interface DomainKnowledgePack {
  domain: string;
  growthStage: string;
  nodes: KnowledgeNode[];
  totalTokens: number;      // 估算
  confidence: number;       // 平均置信度
}

// ── 注入结果 ──

export interface InjectionResult {
  /** 注入的 Prompt 片段 */
  prompt: string;
  /** 命中的领域 */
  domains: string[];
  /** 注入的知识节点数 */
  nodeCount: number;
  /** 估算 Token 数 */
  estimatedTokens: number;
  /** 是否跳过（无知识或预算不足） */
  skipped: boolean;
  skipReason?: string;
}

/**
 * Prompt 注入引擎
 */
export class PromptInjector {
  private stmp: STMPStore;
  private cognitive: CognitiveEngine;
  private config: InjectorConfig;
  private verbose: boolean;

  // 领域关键词缓存（避免重复查询）
  private domainKeywordsCache: Map<string, string[]> = new Map();
  private cacheExpiry = 0;
  private readonly CACHE_TTL_MS = 60_000; // 1 分钟

  constructor(stmp: STMPStore, cognitive: CognitiveEngine, config?: Partial<InjectorConfig>, verbose = false) {
    this.stmp = stmp;
    this.cognitive = cognitive;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.verbose = verbose;
  }

  /**
   * 检查用户消息是否命中已有领域知识
   */
  async checkDomainHit(content: string): Promise<string[]> {
    const domains = this.cognitive.getAllDomainProfiles();
    const hitDomains: string[] = [];

    const contentLower = content.toLowerCase();
    const contentTokens = this.tokenize(contentLower);

    for (const domain of domains) {
      // 跳过 seed 阶段（知识不足）
      if (domain.growthStage === 'seed') continue;

      const keywords = await this.getDomainKeywords(domain.domain);
      let matchScore = 0;

      for (const kw of keywords) {
        if (contentLower.includes(kw.toLowerCase())) {
          matchScore += kw.length > 4 ? 2 : 1; // 长关键词权重更高
        }
      }

      // 领域置信度加权
      const threshold = domain.growthStage === 'mature' ? 2 : 4;
      if (matchScore >= threshold) {
        hitDomains.push(domain.domain);
      }
    }

    return hitDomains;
  }

  /**
   * 从 STMP 检索领域知识并组装注入 Prompt
   */
  async buildInjection(content: string): Promise<InjectionResult> {
    if (!this.config.enabled) {
      return { prompt: '', domains: [], nodeCount: 0, estimatedTokens: 0, skipped: true, skipReason: 'disabled' };
    }

    // 1. 检测命中领域
    const hitDomains = await this.checkDomainHit(content);
    if (hitDomains.length === 0) {
      return { prompt: '', domains: [], nodeCount: 0, estimatedTokens: 0, skipped: true, skipReason: 'no domain hit' };
    }

    // 2. 为每个命中领域收集知识节点
    const packs: DomainKnowledgePack[] = [];
    for (const domain of hitDomains) {
      const pack = await this.collectDomainKnowledge(domain);
      if (pack.nodes.length > 0) {
        packs.push(pack);
      }
    }

    if (packs.length === 0) {
      return { prompt: '', domains: hitDomains, nodeCount: 0, estimatedTokens: 0, skipped: true, skipReason: 'no knowledge nodes' };
    }

    // 3. 按置信度排序，组装 Prompt（控制 Token 预算）
    const { prompt, nodeCount, estimatedTokens } = this.assemblePrompt(packs);

    if (nodeCount === 0) {
      return { prompt: '', domains: hitDomains, nodeCount: 0, estimatedTokens: 0, skipped: true, skipReason: 'budget exhausted' };
    }

    if (this.verbose) {
      console.log(`  [PromptInjector] 注入: ${hitDomains.join(', ')} | ${nodeCount} 节点 | ~${estimatedTokens} chars`);
    }

    return { prompt, domains: hitDomains, nodeCount, estimatedTokens, skipped: false };
  }

  /**
   * 收集某个领域的知识节点
   */
  private async collectDomainKnowledge(domain: string): Promise<DomainKnowledgePack> {
    const profile = this.cognitive.getDomainProfile(domain);
    const nodes: KnowledgeNode[] = [];

    try {
      // 从 STMP 检索领域相关知识
      const result = await this.stmp.retrieve(domain, { maxPrimary: 15, maxAssociative: 5 });

      for (const node of [...result.primary, ...result.associative]) {
        if (node.content.length < 10) continue;
        if (node.content.length > this.config.maxNodeLength * 2) continue;

        const kn: KnowledgeNode = {
          id: node.id,
          content: node.content.slice(0, this.config.maxNodeLength),
          domain,
          type: this.classifyKnowledgeType(node.content),
          confidence: node.emotional?.importance ? node.emotional.importance / 10 : 0.5,
          importance: node.emotional?.importance ?? 5,
          accessCount: node.lifecycle?.accessCount ?? 0,
          timestamp: node.timestamp,
        };

        if (kn.confidence >= this.config.minConfidence) {
          nodes.push(kn);
        }
      }
    } catch (err) {
      if (this.verbose) console.warn(`[PromptInjector] 检索 ${domain} 失败:`, (err as Error).message);
    }

    // 按置信度 × 重要性排序
    nodes.sort((a, b) => (b.confidence * b.importance) - (a.confidence * a.importance));

    // 截断
    const truncated = nodes.slice(0, this.config.maxNodesPerDomain);

    const totalTokens = truncated.reduce((sum, n) => sum + n.content.length, 0);

    return {
      domain,
      growthStage: profile?.growthStage ?? 'unknown',
      nodes: truncated,
      totalTokens,
      confidence: truncated.length > 0
        ? truncated.reduce((s, n) => s + n.confidence, 0) / truncated.length
        : 0,
    };
  }

  /**
   * 组装注入 Prompt（控制 Token 预算）
   */
  private assemblePrompt(packs: DomainKnowledgePack[]): { prompt: string; nodeCount: number; estimatedTokens: number } {
    let budget = this.config.maxTokenBudget;
    let nodeCount = 0;
    let sections: string[] = [];

    // 按平均置信度排序领域（高质量优先）
    packs.sort((a, b) => b.confidence - a.confidence);

    for (const pack of packs) {
      if (budget <= 0) break;

      const stageLabel = pack.growthStage === 'mature' ? '🎯 精通' : '📖 学习中';
      let section = `### 领域: ${pack.domain} (${stageLabel})\n`;

      let domainNodeCount = 0;
      for (const node of pack.nodes) {
        if (budget <= 0) break;

        const typeLabel = this.getTypeLabel(node.type);
        const line = `- [${typeLabel}] ${node.content}\n`;

        if (line.length > budget) continue; // 跳过超长节点

        section += line;
        budget -= line.length;
        nodeCount++;
        domainNodeCount++;
      }

      if (domainNodeCount > 0) {
        sections.push(section);
      }
    }

    if (sections.length === 0) {
      return { prompt: '', nodeCount: 0, estimatedTokens: 0 };
    }

    const prompt = '\n## 领域专业知识注入\n' +
      '以下是你在相关领域积累的专业知识，在回答时优先参考：\n\n' +
      sections.join('\n') +
      '\n---\n';

    const estimatedTokens = prompt.length;
    return { prompt, nodeCount, estimatedTokens };
  }

  /**
   * 分类知识类型
   */
  private classifyKnowledgeType(content: string): KnowledgeNode['type'] {
    const lower = content.toLowerCase();

    if (/应该|必须|建议|推荐|最好|should|must|recommend/i.test(lower)) return 'best_practice';
    if (/注意|小心|避免|风险|警告|warning|caution|risk/i.test(lower)) return 'risk';
    if (/但是|不过|例外|特殊情况|except|however|but/i.test(lower)) return 'exception';
    if (/规则|如果.*就|当.*时|判断|rule|if.*then/i.test(lower)) return 'decision_rule';
    if (/模式|规律|经常|通常|pattern|usually|often/i.test(lower)) return 'pattern';
    return 'general';
  }

  /**
   * 获取知识类型标签
   */
  private getTypeLabel(type: KnowledgeNode['type']): string {
    const labels: Record<string, string> = {
      decision_rule: '规则',
      exception: '例外',
      pattern: '模式',
      risk: '风险',
      best_practice: '最佳实践',
      general: '知识',
    };
    return labels[type] ?? '知识';
  }

  /**
   * 获取领域关键词（带缓存）
   */
  private async getDomainKeywords(domain: string): Promise<string[]> {
    // 检查缓存
    if (this.domainKeywordsCache.has(domain) && Date.now() < this.cacheExpiry) {
      return this.domainKeywordsCache.get(domain)!;
    }

    const keywords = new Set<string>();

    // 从领域名提取
    keywords.add(domain);
    const domainWords = domain.split(/[_\-/\s]+/);
    domainWords.forEach(w => { if (w.length >= 2) keywords.add(w); });

    // 从认知引擎的领域画像中提取
    try {
      const profile = this.cognitive.getDomainProfile(domain);
      if (profile) {
        // domainType 可能包含领域信息
        keywords.add(profile.domainType);
      }
    } catch { /* ignore */ }

    const result = [...keywords];
    this.domainKeywordsCache.set(domain, result);
    this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;

    return result;
  }

  /**
   * 简单分词
   */
  private tokenize(text: string): string[] {
    return text
      .replace(/[，。！？、；：""''（）\[\]{}<>,.!?;:()\[\]{}<>]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2);
  }

  /**
   * 更新配置
   */
  updateConfig(patch: Partial<InjectorConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  /**
   * 获取当前配置
   */
  getConfig(): InjectorConfig {
    return { ...this.config };
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.domainKeywordsCache.clear();
    this.cacheExpiry = 0;
  }
}
