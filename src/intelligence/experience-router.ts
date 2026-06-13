/**
 * 经验路由器 — 基于置信度 + 新颖度 + Thompson Sampling 的自适应路由
 *
 * 四层路由（基于 AgentRR / APC 学术研究）：
 * 极低新颖度 → 零 LLM 直接执行
 * 中等新颖度 → 执行 + LLM 质检
 * 高新颖度   → LLM 为主，经验为参考
 * 极高新颖度 → 纯 LLM + 强制学习
 *
 * Thompson Sampling：在多个候选经验之间做探索/利用权衡，
 * 而不是永远选置信度最高的。
 */

import type { ExperienceUnit, RouteDecision, RoutePath } from './types.js';
import { ExperienceGraph } from './experience-graph.js';

export interface RouterConfig {
  highThreshold: number;           // 高置信度阈值，默认 0.8
  mediumThreshold: number;         // 中置信度阈值，默认 0.5
  minSuccessCount: number;         // 最少成功次数（高置信度要求），默认 3
  maxCandidates: number;           // 最大候选数，默认 5
  noveltyHighThreshold: number;    // 高新颖度阈值，默认 0.7
  noveltyExtremeThreshold: number; // 极高新颖度阈值，默认 0.9
  /** Thompson Sampling 探索系数（越大越倾向探索） */
  explorationFactor: number;       // 默认 1.0
  /** 是否启用 Thompson Sampling */
  useThompsonSampling: boolean;    // 默认 true
}

const DEFAULT_CONFIG: RouterConfig = {
  highThreshold: 0.8,
  mediumThreshold: 0.5,
  minSuccessCount: 3,
  maxCandidates: 5,
  noveltyHighThreshold: 0.7,
  noveltyExtremeThreshold: 0.9,
  explorationFactor: 1.0,
  useThompsonSampling: true,
};

export class ExperienceRouter {
  private graph: ExperienceGraph;
  private config: RouterConfig;

