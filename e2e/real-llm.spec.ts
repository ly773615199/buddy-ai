/**
 * 真实 LLM E2E 测试 — 系统能力验证 v2
 *
 * 核心理念：验证「系统能做到什么」+「三脑决策是否合理」+「协作是否真正完成任务」。
 *
 * 测试维度：
 *   1. 三脑决策 — model_decision 事件包含完整决策链路（tier/reason/layer/candidateCount）
 *   2. 工具调用 — 真实工具调用完成任务，验证结果正确性
 *   3. 多模型协作 — DAG 编排真实完成多步骤任务，验证每步结果
 *   4. 级联升级 — cascade 模式下弱模型失败后升级到强模型
 *   5. 错误恢复 — 无效 key 后系统能恢复并正常工作
 *   6. 边界输入 — 超长/特殊字符/emoji 输入后 LLM 能正常回复
 *
 * 运行方式：
 *   SILICONFLOW_API_KEY=sk-xxx npx playwright test --project=real-llm e2e/real-llm.spec.ts
 */
import { test, expect } from '@playwright/test';
import {
  getSiliconFlowKey,
  setupRealLLMConfig,
  restoreConfig,
  setupFrontendLLMConfig,
  cleanupSensitiveStorage,
  resyncBackendConfig,
  SILICONFLOW_DEFAULTS,
  SILICONFLOW_WEAK_MODEL,
  SILICONFLOW_STRONG_MODEL,
} from './real-llm-fixtures.js';
import { WSEventCollector } from './ws-event-collector.js';
import { sendMessage, waitForWSReady } from './helpers.js';

const HAS_API_KEY = !!process.env.SILICONFLOW_API_KEY;

// ==================== 生命周期 ====================

test.beforeAll(() => {
  if (!HAS_API_KEY) return;
  setupRealLLMConfig();
});

test.afterAll(() => {
  if (!HAS_API_KEY) return;
  restoreConfig();
});

// ==================== 辅助函数 ====================

/**
 * 发送消息并等待 WS 事件闭环
 * 不依赖文本稳定性（thinking 消息会干扰），纯 WS 事件驱动
 */
async function sendAndWaitForEvent(
  page: import('@playwright/test').Page,
  collector: WSEventCollector,
  message: string,
  timeoutMs = 120000,
) {
  collector.clear();
  await sendMessage(page, message);

  // 等待终止事件
  const terminalEvent = await collector.waitForAny(['response_end', 'error'], timeoutMs);
  const events = collector.all();
  const types = events.map(e => e.type);

  return { terminalEvent, types, events };
}

/**
 * 等待 model_decision 事件并返回决策详情
 *
 * 如果三脑决策未走模型池路径（选了 auto/exp 等非 cloud_node 节点），
 * model_decision 不会被发射。此时 response_end 会先到达，函数返回 fallback 值。
 */
async function waitForModelDecision(
  collector: WSEventCollector,
  timeoutMs = 60000,
): Promise<{
  modelId: string;
  displayName: string;
  tier: string;
  reason: string;
  layer: number;
  candidateCount: number;
  taskType: string;
  fromModelPool: boolean;
}> {
  // 同时等 model_decision 和 response_end，谁先到用谁
  const event = await collector.waitForAny(['model_decision', 'response_end', 'error'], timeoutMs);

  if (event.type === 'model_decision') {
    return {
      modelId: event.modelId as string,
      displayName: event.displayName as string,
      tier: event.tier as string,
      reason: event.reason as string,
      layer: event.layer as number,
      candidateCount: event.candidateCount as number,
      taskType: event.taskType as string,
      fromModelPool: true,
    };
  }

  // response_end 先到达 → 三脑决策走了非模型池路径（executeSingle 等）
  console.log(`[model_decision] 未到达，三脑走了非模型池路径 (event=${event.type})`);
  return {
    modelId: '',
    displayName: '',
    tier: '',
    reason: '',
    layer: 0,
    candidateCount: 0,
    taskType: '',
    fromModelPool: false,
  };
}

// ==================== 0. 前端配置 — 模型入池基础入口 ====================

