/**
 * 跨域知识迁移 — 学一得十
 *
 * 来源: Transfer Learning for AI Agents (InfoQ 2025) + CADENT (arXiv 2026.01)
 *
 * 核心思想: 发现不同 fingerprint 的缺口有相似结构 → 自动生成迁移规则。
 * 学会"git commit"的决策模式，自动迁移到"svn commit"或"hg commit"。
 */

import type {
  CapabilityGap, EvolutionProposal, Rule, BrainProvider,
} from '../types.js';

// ── 类型定义 ──

export interface DomainMapping {
  /** 源领域 fingerprint */
  source: string;
  /** 目标领域 fingerprint */
  target: string;
  /** 结构相似度 0-1 */
  similarity: number;
  /** 可迁移的规则 ID */
  transferableRules: string[];
  /** 概念映射 */
  patternMappings: PatternMapping[];
}

export interface PatternMapping {
  sourceConcept: string;
  targetConcept: string;
  confidence: number;
}

export interface TransferResult {
  mapping: DomainMapping;
  rulesTransferred: number;
  success: boolean;
  durationMs: number;
}

export interface TransferConfig {
  /** 最小相似度阈值 */
  minSimilarity: number;
  /** 最少成功样本数才允许迁移 */
  minSuccessSamples: number;
  /** 迁移后规则的优先级衰减因子 */
  priorityDecay: number;
  /** 最大迁移规则数 per mapping */
  maxRulesPerMapping: number;
}

const DEFAULT_CONFIG: TransferConfig = {
  minSimilarity: 0.7,
  minSuccessSamples: 10,
  priorityDecay: 0.8,
  maxRulesPerMapping: 5,
};

// ── TransferLearner 核心 ──

export class TransferLearner {
  private config: TransferConfig;
  private brain: BrainProvider | null = null;
  private transferHistory: TransferResult[] = [];

  constructor(config?: Partial<TransferConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setBrainProvider(brain: BrainProvider): void {
    this.brain = brain;
  }

  /**
   * 发现可迁移的领域对
   *
   * 分析 DecisionMemory 的聚类统计，找出结构相似但独立学习的领域
   */
  findTransferable(gaps: CapabilityGap[]): DomainMapping[] {
    const mappings: DomainMapping[] = [];

    for (let i = 0; i < gaps.length; i++) {
      for (let j = i + 1; j < gaps.length; j++) {
        const sim = this.structuralSimilarity(gaps[i], gaps[j]);
        if (sim >= this.config.minSimilarity) {
          mappings.push({
            source: gaps[i].fingerprint,
            target: gaps[j].fingerprint,
            similarity: sim,
            transferableRules: [],
            patternMappings: this.mapConcepts(gaps[i], gaps[j]),
          });
        }
      }
    }

    return mappings.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * 执行迁移 — 将源领域的规则复制到目标领域
   */
  async transfer(
    mapping: DomainMapping,
    rules: Rule[],
  ): Promise<TransferResult> {
    const startTime = Date.now();

    // 找到源领域中成功率高的规则
    const sourceRules = rules.filter(r =>
      r.source === 'learned' &&
      r.stats.hits > this.config.minSuccessSamples &&
      r.stats.successes / r.stats.hits > 0.6,
    );

    // 限制迁移数量
    const toTransfer = sourceRules.slice(0, this.config.maxRulesPerMapping);

    let transferred = 0;
    if (this.brain) {
      for (const rule of toTransfer) {
        const adapted = this.adaptRule(rule, mapping.patternMappings);
        this.brain.addLearnedRule(adapted);
        transferred++;
      }
    }

    const result: TransferResult = {
      mapping,
      rulesTransferred: transferred,
      success: transferred > 0,
      durationMs: Date.now() - startTime,
    };

    this.transferHistory.push(result);
    return result;
  }

  /**
   * 自动发现并迁移
   */
  async autoTransfer(gaps: CapabilityGap[], rules: Rule[]): Promise<TransferResult[]> {
    const mappings = this.findTransferable(gaps);
    const results: TransferResult[] = [];

    for (const mapping of mappings) {
      const result = await this.transfer(mapping, rules);
      results.push(result);
    }

    return results;
  }

  /**
   * 获取迁移历史
   */
  getHistory(): TransferResult[] {
    return [...this.transferHistory];
  }

  /**
   * 获取迁移摘要
   */
  getSummary(): {
    totalTransfers: number;
    totalRulesTransferred: number;
    successfulTransfers: number;
    avgSimilarity: number;
  } {
    const successful = this.transferHistory.filter(r => r.success);
    return {
      totalTransfers: this.transferHistory.length,
      totalRulesTransferred: this.transferHistory.reduce((s, r) => s + r.rulesTransferred, 0),
      successfulTransfers: successful.length,
      avgSimilarity: this.transferHistory.length > 0
        ? this.transferHistory.reduce((s, r) => s + r.mapping.similarity, 0) / this.transferHistory.length
        : 0,
    };
  }

  // ── 内部方法 ──

  /**
   * 计算两个领域的结构相似度
   *
   * 基于 fingerprint 的组成部分：
   * - domains 重叠度
   * - complexity 匹配度
   * - taskType 匹配度
   */
  private structuralSimilarity(a: CapabilityGap, b: CapabilityGap): number {
    const fpA = a.fingerprint.split('|');
    const fpB = b.fingerprint.split('|');

    // Domain 重叠度
    const domainsA = (fpA[0] ?? '').split(',').map(d => d.trim());
    const domainsB = (fpB[0] ?? '').split(',').map(d => d.trim());
    const intersection = domainsA.filter(d => domainsB.includes(d));
    const union = new Set([...domainsA, ...domainsB]);
    const domainSim = union.size > 0 ? intersection.length / union.size : 0;

    // Complexity 匹配度
    const complexitySim = fpA[1] === fpB[1] ? 1 : 0.3;

    // TaskType 匹配度
    const taskSim = fpA[2] === fpB[2] ? 1 : 0.2;

    // 加权平均
    return domainSim * 0.5 + complexitySim * 0.25 + taskSim * 0.25;
  }

  /**
   * 生成概念映射
   */
  private mapConcepts(a: CapabilityGap, b: CapabilityGap): PatternMapping[] {
    const domainsA = a.fingerprint.split('|')[0]?.split(',').map(d => d.trim()) ?? [];
    const domainsB = b.fingerprint.split('|')[0]?.split(',').map(d => d.trim()) ?? [];

    const mappings: PatternMapping[] = [];

    // 对每个共同 domain 生成映射
    for (const dA of domainsA) {
      for (const dB of domainsB) {
        if (dA !== dB) {
          mappings.push({
            sourceConcept: dA,
            targetConcept: dB,
            confidence: 0.7,
          });
        }
      }
    }

    return mappings;
  }

  /**
   * 适配规则 — 将源规则的概念替换为目标领域
   */
  private adaptRule(rule: Rule, mappings: PatternMapping[]): Rule {
    // 创建新规则，优先级衰减
    return {
      ...rule,
      id: `transfer-${rule.id}-${Date.now()}`,
      name: `[迁移] ${rule.name}`,
      priority: Math.max(1, Math.round(rule.priority * this.config.priorityDecay)),
      source: 'learned',
      stats: { hits: 0, successes: 0, lastUsed: 0 },
      createdAt: Date.now(),
    };
  }
}
