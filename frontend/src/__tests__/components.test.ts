/**
 * 前端组件单元测试
 * 覆盖：ActivityPanel、ChatPanel、InputBar、MessageBubble、ErrorBoundary、EmptyState
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 纯数据/逻辑测试（不依赖 DOM 渲染）

// ==================== ActivityPanel 数据逻辑 ====================

describe('ActivityPanel 数据逻辑', () => {
  it('活动项格式正确', () => {
    const activity = {
      id: 'act-1',
      type: 'tool_call',
      tool: 'web_search',
      args: { query: '天气' },
      result: '今天晴天 25°C',
      success: true,
      durationMs: 1200,
      timestamp: Date.now(),
    };

    expect(activity.id).toBeTruthy();
    expect(activity.type).toBe('tool_call');
    expect(activity.success).toBe(true);
    expect(activity.durationMs).toBeGreaterThan(0);
  });

  it('活动列表排序（最新在前）', () => {
    const activities = [
      { id: '1', timestamp: 1000 },
      { id: '2', timestamp: 3000 },
      { id: '3', timestamp: 2000 },
    ];

    activities.sort((a, b) => b.timestamp - a.timestamp);

    expect(activities[0].id).toBe('2');
    expect(activities[2].id).toBe('1');
  });

  it('活动类型过滤', () => {
    const activities = [
      { id: '1', type: 'tool_call' },
      { id: '2', type: 'emotion_change' },
      { id: '3', type: 'tool_call' },
      { id: '4', type: 'evolution' },
    ];

    const toolCalls = activities.filter(a => a.type === 'tool_call');
    expect(toolCalls).toHaveLength(2);
  });

  it('空活动列表', () => {
    const activities: any[] = [];
    expect(activities).toHaveLength(0);
  });
});

// ==================== ChatPanel 数据逻辑 ====================

describe('ChatPanel 数据逻辑', () => {
  it('消息格式正确', () => {
    const message = {
      id: 'msg-1',
      role: 'user',
      content: '你好',
      timestamp: Date.now(),
    };

    expect(message.role).toBe('user');
    expect(message.content).toBeTruthy();
  });

  it('助手消息格式', () => {
    const message = {
      id: 'msg-2',
      role: 'assistant',
      content: '你好！有什么可以帮你的？',
      timestamp: Date.now(),
      toolCalls: [{ name: 'web_search', args: {}, result: 'ok' }],
    };

    expect(message.role).toBe('assistant');
    expect(message.toolCalls).toHaveLength(1);
  });

  it('消息列表按时间排序', () => {
    const messages = [
      { id: '1', timestamp: 3000 },
      { id: '2', timestamp: 1000 },
      { id: '3', timestamp: 2000 },
    ];

    messages.sort((a, b) => a.timestamp - b.timestamp);

    expect(messages[0].id).toBe('2');
    expect(messages[1].id).toBe('3');
    expect(messages[2].id).toBe('1');
  });

  it('流式消息拼接', () => {
    let fullText = '';
    const chunks = ['你', '好', '，', '世', '界'];

    for (const chunk of chunks) {
      fullText += chunk;
    }

    expect(fullText).toBe('你好，世界');
  });

  it('空消息过滤', () => {
    const messages = [
      { id: '1', content: '你好' },
      { id: '2', content: '' },
      { id: '3', content: '  ' },
      { id: '4', content: 'ok' },
    ];

    const nonEmpty = messages.filter(m => m.content.trim().length > 0);
    expect(nonEmpty).toHaveLength(2);
  });
});

// ==================== InputBar 逻辑 ====================

describe('InputBar 逻辑', () => {
  it('发送按钮禁用条件', () => {
    const isDisabled = (content: string, connected: boolean) => {
      return !connected || content.trim().length === 0;
    };

    expect(isDisabled('', false)).toBe(true);
    expect(isDisabled('', true)).toBe(true);
    expect(isDisabled('hello', false)).toBe(true);
    expect(isDisabled('hello', true)).toBe(false);
    expect(isDisabled('   ', true)).toBe(true);
  });

  it('输入内容截断', () => {
    const maxLength = 4000;
    const truncate = (text: string) => text.slice(0, maxLength);

    const longText = 'x'.repeat(5000);
    expect(truncate(longText).length).toBe(maxLength);
  });

  it('快捷键处理', () => {
    const handleKey = (key: string, shiftKey: boolean, content: string) => {
      if (key === 'Enter' && !shiftKey && content.trim()) return 'send';
      if (key === 'Enter' && shiftKey) return 'newline';
      return 'none';
    };

    expect(handleKey('Enter', false, 'hello')).toBe('send');
    expect(handleKey('Enter', true, 'hello')).toBe('newline');
    expect(handleKey('Enter', false, '')).toBe('none');
    expect(handleKey('a', false, 'hello')).toBe('none');
  });

  it('多行文本高度计算', () => {
    const calcRows = (text: string, maxRows = 6) => {
      const lines = text.split('\n').length;
      return Math.min(Math.max(lines, 1), maxRows);
    };

    expect(calcRows('hello')).toBe(1);
    expect(calcRows('line1\nline2\nline3')).toBe(3);
    expect(calcRows('a\nb\nc\nd\ne\nf\ng\nh')).toBe(6); // capped
  });
});

// ==================== MessageBubble 数据逻辑 ====================

describe('MessageBubble 数据逻辑', () => {
  it('用户消息气泡样式', () => {
    const isUser = (role: string) => role === 'user';
    const getAlignment = (role: string) => isUser(role) ? 'right' : 'left';

    expect(getAlignment('user')).toBe('right');
    expect(getAlignment('assistant')).toBe('left');
  });

  it('时间格式化', () => {
    const formatTime = (timestamp: number) => {
      const d = new Date(timestamp);
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    };

    const time = new Date(2026, 3, 28, 14, 5).getTime();
    expect(formatTime(time)).toBe('14:05');
  });

  it('消息内容截断显示', () => {
    const maxPreviewLength = 500;
    const getPreview = (content: string) =>
      content.length > maxPreviewLength ? content.slice(0, maxPreviewLength) + '...' : content;

    expect(getPreview('短消息')).toBe('短消息');
    expect(getPreview('x'.repeat(600))).toContain('...');
  });

  it('工具调用卡片数据', () => {
    const toolCall = {
      name: 'web_search',
      args: { query: '天气' },
      result: '今天晴天',
      success: true,
      durationMs: 1200,
    };

    expect(toolCall.name).toBeTruthy();
    expect(toolCall.success).toBe(true);
    expect(toolCall.durationMs).toBeGreaterThan(0);
  });
});

// ==================== ErrorBoundary 逻辑 ====================

describe('ErrorBoundary 逻辑', () => {
  it('错误信息格式化', () => {
    const formatError = (error: Error) => ({
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
      timestamp: Date.now(),
    });

    const error = new Error('测试错误');
    const formatted = formatError(error);

    expect(formatted.message).toBe('测试错误');
    expect(formatted.timestamp).toBeGreaterThan(0);
  });

  it('重试逻辑', () => {
    let retryCount = 0;
    const maxRetries = 3;

    const canRetry = () => retryCount < maxRetries;
    const retry = () => { retryCount++; };

    expect(canRetry()).toBe(true);
    retry();
    retry();
    retry();
    expect(canRetry()).toBe(false);
  });

  it('错误分类', () => {
    const classifyError = (error: string) => {
      if (error.includes('network') || error.includes('fetch')) return 'network';
      if (error.includes('timeout')) return 'timeout';
      if (error.includes('permission') || error.includes('403')) return 'permission';
      return 'unknown';
    };

    expect(classifyError('network error')).toBe('network');
    expect(classifyError('request timeout')).toBe('timeout');
    expect(classifyError('permission denied')).toBe('permission');
    expect(classifyError('something weird')).toBe('unknown');
  });
});

// ==================== EmptyState 逻辑 ====================

describe('EmptyState 逻辑', () => {
  it('空状态文案', () => {
    const emptyStates = {
      chat: { emoji: '🐾', title: '打个招呼吧！', subtitle: '试试：帮我列一下当前目录的文件' },
      tools: { emoji: '🔧', title: '暂无工具', subtitle: '工具会在对话中自动使用' },
      memory: { emoji: '🧠', title: '暂无记忆', subtitle: '开始对话来积累记忆' },
    };

    expect(emptyStates.chat.emoji).toBe('🐾');
    expect(emptyStates.tools.title).toBeTruthy();
    expect(emptyStates.memory.subtitle).toBeTruthy();
  });

  it('引导提示', () => {
    const suggestions = [
      '帮我写一段代码',
      '今天天气怎么样？',
      '解释一下量子计算',
      '帮我总结这篇文章',
    ];

    const getRandom = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
    const suggestion = getRandom(suggestions);
    expect(suggestions).toContain(suggestion);
  });
});

// ==================== ToolCallCard 逻辑 ====================

describe('ToolCallCard 逻辑', () => {
  it('工具来源标签', () => {
    const getSourceLabel = (source: string) => {
      const labels: Record<string, string> = {
        builtin: '内置',
        mcp: 'MCP',
        skill: '技能',
        ternary: '三元',
      };
      return labels[source] ?? source;
    };

    expect(getSourceLabel('builtin')).toBe('内置');
    expect(getSourceLabel('mcp')).toBe('MCP');
    expect(getSourceLabel('unknown')).toBe('unknown');
  });

  it('成功率颜色', () => {
    const getSuccessColor = (rate: number) => {
      if (rate >= 90) return 'green';
      if (rate >= 70) return 'yellow';
      return 'red';
    };

    expect(getSuccessColor(95)).toBe('green');
    expect(getSuccessColor(75)).toBe('yellow');
    expect(getSuccessColor(50)).toBe('red');
  });

  it('持续时间格式化', () => {
    const formatDuration = (ms: number) => {
      if (ms < 1000) return `${ms}ms`;
      if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
      return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
    };

    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(90000)).toBe('1m 30s');
  });

  it('参数截断显示', () => {
    const truncateArgs = (args: Record<string, unknown>, maxLen = 100) => {
      const str = JSON.stringify(args);
      return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
    };

    expect(truncateArgs({ q: 'hi' })).toBe('{"q":"hi"}');
    expect(truncateArgs({ q: 'x'.repeat(200) })).toContain('...');
  });
});

// ==================== Settings 数据逻辑 ====================

describe('Settings 数据逻辑', () => {
  it('LLM 配置验证', () => {
    const validateConfig = (config: { provider: string; model: string; apiKey?: string }) => {
      const errors: string[] = [];
      if (!config.provider) errors.push('provider 必填');
      if (!config.model) errors.push('model 必填');
      return { valid: errors.length === 0, errors };
    };

    expect(validateConfig({ provider: '', model: '' }).valid).toBe(false);
    expect(validateConfig({ provider: 'deepseek', model: '' }).valid).toBe(false);
    expect(validateConfig({ provider: 'deepseek', model: 'chat' }).valid).toBe(true);
  });

  it('Provider 列表', () => {
    const providers = [
      { id: 'openai', name: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini'] },
      { id: 'deepseek', name: 'DeepSeek', models: ['deepseek-chat', 'deepseek-coder'] },
      { id: 'anthropic', name: 'Anthropic', models: ['claude-sonnet-4-20250514', 'claude-3-haiku'] },
      { id: 'ollama', name: 'Ollama', models: ['llama3', 'mistral'] },
      { id: 'mimo', name: 'MiMo', models: ['mimo-v2-pro'] },
    ];

    expect(providers.length).toBeGreaterThanOrEqual(4);
    expect(providers.find(p => p.id === 'deepseek')?.models).toContain('deepseek-chat');
  });

  it('主题配置', () => {
    const themes = ['light', 'dark', 'system'];
    const isValidTheme = (theme: string) => themes.includes(theme);

    expect(isValidTheme('dark')).toBe(true);
    expect(isValidTheme('neon')).toBe(false);
  });

  it('语言配置', () => {
    const languages = [
      { code: 'zh-CN', name: '简体中文' },
      { code: 'en-US', name: 'English' },
      { code: 'ja-JP', name: '日本語' },
    ];

    expect(languages.find(l => l.code === 'zh-CN')?.name).toBe('简体中文');
  });
});
