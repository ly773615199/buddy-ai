import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageProcessor } from './message-processor.js';
import type { Subsystems } from './subsystems.js';
import type { SkillOps } from './skill-ops.js';
import type { BuddyConfig } from '../types.js';
import type { LRUCache } from '../perf/cache.js';

// ==================== Mock 工厂 ====================

function makeMockSubsystems(overrides: Record<string, unknown> = {}): Subsystems {
  return {
    pet: {
      getIntimacy: () => 50,
      getBehaviorSignals: () => ({ snark: 5, wisdom: 5, chaos: 3, patience: 7, debugging: 4 }),
      getOcean: () => undefined,
      getPersonalityStrength: () => 1,
      getData: () => ({ evolutionStage: 'developing' }),
      trackFeature: vi.fn(),
    },
    tools: {
      listForPermissions: () => [],
      get: vi.fn(),
    },
    toolRetriever: {
      indexTools: vi.fn(),
      getToolsForPrompt: () => [],
    },
    intentClassifier: {
      classify: vi.fn(() => ({ confidence: 0.3, category: 'complex_task' })),
      filterTools: vi.fn((_tools: any) => []),
    },
    memory: {
      getRecentMessages: () => [],
      searchMemories: () => [],
      addDiaryEntry: vi.fn(),
      getRelation: vi.fn(() => 0),
      setRelation: vi.fn(),
    },
    emotion: {
      getMood: () => 'neutral',
      getPromptInjection: () => '',
      getState: () => ({ satisfaction: 50 }),
    },
    desire: {
      getVector: () => ({ curiosity: 5, productivity: 5, social: 3 }),
    },
    cognitive: {
      getUserPromptFragment: () => '用户画像',
      getSelfPromptFragment: () => '自我认知',
      getDomainProfile: () => ({ growthStage: 'seed', domainType: 'general', depthScore: 0.1 }),
    },
    stmp: {
      retrieve: vi.fn(async () => ({ primary: [], associative: [], room: null })),
      locateRoom: () => null,
      insertNode: vi.fn(),
      upsertEdge: vi.fn(),
    },
    intelligence: {
      graph: {
        match: vi.fn(() => []),
      },
      process: vi.fn(),
      learn: vi.fn(),
      evolver: { canCompile: () => true },
    },
    llm: {
      chat: vi.fn(),
      streamChat: vi.fn(),
    },
    dagPlanner: { plan: vi.fn() },
    taskExecutor: { execute: vi.fn() },
    interviewer: {
      analyzeAndDecide: vi.fn(),
      isAnswerToInterview: vi.fn(),
      recordAnswered: vi.fn(),
      resetSession: vi.fn(),
    },
    skillManager: { listSkills: () => [] },
    extractor: { extract: vi.fn() },
    subscriptionManager: { recordExtraction: () => ({ allowed: true }) },
    knowledgeSourceManager: {
      getStats: () => ({ totalSources: 0 }),
      query: vi.fn(async () => []),
    },
    ...overrides,
  } as unknown as Subsystems;
}

function makeMockSkillOps(): SkillOps {
  return {
    getPromptInjection: () => '',
    tryCreatePackage: vi.fn(),
    checkAutoSnapshots: vi.fn(),
  } as unknown as SkillOps;
}

function makeMockConfig(overrides: Record<string, unknown> = {}): BuddyConfig {
  return {
    models: {
      providers: [{ id: 'openai', type: 'openai' as const, model: 'gpt-4o', apiKey: 'test' }],
    },
    ...overrides,
  } as BuddyConfig;
}

function makeMockMemoryCache(): LRUCache<string> {
  return {
    get: vi.fn(() => null),
    set: vi.fn(),
  } as unknown as LRUCache<string>;
}

function createProcessor(overrides: Record<string, unknown> = {}) {
  const sys = overrides.sys as Subsystems ?? makeMockSubsystems();
  const skillOps = (overrides.skillOps as SkillOps) ?? makeMockSkillOps();
  const config = overrides.config as BuddyConfig ?? makeMockConfig();
  const memoryCache = overrides.memoryCache as LRUCache<string> ?? makeMockMemoryCache();
  return new MessageProcessor(sys, skillOps, config, memoryCache, false);
}