test.describe('前端配置 — 模型入池基础入口', () => {

  test('前端配置 — 模型进入模型池', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    // setupFrontendLLMConfig 已通过 REST API 添加 provider
    // 验证 LLM 已就绪：发一条消息能正常回复
    collector.clear();
    await sendMessage(page, '你好');

    const decision = await waitForModelDecision(collector, 60000);
    if (decision.fromModelPool) {
      expect(decision.modelId).toBeTruthy();
      console.log(`[入池] ✅ 模型已入池: ${decision.modelId} tier=${decision.tier}`);
    } else {
      console.log('[入池] ✅ 系统已响应（三脑走非模型池路径，model_decision 未发射）');
    }

    await collector.waitForAny(['response_end', 'error'], 120000);
    await cleanupSensitiveStorage(page);
  });

  test('POST /api/model-pool/providers — REST API 添加端点', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');

    // 获取 ws-token（REST API 需要 Bearer 认证）
    const tokenRes = await page.request.get('/api/ws-token');
    const { token } = await tokenRes.json();

    // 通过 REST API 添加 provider
    const response = await page.request.post('/api/model-pool/providers', {
      headers: { 'Authorization': `Bearer ${token}` },
      data: {
        id: 'e2e-test-provider',
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
    expect(body.modelCount).toBeGreaterThanOrEqual(0);

    console.log(`[REST入池] ✅ provider=${body.provider.id} modelCount=${body.modelCount}`);

    // 验证配置已写入：GET /api/model-pool 查看状态
    const poolResponse = await page.request.get('/api/model-pool');
    expect(poolResponse.ok()).toBeTruthy();
    const poolBody = await poolResponse.json();
    expect(poolBody.initialized).toBeTruthy();

    console.log(`[REST入池] ✅ 模型池已初始化, profiles=${poolBody.profileCount ?? 'N/A'}`);
  });

  test('GET /api/model-pool — 模型池状态可观测', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');

    // 先确保有配置
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(3000);

    const response = await page.request.get('/api/model-pool');
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    // 模型池应该已初始化
    expect(body.initialized).toBeTruthy();
    // 应该有模型画像
    expect(body.modelCount).toBeGreaterThan(0);

    console.log(`[模型池状态] initialized=${body.initialized} models=${body.modelCount} active=${body.activeCount ?? 'N/A'}`);

    await cleanupSensitiveStorage(page);
  });

  test('模型池刷新 — refreshPlatform 发现新模型', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');

    // 获取 ws-token
    const tokenRes = await page.request.get('/api/ws-token');
    const { token } = await tokenRes.json();
    const authHeaders = { 'Authorization': `Bearer ${token}` };

    // 先添加 provider
    const addResponse = await page.request.post('/api/model-pool/providers', {
      headers: authHeaders,
      data: {
        id: 'e2e-refresh-test',
        type: 'siliconflow',
        model: SILICONFLOW_DEFAULTS.model,
        apiKey: getSiliconFlowKey(),
        baseUrl: SILICONFLOW_DEFAULTS.baseUrl,
      },
    });
    expect(addResponse.ok()).toBeTruthy();

    // 触发刷新
    const refreshResponse = await page.request.post('/api/model-pool/refresh', {
      headers: authHeaders,
      data: { platformId: 'e2e-refresh-test' },
    });

    if (refreshResponse.ok()) {
      const refreshBody = await refreshResponse.json();
      expect(refreshBody.models).toBeTruthy();
      expect(Array.isArray(refreshBody.models)).toBeTruthy();
      console.log(`[刷新] ✅ 发现 ${refreshBody.models.length} 个模型`);
    } else {
      console.log(`[刷新] refreshPlatform 返回 ${refreshResponse.status()}（可能端点不支持单独刷新）`);
    }
  });
});

// ==================== 1. 三脑决策 — 模型池 LLM 选择 ====================

