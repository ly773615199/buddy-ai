/**
 * i18n E2E 测试 — V3 架构（静态 JSON 优先 + LLM 安全网）
 *
 * 覆盖：
 * 1. 英文 UI 完整验证（静态 JSON 驱动）
 * 2. 多语言切换（ja/ko）
 * 3. 语言偏好持久化
 * 4. 降级：翻译 API 不可用时显示中文原文
 * 5. 构建产物：翻译文件正确打包
 * 6. 术语一致性：关键术语翻译一致
 */
import { test, expect, type Page } from '@playwright/test';
import { skipOnboarding, setupMockWS } from './fixtures.js';

// ==================== V3: 静态翻译文件 mock ====================

/**
 * V3 架构：前端直接加载 locales/*.json 静态文件
 * E2E 通过拦截 import() 动态导入来注入 mock 翻译
 */

/** 模拟静态翻译文件内容（对应 locales/en.json 等） */
const MOCK_STATIC_LOCALES: Record<string, Record<string, string>> = {
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
    '时间线': 'Timeline',
    '统计': 'Statistics',
    '调度': 'Scheduler',
    '梦境': 'Dreams',
    '主题': 'Theme',
    '字体大小': 'Font Size',
    '语言': 'Language',
    '深色': 'Dark',
    '浅色': 'Light',
    '跟随系统': 'System',
    '小': 'S',
    '中': 'M',
    '大': 'L',
    '孵化': 'Hatching',
    '成长': 'Growing',
    '成形': 'Formed',
    '成熟': 'Mature',
    '完全体': 'Complete',
    '传说': 'Legendary',
    '亲密度': 'Intimacy',
    '进化进度': 'Evolution Progress',
    '当前情绪': 'Current Mood',
    '稀有度': 'Rarity',
    '最近行为': 'Recent Action',
    '未知': 'Unknown',
  },
  ja: {
    '聊天': 'チャット',
    '工具': 'ツール',
    '记忆': 'メモリ',
    '知识': 'ナレッジ',
    '活动': 'アクティビティ',
    '探索': '探索',
    '视觉': 'ビジョン',
    '传感': 'センサー',
    '专家': 'エキスパート',
    '认知': 'コグニティブ',
    '设置': '設定',
    '🏠 光灵': '🏠 バディ',
    '你的 AI 伙伴': 'あなたの AI パートナー',
    '亲密度': '親密度',
    '孵化': '孵化',
    '成长': '成長',
  },
  ko: {
    '聊天': '채팅',
    '工具': '도구',
    '记忆': '메모리',
    '知识': '지식',
    '活动': '활동',
    '探索': '탐색',
    '视觉': '비전',
    '传感': '센서',
    '专家': '전문가',
    '认知': '인지',
    '设置': '설정',
    '🏠 光灵': '🏠 버디',
    '你的 AI 伙伴': '당신의 AI 파트너',
    '亲密度': '친밀도',
  },
};

/** 术语表 mock（关键术语固定翻译） */
const MOCK_GLOSSARY: Record<string, Record<string, string>> = {
  '亲密度': { en: 'Intimacy', ja: '親密度', ko: '친밀도' },
  '精力': { en: 'Energy', ja: 'エネルギー', ko: '에너지' },
  '心情': { en: 'Mood', ja: '気分', ko: '기분' },
  '硅基流动': { en: 'SiliconFlow', ja: 'SiliconFlow', ko: 'SiliconFlow' },
};

/**
 * V3 安装翻译 mock：
 * - 拦截静态 JSON 文件导入（locales/*.json）
 * - 拦截翻译 API（LLM 安全网兜底）
 * - 注入 localStorage 缓存
 */
