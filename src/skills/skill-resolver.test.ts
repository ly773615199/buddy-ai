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