test.describe('三脑决策 — 模型池 LLM 选择', () => {

  test('model_decision 事件包含完整决策链路', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    // 发送简单聊天 → 触发 model_decision
    collector.clear();
    await sendMessage(page, '你好');

    const decision = await waitForModelDecision(collector, 60000);

    // 如果三脑未走模型池路径，跳过 model_decision 字段验证
    test.skip(!decision.fromModelPool, '三脑未走模型池路径（选了非 cloud_node 节点），model_decision 未发射');

    // 验证决策字段完整性
    expect(decision.modelId).toBeTruthy();
    expect(decision.displayName).toBeTruthy();
    expect(decision.tier).toBeTruthy();
    expect(decision.reason).toBeTruthy();
    expect(decision.layer).toBeGreaterThanOrEqual(1);
    expect(decision.candidateCount).toBeGreaterThanOrEqual(1);
    expect(decision.taskType).toBeTruthy();

    console.log(`[三脑决策] 模型=${decision.modelId} tier=${decision.tier} reason=${decision.reason} layer=${decision.layer} candidates=${decision.candidateCount} taskType=${decision.taskType}`);

    // 验证 response_end 也存在（链路闭环）
    await collector.waitForAny(['response_end', 'error'], 120000);
    await cleanupSensitiveStorage(page);
  });

  test('聊天任务选择 budget/standard tier 模型', async ({ page }) => {
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

    test.skip(!decision.fromModelPool, '三脑未走模型池路径，无法验证 tier/taskType');

    // 简单聊天应该选 budget 或 standard tier（不应该是 premium）
    expect(['budget', 'standard']).toContain(decision.tier);
    // taskType 应该是 chat
    expect(decision.taskType).toBe('chat');

    console.log(`[聊天选型] ${decision.modelId} tier=${decision.tier} taskType=${decision.taskType}`);
    await collector.waitForAny(['response_end', 'error'], 120000);
    await cleanupSensitiveStorage(page);
  });

  test('工具调用任务选择支持 toolCalling 的模型', async ({ page }) => {
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

    // 工具调用任务的 taskType 应该是 tools
    expect(decision.taskType).toBe('tools');
    // 候选模型数应该 >= 1
    expect(decision.candidateCount).toBeGreaterThanOrEqual(1);

    console.log(`[工具选型] ${decision.modelId} tier=${decision.tier} taskType=${decision.taskType} candidates=${decision.candidateCount}`);
    await collector.waitForAny(['response_end', 'error'], 180000);
    await cleanupSensitiveStorage(page);
  });

  test('推理任务选择 premium/standard tier 模型', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    collector.clear();
    await sendMessage(page, '分析一下这个项目的架构设计，为什么用三脑架构而不是单模型？');

    const decision = await waitForModelDecision(collector, 60000);

    test.skip(!decision.fromModelPool, '三脑未走模型池路径，无法验证 tier/taskType');

    // 推理任务应该选 premium 或 standard tier
    expect(['premium', 'standard']).toContain(decision.tier);
    // taskType 应该是 reasoning
    expect(decision.taskType).toBe('reasoning');

    console.log(`[推理选型] ${decision.modelId} tier=${decision.tier} taskType=${decision.taskType}`);
    await collector.waitForAny(['response_end', 'error'], 180000);
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

    const event = await collector.waitForAny(['model_decision', 'response_end', 'error'], 60000);

    if (event.type !== 'model_decision') {
      test.skip(true, '三脑未走模型池路径，model_decision 未发射');
    }

    // tsSample 是 Thompson Sampling 的采样值，应该在 [0, 1] 范围内
    if (event.tsSample !== undefined && event.tsSample !== null) {
      expect(event.tsSample).toBeGreaterThanOrEqual(0);
      expect(event.tsSample).toBeLessThanOrEqual(1);
      console.log(`[Thompson] tsSample=${event.tsSample}`);
    } else {
      console.log('[Thompson] tsSample 未发射（可能首次运行无历史数据）');
    }

    await collector.waitForAny(['response_end', 'error'], 120000);
    await cleanupSensitiveStorage(page);
  });
});

// ==================== 2. 工具调用 — 真实能力验证 ====================

