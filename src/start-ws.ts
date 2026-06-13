import { BuddyAgent } from './core/agent.js';
import { loadConfig, saveConfig } from './config.js';
import { probeAndAutoRegister } from './core/local-service-prober.js';

let config = await loadConfig();

// 零配置探测：自动发现本地 AI 服务（Ollama/LM Studio/ComfyUI 等）
try {
  const { config: updated, changes } = await probeAndAutoRegister(config);
  if (changes.length > 0) {
    for (const msg of changes) console.log(`  ${msg}`);
    config = updated;
    await saveConfig(config);
    console.log('  💾 已自动保存配置');
  }
} catch (err) {
  console.warn('  ⚠️ 本地服务探测失败:', (err as Error).message);
}

const agent = new BuddyAgent(config, { enableWs: true, verbose: true });

const status = agent.getStatus();
console.log(`\n🦊 ${config.name} (${config.species}) 已启动`);
console.log(`   WS: ws://localhost:${config.ws.port}`);
console.log(`\n✅ 后端运行中\n`);

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n👋 关闭中...');
  try {
    await agent.shutdown();
  } catch (err) {
    console.error('Shutdown error:', err);
  }
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ISSUE-004: 全局未捕获异常处理
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Promise Rejection:', reason);
  // 不立即退出，记录后继续运行
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
  // 未捕获异常是未知状态，优雅退出
  shutdown();
});

await new Promise(() => {});
