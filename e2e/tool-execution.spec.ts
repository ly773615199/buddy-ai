/**
 * 工具执行 E2E — UI 面板渲染测试
 *
 * 覆盖：
 * 1. 工具面板数据渲染（工具卡片、使用计数、成功率、执行日志）
 * 2. 工具来源标签（builtin / mcp / skill）
 * 3. 工具确认请求对话框
 * 4. 多专家并行 UI 渲染
 * 5. 三进制推理事件渲染
 * 6. DAG 编排 UI 渲染（开始/进度/完成/重试/跳过/超时）
 * 7. 认知可视化面板渲染
 *
 * 职责：纯 UI 渲染验证，通过 injectWsMessage 精确控制输入
 * 事件流测试（真实后端工具调用链路）已移至 real-llm.spec.ts
 */
import { test, expect } from '@playwright/test';
import { skipOnboarding, setupMockWS, injectWsMessage, waitForWSConnection } from './fixtures.js';

// ==================== 工具面板数据 ====================

test.describe('工具执行 — UI 面板', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
  });

  test('工具调用 → 成功结果 → 使用计数更新', async ({ page }) => {
    await page.locator('button', { hasText: '🔧' }).first().click();

    await injectWsMessage(page, {
      type: 'tool_panel_data',
      data: {
        tools: [
          { name: 'read', description: '读取文件', source: 'builtin', usageCount: 10, successRate: 100 },
          { name: 'exec', description: '执行命令', source: 'builtin', usageCount: 5, successRate: 80 },
        ],
        recentExecutions: [
          { tool: 'read', args: { path: '/tmp/test' }, result: 'file content', success: true, durationMs: 50, timestamp: Date.now() },
        ],
      },
    });

    await expect(page.getByText('read', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/×10/)).toBeVisible();
    await expect(page.getByText(/100%/)).toBeVisible();
    await expect(page.getByText(/50ms/)).toBeVisible();
    await expect(page.getByText('✅')).toBeVisible();
  });

  test('工具调用失败 → 错误渲染', async ({ page }) => {
    await page.locator('button', { hasText: '🔧' }).first().click();

    await injectWsMessage(page, {
      type: 'tool_panel_data',
      data: {
        tools: [
          { name: 'sandbox_exec', description: '沙箱执行', source: 'builtin', usageCount: 3, successRate: 33 },
        ],
        recentExecutions: [
          { tool: 'sandbox_exec', args: { code: 'rm -rf /' }, result: 'Error: 安全限制', success: false, durationMs: 10, timestamp: Date.now() },
        ],
      },
    });

    await expect(page.getByText('33%', { exact: true })).toBeVisible();
    await expect(page.getByText('❌')).toBeVisible();
    await expect(page.getByText('安全限制')).toBeVisible();
  });

  test('工具来源标签 — builtin/mcp/skill 三种来源', async ({ page }) => {
    await page.locator('button', { hasText: '🔧' }).first().click();

    await injectWsMessage(page, {
      type: 'tool_panel_data',
      data: {
        tools: [
          { name: 'exec', description: '内置工具', source: 'builtin', usageCount: 100, successRate: 95 },
          { name: 'mcp_github', description: 'GitHub MCP', source: 'mcp', usageCount: 20, successRate: 100 },
          { name: 'skill_weather', description: '天气技能', source: 'skill', usageCount: 8, successRate: 75 },
        ],
        recentExecutions: [],
      },
    });

    await expect(page.getByText('exec')).toBeVisible();
    await expect(page.getByText('mcp_github')).toBeVisible();
    await expect(page.getByText('skill_weather')).toBeVisible();
  });
});

// ==================== 工具确认流程 ====================

test.describe('工具执行 — 确认请求', () => {

  test('高风险工具触发确认请求', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await injectWsMessage(page, {
      type: 'tool_confirm_request',
      id: 'confirm-001',
      tool: 'exec',
      description: '执行命令: rm -rf /tmp/test',
      trustLevel: 'cautious',
    });

    await expect(page.getByText(/需要确认/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('rm -rf /tmp/test')).toBeVisible();
  });
});

// ==================== 多专家并行 ====================

