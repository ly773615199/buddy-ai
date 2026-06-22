/**
 * 决策记忆 — 左脑的决策数据基础设施
 *
 * 整合 DecisionRecorder，提供：
 * - 决策记录（JSONL 持久化）
 * - kNN 相似查询（从历史中找相似决策）
 * - 分维度统计（按 taskType / domain）
 * - 聚类查询（为 PolicyDistiller 提供数据）
 * - 结果更新（事后补录 success/latency/cost）
 */

import * as fs from 'fs';
import * as path from 'path';
import type { DecisionRecord, DecisionOutcome, TaskSignal } from '../types.js';

// ==================== 统计 ====================

export interface NodeTaskStats {
  attempts: number;
  successes: number;
  successRate: number;
  avgLatency: number;
}

export interface ClusterStats {
  fingerprint: string;
  count: number;
  successCount: number;
  successRate: number;
  avgLatency: number;
  dominantMode: string;
  records: DecisionRecord[];
}

export interface SimilarRecord {
  record: DecisionRecord;
  similarity: number;
}

// ==================== DecisionMemory ====================

export class DecisionMemory {
  private records: DecisionRecord[] = [];
  private readonly maxRecords: number;
  private readonly dataFile: string | null;

  constructor(options?: { dataDir?: string; maxRecords?: number }) {
    this.maxRecords = options?.maxRecords ?? 5000;
    this.dataFile = options?.dataDir
      ? path.join(options.dataDir, 'brain-decisions.jsonl')
      : null;
    if (this.dataFile) this.load();
  }

  // ==================== 记录 ====================

  /** 记录一次决策 */
  record(decision: DecisionRecord): void {
    this.records.push(decision);

    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }

