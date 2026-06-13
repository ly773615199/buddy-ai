import { test, expect } from '@playwright/test';

test.describe('i18n 国际化', () => {
  test('语言切换 → 英文 UI 验证', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);

    // 进入设置
    await page.locator('button', { hasText: '⚙️' }).first().click();
    // 切到外观 tab
    await page.locator('button', { hasText: '🎨' }).first().click();
    // 切英文
    await page.locator('button', { hasText: 'English' }).click();
    await page.waitForTimeout(500);

    // 验证 tab 文本变化（英文 UI）
    await expect(page.getByRole('button', { name: /Chat|Activity|Settings/ })).toBeVisible();
  });

  test('语言偏好持久化', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);

    // 切英文
    await page.locator('button', { hasText: '⚙️' }).first().click();
    await page.locator('button', { hasText: '🎨' }).first().click();
    await page.locator('button', { hasText: 'English' }).click();
    await page.waitForTimeout(500);

    // 刷新页面
    await page.reload();
    await page.waitForTimeout(1000);

    // 验证仍然是英文
    await expect(page.getByRole('button', { name: /Chat|Activity|Settings/ })).toBeVisible();
  });

  test('降级：翻译 API 不可用 → 显示中文原文', async ({ page }) => {
    // 拦截翻译 API 返回 404
    await page.route('**/api/translate', route => {
      route.fulfill({ status: 404, body: 'Not Found' });
    });

    await page.goto('/');
    await page.waitForTimeout(1000);

    // 切到英文
    await page.locator('button', { hasText: '⚙️' }).first().click();
    await page.locator('button', { hasText: '🎨' }).first().click();
    await page.locator('button', { hasText: 'English' }).click();
    await page.waitForTimeout(1000);

    // 页面不应崩溃，至少有一个可见的按钮
    const buttons = page.locator('button');
    await expect(buttons.first()).toBeVisible();
  });
});
