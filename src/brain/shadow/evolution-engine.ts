/**
 * 进化引擎 — 用 LLM 生成候选进化方案
 *
 * L1 规则生成：从缺口描述 + 失败原因 → 新规则
 * L2 参数扩展：从聚类分析 → 新意图/新工具
 * L3 结构变更：从能力需求 → NN 结构修改
 */

import type { Rule, TaskSignal, ResourceState, ExecutionPlan } from '../types.js';
import type {
  CapabilityGap, EvolutionProposal, ProposalChange,
  EvolutionContext, EvolutionLevel,
} from './types.js';
import type { LearningStrategy } from './phase10/meta-learner.js';

interface LLMCaller {
  call(prompt: string): Promise<string>;
}

export class EvolutionEngine {
  private llm: LLMCaller;
  private proposalHistory: EvolutionProposal[] = [];

  constructor(llm: LLMCaller) {
    this.llm = llm;
  }

  /**
   * 从能力缺口生成进化候选方案
   *
   * 根据缺口级别选择 L1/L2/L3：
   * - L1: 规则生成（最常见，最低风险）
   * - L2: 参数扩展（中等风险，failureCount >= 5）
   * - L3: 结构变更（高风险，critical + failureCount >= 10）
   *
   * strategy: MetaLearner 推荐的学习策略，影响方案生成方式
   */
  async generateProposals(gap: CapabilityGap, context: EvolutionContext, strategy?: LearningStrategy): Promise<EvolutionProposal[]> {
    const proposals: EvolutionProposal[] = [];

    // 根据策略调整生成参数
    const samplingHint = strategy ? this.getSamplingHint(strategy) : '';

    // L1: 规则生成
    if (gap.priority !== 'critical') {
      const ruleProposal = await this.generateRuleProposal(gap, context, samplingHint);
      if (ruleProposal) proposals.push(ruleProposal);
    }

    // L2: 参数扩展（策略的 batchSize 影响阈值判定）
    const l2Threshold = strategy ? Math.max(3, 5 - Math.floor(strategy.batchSize / 8)) : 5;
    if (gap.failureCount >= l2Threshold) {
      const paramProposal = await this.generateParamProposal(gap, context, samplingHint);
      if (paramProposal) proposals.push(paramProposal);
    }

    // L3: 结构变更
    if (gap.priority === 'critical' && gap.failureCount >= 10) {
      const structProposal = await this.generateStructProposal(gap, context, samplingHint);
      if (structProposal) proposals.push(structProposal);
    }

    this.proposalHistory.push(...proposals);
    return proposals;
  }

  /**
   * 从学习策略中提取采样提示，注入 LLM prompt
   */
  private getSamplingHint(strategy: LearningStrategy): string {
    const hints: string[] = [];
    if (strategy.samplingMethod === 'curriculum') hints.push('按难度递进生成规则，优先覆盖简单场景');
    if (strategy.samplingMethod === 'contextual') hints.push('考虑上下文相关性，生成条件更精确的规则');
    if (strategy.samplingMethod === 're-attentive') hints.push('关注被遗忘的知识，生成强化记忆的规则');
    if (strategy.lrSchedule === 'adaptive') hints.push('根据反馈动态调整规则优先级');
    if (strategy.lrSchedule === 'cosine') hints.push('规则优先级按周期性节奏调整');
    return hints.length > 0 ? `\n学习策略提示（${strategy.name}）: ${hints.join('; ')}` : '';
  }

  /**
   * 获取方案历史
   */
  getHistory(): EvolutionProposal[] {
    return [...this.proposalHistory];
  }

  /**
   * L1: 生成新规则候选
   */
  private async generateRuleProposal(gap: CapabilityGap, ctx: EvolutionContext, samplingHint?: string): Promise<EvolutionProposal | null> {
    const prompt = `你是一个 AI Agent 的规则生成器。

能力缺口:
- 描述: ${gap.description}
- 连续失败: ${gap.failureCount} 次
- 平均置信度: ${gap.avgConfidence.toFixed(2)}
- 最近失败: ${gap.failures.slice(-5).map(f => f.error).join('; ')}

已有规则（避免重复）:
${ctx.existingRules.map(r => `- ${r.name}: priority=${r.priority}`).join('\n')}
${samplingHint}

请生成一条新的决策规则来填补这个缺口。

输出 JSON:
{
  "name": "规则名称",
  "condition": "触发条件描述",
  "action": "执行动作描述",
  "priority": 1-10,
  "reasoning": "为什么这条规则能解决缺口"
}`;

    try {
      const response = await this.llm.call(prompt);
      const rule = JSON.parse(this.extractJSON(response));

      return {
        id: `proposal-${Date.now()}-rule`,
        level: 'L1',
        type: 'new_rule',
        description: `新规则: ${rule.name}`,
        gap,
        changes: [{
          target: 'left',
          action: 'add',
          details: {
            name: rule.name,
            condition: rule.condition,
            action: rule.action,
            priority: Math.max(1, Math.min(10, rule.priority ?? 5)),
            source: 'evolved',
          },
        }],
        expectedImpact: rule.reasoning ?? '填补能力缺口',
        createdAt: Date.now(),
      };
    } catch {
      return null;
    }
  }

