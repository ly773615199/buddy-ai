/**
 * 左脑：理性决策脑
 *
 * 规则引擎 + 统一调度 + 策略蒸馏
 * 可解释、可审计、纯规则+数据驱动
 *
 * 子模块：
 * - RuleEngine：规则引擎（内置 + 学习 + 否定规则）
 * - UnifiedScheduler：统一调度器（经验 + 直觉 + 稳态）
 * - PolicyDistiller：策略蒸馏器（聚类 → 规则提炼）
 * - DecisionMemory：决策记忆（持久化 + kNN + 聚类）
 */

import type {
  TaskSignal, ResourceState, ExecutionPlan, IntuitionSignal,
  BodyState, DecisionRecord, DecisionOutcome, DistillReport, Rule,
} from '../types.js';
import type { UnifiedResourceHub } from '../hub/unified-resource-hub.js';
import { RuleEngine } from './rule-engine.js';
import { UnifiedScheduler } from './scheduler.js';
import { PolicyDistiller } from './policy-distiller.js';
import { DecisionMemory } from './decision-memory.js';

export interface LeftBrainConfig {
  distillIntervalMs: number;
  enableLearnedRules: boolean;
  maxLearnedRules: number;
}

const DEFAULT_CONFIG: LeftBrainConfig = {
  distillIntervalMs: 3600_000,
  enableLearnedRules: true,
  maxLearnedRules: 50,
};

export { RuleEngine } from './rule-engine.js';
export { UnifiedScheduler } from './scheduler.js';
export { PolicyDistiller } from './policy-distiller.js';

export class LeftBrain {
  private ruleEngine: RuleEngine;
  private distiller: PolicyDistiller;
  /** 统一调度器（公开，供外部设置统一模型池） */
  readonly scheduler: UnifiedScheduler;
  /** 决策记忆（持久化 + kNN + 聚类） */
  readonly memory: DecisionMemory;
  private config: LeftBrainConfig;
  private verbose: boolean;