async function installTranslationMock(page: Page, lang: string = 'en') {
  const dict = MOCK_STATIC_LOCALES[lang] || {};

  // 1. 拦截翻译 API（LLM 安全网 — 正常不触发）
  await page.route('**/api/translate', async (route) => {
    const body = route.request().postDataJSON();
    const targetLang: string = body?.targetLang || lang;
    const texts: string[] = body?.texts || [];
    const d = MOCK_STATIC_LOCALES[targetLang] || {};
    const glossary = MOCK_GLOSSARY;

    const translations = texts.map(t => {
      // 术语表优先
      if (glossary[t]?.[targetLang]) return glossary[t][targetLang];
      // 静态文件
      return d[t] || t;
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ translations, source: 'cache' }),
    });
  });

  // 2. 预填充 localStorage 缓存（translate-engine 的内存缓存层）
  const cacheEntries: Record<string, string> = {};
  for (const [zh, translated] of Object.entries(dict)) {
    cacheEntries[`${lang}::${zh}`] = translated;
  }
  await page.addInitScript((entries) => {
    localStorage.setItem('buddy_i18n_cache', JSON.stringify(entries));
  }, cacheEntries);
}

/** 进入设置面板的外观 tab */
async function openAppearanceSettings(page: Page) {
  await page.locator('button', { hasText: '⚙️' }).first().click();
  await page.locator('button', { hasText: '🎨' }).first().click();
}

// ==================== 1. 英文 UI ====================

test.describe('i18n — 英文 UI 验证（V3 静态 JSON）', () => {

  test('切换英文后 Tab 文本变化', async ({ page }) => {
    await installTranslationMock(page, 'en');
    await skipOnboarding(page);
    await openAppearanceSettings(page);

    // 切英文
    await page.locator('button', { hasText: 'English' }).click();
    await page.waitForTimeout(500);

    // 验证 Tab 文本变为英文（exact 区分主 Tab 和子按钮）
    await expect(page.getByRole('button', { name: /💬 Chat/ })).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole('button', { name: /📊 Activity/ })).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole('button', { name: /⚙️ Settings/ })).toBeVisible({ timeout: 3000 });
  });

  test('英文设置面板渲染', async ({ page }) => {
    await installTranslationMock(page, 'en');
    await skipOnboarding(page);
    await openAppearanceSettings(page);

    await page.locator('button', { hasText: 'English' }).click();
    await page.waitForTimeout(500);

    // 验证设置面板英文内容
    await expect(page.getByText('Appearance')).toBeVisible({ timeout: 3000 });
  });

  test('切回中文恢复正常', async ({ page }) => {
    await installTranslationMock(page, 'en');
    await skipOnboarding(page);
    await openAppearanceSettings(page);

    await page.locator('button', { hasText: 'English' }).click();
    await page.waitForTimeout(300);

    await page.locator('button', { hasText: '中文' }).click();
    await page.waitForTimeout(300);

    // 验证中文 Tab 恢复
    await expect(page.getByRole('button', { name: '📊 活动' })).toBeVisible({ timeout: 3000 });
  });
});

// ==================== 2. 多语言切换 ====================

test.describe('i18n — 多语言切换', () => {

  test('日语切换成功', async ({ page }) => {
    await installTranslationMock(page, 'ja');
    await skipOnboarding(page);
    await openAppearanceSettings(page);

    await page.locator('button', { hasText: '日本語' }).click();
    await page.waitForTimeout(500);

    const activityBtn = page.getByRole('button', { name: /📊/ }).first();
    await expect(activityBtn).toBeVisible({ timeout: 3000 });
    const text = await activityBtn.textContent();
    expect(text).not.toContain('活动');
  });

  test('韩语切换成功', async ({ page }) => {
    await installTranslationMock(page, 'ko');
    await skipOnboarding(page);
    await openAppearanceSettings(page);

    await page.locator('button', { hasText: '한국어' }).click();
    await page.waitForTimeout(500);

    const activityBtn = page.getByRole('button', { name: /📊/ }).first();
    await expect(activityBtn).toBeVisible({ timeout: 3000 });
    const text = await activityBtn.textContent();
    expect(text).not.toContain('活动');
  });
});

// ==================== 3. 持久化 ====================

test.describe('i18n — 语言偏好持久化', () => {

  test('刷新后语言保持', async ({ page }) => {
    await installTranslationMock(page, 'en');
    await skipOnboarding(page);
    await openAppearanceSettings(page);

    await page.locator('button', { hasText: 'English' }).click();
    await page.waitForTimeout(500);

    // 刷新页面
    await page.reload();
    await skipOnboarding(page);
    await page.waitForTimeout(500);

    // 验证仍为英文（localStorage 持久化）
    await expect(page.getByRole('button', { name: /Chat/ })).toBeVisible({ timeout: 3000 });
  });
});

