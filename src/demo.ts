import { MockLLM } from './core/mock-llm.js';
import { ToolRegistry } from './tools/registry.js';
import { ALL_TOOLS } from './tools/builtin.js';
import { MemoryStore } from './memory/store.js';
import { PetManager } from './pet/index.js';
import { buildSystemPrompt, buildMessages } from './personality/prompt.js';
import { DEFAULT_CONFIG, PRESET_PERSONALITIES } from './types.js';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DB = '/tmp/buddy-demo-memory.db';
const TEST_PET_DB = '/tmp/buddy-demo-pet.db';
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
if (fs.existsSync(TEST_PET_DB)) fs.unlinkSync(TEST_PET_DB);

// ==================== Demo 配置 ====================

const config = {
  ...DEFAULT_CONFIG,
  name: '闪电',
  species: '光灵',
  personality: PRESET_PERSONALITIES.sharp_mentor, // 犀利导师型
};

console.log(`
╔══════════════════════════════════════════╗
║  🦊 Buddy v2.0 Phase A 完整演示          ║
║  名字: ${config.name.padEnd(34)}║
║  物种: ${config.species.padEnd(34)}║
║  性格: 犀利导师 (毒舌+智慧+高调试)        ║
╚══════════════════════════════════════════╝
`);

// ==================== 初始化 ====================

const registry = new ToolRegistry();
registry.registerMany(ALL_TOOLS);
const memory = new MemoryStore(TEST_DB);
const pet = new PetManager(TEST_PET_DB);
const systemPrompt = buildSystemPrompt(config);
const llm = new MockLLM(ALL_TOOLS);

// ==================== 测试场景 ====================

const testCases = [
  { desc: '👋 打招呼', input: '你好' },
  { desc: '❓ 能力询问', input: '你能做什么？' },
  { desc: '📁 列文件', input: '帮我列一下当前目录的文件' },
  { desc: '⏰ 查时间', input: '现在几点了' },
  { desc: '⚡ 执行命令', input: '执行 `echo "Hello Buddy!"`' },
  { desc: '🔍 搜索文件', input: '搜索 "ToolDef"' },
  { desc: '🌿 Git 状态', input: '看看 git 状态' },
  { desc: '📄 读文件', input: '读一下 package.json' },
];

async function runDemo() {
  for (const tc of testCases) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`${tc.desc}`);
    console.log(`你 > ${tc.input}`);
    console.log('');

    // 存储用户消息
    memory.addMessage('user', tc.input);
    memory.incrementInteraction();

    // 检索记忆
    const relevantMemories = memory.searchMemories(tc.input, 3);

    // 构建消息
    const recentMessages = memory.getRecentMessages(20);
    const messages = buildMessages(systemPrompt, recentMessages, relevantMemories);

    // 调用 Mock LLM
    const result = await llm.chat(messages, 5);

    // 工具调用详情
    if (result.toolCalls.length > 0) {
      for (const tc of result.toolCalls) {
        console.log(`  🔧 调用工具: ${tc.name}`);
        const args = JSON.stringify(tc.args);
        console.log(`     参数: ${args.length > 80 ? args.slice(0, 80) + '...' : args}`);
        const preview = tc.result.slice(0, 300);
        console.log(`     结果: ${preview}${tc.result.length > 300 ? '...' : ''}`);
        console.log('');
      }
    }

    // 存储回复
    memory.addMessage('assistant', result.text);

    // 养成 v2：追踪功能 + 亲密度
    for (const tc of result.toolCalls) {
      pet.trackFeature(tc.name);
    }
    if (result.toolCalls.length > 0) {
      pet.addIntimacy(2);
    }

    // 日记
    if (result.toolCalls.length > 0) {
      const toolsUsed = result.toolCalls.map(t => t.name).join(', ');
      memory.addDiaryEntry(`帮用户使用了工具: ${toolsUsed}`);
    }

    console.log(`${config.name} > ${result.text}`);
  }

  // ==================== 统计 ====================

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 演示结束 - 统计数据\n`);

  const stats = memory.getStats();
  const petSummary = pet.getSummary();
  console.log(`  对话记录: ${stats.messages} 条`);
  console.log(`  长期记忆: ${stats.memories} 条`);
  console.log(`  日记条目: ${stats.diaryEntries} 天`);
  console.log(`  总互动数: ${stats.interactions} 次`);
  console.log(`  亲密度:   ${petSummary.intimacy}/100 (${petSummary.intimacyDescription})`);
  console.log(`  进化阶段: ${petSummary.stageEmoji} ${petSummary.stageName}`);
  console.log(`  探索进度: ${petSummary.exploration.discovered}/${petSummary.exploration.total}`);

  // 日记内容
  const today = new Date().toISOString().split('T')[0];
  const diary = memory.getDiaryEntry(today);
  if (diary) {
    console.log(`\n📖 今日日记 (${today}):`);
    console.log(`  ${diary.content.split('\n').join('\n  ')}`);
  }

  // 清理
  pet.close();
  memory.close();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  if (fs.existsSync(TEST_PET_DB)) fs.unlinkSync(TEST_PET_DB);

  console.log(`\n✅ Phase A 全流程验证通过\n`);
}

runDemo().catch((err) => {
  console.error('❌ 演示失败:', err);
  process.exit(1);
});
