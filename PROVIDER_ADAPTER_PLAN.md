# Provider Adapter 适配层改造计划

> AI SDK v6 兼容性修复 + 多 Provider 统一适配中间层
> 
> 目标：新平台接入只需填一个 URL，消息链路端到端稳定

---

## 背景

### 问题链路

```
用户 ←→ Buddy ←→ AI SDK v6 ←→ Provider ←→ LLM
       ① 内部格式   ② SDK转换    ③ Provider差异
```

### 已知问题清单

| # | 问题 | 影响范围 | 严重度 |
|---|------|---------|--------|
| P1 | AI SDK v6 将 `system` → `role: 'developer'` | 硅基流动/MiMo/DeepSeek/Ollama 调用报错 | 🔴 阻塞 |
| P2 | `generateObject` / `streamObject` 已废弃 | 未来版本编译失败 | 🟡 预警 |
| P3 | `CoreMessage` 类型已删除 | 类型报错 | 🟡 预警 |
| P4 | `preferredToolFormat` 定义但未实现转换 | 非 OpenAI 格式 provider 工具调用不稳定 | 🟡 隐患 |
| P5 | Provider 能力全靠手动静态标记 | 新 provider 接入成本高、易出错 | 🟡 长期 |
| P6 | 消息顺序/多 system 等边界未处理 | 部分 provider 静默失败 | 🟢 边界 |

### 设计目标

1. **新 provider 接入零代码** — 只需 `baseUrl`，能力自动探测
2. **消息链路端到端可靠** — role/顺序/格式自动转换，不依赖 LLM "自觉"
3. **向后兼容** — 不破坏现有 provider 的工作方式
4. **可观测** — 每次转换都有日志，出问题能定位

---

## Phase 1：紧急修复（0.5 天）

> 目标：让硅基流动/MiMo/DeepSeek/Ollama 立刻能用

### 1.1 使用 `systemMessageMode` 修复 role 问题

**文件：** `src/core/provider-registry.ts`

**改动：** 所有使用 `createOpenAI` 的 provider，加 `systemMessageMode: 'system'`

```typescript
// 硅基流动
createModel: ({ apiKey, baseUrl, model }) => {
  const p = createOpenAI({
    apiKey,
    baseURL: baseUrl ?? 'https://api.siliconflow.cn/v1',
    systemMessageMode: 'system',  // ← 加这一行
  });
  return p.chat(model);
},
```

**需要改的 provider：**
- [x] `siliconflow` — 硅基流动
- [x] `mimo` — 小米 MiMo
- [x] `deepseek` — DeepSeek
- [x] `ollama` — Ollama 本地
- [x] `custom` — 自定义 OpenAI 兼容

**不需要改的：**
- `openai` — 自己家，支持 `developer`
- `anthropic` — 走独立 SDK，不经过 `createOpenAI`
- `google` — 走独立 SDK，不经过 `createOpenAI`

### 1.2 清理之前的 wrapper 方案

如果已经加了 `wrapModelRoleCompat`，回退掉，改用 `systemMessageMode`。

### 1.3 验证

```bash
# 测试每个 provider 能正常 chat
node -e "
const { ProviderFactory } = require('./dist/core/provider-registry');
const p = ProviderFactory.create({ provider: 'siliconflow', model: 'Qwen/Qwen2.5-7B-Instruct', apiKey: 'test', baseUrl: 'https://api.siliconflow.cn/v1' });
console.log('OK:', p.capabilities);
"
```

---

## Phase 2：消息预处理中间层（2 天）

> 目标：建立统一的消息转换管线，新问题改一处即可

### 2.1 新建 `src/core/message-preprocessor.ts`

```typescript
/**
 * 消息预处理管线
 *
 * 职责：将 Buddy 内部消息格式转换为各 Provider 兼容的格式
 * 原则：内部格式不变，所有适配在出站时完成
 */

export interface MessagePreprocessor {
  /** provider 标识 */
  id: string;

  /** role 映射：内部 role → provider role */
  mapRole(role: string): string;

  /** 消息顺序校验和修复（如 system 必须在第一位） */
  reorder(messages: InternalMessage[]): InternalMessage[];

  /** 消息合并/拆分（如多个 system → 合并成一个） */
  normalize(messages: InternalMessage[]): InternalMessage[];

  /** 完整管线：map → reorder → normalize */
  process(messages: InternalMessage[]): InternalMessage[];
}

export interface InternalMessage {
  role: 'system' | 'user' | 'assistant' | 'developer';
  content: string;
  timestamp?: number;
  toolCalls?: unknown[];
}
```

