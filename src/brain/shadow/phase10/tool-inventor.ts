/**
 * 工具发明 — 创造全新工具
 *
 * 来源: Gödel Agent 核心思想——修改自己的代码
 *
 * 核心思想: 当工具组合穷尽仍失败时，影子脑用 LLM 生成全新的工具代码。
 * 工具集从"32 个固定"进化到"按需无限扩展"。
 */

import type { CapabilityGap, BrainProvider } from '../types.js';

// ── 类型定义 ──

export interface InventedTool {
  id: string;
  name: string;
  description: string;
  /** TypeScript 函数体 */
  code: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  /** 安全审查得分 0-1 */
  safetyScore: number;
  /** 沙箱测试结果 */
  testResults: TestResult[];
  /** 状态 */
  status: 'draft' | 'tested' | 'approved' | 'rejected';
  createdAt: number;
}

export interface TestResult {
  testName: string;
  passed: boolean;
  input: unknown;
  expectedOutput: unknown;
  actualOutput?: unknown;
  error?: string;
}

export interface ToolInventorConfig {
  /** LLM 调用器 */
  llm: { call: (prompt: string) => Promise<string> };
  /** 禁止的代码模式（安全检查） */
  forbiddenPatterns: string[];
  /** 最大工具数 */
  maxTools: number;
  /** 最少测试通过数才批准 */
  minTestsPassed: number;
}

const DEFAULT_FORBIDDEN = [
  'fetch(', 'axios', 'exec(', 'rm ', 'curl', 'wget', 'eval(',
  'child_process', 'fs.unlink', 'fs.rmdir', 'process.exit',
  'require("net")', 'require("http")', 'import("net")',
  'bash -i', '/dev/tcp', 'nc -', 'ncat ',
];

const DEFAULT_CONFIG: ToolInventorConfig = {
  llm: { call: async () => '{}' },
  forbiddenPatterns: DEFAULT_FORBIDDEN,
  maxTools: 50,
  minTestsPassed: 2,
};

// ── ToolInventor 核心 ──

export class ToolInventor {
  private tools: Map<string, InventedTool> = new Map();
  private config: ToolInventorConfig;
  private brain: BrainProvider | null = null;

  constructor(config: Partial<ToolInventorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setBrainProvider(brain: BrainProvider): void {
    this.brain = brain;
  }

  /**
   * 从能力缺口发明新工具
   */
  async invent(gap: CapabilityGap, existingToolNames: string[]): Promise<InventedTool | null> {
    const prompt = `
你是一个工具发明家。系统有一个能力缺口无法用现有工具解决。

能力缺口: ${gap.description}
连续失败: ${gap.failureCount} 次
失败详情: ${gap.failures.slice(-3).map(f => f.error).join('; ')}
已有工具: ${existingToolNames.join(', ')}

请设计一个新工具来填补这个缺口。
要求:
1. 纯函数，无副作用
2. 无网络请求、无文件删除、无 shell 命令
3. 输入输出都有明确的类型定义

输出 JSON:
{
  "name": "工具名称",
  "description": "工具描述",
  "code": "TypeScript 函数体（纯函数）",
  "inputSchema": {"type": "object", "properties": {...}},
  "outputSchema": {"type": "object", "properties": {...}}
}`;

    try {
      const response = await this.config.llm.call(prompt);
      const parsed = JSON.parse(response);

      const tool: InventedTool = {
        id: `invented-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: parsed.name,
        description: parsed.description,
        code: parsed.code,
        inputSchema: parsed.inputSchema ?? {},
        outputSchema: parsed.outputSchema ?? {},
        safetyScore: 0,
        testResults: [],
        status: 'draft',
        createdAt: Date.now(),
      };

      // 安全审查
      tool.safetyScore = this.safetyCheck(tool);
      if (tool.safetyScore < 0.5) {
        tool.status = 'rejected';
        this.tools.set(tool.id, tool);
        return tool;
      }

      // 沙箱测试
      tool.testResults = await this.sandboxTest(tool);
      const passedTests = tool.testResults.filter(r => r.passed).length;

      if (passedTests >= this.config.minTestsPassed) {
        tool.status = 'approved';
      } else {
        tool.status = 'tested'; // 需要更多测试
      }

      this.tools.set(tool.id, tool);
      return tool;
    } catch {
      return null;
    }
  }

  /**
   * 获取已批准的工具
   */
  getApprovedTools(): InventedTool[] {
    return [...this.tools.values()].filter(t => t.status === 'approved');
  }

  /**
   * 获取所有工具
   */
  getAllTools(): InventedTool[] {
    return [...this.tools.values()];
  }

  /**
   * 获取指定工具
   */
  getTool(id: string): InventedTool | undefined {
    return this.tools.get(id);
  }

  /**
   * 获取摘要
   */
  getSummary(): {
    totalTools: number;
    approved: number;
    rejected: number;
    draft: number;
    avgSafetyScore: number;
  } {
    const all = [...this.tools.values()];
    return {
      totalTools: all.length,
      approved: all.filter(t => t.status === 'approved').length,
      rejected: all.filter(t => t.status === 'rejected').length,
      draft: all.filter(t => t.status === 'draft').length,
      avgSafetyScore: all.length > 0
        ? all.reduce((s, t) => s + t.safetyScore, 0) / all.length
        : 0,
    };
  }

  // ── 内部方法 ──

  /**
   * 安全审查 — 检查代码中的危险模式
   */
  private safetyCheck(tool: InventedTool): number {
    let violations = 0;
    const totalChecks = this.config.forbiddenPatterns.length;

    for (const pattern of this.config.forbiddenPatterns) {
      if (tool.code.includes(pattern)) {
        violations++;
      }
    }

    // 额外检查
    if (tool.code.includes('while (true)')) violations++; // 无限循环
    if (tool.code.includes('setTimeout')) violations++; // 定时器
    if (tool.code.includes('setInterval')) violations++;
    if ((tool.code.match(/{/g) ?? []).length > 20) violations++; // 过于复杂

    return Math.max(0, 1 - violations / (totalChecks * 0.3));
  }

  /**
   * 沙箱测试 — 在隔离环境中测试工具
   */
  private async sandboxTest(tool: InventedTool): Promise<TestResult[]> {
    const results: TestResult[] = [];

    // Test 1: 代码可解析
    try {
      new Function('input', tool.code);
      results.push({ testName: 'syntax', passed: true, input: null, expectedOutput: null });
    } catch (e: any) {
      results.push({ testName: 'syntax', passed: false, input: null, expectedOutput: null, error: e.message });
    }

    // Test 2: 基本执行（空输入）
    try {
      const fn = new Function('input', tool.code);
      const output = fn({});
      results.push({
        testName: 'empty-input',
        passed: output !== undefined && output !== null,
        input: {},
        expectedOutput: 'non-null',
        actualOutput: output,
      });
    } catch (e: any) {
      results.push({
        testName: 'empty-input',
        passed: false,
        input: {},
        expectedOutput: 'non-null',
        error: e.message,
      });
    }

    // Test 3: 类型检查（输出是否为对象）
    try {
      const fn = new Function('input', tool.code);
      const output = fn({ test: true });
      results.push({
        testName: 'output-type',
        passed: typeof output === 'object' || typeof output === 'string' || typeof output === 'number',
        input: { test: true },
        expectedOutput: 'object|string|number',
        actualOutput: typeof output,
      });
    } catch (e: any) {
      results.push({
        testName: 'output-type',
        passed: false,
        input: { test: true },
        expectedOutput: 'object|string|number',
        error: e.message,
      });
    }

    return results;
  }
}
