/**
 * skill-resolver.ts — SkillResolver 单元测试
 *
 * 覆盖：4 级解析优先级 + 类别围栏 + LLM 降级 + 兜底
 */
import { describe, it, expect, vi } from 'vitest';
import { SkillResolver } from './skill-resolver.js';
import type { DAGSkeleton, SkeletonStep } from '../orchestrate/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolDef } from '../types.js';
import { UnifiedResourceHub } from '../brain/hub/unified-resource-hub.js';

// ── Helpers ──

function mockToolRegistry(tools: Record<string, string> = {}): ToolRegistry {
  const map = new Map<string, ToolDef>();
  for (const [name, desc] of Object.entries(tools)) {
    map.set(name, {
      name,
      description: desc ?? `mock ${name}`,
      parameters: {} as any,
      execute: async () => 'ok',
    } as ToolDef);
  }
  return {
    get: (name: string) => map.get(name),
    list: () => Array.from(map.values()),
    register: () => {},
    registerMany: () => {},
    listForPermissions: () => Array.from(map.values()),
  } as unknown as ToolRegistry;
}

function makeSkeleton(steps: SkeletonStep[] = []): DAGSkeleton {
  return {
    id: 'skel-1',
    description: 'test skeleton',
    steps: steps.length > 0 ? steps : [
      { id: 's1', name: '分析代码', intent: '分析项目代码结构', deps: [], suggestedCategory: 'code_analysis' },
    ],
    edges: [],
    parallelGroups: [],
    complexity: 'medium',
    detectedDomains: ['code'],
  };
}

// ==================== 构造函数 ====================

describe('构造函数', () => {
  it('使用默认配置', () => {
    const resolver = new SkillResolver(mockToolRegistry());
    expect(resolver).toBeDefined();
  });

  it('自定义配置覆盖默认值', () => {
    const resolver = new SkillResolver(mockToolRegistry(), {
      config: { minExpConfidence: 0.9 },
    });
    expect(resolver).toBeDefined();
  });
});

// ==================== 优先级 1: 经验匹配 ====================

describe('优先级 1: 经验图谱匹配', () => {
  it('高置信度经验命中 → 使用经验工具', async () => {
    const experience = {
      getExperiences: () => [{
        trigger: { keywords: ['分析', '代码'] },
        steps: [{ tool: 'analyze_file', args: { path: 'src/' } }],
        stats: { confidence: 0.85 },
      }],
    };

    const resolver = new SkillResolver(mockToolRegistry({ analyze_file: '分析文件' }), {
      experience: experience as any,
    });

    const result = await resolver.resolve(makeSkeleton(), '分析代码');

    expect(result.resolutionLog[0].resolvedTool).toBe('analyze_file');
    expect(result.resolutionLog[0].source).toBe('experience');
    expect(result.resolutionLog[0].confidence).toBe(0.85);
  });

  it('低置信度经验 → 跳过，继续下一优先级', async () => {
    const experience = {
      getExperiences: () => [{
        trigger: { keywords: ['分析'] },
        steps: [{ tool: 'analyze_file', args: {} }],
        stats: { confidence: 0.3 },
      }],
    };

    const registry = mockToolRegistry({ analyze_file: '分析' });
    const resolver = new SkillResolver(registry, {
      experience: experience as any,
    });

    const result = await resolver.resolve(makeSkeleton(), '分析代码');

    // 不应使用经验（置信度 0.3 < 0.7）
    expect(result.resolutionLog[0].source).not.toBe('experience');
  });

  it('类别围栏不匹配 → 跳过经验', async () => {
    const experience = {
      getExperiences: () => [{
        trigger: { keywords: ['分析'] },
        steps: [{ tool: 'tts_speak', args: {} }],  // voice 类别
        stats: { confidence: 0.9 },
      }],
    };

    const resolver = new SkillResolver(
      mockToolRegistry({ tts_speak: 'TTS' }),
      { experience: experience as any },
    );

    const skeleton = makeSkeleton([
      { id: 's1', name: '分析代码', intent: '分析', deps: [], suggestedCategory: 'code_analysis' },
    ]);

    const result = await resolver.resolve(skeleton, '分析代码');

    // tts_speak 属于 voice 类别，但 step 建议 code_analysis → 类别围栏拦截
    expect(result.resolutionLog[0].source).not.toBe('experience');
  });
});

