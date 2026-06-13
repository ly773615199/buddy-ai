/**
 * 真实 LLM E2E Fixture — 硅基流动 (SiliconFlow) API
 *
 * 与 mock-backend.ts 互补：
 *   - mock-backend: 纯前端模拟，不依赖后端服务和真实 API
 *   - real-llm-fixtures: 启动真实后端，用真实 SiliconFlow API 跑完整链路
 *
 * 使用方式：
 *   SILICONFLOW_API_KEY=sk-xxx npx playwright test e2e/real-llm.spec.ts
 *
 * 前置条件：
 *   1. 设置环境变量 SILICONFLOW_API_KEY
 *   2. 后端服务已启动（playwright.config.ts 的 webServer 会自动拉起）
 */
import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const CONFIG_DIR = path.join(process.env.HOME ?? '/tmp', '.buddy');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

/** SiliconFlow 默认配置 */
export const SILICONFLOW_DEFAULTS = {
  provider: 'siliconflow',
  model: process.env.SILICONFLOW_MODEL ?? 'Qwen/Qwen2.5-7B-Instruct',
  baseUrl: 'https://api.siliconflow.cn/v1',
} as const;

/** 弱模型配置（用于弱模型兼容性测试） */
export const SILICONFLOW_WEAK_MODEL = 'Qwen/Qwen2.5-7B-Instruct';

/** 强模型配置（用于工具调用/复杂推理测试） */
export const SILICONFLOW_STRONG_MODEL = 'Qwen/Qwen2.5-32B-Instruct';

/** 从环境变量获取 API Key，缺失时返回空字符串（不抛异常） */
export function getSiliconFlowKey(): string {
  return process.env.SILICONFLOW_API_KEY ?? '';
}

/**
 * 写入 ~/.buddy/config.json 使用真实 SiliconFlow API
 * 测试前调用，测试后用 restoreConfig 恢复
 *
 * 注意：此函数在 webServer 启动前调用（globalSetup 或 beforeAll），
 * 确保后端启动时能读取到正确的 LLM 配置。
 */
