/**
 * Provider Adapter — 统一的 provider 适配接口
 *
 * 把消息预处理、能力管理、模型创建、错误处理封装成一个对象。
 * 新增 provider 只需要实现这个接口，或直接用 OpenAICompatAdapter 一行注册。
 *
 * 设计原则：
 *   1. 内部格式不变，所有适配在 Adapter 层完成
 *   2. 新 provider 零代码接入（registerSimple）
 *   3. 能力可静态标记，也可运行时探测
 *   4. 错误分类准确，给用户可操作的建议
 */

import { createOpenAICompatible, type OpenAICompatibleProvider } from '@ai-sdk/openai-compatible';
import { createOpenAI } from '@ai-sdk/openai';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import type { LanguageModel } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import {
  type MessagePreprocessor,
  type InternalMessage,
  type ProcessedMessage,
  getPreprocessor,
  CompatPreprocessor,
  OpenAIPreprocessor,
  AnthropicPreprocessor,
  GooglePreprocessor,
} from './message-preprocessor.js';
import { CapabilityProber, type ProbeResult } from './capability-prober.js';

// ==================== 类型定义 ====================

export interface ProviderCapabilities {
  /** 是否原生支持 tool calling */
  toolCalling: boolean;
  /** 是否支持流式输出 */
  streaming: boolean;
  /** 是否支持 structured output (Output.object) */
  structuredOutput: boolean;
  /** 是否支持图片输入 */
  vision: boolean;
  /** 最大上下文 token 数 */
  maxContextTokens: number;
  /** 最大输出 token 数 */
  maxOutputTokens: number;
  /** toolChoice 支持级别 */
  toolChoice: 'strict' | 'auto' | false;
  /** 是否支持并行工具调用 */
  parallelToolCalls: boolean;
  /** 是否需要 Prompt 模拟工具调用 */
  needsPromptToolCalling: boolean;
  /** 模型的工具调用格式偏好 */
  preferredToolFormat: 'openai' | 'anthropic' | 'qwen_tags' | 'json_block' | 'natural';
  /** 是否支持 AI SDK v6 的 role: 'developer' 消息格式 */
  supportsDeveloperRole: boolean;
}

export interface AdapterConfig {
  apiKey?: string;
  baseUrl?: string;
  model: string;
}

export type ErrorReason = 'rate_limit' | 'auth' | 'format' | 'network' | 'timeout' | 'unknown';

export interface ErrorClassification {
  retryable: boolean;
  reason: ErrorReason;
  suggestion?: string;
}

export interface ProviderAdapter {
  /** 适配器标识 */
  readonly id: string;
  /** 显示名称 */
  readonly name: string;

  /** 创建模型实例（可返回 Promise） */
  createModel(config: AdapterConfig): LanguageModel | Promise<LanguageModel>;

  /** 消息预处理 */
  preprocess(messages: InternalMessage[]): ProcessedMessage[];

  /** 获取静态能力标记 */
  getStaticCapabilities(model?: string): ProviderCapabilities;

  /** 错误分类 */
  classifyError(error: Error): ErrorClassification;

  /** 健康检查 */
  healthCheck(model: LanguageModel): Promise<boolean>;
}

// ==================== OpenAI 兼容适配器 ====================

/**
 * OpenAI 兼容适配器 — 覆盖大部分第三方 provider
 *
 * 用法：
 *   // 一行注册新 provider
 *   registry.register(new OpenAICompatAdapter('new-platform', '新平台', 'https://api.new-platform.com/v1'));
 */
export class OpenAICompatAdapter implements ProviderAdapter {
  private preprocessor: MessagePreprocessor;
  private defaultCapabilities: ProviderCapabilities;
  private detectToolSupport?: (model: string) => boolean;
  private modelCapabilities: Record<string, Partial<ProviderCapabilities>>;

  constructor(
    readonly id: string,
    readonly name: string,
    private defaultBaseUrl: string,
    options?: {
      systemMessageMode?: 'system' | 'developer';
      capabilities?: Partial<ProviderCapabilities>;
      preprocessor?: MessagePreprocessor;
      detectToolSupport?: (model: string) => boolean;
      modelCapabilities?: Record<string, Partial<ProviderCapabilities>>;
    },
  ) {
    this.preprocessor = options?.preprocessor ?? new CompatPreprocessor();
    this.detectToolSupport = options?.detectToolSupport;
    this.modelCapabilities = options?.modelCapabilities ?? {};
    this.defaultCapabilities = {
      toolCalling: true,
      streaming: true,
      structuredOutput: false,
      vision: false,
      maxContextTokens: 32000,
      maxOutputTokens: 8192,
      toolChoice: 'auto',
      parallelToolCalls: false,
      needsPromptToolCalling: false,
      preferredToolFormat: 'openai',
      supportsDeveloperRole: options?.systemMessageMode === 'developer',
      ...options?.capabilities,
    };
  }

