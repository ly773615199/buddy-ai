/**
 * Self-Instruct 数据扩增器 — 将少量种子样本扩增为多样化训练数据
 *
 * 核心思路：
 * 1. 从种子样本中提取知识模式
 * 2. 用 LLM 生成新的 instruction/input/output 三元组
 * 3. 质量过滤（去重 + 长度 + 多样性）
 *
 * 目标：10 条知识 → 50+ 条高质量训练样本
 */

import type { TrainingSample } from './training-exporter.js';

// ==================== 类型定义 ====================

/** 扩增配置 */
export interface AugmentConfig {
  /** 扩增倍数 (每条种子生成多少条) */
  expansionRatio: number;
  /** 最大总输出数 */
  maxOutput: number;
  /** 最低质量阈值 */
  minQuality: number;
  /** 单条最大输出长度 */
  maxOutputLength: number;
}

/** 扩增结果 */
export interface AugmentResult {
  domain: string;
  seedCount: number;
  generatedCount: number;
  filteredCount: number;
  samples: TrainingSample[];
}

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: AugmentConfig = {
  expansionRatio: 5,
  maxOutput: 200,
  minQuality: 0.6,
  maxOutputLength: 500,
};

// ==================== 扩增 Prompt 模板 ====================

function buildAugmentPrompt(seeds: TrainingSample[], domain: string, count: number): string {
  const seedExamples = seeds.slice(0, 5).map((s, i) =>
    `示例 ${i + 1}:\n  instruction: ${s.instruction}\n  input: ${s.input || '(无)'}\n  output: ${s.output}`
  ).join('\n\n');

  return `你是训练数据扩增器。根据以下种子样本，为「${domain}」领域生成 ${count} 条新的训练数据。

## 要求
- 保持与种子样本相同的知识深度和专业性
- 每条数据的 instruction 应该不同（换角度提问）
- output 必须包含具体的专业知识，不能是泛泛而谈
- 覆盖不同子话题（从种子中推断领域子话题）
- 以下类型的样本各尝试生成：
  1. 问答对（直接回答专业问题）
  2. 判断力样本（情境→判断→原因）
  3. 纠正样本（错误方案→正确方案→原因）

## 种子样本

${seedExamples}

## 输出格式

返回 JSON 数组，每个元素包含：
- instruction: 指令（一个问题或任务描述）
- input: 输入上下文（可为空字符串）
- output: 专业回答

生成 ${count} 条。仅输出 JSON，不要其他内容。`;
}

// ==================== 主类 ====================

export class DataAugmentor {
  private llmCall: ((messages: Array<{ role: string; content: string }>) => Promise<string>) | null = null;
  private config: AugmentConfig;
  private verbose: boolean;

