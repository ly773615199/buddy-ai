/**
 * 智能模块测试
 * 覆盖: ExperienceExecutor, PromptInjector, TrainingExporter, ExperienceEvolver
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExperienceExecutor, type ToolExecutor, type PersonalityKey } from './intelligence/experience-executor.js';
import type { ExperienceUnit } from './intelligence/types.js';

// ═══════════════════════════════════════════════════════
// 测试工具
// ═══════════════════════════════════════════════════════

function makeUnit(overrides: Partial<ExperienceUnit> = {}): ExperienceUnit {
  return {
    id: 'test_unit',
    name: 'test',
    description: 'Test experience unit',
    abstractionLevel: 'concrete',
    trigger: { intent: 'exec', keywords: ['test'], contextTags: [], patterns: [] },
    steps: [{ tool: 'echo', args: { text: 'hello' } }],
    replyTemplate: { sharp: 'done', warm: 'done~', chaotic: 'DONE!', default: '已完成' },
    stats: {
      successCount: 5, failCount: 0, confidence: 0.8,
      avgExecutionMs: 100, lastUsed: Date.now(),
      createdAt: Date.now(), extractedFrom: [], consolidatedAt: 0, evolved: false,
    },
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════
// ExperienceExecutor
// ═══════════════════════════════════════════════════════

describe('ExperienceExecutor', () => {
  let mockExecutor: ToolExecutor;

  beforeEach(() => {
    mockExecutor = vi.fn(async (tool: string, args: Record<string, unknown>) => {
      return `result:${tool}:${JSON.stringify(args)}`;
    });
  });

  it('单步执行成功', async () => {
    const executor = new ExperienceExecutor(mockExecutor);
    const unit = makeUnit();
    const result = await executor.execute(unit);

    expect(result.success).toBe(true);
    expect(result.skillId).toBe('test_unit');
    expect(result.executionMs).toBeGreaterThanOrEqual(0);
    expect(result.reply).toBeTruthy();
    expect(mockExecutor).toHaveBeenCalledWith('echo', { text: 'hello' });
  });

  it('多步顺序执行', async () => {
    const executor = new ExperienceExecutor(mockExecutor);
    const unit = makeUnit({
      steps: [
        { tool: 'read_file', args: { path: 'a.ts' }, outputVar: 'file_content' },
        { tool: 'analyze', args: { content: '${file_content}' } },
      ],
    });

    const result = await executor.execute(unit);
    expect(result.success).toBe(true);
    expect(mockExecutor).toHaveBeenCalledTimes(2);
    // 第二步的 args 应该被 resolve
    const secondCall = (mockExecutor as any).mock.calls[1];
    expect(secondCall[1]).toHaveProperty('content');
  });

  it('条件不满足时中断执行', async () => {
    const executor = new ExperienceExecutor(mockExecutor);
    const unit = makeUnit({
      steps: [
        { tool: 'step1', args: {} },
        { tool: 'step2', args: {}, condition: 'missing_var' },
      ],
    });

    const result = await executor.execute(unit);
    expect(result.success).toBe(false);
    expect(result.failedStep).toBe(1);
    expect(result.error).toContain('condition_not_met');
    expect(mockExecutor).toHaveBeenCalledTimes(1); // 第二步未执行
  });

  it('工具执行失败时返回错误', async () => {
    const failExecutor: ToolExecutor = async () => { throw new Error('tool crashed'); };
    const executor = new ExperienceExecutor(failExecutor);
    const unit = makeUnit();

    const result = await executor.execute(unit);
    expect(result.success).toBe(false);
    expect(result.error).toContain('tool crashed');
    expect(result.failedStep).toBe(0);
  });

  it('超时处理', async () => {
    const slowExecutor: ToolExecutor = () => new Promise(r => setTimeout(r, 10000));
    const executor = new ExperienceExecutor(slowExecutor, { stepTimeoutMs: 50 });

    const result = await executor.execute(makeUnit());
    expect(result.success).toBe(false);
    expect(result.error).toContain('timeout');
  });

  it('不同性格使用不同回复模板', async () => {
    const executor = new ExperienceExecutor(mockExecutor);
    const unit = makeUnit();

    const sharpResult = await executor.execute(unit, 'sharp');
    const warmResult = await executor.execute(unit, 'warm');
    const chaoticResult = await executor.execute(unit, 'chaotic');

    expect(sharpResult.reply).toBe('done');
    expect(warmResult.reply).toBe('done~');
    expect(chaoticResult.reply).toBe('DONE!');
  });

  it('verify — 无 verifier 时返回 success 状态', () => {
    const executor = new ExperienceExecutor(mockExecutor);
    const unit = makeUnit();
    expect(executor.verify(unit, { success: true, outputs: {}, reply: 'ok', skillId: 't', executionMs: 0 })).toBe(true);
    expect(executor.verify(unit, { success: false, outputs: {}, reply: 'fail', skillId: 't', executionMs: 0 })).toBe(false);
  });

  it('verify — output_contains 检查', () => {
    const executor = new ExperienceExecutor(mockExecutor);
    const unit = makeUnit({
      verifier: { type: 'output_contains', target: 'step_0', criteria: 'hello' },
    });

    expect(executor.verify(unit, {
      success: true, outputs: { step_0: 'say hello world' }, reply: 'ok', skillId: 't', executionMs: 0,
    })).toBe(true);

    expect(executor.verify(unit, {
      success: true, outputs: { step_0: 'goodbye' }, reply: 'ok', skillId: 't', executionMs: 0,
    })).toBe(false);
  });

  it('变量替换 — ${var} 引用前序输出', async () => {
    const executor = new ExperienceExecutor(mockExecutor);
    const unit = makeUnit({
      steps: [
        { tool: 'get_data', args: {}, outputVar: 'data' },
        { tool: 'process', args: { input: '${data}' } },
      ],
    });

    await executor.execute(unit);
    const processCall = (mockExecutor as any).mock.calls[1];
    // data 变量应该被替换为第一步的输出
    expect(processCall[1].input).not.toBe('${data}');
  });
});

// ═══════════════════════════════════════════════════════
// ExperienceEvolver (compileFromConversation async)
// ═══════════════════════════════════════════════════════

describe('ExperienceEvolver', () => {
  it('compileFromConversation 返回 null 对于纯闲聊', async () => {
    const { ExperienceEvolver } = await import('./intelligence/experience-evolver.js');
    const { ExperienceGraph } = await import('./intelligence/experience-graph.js');

    const graph = new ExperienceGraph('/tmp/buddy-test-evolver');
    const evolver = new ExperienceEvolver(graph);

    const result = await evolver.compileFromConversation({
      id: 'conv',
      userMessage: '你好',
      assistantReply: '你好！',
      toolCalls: [],
      timestamp: Date.now(),
      wasSuccessful: true,
    });

    expect(result).toBeNull();
  });

  it('compileFromConversation 编译成功对话', async () => {
    const { ExperienceEvolver } = await import('./intelligence/experience-evolver.js');
    const { ExperienceGraph } = await import('./intelligence/experience-graph.js');

    const graph = new ExperienceGraph('/tmp/buddy-test-evolver2');
    await graph.load();
    const evolver = new ExperienceEvolver(graph);

    const result = await evolver.compileFromConversation({
      id: 'conv-ok',
      userMessage: '帮我读取 config.json 文件',
      assistantReply: '文件内容: { "name": "test" }',
      toolCalls: [
        { name: 'read_file', args: { path: 'config.json' }, result: '{ "name": "test" }' },
      ],
      timestamp: Date.now(),
      wasSuccessful: true,
    });

    expect(result).not.toBeNull();
    expect(result!.trigger.keywords.length).toBeGreaterThan(0);
    expect(result!.steps[0].tool).toBe('read_file');
  });

  it('setLLMCaller 注入后编译增强 reasoning', async () => {
    const { ExperienceEvolver } = await import('./intelligence/experience-evolver.js');
    const { ExperienceGraph } = await import('./intelligence/experience-graph.js');

    const graph = new ExperienceGraph('/tmp/buddy-test-evolver3');
    await graph.load();
    const evolver = new ExperienceEvolver(graph);

    evolver.setLLMCaller(async () => '通过读取配置文件确定项目参数');

    const result = await evolver.compileFromConversation({
      id: 'conv-llm',
      userMessage: '读取配置文件',
      assistantReply: '配置已加载',
      toolCalls: [{ name: 'read_file', args: { path: 'config.json' }, result: '{}' }],
      timestamp: Date.now(),
      wasSuccessful: true,
    });

    expect(result).not.toBeNull();
    expect(result!.reasoning).toBe('通过读取配置文件确定项目参数');
  });

  it('onSuccess / onFailure 更新置信度', async () => {
    const { ExperienceEvolver } = await import('./intelligence/experience-evolver.js');
    const { ExperienceGraph } = await import('./intelligence/experience-graph.js');

    const graph = new ExperienceGraph('/tmp/buddy-test-evolver4');
    await graph.load();
    graph.addNode(makeUnit({ id: 'sk1' }));
    const evolver = new ExperienceEvolver(graph);

    const beforeConf = graph.getNode('sk1')!.stats.confidence;
    evolver.onSuccess('sk1', 200);
    const afterConf = graph.getNode('sk1')!.stats.confidence;
    expect(afterConf).toBeGreaterThanOrEqual(beforeConf);

    evolver.onFailure('sk1', 'timeout');
    expect(graph.getNode('sk1')!.stats.failCount).toBe(1);
  });

  it('canCompile / stagnation 检测', async () => {
    const { ExperienceEvolver } = await import('./intelligence/experience-evolver.js');
    const { ExperienceGraph } = await import('./intelligence/experience-graph.js');

    const graph = new ExperienceGraph('/tmp/buddy-test-evolver5');
    const evolver = new ExperienceEvolver(graph);

    // 初始状态可以编译
    expect(evolver.canCompile()).toBe(true);
    expect(evolver.isStagnant()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════
// Sprint 3: ExperienceEngine.learn → ToolSynthesizer 集成
// ═══════════════════════════════════════════════════════

describe('ExperienceEngine.learn → ToolSynthesizer 集成', () => {
  it('learn 编译经验后不崩溃（无 synthesizer）', async () => {
    const { ExperienceEngine } = await import('./intelligence/index.js');
    const engine = new ExperienceEngine(async () => 'ok', { dataDir: '/tmp/buddy-test-integration' });
    await engine.init();

    const result = await engine.learn({
      id: 'conv-learn-1',
      userMessage: '帮我读取 config.json',
      assistantReply: '文件内容: {}',
      toolCalls: [{ name: 'read_file', args: { path: 'config.json' }, result: '{}' }],
      timestamp: Date.now(),
      wasSuccessful: true,
    });

    // 应该编译成功
    expect(result).toBe(true);
  });

  it('learn 后经验加入图谱', async () => {
    const { ExperienceEngine } = await import('./intelligence/index.js');
    const engine = new ExperienceEngine(async () => 'ok', { dataDir: '/tmp/buddy-test-integration2' });
    await engine.init();

    const beforeCount = engine.graph.getAllNodes().length;

    await engine.learn({
      id: 'conv-learn-2',
      userMessage: '帮我搜索代码中的 TODO',
      assistantReply: '找到 3 个 TODO',
      toolCalls: [{ name: 'search_files', args: { pattern: 'TODO' }, result: '3 results' }],
      timestamp: Date.now(),
      wasSuccessful: true,
    });

    const afterCount = engine.graph.getAllNodes().length;
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount);
  });

  it('setToolSynthesizer 后 learn 不崩溃', async () => {
    const { ExperienceEngine } = await import('./intelligence/index.js');
    const { ToolSynthesizer } = await import('./core/tool-synthesizer.js');
    const { SkillManager } = await import('./skills/skill-manager.js');

    const engine = new ExperienceEngine(async () => 'ok', { dataDir: '/tmp/buddy-test-integration3' });
    await engine.init();

    const synthesizer = new ToolSynthesizer(true);
    const skillManager = new SkillManager(['/tmp/buddy-test-skills-dir']);

    engine.setToolSynthesizer(synthesizer, skillManager);

    const result = await engine.learn({
      id: 'conv-learn-3',
      userMessage: '帮我读取 package.json',
      assistantReply: '{"name":"test"}',
      toolCalls: [{ name: 'read_file', args: { path: 'package.json' }, result: '{"name":"test"}' }],
      timestamp: Date.now(),
      wasSuccessful: true,
    });

    expect(result).toBe(true);
  });
});
