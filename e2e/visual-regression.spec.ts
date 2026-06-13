/**
 * 视觉回归 E2E — 截图对比
 *
 * 覆盖：
 * 1. 主界面基线截图
 * 2. 各面板带数据截图
 * 3. 消息气泡各类型截图
 * 4. 响应式布局（移动端/平板）
 * 5. Onboarding 各步骤截图
 * 6. 空状态/错误状态截图
 */
import { test, expect, type Page } from '@playwright/test';
import {
  skipOnboarding,
  setupMockWS,
  injectWsMessage,
  injectBuddyState,
  waitForWSConnection,
  stabilizeForScreenshot,
} from './fixtures.js';

/** 稳定化截图 — 自动冻结动画/时间/动态元素后再截图 */
async function stableScreenshot(page: Page, name: string, options?: { maxDiffPixelRatio?: number }) {
  await stabilizeForScreenshot(page);
  await expect(page).toHaveScreenshot(name, {
    maxDiffPixelRatio: options?.maxDiffPixelRatio ?? 0.01,
  });
}

// ==================== 主界面 ====================

test.describe('视觉回归 — 主界面', () => {

  test('主界面 — 默认状态基线', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await injectBuddyState(page);
    await page.waitForTimeout(500);

    await stableScreenshot(page, 'main-default.png');
  });

  test('主界面 — 连接状态指示器', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
    await page.waitForTimeout(300);

    await stableScreenshot(page, 'main-connected.png');
  });
});

// ==================== 对话面板 ====================

test.describe('视觉回归 — 对话面板', () => {

  test('空消息 — 欢迎状态', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await page.waitForTimeout(500);

    await stableScreenshot(page, 'chat-empty.png');
  });

  test('消息类型 — 用户/助手/工具/错误', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    // 用户消息
    const textarea = page.locator('textarea').first();
    await textarea.fill('这是一条用户消息');
    await textarea.press('Enter');
    await page.waitForTimeout(200);

    // 助手消息
    await injectWsMessage(page, {
      type: 'llm_response',
      content: '这是一条助手回复消息',
      streaming: false,
    });
    await page.waitForTimeout(200);

    // 工具调用
    await injectWsMessage(page, {
      type: 'tool_call',
      tool: 'read',
      args: { path: '/tmp/test.txt' },
    });
    await page.waitForTimeout(200);

    // 工具结果
    await injectWsMessage(page, {
      type: 'tool_result',
      tool: 'read',
      success: true,
      preview: '文件内容预览',
    });
    await page.waitForTimeout(200);

    // 错误消息
    await injectWsMessage(page, {
      type: 'error',
      message: '这是一个错误消息',
    });
    await page.waitForTimeout(200);

    await stableScreenshot(page, 'chat-message-types.png', { maxDiffPixelRatio: 0.05 });
  });

  test('流式响应 — 中间状态', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await injectWsMessage(page, {
      type: 'llm_response',
      content: '正在',
      streaming: true,
    });
    await injectWsMessage(page, {
      type: 'llm_response',
      content: '生成中...',
      streaming: true,
    });
    await page.waitForTimeout(300);

    await stableScreenshot(page, 'chat-streaming.png');
  });

  test('思考中状态', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await injectWsMessage(page, {
      type: 'thinking',
      message: '🤔 让我分析一下...',
    });
    await page.waitForTimeout(300);

    await stableScreenshot(page, 'chat-thinking.png');
  });
});

// ==================== 工具面板 ====================

