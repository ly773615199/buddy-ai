import { BuddyAgent } from './src/core/agent.js';
import { loadConfig } from './src/config.js';

const config = await loadConfig();
const agent = new BuddyAgent(config, { enableWs: true, verbose: true });

process.on('SIGTERM', () => { agent.shutdown(); process.exit(0); });
process.on('SIGINT', () => { agent.shutdown(); process.exit(0); });

console.log(`🚀 Backend WS running. PID: ${process.pid}`);
// 保持进程存活
await new Promise(() => {});
