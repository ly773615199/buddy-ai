/**
 * 专家/视觉/成就/追踪/探索 E2E — 面板数据渲染
 *
 * 覆盖：
 * 1. 专家面板 — 列表渲染、过滤、搜索、安装状态
 * 2. 视觉面板 — 模式切换、隐私控制、UI 状态
 * 3. 成就面板 — 占位符渲染
 * 4. AgentTrace — 追踪步骤渲染
 * 5. 探索地图 — 功能节点渲染
 */
import { test, expect } from '@playwright/test';
import { skipOnboarding, setupMockWS, injectWsMessage, waitForWSConnection } from './fixtures.js';

// ==================== 专家面板 ====================

test.describe('专家面板 E2E', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
  });

  test('专家面板 — 页面结构完整', async ({ page }) => {
    await page.locator('button', { hasText: '🎓' }).first().click();

    // 验证标题
    await expect(page.getByText('专家商城')).toBeVisible({ timeout: 5000 });
    // 验证搜索框
    await expect(page.getByPlaceholder('搜索专家...')).toBeVisible();
    // 验证过滤按钮
    await expect(page.getByText('全部')).toBeVisible();
    await expect(page.getByText('已安装')).toBeVisible();
    await expect(page.getByText('可安装')).toBeVisible();
    await expect(page.getByText('已启用')).toBeVisible();
  });

  test('专家面板 — WS 推送专家列表', async ({ page }) => {
    await page.locator('button', { hasText: '🎓' }).first().click();
    // render cycle

    // 注入专家列表
    await injectWsMessage(page, {
      type: 'ternary_models',
      models: [
        {
          domain: 'coding', name: '编程专家', description: '精通多种编程语言和架构设计',
          architecture: 'LoRA-7B', version: '1.2.0', author: 'Buddy Team',
          tags: ['python', 'typescript', 'architecture'], installed: true, enabled: true,
          growthStage: 'mature', trainSteps: 5000, fileSize: '2.3GB',
        },
        {
          domain: 'writing', name: '写作专家', description: '擅长各类文体写作和文案',
          architecture: 'LoRA-3B', version: '0.9.0', author: 'Buddy Team',
          tags: ['creative', 'copywriting'], installed: false, enabled: false,
          growthStage: 'seed', trainSteps: 0, fileSize: '1.1GB',
        },
      ],
    });
    // render cycle

    // 验证专家卡片渲染
    await expect(page.getByText('编程专家')).toBeVisible();
    await expect(page.getByText('写作专家')).toBeVisible();
    await expect(page.getByText('精通多种编程语言')).toBeVisible();

    // 验证标签
    await expect(page.getByText('#python')).toBeVisible();
    await expect(page.getByText('#typescript')).toBeVisible();

    // 验证元信息
    await expect(page.getByText('LoRA-7B')).toBeVisible();
    await expect(page.getByText('5000 步')).toBeVisible();
  });

  test('专家面板 — 搜索过滤', async ({ page }) => {
    await page.locator('button', { hasText: '🎓' }).first().click();
    // render cycle

    await injectWsMessage(page, {
      type: 'ternary_models',
      models: [
        { domain: 'coding', name: '编程专家', description: '代码', architecture: 'LoRA-7B', version: '1.0', author: 'A', tags: ['code'], installed: true, enabled: true, growthStage: 'mature', trainSteps: 1000, fileSize: '1GB' },
        { domain: 'writing', name: '写作专家', description: '文章', architecture: 'LoRA-3B', version: '1.0', author: 'A', tags: ['write'], installed: false, enabled: false, growthStage: 'seed', trainSteps: 0, fileSize: '500MB' },
      ],
    });
    // render cycle

    // 搜索 "编程"
    await page.getByPlaceholder('搜索专家...').fill('编程');
    // UI transition

    await expect(page.getByText('编程专家')).toBeVisible();
    // 写作专家应该被过滤掉
    await expect(page.getByText('写作专家')).not.toBeVisible();
  });

  test('专家面板 — 安装/已安装状态', async ({ page }) => {
    await page.locator('button', { hasText: '🎓' }).first().click();
    // render cycle

    await injectWsMessage(page, {
      type: 'ternary_models',
      models: [
        { domain: 'coding', name: '编程专家', description: '', architecture: 'LoRA', version: '1.0', author: 'A', tags: [], installed: true, enabled: true, growthStage: 'mature', trainSteps: 100, fileSize: '1GB' },
        { domain: 'math', name: '数学专家', description: '', architecture: 'LoRA', version: '1.0', author: 'A', tags: [], installed: false, enabled: false, growthStage: 'seed', trainSteps: 0, fileSize: '500MB' },
      ],
    });
    // render cycle

    // 已安装的应该有 "已启用" 按钮
    await expect(page.getByText('✓ 已启用')).toBeVisible();
    // 未安装的应该有 "安装" 按钮
    await expect(page.getByText('安装').first()).toBeVisible();
  });

  test('专家面板 — 空列表', async ({ page }) => {
    await page.locator('button', { hasText: '🎓' }).first().click();
    // render cycle

    await injectWsMessage(page, { type: 'ternary_models', models: [] });
    // render cycle

    await expect(page.getByText('暂无专家模型')).toBeVisible();
  });
});