test.describe('视觉回归 — 工具面板', () => {

  test('工具面板 — 带数据', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await page.locator('button', { hasText: '🔧' }).first().click();
    await page.waitForTimeout(300);

    await injectWsMessage(page, {
      type: 'tool_panel_data',
      data: {
        tools: [
          { name: 'read', description: '读取文件内容', source: 'builtin', usageCount: 42, successRate: 95 },
          { name: 'exec', description: '执行 shell 命令', source: 'builtin', usageCount: 18, successRate: 88 },
          { name: 'web_search', description: '搜索互联网', source: 'builtin', usageCount: 7, successRate: 100 },
          { name: 'mcp_github', description: 'GitHub 操作', source: 'mcp', usageCount: 5, successRate: 100 },
          { name: 'skill_weather', description: '天气查询', source: 'skill', usageCount: 3, successRate: 66 },
        ],
        recentExecutions: [
          { tool: 'read', args: { path: '/tmp/test' }, result: 'file content', success: true, durationMs: 50, timestamp: Date.now() },
          { tool: 'exec', args: { command: 'ls -la' }, result: 'Error: timeout', success: false, durationMs: 5000, timestamp: Date.now() - 60000 },
        ],
      },
    });
    await page.waitForTimeout(300);

    await stableScreenshot(page, 'tool-panel-with-data.png');
  });

  test('工具面板 — 空状态', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await page.locator('button', { hasText: '🔧' }).first().click();
    await injectWsMessage(page, {
      type: 'tool_panel_data',
      data: { tools: [], recentExecutions: [] },
    });
    await page.waitForTimeout(300);

    await stableScreenshot(page, 'tool-panel-empty.png');
  });
});

// ==================== 记忆面板 ====================

test.describe('视觉回归 — 记忆面板', () => {

  test('记忆面板 — 多领域', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await page.locator('button', { hasText: '🧠' }).first().click();
    await page.waitForTimeout(300);

    await injectWsMessage(page, {
      type: 'memory_panel_data',
      data: {
        domains: [
          { domain: '编程', domainType: 'technical', knowledgeCount: 200, depthScore: 0.92, growthStage: 'expert', confidence: 0.95, conversationCount: 80, lastActiveAt: Date.now() },
          { domain: 'AI/ML', domainType: 'technical', knowledgeCount: 150, depthScore: 0.78, growthStage: 'growing', confidence: 0.85, conversationCount: 45, lastActiveAt: Date.now() - 3600000 },
          { domain: '生活', domainType: 'personal', knowledgeCount: 50, depthScore: 0.45, growthStage: 'sprout', confidence: 0.6, conversationCount: 15, lastActiveAt: Date.now() - 86400000 },
          { domain: '音乐', domainType: 'hobby', knowledgeCount: 8, depthScore: 0.12, growthStage: 'seed', confidence: 0.25, conversationCount: 3, lastActiveAt: Date.now() - 172800000 },
        ],
        stats: { totalNodes: 408, totalDomains: 4, activeDomains: 3 },
      },
    });
    await page.waitForTimeout(300);

    await stableScreenshot(page, 'memory-panel-domains.png');
  });
});

// ==================== 活动面板 ====================

test.describe('视觉回归 — 活动面板', () => {

  test('活动面板 — 时间线', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
    await injectBuddyState(page);

    await page.locator('button', { hasText: '📊' }).first().click();
    await page.waitForTimeout(500);

    await stableScreenshot(page, 'activity-timeline.png');
  });

  test('活动面板 — 统计', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
    await injectBuddyState(page);

    await page.locator('button', { hasText: '📊' }).first().click();
    await page.waitForTimeout(300);
    await page.locator('button', { hasText: '统计' }).first().click();
    await page.waitForTimeout(300);

    await stableScreenshot(page, 'activity-stats.png');
  });

  test('活动面板 — 梦境', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await page.locator('button', { hasText: '📊' }).first().click();
    await page.waitForTimeout(300);

    // 前端独有事件（后端不 emit）
    await injectWsMessage(page, {
      type: 'dream_logs',
      logs: [
        { journal: '回顾了今天的对话，用户对 TypeScript 泛型很感兴趣。', timestamp: Date.now() - 3600000 },
        { journal: '发现用户经常问关于设计模式的问题，整理了一份速查表。', timestamp: Date.now() - 7200000 },
      ],
    });

    await page.locator('button', { hasText: '梦境' }).first().click();
    await page.waitForTimeout(300);

    await stableScreenshot(page, 'activity-dreams.png');
  });
});

// ==================== 专家面板 ====================

test.describe('视觉回归 — 专家面板', () => {

  test('专家面板 — 专家列表', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await page.locator('button', { hasText: '🎓' }).first().click();
    await page.waitForTimeout(300);

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
    await page.waitForTimeout(300);

    await stableScreenshot(page, 'expert-panel.png');
  });
});