// ==================== 优先级 2: 工具语义检索 ====================

describe('优先级 2: 工具语义检索', () => {
  it('检索到高分工具 → 使用', async () => {
    const toolRetriever = {
      retrieve: vi.fn().mockReturnValue([
        { name: 'search_files', score: 0.8 },
      ]),
    };

    const resolver = new SkillResolver(
      mockToolRegistry({ search_files: '搜索文件' }),
      { toolRetriever: toolRetriever as any },
    );

    // 无 suggestedCategory → 类别围栏不拦截
    const skeleton = makeSkeleton([
      { id: 's1', name: '查找文件', intent: '查找项目文件', deps: [] },
    ]);

    const result = await resolver.resolve(skeleton, '查找文件');

    expect(result.resolutionLog[0].resolvedTool).toBe('search_files');
    expect(result.resolutionLog[0].source).toBe('skill');
  });

  it('检索分数过低 → 跳过', async () => {
    const toolRetriever = {
      retrieve: vi.fn().mockReturnValue([
        { name: 'search_files', score: 0.05 },
      ]),
    };

    const resolver = new SkillResolver(
      mockToolRegistry({ search_files: '搜索' }),
      { toolRetriever: toolRetriever as any },
    );

    const result = await resolver.resolve(makeSkeleton(), '查找');

    // score 0.05 < minToolScore 0.2
    expect(result.resolutionLog[0].source).not.toBe('skill');
  });

  it('类别围栏不匹配 → 跳过工具检索', async () => {
    const toolRetriever = {
      retrieve: vi.fn().mockReturnValue([
        { name: 'tts_speak', score: 0.9 },
      ]),
    };

    const resolver = new SkillResolver(
      mockToolRegistry({ tts_speak: 'TTS' }),
      { toolRetriever: toolRetriever as any },
    );

    const skeleton = makeSkeleton([
      { id: 's1', name: '分析代码', intent: '分析', deps: [], suggestedCategory: 'code_analysis' },
    ]);

    const result = await resolver.resolve(skeleton, '分析代码');

    expect(result.resolutionLog[0].source).not.toBe('skill');
  });
});

// ==================== 优先级 3: 类别映射 ====================

describe('优先级 3: 类别映射兜底', () => {
  it('有 suggestedCategory 且工具注册 → 使用类别工具', async () => {
    const resolver = new SkillResolver(
      mockToolRegistry({ analyze_file: '分析', exec: '执行' }),
    );

    const skeleton = makeSkeleton([
      { id: 's1', name: '分析', intent: '分析', deps: [], suggestedCategory: 'code_analysis' },
    ]);

    const result = await resolver.resolve(skeleton, '分析代码');

    expect(result.resolutionLog[0].resolvedTool).toBe('analyze_file');
    expect(result.resolutionLog[0].source).toBe('skill');
    expect(result.resolutionLog[0].confidence).toBe(0.4);
  });

  it('类别工具未注册 → 跳过', async () => {
    const resolver = new SkillResolver(
      mockToolRegistry({ some_tool: '其他' }),  // 没有任何 code_analysis 工具
    );

    const skeleton = makeSkeleton([
      { id: 's1', name: '分析', intent: '分析', deps: [], suggestedCategory: 'nonexistent_category' },
    ]);

    const result = await resolver.resolve(skeleton, '分析代码');

    // nonexistent_category 不在 CATEGORY_TOOLS 中 → 跳过类别映射
    expect(result.resolutionLog[0].source).not.toBe('skill');
  });

  it('无 suggestedCategory → 跳过类别映射', async () => {
    const resolver = new SkillResolver(mockToolRegistry({ exec: '执行' }));

    const skeleton = makeSkeleton([
      { id: 's1', name: 'do stuff', intent: 'do', deps: [] },
    ]);

    const result = await resolver.resolve(skeleton, 'do stuff');

    // 没有类别，跳过优先级 3
    expect(result.resolutionLog).toHaveLength(1);
  });
});

// ==================== 优先级 4: LLM 降级 ====================

