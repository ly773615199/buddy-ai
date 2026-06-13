# 🔧 工具调用链路系统性修复计划

> 基于 2026-05-14 的代码审计，覆盖 SkillResolver → TaskExecutor → LLM → Reflector 全链路

---

## 问题总览

| # | 优先级 | 问题 | 影响范围 | 状态 |
|---|--------|------|----------|------|
| 1 | 🔴 P0 | `require()` 在 ESM 模块崩溃 | 持久化全部失效 | ✅ 已修 |
| 2 | 🔴 P0 | 工具参数缺失导致 undefined | 文件写入失败 | ✅ 已修 |
| 3 | 🟡 P1 | FTS5 emoji/特殊字符崩溃 | 记忆检索失败 | ✅ 已修 |
| 4 | 🟡 P1 | 类别映射返回空参数 | 工具执行失败 | ✅ 已修 |
| 5 | 🟡 P1 | 上下文压缩丢失关键结果 | 多步任务退化 | ✅ 已修 |
| 6 | 🟡 P2 | 幻觉检测误判短结果 | 不必要重试 | ✅ 已修 |
| 7 | 🟡 P2 | 并行工具执行无依赖感知 | 竞态条件 | ✅ 已修 |
| 8 | 🟠 P3 | 超时检测基于字符串匹配 | 错误分类不准 | ✅ 已修 |
| 9 | 🟠 P3 | 冷启动经验覆盖不足 | 慢+贵 | ✅ 已修 |
| 10 | 🔵 P3 | 模型选择缺乏成本感知 | token 浪费 | ⚠️ 实现方式不同 |
| 11 | 🟡 P1 | `read_file` 无缓存策略 | 重复读取浪费 token | ❌ 未完成 |
| 12 | 🟡 P1 | `maxContextTokens` 硬编码不准 | 有效上下文判断偏差 | ❌ 未完成 |
| 13 | 🟡 P1 | API usage 数据被丢弃 | 无法校准策略效果 | ❌ 未完成 |
| 14 | 🔴 P0 | 机械压缩丢失关键信息 | 多步任务退化 | ❌ 范式重定义 |
| 15 | 🟡 P1 | 无工具结果引用追踪 | 压缩决策盲目 | ❌ 未完成 |
| 16 | 🟡 P1 | 无语义压缩（按工具类型） | 信息提取粗糙 | ❌ 未完成 |

---

## Epic 1: 基础稳定性 (P0)

### Task 1.1 — 修复 ESM 模块中的 `require()` 调用

**问题**: `src/core/model-router.ts` 和 `src/core/llm.ts` 使用 `require('fs')` / `require('path')`，在 ESM (`"type": "module"`) 下直接报 `ReferenceError: require is not defined`。

**影响**:
- ModelRouter 状态持久化失败（模型选择经验无法保存）
- LLM 熔断器状态持久化失败（circuit breaker 重启后重置）
- 日志中大量 `require is not defined` 噪音

**修复方案**:

```typescript
// 方案 A: 改用顶层 import（推荐）
import fs from 'fs/promises';
import path from 'path';

// 方案 B: 动态 import（仅在需要时加载）
const fs = await import('fs');
const path = await import('path');

// 方案 C: createRequire（兼容旧代码）
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
```

**涉及文件**:
- `src/core/model-router.ts:771-782` — save() 和 load() 方法
- `src/core/llm.ts:946-961` — saveCircuitState() 和 loadCircuitState()
- `src/tools/browser.ts:78,118,226` — require('path'), require('playwright')
- `src/social/platform.ts:292` — require('ws')
- `src/core/provider-adapter.ts:259,317,667,674` — require('@ai-sdk/*')

**验收标准**:
- [ ] `npx tsc --noEmit` 无 require 相关错误
- [ ] 启动后日志无 `require is not defined`
- [ ] ModelRouter 状态重启后恢复

**预估工时**: 2h

---

### Task 1.2 — 工具参数校验增强 (已完成)

**状态**: ✅ 已完成 (commit a71f2e7)

**修改内容**:
- `src/skills/skill-resolver.ts`: LLM 降级路径增加参数 schema 说明 + 必填校验
- `src/orchestrate/executor.ts`: 执行前 Zod safeParse 校验

---

## Epic 2: 记忆系统稳定性 (P1)

### Task 2.1 — FTS5 查询特殊字符转义

**问题**: 用户消息含 emoji (📝, 📁) 或特殊字符时，FTS5 MATCH 语法报错 `no such column: 📝`。

**根因**: FTS5 的 MATCH 语法将中文/emoji 当作列名解析。

**修复方案**:

