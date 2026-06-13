/**
 * Prompt 自进化 — 改写自己的说明书
 *
 * 来源: Gödel Agent — "dynamically modify its own logic and behavior through prompting"
 *
 * 核心思想: 影子脑可以优化自己的 prompt 模板。
 * 如果 prompt 写得不好，进化方案的质量会持续偏低。
 */

import type { EvolutionLogEntry } from '../types.js';

// ── 类型定义 ──

export interface PromptTemplate {
  id: string;
  name: string;
  /** prompt 模板内容 */
  template: string;
  /** 适用场景 */
  scope: 'rule_generation' | 'param_expansion' | 'struct_change' | 'gap_analysis';
  // 效果统计
  avgProposalQuality: number;
  acceptanceRate: number;
  usageCount: number;
  successCount: number;
  createdAt: number;
  lastUpdated: number;
}

export interface PromptAnalysis {
  templateId: string;
  avgQuality: number;
  acceptanceRate: number;
  topFailureReasons: string[];
  sampleCount: number;
}

export interface PromptEvolverConfig {
  /** 最大模板数 */
  maxTemplates: number;
  /** 最少使用次数才评估 */
  minUsageForEvaluation: number;
  /** 接受率低于此阈值 → 需要优化 */
  acceptanceThreshold: number;
  /** LLM 调用器 */
  llm?: { call: (prompt: string) => Promise<string> };
}

const DEFAULT_CONFIG: PromptEvolverConfig = {
  maxTemplates: 20,
  minUsageForEvaluation: 5,
  acceptanceThreshold: 0.3,
};

// ── 默认 prompt 模板 ──

const DEFAULT_TEMPLATES: Omit<PromptTemplate, 'usageCount' | 'successCount' | 'createdAt' | 'lastUpdated' | 'avgProposalQuality' | 'acceptanceRate'>[] = [
  {
    id: 'rule-gen-v1',
    name: '规则生成 v1',
    scope: 'rule_generation',
    template: `你是一个 AI Agent 的规则生成器。

能力缺口:
- 描述: {{gapDescription}}
- 连续失败: {{failureCount}} 次
- 平均置信度: {{avgConfidence}}

已有规则（避免重复）:
{{existingRules}}

请生成一条新的决策规则来填补这个缺口。
输出 JSON:
{
  "name": "规则名称",
  "condition": "触发条件描述",
  "action": "执行动作描述",
  "priority": 1-10,
  "reasoning": "为什么这条规则能解决缺口"
}`,
  },
  {
    id: 'param-exp-v1',
    name: '参数扩展 v1',
    scope: 'param_expansion',
    template: `你是一个 AI 系统的参数分析师。

当前意图类别数: {{currentIntents}}
未分类样本数: {{uncategorizedCount}}
未分类样本特征:
{{sampleFeatures}}

请分析这些未分类样本，识别新的意图类别。
输出 JSON:
{
  "newIntents": [
    {"label": "类别名", "description": "描述", "estimatedSamples": 数量}
  ]
}`,
  },
  {
    id: 'struct-change-v1',
    name: '结构变更 v1',
    scope: 'struct_change',
    template: `你是一个神经网络架构师。

当前模型配置:
{{nnConfig}}

能力缺口: {{gapDescription}}
连续失败: {{failureCount}} 次

请建议最小化的结构变更来填补缺口。
输出 JSON:
{
  "changes": [
    {"param": "参数名", "from": 当前值, "to": 建议值, "reason": "原因"}
  ],
  "risk": "low|medium|high"
}`,
  },
];

// ── PromptEvolver 核心 ──

export class PromptEvolver {
  private templates: Map<string, PromptTemplate> = new Map();
  private config: PromptEvolverConfig;

  constructor(config?: Partial<PromptEvolverConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadDefaults();
  }

  /**
   * 获取指定用途的最优 prompt 模板
   */
  getBest(scope: PromptTemplate['scope']): PromptTemplate | undefined {
    const candidates = [...this.templates.values()]
      .filter(t => t.scope === scope && t.usageCount >= this.config.minUsageForEvaluation);

    if (candidates.length === 0) {
      // 返回默认模板
      return [...this.templates.values()].find(t => t.scope === scope);
    }

    // 按接受率排序
    return candidates.sort((a, b) => b.acceptanceRate - a.acceptanceRate)[0];
  }

  /**
   * 获取指定模板
   */
  getTemplate(id: string): PromptTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * 获取所有模板
   */
  getAllTemplates(): PromptTemplate[] {
    return [...this.templates.values()];
  }

  /**
   * 记录模板使用效果
   */
  recordUsage(templateId: string, accepted: boolean, quality: number): void {
    const template = this.templates.get(templateId);
    if (!template) return;

    template.usageCount++;
    if (accepted) template.successCount++;

    // 滑动平均更新接受率和质量
    template.acceptanceRate = template.successCount / template.usageCount;
    template.avgProposalQuality = template.avgProposalQuality * 0.9 + quality * 0.1;
  }

