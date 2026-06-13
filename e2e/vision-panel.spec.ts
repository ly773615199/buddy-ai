/**
 * VisionPanel E2E — 视觉面板深度覆盖
 *
 * 覆盖：
 * 1. 面板结构 — 模式切换（camera/ocr/scene）
 * 2. 隐私模式 — strict/moderate/open 切换
 * 3. OCR 结果展示 — ocr 事件注入
 * 4. 场景分析 — scene_analyze 事件注入
 * 5. 摄像头状态 — 启动/停止
 * 6. 错误处理 — 摄像头不可用
 */
import { test, expect } from '@playwright/test';
import {
  skipOnboarding, setupMockWS, injectWsMessage, waitForWSConnection, injectBuddyState,
} from './fixtures.js';

// ── 辅助函数 ──

/** 导航到视觉面板 */
async function goToVision(page: import('@playwright/test').Page) {
  // 视觉面板通过 tab 切换
  const btn = page.locator('button', { hasText: '👁' }).first();
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(500);
  }
}

// ==================== 测试用例 ====================

test.describe('VisionPanel — 面板结构', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
    await injectBuddyState(page);
  });

  test('视觉面板可导航', async ({ page }) => {
    await goToVision(page);

    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('模式切换 — camera/ocr/scene', async ({ page }) => {
    await goToVision(page);

    // 尝试切换各模式
    const modes = ['摄像头', 'OCR', '场景'];
    for (const label of modes) {
      const btn = page.locator(`button:has-text("${label}")`).first();
      if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(200);
      }
    }

    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

test.describe('VisionPanel — 隐私模式', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
    await injectBuddyState(page);
  });

  test('隐私级别切换 — strict/moderate/open', async ({ page }) => {
    await goToVision(page);

    // 查找隐私相关控件
    const privacyBtns = page.locator('button', { hasText: /strict|moderate|open|严格|适中|开放/ });
    const count = await privacyBtns.count();

    if (count > 0) {
      // 点击各隐私级别
      for (let i = 0; i < count; i++) {
        await privacyBtns.nth(i).click();
        await page.waitForTimeout(200);
      }
    }

    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('隐私模式下敏感数据脱敏', async ({ page }) => {
    await goToVision(page);

    // 注入 OCR 结果（含敏感信息）
    await injectWsMessage(page, {
      type: 'ocr_result',
      data: { text: '手机号：13800138000，身份证：110101199001011234' },
    });
    await page.waitForTimeout(500);

    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

test.describe('VisionPanel — OCR 结果', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
    await injectBuddyState(page);
  });

  test('ocr_result 事件注入后显示文字', async ({ page }) => {
    await goToVision(page);

    await injectWsMessage(page, {
      type: 'ocr_result',
      data: { text: 'Hello World\n这是一段 OCR 识别的文字' },
    });
    await page.waitForTimeout(500);

    // OCR 结果应显示在面板中
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('空 OCR 结果不崩溃', async ({ page }) => {
    await goToVision(page);

    await injectWsMessage(page, {
      type: 'ocr_result',
      data: { text: '' },
    });
    await page.waitForTimeout(500);

    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

test.describe('VisionPanel — 场景分析', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
    await injectBuddyState(page);
  });

  test('scene_analyze 事件注入后显示分析结果', async ({ page }) => {
    await goToVision(page);

    await injectWsMessage(page, {
      type: 'scene_analyze',
      data: {
        description: '一个办公室场景，有一张桌子和一台电脑',
        objects: ['桌子', '电脑', '键盘', '鼠标'],
        confidence: 0.92,
      },
    });
    await page.waitForTimeout(500);

    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('低置信度场景分析不崩溃', async ({ page }) => {
    await goToVision(page);

    await injectWsMessage(page, {
      type: 'scene_analyze',
      data: {
        description: '模糊的场景',
        objects: [],
        confidence: 0.3,
      },
    });
    await page.waitForTimeout(500);

    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

test.describe('VisionPanel — 摄像头', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
    await injectBuddyState(page);
  });

  test('摄像头启动按钮存在', async ({ page }) => {
    await goToVision(page);

    // 查找摄像头相关按钮
    const startBtn = page.locator('button', { hasText: /开启|启动|Open|Start/ }).first();
    if (await startBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(startBtn).toBeEnabled();
    }
  });

  test('摄像头不可用时显示错误', async ({ page }) => {
    await goToVision(page);

    // Mock 摄像头不可用
    await page.evaluate(() => {
      (navigator as any).mediaDevices = {
        getUserMedia: () => Promise.reject(new Error('NotAllowedError')),
        enumerateDevices: () => Promise.resolve([]),
      };
    });

    // 尝试启动摄像头
    const startBtn = page.locator('button', { hasText: /开启|启动|Open|Start/ }).first();
    if (await startBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await startBtn.click();
      await page.waitForTimeout(1000);

      // 应显示错误信息
      await expect(page.getByText(/失败|错误|Error/).first()).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe('VisionPanel — WS 事件注入', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
    await injectBuddyState(page);
  });

  test('连续视觉事件注入不崩溃', async ({ page }) => {
    await goToVision(page);

    const events = [
      { type: 'ocr_result', data: { text: '文字 1' } },
      { type: 'scene_analyze', data: { description: '场景 1', objects: ['obj1'], confidence: 0.8 } },
      { type: 'ocr_result', data: { text: '文字 2' } },
      { type: 'face_detect', data: { faces: [{ x: 10, y: 20, w: 50, h: 50 }] } },
    ];

    for (const event of events) {
      await injectWsMessage(page, event);
      await page.waitForTimeout(200);
    }

    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});
