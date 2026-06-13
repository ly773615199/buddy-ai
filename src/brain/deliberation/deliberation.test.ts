/**
 * 审议委员会测试
 */

import { describe, it, expect, vi } from 'vitest';
import { TopicAnalyzer } from './topic-analyzer.js';
import { RoleAssigner } from './role-assigner.js';
import { DebateEngine } from './debate-engine.js';
import { RiskValidator } from './risk-validator.js';
import { DeliberationCouncil } from './council.js';
import type { BodyState } from '../types.js';

const mockBodyState: BodyState = {
  energy: 80, temperature: 50, load: 30, hunger: 20,
  emotion: { joy: 5, sadness: 0, anger: 0, fear: 0, surprise: 0, disgust: 0, trust: 5, anticipation: 3 },
  desires: { hunger: 10, curiosity: 50, social: 20, safety: 30, expression: 40, rest: 10 },
  focusLevel: 70, confidenceLevel: 60, confusionLevel: 20,
  intimacyLevel: 30, socialNeed: 20,
  hour: 14, isUserActive: true, lastInteractionMs: Date.now(), systemHealth: 'good',
};

describe('TopicAnalyzer', () => {
  it('should return readyToExecute for clear input', async () => {
    const analyzer = new TopicAnalyzer();
    const topic = await analyzer.analyze('读取 src/index.ts');
    expect(topic.readyToExecute).toBe(true);
    expect(topic.ambiguityScore).toBeLessThan(0.3);
  });

  it('should detect ambiguity for vague input', async () => {
    const analyzer = new TopicAnalyzer();
    const topic = await analyzer.analyze('帮我优化一下');
    expect(topic.ambiguityScore).toBeGreaterThan(0);
    // 模式可以是 clarify 或 brainstorm，取决于 ClarificationEngine 的 issueType
    expect(['clarify', 'brainstorm']).toContain(topic.mode);
  });

  it('should detect conflict', async () => {
    const analyzer = new TopicAnalyzer();
    const topic = await analyzer.analyze('简化代码同时增加更多功能');
    expect(topic.subQuestions.some(q => q.source === 'conflict')).toBe(true);
  });

  it('should use LLM for deep analysis when available', async () => {
    const analyzer = new TopicAnalyzer();
    const mockLLM = vi.fn().mockResolvedValue(JSON.stringify({
      mode: 'brainstorm',
      reasoning: '用户方向不确定',
      subQuestions: [{ question: '优化方向是什么？', required: true, source: 'llm分析' }],
    }));
    analyzer.setLLMCaller(mockLLM);
    // 冲突输入确保 shouldClarify=true 且 ambiguityScore > 0
    const topic = await analyzer.analyze('简化代码同时增加更多功能');
    expect(topic.ambiguityScore).toBeGreaterThan(0);
    expect(mockLLM).toHaveBeenCalled();
  });

  it('should use LLM mode when LLM returns mode', async () => {
    const analyzer = new TopicAnalyzer();
    const mockLLM = vi.fn().mockResolvedValue(JSON.stringify({
      mode: 'brainstorm',
      reasoning: '方向不确定',
      subQuestions: [],
    }));
    analyzer.setLLMCaller(mockLLM);
    // 冲突输入一定会触发 shouldClarify
    const topic = await analyzer.analyze('简化代码同时增加更多功能');
    expect(topic.mode).toBe('brainstorm');
  });
});