  createModel(config: AdapterConfig): LanguageModel {
    const provider = createOpenAICompatible({
      name: this.id,
      apiKey: config.apiKey ?? '',
      baseURL: config.baseUrl ?? this.defaultBaseUrl,
      // 修复 role:developer → system（AI SDK v6 对非 OpenAI 模型的问题）
      transformRequestBody: (body: Record<string, unknown>) => {
        if (body.messages && Array.isArray(body.messages)) {
          body.messages = (body.messages as any[]).map((msg: any) => {
            if (msg && msg.role === 'developer') {
              return { ...msg, role: 'system' };
            }
            return msg;
          });
        }
        return body;
      },
    });
    return provider.chatModel(config.model);
  }

  preprocess(messages: InternalMessage[]): ProcessedMessage[] {
    return this.preprocessor.process(messages);
  }

  getStaticCapabilities(model?: string): ProviderCapabilities {
    const caps = { ...this.defaultCapabilities };
    // 按模型动态调整 tool calling 支持
    if (model && this.detectToolSupport) {
      const supported = this.detectToolSupport(model);
      if (!supported) {
        caps.toolCalling = false;
        caps.needsPromptToolCalling = false;
      }
    }
    // 按模型覆盖能力（如 DeepSeek 支持原生 function calling）
    if (model) {
      for (const [keyword, override] of Object.entries(this.modelCapabilities)) {
        if (model.toLowerCase().includes(keyword.toLowerCase())) {
          Object.assign(caps, override);
          break;
        }
      }
    }
    return caps;
  }

  classifyError(error: Error): ErrorClassification {
    const msg = error.message.toLowerCase();

    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) {
      return { retryable: true, reason: 'rate_limit', suggestion: '请求太频繁，稍后再试' };
    }
    if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('invalid api key')) {
      return { retryable: false, reason: 'auth', suggestion: '检查 API Key 是否正确或已过期' };
    }
    if (msg.includes('developer') || msg.includes('role') || msg.includes('invalid message')) {
      return { retryable: false, reason: 'format', suggestion: '该 Provider 可能不兼容当前消息格式，检查 systemMessageMode 配置' };
    }
    if (msg.includes('timeout') || msg.includes('etimedout')) {
      return { retryable: true, reason: 'timeout', suggestion: '请求超时，可能是网络问题或模型响应太慢' };
    }
    if (msg.includes('econnrefused') || msg.includes('econnreset') || msg.includes('network') || msg.includes('fetch failed')) {
      return { retryable: true, reason: 'network', suggestion: '网络连接失败，检查 baseUrl 和网络状态' };
    }

    return { retryable: true, reason: 'unknown' };
  }

  async healthCheck(model: LanguageModel): Promise<boolean> {
    try {
      const { generateText } = await import('ai');
      await generateText({ model, prompt: 'ping', maxOutputTokens: 3 });
      return true;
    } catch {
      return false;
    }
  }
}

// ==================== 内置适配器实例 ====================

/** OpenAI 原生 — 使用 developer role */
export class OpenAIAdapter extends OpenAICompatAdapter {
  constructor() {
    super('openai', 'OpenAI', 'https://api.openai.com/v1', {
      systemMessageMode: 'developer',
      preprocessor: new OpenAIPreprocessor(),
      capabilities: {
        toolCalling: true,
        streaming: true,
        structuredOutput: true,
        vision: true,
        maxContextTokens: 128000,
        maxOutputTokens: 16384,
        toolChoice: 'strict',
        parallelToolCalls: true,
        supportsDeveloperRole: true,
      },
    });
  }

  // OpenAI 用原生 SDK，不用 openai-compatible
  createModel(config: AdapterConfig): LanguageModel {
    const p = createOpenAI({
      apiKey: config.apiKey ?? '',
      baseURL: config.baseUrl ?? 'https://api.openai.com/v1',
    });
    return p.chat(config.model);
  }
}

