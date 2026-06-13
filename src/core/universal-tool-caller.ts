import { z } from 'zod';
import type { ToolDef } from '../types.js';

// ==================== 工具调用结果 ====================

export interface ToolCallResult {
  name: string;
  args: Record<string, unknown>;
  result: string;
  success: boolean;
  durationMs: number;
  parseStrategy?: string;    // 用哪种策略解析出来的
  repairAttempts?: number;   // 修复尝试次数
}

export interface ToolCallSession {
  text: string;
  toolCalls: ToolCallResult[];
  totalSteps: number;
  aborted: boolean;
  reason?: string;
}

// ==================== 解析策略 ====================

interface ParseStrategy {
  name: string;
  priority: number;   // 越高越优先尝试
  parse: (text: string) => { name: string; args: Record<string, unknown> } | null;
}

// ==================== 主类 ====================

/**
 * 通用工具调用引擎
 *
 * 核心设计：
 * 1. 不依赖 AI SDK 的原生 tool calling
 * 2. 多策略解析：应对各种模型的输出格式
 * 3. 自修复：参数不对时自动修正
 * 4. 经验注入：成功模式被记录，未来绕过 LLM
 * 5. 渐进独立：用得越多，对 LLM 依赖越低
 *
 * 这座桥的最终形态：学生不再需要老师也能做事
 */
export class UniversalToolCaller {
  private tools: Map<string, ToolDef> = new Map();
  private parseStrategies: ParseStrategy[] = [];
  private maxIterations = 5;

  // === 统计 ===
  private stats = {
    totalCalls: 0,
    nativeCalls: 0,      // AI SDK 原生 tool calling 成功
    parsedCalls: 0,       // 文本解析成功
    repairedCalls: 0,     // 修复后成功
    failedCalls: 0,
    strategyHits: {} as Record<string, number>,  // 各策略命中次数
  };

  constructor() {
    this.initParseStrategies();
  }

  // ==================== 工具注册 ====================

  registerTool(tool: ToolDef): void {
    this.tools.set(tool.name, tool);
  }

  registerTools(tools: ToolDef[]): void {
    for (const t of tools) this.registerTool(t);
  }