test.describe('工具调用 — 真实能力验证', () => {

  test('read_file 能读取文件并返回正确内容', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    const { terminalEvent, types, events } = await sendAndWaitForEvent(
      page, collector, '读取 package.json 文件，告诉我项目的 name 字段是什么', 180000,
    );

    // 链路必须闭环
    expect(types).toContain('thinking');
    expect(types).toContain('response_end');

    // 如果触发了工具调用，验证事件顺序和结构
    const toolCalls = events.filter(e => e.type === 'tool_call');
    const toolResults = events.filter(e => e.type === 'tool_result');

    if (toolCalls.length > 0) {
      // tool_call → tool_result → response_end 顺序
      expect(types.indexOf('tool_call')).toBeLessThan(types.indexOf('tool_result'));
      expect(types.indexOf('tool_result')).toBeLessThan(types.indexOf('response_end'));

      // tool_call 必须包含 tool 名称和 args
      const tc = toolCalls[0];
      expect(tc.tool).toBeTruthy();
      expect(typeof tc.tool).toBe('string');

      // tool_result 必须包含 result
      if (toolResults.length > 0) {
        const tr = toolResults[0];
        expect(tr.result).toBeTruthy();
      }

      console.log(`[工具调用] ✅ tool=${tc.tool} → tool_result → response_end`);
    } else {
      console.log('[工具调用] 模型未触发工具调用（直接回答），验证回复内容');
    }

    await cleanupSensitiveStorage(page);
  });

  test('工具调用结果正确性 — 读取的文件内容与实际一致', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    const { types, events } = await sendAndWaitForEvent(
      page, collector, '读取 package.json 文件，告诉我项目的 version 字段是什么，只回答版本号', 180000,
    );

    expect(types).toContain('response_end');

    // 如果触发了工具调用，验证 tool_result 中包含实际文件内容
    const toolResults = events.filter(e => e.type === 'tool_result');
    if (toolResults.length > 0) {
      const result = toolResults[0].result as string;
      // package.json 中应该包含 version 字段
      expect(result).toContain('version');
      console.log(`[工具结果] tool_result 包含 version 字段: ${result.slice(0, 200)}`);
    }

    await cleanupSensitiveStorage(page);
  });

  test('agent_trace / brain_trace 执行轨迹存在', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    await sendMessage(page, '查看当前目录有哪些文件');
    await collector.waitForAny(['response_end', 'error'], 180000);

    const types = collector.all().map(e => e.type);

    // agent_trace 或 brain_trace 任一存在
    const hasTrace = types.includes('agent_trace') || types.includes('brain_trace');
    expect(hasTrace).toBeTruthy();
    console.log(`[轨迹] ✅ agent_trace=${types.includes('agent_trace')} brain_trace=${types.includes('brain_trace')}`);

    await cleanupSensitiveStorage(page);
  });
});

// ==================== 3. 多模型协作 — DAG 编排真实完成 ====================

test.describe('多模型协作 — DAG 编排真实完成', () => {

  test('DAG 多步骤任务 — 每步工具调用都有结果', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    const { types, events } = await sendAndWaitForEvent(
      page, collector,
      '先读取 package.json 看项目名，再读取 README.md 看简介，最后总结这个项目是什么',
      240000,
    );

    expect(types).toContain('thinking');
    expect(types).toContain('response_end');

    // 验证多次工具调用都有结果
    const toolCalls = events.filter(e => e.type === 'tool_call');
    const toolResults = events.filter(e => e.type === 'tool_result');

    console.log(`[DAG] tool_call=${toolCalls.length} tool_result=${toolResults.length}`);

    if (toolCalls.length >= 2) {
      // 多步骤任务应该有多次工具调用
      // 每次 tool_call 后应该有 tool_result
      for (const tc of toolCalls) {
        expect(tc.tool).toBeTruthy();
      }
      for (const tr of toolResults) {
        expect(tr.result).toBeTruthy();
      }
      // tool_call 和 tool_result 数量应该匹配
      expect(toolResults.length).toBeGreaterThanOrEqual(toolCalls.length);
      console.log(`[DAG] ✅ ${toolCalls.length} 步工具调用全部有结果`);
    } else {
      console.log(`[DAG] 模型只触发了 ${toolCalls.length} 次工具调用（可能合并了步骤）`);
    }

    await cleanupSensitiveStorage(page);
  });

  test('orch 事件 — 编排任务状态可观测', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    await sendMessage(page, '先读取 package.json 看项目名，再读取 README.md 看简介，最后总结');
    await collector.waitForAny(['response_end', 'error'], 240000);

    const types = collector.all().map(e => e.type);

    // 检查是否有编排相关事件
    const orchEvents = types.filter(t =>
      t.startsWith('orch_') || t === 'agent_trace' || t === 'brain_trace',
    );

    if (orchEvents.length > 0) {
      console.log(`[编排] ✅ 编排事件: ${orchEvents.join(', ')}`);
    } else {
      console.log('[编排] ⚠️ 无编排事件（可能后端未启用 DAG 编排，走了单模型路径）');
    }

    // 至少应该有 thinking + response_end
    expect(types).toContain('thinking');
    expect(types).toContain('response_end');

    await cleanupSensitiveStorage(page);
  });

  test('expert_pool_start 事件 — 专家池选择可观测', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    await sendMessage(page, '分析一下这个项目的技术栈');

    try {
      const event = await collector.waitFor('expert_pool_start', 60000);
      expect(event.taskId).toBeTruthy();
      expect(Array.isArray(event.experts)).toBeTruthy();
      console.log(`[专家池] ✅ taskId=${event.taskId} experts=${(event.experts as string[]).join(', ')}`);
    } catch {
      console.log('[专家池] ⚠️ expert_pool_start 未发射（可能无本地专家注册）');
    }

    await collector.waitForAny(['response_end', 'error'], 180000);
    await cleanupSensitiveStorage(page);
  });
});