describe('RoleAssigner', () => {
  it('should return brainstorm roles for brainstorm mode', () => {
    const assigner = new RoleAssigner();
    const topic = { mode: 'brainstorm' } as any;
    const roles = assigner.selectRoles(topic);
    expect(roles.some(r => r.id === 'creative-proposer')).toBe(true);
    expect(roles.some(r => r.id === 'comparator')).toBe(true);
  });

  it('should return base roles for clarify mode', () => {
    const assigner = new RoleAssigner();
    const topic = { mode: 'clarify', coreQuestion: '普通问题' } as any;
    const roles = assigner.selectRoles(topic);
    expect(roles.some(r => r.id === 'user-advocate')).toBe(true);
    expect(roles.some(r => r.id === 'risk-analyst')).toBe(true);
    expect(roles.some(r => r.id === 'executor')).toBe(true);
  });

  it('should add deploy guardian for deploy tasks', () => {
    const assigner = new RoleAssigner();
    const topic = { mode: 'clarify', coreQuestion: '部署到生产服务器' } as any;
    const roles = assigner.selectRoles(topic);
    expect(roles.some(r => r.id === 'deploy-guardian')).toBe(true);
  });

  it('should add domain roles based on domains', () => {
    const assigner = new RoleAssigner();
    const topic = { mode: 'clarify', coreQuestion: '修改代码' } as any;
    const roles = assigner.selectRoles(topic, ['code']);
    expect(roles.some(r => r.id === 'code-reviewer')).toBe(true);
  });
});

describe('DebateEngine', () => {
  it('should return proceed for empty roles without LLM', async () => {
    const engine = new DebateEngine();
    const topic = {
      mode: 'clarify' as const,
      coreQuestion: '读取文件',
      subQuestions: [],
      missingInfo: [],
    } as any;
    const result = await engine.debate(topic, {}, []);
    // 空角色列表 → 空 statements → aggregateVotes 时 winner='proceed' (默认)
    expect(result.finalVote.action).toBe('proceed');
  });

  it('should use LLM when available', async () => {
    const engine = new DebateEngine();
    const mockLLM = vi.fn().mockResolvedValue(JSON.stringify({
      position: '信息充足',
      responses: [],
      vote: 'proceed',
      confidence: 0.9,
      reasoning: '所有参数都明确了',
    }));
    engine.setLLMCaller(mockLLM);

    const topic = {
      id: 'test',
      mode: 'clarify' as const,
      coreQuestion: '读取 src/index.ts',
      subQuestions: [],
      missingInfo: [],
      ambiguityScore: 0.1,
    } as any;

    const roles = [{ id: 'test', name: '测试', perspective: 'efficiency' as const, prompt: '测试', weight: 1 }];
    const result = await engine.debate(topic, {}, roles);
    expect(result.rounds.length).toBeGreaterThanOrEqual(1);
    expect(mockLLM).toHaveBeenCalled();
  });

  it('should extract proposals in brainstorm mode', async () => {
    const engine = new DebateEngine();
    const mockLLM = vi.fn().mockResolvedValue(JSON.stringify({
      position: '建议方案A',
      responses: [],
      vote: 'brainstorm',
      confidence: 0.8,
      reasoning: '需要用户选择',
      proposals: [
        { title: '方案A', description: '描述A', pros: ['优势1'], cons: ['劣势1'] },
      ],
    }));
    engine.setLLMCaller(mockLLM);

    const topic = {
      id: 'test',
      mode: 'brainstorm' as const,
      coreQuestion: '画一幅虾',
      subQuestions: [],
      missingInfo: ['风格'],
      ambiguityScore: 0.5,
    } as any;

    const roles = [{ id: 'creative', name: '创意', perspective: 'domain_expert' as const, prompt: '创意', weight: 1 }];
    const result = await engine.debate(topic, {}, roles);
    expect(result.proposals.length).toBeGreaterThan(0);
    expect(result.proposals[0].title).toBe('方案A');
  });
});