// ==================== 探索面板 ====================

test.describe('视觉回归 — 探索面板', () => {

  test('探索面板 — 功能地图', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await page.locator('button', { hasText: '🗺️' }).first().click();
    await page.waitForTimeout(300);

    await injectWsMessage(page, {
      type: 'status',
      data: {
        name: 'Buddy', species: 'AI', emoji: '🐾',
        rarity: 'Rare', rarityColor: '#d29922',
        evolutionStage: 'formed', stageName: '成形', stageEmoji: '🦎', stageDescription: '',
        intimacy: 42, intimacyDescription: '信任中',
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
    await page.waitForTimeout(500);

    await stableScreenshot(page, 'exploration-map.png');
  });
});

// ==================== Onboarding ====================

test.describe('视觉回归 — Onboarding', () => {

  test('步骤 1 — 选择主色调', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    await page.reload();
    await expect(page.locator('h2')).toContainText('选择主色调', { timeout: 5000 });

    await stableScreenshot(page, 'onboarding-step1-color.png');
  });

  test('步骤 2 — 选择质感', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    // 等待 Onboarding 渲染（h2 出现 = localStorage.clear 生效）
    await expect(page.locator('h2')).toContainText('选择主色调', { timeout: 10000 });
    await page.locator('button[title="蓝"]').click({ force: true });
    await page.locator('button', { hasText: '下一步' }).click();
    await expect(page.locator('h2')).toContainText('选择质感', { timeout: 5000 });

    await stableScreenshot(page, 'onboarding-step2-texture.png');
  });

  test('步骤 3 — 选择气质', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    await expect(page.locator('h2')).toContainText('选择主色调', { timeout: 10000 });
    await page.locator('button[title="蓝"]').click({ force: true });
    await page.locator('button', { hasText: '下一步' }).click();
    await page.locator('button', { hasText: '柔软' }).click();
    await page.locator('button', { hasText: '下一步' }).click();
    await expect(page.locator('h2')).toContainText('选择气质', { timeout: 5000 });

    await stableScreenshot(page, 'onboarding-step3-temperament.png');
  });

  test('步骤 4 — LLM 配置', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    await expect(page.locator('h2')).toContainText('选择主色调', { timeout: 10000 });
    await page.locator('button[title="蓝"]').click({ force: true });
    await page.locator('button', { hasText: '下一步' }).click();
    await page.locator('button', { hasText: '柔软' }).click();
    await page.locator('button', { hasText: '下一步' }).click();
    await page.locator('button', { hasText: '温暖' }).click();
    await page.locator('button', { hasText: '下一步' }).click();
    await expect(page.locator('h2')).toContainText('连接大脑', { timeout: 5000 });

    await stableScreenshot(page, 'onboarding-step4-llm.png');
  });
});

// ==================== 设置面板 ====================

test.describe('视觉回归 — 设置面板', () => {

  test('设置 — 外观子标签', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);

    await page.locator('button', { hasText: '⚙️' }).first().click();
    await page.waitForTimeout(300);
    await page.locator('button', { hasText: '🎨' }).first().click();
    await page.waitForTimeout(300);

    await stableScreenshot(page, 'settings-appearance.png');
  });

  test('设置 — 模型池子标签', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);

    await page.locator('button', { hasText: '⚙️' }).first().click();
    await page.waitForTimeout(300);
    // 模型池是 Settings 默认 Tab，点击确保激活
    await page.locator('button', { hasText: '🏊' }).first().click();
    await page.waitForTimeout(300);

    await stableScreenshot(page, 'settings-llm.png');
  });
});

// ==================== 响应式 ====================

test.describe('视觉回归 — 响应式布局', () => {

  test('移动端 — 375×812 (iPhone SE)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await setupMockWS(page);
    await skipOnboarding(page);
    await injectBuddyState(page);
    await page.waitForTimeout(500);

    await stableScreenshot(page, 'responsive-mobile-375.png');
  });

  test('平板 — 768×1024 (iPad)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await setupMockWS(page);
    await skipOnboarding(page);
    await injectBuddyState(page);
    await page.waitForTimeout(500);

    await stableScreenshot(page, 'responsive-tablet-768.png');
  });

  test('宽屏 — 1920×1080', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await setupMockWS(page);
    await skipOnboarding(page);
    await injectBuddyState(page);
    await page.waitForTimeout(500);

    await stableScreenshot(page, 'responsive-desktop-1920.png');
  });
});

