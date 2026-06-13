/**
 * 辩论引擎 — 多角色多轮辩论审议
 *
 * 两种模式：
 * - 澄清模式: 角色讨论"缺什么信息"，输出精确追问
 * - 头脑风暴模式: 角色各自提出方案，讨论权衡，生成选项
 *
 * 关键设计：
 * - 每轮辩论中，角色可以看到其他角色的观点并回应
 * - 共识度 ≥ 0.8 提前退出（最多 3 轮）
 * - 并行调用 LLM（所有角色同时发言）
 */

import type {
  Topic, DeliberationRole, ResearchResult,
  DebateRound, RoleStatement, DebateResult, Proposal,
} from './types.js';
import { aggregateVotes, calcConsensus, getConsensusMethod, findDisagreements } from './vote-aggregator.js';

export class DebateEngine {
  private llmCall: ((messages: Array<{ role: string; content: string }>) => Promise<string>) | null = null;
  private verbose: boolean;

  constructor(verbose = false) {
    this.verbose = verbose;
  }

  setLLMCaller(caller: (messages: Array<{ role: string; content: string }>) => Promise<string>): void {
    this.llmCall = caller;
  }

  async debate(
    topic: Topic,
    research: ResearchResult,
    roles: DeliberationRole[],
  ): Promise<DebateResult> {
    const rounds: DebateRound[] = [];
    const allProposals: Proposal[] = [];
    const maxRounds = topic.mode === 'brainstorm' ? 3 : 2;
    let previousStatements: RoleStatement[] = [];

    for (let round = 0; round < maxRounds; round++) {
      // 并行让所有角色发言
      const statements = await Promise.all(
        roles.map(role => this.getStatement(role, topic, research, previousStatements, round))
      );

      const consensus = calcConsensus(statements);
      rounds.push({ round, statements, consensus });

      // 头脑风暴模式：提取本轮产生的方案提案
      if (topic.mode === 'brainstorm') {
        const roundProposals = this.extractProposals(statements, round);
        allProposals.push(...roundProposals);
      }

      if (this.verbose) {
        console.log(`[DebateEngine] 第 ${round + 1} 轮: 共识度=${consensus.toFixed(2)}, 投票=${statements.map(s => s.vote).join('/')}`);
      }

      if (consensus >= 0.8) break;
      previousStatements = statements;
    }

    const finalVote = aggregateVotes(rounds, roles);

    // 头脑风暴模式：方案评分
    if (topic.mode === 'brainstorm' && allProposals.length > 0) {
      this.scoreProposals(allProposals, roles);
      allProposals.sort((a, b) => b.score - a.score);
    }

    return {
      rounds,
      finalVote,
      consensusMethod: getConsensusMethod(rounds),
      unresolvedDisagreements: findDisagreements(rounds),
      proposals: allProposals,
    };
  }