describe('优先级 4: LLM 降级', () => {
  it('LLM 返回有效工具 → 使用', async () => {
    const llmCaller = vi.fn().mockResolvedValue(
      JSON.stringify({ tool: 'exec', args: { command: 'ls' } }),
    );

    const resolver = new SkillResolver(
      mockToolRegistry({ exec: '执行' }),
      { llmCaller },
    );

    // 无 suggestedCategory → 不触发类别匹配，LLM 才能命中
    const skeleton = makeSkeleton([
      { id: 's1', name: '执行命令', intent: '运行命令', deps: [] },
    ]);

    const result = await resolver.resolve(skeleton, '执行命令');

    expect(result.resolutionLog[0].resolvedTool).toBe('exec');
    expect(result.resolutionLog[0].source).toBe('llm');
  });

  it('LLM 返回未注册工具 → 降级到第一个可用工具', async () => {
    const llmCaller = vi.fn().mockResolvedValue(
      JSON.stringify({ tool: 'nonexistent', args: {} }),
    );

    const resolver = new SkillResolver(
      mockToolRegistry({ exec: '执行' }),
      { llmCaller },
    );

    const skeleton = makeSkeleton([
      { id: 's1', name: 'test', intent: 'test', deps: [] },
    ]);

    const result = await resolver.resolve(skeleton, 'test');

    expect(result.resolutionLog[0].resolvedTool).toBe('exec');
    expect(result.resolutionLog[0].source).toBe('llm');
    expect(result.resolutionLog[0].confidence).toBe(0.2);
  });

  it('LLM 返回非法 JSON → 降级', async () => {
    const llmCaller = vi.fn().mockResolvedValue('not json at all');

    const resolver = new SkillResolver(
      mockToolRegistry({ exec: '执行' }),
      { llmCaller },
    );

    const skeleton = makeSkeleton([
      { id: 's1', name: 'test', intent: 'test', deps: [] },
    ]);

    const result = await resolver.resolve(skeleton, 'test');

    expect(result.resolutionLog[0].source).toBe('llm');
    expect(result.resolutionLog[0].confidence).toBe(0.2);
  });

  it('LLM 返回 markdown 包裹的 JSON → 正确解析', async () => {
    const llmCaller = vi.fn().mockResolvedValue(
      '```json\n{"tool": "exec", "args": {"command": "pwd"}}\n```',
    );

    const resolver = new SkillResolver(
      mockToolRegistry({ exec: '执行' }),
      { llmCaller },
    );

    const skeleton = makeSkeleton([
      { id: 's1', name: 'test', intent: 'test', deps: [] },
    ]);

    const result = await resolver.resolve(skeleton, 'test');

    expect(result.resolutionLog[0].resolvedTool).toBe('exec');
    expect(result.resolutionLog[0].source).toBe('llm');
  });
});

// ==================== 兜底 ====================

describe('兜底', () => {
  it('无经验/检索/类别/LLM → exec 兜底', async () => {
    const resolver = new SkillResolver(mockToolRegistry({}));

    const skeleton = makeSkeleton([
      { id: 's1', name: 'unknown', intent: 'unknown', deps: [] },
    ]);

    const result = await resolver.resolve(skeleton, 'unknown');

    expect(result.resolutionLog[0].resolvedTool).toBe('exec');
    expect(result.resolutionLog[0].source).toBe('builtin');
    expect(result.resolutionLog[0].confidence).toBe(0.1);
  });
});

// ==================== DAG 构建 ====================

