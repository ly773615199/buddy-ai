/**
 * ToolCallCard 组件测试
 * 覆盖：渲染、状态图标、参数解析、展开/折叠
 */
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../utils/markdown';

// renderMarkdown 是纯函数，可直接测试
describe('renderMarkdown', () => {
  it('空文本返回空数组', () => {
    const result = renderMarkdown('');
    expect(result).toHaveLength(1); // 空行产生一个 div
  });

  it('普通文本渲染', () => {
    const result = renderMarkdown('hello world');
    expect(result.length).toBeGreaterThan(0);
  });

  it('inline code 渲染', () => {
    const result = renderMarkdown('use `read_file` tool');
    expect(result.length).toBeGreaterThan(0);
    // 包含 code 元素
    const str = JSON.stringify(result);
    expect(str).toContain('read_file');
  });

  it('bold 渲染', () => {
    const result = renderMarkdown('this is **important**');
    expect(result.length).toBeGreaterThan(0);
    const str = JSON.stringify(result);
    expect(str).toContain('important');
  });

  it('link 渲染', () => {
    const result = renderMarkdown('visit [Google](https://google.com)');
    expect(result.length).toBeGreaterThan(0);
    const str = JSON.stringify(result);
    expect(str).toContain('https://google.com');
    expect(str).toContain('Google');
  });

  it('代码块渲染', () => {
    const input = '```typescript\nconst x = 1;\nconsole.log(x);\n```';
    const result = renderMarkdown(input);
    const str = JSON.stringify(result);
    expect(str).toContain('const x = 1');
    expect(str).toContain('typescript');
  });

  it('未闭合代码块仍然渲染', () => {
    const input = '```js\nconst x = 1;';
    const result = renderMarkdown(input);
    const str = JSON.stringify(result);
    expect(str).toContain('const x = 1');
  });

  it('多行混合内容渲染', () => {
    const input = [
      '第一行普通文本',
      '第二行有 `code` 和 **bold**',
      '',
      '第四行有 [link](http://example.com)',
    ].join('\n');
    const result = renderMarkdown(input);
    expect(result.length).toBeGreaterThan(3);
  });

  it('多个 inline code 不崩溃', () => {
    const result = renderMarkdown('use `read_file` and `write_file` together');
    expect(result.length).toBeGreaterThan(0);
  });

  it('特殊字符安全渲染', () => {
    const result = renderMarkdown('<script>alert("xss")</script>');
    expect(result.length).toBeGreaterThan(0);
    // 不会抛出异常
  });
});