// ==================== P7: compressMessages ====================

describe('P7: compressMessages 消息历史压缩', () => {
  const compress = (messages: Array<{ role: string; content: string; timestamp: number }>, keepRecent?: number) =>
    (MessageProcessor as any).compressMessages(messages, keepRecent) as Array<{ role: string; content: string; timestamp: number }>;

  it('最近 keepRecent 条保持原样', () => {
    const messages = [
      { role: 'user', content: '短消息', timestamp: 1 },
      { role: 'assistant', content: '短回复', timestamp: 2 },
      { role: 'user', content: '最新消息', timestamp: 3 },
    ];
    const result = compress(messages, 2);
    expect(result[1].content).toBe('短回复');
    expect(result[2].content).toBe('最新消息');
  });

  it('工具结果消息 > 500 字符截断到 TOOL_RESULT_LIMITS.maxCompressed (200)', () => {
    const longToolResult = '工具 ' + 'x'.repeat(600);
    const messages = [
      { role: 'user', content: longToolResult, timestamp: 1 },
      { role: 'assistant', content: '最新回复', timestamp: 2 },
    ];
    const result = compress(messages, 1);
    expect(result[0].content.length).toBeLessThan(longToolResult.length);
    expect(result[0].content).toContain('[已压缩]');
    expect(result[0].content.length).toBeLessThanOrEqual(220); // 200 + '\n... [已压缩]'
  });

  it('工具结果消息 <= 500 字符不截断', () => {
    const shortToolResult = '工具 ' + 'x'.repeat(100);
    const messages = [
      { role: 'user', content: shortToolResult, timestamp: 1 },
      { role: 'assistant', content: '最新回复', timestamp: 2 },
    ];
    const result = compress(messages, 1);
    expect(result[0].content).toBe(shortToolResult);
  });

  it('长消息 > 300 字符截断到 150 + "... [已截断]"', () => {
    const longMsg = 'a'.repeat(400);
    const messages = [
      { role: 'assistant', content: longMsg, timestamp: 1 },
      { role: 'user', content: '最新', timestamp: 2 },
    ];
    const result = compress(messages, 1);
    expect(result[0].content).toContain('[已截断]');
    expect(result[0].content.length).toBeLessThanOrEqual(165); // 150 + '... [已截断]'
  });

  it('短消息不截断', () => {
    const shortMsg = 'hello world';
    const messages = [
      { role: 'assistant', content: shortMsg, timestamp: 1 },
      { role: 'user', content: '最新', timestamp: 2 },
    ];
    const result = compress(messages, 1);
    expect(result[0].content).toBe(shortMsg);
  });

  it('默认 keepRecent=5', () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: '消息 ' + i,
      timestamp: i,
    }));
    const result = compress(messages);
    // 后 5 条保持原样
    expect(result[9].content).toBe('消息 9');
    expect(result[8].content).toBe('消息 8');
    expect(result[7].content).toBe('消息 7');
    expect(result[6].content).toBe('消息 6');
    expect(result[5].content).toBe('消息 5');
  });

  it('消息数少于 keepRecent 时全部保持原样', () => {
    const messages = [
      { role: 'user', content: 'a'.repeat(400), timestamp: 1 },
    ];
    const result = compress(messages, 5);
    expect(result[0].content).toBe('a'.repeat(400));
  });

  it('工具结果和长消息规则不冲突 — 工具结果优先走压缩规则', () => {
    const toolMsg = '工具 ' + 'y'.repeat(600);
    const messages = [
      { role: 'user', content: toolMsg, timestamp: 1 },
      { role: 'user', content: '最新', timestamp: 2 },
    ];
    const result = compress(messages, 1);
    expect(result[0].content).toContain('[已压缩]');
    expect(result[0].content).not.toContain('[已截断]');
  });

  it('非 user 角色的长消息不走工具结果规则', () => {
    const longAssistant = '工具 ' + 'z'.repeat(600); // role=assistant，不走工具结果规则
    const messages = [
      { role: 'assistant', content: longAssistant, timestamp: 1 },
      { role: 'user', content: '最新', timestamp: 2 },
    ];
    const result = compress(messages, 1);
    // assistant 角色走长消息规则而非工具结果规则
    expect(result[0].content).toContain('[已截断]');
    expect(result[0].content).not.toContain('[已压缩]');
  });

  it('正好 300 字符的消息不截断', () => {
    const exact300 = 'b'.repeat(300);
    const messages = [
      { role: 'assistant', content: exact300, timestamp: 1 },
      { role: 'user', content: '最新', timestamp: 2 },
    ];
    const result = compress(messages, 1);
    expect(result[0].content).toBe(exact300);
  });

  it('正好 301 字符的消息被截断', () => {
    const msg301 = 'c'.repeat(301);
    const messages = [
      { role: 'assistant', content: msg301, timestamp: 1 },
      { role: 'user', content: '最新', timestamp: 2 },
    ];
    const result = compress(messages, 1);
    expect(result[0].content).toContain('[已截断]');
  });

  it('工具结果 <= 500 字符但 > 300 字符走长消息截断规则', () => {
    const toolMsg = '工具 ' + 'd'.repeat(400); // ~402 chars, > 300 but <= 500
    const messages = [
      { role: 'user', content: toolMsg, timestamp: 1 },
      { role: 'user', content: '最新', timestamp: 2 },
    ];
    const result = compress(messages, 1);
    // 不走工具结果压缩（<= 500），但走长消息截断（> 300）
    expect(result[0].content).toContain('[已截断]');
    expect(result[0].content).not.toContain('[已压缩]');
  });

  it('工具结果 <= 300 字符不截断', () => {
    const toolMsg = '工具 ' + 'd'.repeat(200); // ~202 chars, <= 300
    const messages = [
      { role: 'user', content: toolMsg, timestamp: 1 },
      { role: 'user', content: '最新', timestamp: 2 },
    ];
    const result = compress(messages, 1);
    expect(result[0].content).toBe(toolMsg);
  });

  it('空消息列表返回空', () => {
    const result = compress([]);
    expect(result).toEqual([]);
  });

  it('返回新数组，不修改原始消息', () => {
    const original = { role: 'assistant', content: 'a'.repeat(400), timestamp: 1 };
    const messages = [original, { role: 'user', content: '最新', timestamp: 2 }];
    const result = compress(messages, 1);
    expect(original.content).toBe('a'.repeat(400)); // 原始不变
    expect(result[0].content).not.toBe(original.content); // 新对象
  });
});

