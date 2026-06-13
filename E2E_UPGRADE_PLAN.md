# E2E 测试双升级计划

> 2026-04-30 | 目标：Mock 测试从"前端注入"升级为"端到端协议验证"，真实 LLM 测试从"页面有字"升级为"事件流断言"

---

## 问题诊断

### 现状

```
217 个 Mock 测试：  Playwright → 拦截 WS → 注入 JSON → 看页面有没有字
 22 个真实 LLM 测试：Playwright → 真实 WS → 真实 LLM → 看页面有没有字
```

**两种测试的断言方式完全一样，区别只是消息来源不同。**

### 核心矛盾

| 维度 | Mock 测试 | 真实 LLM 测试 |
|------|----------|--------------|
| 测的是 | 前端渲染能力 | LLM API 可用性 |
| 漏掉的 | 后端协议/工具执行/决策链路 | 工具调用正确性/事件流完整性 |
| 本质 | 组件测试冒充 E2E | 冒烟测试冒充 E2E |

---

## 升级一：Mock 测试 → 真实后端 + MockLLM

### 原理

```
Before:  Playwright ──X──▶ 后端（不启动）    ──▶ 前端渲染注入的 JSON
After:   Playwright ──────▶ 后端(MockLLM) ──▶ 前端渲染真实响应
```

后端已有 `BUDDY_MOCK_LLM=1` 模式（playwright.config.ts 已配置），MockLLM 会：
- 用正则识别意图（exec/list/read/write/search/git/time）
- **真实执行工具**（`tool.execute()`）
- 返回确定性结果

### 改造方案

#### Step 1：新增 WS 事件监听 Fixture

```typescript
// e2e/ws-event-collector.ts
import type { Page, WebSocket } from '@playwright/test';

export interface WSEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * 在 Playwright 层拦截后端 → 前端的 WS 消息
 * 不修改前端代码，不注入 mock WS
 * 直接监听浏览器的 WebSocket 连接
 */
export class WSEventCollector {
  private events: WSEvent[] = [];
  private ws: WebSocket | null = null;
  private listeners: Map<string, ((e: WSEvent) => void)[]> = new Map();

  constructor(private page: Page) {}

  async attach() {
    // 监听 Playwright 级别的 WebSocket
    this.page.on('websocket', (ws) => {
      this.ws = ws;
      ws.on('framereceived', (frame) => {
        try {
          const data = JSON.parse(frame.payload.toString());
          this.events.push(data);
          // 触发类型监听器
          const cbs = this.listeners.get(data.type) ?? [];
          cbs.forEach(cb => cb(data));
          // 通配符监听
          const allCbs = this.listeners.get('*') ?? [];
          allCbs.forEach(cb => cb(data));
        } catch {}
      });
    });
  }

  /** 等待某个类型的事件出现 */
  async waitFor(type: string, timeoutMs = 15000): Promise<WSEvent> {
    const existing = this.events.find(e => e.type === type);
    if (existing) return existing;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`WS 事件 "${type}" 超时 (${timeoutMs}ms)`)), timeoutMs);
      const cb = (e: WSEvent) => {
        if (e.type === type) {
          clearTimeout(timer);
          this.listeners.set(type, (this.listeners.get(type) ?? []).filter(c => c !== cb));
          resolve(e);
        }
      };
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type)!.push(cb);
    });
  }

  /** 等待事件序列（按顺序） */
  async waitForSequence(types: string[], timeoutMs = 30000): Promise<WSEvent[]> {
    const results: WSEvent[] = [];
    for (const type of types) {
      const event = await this.waitFor(type, timeoutMs);
      results.push(event);
    }
    return results;
  }

  /** 获取所有已收集的事件 */
  all(): WSEvent[] { return [...this.events]; }

  /** 按类型过滤 */
  filter(type: string): WSEvent[] {
    return this.events.filter(e => e.type === type);
  }

  /** 清空 */
  clear() { this.events = []; }
}
```

#### Step 2：新增发送消息 Fixture

```typescript
// e2e/helpers.ts
import type { Page } from '@playwright/test';

/**
 * 通过真实 UI 发送消息（不是注入 WS）
 * 模拟真实用户操作
 */
export async function sendMessage(page: Page, text: string) {
  const textarea = page.locator('textarea').first();
  await textarea.fill(text);
  await textarea.press('Enter');
}

/**
 * 等待页面文本包含目标内容（排除 UI 固定文案）
 */
export async function waitForContent(
  page: Page,
  predicate: (text: string) => boolean,
  timeoutMs = 15000,
): Promise<string> {
  const start = Date.now();
  const UI_TEXTS = ['已连接', '打个招呼吧', '思考中', '发送', '连接中...'];

  while (Date.now() - start < timeoutMs) {
    const messages = await page.evaluate((uiTexts: string[]) => {
      const divs = document.querySelectorAll('div, p, span');
      return Array.from(divs)
        .filter(d => d.children.length === 0 && d.textContent?.trim())
        .map(d => d.textContent!.trim())
        .filter(t => t.length > 1 && !uiTexts.some(ui => t === ui));
    }, UI_TEXTS);

    const found = messages.find(predicate);
    if (found) return found;
    await page.waitForTimeout(300);
  }
  throw new Error(`waitForContent 超时 (${timeoutMs}ms)`);
}
```

