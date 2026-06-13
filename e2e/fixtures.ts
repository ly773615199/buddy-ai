/**
 * E2E 公共 fixture — 所有 Playwright 测试共享
 * 提取自各 spec 文件的重复辅助函数
 */
import { expect, type Page } from '@playwright/test';

/**
 * 视觉回归稳定化 — 截图前调用，消除动态元素干扰
 * 解决：动画、时间戳、光标闪烁、随机 ID 等导致的像素差异
 */
export async function stabilizeForScreenshot(page: Page) {
  await page.evaluate(() => {
    // 1. 冻结所有 CSS 动画和过渡
    const style = document.createElement('style');
    style.id = '__e2e_stabilize';
    style.textContent = `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
      /* 隐藏动态元素 */
      [data-testid="timestamp"],
      [data-testid="typing-indicator"],
      .cursor-blink,
      .pulse,
      .animate-spin,
      .animate-pulse {
        visibility: hidden !important;
      }
    `;
    document.head.appendChild(style);

    // 2. 冻结时间（Date.now 返回固定值）
    const fixedTime = 1714502400000; // 2026-05-01 00:00:00 UTC
    const origNow = Date.now;
    Date.now = () => fixedTime;
    (window as any).__e2e_restoreTime = () => { Date.now = origNow; };

    // 3. 禁用 requestAnimationFrame 的动画推进
    const origRAF = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb) => origRAF(() => cb(0));
  });

  // 等一帧让样式生效
  await page.waitForTimeout(100);
}

/**
 * 截图后恢复（可选，测试结束自动清理）
 */
export async function restoreAfterScreenshot(page: Page) {
  await page.evaluate(() => {
    document.getElementById('__e2e_stabilize')?.remove();
    (window as any).__e2e_restoreTime?.();
  });
}

/**
 * 等待 WS 连接就绪，超时则抛出错误（不静默 skip）
 * 用于需要 WS 连接的测试，确保 CI 中连接失败会被报告
 */
export async function waitForWSConnection(page: Page, timeoutMs = 10000) {
  // 使用 .first() 避免 strict mode violation
  const statusText = page.getByText(/已连接|Connected/).first();
  await statusText.waitFor({ timeout: timeoutMs }).catch((err) => {
    throw new Error(
      `WS 连接超时 (${timeoutMs}ms) — 后端可能未启动\n原始错误: ${err.message}`,
    );
  });
}

/** 跳过 Onboarding（在页面脚本执行前注入 localStorage，避免 reload 竞态） */
export async function skipOnboarding(page: Page) {
  // addInitScript 在页面 JS 执行前运行，确保 React mount 时就能读到 seed
  await page.addInitScript(() => {
    localStorage.setItem('buddy_visual_seed', JSON.stringify({
      primaryColor: '#58a6ff',
      secondaryColor: '#a371f7',
      texture: 'soft',
      temperament: 'warm',
    }));
  });
  await page.goto('/');
  // 等待主界面渲染完成（h1 出现 = 跳过 onboarding 成功）
  await expect(page.locator('h1')).toBeVisible({ timeout: 10000 });
}

/** 清除 localStorage 模拟首次访问 */
export async function simulateFirstVisit(page: Page) {
  // 用 addInitScript 确保在页面脚本执行前清除，避免时序竞争
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  // 再次清除（当前页面上下文），双重保险
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

/** 注入 mock WebSocket（拦截 send，保留实例引用） */
export async function setupMockWS(page: Page) {
  await page.addInitScript(() => {
    const OriginalWS = window.WebSocket;
    window.WebSocket = function (url: string, protocols?: string | string[]) {
      const ws = new OriginalWS(url, protocols);
      (window as any).__mockWs = { instance: ws, sendCalls: [] as string[] };
      const origSend = ws.send.bind(ws);
      ws.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
        (window as any).__mockWs.sendCalls.push(typeof data === 'string' ? data : String(data));
        origSend(data as any);
      };
      return ws;
    } as any;
    window.WebSocket.prototype = OriginalWS.prototype;
    Object.assign(window.WebSocket, {
      CONNECTING: OriginalWS.CONNECTING,
      OPEN: OriginalWS.OPEN,
      CLOSING: OriginalWS.CLOSING,
      CLOSED: OriginalWS.CLOSED,
    });
  });
}

/** 通过 mock WS 实例注入消息（模拟服务端推送）
 *  使用 dispatchEvent 统一触发所有监听器（BuddyLink 用 addEventListener，CognitiveDashboard 同理）
 *  注入后等待 React 渲染完成（BuddyLink 的异步 pipeline + React 批处理需要时间）
 */
export async function injectWsMessage(page: Page, data: object) {
  await page.evaluate((msg) => {
    const ws = (window as any).__mockWs?.instance;
    if (ws) {
      const payload = JSON.stringify(msg);
      ws.dispatchEvent(new MessageEvent('message', { data: payload }));
    }
  }, data);
  // 等待 BuddyLink pipeline（async）+ React 批处理 flush
  await page.waitForTimeout(200);
}

/** 默认 buddyState 数据 */
const DEFAULT_BUDDY_STATE = {
  name: 'Buddy', species: 'AI', emoji: '🐾',
  rarity: 'Rare', rarityColor: '#d29922',
  evolutionStage: 'formed', stageName: '成形', stageEmoji: '🦎', stageDescription: '',
  intimacy: 42, intimacyDescription: '信任中',
  behaviorSignals: { snark: 0.3, wisdom: 0.7, chaos: 0.2, patience: 0.8, debugging: 0.6, lastComputedAt: Date.now(), sampleCount: 100 },
  stats: { hp: 80, maxHp: 100, attack: 15, defense: 12, speed: 10, intelligence: 18 },
  features: [],
  exploration: { discovered: 0, total: 0, basic: 0, advanced: 0, expert: 0, hidden: 0, basicTotal: 0, advancedTotal: 0, expertTotal: 0, hiddenTotal: 0 },
  guidance: null,
  petStats: {
    totalMessages: 156, totalToolCalls: 42, totalDays: 14, consecutiveDays: 3,
    dailyActivity: [
      { date: '2026-04-23', messages: 10, toolCalls: 4 },
      { date: '2026-04-22', messages: 8, toolCalls: 2 },
    ],
  },
  emotion: { mood: 'happy', energy: 0.8, satisfaction: 0.7 },
  visualSeed: { primaryColor: '#58a6ff', texture: 'soft', temperament: 'warm', seed: 1 },
  formProgress: 50,
  visualStage: { stage: 'formed', name: '成形', emoji: '🦎', description: '', minProgress: 40, maxProgress: 70 },
};

/** 注入 buddyState（通过 status 事件），支持部分覆盖 */
export async function injectBuddyState(page: Page, overrides?: Record<string, unknown>) {
  const data = overrides
    ? { ...DEFAULT_BUDDY_STATE, ...overrides }
    : DEFAULT_BUDDY_STATE;
  await injectWsMessage(page, { type: 'status', data });
}