```typescript
// src/memory/stmp.ts — locateRoom() 方法
locateRoom(query: string): Room | null {
  // ...
  try {
    // 对 query 做 FTS5 安全转义
    const safeQuery = this.fts5Escape(query);
    if (!safeQuery) return null;
    
    const result = this.db.prepare(`
      SELECT room, COUNT(*) as cnt FROM stmp_nodes_fts fts
      JOIN stmp_nodes n ON n.rowid = fts.rowid
      WHERE stmp_nodes_fts MATCH ?
      GROUP BY room ORDER BY cnt DESC LIMIT 1
    `).get(safeQuery) as RoomIdRow | undefined;
    // ...
  }
}

/** FTS5 安全查询：用双引号包裹词项，移除无法索引的字符 */
private fts5Escape(input: string): string {
  // 移除 emoji 和特殊字符，保留中文/英文/数字
  const cleaned = input.replace(/[\u{1F000}-\u{1FFFF}]/gu, '').trim();
  if (!cleaned) return '';
  
  // 按空格分词，每项用双引号包裹
  return cleaned.split(/\s+/)
    .filter(t => t.length > 0)
    .map(t => `"${t.replace(/"/g, '""')}"`)
    .join(' OR ');
}
```

**涉及文件**: `src/memory/stmp.ts`

**验收标准**:
- [ ] 发送含 emoji 的消息不报 FTS 错误
- [ ] 记忆检索正常工作

**预估工时**: 1h

---

### Task 2.2 — 上下文压缩保留关键工具结果

**问题**: `compressToolHistory()` 简单保留最近 N 条，早期关键结果（如 `read_file` 的文件内容）被压缩，导致后续步骤参数丢失。

**修复方案**:

```typescript
// src/core/llm.ts — 智能压缩策略
private compressToolHistory(messages, keepRecent = 2): void {
  // 收集所有工具结果的位置
  const toolResults: Array<{ index: number; name: string; content: string }> = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (typeof msg.content === 'string' && msg.content.startsWith('工具 ') && msg.content.includes('返回:')) {
      const nameMatch = msg.content.match(/^工具 (\w+) 返回: /);
      if (nameMatch) {
        toolResults.push({ index: i, name: nameMatch[1], content: msg.content });
      }
    }
  }
  
  // 保留策略：
  // 1. 最近 N 条完整保留
  // 2. read_file / list_files 结果保留（后续步骤可能引用）
  // 3. 其余压缩
  const keepNames = new Set(['read_file', 'list_files', 'search_files']);
  const recentStart = toolResults.length - keepRecent;
  
  for (let i = 0; i < toolResults.length; i++) {
    const tr = toolResults[i];
    if (i >= recentStart || keepNames.has(tr.name)) continue; // 保留
    
    // 压缩：保留工具名 + 前 80 字
    const originalResult = tr.content.split('返回: ')[1] ?? '';
    messages[tr.index].content = `工具 ${tr.name} 返回: [已压缩, 原长 ${originalResult.length} 字符, 前 80 字: ${originalResult.slice(0, 80)}...]`;
  }
}
```

**涉及文件**: `src/core/llm.ts`

**验收标准**:
- [ ] 多步任务（3+ 工具调用）不丢失上下文
- [ ] token 使用量不超过阈值

**预估工时**: 1.5h

---

## Epic 3: 工具调用准确性 (P1-P2)

### Task 3.1 — 类别映射填充默认参数

**问题**: `findCategoryMatch()` 返回 `args: {}`，导致执行时必填字段全 undefined。

**修复方案**:

```typescript
// src/skills/skill-resolver.ts
private findCategoryMatch(step: SkeletonStep): ResolvedTask | null {
  const category = step.suggestedCategory;
  if (!category) return null;

  const tools = CATEGORY_TOOLS[category];
  if (!tools || tools.length === 0) return null;

  for (const toolName of tools) {
    const tool = this.toolRegistry.get(toolName);
    if (tool) {
      // 根据工具和步骤意图推断默认参数
      const args = this.inferDefaultArgs(toolName, step);
      return {
        tool: toolName,
        args,
        source: 'skill',
        confidence: 0.4,
      };
    }
  }
  return null;
}

private inferDefaultArgs(toolName: string, step: SkeletonStep): Record<string, unknown> {
  const intent = `${step.name} ${step.intent}`.toLowerCase();
  
  switch (toolName) {
    case 'read_file':
    case 'list_files':
      return { path: '.' };
    case 'write_file':
      return { path: this.inferFilePath(step, intent), content: `// ${step.intent}` };
    case 'exec':
      return { command: `echo "TODO: ${step.name}"` };
    case 'search_files':
      return { pattern: step.intent.slice(0, 20), path: '.' };
    default:
      return {};
  }
}
```

**涉及文件**: `src/skills/skill-resolver.ts`

**验收标准**:
- [ ] 类别映射路径不再返回空 args
- [ ] write_file 类别映射有合理的 path 和 content

**预估工时**: 1h

---

### Task 3.2 — 幻觉检测语义化

**问题**: 当前幻觉检测基于「结果长度 < 10 字符」和「工具名不在领域白名单」，误判率高。

**修复方案**:

```typescript
// src/core/reflector.ts
export function detectHallucinations(
  sys: Subsystems,
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }>,
  signal: TaskSignal,
): string[] {
  const hallucinations: string[] = [];

  for (const call of toolCalls) {
    // 跳过已知错误（以 [ 开头的结果）
    if (call.result.startsWith('[')) continue;

    // 检测 1: 工具返回了错误格式（非正常输出）
    if (call.name === 'exec' && call.result.includes('command not found')) {
      hallucinations.push(call.name);
      continue;
    }

    // 检测 2: read_file 返回空但任务需要内容
    if (call.name === 'read_file' && call.result.trim() === '' && signal.taskType === 'chat') {
      hallucinations.push(call.name);
      continue;
    }

    // 检测 3: write_file 但任务不涉及文件操作
    if (call.name === 'write_file' && !signal.domains.includes('file_ops') && signal.taskType === 'chat') {
      // 只在明确不相关时标记
      const intentLower = signal.intent?.toLowerCase() ?? '';
      if (!intentLower.includes('文件') && !intentLower.includes('写入') && !intentLower.includes('创建')) {
        hallucinations.push(call.name);
        continue;
      }
    }

    // 不再用结果长度判断
  }

  return [...new Set(hallucinations)];
}
```

**涉及文件**: `src/core/reflector.ts`

**验收标准**:
- [ ] 短结果（如 `ls` 返回单文件）不被误判
- [ ] 真正无关的工具调用仍被检测

**预估工时**: 1h

---

### Task 3.3 — 并行工具执行依赖分析

**问题**: LLM 返回多个 tool_call 时全部并行执行，有依赖关系的会出竞态。

**修复方案**:

```typescript
// src/core/llm.ts — 依赖感知执行
private analyzeDependencies(toolCalls: ToolCall[]): ToolCall[][] {
  // 构建依赖图：如果 B 的参数引用了 A 的结果 → B 依赖 A
  const batches: ToolCall[][] = [];
  const completed = new Set<string>();
  
  const remaining = [...toolCalls];
  while (remaining.length > 0) {
    // 找出无依赖的批次
    const batch = remaining.filter(tc => {
      const argsStr = JSON.stringify(tc.arguments);
      // 检查是否引用了未完成工具的结果
      return !remaining.some(other => 
        other !== tc && argsStr.includes(other.name)
      );
    });
    
    if (batch.length === 0) {
      // 全部有依赖，强制串行
      batches.push([remaining.shift()!]);
      continue;
    }
    
    // 移入批次
    for (const tc of batch) remaining.splice(remaining.indexOf(tc), 1);
    batches.push(batch);
  }
  
  return batches;
}

