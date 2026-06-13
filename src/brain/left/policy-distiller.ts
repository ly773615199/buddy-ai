/**
 * 策略蒸馏器 — 从决策记录中提炼规则
 *
 * 定期执行：聚类 → 正规则/否定规则 → 冲突检测 → 淘汰
 */

import type {
  TaskSignal, Rule, DistillReport,
} from '../types.js';
import { DecisionMemory, type ClusterStats } from './decision-memory.js';
import type { RuleEngine } from './rule-engine.js';

export class PolicyDistiller {
  private memory: DecisionMemory;
  private verbose: boolean;

  constructor(memory: DecisionMemory, verbose = false) {
    this.memory = memory;
    this.verbose = verbose;
  }

  /** 执行蒸馏 */
  async distill(engine: RuleEngine): Promise<DistillReport> {
    const t0 = Date.now();

    const clusterStats = this.memory.getClusterStats(3);

    let newRules = 0;
    let prunedRules = 0;
    let negations = 0;

    for (const cluster of clusterStats) {
      // 正规则：成功率 > 0.8 且样本 >= 5
      if (cluster.successRate > 0.8 && cluster.count >= 5) {
        const fp = cluster.fingerprint;
        const mode = cluster.dominantMode;
        engine.addLearnedRule({
          id: `learned-${fp.slice(0, 16)}-${Date.now()}`,
          name: `蒸馏规则: ${fp.slice(0, 30)}`,
          priority: 55,
          condition: (signal) => this.fingerprint(signal) === fp,
          action: (signal, resources) => ({
            mode: mode as any, reason: `蒸馏: 成功率${(cluster.successRate * 100).toFixed(0)}%`,
            selectedNodes: [{ id: 'primary', type: 'cloud_node' }],
            confidence: cluster.successRate, source: 'learned',
          }),
          source: 'learned',
          stats: { hits: cluster.count, successes: cluster.successCount, lastUsed: Date.now() },
          createdAt: Date.now(),
        });
        newRules++;
      }

      // 否定规则：成功率 < 0.2 且样本 >= 3
      if (cluster.successRate < 0.2 && cluster.count >= 3) {
        engine.addNegation(cluster.records[0].signal);
        negations++;
      }
    }

    // 淘汰低效规则
    prunedRules = engine.prune(7 * 24 * 3600_000, 0.3);

    const durationMs = Date.now() - t0;

    if (this.verbose) {
      console.log(`[PolicyDistiller] 蒸馏完成: ${newRules} 新规则, ${prunedRules} 淘汰, ${negations} 否定, ${durationMs}ms`);
    }

    return {
      newRules,
      prunedRules,
      negations,
      clusters: clusterStats.length,
      totalRecords: this.memory.size,
      durationMs,
    };
  }

  private fingerprint(signal: TaskSignal): string {
    return `${signal.domains.sort().join(',')}|${signal.complexity}|${signal.taskType}`;
  }
}
