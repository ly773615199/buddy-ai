/**
 * 蒸馏数据准备器
 *
 * 将大模型推理输出转化为三进制模型的训练数据。
 *
 * 数据来源：
 * 1. 大模型 QA 对 (教师模型回答)
 * 2. 大模型推理链 (CoT)
 * 3. 判断力样本 (大模型做选择的记录)
 * 4. 纠错样本 (大模型纠正错误的记录)
 *
 * 数据格式：TrainingSample（与 trainer.ts 兼容）
 */

import type { TrainingSample } from './trainer.js';

// ── 大模型原始输出 ──

export interface TeacherOutput {
  /** 输入 prompt */
  prompt: string;
  /** 教师模型回答 */
  response: string;
  /** 推理链 (可选) */
  reasoning?: string;
  /** 领域 */
  domain: string;
  /** 教师模型标识 */
  teacherModel: string;
  /** 置信度 (0-1) */
  confidence?: number;
  /** 时间戳 */
  timestamp: number;
}

export interface JudgmentSample {
  /** 场景描述 */
  scenario: string;
  /** 选项列表 */
  options: string[];
  /** 教师选择的索引 */
  teacherChoice: number;
  /** 教师解释 */
  explanation?: string;
  /** 领域 */
  domain: string;
  /** 质量评分 */
  quality: number;
}

export interface CorrectionSample {
  /** 原始错误回答 */
  wrongAnswer: string;
  /** 正确回答 */
  correctAnswer: string;
  /** 错误原因分析 */
  errorReason: string;
  /** 领域 */
  domain: string;
  /** 质量评分 */
  quality: number;
}

// ── 蒸馏配置 ──

export interface DistillPrepConfig {
  /** 最小 prompt 长度 */
  minPromptLen: number;
  /** 最大 prompt 长度 */
  maxPromptLen: number;
  /** 最小回答长度 */
  minResponseLen: number;
  /** 推理链拆分为子步骤 */
  splitReasoningSteps: boolean;
  /** 判断力样本置信度阈值 */
  minJudgmentConfidence: number;
  /** 每条 QA 对生成的样本倍数 */
  samplesPerQA: number;
}

const DEFAULT_CONFIG: DistillPrepConfig = {
  minPromptLen: 5,
  maxPromptLen: 2048,
  minResponseLen: 10,
  splitReasoningSteps: true,
  minJudgmentConfidence: 0.7,
  samplesPerQA: 3,
};

// ── 蒸馏统计 ──

export interface DistillStats {
  /** 原始 QA 对数 */
  rawQACount: number;
  /** 生成的训练样本数 */
  generatedSamples: number;
  /** 丢弃的低质量样本数 */
  discardedCount: number;
  /** 领域分布 */
  domainDistribution: Record<string, number>;
  /** 类型分布 */
  typeDistribution: Record<string, number>;
  /** 平均质量分 */
  avgQuality: number;
}

// ════════════════════════════════════════════════════════
// 蒸馏数据准备器
// ════════════════════════════════════════════════════════

export class DistillDataPrep {
  private config: DistillPrepConfig;
  private vocab: Map<string, number> = new Map();
  private nextId = 10;

  constructor(config?: Partial<DistillPrepConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initVocab();
  }

  /**
   * 从教师模型 QA 对生成训练样本
   */
  prepareFromQA(outputs: TeacherOutput[]): TrainingSample[] {
    const samples: TrainingSample[] = [];

    for (const output of outputs) {
      if (!this.validateOutput(output)) continue;

      // 1. 基础 QA 样本
      samples.push(this.qaToSample(output));

      // 2. 推理链拆分（如有）
      if (this.config.splitReasoningSteps && output.reasoning) {
        samples.push(...this.splitReasoning(output));
      }

      // 3. 反向 QA（回答 → 问题）
      if (this.config.samplesPerQA > 1) {
        samples.push(this.reverseQA(output));
      }

      // 4. 摘要样本（长回答 → 短摘要）
      if (output.response.length > 100 && this.config.samplesPerQA > 2) {
        samples.push(this.summarizationSample(output));
      }
    }

    return samples;
  }

  /**
   * 从判断力样本生成训练数据
   */
  prepareFromJudgments(samples: JudgmentSample[]): TrainingSample[] {
    const results: TrainingSample[] = [];

    for (const j of samples) {
      if (j.quality < this.config.minJudgmentConfidence) continue;

      // 选择题格式：场景 + 选项 → 正确选择
      const prompt = `${j.scenario}\n选项：${j.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join(' ')}`;
      const response = `${String.fromCharCode(65 + j.teacherChoice)}. ${j.options[j.teacherChoice]}${j.explanation ? ` — ${j.explanation}` : ''}`;

      results.push({
        inputIds: this.tokenize(prompt),
        targetIds: this.tokenize(response),
        type: 'judgment',
        domain: j.domain,
        quality: j.quality,
        timestamp: Date.now(),
      });
    }

    return results;
  }