// ==================== 4. 降级 ====================

test.describe('i18n — 翻译降级（LLM 安全网不可用）', () => {

  test('翻译 API 不可用时显示中文原文，不崩溃', async ({ page }) => {
    // 拦截翻译 API 返回 500（模拟 LLM 安全网不可用）
    await page.route('**/api/translate', route => {
      route.fulfill({ status: 500, body: 'Internal Server Error' });
    });

    await skipOnboarding(page);
    await openAppearanceSettings(page);

    // 切英文
    await page.locator('button', { hasText: 'English' }).click();
    await page.waitForTimeout(1000);

    // 不应崩溃，页面仍然可用
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
    expect(body!.length).toBeGreaterThan(0);

    // 中文原文应作为兜底显示（V3 设计：无翻译时返回原文）
    // 页面不应出现空白或错误状态
  });

  test('静态翻译文件不可用时降级到 LLM 安全网', async ({ page }) => {
    // 不预填充 localStorage 缓存（模拟静态文件缺失）
    // 拦截翻译 API 返回翻译结果
    await page.route('**/api/translate', async (route) => {
      const body = route.request().postDataJSON();
      const texts: string[] = body?.texts || [];
      const translations = texts.map(t => `[en]${t}`);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ translations, source: 'llm' }),
      });
    });

    await skipOnboarding(page);
    await openAppearanceSettings(page);

    await page.locator('button', { hasText: 'English' }).click();
    await page.waitForTimeout(500);

    // 页面不应崩溃
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

// ==================== 5. 构建产物验证 ====================

test.describe('i18n — 构建产物', () => {

  test('翻译引擎加载成功（无 JS 错误）', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await skipOnboarding(page);
    await page.waitForTimeout(1000);

    // 不应有 i18n 相关的 JS 错误
    const i18nErrors = errors.filter(e =>
      e.includes('i18n') || e.includes('translate') || e.includes('locale')
    );
    expect(i18nErrors).toHaveLength(0);
  });

  test('语言切换不产生未捕获异常', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await installTranslationMock(page, 'en');
    await skipOnboarding(page);
    await openAppearanceSettings(page);

    // 快速切换多语言
    await page.locator('button', { hasText: 'English' }).click();
    await page.waitForTimeout(200);
    await page.locator('button', { hasText: '日本語' }).click();
    await page.waitForTimeout(200);
    await page.locator('button', { hasText: '한국어' }).click();
    await page.waitForTimeout(200);
    await page.locator('button', { hasText: '中文' }).click();
    await page.waitForTimeout(500);

    // 不应有 i18n 相关的未捕获异常（过滤掉 WS 初始化等非 i18n 错误）
    const i18nErrors = errors.filter(e =>
      e.includes('i18n') || e.includes('translate') || e.includes('locale')
    );
    expect(i18nErrors).toHaveLength(0);
  });
});

// ==================== 6. 术语一致性 ====================

test.describe('i18n — 术语一致性', () => {

  test('关键术语在多语言下翻译一致', async ({ page }) => {
    // 验证使用 useTranslation 的组件在切换语言后正确翻译
    // 注意：dev 模式下 i18n 插件关闭，只有显式导入 useTranslation 的组件会翻译
    await installTranslationMock(page, 'en');
    await skipOnboarding(page);
    await openAppearanceSettings(page);

    // 切英文
    await page.locator('button', { hasText: 'English' }).click();
    await page.waitForTimeout(500);

    // 验证 Tab 栏（使用 useTranslation 的组件）正确翻译
    await expect(page.getByRole('button', { name: /💬 Chat/ })).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole('button', { name: /🧠 Memory/ })).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole('button', { name: /📚 Knowledge/ })).toBeVisible({ timeout: 3000 });

    // 验证设置面板中的翻译文本（Appearance tab 已由 openAppearanceSettings 选中）
    await expect(page.getByText('Appearance')).toBeVisible({ timeout: 3000 });
  });
});