  constructor(graph: ExperienceGraph, config?: Partial<RouterConfig>) {
    this.graph = graph;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 路由决策 — 四层自适应路由 + Thompson Sampling
   */
  /**
   * 路由决策 — 四层自适应路由 + Thompson Sampling + 元认知检查
   *
   * 元认知检查（v3.1 新增）：
   * 在所有路由之前，先检查直觉信号的质量预判。
   * quality < 0.3 → 强制 LLM（极度不确定）
   * quality < 0.5 → 走经验但要求 LLM 验证
   *
   * 基于 MUSE (arXiv 2024) + Uncertainty as Control Signal (arXiv 2025)
   */
  route(input: string, contextTags: string[] = [], qualityEstimate?: number): RouteDecision {
    // ── 元认知检查（在所有路由之前）──
    if (qualityEstimate !== undefined) {
      // 极低信心 → 强制走 LLM，跳过所有经验
      if (qualityEstimate < 0.3) {
        return {
          path: 'llm_only',
          reason: 'metacognitive_uncertainty',
          novelty: 1.0,
          confidence: qualityEstimate,
        };
      }
      // 中等信心 → 走经验但要求 LLM 验证
      if (qualityEstimate < 0.5) {
        // 仍然尝试匹配经验，但强制走验证路径
        const candidates = this.graph.match(input, contextTags);
        if (candidates.length > 0) {
          const selected = this.rankCandidates(candidates, input)[0];
          return {
            path: 'exp_verified',
            skill: selected,
            reason: 'metacognitive_caution',
            confidence: qualityEstimate,
            novelty: this.calcNovelty(selected, input),
          };
        }
        // 没有匹配经验 → 纯 LLM
        return {
          path: 'llm_only',
          reason: 'metacognitive_caution_no_exp',
          novelty: 1.0,
          confidence: qualityEstimate,
        };
      }
    }

    // ── 原有路由逻辑 ──
    const candidates = this.graph.match(input, contextTags);

    // 没有任何匹配 → 纯 LLM
    if (candidates.length === 0) {
      return { path: 'llm_only', reason: 'no_exp_matched', novelty: 1.0 };
    }

    // Thompson Sampling：在多个候选中选一个（而非永远选排名最高的）
    let selected: ExperienceUnit;
    if (this.config.useThompsonSampling && candidates.length > 1) {
      selected = this.thompsonSelect(candidates);
    } else {
      selected = this.rankCandidates(candidates, input)[0];
    }

    const novelty = this.calcNovelty(selected, input);

    // 极高新颖度 → 纯 LLM + 强制学习
    if (novelty >= this.config.noveltyExtremeThreshold) {
      return { path: 'llm_only', skill: selected, reason: 'extreme_novelty', novelty, confidence: selected.stats.confidence };
    }

    // 高置信度 + 足够成功次数 + 低新颖度 → 零 LLM
    if (
      selected.stats.confidence >= this.config.highThreshold &&
      selected.stats.successCount >= this.config.minSuccessCount &&
      novelty < this.config.noveltyHighThreshold
    ) {
      return { path: 'exp_direct', skill: selected, confidence: selected.stats.confidence, novelty };
    }

    // 中置信度 → 执行 + LLM 验证
    if (selected.stats.confidence >= this.config.mediumThreshold && novelty < this.config.noveltyHighThreshold) {
      return { path: 'exp_verified', skill: selected, confidence: selected.stats.confidence, novelty };
    }

    // 高新颖度或低置信度 → LLM 为主，技能为 hint
    return { path: 'llm_with_hint', skill: selected, confidence: selected.stats.confidence, novelty };
  }

  /**
   * 获取所有候选技能（用于调试/展示）
   */
  getCandidates(input: string, contextTags: string[] = []): ExperienceUnit[] {
    const matched = this.graph.match(input, contextTags);
    return this.rankCandidates(matched, input).slice(0, this.config.maxCandidates);
  }

  /**
   * 判断是否可以用自产智能处理
   */
  canHandleLocally(input: string, contextTags: string[] = []): boolean {
    const decision = this.route(input, contextTags);
    return decision.path === 'exp_direct' || decision.path === 'exp_verified';
  }

  // ── Thompson Sampling ──

  /**
   * Thompson Sampling 选择算法
   *
   * 将每个经验视为一个 Bernoulli 臂，用 Beta(α, β) 分布采样。
   * α = 成功次数 + 1, β = 失败次数 + 1
   *
   * 高置信度（多成功）的经验被选中概率更高，
   * 但低使用次数的经验也有机会被探索（避免局部最优）。
   *
   * 探索系数控制探索力度：>1 更激进探索，<1 更保守利用。
   */
  private thompsonSelect(candidates: ExperienceUnit[]): ExperienceUnit {
    let bestSample = -1;
    let selected = candidates[0];

    for (const exp of candidates) {
      const alpha = exp.stats.successCount + 1;
      const beta = exp.stats.failCount + 1;

      // Beta 分布采样（使用 Gamma 近似）
      const sample = this.sampleBeta(alpha, beta) * this.config.explorationFactor;

      if (sample > bestSample) {
        bestSample = sample;
        selected = exp;
      }
    }

    return selected;
  }

  /**
   * Beta(α, β) 分布采样
   * 通过 Gamma 分布近似：Beta(α,β) ≈ X/(X+Y) where X~Gamma(α,1), Y~Gamma(β,1)
   */
  private sampleBeta(alpha: number, beta: number): number {
    const x = this.sampleGamma(alpha);
    const y = this.sampleGamma(beta);
    return x / (x + y);
  }

  /**
   * Gamma(k, 1) 分布采样（Marsaglia & Tsang 方法）
   * k >= 1 时使用 Marsaglia-Tsang；k < 1 时使用 Ahrens-Dieter
   */
  private sampleGamma(shape: number): number {
    if (shape < 1) {
      // Ahrens-Dieter method
      return this.sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
    }

    // Marsaglia & Tsang method
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);

    while (true) {
      let x: number;
      let v: number;
      do {
        x = this.randomNormal();
        v = 1 + c * x;
      } while (v <= 0);

      v = v * v * v;
      const u = Math.random();

      // Squeeze test
      if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  /**
   * 标准正态分布采样（Box-Muller）
   */
  private randomNormal(): number {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  // ── 新颖度计算 ──

  /**
   * 计算输入相对于最佳匹配经验的新颖度 (0-1)
   * 1.0 = 完全没见过，0.0 = 非常熟悉
   *
   * 基于：
   * - 匹配分数（越低越新颖）
   * - 关键词覆盖率（越低越新颖）
   * - 经验使用次数（越少越新颖）
   */
  private calcNovelty(best: ExperienceUnit, input: string): number {
    const inputLower = input.toLowerCase();

    // 关键词覆盖率
    const matchedKw = best.trigger.keywords.filter(kw =>
      inputLower.includes(kw.toLowerCase())
    ).length;
    const kwCoverage = best.trigger.keywords.length > 0
      ? matchedKw / best.trigger.keywords.length
      : 0;

    // 经验成熟度（使用次数越多越成熟）
    const maturity = Math.min(1, (best.stats.successCount + best.stats.failCount) / 20);

    // 新颖度 = 1 - (关键词覆盖 * 0.5 + 成熟度 * 0.3 + 置信度 * 0.2)
    const familiarity = kwCoverage * 0.5 + maturity * 0.3 + best.stats.confidence * 0.2;
    return Math.max(0, Math.min(1, 1 - familiarity));
  }

  // ── 排序算法 ──

  private rankCandidates(candidates: ExperienceUnit[], input: string): ExperienceUnit[] {
    return candidates.sort((a, b) => {
      const scoreA = this.calcScore(a, input);
      const scoreB = this.calcScore(b, input);
      return scoreB - scoreA;
    });
  }

  private calcScore(skill: ExperienceUnit, input: string): number {
    let score = 0;

    // 置信度权重 (35%)
    score += skill.stats.confidence * 0.35;

    // 成功次数权重 (15%)
    const successNorm = Math.min(1, skill.stats.successCount / 10);
    score += successNorm * 0.15;

    // 关键词精确匹配 (20%)
    const inputLower = input.toLowerCase();
    const matchedKw = skill.trigger.keywords.filter(kw =>
      inputLower.includes(kw.toLowerCase())
    ).length;
    score += (matchedKw / Math.max(1, skill.trigger.keywords.length)) * 0.2;

    // Phase 6: reasoning 语义匹配 (15%)
    if (skill.reasoning) {
      const reasoningLower = skill.reasoning.toLowerCase();
      // 英文单词
      const enWords = reasoningLower.match(/[a-z_]{2,}/g) ?? [];
      // 中文二元组（bigram）用于语义匹配
      const cnSegments = reasoningLower.replace(/[a-zA-Z0-9_\s]+/g, ' ').replace(/[，。、！？；：]+/g, ' ');
      const cnPhrases = cnSegments.match(/[\u4e00-\u9fa5]+/g) ?? [];
      const bigrams = new Set<string>();
      for (const seg of cnPhrases) {
        for (let i = 0; i < seg.length - 1; i++) {
          bigrams.add(seg.slice(i, i + 2));
        }
      }
      const reasoningTokens = [...new Set([...enWords, ...bigrams])];
      const matchedReasoning = reasoningTokens.filter(w => inputLower.includes(w)).length;
      if (reasoningTokens.length > 0) {
        score += (matchedReasoning / reasoningTokens.length) * 0.15;
      }
    }

    // 最近使用 (10%)
    const hoursSinceUse = (Date.now() - skill.stats.lastUsed) / 3600000;
    const recency = Math.exp(-hoursSinceUse / 168); // 一周半衰期
    score += recency * 0.1;

    // 失败惩罚 (5%)
    const failRate = skill.stats.failCount / Math.max(1, skill.stats.successCount + skill.stats.failCount);
    score -= failRate * 0.05;

    return Math.max(0, score);
  }
}
