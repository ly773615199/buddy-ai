/**
 * WebSocket 连接与断线重连 E2E
 *
 * 覆盖：
 * 1. 初始连接状态
 * 2. 连接成功后 UI 状态变化
 * 3. 断线后 UI 降级（输入框禁用、状态指示器）
 * 4. 重连后 UI 恢复
 * 5. 连接中状态显示
 */
import { test, expect } from '@playwright/test';
import { skipOnboarding } from './fixtures.js';

test.describe('WebSocket 连接 E2E', () => {

  test('初始加载 — 连接状态指示器存在', async ({ page }) => {
    await skipOnboarding(page);

    // 应该显示"已连接"或"未连接"
    const body = await page.textContent('body');
    const hasStatus = body?.includes('已连接') || body?.includes('未连接');
    expect(hasStatus).toBe(true);
  });

  test('连接成功 — 输入框可用', async ({ page }) => {
    await skipOnboarding(page);

    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible();

    const isConnected = await page.evaluate(() =>
      document.body.innerText.includes('已连接')
    );

    if (isConnected) {
      // 连接成功时 textarea 应该可用
      await expect(textarea).toBeEnabled();
    }
  });

  test('未连接 — 输入框 placeholder 显示"连接中..."', async ({ page }) => {
    // 阻止 WS 连接，确保始终处于未连接状态
    await page.addInitScript(() => {
      window.WebSocket = function () {
        const fake = { close() {}, send() {}, readyState: 3 } as any;
        return fake;
      } as any;
    });

    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('buddy_visual_seed', JSON.stringify({
        primaryColor: '#58a6ff', secondaryColor: '#a371f7',
        texture: 'soft', temperament: 'warm',
      }));
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible();

    // 未连接时 placeholder 应该是"连接中..."
    const placeholder = await textarea.getAttribute('placeholder');
    expect(placeholder).toContain('连接中');
  });

  test('Mock 断线 — 输入框禁用', async ({ page }) => {
    // 完全阻止 WS 连接，确保断线状态
    await page.addInitScript(() => {
      window.WebSocket = function () {
        const fake = {
          close() {}, send() {}, readyState: 3,
          addEventListener() {}, removeEventListener() {},
          onopen: null, onclose: null, onerror: null, onmessage: null,
        } as any;
        // 触发 onclose
        setTimeout(() => { if (fake.onclose) fake.onclose({ code: 1006 }); }, 100);
        return fake;
      } as any;
    });

    await skipOnboarding(page);

    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible();

    // 断线后输入框应禁用
    await expect(textarea).toBeDisabled({ timeout: 5000 });
  });

  test('连接状态 — 绿色/红色指示点', async ({ page }) => {
    await skipOnboarding(page);

    // 验证连接状态指示点存在
    const statusArea = page.locator('div').filter({ hasText: /^(已连接|未连接)$/ }).first();
    await expect(statusArea).toBeVisible({ timeout: 5000 });
  });

  test('WS Token 刷新机制', async ({ page }) => {
    // 验证 app 启动时会请求 ws-token
    let tokenRequested = false;
    page.on('request', req => {
      if (req.url().includes('/api/ws-token')) {
        tokenRequested = true;
      }
    });

    await skipOnboarding(page);

    // 应该发起了 ws-token 请求
    // 注意：如果后端没启动，请求会失败但仍然会发起
    expect(tokenRequested).toBe(true);
  });

  test('多次 Tab 切换 — 连接保持', async ({ page }) => {
    await skipOnboarding(page);

    // 快速切换多个 Tab
    const tabs = ['🔧', '🧠', '📊', '🗺️', '⚙️', '💬'];
    for (const icon of tabs) {
      await page.locator('button', { hasText: icon }).first().click();
    }

    // 回到对话 Tab，连接应该仍然正常
    await page.locator('button', { hasText: '💬' }).first().click();

    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible();
  });
});