// ==================== 状态变化 ====================

test.describe('视觉回归 — 状态变化', () => {

  test('进化阶段 — 孵化', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);

    await injectWsMessage(page, {
      type: 'status',
      data: {
        name: 'Buddy', species: 'AI', emoji: '🐾',
        rarity: 'Common', rarityColor: '#8b949e',
        evolutionStage: 'hatching', stageName: '孵化', stageEmoji: '🐣', stageDescription: '刚刚诞生',
        intimacy: 5, intimacyDescription: '陌生',
        behaviorSignals: { snark: 0.1, wisdom: 0.2, chaos: 0.1, patience: 0.5, debugging: 0.1, lastComputedAt: Date.now(), sampleCount: 5 },
        stats: { hp: 30, maxHp: 100, attack: 3, defense: 3, speed: 3, intelligence: 5 },
        features: [], exploration: { discovered: 0, total: 0, basic: 0, advanced: 0, expert: 0, hidden: 0, basicTotal: 0, advancedTotal: 0, expertTotal: 0, hiddenTotal: 0 },
        guidance: null,
        petStats: { totalMessages: 2, totalToolCalls: 0, totalDays: 1, consecutiveDays: 1 },
        emotion: { mood: 'neutral', energy: 0.5, satisfaction: 0.3 },
        visualSeed: { primaryColor: '#58a6ff', texture: 'soft', temperament: 'warm', seed: 1 },
        formProgress: 5,
        visualStage: { stage: 'hatching', name: '孵化', emoji: '🐣', description: '', minProgress: 0, maxProgress: 20 },
      },
    });
    await page.waitForTimeout(500);

    await stableScreenshot(page, 'state-hatching.png');
  });

  test('进化阶段 — 成熟', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);

    await injectWsMessage(page, {
      type: 'status',
      data: {
        name: 'DragonBuddy', species: 'AI龙', emoji: '🐲',
        rarity: 'Legendary', rarityColor: '#f0883e',
        evolutionStage: 'mature', stageName: '成熟', stageEmoji: '🐺', stageDescription: '性格明显可辨',
        intimacy: 85, intimacyDescription: '深厚羁绊',
        behaviorSignals: { snark: 0.5, wisdom: 0.9, chaos: 0.1, patience: 0.9, debugging: 0.8, lastComputedAt: Date.now(), sampleCount: 500 },
        stats: { hp: 95, maxHp: 100, attack: 25, defense: 20, speed: 18, intelligence: 30 },
        features: [
          { id: 'chat', name: '对话', description: '', category: 'basic', discovered: true, useCount: 200, mastery: 95, emoji: '💬' },
          { id: 'tools', name: '工具', description: '', category: 'basic', discovered: true, useCount: 80, mastery: 85, emoji: '🔧' },
          { id: 'memory', name: '记忆', description: '', category: 'advanced', discovered: true, useCount: 50, mastery: 70, emoji: '🧠' },
        ],
        exploration: { discovered: 3, total: 5, basic: 2, advanced: 1, expert: 0, hidden: 0, basicTotal: 2, advancedTotal: 2, expertTotal: 1, hiddenTotal: 0 },
        guidance: null,
        petStats: { totalMessages: 500, totalToolCalls: 120, totalDays: 30, consecutiveDays: 15 },
        emotion: { mood: 'happy', energy: 0.9, satisfaction: 0.85 },
        visualSeed: { primaryColor: '#f0883e', texture: 'warm', temperament: 'calm', seed: 42 },
        formProgress: 85,
        visualStage: { stage: 'mature', name: '成熟', emoji: '🐺', description: '', minProgress: 70, maxProgress: 90 },
      },
    });
    await page.waitForTimeout(500);

    await stableScreenshot(page, 'state-mature.png');
  });
});

// ==================== 新增：AgentTrace 面板 ====================

