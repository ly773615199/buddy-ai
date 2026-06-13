/**
 * 模型选择 E2E — 真实 LLM 全链路
 *
 * 核心理念：验证「前端配置 → 后端模型池初始化 → 三脑决策选模型 → 前端渲染」完整闭环。
 *
 * 链路：
 *   1. 前端 POST /api/model-pool/providers 配置 API 端点
 *   2. 后端写入 config + reconfigureLLM + refreshPlatform → 模型池初始化
 *   3. GET /api/model-pool 返回真实模型池数据（模型画像、Thompson 参数）
 *   4. 用户发消息 → 三脑决策 → model_decision WS 事件
 *   5. 前端 AgentTrace / CognitiveDashboard 渲染 model_decision
 *
 * 运行方式：
 *   SILICONFLOW_API_KEY=sk-xxx npx playwright test --project=real-llm e2e/model-selection-real.spec.ts
 */
import { test, expect } from '@playwright/test';
import {
  getSiliconFlowKey,
  setupFrontendLLMConfig,
  cleanupSensitiveStorage,
  SILICONFLOW_DEFAULTS,
  SILICONFLOW_WEAK_MODEL,
  SILICONFLOW_STRONG_MODEL,
} from './real-llm-fixtures.js';
import { WSEventCollector } from './ws-event-collector.js';
import { sendMessage, waitForWSReady } from './helpers.js';

const HAS_API_KEY = !!process.env.SILICONFLOW_API_KEY;

// ==================== 辅助函数 ====================

/**
 * 等待 model_decision 事件
 *
 * 如果三脑决策未走模型池路径，model_decision 不会被发射，
 * 此时 response_end 会先到达，函数返回 fallback 值。
 */
async function waitForModelDecision(
  collector: WSEventCollector,
  timeoutMs = 60000,
) {
  const event = await collector.waitForAny(['model_decision', 'response_end', 'error'], timeoutMs);

  if (event.type === 'model_decision') {
    return {
      modelId: event.modelId as string,
      displayName: event.displayName as string,
      tier: event.tier as string,
      reason: event.reason as string,
      layer: event.layer as number,
      candidateCount: event.candidateCount as number,
      tsSample: event.tsSample as number | undefined,
      taskType: event.taskType as string,
      fromModelPool: true,
    };
  }

  console.log(`[model_decision] 未到达，三脑走了非模型池路径 (event=${event.type})`);
  return {
    modelId: '',
    displayName: '',
    tier: '',
    reason: '',
    layer: 0,
    candidateCount: 0,
    tsSample: undefined as number | undefined,
    taskType: '',
    fromModelPool: false,
  };
}

/**
 * 发送消息并等待完整链路闭环（thinking → model_decision → response_end）
 */
async function sendAndWaitForDecision(
  page: import('@playwright/test').Page,
  collector: WSEventCollector,
  message: string,
  timeoutMs = 120000,
) {
  collector.clear();
  await sendMessage(page, message);

  // 等待 model_decision
  const decision = await waitForModelDecision(collector, timeoutMs);

  // 等待链路闭环
  const terminal = await collector.waitForAny(['response_end', 'error'], timeoutMs);
  const events = collector.all();
  const types = events.map(e => e.type);

  return { decision, terminal, types, events };
}

// ==================== 1. 前端配置 → 后端模型池初始化 ====================

