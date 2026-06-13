/**
 * 训练数据导出器 — 将 STMP 积累的领域知识导出为 LoRA 训练格式
 *
 * 格式：instruction / input / output (Alpaca 格式)
 * 支持脱敏处理、质量过滤、去重
 * Phase B 增强：judgment/correction 样本 + 多维质量评估 + 外部样本合并
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { STMPStore } from '../memory/stmp.js';
import type { CognitiveEngine } from '../cognitive/engine.js';
import type { TrainingSample as ExtractorTrainingSample } from '../knowledge/extractor.js';
import type { DataAugmentor } from './data-augmentor.js';
import { sanitizeText } from '../core/sanitizer.js';

// ── 导出配置 ──

export interface ExportConfig {
  /** 最低置信度 */
  minConfidence: number;
  /** 去重相似度阈值 */
  dedupThreshold: number;
  /** 单条最大长度 */
  maxContentLength: number;
  /** 是否脱敏 */
  anonymize: boolean;
  /** 导出目录 */
  outputDir: string;
  /** 是否启用数据扩增 */
  enableAugmentation: boolean;
}

const DEFAULT_EXPORT_CONFIG: ExportConfig = {
  minConfidence: 0.7,
  dedupThreshold: 0.9,
  maxContentLength: 500,
  anonymize: true,
  outputDir: '',
  enableAugmentation: false,
};

// ── 训练样本 ──

export interface TrainingSample {
  instruction: string;
  input: string;
  output: string;
  domain: string;
  confidence: number;
  sourceType: 'stmp' | 'conversation_qa' | 'judgment' | 'correction' | 'augmented';
}

// ── 多维质量评估 ──

export interface QualityMetrics {
  overall: number;           // 综合分数 0-1
  diversity: number;         // 多样性：sourceType 分布 + 领域覆盖
  reasoning: number;         // 推理深度：judgment/correction 样本占比
  coverage: number;          // 覆盖度：样本数量 vs 理想数量
  freshness: number;         // 新鲜度：近期样本占比
  sampleTypeBreakdown: Record<string, number>; // 各类型样本数
}

// ── 导出结果 ──

export interface ExportResult {
  domain: string;
  totalNodes: number;
  exportedSamples: number;
  filtered: number;       // 低置信度过滤
  deduplicated: number;   // 去重
  augmented: number;      // 扩增生成的样本数
  filePath: string;
  fileSizeBytes: number;
  qualityScore: number;   // 0-1 (兼容)
  qualityMetrics: QualityMetrics; // 多维评估
}

// ── 领域统计 ──

export interface DomainStats {
  domain: string;
  growthStage: string;
  totalNodes: number;
  eligibleNodes: number;  // 达到导出标准的
  avgConfidence: number;
  lastExtracted: number;
}

/**
 * 训练数据导出器
 */
export class TrainingExporter {
  private stmp: STMPStore;
  private cognitive: CognitiveEngine;
  private config: ExportConfig;
  private augmentor: DataAugmentor | null;
  private verbose: boolean;

  constructor(stmp: STMPStore, cognitive: CognitiveEngine, config?: Partial<ExportConfig>, verbose = false, augmentor?: DataAugmentor) {
    this.stmp = stmp;
    this.cognitive = cognitive;
    this.config = { ...DEFAULT_EXPORT_CONFIG, ...config };
    this.augmentor = augmentor ?? null;
    this.verbose = verbose;
  }

  /**
   * 获取所有可导出领域的统计
   */
  async getExportableStats(): Promise<DomainStats[]> {
    const profiles = this.cognitive.getAllDomainProfiles();
    const stats: DomainStats[] = [];

    for (const profile of profiles) {
      if (profile.growthStage === 'seed') continue;

      const nodes = await this.fetchDomainNodes(profile.domain);
      const eligible = nodes.filter(n =>
        (n.confidence ?? 0) >= this.config.minConfidence &&
        n.content.length >= 10 &&
        n.content.length <= this.config.maxContentLength
      );

      stats.push({
        domain: profile.domain,
        growthStage: profile.growthStage,
        totalNodes: nodes.length,
        eligibleNodes: eligible.length,
        avgConfidence: eligible.length > 0
          ? eligible.reduce((s, n) => s + (n.confidence ?? 0), 0) / eligible.length
          : 0,
        lastExtracted: profile.lastActiveAt ?? 0,
      });
    }

    return stats;
  }

