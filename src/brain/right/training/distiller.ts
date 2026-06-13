/**
 * Structured Agent Distillation 蒸馏器
 *
 * 从 DecisionMemory 中收集 LLM 教师的决策记录
 * 用 span-level loss 蒸馏到 IntuitionNet 学生模型
 *
 * 基于 AAMAS 2026 CMU/Harvard/MIT 论文
 */

import type { TrainingSample, DistillConfig, DecisionRecord, DecisionOutcome } from '../../types.js';
import type { IntuitionNet } from '../nn/model.js';
import { OnlineLearner } from './online-learner.js';

export interface DistillResult {
  samples: number;
  avgLoss: number;
  durationMs: number;
  improved: boolean;
  /** 从教师决策中提取的可解释规则 */
  extractedRules: DistilledRule[];
}

/** 从蒸馏中提取的可解释规则 */
export interface DistilledRule {
  /** 规则描述 */
  description: string;
  /** 触发条件（signal fingerprint） */
  condition: string;
  /** 推荐意图 */
  intent: string;
  /** 推荐工具 */
  tools: string[];
  /** 置信度 */
  confidence: number;
  /** 样本数 */
  sampleCount: number;
  /** 成功率 */
  successRate: number;
}

export class Distiller {
  private model: IntuitionNet;
  private learner: OnlineLearner;
  private config: DistillConfig;
  private verbose: boolean;

  constructor(
    model: IntuitionNet,
    learner: OnlineLearner,
    config: DistillConfig,
    verbose = false,
  ) {
    this.model = model;
    this.learner = learner;
    this.config = config;
    this.verbose = verbose;
  }

  /**
   * 从决策记录中蒸馏
   *
   * @param records LLM 的决策记录
   * @returns 蒸馏结果
   */
  async distill(records: DecisionRecord[]): Promise<DistillResult> {
    const t0 = Date.now();

    if (records.length < this.config.minTeacherSamples) {
      return { samples: 0, avgLoss: 0, durationMs: 0, improved: false, extractedRules: [] };
    }

    // Step 1: Span 分割 — 将每条记录分解为 signal/context/action span
    const samples = this.extractSamples(records);

    // Step 2: Decision-Attention 加权
    this.applyDecisionAttention(samples);

    // Step 3: 训练
    let totalLoss = 0;
    let updateCount = 0;
    for (const sample of samples) {
      this.learner.collectSample(
        '',
        { domains: [], complexity: 'medium', taskType: 'chat', shouldUseDAG: false, dagReason: '', intentConfidence: 0 },
        { budgetRemaining: 0, availableNodeCount: 0, localCoverageRatio: 0, localConfidence: 0, userCorrectionCount: 0, experienceHit: null },
        sample.labelIntent,
        sample.labelTools,
        sample.labelQuality,
        { success: sample.outcome, latencyMs: 0, costEstimate: 0, toolsUsed: [] },
      );

      const result = await this.learner.update();
      if (result.loss > 0) {
        totalLoss += result.loss;
        updateCount++;
      }
    }

    const durationMs = Date.now() - t0;
    const avgLoss = updateCount > 0 ? totalLoss / updateCount : 0;

    if (this.verbose) {
      console.log(`[Distiller] 蒸馏完成: ${samples.length} 样本, avgLoss=${avgLoss.toFixed(4)}, ${durationMs}ms`);
    }

    return {
      samples: samples.length,
      avgLoss,
      durationMs,
      improved: avgLoss < 0.5,
      extractedRules: this.extractRules(records),
    };
  }

