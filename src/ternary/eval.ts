/**
 * 三进制模型质量评估器
 *
 * 多维度评估模型能力：
 * 1. 领域准确率 — 在特定领域的回答质量
 * 2. 一致性 — 相同输入多次推理的稳定性
 * 3. 多样性 — 输出的丰富度
 * 4. 覆盖度 — 知识面覆盖程度
 * 5. 推理速度 — tok/s 性能
 */

import type { TernaryModel, TernaryModelMeta } from './format.js';
import type { TrainingSample } from './trainer.js';
import { TernaryEngine, type EngineStats } from './engine.js';

// ── 评估数据集 ──

export interface EvalDataset {
  /** 评估集名称 */
  name: string;
  /** 领域 */
  domain: string;
  /** 评估样本 */
  samples: EvalSample[];
}

export interface EvalSample {
  /** 输入 */
  prompt: string;
  /** 参考答案 */
  reference: string;
  /** 难度 (0-1) */
  difficulty: number;
  /** 类别 */
  category: string;
}

// ── 评估配置 ──

export interface EvalConfig {
  /** 每题重复推理次数（测试一致性） */
  repeatInference: number;
  /** 推理配置 */
  maxTokens: number;
  temperature: number;
  /** 评估超时 (ms) */
  timeoutMs: number;
}

const DEFAULT_EVAL_CONFIG: EvalConfig = {
  repeatInference: 3,
  maxTokens: 128,
  temperature: 0.7,
  timeoutMs: 30000,
};

// ── 评估结果 ──

export interface EvalResult {
  /** 模型元数据 */
  modelMeta: TernaryModelMeta;
  /** 评估集名称 */
  datasetName: string;

  /** 领域准确率 (0-1) */
  domainAccuracy: number;
  /** 回答一致性 (0-1) */
  consistency: number;
  /** 输出多样性 (0-1) */
  diversity: number;
  /** 知识覆盖度 (0-1) */
  coverage: number;

  /** 推理性能 */
  performance: {
    tokPerSec: number;
    firstTokenMs: number;
    memoryMB: number;
  };

  /** 各类别准确率 */
  categoryScores: Record<string, number>;

  /** 各难度准确率 */
  difficultyScores: Record<string, number>;

  /** 综合评分 (0-100) */
  overallScore: number;

  /** 评估详情 */
  details: {
    totalSamples: number;
    evaluatedSamples: number;
    errors: number;
    elapsedMs: number;
  };
}

// ── 成长报告 ──

export interface GrowthComparison {
  /** 之前评估结果 */
  previous: EvalResult | null;
  /** 当前评估结果 */
  current: EvalResult;
  /** 变化 */
  changes: {
    accuracyDelta: number;
    consistencyDelta: number;
    diversityDelta: number;
    coverageDelta: number;
    overallDelta: number;
  };
  /** 是否有进步 */
  improved: boolean;
}

// ════════════════════════════════════════════════════════
// 质量评估器
// ════════════════════════════════════════════════════════

export class TernaryEvaluator {
  private config: EvalConfig;
  private history: Map<string, EvalResult[]> = new Map();

  constructor(config?: Partial<EvalConfig>) {
    this.config = { ...DEFAULT_EVAL_CONFIG, ...config };
  }

  /**
   * 评估模型
   */
  async evaluate(model: TernaryModel, dataset: EvalDataset): Promise<EvalResult> {
    const startTime = performance.now();
    const engine = new TernaryEngine();
    engine.loadFromModel(model);

    const categoryScores: Record<string, { correct: number; total: number }> = {};
    const difficultyScores: Record<string, { correct: number; total: number }> = {};
    let totalConsistency = 0;
    const outputs: string[] = [];
    let errors = 0;
    let evaluated = 0;

    for (const sample of dataset.samples) {
      try {
        // 多次推理测试一致性
        const results: string[] = [];
        for (let r = 0; r < this.config.repeatInference; r++) {
          const output = await engine.complete(sample.prompt, {
            maxTokens: this.config.maxTokens,
            temperature: this.config.temperature,
          });
          results.push(output);
        }

        // 一致性评分
        const consistency = this.computeConsistency(results);
        totalConsistency += consistency;

        // 简化准确率评估：检查输出长度和关键词
        const bestOutput = results[0];
        outputs.push(bestOutput);

        // 类别统计
        const cat = sample.category;
        if (!categoryScores[cat]) categoryScores[cat] = { correct: 0, total: 0 };
        categoryScores[cat].total++;
        if (this.isRelevantAnswer(bestOutput, sample.reference)) {
          categoryScores[cat].correct++;
        }

        // 难度统计
        const diff = sample.difficulty > 0.7 ? 'hard' : sample.difficulty > 0.3 ? 'medium' : 'easy';
        if (!difficultyScores[diff]) difficultyScores[diff] = { correct: 0, total: 0 };
        difficultyScores[diff].total++;
        if (this.isRelevantAnswer(bestOutput, sample.reference)) {
          difficultyScores[diff].correct++;
        }

        evaluated++;
      } catch {
        errors++;
      }
    }

    // 计算各项指标
    const domainAccuracy = this.computeAccuracy(categoryScores);
    const consistency = evaluated > 0 ? totalConsistency / evaluated : 0;
    const diversity = this.computeDiversity(outputs);
    const coverage = this.computeCoverage(categoryScores);

    // 引擎统计
    const stats = engine.getStats();

    // 转换类别/难度分数
    const catScores = this.toRatioScores(categoryScores);
    const diffScores = this.toRatioScores(difficultyScores);

    // 综合评分
    const overallScore = Math.round(
      (domainAccuracy * 40 + consistency * 20 + diversity * 15 + coverage * 25)
    );

    const result: EvalResult = {
      modelMeta: model.meta,
      datasetName: dataset.name,
      domainAccuracy,
      consistency,
      diversity,
      coverage,
      performance: {
        tokPerSec: stats.tokPerSec,
        firstTokenMs: stats.firstTokenMs,
        memoryMB: stats.memoryMB,
      },
      categoryScores: catScores,
      difficultyScores: diffScores,
      overallScore,
      details: {
        totalSamples: dataset.samples.length,
        evaluatedSamples: evaluated,
        errors,
        elapsedMs: Math.round(performance.now() - startTime),
      },
    };

    // 记录历史
    const domain = model.meta.domain;
    if (!this.history.has(domain)) this.history.set(domain, []);
    this.history.get(domain)!.push(result);

    engine.unload();
    return result;
  }

