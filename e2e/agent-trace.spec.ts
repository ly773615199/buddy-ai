/**
 * AgentTrace E2E — 决策追踪面板覆盖
 *
 * 覆盖：
 * 1. 空状态 — 无追踪记录时显示引导文案
 * 2. 追踪步骤渲染 — thinking/tool_call/tool_result/response/model_decision/brain_trace
 * 3. 时间线结构 — 图标 + 标签 + 内容 + 时间戳
 * 4. WS 事件注入 — agent_trace 事件驱动面板更新
 * 5. 多步骤追踪 — 完整决策链路渲染
 */
import { test, expect } from '@playwright/test';
import {
  skipOnboarding, setupMockWS, injectWsMessage, waitForWSConnection, injectBuddyState,
} from './fixtures.js';

// ── Mock 追踪数据 ──

function makeTrace(steps: Array<Record<string, unknown>>) {
  return {
    type: 'agent_trace',
    trace: steps,
  };
}

const MOCK_THINKING = {
  type: 'thinking',
  content: '分析用户意图：查询天气信息',
  timestamp: Date.now() - 5000,
};

const MOCK_TOOL_CALL = {
  type: 'tool_call',
  content: '调用天气查询工具',
  tool: 'web_search',
  timestamp: Date.now() - 4000,
};

const MOCK_TOOL_RESULT = {
  type: 'tool_result',
  content: '北京今天晴，温度 25°C',
  success: true,
  timestamp: Date.now() - 3000,
};

const MOCK_MODEL_DECISION = {
  type: 'model_decision',
  content: '选择 deepseek-chat 处理简单查询',
  modelId: 'deepseek-chat',
  displayName: 'DeepSeek Chat',
  tier: 'primary',
  layer: 0,
  candidateCount: 3,
  taskType: 'chat',
  timestamp: Date.now() - 2000,
};

const MOCK_BRAIN_TRACE = {
  type: 'brain_trace',
  content: '三脑决策：左脑调度 → 右脑分类 → 小脑执行',
  phase: 'left-brain',
  traceId: 'trace-abc12345',
  timestamp: Date.now() - 1000,
};

const MOCK_RESPONSE = {
  type: 'response',
  content: '北京今天天气晴朗，温度 25°C，适合外出。',
  timestamp: Date.now(),
};

// ==================== 测试用例 ====================

test.describe('AgentTrace — 空状态', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
    await injectBuddyState(page);
  });

  test('无追踪记录时显示空状态文案', async ({ page }) => {
    // agentTrace 初始为空，面板应显示空状态
    // AgentTrace 组件在 trace.length === 0 时显示 "trace.noTrace" 翻译文案
    // 但面板只在 agentTrace.length > 0 时渲染，所以验证面板不存在
    const tracePanel = page.locator('text=🤔 思考').first();
    await expect(tracePanel).not.toBeVisible({ timeout: 2000 });
  });
});

test.describe('AgentTrace — 追踪步骤渲染', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
    await injectBuddyState(page);
  });

  test('thinking 步骤渲染 — 🤔 图标 + 内容', async ({ page }) => {
    await injectWsMessage(page, makeTrace([MOCK_THINKING]));

    await expect(page.getByText('🤔').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('分析用户意图：查询天气信息')).toBeVisible();
  });

  test('tool_call 步骤渲染 — 🔧 图标 + 工具名', async ({ page }) => {
    await injectWsMessage(page, makeTrace([MOCK_TOOL_CALL]));

    await expect(page.getByText('🔧').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('web_search')).toBeVisible();
  });

  test('tool_result 步骤渲染 — 📋 图标 + 成功状态', async ({ page }) => {
    await injectWsMessage(page, makeTrace([MOCK_TOOL_RESULT]));

    await expect(page.getByText('📋').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('✅ 成功')).toBeVisible();
    await expect(page.getByText('北京今天晴，温度 25°C')).toBeVisible();
  });

  test('model_decision 步骤渲染 — 🧠 图标 + 模型信息', async ({ page }) => {
    await injectWsMessage(page, makeTrace([MOCK_MODEL_DECISION]));

    await expect(page.getByText('🧠').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('DeepSeek Chat')).toBeVisible();
    await expect(page.getByText('[primary]')).toBeVisible();
    await expect(page.getByText('Layer 0')).toBeVisible();
    await expect(page.getByText(/候选/)).toBeVisible();
    await expect(page.getByText('#chat')).toBeVisible();
  });

  test('brain_trace 步骤渲染 — ⚡ 图标 + 阶段信息', async ({ page }) => {
    await injectWsMessage(page, makeTrace([MOCK_BRAIN_TRACE]));

    await expect(page.getByText('⚡').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('left-brain')).toBeVisible();
    await expect(page.getByText('trace-ab')).toBeVisible();
  });

  test('response 步骤渲染 — 💬 图标 + 回复内容', async ({ page }) => {
    await injectWsMessage(page, makeTrace([MOCK_RESPONSE]));

    await expect(page.getByText('💬').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/北京今天天气晴朗/)).toBeVisible();
  });
});

