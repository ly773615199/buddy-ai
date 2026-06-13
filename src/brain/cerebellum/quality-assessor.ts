/**
 * OutputQualityAssessor — 输出质量自评器
 *
 * 纯规则评估，无 LLM 调用，<5ms
 *
 * 四维评估：
 * - completeness: 输出是否覆盖任务要求
 * - accuracy: 是否包含明显错误
 * - conciseness: 是否啰嗦冗余
 * - usability: 用户能否直接使用
 *
 * 接入 ThreeBrain.feedback() 闭环，quality score 影响 Thompson Sampling 权重
 */

// ==================== 类型定义 ====================

export interface QualityAssessment {
  score: number;                    // 总分 0-1
  dimensions: {
    completeness: number;           // 完整性 0-1
    accuracy: number;               // 准确性 0-1
    conciseness: number;            // 简洁性 0-1
    usability: number;              // 可用性 0-1
  };
  level: 'excellent' | 'good' | 'acceptable' | 'poor' | 'failed';
  issues: QualityIssue[];
  suggestion?: string;
  /** 是否触发自我反思（score < threshold） */
  shouldReflect: boolean;
  /** 反思 prompt（注入 LLM） */
  reflectionPrompt?: string;
}

export interface QualityIssue {
  dimension: 'completeness' | 'accuracy' | 'conciseness' | 'usability';
  severity: 'high' | 'medium' | 'low';
  description: string;
  penalty: number;                  // 扣分 0-1
}

export interface AssessmentContext {
  userRequest: string;              // 原始请求
  taskType: string;                 // 任务类型
  output: string;                   // 模型输出
  executionSuccess: boolean;        // 执行是否成功
  latencyMs: number;                // 耗时
  toolResults?: string[];           // 工具调用结果
  retryCount?: number;              // 重试次数
}

// ==================== 权重配置 ====================

/** 按任务类型调整的维度权重 */
const TASK_WEIGHTS: Record<string, { completeness: number; accuracy: number; conciseness: number; usability: number }> = {
  tools:     { completeness: 0.4, accuracy: 0.3, usability: 0.2, conciseness: 0.1 },
  reasoning: { accuracy: 0.4, completeness: 0.3, usability: 0.2, conciseness: 0.1 },
  chat:      { conciseness: 0.3, usability: 0.3, completeness: 0.2, accuracy: 0.2 },
  domain:    { accuracy: 0.35, completeness: 0.3, usability: 0.2, conciseness: 0.15 },
  background:{ completeness: 0.3, accuracy: 0.3, usability: 0.2, conciseness: 0.2 },
};

const DEFAULT_WEIGHTS = TASK_WEIGHTS.chat;

// ==================== 错误模式 ====================