// ==================== P1: assessComplexity ====================

describe('P1: assessComplexity 自动 DAG 检测', () => {
  const assess = (content: string) => {
    const processor = createProcessor();
    return (processor as any).assessComplexity(content) as { shouldUseDAG: boolean; reason: string };
  };

  it('短消息 (<30 chars) → shouldUseDAG=false', () => {
    expect(assess('你好').shouldUseDAG).toBe(false);
    expect(assess('帮我读取 config.json').shouldUseDAG).toBe(false);
    expect(assess('hi').shouldUseDAG).toBe(false);
  });

  it('markerCount >= 3 时 shouldUseDAG=true', () => {
    const result = assess('先读取项目配置文件，然后修改源代码中的内容，最后保存所有的文件到磁盘');
    expect(result.shouldUseDAG).toBe(true);
    expect(result.reason).toContain('markers=');
  });

  it('hasParallel 时 shouldUseDAG=true', () => {
    const result = assess('请同时读取项目中的所有配置文件和搜索代码库中的关键字并行处理两边的结果');
    expect(result.shouldUseDAG).toBe(true);
    expect(result.reason).toContain('parallel=true');
  });

  it('clauses >= 4 时 shouldUseDAG=true', () => {
    const result = assess('读取项目配置文件，搜索代码中的引用，分析模块依赖关系，生成完整的报告');
    expect(result.shouldUseDAG).toBe(true);
    expect(result.reason).toContain('clauses=');
  });

  it('多个文件路径 (>=2) → shouldUseDAG=true', () => {
    const result = assess('请帮我分析 src/app.ts 和 src/config.json 这两个文件的关系以及依赖');
    expect(result.shouldUseDAG).toBe(true);
    expect(result.reason).toContain('multiPath');
  });

  it('简单请求 shouldUseDAG=false', () => {
    const result = assess('你好');
    expect(result.shouldUseDAG).toBe(false);
    expect(result.reason).toBe('');
  });

  it('单步骤请求 shouldUseDAG=false', () => {
    const result = assess('帮我读取 config.json');
    expect(result.shouldUseDAG).toBe(false);
  });

  it('英文并行标记也能检测', () => {
    const result = assess('read the file together with searching code and process the results');
    expect(result.shouldUseDAG).toBe(true);
  });

  it('英文多步骤标记也能检测', () => {
    const result = assess('first read the file, and then search code, finally save results');
    expect(result.shouldUseDAG).toBe(true);
  });

  it('条件语句 + 多子句 → shouldUseDAG=true', () => {
    const result = assess('如果文件存在，就读取内容，然后解析配置，否则创建默认配置文件');
    expect(result.shouldUseDAG).toBe(true);
    expect(result.reason).toContain('conditional');
  });

  it('批量指示 → shouldUseDAG=true', () => {
    const result = assess('请帮我把所有项目的 README 文件都检查一遍并更新其中的版本号');
    expect(result.shouldUseDAG).toBe(true);
    expect(result.reason).toContain('batch');
  });

  it('正好 30 字符的非触发消息 → shouldUseDAG=false', () => {
    // 'a' * 30 = 30 chars, no markers
    const result = assess('a'.repeat(30));
    expect(result.shouldUseDAG).toBe(false);
  });

  it('29 字符消息 → shouldUseDAG=false (即使有标记词)', () => {
    // 短消息直接跳过，即使包含 "然后"
    const result = assess('先A然后B然后C');
    // 这个不到30 chars，直接跳过
    expect(result.shouldUseDAG).toBe(false);
  });

  it('英文 after that, next, also 检测', () => {
    const result = assess('after that read the file, also check the config, next parse the output, and then write results');
    expect(result.shouldUseDAG).toBe(true);
  });

  it('along with 并行标记', () => {
    const result = assess('analyze the code along with checking the dependencies and review test coverage for the module');
    expect(result.shouldUseDAG).toBe(true);
  });
});

