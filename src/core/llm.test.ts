/**
 * LLMAdapter 单元测试 — 精简版
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ai', () => ({
  generateText: vi.fn(async () => ({ text: 'mock response', steps: [] })),
  generateObject: vi.fn(async () => ({ object: { answer: '42' } })),
  streamText: vi.fn(() => ({
    textStream: (async function* () { yield 'stream'; yield ' text'; })(),
    steps: Promise.resolve([]),
  })),
  tool: vi.fn((opts: any) => opts),
  stepCountIs: vi.fn((n: number) => ({ type: 'step-count', maxSteps: n })),
}));

vi.mock('./provider-registry.js', () => ({
  ProviderFactory: {
    create: vi.fn(() => ({
      model: { id: 'mock-model' },
      capabilities: {
        toolCalling: true, streaming: true, structuredOutput: true, vision: false,
        needsPromptToolCalling: false, maxContextTokens: 4096, maxOutputTokens: 2048,
      },
    })),
  },
  getPreprocessor: vi.fn(() => ({
    process: vi.fn((msgs: any[]) => msgs.map(m => ({ role: m.role, content: m.content }))),
  })),
}));

vi.mock('./response-normalizer.js', () => ({
  ResponseNormalizer: {
    normalize: vi.fn((text: string) => text),
    normalizeAIStep: vi.fn((result: any) => ({
      text: result?.text ?? 'mock',
      toolCalls: result?.steps?.flatMap((s: any) => s?.toolCalls ?? []) ?? [],
    })),
  },
}));

vi.mock('./universal-tool-caller.js', () => {
  class UTC { constructor() { return { execute: vi.fn(async () => 'tool result') }; } }
  return { UniversalToolCaller: UTC };
});

vi.mock('./model-router.js', () => {
  class MR {
    constructor() {
      return {
        select: vi.fn(() => ({
          id: 'deepseek-chat', provider: 'deepseek', model: 'deepseek-chat',
          capabilities: { toolCalling: true, streaming: true, structuredOutput: true, needsPromptToolCalling: false },
          source: 'default',
        })),
        recordOutcome: vi.fn(),
        getSummary: vi.fn(() => ({
          hasPool: false, localExperts: [], userOverride: null,
        })),
        clearUserOverride: vi.fn(), setUserOverride: vi.fn(),
        setOnSelection: vi.fn(),
        setPool: vi.fn(), getPool: vi.fn(() => null),
        setDecisionRecorder: vi.fn(), getDecisionRecorder: vi.fn(() => null),
      };
    }
  }
  return { ModelRouter: MR, inferTaskType: vi.fn(() => 'chat') };
});

vi.mock('./decision-recorder.js', () => {
  class DR { constructor() { return { record: vi.fn() }; } }
  return { DecisionRecorder: DR };
});

vi.mock('./model-pool.js', () => ({ ModelPool: vi.fn() }));
vi.mock('./model-pool-scheduler.js', () => ({ ModelPoolScheduler: vi.fn() }));

import { LLMAdapter } from './llm.js';

const cfg = {
  models: {
    providers: [{
      id: 'deepseek', type: 'deepseek' as const, model: 'deepseek-chat',
      apiKey: 'test-key', baseUrl: 'https://api.deepseek.com/v1',
    }],
  },
};

describe('LLMAdapter', () => {
  let llm: LLMAdapter;
  beforeEach(() => { vi.clearAllMocks(); llm = new LLMAdapter(cfg as any); });

  describe('初始化', () => {
    it('创建成功', () => { expect(llm).toBeDefined(); });
    it('getRouter', () => { expect(llm.getRouter()).toBeDefined(); });
    it('getModelSummary', () => { expect(llm.getModelSummary()).toBeDefined(); });
    it('getCapabilities', () => { expect(llm.getCapabilities().toolCalling).toBe(true); });
  });

  describe('chat', () => {
    it('返回 text + toolCalls', async () => {
      const r = await llm.chat([{ role: 'user', content: '你好', timestamp: Date.now() }], [], 1);
      expect(r.text).toBeDefined();
      expect(Array.isArray(r.toolCalls)).toBe(true);
    });
    it('空消息', async () => { expect(await llm.chat([], [], 1)).toBeDefined(); });
    it('userOverride', async () => {
      expect(await llm.chat([{ role: 'user', content: 't', timestamp: Date.now() }], [], 1, { userOverride: 'lw' })).toBeDefined();
    });
  });

  describe('streamChat', () => {
    it('返回结果', async () => {
      expect(await llm.streamChat([{ role: 'user', content: 'hi', timestamp: Date.now() }], [], 5, () => {})).toBeDefined();
    });
  });

  describe('熔断器', () => {
    it('初始状态', () => { expect(llm.getCircuitStatus().open).toBe(false); });
  });

  describe('setBeforeToolExecute', () => {
    it('不抛错', () => { llm.setBeforeToolExecute(vi.fn(async () => ({ allowed: true }))); });
  });

  describe('getLastUsage (Task 8.1)', () => {
    it('初始状态返回 null', () => {
      expect(llm.getLastUsage()).toBeNull();
    });
  });

  describe('semanticCompress (Task 2.2)', () => {
    // 通过类型断言访问 private 方法
    const getCompressor = () => (llm as any).semanticCompress.bind(llm) as (content: string, toolName: string) => string;

    it('exec 类型提取退出码和错误行', () => {
      const compress = getCompressor();
      const content = 'some output\nmore lines\nError: something failed\nexit code: 1\nlast line';
      const result = compress(content, 'exec');
      expect(result).toContain('exit');
      expect(result).toContain('Error');
    });

    it('write_file 类型提取路径和字节数', () => {
      const compress = getCompressor();
      const content = '已写入 /tmp/test.txt，1234 字节';
      const result = compress(content, 'write_file');
      expect(result).toContain('/tmp/test.txt');
      expect(result).toContain('1234');
    });

    it('search_files 类型提取匹配文件', () => {
      const compress = getCompressor();
      const content = 'src/a.ts\nsrc/b.ts\nsrc/c.js\n3 matches found';
      const result = compress(content, 'search_files');
      expect(result).toContain('.ts');
      expect(result).toContain('3');
    });

    it('通用类型保留前 200 字', () => {
      const compress = getCompressor();
      const content = 'x'.repeat(500);
      const result = compress(content, 'unknown_tool');
      expect(result.length).toBeLessThanOrEqual(300);
      expect(result).toContain('x');
    });
  });

  describe('compressToolHistory 生命周期 (Task 7.2)', () => {
    const getCompressor = () => (llm as any).compressToolHistory.bind(llm) as (msgs: any[], keepRecent?: number) => void;

    it('关键工具结果始终保留', () => {
      const compress = getCompressor();
      const msgs = [
        { role: 'user', content: '工具 read_file 返回: ' + 'x'.repeat(200) },
        { role: 'user', content: '工具 exec 返回: ' + 'y'.repeat(200) },
        { role: 'user', content: '工具 read_file 返回: ' + 'z'.repeat(200) },
      ];
      compress(msgs, 0);
      // read_file 不应被压缩
      expect(msgs[0].content).not.toContain('[已压缩');
      expect(msgs[2].content).not.toContain('[已压缩');
    });

    it('最近 N 条工具结果不压缩', () => {
      const compress = getCompressor();
      const msgs = [
        { role: 'user', content: '工具 exec 返回: ' + 'a'.repeat(200) },
        { role: 'user', content: '工具 exec 返回: ' + 'b'.repeat(200) },
        { role: 'user', content: '工具 exec 返回: ' + 'c'.repeat(200) },
      ];
      compress(msgs, 2);
      // 最近 2 条不压缩
      expect(msgs[1].content).not.toContain('[已压缩');
      expect(msgs[2].content).not.toContain('[已压缩');
    });

    it('旧的未引用工具结果被压缩或归档', () => {
      const compress = getCompressor();
      const msgs = [
        { role: 'user', content: '工具 exec 返回: ' + 'a'.repeat(200) },
        { role: 'user', content: '工具 exec 返回: ' + 'b'.repeat(200) },
        { role: 'user', content: '工具 exec 返回: ' + 'c'.repeat(200) },
        { role: 'user', content: '工具 exec 返回: ' + 'd'.repeat(200) },
        { role: 'user', content: '工具 exec 返回: ' + 'e'.repeat(200) },
      ];
      compress(msgs, 1);
      // 第一条（最旧）应被压缩或归档
      expect(msgs[0].content).toMatch(/\[已(压缩|归档)/);
    });
  });
});
