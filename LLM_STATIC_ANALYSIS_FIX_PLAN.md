# LLM 调用链静态分析修复计划

> 基于 Vercel AI SDK 全链路静态检查，覆盖 llm.ts → provider-adapter.ts → model-pool.ts → message-preprocessor.ts → response-normalizer.ts → universal-tool-caller.ts → capability-prober.ts
>
> 生成日期: 2026-05-04
> 问题来源: 代码审计 + AI SDK 官方文档 + arxiv 论文交叉验证

---

## 问题总览

| # | 问题 | 文件 | 优先级 | 影响范围 |
|---|------|------|--------|---------|
| 1 | 消息膨胀：工具结果无限追加 | `llm.ts` L607-687 | P0 | 所有 Prompt 模拟工具调用路径 |
| 2 | Anthropic toolCalls 丢失 | `message-preprocessor.ts` L133-145 | P1 | Anthropic provider 多轮工具调用 |
| 3 | 流式工具调用 `as any` 类型断言 | `llm.ts` L258-265 | P1 | streamChat 路径 |
| 4 | developer→system 双重替换 | `provider-adapter.ts` L158-165 | P1 | 所有 OpenAI 兼容 provider |
| 5 | 三进制未接入统一模型池 | `model-router.ts` L138-143 | P2 | 三进制模型选择 |
| 6 | 持久化竞态：每次反馈写磁盘 | `model-pool.ts` L550-575 | P2 | 高频对话场景 |
| 7 | 工具修复无超时 | `llm.ts` L543-561 | P2 | 极端情况阻塞 |

---

## Issue #1: 消息膨胀 — 工具结果无限追加 [P0]

### 问题

`chatWithPromptTools` 中，每轮工具执行后结果以 `user` 消息追加到 `currentMessages`。当 `maxSteps=5`、每轮 3 个工具时，最坏情况注入 15 条工具结果消息。配合 `TOOL_RESULT_LIMITS.maxRaw`（单条截断），总上下文仍可能被工具结果占满，导致 LLM 看不到用户原始意图。

### 根因

缺少 token 预算控制。工具结果注入时不检查当前上下文总 token 量。

### 修复方案

**文件**: `src/core/llm.ts`

```typescript
// 新增：估算消息 token 数
private estimateMessagesTokens(messages: any[]): number {
  let total = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') {
      // 粗略估算：中文 1 字 ≈ 2 token，英文 1 词 ≈ 1.3 token
      total += Math.ceil(m.content.length / 3);
    }
  }
  return total;
}

// 新增：压缩历史工具结果
private compressToolHistory(messages: any[], keepRecent: number = 2): void {
  let toolMsgCount = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user' && typeof m.content === 'string'
        && m.content.startsWith('工具 ') && m.content.includes('返回:')) {
      toolMsgCount++;
      if (toolMsgCount > keepRecent) {
        // 保留工具名，压缩结果为摘要
        const resultIdx = m.content.indexOf('返回:');
        const toolName = m.content.slice(3, resultIdx).trim();
        const originalResult = m.content.slice(resultIdx + 3).trim();
        if (originalResult.length > 100) {
          messages[i] = {
            ...m,
            content: `工具 ${toolName} 返回: [已压缩, 原长 ${originalResult.length} 字符, 前 80 字: ${originalResult.slice(0, 80)}...]`,
          };
        }
      }
    }
  }
}
```

**在 `chatWithPromptTools` 工具结果追加处注入预算控制**:

```typescript
// 现有代码（L663-670）：
for (const r of results) {
  if (r.status === 'fulfilled') {
    allToolCalls.push(r.value);
    currentMessages.push({ role: 'user', content: `工具 ${r.value.name} 返回: ${r.value.result}` });
  }
}

// 改为：
for (const r of results) {
  if (r.status === 'fulfilled') {
    allToolCalls.push(r.value);

    // P0: 上下文预算控制
    const estimatedTokens = this.estimateMessagesTokens(currentMessages);
    const maxContextTokens = this.currentCapabilities.maxContextTokens ?? 32000;
    const budgetThreshold = maxContextTokens * 0.6; // 60% 阈值

    if (estimatedTokens > budgetThreshold) {
      this.compressToolHistory(currentMessages, 2); // 只保留最近 2 条工具结果
    }

    currentMessages.push({ role: 'user', content: `工具 ${r.value.name} 返回: ${r.value.result}` });
  }
}
```

