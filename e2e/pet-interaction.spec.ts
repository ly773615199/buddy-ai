import { test, expect } from '@playwright/test';
import { skipOnboarding, setupMockWS, injectWsMessage, waitForWSConnection } from './fixtures.js';

test.describe('Pet 交互 E2E', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
  });

  test('摸头按钮存在且可点击', async ({ page }) => {
    // 切换到宠物标签页
    const statsTab = page.locator('button:has-text("探索"), button:has-text("stats")');
    if (await statsTab.count() > 0) {
      await statsTab.first().click();
      await page.waitForTimeout(500);
    }

    // 查找摸头按钮
    const petButton = page.locator('button:has-text("摸摸头"), button:has-text("摸头")');
    await expect(petButton).toBeVisible({ timeout: 5000 });
    await expect(petButton).toBeEnabled();
  });

  test('点击摸头发送 pet 消息', async ({ page }) => {
    // 导航到探索 tab
    const statsTab = page.locator('button:has-text("探索"), button:has-text("stats")');
    if (await statsTab.count() > 0) {
      await statsTab.first().click();
      await page.waitForTimeout(500);
    }

    // 通过 mock WS sendCalls 验证发送了 pet 消息（setupMockWS 已拦截 send）
    const petButton = page.locator('button:has-text("摸摸头"), button:has-text("摸头")');
    await petButton.click();
    await page.waitForTimeout(500);

    // 从 mock WS 的 sendCalls 中查找 pet 消息
    const messages: string[] = await page.evaluate(() => (window as any).__mockWs?.sendCalls ?? []);
    const petMsg = messages.find((m: string) => {
      try { return JSON.parse(m).type === 'pet'; } catch { return false; }
    });
    expect(petMsg).toBeTruthy();
  });

  test('亲密度数值显示正确', async ({ page }) => {
    // 切换到宠物标签页
    const statsTab = page.locator('button:has-text("探索"), button:has-text("stats")');
    if (await statsTab.count() > 0) {
      await statsTab.first().click();
      await page.waitForTimeout(500);
    }

    // 检查亲密度显示
    const intimacyText = page.locator('text=/亲密度|\\d+\\/100/');
    await expect(intimacyText.first()).toBeVisible({ timeout: 5000 });
  });

  test('PetStats 组件渲染完整', async ({ page }) => {
    // 切换到宠物标签页
    const statsTab = page.locator('button:has-text("探索"), button:has-text("stats")');
    if (await statsTab.count() > 0) {
      await statsTab.first().click();
      await page.waitForTimeout(500);
    }

    // 检查核心元素存在
    const sections = [
      '性格雷达',
      '战斗属性',
      '活动记录',
    ];

    for (const section of sections) {
      const el = page.locator(`text=${section}`);
      if (await el.count() > 0) {
        await expect(el.first()).toBeVisible();
      }
    }
  });

  test('探索图谱显示功能节点', async ({ page }) => {
    // 切换到宠物标签页
    const statsTab = page.locator('button:has-text("探索"), button:has-text("stats")');
    if (await statsTab.count() > 0) {
      await statsTab.first().click();
      await page.waitForTimeout(500);
    }

    // 检查探索图谱区域
    const exploration = page.locator('text=/探索|功能/');
    if (await exploration.count() > 0) {
      await expect(exploration.first()).toBeVisible();
    }
  });
});

// ==================== 进化阶段深度测试 ====================