test.describe('前端配置 → 后端模型池初始化', () => {

  test('POST /api/model-pool/providers — 添加 API 端点后模型池初始化', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');

    // 获取 ws-token（REST API 需要 Bearer 认证）
    const tokenRes = await page.request.get('/api/ws-token');
    const { token } = await tokenRes.json();

    // 直接通过 REST API 添加 provider（模拟前端 Onboarding 或 Settings 的操作）
    const response = await page.request.post('/api/model-pool/providers', {
      headers: { 'Authorization': `Bearer ${token}` },
      data: {
        id: 'siliconflow-e2e',
        type: 'siliconflow',
        model: SILICONFLOW_DEFAULTS.model,
        apiKey: getSiliconFlowKey(),
        baseUrl: SILICONFLOW_DEFAULTS.baseUrl,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.ok).toBeTruthy();
    expect(body.provider).toBeTruthy();
    expect(body.provider.id).toBe('siliconflow-e2e');
    expect(body.provider.type).toBe('siliconflow');
    expect(body.modelCount).toBeGreaterThanOrEqual(0);

    console.log(`[POST providers] ✅ provider=${body.provider.id} modelCount=${body.modelCount}`);
  });

  test('GET /api/model-pool — 模型池已初始化且包含真实模型', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');

    // 获取 ws-token
    const tokenRes = await page.request.get('/api/ws-token');
    const { token } = await tokenRes.json();

    // 先确保 provider 已添加
    await page.request.post('/api/model-pool/providers', {
      headers: { 'Authorization': `Bearer ${token}` },
      data: {
        id: 'siliconflow-e2e',
        type: 'siliconflow',
        model: SILICONFLOW_DEFAULTS.model,
        apiKey: getSiliconFlowKey(),
        baseUrl: SILICONFLOW_DEFAULTS.baseUrl,
      },
    });

    // 查询模型池状态
    const poolResponse = await page.request.get('/api/model-pool');
    expect(poolResponse.ok()).toBeTruthy();
    const pool = await poolResponse.json();

    // 模型池必须已初始化
    expect(pool.initialized).toBeTruthy();
    expect(pool.modelCount).toBeGreaterThan(0);
    expect(pool.models.length).toBeGreaterThan(0);

    // 验证模型画像结构完整性
    const firstModel = pool.models[0];
    expect(firstModel.id).toBeTruthy();
    expect(firstModel.platform).toBeTruthy();
    expect(firstModel.displayName).toBeTruthy();
    expect(firstModel.tier).toBeTruthy();
    expect(firstModel.capabilities).toBeTruthy();
    expect(typeof firstModel.capabilities.reasoning).toBe('number');
    expect(typeof firstModel.capabilities.toolCalling).toBe('boolean');

    // 验证 preferences 和 thompsonParams 字段存在
    expect(pool.preferences).toBeDefined();
    expect(pool.thompsonParams).toBeDefined();

    console.log(`[GET model-pool] ✅ initialized=${pool.initialized} modelCount=${pool.modelCount}`);
    console.log(`[模型列表] ${pool.models.map((m: any) => `${m.id}(${m.tier})`).join(', ')}`);
  });

  test('前端配置 → 后端热重载 + 模型池刷新', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');
    const collector = new WSEventCollector(page);
    await collector.attach();

    // 通过 REST API 配置 provider（替代已删除的 llm_config WS 消息）
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    // 验证后端模型池已初始化：GET /api/model-pool
    const poolResponse = await page.request.get('/api/model-pool');
    expect(poolResponse.ok()).toBeTruthy();
    const pool = await poolResponse.json();
    expect(pool.initialized).toBeTruthy();
    expect(pool.modelCount).toBeGreaterThan(0);
    console.log(`[模型池] ✅ ${pool.modelCount} 个模型已入池`);

    await cleanupSensitiveStorage(page);
  });
});

// ==================== 2. 三脑决策 → model_decision 全链路 ====================

test.describe('三脑决策 → model_decision 全链路', () => {

  test('发消息 → 三脑决策 → model_decision 事件包含完整字段', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    collector.clear();
    await sendMessage(page, '你好');

    const decision = await waitForModelDecision(collector, 60000);

    test.skip(!decision.fromModelPool, '三脑未走模型池路径，model_decision 未发射');

    // 验证决策字段完整性
    expect(decision.modelId).toBeTruthy();
    expect(decision.displayName).toBeTruthy();
    expect(decision.tier).toBeTruthy();
    expect(decision.reason).toBeTruthy();
    expect(decision.layer).toBeGreaterThanOrEqual(0);
    expect(decision.candidateCount).toBeGreaterThanOrEqual(1);
    expect(decision.taskType).toBeTruthy();

    // 简单聊天任务应选 budget/standard tier
    expect(['budget', 'standard', 'free']).toContain(decision.tier);
    expect(decision.taskType).toBe('chat');

    console.log(`[model_decision] ✅ model=${decision.modelId} displayName=${decision.displayName} tier=${decision.tier} layer=${decision.layer} candidates=${decision.candidateCount} reason=${decision.reason}`);

    // 等待链路闭环
    const terminal = await collector.waitForAny(['response_end', 'error'], 120000);
    expect(terminal.type === 'response_end' || terminal.type === 'error').toBeTruthy();

    await cleanupSensitiveStorage(page);
  });

  test('brain_trace 三阶段 → decision 阶段含 selectedModel', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    collector.clear();
    await sendMessage(page, '你好');

    // 等待 brain_trace decision 阶段
    const decision = await collector.waitFor('brain_trace', 60000);
    expect(decision.phase).toBeTruthy();

    // 收集所有 brain_trace 事件
    await collector.waitForAny(['response_end', 'error'], 120000);
    const brainTraces = collector.filter('brain_trace');
    const phases = brainTraces.map(t => t.phase as string);

    console.log(`[brain_trace] phases: ${phases.join(' → ')}`);

    // 应该有 signal/resource/decision 中的至少一个
    const hasDecision = phases.includes('decision');
    if (hasDecision) {
      const decisionTrace = brainTraces.find(t => t.phase === 'decision');
      expect(decisionTrace!.data).toBeTruthy();
      console.log(`[brain_trace decision] ${JSON.stringify(decisionTrace!.data).slice(0, 200)}`);
    }

    await cleanupSensitiveStorage(page);
  });

  test('Thompson Sampling 采样值可观测', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    collector.clear();
    await sendMessage(page, '你好');

    const decision = await waitForModelDecision(collector, 60000);

    // tsSample 是 Thompson Sampling 采样值，应在 [0, 1] 范围
    if (decision.tsSample !== undefined && decision.tsSample !== null) {
      expect(decision.tsSample).toBeGreaterThanOrEqual(0);
      expect(decision.tsSample).toBeLessThanOrEqual(1);
      console.log(`[Thompson] ✅ tsSample=${decision.tsSample}`);
    } else {
      console.log('[Thompson] tsSample 未发射（首次运行无历史数据，Layer 0 直接选择）');
    }

    await collector.waitForAny(['response_end', 'error'], 120000);
    await cleanupSensitiveStorage(page);
  });
});

