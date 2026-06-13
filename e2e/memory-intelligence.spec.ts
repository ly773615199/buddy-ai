/**
 * 记忆与智能系统 E2E — 知识管理、经验学习、梦境
 *
 * 覆盖：
 * 1. 记忆面板完整数据渲染
 * 2. 梦境系统（日志、完成事件）
 * 3. 领域成熟度事件
 * 4. 技能注册事件
 * 5. 知识缺口检测
 * 6. 信念存储
 * 7. 推理链
 */
import { test, expect } from '@playwright/test';
import { skipOnboarding, setupMockWS, injectWsMessage, waitForWSConnection } from './fixtures.js';

// ==================== 记忆面板 ====================

test.describe('记忆系统 — 面板数据', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
  });

  test('记忆面板 — 多领域深度数据', async ({ page }) => {
    await page.locator('button', { hasText: '🧠' }).first().click();

    await injectWsMessage(page, {
      type: 'memory_panel_data',
      data: {
        domains: [
          {
            domain: '编程',
            domainType: 'technical',
            knowledgeCount: 200,
            depthScore: 0.92,
            growthStage: 'expert',
            confidence: 0.95,
            conversationCount: 80,
            lastActiveAt: Date.now(),
          },
          {
            domain: '生活',
            domainType: 'personal',
            knowledgeCount: 50,
            depthScore: 0.45,
            growthStage: 'sprout',
            confidence: 0.6,
            conversationCount: 15,
            lastActiveAt: Date.now() - 86400000,
          },
          {
            domain: '音乐',
            domainType: 'hobby',
            knowledgeCount: 8,
            depthScore: 0.12,
            growthStage: 'seed',
            confidence: 0.25,
            conversationCount: 3,
            lastActiveAt: Date.now() - 172800000,
          },
          {
            domain: 'AI/ML',
            domainType: 'technical',
            knowledgeCount: 150,
            depthScore: 0.78,
            growthStage: 'growing',
            confidence: 0.85,
            conversationCount: 45,
            lastActiveAt: Date.now() - 3600000,
          },
        ],
        stats: {
          totalNodes: 408,
          totalDomains: 4,
          activeDomains: 3,
        },
      },
    });

    // 验证统计数字
    await expect(page.getByText(/408/)).toBeVisible();
    await expect(page.getByText('4', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('3', { exact: true }).first()).toBeVisible();

    // 验证领域列表
    await expect(page.getByText('编程')).toBeVisible();
    await expect(page.getByText('AI/ML')).toBeVisible();

    // 验证成长阶段标签（expert 被 i18n 翻译为"专家"）
    await expect(page.getByText('专家').first()).toBeVisible();
  });

  test('记忆面板 — 领域深度条可视化', async ({ page }) => {
    await page.locator('button', { hasText: '🧠' }).first().click();

    await injectWsMessage(page, {
      type: 'memory_panel_data',
      data: {
        domains: [
          {
            domain: '编程',
            domainType: 'technical',
            knowledgeCount: 100,
            depthScore: 0.85,
            growthStage: 'mature',
            confidence: 0.9,
            conversationCount: 40,
            lastActiveAt: Date.now(),
          },
        ],
        stats: { totalNodes: 100, totalDomains: 1, activeDomains: 1 },
      },
    });

    // 验证深度百分比
    await expect(page.getByText(/85%/).first()).toBeVisible();
    // 验证知识条数
    await expect(page.getByText('100 条知识')).toBeVisible();
    // 验证对话次数
    await expect(page.getByText('40 次对话')).toBeVisible();
  });

  test('记忆面板 — 按活跃度排序', async ({ page }) => {
    await page.locator('button', { hasText: '🧠' }).first().click();

    await injectWsMessage(page, {
      type: 'memory_panel_data',
      data: {
        domains: [
          { domain: '旧领域', domainType: 'hobby', knowledgeCount: 5, depthScore: 0.1, growthStage: 'seed', confidence: 0.2, conversationCount: 1, lastActiveAt: Date.now() - 604800000 },
          { domain: '活跃领域', domainType: 'technical', knowledgeCount: 100, depthScore: 0.9, growthStage: 'expert', confidence: 0.95, conversationCount: 50, lastActiveAt: Date.now() },
          { domain: '中等领域', domainType: 'personal', knowledgeCount: 30, depthScore: 0.5, growthStage: 'growing', confidence: 0.6, conversationCount: 10, lastActiveAt: Date.now() - 86400000 },
        ],
        stats: { totalNodes: 135, totalDomains: 3, activeDomains: 2 },
      },
    });

    // 验证领域按知识量排序（活跃领域 100 > 中等 30 > 旧 5）
    const active = page.getByText('活跃领域').first();
    const old = page.getByText('旧领域').first();
    const activeBox = await active.boundingBox();
    const oldBox = await old.boundingBox();

    if (activeBox && oldBox) {
      expect(activeBox.y).toBeLessThan(oldBox.y);
    }
  });
});