  constructor(config?: Partial<LeftBrainConfig>, verbose = false) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.verbose = verbose;
    this.ruleEngine = new RuleEngine();
    this.memory = new DecisionMemory({ maxRecords: 5000 });
    this.distiller = new PolicyDistiller(this.memory, verbose);
    this.scheduler = new UnifiedScheduler({}, verbose);
  }

  /** Phase 2: 获取规则引擎（供 Gate-1/Gate-2 门控调用） */
  getRuleEngine(): RuleEngine {
    return this.ruleEngine;
  }

  /** 注入资源画像系统到规则引擎和调度器 */
  setResourceHub(hub: UnifiedResourceHub): void {
    this.ruleEngine.setResourceHub(hub);
    this.scheduler.setResourceHub(hub);
  }

  /**
   * 核心决策入口
   *
   * Fix: 规则引擎输出的 cloud_node 缺少 provider/model 信息，
   * 通过 scheduler 的 ModelRouter 补全，确保走统一池而非旧 fallback。
   */
  async decide(
    signal: TaskSignal,
    resources: ResourceState,
    intuition?: IntuitionSignal,
    body?: BodyState,
    failureContext?: import('../types.js').FailureAnalysis,
  ): Promise<ExecutionPlan> {
    // 1. 规则引擎优先
    const ruleResult = this.ruleEngine.evaluate(signal, resources, intuition, body);
    if (ruleResult) {
      return await this.enrichPlanWithRouter(ruleResult, signal, body);
    }

    // 2. 调度器兜底（Phase 2.1: 多候选方案生成）
    //    无失败上下文时生成候选；有失败上下文时走单方案（换路策略已在 scheduler 内部处理）
    if (!failureContext) {
      const { primary, candidates } = await this.scheduler.scheduleMultiple(signal, resources, intuition, body);
      if (candidates && candidates.length > 0) {
        primary.candidates = candidates;
      }
      return primary;
    }

    // 有失败上下文 → 单方案（已换路）
    return this.scheduler.schedule(signal, resources, intuition, body, failureContext);
  }

  /**
   * Phase 4: 注入右脑 predictDetailed 供 Thompson Sampling 使用
   */
  setPredictDetailed(fn: (signal: TaskSignal, resources: ResourceState, body?: BodyState) => Promise<{ tools: Array<{ name: string; probability: number }> }>): void {
    this.scheduler.setPredictDetailed(fn);
  }

  /**
   * 补全规则引擎输出的模型信息
   *
   * 规则引擎只做决策（mode/reason），不选具体模型。
   * 当 selectedNodes 中有 cloud_node 缺少 provider/model 时，
   * 通过 ModelRouter 从统一池选出具体模型注入。
   */
  private async enrichPlanWithRouter(
    plan: ExecutionPlan,
    signal: TaskSignal,
    body?: BodyState,
  ): Promise<ExecutionPlan> {
    const router = this.scheduler.getRouter();
    if (!router) return plan;

    let enriched = false;
    const nodes = await Promise.all(plan.selectedNodes.map(async node => {
      // 只处理 cloud_node 且缺少模型信息的节点
      if (node.type !== 'cloud_node' || (node.provider && node.model)) {
        return node;
      }

      try {
        const taskType = signal.taskType as import('../../core/model-router.js').TaskType;
        const selection = await router.select(taskType, {
          content: signal.content ?? '',
          bodyState: body,
        });
        if (selection) {
          enriched = true;
          const creds = router.getPool()?.getProviderCredentials(selection.provider);
          if (this.verbose) {
            console.log(`[LeftBrain] 规则引擎节点补全: ${node.id} → ${selection.id} (${selection.source})`);
          }
          return {
            ...node,
            id: selection.id,
            provider: selection.provider,
            model: selection.model,
            apiKey: creds?.apiKey,
            baseUrl: creds?.baseUrl,
          };
        }
      } catch (err) {
        if (this.verbose) {
          console.warn(`[LeftBrain] 节点补全失败: ${(err as Error).message}`);
        }
      }

      return node;
    }));

    if (!enriched) return plan;

    return {
      ...plan,
      selectedNodes: nodes,
      reason: `${plan.reason} → router 补全`,
      source: `${plan.source}+router`,
    };
  }

  /** 记录决策 */
  recordDecision(record: DecisionRecord): void {
    this.memory.record(record);
  }

  /** 记录结果 */
  recordOutcome(input: string, outcome: DecisionOutcome): void {
    this.memory.updateLastOutcome(input, outcome);
  }

  /** Thompson Sampling 结果反馈 */
  recordSchedulerOutcome(signal: TaskSignal, tool: string, success: boolean, latencyMs: number, costEstimate: number): void {
    this.scheduler.recordOutcome(signal, tool, success, latencyMs, costEstimate);
  }

  /** 获取相似历史决策 */
  findSimilar(signal: TaskSignal, k = 5) {
    return this.memory.findSimilar(signal, k);
  }

  /** 策略蒸馏 */
  async distill(): Promise<DistillReport> {
    return this.distiller.distill(this.ruleEngine);
  }

  getStats() {
    return {
      ...this.ruleEngine.getStats(),
      totalDecisions: this.memory.size,
      memoryStats: this.memory.getGlobalStats(),
    };
  }

  // ── 影子大脑数据接口 ──

  /** 获取所有规则（供影子大脑读取） */
  getRules() {
    return this.ruleEngine.getRules();
  }

  /** 添加学习到的规则（供影子大脑进化合入） */
  addLearnedRule(rule: Rule): void {
    this.ruleEngine.addLearnedRule(rule);
  }

  /** 获取决策指纹分布（供 GDI 结构漂移检测） */
  getDecisionDistribution(): number[] {
    const clusters = this.memory.getClusterStats(1);
    return clusters.map(c => c.count);
  }

  /** 获取决策样本（供进化上下文） */
  getDecisionSamples(): Array<{ labelIntent: number; fingerprint: string }> {
    const clusters = this.memory.getClusterStats(1);
    return clusters.map((c, i) => ({
      labelIntent: i,
      fingerprint: c.fingerprint,
    }));
  }

  /** 获取指定 fingerprint 的聚类统计 */
  getClusterStats(fingerprint: string): { count: number; successRate: number } | null {
    const clusters = this.memory.getClusterStats(1);
    const match = clusters.find(c => c.fingerprint === fingerprint);
    return match ? { count: match.count, successRate: match.successRate } : null;
  }

  destroy(): void {
    this.memory.clear();
  }
}
