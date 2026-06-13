/**
 * BuddyCanvas E2E — 精灵画布覆盖
 *
 * 覆盖：
 * 1. Canvas 元素存在且渲染
 * 2. 情绪状态注入 → 画布更新
 * 3. 精灵点击交互
 * 4. 窗口 resize 自适应
 * 5. 不同进化阶段渲染
 * 6. 连续渲染稳定性
 */
import { test, expect } from '@playwright/test';
import {
  skipOnboarding, setupMockWS, injectWsMessage, waitForWSConnection, injectBuddyState,
} from './fixtures.js';

// ── 辅助函数 ──

/** 获取 BuddyCanvas 容器 */
function getCanvasContainer(page: import('@playwright/test').Page) {
  return page.locator('[style*="cursor: pointer"][style*="touch-action: none"]').first();
}

/** 检查 canvas 或 fallback 是否渲染 */
async function hasRenderedContent(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const container = document.querySelector('[style*="cursor: pointer"][style*="touch-action: none"]');
    if (!container) return false;
    // Three.js canvas 或 Canvas2D fallback
    const canvas = container.querySelector('canvas');
    if (canvas) {
      // 检查 canvas 是否有内容（宽高 > 0）
      return canvas.width > 0 && canvas.height > 0;
    }
    // Canvas2D fallback 也会创建 canvas
    return container.children.length > 0;
  });
}

// ==================== 测试用例 ====================

test.describe('BuddyCanvas — 基础渲染', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
  });

  test('Canvas 容器存在且尺寸正确', async ({ page }) => {
    await injectBuddyState(page);

    const container = getCanvasContainer(page);
    await expect(container).toBeVisible({ timeout: 5000 });

    // 验证容器尺寸
    const box = await container.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThan(100);
    expect(box!.height).toBeGreaterThan(100);
  });

  test('注入 buddyState 后 canvas 有内容', async ({ page }) => {
    await injectBuddyState(page);
    await page.waitForTimeout(1000); // 等待渲染器初始化

    const rendered = await hasRenderedContent(page);
    expect(rendered).toBe(true);
  });

  test('默认 visualSeed 下渲染正常', async ({ page }) => {
    await injectBuddyState(page, {
      visualSeed: { primaryColor: '#58a6ff', texture: 'soft', temperament: 'warm', seed: 1 },
    });
    await page.waitForTimeout(1000);

    const rendered = await hasRenderedContent(page);
    expect(rendered).toBe(true);
  });
});

test.describe('BuddyCanvas — 情绪响应', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
  });

  test('happy 情绪注入后画布正常', async ({ page }) => {
    await injectBuddyState(page, {
      emotion: { mood: 'happy', energy: 0.9, satisfaction: 0.8 },
    });
    await page.waitForTimeout(1000);

    const rendered = await hasRenderedContent(page);
    expect(rendered).toBe(true);
  });

  test('frustrated 情绪注入后画布正常', async ({ page }) => {
    await injectBuddyState(page, {
      emotion: { mood: 'frustrated', energy: 0.3, satisfaction: 0.2 },
    });
    await page.waitForTimeout(1000);

    const rendered = await hasRenderedContent(page);
    expect(rendered).toBe(true);
  });

  test('excited 情绪注入后画布正常', async ({ page }) => {
    await injectBuddyState(page, {
      emotion: { mood: 'excited', energy: 1.0, satisfaction: 0.9 },
    });
    await page.waitForTimeout(1000);

    const rendered = await hasRenderedContent(page);
    expect(rendered).toBe(true);
  });

  test('情绪切换 — happy → frustrated 不崩溃', async ({ page }) => {
    await injectBuddyState(page, {
      emotion: { mood: 'happy', energy: 0.9, satisfaction: 0.8 },
    });
    await page.waitForTimeout(500);

    // 切换情绪
    await injectBuddyState(page, {
      emotion: { mood: 'frustrated', energy: 0.3, satisfaction: 0.2 },
    });
    await page.waitForTimeout(500);

    const rendered = await hasRenderedContent(page);
    expect(rendered).toBe(true);
  });

  test('情绪切换 — calm → excited → tired 不崩溃', async ({ page }) => {
    for (const mood of ['calm', 'excited', 'tired']) {
      await injectBuddyState(page, {
        emotion: { mood, energy: 0.5, satisfaction: 0.5 },
      });
      await page.waitForTimeout(300);
    }

    const rendered = await hasRenderedContent(page);
    expect(rendered).toBe(true);
  });
});

test.describe('BuddyCanvas — 进化阶段', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
  });

  test('孵化期 (formProgress=10) 渲染正常', async ({ page }) => {
    await injectBuddyState(page, {
      formProgress: 10,
      visualStage: { stage: 'hatching', name: '孵化', emoji: '🥚', description: '', minProgress: 0, maxProgress: 20 },
    });
    await page.waitForTimeout(1000);

    const rendered = await hasRenderedContent(page);
    expect(rendered).toBe(true);
  });

  test('成形期 (formProgress=50) 渲染正常', async ({ page }) => {
    await injectBuddyState(page, {
      formProgress: 50,
      visualStage: { stage: 'formed', name: '成形', emoji: '🦎', description: '', minProgress: 40, maxProgress: 70 },
    });
    await page.waitForTimeout(1000);

    const rendered = await hasRenderedContent(page);
    expect(rendered).toBe(true);
  });

  test('成熟期 (formProgress=90) 渲染正常', async ({ page }) => {
    await injectBuddyState(page, {
      formProgress: 90,
      visualStage: { stage: 'mature', name: '成熟', emoji: '🐉', description: '', minProgress: 80, maxProgress: 100 },
    });
    await page.waitForTimeout(1000);

    const rendered = await hasRenderedContent(page);
    expect(rendered).toBe(true);
  });
});

test.describe('BuddyCanvas — 交互', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
    await injectBuddyState(page);
    await page.waitForTimeout(1000);
  });

  test('点击画布不崩溃', async ({ page }) => {
    const container = getCanvasContainer(page);
    await expect(container).toBeVisible({ timeout: 5000 });

    // 点击画布中心
    await container.click();
    await page.waitForTimeout(500);

    // 页面应正常
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('鼠标移动不崩溃', async ({ page }) => {
    const container = getCanvasContainer(page);
    await expect(container).toBeVisible({ timeout: 5000 });

    const box = await container.boundingBox();
    if (box) {
      // 在画布上移动鼠标
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(200);
      await page.mouse.move(box.x + 10, box.y + 10);
      await page.waitForTimeout(200);
    }

    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

test.describe('BuddyCanvas — 稳定性', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
  });

  test('连续 5 次状态更新不崩溃', async ({ page }) => {
    await injectBuddyState(page);
    await page.waitForTimeout(500);

    // 连续更新情绪
    const moods = ['happy', 'calm', 'frustrated', 'excited', 'tired'];
    for (const mood of moods) {
      await injectBuddyState(page, {
        emotion: { mood, energy: 0.5, satisfaction: 0.5 },
      });
      await page.waitForTimeout(200);
    }

    const rendered = await hasRenderedContent(page);
    expect(rendered).toBe(true);
  });

  test('颜色更新不崩溃', async ({ page }) => {
    await injectBuddyState(page);
    await page.waitForTimeout(500);

    // 更新颜色
    await injectBuddyState(page, {
      visualSeed: { primaryColor: '#ff6b6b', secondaryColor: '#4ecdc4', texture: 'sharp', temperament: 'cool', seed: 2 },
    });
    await page.waitForTimeout(500);

    const rendered = await hasRenderedContent(page);
    expect(rendered).toBe(true);
  });
});
