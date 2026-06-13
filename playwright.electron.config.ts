/**
 * Playwright 配置 — Electron 模块单元测试
 *
 * 这些测试不需要浏览器或 web server，
 * 只需 Node.js 环境中运行即可。
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/electron-*.spec.ts',
  timeout: 15000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  // 不启动任何 web server（纯 Node.js 测试）
  webServer: undefined,
  projects: [
    {
      name: 'node',
      // 使用空的浏览器配置，实际不会启动浏览器
      use: {},
    },
  ],
});