### 2.2 内置 Preprocessor 实现

```typescript
/** OpenAI 原生 — 保留 developer role（v6 默认行为） */
export class OpenAIPreprocessor implements MessagePreprocessor {
  id = 'openai';
  mapRole(role) { return role; }  // 不转换
  reorder(msgs) { return msgs; }
  normalize(msgs) { return msgs; }
}

/** 兼容模式 — developer → system，多 system 合并 */
export class CompatPreprocessor implements MessagePreprocessor {
  id = 'compat';
  mapRole(role) { return role === 'developer' ? 'system' : role; }
  
  reorder(msgs) {
    // system 必须在最前面
    const systems = msgs.filter(m => m.role === 'system');
    const others = msgs.filter(m => m.role !== 'system');
    return [...systems, ...others];
  }
  
  normalize(msgs) {
    // 多个 system 合并成一个
    const systems = msgs.filter(m => m.role === 'system');
    const others = msgs.filter(m => m.role !== 'system');
    if (systems.length <= 1) return msgs;
    const merged = {
      role: 'system' as const,
      content: systems.map(s => s.content).join('\n\n'),
      timestamp: systems[0].timestamp,
    };
    return [merged, ...others];
  }
}

/** Anthropic 模式 — system 独立传，消息必须 user/assistant 交替 */
export class AnthropicPreprocessor implements MessagePreprocessor {
  id = 'anthropic';
  mapRole(role) { return role; }
  
  reorder(msgs) {
    // Anthropic 要求 user/assistant 严格交替
    // 连续同 role 的消息需要合并
    const result: InternalMessage[] = [];
    for (const msg of msgs) {
      const last = result[result.length - 1];
      if (last && last.role === msg.role && msg.role !== 'system') {
        last.content += '\n\n' + msg.content;
      } else {
        result.push({ ...msg });
      }
    }
    return result;
  }
  
  normalize(msgs) { return msgs; }
}
```

### 2.3 注册表集成

**改动文件：** `src/core/provider-registry.ts`

```typescript
// ProviderDef 增加 preprocessor 字段
export interface ProviderDef {
  name: string;
  capabilities: ProviderCapabilities;
  createModel: (config: ModelConfig) => LanguageModel;
  preprocessor?: MessagePreprocessor;  // ← 新增
}

// 各 provider 注册时绑定
export const PROVIDERS: Record<string, ProviderDef> = {
  openai: { ..., preprocessor: new OpenAIPreprocessor() },
  deepseek: { ..., preprocessor: new CompatPreprocessor() },
  anthropic: { ..., preprocessor: new AnthropicPreprocessor() },
  siliconflow: { ..., preprocessor: new CompatPreprocessor() },
  mimo: { ..., preprocessor: new CompatPreprocessor() },
  ollama: { ..., preprocessor: new CompatPreprocessor() },
  custom: { ..., preprocessor: new CompatPreprocessor() },
};
```

### 2.4 LLM 适配层集成

**改动文件：** `src/core/llm.ts`

```typescript
// chat / streamChat 中，发送前走 preprocessor
private preprocessMessages(
  messages: Message[],
  provider: string,
): Message[] {
  const def = PROVIDERS[provider];
  if (!def?.preprocessor) return messages;
  
  const preprocessed = def.preprocessor.process(
    messages.map(m => ({ ...m, role: m.role }))
  );
  return preprocessed.map(m => ({ ...m, role: m.role as Message['role'] }));
}
```

### 2.5 测试

```typescript
// message-preprocessor.test.ts
describe('CompatPreprocessor', () => {
  it('developer → system', () => { ... });
  it('多个 system 合并', () => { ... });
  it('system 必须在第一位', () => { ... });
});

describe('AnthropicPreprocessor', () => {
  it('连续同 role 消息合并', () => { ... });
  it('system 保持独立', () => { ... });
});
```

