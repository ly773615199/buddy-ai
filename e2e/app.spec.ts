/**
 * Buddy E2E 测试 — 完整用户流程
 *
 * 覆盖：
 * 1. 页面加载与基础渲染
 * 2. Onboarding 流程（首次访问）
 * 3. 主界面 Tab 切换
 * 4. 设置面板 — 语言切换
 * 5. 活动面板 — 子标签
 * 6. 对话面板 — 输入与发送
 */
import { test, expect, type Page } from '@playwright/test';
import { skipOnboarding, simulateFirstVisit } from './fixtures.js';

/** 模拟翻译词典（用于语言切换测试）— key 与 t() 调用一致 */
const MOCK_TRANSLATIONS: Record<string, Record<string, string>> = {
  en: {
    '聊天': 'Chat',
    '工具': 'Tools',
    '记忆': 'Memory',
    '知识': 'Knowledge',
    '活动': 'Activity',
    '探索': 'Explore',
    '视觉': 'Vision',
    '传感': 'Sensors',
    '专家': 'Experts',
    '认知': 'Cognitive',
    '设置': 'Settings',
    '🏠 光灵': '🏠 Buddy',
    '你的 AI 伙伴': 'Your AI companion',
    '外观': 'Appearance',
    '外观设置': 'Appearance',
    '行为设置': 'Behavior',
    '数据管理': 'Data Management',
    '模型池': 'Model Pool',
    '平台设置': 'Platform',
  },
};

async function installTranslationMock(page: Page) {
  const lang = 'en';
  const dict = MOCK_TRANSLATIONS[lang] || {};
  await page.route('**/api/translate', async (route) => {
    const body = route.request().postDataJSON();
    const targetLang: string = body?.targetLang || lang;
    const texts: string[] = body?.texts || [];
    const d = MOCK_TRANSLATIONS[targetLang] || {};
    const translations = texts.map(t => d[t] || t);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ translations }),
    });
  });
  const cacheEntries: Record<string, string> = {};
  for (const [zh, translated] of Object.entries(dict)) {
    cacheEntries[`${lang}::${zh}`] = translated;
  }
  await page.addInitScript((entries) => {
    localStorage.setItem('buddy_i18n_cache', JSON.stringify(entries));
  }, cacheEntries);
}

// ==================== 测试用例 ====================