  /**
   * 快速评估（只检查基本功能）
   */
  quickEval(model: TernaryModel): { loaded: boolean; canGenerate: boolean; tokPerSec: number } {
    const engine = new TernaryEngine();
    engine.loadFromModel(model);

    const canGenerate = engine.isLoaded;
    let tokPerSec = 0;

    if (canGenerate) {
      const start = performance.now();
      let tokens = 0;
      // 同步解码几步
      let tokenId = 42;
      for (let i = 0; i < 10; i++) {
        const result = engine.decode(tokenId);
        tokenId = result.nextToken;
        tokens++;
      }
      const elapsed = (performance.now() - start) / 1000;
      tokPerSec = elapsed > 0 ? Math.round(tokens / elapsed) : 0;
    }

    engine.unload();
    return { loaded: true, canGenerate, tokPerSec };
  }

  /**
   * 获取历史评估结果
   */
  getHistory(domain: string): EvalResult[] {
    return this.history.get(domain) ?? [];
  }

  /**
   * 比较两次评估
   */
  compare(current: EvalResult): GrowthComparison | null {
    const history = this.history.get(current.modelMeta.domain);
    if (!history || history.length < 2) return null;

    const previous = history[history.length - 2];

    return {
      previous,
      current,
      changes: {
        accuracyDelta: current.domainAccuracy - previous.domainAccuracy,
        consistencyDelta: current.consistency - previous.consistency,
        diversityDelta: current.diversity - previous.diversity,
        coverageDelta: current.coverage - previous.coverage,
        overallDelta: current.overallScore - previous.overallScore,
      },
      improved: current.overallScore > previous.overallScore,
    };
  }

  // ── 内部方法 ──

  private computeConsistency(outputs: string[]): number {
    if (outputs.length <= 1) return 1;

    // 两两比较相似度
    let totalSim = 0;
    let pairs = 0;

    for (let i = 0; i < outputs.length; i++) {
      for (let j = i + 1; j < outputs.length; j++) {
        totalSim += this.stringSimilarity(outputs[i], outputs[j]);
        pairs++;
      }
    }

    return pairs > 0 ? totalSim / pairs : 1;
  }

  private computeDiversity(outputs: string[]): number {
    if (outputs.length <= 1) return 1;

    const unique = new Set(outputs);
    return unique.size / outputs.length;
  }

  private computeCoverage(categoryScores: Record<string, { correct: number; total: number }>): number {
    const categories = Object.keys(categoryScores);
    if (categories.length === 0) return 0;

    const answered = categories.filter(c => categoryScores[c].correct > 0);
    return answered.length / categories.length;
  }

  private computeAccuracy(categoryScores: Record<string, { correct: number; total: number }>): number {
    let totalCorrect = 0, totalSamples = 0;
    for (const cat of Object.values(categoryScores)) {
      totalCorrect += cat.correct;
      totalSamples += cat.total;
    }
    return totalSamples > 0 ? totalCorrect / totalSamples : 0;
  }

  private toRatioScores(scores: Record<string, { correct: number; total: number }>): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [key, val] of Object.entries(scores)) {
      result[key] = val.total > 0 ? Math.round((val.correct / val.total) * 1000) / 1000 : 0;
    }
    return result;
  }

  private isRelevantAnswer(output: string, reference: string): boolean {
    // 简化匹配：检查是否有共同关键词
    const refWords = new Set(reference.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const outWords = output.toLowerCase().split(/\s+/);

    let matches = 0;
    for (const w of outWords) {
      if (refWords.has(w)) matches++;
    }

    return matches >= Math.min(2, refWords.size * 0.3);
  }

  private stringSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;

    // Jaccard 相似度（字符 bigrams）
    const bigramsA = this.getBigrams(a);
    const bigramsB = this.getBigrams(b);

    const intersection = new Set([...bigramsA].filter(x => bigramsB.has(x)));
    const union = new Set([...bigramsA, ...bigramsB]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  private getBigrams(str: string): Set<string> {
    const bigrams = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.add(str.slice(i, i + 2));
    }
    return bigrams;
  }
}