  constructor(config?: Partial<AugmentConfig>, verbose = false) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.verbose = verbose;
  }

  /** 设置 LLM 调用器 */
  setLLMCaller(caller: (messages: Array<{ role: string; content: string }>) => Promise<string>): void {
    this.llmCall = caller;
  }

  /**
   * 从种子样本扩增训练数据
   * @param seeds 种子样本（从 KnowledgeExtractor 或 TrainingExporter 获取）
   * @param domain 领域名
   */
  async augment(seeds: TrainingSample[], domain: string): Promise<AugmentResult> {
    const result: AugmentResult = {
      domain,
      seedCount: seeds.length,
      generatedCount: 0,
      filteredCount: 0,
      samples: [],
    };

    if (seeds.length === 0) return result;
    if (!this.llmCall) {
      if (this.verbose) console.warn('[DataAugmentor] 无 LLM 调用器，跳过扩增');
      return result;
    }

    // 计算目标扩增数量
    const targetCount = Math.min(
      seeds.length * this.config.expansionRatio,
      this.config.maxOutput - seeds.length,
    );
    if (targetCount <= 0) return result;

    try {
      // 分批生成（每批最多 10 条，避免 LLM 输出过长）
      const batchSize = Math.min(targetCount, 10);
      const batches = Math.ceil(targetCount / batchSize);
      const allGenerated: TrainingSample[] = [];

      for (let batch = 0; batch < batches; batch++) {
        const count = Math.min(batchSize, targetCount - allGenerated.length);
        if (count <= 0) break;

        try {
          const batchSamples = await this.generateBatch(seeds, domain, count);
          allGenerated.push(...batchSamples);
        } catch (err) {
          if (this.verbose) console.warn(`[DataAugmentor] 批次 ${batch + 1} 失败:`, (err as Error).message);
        }
      }

      result.generatedCount = allGenerated.length;

      // 质量过滤
      const filtered = this.qualityFilter(allGenerated, seeds);
      result.filteredCount = allGenerated.length - filtered.length;
      result.samples = filtered;

      if (this.verbose) {
        console.log(`  [DataAugmentor] ${domain}: ${seeds.length} 种子 → ${allGenerated.length} 生成 → ${filtered.length} 保留`);
      }

      return result;
    } catch (err) {
      if (this.verbose) console.warn('[DataAugmentor] 扩增失败:', (err as Error).message);
      return result;
    }
  }

  /**
   * 单批生成
   */
  private async generateBatch(seeds: TrainingSample[], domain: string, count: number): Promise<TrainingSample[]> {
    if (!this.llmCall) return [];

    const prompt = buildAugmentPrompt(seeds, domain, count);

    const response = await this.llmCall([
      { role: 'system', content: '你是训练数据扩增器，生成高质量的 JSON 训练样本。只输出 JSON 数组。' },
      { role: 'user', content: prompt },
    ]);

    return this.parseAugmentResponse(response, domain);
  }

  /**
   * 解析 LLM 返回的扩增数据
   */
  private parseAugmentResponse(response: string, domain: string): TrainingSample[] {
    try {
      let jsonStr = response.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      const start = jsonStr.indexOf('[');
      const end = jsonStr.lastIndexOf(']');
      if (start >= 0 && end > start) {
        jsonStr = jsonStr.slice(start, end + 1);
      }

      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((item: any) => item && item.instruction && item.output)
        .map((item: any) => ({
          instruction: String(item.instruction).slice(0, 200),
          input: String(item.input ?? '').slice(0, 200),
          output: String(item.output).slice(0, this.config.maxOutputLength),
          domain,
          confidence: 0.7, // 扩增样本默认置信度
          sourceType: 'augmented' as const,
        }));
    } catch {
      return [];
    }
  }

  /**
   * 质量过滤
   */
  private qualityFilter(generated: TrainingSample[], seeds: TrainingSample[]): TrainingSample[] {
    const filtered: TrainingSample[] = [];
    const seedOutputs = new Set(seeds.map(s => s.output.slice(0, 50).toLowerCase()));

    for (const sample of generated) {
      // 1. 长度过滤
      if (sample.output.length < 15) continue;
      if (sample.instruction.length < 5) continue;

      // 2. 与种子去重（不能和种子太相似）
      const sampleKey = sample.output.slice(0, 50).toLowerCase();
      if (seedOutputs.has(sampleKey)) continue;

      // 3. 过滤泛泛而谈的内容
      const generic = /^(好的|嗯|是的|没问题|当然|我来|让我|这个)/i;
      if (generic.test(sample.output.trim())) continue;

      // 4. 质量评分（基于内容具体性）
      const quality = this.scoreQuality(sample);
      if (quality < this.config.minQuality) continue;

      filtered.push(sample);
    }

    return filtered;
  }

  /**
   * 单条样本质量评分
   */
  private scoreQuality(sample: TrainingSample): number {
    let score = 0;

    // 长度合理性 (30-300 最佳)
    const len = sample.output.length;
    if (len >= 30 && len <= 300) score += 0.3;
    else if (len >= 15) score += 0.15;

    // 包含专业信号词
    const hasExpertSignal = /因为|由于|原因|关键|注意|建议|应该|最好|不要|避免|实际上|本质上|方法是|做法是/i;
    if (hasExpertSignal.test(sample.output)) score += 0.3;

    // instruction 不是太泛
    if (sample.instruction.length >= 10) score += 0.2;

    // output 包含具体信息（数字、专有名词等）
    const hasSpecifics = /\d+|[A-Z]{2,}|[\u4e00-\u9fff]{2,}(?:模式|架构|算法|协议|框架|引擎)/;
    if (hasSpecifics.test(sample.output)) score += 0.2;

    return Math.min(score, 1);
  }

  /** 更新配置 */
  updateConfig(patch: Partial<AugmentConfig>): void {
    this.config = { ...this.config, ...patch };
  }
}