// ==================== extractConcepts ====================

describe('extractConcepts 概念提取', () => {
  const extract = (text: string) => {
    const processor = createProcessor();
    return (processor as any).extractConcepts(text) as string[];
  };

  it('按标点和空白分割', () => {
    const result = extract('hello world, foo bar');
    expect(result).toContain('hello');
    expect(result).toContain('world');
    expect(result).toContain('foo');
    expect(result).toContain('bar');
  });

  it('过滤长度 < 2 的 token', () => {
    const result = extract('I am a go developer');
    // 'I' (1 char) 和 'a' (1 char) 应被过滤
    expect(result).not.toContain('I');
    expect(result).not.toContain('a');
    expect(result).toContain('am');
    expect(result).toContain('go'); // 'go' 长度=2，保留
    expect(result).toContain('developer');
  });

  it('移除停用词', () => {
    const result = extract('the quick brown fox is a clever animal');
    // 停用词: the, a, is
    expect(result).not.toContain('the');
    expect(result).not.toContain('a');
    expect(result).not.toContain('is');
    expect(result).toContain('quick');
    expect(result).toContain('brown');
    expect(result).toContain('fox');
    expect(result).toContain('clever');
    expect(result).toContain('animal');
  });

  it('中文停用词也被移除', () => {
    const result = extract('的 了 是 在 我 有 和 就 不 请 帮 能 吗 呢 吧 啊');
    // 所有中文停用词都应被过滤（长度 < 2 或是停用词）
    expect(result).toHaveLength(0);
  });

  it('返回最多 8 个唯一 token', () => {
    const result = extract('alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu');
    expect(result.length).toBeLessThanOrEqual(8);
  });

  it('去重', () => {
    const result = extract('hello hello world world hello');
    const helloCount = result.filter(t => t === 'hello').length;
    const worldCount = result.filter(t => t === 'world').length;
    expect(helloCount).toBe(1);
    expect(worldCount).toBe(1);
  });

  it('中文标点符号被正确分割', () => {
    const result = extract('你好世界，测试代码！分析结果？');
    expect(result).toContain('你好世界');
    expect(result).toContain('测试代码');
    expect(result).toContain('分析结果');
  });

  it('空字符串返回空数组', () => {
    const result = extract('');
    expect(result).toEqual([]);
  });

  it('纯停用词返回空数组', () => {
    const result = extract('the a an is are was');
    expect(result).toEqual([]);
  });

  it('大小写不敏感的停用词过滤', () => {
    const result = extract('The QUICK Brown FOX');
    expect(result).not.toContain('The'); // 'The' 小写后 'the' 是停用词
    expect(result).toContain('QUICK');
    expect(result).toContain('Brown');
    expect(result).toContain('FOX');
  });

  it('混合中英文', () => {
    const result = extract('使用 Python 编写 machine learning 模型');
    expect(result).toContain('使用');
    expect(result).toContain('Python');
    expect(result).toContain('编写');
    expect(result).toContain('machine');
    expect(result).toContain('learning');
    expect(result).toContain('模型');
  });

  it('大括号、尖括号等特殊标点也分割', () => {
    const result = extract('function<Type>(arg) { return value; }');
    expect(result).toContain('function');
    expect(result).toContain('Type');
    expect(result).toContain('arg');
    expect(result).toContain('return');
    expect(result).toContain('value');
  });
});

