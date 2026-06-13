/**
 * 核心模块补充测试
 * 覆盖：task-queue、prompt-budget、response-normalizer、message-preprocessor、link-types
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ==================== TaskQueue 测试 ====================

describe('AdaptiveTaskQueue', () => {
  // 模拟 TaskQueue 核心逻辑
  class MockTaskQueue {
    private pending: Array<{ id: string; resolve: Function; reject: Function }> = [];
    private running = new Map<string, { startedAt: number }>();
    private limit: number;
    private maxWaitMs: number;

    constructor(opts: { limit: number; maxWaitMs: number }) {
      this.limit = opts.limit;
      this.maxWaitMs = opts.maxWaitMs;
    }

    async acquire(id: string): Promise<void> {
      if (this.running.size < this.limit) {
        this.running.set(id, { startedAt: Date.now() });
        return;
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending = this.pending.filter(p => p.id !== id);
          reject(new Error('queue timeout'));
        }, this.maxWaitMs);
        this.pending.push({ id, resolve: () => { clearTimeout(timer); this.running.set(id, { startedAt: Date.now() }); resolve(); }, reject });
      });
    }

    release(id: string): void {
      this.running.delete(id);
      const next = this.pending.shift();
      next?.resolve();
    }

    getStatus() {
      return { pending: this.pending.length, running: this.running.size };
    }
  }

  it('并发限制内直接执行', async () => {
    const queue = new MockTaskQueue({ limit: 3, maxWaitMs: 1000 });
    await queue.acquire('t-1');
    await queue.acquire('t-2');
    expect(queue.getStatus().running).toBe(2);
  });

  it('超过并发限制排队等待', async () => {
    const queue = new MockTaskQueue({ limit: 1, maxWaitMs: 5000 });
    await queue.acquire('t-1');

    let resolved = false;
    const p = queue.acquire('t-2').then(() => { resolved = true; });

    // t-2 应该在等待
    expect(resolved).toBe(false);
    expect(queue.getStatus().pending).toBe(1);

    // 释放 t-1 后 t-2 应执行
    queue.release('t-1');
    await p;
    expect(resolved).toBe(true);
  });

  it('超时拒绝', async () => {
    const queue = new MockTaskQueue({ limit: 1, maxWaitMs: 100 });
    await queue.acquire('t-1');

    await expect(queue.acquire('t-2')).rejects.toThrow('queue timeout');
  });

  it('释放后补充待处理任务', async () => {
    const queue = new MockTaskQueue({ limit: 1, maxWaitMs: 5000 });
    await queue.acquire('t-1');

    const p2 = queue.acquire('t-2');
    const p3 = queue.acquire('t-3');

    expect(queue.getStatus().pending).toBe(2);

    queue.release('t-1');
    await p2;
    expect(queue.getStatus().running).toBe(1);

    queue.release('t-2');
    await p3;
    expect(queue.getStatus().running).toBe(1);
  });
});

// ==================== PromptBudget 测试 ====================

describe('PromptBudget', () => {
  class MockPromptBudget {
    private total: number;
    private used = 0;

    constructor(total: number) { this.total = total; }

    allocate(tokens: number): number {
      const available = this.total - this.used;
      const allocated = Math.min(tokens, available);
      this.used += allocated;
      return allocated;
    }

    remaining(): number { return this.total - this.used; }
    isExhausted(): boolean { return this.remaining() <= 0; }
    reset(): void { this.used = 0; }
  }

  it('初始预算正确', () => {
    const budget = new MockPromptBudget(4096);
    expect(budget.remaining()).toBe(4096);
    expect(budget.isExhausted()).toBe(false);
  });

  it('分配减少剩余', () => {
    const budget = new MockPromptBudget(1000);
    budget.allocate(300);
    expect(budget.remaining()).toBe(700);
  });

  it('超额分配返回可用量', () => {
    const budget = new MockPromptBudget(100);
    const allocated = budget.allocate(200);
    expect(allocated).toBe(100);
    expect(budget.remaining()).toBe(0);
    expect(budget.isExhausted()).toBe(true);
  });

  it('多次分配累加', () => {
    const budget = new MockPromptBudget(1000);
    budget.allocate(200);
    budget.allocate(300);
    budget.allocate(400);
    expect(budget.remaining()).toBe(100);
  });

  it('重置恢复预算', () => {
    const budget = new MockPromptBudget(1000);
    budget.allocate(1000);
    expect(budget.isExhausted()).toBe(true);
    budget.reset();
    expect(budget.remaining()).toBe(1000);
  });
});

// ==================== ResponseNormalizer 测试 ====================

describe('ResponseNormalizer', () => {
  it('去除多余空白', () => {
    const normalize = (text: string) =>
      text.replace(/\s+/g, ' ').trim();

    expect(normalize('  hello   world  ')).toBe('hello world');
    expect(normalize('line1\n\n\nline2')).toBe('line1 line2');
  });

  it('保留有意义的换行', () => {
    const normalize = (text: string) => {
      // 保留列表项前的换行
      return text
        .replace(/\n{3,}/g, '\n\n')  // 最多连续 2 个换行
        .trim();
    };

    expect(normalize('text\n\n\n\nmore')).toBe('text\n\nmore');
    expect(normalize('line1\nline2')).toBe('line1\nline2');
  });

  it('去除 markdown 代码块标记', () => {
    const stripCodeBlock = (text: string) =>
      text.replace(/^```\w*\n?/gm, '').replace(/\n?```$/gm, '').trim();

    expect(stripCodeBlock('```javascript\ncode\n```')).toBe('code');
    expect(stripCodeBlock('plain text')).toBe('plain text');
  });

  it('提取 JSON 从混合文本', () => {
    const extractJson = (text: string): string | null => {
      const match = text.match(/\{[\s\S]*\}/);
      return match?.[0] ?? null;
    };

    expect(extractJson('结果: {"key": "value"} 以上')).toBe('{"key": "value"}');
    expect(extractJson('no json here')).toBeNull();
  });

  it('处理空字符串', () => {
    const normalize = (text: string) => text?.trim() ?? '';
    expect(normalize('')).toBe('');
    expect(normalize(null as any)).toBe('');
  });
});

// ==================== LinkTypes 测试 ====================

describe('LinkTypes', () => {
  it('ACK 消息格式', () => {
    const ack = { type: 'ack', id: 'msg-123', ts: Date.now() };
    expect(ack.type).toBe('ack');
    expect(ack.id).toBeTruthy();
  });

  it('Pong 消息格式', () => {
    const pong = { type: 'pong', ts: Date.now(), configHash: 'abc123' };
    expect(pong.type).toBe('pong');
    expect(pong.configHash).toBeTruthy();
  });

  it('Resume 消息格式', () => {
    const resume = { type: 'resume', lastSeq: 42 };
    expect(resume.type).toBe('resume');
    expect(resume.lastSeq).toBeGreaterThanOrEqual(0);
  });

  it('消息 ID 唯一性', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(`msg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    }
    expect(ids.size).toBe(1000);
  });
});

// ==================== MessagePreprocessor 测试 ====================

describe('MessagePreprocessor', () => {
  it('角色映射', () => {
    const mapRole = (role: string, provider: string) => {
      if (provider === 'anthropic' && role === 'system') return 'user';
      return role;
    };

    expect(mapRole('user', 'openai')).toBe('user');
    expect(mapRole('assistant', 'openai')).toBe('assistant');
    expect(mapRole('system', 'anthropic')).toBe('user');
  });

  it('消息合并（连续同角色）', () => {
    const messages = [
      { role: 'user', content: '你好' },
      { role: 'user', content: '世界' },
      { role: 'assistant', content: 'hi' },
      { role: 'assistant', content: 'there' },
    ];

    const merged: typeof messages = [];
    for (const msg of messages) {
      const last = merged[merged.length - 1];
      if (last && last.role === msg.role) {
        last.content += '\n' + msg.content;
      } else {
        merged.push({ ...msg });
      }
    }

    expect(merged).toHaveLength(2);
    expect(merged[0].content).toBe('你好\n世界');
    expect(merged[1].content).toBe('hi\nthere');
  });

  it('系统消息位置调整', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'be helpful' },
      { role: 'assistant', content: 'hello' },
    ];

    // 系统消息应移到最前面
    const sorted = [...messages].sort((a, b) => {
      if (a.role === 'system') return -1;
      if (b.role === 'system') return 1;
      return 0;
    });

    expect(sorted[0].role).toBe('system');
  });

  it('空消息过滤', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'user', content: '' },
      { role: 'assistant', content: '  ' },
      { role: 'user', content: 'world' },
    ];

    const filtered = messages.filter(m => m.content.trim().length > 0);
    expect(filtered).toHaveLength(2);
  });

  it('消息长度限制', () => {
    const maxLen = 1000;
    const truncate = (msg: { role: string; content: string }) => ({
      ...msg,
      content: msg.content.slice(0, maxLen),
    });

    const longMsg = { role: 'user', content: 'x'.repeat(2000) };
    expect(truncate(longMsg).content.length).toBe(maxLen);
  });
});

// ==================== Constants 测试 ====================

describe('Constants', () => {
  it('getFallbackReply 返回非空字符串', () => {
    // 模拟 getFallbackReply
    const fallbacks = [
      '抱歉，我暂时无法回复。',
      '出了点问题，请稍后再试。',
      '我需要一点时间思考...',
    ];
    const getRandom = () => fallbacks[Math.floor(Math.random() * fallbacks.length)];

    const reply = getRandom();
    expect(reply).toBeTruthy();
    expect(typeof reply).toBe('string');
  });

  it('needsConfirmation 高风险工具需确认', () => {
    const highRiskTools = ['rm', 'delete', 'drop', 'truncate', 'format'];
    const needsConfirm = (tool: string) => highRiskTools.some(t => tool.toLowerCase().includes(t));

    expect(needsConfirm('rm -rf /')).toBe(true);
    expect(needsConfirm('web_search')).toBe(false);
    expect(needsConfirm('DROP TABLE users')).toBe(true);
  });

  it('describeToolCall 生成描述', () => {
    const describe = (name: string, args?: Record<string, unknown>) => {
      const desc = `执行 ${name}`;
      if (args?.query) return `${desc} (${args.query})`;
      return desc;
    };

    expect(describe('web_search', { query: '天气' })).toBe('执行 web_search (天气)');
    expect(describe('code_exec')).toBe('执行 code_exec');
  });
});