  /**
   * L2: 生成参数扩展方案
   */
  private async generateParamProposal(gap: CapabilityGap, ctx: EvolutionContext, samplingHint?: string): Promise<EvolutionProposal | null> {
    const uncategorized = ctx.samples.filter(s => s.labelIntent >= ctx.currentIntentCount);
    if (uncategorized.length < 20) return null;

    const prompt = `你是一个 AI Agent 的意图分类专家。

当前有 ${ctx.currentIntentCount} 个意图类别。
有 ${uncategorized.length} 个未分类样本。

能力缺口: ${gap.description}
连续失败: ${gap.failureCount} 次
${samplingHint}

请分析未分类样本的模式，建议新的意图类别。

输出 JSON:
{
  "newIntents": [
    {"label": "类别名", "description": "类别描述", "estimatedSamples": 估计样本数}
  ],
  "reasoning": "为什么需要这些新类别"
}`;

    try {
      const response = await this.llm.call(prompt);
      const result = JSON.parse(this.extractJSON(response));

      if (!result.newIntents || result.newIntents.length === 0) return null;

      return {
        id: `proposal-${Date.now()}-param`,
        level: 'L2',
        type: 'new_intent',
        description: `新增 ${result.newIntents.length} 个意图类别`,
        gap,
        changes: [{
          target: 'right',
          action: 'expand',
          details: {
            newIntents: result.newIntents,
            expandFrom: ctx.currentIntentCount,
            expandTo: ctx.currentIntentCount + result.newIntents.length,
          },
        }],
        expectedImpact: result.reasoning ?? `覆盖 ${uncategorized.length} 个未分类样本`,
        createdAt: Date.now(),
      };
    } catch {
      return null;
    }
  }

  /**
   * L3: 生成 NN 结构变更方案
   */
  private async generateStructProposal(gap: CapabilityGap, ctx: EvolutionContext, samplingHint?: string): Promise<EvolutionProposal | null> {
    const prompt = `你是一个神经网络架构师。

当前模型配置:
- vocabSize: ${ctx.nnConfig.vocabSize}
- embedDim: ${ctx.nnConfig.embedDim}
- hiddenDim: ${ctx.nnConfig.hiddenDim}
- numLayers: ${ctx.nnConfig.numLayers}
- 输出头: intent(${ctx.nnConfig.numIntents}), tool(${ctx.nnConfig.numTools})

能力缺口: ${gap.description}
连续失败: ${gap.failureCount} 次
${samplingHint}

请建议最小化的结构变更来填补缺口。只输出必要的修改。

输出 JSON:
{
  "changes": [
    {"param": "参数名", "from": 当前值, "to": 建议值, "reason": "原因"}
  ],
  "newHeads": [
    {"name": "头名称", "outputDim": 维度, "reason": "原因"}
  ],
  "risk": "low|medium|high"
}`;

    try {
      const response = await this.llm.call(prompt);
      const result = JSON.parse(this.extractJSON(response));

      return {
        id: `proposal-${Date.now()}-struct`,
        level: 'L3',
        type: 'nn_expand',
        description: `NN 结构变更: ${(result.changes ?? []).map((c: any) => `${c.param} ${c.from}→${c.to}`).join(', ')}`,
        gap,
        changes: [{
          target: 'right',
          action: 'modify',
          details: result,
        }],
        expectedImpact: (result.changes ?? []).map((c: any) => c.reason).join('; ') ?? '扩展 NN 能力',
        createdAt: Date.now(),
      };
    } catch {
      return null;
    }
  }

  /**
   * 从 LLM 响应中提取 JSON
   */
  private extractJSON(text: string): string {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? match[0] : text;
  }
}