export function setupRealLLMConfig(apiKey?: string): void {
  const key = apiKey ?? getSiliconFlowKey();

  // 备份现有配置
  try {
    const existing = fs.readFileSync(CONFIG_FILE, 'utf-8');
    fs.writeFileSync(CONFIG_FILE + '.bak', existing);
  } catch { /* 没有现有配置，跳过 */ }

  // 确保目录存在
  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  const config = {
    name: 'Buddy-E2E',
    species: '测试龙',
    personality: { snark: 30, wisdom: 50, chaos: 20, patience: 70, debugging: 40 },
    models: {
      providers: [
        {
          id: 'siliconflow',
          type: 'siliconflow' as const,
          model: SILICONFLOW_DEFAULTS.model,
          apiKey: key,
          baseUrl: SILICONFLOW_DEFAULTS.baseUrl,
        },
      ],
    },
    ws: { port: 8765, token: 'e2e-test-token' },
    sandbox: { timeout: 30000, workspace: '/tmp/buddy-sandbox' },
    idle: { enabled: false },
    tts: { enabled: false },
    mcp: { servers: [] },
    platforms: {},
  };

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * 同步预写入配置（供 globalSetup 使用，在 webServer 启动前调用）
 * 解决 beforeAll 与 webServer 启动的时序竞争
 */
export function prewriteRealLLMConfig(): void {
  const key = getSiliconFlowKey();
  if (!key) return;
  setupRealLLMConfig(key);
}

/**
 * 恢复原始配置（测试后清理）
 */
export function restoreConfig(): void {
  const backupFile = CONFIG_FILE + '.bak';
  if (fs.existsSync(backupFile)) {
    fs.copyFileSync(backupFile, CONFIG_FILE);
    fs.unlinkSync(backupFile);
  } else if (fs.existsSync(CONFIG_FILE)) {
    fs.unlinkSync(CONFIG_FILE);
  }
}

/**
 * 获取 ws-token（REST API 需要 Bearer 认证）
 */
async function getAuthHeaders(page: Page): Promise<Record<string, string>> {
  try {
    const tokenRes = await page.request.get('/api/ws-token');
    const { token } = await tokenRes.json();
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/**
 * 通过 REST API 配置 LLM provider（替代已删除的 localStorage buddy_llm_config）
 * 使用 addInitScript 设置 visual_seed，provider 配置通过 POST /api/model-pool/providers 完成
 */
export async function setupFrontendLLMConfig(
  page: Page,
  options?: { apiKey?: string; model?: string },
) {
  const apiKey = options?.apiKey ?? getSiliconFlowKey();
  const model = options?.model ?? SILICONFLOW_DEFAULTS.model;

  // addInitScript 只设置 visual_seed（llm_config 已移至服务端）
  await page.addInitScript(
    () => {
      localStorage.setItem(
        'buddy_visual_seed',
        JSON.stringify({
          primaryColor: '#58a6ff',
          secondaryColor: '#a371f7',
          texture: 'soft',
          temperament: 'warm',
        }),
      );
    },
  );

  // 通过 REST API 直接配置 provider（绕过前端 localStorage）
  try {
    const headers = await getAuthHeaders(page);
    await page.request.post('/api/model-pool/providers', {
      headers,
      data: {
        id: 'siliconflow',
        type: 'siliconflow',
        model: model,
        apiKey: apiKey,
        baseUrl: 'https://api.siliconflow.cn/v1',
      },
    });
  } catch {
    // 后端可能还没启动，忽略错误（addInitScript 设置的 visual_seed 仍然有效）
  }
}

/**
 * 清理测试中添加的临时 provider（防止 Thompson Sampling 候选池被污染）
 *
 * 问题：测试 POST /api/model-pool/providers 添加了 e2e-test-provider / e2e-refresh-test，
 * 但后续测试的 setupFrontendLLMConfig 不会删除这些旧 provider，导致模型池污染。
 * 此函数通过 DELETE API 清理，确保测试隔离。
 */
export async function cleanupTestProviders(page: Page): Promise<void> {
  try {
    const headers = await getAuthHeaders(page);
    for (const id of ['e2e-test-provider', 'e2e-refresh-test', 'siliconflow-e2e', 'e2e-test']) {
      try {
        await page.request.delete('/api/model-pool/providers', {
          headers,
          data: { id },
        });
      } catch { /* 忽略：provider 可能不存在或后端未启动 */ }
    }
  } catch { /* 忽略：获取 auth headers 失败 */ }
}

/**
 * 清理 localStorage 中的敏感信息 + 测试 provider
 * 每个测试结束后调用，防止截图/trace 泄露和模型池污染
 */
export async function cleanupSensitiveStorage(page: Page): Promise<void> {
  await page.evaluate(() => {
    // 清理 visual_seed 中可能残留的敏感数据
    // llm_config 已移至服务端，localStorage 中不再存储 apiKey
  });

  // 清理测试中可能添加的临时 provider，防止模型池污染
  await cleanupTestProviders(page);
}

/**
 * 重新同步后端 LLM 配置到正确的 key
 *
 * 场景：某个测试（如无效 key 测试）污染了后端配置，需要在后续测试前修复。
 *
 * 原理：通过 REST API 重新添加 provider，触发后端 reconfigureLLM + 模型池刷新。
 */
export async function resyncBackendConfig(page: Page): Promise<void> {
  const apiKey = getSiliconFlowKey();
  if (!apiKey) return;

  // 通过 REST API 重新配置 provider（替代已删除的 llm_config WS 消息）
  try {
    const headers = await getAuthHeaders(page);
    await page.request.post('/api/model-pool/providers', {
      headers,
      data: {
        id: 'siliconflow',
        type: 'siliconflow',
        model: SILICONFLOW_DEFAULTS.model,
        apiKey: apiKey,
        baseUrl: SILICONFLOW_DEFAULTS.baseUrl,
      },
    });
  } catch {
    console.warn('[resyncBackendConfig] REST API 调用失败，跳过');
  }
}

/**
 * 等待真实 LLM 回复（带超时）
 * 真实 API 比 mock 慢，需要更长等待
 *
 * 策略：等待页面文本稳定（连续 2s 无变化 = 流式结束）
 */
export async function waitForLLMResponse(
  page: Page,
  timeoutMs: number = 30000,
): Promise<string> {
  const startTime = Date.now();
  let lastSnapshot = '';
  let stableSince = Date.now();
  const STABLE_MS = 2000; // 连续 2s 无变化视为完成

  // 已知的 UI 固定文案（排除干扰）
  // 包含 thinking 消息文本（useWebSocket 在 thinking 事件时插入，llm_response 时移除）
  const UI_TEXTS = [
    '已连接', '🟢 已连接', '打个招呼吧', '思考中', '发送', 'Buddy',
    '🤔 让我看看...', '连接中...', '断开连接',
    '让我想想...', '🤔', '💭', '思考中...',
  ];

  while (Date.now() - startTime < timeoutMs) {
    // 优先查找 assistant 消息气泡（role=assistant 的消息容器）
    const assistantText = await page.evaluate(() => {
      // 尝试找 assistant 消息（常见 class/data 属性模式）
      const candidates = document.querySelectorAll('[data-role="assistant"], .message-assistant, .assistant-message, .chat-message-assistant');
      for (const el of candidates) {
        const text = el.textContent?.trim();
        if (text && text.length > 1) return text;
      }
      return null;
    });

    if (assistantText) {
      return assistantText;
    }

    // 回退：获取页面上所有非 UI 文本
    const allMessages = await page.evaluate((uiTexts: string[]) => {
      const body = document.body;
      const divs = body.querySelectorAll('div, p, span');
      const texts: string[] = [];
      divs.forEach(d => {
        if (d.children.length === 0 && d.textContent?.trim()) {
          const t = d.textContent.trim();
          if (t.length > 1 && !uiTexts.some(ui => t === ui)) {
            texts.push(t);
          }
        }
      });
      return texts;
    }, UI_TEXTS);

    const currentSnapshot = allMessages.join('|||');

    if (currentSnapshot !== lastSnapshot) {
      // 内容变化了 → 重置稳定计时
      lastSnapshot = currentSnapshot;
      stableSince = Date.now();
    } else if (currentSnapshot.length > 0 && Date.now() - stableSince >= STABLE_MS) {
      // 内容稳定 2s → 流式结束，返回最后一条非 UI 消息
      return allMessages[allMessages.length - 1] ?? '';
    }

    await page.waitForTimeout(300);
  }

  // 超时但有内容 → 返回已有的最后一条
  if (lastSnapshot) {
    const parts = lastSnapshot.split('|||');
    return parts[parts.length - 1] ?? '';
  }
  throw new Error(`等待 LLM 回复超时 (${timeoutMs}ms)`);
}

/**
 * 发送消息并等待真实 LLM 回复
 * 确认消息已发出（用户气泡出现）后再等回复
 * 如果后端忙（isProcessing），自动重试
 */
export async function sendAndReceive(
  page: Page,
  message: string,
  timeoutMs: number = 30000,
): Promise<string> {
  const textarea = page.locator('textarea').first();

  // 最多重试 5 次（后端 isProcessing 锁可能还没释放，安全超时 120s）
  for (let attempt = 0; attempt < 5; attempt++) {
    await textarea.fill(message);
    await textarea.press('Enter');

    // 等一下看是否被拒绝
    await page.waitForTimeout(1000);

    // 检查是否出现"处理中"拒绝消息
    const bodyText = await page.textContent('body');
    const rejected = bodyText?.includes('我还在处理') ?? false;

    if (rejected) {
      // 后端忙，等 10s 后重试
      console.log(`[sendAndReceive] 后端忙，第 ${attempt + 1} 次重试（等 10s）...`);
      await page.waitForTimeout(10000);
      continue;
    }

    // 消息已发出，等待回复
    return waitForLLMResponse(page, timeoutMs);
  }

  // 3 次都忙，最后一次直接等
  return waitForLLMResponse(page, timeoutMs);
}
