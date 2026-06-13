/**
 * 审议委员会 — 模块导出
 */

export { DeliberationCouncil, type DeliberationCouncilConfig } from './council.js';
export { TopicAnalyzer } from './topic-analyzer.js';
export { RoleAssigner } from './role-assigner.js';
export { ResearchGatherer } from './research-gatherer.js';
export { DebateEngine } from './debate-engine.js';
export { RiskValidator } from './risk-validator.js';
export { aggregateVotes, calcConsensus, getConsensusMethod, findDisagreements, type VoteResult, type ConsensusMethod } from './vote-aggregator.js';
export { DeliberationArchiveStore } from './archive.js';
export type {
  Topic, SubQuestion,
  DeliberationRole,
  DebateRound, RoleStatement, DebateResult, Proposal,
  ResearchResult,
  RiskAssessment,
  DeliberationArchive,
  DeliberationResult, ExecutionBreakdown,
} from './types.js';
