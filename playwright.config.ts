import { defineConfig, devices } from '@playwright/test';

const hasRealLLMKey = !!process.env.SILICONFLOW_API_KEY;

export default defineConfig({
  globalSetup: hasRealLLMKey ? './e2e/global-setup.ts' : undefined,
  testDir: './e2e',
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'html' : 'list',
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'on-first-retry' : 'off',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
    },
  },
  projects: [
    // ── Mock 测试（默认，不依赖真实 LLM）──
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: '/usr/bin/chromium',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--font-render-hinting=none',
            '--disable-font-subpixel-positioning',
          ],
        },
      },
      testIgnore: '**/real-llm*.spec.ts',
    },
    // ── 真实 LLM 测试（需手动指定 --project=real-llm）──
    ...(hasRealLLMKey
      ? [
          {
            name: 'real-llm' as const,
            use: {
              ...devices['Desktop Chrome'],
              launchOptions: {
                executablePath: '/usr/bin/chromium',
                args: [
                  '--no-sandbox',
                  '--disable-setuid-sandbox',
                  '--disable-gpu',
                  '--font-render-hinting=none',
                  '--disable-font-subpixel-positioning',
                ],
              },
            },
            testMatch: '**/real-llm*.spec.ts',
            timeout: 60_000,
            expect: { timeout: 15_000 },
          },
        ]
      : []),
  ],
  webServer: [
    {
      command: 'npx tsx --no-cache src/start-ws.ts',
      port: 8765,
      // 真实 LLM 测试不复用旧 server（避免 token 不匹配）
      reuseExistingServer: !hasRealLLMKey,
      timeout: 20000,
      cwd: '.',
      env: {
        ...process.env,
        // 测试环境缩短 isProcessing 超时（默认 120s 太长）
        BUDDY_PROCESSING_TIMEOUT_MS: '15000',
        // E2E 测试跳过订阅配额限制
        BUDDY_SKIP_SUBSCRIPTION: '1',
        // Mock LLM: 默认启用，避免 chromium 测试调真实 API
        // real-llm project 会启动独立 server 覆盖此设置
        ...(hasRealLLMKey ? {} : { BUDDY_MOCK_LLM: '1' }),
        // 强制启用三脑系统，确保 three-brain E2E 测试覆盖
        BUDDY_THREE_BRAIN: '1',
      },
    },
    {
      command: 'npx vite --port 5173',
      port: 5173,
      reuseExistingServer: true,
      timeout: 15000,
      cwd: './frontend',
    },
  ],
});