---

## Phase 3：能力自动探测（3 天）

> 目标：新 provider 接入不需要手动填能力表

### 3.1 新建 `src/core/capability-prober.ts`

```typescript
/**
 * Provider 能力探测器
 * 
 * 首次连接新 provider 时，发送一系列探测请求，
 * 自动判断它支持什么功能。
 */

export interface ProbeResult {
  /** 基础连通性 */
  reachable: boolean;
  /** 是否支持原生 tool calling */
  toolCalling: boolean;
  /** 是否支持 structured output */
  structuredOutput: boolean;
  /** 是否支持 role: 'developer' */
  supportsDeveloperRole: boolean;
  /** 是否支持视觉输入 */
  vision: boolean;
  /** 最大上下文窗口（估算） */
  maxContextTokens: number;
  /** 响应延迟（ms） */
  latencyMs: number;
  /** 探测错误信息 */
  errors: string[];
}

export class CapabilityProber {
  /**
   * 探测 provider 能力
   * 用最轻量的请求逐项验证
   */
  async probe(model: LanguageModel): Promise<ProbeResult> {
    const result: ProbeResult = {
      reachable: false,
      toolCalling: false,
      structuredOutput: false,
      supportsDeveloperRole: false,
      vision: false,
      maxContextTokens: 32000,
      latencyMs: 0,
      errors: [],
    };

    // 1. 基础连通性
    try {
      const start = Date.now();
      await generateText({ model, prompt: 'Hi', maxOutputTokens: 5 });
      result.reachable = true;
      result.latencyMs = Date.now() - start;
    } catch (e) {
      result.errors.push(`连通性失败: ${e.message}`);
      return result;
    }

    // 2. developer role 支持
    try {
      await generateText({
        model,
        messages: [{ role: 'developer', content: 'Say OK' }],
        maxOutputTokens: 5,
      });
      result.supportsDeveloperRole = true;
    } catch {
      result.supportsDeveloperRole = false;
    }

    // 3. Tool calling 支持
    try {
      await generateText({
        model,
        messages: [{ role: 'user', content: 'What is 1+1?' }],
        tools: { calculator: tool({ description: 'calc', inputSchema: z.object({ expr: z.string() }), execute: () => '2' }) },
        maxSteps: 1,
      });
      result.toolCalling = true;
    } catch {
      result.toolCalling = false;
    }

    // 4. Structured output 支持
    try {
      await generateText({
        model,
        output: Output.object({ schema: z.object({ answer: z.string() }) }),
        messages: [{ role: 'user', content: 'Reply with {"answer": "ok"}' }],
      });
      result.structuredOutput = true;
    } catch {
      result.structuredOutput = false;
    }

    return result;
  }
}
```

### 3.2 探测结果缓存

```typescript
// 缓存到 ~/.buddy/capabilities/<provider>-<model>.json
// 避免每次启动都重新探测
interface CachedCapabilities {
  provider: string;
  model: string;
  probedAt: number;       // 探测时间
  ttlMs: number;          // 缓存有效期（默认 7 天）
  result: ProbeResult;
}
```

### 3.3 ProviderFactory 集成

```typescript
// ProviderFactory.create() 改造
static async create(config: {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}): Promise<{ model: LanguageModel; capabilities: ProviderCapabilities }> {
  const def = PROVIDERS[config.provider] ?? PROVIDERS.custom;
  
  // 1. 先用静态标记
  const staticCaps = { ...def.capabilities };
  
  // 2. 如果有缓存的探测结果，合并
  const cached = await CapabilityCache.load(config.provider, config.model);
  if (cached && !isExpired(cached)) {
    return mergeCapabilities(staticCaps, cached.result);
  }
  
  // 3. 首次连接，自动探测
  const model = def.createModel(config);
  const probed = await new CapabilityProber().probe(model);
  await CapabilityCache.save(config.provider, config.model, probed);
  
  return mergeCapabilities(staticCaps, probed);
}
```

---

## Phase 4：统一 Adapter 接口（5 天）

> 目标：新增 provider 只需一行配置

### 4.1 新建 `src/core/provider-adapter.ts`