### 验证

- [ ] 5 轮 × 3 工具调用后，上下文 token 不超过 maxContextTokens 的 70%
- [ ] 压缩后 LLM 仍能正确理解用户意图
- [ ] 非工具对话场景不受影响

---

## Issue #2: AnthropicPreprocessor toolCalls 丢失 [P1]

### 问题

`AnthropicPreprocessor.enforceAlternation` 合并连续同 role 消息时，只合并 `content`，丢弃了后一条消息的 `toolCalls`。

### 根因

```typescript
// message-preprocessor.ts L140-144
if (last && last.role === msg.role) {
  last.content += '\n\n' + msg.content;  // ← 只合并 content
  // ← toolCalls 丢失
}
```

### 修复方案

**文件**: `src/core/message-preprocessor.ts`

```typescript
// enforceAlternation 中合并逻辑改为：
if (last && last.role === msg.role) {
  last.content += '\n\n' + msg.content;
  // 保留 toolCalls（合并而非丢弃）
  if (msg.toolCalls?.length) {
    last.toolCalls = [...(last.toolCalls ?? []), ...msg.toolCalls];
  }
}
```

### 验证

- [ ] Anthropic provider 多轮工具调用，toolCalls 不丢失
- [ ] 连续 assistant 消息（一条有 toolCalls，一条是文本）合并后保留完整

---

## Issue #3: 流式工具调用 `as any` 类型断言 [P1]

### 问题

`streamChat` 中访问 `result.steps` 的 `toolCalls` 和 `toolResults` 时使用 `(step as any)`，绕过类型检查。AI SDK v6 提供了顶层属性 `result.toolCalls` 和 `result.toolResults`。

### 根因

```typescript
// llm.ts L258-265
const steps = await result.steps;
for (const step of steps) {
  for (const tc of (step as any).toolCalls ?? []) {  // ← as any
    const tr = ((step as any).toolResults ?? []).find(
      (r: any) => r.toolCallId === tc.toolCallId,
    );
  }
}
```

### 修复方案

**文件**: `src/core/llm.ts`

```typescript
// streamChat 中工具调用提取改为使用 SDK 顶层属性：
const toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }> = [];
try {
  const steps = await result.steps;
  for (const step of steps) {
    // 使用类型安全的访问方式
    const stepToolCalls = step.toolCalls ?? [];
    const stepToolResults = step.toolResults ?? [];
    for (const tc of stepToolCalls) {
      const tr = stepToolResults.find(
        (r) => 'toolCallId' in r && r.toolCallId === tc.toolCallId,
      );
      toolCalls.push({
        name: tc.toolName,
        args: tc.args as Record<string, unknown>,
        result: tr && 'result' in tr ? String(tr.result) : '',
      });
    }
  }
} catch { /* 提取失败不影响主流程 */ }
```

### 验证

- [ ] `tsc --noEmit` 零错误（该路径相关类型）
- [ ] streamChat 工具调用结果正确提取

---

## Issue #4: developer→system 双重替换 [P1]

### 问题

`OpenAICompatAdapter.createModel()` 中的 `transformRequestBody` 在 HTTP body 层面将所有 `developer` role 替换为 `system`。同时 `CompatPreprocessor` 在消息层面也做了同样的替换。两层替换结果一致，但：

1. 如果未来某个 OpenAI 兼容 provider 原生支持 `developer` role，HTTP 层替换会错误降级
2. `transformRequestBody` 是全局的，无法按 provider 粒度控制

### 根因

```typescript
// provider-adapter.ts L158-165
transformRequestBody: (body: Record<string, unknown>) => {
  if (body.messages && Array.isArray(body.messages)) {
    body.messages = (body.messages as any[]).map((msg: any) => {
      if (msg && msg.role === 'developer') {
        return { ...msg, role: 'system' };  // ← 全局替换
      }
      return msg;
    });
  }
  return body;
},
```

### 修复方案

**文件**: `src/core/provider-adapter.ts`

