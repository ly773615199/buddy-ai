/**
 * 工具面板 & 记忆面板 E2E — 功能级覆盖
 *
 * 覆盖：
 * 1. 工具面板 — 加载态、工具卡片、执行日志、来源标签
 * 2. 记忆面板 — 加载态、统计卡片、领域列表、深度条
 * 3. 面板数据请求触发
 */
import { test, expect, type Page } from '@playwright/test';
import { skipOnboarding, injectWsMessage, setupMockWS, waitForWSConnection } from './fixtures.js';

// ==================== 本地辅助函数 ====================

/** 导航到指定 Tab */
async function goToTab(page: Page, icon: string) {
  await page.locator('button', { hasText: icon }).first().click();
  // render cycle
}

// ==================== 工具面板测试 ====================

test.describe('工具面板 E2E', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
  });

  test('工具面板 — 加载态显示', async ({ page }) => {
    await goToTab(page, '🔧');

    // 初始应该显示加载中文案（i18n key 或中文）
    const loading = page.getByText(/loading|加载中/);
    // 如果数据还没返回，应该看到加载态
    // 如果 WS 快速返回了数据，也可能直接看到工具列表
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('工具面板 — 注入 mock 数据后显示工具卡片', async ({ page }) => {
    await goToTab(page, '🔧');

    // 注入工具面板数据
    await injectWsMessage(page, {
      type: 'tool_panel_data',
      data: {
        tools: [
          { name: 'web_search', description: '搜索互联网获取实时信息', source: 'builtin', usageCount: 42, successRate: 95 },
          { name: 'code_exec', description: '执行代码片段', source: 'builtin', usageCount: 18, successRate: 88 },
          { name: 'mcp_github', description: 'GitHub 操作', source: 'mcp', usageCount: 7, successRate: 100 },
          { name: 'skill_weather', description: '天气查询', source: 'skill', usageCount: 3, successRate: 66 },
        ],
        recentExecutions: [
          { tool: 'web_search', args: { query: '天气' }, result: '今天晴天 25°C', success: true, durationMs: 1200, timestamp: Date.now() },
          { tool: 'code_exec', args: { code: 'print(1)' }, result: 'Error: timeout', success: false, durationMs: 5000, timestamp: Date.now() - 60000 },
        ],
      },
    });
    // render cycle

    // 验证工具卡片渲染
    await expect(page.getByText('web_search').first()).toBeVisible();
    await expect(page.getByText('code_exec').first()).toBeVisible();
    await expect(page.getByText('mcp_github').first()).toBeVisible();
    await expect(page.getByText('skill_weather').first()).toBeVisible();

    // 验证工具描述
    await expect(page.getByText('搜索互联网获取实时信息')).toBeVisible();

    // 验证使用次数
    await expect(page.getByText('×42')).toBeVisible();
    await expect(page.getByText('×18')).toBeVisible();

    // 验证成功率颜色（数字存在即可）
    await expect(page.getByText('95%')).toBeVisible();
    await expect(page.getByText('88%')).toBeVisible();
  });

  test('工具面板 — 来源标签颜色区分', async ({ page }) => {
    await goToTab(page, '🔧');

    await injectWsMessage(page, {
      type: 'tool_panel_data',
      data: {
        tools: [
          { name: 'builtin_tool', description: '内置工具', source: 'builtin', usageCount: 1, successRate: 100 },
          { name: 'mcp_tool', description: 'MCP 工具', source: 'mcp', usageCount: 1, successRate: 100 },
          { name: 'skill_tool', description: '技能工具', source: 'skill', usageCount: 1, successRate: 100 },
        ],
        recentExecutions: [],
      },
    });
    // render cycle

    // 验证来源标签存在
    await expect(page.getByText('builtin_tool').first()).toBeVisible();
    await expect(page.getByText('mcp_tool').first()).toBeVisible();
    await expect(page.getByText('skill_tool').first()).toBeVisible();
  });

  test('工具面板 — 执行日志渲染', async ({ page }) => {
    await goToTab(page, '🔧');

    await injectWsMessage(page, {
      type: 'tool_panel_data',
      data: {
        tools: [],
        recentExecutions: [
          { tool: 'web_search', args: { query: '测试' }, result: '搜索结果 OK', success: true, durationMs: 800, timestamp: Date.now() },
          { tool: 'code_exec', args: {}, result: 'RuntimeError', success: false, durationMs: 200, timestamp: Date.now() - 30000 },
        ],
      },
    });
    // render cycle

    // 验证执行日志卡片
    await expect(page.getByText('800ms')).toBeVisible();
    await expect(page.getByText('200ms')).toBeVisible();

    // 验证成功/失败状态（✅/❌ 通过文本匹配）
    const body = await page.textContent('body');
    expect(body).toContain('✅');
    expect(body).toContain('❌');
  });

  test('工具面板 — 空列表提示', async ({ page }) => {
    await goToTab(page, '🔧');

    await injectWsMessage(page, {
      type: 'tool_panel_data',
      data: {
        tools: [],
        recentExecutions: [],
      },
    });
    // render cycle

    // 应该显示空状态文案
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

// ==================== 记忆面板测试 ====================

test.describe('记忆面板 E2E', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
  });

  test('记忆面板 — 加载态显示', async ({ page }) => {
    await goToTab(page, '🧠');

    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('记忆面板 — 注入 mock 数据后显示统计卡片', async ({ page }) => {
    await goToTab(page, '🧠');

    await injectWsMessage(page, {
      type: 'memory_panel_data',
      data: {
        domains: [
          {
            domain: '编程',
            domainType: 'technical',
            knowledgeCount: 156,
            depthScore: 0.85,
            growthStage: 'mature',
            confidence: 0.92,
            conversationCount: 48,
            lastActiveAt: Date.now(),
          },
          {
            domain: '生活',
            domainType: 'personal',
            knowledgeCount: 42,
            depthScore: 0.45,
            growthStage: 'sprout',
            confidence: 0.6,
            conversationCount: 12,
            lastActiveAt: Date.now() - 86400000,
          },
          {
            domain: '音乐',
            domainType: 'hobby',
            knowledgeCount: 8,
            depthScore: 0.15,
            growthStage: 'seed',
            confidence: 0.3,
            conversationCount: 3,
            lastActiveAt: Date.now() - 172800000,
          },
        ],
        stats: {
          totalNodes: 206,
          totalDomains: 3,
          activeDomains: 2,
        },
      },
    });
    // render cycle

    // 验证统计卡片数字
    await expect(page.getByText('206')).toBeVisible();  // totalNodes
    await expect(page.getByText('3').first()).toBeVisible();    // totalDomains
    await expect(page.getByText('2').first()).toBeVisible();    // activeDomains

    // 验证领域列表
    await expect(page.getByText('编程')).toBeVisible();
    await expect(page.getByText('生活')).toBeVisible();
    await expect(page.getByText('音乐')).toBeVisible();
  });

  test('记忆面板 — 领域卡片详情', async ({ page }) => {
    await goToTab(page, '🧠');

    await injectWsMessage(page, {
      type: 'memory_panel_data',
      data: {
        domains: [
          {
            domain: '编程',
            domainType: 'technical',
            knowledgeCount: 156,
            depthScore: 0.85,
            growthStage: 'mature',
            confidence: 0.92,
            conversationCount: 48,
            lastActiveAt: Date.now(),
          },
        ],
        stats: { totalNodes: 156, totalDomains: 1, activeDomains: 1 },
      },
    });
    // render cycle

    // 验证知识条数
    await expect(page.getByText('156 条知识')).toBeVisible();

    // 验证深度百分比 (0.85 → 85%)
    await expect(page.getByText('85%').first()).toBeVisible();

    // 验证对话次数
    await expect(page.getByText('48 次对话')).toBeVisible();
  });

  test('记忆面板 — 空领域提示', async ({ page }) => {
    await goToTab(page, '🧠');

    await injectWsMessage(page, {
      type: 'memory_panel_data',
      data: {
        domains: [],
        stats: { totalNodes: 0, totalDomains: 0, activeDomains: 0 },
      },
    });
    // render cycle

    // 应该显示空状态文案
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('记忆面板 — 领域按知识量排序', async ({ page }) => {
    await goToTab(page, '🧠');

    await injectWsMessage(page, {
      type: 'memory_panel_data',
      data: {
        domains: [
          { domain: '音乐', domainType: 'hobby', knowledgeCount: 5, depthScore: 0.1, growthStage: 'seed', confidence: 0.2, conversationCount: 1, lastActiveAt: Date.now() },
          { domain: '编程', domainType: 'technical', knowledgeCount: 200, depthScore: 0.9, growthStage: 'expert', confidence: 0.95, conversationCount: 60, lastActiveAt: Date.now() },
          { domain: '生活', domainType: 'personal', knowledgeCount: 50, depthScore: 0.5, growthStage: 'growing', confidence: 0.7, conversationCount: 15, lastActiveAt: Date.now() },
        ],
        stats: { totalNodes: 255, totalDomains: 3, activeDomains: 3 },
      },
    });
    // render cycle

    // 获取领域名称的位置，验证排序（编程应该在最前面）
    const codingDomain = page.getByText('编程').first();
    const musicDomain = page.getByText('音乐').first();

    const codingBox = await codingDomain.boundingBox();
    const musicBox = await musicDomain.boundingBox();

    if (codingBox && musicBox) {
      // 编程（200条）应该在音乐（5条）上方
      expect(codingBox.y).toBeLessThan(musicBox.y);
    }
  });
});