  private async getStatement(
    role: DeliberationRole,
    topic: Topic,
    research: ResearchResult,
    previousRounds: RoleStatement[],
    round: number,
  ): Promise<RoleStatement> {
    if (!this.llmCall) {
      return {
        roleId: role.id,
        roleName: role.name,
        position: '信息不足，无法判断',
        responses: [],
        vote: 'refine',
        confidence: 0.3,
        reasoning: '无 LLM 调用能力',
      };
    }

    const contextParts = [
      `## 议题\n${topic.coreQuestion}`,
      `## 审议模式: ${topic.mode === 'brainstorm' ? '头脑风暴' : '澄清追问'}`,
      topic.subQuestions.length > 0
        ? `\n## 需要确认的子问题\n${topic.subQuestions.map(q => {
            const opts = q.options?.length
              ? `\n  候选方案: ${q.options.map(o => `\n    - ${o.label}: ${o.description} (优: ${o.pros.join(',')} 劣: ${o.cons.join(',')})`).join('')}`
              : '';
            return `- ${q.question} (${q.required ? '必要' : '可选'})${opts}`;
          }).join('\n')}`
        : '',
      topic.missingInfo.length > 0
        ? `\n## 缺失信息\n${topic.missingInfo.join(', ')}`
        : '',
      research.fileContext
        ? `\n## 相关文件\n${research.fileContext.slice(0, 1000)}`
        : '',
      research.experience
        ? `\n## 历史经验\n${research.experience.slice(0, 500)}`
        : '',
      previousRounds.length > 0
        ? `\n## 其他角色上一轮观点\n${previousRounds.map(s => `**${s.roleName}**: ${s.position} [投票: ${s.vote}]`).join('\n')}`
        : '',
    ].filter(Boolean).join('\n');

    const brainstormHint = topic.mode === 'brainstorm' ? `
你的角色是方案提案者。请针对这个议题，提出你认为可行的方案。
每个方案要有：标题、描述、优势、劣势。
你也可以对其他角色的方案发表评价（支持/中立/反对 + 理由）。` : '';

    const prompt = `${role.prompt}
${brainstormHint}

${contextParts}

---

这是第 ${round + 1} 轮审议。

请以 JSON 格式回复:
{
  "position": "你的核心观点（一句话）",
  "responses": ["对其他角色观点的回应"],
  "vote": "proceed|refine|brainstorm",
  "confidence": 0.0-1.0,
  "reasoning": "你的推理过程"${topic.mode === 'brainstorm' ? `,
  "proposals": [
    {
      "title": "方案标题",
      "description": "方案描述",
      "pros": ["优势1", "优势2"],
      "cons": ["劣势1"]
    }
  ]` : ''}
}

注意：
- proceed = 信息充足，可以执行
- refine = 信息不足，需要追问用户
- brainstorm = 方向不确定，需要生成方案让用户选择`;

    try {
      const response = await this.llmCall([{ role: 'user', content: prompt }]);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      const parsed = JSON.parse(jsonMatch[0]);

      const stmt: RoleStatement = {
        roleId: role.id,
        roleName: role.name,
        position: parsed.position ?? '无观点',
        responses: parsed.responses ?? [],
        vote: parsed.vote ?? 'refine',
        confidence: parsed.confidence ?? 0.5,
        reasoning: parsed.reasoning ?? '',
      };

      // 头脑风暴模式：附加 proposals（通过类型断言）
      if (topic.mode === 'brainstorm' && parsed.proposals) {
        (stmt as any).proposals = parsed.proposals;
      }

      return stmt;
    } catch (err) {
      return {
        roleId: role.id,
        roleName: role.name,
        position: '解析失败',
        responses: [],
        vote: 'refine',
        confidence: 0.2,
        reasoning: `LLM 响应解析失败: ${(err as Error).message}`,
      };
    }
  }

  /**
   * 从角色发言中提取方案提案
   */
  private extractProposals(statements: RoleStatement[], round: number): Proposal[] {
    const proposals: Proposal[] = [];

    for (const stmt of statements) {
      const stmtProposals = (stmt as any).proposals ?? [];
      for (const p of stmtProposals) {
        proposals.push({
          id: `prop-${round}-${proposals.length}`,
          title: p.title ?? '未命名方案',
          description: p.description ?? '',
          proposedBy: stmt.roleId,
          pros: p.pros ?? [],
          cons: p.cons ?? [],
          support: [],
          score: 0,
        });
      }
    }

    return proposals;
  }

  /**
   * 为方案评分 — 基于优势/劣势数量和提出者权重
   */
  private scoreProposals(proposals: Proposal[], roles: DeliberationRole[]): void {
    for (const proposal of proposals) {
      const proposerRole = roles.find(r => r.id === proposal.proposedBy);
      let score = (proposerRole?.weight ?? 1.0) * 0.3;

      for (const support of proposal.support) {
        const role = roles.find(r => r.id === support.roleId);
        const weight = role?.weight ?? 1.0;
        if (support.stance === 'support') score += 0.3 * weight;
        else if (support.stance === 'oppose') score -= 0.2 * weight;
      }

      score += (proposal.pros.length - proposal.cons.length) * 0.05;
      proposal.score = Math.max(0, Math.min(1, score));
    }
  }
}
