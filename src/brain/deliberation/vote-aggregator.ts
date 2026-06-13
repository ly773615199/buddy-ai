/**
 * 合议投票 — 加权投票 + 共识达成方式判断
 *
 * 从 DebateEngine 中提取的投票聚合逻辑
 */

import type { DeliberationRole, DebateRound, RoleStatement } from './types.js';

export interface VoteResult {
  action: 'proceed' | 'refine' | 'brainstorm';
  confidence: number;
  reasoning: string;
}

export type ConsensusMethod = 'unanimous' | 'majority' | 'chair_override';

/**
 * 加权投票聚合
 *
 * 用户代言人权重更高（1.5x），风险分析师次之（1.2x）
 * 最终按加权得分最高的选项获胜
 */
export function aggregateVotes(rounds: DebateRound[], roles: DeliberationRole[]): VoteResult {
  const lastRound = rounds[rounds.length - 1];
  const scores: Record<string, number> = { proceed: 0, refine: 0, brainstorm: 0 };

  for (const stmt of lastRound.statements) {
    const role = roles.find(r => r.id === stmt.roleId);
    const weight = role?.weight ?? 1.0;
    scores[stmt.vote] += stmt.confidence * weight;
  }

  const total = scores.proceed + scores.refine + scores.brainstorm;
  const winner = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
  const confidence = total > 0 ? scores[winner] / total : 0;

  const reasoning = lastRound.statements
    .filter(s => s.vote === winner)
    .map(s => `${s.roleName}: ${s.reasoning}`)
    .join('; ');

  return { action: winner as VoteResult['action'], confidence, reasoning };
}

/**
 * 计算单轮共识度
 */
export function calcConsensus(statements: RoleStatement[]): number {
  if (statements.length <= 1) return 1;
  const votes = statements.map(s => s.vote);
  const counts = new Map<string, number>();
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);
  const maxCount = Math.max(...counts.values());
  return maxCount / votes.length;
}

/**
 * 判断共识达成方式
 */
export function getConsensusMethod(rounds: DebateRound[]): ConsensusMethod {
  const last = rounds[rounds.length - 1];
  if (last.consensus >= 1.0) return 'unanimous';
  if (last.consensus >= 0.67) return 'majority';
  return 'chair_override';
}

/**
 * 找出未解决的分歧
 */
export function findDisagreements(rounds: DebateRound[]): string[] {
  const last = rounds[rounds.length - 1];
  const majorityVote = last.statements[0]?.vote;
  return last.statements
    .filter(s => s.vote !== majorityVote)
    .map(s => `${s.roleName}: ${s.position}`);
}