// ==================== estimateContextWindow ====================

describe('estimateContextWindow 上下文窗口估算', () => {
  const estimate = (provider: string) => {
    const processor = createProcessor({ config: makeMockConfig({ models: { providers: [{ id: provider, type: provider, model: 'test' }] } }) });
    return (processor as any).estimateContextWindow() as number;
  };

  it('openai → 128000', () => {
    expect(estimate('openai')).toBe(128000);
  });

  it('anthropic → 200000', () => {
    expect(estimate('anthropic')).toBe(200000);
  });

  it('google → 1000000', () => {
    expect(estimate('google')).toBe(1000000);
  });

  it('deepseek → 64000', () => {
    expect(estimate('deepseek')).toBe(64000);
  });

  it('ollama → 32000', () => {
    expect(estimate('ollama')).toBe(32000);
  });

  it('mimo → 32000', () => {
    expect(estimate('mimo')).toBe(32000);
  });

  it('custom → 32000', () => {
    expect(estimate('custom')).toBe(32000);
  });

  it('未知 provider 默认 32000', () => {
    expect(estimate('unknown_provider_xyz')).toBe(32000);
    expect(estimate('')).toBe(32000);
    expect(estimate('some-new-llm')).toBe(32000);
  });
});

// ==================== P0: speculativePrefetch ====================