  /**
   * 合并外部样本（来自 KnowledgeExtractor 的 Q&A 对 + 判断力样本）
   * 在导出前调用，将 extractor 提取的高质量样本并入导出
   */
  private externalSamples: Map<string, ExtractorTrainingSample[]> = new Map();

  addExternalSamples(domain: string, samples: ExtractorTrainingSample[]): void {
    const existing = this.externalSamples.get(domain) ?? [];
    this.externalSamples.set(domain, [...existing, ...samples]);
  }

  /**
   * 导出指定领域的训练数据
   */
  async exportDomain(domain: string): Promise<ExportResult> {
    const outputDir = this.config.outputDir || path.join(process.env.HOME ?? '/tmp', '.buddy', 'training-data');
    await fs.mkdir(outputDir, { recursive: true });

    // 1. 获取领域知识节点
    const rawNodes = await this.fetchDomainNodes(domain);
    const totalNodes = rawNodes.length;

    // 2. 置信度过滤
    const filtered = rawNodes.filter(n =>
      (n.confidence ?? 0) < this.config.minConfidence ||
      n.content.length < 10 ||
      n.content.length > this.config.maxContentLength
    );
    let nodes = rawNodes.filter(n =>
      (n.confidence ?? 0) >= this.config.minConfidence &&
      n.content.length >= 10 &&
      n.content.length <= this.config.maxContentLength
    );

    // 3. 去重
    const beforeDedup = nodes.length;
    nodes = this.deduplicate(nodes);
    const deduplicated = beforeDedup - nodes.length;

    // 4. 转换为训练样本
    let samples = this.convertToSamples(domain, nodes);

    // 5. 合并外部样本（Q&A 对 + 判断力样本 + 纠正样本）
    const extSamples = this.externalSamples.get(domain) ?? [];
    if (extSamples.length > 0) {
      const mapped: TrainingSample[] = extSamples.map(s => ({
        instruction: s.instruction,
        input: s.input,
        output: this.config.anonymize ? this.anonymizeContent(s.output) : s.output,
        domain: s.domain,
        confidence: s.confidence,
        sourceType: s.sourceType,
      }));
      samples = [...samples, ...mapped];
      this.externalSamples.delete(domain); // 清空已消费的外部样本
    }

    // 6. 数据扩增（Phase 0）
    let augmentedCount = 0;
    if (this.config.enableAugmentation && this.augmentor && samples.length >= 3) {
      try {
        const augmentResult = await this.augmentor.augment(samples, domain);
        if (augmentResult.samples.length > 0) {
          // 脱敏处理扩增样本
          const augmentedSamples = this.config.anonymize
            ? augmentResult.samples.map(s => ({ ...s, output: this.anonymizeContent(s.output) }))
            : augmentResult.samples;
          samples = [...samples, ...augmentedSamples];
          augmentedCount = augmentResult.samples.length;
          if (this.verbose) {
            console.log(`  [TrainingExporter] ${domain}: 扩增 ${augmentResult.seedCount} → +${augmentedCount} 条`);
          }
        }
      } catch (err) {
        if (this.verbose) console.warn(`[TrainingExporter] 扩增失败:`, (err as Error).message);
      }
    }

    // 7. 导出 JSONL
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `${domain}_${timestamp}.jsonl`;
    const filePath = path.join(outputDir, fileName);

    const lines = samples.map(s => JSON.stringify(s));
    await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf-8');

    const stat = await fs.stat(filePath);
    const qualityMetrics = this.computeQualityMetrics(samples);
    const qualityScore = qualityMetrics.overall;

    if (this.verbose) {
      console.log(`  [TrainingExporter] ${domain}: ${samples.length} 条 → ${fileName} (${(stat.size / 1024).toFixed(1)} KB) [质量: ${qualityScore.toFixed(2)}]`);
    }

    return {
      domain,
      totalNodes,
      exportedSamples: samples.length,
      filtered: filtered.length,
      deduplicated,
      augmented: augmentedCount,
      filePath,
      fileSizeBytes: stat.size,
      qualityScore,
      qualityMetrics,
    };
  }

