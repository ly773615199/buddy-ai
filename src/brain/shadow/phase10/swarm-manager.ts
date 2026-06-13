/**
 * 多影子并行探索 — 群体进化
 *
 * 来源: Group-Evolving Agents (arXiv 2026.02) — SWE-bench 71% vs DGM 56.7%
 *
 * 核心思想: 同时启动多个影子副本，每个探索不同方向，取最优合入。
 * 避免单线程进化"一条路走到黑"的问题。
 *
 * 验证策略：漏斗式互补
 * - 通道1 离线模拟：基于聚类统计估计，做门槛过滤（低于阈值直接淘汰）
 * - 通道2 影子副本：基于真实规则推理，做精确校准（得分即最终得分）
 * - 互补：离线拦住"统计不值得"的方案，副本拦住"规则有缺陷"的方案
 */

import type {
  CapabilityGap, EvolutionProposal, EvolutionContext,
  ABTestResult, LockResult, BrainProvider,
  TaskSignal, ResourceState, Rule,
} from '../types.js';
import { isShadowCapable, type ShadowCapableBrainProvider } from '../types.js';
import { EvolutionEngine } from '../evolution-engine.js';
import { EvolutionLock } from '../evolution-lock.js';

// ── 类型定义 ──

export interface SwarmConfig {
  /** 最大并行影子数 */
  maxParallel: number;
  /** 合并策略 */
  mergeStrategy: 'best' | 'ensemble' | 'vote';
  /** 方案间最小差异度 (0-1) */
  diversityRequirement: number;
  /** 每个影子的 A/B 测试轮数（离线通道） */
  abTestRounds: number;
  /** 影子副本测试轮数（副本通道） */
  replayRounds: number;
  /** 超时时间 (ms) */
  timeoutMs: number;
  /** 离线模拟通过阈值（低于此值直接淘汰，不做副本验证） */
  minOfflineScore: number;
}

export interface SwarmResult {
  /** 最优方案 */
  bestProposal: EvolutionProposal | null;
  /** 所有方案的验证结果 */
  results: SwarmCandidate[];
  /** 选择理由 */
  reason: string;
  /** 总耗时 */
  durationMs: number;
}

export interface SwarmCandidate {
  proposal: EvolutionProposal;
  /** 通道1: 离线模拟结果 */
  offlineResults: ABTestResult[];
  /** 通道2: 影子副本结果（null = 无副本能力） */
  replayResults: ABTestResult[] | null;
  /** 合并得分 */
  score: number;
  /** 离线通道得分 */
  offlineScore: number;
  /** 副本通道得分（null = 无副本能力） */
  replayScore: number | null;
  lockResult: LockResult | null;
  rank: number;
}

interface ShadowInstance {
  id: string;
  proposal: EvolutionProposal;
  state: 'pending' | 'running' | 'completed' | 'failed' | 'timeout';
  startTime: number;
  endTime: number | null;
}

const DEFAULT_CONFIG: SwarmConfig = {
  maxParallel: 3,
  mergeStrategy: 'best',
  diversityRequirement: 0.3,
  abTestRounds: 500,
  replayRounds: 100,
  timeoutMs: 300000, // 5 分钟
  minOfflineScore: 0.01,
};

// ── SwarmManager 核心 ──

export class SwarmManager {
  private config: SwarmConfig;
  private evolutionEngine: EvolutionEngine;
  private evolutionLock: EvolutionLock;
  private brainProvider: BrainProvider | null = null;
  private activeSwarms: Map<string, ShadowInstance[]> = new Map();