```typescript
/**
 * Provider Adapter — 统一的 provider 适配接口
 *
 * 把消息预处理、能力管理、模型创建、错误处理封装成一个对象。
 * 新增 provider 只需要实现这个接口。
 */

export interface ProviderAdapter {
  /** 适配器标识 */
  readonly id: string;
  /** 显示名称 */
  readonly name: string;
  
  /** 创建模型实例 */
  createModel(config: AdapterConfig): LanguageModel;
  
  /** 消息预处理 */
  preprocess(messages: InternalMessage[]): InternalMessage[];
  
  /** 获取能力（静态 + 探测合并） */
  getCapabilities(model: string): Promise<ProviderCapabilities>;
  
  /** 错误分类（是否可重试） */
  classifyError(error: Error): ErrorClassification;
  
  /** 健康检查 */
  healthCheck(model: LanguageModel): Promise<boolean>;
}

export interface AdapterConfig {
  apiKey?: string;
  baseUrl?: string;
  model: string;
}

export type ErrorClassification = {
  retryable: boolean;
  reason: 'rate_limit' | 'auth' | 'format' | 'network' | 'unknown';
  suggestion?: string;  // 给用户的建议
};
```

### 4.2 内置 Adapter 实现

```typescript
/** OpenAI 兼容适配器 — 覆盖大部分第三方 provider */
export class OpenAICompatAdapter implements ProviderAdapter {
  constructor(
    readonly id: string,
    readonly name: string,
    private defaultBaseUrl: string,
    private messageMode: 'system' | 'developer' = 'system',
  ) {}

  createModel(config) {
    const p = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl ?? this.defaultBaseUrl,
      systemMessageMode: this.messageMode,
    });
    return p.chat(config.model);
  }

  preprocess(messages) {
    const pp = new CompatPreprocessor();
    return pp.process(messages);
  }

  classifyError(error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('429') || msg.includes('rate limit'))
      return { retryable: true, reason: 'rate_limit', suggestion: '请求太频繁，稍后再试' };
    if (msg.includes('401') || msg.includes('403'))
      return { retryable: false, reason: 'auth', suggestion: '检查 API Key 是否正确' };
    if (msg.includes('developer') || msg.includes('role'))
      return { retryable: false, reason: 'format', suggestion: '该 Provider 不支持 developer role，检查 systemMessageMode 配置' };
    return { retryable: true, reason: 'unknown' };
  }

  async healthCheck(model) {
    try {
      await generateText({ model, prompt: 'ping', maxOutputTokens: 3 });
      return true;
    } catch { return false; }
  }
}
```

### 4.3 注册中心

```typescript
/** Provider 注册中心 — 单例 */
export class ProviderRegistry {
  private adapters = new Map<string, ProviderAdapter>();

  constructor() {
    // 内置
    this.register(new OpenAICompatAdapter('openai', 'OpenAI', 'https://api.openai.com/v1', 'developer'));
    this.register(new OpenAICompatAdapter('deepseek', 'DeepSeek', 'https://api.deepseek.com/v1'));
    this.register(new OpenAICompatAdapter('siliconflow', '硅基流动', 'https://api.siliconflow.cn/v1'));
    this.register(new OpenAICompatAdapter('mimo', '小米 MiMo', 'https://api.mimo.xiaomi.com/v1'));
    this.register(new OpenAICompatAdapter('ollama', 'Ollama', 'http://localhost:11434/v1'));
    this.register(new OpenAICompatAdapter('custom', '自定义', ''));
    // Anthropic / Google 走独立 SDK，单独注册
  }

  /** 运行时注册新 provider — 零代码接入 */
  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  /** 一行接入新 provider */
  registerSimple(id: string, baseUrl: string, name?: string): void {
    this.register(new OpenAICompatAdapter(id, name ?? id, baseUrl));
  }

  get(id: string): ProviderAdapter | undefined {
    return this.adapters.get(id);
  }

  list(): string[] {
    return [...this.adapters.keys()];
  }
}
```

### 4.4 新 Provider 接入方式

```typescript
// 方式 1：配置文件（零代码）
// ~/.buddy/config.json
{
  "llm": {
    "provider": "new-platform",
    "model": "their-model-v1",
    "apiKey": "sk-xxx",
    "baseUrl": "https://api.new-platform.com/v1"
  }
}

// 方式 2：运行时注册（一行代码）
registry.registerSimple('new-platform', 'https://api.new-platform.com/v1');

// 方式 3：完整 Adapter（需要特殊处理时）
registry.register(new MyCustomAdapter());
```