    if (this.dataFile) this.appendToFile(decision);
  }

  /** 更新最近一条决策的结果 */
  updateLastOutcome(input: string, outcome: DecisionOutcome): void {
    for (let i = this.records.length - 1; i >= Math.max(0, this.records.length - 10); i--) {
      if (this.records[i].input === input && !this.records[i].outcome) {
        this.records[i].outcome = outcome;
        return;
      }
    }
  }

  // ==================== 查询 ====================

  /** 获取最近 N 条记录 */
  getRecent(count: number): DecisionRecord[] {
    return this.records.slice(-count);
  }

  /** 按 fingerprint 聚类 */
  clusterByFingerprint(): Map<string, DecisionRecord[]> {
    const clusters = new Map<string, DecisionRecord[]>();
    for (const record of this.records) {
      const fp = this.fingerprint(record.signal);
      if (!clusters.has(fp)) clusters.set(fp, []);
      clusters.get(fp)!.push(record);
    }
    return clusters;
  }

  /** 获取聚类统计（供 PolicyDistiller 使用） */
  getClusterStats(minCount = 3): ClusterStats[] {
    const clusters = this.clusterByFingerprint();
    const stats: ClusterStats[] = [];

    for (const [fp, records] of clusters) {
      if (records.length < minCount) continue;

      const successCount = records.filter(r => r.outcome?.success).length;
      const latencies = records.filter(r => r.latencyMs > 0).map(r => r.latencyMs);

      // 找出现最多的 mode
      const modeCounts = new Map<string, number>();
      for (const r of records) {
        modeCounts.set(r.plan.mode, (modeCounts.get(r.plan.mode) || 0) + 1);
      }
      let dominantMode = 'single';
      let maxCount = 0;
      for (const [mode, count] of modeCounts) {
        if (count > maxCount) { dominantMode = mode; maxCount = count; }
      }

      stats.push({
        fingerprint: fp,
        count: records.length,
        successCount,
        successRate: successCount / records.length,
        avgLatency: latencies.length > 0
          ? latencies.reduce((a, b) => a + b, 0) / latencies.length
          : 0,
        dominantMode,
        records,
      });
    }

    return stats;
  }

  /** kNN 相似查询 */
  findSimilar(signal: TaskSignal, k = 5): SimilarRecord[] {
    const fp = this.fingerprint(signal);
    const scored: SimilarRecord[] = [];

    for (const record of this.records) {
      const rfp = this.fingerprint(record.signal);
      const sim = this.fingerprintSimilarity(fp, rfp);
      if (sim > 0) {
        scored.push({ record, similarity: sim });
      }
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, k);
  }

  /** 按维度统计 */
  getStatsByDimension(): Record<string, NodeTaskStats> {
    const stats: Record<string, NodeTaskStats> = {};

    for (const record of this.records) {
      const key = `${record.signal.taskType}|${record.signal.complexity}`;
      if (!stats[key]) {
        stats[key] = { attempts: 0, successes: 0, successRate: 0, avgLatency: 0 };
      }
      const s = stats[key];
      s.attempts++;
      if (record.outcome?.success) s.successes++;
      if (record.latencyMs > 0) {
        s.avgLatency = (s.avgLatency * (s.attempts - 1) + record.latencyMs) / s.attempts;
      }
    }

    for (const s of Object.values(stats)) {
      s.successRate = s.attempts > 0 ? s.successes / s.attempts : 0;
    }

    return stats;
  }

  /** 全局统计 */
  getGlobalStats(): {
    total: number;
    withOutcome: number;
    overallSuccessRate: number;
    avgLatency: number;
  } {
    const withOutcome = this.records.filter(r => r.outcome);
    const successes = withOutcome.filter(r => r.outcome!.success).length;
    const latencies = withOutcome.filter(r => r.latencyMs > 0).map(r => r.latencyMs);

    return {
      total: this.records.length,
      withOutcome: withOutcome.length,
      overallSuccessRate: withOutcome.length > 0 ? successes / withOutcome.length : 0,
      avgLatency: latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 0,
    };
  }

  /** 获取所有记录（供 PolicyDistiller 使用） */
  getAll(): DecisionRecord[] {
    return [...this.records];
  }

  /** 清空 */
  clear(): void {
    this.records = [];
  }

  get size(): number {
    return this.records.length;
  }

  // ==================== 反事实样本生成 ====================

  /**
   * 从一条决策记录生成反事实训练样本
   *
   * 原理（Counterfactual Data Augmentation）：
   * "如果当时选了另一个方案会怎样？"
   * 从历史中找同 fingerprint 但不同 mode 的记录，用其成功率作为反事实标签。
   *
   * @param record 原始决策记录
   * @param maxAlternatives 最多生成几个反事实样本
   * @returns 反事实训练样本数组
   */
  generateCounterfactuals(record: DecisionRecord, maxAlternatives = 3): Array<{
    labelIntent: number;
    labelTools: number[];
    labelQuality: number;
    outcome: boolean;
    alternativeMode: string;
  }> {
    const fp = this.fingerprint(record.signal);
    const results: Array<{
      labelIntent: number;
      labelTools: number[];
      labelQuality: number;
      outcome: boolean;
      alternativeMode: string;
    }> = [];

    // 找同 fingerprint 但不同 mode 的记录
    const alternatives = new Map<string, DecisionRecord[]>();
    for (const r of this.records) {
      if (this.fingerprint(r.signal) !== fp) continue;
      if (r.plan.mode === record.plan.mode) continue;
      if (!r.outcome) continue; // 没有结果的跳过
      const mode = r.plan.mode;
      if (!alternatives.has(mode)) alternatives.set(mode, []);
      alternatives.get(mode)!.push(r);
    }

    // 按模式聚合，计算替代方案的成功率
    for (const [mode, records] of alternatives) {
      if (results.length >= maxAlternatives) break;

      const successCount = records.filter(r => r.outcome!.success).length;
      const successRate = successCount / records.length;

      // 推断替代方案的意图和工具
      const intent = this.inferIntent(record.signal);
      const tools = this.inferTools(records[0].plan);

      results.push({
        labelIntent: intent,
        labelTools: tools,
        labelQuality: successRate,
        outcome: successRate > 0.5,
        alternativeMode: mode,
      });
    }

    return results;
  }

  /**
   * 批量生成反事实样本（从最近 N 条有结果的记录）
   */
  generateCounterfactualBatch(count = 10): Array<{
    features: Float32Array;
    labelIntent: number;
    labelTools: number[];
    labelQuality: number;
    outcome: boolean;
    timestamp: number;
    weight: number;
  }> {
    const withOutcome = this.records.filter(r => r.outcome);
    const recent = withOutcome.slice(-count);
    const samples: Array<{
      features: Float32Array;
      labelIntent: number;
      labelTools: number[];
      labelQuality: number;
      outcome: boolean;
      timestamp: number;
      weight: number;
    }> = [];

    for (const record of recent) {
      const counterfactuals = this.generateCounterfactuals(record);
      for (const cf of counterfactuals) {
        samples.push({
          features: new Float32Array(0), // 特征在接入时由 encodeFeatures 重新编码
          labelIntent: cf.labelIntent,
          labelTools: cf.labelTools,
          labelQuality: cf.labelQuality,
          outcome: cf.outcome,
          timestamp: record.timestamp,
          weight: 0.5, // 反事实样本权重较低
        });
      }
    }

    return samples;
  }

  // ==================== 内部 ====================

  private inferIntent(signal: TaskSignal): number {
    const INTENT_MAP: Record<string, number> = {
      'file': 0, 'code': 1, 'git': 2, 'web': 3,
      'system': 4, 'knowledge': 5, 'conversation': 6, 'complex': 7,
    };
    return INTENT_MAP[signal.domains[0] ?? ''] ?? 6;
  }

  private inferTools(plan: { selectedNodes: Array<{ skillId?: string }> }): number[] {
    const TOOL_IDS: Record<string, number> = {
      'read_file': 0, 'write_file': 1, 'list_files': 2, 'search_files': 3,
      'exec': 4, 'git_status': 5, 'git_log': 6, 'git_diff': 7,
      'git_commit': 8, 'git_branch': 9, 'git_merge': 10, 'git_push': 11,
      'search_web': 12, 'fetch_url': 13,
    };
    const tools: number[] = [];
    for (const node of plan.selectedNodes) {
      if (node.skillId && TOOL_IDS[node.skillId] !== undefined) {
        tools.push(TOOL_IDS[node.skillId]);
      }
    }
    return tools;
  }

  private fingerprint(signal: TaskSignal): string {
    return `${signal.domains.sort().join(',')}|${signal.complexity}|${signal.taskType}`;
  }

  private fingerprintSimilarity(fp1: string, fp2: string): number {
    if (fp1 === fp2) return 1;
    const parts1 = fp1.split('|');
    const parts2 = fp2.split('|');
    let match = 0;
    for (let i = 0; i < parts1.length; i++) {
      if (parts1[i] === parts2[i]) match++;
    }
    return match / parts1.length;
  }

  private load(): void {
    if (!this.dataFile) return;
    try {
      if (!fs.existsSync(this.dataFile)) return;
      const content = fs.readFileSync(this.dataFile, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          this.records.push(JSON.parse(line));
        } catch { /* skip malformed */ }
      }
      if (this.records.length > this.maxRecords) {
        this.records = this.records.slice(-this.maxRecords);
      }
    } catch { /* load failed, start fresh */ }
  }

  private appendToFile(record: DecisionRecord): void {
    if (!this.dataFile) return;
    const dir = path.dirname(this.dataFile);
    const line = JSON.stringify(record) + '\n';
    // 异步写入，不阻塞事件循环
    fs.promises.mkdir(dir, { recursive: true })
      .then(() => fs.promises.appendFile(this.dataFile!, line))
      .catch(() => { /* write failed, non-critical */ });
  }
}