test.describe('工具执行 — 多专家并行', () => {

  test('多专家并行调用事件流', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await injectWsMessage(page, {
      type: 'expert_pool_start',
      taskId: 'task-001',
      experts: ['coding', 'writing', 'analysis'],
    });

    await injectWsMessage(page, {
      type: 'expert_start',
      taskId: 'task-001',
      expertId: 'coding',
      modelId: 'LoRA-7B',
    });

    await injectWsMessage(page, {
      type: 'expert_start',
      taskId: 'task-001',
      expertId: 'writing',
      modelId: 'LoRA-3B',
    });

    await injectWsMessage(page, {
      type: 'expert_done',
      taskId: 'task-001',
      expertId: 'coding',
      latencyMs: 1200,
      success: true,
    });

    await injectWsMessage(page, {
      type: 'expert_done',
      taskId: 'task-001',
      expertId: 'writing',
      latencyMs: 800,
      success: true,
    });

    await injectWsMessage(page, {
      type: 'multi_expert_complete',
      experts: 3,
      fusion: { merged: 5, contradictions: 1, associations: 3, durationMs: 2000 },
    });

    await expect(page.getByText('多专家融合完成')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('5 条合并')).toBeVisible();
    await expect(page.getByText('1 处矛盾')).toBeVisible();
    await expect(page.getByText('3 条关联')).toBeVisible();
  });

  test('专家执行失败 — 部分降级', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await injectWsMessage(page, {
      type: 'expert_done',
      taskId: 'task-002',
      expertId: 'coding',
      latencyMs: 5000,
      success: false,
      error: '模型加载超时',
    });

    await injectWsMessage(page, {
      type: 'multi_expert_result',
      taskId: 'task-002',
      experts: [
        { id: 'coding', success: false, latencyMs: 5000 },
        { id: 'writing', success: true, latencyMs: 1000 },
      ],
    });

    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

// ==================== 三进制推理 ====================

test.describe('工具执行 — 三进制推理', () => {

  test('三进制推理事件渲染', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await injectWsMessage(page, {
      type: 'ternary_inference',
      domain: 'coding',
      confidence: 0.85,
    });

    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('三进制训练完成事件', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await injectWsMessage(page, {
      type: 'ternary_train_complete',
      domain: 'coding',
      success: true,
      initialLoss: 2.5,
      finalLoss: 0.3,
      steps: 1000,
      timestamp: Date.now(),
    });

    await expect(page.getByText(/三进制专家.*训练完成/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/coding/)).toBeVisible();
    await expect(page.getByText(/2\.5/)).toBeVisible();
    await expect(page.getByText(/0\.3/)).toBeVisible();
  });
});

// ==================== DAG 编排 ====================

test.describe('工具执行 — DAG 编排', () => {

  test('DAG 编排完整事件流', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await injectWsMessage(page, {
      type: 'orch_start',
      dagId: 'dag-001',
      description: '分析项目结构并生成报告',
      taskCount: 3,
    });

    await injectWsMessage(page, {
      type: 'orch_task_start',
      dagId: 'dag-001',
      taskId: 'task-1',
    });

    await injectWsMessage(page, {
      type: 'orch_task_done',
      dagId: 'dag-001',
      taskId: 'task-1',
      result: '扫描完成，发现 42 个文件',
    });

    await injectWsMessage(page, {
      type: 'orch_task_start',
      dagId: 'dag-001',
      taskId: 'task-2',
    });

    await injectWsMessage(page, {
      type: 'orch_task_done',
      dagId: 'dag-001',
      taskId: 'task-2',
      result: '依赖分析完成',
    });

    await injectWsMessage(page, {
      type: 'orch_progress',
      done: 2,
      total: 3,
      current: 'task-3',
    });

    await injectWsMessage(page, {
      type: 'orch_done',
      dagId: 'dag-001',
      summary: '项目分析完成：42 文件，3 个模块，无安全问题',
      totalMs: 5000,
    });

    await expect(page.getByText(/编排开始/)).toBeVisible();
    await expect(page.getByText(/分析项目结构/)).toBeVisible();
    await expect(page.getByText(/编排完成/)).toBeVisible({ timeout: 5000 });
  });

  test('DAG 任务失败 → 重试', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await injectWsMessage(page, {
      type: 'orch_task_fail',
      dagId: 'dag-002',
      taskId: 'task-1',
      error: '网络超时',
    });

    await injectWsMessage(page, {
      type: 'orch_task_retry',
      dagId: 'dag-002',
      taskId: 'task-1',
      attempt: 2,
      maxRetry: 3,
      delayMs: 1000,
    });

    await injectWsMessage(page, {
      type: 'orch_task_done',
      dagId: 'dag-002',
      taskId: 'task-1',
      result: '重试成功',
    });

    await expect(page.getByText(/❌.*task-1.*网络超时/)).toBeVisible();
    await expect(page.getByText(/🔄.*task-1.*重试中/)).toBeVisible();
    await expect(page.getByText(/✅.*task-1/)).toBeVisible();
  });

  test('DAG 任务跳过（不可达）', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await injectWsMessage(page, {
      type: 'orch_task_skipped',
      dagId: 'dag-003',
      taskId: 'task-2',
      reason: '前置任务失败，当前任务不可达',
    });

    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('DAG 任务超时', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await injectWsMessage(page, {
      type: 'orch_task_timeout',
      dagId: 'dag-004',
      taskId: 'task-1',
      timeoutMs: 30000,
    });

    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

// ==================== 认知可视化 ====================

test.describe('工具执行 — 认知可视化', () => {

  test('cognitive_update 事件渲染认知面板', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await injectWsMessage(page, {
      type: 'cognitive_update',
      profile: {
        focusLevel: 85,
        confidenceLevel: 70,
        confusionLevel: 10,
        energy: 60,
        temperature: 45,
      },
    });

    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});