#### Step 3：改造测试用例（示例）

```typescript
// e2e/chat-flow-upgraded.spec.ts — 改造后的对话流程测试

import { test, expect } from '@playwright/test';
import { skipOnboarding } from './fixtures.js';
import { WSEventCollector } from './ws-event-collector.js';
import { sendMessage } from './helpers.js';

test.describe('对话流程 — 端到端', () => {

  test('发送消息 → 后端处理 → 完整事件流', async ({ page }) => {
    const collector = new WSEventCollector(page);
    await collector.attach();

    await skipOnboarding(page);
    await expect(page.getByText('已连接')).toBeVisible({ timeout: 15000 });

    // 清空收集器（跳过 onboarding 期间的事件）
    collector.clear();

    // 通过真实 UI 发送消息
    await sendMessage(page, '你好');

    // 断言事件流顺序
    const events = await collector.waitForSequence([
      'user_message',   // 1. 用户消息确认
      'thinking',       // 2. 三脑决策开始
      'llm_response',   // 3. LLM 回复
      'response_end',   // 4. 响应结束
    ], 30000);

    // 断言事件内容
    expect(events[3].toolCalls).toBe(0); // 闲聊无工具调用
  });

  test('文件操作 → 工具调用链路完整', async ({ page }) => {
    const collector = new WSEventCollector(page);
    await collector.attach();

    await skipOnboarding(page);
    await expect(page.getByText('已连接')).toBeVisible({ timeout: 15000 });
    collector.clear();

    // 发送会触发工具调用的消息（MockLLM 会识别 "列出/目录/文件" → list_files）
    await sendMessage(page, '帮我列出当前目录的文件');

    // 断言：thinking → tool_call → tool_result → llm_response
    const thinking = await collector.waitFor('thinking', 10000);
    expect(thinking).toBeTruthy();

    const toolCall = await collector.waitFor('tool_call', 10000);
    expect(toolCall.tool).toBeTruthy(); // MockLLM 会调 list_files 或 exec

    const toolResult = await collector.waitFor('tool_result', 10000);
    expect(toolResult.success).toBe(true);
    expect(toolResult.preview).toBeTruthy();

    const response = await collector.waitFor('llm_response', 15000);
    expect(response.content.length).toBeGreaterThan(0);

    // 断言：页面渲染了工具结果（如 package.json 出现在文件列表中）
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('package.json');
  });

  test('工具确认流程 — 高风险操作', async ({ page }) => {
    const collector = new WSEventCollector(page);
    await collector.attach();

    await skipOnboarding(page);
    await expect(page.getByText('已连接')).toBeVisible({ timeout: 15000 });
    collector.clear();

    // 发送高风险命令（MockLLM 会调 exec，后端可能触发确认）
    await sendMessage(page, '执行 rm -rf /tmp/test');

    // 等待 tool_call 或 tool_confirm_request
    const event = await Promise.race([
      collector.waitFor('tool_call', 10000),
      collector.waitFor('tool_confirm_request', 10000),
    ]);

    if (event.type === 'tool_confirm_request') {
      // 验证确认对话框
      expect(event.tool).toBe('exec');
      expect(event.trustLevel).toBeTruthy();
      await expect(page.getByText(/需要确认/)).toBeVisible();
    }
    // 如果直接执行了（trust level 够高），也验证 tool_result
    if (event.type === 'tool_call') {
      const result = await collector.waitFor('tool_result', 10000);
      expect(result).toBeTruthy();
    }
  });
});
```

### Mock 测试改造清单

| 原测试文件 | 改造重点 | 新增断言 |
|-----------|---------|---------|
| `chat-flow.spec.ts` | 发消息走 UI，收集 WS 事件 | `thinking → tool_call → tool_result → llm_response` 完整链路 |
| `three-brain.spec.ts` | 发消息触发真实决策 | `brain_trace` 事件 phase=signal/resource/data |
| `tool-execution.spec.ts` | 发消息触发真实工具 | `tool_call.tool` 匹配预期工具名，`tool_result.success=true` |
| `memory-intelligence.spec.ts` | 长对话后检查记忆 | `memory_panel_data` 事件含领域数据 |
| `pet-interaction.spec.ts` | 点摸头按钮 | WS 发送 `pet` 消息，`emotion` 事件变化 |
| `brain-decision.spec.ts` | 调 REST API | `/api/decision-trace` 返回含 `domains`/`complexity` 的记录 |
| `ws-reconnection.spec.ts` | 杀后端重启 | WS 事件恢复，`status` 事件重新推送 |
| `persistence.spec.ts` | 刷新后重连 | WS 重连后 `status` 事件重新推送 buddyState |
| `visual-regression.spec.ts` | 保持不变 | 截图对比仍然有效 |
| `smooth-interaction.spec.ts` | 保持不变 | 帧率/内存测试仍然有效 |
| `error-boundary.spec.ts` | 保持不变 | 边界测试仍然有效 |
| `onboarding.spec.ts` | 保持不变 | 流程测试仍然有效 |