移除 `transformRequestBody` 中的 role 替换，因为 `CompatPreprocessor` 已经在消息层处理了。`transformRequestBody` 应该只处理 HTTP 层面的格式差异（如非标准字段映射），不处理消息格式。

```typescript
createModel(config: AdapterConfig): LanguageModel {
  const provider = createOpenAICompatible({
    name: this.id,
    apiKey: config.apiKey ?? '',
    baseURL: config.baseUrl ?? this.defaultBaseUrl,
    // 移除 transformRequestBody — role 映射由 CompatPreprocessor 处理
  });
  return provider.chatModel(config.model);
}
```

### 验证

- [ ] DeepSeek / SiliconFlow / MiMo / Ollama / OpenRouter provider 正常工作
- [ ] system 消息正确传递（不被重复处理）
- [ ] 如果未来接入支持 developer role 的 provider，不需要改 adapter

---

## Issue #5: 三进制未接入统一模型池 [P2]

### 问题

`ModelRouter.select()` 中，本地专家（含三进制）仅在 `taskType === 'domain'` 且 `context.domainMatch` 存在时才被尝试。三进制模型无法参与 chat/tools/reasoning 等通用任务的选择。

### 根因

```typescript
// model-router.ts L138-143
if (taskType === 'domain' && context?.domainMatch) {
  const local = this.tryLocalExpert(context.domainMatch);
  if (local) return local;
}
```

### 修复方案

**文件**: `src/core/model-router.ts`

将三进制模型注册为统一池中的 `tier: 'free'` 特殊 profile，让 Thompson Sampling 自然选择。同时保留本地专家快速路径作为 Layer 0.5（在元数据筛选之前）。

```typescript
// select() 方法中，在统一池选择之前增加本地专家快速路径：
select(taskType: TaskType, context?: TaskContext): ModelConfig {
  // 1. 用户 per-message 指定
  if (context?.userOverride) { ... }

  // 2. 用户会话级覆盖
  if (this.userOverride) { ... }

  // 3. 本地专家快速路径（不限于 domain 任务）
  //    置信度 > 0.8 的本地专家直接选用，跳过统一池
  for (const [domain, expert] of this.localExperts) {
    if (expert.confidence >= 0.8) {
      // 检查任务类型是否匹配专家能力
      if (this.expertMatchesTask(expert, taskType, context)) {
        return {
          id: `local/${domain}`,
          provider: 'local',
          model: domain,
          capabilities: expert.capabilities,
          source: 'local_expert',
        };
      }
    }
  }

  // 4. 统一模型池（Thompson Sampling）
  if (this.pool && this.pool.isInitialized) { ... }
  ...
}

// 新增：专家-任务匹配判断
private expertMatchesTask(expert: LocalExpert, taskType: TaskType, context?: TaskContext): boolean {
  // 三进制 chat 专家匹配闲聊任务
  if (expert.domain === 'chat' && taskType === 'chat') return true;
  // 三进制 coding 专家匹配工具/代码任务
  if (expert.domain === 'coding' && (taskType === 'tools' || taskType === 'reasoning')) return true;
  // 领域任务走原有匹配
  if (taskType === 'domain' && context?.domainMatch === expert.domain) return true;
  return false;
}
```

### 验证

- [ ] 闲聊任务有概率选到三进制 chat 模型
- [ ] 代码任务有概率选到三进制 coding 模型
- [ ] 置信度不足时 fallback 到统一池
- [ ] 不影响原有的 domain 任务匹配

---

## Issue #6: 持久化竞态 [P2]

### 问题

`ModelPool.recordFeedback()` 每次调用都同步写 3 个 JSON 文件（profiles.json、thompson.json、preferences.json）。高频对话场景（流式每秒多次反馈）造成 I/O 瓶颈。

### 根因

```typescript
// model-pool.ts recordFeedback() 末尾
this.saveUnifiedState(); // ← 每次反馈都写磁盘
```

### 修复方案

**文件**: `src/core/model-pool.ts`

防抖写入，合并短时间内的多次更新：

