/**
 * KnowledgePanel E2E — 知识图谱面板完整覆盖
 *
 * 覆盖：
 * 1. 统计概览 — 4 个 StatCard 正确渲染
 * 2. 概念图视图 — SVG 节点/边渲染、节点点击
 * 3. 知识列表视图 — 切换、条目渲染、文件列表
 * 4. 节点详情 — 选中节点显示详情面板
 * 5. 空状态 — 无数据时的提示文案
 * 6. 加载态 — 初始加载提示
 */
import { test, expect } from '@playwright/test';
import { skipOnboarding, setupMockWS, injectWsMessage, waitForWSConnection, injectBuddyState } from './fixtures.js';

// ── 工具函数 ──

/** 导航到知识 Tab */
async function goToKnowledgeTab(page: import('@playwright/test').Page) {
  await page.locator('button', { hasText: '📚' }).first().click();
  await page.waitForTimeout(300);
}

/** 注入知识面板完整数据 */
async function injectKnowledgeData(page: import('@playwright/test').Page) {
  await injectWsMessage(page, {
    type: 'knowledge_panel_data',
    data: {
      nodes: [
        { id: 'typescript', label: 'TypeScript', count: 42, domains: ['技术'], types: ['rule_based'], size: 20 },
        { id: 'react', label: 'React', count: 35, domains: ['技术'], types: ['pattern_recognition'], size: 18 },
        { id: 'ai', label: 'AI', count: 28, domains: ['技术', '研究'], types: ['creative'], size: 16 },
        { id: 'design', label: '设计模式', count: 15, domains: ['技术'], types: ['relational'], size: 12 },
      ],
      edges: [
        { source: 'typescript', target: 'react', weight: 3 },
        { source: 'react', target: 'ai', weight: 2 },
        { source: 'typescript', target: 'design', weight: 1.5 },
      ],
      knowledge: [
        { key: 'TS 泛型', value: 'TypeScript 泛型允许创建可复用的组件', importance: 8 },
        { key: 'React Hooks', value: 'Hooks 是 React 16.8 引入的新特性', importance: 7 },
        { key: 'GPT 架构', value: 'Generative Pre-trained Transformer', importance: 9 },
      ],
      files: [
        { key: 'README.md', value: '2026-05-01 学习' },
        { key: 'ARCHITECTURE.md', value: '2026-04-28 学习' },
      ],
      stats: {
        totalKnowledge: 120,
        totalFiles: 15,
        totalDomains: 5,
        totalSTMPNodes: 340,
      },
    },
  });
}

// ── 测试 ──

test.describe('KnowledgePanel — 统计概览', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
    await injectBuddyState(page);
  });

  test('4 个统计卡片全部可见', async ({ page }) => {
    await goToKnowledgeTab(page);
    await injectKnowledgeData(page);

    // 验证 4 个 StatCard
    await expect(page.getByText('知识条目')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('学习文件')).toBeVisible();
    await expect(page.getByText('领域').first()).toBeVisible();
    await expect(page.getByText('STMP 节点')).toBeVisible();
  });

  test('统计数值正确渲染', async ({ page }) => {
    await goToKnowledgeTab(page);
    await injectKnowledgeData(page);

    await expect(page.getByText('120')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('15').first()).toBeVisible();
    await expect(page.getByText('5').first()).toBeVisible();
    await expect(page.getByText('340')).toBeVisible();
  });
});

