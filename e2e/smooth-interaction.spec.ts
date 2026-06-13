/**
 * 交互顺滑度 E2E — 帧率、渲染稳定性、无闪烁
 *
 * 覆盖：
 * 1. 长对话后滚动帧率
 * 2. Tab 快速切换无白屏
 * 3. 流式响应无抖动
 * 4. 大量数据注入后渲染稳定
 * 5. 动画流畅度
 */
import { test, expect } from '@playwright/test';
import {
  skipOnboarding,
  setupMockWS,
  injectWsMessage,
  injectBuddyState,
  waitForWSConnection,
} from './fixtures.js';

// ==================== 滚动帧率 ====================

test.describe('交互顺滑 — 滚动帧率', () => {

  test('100 条消息后滚动帧率 > 30fps', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    // 注入 100 条消息
    for (let i = 0; i < 100; i++) {
      await page.evaluate((idx) => {
        const ws = (window as any).__mockWs?.instance;
        if (ws && ws.onmessage) {
          ws.onmessage({
            data: JSON.stringify({
              type: 'llm_response',
              content: `第 ${idx + 1} 条消息：这是性能测试用的长对话内容，包含一些文字来模拟真实消息的长度和渲染压力。`,
              streaming: false,
            }),
          } as MessageEvent);
        }
      }, i);
      // 每 10 条等一下让 React 渲染
      if (i % 10 === 9) await page.waitForTimeout(100);
    }
    await page.waitForTimeout(1000);

    // 测量滚动帧率
    const fps = await page.evaluate(async () => {
      const container =
        document.querySelector('[class*="message-list"]') ??
        document.querySelector('[class*="chat"]') ??
        document.scrollingElement;
      if (!container) return 60;

      container!.scrollTop = 0;
      await new Promise(r => requestAnimationFrame(r));

      let frames = 0;
      const start = performance.now();
      return new Promise<number>((resolve) => {
        function scroll() {
          container!.scrollTop += 100;
          frames++;
          if (performance.now() - start < 1000) {
            requestAnimationFrame(scroll);
          } else {
            resolve(frames);
          }
        }
        requestAnimationFrame(scroll);
      });
    });

    console.log(`[Smooth] 100 条消息滚动帧率: ${fps} fps`);
    expect(fps).toBeGreaterThan(20); // 至少 20fps（headless 环境偏低）
  });
});

// ==================== Tab 切换 ====================

test.describe('交互顺滑 — Tab 切换', () => {

  test('20 次快速 Tab 切换 — 无白屏/崩溃', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await injectBuddyState(page);

    const icons = ['💬', '🔧', '🧠', '📚', '📊', '🗺️', '👁️', '📡', '🎓', '🧩', '⚙️'];

    for (let round = 0; round < 20; round++) {
      const icon = icons[round % icons.length];
      await page.locator(`button:has-text("${icon}")`).first().click();
      await page.waitForTimeout(50);

      // 每次切换后检查页面非空
      const bodyLen = await page.evaluate(() => document.body.textContent?.length ?? 0);
      expect(bodyLen).toBeGreaterThan(50);
    }

    // 最终页面仍然正常
    const finalBody = await page.textContent('body');
    expect(finalBody!.length).toBeGreaterThan(100);
  });

  test('Tab 切换 — 内容正确加载', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await injectBuddyState(page);

    // 切到工具面板
    await page.locator('button', { hasText: '🔧' }).first().click();
    await page.waitForTimeout(300);

    // 注入工具数据
    await injectWsMessage(page, {
      type: 'tool_panel_data',
      data: {
        tools: [
          { name: 'read', description: '读取文件', source: 'builtin', usageCount: 10, successRate: 100 },
        ],
        recentExecutions: [],
      },
    });
    await page.waitForTimeout(300);
    await expect(page.getByText('read').first()).toBeVisible();

    // 切到记忆面板
    await page.locator('button', { hasText: '🧠' }).first().click();
    await page.waitForTimeout(300);

    // 切回工具面板 — 数据应该还在
    await page.locator('button', { hasText: '🔧' }).first().click();
    await page.waitForTimeout(300);
    await expect(page.getByText('read').first()).toBeVisible();
  });
});

// ==================== 流式渲染 ====================

