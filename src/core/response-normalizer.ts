/**
 * 响应格式标准化器
 *
 * 不同 LLM 返回的格式千差万别，这个类负责把它们统一。
 * 三层处理：
 *   Layer 1: HTTP 响应层面的格式差异（Ollama vs OpenAI）
 *   Layer 2: tool_calls 结构差异（字段缺失、类型不一致）
 *   Layer 3: 文本中混杂的工具调用（模型把工具调用写在自然语言里）
 */

export interface NormalizedResponse {
  role: 'assistant';
  content: string | null;
  toolCalls: NormalizedToolCall[];
  rawContent?: string;    // 原始文本（含工具调用 JSON）
}

export interface NormalizedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  source: 'native' | 'parsed' | 'inferred';  // 来源
}

export class ResponseNormalizer {

  private static idCounter = 0;

  /**
   * 生成唯一工具调用 ID
   */
  static generateId(): string {
    return `call_${Date.now()}_${++this.idCounter}_${Math.random().toString(36).slice(2, 6)}`;
  }

  /**
   * 标准化 AI SDK 的 step 结果
   * AI SDK 内部已经做了 Provider 格式转换，这里处理的是
   * AI SDK 无法处理的边界情况
   */
  static normalizeAIStep(step: any): NormalizedResponse {
    const content = step.text ?? step.content ?? '';
    const toolCalls: NormalizedToolCall[] = [];

    // 提取 tool calls
    if (step.toolCalls && Array.isArray(step.toolCalls)) {
      for (const tc of step.toolCalls) {
        toolCalls.push({
          id: tc.toolCallId ?? this.generateId(),
          name: tc.toolName ?? tc.name ?? '',
          arguments: typeof tc.args === 'string' ? this.safeParseJson(tc.args) : (tc.args ?? {}),
          source: 'native',
        });
      }
    }

    return {
      role: 'assistant',
      content: content || null,
      toolCalls,
      rawContent: content,
    };
  }

  /**
   * 从纯文本中解析工具调用
   * 这是给不支持原生 tool calling 的模型用的
   */
  static extractFromText(text: string): NormalizedResponse {
    const toolCalls: NormalizedToolCall[] = [];
    let cleanContent = text;

    // 策略 1: ```json { ... } ```
    const jsonBlocks = text.matchAll(/```json\s*([\s\S]*?)\s*```/g);
    for (const match of jsonBlocks) {
      const parsed = this.tryParseToolCall(match[1]);
      if (parsed) {
        toolCalls.push({ ...parsed, source: 'parsed' });
        cleanContent = cleanContent.replace(match[0], '').trim();
      }
    }

    // 策略 2:   (Qwen 风格)
    if (toolCalls.length === 0) {
      const funcBlocks = text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/?tool_call>/g);
      for (const match of funcBlocks) {
        const parsed = this.tryParseToolCall(match[1]);
        if (parsed) {
          toolCalls.push({ ...parsed, source: 'parsed' });
          cleanContent = cleanContent.replace(match[0], '').trim();
        }
      }
    }

    // 策略 3: 单行 <tool_call>... 缺少闭合标签时用括号匹配
    if (toolCalls.length === 0) {
      const singleFuncStart = text.match(/<tool_call>\s*/);
      if (singleFuncStart) {
        const jsonStart = singleFuncStart.index! + singleFuncStart[0].length;
        const jsonStr = this.extractJsonObject(text, jsonStart);
        if (jsonStr) {
          const parsed = this.tryParseToolCall(jsonStr);
          if (parsed) {
            toolCalls.push({ ...parsed, source: 'parsed' });
            const endIdx = jsonStart + jsonStr.length;
            cleanContent = (text.slice(0, singleFuncStart.index) + text.slice(endIdx)).trim();
          }
        }
      }
    }

    // 策略 3b: XML 标签包裹工具调用（<tool>name</tool><args>{...}</args>）
    if (toolCalls.length === 0) {
      const xmlToolMatch = text.match(/<tool\s*>\s*([^<]+?)\s*<\/tool\s*>(?:\s*<(?:args|arguments|parameter)\s*>\s*([\s\S]*?)\s*<\/(?:args|arguments|parameter)\s*>)?/i);
      if (xmlToolMatch) {
        const name = xmlToolMatch[1].trim();
        let args: Record<string, unknown> = {};
        if (xmlToolMatch[2]) {
          try { args = JSON.parse(xmlToolMatch[2].trim()); } catch { /* ignore */ }
        }
        toolCalls.push({ id: this.generateId(), name, arguments: args, source: 'parsed' });
        cleanContent = cleanContent.replace(xmlToolMatch[0], '').trim();
      }
    }

