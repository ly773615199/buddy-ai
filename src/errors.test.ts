/**
 * 错误分类器测试
 * 覆盖：classifyError 全部 9 种分类 + getUserFriendlyMessage
 */
import { describe, it, expect } from 'vitest';
import { classifyError, getUserFriendlyMessage, type ErrorCategory } from './errors.js';

describe('classifyError', () => {
  describe('网络错误', () => {
    it('ECONNREFUSED → network', () => {
      const e = classifyError(new Error('connect ECONNREFUSED 127.0.0.1:3000'));
      expect(e.category).toBe('network');
      expect(e.recoverable).toBe(true);
    });

    it('ECONNRESET → network', () => {
      expect(classifyError(new Error('read ECONNRESET')).category).toBe('network');
    });

    it('ENOTFOUND → network', () => {
      expect(classifyError(new Error('getaddrinfo ENOTFOUND api.example.com')).category).toBe('network');
    });

    it('fetch failed → network', () => {
      expect(classifyError(new Error('fetch failed')).category).toBe('network');
    });

    it('socket hang up → network', () => {
      expect(classifyError(new Error('socket hang up')).category).toBe('network');
    });
  });

  describe('超时错误', () => {
    it('timeout → timeout', () => {
      const e = classifyError(new Error('Request timeout after 30000ms'));
      expect(e.category).toBe('timeout');
      expect(e.recoverable).toBe(true);
    });

    it('timed out → timeout', () => {
      expect(classifyError(new Error('Connection timed out')).category).toBe('timeout');
    });

    it('ETIMEDOUT → network (E前缀匹配网络规则)', () => {
      // ETIMEDOUT 包含 ETIMED，被网络规则的 ECONN|ENOTFOUND|ETIMEDOUT 正则匹配
      expect(classifyError(new Error('connect ETIMEDOUT')).category).toBe('network');
    });

    it('纯 timeout 不带 connect → timeout', () => {
      expect(classifyError(new Error('Request timeout after 30000ms')).category).toBe('timeout');
    });
  });

  describe('认证错误', () => {
    it('401 → auth', () => {
      const e = classifyError(new Error('HTTP 401 Unauthorized'));
      expect(e.category).toBe('auth');
      expect(e.recoverable).toBe(false);
    });

    it('403 → auth', () => {
      expect(classifyError(new Error('HTTP 403 Forbidden')).category).toBe('auth');
    });

    it('invalid token → auth', () => {
      expect(classifyError(new Error('invalid_token: The access token is invalid')).category).toBe('auth');
    });

    it('API key expired → auth', () => {
      expect(classifyError(new Error('API key is expired')).category).toBe('auth');
    });

    it('authentication failed → auth', () => {
      expect(classifyError(new Error('Authentication failed')).category).toBe('auth');
    });
  });

  describe('权限错误', () => {
    it('EACCES → permission', () => {
      expect(classifyError(new Error('EACCES: permission denied')).category).toBe('permission');
    });

    it('EPERM → permission', () => {
      expect(classifyError(new Error('EPERM: operation not permitted')).category).toBe('permission');
    });

    it('access denied → permission', () => {
      expect(classifyError(new Error('access denied')).category).toBe('permission');
    });
  });

  describe('文件不存在', () => {
    it('ENOENT → not_found', () => {
      expect(classifyError(new Error("ENOENT: no such file or directory '/foo/bar'")).category).toBe('not_found');
    });

    it('404 → not_found', () => {
      expect(classifyError(new Error('HTTP 404 Not Found')).category).toBe('not_found');
    });

    it('file not found → not_found', () => {
      expect(classifyError(new Error('file not found')).category).toBe('not_found');
    });
  });

  describe('语法错误', () => {
    it('syntax error → syntax', () => {
      expect(classifyError(new Error('Syntax error in JSON')).category).toBe('syntax');
    });

    it('unexpected token → syntax', () => {
      expect(classifyError(new Error('Unexpected token } in JSON')).category).toBe('syntax');
    });

    it('parse error → syntax', () => {
      expect(classifyError(new Error('Parse error at position 5')).category).toBe('syntax');
    });

    it('invalid argument → syntax', () => {
      expect(classifyError(new Error('invalid argument: path')).category).toBe('syntax');
    });
  });

  describe('LLM 错误', () => {
    it('rate limit → llm_error', () => {
      const e = classifyError(new Error('Rate limit exceeded'));
      expect(e.category).toBe('llm_error');
      expect(e.recoverable).toBe(true);
    });

    it('429 → llm_error', () => {
      expect(classifyError(new Error('HTTP 429 Too Many Requests')).category).toBe('llm_error');
    });

    it('model not found → llm_error', () => {
      expect(classifyError(new Error('model not found: gpt-5')).category).toBe('llm_error');
    });

    it('500 → llm_error', () => {
      expect(classifyError(new Error('HTTP 500 Internal Server Error')).category).toBe('llm_error');
    });

    it('502 → llm_error', () => {
      expect(classifyError(new Error('502 Bad Gateway')).category).toBe('llm_error');
    });
  });

  describe('未知错误', () => {
    it('随机错误 → unknown', () => {
      const e = classifyError(new Error('Something weird happened'));
      expect(e.category).toBe('unknown');
      expect(e.recoverable).toBe(false);
    });

    it('非 Error 对象 → unknown', () => {
      const e = classifyError('a string error');
      expect(e.category).toBe('unknown');
      expect(e.original).toBe('a string error');
    });

    it('null → unknown', () => {
      expect(classifyError(null).category).toBe('unknown');
    });

    it('undefined → unknown', () => {
      expect(classifyError(undefined).category).toBe('unknown');
    });
  });

  describe('优先级：网络 > 超时', () => {
    it('同时包含 network 和 timeout 关键字 → network', () => {
      const e = classifyError(new Error('ECONNREFUSED timeout'));
      expect(e.category).toBe('network');
    });
  });
});

describe('getUserFriendlyMessage', () => {
  it('network 返回含网络和重试的提示', () => {
    const classified = classifyError(new Error('ECONNREFUSED'));
    const msg = getUserFriendlyMessage(classified);
    expect(msg).toContain('网络');
  });

  it('auth 返回含认证的提示', () => {
    const classified = classifyError(new Error('401 Unauthorized'));
    const msg = getUserFriendlyMessage(classified);
    expect(msg).toContain('认证');
  });

  it('带 toolName 时添加前缀', () => {
    const classified = classifyError(new Error('ECONNREFUSED'));
    const msg = getUserFriendlyMessage(classified, 'exec');
    expect(msg).toMatch(/^\[exec\]/);
  });

  it('不带 toolName 时无前缀', () => {
    const classified = classifyError(new Error('ECONNREFUSED'));
    const msg = getUserFriendlyMessage(classified);
    expect(msg).not.toMatch(/^\[/);
  });

  it('timeout 返回超时提示', () => {
    const classified = classifyError(new Error('Request timeout'));
    const msg = getUserFriendlyMessage(classified);
    expect(msg).toContain('超时');
  });

  it('llm_error 返回 AI 后端提示', () => {
    const classified = classifyError(new Error('Rate limit exceeded'));
    const msg = getUserFriendlyMessage(classified);
    expect(msg).toContain('AI');
  });

  it('每个分类都返回非空字符串', () => {
    const categories: ErrorCategory[] = ['network', 'auth', 'permission', 'syntax', 'timeout', 'not_found', 'tool_error', 'llm_error', 'unknown'];
    for (const cat of categories) {
      const msg = getUserFriendlyMessage({
        category: cat,
        message: 'test',
        original: 'test',
        recoverable: false,
        suggestion: 'test',
      });
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});