  /**
   * 导出所有成熟领域的训练数据
   */
  async exportAllMature(): Promise<ExportResult[]> {
    const profiles = this.cognitive.getAllDomainProfiles();
    const results: ExportResult[] = [];

    for (const profile of profiles) {
      if (profile.growthStage !== 'mature' && profile.growthStage !== 'trainable') continue;
      try {
        const result = await this.exportDomain(profile.domain);
        if (result.exportedSamples > 0) {
          results.push(result);
        }
      } catch (err) {
        if (this.verbose) console.warn(`[TrainingExporter] 导出 ${profile.domain} 失败:`, (err as Error).message);
      }
    }

    return results;
  }

  /**
   * 导出为 JSON 格式（用于查看/调试）
   */
  async exportAsJSON(domain: string): Promise<string> {
    const nodes = await this.fetchDomainNodes(domain);
    const filtered = nodes.filter(n =>
      (n.confidence ?? 0) >= this.config.minConfidence &&
      n.content.length >= 10
    );
    const deduped = this.deduplicate(filtered);
    const samples = this.convertToSamples(domain, deduped);

    return JSON.stringify({
      domain,
      sampleCount: samples.length,
      samples,
      exportedAt: new Date().toISOString(),
    }, null, 2);
  }

  // ── 私有方法 ──

  /**
   * 从 STMP 获取领域知识节点
   */
  private async fetchDomainNodes(domain: string): Promise<Array<{
    id: string;
    content: string;
    confidence?: number;
    importance?: number;
    sourceType?: string;
  }>> {
    const nodes: Array<{
      id: string;
      content: string;
      confidence?: number;
      importance?: number;
      sourceType?: string;
    }> = [];

    try {
      const result = await this.stmp.retrieve(domain, { maxPrimary: 50, maxAssociative: 20 });

      for (const node of [...result.primary, ...result.associative]) {
        nodes.push({
          id: node.id,
          content: node.content,
          confidence: node.emotional?.importance ? node.emotional.importance / 10 : 0.5,
          importance: node.emotional?.importance ?? 5,
          sourceType: node.source ?? 'unknown',
        });
      }
    } catch (err) {
      if (this.verbose) console.warn(`[TrainingExporter] 获取 ${domain} 节点失败:`, (err as Error).message);
    }

    return nodes;
  }

  /**
   * 去重（基于内容相似度）
   */
  private deduplicate(nodes: Array<{ id: string; content: string; [key: string]: unknown }>): typeof nodes {
    const unique: typeof nodes = [];
    const seen = new Set<string>();

    for (const node of nodes) {
      // 简化内容用于比较（去掉空格和标点）
      const simplified = node.content
        .replace(/[\s，。！？、；：""''（）\[\]{}<>,.!?;:()\[\]{}<>]/g, '')
        .toLowerCase();

      let isDuplicate = false;
      for (const s of seen) {
        if (this.similarity(simplified, s) >= this.config.dedupThreshold) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        seen.add(simplified);
        unique.push(node);
      }
    }

    return unique;
  }

  /**
   * 简单字符串相似度（Jaccard）
   */
  private similarity(a: string, b: string): number {
    if (a.length === 0 || b.length === 0) return 0;

    const setA = new Set(a.split(''));
    const setB = new Set(b.split(''));

    let intersection = 0;
    for (const ch of setA) {
      if (setB.has(ch)) intersection++;
    }

    return intersection / (setA.size + setB.size - intersection);
  }

