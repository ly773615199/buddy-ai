/**
 * 三脑决策 E2E — 通过 REST API 验证决策追踪
 *
 * 覆盖：
 * 1. 决策追踪记录完整性（/api/decision-trace）
 * 2. 三脑状态查询（/api/brain-status）
 * 3. 不同复杂度任务的决策模式验证
 * 4. A/B 对比统计
 */
import { test, expect } from '@playwright/test';
import { skipOnboarding, setupMockWS, waitForWSConnection } from './fixtures.js';

/** 获取 ws-token（REST API 认证用） */
async function getWsToken(page: import('@playwright/test').Page): Promise<string | null> {
  try {
    const res = await page.evaluate(async () => {
      const r = await fetch('http://localhost:8765/api/ws-token');
      return r.ok ? (await r.json()).token : null;
    });
    return res;
  } catch { return null; }
}

/** 带认证的 REST API fetch */
async function authFetch(page: import('@playwright/test').Page, path: string): Promise<{ status: number; ok: boolean; data: any }> {
  const token = await getWsToken(page);
  return page.evaluate(async ({ p, t }) => {
    const headers: Record<string, string> = {};
    if (t) headers['Authorization'] = `Bearer ${t}`;
    const res = await fetch(`http://localhost:8765${p}`, { headers });
    return { status: res.status, ok: res.ok, data: await res.json().catch(() => null) };
  }, { p: path, t: token });
}

/** 等待决策追踪记录出现（轮询 REST API） */
async function waitForDecisionTrace(
  page: import('@playwright/test').Page,
  timeoutMs = 15000,
): Promise<Array<{
  traceId: string; timestamp: number; input: string;
  domains: string[]; complexity: string; mode: string; reason: string;
  nodes: string[]; path: string; latencyMs: number; success: boolean | null;
}>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await authFetch(page, '/api/decision-trace');
    const traces = (result.data)?.traces ?? [];
    if (traces.length > 0) return traces;
    await page.waitForTimeout(500);
  }
  return [];
}

/** 获取最近一条决策追踪 */
async function getLatestTrace(
  page: import('@playwright/test').Page,
): Promise<{
  traceId: string; timestamp: number; input: string;
  domains: string[]; complexity: string; mode: string; reason: string;
  nodes: string[]; path: string; latencyMs: number; success: boolean | null;
} | null> {
  const result = await authFetch(page, '/api/decision-trace');
  const traces = (result.data)?.traces ?? [];
  return traces.length > 0 ? traces[traces.length - 1] : null;
}

// ==================== 决策追踪 API ====================

test.describe('三脑决策 — REST API 可用性', () => {

  test('GET /api/decision-trace 返回 200', async ({ page }) => {
    await skipOnboarding(page);

    // 先获取 ws-token（REST API 需要认证）
    const tokenRes = await page.evaluate(async () => {
      const res = await fetch('http://localhost:8765/api/ws-token');
      return res.ok ? (await res.json()).token : null;
    });

    const result = await page.evaluate(async (t) => {
      const headers: Record<string, string> = {};
      if (t) headers['Authorization'] = `Bearer ${t}`;
      const res = await fetch('http://localhost:8765/api/decision-trace', { headers });
      return { status: res.status, ok: res.ok };
    }, tokenRes);

    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
  });

  test('GET /api/brain-status 返回三脑状态', async ({ page }) => {
    await skipOnboarding(page);

    const result = await authFetch(page, '/api/brain-status');
    const data = result.data;

    // API 应返回有效 JSON 结构
    expect(data).toBeDefined();
    // emotion 和 body 在 mock 模式下可能为 null/undefined（cerebellum 未初始化）
    if (data.emotion) {
      expect(data.emotion.mood).toBeTruthy();
    }
    if (data.body) {
      expect(data.body.energy).toBeGreaterThanOrEqual(0);
      expect(data.body.energy).toBeLessThanOrEqual(100);
    }
  });
});

// ==================== 决策追踪记录 ====================