  /**
   * 分析模板效果
   */
  analyze(history: EvolutionLogEntry[]): PromptAnalysis[] {
    const analyses: PromptAnalysis[] = [];

    for (const template of this.templates.values()) {
      if (template.usageCount < this.config.minUsageForEvaluation) continue;

      // 从历史中找出使用该模板的记录
      const relevant = history.filter(e =>
        e.proposal.description?.includes(template.id) || // 简化匹配
        template.usageCount > 0
      );

      const rejected = relevant.filter(e => e.result === 'rejected');
      const failureReasons = rejected.flatMap(e =>
        e.validation.locks.filter(l => !l.passed).map(l => l.lockName)
      );

      // 统计失败原因频率
      const reasonFreq: Record<string, number> = {};
      for (const r of failureReasons) {
        reasonFreq[r] = (reasonFreq[r] ?? 0) + 1;
      }
      const topReasons = Object.entries(reasonFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([r]) => r);

      analyses.push({
        templateId: template.id,
        avgQuality: template.avgProposalQuality,
        acceptanceRate: template.acceptanceRate,
        topFailureReasons: topReasons,
        sampleCount: relevant.length,
      });
    }

    return analyses;
  }

  /**
   * 生成 prompt 改进方案
   *
   * 基于效果分析，用 LLM 改进 prompt 模板
   */
  async improve(templateId: string, analysis: PromptAnalysis): Promise<PromptTemplate | null> {
    const template = this.templates.get(templateId);
    if (!template || !this.config.llm) return null;

    const prompt = `
你是一个 prompt 优化专家。

当前 prompt:
${template.template}

效果分析:
- 方案平均质量: ${analysis.avgQuality.toFixed(2)}
- 通过率: ${(analysis.acceptanceRate * 100).toFixed(0)}%
- 主要失败原因: ${analysis.topFailureReasons.join(', ')}

请改进这个 prompt，使其生成更高质量的进化方案。
保留核心指令，优化上下文提供方式和约束条件。
只输出改进后的 prompt 文本，不要解释。`;

    try {
      const improved = await this.config.llm.call(prompt);

      const newTemplate: PromptTemplate = {
        id: `${template.id}-v${Date.now()}`,
        name: `${template.name} (优化版)`,
        template: improved.trim(),
        scope: template.scope,
        avgProposalQuality: 0,
        acceptanceRate: 0,
        usageCount: 0,
        successCount: 0,
        createdAt: Date.now(),
        lastUpdated: Date.now(),
      };

      this.addTemplate(newTemplate);
      return newTemplate;
    } catch {
      return null;
    }
  }

  /**
   * 添加模板
   */
  addTemplate(template: PromptTemplate): void {
    if (this.templates.size >= this.config.maxTemplates) {
      // 淘汰效果最差的
      const worst = [...this.templates.values()]
        .filter(t => t.usageCount > 0)
        .sort((a, b) => a.acceptanceRate - b.acceptanceRate)[0];
      if (worst) this.templates.delete(worst.id);
    }
    this.templates.set(template.id, template);
  }

  /**
   * 渲染模板 — 替换变量
   */
  render(templateId: string, vars: Record<string, string | number>): string {
    const template = this.templates.get(templateId);
    if (!template) return '';

    let rendered = template.template;
    for (const [key, value] of Object.entries(vars)) {
      rendered = rendered.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
    }
    return rendered;
  }

  /**
   * 获取摘要
   */
  getSummary(): {
    totalTemplates: number;
    byScope: Record<string, number>;
    bestTemplates: Array<{ template: PromptTemplate; score: number }>;
    needsImprovement: PromptTemplate[];
  } {
    const all = [...this.templates.values()];
    const byScope: Record<string, number> = {};
    for (const t of all) {
      byScope[t.scope] = (byScope[t.scope] ?? 0) + 1;
    }

    const best = all
      .filter(t => t.usageCount >= this.config.minUsageForEvaluation)
      .map(t => ({
        template: t,
        score: t.acceptanceRate * 0.6 + t.avgProposalQuality * 0.4,
      }))
      .sort((a, b) => b.score - a.score);

    const needsImprovement = all.filter(t =>
      t.usageCount >= this.config.minUsageForEvaluation &&
      t.acceptanceRate < this.config.acceptanceThreshold
    );

    return {
      totalTemplates: all.length,
      byScope,
      bestTemplates: best.slice(0, 5),
      needsImprovement,
    };
  }

  // ── 内部方法 ──

  private loadDefaults(): void {
    for (const template of DEFAULT_TEMPLATES) {
      this.templates.set(template.id, {
        ...template,
        avgProposalQuality: 0,
        acceptanceRate: 0,
        usageCount: 0,
        successCount: 0,
        createdAt: Date.now(),
        lastUpdated: Date.now(),
      });
    }
  }
}