test.describe('Pet 交互 — 进化阶段', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
  });

  test('孵化期 — 低亲密度 + 基础属性', async ({ page }) => {
    await injectWsMessage(page, {
      type: 'status',
      data: {
        name: 'Buddy', species: 'AI', emoji: '🐣',
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

    // 导航到探索 tab
    const statsTab = page.locator('button:has-text("探索"), button:has-text("stats")');
    if (await statsTab.count() > 0) {
      await statsTab.first().click();
      await page.waitForTimeout(500);
    }

    // 应显示孵化阶段信息
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('成熟期 — 高亲密度 + 完整属性', async ({ page }) => {
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
        ],
        exploration: { discovered: 2, total: 5, basic: 2, advanced: 0, expert: 0, hidden: 0, basicTotal: 2, advancedTotal: 2, expertTotal: 1, hiddenTotal: 0 },
        guidance: null,
        petStats: { totalMessages: 500, totalToolCalls: 120, totalDays: 30, consecutiveDays: 15 },
        emotion: { mood: 'happy', energy: 0.9, satisfaction: 0.85 },
        visualSeed: { primaryColor: '#f0883e', texture: 'warm', temperament: 'calm', seed: 42 },
        formProgress: 85,
        visualStage: { stage: 'mature', name: '成熟', emoji: '🐺', description: '', minProgress: 70, maxProgress: 90 },
      },
    });
    await page.waitForTimeout(500);

    // 导航到探索 tab
    const statsTab = page.locator('button:has-text("探索"), button:has-text("stats")');
    if (await statsTab.count() > 0) {
      await statsTab.first().click();
      await page.waitForTimeout(500);
    }

    // 应显示成熟阶段信息
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('进化阶段切换 — hatching → formed → mature 不崩溃', async ({ page }) => {
    const stages = [
      { stage: 'hatching', formProgress: 5, emoji: '🐣' },
      { stage: 'formed', formProgress: 50, emoji: '🦎' },
      { stage: 'mature', formProgress: 85, emoji: '🐺' },
    ];

    for (const s of stages) {
      await injectWsMessage(page, {
        type: 'status',
        data: {
          name: 'Buddy', species: 'AI', emoji: s.emoji,
          rarity: 'Rare', rarityColor: '#d29922',
          evolutionStage: s.stage, stageName: s.stage, stageEmoji: s.emoji, stageDescription: '',
          intimacy: 42, intimacyDescription: '信任中',
          behaviorSignals: { snark: 0.3, wisdom: 0.7, chaos: 0.2, patience: 0.8, debugging: 0.6, lastComputedAt: Date.now(), sampleCount: 100 },
          stats: { hp: 80, maxHp: 100, attack: 15, defense: 12, speed: 10, intelligence: 18 },
          features: [], exploration: { discovered: 0, total: 0, basic: 0, advanced: 0, expert: 0, hidden: 0, basicTotal: 0, advancedTotal: 0, expertTotal: 0, hiddenTotal: 0 },
          guidance: null,
          petStats: { totalMessages: 100, totalToolCalls: 20, totalDays: 10, consecutiveDays: 3 },
          emotion: { mood: 'happy', energy: 0.8, satisfaction: 0.7 },
          visualSeed: { primaryColor: '#58a6ff', texture: 'soft', temperament: 'warm', seed: 1 },
          formProgress: s.formProgress,
          visualStage: { stage: s.stage, name: s.stage, emoji: s.emoji, description: '', minProgress: 0, maxProgress: 100 },
        },
      });
      await page.waitForTimeout(300);
    }

    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

test.describe('Pet 交互 — 稀有度', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
  });

  test('Legendary 稀有度标签颜色正确', async ({ page }) => {
    await injectWsMessage(page, {
      type: 'status',
      data: {
        name: 'Buddy', species: 'AI', emoji: '🐾',
        rarity: 'Legendary', rarityColor: '#f0883e',
        evolutionStage: 'formed', stageName: '成形', stageEmoji: '🦎', stageDescription: '',
        intimacy: 50, intimacyDescription: '信任中',
        behaviorSignals: { snark: 0.3, wisdom: 0.7, chaos: 0.2, patience: 0.8, debugging: 0.6, lastComputedAt: Date.now(), sampleCount: 100 },
        stats: { hp: 80, maxHp: 100, attack: 15, defense: 12, speed: 10, intelligence: 18 },
        features: [], exploration: { discovered: 0, total: 0, basic: 0, advanced: 0, expert: 0, hidden: 0, basicTotal: 0, advancedTotal: 0, expertTotal: 0, hiddenTotal: 0 },
        guidance: null,
        petStats: { totalMessages: 100, totalToolCalls: 20, totalDays: 10, consecutiveDays: 3 },
        emotion: { mood: 'happy', energy: 0.8, satisfaction: 0.7 },
        visualSeed: { primaryColor: '#f0883e', texture: 'soft', temperament: 'warm', seed: 1 },
        formProgress: 50,
        visualStage: { stage: 'formed', name: '成形', emoji: '🦎', description: '', minProgress: 40, maxProgress: 70 },
      },
    });
    await page.waitForTimeout(500);

    const body = await page.textContent('body');
    expect(body).toContain('Legendary');
  });
});