/** Anthropic Claude — 独立 SDK，特殊消息处理 */
export class AnthropicAdapter implements ProviderAdapter {
  readonly id = 'anthropic';
  readonly name = 'Anthropic (Claude)';
  private preprocessor = new AnthropicPreprocessor();

  async createModel(config: AdapterConfig): Promise<LanguageModel> {
    try {
      const { createAnthropic } = await import('@ai-sdk/anthropic');
      const p = createAnthropic({ apiKey: config.apiKey ?? '' });
      return p.chat(config.model);
    } catch {
      throw new Error('Anthropic provider 需要安装 @ai-sdk/anthropic: npm install @ai-sdk/anthropic');
    }
  }

  preprocess(messages: InternalMessage[]): ProcessedMessage[] {
    return this.preprocessor.process(messages);
  }

  getStaticCapabilities(): ProviderCapabilities {
    return {
      toolCalling: true,
      streaming: true,
      structuredOutput: true,
      vision: true,
      maxContextTokens: 200000,
      maxOutputTokens: 8192,
      toolChoice: 'auto',
      parallelToolCalls: true,
      needsPromptToolCalling: false,
      preferredToolFormat: 'anthropic',
      supportsDeveloperRole: true,
    };
  }

  classifyError(error: Error): ErrorClassification {
    const msg = error.message.toLowerCase();
    if (msg.includes('429') || msg.includes('rate limit')) {
      return { retryable: true, reason: 'rate_limit', suggestion: 'Anthropic API 请求频率超限，稍后再试' };
    }
    if (msg.includes('401') || msg.includes('403')) {
      return { retryable: false, reason: 'auth', suggestion: '检查 Anthropic API Key' };
    }
    return { retryable: true, reason: 'unknown' };
  }

  async healthCheck(model: LanguageModel): Promise<boolean> {
    try {
      const { generateText } = await import('ai');
      await generateText({ model, prompt: 'ping', maxOutputTokens: 3 });
      return true;
    } catch {
      return false;
    }
  }
}

/** Google Gemini — 独立 SDK */
export class GoogleAdapter implements ProviderAdapter {
  readonly id = 'google';
  readonly name = 'Google (Gemini)';
  private preprocessor = new GooglePreprocessor();

  async createModel(config: AdapterConfig): Promise<LanguageModel> {
    try {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      const p = createGoogleGenerativeAI({ apiKey: config.apiKey ?? '' });
      return p.chat(config.model);
    } catch {
      throw new Error('Google provider 需要安装 @ai-sdk/google: npm install @ai-sdk/google');
    }
  }

  preprocess(messages: InternalMessage[]): ProcessedMessage[] {
    return this.preprocessor.process(messages);
  }

  getStaticCapabilities(): ProviderCapabilities {
    return {
      toolCalling: true,
      streaming: true,
      structuredOutput: true,
      vision: true,
      maxContextTokens: 1000000,
      maxOutputTokens: 8192,
      toolChoice: 'auto',
      parallelToolCalls: false,
      needsPromptToolCalling: false,
      preferredToolFormat: 'openai',
      supportsDeveloperRole: true,
    };
  }

  classifyError(error: Error): ErrorClassification {
    const msg = error.message.toLowerCase();
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('quota')) {
      return { retryable: true, reason: 'rate_limit', suggestion: 'Google API 配额超限，稍后再试' };
    }
    if (msg.includes('401') || msg.includes('403')) {
      return { retryable: false, reason: 'auth', suggestion: '检查 Google API Key' };
    }
    return { retryable: true, reason: 'unknown' };
  }

  async healthCheck(model: LanguageModel): Promise<boolean> {
    try {
      const { generateText } = await import('ai');
      await generateText({ model, prompt: 'ping', maxOutputTokens: 3 });
      return true;
    } catch {
      return false;
    }
  }
}

// ==================== 适配器注册中心 ====================

/**
 * Provider 适配器注册中心 — 单例
 *
 * 三种接入方式：
 *   1. 内置适配器（OpenAI / Anthropic / Google / DeepSeek / SiliconFlow / MiMo / Ollama）
 *   2. 一行注册：registry.registerSimple('new-id', 'https://api.new.com/v1')
 *   3. 完全自定义：registry.register(new MyCustomAdapter())
 */
// ==================== Mock LLM Provider（E2E 测试专用）====================