test.describe('视觉回归 — AgentTrace 面板', () => {

  test('AgentTrace — 完整决策链路', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await injectBuddyState(page);

    await injectWsMessage(page, {
      type: 'agent_trace',
      trace: [
        { type: 'thinking', content: '分析用户意图：查询天气信息', timestamp: Date.now() - 5000 },
        { type: 'model_decision', content: '选择 deepseek-chat', modelId: 'deepseek-chat', displayName: 'DeepSeek Chat', tier: 'primary', layer: 0, candidateCount: 3, taskType: 'chat', timestamp: Date.now() - 4000 },
        { type: 'tool_call', content: '调用天气查询', tool: 'web_search', timestamp: Date.now() - 3000 },
        { type: 'tool_result', content: '北京晴 25°C', success: true, timestamp: Date.now() - 2000 },
        { type: 'brain_trace', content: '三脑决策完成', phase: 'left-brain', traceId: 'trace-abc12345', timestamp: Date.now() - 1000 },
        { type: 'response', content: '北京今天天气晴朗，温度 25°C。', timestamp: Date.now() },
      ],
    });
    await page.waitForTimeout(500);

    await stableScreenshot(page, 'agent-trace-panel.png');
  });
});

// ==================== 新增：BuddyCanvas 精灵 ====================

test.describe('视觉回归 — BuddyCanvas 精灵', () => {

  test('精灵 — 孵化期 (formProgress=10)', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await injectBuddyState(page, {
      formProgress: 10,
      visualStage: { stage: 'hatching', name: '孵化', emoji: '🥚', description: '', minProgress: 0, maxProgress: 20 },
      emotion: { mood: 'neutral', energy: 0.5, satisfaction: 0.3 },
    });
    await page.waitForTimeout(1000);

    await stableScreenshot(page, 'canvas-hatching.png', { maxDiffPixelRatio: 0.05 });
  });

  test('精灵 — 成形期 (formProgress=50)', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await injectBuddyState(page, {
      formProgress: 50,
      visualStage: { stage: 'formed', name: '成形', emoji: '🦎', description: '', minProgress: 40, maxProgress: 70 },
      emotion: { mood: 'happy', energy: 0.8, satisfaction: 0.7 },
    });
    await page.waitForTimeout(1000);

    await stableScreenshot(page, 'canvas-formed.png', { maxDiffPixelRatio: 0.05 });
  });

  test('精灵 — 成熟期 (formProgress=90)', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await injectBuddyState(page, {
      formProgress: 90,
      visualStage: { stage: 'mature', name: '成熟', emoji: '🐉', description: '', minProgress: 80, maxProgress: 100 },
      emotion: { mood: 'excited', energy: 1.0, satisfaction: 0.9 },
    });
    await page.waitForTimeout(1000);

    await stableScreenshot(page, 'canvas-mature.png', { maxDiffPixelRatio: 0.05 });
  });
});

// ==================== 新增：传感器面板 ====================

test.describe('视觉回归 — 传感器面板', () => {

  test('传感器面板 — 空状态', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await injectBuddyState(page);

    // 导航到传感器面板
    const sensorBtn = page.locator('button', { hasText: '📡' }).first();
    if (await sensorBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sensorBtn.click();
      await page.waitForTimeout(500);
    }

    await stableScreenshot(page, 'sensor-panel-empty.png');
  });
});

// ==================== 新增：设置面板主题 ====================

test.describe('视觉回归 — 设置面板', () => {

  test('设置 — LLM 配置页', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await injectBuddyState(page);

    // 导航到设置
    const settingsBtn = page.locator('button', { hasText: '⚙️' }).first();
    await settingsBtn.click();
    await page.waitForTimeout(500);

    await stableScreenshot(page, 'settings-llm.png');
  });

  test('设置 — 外观配置页', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await injectBuddyState(page);

    const settingsBtn = page.locator('button', { hasText: '⚙️' }).first();
    await settingsBtn.click();
    await page.waitForTimeout(300);

    // 切换到外观标签
    const appearanceBtn = page.locator('button', { hasText: '🎨' }).first();
    if (await appearanceBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await appearanceBtn.click();
      await page.waitForTimeout(300);
    }

    await stableScreenshot(page, 'settings-appearance.png');
  });
});
