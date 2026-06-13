/**
 * 议题分析器 — 把模糊输入分解为可审议的子议题 + 判断审议模式
 *
 * 两层策略：
 * - 快速层: 复用 ClarificationEngine 模式匹配 (< 1ms)
 * - 深度层: LLM 议题分解 (仅模糊度高时触发)
 *
 * 两种模式：
 * - clarify: 用户知道答案但没说 → 追问参数
 * - brainstorm: 用户自己也在探索 → 生成方案选项
 */

import { ClarificationEngine } from '../../core/clarifier.js';
import type { Topic, SubQuestion } from './types.js';

export class TopicAnalyzer {
  private clarifier: ClarificationEngine;
  private llmCall: ((messages: Array<{ role: string; content: string }>) => Promise<string>) | null = null;

  constructor() {
    this.clarifier = new ClarificationEngine(10); // 审议委员会内部不限制澄清次数
  }

  setLLMCaller(caller: (messages: Array<{ role: string; content: string }>) => Promise<string>): void {
    this.llmCall = caller;
  }

  async analyze(input: string): Promise<Topic> {
    const topicId = `topic-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // 1. 快速模式匹配
    const quick = this.clarifier.assess(input);

    if (!quick.shouldClarify) {
      return {
        id: topicId,
        originalInput: input,
        coreQuestion: input,
        subQuestions: [],
        ambiguityScore: 0.1,
        missingInfo: [],
        readyToExecute: true,
        mode: 'clarify',
      };
    }

    // 2. 模糊度高 → 构建子议题
    const subQuestions = this.buildSubQuestions(input, quick);

    // 3. LLM 深度分析（可选）
    let llmResult: { subQuestions: SubQuestion[]; mode: 'clarify' | 'brainstorm' } = { subQuestions: [], mode: 'clarify' };
    if (this.llmCall) {
      llmResult = await this.deepAnalyze(input, subQuestions);
    }

    const allSubQuestions = [...subQuestions, ...llmResult.subQuestions];
    const missingInfo = quick.ambiguousAspects;

    // 4. 模式判断
    const mode = llmResult.mode || this.detectMode(input, allSubQuestions);

    return {
      id: topicId,
      originalInput: input,
      coreQuestion: input,
      subQuestions: allSubQuestions,
      ambiguityScore: Math.min(1, missingInfo.length / 4),
      missingInfo,
      readyToExecute: allSubQuestions.filter(q => q.required).length === 0,
      mode,
    };
  }

  /**
   * 模式判断启发式
   */
  private detectMode(input: string, subQuestions: SubQuestion[]): 'clarify' | 'brainstorm' {
    const brainstormPatterns = /画|设计|创作|创意|优化|改进|美化|风格|方案|思路|想法|怎么做|如何实现|有没有/i;
    const clarifyPatterns = /保存|发送|部署|路径|文件名|哪个|哪一|几|多少|给谁/i;

    const hasBrainstormSignal = brainstormPatterns.test(input);
    const hasClarifySignal = clarifyPatterns.test(input);

    if (hasBrainstormSignal && !hasClarifySignal) return 'brainstorm';

    const hasOptionQuestions = subQuestions.some(q =>
      q.question.includes('还是') || q.question.includes('哪种') || q.question.includes('方案'),
    );
    if (hasOptionQuestions) return 'brainstorm';

    if (hasClarifySignal) return 'clarify';

    return 'brainstorm';
  }

  private buildSubQuestions(input: string, quick: { ambiguousAspects: string[]; issueType: string }): SubQuestion[] {
    const questions: SubQuestion[] = [];

    // 基于 ClarificationEngine 的模糊点生成子问题
    for (let i = 0; i < quick.ambiguousAspects.length; i++) {
      const aspect = quick.ambiguousAspects[i];
      questions.push({
        id: `sq-quick-${i}`,
        question: aspect,
        required: quick.issueType === 'conflict' || quick.issueType === 'resource',
        source: quick.issueType === 'conflict' ? 'conflict'
          : quick.issueType === 'resource' ? 'missing_param'
          : 'vague_word',
      });
    }

    return questions;
  }

  /**
   * LLM 深度分析 — 同时做议题分解和模式判断
   */
  private async deepAnalyze(input: string, _existingSubs: SubQuestion[]): Promise<{ subQuestions: SubQuestion[]; mode: 'clarify' | 'brainstorm' }> {
    if (!this.llmCall) return { subQuestions: [], mode: 'clarify' };

    const prompt = `分析以下用户输入，判断审议模式并生成子议题。

用户输入: "${input}"

审议模式定义：
- clarify（澄清模式）：用户知道自己要什么，只是缺少具体参数。例如"帮我写个文件"缺文件名。
- brainstorm（头脑风暴模式）：用户方向不确定，需要探索不同方案。例如"帮我优化这个系统"不知道优化什么。

请以 JSON 格式回复:
{
  "mode": "clarify 或 brainstorm",
  "reasoning": "判断理由",
  "subQuestions": [
    {
      "question": "子问题",
      "required": true/false,
      "source": "llm分析"
    }
  ]
}`;

    try {
      const response = await this.llmCall([{ role: 'user', content: prompt }]);
      // 提取 JSON（兼容 markdown code block）
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { subQuestions: [], mode: 'clarify' };
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        subQuestions: (parsed.subQuestions ?? []).map((q: any, i: number) => ({
          id: `sq-llm-${i}`,
          question: q.question,
          required: q.required ?? true,
          source: 'llm分析' as const,
        })),
        mode: parsed.mode === 'brainstorm' ? 'brainstorm' : 'clarify',
      };
    } catch {
      return { subQuestions: [], mode: 'clarify' };
    }
  }
}