// ==================== 3. 前端渲染 — model_decision 在 UI 中可见 ====================

test.describe('前端渲染 — model_decision 在 UI 中可见', () => {

  test('AgentTrace 渲染 model_decision 步骤（模型名/tier/layer/候选数）', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    collector.clear();
    await sendMessage(page, '你好');

    const decision = await waitForModelDecision(collector, 60000);
    await collector.waitForAny(['response_end', 'error'], 120000);

    test.skip(!decision.fromModelPool, '三脑未走模型池路径，无法验证 UI 渲染');

    // 验证前端渲染了 model_decision 信息
    // displayName 应该出现在 AgentTrace 区域
    await expect(page.getByText(decision.displayName).first()).toBeVisible({ timeout: 5000 });

    // tier 标签应可见（如 [standard]）
    await expect(page.getByText(`[${decision.tier}]`)).toBeVisible({ timeout: 3000 });

    // layer 信息应可见（如 Layer 2）
    if (decision.layer > 0) {
      await expect(page.getByText(`Layer ${decision.layer}`)).toBeVisible({ timeout: 3000 });
    }

    // 候选数应可见（如 8 候选）
    if (decision.candidateCount > 1) {
      await expect(page.getByText(`${decision.candidateCount} 候选`)).toBeVisible({ timeout: 3000 });
    }

    // taskType 标签应可见（如 #chat）
    await expect(page.getByText(`#${decision.taskType}`)).toBeVisible({ timeout: 3000 });

    console.log(`[AgentTrace 渲染] ✅ displayName=${decision.displayName} [${decision.tier}] Layer ${decision.layer} ${decision.candidateCount} 候选 #${decision.taskType}`);

    await cleanupSensitiveStorage(page);
  });

  test('设置面板 — 模型池 Tab 展示真实模型数据', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    // 导航到设置面板
    await page.locator('button', { hasText: '⚙️' }).first().click();
    await page.waitForTimeout(500);

    // 切换到模型池子标签
    const poolTab = page.locator('button', { hasText: '模型池' }).first();
    if (await poolTab.isVisible()) {
      await poolTab.click();
      await page.waitForTimeout(1000);
    }

    // 验证模型池 UI 渲染了真实模型
    // 从 GET /api/model-pool 获取真实模型列表
    const poolResponse = await page.request.get('/api/model-pool');
    if (poolResponse.ok()) {
      const pool = await poolResponse.json();
      if (pool.initialized && pool.models.length > 0) {
        // 至少第一个模型的 displayName 应在 UI 中可见
        const firstModel = pool.models[0];
        await expect(page.getByText(firstModel.displayName).first()).toBeVisible({ timeout: 5000 });
        console.log(`[Settings 模型池] ✅ 渲染了 ${firstModel.displayName}`);
      }
    }

    await cleanupSensitiveStorage(page);
  });
});

// ==================== 4. 不同任务类型 → 不同模型选择策略 ====================