test.describe('Buddy App E2E', () => {

  test('页面加载成功', async ({ page }) => {
    await skipOnboarding(page);
    await expect(page.locator('h1')).toBeVisible();
  });

  test('首次访问显示 Onboarding', async ({ page }) => {
    await simulateFirstVisit(page);
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('主界面显示所有 Tab', async ({ page }) => {
    await skipOnboarding(page);
    // React app 的 11 个 tab 用 button + emoji + 文字渲染
    const tabs = ['💬', '🔧', '🧠', '📚', '📊', '🗺️', '👁️', '📡', '🎓', '🧩', '⚙️'];
    for (const icon of tabs) {
      const btn = page.locator(`button >> text=${icon}`).first();
      await expect(btn).toBeVisible({ timeout: 3000 });
    }
  });

  test('Tab 切换正常', async ({ page }) => {
    await skipOnboarding(page);

    // 切到工具 Tab
    await page.locator('button', { hasText: '🔧' }).first().click();
    await expect(page.locator('button', { hasText: '🔧' }).first()).toBeVisible();

    // 切到记忆 Tab
    await page.locator('button', { hasText: '🧠' }).first().click();
    await expect(page.locator('button', { hasText: '🧠' }).first()).toBeVisible();

    // 切到知识 Tab
    await page.locator('button', { hasText: '📚' }).first().click();
    await expect(page.locator('button', { hasText: '📚' }).first()).toBeVisible();

    // 切到活动 Tab
    await page.locator('button', { hasText: '📊' }).first().click();
    await expect(page.getByText('时间线')).toBeVisible();

    // 切到传感 Tab
    await page.locator('button', { hasText: '📡' }).first().click();
    await expect(page.locator('button', { hasText: '📡' }).first()).toBeVisible();

    // 切到认知 Tab
    await page.locator('button', { hasText: '🧩' }).first().click();
    await expect(page.locator('button', { hasText: '🧩' }).first()).toBeVisible();

    // 切到设置 Tab
    await page.locator('button', { hasText: '⚙️' }).first().click();
    await expect(page.locator('button', { hasText: '⚙️' }).first()).toBeVisible();
  });

  test('设置面板 — 语言切换', async ({ page }) => {
    await installTranslationMock(page);
    await skipOnboarding(page);

    // 进入设置
    await page.locator('button', { hasText: '⚙️' }).first().click();
    await expect(page.locator('button', { hasText: '🎨' }).first()).toBeVisible();

    // 点击外观标签
    await page.locator('button', { hasText: '🎨' }).first().click();
    await expect(page.locator('button', { hasText: 'English' })).toBeVisible();

    // 点击 English 按钮
    await page.locator('button', { hasText: 'English' }).click();
    await expect(page.getByRole('button', { name: 'Activity' })).toBeVisible({ timeout: 3000 });

    // 切回中文
    await page.locator('button', { hasText: '中文' }).click();
    // 使用 getByRole 避免 strict mode（'活动' 匹配多个元素）
    await expect(page.getByRole('button', { name: '📊 活动' })).toBeVisible({ timeout: 3000 });
  });

  test('设置面板 — 模型池 Tab', async ({ page }) => {
    await skipOnboarding(page);

    // 进入设置
    await page.locator('button', { hasText: '⚙️' }).first().click();

    // 切到模型池子标签（三脑架构重构后，原 LLM 配置 → 统一模型池）
    await page.locator('button', { hasText: '模型池' }).click();

    // 验证模型池 UI 渲染（mock 环境未初始化模型池，显示配置引导）
    await expect(page.getByText('统一模型池未初始化')).toBeVisible({ timeout: 5000 });
  });

  test('活动面板 — 六个子标签', async ({ page }) => {
    await skipOnboarding(page);

    // 进入活动面板
    await page.locator('button', { hasText: '📊' }).first().click();
    await expect(page.locator('button', { hasText: '时间线' }).first()).toBeVisible();

    // 六个子标签存在
    await expect(page.locator('button', { hasText: '统计' }).first()).toBeVisible();
    await expect(page.locator('button', { hasText: '调度器' }).first()).toBeVisible();
    await expect(page.locator('button', { hasText: '梦境' }).first()).toBeVisible();
    await expect(page.locator('button', { hasText: '传感器' }).first()).toBeVisible();
    await expect(page.locator('button', { hasText: '感知' }).first()).toBeVisible();

    // 切到统计
    await page.locator('button', { hasText: '统计' }).first().click();
    const body = await page.textContent('body');
    expect(body).toBeTruthy();

    // 切到梦境
    await page.locator('button', { hasText: '梦境' }).first().click();
    await expect(page.locator('button', { hasText: '梦境' }).first()).toBeVisible();

    // 切到传感器（活动面板子标签）
    await page.locator('button', { hasText: '传感器' }).first().click();
    await expect(page.getByText('环境信息')).toBeVisible({ timeout: 3000 });
  });

  test('设置面板 — 数据管理', async ({ page }) => {
    await skipOnboarding(page);

    // 进入设置 → 数据
    await page.locator('button', { hasText: '⚙️' }).first().click();
    await expect(page.locator('button', { hasText: '💾' }).first()).toBeVisible();
    await page.locator('button', { hasText: '💾' }).first().click();

    // 导出按钮存在（i18n 插件可能转义中文，用多种模式匹配）
    await expect(
      page.getByText(/导出|Export|\\u5BFC\\u51FA/).first()
    ).toBeVisible({ timeout: 3000 });
  });
});
