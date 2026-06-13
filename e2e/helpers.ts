/**
 * E2E 测试辅助函数 — 消息发送、内容等待、UI 交互
 *
 * 与 fixtures.ts 的区别：
 * - fixtures.ts: Mock 基础设施（WS 拦截、buddyState 注入）
 * - helpers.ts: 真实用户操作（通过 UI 发送消息、等待页面内容）
 */
import type { Page } from '@playwright/test';

/**
 * 通过真实 UI 发送消息（模拟用户操作）
 * 点击 textarea → 填入文本 → 按 Enter 发送
 */
export async function sendMessage(page: Page, text: string) {
  const textarea = page.locator('textarea').first();
  await textarea.waitFor({ state: 'visible', timeout: 10000 });
  await textarea.fill(text);
  await textarea.press('Enter');
}

/**
 * 等待页面文本满足条件
 * 排除 UI 固定文案（连接状态、placeholder 等），只匹配用户可见内容
 *
 * @param page Playwright Page
 * @param predicate 文本匹配函数
 * @param timeoutMs 超时
 * @returns 匹配到的文本
 */
export async function waitForContent(
  page: Page,
  predicate: (text: string) => boolean,
  timeoutMs = 15000,
): Promise<string> {
  const start = Date.now();
  const UI_TEXTS = [
    '已连接', 'Connected', '打个招呼吧', '思考中', '发送',
    '连接中...', '断开连接', '🐾', '💡', '⚙️',
  ];

  while (Date.now() - start < timeoutMs) {
    const messages = await page.evaluate((uiTexts: string[]) => {
      const divs = document.querySelectorAll('div, p, span, li');
      return Array.from(divs)
        .filter(d => d.children.length === 0 && d.textContent?.trim())
        .map(d => d.textContent!.trim())
        .filter(t => t.length > 1 && !uiTexts.some(ui => t === ui));
    }, UI_TEXTS);

    const found = messages.find(predicate);
    if (found) return found;
    await page.waitForTimeout(300);
  }
  throw new Error(`waitForContent 超时 (${timeoutMs}ms)`);
}

/**
 * 等待页面包含某个文本片段（排除 UI 文案）
 */
export async function waitForText(
  page: Page,
  text: string,
  timeoutMs = 15000,
): Promise<void> {
  await waitForContent(page, (t) => t.includes(text), timeoutMs);
}

/**
 * 导航到指定 Tab（通过 emoji 图标）
 */
export async function goToTab(page: Page, emoji: string) {
  await page.locator(`button:has-text("${emoji}")`).first().click();
  await page.waitForTimeout(300);
}

/**
 * 等待 WS 连接就绪
 */
export async function waitForWSReady(page: Page, timeoutMs = 15000) {
  await page.getByText('已连接', { exact: true }).waitFor({ timeout: timeoutMs });
}

/**
 * 获取页面所有非 UI 文本（调试用）
 */
export async function getPageTexts(page: Page): Promise<string[]> {
  const UI_TEXTS = ['已连接', 'Connected', '打个招呼吧', '思考中', '发送', '连接中...'];
  return page.evaluate((uiTexts: string[]) => {
    const divs = document.querySelectorAll('div, p, span, li');
    return Array.from(divs)
      .filter(d => d.children.length === 0 && d.textContent?.trim())
      .map(d => d.textContent!.trim())
      .filter(t => t.length > 1 && !uiTexts.some(ui => t === ui));
  }, UI_TEXTS);
}