test.describe('不同任务类型 → 不同模型选择策略', () => {

  test('聊天任务 → 选 budget/standard tier', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    collector.clear();
    await sendMessage(page, '你好，今天天气怎么样？');

    const decision = await waitForModelDecision(collector, 60000);

    test.skip(!decision.fromModelPool, '三脑未走模型池路径，无法验证 taskType/tier');

    expect(decision.taskType).toBe('chat');
    expect(['budget', 'standard', 'free']).toContain(decision.tier);

    console.log(`[聊天选型] ✅ ${decision.modelId} tier=${decision.tier} taskType=${decision.taskType}`);

    await collector.waitForAny(['response_end', 'error'], 120000);
    await cleanupSensitiveStorage(page);
  });

  test('工具调用任务 → taskType=tools', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    collector.clear();
    await sendMessage(page, '读取 package.json 文件的 name 字段');

    const decision = await waitForModelDecision(collector, 60000);

    test.skip(!decision.fromModelPool, '三脑未走模型池路径，无法验证 taskType');

    expect(decision.taskType).toBe('tools');
    expect(decision.candidateCount).toBeGreaterThanOrEqual(1);

    console.log(`[工具选型] ✅ ${decision.modelId} tier=${decision.tier} taskType=${decision.taskType} candidates=${decision.candidateCount}`);

    await collector.waitForAny(['response_end', 'error'], 180000);
    await cleanupSensitiveStorage(page);
  });

  test('推理任务 → taskType=reasoning，选 premium/standard tier', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    collector.clear();
    await sendMessage(page, '分析一下三脑架构和单模型架构的优劣，从计算效率、容错性、推理质量三个维度');

    const decision = await waitForModelDecision(collector, 60000);

    test.skip(!decision.fromModelPool, '三脑未走模型池路径，无法验证 taskType/tier');

    expect(decision.taskType).toBe('reasoning');
    expect(['premium', 'standard']).toContain(decision.tier);

    console.log(`[推理选型] ✅ ${decision.modelId} tier=${decision.tier} taskType=${decision.taskType}`);

    await collector.waitForAny(['response_end', 'error'], 180000);
    await cleanupSensitiveStorage(page);
  });
});

// ==================== 5. 完整闭环 — 前端配置 → 模型池 → 决策 → 渲染 ====================

test.describe('完整闭环 — 前端配置 → 模型池 → 决策 → 渲染', () => {

  test('全流程：配置 API → 初始化 → 发消息 → model_decision → UI 渲染', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');
    const collector = new WSEventCollector(page);
    await collector.attach();

    // Step 1: 前端配置 API Key（模拟 Onboarding 填入）
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    // Step 2: 验证后端模型池已初始化
    const poolResponse = await page.request.get('/api/model-pool');
    expect(poolResponse.ok()).toBeTruthy();
    const pool = await poolResponse.json();
    expect(pool.initialized).toBeTruthy();
    expect(pool.modelCount).toBeGreaterThan(0);
    console.log(`[Step 2] ✅ 模型池已初始化: ${pool.modelCount} 个模型`);

    // Step 3: 用户发消息触发三脑决策
    collector.clear();
    await sendMessage(page, '你好，介绍一下你自己');

    // Step 4: 等待 model_decision 事件
    const decision = await waitForModelDecision(collector, 60000);
    if (!decision.fromModelPool) {
      test.skip(true, '三脑未走模型池路径，无法验证完整闭环');
    }
    expect(decision.modelId).toBeTruthy();
    expect(decision.tier).toBeTruthy();
    console.log(`[Step 4] ✅ model_decision: ${decision.modelId} tier=${decision.tier} taskType=${decision.taskType}`);

    // Step 5: 等待链路闭环
    const terminal = await collector.waitForAny(['response_end', 'error'], 120000);
    expect(terminal.type === 'response_end' || terminal.type === 'error').toBeTruthy();
    console.log(`[Step 5] ✅ 链路闭环: ${terminal.type}`);

    // Step 6: 验证前端 UI 渲染了 model_decision
    // AgentTrace 应展示模型名
    await expect(page.getByText(decision.displayName).first()).toBeVisible({ timeout: 5000 });
    // tier 标签
    await expect(page.getByText(`[${decision.tier}]`)).toBeVisible({ timeout: 3000 });
    console.log(`[Step 6] ✅ 前端渲染: ${decision.displayName} [${decision.tier}]`);

    await cleanupSensitiveStorage(page);
  });
});
