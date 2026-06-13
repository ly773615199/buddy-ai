/**
 * 活动面板 E2E — 数据渲染覆盖
 *
 * 覆盖：
 * 1. 时间线子标签 — 热力图 + 每日活动列表
 * 2. 统计子标签 — 使用统计卡片 + Token 估算 + 折线图
 * 3. 梦境子标签 — 梦境日志列表
 * 4. 传感子标签 — 环境信息 + 传感器数据
 * 5. 子标签切换
 * 6. 空数据状态
 */
import { test, expect } from '@playwright/test';
import { skipOnboarding, setupMockWS, injectWsMessage, injectBuddyState, waitForWSConnection } from './fixtures.js';

/** 导航到活动面板 */
async function goToActivity(page: import('@playwright/test').Page) {
  await page.locator('button', { hasText: '📊' }).first().click();
  await page.waitForTimeout(300);
}

// ==================== 测试用例 ====================

test.describe('活动面板 — 子标签切换', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
  });

  test('六个子标签全部可见且可切换', async ({ page }) => {
    await goToActivity(page);

    const subTabs = ['时间线', '统计', '调度器', '梦境', '传感器', '感知'];
    for (const label of subTabs) {
      const btn = page.locator('button', { hasText: label }).first();
      await expect(btn).toBeVisible();
      await btn.click();
      // UI transition
    }
  });

  test('切换子标签后内容变化', async ({ page }) => {
    await goToActivity(page);

    // 切到统计
    await page.locator('button', { hasText: '统计' }).first().click();
    // UI transition
    const statsBody = await page.textContent('body');

    // 切到梦境
    await page.locator('button', { hasText: '梦境' }).first().click();
    // UI transition
    const dreamsBody = await page.textContent('body');

    // 内容应该不同
    expect(statsBody).not.toBe(dreamsBody);
  });
});

test.describe('活动面板 — 时间线', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
  });

  test('有数据时显示热力图和活动列表', async ({ page }) => {
    await goToActivity(page);
    await injectBuddyState(page);

    // 默认在时间线子标签
    // render cycle

    // 验证活动列表中的日期
    await expect(page.getByText('2026-04-23')).toBeVisible();
    await expect(page.getByText('2026-04-22')).toBeVisible();

    // 验证消息和工具调用计数（使用 exact 匹配避免 strict mode）
    await expect(page.getByText('💬 10')).toBeVisible();
    await expect(page.getByText('🔧 4', { exact: true })).toBeVisible();
  });

  test('无数据时显示空状态', async ({ page }) => {
    await goToActivity(page);
    await injectBuddyState(page, {
      petStats: { totalMessages: 0, totalToolCalls: 0, totalDays: 0, consecutiveDays: 0, dailyActivity: [] },
    });
    // render cycle

    await expect(page.getByText('暂无活动记录')).toBeVisible();
  });
});

test.describe('活动面板 — 统计', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
  });

  test('统计卡片显示正确数值', async ({ page }) => {
    await goToActivity(page);
    await injectBuddyState(page);

    await page.locator('button', { hasText: '统计' }).first().click();
    // render cycle

    // 验证统计数字（使用 exact 避免 strict mode）
    await expect(page.getByText('156', { exact: true })).toBeVisible();  // 总消息
    await expect(page.getByText('42', { exact: true })).toBeVisible();   // 工具调用
    await expect(page.getByText('14', { exact: true })).toBeVisible();   // 活跃天数
    await expect(page.getByText('3', { exact: true })).toBeVisible();    // 连续天数
  });

  test('Token 估算和费用显示', async ({ page }) => {
    await goToActivity(page);
    await injectBuddyState(page);

    await page.locator('button', { hasText: '统计' }).first().click();
    // render cycle

    // 预估 Tokens: 156 * 500 = 78,000
    await expect(page.getByText('78,000')).toBeVisible();

    // 预估费用应该存在
    const body = await page.textContent('body');
    expect(body).toContain('预估费用');
  });

  test('无数据时显示空状态', async ({ page }) => {
    await goToActivity(page);
    await injectBuddyState(page, { petStats: null });
    // UI transition

    await page.locator('button', { hasText: '统计' }).first().click();
    // render cycle

    await expect(page.getByText('暂无统计数据')).toBeVisible();
  });
});

test.describe('活动面板 — 梦境', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
  });

  test('有梦境日志时渲染列表', async ({ page }) => {
    await goToActivity(page);

    // 注入梦境数据（前端独有事件，后端不 emit）
    await injectWsMessage(page, {
      type: 'dream_logs',
      logs: [
        { journal: '今天学习了关于 TypeScript 泛型的知识，用户问了一个很有深度的问题...', timestamp: Date.now() - 3600000 },
        { journal: '回顾了之前的对话，发现用户对编程模式很有兴趣，下次可以深入讨论设计模式。', timestamp: Date.now() - 7200000 },
      ],
    });
    // UI transition

    await page.locator('button', { hasText: '梦境' }).first().click();
    await page.waitForTimeout(500); // 等待 React 渲染梦境列表

    // 验证梦境日志内容（dev 模式下 {{count}} 占位符不替换）
    await expect(page.getByText(/学习了关于 TypeScript/)).toBeVisible();
    await expect(page.getByText(/回顾了之前的对话/)).toBeVisible();
  });

  test('无梦境时显示空状态', async ({ page }) => {
    await goToActivity(page);
    await page.locator('button', { hasText: '梦境' }).first().click();
    // render cycle

    await expect(page.getByText('还没有梦境记录')).toBeVisible();
  });
});

test.describe('活动面板 — 传感', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
  });

  test('环境信息默认显示', async ({ page }) => {
    await goToActivity(page);
    await page.locator('button', { hasText: '传感器' }).first().click();

    // 验证环境信息项
    await expect(page.getByText('网络')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('语言')).toBeVisible();
    await expect(page.getByText('💻 平台')).toBeVisible();
    await expect(page.getByText('屏幕')).toBeVisible();
    await expect(page.getByText('时区')).toBeVisible();
  });

  test('刷新传感器数据按钮存在', async ({ page }) => {
    await goToActivity(page);
    await page.locator('button', { hasText: '传感器' }).first().click();

    await expect(page.getByText('刷新传感器数据')).toBeVisible({ timeout: 5000 });
  });

  test('传感器数据注入后渲染', async ({ page }) => {
    await goToActivity(page);

    // 注入传感器数据
    // 前端独有事件（App.tsx 自行 emit，后端不发）
    await injectWsMessage(page, {
      type: 'sensor_update',
      data: {
        location: { lat: 39.9042, lng: 116.4074, accuracy: 10 },
        motion: { x: 0.1, y: -9.8, z: 0.3, state: 'still' },
        environment: { light: 350, battery: 85, online: true },
      },
    });

    await page.locator('button', { hasText: '传感器' }).first().click();

    // 验证传感器数据渲染
    await expect(page.getByText(/39\.904/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/116\.407/)).toBeVisible();
  });
});