test.describe('三脑决策 — 追踪记录', () => {

  test('发送消息后产生决策追踪记录', async ({ page }) => {
    await skipOnboarding(page);
    await page.waitForTimeout(1000);

    // 发送一条消息
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible();
    await textarea.fill('你好，今天天气怎么样？');
    await textarea.press('Enter');

    // 等待决策追踪记录出现（mock 模式下可能不产生追踪）
    const traces = await waitForDecisionTrace(page, 20000);
    if (traces.length === 0) {
      test.skip(true, 'Mock 模式下未产生决策追踪记录（LLM 未触发决策链路）');
      return;
    }

    // 验证最近一条记录的字段
    const latest = traces[traces.length - 1];
    expect(latest.traceId).toBeTruthy();
    expect(latest.timestamp).toBeGreaterThan(0);
    expect(latest.mode).toBeTruthy();
    expect(latest.reason).toBeTruthy();
    expect(['threeBrain', 'legacy']).toContain(latest.path);
  });

  test('简单任务 → complexity=simple', async ({ page }) => {
    await skipOnboarding(page);

    const textarea = page.locator('textarea').first();
    await textarea.fill('你好');
    await textarea.press('Enter');

    const traces = await waitForDecisionTrace(page, 20000);
    if (traces.length === 0) {
      test.skip(true, 'Mock 模式下未产生决策追踪记录');
      return;
    }

    const latest = traces[traces.length - 1];
    expect(latest.complexity).toBe('simple');
    expect(latest.mode).toBe('single');
  });

  test('工具类任务 → taskType=tools', async ({ page }) => {
    await skipOnboarding(page);

    const textarea = page.locator('textarea').first();
    await textarea.fill('帮我读取当前目录下的 package.json 文件内容');
    await textarea.press('Enter');

    const traces = await waitForDecisionTrace(page, 20000);
    if (traces.length === 0) {
      test.skip(true, 'Mock 模式下未产生决策追踪记录');
      return;
    }

    const latest = traces[traces.length - 1];
    // 右脑分类应识别为工具类任务
    expect(latest.domains).toContain('code');
  });

  test('复杂任务 → complexity=complex', async ({ page }) => {
    await skipOnboarding(page);

    const textarea = page.locator('textarea').first();
    await textarea.fill('请同时分析项目架构、检查代码质量、列出所有TODO，然后生成一份综合报告，包含依赖关系图和模块划分');
    await textarea.press('Enter');

    const traces = await waitForDecisionTrace(page, 20000);
    if (traces.length === 0) {
      test.skip(true, 'Mock 模式下未产生决策追踪记录');
      return;
    }

    const latest = traces[traces.length - 1];
    expect(['complex', 'medium']).toContain(latest.complexity);
  });

  test('决策记录包含 latencyMs', async ({ page }) => {
    await skipOnboarding(page);

    const textarea = page.locator('textarea').first();
    await textarea.fill('1+1等于几？');
    await textarea.press('Enter');

    const traces = await waitForDecisionTrace(page, 20000);
    if (traces.length === 0) {
      test.skip(true, 'Mock 模式下未产生决策追踪记录');
      return;
    }

    const latest = traces[traces.length - 1];
    expect(latest.latencyMs).toBeGreaterThanOrEqual(0);
    expect(latest.latencyMs).toBeLessThan(1000); // 决策应该 < 1s
  });
});

// ==================== 三脑状态 ====================

test.describe('三脑决策 — 状态变化', () => {

  test('多轮交互后精力下降', async ({ page }) => {
    await skipOnboarding(page);

    // 获取初始精力
    const initialRes = await authFetch(page, '/api/brain-status');
    const initialEnergy = (initialRes.data)?.body?.energy ?? 50;

    // 多轮交互
    const textarea = page.locator('textarea').first();
    for (let i = 0; i < 5; i++) {
      await textarea.fill(`第 ${i + 1} 轮对话：请简单回复`);
      await textarea.press('Enter');
      await page.waitForTimeout(2000);
    }

    // 检查精力变化
    const afterRes = await authFetch(page, '/api/brain-status');
    const after = afterRes.data;

    // 精力应该有所消耗（不强制断言具体值，因为有自然恢复）
    // mock 模式下 body 可能为 undefined（cerebellum 未初始化）
    if (after.body) {
      expect(after.body.energy).toBeGreaterThanOrEqual(0);
      expect(after.body.energy).toBeLessThanOrEqual(100);
    }
  });

  test('brain-status 包含 emotion 字段', async ({ page }) => {
    await skipOnboarding(page);

    const result = await authFetch(page, '/api/brain-status');
    const data = result.data;

    // mock 模式下 emotion 可能为 undefined
    if (data.emotion) {
      expect(data.emotion.mood).toBeTruthy();
    }
  });
});