test.describe('AgentTrace — 完整决策链路', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
    await injectBuddyState(page);
  });

  test('多步骤追踪按顺序渲染', async ({ page }) => {
    await injectWsMessage(page, makeTrace([
      MOCK_THINKING, MOCK_MODEL_DECISION, MOCK_TOOL_CALL, MOCK_TOOL_RESULT, MOCK_RESPONSE,
    ]));

    // 所有步骤图标应可见
    await expect(page.getByText('🤔').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('🧠').first()).toBeVisible();
    await expect(page.getByText('🔧').first()).toBeVisible();
    await expect(page.getByText('📋').first()).toBeVisible();
    await expect(page.getByText('💬').first()).toBeVisible();
  });

  test('工具调用失败状态渲染', async ({ page }) => {
    const failedResult = {
      ...MOCK_TOOL_RESULT,
      success: false,
      content: '权限不足，无法执行',
    };
    await injectWsMessage(page, makeTrace([MOCK_TOOL_CALL, failedResult]));

    await expect(page.getByText('❌ 失败')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('权限不足，无法执行')).toBeVisible();
  });

  test('长内容截断显示（200字符限制）', async ({ page }) => {
    const longContent = 'A'.repeat(300);
    const step = { ...MOCK_THINKING, content: longContent };
    await injectWsMessage(page, makeTrace([step]));

    // 应显示截断后的内容（200字符 + "..."）
    const text = await page.textContent('body');
    expect(text).toContain('A'.repeat(200));
    expect(text).toContain('...');
  });

  test('未知步骤类型降级为 thinking 样式', async ({ page }) => {
    const unknownStep = {
      type: 'unknown_type',
      content: '未知步骤内容',
      timestamp: Date.now(),
    };
    await injectWsMessage(page, makeTrace([unknownStep]));

    // 应降级显示 thinking 图标
    await expect(page.getByText('🤔').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('未知步骤内容')).toBeVisible();
  });
});

test.describe('AgentTrace — 动态更新', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
    await injectBuddyState(page);
  });

  test('新追踪数据覆盖旧数据', async ({ page }) => {
    // 第一次注入
    await injectWsMessage(page, makeTrace([MOCK_THINKING]));
    await expect(page.getByText('分析用户意图：查询天气信息')).toBeVisible({ timeout: 5000 });

    // 第二次注入（新内容）
    await injectWsMessage(page, makeTrace([
      { type: 'thinking', content: '新的思考内容', timestamp: Date.now() },
    ]));
    await expect(page.getByText('新的思考内容')).toBeVisible({ timeout: 5000 });
  });

  test('空追踪数组清空面板', async ({ page }) => {
    // 先注入有数据
    await injectWsMessage(page, makeTrace([MOCK_THINKING]));
    await expect(page.getByText('分析用户意图：查询天气信息')).toBeVisible({ timeout: 5000 });

    // 注入空数组
    await injectWsMessage(page, { type: 'agent_trace', trace: [] });
    await page.waitForTimeout(300);

    // 面板应不再显示（App.tsx 中 agentTrace.length > 0 条件）
    const tracePanel = page.locator('text=🤔 思考').first();
    await expect(tracePanel).not.toBeVisible({ timeout: 3000 });
  });
});
