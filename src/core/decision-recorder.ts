/**
 * 决策记录器 — ModelPool 的数据基础设施
 *
 * 每次调度都记录决策 + 结果，积累智能的燃料。
 * 支持 kNN 相似查询、分维度统计、持久化。
 *
 * 设计原则（来自研究）：
 * - 用相对排序，不用绝对评分（避免 routing collapse）
 * - 分维度统计（按 taskType），不汇总（避免预算越高越选贵模型）
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { DecisionRecord } from '../types.js';

// ==================== 统计结果 ====================

export interface NodeTaskStats {
  attempts: number;
  successes: number;
  successRate: number;
  avgLatency: number;
}

export interface SimilarRecord {
  record: DecisionRecord;
  similarity: number;
}

// ==================== DecisionRecorder ====================

export class DecisionRecorder {
  private records: DecisionRecord[] = [];
  private readonly maxRecords: number;
  private readonly dataFile: string;

  constructor(dataDir: string, maxRecords = 5000) {
    this.maxRecords = maxRecords;
    this.dataFile = path.join(dataDir, 'pool-decisions.jsonl');
    this.load();
  }

  // ==================== 记录 ====================

  /**
   * 记录一次调度决策
   */
  record(decision: Omit<DecisionRecord, 'inputHash' | 'timestamp'>): void {
    const record: DecisionRecord = {
      ...decision,
      inputHash: this.hashInput(decision.input),
      timestamp: Date.now(),
    };

    this.records.push(record);

    // 超过上限时裁剪（保留最新的）
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }

    // 追加写入 JSONL（不重写整个文件，性能友好）
    this.appendToFile(record);
  }

  /**
   * 更新最近一条匹配的决策记录的实际结果
   * 用于 orchestrate() 事后补录 success/latencyMs/costEstimate
   */
  updateLastOutcome(input: string, patch: { success?: boolean; latencyMs?: number; costEstimate?: number; inputTokens?: number; outputTokens?: number }): void {
    const queryHash = this.hashInput(input);
    // 从后往前找最近一条匹配的记录
    for (let i = this.records.length - 1; i >= Math.max(0, this.records.length - 5); i--) {
      if (this.records[i].inputHash === queryHash && this.records[i].latencyMs === 0) {
        if (patch.success !== undefined) this.records[i].success = patch.success;
        if (patch.latencyMs !== undefined) this.records[i].latencyMs = patch.latencyMs;
        if (patch.costEstimate !== undefined) this.records[i].costEstimate = patch.costEstimate;
        if (patch.inputTokens !== undefined) this.records[i].inputTokens = patch.inputTokens;
        if (patch.outputTokens !== undefined) this.records[i].outputTokens = patch.outputTokens;
        // 追加更新到 JSONL
        this.appendToFile({ ...this.records[i], _updated: true } as any);
        break;
      }
    }
  }

  // ==================== 查询 ====================

  /**
   * kNN 相似查询 — 基于 inputHash 找相似历史
   * 简单实现：前缀匹配 + 编辑距离
   */
  findSimilar(input: string, k = 10): SimilarRecord[] {
    const queryHash = this.hashInput(input);
    const queryTokens = this.tokenize(input);

    const scored: SimilarRecord[] = [];

    for (const record of this.records) {
      // 快速跳过完全不相关的（hash 前缀不同）
      const similarity = this.computeSimilarity(queryTokens, this.tokenize(record.input));

      if (similarity > 0.1) {
        scored.push({ record, similarity });
      }
    }

    // 按相似度降序，取 top-k
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, k);
  }

  /**
   * 按节点 + 任务类型统计成功率和延迟
   */
  getNodeStats(nodeId: string, taskType?: string): NodeTaskStats {
    const relevant = this.records.filter(r => {
      if (r.selectedNode !== nodeId) return false;
      if (taskType && r.intent !== taskType) return false;
      return true;
    });

    if (relevant.length === 0) {
      return { attempts: 0, successes: 0, successRate: 0, avgLatency: 0 };
    }

    const successes = relevant.filter(r => r.success).length;
    const totalLatency = relevant.reduce((sum, r) => sum + r.latencyMs, 0);

    return {
      attempts: relevant.length,
      successes,
      successRate: successes / relevant.length,
      avgLatency: totalLatency / relevant.length,
    };
  }

  /**
   * 按节点 + 任务类型查询原始记录（供多维加权反馈使用）
   */
  getByNodeAndTask(nodeId: string, taskType?: string): DecisionRecord[] {
    return this.records.filter(r => {
      if (r.selectedNode !== nodeId) return false;
      if (taskType && r.intent !== taskType) return false;
      return true;
    });
  }

  /**
   * 获取所有节点在指定任务类型上的统计
   * 用于调度器比较不同节点的表现
   */
  getAllNodeStats(taskType: string): Map<string, NodeTaskStats> {
    const result = new Map<string, NodeTaskStats>();

    for (const record of this.records) {
      if (record.intent !== taskType) continue;

      if (!result.has(record.selectedNode)) {
        result.set(record.selectedNode, {
          attempts: 0, successes: 0, successRate: 0, avgLatency: 0,
        });
      }

      const stats = result.get(record.selectedNode)!;
      stats.attempts++;
      if (record.success) stats.successes++;
    }

    // 计算比率和平均值
    for (const [nodeId, stats] of result) {
      if (stats.attempts > 0) {
        stats.successRate = stats.successes / stats.attempts;
        const nodeRecords = this.records.filter(
          r => r.selectedNode === nodeId && r.intent === taskType,
        );
        stats.avgLatency = nodeRecords.reduce((s, r) => s + r.latencyMs, 0) / nodeRecords.length;
      }
    }

    return result;
  }

  /**
   * 获取最近 N 条记录
   */
  getRecent(n: number): DecisionRecord[] {
    return this.records.slice(-n);
  }

  /**
   * 获取总记录数
   */
  count(): number {
    return this.records.length;
  }

  /**
   * 按时间范围查询
   */
  getByTimeRange(from: number, to: number): DecisionRecord[] {
    return this.records.filter(r => r.timestamp >= from && r.timestamp <= to);
  }

  // ==================== 相似度计算 ====================

  /**
   * 简单的 token 集合相似度（Jaccard）
   * 不需要 embedding，轻量级但对短文本有效
   */
  private computeSimilarity(tokensA: string[], tokensB: string[]): number {
    if (tokensA.length === 0 || tokensB.length === 0) return 0;

    const setA = new Set(tokensA);
    const setB = new Set(tokensB);

    let intersection = 0;
    for (const t of setA) {
      if (setB.has(t)) intersection++;
    }

    const union = setA.size + setB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * 简单分词：按空格/标点分割，转小写，去停用词
   */
  private tokenize(text: string): string[] {
    const stopwords = new Set([
      '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
      '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
      'on', 'with', 'at', 'by', 'from', 'it', 'this', 'that', 'and', 'or',
      'but', 'not', 'no', 'so', 'if', 'then', 'than', 'too', 'very',
    ]);

    return text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff]+/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1 && !stopwords.has(t));
  }

  /**
   * 输入哈希 — 用于快速去重和前缀匹配
   */
  private hashInput(input: string): string {
    return crypto.createHash('md5').update(input.trim().toLowerCase()).digest('hex');
  }

  // ==================== 持久化 ====================

  /**
   * 追加一条记录到 JSONL 文件
   */
  private appendToFile(record: DecisionRecord): void {
    try {
      const dir = path.dirname(this.dataFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(this.dataFile, JSON.stringify(record) + '\n');
    } catch {
      // 持久化失败不影响运行
    }
  }

  /**
   * 从 JSONL 文件加载历史记录
   */
  private load(): void {
    try {
      if (!fs.existsSync(this.dataFile)) return;

      const content = fs.readFileSync(this.dataFile, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l.length > 0);

      for (const line of lines) {
        try {
          const record = JSON.parse(line) as DecisionRecord;
          this.records.push(record);
        } catch {
          // 跳过损坏的行
        }
      }

      // 超过上限时裁剪
      if (this.records.length > this.maxRecords) {
        this.records = this.records.slice(-this.maxRecords);
        // 重写文件（裁剪后）
        this.rewriteFile();
      }
    } catch {
      // 加载失败不影响运行
    }
  }

  /**
   * 重写整个 JSONL 文件（裁剪后）
   */
  private rewriteFile(): void {
    try {
      const content = this.records.map(r => JSON.stringify(r)).join('\n') + '\n';
      fs.writeFileSync(this.dataFile, content);
    } catch {
      // 重写失败不影响运行
    }
  }
}