```typescript
private saveTimer: NodeJS.Timeout | null = null;
private readonly SAVE_DEBOUNCE_MS = 3000; // 3 秒防抖
private dirty = false;

private debouncedSave(): void {
  this.dirty = true;
  if (this.saveTimer) return; // 已有定时器，不重复创建
  this.saveTimer = setTimeout(() => {
    if (this.dirty) {
      this.saveUnifiedState();
      this.dirty = false;
    }
    this.saveTimer = null;
  }, this.SAVE_DEBOUNCE_MS);
}

// recordFeedback 中替换：
recordFeedback(...): void {
  // ... 更新参数 ...
  this.debouncedSave(); // 替代 this.saveUnifiedState()
}

// shutdown 中确保最终写入：
shutdown(): void {
  if (this.saveTimer) {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
  }
  if (this.dirty) {
    this.saveUnifiedState();
    this.dirty = false;
  }
  if (this.updater) {
    this.updater.stop();
    this.updater = null;
  }
}
```

### 验证

- [ ] 高频对话场景 I/O 写入频率降低 80%+
- [ ] 进程退出前数据不丢失（shutdown 保证最终写入）
- [ ] Thompson Sampling 参数在防抖窗口内正确累积

---

## Issue #7: 工具修复无超时 [P2]

### 问题

`experimental_repairToolCall` 内部调用 `generateText` 做修复，没有超时控制。如果 LLM 响应慢，会阻塞整个工具调用链。

### 根因

```typescript
// llm.ts L543-561
experimental_repairToolCall: async ({ toolCall, tools, error }) => {
  const repair = await generateText({ ... }); // ← 无超时
  ...
}
```

### 修复方案

**文件**: `src/core/llm.ts`

```typescript
experimental_repairToolCall: async ({ toolCall, tools, error }) => {
  console.log(`🔧 修复工具调用: ${toolCall.toolName} — ${error.message}`);
  const toolDef = (tools as Record<string, any>)[toolCall.toolName];
  if (!toolDef) return null;

  const REPAIR_TIMEOUT_MS = 15_000; // 15 秒超时

  try {
    const repairPromise = generateText({
      model,
      messages: [{
        role: 'user' as const,
        content: `工具调用参数有误，请修复。\n\n工具: ${toolCall.toolName}\n工具描述: ${toolDef.description}\n原始参数: ${JSON.stringify((toolCall as any).input ?? (toolCall as any).args)}\n错误: ${error.message}\n\n请只输出修复后的参数 JSON，不要其他文字。`,
      }],
      maxOutputTokens: 500,
    });

    const timeoutPromise = new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error('工具修复超时')), REPAIR_TIMEOUT_MS)
    );

    const repair = await Promise.race([repairPromise, timeoutPromise]);
    if (!repair) return null;

    const fixed = this.extractJson(repair.text ?? '');
    if (fixed) return { ...toolCall, args: JSON.parse(fixed) };
  } catch (err) {
    console.warn(`🔧 工具修复失败: ${(err as Error).message}`);
  }
  return null;
}
```

### 验证

- [ ] 修复调用超过 15 秒时自动放弃，不阻塞主流程
- [ ] 正常修复场景不受影响
- [ ] 修复失败时返回 null，AI SDK 走默认错误处理

---

## 实施顺序

```
Phase 1 (P0 — 立即修复):
  └─ Issue #1: 消息膨胀 — 上下文预算控制

Phase 2 (P1 — 尽快修复):
  ├─ Issue #2: Anthropic toolCalls 丢失
  ├─ Issue #3: 流式工具调用类型安全
  └─ Issue #4: developer→system 双重替换

Phase 3 (P2 — 计划修复):
  ├─ Issue #5: 三进制接入统一池
  ├─ Issue #6: 持久化竞态
  └─ Issue #7: 工具修复超时
```

## 验证清单

- [ ] `tsc --noEmit` 零错误
- [ ] `npm run test` 全部通过
- [ ] 前端 `npm run build` 成功
- [ ] 手动测试：5 轮工具调用后上下文不爆炸
- [ ] 手动测试：Anthropic provider 多轮工具调用正常
- [ ] 手动测试：streamChat 工具调用结果正确
- [ ] 手动测试：三进制模型在闲聊任务中被选中
- [ ] 手动测试：高频对话无 I/O 卡顿
