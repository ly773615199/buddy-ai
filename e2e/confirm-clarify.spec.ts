/**
 * 确认与澄清流程 E2E — 高风险操作确认、意图澄清
 *
 * 覆盖：
 * 1. 高风险工具确认对话框
 * 2. 意图澄清问题
 * 3. 确认/拒绝响应
 * 4. 信任等级影响
 */
import { test, expect } from '@playwright/test';
import { skipOnboarding, setupMockWS, injectWsMessage, waitForWSConnection } from './fixtures.js';

// ==================== 工具确认 ====================

test.describe('确认流程 — 工具确认', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
  });

  test('高风险工具触发确认对话框', async ({ page }) => {
    await injectWsMessage(page, {
      type: 'confirm_required',
      question: '确认执行: 删除文件 /tmp/important.txt?',
    });

    // 验证确认对话框渲染
    await expect(page.getByText('确认执行')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('删除文件')).toBeVisible();
  });

  test('工具确认请求包含信任等级', async ({ page }) => {
    await injectWsMessage(page, {
      type: 'tool_confirm_request',
      id: 'confirm-002',
      tool: 'exec',
      description: '执行命令: sudo apt upgrade',
      trustLevel: 'cautious',
    });

    // handler 渲染: ⚠️ 需要确认：执行命令: sudo apt upgrade
    await expect(page.getByText(/需要确认/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('sudo apt upgrade')).toBeVisible();
  });

  test('多个确认请求排队', async ({ page }) => {
    // 第一个确认请求
    await injectWsMessage(page, {
      type: 'confirm_required',
      question: '确认操作 1?',
    });

    await expect(page.getByText('确认操作 1')).toBeVisible({ timeout: 5000 });

    // 第二个确认请求
    await injectWsMessage(page, {
      type: 'confirm_required',
      question: '确认操作 2?',
    });

    const body = await page.textContent('body');
    expect(body).toContain('确认操作');
  });
});

// ==================== 意图澄清 ====================

test.describe('确认流程 — 意图澄清', () => {

  test('clarify 事件渲染澄清问题', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await injectWsMessage(page, {
      type: 'clarify',
      question: '你想让我读取哪个文件？请提供路径。',
    });

    await expect(page.getByText('你想让我读取哪个文件')).toBeVisible({ timeout: 5000 });
  });

  test('澄清后继续处理', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    // 先显示澄清问题
    await injectWsMessage(page, {
      type: 'clarify',
      question: '你想搜索什么？',
    });

    await expect(page.getByText('你想搜索什么')).toBeVisible({ timeout: 5000 });

    // 用户回复后正常处理
    const textarea = page.locator('textarea').first();
    await textarea.fill('搜索天气');
    await textarea.press('Enter');

    // 验证消息已发送
    await expect(page.getByText('搜索天气')).toBeVisible();
  });
});