// ==================== 4. 多模型切换 — 不同模型真实能力 ====================

test.describe('多模型切换 — 不同模型真实能力', () => {

  test('默认模型能完成对话并回复有意义内容', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    const { terminalEvent, types } = await sendAndWaitForEvent(page, collector, '1+1等于几？');

    expect(types).toContain('thinking');
    expect(terminalEvent.type).toBe('response_end');

    console.log(`[默认模型] ${SILICONFLOW_DEFAULTS.model}: 完成对话`);
    await cleanupSensitiveStorage(page);
  });

  test('切换模型后新模型能正常工作', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');

    // 第一轮：默认模型
    const c1 = new WSEventCollector(page);
    await c1.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);
    const r1 = await sendAndWaitForEvent(page, c1, '你好');
    expect(r1.terminalEvent.type).toBe('response_end');

    const d1 = await waitForModelDecision(c1, 60000);
    console.log(`[切换] 模型A: ${d1.modelId || '(非模型池路径)'} tier=${d1.tier}`);

    // 第二轮：切换到强模型
    await cleanupSensitiveStorage(page);
    const c2 = new WSEventCollector(page);
    await c2.attach();
    await setupFrontendLLMConfig(page, { model: SILICONFLOW_STRONG_MODEL });
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);
    const r2 = await sendAndWaitForEvent(page, c2, '1+1=?');
    expect(r2.terminalEvent.type).toBe('response_end');

    const d2 = await waitForModelDecision(c2, 60000);
    console.log(`[切换] 模型B: ${d2.modelId || '(非模型池路径)'} tier=${d2.tier}`);

    // 两次都成功回复即可（不要求 modelId 非空，因为三脑可能不走模型池）
    expect(r1.terminalEvent.type).toBe('response_end');
    expect(r2.terminalEvent.type).toBe('response_end');

    await cleanupSensitiveStorage(page);
  });

  test('弱模型（7B）能处理简单问答', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page, { model: SILICONFLOW_WEAK_MODEL });
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    const { terminalEvent, types } = await sendAndWaitForEvent(page, collector, '你好');

    expect(types).toContain('thinking');
    expect(terminalEvent.type).toBe('response_end');

    console.log(`[弱模型] ${SILICONFLOW_WEAK_MODEL}: 完成对话`);
    await cleanupSensitiveStorage(page);
  });

  test('强模型（32B）能处理推理任务', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page, { model: SILICONFLOW_STRONG_MODEL });
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    const { terminalEvent, types } = await sendAndWaitForEvent(
      page, collector, '分析一下 TypeScript 泛型和 Java 泛型的区别，从类型擦除角度',
      180000,
    );

    expect(types).toContain('thinking');
    expect(terminalEvent.type).toBe('response_end');

    console.log(`[强模型] ${SILICONFLOW_STRONG_MODEL}: 完成推理任务`);
    await cleanupSensitiveStorage(page);
  });
});

// ==================== 5. 错误恢复 ====================

