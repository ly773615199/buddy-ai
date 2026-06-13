/**
 * 审议委员会主控 — 串联全流程
 *
 * 信号流：
 * 用户输入 → 定议题 → 分角色 → 查资料 → 多轮辩论 → 风险校验 → 合议投票 → 存档
 *
 * 输出决策：
 * - proceed   → 直接执行（信息充足）
 * - refine    → 追问缺失参数（澄清模式输出）
 * - brainstorm → 呈现方案选项让用户选择（头脑风暴模式输出）
 */

import { TopicAnalyzer } from './topic-analyzer.js';
import { RoleAssigner } from './role-assigner.js';
import { ResearchGatherer } from './research-gatherer.js';
import { DebateEngine } from './debate-engine.js';
import { RiskValidator } from './risk-validator.js';
import { DeliberationArchiveStore } from './archive.js';
import type { DeliberationResult, DeliberationArchive, Proposal } from './types.js';
import type { BodyState, IntuitionSignal } from '../types.js';

export interface DeliberationCouncilConfig {
  verbose?: boolean;
  /** LLM 调用器（可选，不提供则退化为纯启发式） */
  llmCall?: (messages: Array<{ role: string; content: string }>) => Promise<string>;
  /** 文件读取器 */
  readFile?: (path: string) => Promise<string>;
  /** 目录列表器 */
  listDir?: (path: string) => Promise<string[]>;
  /** 经验提供器 */
  getExperience?: (input: string) => string | null;
}

export class DeliberationCouncil {
  private topicAnalyzer: TopicAnalyzer;
  private roleAssigner: RoleAssigner;
  private researchGatherer: ResearchGatherer;
  private debateEngine: DebateEngine;
  private riskValidator: RiskValidator;
  private archiveStore: DeliberationArchiveStore;
  private verbose: boolean;

  constructor(config?: DeliberationCouncilConfig) {
    this.verbose = config?.verbose ?? false;
    this.topicAnalyzer = new TopicAnalyzer();
    this.roleAssigner = new RoleAssigner();
    this.researchGatherer = new ResearchGatherer();
    this.debateEngine = new DebateEngine(this.verbose);
    this.riskValidator = new RiskValidator();
    this.archiveStore = new DeliberationArchiveStore();

    // 注入可选依赖
    if (config?.llmCall) {
      this.topicAnalyzer.setLLMCaller(config.llmCall);
      this.debateEngine.setLLMCaller(config.llmCall);
    }
    if (config?.readFile && config?.listDir) {
      this.researchGatherer.setFileOps(config.readFile, config.listDir);
    }
    if (config?.getExperience) {
      this.researchGatherer.setExperienceProvider(config.getExperience);
    }
  }

  /**
   * 审议主流程
   */
  async deliberate(
    input: string,
    domains: string[],
    bodyState: BodyState,
    intuition?: IntuitionSignal,
  ): Promise<DeliberationResult> {
    const t0 = performance.now();

    // Step 1: 定议题 + 模式判断
    const topic = await this.topicAnalyzer.analyze(input);

    // 快速通道：模糊度低 → 直接放行
    if (topic.readyToExecute && topic.ambiguityScore < 0.3) {
      return {
        action: 'proceed',
        confidence: 0.9,
        reasoning: '议题清晰，无需审议',
        topic,
        risk: { level: 'low', risks: [], canProceed: true, userConfirmations: [] },
        archiveId: 'fast-path',
        durationMs: performance.now() - t0,
      };
    }

    if (this.verbose) {
      console.log(`[DeliberationCouncil] 议题模糊度=${topic.ambiguityScore.toFixed(2)}, 模式=${topic.mode}, 子议题=${topic.subQuestions.length}`);
    }

    // Step 2: 分角色
    const roles = this.roleAssigner.selectRoles(topic, domains);

    // Step 3: 自动查资料
    const research = await this.researchGatherer.gather(topic, input, bodyState, intuition);

    // Step 4: 多轮辩论审议
    const debate = await this.debateEngine.debate(topic, research, roles);

    // Step 5: 风险校验
    const risk = this.riskValidator.validate(topic, debate);

    // Step 6: 合议投票（已在 debate 中完成）
    const decision = debate.finalVote;

    // Step 7: 全程存档
    const archiveId = `delib-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const durationMs = performance.now() - t0;

    const archive: DeliberationArchive = {
      id: archiveId,
      timestamp: Date.now(),
      input,
      topic,
      roles,
      research,
      debate,
      risk,
      decision,
      durationMs,
    };
    this.archiveStore.save(archive);

    if (this.verbose) {
      console.log(`[DeliberationCouncil] 决策: ${decision.action} (conf=${decision.confidence.toFixed(2)}), 风险=${risk.level}, 耗时=${durationMs.toFixed(0)}ms`);
    }

    return {
      action: decision.action,
      confidence: decision.confidence,
      reasoning: decision.reasoning,
      topic,
      risk,
      archiveId,
      durationMs,
      clarificationQuestion: decision.action === 'refine'
        ? this.buildClarification(topic)
        : undefined,
      proposals: decision.action === 'brainstorm'
        ? debate.proposals
        : undefined,
      executionBreakdown: decision.action === 'proceed'
        ? { steps: [{ id: 'step-1', description: topic.coreQuestion, tool: 'auto', dependencies: [] }], estimatedDuration: '待评估' }
        : undefined,
    };
  }

  /** 获取存档 */
  getArchive(id: string): DeliberationArchive | undefined {
    return this.archiveStore.get(id);
  }

  /** 获取所有存档 */
  getArchives(): DeliberationArchive[] {
    return this.archiveStore.getAll();
  }

  /**
   * 构建追问问题（澄清模式）
   */
  private buildClarification(topic: { subQuestions: Array<{ required: boolean; question: string }>; missingInfo: string[] }): string {
    const questions = topic.subQuestions
      .filter(q => q.required)
      .map(q => `• ${q.question}`);

    if (questions.length > 0) {
      return `我需要更多信息来处理这个请求：\n${questions.join('\n')}`;
    }

    return `我不太确定你的具体意图。能补充一下细节吗？\n${topic.missingInfo.join('、')}`;
  }

  /**
   * 构建方案呈现（头脑风暴模式）
   */
  static buildProposalsPresentation(proposals: Proposal[]): string {
    if (proposals.length === 0) return '';

    const cards = proposals.slice(0, 3).map((p, i) => {
      const prosStr = p.pros.length > 0 ? `✅ ${p.pros.join('、')}` : '';
      const consStr = p.cons.length > 0 ? `⚠️ ${p.cons.join('、')}` : '';
      return [
        `**${String.fromCharCode(65 + i)}. ${p.title}**`,
        p.description,
        prosStr,
        consStr,
      ].filter(Boolean).join('\n');
    });

    return `关于这个问题，我有几个想法：\n\n${cards.join('\n\n')}\n\n你觉得哪个方向更符合你的想法？或者你有其他思路？`;
  }
}