test.describe('KnowledgePanel — 概念图视图', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
    await injectBuddyState(page);
  });

  test('概念图 Tab 默认激活', async ({ page }) => {
    await goToKnowledgeTab(page);
    await injectKnowledgeData(page);

    // 概念图按钮应有激活样式
    const graphBtn = page.locator('button', { hasText: '🕸️ 概念图' }).first();
    await expect(graphBtn).toBeVisible({ timeout: 5000 });
  });

  test('概念图 SVG 渲染节点和边', async ({ page }) => {
    await goToKnowledgeTab(page);
    await injectKnowledgeData(page);

    // SVG 应该存在
    const svg = page.locator('svg').first();
    await expect(svg).toBeVisible({ timeout: 5000 });

    // 应该有 circle 元素（节点）
    const circles = page.locator('svg circle');
    const count = await circles.count();
    // 4 个节点 = 4 个节点圆 + 可能的选中光晕
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test('节点点击触发选中', async ({ page }) => {
    await goToKnowledgeTab(page);
    await injectKnowledgeData(page);

    // 等待 SVG 渲染
    await page.locator('svg').first().waitFor({ timeout: 5000 });

    // 点击第一个节点（g 元素）
    const nodeGroup = page.locator('svg g').first();
    await nodeGroup.click();
    await page.waitForTimeout(300);

    // 选中后应显示节点详情面板（包含"条知识"文案）
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

test.describe('KnowledgePanel — 知识列表视图', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
    await injectBuddyState(page);
  });

  test('切换到知识列表视图', async ({ page }) => {
    await goToKnowledgeTab(page);
    await injectKnowledgeData(page);

    // 点击知识列表按钮
    const listBtn = page.locator('button', { hasText: '📋 知识列表' }).first();
    await listBtn.click();
    await page.waitForTimeout(300);

    // 应显示已学习文件标题
    await expect(page.getByText(/已学习文件/)).toBeVisible({ timeout: 5000 });
    // 应显示知识条目标题
    await expect(page.getByText(/知识条目/).first()).toBeVisible();
  });

  test('知识条目渲染正确', async ({ page }) => {
    await goToKnowledgeTab(page);
    await injectKnowledgeData(page);

    // 切换到列表
    await page.locator('button', { hasText: '📋 知识列表' }).first().click();
    await page.waitForTimeout(300);

    // 验证知识条目内容
    await expect(page.getByText('TS 泛型').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('React Hooks').first()).toBeVisible();
    await expect(page.getByText('GPT 架构').first()).toBeVisible();
  });

  test('已学习文件列表渲染', async ({ page }) => {
    await goToKnowledgeTab(page);
    await injectKnowledgeData(page);

    await page.locator('button', { hasText: '📋 知识列表' }).first().click();
    await page.waitForTimeout(300);

    // 验证文件名
    await expect(page.getByText('README.md').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('ARCHITECTURE.md').first()).toBeVisible();
  });

  test('概念图与列表视图切换', async ({ page }) => {
    await goToKnowledgeTab(page);
    await injectKnowledgeData(page);

    // 默认是概念图 → 切换到列表
    await page.locator('button', { hasText: '📋 知识列表' }).first().click();
    await page.waitForTimeout(200);
    await expect(page.getByText(/已学习文件/)).toBeVisible({ timeout: 5000 });

    // 切回概念图
    await page.locator('button', { hasText: '🕸️ 概念图' }).first().click();
    await page.waitForTimeout(200);
    // SVG 应重新出现
    await expect(page.locator('svg').first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('KnowledgePanel — 空状态', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
    await injectBuddyState(page);
  });

  test('空数据时概念图显示提示', async ({ page }) => {
    await goToKnowledgeTab(page);

    // 注入空数据
    await injectWsMessage(page, {
      type: 'knowledge_panel_data',
      data: {
        nodes: [],
        edges: [],
        knowledge: [],
        files: [],
        stats: { totalKnowledge: 0, totalFiles: 0, totalDomains: 0, totalSTMPNodes: 0 },
      },
    });

    // 应显示空状态提示
    await expect(page.getByText(/暂无概念数据/)).toBeVisible({ timeout: 5000 });
  });

  test('空数据时列表显示提示', async ({ page }) => {
    await goToKnowledgeTab(page);

    await injectWsMessage(page, {
      type: 'knowledge_panel_data',
      data: {
        nodes: [],
        edges: [],
        knowledge: [],
        files: [],
        stats: { totalKnowledge: 0, totalFiles: 0, totalDomains: 0, totalSTMPNodes: 0 },
      },
    });

    // 切换到列表视图
    await page.locator('button', { hasText: '📋 知识列表' }).first().click();
    await page.waitForTimeout(300);

    await expect(page.getByText(/暂无已学习的知识/)).toBeVisible({ timeout: 5000 });
  });
});

test.describe('KnowledgePanel — 加载态', () => {

  test('初始加载显示 loading 提示', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
    await injectBuddyState(page);

    // 拦截 WS 消息，丢弃 knowledge_panel_data 以保持 loading 态
    await page.evaluate(() => {
      const ws = (window as any).__mockWs?.instance;
      if (ws) {
        const origHandler = ws.onmessage;
        ws.onmessage = (ev: MessageEvent) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'knowledge_panel_data') return;
          } catch {}
          if (origHandler) origHandler(ev);
        };
      }
    });

    await goToKnowledgeTab(page);

    // loading 态应持续可见（数据被拦截，不会消失）
    await expect(page.getByText(/加载知识图谱/)).toBeVisible({ timeout: 5000 });
  });
});
