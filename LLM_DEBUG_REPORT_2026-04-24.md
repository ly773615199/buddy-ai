# LLM 适配层调试报告

**日期**: 2026-04-24  
**环境**: SiliconFlow / DeepSeek-V3 / AI SDK v6  
**分支**: main (`3e6bd35`)

---

## 1. 测试环境搭建

- 克隆私有仓库 `buddy` 到 `/root/.openclaw/workspace/buddy`
- 使用 npmmirror 国内镜像安装依赖（`--ignore-scripts` 跳过 electron 原生编译）
- TypeScript 编译检查：核心 LLM 适配层 **0 错误**（仅测试文件有 1 个类型问题）
- 配置 SiliconFlow provider + DeepSeek-V3 模型

## 2. 发现的 Bug

### Bug #1: `result.text` 为 undefined 导致 crash 🔴

**现象**: `Agent 处理错误: Cannot read properties of undefined (reading 'slice')`  
**位置**: `src/core/ws-handler.ts:989`  
**根因**: AI SDK 的 `generateText()` 返回的 `result` 对象中，`text` 字段可能为 `undefined`。后续代码直接调用 `result.text.slice(0, 500)` 触发 TypeError。

**修复**:
```typescript
// Before
this.eventBus?.emit({ type: 'llm_response', content: result.text });
traceSteps.push({ type: 'response', content: result.text.slice(0, 500), ... });

// After
const responseText = result.text ?? '';
this.eventBus?.emit({ type: 'llm_response', content: responseText });
traceSteps.push({ type: 'response', content: responseText.slice(0, 500), ... });
```

### Bug #2: `tc.result` 为 undefined 导致 crash 🔴

**现象**: 同上 TypeError  
**位置**: `src/core/ws-handler.ts:923-934`  
**根因**: LLM 返回的 toolCalls 中，`result` 字段可能为 `undefined`（工具执行异常或 AI SDK 解析问题）。

**修复**:
```typescript
// Before
const success = !tc.result.startsWith('[');
this.eventBus?.emit({ type: 'tool_result', preview: tc.result.slice(0, 200) });

// After
const tcResult = tc.result ?? '';
const success = !tcResult.startsWith('[');
this.eventBus?.emit({ type: 'tool_result', preview: tcResult.slice(0, 200) });
```

### Bug #3: `formatToolResult(undefined)` crash 🟡

**位置**: `src/core/constants.ts:112`  
**根因**: 函数直接访问 `result.length`，未做空值检查。

**修复**:
```typescript
export function formatToolResult(result: string): string {
  if (!result) return '';  // 新增
  if (result.length <= TOOL_RESULT_MAX_CHARS) return result;
  // ...
}
```

### Bug #4: `correction.content` 可能为 undefined 🟡

**位置**: `src/core/ws-handler.ts:908`  
**修复**: `correction.content.slice(0, 50)` → `(correction.content ?? '').slice(0, 50)`

### Bug #5: LLM `chat()` 返回路径缺少兜底 🟡

**位置**: `src/core/llm.ts` 多处 return 语句  
**修复**: 所有 `return { text: result.text, ... }` 改为 `return { text: result.text ?? "", ... }`

## 3. 未解决的根因问题

### AI SDK v6 对 SiliconFlow 的空响应问题 ⚠️

**现象**: 模型返回了 27 个 token（`outputTokens: 27`），但 AI SDK 的 `result.text` 为空字符串，`step.content` 为空数组 `[]`。

**调试日志**:
```
[LLM] 空响应! result.text="" normalized.content="null" steps=1
[LLM] result keys: steps,_output,totalUsage
[LLM] step: {"stepNumber":0,"content":[],"finishReason":"stop","outputTokens":27}
```

**分析**:
- SiliconFlow API 直接调用正常（curl 返回正确 JSON）
- AI SDK 的 `generateText()` 偶发返回空 content
- 可能原因：
  1. AI SDK 对 OpenAI 兼容 API 的响应解析存在边界情况
  2. SiliconFlow 的 SSE 流式响应格式与 AI SDK 预期不完全一致
  3. DeepSeek-V3 的 `finishReason: "stop"` 但 content 为空的特殊场景

**影响**: 基本对话成功率约 70%，工具调用场景更容易触发空响应。

**建议**: 
- 短期：在 `chatNative` 中增加重试逻辑（检测到空响应时自动重试 1 次）
- 中期：考虑直接使用 SiliconFlow 的 REST API 而非通过 AI SDK
- 长期：向 AI SDK 提 issue 报告此兼容性问题

## 4. 静态代码检查发现

### 架构优点 ✅
- Adapter → Registry → Factory → Router 四层解耦，新增 provider 零代码接入
- Fallback 链：主模型 → lightweight → fallbacks，带熔断器 + 指数退避重试
- 8 种工具调用解析策略（markdown_json / <tool_call> / XML / invoke / 自然语言）
- 消息预处理管线：developer→system 映射、多 system 合并、交替校验
- 能力探测器 + 磁盘缓存（7 天 TTL）
- 模型路由器支持经验学习 + 任务类型路由

### 待改进项 📝
1. `AnthropicAdapter` / `GoogleAdapter` 用 `require()` 加载依赖，ESM 环境可能报错
2. `getCurrentAdapter()` 用 `require()` 动态导入，应改为直接引用已导出的 `adapterRegistry`
3. 错误分类纯靠字符串匹配，未用 HTTP status code
4. TypeScript 编译：测试文件 `message-processor.test.ts` 有 1 个类型错误

## 5. 修改文件清单

| 文件 | 改动 | 行数 |
|------|------|------|
| `src/core/ws-handler.ts` | 空值防御 + tcResult 局部变量 | +14 -12 |
| `src/core/llm.ts` | 返回路径兜底 + 空响应日志 | +8 -5 |
| `src/core/constants.ts` | formatToolResult 空值保护 | +1 |
| **合计** | | **+25 -18** |

## 6. 测试验证

| 场景 | 结果 | 备注 |
|------|------|------|
| TypeScript 编译 | ✅ 0 error | 核心 LLM 层 |
| 基本对话 (SiliconFlow) | ✅ 成功 | 偶发空响应 |
| 工具调用 (get_time) | ⚠️ 间歇性 | AI SDK 解析问题 |
| 熔断器 | ✅ 正常 | 连续失败后正确打开 |
| 防御性修复 | ✅ 不再 crash | 空响应时优雅降级 |
| Git push | ✅ `3e6bd35` | main 分支 |

---

**结论**: 修复了 5 个空值安全 bug，消除了 `.slice()` crash 导致的连锁故障。根因是 AI SDK v6 对 SiliconFlow 的响应解析存在兼容性问题，已记录待跟进。