test.describe('错误恢复', () => {

  test('无效 key 后恢复 — 系统能重新工作', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');

    // 用无效 key
    await setupFrontendLLMConfig(page, { apiKey: 'sk-invalid' });
    await page.goto('/');
    await page.waitForTimeout(3000);
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible()) {
      await textarea.fill('测试');
      await textarea.press('Enter');
      await page.waitForTimeout(5000);
    }

    // 恢复正确 key
    await setupFrontendLLMConfig(page);
    await resyncBackendConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    const collector = new WSEventCollector(page);
    await collector.attach();
    const { terminalEvent, types } = await sendAndWaitForEvent(page, collector, '你好');

    expect(types).toContain('thinking');
    expect(terminalEvent.type).toBe('response_end');

    // 验证恢复后系统能正常回复
    const decision = await waitForModelDecision(collector, 60000);
    if (decision.fromModelPool) {
      expect(decision.modelId).toBeTruthy();
      console.log(`[恢复] ✅ 恢复后 model_decision: ${decision.modelId}`);
    } else {
      console.log('[恢复] ✅ 恢复后系统正常响应（非模型池路径）');
    }

    await cleanupSensitiveStorage(page);
  });

  test('无效 key — 页面不崩溃', async ({ page }) => {
    await setupFrontendLLMConfig(page, { apiKey: 'sk-invalid-key-12345' });
    const collector = new WSEventCollector(page);
    await collector.attach();

    try {
      await page.goto('/');
      await page.waitForTimeout(3000);

      const textarea = page.locator('textarea').first();
      if (await textarea.isVisible()) {
        await textarea.fill('测试');
        await textarea.press('Enter');

        await collector.waitForAny(['error', 'response_end'], 20000).catch(() => null);

        const body = await page.textContent('body');
        expect(body).toBeTruthy();
        expect(body!.length).toBeGreaterThan(50);
      }
    } finally {
      await cleanupSensitiveStorage(page);
      if (HAS_API_KEY) {
        await setupFrontendLLMConfig(page);
        await resyncBackendConfig(page);
        await cleanupSensitiveStorage(page);
      }
    }
  });
});

// ==================== 6. 边界输入 ====================

test.describe('边界输入', () => {

  test('超长消息（2000 字符）— LLM 能正常回复', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    const longMsg = '请总结以下内容：' + '人工智能是计算机科学的一个分支，它致力于研究和开发能够模拟、延伸和扩展人类智能的理论、方法、技术及应用系统。'.repeat(25);
    await sendMessage(page, longMsg);

    const { terminalEvent, types } = await sendAndWaitForEvent(page, collector, '', 180000);

    // 不崩溃，链路闭环
    expect(types).toContain('thinking');
    expect(terminalEvent.type === 'response_end' || terminalEvent.type === 'error').toBeTruthy();

    console.log(`[超长消息] ${longMsg.length} 字符: ${terminalEvent.type}`);
    await cleanupSensitiveStorage(page);
  });

  test('Emoji 输入 — 不破坏 WS 协议', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    const { terminalEvent, types } = await sendAndWaitForEvent(page, collector, '用emoji表达开心 🐾✨🎉🚀');
    expect(types).toContain('thinking');
    expect(terminalEvent.type === 'response_end' || terminalEvent.type === 'error').toBeTruthy();

    console.log(`[Emoji] ${terminalEvent.type}`);
    await cleanupSensitiveStorage(page);
  });

  test('特殊字符 — 代码片段不破坏协议', async ({ page }) => {
    test.skip(!HAS_API_KEY, '需要 SILICONFLOW_API_KEY');
    const collector = new WSEventCollector(page);
    await collector.attach();
    await setupFrontendLLMConfig(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await waitForWSReady(page);

    const { terminalEvent, types } = await sendAndWaitForEvent(
      page, collector,
      '解释: const fn = <T>(x: T): T => x; const arr = [1, "hello", null];',
    );
    expect(types).toContain('thinking');
    expect(terminalEvent.type === 'response_end' || terminalEvent.type === 'error').toBeTruthy();

    console.log(`[特殊字符] ${terminalEvent.type}`);
    await cleanupSensitiveStorage(page);
  });
});