describe('P0: speculativePrefetch 投机预执行', () => {
  it('高置信度经验的只读工具被预取', async () => {
    const mockExecute = vi.fn(async () => 'file content');
    const sys = makeMockSubsystems({
      intelligence: {
        graph: {
          match: vi.fn(() => [{
            id: 'exp-1',
            abstractionLevel: 'concrete',
            trigger: { keywords: ['读取', 'config'] },
            steps: [{ tool: 'read_file', args: { path: '/config.json' } }],
            stats: { confidence: 0.95, successCount: 5 },
          }]),
        },
      },
      tools: {
        listForPermissions: () => [],
        get: vi.fn(() => ({ execute: mockExecute })),
      },
    });

    const processor = createProcessor({ sys });
    const count = await (processor as any).speculativePrefetch('读取配置文件') as number;

    expect(count).toBeGreaterThanOrEqual(1);
    expect(mockExecute).toHaveBeenCalled();
  });

  it('低置信度经验不预取', async () => {
    const mockExecute = vi.fn(async () => 'result');
    const sys = makeMockSubsystems({
      intelligence: {
        graph: {
          match: vi.fn(() => [{
            id: 'exp-low',
            abstractionLevel: 'concrete',
            steps: [{ tool: 'read_file', args: { path: '/a.txt' } }],
            stats: { confidence: 0.3, successCount: 1 },
          }]),
        },
      },
      tools: {
        listForPermissions: () => [],
        get: vi.fn(() => ({ execute: mockExecute })),
      },
    });

    const processor = createProcessor({ sys });
    const count = await (processor as any).speculativePrefetch('测试') as number;

    expect(count).toBe(0);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('非只读工具不预取', async () => {
    const mockExecute = vi.fn(async () => 'result');
    const sys = makeMockSubsystems({
      intelligence: {
        graph: {
          match: vi.fn(() => [{
            id: 'exp-write',
            abstractionLevel: 'concrete',
            steps: [{ tool: 'write_file', args: { path: '/a.txt', content: 'x' } }],
            stats: { confidence: 0.95, successCount: 5 },
          }]),
        },
      },
      tools: {
        listForPermissions: () => [],
        get: vi.fn(() => ({ execute: mockExecute })),
      },
    });

    const processor = createProcessor({ sys });
    const count = await (processor as any).speculativePrefetch('写入文件') as number;

    expect(count).toBe(0);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('无匹配经验时返回 0', async () => {
    const sys = makeMockSubsystems({
      intelligence: { graph: { match: vi.fn(() => []) } },
    });
    const processor = createProcessor({ sys });
    const count = await (processor as any).speculativePrefetch('无匹配') as number;
    expect(count).toBe(0);
  });

  it('READONLY_TOOLS 白名单包含预期工具', () => {
    const readonlyTools = (MessageProcessor as any).READONLY_TOOLS as Set<string>;
    expect(readonlyTools.has('read_file')).toBe(true);
    expect(readonlyTools.has('git_status')).toBe(true);
    expect(readonlyTools.has('search_files')).toBe(true);
    expect(readonlyTools.has('write_file')).toBe(false);
    expect(readonlyTools.has('exec')).toBe(false);
  });
});

// ==================== validateToolCalls ====================

describe('validateToolCalls 工具验证', () => {
  const validate = (
    toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }>,
    availableTools: Array<{ name: string; description: string; parameters: any; execute: any }>,
    maxRetries?: number,
  ) => {
    const processor = createProcessor();
    return (processor as any).validateToolCalls(toolCalls, availableTools, maxRetries) as typeof toolCalls;
  };

  it('工具存在且参数合法 → 通过', () => {
    const zodSchema = { parse: (v: any) => v, strip: () => ({ parse: (v: any) => v }) };
    const result = validate(
      [{ name: 'read_file', args: { path: '/a.txt' }, result: '' }],
      [{ name: 'read_file', description: '读文件', parameters: zodSchema, execute: vi.fn() }],
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('read_file');
  });

  it('工具不存在 → 尝试找相似工具降级（名称包含关系）', () => {
    const zodSchema = { parse: (v: any) => v, strip: () => ({ parse: (v: any) => v }) };
    const result = validate(
      [{ name: 'read', args: { path: '/a.txt' }, result: '' }],
      [{ name: 'read_file', description: '读文件', parameters: zodSchema, execute: vi.fn() }],
      1,
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('read_file');
    expect(result[0].result).toContain('自动修正');
  });

  it('工具不存在且无相似替代 → 跳过', () => {
    const result = validate(
      [{ name: 'totally_unknown_tool', args: {}, result: '' }],
      [{ name: 'read_file', description: '读文件', parameters: undefined, execute: vi.fn() }],
      1,
    );
    expect(result).toHaveLength(0);
  });

  it('工具不存在时通过 description 匹配相似工具', () => {
    // 源码: t.description.toLowerCase().includes(tc.name.toLowerCase())
    // description 需要包含调用的工具名
    const result = validate(
      [{ name: 'viewer', args: { path: '/a.txt' }, result: '' }],
      [{ name: 'read_file', description: 'a file viewer tool', parameters: undefined, execute: vi.fn() }],
      1,
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('read_file');
  });

  it('参数不合法 → 尝试修复（strip 多余字段）', () => {
    const zodSchema = {
      parse: (v: any) => { if (v.extra !== undefined) throw new Error('extra field'); return v; },
      strip: () => ({ parse: (v: any) => v }),
    };
    const result = validate(
      [{ name: 'read_file', args: { path: '/a.txt', extra: 'bad' }, result: '' }],
      [{ name: 'read_file', description: '读文件', parameters: zodSchema, execute: vi.fn() }],
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('read_file');
  });

  it('参数不合法且无法修复 → 跳过', () => {
    const zodSchema = {
      parse: () => { throw new Error('invalid'); },
      strip: () => ({ parse: () => { throw new Error('still invalid'); } }),
    };
    const result = validate(
      [{ name: 'read_file', args: { bad: true }, result: '' }],
      [{ name: 'read_file', description: '读文件', parameters: zodSchema, execute: vi.fn() }],
    );
    expect(result).toHaveLength(0);
  });

  it('工具无 parameters schema → 直接通过', () => {
    const result = validate(
      [{ name: 'git_status', args: {}, result: '' }],
      [{ name: 'git_status', description: 'git 状态', parameters: undefined, execute: vi.fn() }],
    );
    expect(result).toHaveLength(1);
  });

  it('maxRetries=0 时不尝试降级', () => {
    const result = validate(
      [{ name: 'read_fle', args: {}, result: '' }],
      [{ name: 'read_file', description: '读文件', parameters: undefined, execute: vi.fn() }],
      0,
    );
    expect(result).toHaveLength(0);
  });

  it('多个工具调用逐一验证', () => {
    const zodSchema = { parse: (v: any) => v, strip: () => ({ parse: (v: any) => v }) };
    const result = validate(
      [
        { name: 'read_file', args: { path: '/a.txt' }, result: '' },
        { name: 'unknown_tool', args: {}, result: '' },
        { name: 'git_status', args: {}, result: '' },
      ],
      [
        { name: 'read_file', description: '读文件', parameters: zodSchema, execute: vi.fn() },
        { name: 'git_status', description: 'git 状态', parameters: undefined, execute: vi.fn() },
      ],
    );
    expect(result).toHaveLength(2);
    expect(result.map(t => t.name)).toEqual(['read_file', 'git_status']);
  });

  it('空工具调用列表返回空', () => {
    const result = validate([], [{ name: 'read_file', description: 'd', parameters: undefined, execute: vi.fn() }]);
    expect(result).toEqual([]);
  });

  it('空可用工具列表时所有调用被跳过', () => {
    const result = validate(
      [{ name: 'read_file', args: {}, result: '' }],
      [],
    );
    expect(result).toHaveLength(0);
  });

  it('相似工具匹配时 result 被标记为自动修正', () => {
    const result = validate(
      [{ name: 'list', args: {}, result: '' }],
      [{ name: 'list_files', description: 'list', parameters: undefined, execute: vi.fn() }],
      1,
    );
    expect(result).toHaveLength(1);
    // result 消息格式: [自动修正: 原工具 "list" 不存在]
    expect(result[0].result).toContain('自动修正');
    expect(result[0].result).toContain('list');
    // name 被替换为相似工具
    expect(result[0].name).toBe('list_files');
  });
});

// ==================== P2: buildContext 分层缓存 ====================

describe('P2: buildContext 分层缓存', () => {
  it('静态层：信任度不变时不重建核心 Prompt', async () => {
    const buildSystemPrompt = vi.fn(() => 'system prompt');
    const getToolsForPrompt = vi.fn(() => []);

    vi.mock('../personality/prompt.js', () => ({
      buildSystemPrompt,
      buildMessages: vi.fn(() => []),
    }));

    const sys = makeMockSubsystems({
      pet: {
        getIntimacy: () => 50,
        getBehaviorSignals: () => ({ snark: 5, wisdom: 5, chaos: 3, patience: 7, debugging: 4 }),
        getOcean: () => undefined,
        getPersonalityStrength: () => 1,
        getData: () => ({ evolutionStage: 'developing' }),
        trackFeature: vi.fn(),
      },
      tools: {
        listForPermissions: () => [{ name: 'read_file', description: 'd', parameters: {}, execute: vi.fn() }],
        get: vi.fn(),
      },
      toolRetriever: { indexTools: vi.fn(), getToolsForPrompt },
      intentClassifier: {
        classify: vi.fn(() => ({ confidence: 0.3, category: 'complex_task' })),
        filterTools: vi.fn(() => []),
      },
      memory: {
        getRecentMessages: () => [],
        searchMemories: () => [],
        addDiaryEntry: vi.fn(),
        getRelation: vi.fn(() => 0),
        setRelation: vi.fn(),
      },
      emotion: { getMood: () => 'neutral', getPromptInjection: () => '', getState: () => ({ satisfaction: 50 }) },
      desire: { getVector: () => ({}) },
      cognitive: { getUserPromptFragment: () => '', getSelfPromptFragment: () => '', getDomainProfile: () => ({ growthStage: 'seed', depthScore: 0.1 }) },
      stmp: {
        retrieve: vi.fn(async () => ({ primary: [], associative: [], room: null })),
        locateRoom: () => null, insertNode: vi.fn(), upsertEdge: vi.fn(),
      },
      intelligence: { graph: { match: vi.fn(() => []) } },
      skillManager: { listSkills: () => [] },
    });

    const processor = createProcessor({ sys });

    await (processor as any).buildContext('测试消息');
    const firstCallCount = buildSystemPrompt.mock.calls.length;

    await (processor as any).buildContext('另一条消息');
    expect(buildSystemPrompt.mock.calls.length).toBe(firstCallCount);

    vi.restoreAllMocks();
  });

  it('半动态层：每 10 次交互更新认知画像', async () => {
    vi.mock('../personality/prompt.js', () => ({
      buildSystemPrompt: vi.fn(() => 'prompt'),
      buildMessages: vi.fn(() => []),
    }));

    const getUserPromptFragment = vi.fn(() => '用户认知');
    const sys = makeMockSubsystems({
      pet: {
        getIntimacy: () => 50,
        getBehaviorSignals: () => ({ snark: 5, wisdom: 5, chaos: 3, patience: 7, debugging: 4 }),
        getOcean: () => undefined, getPersonalityStrength: () => 1,
        getData: () => ({ evolutionStage: 'developing' }), trackFeature: vi.fn(),
      },
      tools: { listForPermissions: () => [], get: vi.fn() },
      toolRetriever: { indexTools: vi.fn(), getToolsForPrompt: () => [] },
      intentClassifier: {
        classify: vi.fn(() => ({ confidence: 0.3, category: 'complex_task' })),
        filterTools: vi.fn(() => []),
      },
      memory: {
        getRecentMessages: () => [], searchMemories: () => [],
        addDiaryEntry: vi.fn(), getRelation: vi.fn(() => 0), setRelation: vi.fn(),
      },
      emotion: { getMood: () => 'neutral', getPromptInjection: () => '', getState: () => ({ satisfaction: 50 }) },
      desire: { getVector: () => ({}) },
      cognitive: { getUserPromptFragment, getSelfPromptFragment: () => '', getDomainProfile: () => ({ growthStage: 'seed', depthScore: 0.1 }) },
      stmp: {
        retrieve: vi.fn(async () => ({ primary: [], associative: [], room: null })),
        locateRoom: () => null, insertNode: vi.fn(), upsertEdge: vi.fn(),
      },
      intelligence: { graph: { match: vi.fn(() => []) } },
      skillManager: { listSkills: () => [] },
    });

    const processor = createProcessor({ sys });

    for (let i = 0; i < 9; i++) {
      await (processor as any).buildContext(`消息 ${i}`);
    }
    const before = getUserPromptFragment.mock.calls.length;

    await (processor as any).buildContext('第10条消息');
    expect(getUserPromptFragment.mock.calls.length).toBeGreaterThan(before);

    vi.restoreAllMocks();
  });
});