  constructor(
    evolutionEngine: EvolutionEngine,
    evolutionLock: EvolutionLock,
    config?: Partial<SwarmConfig>,
  ) {
    this.evolutionEngine = evolutionEngine;
    this.evolutionLock = evolutionLock;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setBrainProvider(provider: BrainProvider): void {
    this.brainProvider = provider;
  }

  // ── 主入口 ──

  /**
   * 启动多影子并行探索
   *
   * 流程:
   * 1. 生成多样化候选方案
   * 2. 并行验证每个方案（双通道）
   * 3. 按合并策略选择最优
   * 4. 返回最优方案（调用方负责合入）
   */
  async explore(gap: CapabilityGap, context: EvolutionContext): Promise<SwarmResult> {
    const startTime = Date.now();
    const swarmId = `swarm-${Date.now()}`;

    // Step 1: 生成候选方案
    const rawProposals = await this.evolutionEngine.generateProposals(gap, context);

    // Step 2: 确保方案多样性
    const diverseProposals = this.ensureDiversity(rawProposals);

    // 限制并行数
    const proposals = diverseProposals.slice(0, this.config.maxParallel);

    if (proposals.length === 0) {
      return {
        bestProposal: null,
        results: [],
        reason: '无有效候选方案',
        durationMs: Date.now() - startTime,
      };
    }

    // Step 3: 记录影子实例
    const instances: ShadowInstance[] = proposals.map(p => ({
      id: `${swarmId}-${p.id}`,
      proposal: p,
      state: 'pending',
      startTime: Date.now(),
      endTime: null,
    }));
    this.activeSwarms.set(swarmId, instances);

    // Step 4: 并行双通道验证
    const candidates = await this.validateParallel(proposals, gap, context);

    // Step 5: 选择最优
    const best = this.selectBest(candidates);

    // 清理
    this.activeSwarms.delete(swarmId);

    return {
      bestProposal: best?.proposal ?? null,
      results: candidates,
      reason: best
        ? `最优方案: ${best.proposal.description} (得分=${best.score.toFixed(3)}, 离线=${best.offlineScore.toFixed(3)}${best.replayScore !== null ? `, 副本=${best.replayScore.toFixed(3)}` : ''})`
        : '所有方案均未通过验证',
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * 获取活跃的探索任务状态
   */
  getActiveSwarms(): Array<{ swarmId: string; instances: ShadowInstance[] }> {
    return [...this.activeSwarms.entries()].map(([swarmId, instances]) => ({
      swarmId,
      instances: [...instances],
    }));
  }

  // ── 并行验证 ──

  private async validateParallel(
    proposals: EvolutionProposal[],
    gap: CapabilityGap,
    context: EvolutionContext,
  ): Promise<SwarmCandidate[]> {
    const candidates: SwarmCandidate[] = [];

    // 使用 Promise.allSettled 并行执行
    const validations = await Promise.allSettled(
      proposals.map(proposal => this.validateSingle(proposal, gap, context))
    );

    for (let i = 0; i < validations.length; i++) {
      const result = validations[i];
      if (result.status === 'fulfilled') {
        candidates.push(result.value);
      } else {
        // 验证失败的方案
        candidates.push({
          proposal: proposals[i],
          offlineResults: [],
          replayResults: null,
          score: 0,
          offlineScore: 0,
          replayScore: null,
          lockResult: null,
          rank: 0,
        });
      }
    }

    // 排名
    candidates.sort((a, b) => b.score - a.score);
    candidates.forEach((c, i) => c.rank = i + 1);

    return candidates;
  }

  /**
   * 漏斗式验证 — 离线过滤 → 副本验证
   *
   * 通道1（离线模拟）做门槛：低于阈值直接淘汰，不做副本验证
   * 通道2（影子副本）做校准：用真实推理结果作为最终得分
   *
   * 互补机制：
   * - 离线拦住"统计上不值得进化"的方案（副本的盲区）
   * - 副本拦住"规则机制有缺陷"的方案（离线的盲区）
   */
  private async validateSingle(
    proposal: EvolutionProposal,
    gap: CapabilityGap,
    context: EvolutionContext,
  ): Promise<SwarmCandidate> {
    if (!this.brainProvider) {
      throw new Error('BrainProvider not set');
    }

    // ── 通道1: 离线模拟（门槛）──
    const offlineResults = await this.runOfflineSimulation(proposal);
    const offlineScore = this.calcScore(offlineResults);

    // 低于阈值 → 直接淘汰，不走副本验证
    if (offlineScore < this.config.minOfflineScore) {
      return {
        proposal,
        offlineResults,
        replayResults: null,
        score: 0,
        offlineScore,
        replayScore: null,
        lockResult: null,
        rank: 0,
      };
    }

    // ── 通道2: 影子副本测试（校准）──
    let replayResults: ABTestResult[] | null = null;
    let replayScore: number | null = null;

    if (isShadowCapable(this.brainProvider)) {
      replayResults = await this.runShadowReplay(proposal, this.brainProvider);
      replayScore = this.calcScore(replayResults);
    }

    // ── 最终得分：副本得分即最终得分（无副本时降级为离线得分）──
    const score = replayScore !== null ? replayScore : offlineScore;

    // ── 进化锁验证 ──
    const allResults = replayResults
      ? [...offlineResults, ...replayResults]
      : offlineResults;

    const shadowState = {
      decisionEmbeddings: [] as Float32Array[],
      decisionDistribution: this.brainProvider.getDecisionDistribution(),
      nnWeights: this.brainProvider.getNNWeights(),
      regressionTestFailures: 0,
    };
    const prodState = {
      decisionEmbeddings: [] as Float32Array[],
      decisionDistribution: this.brainProvider.getDecisionDistribution(),
      nnWeights: this.brainProvider.getNNWeights(),
    };

    let lockResult: LockResult | null = null;
    try {
      const validation = await this.evolutionLock.validate(
        shadowState as any,
        prodState as any,
        allResults,
        proposal,
      );
      lockResult = {
        lockName: 'swarm-check',
        passed: validation.allPassed,
        score: validation.locks.reduce((s, l) => s + l.score, 0) / validation.locks.length,
        details: validation.summary,
      };
    } catch {
      lockResult = { lockName: 'swarm-check', passed: false, score: 0, details: '验证异常' };
    }

    return {
      proposal,
      offlineResults,
      replayResults,
      score: lockResult.passed ? score : score * 0.3,
      offlineScore,
      replayScore,
      lockResult,
      rank: 0,
    };
  }

  // ── 通道1: 离线模拟 ──

  /**
   * 离线 A/B 模拟 — 基于聚类统计估计
   *
   * 优势：快速、轻量、捕捉统计趋势
   * 劣势：使用固定 boost 估计，无法验证具体规则效果
   */
  private async runOfflineSimulation(proposal: EvolutionProposal): Promise<ABTestResult[]> {
    if (!this.brainProvider) return [];

    const samples = this.brainProvider.getDecisionSamples();
    if (samples.length < 50) return [];

    // 从聚类统计获取真实的基线成功率
    let totalSuccess = 0;
    let totalCount = 0;
    const clusterStats = new Map<string, { count: number; successRate: number }>();
    for (const sample of samples) {
      const stats = this.brainProvider.getClusterStats(sample.fingerprint);
      if (stats && stats.count > 0) {
        clusterStats.set(sample.fingerprint, stats);
        totalSuccess += stats.count * stats.successRate;
        totalCount += stats.count;
      }
    }
    const baseSuccessRate = totalCount > 0 ? totalSuccess / totalCount : 0.5;

    // 影子版本的预期成功率：基于真实聚类 + 进化方案预期提升
    const shadowBoost = proposal.level === 'L1' ? 0.05 : proposal.level === 'L2' ? 0.03 : 0;
    const shadowSuccessRate = Math.min(1, baseSuccessRate + shadowBoost);

    const results: ABTestResult[] = [];
    const rounds = Math.min(this.config.abTestRounds, samples.length);

    for (let i = 0; i < rounds; i++) {
      const sample = samples[i % samples.length];
      const stats = clusterStats.get(sample.fingerprint);
      const realSuccessRate = stats?.successRate ?? baseSuccessRate;

      const isShadow = i % 2 === 0;
      const successRate = isShadow
        ? Math.min(1, realSuccessRate + shadowBoost)
        : realSuccessRate;

      results.push({
        group: isShadow ? 'shadow' : 'production',
        success: Math.random() < successRate,
        latencyMs: 50 + Math.random() * 100,
        cost: 0.001,
      });
    }

    return results;
  }

  // ── 通道2: 影子副本测试 ──

  /**
   * 影子副本测试 — 用真实规则推理验证
   *
   * 优势：精确、捕捉规则级效果、发现离线模拟遗漏的问题
   * 劣势：需要 ShadowCapableBrainProvider，计算开销更大
   *
   * 流程：
   * 1. 深拷贝当前三脑状态
   * 2. 将方案的规则编译并加入影子副本
   * 3. 对历史样本用影子副本重新推理
   * 4. 与线上版本对比
   */
  private async runShadowReplay(
    proposal: EvolutionProposal,
    brain: ShadowCapableBrainProvider,
  ): Promise<ABTestResult[]> {
    // 深拷贝当前状态
    const shadowState = brain.cloneBrainState();
    const samples = this.brainProvider!.getDecisionSamples();
    if (samples.length < 10) return [];

    // 将方案的规则加入影子副本
    const shadowRules = this.applyProposalToRules(shadowState.rules, proposal);

    // 对历史样本重放推理
    const results: ABTestResult[] = [];
    const rounds = Math.min(this.config.replayRounds, samples.length);

    for (let i = 0; i < rounds; i++) {
      const sample = samples[i];
      const isShadow = i % 2 === 0;

      // 构造测试信号（从 fingerprint 反推）
      const signal = this.fingerprintToSignal(sample.fingerprint);
      const resources: ResourceState = {
        budgetRemaining: 100,
        availableNodeCount: 3,
        localCoverageRatio: 0.5,
        localConfidence: 0.6,
        userCorrectionCount: 0,
        experienceHit: null,
      };

      try {
        if (isShadow) {
          // 用影子规则集推理
          const shadowStateWithRules = { ...shadowState, rules: shadowRules };
          const result = await brain.replayDecision(shadowStateWithRules, signal, resources);
          results.push({
            group: 'shadow',
            success: result.success,
            latencyMs: result.latencyMs,
            cost: 0,
          });
        } else {
          // 用原始规则集推理（线上基线）
          const result = await brain.replayDecision(shadowState, signal, resources);
          results.push({
            group: 'production',
            success: result.success,
            latencyMs: result.latencyMs,
            cost: 0,
          });
        }
      } catch {
        results.push({
          group: isShadow ? 'shadow' : 'production',
          success: false,
          latencyMs: 0,
          cost: 0,
        });
      }
    }

    return results;
  }

  /**
   * 将方案的规则编译并加入规则集
   */
  private applyProposalToRules(existingRules: Rule[], proposal: EvolutionProposal): Rule[] {
    const newRules: Rule[] = [...existingRules];

    for (const change of proposal.changes) {
      if (change.target === 'left' && change.action === 'add' && proposal.type === 'new_rule') {
        const details = change.details as {
          name: string;
          condition: string;
          action: string;
          priority: number;
          source: string;
        };

        newRules.push({
          id: `swarm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: details.name,
          priority: details.priority,
          condition: (signal: TaskSignal, _resources: ResourceState) => {
            // 基于描述的关键词匹配（与 Orchestrator.compileCondition 一致）
            const desc = (details.condition ?? '').toLowerCase();
            const signalStr = [...signal.domains, signal.complexity, signal.taskType].join(' ').toLowerCase();
            const keywords = desc.match(/\b\w+\b/g) ?? [];
            return keywords.some(kw => signalStr.includes(kw));
          },
          action: (_signal: TaskSignal, _resources: ResourceState) => ({
            mode: 'single' as const,
            reason: `[swarm-replay] ${details.action}`,
            selectedNodes: [{ id: 'primary' as const, type: 'cloud_node' as const }],
            confidence: 0.6,
            source: 'evolved' as const,
          }),
          source: 'learned',
          stats: { hits: 0, successes: 0, lastUsed: 0 },
          createdAt: Date.now(),
        });
      }
    }

    return newRules;
  }

  /**
   * 从 fingerprint 反推 TaskSignal
   */
  private fingerprintToSignal(fingerprint: string): TaskSignal {
    const parts = fingerprint.split('|');
    const domains = (parts[0] ?? 'unknown').split(',').map(d => d.trim());
    const complexity = (parts[1] ?? 'medium') as TaskSignal['complexity'];
    const taskType = (parts[2] ?? 'tools') as TaskSignal['taskType'];
    return { domains, complexity, taskType, shouldUseDAG: false, dagReason: '', intentConfidence: 0.5 };
  }

  // ── 多样性保证 ──

  /**
   * 确保方案之间有足够的差异度
   *
   * 差异度计算:
   * - 不同 level (L1/L2/L3) → 高差异
   * - 不同 target (left/right/cerebellum) → 中差异
   * - 不同 type → 中差异
   */
  private ensureDiversity(proposals: EvolutionProposal[]): EvolutionProposal[] {
    if (proposals.length <= 1) return proposals;

    const diverse: EvolutionProposal[] = [proposals[0]];

    for (let i = 1; i < proposals.length; i++) {
      const candidate = proposals[i];
      let isDiverse = true;

      for (const selected of diverse) {
        const similarity = this.calcSimilarity(candidate, selected);
        if (similarity > 1 - this.config.diversityRequirement) {
          isDiverse = false;
          break;
        }
      }

      if (isDiverse) {
        diverse.push(candidate);
      }
    }

    return diverse;
  }

  /**
   * 计算两个方案的相似度 (0-1)
   */
  private calcSimilarity(a: EvolutionProposal, b: EvolutionProposal): number {
    let similarity = 0;
    let dimensions = 0;

    // level 相同 → +0.3
    dimensions++;
    if (a.level === b.level) similarity += 0.3;

    // type 相同 → +0.3
    dimensions++;
    if (a.type === b.type) similarity += 0.3;

    // target 相同 → +0.2
    const targetA = a.changes[0]?.target;
    const targetB = b.changes[0]?.target;
    dimensions++;
    if (targetA && targetB && targetA === targetB) similarity += 0.2;

    // description 余弦相似度 → +0.2
    dimensions++;
    const descSim = this.textSimilarity(a.description, b.description);
    similarity += descSim * 0.2;

    return similarity;
  }

  private textSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.split(/\s+/));
    const wordsB = new Set(b.split(/\s+/));
    const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    return union > 0 ? intersection / union : 0;
  }

  // ── 最优选择 ──

  private selectBest(candidates: SwarmCandidate[]): SwarmCandidate | null {
    const valid = candidates.filter(c => c.lockResult?.passed !== false);
    if (valid.length === 0) return null;

    switch (this.config.mergeStrategy) {
      case 'best':
        return valid.reduce((best, c) => c.score > best.score ? c : best);

      case 'ensemble':
        // 集成策略：选择与多数方案方向一致的
        return this.selectByEnsemble(valid);

      case 'vote':
        // 投票策略：选择 level/type 组合得票最多的
        return this.selectByVote(valid);

      default:
        return valid[0];
    }
  }

  private selectByEnsemble(candidates: SwarmCandidate[]): SwarmCandidate {
    // 计算每个方案与其他方案的平均相似度
    let best = candidates[0];
    let bestAvgSim = 0;

    for (const c of candidates) {
      let totalSim = 0;
      for (const other of candidates) {
        if (c.proposal.id !== other.proposal.id) {
          totalSim += this.calcSimilarity(c.proposal, other.proposal);
        }
      }
      const avgSim = totalSim / (candidates.length - 1);
      // 综合得分 = 原始得分 × 0.6 + 一致性 × 0.4
      const ensembleScore = c.score * 0.6 + avgSim * 0.4;
      if (ensembleScore > bestAvgSim) {
        bestAvgSim = ensembleScore;
        best = c;
      }
    }

    return best;
  }

  private selectByVote(candidates: SwarmCandidate[]): SwarmCandidate {
    // 按 level+type 分组投票
    const votes = new Map<string, { count: number; best: SwarmCandidate }>();

    for (const c of candidates) {
      const key = `${c.proposal.level}-${c.proposal.type}`;
      const existing = votes.get(key);
      if (!existing || c.score > existing.best.score) {
        votes.set(key, {
          count: (existing?.count ?? 0) + 1,
          best: c,
        });
      } else {
        existing.count++;
      }
    }

    // 得票最多且得分最高的
    let winner = candidates[0];
    let maxVotes = 0;
    for (const { count, best } of votes.values()) {
      if (count > maxVotes || (count === maxVotes && best.score > winner.score)) {
        maxVotes = count;
        winner = best;
      }
    }

    return winner;
  }

  // ── 辅助方法 ──

  private calcScore(abResults: ABTestResult[]): number {
    if (abResults.length === 0) return 0;

    const shadow = abResults.filter(r => r.group === 'shadow');
    const prod = abResults.filter(r => r.group === 'production');

    if (shadow.length === 0 || prod.length === 0) return 0;

    const shadowSuccess = shadow.filter(r => r.success).length / shadow.length;
    const prodSuccess = prod.filter(r => r.success).length / prod.length;

    const shadowLatency = shadow.reduce((s, r) => s + r.latencyMs, 0) / shadow.length;
    const prodLatency = prod.reduce((s, r) => s + r.latencyMs, 0) / prod.length;

    // 得分 = 成功率提升 × 0.7 + 延迟改善 × 0.3
    const successImprovement = shadowSuccess - prodSuccess;
    const latencyImprovement = prodLatency > 0 ? (prodLatency - shadowLatency) / prodLatency : 0;

    return Math.max(0, successImprovement * 0.7 + latencyImprovement * 0.3);
  }
}