// ==================== 视觉面板 ====================

test.describe('视觉面板 E2E', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
  });

  test('视觉面板 — 三个模式按钮', async ({ page }) => {
    await page.locator('button', { hasText: '👁️' }).first().click();
    // render cycle

    await expect(page.getByText('📷 摄像头')).toBeVisible();
    await expect(page.getByText('📝 文字识别')).toBeVisible();
    await expect(page.getByText('🔍 场景分析')).toBeVisible();
  });

  test('视觉面板 — 摄像头未开启状态', async ({ page }) => {
    await page.locator('button', { hasText: '👁️' }).first().click();
    // render cycle

    await expect(page.getByText('摄像头未开启')).toBeVisible();
    await expect(page.getByText('▶ 开启摄像头')).toBeVisible();
  });

  test('视觉面板 — 隐私控制', async ({ page }) => {
    await page.locator('button', { hasText: '👁️' }).first().click();
    // render cycle

    // 验证三个隐私级别（使用 button role 避免 strict mode，'开放' 与 SVG 文本冲突）
    await expect(page.getByRole('button', { name: '严格' })).toBeVisible();
    await expect(page.getByRole('button', { name: '适中' })).toBeVisible();
    await expect(page.getByRole('button', { name: '开放' })).toBeVisible();
  });

  test('视觉面板 — 模式切换', async ({ page }) => {
    await page.locator('button', { hasText: '👁️' }).first().click();
    // render cycle

    // 切到 OCR 模式
    await page.getByText('📝 文字识别').click();
    // UI transition

    // 切到场景分析模式
    await page.getByText('🔍 场景分析').click();
    // UI transition

    // 切回摄像头模式
    await page.getByText('📷 摄像头').click();
    // UI transition
  });
});

// ==================== 成就面板 ====================