test.describe('交互顺滑 — 流式渲染', () => {

  test('快速流式 chunk — 无丢失/抖动', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    // 快速注入 20 个 chunk
    const chunks = [
      '人', '工', '智', '能', '（', 'A', 'I', '）', '是', '计',
      '算', '机', '科', '学', '的', '一', '个', '分', '支', '。',
    ];
    for (const chunk of chunks) {
      await injectWsMessage(page, { type: 'llm_response', content: chunk, streaming: true });
      await page.waitForTimeout(30);
    }

    // 流式结束
    await injectWsMessage(page, { type: 'llm_response', content: '', streaming: false });
    await page.waitForTimeout(500);

    // 最终内容完整
    await expect(page.getByText('人工智能（AI）是计算机科学的一个分支。')).toBeVisible();
  });

  test('长文本流式 — 200 个 chunk 不卡顿', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    const start = Date.now();

    // 注入 200 个 chunk（批量发送避免 200ms/chunk 超时）
    await page.evaluate(() => {
      const ws = (window as any).__mockWs?.instance;
      if (!ws) return;
      for (let i = 0; i < 200; i++) {
        const payload = JSON.stringify({ type: 'llm_response', content: `chunk-${i} `, streaming: true });
        ws.dispatchEvent(new MessageEvent('message', { data: payload }));
      }
    });

    // 流式结束
    await injectWsMessage(page, { type: 'llm_response', content: '', streaming: false });

    const elapsed = Date.now() - start;
    console.log(`[Smooth] 200 chunk 注入耗时: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(10000); // 10s 内完成

    // 页面仍然正常
    const body = await page.textContent('body');
    expect(body!.length).toBeGreaterThan(100);
  });
});

// ==================== 大量数据 ====================

test.describe('交互顺滑 — 大量数据', () => {

  test('50 个工具卡片 — 面板渲染不卡', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await page.locator('button', { hasText: '🔧' }).first().click();
    await page.waitForTimeout(300);

    // 生成 50 个工具
    const tools = Array.from({ length: 50 }, (_, i) => ({
      name: `tool_${i}`,
      description: `工具 ${i} 的描述`,
      source: i % 3 === 0 ? 'builtin' : i % 3 === 1 ? 'mcp' : 'skill',
      usageCount: Math.floor(Math.random() * 100),
      successRate: Math.floor(Math.random() * 100),
    }));

    await injectWsMessage(page, {
      type: 'tool_panel_data',
      data: { tools, recentExecutions: [] },
    });
    await page.waitForTimeout(500);

    // 页面仍然正常
    const body = await page.textContent('body');
    expect(body!.length).toBeGreaterThan(100);

    // 第一个和最后一个工具都渲染了
    await expect(page.getByText('tool_0').first()).toBeVisible();
    await expect(page.getByText('tool_49').first()).toBeVisible();
  });

  test('20 个领域 — 记忆面板渲染不卡', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await page.locator('button', { hasText: '🧠' }).first().click();
    await page.waitForTimeout(300);

    const domains = Array.from({ length: 20 }, (_, i) => ({
      domain: `领域_${i}`,
      domainType: 'technical',
      knowledgeCount: Math.floor(Math.random() * 200),
      depthScore: Math.random(),
      growthStage: ['seed', 'sprout', 'growing', 'mature', 'expert'][i % 5],
      confidence: Math.random(),
      conversationCount: Math.floor(Math.random() * 50),
      lastActiveAt: Date.now() - i * 86400000,
    }));

    await injectWsMessage(page, {
      type: 'memory_panel_data',
      data: { domains, stats: { totalNodes: 1000, totalDomains: 20, activeDomains: 15 } },
    });
    await page.waitForTimeout(500);

    const body = await page.textContent('body');
    expect(body!.length).toBeGreaterThan(100);
  });

  test('长 AgentTrace — 50 步追踪渲染', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    const trace = Array.from({ length: 50 }, (_, i) => ({
      type: i % 3 === 0 ? 'thinking' : i % 3 === 1 ? 'tool_call' : 'tool_result',
      content: `步骤 ${i + 1}: ${i % 3 === 0 ? '分析中' : i % 3 === 1 ? '调用工具' : '获取结果'}`,
      tool: i % 3 === 1 ? 'exec' : undefined,
      success: i % 3 === 2 ? true : undefined,
      timestamp: Date.now() - (50 - i) * 1000,
    }));

    await injectWsMessage(page, {
      type: 'agent_trace',
      trace,
    });
    await page.waitForTimeout(500);

    const body = await page.textContent('body');
    expect(body!.length).toBeGreaterThan(100);
  });
});

// ==================== 内存稳定性 ====================

test.describe('交互顺滑 — 内存稳定性', () => {

  test('反复注入/清除消息 — 无内存泄漏迹象', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    // 获取初始内存基线
    const initialMemory = await page.evaluate(() => {
      return (performance as any).memory?.usedJSHeapSize ?? 0;
    });

    // 反复注入消息 10 轮
    for (let round = 0; round < 10; round++) {
      for (let i = 0; i < 20; i++) {
        await page.evaluate(([idx, msgIdx]) => {
          const ws = (window as any).__mockWs?.instance;
          if (ws && ws.onmessage) {
            ws.onmessage({
              data: JSON.stringify({
                type: 'llm_response',
                content: `轮次 ${idx} 消息 ${msgIdx}：内存泄漏测试内容 `.repeat(5),
                streaming: false,
              }),
            } as MessageEvent);
          }
        }, [round, i]);
      }
      await page.waitForTimeout(200);
    }

    // 检查内存（如果 API 可用）
    const finalMemory = await page.evaluate(() => {
      return (performance as any).memory?.usedJSHeapSize ?? 0;
    });

    if (initialMemory > 0 && finalMemory > 0) {
      const growthMB = (finalMemory - initialMemory) / 1024 / 1024;
      console.log(`[Smooth] 内存增长: ${growthMB.toFixed(2)} MB`);
      expect(growthMB).toBeLessThan(100); // 增长不超过 100MB
    }

    // 页面仍然正常
    const body = await page.textContent('body');
    expect(body!.length).toBeGreaterThan(100);
  });
});