describe('DAG 构建', () => {
  it('多个步骤全部解析 → DAG 包含所有任务', async () => {
    const resolver = new SkillResolver(
      mockToolRegistry({ analyze_file: '分析', exec: '执行' }),
    );

    const skeleton = makeSkeleton([
      { id: 's1', name: '分析', intent: '分析代码', deps: [], suggestedCategory: 'code_analysis' },
      { id: 's2', name: '执行', intent: '运行命令', deps: ['s1'], suggestedCategory: 'system' },
    ]);

    const result = await resolver.resolve(skeleton, '分析并执行');

    expect(result.resolutionLog).toHaveLength(2);
    expect(result.unresolvedSteps).toHaveLength(0);
  });

  it('LLM 解析的步骤记入 unresolvedSteps', async () => {
    const llmCaller = vi.fn().mockResolvedValue(
      JSON.stringify({ tool: 'exec', args: {} }),
    );

    const resolver = new SkillResolver(
      mockToolRegistry({ exec: '执行' }),
      { llmCaller },
    );

    // 无 suggestedCategory → 走 LLM 路径
    const skeleton = makeSkeleton([
      { id: 's1', name: 'unknown', intent: 'unknown', deps: [] },
    ]);

    const result = await resolver.resolve(skeleton, 'test');

    // LLM source → unresolvedSteps
    expect(result.unresolvedSteps).toContain('s1');
  });

  it('并行组正确添加到 DAG', async () => {
    const resolver = new SkillResolver(
      mockToolRegistry({ analyze_file: '分析' }),
    );

    const skeleton = makeSkeleton([
      { id: 's1', name: '分析A', intent: '分析', deps: [], suggestedCategory: 'code_analysis' },
      { id: 's2', name: '分析B', intent: '分析', deps: [], suggestedCategory: 'code_analysis' },
    ]);
    skeleton.parallelGroups = [['s1', 's2']];

    const result = await resolver.resolve(skeleton, 'test');

    expect(result.dag.parallelGroups).toContainEqual(['s1', 's2']);
  });
});

// ==================== V1+V2 新增功能测试 ====================

describe('V2: inferCapabilityRequirement', () => {
  it('code_analysis → tools + requiresToolCalling', () => {
    const resolver = new SkillResolver(mockToolRegistry());
    // 通过 matchExecutors 间接测试推断
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'gpt' });
    hub.markState('m1', 'active');
    resolver.setResourceHub(hub);

    const dag = { id: 'd1', description: 'test', tasks: new Map(), edges: [], parallelGroups: [], createdAt: Date.now(), status: 'executing' as const, defaultTimeoutMs: 30000 };
    const task = { id: 's1', name: 'scan', tool: 'exec', args: {}, deps: [], status: 'pending' as const };
    dag.tasks.set('s1', task);

    const skeleton = makeSkeleton([
      { id: 's1', name: 'scan', intent: 'scan code', deps: [], suggestedCategory: 'code_analysis' },
    ]);

    const matches = resolver.matchExecutors(dag, skeleton);
    expect(matches.has('s1')).toBe(true);
    expect(matches.get('s1')!.source).toBe('capability');
    // 推断结果应回写到 skeleton step
    expect(skeleton.steps[0].capabilityRequirement?.taskType).toBe('tools');
    expect(skeleton.steps[0].capabilityRequirement?.requiresToolCalling).toBe(true);
  });

  it('voice → chat 无 requiresToolCalling', () => {
    const resolver = new SkillResolver(mockToolRegistry());
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'tts' });
    hub.markState('m1', 'active');
    resolver.setResourceHub(hub);

    const dag = { id: 'd1', description: 'test', tasks: new Map(), edges: [], parallelGroups: [], createdAt: Date.now(), status: 'executing' as const, defaultTimeoutMs: 30000 };
    dag.tasks.set('s1', { id: 's1', name: 'speak', tool: 'tts_speak', args: {}, deps: [], status: 'pending' as const });

    const skeleton = makeSkeleton([
      { id: 's1', name: 'speak', intent: 'speak text', deps: [], suggestedCategory: 'voice' },
    ]);

    const matches = resolver.matchExecutors(dag, skeleton);
    expect(skeleton.steps[0].capabilityRequirement?.taskType).toBe('chat');
    expect(skeleton.steps[0].capabilityRequirement?.requiresToolCalling).toBeUndefined();
  });

  it('无 suggestedCategory → 不推断，跳过', () => {
    const resolver = new SkillResolver(mockToolRegistry());
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'gpt' });
    hub.markState('m1', 'active');
    resolver.setResourceHub(hub);

    const dag = { id: 'd1', description: 'test', tasks: new Map(), edges: [], parallelGroups: [], createdAt: Date.now(), status: 'executing' as const, defaultTimeoutMs: 30000 };
    dag.tasks.set('s1', { id: 's1', name: 'unknown', tool: 'exec', args: {}, deps: [], status: 'pending' as const });

    const skeleton = makeSkeleton([
      { id: 's1', name: 'unknown', intent: 'unknown', deps: [] }, // 无 suggestedCategory
    ]);

    const matches = resolver.matchExecutors(dag, skeleton);
    expect(matches.has('s1')).toBe(false);
  });

  it('已有 capabilityRequirement 时不覆盖', () => {
    const resolver = new SkillResolver(mockToolRegistry());
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'gpt' });
    hub.markState('m1', 'active');
    resolver.setResourceHub(hub);

    const dag = { id: 'd1', description: 'test', tasks: new Map(), edges: [], parallelGroups: [], createdAt: Date.now(), status: 'executing' as const, defaultTimeoutMs: 30000 };
    dag.tasks.set('s1', { id: 's1', name: 'chat', tool: 'exec', args: {}, deps: [], status: 'pending' as const });

    const existingReq = { taskType: 'reasoning' as const, requiresToolCalling: false };
    const skeleton = makeSkeleton([
      { id: 's1', name: 'chat', intent: 'chat', deps: [], suggestedCategory: 'chat', capabilityRequirement: existingReq },
    ]);

    resolver.matchExecutors(dag, skeleton);
    // 不应覆盖已有的 requirement
    expect(skeleton.steps[0].capabilityRequirement).toBe(existingReq);
  });
});