  /**
   * 从纠错样本生成训练数据
   */
  prepareFromCorrections(samples: CorrectionSample[]): TrainingSample[] {
    const results: TrainingSample[] = [];

    for (const c of samples) {
      if (c.quality < 0.5) continue;

      // 纠错格式：错误回答 → 正确回答 + 原因
      const prompt = `错误：${c.wrongAnswer}`;
      const response = `正确：${c.correctAnswer}。原因：${c.errorReason}`;

      results.push({
        inputIds: this.tokenize(prompt),
        targetIds: this.tokenize(response),
        type: 'correction',
        domain: c.domain,
        quality: c.quality,
        timestamp: Date.now(),
      });
    }

    return results;
  }

  /**
   * 批量处理：混合多种来源
   */
  prepareFromMixed(input: {
    qa?: TeacherOutput[];
    judgments?: JudgmentSample[];
    corrections?: CorrectionSample[];
  }): { samples: TrainingSample[]; stats: DistillStats } {
    const allSamples: TrainingSample[] = [];
    let rawCount = 0;

    if (input.qa) {
      rawCount += input.qa.length;
      allSamples.push(...this.prepareFromQA(input.qa));
    }
    if (input.judgments) {
      rawCount += input.judgments.length;
      allSamples.push(...this.prepareFromJudgments(input.judgments));
    }
    if (input.corrections) {
      rawCount += input.corrections.length;
      allSamples.push(...this.prepareFromCorrections(input.corrections));
    }

    const stats = this.computeStats(allSamples, rawCount);
    return { samples: allSamples, stats };
  }

  // ── 内部方法 ──

  private validateOutput(output: TeacherOutput): boolean {
    if (output.prompt.length < this.config.minPromptLen) return false;
    if (output.prompt.length > this.config.maxPromptLen) return false;
    if (output.response.length < this.config.minResponseLen) return false;
    return true;
  }

  private qaToSample(output: TeacherOutput): TrainingSample {
    return {
      inputIds: this.tokenize(output.prompt),
      targetIds: this.tokenize(output.response),
      type: 'qa',
      domain: output.domain,
      quality: output.confidence ?? 0.8,
      timestamp: output.timestamp,
    };
  }

  private reverseQA(output: TeacherOutput): TrainingSample {
    return {
      inputIds: this.tokenize(output.response.slice(0, 200)),
      targetIds: this.tokenize(output.prompt),
      type: 'qa',
      domain: output.domain,
      quality: (output.confidence ?? 0.8) * 0.9, // 略低质量
      timestamp: output.timestamp,
    };
  }

  private summarizationSample(output: TeacherOutput): TrainingSample {
    // 取前 200 字符作为"长文"，回答前 50 字符作为"摘要"
    return {
      inputIds: this.tokenize(`总结：${output.response.slice(0, 200)}`),
      targetIds: this.tokenize(output.response.slice(0, 50)),
      type: 'instruct',
      domain: output.domain,
      quality: (output.confidence ?? 0.8) * 0.85,
      timestamp: output.timestamp,
    };
  }

  private splitReasoning(output: TeacherOutput): TrainingSample[] {
    const steps = (output.reasoning ?? '')
      .split(/[。\n;；]+/)
      .map(s => s.trim())
      .filter(s => s.length > 5);

    return steps.map((step, i) => ({
      inputIds: this.tokenize(`步骤 ${i + 1}：${step}`),
      targetIds: this.tokenize(step),
      type: 'instruct' as const,
      domain: output.domain,
      quality: (output.confidence ?? 0.8) * 0.9,
      timestamp: output.timestamp,
    }));
  }

  /**
   * 简易分词（与 TernaryTokenizer 兼容）
   */
  private tokenize(text: string): number[] {
    const ids: number[] = [1]; // BOS
    for (const ch of text) {
      if (this.vocab.has(ch)) {
        ids.push(this.vocab.get(ch)!);
      } else {
        ids.push(3); // UNK
      }
    }
    ids.push(2); // EOS
    return ids;
  }

  private initVocab(): void {
    // 基础 token
    this.vocab.set('<pad>', 0);
    this.vocab.set('<s>', 1);
    this.vocab.set('</s>', 2);
    this.vocab.set('<unk>', 3);

    // ASCII
    for (let i = 32; i <= 126; i++) {
      this.vocab.set(String.fromCharCode(i), this.nextId++);
    }

    // 常用中文（前 5000）
    for (let cp = 0x4E00; cp < 0x4E00 + 5000; cp++) {
      this.vocab.set(String.fromCodePoint(cp), this.nextId++);
    }
  }

  private computeStats(samples: TrainingSample[], rawCount: number): DistillStats {
    const domainDist: Record<string, number> = {};
    const typeDist: Record<string, number> = {};
    let totalQuality = 0;

    for (const s of samples) {
      domainDist[s.domain] = (domainDist[s.domain] ?? 0) + 1;
      typeDist[s.type] = (typeDist[s.type] ?? 0) + 1;
      totalQuality += s.quality;
    }

    return {
      rawQACount: rawCount,
      generatedSamples: samples.length,
      discardedCount: 0,
      domainDistribution: domainDist,
      typeDistribution: typeDist,
      avgQuality: samples.length > 0 ? totalQuality / samples.length : 0,
    };
  }
}
