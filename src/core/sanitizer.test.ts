/**
 * core/sanitizer.ts 测试
 * 覆盖：sanitizeText、containsPII、generateSanitizeReport、sanitizeObject
 */
import { describe, it, expect } from 'vitest';
import { sanitizeText, containsPII, generateSanitizeReport, sanitizeObject } from './sanitizer.js';

// ==================== sanitizeText ====================

describe('sanitizeText', () => {
  it('脱敏文件路径', () => {
    expect(sanitizeText('/home/user/file.txt')).toBe('[PATH]');
    expect(sanitizeText('读取 /root/project/src/main.ts 文件')).toBe('读取 [PATH] 文件');
  });

  it('脱敏 Windows 路径', () => {
    expect(sanitizeText('C:\\Users\\test\\file.txt')).toBe('[PATH]');
  });

  it('脱敏 IPv4 地址', () => {
    expect(sanitizeText('连接到 192.168.1.100')).toBe('连接到 [IP]');
    expect(sanitizeText('http://10.0.0.1:8080/api')).toBe('http://[IP]:8080/api');
  });

  it('脱敏邮箱', () => {
    expect(sanitizeText('联系 test@example.com')).toBe('联系 [EMAIL]');
    expect(sanitizeText('user.name@company.co.jp')).toBe('[EMAIL]');
  });

  it('脱敏 OpenAI API Key', () => {
    expect(sanitizeText('sk-' + 'a'.repeat(30))).toBe('[TOKEN]');
    expect(sanitizeText('sk_' + 'b'.repeat(30))).toBe('[TOKEN]');
  });

  it('脱敏 GitHub Token', () => {
    expect(sanitizeText('ghp_' + 'x'.repeat(30))).toBe('[TOKEN]');
  });

  it('脱敏 JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456';
    expect(sanitizeText(jwt)).toBe('[TOKEN]');
  });

  it('脱敏中国手机号', () => {
    expect(sanitizeText('手机号 13812345678')).toBe('手机号 [PHONE]');
  });

  it('脱敏身份证号', () => {
    expect(sanitizeText('身份证 110101199001011234')).toBe('身份证 [ID_CARD]');
  });

  it('不改变普通文本', () => {
    const text = '这是一段普通的对话内容，没有敏感信息';
    expect(sanitizeText(text)).toBe(text);
  });

  it('可通过选项禁用特定脱敏', () => {
    expect(sanitizeText('/path/to/file.txt', { paths: false })).toBe('/path/to/file.txt');
    expect(sanitizeText('test@email.com', { emails: false })).toBe('test@email.com');
    expect(sanitizeText('13812345678', { phones: false })).toBe('13812345678');
  });

  it('自定义模式替换', () => {
    const result = sanitizeText('my_secret_key', {
      customPatterns: [{ pattern: /secret/g, replacement: '***' }],
    });
    expect(result).toBe('my_***_key');
  });

  it('混合内容全部脱敏', () => {
    const input = '用户 test@example.com 的手机号 13812345678，IP 10.0.0.1';
    const result = sanitizeText(input);
    expect(result).toContain('[EMAIL]');
    expect(result).toContain('[PHONE]');
    expect(result).toContain('[IP]');
  });
});

// ==================== containsPII ====================

describe('containsPII', () => {
  it('检测文件路径', () => {
    expect(containsPII('/home/user/file.txt')).toBe(true);
  });

  it('检测 IP 地址', () => {
    expect(containsPII('192.168.1.1')).toBe(true);
  });

  it('检测邮箱', () => {
    expect(containsPII('test@example.com')).toBe(true);
  });

  it('检测 API Key', () => {
    expect(containsPII('sk-' + 'a'.repeat(25))).toBe(true);
  });

  it('检测手机号', () => {
    expect(containsPII('13812345678')).toBe(true);
  });

  it('普通文本返回 false', () => {
    expect(containsPII('今天天气不错')).toBe(false);
    expect(containsPII('帮我看看这个函数')).toBe(false);
  });
});

// ==================== generateSanitizeReport ====================

describe('generateSanitizeReport', () => {
  it('无替换时无报告', () => {
    const report = generateSanitizeReport('hello', 'hello');
    expect(report.hasPII).toBe(false);
    expect(report.replacements).toHaveLength(0);
  });

  it('统计 PATH 替换', () => {
    const report = generateSanitizeReport('/a/b.txt /c/d.txt', '[PATH] [PATH]');
    expect(report.hasPII).toBe(true);
    expect(report.replacements).toContainEqual({ type: 'PATH', count: 2 });
  });

  it('统计多种替换', () => {
    const original = 'test@email.com 192.168.1.1';
    const sanitized = '[EMAIL] [IP]';
    const report = generateSanitizeReport(original, sanitized);
    expect(report.hasPII).toBe(true);
    expect(report.replacements.length).toBeGreaterThanOrEqual(2);
  });
});

// ==================== sanitizeObject ====================

describe('sanitizeObject', () => {
  it('脱敏指定字段', () => {
    const obj = { name: 'test', email: 'user@test.com', path: '/home/file.txt' };
    const result = sanitizeObject(obj, ['email', 'path']);
    expect(result.email).toBe('[EMAIL]');
    expect(result.path).toBe('[PATH]');
    expect(result.name).toBe('test');
  });

  it('不修改原对象', () => {
    const obj = { email: 'user@test.com' };
    const result = sanitizeObject(obj, ['email']);
    expect(obj.email).toBe('user@test.com');
    expect(result.email).toBe('[EMAIL]');
  });

  it('跳过非字符串字段', () => {
    const obj = { count: 42, active: true, name: 'test' };
    const result = sanitizeObject(obj, ['count', 'active']);
    expect(result.count).toBe(42);
    expect(result.active).toBe(true);
  });
});