---

## 升级二：真实 LLM 测试 → 事件流断言

### 原理

```
Before:  发消息 → 等页面有字 → 断言字数 > 0
After:   发消息 → 收集 WS 事件 → 断言事件类型/内容/顺序
```

### 改造方案

```typescript
// e2e/real-llm-upgraded.spec.ts — 改造后的真实 LLM 测试

import { test, expect } from '@playwright/test';
import { WSEventCollector } from './ws-event-collector.js';
import { sendMessage } from './helpers.js';
import {
  setupFrontendLLMConfig,
  cleanupSensitiveStorage,
  getSiliconFlowKey,
} from './real-llm-fixtures.js';

const HAS_API_KEY = !!process.env.SILICONFLOW_API_KEY;

test.describe('真实 LLM — 事件流验证', () => {

  test('简单问答 → 无工具调用', async ({ page }) => {
    test.skip(!HAS_API_KEY);
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await expect(page.getByText('已连接')).toBeVisible({ timeout: 15000 });
    collector.clear();

    await sendMessage(page, '1+1等于几？');

    // 等待事件流
    await collector.waitFor('user_message', 5000);
    await collector.waitFor('thinking', 10000);

    // 简单问答不应触发工具调用
    const toolCalls = collector.filter('tool_call');
    // 注意：不能直接断言 0，因为可能在等待期间有其他事件
    // 需要等 response_end 后再检查
    await collector.waitFor('response_end', 30000);

    const allToolCalls = collector.filter('tool_call');
    const responseEnd = collector.filter('response_end')[0];
    expect(responseEnd.toolCalls).toBe(0);

    await cleanupSensitiveStorage(page);
  });

  test('文件操作 → 触发 read 工具', async ({ page }) => {
    test.skip(!HAS_API_KEY);
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await expect(page.getByText('已连接')).toBeVisible({ timeout: 15000 });
    collector.clear();

    await sendMessage(page, '读取当前目录的 package.json，告诉我项目名称');

    // 等待工具调用
    const toolCall = await collector.waitFor('tool_call', 60000);

    // ✅ 断言工具名（不是页面文本包含 "read"）
    expect(['read_file', 'read', 'exec']).toContain(toolCall.tool);

    // ✅ 断言工具参数
    if (toolCall.args?.path) {
      expect(toolCall.args.path).toContain('package');
    }

    // ✅ 断言工具结果
    const toolResult = await collector.waitFor('tool_result', 30000);
    expect(toolResult.success).toBe(true);
    expect(toolResult.preview).toContain('buddy'); // package.json 的 name

    // ✅ 断言最终回复
    const response = await collector.waitFor('llm_response', 30000);
    expect(response.content).toContain('buddy');

    await cleanupSensitiveStorage(page);
  });

  test('三脑决策 → brain_trace 事件完整', async ({ page }) => {
    test.skip(!HAS_API_KEY);
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await expect(page.getByText('已连接')).toBeVisible({ timeout: 15000 });
    collector.clear();

    await sendMessage(page, '分析当前项目结构');

    // 等待 brain_trace 事件（三脑决策链路）
    const signal = await collector.waitFor('brain_trace', 30000);
    expect(signal.phase).toBe('signal');
    expect(signal.data.domains).toBeTruthy();
    expect(signal.data.complexity).toBeTruthy();

    // 等待完整决策链路
    const resource = await collector.waitFor('brain_trace', 15000);
    expect(resource.phase).toBe('resource');

    const decision = await collector.waitFor('brain_trace', 15000);
    expect(decision.phase).toBe('decision');
    expect(decision.data.path).toBeTruthy(); // 'threeBrain' 或 'legacy'
    expect(decision.data.mode).toBeTruthy(); // 'single'/'parallel'/'cascade'

    // 等待执行完成
    await collector.waitFor('response_end', 120000);

    await cleanupSensitiveStorage(page);
  });

  test('工具调用延迟 — 首次 tool_call < 15s', async ({ page }) => {
    test.skip(!HAS_API_KEY);
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await expect(page.getByText('已连接')).toBeVisible({ timeout: 15000 });
    collector.clear();

    const start = Date.now();
    await sendMessage(page, '当前目录有哪些文件？');

    const toolCall = await collector.waitFor('tool_call', 30000);
    const elapsed = Date.now() - start;

    console.log(`[Perf] 首次 tool_call 延迟: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(15000);
    expect(toolCall.tool).toBeTruthy();

    await cleanupSensitiveStorage(page);
  });

  test('多轮对话 → 上下文记忆', async ({ page }) => {
    test.skip(!HAS_API_KEY);
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await expect(page.getByText('已连接')).toBeVisible({ timeout: 15000 });
    collector.clear();

    // 第一轮
    await sendMessage(page, '我最喜欢的水果是芒果');
    await collector.waitFor('response_end', 30000);
    collector.clear();

    // 第二轮
    await sendMessage(page, '我最喜欢的水果是什么？');
    const response = await collector.waitFor('llm_response', 30000);

    // ✅ 断言回复内容（不是页面文本）
    expect(response.content).toContain('芒果');

    await cleanupSensitiveStorage(page);
  });

  test('错误处理 — 无效 API Key', async ({ page }) => {
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page, { apiKey: 'sk-invalid-12345' });
    await page.goto('/');
    await page.waitForTimeout(2000);
    collector.clear();

    await sendMessage(page, '你好');

    // 应该收到 error 事件
    const error = await collector.waitFor('error', 30000);
    expect(error.message).toBeTruthy();
    // 页面也应该显示错误
    await expect(page.getByText(/❌|错误|失败/)).toBeVisible();
  });
});
```

---

## 执行计划

### Phase 1：基础设施（1 天）

| 任务 | 文件 | 说明 |
|------|------|------|
| 新建 WSEventCollector | `e2e/ws-event-collector.ts` | WS 事件收集器 |
| 新建 helpers | `e2e/helpers.ts` | sendMessage、waitForContent |
| 验证 MockLLM 工具链路 | 手动跑 `BUDDY_MOCK_LLM=1 npx tsx src/start-ws.ts` | 确认 MockLLM 真实执行工具 |

### Phase 2：Mock 测试升级（2-3 天）

| 任务 | 改造文件 | 新增测试数 |
|------|---------|----------|
| 对话流程 | `chat-flow.spec.ts` | +5（事件流断言） |
| 三脑决策 | `three-brain.spec.ts` | +4（brain_trace 链路） |
| 工具执行 | `tool-execution.spec.ts` | +6（真实工具调用） |
| 记忆系统 | `memory-intelligence.spec.ts` | +3（长对话后记忆） |
| 决策追踪 | `brain-decision.spec.ts` | +3（REST API 真实数据） |
| WS 生命周期 | `ws-lifecycle.spec.ts` | +3（断线重连后事件恢复） |
| 保留不动 | 10 个文件 | 0（视觉/性能/边界/onboarding） |

**预计新增：~24 个事件流测试，升级 ~15 个现有测试**

### Phase 3：真实 LLM 测试升级（1-2 天）

| 任务 | 改造文件 | 说明 |
|------|---------|------|
| 事件流断言 | `real-llm.spec.ts` | 全部 22 个测试改为 WS 事件断言 |
| 性能指标 | 同上 | 从"页面有字"改为"事件到达时间" |
| 工具验证 | 同上 | 从"bodyText.includes('read')"改为"toolCall.tool === 'read_file'" |

### Phase 4：CI 适配（0.5 天）

| 任务 | 说明 |
|------|------|
| Mock 测试 CI | `BUDDY_MOCK_LLM=1` + 真实后端，无需 API Key |
| 真实 LLM CI | 可选：配 `SILICONFLOW_API_KEY` secret，无则 skip |
| 超时调整 | Mock 测试从 30s 调到 45s（真实后端比注入慢） |

---

## 预期成果

```
改造前：
  217 Mock 测试 → 测前端渲染（管道 0%）
  22 真实 LLM  → 测页面有字（脑子 10%）

改造后：
  ~193 不变    → 测 UI/视觉/性能/边界（该测啥测啥）
  ~24 新增    → 测端到端协议 + 真实工具执行（管道 100%）
  22 升级     → 测事件流正确性 + 决策链路（脑子 80%）
```

| 指标 | 改造前 | 改造后 |
|------|-------|-------|
| 后端协议覆盖 | 0% | **100%** |
| 工具执行覆盖 | 0% | **100%**（MockLLM 真实执行） |
| 三脑决策覆盖 | 0% | **signal→resource→decision 全链路** |
| LLM 行为验证 | 页面有字 | **事件类型+内容+顺序** |
| 测试运行时间 | ~30s | ~60s（可接受） |
| CI 依赖 | 无 | Mock 测试无依赖，真实 LLM 需 API Key |