  getTool(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  listTools(): ToolDef[] {
    return Array.from(this.tools.values());
  }

  // ==================== 工具 Prompt 构建 ====================

  /**
   * 构建工具系统 Prompt
   * 让任何模型都能"看懂"工具并正确调用
   *
   * 优化：
   * - 动态 few-shot 示例（Task 1.1）
   * - CoT 前置引导（Task 1.2）
   * - 工具描述压缩：用简洁格式替代冗长 JSON Schema（Task 1.3）
   */
  buildToolSystemPrompt(): string {
    if (this.tools.size === 0) return '';

    // 压缩格式：name(params) — description
    const toolSummary = Array.from(this.tools.values()).map(t => {
      const params = this.zodToCompactParams(t.parameters);
      return `- **${t.name}**${params} — ${t.description}`;
    }).join('\n');

    // 完整 schema 保留但精简（只在需要时参考）
    const toolDescs = Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      parameters: this.zodToJsonSchema(t.parameters),
    }));

    // 动态生成 few-shot 示例（最多 3 个，覆盖不同工具类型）
    const examples = this.buildFewShotExamples();

    return `
## 工具系统

你可以使用以下工具来帮助用户。

### 调用流程
当用户请求需要工具完成时，按以下步骤思考：
1. **理解意图**：用户想要什么结果？
2. **选择工具**：哪个工具最合适？
3. **准备参数**：需要哪些参数？用户提供了哪些？
4. **输出调用**：严格按 JSON 格式输出

\`\`\`json
{"tool": "工具名", "args": {"参数1": "值1", "参数2": "值2"}}
\`\`\`

### 规则
1. 一次只调用一个工具
2. 等待工具执行结果后，再决定下一步
3. 如果不需要工具，直接回答
4. 参数必须严格匹配 schema 定义的类型
5. JSON 块前后不要放其他内容
6. 调用前先用一句话说明你要做什么（帮助你理清思路）

### 可用工具 (${this.tools.size} 个)
${toolSummary}

### 工具参数详情
${JSON.stringify(toolDescs, null, 2)}

### 示例
${examples}`;
  }

  /**
   * 将 Zod schema 压缩为紧凑参数描述
   * 例：(path: string, start_line?: number, max_lines?: number)
   */
  private zodToCompactParams(schema: z.ZodType): string {
    try {
      if (!(schema instanceof z.ZodObject)) return '()';
      const shape = schema.shape as Record<string, z.ZodType>;
      const parts: string[] = [];

      for (const [key, fieldSchema] of Object.entries(shape)) {
        const isOptional = fieldSchema instanceof z.ZodOptional || fieldSchema instanceof z.ZodDefault;
        const inner = isOptional ? (fieldSchema as any)._def.innerType ?? fieldSchema : fieldSchema;
        let type = 'any';
        if (inner instanceof z.ZodString) type = 'string';
        else if (inner instanceof z.ZodNumber) type = 'number';
        else if (inner instanceof z.ZodBoolean) type = 'boolean';
        else if (inner instanceof z.ZodArray) type = 'array';
        parts.push(`${key}${isOptional ? '?' : ''}: ${type}`);
      }

      return parts.length > 0 ? `(${parts.join(', ')})` : '()';
    } catch {
      return '()';
    }
  }

  /**
   * 动态生成 few-shot 示例
   * 根据已注册工具生成 2-3 个高质量示例
   */
  private buildFewShotExamples(): string {
    const tools = Array.from(this.tools.values());
    const examples: string[] = [];

    // 读取文件示例
    const readFile = tools.find(t => t.name === 'read_file');
    if (readFile) {
      examples.push(`用户：帮我读一下 config.json
你：
\`\`\`json
{"tool": "read_file", "args": {"path": "config.json"}}
\`\`\`
（系统会返回文件内容，然后你基于内容回答用户）`);
    }

    // 执行命令示例
    const exec = tools.find(t => t.name === 'exec');
    if (exec) {
      examples.push(`用户：看看当前目录有什么文件
你：
\`\`\`json
{"tool": "exec", "args": {"command": "ls -la"}}
\`\`\`
（系统会返回命令输出，然后你总结给用户）`);
    }

    // 搜索文件示例
    const search = tools.find(t => t.name === 'search_files');
    if (search) {
      examples.push(`用户：在 src 目录下搜索包含 "TODO" 的文件
你：
\`\`\`json
{"tool": "search_files", "args": {"pattern": "TODO", "path": "src"}}
\`\`\``);
    }

    // Git 操作示例
    const gitStatus = tools.find(t => t.name === 'git_status');
    if (gitStatus && !examples.some(e => e.includes('git_status'))) {
      examples.push(`用户：看看 git 状态
你：
\`\`\`json
{"tool": "git_status", "args": {"repo_path": "."}}
\`\`\``);
    }

    // 写文件示例
    const writeFile = tools.find(t => t.name === 'write_file');
    if (writeFile && !examples.some(e => e.includes('write_file'))) {
      examples.push(`用户：创建一个 hello.py 文件，内容是 print("hello")
你：
\`\`\`json
{"tool": "write_file", "args": {"path": "hello.py", "content": "print(\\"hello\\")"}}
\`\`\``);
    }

    // 获取时间示例
    const getTime = tools.find(t => t.name === 'get_time');
    if (getTime && examples.length < 3) {
      examples.push(`用户：现在几点了
你：
\`\`\`json
{"tool": "get_time", "args": {}}
\`\`\``);
    }

    // 如果没有匹配到任何已知工具，生成一个通用示例
    if (examples.length === 0 && tools.length > 0) {
      const first = tools[0];
      const params = this.zodToJsonSchema(first.parameters);
      const paramKeys = params && typeof params === 'object' && 'properties' in params
        ? Object.keys((params as any).properties ?? {})
        : [];
      const argsStr = paramKeys.length > 0
        ? paramKeys.map(k => `"${k}": "..."`).join(', ')
        : '';
      examples.push(`用户：使用 ${first.name}
你：
\`\`\`json
{"tool": "${first.name}", "args": {${argsStr}}}
\`\`\``);
    }

    return examples.join('\n\n');
  }

  // ==================== 解析引擎 ====================

  /**
   * 初始化解析策略（按优先级排序）
   * 这是应对各种模型格式差异的核心
   *
   * Task 2.1: 新增 XML 标签解析策略（Qwen/DeepSeek 等国产模型适配）
   */
  private initParseStrategies(): void {
    this.parseStrategies = [
      // 策略 1: 标准 ```json ``` 代码块（大多数模型）
      {
        name: 'markdown_json',
        priority: 100,
        parse: (text) => {
          const match = text.match(/```json\s*([\s\S]*?)\s*```/);
          if (!match) return null;
          return this.tryParseJson(match[1]);
        },
      },

      // 策略 2:   标签（Qwen / 部分国产模型）
      {
        name: 'function_call_tags',
        priority: 96,
        parse: (text) => {
          const match = text.match(/<tool_call>\s*([\s\S]*?)\s*<\/?tool_call>/);
          if (!match) return null;
          return this.tryParseJson(match[1]);
        },
      },

      // 策略 2b: <tool_call>... 没有闭合标签时，用括号匹配提取完整 JSON
      {
        name: 'function_call_single',
        priority: 95,
        parse: (text) => {
          const match = text.match(/<tool_call>\s*/);
          if (!match) return null;
          const jsonStart = match.index! + match[0].length;
          const json = this.extractJsonObject(text, jsonStart);
          if (!json) return null;
          return this.tryParseJson(json);
        },
      },

      // 策略 2c: XML 标签包裹工具调用（<tool>name</tool><args>{...}</args>）
      {
        name: 'xml_tool_tag',
        priority: 93,
        parse: (text) => {
          const nameMatch = text.match(/<tool\s*>\s*([^<]+?)\s*<\/tool\s*>/i);
          if (!nameMatch) return null;
          const name = nameMatch[1].trim();
          // 尝试找 args/arguments/parameter 标签
          const argsMatch = text.match(/<(?:args|arguments|parameter)\s*>\s*([\s\S]*?)\s*<\/(?:args|arguments|parameter)\s*>/i);
          let args: Record<string, unknown> = {};
          if (argsMatch) {
            const parsed = this.tryParseJson(argsMatch[1]);
            if (parsed) args = parsed.args;
          }
          return { name, args };
        },
      },

      // 策略 2d:   简写标签
      {
        name: 'xml_action_tag',
        priority: 92,
        parse: (text) => {
          const match = text.match(/<action\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/action\s*>/i);
          if (!match) return null;
          const name = match[1].trim();
          let args: Record<string, unknown> = {};
          if (match[2].trim()) {
            const parsed = this.tryParseJson(match[2]);
            if (parsed) args = parsed.args ?? parsed;
          }
          return { name, args };
        },
      },

      // 策略 3:  标签（某些模型用这个）
      {
        name: 'invoke_tags',
        priority: 85,
        parse: (text) => {
          const match = text.match(/<invoke\s+name="([^"]+)">\s*<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>\s*<\/invoke>/);
          if (!match) return null;
          return { name: match[1], args: { [match[2]]: match[3].trim() } };
        },
      },

      // 策略 4: 多参数 invoke
      {
        name: 'invoke_multi_params',
        priority: 84,
        parse: (text) => {
          const match = text.match(/<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/);
          if (!match) return null;
          const name = match[1];
          const paramsBlock = match[2];
          const args: Record<string, unknown> = {};
          const paramRe = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g;
          let pm;
          while ((pm = paramRe.exec(paramsBlock)) !== null) {
            args[pm[1]] = this.tryCoerceValue(pm[2].trim());
          }
          return Object.keys(args).length > 0 ? { name, args } : null;
        },
      },

      // 策略 5: [TOOL_CALL] 格式（某些系统用方括号）
      {
        name: 'bracket_format',
        priority: 80,
        parse: (text) => {
          const match = text.match(/\[TOOL_CALL\]\s*([\s\S]*?)\[\/TOOL_CALL\]/);
          if (!match) return null;
          return this.tryParseJson(match[1]);
        },
      },

      // 策略 6: 纯 JSON（整段文本就是一个 JSON）
      {
        name: 'pure_json',
        priority: 70,
        parse: (text) => {
          const trimmed = text.trim();
          if (!trimmed.startsWith('{')) return null;
          return this.tryParseJson(trimmed);
        },
      },

      // 策略 7: JSON 在文本开头（"好的，我来帮你：{"tool":"..."）
      {
        name: 'json_inline',
        priority: 60,
        parse: (text) => {
          // 找第一个 { 到最后一个 } 的范围
          const start = text.indexOf('{');
          const end = text.lastIndexOf('}');
          if (start === -1 || end <= start) return null;
          return this.tryParseJson(text.slice(start, end + 1));
        },
      },

      // 策略 8: 自然语言意图识别（兜底）
      {
        name: 'natural_language',
        priority: 10,
        parse: (text) => {
          // 尝试从自然语言中提取工具意图
          // 例如："让我帮你读取 config.json 文件" -> read_file
          return this.inferToolFromText(text);
        },
      },
    ];
  }

  /**
   * 解析文本中的工具调用
   * 按优先级尝试所有策略，返回第一个成功的结果
   */
  parseToolCall(text: string): { name: string; args: Record<string, unknown>; strategy: string } | null {
    // 按优先级降序
    const sorted = [...this.parseStrategies].sort((a, b) => b.priority - a.priority);

    for (const strategy of sorted) {
      try {
        const result = strategy.parse(text);
        if (result && this.tools.has(result.name)) {
          this.stats.strategyHits[strategy.name] = (this.stats.strategyHits[strategy.name] ?? 0) + 1;
          return { ...result, strategy: strategy.name };
        }
        // 解析出工具名但不在工具列表中 → 跳过
        if (result && !this.tools.has(result.name)) {
          // 尝试模糊匹配
          const fuzzyMatch = this.fuzzyMatchTool(result.name);
          if (fuzzyMatch) {
            this.stats.strategyHits[strategy.name] = (this.stats.strategyHits[strategy.name] ?? 0) + 1;
            return { name: fuzzyMatch, args: result.args, strategy: strategy.name + '_fuzzy' };
          }
        }
      } catch {
        // 策略失败，继续下一个
      }
    }
    return null;
  }

  // ==================== 参数修复 ====================

  /**
   * 修复工具调用参数
   * 模型经常返回格式不对的参数，这里做自动修正
   */
  repairArgs(toolName: string, rawArgs: Record<string, unknown>): Record<string, unknown> | null {
    const tool = this.tools.get(toolName);
    if (!tool) return null;

    try {
      // 直接尝试 Zod 校验
      const result = tool.parameters.safeParse(rawArgs);
      if (result.success) return result.data;
    } catch { /* 继续修复 */ }

    // 修复策略 1: 类型强制转换
    const coerced = this.coerceTypes(tool.parameters, rawArgs);
    if (coerced) return coerced;

    // 修复策略 2: 填充默认值
    const withDefaults = this.fillDefaults(tool.parameters, rawArgs);
    if (withDefaults) return withDefaults;

    // 修复策略 3: 去除多余字段
    const stripped = this.stripExtraFields(tool.parameters, rawArgs);
    if (stripped) return stripped;

    return null;
  }

  // ==================== JSON 解析工具 ====================

  private tryParseJson(text: string): { name: string; args: Record<string, unknown> } | null {
    // 清理常见问题
    let cleaned = text
      .replace(/,\s*}/g, '}')       // 尾逗号
      .replace(/,\s*]/g, ']')       // 数组尾逗号
      .replace(/'/g, '"')           // 单引号变双引号
      .replace(/(\w+)\s*:/g, '"$1":') // 未引号的 key
      .trim();

    try {
      const parsed = JSON.parse(cleaned);
      if (parsed.tool && typeof parsed.tool === 'string') {
        return {
          name: parsed.tool,
          args: (parsed.args && typeof parsed.args === 'object') ? parsed.args : {},
        };
      }
      // 兼容 function_call 格式
      if (parsed.function?.name) {
        return {
          name: parsed.function.name,
          args: typeof parsed.function.arguments === 'string'
            ? JSON.parse(parsed.function.arguments)
            : parsed.function.arguments ?? {},
        };
      }
      // 兼容 name + arguments 格式
      if (parsed.name && parsed.arguments) {
        return {
          name: parsed.name,
          args: typeof parsed.arguments === 'string'
            ? JSON.parse(parsed.arguments)
            : parsed.arguments,
        };
      }
    } catch {
      // 最后尝试：修复被截断的 JSON
      try {
        const fixed = this.fixTruncatedJson(cleaned);
        if (fixed) return this.tryParseJson(fixed);
      } catch { /* 放弃 */ }
    }
    return null;
  }

  /** 修复被截断的 JSON */
  private fixTruncatedJson(text: string): string | null {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\' && inString) { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      if (ch === '}') depth--;
    }

    if (depth > 0) {
      // 缺少闭合括号
      return text + '}'.repeat(depth);
    }
    return null;
  }

  /**
   * 从指定位置开始，用括号深度匹配提取完整 JSON 对象
   * 解决 [\s\S]*? 在 tool_call 标签缺失时贪婪匹配导致截断的问题
   */
  private extractJsonObject(text: string, start: number): string | null {
    const braceStart = text.indexOf('{', start);
    if (braceStart === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = braceStart; i < text.length; i++) {
      const ch = text[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\' && inString) { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) return text.slice(braceStart, i + 1);
      }
    }
    return null;
  }

  /** 模糊匹配工具名 */
  private fuzzyMatchTool(input: string): string | null {
    const lower = input.toLowerCase().replace(/[-_\s]/g, '');

    for (const name of this.tools.keys()) {
      const normalized = name.toLowerCase().replace(/[-_\s]/g, '');
      if (normalized === lower) return name;
      // 包含关系
      if (normalized.includes(lower) || lower.includes(normalized)) return name;
    }

    // Levenshtein 距离（容错 2 个字符）
    let best: string | null = null;
    let bestDist = Infinity;
    for (const name of this.tools.keys()) {
      const dist = this.levenshtein(lower, name.toLowerCase().replace(/[-_\s]/g, ''));
      if (dist < bestDist && dist <= 2) {
        bestDist = dist;
        best = name;
      }
    }
    return best;
  }

  /**
   * 自然语言意图推断（终极兜底）
   * Task 2.3: 扩展更多工具模式匹配
   */
  private inferToolFromText(text: string): { name: string; args: Record<string, unknown> } | null {
    const lower = text.toLowerCase();

    // 文件读取意图
    if (/读取|打开|查看|看看|read|open|cat\s+/.test(lower)) {
      const pathMatch = text.match(/['"`]([^'"`]+\.[a-z]+)['"`]/);
      if (pathMatch) return { name: 'read_file', args: { path: pathMatch[1] } };
      // 没有引号但有文件路径
      const pathMatch2 = text.match(/(\S+\.[a-z]{1,5})\s*/);
      if (pathMatch2 && !/^(是|的|吗|了|吧)$/.test(pathMatch2[1])) {
        return { name: 'read_file', args: { path: pathMatch2[1] } };
      }
    }

    // 文件写入意图
    if (/写入|保存|创建文件|创建|新建|write|save|create/.test(lower)) {
      const pathMatch = text.match(/['"`]([^'"`]+\.[a-z]+)['"`]/);
      if (pathMatch) return { name: 'write_file', args: { path: pathMatch[1] } };
    }

    // 列出文件意图
    if (/列出|列出来|看看目录|看看文件|目录|文件列表|list|ls/.test(lower)) {
      const pathMatch = text.match(/(?:目录|文件夹|路径|在)\s*['"`]?([^\s'"`]+)/);
      return { name: 'list_files', args: { path: pathMatch?.[1] ?? '.' } };
    }

    // 搜索文件意图
    if (/搜索|查找|grep|find|search|搜一下|找一下/.test(lower)) {
      const patternMatch = text.match(/(?:搜索|查找|grep|find|search|搜一下|找一下)\s*['"`]?([^'"`\n]+?)['"`]?\s*(?:在|目录|路径|文件|$)/);
      const pathMatch = text.match(/(?:在|目录|路径)\s*['"`]?([^\s'"`]+)/);
      if (patternMatch) {
        return {
          name: 'search_files',
          args: {
            pattern: patternMatch[1].trim(),
            path: pathMatch?.[1] ?? '.',
          },
        };
      }
    }

    // 执行命令意图
    if (/执行|运行|run|exec|终端|命令行/.test(lower)) {
      const cmdMatch = text.match(/(?:执行|运行|run|exec|终端|命令行)\s*[:：]?\s*['"`]?([^'"`\n]+)['"`]?/);
      if (cmdMatch) return { name: 'exec', args: { command: cmdMatch[1].trim() } };
    }

    // Git 状态意图
    if (/git\s*状态|git\s*status|看看改动|看看变更|代码改了/.test(lower)) {
      return { name: 'git_status', args: { repo_path: '.' } };
    }

    // Git 日志意图
    if (/git\s*日志|git\s*log|提交记录|最近提交/.test(lower)) {
      const countMatch = text.match(/(\d+)\s*(?:条|个|次)/);
      return { name: 'git_log', args: { repo_path: '.', count: countMatch ? parseInt(countMatch[1]) : 10 } };
    }

    // Git diff 意图
    if (/git\s*diff|看看差异|对比|改动了什么/.test(lower)) {
      return { name: 'git_diff', args: { repo_path: '.' } };
    }

    // 网络搜索意图
    if (/搜索一下|搜一下|网上查|search\s*web|google|百度/.test(lower)) {
      const queryMatch = text.match(/(?:搜索一下|搜一下|网上查|search\s*web)\s*['"`]?([^'"`\n]+)/);
      if (queryMatch) return { name: 'search_web', args: { query: queryMatch[1].trim() } };
    }

    // 获取时间意图
    if (/几点|时间|日期|time|date/.test(lower)) {
      return { name: 'get_time', args: {} };
    }

    return null;
  }

  // ==================== 类型修复工具 ====================

  private coerceTypes(schema: z.ZodType, data: Record<string, unknown>): Record<string, unknown> | null {
    try {
      // 尝试递归转换类型
      const result = schema.safeParse(data);
      if (result.success) return result.data;
    } catch { /* ignore */ }

    // 如果 schema 是 ZodObject，尝试逐字段转换
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape as Record<string, z.ZodType>;
      const coerced: Record<string, unknown> = {};

      for (const [key, fieldSchema] of Object.entries(shape)) {
        if (key in data) {
          const val = data[key];
          coerced[key] = this.coerceSingleValue(fieldSchema, val);
        }
      }

      const result = schema.safeParse(coerced);
      if (result.success) return result.data;
    }

    return null;
  }

  private coerceSingleValue(schema: z.ZodType, value: unknown): unknown {
    // ZodNumber: 字符串转数字
    if (schema instanceof z.ZodNumber && typeof value === 'string') {
      const num = Number(value);
      if (!isNaN(num)) return num;
    }
    // ZodBoolean: 字符串转布尔
    if (schema instanceof z.ZodBoolean && typeof value === 'string') {
      if (value === 'true') return true;
      if (value === 'false') return false;
    }
    // ZodArray: 单值变数组
    if (schema instanceof z.ZodArray && !Array.isArray(value)) {
      return [value];
    }
    // ZodString: 非字符串转字符串
    if (schema instanceof z.ZodString && typeof value !== 'string') {
      return String(value);
    }
    return value;
  }

  private fillDefaults(schema: z.ZodType, data: Record<string, unknown>): Record<string, unknown> | null {
    if (!(schema instanceof z.ZodObject)) return null;
    const shape = schema.shape as Record<string, z.ZodType>;
    const filled = { ...data };

    for (const [key, fieldSchema] of Object.entries(shape)) {
      if (!(key in filled)) {
        // 检查是否有默认值
        if (fieldSchema instanceof z.ZodDefault) {
          filled[key] = fieldSchema._def.defaultValue();
        } else if (fieldSchema instanceof z.ZodOptional) {
          // 可选字段，跳过
        }
      }
    }

    const result = schema.safeParse(filled);
    return result.success ? result.data : null;
  }

  private stripExtraFields(schema: z.ZodType, data: Record<string, unknown>): Record<string, unknown> | null {
    if (!(schema instanceof z.ZodObject)) return null;
    const shape = schema.shape as Record<string, z.ZodType>;
    const validKeys = new Set(Object.keys(shape));
    const stripped: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(data)) {
      if (validKeys.has(key)) stripped[key] = val;
    }

    const result = schema.safeParse(stripped);
    return result.success ? result.data : null;
  }

  private tryCoerceValue(str: string): unknown {
    if (str === 'true') return true;
    if (str === 'false') return false;
    if (str === 'null') return null;
    const num = Number(str);
    if (!isNaN(num) && str.trim() !== '') return num;
    try { return JSON.parse(str); } catch { return str; }
  }

  private levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[m][n];
  }

  private zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
    // 简化版 Zod -> JSON Schema 转换
    try {
      if (schema instanceof z.ZodObject) {
        const shape = schema.shape as Record<string, z.ZodType>;
        const properties: Record<string, unknown> = {};
        const required: string[] = [];

        for (const [key, fieldSchema] of Object.entries(shape)) {
          properties[key] = this.zodFieldToJsonSchema(fieldSchema);
          if (!(fieldSchema instanceof z.ZodOptional) && !(fieldSchema instanceof z.ZodDefault)) {
            required.push(key);
          }
        }

        return {
          type: 'object',
          properties,
          required: required.length > 0 ? required : undefined,
        };
      }
    } catch { /* ignore */ }
    return { type: 'object' };
  }

  private zodFieldToJsonSchema(schema: z.ZodType): Record<string, unknown> {
    if (schema instanceof z.ZodString) return { type: 'string', description: schema.description };
    if (schema instanceof z.ZodNumber) return { type: 'number', description: schema.description };
    if (schema instanceof z.ZodBoolean) return { type: 'boolean', description: schema.description };
    if (schema instanceof z.ZodArray) {
      return { type: 'array', items: this.zodFieldToJsonSchema(schema.element), description: schema.description };
    }
    if (schema instanceof z.ZodEnum) return { type: 'string', enum: schema.options, description: schema.description };
    if (schema instanceof z.ZodOptional) return { ...this.zodFieldToJsonSchema(schema.unwrap()), optional: true };
    if (schema instanceof z.ZodDefault) return { ...this.zodFieldToJsonSchema(schema.removeDefault()), default: schema._def.defaultValue() };
    if (schema instanceof z.ZodUnion) {
      const options = schema.options as z.ZodType[];
      return { oneOf: options.map(o => this.zodFieldToJsonSchema(o)) };
    }
    return { type: 'string' };
  }

  // ==================== 统计 ====================

  /**
   * 获取详细统计（Task 4.2: 增强可观测性）
   */
  getStats() {
    const totalStrategyHits = Object.values(this.stats.strategyHits).reduce((a, b) => a + b, 0);
    return {
      ...this.stats,
      totalStrategyHits,
      strategyDistribution: Object.entries(this.stats.strategyHits)
        .sort((a, b) => b[1] - a[1])
        .map(([name, hits]) => ({
          name,
          hits,
          pct: totalStrategyHits > 0 ? Math.round(hits / totalStrategyHits * 100) : 0,
        })),
      successRate: this.stats.totalCalls > 0
        ? Math.round((this.stats.totalCalls - this.stats.failedCalls) / this.stats.totalCalls * 100)
        : 0,
      registeredTools: this.tools.size,
    };
  }

  resetStats(): void {
    this.stats = {
      totalCalls: 0,
      nativeCalls: 0,
      parsedCalls: 0,
      repairedCalls: 0,
      failedCalls: 0,
      strategyHits: {},
    };
  }
}
