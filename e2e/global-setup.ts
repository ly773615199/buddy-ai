/**
 * Playwright globalSetup — 在 webServer 启动前预写 LLM 配置
 *
 * 执行顺序：globalSetup → webServer 启动 → beforeAll → 测试用例
 * 这样后端启动时就能读取到正确的 ~/.buddy/config.json
 */
import { prewriteRealLLMConfig } from './real-llm-fixtures.js';

export default function globalSetup() {
  prewriteRealLLMConfig();
}