// 执行时按批次串行，批内并行
for (const batch of batches) {
  const results = await Promise.allSettled(batch.map(tc => executeTool(tc)));
  // ...
}
```

**涉及文件**: `src/core/llm.ts`

**验收标准**:
- [ ] 有依赖的工具串行执行
- [ ] 无依赖的工具仍并行

**预估工时**: 2h

---

## Epic 4: 执行健壮性 (P2-P3)

### Task 4.1 — 超时控制用 AbortController

**问题**: 当前超时检测基于 `withTimeout(Promise.race)`，错误信息不含 "timeout" 时漏判。

**修复方案**:

```typescript
// src/orchestrate/executor.ts
private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  
  try {
    const result = await promise;
    return result;
  } catch (err) {
    if (controller.signal.aborted) {
      throw new TimeoutError(`任务超时 (${ms}ms)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

class TimeoutError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'TimeoutError';
  }
}

// 超时检测改为类型判断
if (err instanceof TimeoutError) {
  // 超时处理
}
```

**涉及文件**: `src/orchestrate/executor.ts`

**验收标准**:
- [ ] 超时任务正确识别，不依赖字符串匹配
- [ ] 非超时错误不被误判

**预估工时**: 1h

---

### Task 4.2 — 种子经验扩充

**问题**: 冷启动时经验库为空，所有请求走 LLM 降级路径。

**修复方案**: 扩充 `src/intelligence/seed-experiences.ts`，增加高频场景的种子经验：

```typescript
// 新增种子经验
const SEED_EXPERIENCES = [
  {
    trigger: { keywords: ['写入', '创建', '文件', '保存'], domains: ['file_ops'] },
    steps: [
      { tool: 'write_file', argsTemplate: { path: '${intent.file}', content: '${intent.content}' } }
    ],
    confidence: 0.9,
  },
  {
    trigger: { keywords: ['读取', '查看', '打开', '文件'], domains: ['file_ops'] },
    steps: [
      { tool: 'read_file', argsTemplate: { path: '${intent.file}' } }
    ],
    confidence: 0.9,
  },
  {
    trigger: { keywords: ['搜索', '查找', '代码'], domains: ['code'] },
    steps: [
      { tool: 'search_files', argsTemplate: { pattern: '${intent.keyword}', path: '.' } }
    ],
    confidence: 0.85,
  },
  {
    trigger: { keywords: ['运行', '执行', '命令'], domains: ['system'] },
    steps: [
      { tool: 'exec', argsTemplate: { command: '${intent.command}' } }
    ],
    confidence: 0.85,
  },
  {
    trigger: { keywords: ['列出', '目录', '文件列表'], domains: ['file_ops'] },
    steps: [
      { tool: 'list_files', argsTemplate: { path: '${intent.dir}' } }
    ],
    confidence: 0.9,
  },
  // ... 更多种子
];
```

**涉及文件**: `src/intelligence/seed-experiences.ts`

**验收标准**:
- [ ] 冷启动时文件操作类任务直接走经验路径
- [ ] 不触发 LLM 降级

**预估工时**: 1.5h

---

### Task 4.3 — 模型选择成本感知

**状态**: ⚠️ 部分完成

**问题**: 简单任务用 DeepSeek-R1（推理模型），token 浪费严重。

**实际实现**: 未采用文档描述的 `MODEL_TIERS` 显式分层架构，而是通过 `inferComplexity()` + `costPer1kInput` 排序选择实现功能等价效果。

**已实现**:
- `model-router.ts`: `inferComplexity()` 按 taskType 推断 simple/medium/complex
- `model-router.ts`: `buildModelRequirement()` 根据复杂度设定最低能力要求
- 选择时按 `costPer1kInput` 升序，自然倾向选便宜的模型

**未实现**:
- 无显式 `MODEL_TIERS` 数组和 `targetTier` 映射
- 无按任务类型的明确分层路由（如"简单任务一定走 7B"）
- 成本下降效果未量化验证

**与文档方案差异**: 功能等价但架构不同。当前方案更灵活（动态排序），文档方案更可预测（显式分层）。建议保持当前实现，后续按需引入显式分层。

---

## 执行计划

```
Week 1 (5/14-5/18):
  ├─ Epic 1: Task 1.1 (require ESM 修复)         — 2h
  ├─ Epic 2: Task 2.1 (FTS5 转义)                — 1h
  └─ Epic 3: Task 3.1 (类别映射参数)              — 1h

Week 2 (5/19-5/25):
  ├─ Epic 2: Task 2.2 (上下文压缩)                — 1.5h
  ├─ Epic 3: Task 3.2 (幻觉检测)                  — 1h
  └─ Epic 3: Task 3.3 (并行依赖)                  — 2h

Week 3 (5/26-6/1):
  ├─ Epic 4: Task 4.1 (超时控制)                  — 1h
  ├─ Epic 4: Task 4.2 (种子经验)                  — 1.5h
  └─ Epic 4: Task 4.3 (成本感知)                  — 2h

总计: ~15h 工时
```

---

## Epic 5: 安全与权限一致性 (P1) ← 遗漏补充

### Task 5.1 — DAG 执行器缺失权限检查

**问题**: `TaskExecutor.executeSingleTask()` 直接调用 `tool.execute(resolvedArgs)`，没有经过 `beforeToolExecute` 权限检查。LLM 路径有权限拦截，但 DAG 路径没有。

**影响**: 通过 DAG 编排执行的工具（write_file, exec 等）绕过了亲密度阶段确认机制，用户未确认的操作可直接执行。

**修复方案**:

```typescript
// src/orchestrate/executor.ts — executeSingleTask()
private async executeSingleTask(dag, task, onEvent, timeoutMs) {
  // ... existing code ...
  
  // 新增：权限检查（与 LLM 路径一致）
  if (this.beforeToolExecute) {
    const check = await this.beforeToolExecute(task.tool, resolvedArgs);
    if (!check.allowed) {
      throw new Error(`权限拦截: ${check.reason ?? '操作被拒绝'}`);
    }
  }
  
  // 参数校验（已修复）
  // ... existing code ...
}

// 构造函数增加 beforeToolExecute 回调
constructor(
  private toolRegistry: ToolRegistry,
  private beforeToolExecute?: (name: string, args: Record<string, unknown>) => Promise<{ allowed: boolean; reason?: string }>,
  private verbose: boolean = false,
) {}
```

**涉及文件**: `src/orchestrate/executor.ts`

**验收标准**:
- [ ] DAG 路径的 write_file/exec 需要用户确认（低亲密度阶段）
- [ ] 高亲密度阶段自动放行

**预估工时**: 1h

---

### Task 5.2 — 工具链执行缺失权限检查

**问题**: `executeChain()` 同样直接调用 `tool.execute()`，无权限检查。

**影响**: 工具链组合可绕过权限机制。

**修复方案**:

```typescript
// src/tools/tool-chain.ts — executeChain()
export async function executeChain(
  chain: ToolChain,
  registry: ToolRegistry,
  input?: Record<string, unknown>,
  options?: {
    beforeToolExecute?: (name: string, args: Record<string, unknown>) => Promise<{ allowed: boolean; reason?: string }>;
  },
): Promise<ChainResult> {
  // ...
  for (let i = 0; i < chain.steps.length; i++) {
    // ... existing code ...
    
    // 新增：权限检查
    if (options?.beforeToolExecute) {
      const check = await options.beforeToolExecute(tool.name, resolvedArgs);
      if (!check.allowed) {
        stepResults.push({ step: i, tool: step.tool, result: '', error: `权限拦截: ${check.reason}` });
        success = false;
        break;
      }
    }
    
    // ... existing code ...
  }
}
```

**涉及文件**: `src/tools/tool-chain.ts`

**预估工时**: 0.5h

---

## Epic 6: 执行路径一致性 (P1-P2) ← 遗漏补充

### Task 6.1 — 工具执行路径统一

**问题**: 存在 4 条独立的工具执行路径，各自行为不一致：

| 路径 | 权限检查 | 参数校验 | 结果截断 | 超时控制 |
|------|----------|----------|----------|----------|
| LLM 直接调用 | ✅ | ✅ repairArgs | ✅ | ❌ |
| DAG 编排执行 | ❌ | ✅ (已修) | ❌ | ✅ withTimeout |
| 工具链执行 | ❌ | ❌ | ❌ | ❌ |
| 经验执行器 | ❌ | ❌ | ❌ | ✅ |

**修复方案**: 抽取统一的 `ToolExecutionMiddleware`：

```typescript
// src/tools/execution-middleware.ts（新建）
export interface ToolExecutionContext {
  toolName: string;
  args: Record<string, unknown>;
  source: 'llm' | 'dag' | 'chain' | 'experience';
  timeoutMs?: number;
}

export interface ToolExecutionResult {
  success: boolean;
  result: string;
  durationMs: number;
  error?: string;
}

export class ToolExecutionMiddleware {
  constructor(
    private registry: ToolRegistry,
    private options?: {
      beforeExecute?: (name: string, args: Record<string, unknown>) => Promise<{ allowed: boolean; reason?: string }>;
      maxResultLength?: number;
      defaultTimeoutMs?: number;
    },
  ) {}

  async execute(ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
    const startMs = Date.now();
    
    // 1. 权限检查
    if (this.options?.beforeExecute) {
      const check = await this.options.beforeExecute(ctx.toolName, ctx.args);
      if (!check.allowed) {
        return { success: false, result: `[已拦截: ${check.reason}]`, durationMs: Date.now() - startMs, error: check.reason };
      }
    }
    
    // 2. 工具查找
    const tool = this.registry.get(ctx.toolName);
    if (!tool) {
      return { success: false, result: `[工具不存在: ${ctx.toolName}]`, durationMs: Date.now() - startMs, error: 'tool_not_found' };
    }
    
    // 3. 参数校验
    try {
      const schema = tool.parameters as { safeParse?: (data: unknown) => { success: boolean; error?: { message: string } } };
      if (schema?.safeParse) {
        const validation = schema.safeParse(ctx.args);
        if (!validation.success) {
          return { success: false, result: `[参数错误: ${validation.error?.message}]`, durationMs: Date.now() - startMs, error: 'validation_failed' };
        }
      }
    } catch { /* 降级兼容 */ }
    
    // 4. 超时执行
    const timeoutMs = ctx.timeoutMs ?? this.options?.defaultTimeoutMs ?? 30000;
    try {
      const result = await this.withTimeout(tool.execute(ctx.args), timeoutMs);
      let resultStr = typeof result === 'string' ? result : JSON.stringify(result);
      
      // 5. 结果截断
      const maxLen = this.options?.maxResultLength ?? 10000;
      if (resultStr.length > maxLen) {
        resultStr = resultStr.slice(0, maxLen) + `\n... [已截断, 原长 ${result.length} 字符]`;
      }
      
      return { success: true, result: resultStr, durationMs: Date.now() - startMs };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, result: `[执行错误: ${msg}]`, durationMs: Date.now() - startMs, error: msg };
    }
  }
  
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`超时 (${ms}ms)`)), ms)),
    ]);
  }
}
```

**涉及文件**: 新建 `src/tools/execution-middleware.ts`，修改 `llm.ts` / `executor.ts` / `tool-chain.ts` / `experience-executor.ts` 统一使用。

**预估工时**: 3h

---

### Task 6.2 — 工具链错误恢复

**问题**: `executeChain()` 在任意步骤失败时 `break` 中断，无恢复机制。

**修复方案**:

```typescript
// src/tools/tool-chain.ts — 增加 continueOnError 选项
export interface ToolChain {
  id: string;
  name: string;
  description?: string;
  steps: ChainStep[];
  /** 步骤失败时是否继续（默认 false） */
  continueOnError?: boolean;
}

// 执行时
catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  stepOutputs.push('');
  stepResults.push({ step: i, tool: step.tool, result: '', error: msg });
  success = false;
  if (!chain.continueOnError) break;  // 默认中断
  // continueOnError=true 时继续下一步
}
```

**涉及文件**: `src/tools/tool-chain.ts`

**预估工时**: 0.5h

---

## Epic 7: 上下文与缓存 (P2-P3) ← 遗漏补充

### Task 7.1 — 工具结果缓存一致性

**状态**: ❌ 未完成

**问题**: `ToolCache` 存在但未被所有工具使用。`list_files` 有 `cacheTtlSec: 30`，但 `read_file`、`write_file` 等无缓存策略。重复读取同一文件浪费 token。

**实际现状**:
- `list_files`: `cacheTtlSec: 30` ✅
- `exec`: `cacheTtlSec: 1` ✅
- `read_file`: 无缓存 ❌
- `write_file`: 无缓存失效机制 ❌

**修复方案**:

```typescript
// src/tools/builtin.ts — read_file 增加缓存
export const read_file: ToolDef = {
  name: 'read_file',
  description: '读取文件内容。',
  parameters: z.object({
    path: z.string().describe('文件路径'),
    max_lines: z.number().optional().describe('最大行数'),
  }),
  permission: 'read_files',
  outputFormat: 'lines',
  outputSchema: z.string(),
  cacheTtlSec: 60,  // 新增：60秒缓存
  execute: async (args) => { /* ... */ },
};

// write_file 执行后清除 read_file 缓存
execute: async (args) => {
  // ... write logic ...
  // 新增：清除该文件的 read_file 缓存
  ToolCache.invalidate('read_file', { path: filePath });
  return `[已写入 ${resolved}，${content.length} 字节]`;
}
```

**涉及文件**: `src/tools/builtin.ts`, `src/tools/cache.ts`

**预估工时**: 1h

---

### Task 7.2 — 上下文信息管理（范式重定义）

**状态**: ❌ 当前实现需重写，方向从"token 预算管理"转为"信息生命周期管理"

**范式转换**:

```
旧范式（当前）：数 token → 到阈值 → 机械压缩 → 继续
  本质：磁盘空间管理
  问题：maxContextTokens 不准 + token 估算不准 = 双重误差

新范式（应有）：管信息 → 旧的变模糊 → 总结/提炼 → 保持清晰
  本质：记忆管理
  优势：不依赖精确 token 计数，关注信息质量而非数量
```

**当前实现问题**:

1. **机械压缩**: `compressToolHistory` 按"保留最近 N 条 + 前 80 字"压缩，丢失关键信息
2. **无引用追踪**: 不知道哪些工具结果被后续步骤用过，哪些是噪音
3. **无语义理解**: `read_file` 返回 500 行，压缩成"前 80 字"，关键信息可能在里面也可能不在
4. **无位置管理**: LLM 有 U 型注意力偏差（开头和结尾关注多，中间被忽略），但工具结果沉在中间

**学术依据** (2026-05-14 调研):

| 论文 | 核心思路 | 对项目的启示 |
|------|----------|-------------|
| **MemTool** (arXiv:2507.21428) | Agent 自主决定丢弃哪些工具上下文，推理模型达 90-94% 效率 | 让 LLM 判断工具结果是否还会被用到 |
| **SimpleMem** (arXiv:2601.02553) | 语义无损压缩：结构化提取 + 在线合成 + 意图检索，token 降 30 倍 | 工具结果应提取关键信息后压缩 |
| **SUPO** (arXiv:2510.06727) | 总结替代压缩，用摘要保留任务相关信息 | 用便宜模型总结旧上下文，而非截断 |
| **MemGPT** (arXiv:2310.08560) | 操作系统式内存分层：工作内存 ↔ 长期存储 | 工具结果先在上下文，超龄后转摘要存 STMP |
| **Found in the Middle** (arXiv:2406.16008) | LLM 有 U 型注意力偏差，校准后长上下文利用率 +15% | 关键信息应靠近上下文末尾 |

**修复方案 — 信息管理三层架构**:

#### 第一层：工具结果生命周期（MemTool 思路）

```typescript
interface ToolResultMeta {
  toolName: string;
  turn: number;           // 产生的轮次
  referenced: number;     // 被后续工具调用引用的次数
  status: 'hot' | 'warm' | 'cold';
}

// 每轮工具执行后更新状态
function updateToolResultStatus(messages: Message[], currentTurn: number): void {
  for (const msg of messages) {
    if (!isToolResult(msg)) continue;
    const age = currentTurn - msg.meta.turn;

    if (msg.meta.referenced > 0 || age <= 1) {
      msg.meta.status = 'hot';    // 被引用过或刚产生 → 原样保留
    } else if (age <= 3) {
      msg.meta.status = 'warm';   // 未引用但不太旧 → 语义压缩
    } else {
      msg.meta.status = 'cold';   // 老且未引用 → 总结后移入长期记忆
    }
  }
}
```

#### 第二层：语义压缩（SimpleMem 思路）

```typescript
// 按工具类型提取关键信息，而非截断前 80 字
function semanticCompress(content: string, toolName: string): string {
  switch (toolName) {
    case 'read_file':
      // 提取：文件路径 + 行数 + 关键内容（函数签名、类定义、错误信息）
      return extractFileSummary(content);
    case 'exec':
      // 提取：退出码 + 最后几行 + 错误信息
      return extractExecSummary(content);
    case 'search_files':
      // 提取：匹配文件路径列表 + 匹配数
      return extractSearchSummary(content);
    case 'list_files':
      // 提取：目录结构概要（不展开子目录）
      return extractDirSummary(content);
    default:
      return content.slice(0, 200) + '...';
  }
}
```

#### 第三层：位置管理（Found in the Middle 思路）

```typescript
// 重排消息：关键信息靠近末尾（LLM 注意力最高的位置）
function reorderForAttention(messages: Message[]): Message[] {
  const systemMsgs = messages.filter(m => m.role === 'system');
  const toolResults = messages.filter(m => isToolResult(m) && m.meta.status === 'hot');
  const otherMsgs = messages.filter(m => !isToolResult(m) && m.role !== 'system');
  const compressed = messages.filter(m => isToolResult(m) && m.meta.status === 'warm');

  // 排列：system → 压缩的旧结果 → 其他对话 → 热工具结果（靠近末尾）
  return [...systemMsgs, ...compressed, ...otherMsgs, ...toolResults];
}
```

#### 总结替代压缩（SUPO 思路）

```typescript
// cold 状态的工具结果：用便宜模型总结后存入长期记忆
async function summarizeAndArchive(msg: Message, llm: LLM): Promise<void> {
  const summary = await llm.generate(
    `用一句话总结这个工具调用的关键结论：\n${msg.content}`
  );
  // 存入 STMP 长期记忆，后续可检索
  await stmp.store({
    type: 'tool_summary',
    tool: msg.meta.toolName,
    summary,
    turn: msg.meta.turn,
  });
  // 从当前上下文移除
  removeFromContext(msg);
}
```

**完整流程**:

```
工具执行 → 结果注入 [hot]
    ↓ 1 轮后
检查引用 → 被引用过？保持 [hot] : 降级 [warm]
    ↓ warm
语义压缩 → 提取关键信息（按工具类型）
    ↓ 3 轮后仍未引用
总结 → 用便宜模型生成一句话摘要 → 存入 STMP [cold] → 从上下文移除
    ↓ 后续需要时
从 STMP 检索摘要 → 注入上下文
```

**涉及文件**: `src/core/llm.ts`（主逻辑）, `src/memory/stmp.ts`（长期记忆存储）

**验收标准**:
- [ ] 工具结果有 hot/warm/cold 状态追踪
- [ ] warm 状态按工具类型做语义压缩（非截断）
- [ ] cold 状态总结后存入 STMP，从上下文移除
- [ ] 被引用过的工具结果不被压缩/移除
- [ ] 关键信息重排到上下文末尾

**预估工时**: 4h

---

### Task 7.3 — 错误消息用户友好化

**问题**: 工具返回的错误是原始技术信息（如 `[写入失败: The "paths[0]" argument must be of type string]`），用户看不懂。

**修复方案**:

```typescript
// src/tools/error-messages.ts（新建）
const ERROR_TRANSLATIONS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /paths\[0\].*must be of type string/, message: '文件路径无效，请检查路径是否正确' },
  { pattern: /ENOENT.*no such file/, message: '文件或目录不存在' },
  { pattern: /EACCES.*permission denied/, message: '没有权限访问该文件' },
  { pattern: /ENOSPC/, message: '磁盘空间不足' },
  { pattern: /timeout/i, message: '操作超时，请稍后重试' },
  { pattern: /command not found/, message: '命令不存在，请检查是否已安装' },
  { pattern: /401/, message: 'API 认证失败，请检查 API Key' },
  { pattern: /429/, message: 'API 请求过于频繁，请稍后重试' },
  { pattern: /500/, message: '服务器内部错误，请稍后重试' },
];

export function friendlyError(raw: string): string {
  for (const { pattern, message } of ERROR_TRANSLATIONS) {
    if (pattern.test(raw)) return message;
  }
  return raw; // 无匹配则原样返回
}
```

**涉及文件**: 新建 `src/tools/error-messages.ts`，在 `execution-middleware.ts` 中调用。

**预估工时**: 0.5h

---

## Epic 8: 上下文信息管理基础设施 (P1) ← 2026-05-14 调研补充

> Task 7.2 从"token 预算管理"重定义为"信息生命周期管理"。
> 以下基础设施是信息管理方案的前置依赖。

### Task 8.1 — 接住 API usage 数据（辅助校准）

**问题**: `generateText()` 返回的 `result.usage`（含 `promptTokens` / `completionTokens`）是 API 告诉的真实 token 数，但主 LLM 路径（`llm.ts`）完全丢弃。

**作用**: 不作为预算管理的核心，而是作为**信息管理的辅助校准**——知道实际用了多少 token，可以帮助判断压缩策略是否有效。

**修复方案**:

```typescript
// src/core/llm.ts — 增加 usage 记录
private lastActualUsage: { input: number; output: number } | null = null;

const result = await generateText({ model, messages: currentMessages });
if (result.usage) {
  this.lastActualUsage = {
    input: result.usage.promptTokens ?? 0,
    output: result.usage.completionTokens ?? 0,
  };
}
```

**涉及文件**: `src/core/llm.ts`

**预估工时**: 0.5h

---

### Task 8.2 — maxContextTokens 动态化（辅助校准）

**问题**: `maxContextTokens` 硬编码在 Provider Adapter 中，不按实际模型区分。

**作用**: 信息管理不依赖精确的 token 计数，但 `maxContextTokens` 仍需大致准确——用于判断"是否接近有效上下文上限"（有效上下文 ≈ 声称窗口 × 0.5）。

**修复方案**: 三级优先级

```
① 用户配置 contextWindow（最高优先级）→ config.contextWindow
② model-knowledge.ts 按模型查询 → lookupModelKnowledge(modelId).contextWindow
③ Adapter 硬编码兜底（最低优先级）
```

```typescript
// src/core/provider-adapter.ts
const knowledge = lookupModelKnowledge(modelId);
if (knowledge?.contextWindow) {
  capabilities.maxContextTokens = knowledge.contextWindow;
}
if (config.contextWindow) {
  capabilities.maxContextTokens = config.contextWindow;
}
```

同时给 `model-knowledge.ts` 补上 `contextWindow` 字段。

**涉及文件**: `src/core/provider-adapter.ts`, `src/core/model-knowledge.ts`

**预估工时**: 1.5h

---

### Task 8.3 — 工具结果引用追踪

**问题**: 当前系统不知道哪些工具结果被后续步骤使用过。`compressToolHistory` 按"最近 N 条"机械压缩，可能丢掉后续需要的关键结果。

**修复方案**: 给每条工具结果记录是否被后续引用

```typescript
// src/core/llm.ts — 工具结果元数据
interface ToolResultMeta {
  toolName: string;
  turn: number;
  referenced: number;  // 被后续工具调用引用的次数
  status: 'hot' | 'warm' | 'cold';
}

// 工具执行后，检查之前的结果是否被引用
function trackReferences(toolCalls: ToolCall[], messages: Message[]): void {
  for (const tc of toolCalls) {
    const argsStr = JSON.stringify(tc.arguments);
    for (const msg of messages) {
      if (!isToolResult(msg)) continue;
      // 如果后续工具的参数引用了之前结果的内容
      if (argsStr.includes(msg.meta.toolName) || argsStr.includes(extractKeyFromResult(msg))) {
        msg.meta.referenced++;
        msg.meta.status = 'hot';
      }
    }
  }
}
```

**涉及文件**: `src/core/llm.ts`

**预估工时**: 1h

---

### Task 8.4 — 语义压缩函数（按工具类型）

**问题**: 当前压缩是"保留前 80 字"，不区分工具类型。`read_file` 的 500 行和 `exec` 的输出，关键信息位置完全不同。

**修复方案**: 按工具类型提取关键信息

```typescript
function semanticCompress(content: string, toolName: string): string {
  switch (toolName) {
    case 'read_file':
      // 提取：路径 + 行数 + 函数/类签名 + 错误行
      return extractFileSummary(content);
    case 'exec':
      // 提取：退出码 + stderr + 最后 5 行
      return extractExecSummary(content);
    case 'search_files':
      // 提取：匹配路径列表 + 总匹配数
      return extractSearchSummary(content);
    case 'list_files':
      // 提取：顶层目录结构（不递归）
      return extractDirSummary(content);
    default:
      return content.slice(0, 200) + '...';
  }
}
```

**涉及文件**: `src/core/llm.ts`（或新建 `src/tools/semantic-compress.ts`）

**预估工时**: 1.5h


## 修订后执行计划

```
Week 1 (5/14-5/18):
  ├─ Epic 1: Task 1.1 (require ESM 修复)              — 2h
  ├─ Epic 2: Task 2.1 (FTS5 转义)                     — 1h
  ├─ Epic 3: Task 3.1 (类别映射参数)                   — 1h
  └─ Epic 5: Task 5.1 (DAG 权限检查)                  — 1h

Week 2 (5/19-5/25):
  ├─ Epic 2: Task 2.2 (上下文压缩)                    — 1.5h
  ├─ Epic 3: Task 3.2 (幻觉检测)                      — 1h
  ├─ Epic 3: Task 3.3 (并行依赖)                      — 2h
  └─ Epic 5: Task 5.2 (工具链权限)                    — 0.5h

Week 3 (5/26-6/1):
  ├─ Epic 6: Task 6.1 (执行路径统一)                  — 3h ← 核心重构
  ├─ Epic 6: Task 6.2 (工具链错误恢复)                — 0.5h
  └─ Epic 4: Task 4.1 (超时控制)                      — 1h

Week 4 (6/2-6/8):
  ├─ Epic 4: Task 4.2 (种子经验)                      — 1.5h
  ├─ Epic 4: Task 4.3 (成本感知)                      — 2h ← 已部分完成
  ├─ Epic 8: Task 8.1 (接住 API usage)                — 0.5h
  ├─ Epic 8: Task 8.2 (maxContextTokens 动态化)       — 1.5h
  └─ Epic 8: Task 8.3 (引用追踪)                      — 1h

Week 5 (6/9-6/15):
  ├─ Epic 8: Task 8.4 (语义压缩函数)                  — 1.5h
  ├─ Epic 7: Task 7.1 (结果缓存)                      — 1h
  ├─ Epic 7: Task 7.2 (信息生命周期管理)              — 4h ← 核心，依赖 Epic 8
  └─ Epic 7: Task 7.3 (错误友好化)                    — 0.5h

总计: ~30h 工时
```

---

## 风险与依赖（更新）

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| require→import 引入循环依赖 | 中 | 编译失败 | 按模块顺序逐个替换 |
| FTS5 转义过度导致检索失效 | 低 | 记忆质量下降 | 保留原文 fallback |
| 并行依赖分析误判 | 低 | 性能退化 | 保守策略：无法判断时串行 |
| 成本感知模型切换质量下降 | 中 | 回答质量下降 | A/B 测试验证 |
| **执行路径统一重构影响面大** | **中** | **回归风险** | **先写集成测试再重构** |
| **DAG 权限检查破坏现有流程** | **低** | **功能不可用** | **高亲密度阶段自动放行** |
| **信息管理引入额外 LLM 调用** | **中** | **延迟增加** | **用本地便宜模型做总结，异步执行** |
| **引用追踪误判** | **低** | **信息丢失** | **保守策略：不确定时保持 hot** |
| **语义压缩丢失关键信息** | **中** | **任务失败** | **按工具类型定制压缩策略，保留原文 fallback** |

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| require→import 引入循环依赖 | 中 | 编译失败 | 按模块顺序逐个替换 |
| FTS5 转义过度导致检索失效 | 低 | 记忆质量下降 | 保留原文 fallback |
| 并行依赖分析误判 | 低 | 性能退化 | 保守策略：无法判断时串行 |
| 成本感知模型切换质量下降 | 中 | 回答质量下降 | A/B 测试验证 |

---

## 附录：相关代码位置

| 模块 | 文件 | 关键行 |
|------|------|--------|
| SkillResolver | `src/skills/skill-resolver.ts` | L295-340 (LLM 降级) |
| TaskExecutor | `src/orchestrate/executor.ts` | L370-410 (参数校验) |
| LLM 工具调用 | `src/core/llm.ts` | L820-870 (并行执行), L692 (压缩), L873 (预算检查) |
| Reflector | `src/core/reflector.ts` | L184-210 (幻觉检测) |
| STMP 记忆 | `src/memory/stmp.ts` | L232-263 (FTS 查询) |
| ModelRouter | `src/core/model-router.ts` | L770-790 (持久化) |
| 种子经验 | `src/intelligence/seed-experiences.ts` | 全文件 |
| Provider Adapter | `src/core/provider-adapter.ts` | L44 (maxContextTokens), L234/279/337 (各 Provider 硬编码) |
| Model Knowledge | `src/core/model-knowledge.ts` | L266-290 (硅基流动模型，缺 contextWindow) |
| Execution Middleware | `src/tools/execution-middleware.ts` | 全文件 (统一执行路径) |
| Error Messages | `src/tools/error-messages.ts` | 全文件 (错误友好化) |
| Tool Chain | `src/tools/tool-chain.ts` | L25 (continueOnError), L135 (权限检查) |

---

## 2026-05-14 复核总结

**已完成**: 15/21 个任务（Epic 1-6 全部完成，Task 7.3 完成）

**未完成**:
- Task 7.1: read_file 无缓存
- Task 7.2: 从"token 预算管理"重定义为"信息生命周期管理"（需重写，依赖 Epic 8）
- Task 4.3: 实现方式与文档不同（功能等价，建议保持现状）
- Epic 8: 上下文信息管理基础设施（新增，Task 8.1-8.4）

**范式转换**:
- 旧思路：数 token → 到阈值 → 机械压缩
- 新思路：管信息 → 生命周期（hot/warm/cold）→ 语义压缩 → 总结存档
- 学术依据：MemTool、SimpleMem、SUPO、MemGPT、Found in the Middle

**关键发现**:
1. `maxContextTokens` 硬编码不准，但不是核心问题——信息管理不依赖精确 token 计数
2. 核心问题是 `compressToolHistory` 机械压缩（保留最近 N 条 + 前 80 字），丢失关键信息
3. 应改为：引用追踪 + 语义压缩 + 位置管理 + 总结存档
4. API usage 仍应接住，但作为辅助校准而非核心依赖