---

## Phase 5：v6 API 迁移（1 天）

> 目标：消除废弃警告，为未来版本做准备

### 5.1 `generateObject` → `generateText` + `Output.object`

**改动文件：** `src/core/llm.ts` — `structuredOutput()` 方法

```typescript
// 旧
const result = await generateObject({ model, messages, schema, ... });

// 新
import { Output } from 'ai';
const { output } = await generateText({
  model,
  messages,
  output: Output.object({ schema, schemaName, schemaDescription, mode }),
  ...genParams,
});
return output;
```

### 5.2 `CoreMessage` → `ModelMessage`

全局替换类型引用。

### 5.3 `ToolCallOptions` → `ToolExecutionOptions`

全局替换类型引用。

---

## 实施时间线

```
Week 1
├── Day 1 (Phase 1)     🔴 systemMessageMode 修复 → 立即可用          ✅ 已完成
├── Day 2-3 (Phase 2)   🟡 MessagePreprocessor 中间层                 ✅ 已完成
├── Day 4 (Phase 5)     🟡 v6 API 迁移（消除废弃警告）                 ⏳ 待实施
└── Day 5 (Phase 3)     🟢 CapabilityProber 自动探测                  ✅ 已完成

Week 2
└── Day 6-10 (Phase 4)  🟢 ProviderAdapter 统一接口 + 注册中心        ✅ 已完成

总计：~8 人天 → 实际 1 天一步到位
```

---

## 验收标准

### Phase 1 完成标准
- [ ] 硅基流动 Qwen 模型能正常 chat
- [ ] MiMo 模型能正常 chat
- [ ] DeepSeek 模型能正常 chat
- [ ] Ollama 本地模型能正常 chat
- [ ] OpenAI / Anthropic / Google 不受影响

### Phase 2 完成标准
- [ ] `CompatPreprocessor` 正确处理 developer → system
- [ ] 多个 system 消息正确合并
- [ ] 消息顺序自动校正
- [ ] Anthropic 消息交替规则正确处理
- [ ] 单元测试覆盖率 > 90%

### Phase 3 完成标准
- [ ] 新 provider 首次连接自动探测能力
- [ ] 探测结果正确缓存和复用
- [ ] 探测失败不阻断正常服务（降级到静态标记）

### Phase 4 完成标准
- [ ] 新增 provider 只需 `baseUrl` + `apiKey`
- [ ] 运行时注册新 provider 不需要重启
- [ ] 错误分类准确，给用户可操作的建议
- [ ] 健康检查端点可用

### Phase 5 完成标准
- [ ] 零 deprecated 警告
- [ ] 所有现有测试通过

---

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| `systemMessageMode` 在某些 SDK 版本不生效 | 修复无效 | 回退到 wrapper 方案作为 Plan B |
| 能力探测的请求消耗 token | 成本增加 | 探测用最短 prompt，结果缓存 7 天 |
| 某些 provider 的 API 和 OpenAI 差异太大 | 兼容 adapter 不够用 | 保留写独立 adapter 的能力 |
| v6 后续小版本继续改 API | 追不上变化 | 锁定 `ai: ^6.0.x`，不自动升级 |

---

## 文件清单

### 新建 ✅
- `src/core/message-preprocessor.ts` — 消息预处理管线（187 行）
- `src/core/capability-prober.ts` — 能力自动探测 + 缓存（203 行）
- `src/core/provider-adapter.ts` — 统一 Adapter 接口 + 注册中心（469 行）

### 修改 ✅
- `src/core/provider-registry.ts` — 重写为 v2，委托给 AdapterRegistry
- `src/core/llm.ts` — 集成消息预处理 + 错误分类
- `src/core/subsystems.ts` — 补充 supportsDeveloperRole 字段
- `src/core/ws-handler.ts` — 补充 supportsDeveloperRole 字段

### 待实施
- `src/core/llm.ts` — Phase 5: `generateObject` → `generateText` + `Output.object` 迁移