    // 策略 3c: <action name="tool">args</action>
    if (toolCalls.length === 0) {
      const actionMatch = text.match(/<action\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/action\s*>/i);
      if (actionMatch) {
        const name = actionMatch[1].trim();
        let args: Record<string, unknown> = {};
        if (actionMatch[2].trim()) {
          try { args = JSON.parse(actionMatch[2].trim()); } catch { /* ignore */ }
        }
        toolCalls.push({ id: this.generateId(), name, arguments: args, source: 'parsed' });
        cleanContent = cleanContent.replace(actionMatch[0], '').trim();
      }
    }

    // 策略 4:  参数化标签
    if (toolCalls.length === 0) {
      const invokeMatch = text.match(/<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/);
      if (invokeMatch) {
        const name = invokeMatch[1];
        const args: Record<string, unknown> = {};
        const paramRe = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g;
        let pm;
        while ((pm = paramRe.exec(invokeMatch[2])) !== null) {
          args[pm[1]] = this.coerceValue(pm[2].trim());
        }
        if (Object.keys(args).length > 0) {
          toolCalls.push({ id: this.generateId(), name, arguments: args, source: 'parsed' });
          cleanContent = cleanContent.replace(invokeMatch[0], '').trim();
        }
      }
    }

    // 策略 5: 纯 JSON（整段就是一个工具调用）
    if (toolCalls.length === 0) {
      const trimmed = text.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        const parsed = this.tryParseToolCall(trimmed);
        if (parsed) {
          toolCalls.push({ ...parsed, source: 'parsed' });
          cleanContent = '';
        }
      }
    }

    // 策略 6: JSON 嵌在文本中
    if (toolCalls.length === 0) {
      const start = text.indexOf('{"tool"');
      if (start !== -1) {
        let depth = 0;
        let end = -1;
        for (let i = start; i < text.length; i++) {
          if (text[i] === '{') depth++;
          if (text[i] === '}') depth--;
          if (depth === 0) { end = i + 1; break; }
        }
        if (end !== -1) {
          const parsed = this.tryParseToolCall(text.slice(start, end));
          if (parsed) {
            toolCalls.push({ ...parsed, source: 'parsed' });
            cleanContent = (text.slice(0, start) + text.slice(end)).trim();
          }
        }
      }
    }

    return {
      role: 'assistant',
      content: cleanContent || null,
      toolCalls,
      rawContent: text,
    };
  }

  /**
   * 合并两个 NormalizedResponse
   * 原生 tool calling 和文本解析可能同时有结果
   */
  static merge(native: NormalizedResponse, parsed: NormalizedResponse): NormalizedResponse {
    // 如果原生有工具调用，优先用原生
    if (native.toolCalls.length > 0) return native;
    // 如果解析有工具调用，用解析
    if (parsed.toolCalls.length > 0) return parsed;
    // 都没有，用原生的文本
    return native;
  }

  // ==================== 内部工具 ====================

  private static tryParseToolCall(jsonStr: string): { id: string; name: string; arguments: Record<string, unknown> } | null {
    try {
      // 清理
      let cleaned = jsonStr
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']')
        .replace(/'/g, '"')
        .trim();

      const parsed = JSON.parse(cleaned);

      // 格式 A: { tool: "...", args: {...} }
      if (parsed.tool && typeof parsed.tool === 'string') {
        return {
          id: this.generateId(),
          name: parsed.tool,
          arguments: (parsed.args && typeof parsed.args === 'object') ? parsed.args : {},
        };
      }

      // 格式 B: { function: { name: "...", arguments: "..." } } (OpenAI 原生)
      if (parsed.function?.name) {
        return {
          id: parsed.id ?? this.generateId(),
          name: parsed.function.name,
          arguments: typeof parsed.function.arguments === 'string'
            ? this.safeParseJson(parsed.function.arguments)
            : parsed.function.arguments ?? {},
        };
      }

      // 格式 C: { name: "...", arguments: {...} }
      if (parsed.name && typeof parsed.name === 'string') {
        return {
          id: this.generateId(),
          name: parsed.name,
          arguments: typeof parsed.arguments === 'string'
            ? this.safeParseJson(parsed.arguments)
            : parsed.arguments ?? {},
        };
      }
    } catch {
      // 尝试修复截断的 JSON
      try {
        const fixed = this.fixTruncatedJson(jsonStr.trim());
        if (fixed) return this.tryParseToolCall(fixed);
      } catch { /* 放弃 */ }
    }
    return null;
  }

  private static safeParseJson(str: string): Record<string, unknown> {
    try { return JSON.parse(str); }
    catch { return {}; }
  }

  private static fixTruncatedJson(text: string): string | null {
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

    return depth > 0 ? text + '}'.repeat(depth) : null;
  }

  /**
   * 从指定位置开始，用括号深度匹配提取完整 JSON 对象
   */
  private static extractJsonObject(text: string, start: number): string | null {
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

  private static coerceValue(str: string): unknown {
    if (str === 'true') return true;
    if (str === 'false') return false;
    if (str === 'null') return null;
    const num = Number(str);
    if (!isNaN(num) && str.trim() !== '') return num;
    try { return JSON.parse(str); } catch { return str; }
  }
}