/**
 * 根据用户输入生成模拟回复
 * 当输入匹配工具相关意图时，返回含工具调用 JSON 的文本，
 * 让 UniversalToolCaller 解析并真实执行工具。
 *
 * 关键：只用第一行（用户实际输入）做匹配，避免系统 prompt 中的工具描述干扰。
 */
function _mockResponse(input: string): string {
  // 提取第一行作为主要判断依据（系统 prompt 是多行的，用户消息通常单行）
  const firstLine = input.split('\n').find(l => l.trim().length > 0)?.trim() ?? '';
  const lower = firstLine.toLowerCase();
  const isShort = firstLine.length < 200;

  // 工具调用意图 → 返回含 ```json 代码块的文本
  // 使用行首锚定 + 明确动词，避免匹配系统 prompt 中的工具描述
  if (isShort && /^(帮我|请)?\s*(列出|列表|看看|查看).*目录|(帮我|请)?\s*(列出|列表)\s*[.~]/i.test(lower)) {
    const pathMatch = firstLine.match(/[.~/][\w/.-]*/);
    const path = pathMatch?.[0] ?? '.';
    return `好的，让我看看目录里有什么。\n\n\`\`\`json\n{"tool": "list_files", "args": {"path": "${path}"}}\n\`\`\``;
  }
  if (isShort && /^(帮我|请)?\s*(读取|读|打开|查看|看看)\s*[\w./-]+\.\w+/i.test(firstLine)) {
    const fileMatch = firstLine.match(/[\w./-]+\.\w+/);
    const path = fileMatch?.[0] ?? 'package.json';
    return `好的，我来读取这个文件。\n\n\`\`\`json\n{"tool": "read_file", "args": {"path": "${path}"}}\n\`\`\``;
  }
  if (isShort && /^(帮我|请)?\s*(执行|运行|跑)\s+/i.test(firstLine)) {
    const cmd = firstLine.replace(/^(帮我|请|执行|运行|跑)\s*/i, '').trim() || 'echo hello';
    return `好的，执行命令。\n\n\`\`\`json\n{"tool": "exec", "args": {"command": "${cmd}"}}\n\`\`\``;
  }
  if (isShort && /^(帮我|请)?\s*(搜索|查找|找|搜)\s+/i.test(firstLine)) {
    const pattern = firstLine.replace(/.*?(搜索|查找|找|搜)\s*['"""]?/i, '').replace(/['"""]$/, '').trim() || 'test';
    return `让我搜索一下。\n\n\`\`\`json\n{"tool": "search_files", "args": {"pattern": "${pattern}", "path": "."}}\n\`\`\``;
  }
  if (isShort && /git\s*(状态|status)|^看看\s*git/i.test(lower)) {
    return '看看 Git 状态。\n\n```json\n{"tool": "git_status", "args": {"repo_path": "."}}\n```';
  }
  if (isShort && /^(现在|几点|什么时间|time)/i.test(lower)) {
    return '让我看看现在几点了。\n\n```json\n{"tool": "get_time", "args": {}}\n```';
  }

  // 闲聊 → 纯文本回复（不触发工具）
  if (/^(你好|hello|hi|嗨)\b/i.test(lower)) return '你好！我是你的 Buddy 🦊，很高兴见到你！';
  if (/^(1\+1|一加一)\b/.test(lower)) return '1+1=2，这是最基本的数学运算。';
  const replies = ['收到！让我想想怎么帮你。', '好的，我来处理这个。', '没问题，我来试试。', '了解，让我分析一下。'];
  return replies[Math.floor(Math.random() * replies.length)];
}

export class MockProviderAdapter implements ProviderAdapter {
  readonly id = 'mock';
  readonly name = 'Mock LLM (E2E)';

  createModel(_config: AdapterConfig): LanguageModel {
    return new MockLanguageModelV3({
      provider: 'mock',
      modelId: 'mock-model',
      doGenerate: async ({ prompt }) => {
        const lastUserMsg = [...prompt].reverse().find((m: any) => m.role === 'user');
        const input = Array.isArray(lastUserMsg?.content)
          ? lastUserMsg.content.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('')
          : (lastUserMsg?.content as string) ?? '';
        const text = _mockResponse(input);
        return {
          text, finishReason: 'stop' as const,
          usage: { inputTokens: 10, outputTokens: 20 },
          response: { id: `mock-${Date.now()}`, modelId: 'mock-model', timestamp: new Date() },
          request: { body: {} }, warnings: [],
          content: [{ type: 'text' as const, text }],
        } as any;
      },
      doStream: async ({ prompt }) => {
        const lastUserMsg = [...prompt].reverse().find((m: any) => m.role === 'user');
        const input = Array.isArray(lastUserMsg?.content)
          ? lastUserMsg.content.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('')
          : (lastUserMsg?.content as string) ?? '';
        const text = _mockResponse(input);
        let idx = 0;
        return {
          stream: new ReadableStream({
            pull(controller) {
              if (idx < text.length) {
                controller.enqueue({ type: 'text-delta' as const, textDelta: text[idx++] });
              } else {
                controller.enqueue({ type: 'finish' as const, finishReason: 'stop' as const, usage: { inputTokens: 10, outputTokens: 20 } } as any);
                controller.close();
              }
            },
          }),
          response: { id: `mock-${Date.now()}`, modelId: 'mock-model', timestamp: new Date() },
          request: { body: {} },
        } as any;
      },
    }) as unknown as LanguageModel;
  }

  getStaticCapabilities(_model: string): ProviderCapabilities {
    return {
      toolCalling: false, streaming: true, structuredOutput: false, vision: false,
      maxContextTokens: 4096, maxOutputTokens: 2048, toolChoice: false,
      parallelToolCalls: false, needsPromptToolCalling: true,
      preferredToolFormat: 'json_block', supportsDeveloperRole: false,
    };
  }

  preprocess(messages: InternalMessage[]): ProcessedMessage[] {
    return new OpenAIPreprocessor().process(messages);
  }

  classifyError(_err: Error) {
    return { retryable: false, reason: 'unknown' as const, suggestion: 'Mock provider error' };
  }

  getInstallUrl(): string { return ''; }
  checkDependencies(): { ok: boolean; install?: string } { return { ok: true }; }
  async healthCheck(_model: LanguageModel): Promise<boolean> { return true; }
}

// ==================== AdapterRegistry ====================

export class AdapterRegistry {
  private adapters = new Map<string, ProviderAdapter>();

  constructor() {
    // Mock LLM: E2E 测试时激活
    if (process.env.BUDDY_MOCK_LLM === '1') {
      this.register(new MockProviderAdapter());
      console.log('[MockLLM] ✅ Mock provider 已注册');
    }

    // 内置适配器
    this.register(new OpenAIAdapter());
    this.register(new AnthropicAdapter());
    this.register(new GoogleAdapter());

    // OpenAI 兼容 provider
    this.register(new OpenAICompatAdapter('deepseek', 'DeepSeek', 'https://api.deepseek.com/v1', {
      capabilities: {
        maxContextTokens: 64000,
        parallelToolCalls: true,
        supportsDeveloperRole: false,
      },
    }));

    this.register(new OpenAICompatAdapter('siliconflow', '硅基流动 (SiliconFlow)', 'https://api.siliconflow.cn/v1', {
      capabilities: {
        vision: true,
        toolCalling: true,
        needsPromptToolCalling: true,  // 默认用 prompt 模拟（Qwen 不支持原生）
        preferredToolFormat: 'qwen_tags',
        supportsDeveloperRole: false,
      },
      detectToolSupport: (model: string) => {
        const supported = ['qwen', 'deepseek', 'glm', 'internlm', 'yi', 'mistral', 'llama', 'command'];
        return supported.some((s) => model.toLowerCase().includes(s));
      },
      // 按模型覆盖能力：DeepSeek 支持原生 function calling
      modelCapabilities: {
        'deepseek': { needsPromptToolCalling: false, preferredToolFormat: 'openai' as const },
        'glm': { needsPromptToolCalling: false, preferredToolFormat: 'openai' as const },
      },
    }));

    this.register(new OpenAICompatAdapter('mimo', '小米 MiMo', 'https://api.xiaomimimo.com/v1', {
      capabilities: {
        vision: true,
        supportsDeveloperRole: false,
      },
    }));

    // NVIDIA NIM — 英伟达推理微服务（OpenAI 兼容）
    this.register(new OpenAICompatAdapter('nvidia', 'NVIDIA NIM', 'https://integrate.api.nvidia.com/v1', {
      capabilities: {
        vision: true,
        toolCalling: true,
        maxContextTokens: 128000,
        supportsDeveloperRole: false,
      },
    }));

    this.register(new OpenAICompatAdapter('ollama', 'Ollama (本地)', 'http://localhost:11434/v1', {
      capabilities: {
        vision: true,
        maxOutputTokens: 4096,
        toolChoice: false,
        preferredToolFormat: 'json_block',
        supportsDeveloperRole: false,
      },
      detectToolSupport: (model: string) => {
        const supported = [
          'qwen2.5', 'qwen3', 'qwen2.5-coder',
          'llama3.1', 'llama3.2', 'llama3.3',
          'mistral', 'mixtral', 'command-r', 'firefunction',
          'nemotron', 'granite3', 'athene-v2',
        ];
        return supported.some((s) => model.toLowerCase().includes(s));
      },
    }));

    // LM Studio — 本地 LLM 运行时（默认端口 1234）
    // 自动检测模型能力：tool calling、vision 等
    this.register(new OpenAICompatAdapter('lmstudio', 'LM Studio (本地)', 'http://localhost:1234/v1', {
      capabilities: {
        vision: true,
        maxOutputTokens: 4096,
        toolChoice: false,
        preferredToolFormat: 'json_block',
        supportsDeveloperRole: false,
      },
      detectToolSupport: (model: string) => {
        // LM Studio 支持 tool calling 的模型（与 Ollama 类似，但格式偏好不同）
        const supported = [
          'qwen2.5', 'qwen3', 'qwen2.5-coder',
          'llama3.1', 'llama3.2', 'llama3.3',
          'mistral', 'mixtral', 'command-r', 'firefunction',
          'nemotron', 'granite3', 'athene-v2',
          'deepseek', 'glm', 'internlm',
        ];
        return supported.some((s) => model.toLowerCase().includes(s));
      },
      // 按模型覆盖能力
      modelCapabilities: {
        'deepseek': { needsPromptToolCalling: false, preferredToolFormat: 'openai' as const },
        'glm': { needsPromptToolCalling: false, preferredToolFormat: 'openai' as const },
        'qwen3': { needsPromptToolCalling: false, preferredToolFormat: 'openai' as const },
      },
    }));

    this.register(new OpenAICompatAdapter('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', {
      capabilities: {
        vision: true,
        toolCalling: true,
        maxContextTokens: 128000,
        supportsDeveloperRole: false,
      },
    }));

    this.register(new OpenAICompatAdapter('custom', '自定义 (OpenAI 兼容)', '', {
      capabilities: {
        maxOutputTokens: 4096,
        preferredToolFormat: 'json_block',
        supportsDeveloperRole: false,
      },
    }));
  }

  /**
   * 注册适配器
   */
  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  /**
   * 一行注册新 OpenAI 兼容 provider
   */
  registerSimple(id: string, baseUrl: string, name?: string): void {
    this.register(new OpenAICompatAdapter(id, name ?? id, baseUrl));
  }

  /**
   * 获取适配器
   */
  get(id: string): ProviderAdapter | undefined {
    return this.adapters.get(id);
  }

  /**
   * 获取适配器，未知 provider 自动降级到 custom
   */
  getOrFallback(id: string, baseUrl?: string): ProviderAdapter {
    const adapter = this.adapters.get(id);
    if (adapter) return adapter;

    if (baseUrl) {
      console.log(`[Adapter] "${id}" 未注册，自动按 OpenAI 兼容模式处理 (${baseUrl})`);
      return new OpenAICompatAdapter(id, `${id} (auto)`, baseUrl);
    }

    throw new Error(
      `未知的 Provider: "${id}"\n` +
      `已注册: ${[...this.adapters.keys()].join(', ')}\n` +
      `提示: 未知 Provider 需要提供 baseUrl（OpenAI 兼容地址）`,
    );
  }

  /**
   * 列出所有已注册的适配器
   */
  list(): Array<{ id: string; name: string }> {
    return [...this.adapters.entries()].map(([id, adapter]) => ({ id, name: adapter.name }));
  }

  /**
   * 检查 provider 依赖
   */
  async checkDependencies(provider: string): Promise<{ ok: boolean; install?: string }> {
    switch (provider) {
      case 'anthropic':
        try {
          await import('@ai-sdk/anthropic');
          return { ok: true };
        } catch {
          return { ok: false, install: 'npm install @ai-sdk/anthropic' };
        }
      case 'google':
        try {
          await import('@ai-sdk/google');
          return { ok: true };
        } catch {
          return { ok: false, install: 'npm install @ai-sdk/google' };
        }
      default:
        return { ok: true };
    }
  }
}

/** 全局单例 */
export const adapterRegistry = new AdapterRegistry();
