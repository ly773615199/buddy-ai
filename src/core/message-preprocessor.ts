/**
 * 消息预处理管线
 *
 * 职责：将 Buddy 内部消息格式转换为各 Provider 兼容的格式
 * 原则：内部格式不变，所有适配在出站时完成
 *
 * 处理内容：
 *   1. Role 映射（developer ↔ system）
 *   2. 消息顺序校正（system 必须在最前）
 *   3. 消息合并（多个 system → 一个）
 *   4. 消息交替校验（部分 provider 要求 user/assistant 严格交替）
 *   5. 空消息过滤
 */

// ==================== 类型定义 ====================

export interface InternalMessage {
  role: 'system' | 'user' | 'assistant' | 'developer';
  content: string;
  timestamp?: number;
  toolCalls?: unknown[];
}

/** 预处理后的消息 */
export interface ProcessedMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'developer';
  content: string;
  timestamp?: number;
  toolCalls?: unknown[];
}

export interface MessagePreprocessor {
  /** provider 标识 */
  readonly id: string;
  /** 完整管线：map → reorder → normalize → filter */
  process(messages: InternalMessage[]): ProcessedMessage[];
}

// ==================== 内置实现 ====================

/**
 * OpenAI 原生 — 保留 developer role（v6 默认行为）
 * 用于：openai
 */
export class OpenAIPreprocessor implements MessagePreprocessor {
  readonly id = 'openai';

  process(messages: InternalMessage[]): ProcessedMessage[] {
    return filterEmpty(messages.map((m) => ({
      role: m.role === 'developer' ? 'developer' as const : m.role,
      content: m.content,
      timestamp: m.timestamp,
      toolCalls: m.toolCalls,
    })));
  }
}

/**
 * 兼容模式 — developer → system，多 system 合并，顺序校正
 * 用于：deepseek / siliconflow / mimo / ollama / custom 及所有 OpenAI 兼容 provider
 */
export class CompatPreprocessor implements MessagePreprocessor {
  readonly id = 'compat';

  process(messages: InternalMessage[]): ProcessedMessage[] {
    let result: ProcessedMessage[] = messages.map((m) => ({
      role: (m.role === 'developer' ? 'system' : m.role) as ProcessedMessage['role'],
      content: m.content,
      timestamp: m.timestamp,
      toolCalls: m.toolCalls,
    }));

    // 合并多个 system 消息
    result = mergeSystemMessages(result);

    // system 必须在最前面
    result = reorderSystemFirst(result);

    // 过滤空消息
    result = filterEmpty(result);

    return result;
  }
}

/**
 * Anthropic 模式 — 消息必须 user/assistant 严格交替
 * 用于：anthropic
 */
export class AnthropicPreprocessor implements MessagePreprocessor {
  readonly id = 'anthropic';

  process(messages: InternalMessage[]): ProcessedMessage[] {
    let result: ProcessedMessage[] = messages.map((m) => ({
      role: (m.role === 'developer' ? 'system' : m.role) as ProcessedMessage['role'],
      content: m.content,
      timestamp: m.timestamp,
      toolCalls: m.toolCalls,
    }));

    // system 放最前
    result = reorderSystemFirst(result);

    // user/assistant 严格交替：连续同 role 的非 system 消息合并
    result = enforceAlternation(result);

    result = filterEmpty(result);

    return result;
  }
}

/**
 * Google Gemini 模式 — 类似 OpenAI 但对 system 位置敏感
 * 用于：google
 */
export class GooglePreprocessor implements MessagePreprocessor {
  readonly id = 'google';

  process(messages: InternalMessage[]): ProcessedMessage[] {
    let result: ProcessedMessage[] = messages.map((m) => ({
      role: (m.role === 'developer' ? 'system' : m.role) as ProcessedMessage['role'],
      content: m.content,
      timestamp: m.timestamp,
      toolCalls: m.toolCalls,
    }));
    result = mergeSystemMessages(result);
    result = reorderSystemFirst(result);
    result = filterEmpty(result);
    return result;
  }
}

// ==================== 工具函数 ====================

/** 合并多个 system 消息为一个 */
function mergeSystemMessages(messages: ProcessedMessage[]): ProcessedMessage[] {
  const systems = messages.filter((m) => m.role === 'system');
  const others = messages.filter((m) => m.role !== 'system');

  if (systems.length <= 1) return messages;

  const merged: ProcessedMessage = {
    role: 'system',
    content: systems.map((s) => s.content).filter(Boolean).join('\n\n'),
    timestamp: systems[0].timestamp,
  };

  return [merged, ...others];
}

/** system 消息必须排在最前面 */
function reorderSystemFirst(messages: ProcessedMessage[]): ProcessedMessage[] {
  const systems = messages.filter((m) => m.role === 'system');
  const others = messages.filter((m) => m.role !== 'system');
  return [...systems, ...others];
}

/** 强制 user/assistant 严格交替（连续同 role 合并） */
function enforceAlternation(messages: ProcessedMessage[]): ProcessedMessage[] {
  const result: ProcessedMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      result.push(msg);
      continue;
    }

    const last = result[result.length - 1];
    if (last && last.role === msg.role) {
      // 连续同 role，合并内容
      last.content += '\n\n' + msg.content;
      // 保留 toolCalls（合并而非丢弃）
      if (msg.toolCalls?.length) {
        last.toolCalls = [...(last.toolCalls ?? []), ...msg.toolCalls];
      }
    } else {
      result.push({ ...msg });
    }
  }

  return result;
}

/** 过滤空消息 */
function filterEmpty(messages: ProcessedMessage[]): ProcessedMessage[] {
  return messages.filter((m) => m.content && m.content.trim().length > 0);
}

// ==================== 预处理器注册表 ====================

const PREPROCESSORS: Record<string, MessagePreprocessor> = {
  openai: new OpenAIPreprocessor(),
  anthropic: new AnthropicPreprocessor(),
  google: new GooglePreprocessor(),
  deepseek: new CompatPreprocessor(),
  siliconflow: new CompatPreprocessor(),
  mimo: new CompatPreprocessor(),
  ollama: new CompatPreprocessor(),
  custom: new CompatPreprocessor(),
};

/**
 * 获取 provider 对应的预处理器
 * 未知 provider 默认使用 CompatPreprocessor
 */
export function getPreprocessor(providerId: string): MessagePreprocessor {
  return PREPROCESSORS[providerId] ?? new CompatPreprocessor();
}

/**
 * 注册自定义预处理器
 */
export function registerPreprocessor(id: string, preprocessor: MessagePreprocessor): void {
  PREPROCESSORS[id] = preprocessor;
}