describe('RiskValidator', () => {
  it('should detect write operations', () => {
    const validator = new RiskValidator();
    const topic = { coreQuestion: '删除临时文件', subQuestions: [], missingInfo: [] } as any;
    const debate = { finalVote: { action: 'proceed', confidence: 0.8, reasoning: '' } } as any;
    const risk = validator.validate(topic, debate);
    expect(risk.risks.some(r => r.description.includes('写入/删除'))).toBe(true);
  });

  it('should force refine when missing info and vote proceed', () => {
    const validator = new RiskValidator();
    const topic = { coreQuestion: '普通任务', subQuestions: [], missingInfo: ['目标文件'] } as any;
    const debate = { finalVote: { action: 'proceed', confidence: 0.8, reasoning: '' } } as any;
    const risk = validator.validate(topic, debate);
    expect(debate.finalVote.action).toBe('refine'); // forced by validator
    expect(risk.canProceed).toBe(false);
  });

  it('should detect unresolved required sub-questions', () => {
    const validator = new RiskValidator();
    const topic = {
      coreQuestion: '普通任务',
      subQuestions: [{ id: '1', question: '参数？', required: true, source: 'missing_param' }],
      missingInfo: [],
    } as any;
    const debate = { finalVote: { action: 'proceed', confidence: 0.8, reasoning: '' } } as any;
    const risk = validator.validate(topic, debate);
    expect(debate.finalVote.action).toBe('refine');
  });
});

describe('DeliberationCouncil', () => {
  it('should fast-path clear input', async () => {
    const council = new DeliberationCouncil();
    const result = await council.deliberate('读取 src/index.ts', [], mockBodyState);
    expect(result.action).toBe('proceed');
    expect(result.durationMs).toBeLessThan(50);
  });

  it('should return brainstorm result for ambiguous brainstorm input', async () => {
    const mockLLM = vi.fn()
      // TopicAnalyzer deepAnalyze
      .mockResolvedValueOnce(JSON.stringify({
        mode: 'brainstorm',
        reasoning: '用户方向不确定',
        subQuestions: [{ question: '什么风格？', required: true, source: 'llm分析' }],
      }))
      // DebateEngine - 所有角色发言
      .mockResolvedValue(JSON.stringify({
        position: '建议方案A',
        responses: [],
        vote: 'brainstorm',
        confidence: 0.8,
        reasoning: '需要用户选择',
        proposals: [
          { title: '写意风格', description: '寥寥数笔', pros: ['简洁'], cons: ['细节少'] },
          { title: '工笔风格', description: '细节丰富', pros: ['精细'], cons: ['耗时'] },
        ],
      }));
    const council = new DeliberationCouncil({ llmCall: mockLLM });
    // 冲突输入确保 shouldClarify=true
    const result = await council.deliberate('简化代码同时增加更多功能', ['code'], mockBodyState);
    expect(result.action).toBe('brainstorm');
    expect(result.proposals).toBeDefined();
    expect(result.proposals!.length).toBeGreaterThanOrEqual(2);
  });

  it('should build proposals presentation', () => {
    const presentation = DeliberationCouncil.buildProposalsPresentation([
      { id: '1', title: '方案A', description: '描述A', pros: ['优势1', '优势2'], cons: ['劣势1'], proposedBy: 'test', support: [], score: 0.8 },
      { id: '2', title: '方案B', description: '描述B', pros: ['优势1'], cons: ['劣势1', '劣势2'], proposedBy: 'test', support: [], score: 0.6 },
    ]);
    expect(presentation).toContain('方案A');
    expect(presentation).toContain('方案B');
    expect(presentation).toContain('✅');
    expect(presentation).toContain('⚠️');
  });

  it('should use LLM for ambiguous input with conflict', async () => {
    const mockLLM = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        mode: 'clarify',
        reasoning: '缺少参数',
        subQuestions: [{ question: '目标是什么？', required: true, source: 'llm分析' }],
      }))
      .mockResolvedValue(JSON.stringify({
        position: '需要追问',
        responses: [],
        vote: 'refine',
        confidence: 0.7,
        reasoning: '信息不足',
      }));
    const council = new DeliberationCouncil({ llmCall: mockLLM });
    const result = await council.deliberate('简化代码同时增加更多功能', [], mockBodyState);
    expect(mockLLM).toHaveBeenCalled();
  });
});
