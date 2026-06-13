/**
 * DiagnosticCard E2E — 诊断报告卡片完整覆盖
 *
 * 覆盖：
 * 1. 诊断消息渲染 — mood emoji + message
 * 2. 技术详情折叠 — 展开/收起 detail
 * 3. 建议操作按钮 — suggestion 渲染、优先级标签
 * 4. 不同 mood 类型 — frustrated/confused/tired
 * 5. 多建议操作 — 按钮列表完整渲染
 */
import { test, expect } from '@playwright/test';
import { skipOnboarding, setupMockWS, injectWsMessage, waitForWSConnection, injectBuddyState } from './fixtures.js';

// ── Mock 诊断数据 ──

function makeDiagnostic(overrides: Record<string, unknown> = {}) {
  return {
    type: 'diagnostic',
    data: {
      category: 'model_error',
      message: '模型调用失败，无法完成请求',
      mood: 'frustrated',
      detail: 'Error: Connection refused\n  at fetch (node:internal)\n  timeout: 30000ms',
      attempted: ['deepseek-chat', 'gpt-4o'],
      failedReasons: ['API key 过期', '速率限制'],
      suggestions: [
        {
          action: 'update_key',
          label: '更新 API Key',
          description: '当前 Key 已过期，请在设置中更新',
          priority: 'high',
        },
        {
          action: 'switch_model',
          label: '切换模型',
          description: '尝试使用其他可用模型',
          priority: 'medium',
        },
        {
          action: 'retry',
          label: '重试',
          description: '稍后重试当前请求',
          priority: 'low',
        },
      ],
      ...overrides,
    },
  };
}

// ── 测试 ──

test.describe('DiagnosticCard — 基础渲染', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
    await injectBuddyState(page);
  });

  test('诊断消息渲染 — emoji + message', async ({ page }) => {
    await injectWsMessage(page, makeDiagnostic());

    // 应显示诊断 emoji 和消息
    await expect(page.getByText('😤')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('模型调用失败，无法完成请求')).toBeVisible();
  });

  test('mood 标签渲染', async ({ page }) => {
    await injectWsMessage(page, makeDiagnostic({ mood: 'frustrated' }));

    // 应显示 mood 翻译文案
    await expect(page.getByText(/有点沮丧/)).toBeVisible({ timeout: 5000 });
  });

  test('建议操作按钮渲染', async ({ page }) => {
    await injectWsMessage(page, makeDiagnostic());

    // 应显示建议操作标题
    await expect(page.getByText('建议操作：')).toBeVisible({ timeout: 5000 });
    // 应显示具体操作
    await expect(page.getByText('更新 API Key')).toBeVisible();
    await expect(page.getByText('切换模型')).toBeVisible();
    await expect(page.getByRole('button', { name: '重试' })).toBeVisible();
  });

  test('优先级标签渲染', async ({ page }) => {
    await injectWsMessage(page, makeDiagnostic());

    // 应显示优先级标签
    await expect(page.getByText('高').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('中').first()).toBeVisible();
    await expect(page.getByText('低').first()).toBeVisible();
  });
});

test.describe('DiagnosticCard — 技术详情折叠', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
    await injectBuddyState(page);
  });

  test('技术详情默认收起', async ({ page }) => {
    await injectWsMessage(page, makeDiagnostic());

    // 技术细节按钮应存在
    await expect(page.getByText('技术细节')).toBeVisible({ timeout: 5000 });
    // 默认收起，detail 内容不可见
    await expect(page.getByText('Connection refused')).not.toBeVisible();
  });

  test('点击展开技术详情', async ({ page }) => {
    await injectWsMessage(page, makeDiagnostic());

    // 点击展开
    await page.getByText('技术细节').click();
    await page.waitForTimeout(300);

    // detail 内容应可见
    await expect(page.getByText(/Connection refused/)).toBeVisible({ timeout: 5000 });
    // 已尝试的模型
    await expect(page.getByText(/deepseek-chat/)).toBeVisible();
    await expect(page.getByText(/gpt-4o/)).toBeVisible();
    // 失败原因
    await expect(page.getByText(/API key 过期/)).toBeVisible();
    await expect(page.getByText(/速率限制/)).toBeVisible();
  });

  test('再次点击收起技术详情', async ({ page }) => {
    await injectWsMessage(page, makeDiagnostic());

    // 展开
    await page.getByText('技术细节').click();
    await page.waitForTimeout(200);
    await expect(page.getByText(/Connection refused/)).toBeVisible({ timeout: 5000 });

    // 收起
    await page.getByText('技术细节').click();
    await page.waitForTimeout(200);
    await expect(page.getByText('Connection refused')).not.toBeVisible();
  });
});

test.describe('DiagnosticCard — 不同 mood 类型', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
    await injectBuddyState(page);
  });

  test('mood=frustrated → 😤 有点沮丧', async ({ page }) => {
    await injectWsMessage(page, makeDiagnostic({ mood: 'frustrated' }));
    await expect(page.getByText('😤')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/有点沮丧/)).toBeVisible();
  });

  test('mood=confused → 😕 有点困惑', async ({ page }) => {
    await injectWsMessage(page, makeDiagnostic({
      mood: 'confused',
      message: '意图不明确，需要澄清',
    }));
    await expect(page.getByText('😕')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/有点困惑/)).toBeVisible();
  });

  test('mood=tired → 😫 有点累了', async ({ page }) => {
    await injectWsMessage(page, makeDiagnostic({
      mood: 'tired',
      message: '处理过多请求，需要休息',
    }));
    await expect(page.getByText('😫')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/有点累了/)).toBeVisible();
  });
});

test.describe('DiagnosticCard — 边界场景', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
    await injectBuddyState(page);
  });

  test('无建议操作时正常渲染', async ({ page }) => {
    await injectWsMessage(page, makeDiagnostic({
      suggestions: [],
    }));

    // 消息应渲染
    await expect(page.getByText('模型调用失败，无法完成请求')).toBeVisible({ timeout: 5000 });
    // 不应显示建议操作标题
    await expect(page.getByText('建议操作：')).not.toBeVisible();
  });

  test('无 detail 时技术细节区域不崩溃', async ({ page }) => {
    await injectWsMessage(page, makeDiagnostic({
      detail: '',
      attempted: [],
      failedReasons: [],
    }));

    // 页面应正常渲染
    await expect(page.getByText('模型调用失败，无法完成请求')).toBeVisible({ timeout: 5000 });
  });

  test('单个建议操作', async ({ page }) => {
    await injectWsMessage(page, makeDiagnostic({
      suggestions: [
        { action: 'retry', label: '重试请求', description: '网络恢复后重试', priority: 'high' },
      ],
    }));

    await expect(page.getByText('建议操作：')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('重试请求')).toBeVisible();
    await expect(page.getByText('网络恢复后重试')).toBeVisible();
  });

  test('多个诊断消息顺序渲染', async ({ page }) => {
    await injectWsMessage(page, makeDiagnostic({ message: '第一个错误' }));
    await injectWsMessage(page, makeDiagnostic({
      message: '第二个错误',
      mood: 'tired',
    }));

    await expect(page.getByText('第一个错误')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('第二个错误')).toBeVisible();
  });
});