  /**
   * 将知识节点转换为训练样本
   */
  private convertToSamples(domain: string, nodes: Array<{
    id: string;
    content: string;
    confidence?: number;
    importance?: number;
    sourceType?: string;
  }>): TrainingSample[] {
    const samples: TrainingSample[] = [];

    for (const node of nodes) {
      const content = this.config.anonymize
        ? this.anonymizeContent(node.content)
        : node.content;

      samples.push({
        instruction: `作为${domain}领域的专家，请根据你的专业知识回答以下问题。`,
        input: '',
        output: content,
        domain,
        confidence: node.confidence ?? 0.5,
        sourceType: (node.sourceType ?? 'stmp') as TrainingSample['sourceType'],
      });
    }

    return samples;
  }

  /**
   * 脱敏处理（使用共享脱敏工具）
   */
  private anonymizeContent(content: string): string {
    return sanitizeText(content);
  }

  /**
   * 多维质量评估 (Phase B)
   * - diversity: 样本类型多样性 (stmp/judgment/correction/augmented 分布)
   * - reasoning: 推理深度 (judgment + correction 样本占比)
   * - coverage: 覆盖度 (样本数量 vs 理想数量 100)
   * - freshness: 内容质量 (置信度 + 长度合理性)
   */
  private computeQualityMetrics(samples: TrainingSample[]): QualityMetrics {
    if (samples.length === 0) {
      return { overall: 0, diversity: 0, reasoning: 0, coverage: 0, freshness: 0, sampleTypeBreakdown: {} };
    }

    // 类型分布统计
    const typeCounts: Record<string, number> = {};
    for (const s of samples) {
      typeCounts[s.sourceType] = (typeCounts[s.sourceType] ?? 0) + 1;
    }
    const uniqueTypes = Object.keys(typeCounts).length;

    // STMP 来源类型（对话/学习/观察/梦境/提取 都属于 STMP 积累）
    const stmpSourceTypes = new Set(['stmp', 'conversation', 'learned', 'observed', 'dream', 'extracted', 'unknown']);
    const stmpCount = samples.filter(s => stmpSourceTypes.has(s.sourceType)).length;

    // diversity: 类型越多越好 (max 4 types → 1.0)，纯单类型给低分
    const typeRatio = uniqueTypes <= 1 ? 0 : Math.min(uniqueTypes / 4, 1);
    const nonStmpRatio = 1 - stmpCount / samples.length;
    const diversity = typeRatio * 0.6 + nonStmpRatio * 0.4;

    // reasoning: judgment + correction 样本占比
    const reasoningSamples = (typeCounts['judgment'] ?? 0) + (typeCounts['correction'] ?? 0);
    const reasoning = Math.min(reasoningSamples / Math.max(samples.length * 0.3, 1), 1);

    // coverage: 数量分数 (上限 100)
    const coverage = Math.min(samples.length / 100, 1);

    // freshness: 置信度 + 内容长度合理性
    const avgConfidence = samples.reduce((s, n) => s + n.confidence, 0) / samples.length;
    const avgLen = samples.reduce((s, n) => s + n.output.length, 0) / samples.length;
    const lenScore = avgLen >= 30 && avgLen <= 300 ? 1 : avgLen >= 15 ? 0.5 : 0.2;
    const freshness = avgConfidence * 0.6 + lenScore * 0.4;

    // 综合分数 (加权)
    const overall = diversity * 0.2 + reasoning * 0.25 + coverage * 0.3 + freshness * 0.25;

    return {
      overall: Math.min(overall, 1),
      diversity: Math.min(diversity, 1),
      reasoning: Math.min(reasoning, 1),
      coverage,
      freshness: Math.min(freshness, 1),
      sampleTypeBreakdown: typeCounts,
    };
  }

  /**
   * 兼容旧接口的简单质量分数
   */
  private computeQualityScore(samples: TrainingSample[]): number {
    return this.computeQualityMetrics(samples).overall;
  }

  /**
   * 更新配置
   */
  updateConfig(patch: Partial<ExportConfig>): void {
    this.config = { ...this.config, ...patch };
  }
}
