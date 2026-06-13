/**
 * Onboarding E2E — 完整首次配置流程
 */
import { test, expect, type Page } from '@playwright/test';

test.describe('Onboarding 流程', () => {

  test('完整流程：颜色 → 质感 → 气质 → LLM → 进入主界面', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    // Step 1: 选择颜色（圆形按钮，title=颜色名）
    await expect(page.locator('h2')).toContainText('选择主色调');
    await page.locator('button[title="蓝"]').click({ force: true });
    await page.locator('button', { hasText: '下一步' }).click();

    // Step 2: 选择质感
    await expect(page.locator('h2')).toContainText('选择质感');
    await page.locator('button', { hasText: '柔软' }).click();
    await page.locator('button', { hasText: '下一步' }).click();

    // Step 3: 选择气质
    await expect(page.locator('h2')).toContainText('选择气质');
    await page.locator('button', { hasText: '温暖' }).click();
    await page.locator('button', { hasText: '下一步' }).click();

    // Step 4: LLM 配置
    await expect(page.locator('h2')).toContainText('连接大脑');
    const apiKeyInput = page.locator('input[type="password"]');
    await apiKeyInput.fill('sk-test-key-12345');
    await page.locator('button', { hasText: '开启旅程' }).click();

    // 验证：进入主界面
    await expect(page.locator('h1')).toBeVisible({ timeout: 5000 });
    const seed = await page.evaluate(() => localStorage.getItem('buddy_visual_seed'));
    expect(seed).toBeTruthy();
    const parsed = JSON.parse(seed!);
    expect(parsed.primaryColor).toBeTruthy();
    expect(parsed.texture).toBe('soft');
    expect(parsed.temperament).toBe('warm');
  });

  test('返回按钮可回到上一步', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(page.locator('h2')).toContainText('选择主色调');
    await page.locator('button[title="蓝"]').click({ force: true });
    await page.locator('button', { hasText: '下一步' }).click();
    await expect(page.locator('h2')).toContainText('选择质感');

    await page.locator('button', { hasText: '上一步' }).click();
    await expect(page.locator('h2')).toContainText('选择主色调');
  });

  test('POST /api/model-pool/providers 包含 model 字段', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    // 拦截 POST /api/model-pool/providers，捕获请求体
    let postBody: Record<string, unknown> | null = null;
    await page.route('**/api/model-pool/providers', async (route) => {
      if (route.request().method() === 'POST') {
        postBody = JSON.parse(route.request().postData() ?? '{}');
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"modelCount":3}' });
      } else {
        await route.continue();
      }
    });
    // 拦截 /api/ws-token（Onboarding 先获取 token）
    await page.route('**/api/ws-token', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"token":"test"}' });
    });

    // 走完 Onboarding 流程
    await page.locator('button[title="蓝"]').click({ force: true });
    await page.locator('button', { hasText: '下一步' }).click();
    await page.locator('button', { hasText: '柔软' }).click();
    await page.locator('button', { hasText: '下一步' }).click();
    await page.locator('button', { hasText: '温暖' }).click();
    await page.locator('button', { hasText: '下一步' }).click();

    // LLM 步骤：填入 API Key（DeepSeek 默认选中）
    await page.locator('input[type="password"]').fill('sk-test-key-12345');
    await page.locator('button', { hasText: '开启旅程' }).click();

    // 等待 POST 请求完成
    await page.waitForTimeout(2000);

    // 验证 POST body
    expect(postBody).toBeTruthy();
    expect(postBody!.id).toBe('deepseek');
    expect(postBody!.type).toBe('deepseek');
    // model 字段已不再由前端 Onboarding 发送（后端默认 model=type）
    expect(postBody!.model).toBeUndefined();
    expect(postBody!.apiKey).toBe('sk-test-key-12345');
  });

  test('未选择质感时"下一步"禁用', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(page.locator('h2')).toContainText('选择主色调');
    await page.locator('button[title="蓝"]').click({ force: true });
    await page.locator('button', { hasText: '下一步' }).click();

    const nextBtn = page.locator('button', { hasText: '下一步' });
    await expect(nextBtn).toBeDisabled();
  });
});