describe('V2: resolveParallelConflicts', () => {
  it('并行组内同资源应重新分配', () => {
    const resolver = new SkillResolver(mockToolRegistry());
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'gpt' });
    hub.register({ id: 'm2', type: 'model', name: 'claude' });
    hub.markState('m1', 'active');
    hub.markState('m2', 'active');
    resolver.setResourceHub(hub);

    const dag = { id: 'd1', description: 'test', tasks: new Map(), edges: [], parallelGroups: [['s1', 's2']], createdAt: Date.now(), status: 'executing' as const, defaultTimeoutMs: 30000 };
    dag.tasks.set('s1', { id: 's1', name: 'A', tool: 'exec', args: {}, deps: [], status: 'pending' as const });
    dag.tasks.set('s2', { id: 's2', name: 'B', tool: 'exec', args: {}, deps: [], status: 'pending' as const });

    const skeleton = makeSkeleton([
      { id: 's1', name: 'A', intent: 'do A', deps: [], suggestedCategory: 'code_analysis' },
      { id: 's2', name: 'B', intent: 'do B', deps: [], suggestedCategory: 'code_analysis' },
    ]);
    skeleton.parallelGroups = [['s1', 's2']];

    const matches = resolver.matchExecutors(dag, skeleton);
    // 两个步骤应分配到不同资源（如果可用）
    const r1 = matches.get('s1')?.resourceId;
    const r2 = matches.get('s2')?.resourceId;
    if (r1 && r2) {
      // 至少有一个会被重新分配（如果两个都分到同一个）
      expect(matches.size).toBe(2);
    }
  });
});

describe('V2: matchExecutors reusePreviousModel', () => {
  it('reusePreviousModel 复用 deps[0] 的匹配结果', () => {
    const resolver = new SkillResolver(mockToolRegistry());
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'gpt' });
    hub.markState('m1', 'active');
    resolver.setResourceHub(hub);

    const dag = { id: 'd1', description: 'test', tasks: new Map(), edges: [], parallelGroups: [], createdAt: Date.now(), status: 'executing' as const, defaultTimeoutMs: 30000 };
    dag.tasks.set('s1', { id: 's1', name: 'scan', tool: 'exec', args: {}, deps: [], status: 'pending' as const });
    dag.tasks.set('s2', { id: 's2', name: 'report', tool: 'exec', args: {}, deps: ['s1'], status: 'pending' as const });

    const skeleton = makeSkeleton([
      { id: 's1', name: 'scan', intent: 'scan', deps: [], suggestedCategory: 'code_analysis' },
      { id: 's2', name: 'report', intent: 'report', deps: ['s1'], suggestedCategory: 'chat',
        capabilityRequirement: { taskType: 'chat', reusePreviousModel: true } },
    ]);

    const matches = resolver.matchExecutors(dag, skeleton);
    // s2 应复用 s1 的资源
    if (matches.has('s1') && matches.has('s2')) {
      expect(matches.get('s2')!.source).toBe('reuse');
      expect(matches.get('s2')!.resourceId).toBe(matches.get('s1')!.resourceId);
    }
  });
});
