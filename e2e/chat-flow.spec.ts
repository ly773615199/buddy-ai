/**
 * 对话流程 E2E — UI 渲染测试
 *
 * 覆盖：
 * 1. 空消息状态（欢迎文案）
 * 2. 发送按钮状态（未连接/空输入时禁用）
 * 3. Enter 发送 / Shift+Enter 换行
 * 4. 各类 WS 消息渲染（llm_response / thinking / tool_call / error / bubble / evolution / achievement）
 * 5. 流式响应逐步拼接
 * 6. 多条消息顺序渲染
 *
 * 职责：纯 UI 渲染验证，通过 injectWsMessage 精确控制输入
 * 事件流测试（真实后端链路）已移至 real-llm.spec.ts
 */
import { test, expect } from '@playwright/test';
import { setupMockWS, injectWsMessage, skipOnboarding, waitForWSConnection } from './fixtures.js';

// ==================== 空状态 & 按钮 ====================

test.describe('对话流程 — 空状态与按钮', () => {

  test('空消息状态 — 显示欢迎文案', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);

    await expect(page.getByText('打个招呼吧！')).toBeVisible();
    await expect(page.getByText('试试：帮我列一下当前目录的文件')).toBeVisible();
    await expect(page.getByText('🐾').first()).toBeVisible();
  });

  test('发送按钮 — 未连接时禁用', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('buddy_visual_seed', JSON.stringify({
        primaryColor: '#58a6ff', secondaryColor: '#a371f7',
        texture: 'soft', temperament: 'warm',
      }));
    });
    await page.addInitScript(() => {
      window.WebSocket = function () { throw new Error('blocked'); } as any;
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const sendBtn = page.getByRole('button', { name: '发送' });
    await expect(sendBtn).toBeDisabled();
  });

  test('发送按钮 — 空输入时禁用', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    const textarea = page.locator('textarea').first();
    const sendBtn = page.getByRole('button', { name: '发送' });

    await expect(textarea).toBeVisible();
    await textarea.fill('');
    await expect(sendBtn).toBeDisabled();
  });

  test('输入文字后发送按钮可用', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    const textarea = page.locator('textarea').first();
    const sendBtn = page.getByRole('button', { name: '发送' });

    await textarea.fill('');
    await expect(sendBtn).toBeDisabled();

    await textarea.fill('你好');
    await expect(sendBtn).toBeEnabled();
  });

  test('Enter 键发送消息', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    const textarea = page.locator('textarea').first();
    await textarea.fill('Enter 发送测试');
    await textarea.press('Enter');

    await expect(page.getByText('Enter 发送测试')).toBeVisible();
  });

  test('Shift+Enter 换行不发送', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    const textarea = page.locator('textarea').first();
    await textarea.fill('第一行');
    await textarea.press('Shift+Enter');
    await textarea.type('第二行');

    const val = await textarea.inputValue();
    expect(val).toContain('第一行');
    expect(val).toContain('第二行');
  });
});

// ==================== 消息类型渲染 ====================

test.describe('对话流程 — 消息渲染', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
  });

  test('llm_response — 助手消息渲染', async ({ page }) => {
    await injectWsMessage(page, {
      type: 'llm_response',
      content: '你好！我是 Buddy，很高兴见到你 🐾',
      streaming: false,
    });

    await expect(page.getByText('你好！我是 Buddy，很高兴见到你 🐾')).toBeVisible();
  });

  test('流式响应 — 消息逐步拼接', async ({ page }) => {
    await injectWsMessage(page, { type: 'llm_response', content: '你好', streaming: true });
    await expect(page.getByText('你好')).toBeVisible();

    await injectWsMessage(page, { type: 'llm_response', content: '，世界！', streaming: true });
    await expect(page.getByText('你好，世界！')).toBeVisible();

    await injectWsMessage(page, { type: 'llm_response', content: '', streaming: false });
  });

  test('thinking — 思考中消息渲染', async ({ page }) => {
    // 后端 emit { type: 'thinking' } 无 message 字段，前端 fallback 到默认文案
    await injectWsMessage(page, { type: 'thinking' });
    await expect(page.getByText('🤔 让我看看...')).toBeVisible();
  });

  test('tool_call + tool_result — 工具调用消息渲染', async ({ page }) => {
    await injectWsMessage(page, {
      type: 'tool_call',
      tool: 'web_search',
      args: { query: '天气' },
    });
    await expect(page.getByText('web_search')).toBeVisible();

    await injectWsMessage(page, {
      type: 'tool_result',
      tool: 'web_search',
      success: true,
      preview: '今天晴天，25°C',
    });
    await expect(page.getByText('今天晴天，25°C')).toBeVisible();
  });

  test('error — 错误消息渲染', async ({ page }) => {
    await injectWsMessage(page, {
      type: 'error',
      message: 'API 调用失败，请检查配置',
    });

    await expect(page.getByText('❌ API 调用失败，请检查配置')).toBeVisible();
  });

  test('bubble — 引导气泡渲染', async ({ page }) => {
    await injectWsMessage(page, {
      type: 'bubble',
      text: '试试点击工具面板看看我有哪些能力！',
    });

    await expect(page.getByText('试试点击工具面板看看我有哪些能力！')).toBeVisible();
  });

  test('evolution — 进化消息渲染', async ({ page }) => {
    await injectWsMessage(page, { type: 'evolution', from: '孵化', to: '成长' });
    await expect(page.getByText('✨ 进化了！孵化 → 成长')).toBeVisible();
  });

  test('achievement — 成就消息渲染', async ({ page }) => {
    // 前端独有事件（后端无 achievement 事件源）
    await injectWsMessage(page, { type: 'achievement', name: '初次对话' });
    await expect(page.getByText('🏆 成就解锁：初次对话')).toBeVisible();
  });

  test('多条消息顺序渲染', async ({ page }) => {
    await injectWsMessage(page, { type: 'llm_response', content: '第一条消息', streaming: false });
    await expect(page.getByText('第一条消息')).toBeVisible();

    await injectWsMessage(page, { type: 'llm_response', content: '第二条消息', streaming: false });
    await expect(page.getByText('第二条消息')).toBeVisible();

    await injectWsMessage(page, { type: 'llm_response', content: '第三条消息', streaming: false });
    await expect(page.getByText('第三条消息')).toBeVisible();
  });
});
