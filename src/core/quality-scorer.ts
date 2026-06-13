/**
 * QualityScorer — 轻量质量评分器
 *
 * 对 LLM 输出进行多维质量评分，用于闭环反馈。
 * 两种模式：
 *   1. 规则评分（默认，零成本）— 基于长度、结构、工具调用成功率
 *   2. Judge LLM 评分（可选）— 用一个轻量 LLM 评估另一个 LLM 的输出质量
 */

export interface QualityDimensions {
  /** 整体质量 0-1 */
  overall: number;
  /** 相关性 — 是否回答了用户的问题 */
  relevance: number;
  /** 完整性 — 回答是否完整 */
  completeness: number;
  /** 简洁性 — 是否没有废话 */
  conciseness: number;
  /** 工具使用质量 — 工具调用是否正确 */
  toolQuality: number;
}

export interface ScoreResult {
  score: number;
  dimensions: QualityDimensions;
  method: 'rule' | 'judge';
  latencyMs: number;
}

/**
 * 规则评分 — 零成本，基于启发式规则
 */
export function scoreByRules(params: {
  input: string;
  output: string;
  toolCalls?: Array<{ name: string; success: boolean }>;
  latencyMs?: number;
}): ScoreResult {
  const start = Date.now();
  const { input, output, toolCalls, latencyMs } = params;

  const dimensions: QualityDimensions = {
    relevance: 0,
    completeness: 0,
    conciseness: 0,
    toolQuality: 0,
    overall: 0,
  };

  // ── 相关性 ──
  // 输出是否包含与输入相关的关键词
  const inputWords = new Set(input.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const outputWords = new Set(output.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const overlap = [...inputWords].filter(w => outputWords.has(w)).length;
  const relevance = inputWords.size > 0 ? Math.min(1, overlap / Math.max(1, inputWords.size * 0.3)) : 0.8;
  dimensions.relevance = relevance;

  // ── 完整性 ──
  // 输出长度是否合理（太短 = 不完整，太长 = 可能有废话）
  const outputLen = output.length;
  const inputLen = input.length;
  const expectedLen = Math.max(50, inputLen * 2);
  const lenRatio = outputLen / expectedLen;
  dimensions.completeness = lenRatio < 0.2 ? 0.3
    : lenRatio < 0.5 ? 0.6
    : lenRatio > 10 ? 0.7
    : Math.min(1, 0.5 + lenRatio * 0.3);

  // ── 简洁性 ──
  // 重复内容检测
  const sentences = output.split(/[。！？.!?\n]/).filter(s => s.trim().length > 5);
  const uniqueSentences = new Set(sentences.map(s => s.trim().toLowerCase()));
  const repetitionRate = sentences.length > 0 ? 1 - uniqueSentences.size / sentences.length : 0;
  dimensions.conciseness = Math.max(0, 1 - repetitionRate * 2);

  // ── 工具质量 ──
  if (toolCalls && toolCalls.length > 0) {
    const successRate = toolCalls.filter(t => t.success).length / toolCalls.length;
    dimensions.toolQuality = successRate;
  } else {
    dimensions.toolQuality = 1; // 无工具调用时默认满分
  }

  // ── 整体分数（加权平均） ──
  dimensions.overall =
    dimensions.relevance * 0.3 +
    dimensions.completeness * 0.25 +
    dimensions.conciseness * 0.2 +
    dimensions.toolQuality * 0.25;

  // 延迟惩罚
  if (latencyMs && latencyMs > 10000) {
    dimensions.overall *= 0.9;
  } else if (latencyMs && latencyMs > 30000) {
    dimensions.overall *= 0.7;
  }

  return {
    score: Math.round(dimensions.overall * 100) / 100,
    dimensions,
    method: 'rule',
    latencyMs: Date.now() - start,
  };
}

/**
 * Judge LLM 评分 — 用一个轻量 LLM 评估输出质量
 * 需要传入 chat 函数，返回 0-1 分数
 */
export async function scoreByJudge(params: {
  input: string;
  output: string;
  judgeChat: (messages: Array<{ role: string; content: string }>) => Promise<string>;
}): Promise<ScoreResult> {
  const start = Date.now();
  const { input, output, judgeChat } = params;

  try {
    const prompt = `You are a quality judge. Rate the following AI response on a scale of 0 to 1.

User question: ${input.slice(0, 500)}

AI response: ${output.slice(0, 1000)}

Rate ONLY with a JSON object: {"score": 0.85, "relevance": 0.9, "completeness": 0.8, "conciseness": 0.85}
No explanation, just the JSON.`;

    const result = await judgeChat([
      { role: 'system', content: 'You are a precise quality evaluator. Output only valid JSON.' },
      { role: 'user', content: prompt },
    ]);

    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const score = Math.max(0, Math.min(1, parsed.score ?? 0.5));
      return {
        score,
        dimensions: {
          overall: score,
          relevance: parsed.relevance ?? score,
          completeness: parsed.completeness ?? score,
          conciseness: parsed.conciseness ?? score,
          toolQuality: 1,
        },
        method: 'judge',
        latencyMs: Date.now() - start,
      };
    }
  } catch {
    // Judge 失败，降级到规则评分
  }

  // fallback
  return scoreByRules({ input, output });
}