/** 明显错误/拒绝模式 */
const ERROR_PATTERNS = [
  /i\s+(cannot|can't|am\s+unable|'m\s+unable)/i,
  /sorry.{0,20}(cannot|can't|unable)/i,
  /作为(一个)?ai.{0,20}(无法|不能|没办法)/i,
  /我(无法|不能|没办法)(完成|处理|回答)/i,
  /\[placeholder\]/i,
  /\[todo\]/i,
  /not\s+implemented/i,
  /coming\s+soon/i,
  /error:\s*function\s+not\s+found/i,
];

/** 幻觉信号 */
const HALLUCINATION_SIGNALS = [
  /(?:according|based)\s+to\s+(?:my|our)\s+(?:training|data|knowledge)/i,
  /(?:截至|截止)(?:我|目前)(?:的)?(?:训练|知识)/,
  /(?:我(?:的)?(?:训练|知识))(?:截止|截至)/,
];

/** 模糊/无用表述 */
const VAGUE_PATTERNS = [
  /^(好的?|ok|sure|当然|没问题)[\s,，。.!！]*$/i,
  /^(以下是|here\s+(?:is|are)|below\s+is)/i,
];

/** 代码任务检测 */
const CODE_TASK_PATTERNS = [
  /代码|code|编写|write|实现|implement|函数|function|类|class|接口|interface/,
  /脚本|script|程序|program|模块|module|组件|component/,
  /fix|bug|修复|调试|debug|重构|refactor/,
];

// ==================== 评估器 ====================

export class OutputQualityAssessor {
  private readonly reflectThreshold: number;

  constructor(options?: { reflectThreshold?: number }) {
    this.reflectThreshold = options?.reflectThreshold ?? 0.5;
  }

  /**
   * 评估输出质量
   */
  assess(ctx: AssessmentContext): QualityAssessment {
    const issues: QualityIssue[] = [];

    // 各维度评估
    const completeness = this.assessCompleteness(ctx, issues);
    const accuracy = this.assessAccuracy(ctx, issues);
    const conciseness = this.assessConciseness(ctx, issues);
    const usability = this.assessUsability(ctx, issues);

    // 空输出直接 failed（不走加权）
    if (completeness === 0) {
      return {
        score: 0,
        dimensions: { completeness: 0, accuracy, conciseness, usability },
        level: 'failed',
        issues,
        suggestion: '输出为空',
        shouldReflect: true,
        reflectionPrompt: this.buildReflectionPrompt(ctx),
      };
    }

    // 加权总分
    const weights = TASK_WEIGHTS[ctx.taskType] ?? DEFAULT_WEIGHTS;
    const score = clamp(
      completeness * weights.completeness +
      accuracy * weights.accuracy +
      conciseness * weights.conciseness +
      usability * weights.usability,
      0, 1,
    );

    // 等级
    const level = score >= 0.85 ? 'excellent'
      : score >= 0.7 ? 'good'
      : score >= 0.5 ? 'acceptable'
      : score >= 0.3 ? 'poor'
      : 'failed';

    // 建议
    const suggestion = this.generateSuggestion(issues, level);

    // 自我反思触发
    const shouldReflect = score < this.reflectThreshold;
    const reflectionPrompt = shouldReflect
      ? this.buildReflectionPrompt(ctx)
      : undefined;

    return {
      score,
      dimensions: { completeness, accuracy, conciseness, usability },
      level,
      issues,
      suggestion,
      shouldReflect,
      reflectionPrompt,
    };
  }

  // ==================== 维度评估 ====================

  /** 完整性评估 */
  private assessCompleteness(ctx: AssessmentContext, issues: QualityIssue[]): number {
    let score = 1.0;

    // 空输出
    if (!ctx.output || ctx.output.trim().length === 0) {
      issues.push({
        dimension: 'completeness', severity: 'high',
        description: '输出为空', penalty: 1.0,
      });
      return 0;
    }

    // 过短输出（相对于请求）
    const requestLen = ctx.userRequest.length;
    const outputLen = ctx.output.length;
    if (requestLen > 30 && outputLen < 20) {
      const penalty = 0.3;
      score -= penalty;
      issues.push({
        dimension: 'completeness', severity: 'medium',
        description: `输出过短（${outputLen} 字符 vs 请求 ${requestLen} 字符）`,
        penalty,
      });
    }

    // 代码任务但无代码块
    const isCodeTask = CODE_TASK_PATTERNS.some(p => p.test(ctx.userRequest));
    if (isCodeTask && !ctx.output.includes('```') && !ctx.output.includes('    ')) {
      const penalty = 0.2;
      score -= penalty;
      issues.push({
        dimension: 'completeness', severity: 'medium',
        description: '代码任务但输出中没有代码块',
        penalty,
      });
    }

    // 工具任务但没有工具结果
    if (ctx.taskType === 'tools' && (!ctx.toolResults || ctx.toolResults.length === 0)) {
      const penalty = 0.2;
      score -= penalty;
      issues.push({
        dimension: 'completeness', severity: 'medium',
        description: '工具任务但没有工具调用结果',
        penalty,
      });
    }

    // 执行失败
    if (!ctx.executionSuccess) {
      const penalty = 0.4;
      score -= penalty;
      issues.push({
        dimension: 'completeness', severity: 'high',
        description: '执行失败',
        penalty,
      });
    }

    return clamp(score, 0, 1);
  }

  /** 准确性评估 */
  private assessAccuracy(ctx: AssessmentContext, issues: QualityIssue[]): number {
    let score = 1.0;

    // 错误模式匹配
    for (const pattern of ERROR_PATTERNS) {
      if (pattern.test(ctx.output)) {
        const penalty = 0.5;
        score -= penalty;
        issues.push({
          dimension: 'accuracy', severity: 'high',
          description: `检测到错误/拒绝模式: ${pattern.source.slice(0, 40)}`,
          penalty,
        });
        break; // 只计一次
      }
    }

    // 幻觉信号
    for (const pattern of HALLUCINATION_SIGNALS) {
      if (pattern.test(ctx.output)) {
        const penalty = 0.15;
        score -= penalty;
        issues.push({
          dimension: 'accuracy', severity: 'low',
          description: '可能存在幻觉信号',
          penalty,
        });
        break;
      }
    }

    // 重试次数暗示质量问题
    if (ctx.retryCount && ctx.retryCount > 0) {
      const penalty = Math.min(0.2, ctx.retryCount * 0.1);
      score -= penalty;
      issues.push({
        dimension: 'accuracy', severity: 'medium',
        description: `经过 ${ctx.retryCount} 次重试`,
        penalty,
      });
    }

    return clamp(score, 0, 1);
  }

  /** 简洁性评估 */
  private assessConciseness(ctx: AssessmentContext, issues: QualityIssue[]): number {
    let score = 1.0;

    const requestLen = ctx.userRequest.length;
    const outputLen = ctx.output.length;

    // 输出/请求比过大
    if (requestLen > 0) {
      const ratio = outputLen / requestLen;
      if (ratio > 20) {
        const penalty = 0.3;
        score -= penalty;
        issues.push({
          dimension: 'conciseness', severity: 'medium',
          description: `输出/请求比过大 (${ratio.toFixed(1)}x)`,
          penalty,
        });
      } else if (ratio > 10) {
        const penalty = 0.15;
        score -= penalty;
        issues.push({
          dimension: 'conciseness', severity: 'low',
          description: `输出/请求比偏大 (${ratio.toFixed(1)}x)`,
          penalty,
        });
      }
    }

    // 内容重复检测（简单：连续相同行）
    const lines = ctx.output.split('\n');
    let duplicateLines = 0;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim().length > 10 && lines[i].trim() === lines[i - 1].trim()) {
        duplicateLines++;
      }
    }
    if (duplicateLines > 2) {
      const penalty = 0.15;
      score -= penalty;
      issues.push({
        dimension: 'conciseness', severity: 'low',
        description: `检测到 ${duplicateLines} 行重复内容`,
        penalty,
      });
    }

    return clamp(score, 0, 1);
  }

  /** 可用性评估 */
  private assessUsability(ctx: AssessmentContext, issues: QualityIssue[]): number {
    let score = 1.0;

    // 模糊/无用开头
    const firstLine = ctx.output.split('\n')[0]?.trim() ?? '';
    for (const pattern of VAGUE_PATTERNS) {
      if (pattern.test(firstLine)) {
        // 不扣分，只是标记
        break;
      }
    }

    // 格式化检查：有结构化内容加分
    const hasList = /^\s*[-*•]\s+/m.test(ctx.output) || /^\s*\d+[.、)]\s+/m.test(ctx.output);
    const hasHeaders = /^#{1,3}\s+/m.test(ctx.output);
    const hasCodeBlock = ctx.output.includes('```');

    if (!hasList && !hasHeaders && !hasCodeBlock && ctx.output.length > 300) {
      const penalty = 0.1;
      score -= penalty;
      issues.push({
        dimension: 'usability', severity: 'low',
        description: '长输出缺乏结构化格式（无列表/标题/代码块）',
        penalty,
      });
    }

    // 模糊表述过多
    const vagueCount = (ctx.output.match(/可能|也许|大概|或许|perhaps|maybe|probably/gi) ?? []).length;
    if (vagueCount > 5) {
      const penalty = 0.1;
      score -= penalty;
      issues.push({
        dimension: 'usability', severity: 'low',
        description: `模糊表述过多 (${vagueCount} 处)`,
        penalty,
      });
    }

    return clamp(score, 0, 1);
  }

  // ==================== 辅助 ====================

  /** 生成改进建议 */
  private generateSuggestion(issues: QualityIssue[], level: QualityAssessment['level']): string | undefined {
    if (level === 'excellent' || level === 'good') return undefined;

    const highIssues = issues.filter(i => i.severity === 'high');
    if (highIssues.length > 0) {
      return `主要问题: ${highIssues.map(i => i.description).join('; ')}`;
    }

    const mediumIssues = issues.filter(i => i.severity === 'medium');
    if (mediumIssues.length > 0) {
      return `可改进: ${mediumIssues.map(i => i.description).join('; ')}`;
    }

    return undefined;
  }

  /** 构建自我反思 prompt */
  private buildReflectionPrompt(ctx: AssessmentContext): string {
    return [
      '以下是用户请求和你的输出，请检查是否有错误或遗漏：',
      '',
      `用户请求: ${ctx.userRequest.slice(0, 500)}`,
      '',
      `你的输出: ${ctx.output.slice(0, 1000)}`,
      '',
      '请检查：',
      '1. 输出是否完整覆盖了用户的需求？',
      '2. 是否有明显错误或不准确之处？',
      '3. 是否有更好的表达方式？',
      '',
      '请简要指出问题并给出改进建议（3 句话以内）。',
    ].join('\n');
  }
}

// ==================== 工具函数 ====================

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