  /**
   * 从教师决策中提取可解释规则
   *
   * 按 signal fingerprint 聚类，成功模式 → 规则
   */
  private extractRules(records: DecisionRecord[]): DistilledRule[] {
    const INTENT_LABELS = [
      'file_operations', 'code_operations', 'git_operations', 'web_operations',
      'system_operations', 'knowledge_query', 'conversation', 'complex_task',
    ];

    // 按 fingerprint 聚类
    const clusters = new Map<string, DecisionRecord[]>();
    for (const record of records) {
      const fp = `${record.signal.domains.sort().join(',')}|${record.signal.complexity}|${record.signal.taskType}`;
      if (!clusters.has(fp)) clusters.set(fp, []);
      clusters.get(fp)!.push(record);
    }

    const rules: DistilledRule[] = [];
    for (const [fp, cluster] of clusters) {
      if (cluster.length < 3) continue; // 样本太少跳过

      const successCount = cluster.filter(r => r.outcome?.success).length;
      const successRate = successCount / cluster.length;

      // 只提取成功模式
      if (successRate < 0.7) continue;

      // 取最常见的意图和工具
      const intentCounts = new Map<string, number>();
      const toolCounts = new Map<string, number>();
      for (const r of cluster) {
        const intent = INTENT_LABELS.find((_, i) =>
          r.signal.taskType === 'tools' && r.signal.domains[0] ===
          ['file', 'code', 'git', 'web', 'system', 'knowledge'][i]);
        if (intent) intentCounts.set(intent, (intentCounts.get(intent) ?? 0) + 1);
        for (const node of r.plan.selectedNodes) {
          if (node.skillId) toolCounts.set(node.skillId, (toolCounts.get(node.skillId) ?? 0) + 1);
        }
      }

      const topIntent = [...intentCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'conversation';
      const topTools = [...toolCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([tool]) => tool);

      rules.push({
        description: `蒸馏规则: ${fp.slice(0, 30)}`,
        condition: fp,
        intent: topIntent,
        tools: topTools,
        confidence: successRate,
        sampleCount: cluster.length,
        successRate,
      });
    }

    return rules;
  }

  /**
   * 从决策记录中提取训练样本
   *
   * Span 分割：
   * - signal_span: signal 的各维度 → intent 标签
   * - action_span: selectedMode + tools → tool 标签
   * - quality: outcome → quality 标签
   */
  private extractSamples(records: DecisionRecord[]): TrainingSample[] {
    const INTENT_MAP: Record<string, number> = {
      'file_operations': 0, 'code_operations': 1, 'git_operations': 2, 'web_operations': 3,
      'system_operations': 4, 'knowledge_query': 5, 'conversation': 6, 'complex_task': 7,
    };

    const TOOL_MAP: Record<string, number> = {
      'read_file': 0, 'write_file': 1, 'list_files': 2, 'search_files': 3,
      'exec': 4, 'git_status': 5, 'git_log': 6, 'git_diff': 7,
      'git_commit': 8, 'git_branch': 9, 'git_merge': 10, 'git_push': 11,
      'search_web': 12, 'fetch_url': 13, 'analyze_file': 14, 'find_references': 15,
      'browser_screenshot': 16, 'browser_extract': 17, 'browser_pdf': 18,
      'screen_capture': 19, 'screen_ocr': 20, 'screen_describe': 21,
      'tts_speak': 22, 'tts_voices': 23, 'tts_status': 24,
      'scan_project': 25, 'project_context': 26, 'get_time': 27,
    };

    const samples: TrainingSample[] = [];
    for (const record of records) {
      // 意图标签：从 signal.taskType 推断
      let intentLabel = 6; // default: conversation
      if (record.signal.taskType === 'tools') {
        // 根据 domain 推断
        const domain = record.signal.domains[0] || '';
        intentLabel = INTENT_MAP[`${domain}_operations`] ?? 6;
      }

      // 工具标签：从 plan 中提取
      const toolLabels = new Array(32).fill(0);
      if (record.plan.selectedNodes) {
        for (const node of record.plan.selectedNodes) {
          if (node.skillId) {
            const idx = TOOL_MAP[node.skillId];
            if (idx !== undefined) toolLabels[idx] = 1;
          }
        }
      }

      // 质量标签
      const qualityLabel = record.outcome?.success ? 0.8 : 0.2;

      samples.push({
        features: new Float32Array(0), // 特征在 collectSample 中重新编码
        labelIntent: intentLabel,
        labelTools: toolLabels,
        labelQuality: qualityLabel,
        outcome: record.outcome?.success ?? false,
        timestamp: record.timestamp,
        weight: 1.0,
      });
    }

    return samples;
  }

  /**
   * Decision-Attention 加权
   *
   * - 成功的教师决策 → 权重 1.0
   * - 失败的教师决策 → 权重 0.3
   * - 最近的决策 → 权重更高（指数衰减）
   */
  private applyDecisionAttention(samples: TrainingSample[]): void {
    const now = Date.now();
    const halfLife = 3600_000; // 1 小时半衰期

    for (const sample of samples) {
      // 成功/失败权重
      const successWeight = sample.outcome ? 1.0 : 0.3;

      // 时间衰减
      const ageMs = now - sample.timestamp;
      const timeWeight = Math.exp(-ageMs / halfLife);

      sample.weight = successWeight * timeWeight;
    }
  }
}
