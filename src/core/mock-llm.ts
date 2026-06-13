import type { Message, ToolDef } from '../types.js';

/**
 * Mock LLM - 用于测试，无需外部 API
 * 
 * 模拟真实 LLM 的行为：
 * - 理解用户意图
 * - 决定是否调用工具
 * - 返回合理的回复
 */
export class MockLLM {
  private toolDefs: ToolDef[];

  constructor(tools: ToolDef[]) {
    this.toolDefs = tools;
  }

  async chat(
    messages: Message[],
    maxSteps = 5,
  ): Promise<{ text: string; steps: number; toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }> }> {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const input = lastUserMsg?.content ?? '';
    
    const toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }> = [];

    // 模拟意图识别 + 工具调用
    const intent = this.detectIntent(input);

    if (intent.action === 'exec') {
      const cmd = this.extractCommand(input);
      if (cmd) {
        const tool = this.toolDefs.find(t => t.name === 'exec');
        if (tool) {
          const result = await tool.execute({ command: cmd });
          toolCalls.push({ name: 'exec', args: { command: cmd }, result });
        }
      }
      return {
        text: `好，帮你执行了 \`${cmd}\`。\n\n${toolCalls[0]?.result ?? ''}`,
        steps: 1,
        toolCalls,
      };
    }

    if (intent.action === 'list') {
      const dir = this.extractPath(input) || '.';
      const tool = this.toolDefs.find(t => t.name === 'list_files');
      if (tool) {
        const result = await tool.execute({ path: dir });
        toolCalls.push({ name: 'list_files', args: { path: dir }, result });
      }
      return {
        text: `这是 ${dir} 目录下的文件：\n\n${toolCalls[0]?.result ?? ''}`,
        steps: 1,
        toolCalls,
      };
    }

    if (intent.action === 'read') {
      const file = this.extractFilePath(input);
      if (file) {
        const tool = this.toolDefs.find(t => t.name === 'read_file');
        if (tool) {
          const result = await tool.execute({ path: file, max_lines: 50 });
          toolCalls.push({ name: 'read_file', args: { path: file }, result });
        }
      }
      return {
        text: `读取了 ${file}：\n\n${toolCalls[0]?.result ?? ''}`,
        steps: 1,
        toolCalls,
      };
    }

    if (intent.action === 'write') {
      const file = this.extractFilePath(input);
      const content = this.extractContent(input) || '// 由 Buddy 创建\n';
      if (file) {
        const tool = this.toolDefs.find(t => t.name === 'write_file');
        if (tool) {
          const result = await tool.execute({ path: file, content });
          toolCalls.push({ name: 'write_file', args: { path: file, content }, result });
        }
      }
      return {
        text: `写好了！${toolCalls[0]?.result ?? ''}`,
        steps: 1,
        toolCalls,
      };
    }

    if (intent.action === 'git') {
      const tool = this.toolDefs.find(t => t.name === 'git_status');
      if (tool) {
        const result = await tool.execute({ repo_path: '.' });
        toolCalls.push({ name: 'git_status', args: { repo_path: '.' }, result });
      }
      return {
        text: `当前 Git 状态：\n\n${toolCalls[0]?.result ?? ''}`,
        steps: 1,
        toolCalls,
      };
    }

    if (intent.action === 'search') {
      const pattern = this.extractSearchPattern(input) || input;
      const searchDir = '.';
      const tool = this.toolDefs.find(t => t.name === 'search_files');
      if (tool) {
        const result = await tool.execute({ pattern, path: searchDir });
        toolCalls.push({ name: 'search_files', args: { pattern, path: searchDir }, result });
      }
      return {
        text: `搜索 "${pattern}" 的结果：\n\n${toolCalls[0]?.result ?? ''}`,
        steps: 1,
        toolCalls,
      };
    }

    if (intent.action === 'time') {
      const tool = this.toolDefs.find(t => t.name === 'get_time');
      if (tool) {
        const result = await tool.execute({});
        toolCalls.push({ name: 'get_time', args: {}, result });
      }
      return {
        text: toolCalls[0]?.result ?? '现在不知道几点了...',
        steps: 1,
        toolCalls,
      };
    }

    // 闲聊
    const replies = [
      `我在呢！有什么需要帮忙的？试试让我帮你列文件、执行命令、或者读文件。`,
      `说吧，要我干啥？列目录、跑命令、读文件都行。`,
      `有事尽管说。我虽然只是个 Mock，但工具调用是真实的哦。`,
    ];

    if (input.includes('你好') || input.includes('hello') || input.includes('hi')) {
      return { text: `你好！我是你的 Buddy 🦊。我能帮你执行命令、读写文件、查看 Git 状态。想试试？`, steps: 1, toolCalls: [] };
    }

    if (input.includes('你能')) {
      return {
        text: `我能做的：\n- 📁 列文件 / 读文件 / 写文件\n- ⚡ 执行 Shell 命令\n- 🔍 搜索文件内容\n- 🌿 查看 Git 状态\n- ⏰ 看时间\n\n试试说 "帮我列一下当前目录"`,
        steps: 1,
        toolCalls: [],
      };
    }

    return {
      text: replies[Math.floor(Math.random() * replies.length)],
      steps: 1,
      toolCalls: [],
    };
  }

  private detectIntent(input: string): { action: string } {
    const lower = input.toLowerCase();
    
    if (/执行|运行|跑|run|exec/.test(lower) && !/列表|列出|列一下|list/.test(lower)) return { action: 'exec' };
    if (/列表|列出|列一下|list|ls|目录|文件/.test(lower) && !/读|read|cat/.test(lower)) return { action: 'list' };
    if (/读取|读|read|cat|看.*内容|打开.*文件|查看/.test(lower)) return { action: 'read' };
    if (/写|创建|write|create|保存/.test(lower)) return { action: 'write' };
    if (/搜索|查找|搜|grep|find|找/.test(lower)) return { action: 'search' };
    if (/git|提交|commit|状态|branch|分支/.test(lower)) return { action: 'git' };
    if (/时间|几点|time|日期/.test(lower)) return { action: 'time' };
    
    return { action: 'chat' };
  }

  private extractCommand(input: string): string {
    // 提取引号内的命令
    const quoted = input.match(/[`'"]([^`'"]+)[`'"]/);
    if (quoted) return quoted[1];
    
    // 去掉前缀词
    return input
      .replace(/^(帮我|请|执行|运行|跑|run|exec)\s*/i, '')
      .trim();
  }

  private extractPath(input: string): string {
    const match = input.match(/[.~/][\w/.-]*/);
    return match?.[0] || '.';
  }

  private extractFilePath(input: string): string {
    const match = input.match(/[.~/][\w/.-]*\.\w+/);
    if (match) return match[0];
    
    // 尝试提取 "文件名.xxx" 模式
    const fileMatch = input.match(/([\w-]+\.\w+)/);
    return fileMatch?.[1] || 'test.txt';
  }

  private extractContent(input: string): string | null {
    const match = input.match(/内容[是为：:]\s*['"](.+?)['"]/);
    return match?.[1] ?? null;
  }

  private extractSearchPattern(input: string): string | null {
    const match = input.match(/搜索[：: ]*['"](.+?)['"]/);
    if (match) return match[1];
    const match2 = input.match(/(?:搜索|查找|搜|找)(?:文件|内容|一下)?\s*['"](.+?)['"]/);
    if (match2) return match2[1];
    const match3 = input.match(/(?:搜索|查找|搜|找)(?:文件|内容|一下)?\s+(\S+)/);
    return match3?.[1] || null;
  }
}