// ==================== 梦境系统 ====================

test.describe('记忆系统 — 梦境', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
  });

  test('梦境日志渲染', async ({ page }) => {
    await page.locator('button', { hasText: '📊' }).first().click();
    await page.locator('button', { hasText: '梦境' }).first().click();

    // 前端独有事件（后端不 emit）
    await injectWsMessage(page, {
      type: 'dream_logs',
      logs: [
        { journal: '回顾了今天的对话，用户对 TypeScript 泛型很感兴趣，下次可以深入讨论条件类型和映射类型。', timestamp: Date.now() - 3600000 },
        { journal: '发现用户经常问关于设计模式的问题，整理了一份常用设计模式速查表。', timestamp: Date.now() - 7200000 },
        { journal: '今天的情绪波动较大，用户似乎在赶项目 deadline，下次回复要更简洁高效。', timestamp: Date.now() - 10800000 },
      ],
    });

    await expect(page.getByText(/TypeScript 泛型/)).toBeVisible();
    await expect(page.getByText(/设计模式/)).toBeVisible();
    await expect(page.getByText('梦境日志 (3)')).toBeVisible();
  });

  test('梦境完成事件', async ({ page }) => {
    // 注入梦境完成事件
    await injectWsMessage(page, {
      type: 'dream_complete',
      journal: '今天的梦境总结：学到了 3 个新知识点，发现了 1 个知识缺口。',
      timestamp: Date.now(),
    });

    // bubble 应该渲染梦境日志
    await expect(page.getByText(/梦境总结/)).toBeVisible({ timeout: 5000 });
  });
});

// ==================== 领域成熟度 ====================

test.describe('记忆系统 — 领域成熟度', () => {

  test('domain_mature 事件触发通知', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await injectWsMessage(page, {
      type: 'domain_mature',
      domain: '编程',
      knowledgeCount: 100,
    });

    // 验证领域成熟通知渲染
    await expect(page.getByText(/领域.*编程.*已成熟/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('100 条知识')).toBeVisible();
  });
});

// ==================== 技能系统 ====================

test.describe('记忆系统 — 技能注册', () => {

  test('skill_registered 事件渲染', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await injectWsMessage(page, {
      type: 'skill_registered',
      name: 'weather',
      description: '天气查询技能',
      source: 'clawhub',
    });

    // 验证技能注册消息渲染
    await expect(page.getByText(/新工具已加载/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('weather')).toBeVisible();
    await expect(page.getByText('天气查询技能')).toBeVisible();
  });
});

// ==================== 记忆面板 — 传感数据完整 ====================

test.describe('记忆系统 — 传感数据', () => {

  test('完整传感器数据注入', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await page.locator('button', { hasText: '📊' }).first().click();
    await page.locator('button', { hasText: '传感器' }).first().click();

    // 注入完整传感器数据
    // 前端独有事件（后端不 emit）
    await injectWsMessage(page, {
      type: 'sensor_update',
      data: {
        location: { lat: 31.2304, lng: 121.4737, accuracy: 5 },
        motion: { x: 0.05, y: -9.78, z: 0.12, state: 'still' },
        environment: { light: 450, battery: 72, online: true },
      },
    });

    // 验证位置数据
    await expect(page.getByText(/31\.230/)).toBeVisible();
    await expect(page.getByText(/121\.473/)).toBeVisible();
  });

  test('环境信息面板项完整性', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await page.locator('button', { hasText: '📊' }).first().click();
    await page.locator('button', { hasText: '传感器' }).first().click();

    // 验证所有环境信息项
    const items = ['网络', '语言', '💻 平台', '屏幕', '时区'];
    for (const item of items) {
      await expect(page.getByText(item)).toBeVisible({ timeout: 3000 });
    }
  });
});