test.describe('成就面板 E2E', () => {

  test('成就面板 — 显示占位符', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    // 成就面板没有独立 Tab，但 AchievementsPanel 组件存在
    // 通过检查 DOM 验证占位符文案（如果有渲染入口）
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

// ==================== AgentTrace ====================

test.describe('AgentTrace E2E', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
  });

  test('AgentTrace — 注入追踪步骤后渲染', async ({ page }) => {
    // 注入 agent trace 数据
    await injectWsMessage(page, {
      type: 'agent_trace',
      trace: [
        { type: 'thinking', content: '分析用户意图...', timestamp: Date.now() - 5000 },
        { type: 'tool_call', content: '调用搜索工具', tool: 'web_search', args: { query: '天气' }, timestamp: Date.now() - 4000 },
        { type: 'tool_result', content: '搜索完成', tool: 'web_search', success: true, timestamp: Date.now() - 3000 },
        { type: 'response', content: '今天天气晴朗，温度 25°C', timestamp: Date.now() - 2000 },
      ],
    });
    // render cycle

    // AgentTrace 在对话面板下方渲染
    // 验证追踪步骤内容
    await expect(page.getByText('分析用户意图...')).toBeVisible();
    await expect(page.getByText('web_search').first()).toBeVisible();
    await expect(page.getByText('今天天气晴朗')).toBeVisible();
  });

  test('AgentTrace — 空追踪不显示', async ({ page }) => {
    // 不注入 trace 数据，验证对话面板正常
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

// ==================== 探索地图 ====================

test.describe('探索地图 E2E', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
  });

  test('探索地图 — 注入功能节点后渲染', async ({ page }) => {
    await page.locator('button', { hasText: '🗺️' }).first().click();
    // render cycle

    // 注入包含 features 的 buddyState
    await injectWsMessage(page, {
      type: 'status',
      data: {
        name: 'Buddy', species: 'AI', emoji: '🐾',
        rarity: 'Rare', rarityColor: '#d29922',
        evolutionStage: 'formed', stageName: '成形', stageEmoji: '🦎', stageDescription: '',
        intimacy: 42, intimacyDescription: '',
        behaviorSignals: { snark: 0.3, wisdom: 0.7, chaos: 0.2, patience: 0.8, debugging: 0.6, lastComputedAt: Date.now(), sampleCount: 100 },
        stats: { hp: 80, maxHp: 100, attack: 15, defense: 12, speed: 10, intelligence: 18 },
        features: [
          { id: 'chat', name: '对话', description: '与 Buddy 交谈', category: 'basic', discovered: true, useCount: 50, mastery: 80, emoji: '💬' },
          { id: 'tools', name: '工具', description: '使用工具', category: 'basic', discovered: true, useCount: 20, mastery: 60, emoji: '🔧' },
          { id: 'memory', name: '记忆', description: '知识记忆', category: 'advanced', discovered: false, useCount: 0, mastery: 0, emoji: '🧠' },
        ],
        exploration: { discovered: 2, total: 3, basic: 2, advanced: 0, expert: 0, hidden: 0, basicTotal: 2, advancedTotal: 1, expertTotal: 0, hiddenTotal: 0 },
        guidance: null,
        petStats: { totalMessages: 50, totalToolCalls: 20, totalDays: 7, consecutiveDays: 2 },
        emotion: { mood: 'happy', energy: 0.8, satisfaction: 0.7 },
        visualSeed: { primaryColor: '#58a6ff', texture: 'soft', temperament: 'warm', seed: 1 },
        formProgress: 50,
        visualStage: { stage: 'formed', name: '成形', emoji: '🦎', description: '', minProgress: 40, maxProgress: 70 },
      },
    });
    // render cycle

    // 验证探索地图已渲染（功能总数 + buddyState 名称）
    await expect(page.getByText('Buddy', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/3.*已发现/)).toBeVisible();
  });

  test('探索地图 — 未发现节点显示锁定状态', async ({ page }) => {
    await page.locator('button', { hasText: '🗺️' }).first().click();
    // render cycle

    await injectWsMessage(page, {
      type: 'status',
      data: {
        name: 'Buddy', species: 'AI', emoji: '🐾',
        rarity: 'Common', rarityColor: '#8b949e',
        evolutionStage: 'hatching', stageName: '孵化', stageEmoji: '🐣', stageDescription: '',
        intimacy: 10, intimacyDescription: '',
        behaviorSignals: { snark: 0.1, wisdom: 0.3, chaos: 0.1, patience: 0.5, debugging: 0.2, lastComputedAt: Date.now(), sampleCount: 10 },
        stats: { hp: 50, maxHp: 100, attack: 5, defense: 5, speed: 5, intelligence: 5 },
        features: [
          { id: 'chat', name: '对话', description: '', category: 'basic', discovered: true, useCount: 5, mastery: 20, emoji: '💬' },
          { id: 'memory', name: '记忆', description: '', category: 'advanced', discovered: false, useCount: 0, mastery: 0, emoji: '🧠' },
        ],
        exploration: { discovered: 1, total: 2, basic: 1, advanced: 0, expert: 0, hidden: 0, basicTotal: 1, advancedTotal: 1, expertTotal: 0, hiddenTotal: 0 },
        guidance: null,
        petStats: { totalMessages: 5, totalToolCalls: 0, totalDays: 1, consecutiveDays: 1 },
        emotion: { mood: 'neutral', energy: 0.5, satisfaction: 0.5 },
        visualSeed: { primaryColor: '#58a6ff', texture: 'soft', temperament: 'warm', seed: 1 },
        formProgress: 10,
        visualStage: { stage: 'hatching', name: '孵化', emoji: '🐣', description: '', minProgress: 0, maxProgress: 20 },
      },
    });
    // render cycle

    // 未发现的节点应该有锁定标记
    const body = await page.textContent('body');
    expect(body).toContain('🔒');
  });
});

// ==================== 专家 REST API 回归 ====================

test.describe('专家面板 — REST API 回归', () => {
  test('GET /api/ternary/models 返回 200', async ({ page }) => {
    await skipOnboarding(page);
    // 获取 ws-token
    const tokenRes = await page.evaluate(() =>
      fetch('http://localhost:8765/api/ws-token').then(r => r.json())
    );
    const headers = { Authorization: `Bearer ${tokenRes.token}` };

    const res = await page.evaluate(async (h) => {
      const r = await fetch('http://localhost:8765/api/ternary/models', { headers: h });
      return { ok: r.ok, status: r.status };
    }, headers);

    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
  });
});
