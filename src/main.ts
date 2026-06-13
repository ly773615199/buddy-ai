import * as readline from 'readline';
import * as path from 'path';
import { BuddyAgent } from './core/agent.js';
import { DEFAULT_CONFIG, PRESET_PERSONALITIES, type BuddyConfig } from './types.js';
import { loadConfig, saveConfig, configExists, getConfigDir } from './config.js';
import { probeAndAutoRegister } from './core/local-service-prober.js';
import { logger } from './audit/structured-logger.js';

// ==================== CLI 入口 ====================

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === 'init') {
    await initConfig();
    return;
  }

  if (args[0] === 'status') {
    await showStatus();
    return;
  }

  // 默认启动 CLI 交互
  const verbose = args.includes('--verbose') || args.includes('-v');
  await startCLI(verbose);
}

/**
 * buddy init - 初始化配置
 */
async function initConfig(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));

  console.log('\n🦊 Buddy 初始化向导\n');

  // 名字
  const name = (await ask('给你的 Buddy 起个名字 [闪电]: ')) || '闪电';
  console.log(`  → 名字: ${name}`);

  // 物种
  console.log('\n  可选物种: 光灵 ✨ / 大鹅 🪿 / 猫 🐱 / 龙 🐲 / 幽灵 👻 / 机器人 🤖 / 蘑菇 🍄 / 胖胖 🐻');
  const species = (await ask('物种 [光灵]: ')) || '光灵';
  console.log(`  → 物种: ${species}`);

  // 性格
  console.log('\n  性格预设:');
  console.log('    1. 犀利导师 (毒舌+智慧，适合开发者)');
  console.log('    2. 温和伙伴 (耐心+善良，适合所有人)');
  console.log('    3. 沙雕朋友 (混乱+有趣，适合摸鱼)');
  const pc = (await ask('选择 [1-3, 默认2]: ')) || '2';
  const personalityMap: Record<string, keyof typeof PRESET_PERSONALITIES> = {
    '1': 'sharp_mentor', '2': 'warm_companion', '3': 'chaotic_friend',
  };
  const personalityKey = personalityMap[pc] ?? 'warm_companion';
  console.log(`  → 性格: ${personalityKey}`);

  // LLM
  console.log('\n  LLM 配置:');

  const providerDefaults: Record<string, { label: string; model: string; baseUrl: string; free: boolean }> = {
    siliconflow: { label: '硅基流动 (推荐，有免费额度)', model: 'Qwen/Qwen2.5-7B-Instruct', baseUrl: 'https://api.siliconflow.cn/v1', free: true },
    deepseek:    { label: 'DeepSeek (性价比高)',         model: 'deepseek-chat',           baseUrl: 'https://api.deepseek.com/v1',    free: false },
    openai:      { label: 'OpenAI (GPT-4o)',             model: 'gpt-4o-mini',             baseUrl: '',                                free: false },
    ollama:      { label: 'Ollama (本地，无需 Key)',      model: 'llama3',                  baseUrl: 'http://localhost:11434/v1',       free: true },
  };

  console.log('    可选 Provider:');
  const providerKeys = Object.keys(providerDefaults);
  providerKeys.forEach((k, i) => {
    const pd = providerDefaults[k];
    const freeTag = pd.free ? ' 🆓' : '';
    console.log(`      ${i + 1}. ${pd.label}${freeTag}`);
  });
  console.log(`      ${providerKeys.length + 1}. 自定义 (其他 OpenAI 兼容 API)`);

  const providerChoice = (await ask(`\n    选择 [1-${providerKeys.length + 1}, 默认1]: `)) || '1';
  const idx = parseInt(providerChoice) - 1;
  let provider: string;
  let defaults: { model: string; baseUrl: string };

  if (idx >= 0 && idx < providerKeys.length) {
    provider = providerKeys[idx];
    const pd = providerDefaults[provider];
    defaults = { model: pd.model, baseUrl: pd.baseUrl };
    console.log(`    → ${pd.label}`);
  } else {
    provider = 'custom';
    defaults = { model: '', baseUrl: '' };
    console.log('    → 自定义');
  }

  const model = (await ask(`    Model [${defaults.model}]: `)) || defaults.model;

  let baseUrl = defaults.baseUrl;
  if (provider === 'custom' || !defaults.baseUrl) {
    baseUrl = (await ask('    Base URL: ') || '');
  }

  // API Key 输入 + 验证
  let apiKey: string | undefined;
  const isLocal = provider === 'ollama';

  if (!isLocal) {
    console.log('');
    const keyInput = (await ask('    API Key: ')) || '';
    if (keyInput) {
      apiKey = keyInput;
      // 验证 Key 格式
      const isValidFormat = apiKey.length > 10 && (
        apiKey.startsWith('sk-') || apiKey.startsWith('sk_') || apiKey.startsWith('Bearer ') || apiKey.length > 20
      );
      if (!isValidFormat) {
        console.log('    ⚠️  Key 格式看起来不太对，但仍然保存');
      }

      // 快速连通测试
      logger.info('main', '配置已保存，启动后添加 API 端点时将自动发现模型并验证连通性');
    } else {
      console.log('    ⚠️  未输入 Key，将尝试读取环境变量');
      // 提示对应的环境变量名
      const envVarMap: Record<string, string> = {
        openai: 'OPENAI_API_KEY',
        deepseek: 'DEEPSEEK_API_KEY',
        custom: 'OPENAI_API_KEY',
      };
      const envVar = envVarMap[provider];
      if (envVar) {
        console.log(`    💡 设置方式: export ${envVar}=your-key-here`);
      }
    }
  } else {
    console.log('    💡 Ollama 无需 API Key，请确保 ollama serve 正在运行');
  }

  // ── 轻量模型配置（可选）──
  let lightweightCfg: { provider: string; model: string; apiKey?: string; baseUrl?: string } | undefined;
  const lwChoice = (await ask('\n  是否配置轻量模型？(用于闲聊/后台任务，省钱) [y/N]: ')) || 'n';
  if (lwChoice.toLowerCase() === 'y') {
    console.log('    1. 同平台小模型 (推荐)');
    console.log('    2. 本地 Ollama');
    const lwType = (await ask('    选择 [1-2, 默认1]: ')) || '1';

    if (lwType === '2') {
      lightweightCfg = { provider: 'ollama', model: 'llama3', baseUrl: 'http://localhost:11434/v1' };
      console.log('    → 本地 Ollama (llama3)');
    } else {
      const lwModel = (await ask(`    Model [${defaults.model === model ? 'Qwen/Qwen2.5-7B-Instruct' : defaults.model}]: `))
        || (defaults.model === model ? 'Qwen/Qwen2.5-7B-Instruct' : defaults.model);
      lightweightCfg = { provider, model: lwModel, apiKey, baseUrl: baseUrl || undefined };
      console.log(`    → ${provider}/${lwModel}`);
    }
  }

  // ── ModelPool 多模型池配置（可选）──
  let poolCfg: BuddyConfig['pool'] | undefined;
  const poolChoice = (await ask('\n  是否启用多模型池？(智能调度多个模型，降本增效) [y/N]: ')) || 'n';
  if (poolChoice.toLowerCase() === 'y') {
    console.log('\n  📦 多模型池配置:');
    console.log('    调度策略:');
    console.log('      1. task_match — 按任务类型匹配（推荐）');
    console.log('      2. cost_optimized — 成本优先');
    console.log('      3. quality_first — 质量优先');
    const strategyChoice = (await ask('    选择 [1-3, 默认1]: ')) || '1';
    const strategyMap: Record<string, NonNullable<BuddyConfig['pool']>['strategy']> = {
      '1': 'task_match', '2': 'cost_optimized', '3': 'quality_first',
    };
    const strategy = strategyMap[strategyChoice] ?? 'task_match';

    // 预算约束
    const budgetInput = (await ask('    每小时最大成本 (元，留空不限): ')) || '';
    const budget = budgetInput ? { maxCostPerHour: parseFloat(budgetInput) } : undefined;

    // 自动添加当前主模型为 premium 节点
    const nodes: import('./types.js').PoolNodeConfig[] = [{
      id: `${provider}/${model}`,
      type: 'cloud',
      provider,
      model,
      apiKey,
      baseUrl: baseUrl || undefined,
      tags: ['reasoning', 'code', 'complex'],
      tier: 'premium',
      costPer1kInput: 0.04,
      costPer1kOutput: 0.08,
    }];
    console.log(`\n    ✅ 已自动添加主模型 ${provider}/${model} 为 premium 节点`);

    // 可选：添加 budget 节点
    if (lightweightCfg) {
      nodes.push({
        id: `${lightweightCfg.provider}/${lightweightCfg.model}`,
        type: 'cloud',
        provider: lightweightCfg.provider,
        model: lightweightCfg.model,
        apiKey: lightweightCfg.apiKey,
        baseUrl: lightweightCfg.baseUrl,
        tags: ['chat', 'fast', 'cheap'],
        tier: 'budget',
        costPer1kInput: 0.005,
        costPer1kOutput: 0.01,
      });
      console.log(`    ✅ 已自动添加轻量模型 ${lightweightCfg.provider}/${lightweightCfg.model} 为 budget 节点`);
    }

    // 可选：添加额外云端节点
    const addMore = (await ask('\n    是否添加额外云端节点？[y/N]: ')) || 'n';
    if (addMore.toLowerCase() === 'y') {
      let adding = true;
      while (adding) {
        console.log(`\n    --- 添加节点 ---`);
        const nodeId = (await ask('      ID (如 deepseek-v3): ')) || '';
        const nodeProvider = (await ask('      Provider [deepseek]: ')) || 'deepseek';
        const nodeModel = (await ask('      Model [deepseek-chat]: ')) || 'deepseek-chat';
        const nodeTier = (await ask('      Tier (premium/standard/budget) [standard]: ')) || 'standard';
        const nodeTags = (await ask('      Tags (逗号分隔) [reasoning,code]: ')) || 'reasoning,code';

        nodes.push({
          id: nodeId || `${nodeProvider}/${nodeModel}`,
          type: 'cloud',
          provider: nodeProvider,
          model: nodeModel,
          tags: nodeTags.split(',').map(t => t.trim()),
          tier: nodeTier as 'premium' | 'standard' | 'budget',
        });
        console.log(`      ✅ 已添加: ${nodeId || `${nodeProvider}/${nodeModel}`}`);

        const more = (await ask('    继续添加？[y/N]: ')) || 'n';
        adding = more.toLowerCase() === 'y';
      }
    }

    poolCfg = { strategy, budget, nodes };
    console.log(`\n    📊 模型池配置完成: ${nodes.length} 个节点, 策略=${strategy}`);
  }

  const config: BuddyConfig = {
    ...DEFAULT_CONFIG,
    name,
    species,
    personality: PRESET_PERSONALITIES[personalityKey],
    llm: {
      provider,
      model,
      apiKey,
      baseUrl: baseUrl || undefined,
      lightweight: lightweightCfg,
    },
    pool: poolCfg,
  };

  await saveConfig(config);
  rl.close();

  console.log(`\n✅ 配置已保存到 ${getConfigDir()}/config.json`);
  console.log(`\n  🚀 启动 Buddy:`);
  console.log(`     npx tsx src/main.ts        # CLI 交互`);
  console.log(`     npx tsx src/start-ws.ts     # WebSocket 服务`);
  console.log(`     npm run dev:all             # 前后端一起`);
  console.log(`\n  📊 查看状态:  npx tsx src/main.ts status`);
  console.log(`  🔧 调试模式:  npx tsx src/main.ts --verbose\n`);
}

/**
 * buddy status - 查看状态（不启动 WebSocket）
 */
async function showStatus(): Promise<void> {
  const config = await loadConfig();
  // 不启动 WebSocket
  const agent = new BuddyAgent(config, { enableWs: false });
  const status = agent.getStatus();

  console.log('\n📊 Buddy 状态\n');
  console.log(`  名字: ${status.config.name}`);
  console.log(`  物种: ${status.config.species}`);
  const primary = status.config.models?.providers?.[0];
  console.log(`  模型: ${primary?.type ?? '未配置'}/${primary?.model ?? '未配置'}`);
  console.log(`  进化: ${status.pet.stageEmoji} ${status.pet.stageName} (${status.pet.evolutionStage})`);
  console.log(`  稀有度: ${status.pet.rarity}`);
  console.log(`  亲密度: ${status.pet.intimacy}/100 (${status.pet.intimacyDescription})`);
  console.log(`\n  🧭 性格（行为涌现）:`);
  console.log(`    毒舌: ${Math.round(status.pet.behaviorSignals.snark)} | 智慧: ${Math.round(status.pet.behaviorSignals.wisdom)} | 混乱: ${Math.round(status.pet.behaviorSignals.chaos)} | 耐心: ${Math.round(status.pet.behaviorSignals.patience)} | 调试: ${Math.round(status.pet.behaviorSignals.debugging)}`);
  console.log(`\n  🗺️ 探索进度: ${status.pet.exploration.discovered}/${status.pet.exploration.total}`);
  console.log(`    基础: ${status.pet.exploration.basic}/${status.pet.exploration.basicTotal} | 进阶: ${status.pet.exploration.advanced}/${status.pet.exploration.advancedTotal} | 专家: ${status.pet.exploration.expert}/${status.pet.exploration.expertTotal} | 隐藏: ${status.pet.exploration.hidden}/${status.pet.exploration.hiddenTotal}`);
  if (status.pet.guidance) {
    console.log(`\n  💡 下一步建议: ${status.pet.guidance.hint}`);
  }
  console.log(`\n  🎭 情绪状态:`);
  console.log(`    心情: ${status.emotion.mood}`);
  console.log(`    精力: ${status.emotion.energy}/100`);
  console.log(`    满足度: ${status.emotion.satisfaction}/100`);
  console.log(`\n  📊 数据统计:`);
  console.log(`    对话: ${status.pet.stats.totalMessages} 条`);
  console.log(`    工具调用: ${status.pet.stats.totalToolCalls} 次`);
  console.log(`    使用天数: ${status.pet.stats.totalDays} 天 (连续 ${status.pet.stats.consecutiveDays} 天)`);
  console.log(`    记忆: ${status.stats.memories} 条`);
  console.log(`    日记: ${status.stats.diaryEntries} 天`);

  // 统一模型池状态
  const poolScheduler = agent.getLLM?.()?.getPoolScheduler?.();
  if (poolScheduler) {
    const ps = poolScheduler.getSummary();
    console.log(`\n  🏊 模型池:`);
    console.log(`    节点: ${ps.pool.available}/${ps.pool.total} 可用`);
    console.log(`    策略: ${status.config.models?.strategy ?? 'task_match'}`);
    if (ps.pool.circuitBroken.length > 0) {
      console.log(`    ⚠️ 熔断中: ${ps.pool.circuitBroken.join(', ')}`);
    }
    console.log(`    决策记录: ${ps.recentDecisions} 条`);
  }

  await agent.shutdown();
}

/**
 * CLI 交互模式
 */
async function startCLI(verbose: boolean): Promise<void> {
  let config = await loadConfig();

  // 提示配置来源
  if (!configExists()) {
    console.log('\n💡 未找到配置文件，使用默认配置。运行 `npx tsx src/main.ts init` 进行初始化。');
  }

  // 零配置探测：自动发现本地 AI 服务（Ollama/LM Studio/ComfyUI 等）
  try {
    const { config: updated, changes } = await probeAndAutoRegister(config);
    if (changes.length > 0) {
      for (const msg of changes) console.log(`  ${msg}`);
      config = updated;
      await saveConfig(config);
      console.log('  💾 已自动保存配置');
    } else if (verbose) {
      console.log('  🔍 本地服务探测完成，无新发现');
    }
  } catch (err) {
    if (verbose) console.warn('  ⚠️ 本地服务探测失败:', (err as Error).message);
  }

  // 不启动 WebSocket（CLI 模式不需要）
  const agent = new BuddyAgent(config, { enableWs: false, verbose });

  const status = agent.getStatus();
  const primary = config.models?.providers?.[0];
  console.log(`\n🦊 ${config.name} (${config.species}) 已上线`);
  console.log(`   模型: ${primary?.type ?? '未配置'}/${primary?.model ?? '未配置'}`);
  console.log(`   进化: ${status.pet.stageEmoji} ${status.pet.stageName}`);
  console.log(`   亲密度: ${status.pet.intimacy}/100 (${status.pet.intimacyDescription})`);
  if (verbose) {
    logger.debug('main', `探索: ${status.pet.exploration.discovered}/${status.pet.exploration.total} 功能`);
    logger.debug('main', `性格: 毒舌${Math.round(status.pet.behaviorSignals.snark)} 智慧${Math.round(status.pet.behaviorSignals.wisdom)} 混乱${Math.round(status.pet.behaviorSignals.chaos)} 耐心${Math.round(status.pet.behaviorSignals.patience)} 调试${Math.round(status.pet.behaviorSignals.debugging)}`);
  }
  console.log(`\n   输入消息开始对话`);
  console.log(`   /status 查看状态 | /quit 退出 | --verbose 调试模式\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `你 > `,
  });

  // 设置 CLI 确认处理器
  agent.setCLIConfirmHandler((description: string): Promise<boolean> => {
    return new Promise((resolve) => {
      rl.question(`\n⚠️  ${description}\n   允许执行？(y/n) `, (answer) => {
        resolve(answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes');
      });
    });
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    // 内置命令
    if (input === '/quit' || input === '/exit') {
      await agent.shutdown();
      rl.close();
      return;
    }

    if (input === '/status') {
      const s = agent.getStatus();
      console.log(`\n📊 ${s.pet.stageEmoji} ${s.pet.stageName} | 亲密度: ${s.pet.intimacy}/100 (${s.pet.intimacyDescription}) | 探索: ${s.pet.exploration.discovered}/${s.pet.exploration.total}\n`);
      rl.prompt();
      return;
    }

    if (input === '/help') {
      console.log(`
命令:
  /status  查看状态
  /learn <file|url>  从文件或URL学习
  /learned  查看已学习的知识
  /watch <path>  监听目录文件变更
  /shop    查看商城商品
  /buy <itemId>  购买商品
  /inventory  查看库存
  /friends  查看好友列表
  /addfriend <id> <name>  添加好友
  /delfriend <id>  删除好友
  /health  上线就绪检查
  /export <domain>  导出能力包
  /export-training <domain|all>  导出训练数据 (Phase 3)
  /train <domain>   提交 LoRA 微调 (Phase 4)
  /train-status <jobId>  查看训练进度
  /weights [list|delete <id>]  权重管理
  /models    列出本地三进制专家模型
  /train-ternary <domain>  手动触发三进制训练
  /train-ternary-status  查看三进制训练调度状态
  /experts   列出已安装的三进制专家模型
  /install-expert <path>  安装 .ta 模型文件
  /uninstall-expert <domain>  卸载专家模型
  /rate <domain> <1-5>  给能力包评分
  /backup    备份数据库
  /backups   查看备份列表
  /dbinfo    查看数据库状态
  /mcp       查看 MCP 服务器状态
  /mcp-list  列出所有 MCP 服务器及预置列表
  /mcp-search <query>  搜索 Smithery MCP 市场
  /mcp-install <name>  从 Smithery 安装 MCP Server
  /mcp-connect <name>  连接预置 MCP Server
  /mcp-disconnect <name>  断开 MCP Server
  /mcp-add <name> <command> [args...]  添加自定义 MCP Server
  /mcp-remove <name>  移除 MCP Server
  /pool       查看 ModelPool 状态
  /workflow            列出 DAG 工作流
  /workflow list       同上
  /workflow run <id>   执行工作流
  /workflow create <名称> <工具:参数>...  创建工作流
  /workflow remove <id>  删除工作流
  /workflow history [id]  执行历史
  /workflow stats      编排引擎统计
  /orch <任务描述>      DAG 编排预览（不执行）
  /project index [路径]    构建项目代码索引
  /project context <关键词> [路径]  生成聚焦上下文
  /project search <关键词> [路径]  搜索符号
  /beliefs [query]     查看/搜索信念存储
  /entities [query]    查看/搜索实体存储
  /privacy             查看隐私权限状态
  /privacy-toggle      切换隐私模式
  /perception          查看感知事件历史
  /knowledge-export [domain]  导出知识包
  /growth [domain]     查看三进制模型成长报告
  /env                 环境检测
  /chain <json>        执行工具链
  /help    帮助
  /quit    退出

试试:
  帮我列一下当前目录的文件
  执行 echo hello
  现在几点了
  看看 git 状态
  读一下 package.json
  搜索 "React hooks"         ← NEW
  分析一下 src/main.ts       ← NEW
  帮我看看 https://xxx.com   ← NEW
`);
      rl.prompt();
      return;
    }

    // /learn 命令
    if (input.startsWith('/learn ')) {
      const target = input.slice(7).trim();
      if (!target) {
        console.log('  用法: /learn <文件路径或URL>');
      } else if (target.startsWith('http://') || target.startsWith('https://')) {
        const result = await agent.learnFromUrl(target);
        console.log(`  ${result.success ? '✅' : '❌'} ${result.message}`);
      } else {
        const result = await agent.learnFromFile(target);
        console.log(`  ${result.success ? '✅' : '❌'} ${result.message}`);
      }
      rl.prompt();
      return;
    }

    // /learned 命令
    if (input === '/learned') {
      const knowledge = agent.getLearnedKnowledge?.() ?? [];
      const files = agent.getLearnedFiles?.() ?? [];
      console.log(`\n📚 已学习知识: ${knowledge.length} 条`);
      console.log(`📄 已学习文件: ${files.length} 个`);
      if (files.length > 0) {
        files.forEach((f: { key: string; value: string }) => console.log(`  • ${f.key}: ${f.value}`));
      }
      if (knowledge.length > 0) {
        console.log('\n知识片段:');
        knowledge.slice(0, 10).forEach((k: { key: string; value: string }) => {
          console.log(`  • [${k.key}] ${k.value.slice(0, 80)}...`);
        });
        if (knowledge.length > 10) console.log(`  ... 及其他 ${knowledge.length - 10} 条`);
      }
      console.log('');
      rl.prompt();
      return;
    }

    // /watch 命令
    if (input.startsWith('/watch ')) {
      const target = input.slice(7).trim();
      if (!target) {
        console.log('  用法: /watch <目录路径>');
      } else {
        agent.watchDirectory(target);
        console.log(`  👀 开始监听: ${target}`);
      }
      rl.prompt();
      return;
    }

    // /shop 命令
    if (input === '/shop') {
      const items = agent.getShopItems();
      console.log('\n🛒 商城商品:\n');
      const rarityEmoji: Record<string, string> = { common: '⬜', uncommon: '🟢', rare: '🔵', epic: '🟣', legendary: '🟡' };
      for (const item of items) {
        const re = rarityEmoji[item.rarity] || '⬜';
        console.log(`  ${re} ${item.name} — ${item.description}`);
        console.log(`     💰 ${item.price} ${item.currency} | /buy ${item.id}\n`);
      }
      rl.prompt();
      return;
    }

    // /buy 命令
    if (input.startsWith('/buy ')) {
      const itemId = input.slice(5).trim();
      const result = agent.purchaseItem('local', itemId);
      console.log(result.success ? `  ✅ 购买成功！` : `  ❌ ${result.error}`);
      rl.prompt();
      return;
    }

    // /inventory 命令
    if (input === '/inventory') {
      const inv = agent.getUserInventory('local');
      console.log(`\n🎒 背包 (💰 ${inv.coins} 金币 | 💎 ${inv.gems} 宝石):\n`);
      if (inv.items.length === 0) {
        console.log('  空空如也～去 /shop 逛逛吧！');
      } else {
        for (const slot of inv.items) {
          const mark = slot.equipped ? ' [已装备]' : '';
          console.log(`  • ${slot.itemId}${mark}`);
        }
      }
      console.log('');
      rl.prompt();
      return;
    }

    // /friends 命令
    if (input === '/friends') {
      const friends = agent.getFriends();
      console.log('\n👫 好友列表:\n');
      if (friends.length === 0) {
        console.log('  还没有好友。用 /addfriend <id> <name> 添加！');
      } else {
        for (const f of friends) {
          const statusIcon = f.status === 'online' ? '🟢' : f.status === 'offline' ? '⚫' : '🟡';
          console.log(`  ${statusIcon} ${f.name} — ${f.status}`);
        }
      }
      console.log('');
      rl.prompt();
      return;
    }

    // /addfriend 命令
    if (input.startsWith('/addfriend ')) {
      const parts = input.slice(11).trim().split(/\s+/);
      if (parts.length < 2) {
        console.log('  用法: /addfriend <id> <name>');
      } else {
        const friend = agent.addFriend(parts[0], parts.slice(1).join(' '));
        console.log(`  ✅ 已添加好友: ${friend.name}`);
      }
      rl.prompt();
      return;
    }

    // /delfriend 命令
    if (input.startsWith('/delfriend ')) {
      const id = input.slice(11).trim();
      const ok = agent.removeFriend(id);
      console.log(ok ? '  ✅ 已移除' : '  ❌ 未找到该好友');
      rl.prompt();
      return;
    }

    // /health 命令
    if (input === '/health') {
      console.log('\n🏥 上线就绪检查...\n');
      try {
        const report = await agent.runReadinessCheck();
        const icon = report.ready ? '✅' : '⚠️';
        console.log(`  ${icon} 总体: ${report.ready ? '就绪' : '有问题'} (${report.passed}通过 ${report.warned}警告 ${report.failed}失败)\n`);
        for (const check of report.checks) {
          const ci = check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️' : '❌';
          console.log(`  ${ci} [${check.category}] ${check.name}: ${check.message}`);
        }
        console.log('');
      } catch (err) {
        console.log(`  ❌ 检查失败: ${(err as Error).message}`);
      }
      rl.prompt();
      return;
    }

    // /export 命令
    if (input.startsWith('/export ')) {
      const domain = input.slice(8).trim();
      const data = agent.exportSkillPackage(domain);
      if (data) {
        const fs = await import('fs');
        const filePath = `${domain}.skillmate`;
        fs.writeFileSync(filePath, data);
        console.log(`  ✅ 已导出到 ${filePath}`);
      } else {
        console.log(`  ❌ 未找到领域「${domain}」的能力包`);
      }
      rl.prompt();
      return;
    }

    // /export-training 命令 (Phase 3)
    if (input.startsWith('/export-training ')) {
      const target = input.slice(17).trim();
      const { TrainingExporter } = await import('./intelligence/training-exporter.js');
      const exporter = new TrainingExporter(agent.getSTMP(), agent.getCognitive(), { enableAugmentation: true }, verbose, agent.getDataAugmentor());
      try {
        if (target === 'all') {
          console.log('  ⏳ 导出所有成熟领域训练数据...');
          const results = await exporter.exportAllMature();
          if (results.length === 0) {
            console.log('  ⚠️ 没有成熟领域可导出');
          } else {
            for (const r of results) {
              console.log(`  ✅ ${r.domain}: ${r.exportedSamples} 条 → ${r.filePath} (${(r.fileSizeBytes / 1024).toFixed(1)} KB, 质量: ${(r.qualityScore * 100).toFixed(0)}%)`);
            }
          }
        } else {
          console.log(`  ⏳ 导出领域「${target}」训练数据...`);
          const result = await exporter.exportDomain(target);
          console.log(`  ✅ ${result.exportedSamples} 条 → ${result.filePath} (${(result.fileSizeBytes / 1024).toFixed(1)} KB)`);
          console.log(`     过滤: ${result.filtered} | 去重: ${result.deduplicated} | 扩增: +${result.augmented} | 质量: ${(result.qualityScore * 100).toFixed(0)}%`);
        }
      } catch (err) {
        console.log(`  ❌ 导出失败: ${(err as Error).message}`);
      }
      rl.prompt();
      return;
    }

    // /train 命令 (Phase 4)
    if (input.startsWith('/train ')) {
      const domain = input.slice(7).trim();
      const lora = agent.getLoRAService();
      try {
        const cfg = lora.getConfig();
        if (!cfg.enabled) {
          console.log('  ⚠️ LoRA 服务未启用。使用导出训练数据 + 外部训练的方案：');
          console.log(`     1. /export-training ${domain}  — 导出 JSONL`);
          console.log('     2. 上传到云端微调服务（如 AutoDL / 硅基流动）');
          console.log('     3. 训练完成后下载权重到 ~/.buddy/weights/');
          rl.prompt();
          return;
        }
        console.log(`  ⏳ 正在提交领域「${domain}」的训练任务...`);
        const job = await lora.startTraining(domain);
        console.log(`  ✅ 训练任务已提交: ${job.id}`);
        console.log(`     状态: ${job.status} | 领域: ${job.domain}`);
        console.log(`     用 /train-status ${job.id} 查看进度`);
      } catch (err) {
        console.log(`  ❌ ${(err as Error).message}`);
      }
      rl.prompt();
      return;
    }

    // /train-status 命令
    if (input.startsWith('/train-status ')) {
      const jobId = input.slice(14).trim();
      const lora = agent.getLoRAService();
      try {
        const job = await lora.getJobStatus(jobId);
        const statusEmoji: Record<string, string> = { queued: '⏳', training: '🔄', completed: '✅', failed: '❌' };
        console.log(`\n  ${statusEmoji[job.status] ?? '❓'} 训练任务: ${job.id}`);
        console.log(`     领域: ${job.domain} | 状态: ${job.status} | 进度: ${job.progress}%`);
        if (job.metrics) {
          console.log(`     指标: loss=${job.metrics.loss.toFixed(4)} | accuracy=${(job.metrics.accuracy * 100).toFixed(1)}%`);
        }
        if (job.error) console.log(`     错误: ${job.error}`);
        if (job.completedAt) console.log(`     完成于: ${new Date(job.completedAt).toLocaleString('zh-CN')}`);
        console.log('');
      } catch (err) {
        console.log(`  ❌ ${(err as Error).message}`);
      }
      rl.prompt();
      return;
    }

    // /weights 命令
    if (input === '/weights' || input === '/weights list') {
      const lora = agent.getLoRAService();
      const weights = lora.getLocalWeightsMeta();
      console.log(`\n📦 本地 LoRA 权重 (${weights.length} 个):\n`);
      if (weights.length === 0) {
        console.log('  暂无本地权重');
        console.log('  用 /train <domain> 提交训练，完成后自动下载');
      } else {
        for (const w of weights) {
          const size = w.sizeBytes < 1024 * 1024
            ? `${(w.sizeBytes / 1024).toFixed(1)} KB`
            : `${(w.sizeBytes / 1024 / 1024).toFixed(1)} MB`;
          console.log(`  📄 ${w.domain} — ${size} | v${w.version}`);
          console.log(`     ID: ${w.id} | Job: ${w.jobId}`);
          if (w.metrics) {
            console.log(`     loss=${w.metrics.loss.toFixed(4)} | acc=${(w.metrics.accuracy * 100).toFixed(1)}%`);
          }
        }
      }
      console.log('');
      rl.prompt();
      return;
    }

    if (input.startsWith('/weights delete ')) {
      const id = input.slice(16).trim();
      const lora = agent.getLoRAService();
      const ok = await lora.deleteWeights(id);
      console.log(ok ? '  ✅ 已删除' : '  ❌ 未找到');
      rl.prompt();
      return;
    }

    // /models 命令 — 列出本地三进制模型
    if (input === '/models' || input === '/models list') {
      const router = agent.getTernaryRouter();
      const models = router.listExperts();
      console.log(`\n🧠 本地三进制模型 (${models.length} 个):\n`);
      if (models.length === 0) {
        console.log('  暂无本地模型');
        console.log('  训练数据积累到一定程度后，系统会自动训练');
      } else {
        for (const m of models) {
          const stage: Record<string, string> = {
            seed: '🌱 种子', sprout: '🌿 萌芽', growing: '🪴 成长',
            trainable: '📚 可训练', mature: '🏆 成熟',
          };
          console.log(`  ${stage[m.growthStage] ?? m.growthStage} ${m.domain} — ${m.totalParams} params | 训练 ${m.trainSteps} 步`);
          console.log(`     架构: ${m.architecture} | 量化: ${m.quantBits}bit | 更新: ${new Date(m.lastUpdated).toLocaleDateString('zh-CN')}`);
        }
      }
      console.log('');
      rl.prompt();
      return;
    }

    // /train-ternary 命令 — 手动触发三进制训练
    if (input.startsWith('/train-ternary ')) {
      const domain = input.slice(15).trim();
      const scheduler = agent.getTernaryRouter();
      const models = scheduler.listExperts();
      const model = models.find(m => m.domain === domain);
      if (!model) {
        console.log(`  ❌ 未找到领域「${domain}」的三进制模型`);
        console.log('  用 /models 查看可用模型');
      } else {
        // 注入知识并强制训练
        await agent.feedTernaryScheduler();
        const result = await agent.getTernaryScheduler().forceTrain(domain);
        if (result) {
          console.log(`  ✅ 训练完成: ${domain}`);
          console.log(`     loss: ${result.initialLoss.toFixed(4)} → ${result.finalLoss.toFixed(4)}`);
          console.log(`     步数: ${result.steps} | 成功: ${result.success}${result.rolledBack ? ' (已回滚)' : ''}`);
        } else {
          console.log(`  ⚠️ 领域「${domain}」暂无待训练数据`);
        }
      }
      rl.prompt();
      return;
    }

    // /train-ternary-status 命令
    if (input === '/train-ternary-status') {
      const state = agent.getTernaryScheduler().getState();
      console.log(`\n📊 三进制训练调度状态:\n`);
      console.log(`  训练中: ${state.isTraining ? '🔄 是' : '❌ 否'}`);
      console.log(`  待训练队列: ${state.queue.length} 个领域`);
      console.log(`  累计未训练样本: ${state.pendingSampleCount}`);
      if (state.lastTrainTime > 0) {
        console.log(`  上次训练: ${new Date(state.lastTrainTime).toLocaleString('zh-CN')}`);
      }
      if (state.lastResult) {
        const r = state.lastResult;
        console.log(`  上次结果: ${r.success ? '✅ 成功' : '❌ 失败'} | loss ${r.initialLoss.toFixed(4)}→${r.finalLoss.toFixed(4)} | ${r.steps} 步${r.rolledBack ? ' (已回滚)' : ''}`);
      }
      const pending = agent.getTernaryScheduler().getPendingSummary();
      if (pending.length > 0) {
        console.log(`\n  待训练详情:`);
        for (const p of pending) {
          console.log(`    • ${p.domain}: ${p.sampleCount} 样本 | 优先级: ${p.priority}`);
        }
      }
      console.log('');
      rl.prompt();
      return;
    }

    // /experts 命令 — 列出已安装的专家模型
    if (input === '/experts') {
      const installed = agent.getModelInstaller().listInstalled();
      console.log(`\n🧠 已安装专家模型 (${installed.length} 个):\n`);
      if (installed.length === 0) {
        console.log('  暂无已安装模型');
        console.log('  用 /install-expert <path> 安装 .ta 模型文件');
      } else {
        for (const m of installed) {
          const size = m.fileSize < 1024 * 1024
            ? `${(m.fileSize / 1024).toFixed(1)} KB`
            : `${(m.fileSize / 1024 / 1024).toFixed(1)} MB`;
          console.log(`  ${m.enabled ? '✅' : '⏸️'} ${m.manifest.name} v${m.manifest.version} — ${size}`);
          console.log(`     ${m.manifest.description}`);
          console.log(`     领域: ${m.manifest.domain} | 架构: ${m.manifest.architecture} | 作者: ${m.manifest.author}`);
        }
      }
      console.log('');
      rl.prompt();
      return;
    }

    // /install-expert 命令 — 安装 .ta 模型文件
    if (input.startsWith('/install-expert ')) {
      const filePath = input.slice(16).trim();
      console.log(`  ⏳ 安装模型: ${filePath}...`);
      try {
        const result = await agent.getModelInstaller().installFromFile(filePath);
        if (result.success) {
          console.log(`  ✅ ${result.message} (${result.elapsedMs}ms)`);
          // 刷新路由
          await agent.getTernaryRouter().init();
        } else {
          console.log(`  ❌ ${result.message}: ${result.error}`);
        }
      } catch (err) {
        console.log(`  ❌ 安装失败: ${(err as Error).message}`);
      }
      rl.prompt();
      return;
    }

    // /uninstall-expert 命令
    if (input.startsWith('/uninstall-expert ')) {
      const domain = input.slice(18).trim();
      const result = await agent.getModelInstaller().uninstall(domain);
      console.log(result.success ? `  ✅ ${result.message}` : `  ❌ ${result.message}: ${result.error}`);
      rl.prompt();
      return;
    }

    // /rate 命令
    if (input.startsWith('/rate ')) {
      const parts = input.slice(6).trim().split(/\s+/);
      if (parts.length < 2) {
        console.log('  用法: /rate <domain> <1-5>');
      } else {
        const domain = parts[0];
        const rating = parseInt(parts[1]);
        if (rating < 1 || rating > 5) {
          console.log('  评分范围: 1-5');
        } else {
          const stats = agent.getSkillFeedbackStats(domain);
          if (stats) {
            console.log(`  📊 「${domain}」反馈统计:`);
            console.log(`     总反馈: ${stats.totalFeedback} | 平均评分: ${stats.averageRating.toFixed(1)}/5`);
            console.log(`     纠正次数: ${stats.correctionCount}`);
          } else {
            console.log(`  ❌ 未找到领域「${domain}」的能力包`);
          }
        }
      }
      rl.prompt();
      return;
    }

    // /mcp 命令
    if (input === '/mcp') {
      const mcp = agent.getMCPAdapter();
      const servers = mcp.listServers();
      console.log(`\n🔌 MCP 服务器 (${servers.length} 个):\n`);
      if (servers.length === 0) {
        console.log('  暂无连接。用 /mcp-connect <name> 连接');
        console.log('  预置服务器: filesystem, github, memory, puppeteer, slack, postgres');
      } else {
        for (const s of servers) {
          const icon = s.connected ? '🟢' : '⚫';
          console.log(`  ${icon} ${s.name} — ${s.toolCount} 个工具`);
        }
        const tools = mcp.listAllTools();
        if (tools.length > 0) {
          console.log('\n  可用工具:');
          for (const t of tools.slice(0, 10)) {
            console.log(`    • mcp_${t.server}_${t.tool}: ${t.description.slice(0, 60)}`);
          }
          if (tools.length > 10) console.log(`    ... 及其他 ${tools.length - 10} 个`);
        }
      }
      console.log('');
      rl.prompt();
      return;
    }

    // /mcp-connect 命令
    if (input.startsWith('/mcp-connect ')) {
      const name = input.slice(13).trim();
      const { PRESET_MCP_SERVERS } = await import('./tools/mcp-adapter.js');
      const config = PRESET_MCP_SERVERS[name];
      if (!config) {
        console.log(`  ❌ 未知 MCP Server: ${name}`);
        console.log(`  预置: ${Object.keys(PRESET_MCP_SERVERS).join(', ')}`);
      } else {
        console.log(`  ⏳ 正在连接 ${name}...`);
        try {
          const tools = await agent.getMCPAdapter().connect(config);
          const defs = agent.getMCPAdapter().registerAsToolDefs(name);
          agent.getToolRegistry().registerMany(defs);
          console.log(`  ✅ ${name} 已连接 — ${tools.length} 个工具已注册`);
          for (const t of tools) {
            console.log(`    • ${t.name}: ${t.description.slice(0, 60)}`);
          }
        } catch (err) {
          console.log(`  ❌ 连接失败: ${(err as Error).message}`);
        }
      }
      rl.prompt();
      return;
    }

    // /mcp-disconnect 命令
    if (input.startsWith('/mcp-disconnect ')) {
      const name = input.slice(16).trim();
      await agent.getMCPAdapter().disconnect(name);
      console.log(`  ✅ ${name} 已断开`);
      rl.prompt();
      return;
    }

    // /mcp-list 命令
    if (input === '/mcp-list') {
      const adapter = agent.getMCPAdapter();
      const connected = adapter.listServers();
      console.log(`\n📡 MCP 服务器:\n`);
      if (connected.length === 0) {
        console.log('  无已连接的服务器');
      } else {
        for (const s of connected) {
          console.log(`  ${s.connected ? '🟢' : '🔴'} ${s.name} — ${s.toolCount} 个工具`);
        }
      }
      const { PRESET_MCP_SERVERS } = await import('./tools/mcp-adapter.js');
      console.log(`\n  预置服务器: ${Object.keys(PRESET_MCP_SERVERS).join(', ')}`);
      rl.prompt();
      return;
    }

    // /mcp-add 命令 — 添加自定义 MCP Server 到配置
    if (input.startsWith('/mcp-add ')) {
      const rest = input.slice(9).trim();
      const parts = rest.split(/\s+/);
      if (parts.length < 2) {
        console.log('  用法: /mcp-add <name> <command> [args...]');
        console.log('  示例: /mcp-add my-server npx -y @myorg/mcp-server');
      } else {
        const name = parts[0];
        const command = parts[1];
        const args = parts.slice(2);
        // 写入配置
        const curConfig = await loadConfig();
        // 检查是否已存在同名 server
        const exists = curConfig.mcp.servers.some(s => s.name === name);
        if (exists) {
          console.log(`  ⚠️  Server "${name}" 已存在于配置中`);
        } else {
          curConfig.mcp.servers.push({ name, command, args });
          await saveConfig(curConfig);
          console.log(`  ✅ 已添加到配置: ${name} (${command} ${args.join(' ')})`);
        }
        // 尝试连接
        console.log(`  ⏳ 正在连接 ${name}...`);
        try {
          const mcpConfig = { name, command, args };
          const tools = await agent.getMCPAdapter().connect(mcpConfig);
          const defs = agent.getMCPAdapter().registerAsToolDefs(name);
          agent.getToolRegistry().registerMany(defs);
          console.log(`  ✅ ${name} 已连接 — ${tools.length} 个工具已注册`);
        } catch (err) {
          console.log(`  ⚠️  连接失败（已保存到配置）: ${(err as Error).message}`);
        }
      }
      rl.prompt();
      return;
    }

    // /mcp-remove 命令 — 从配置中移除 MCP Server
    if (input.startsWith('/mcp-remove ')) {
      const name = input.slice(12).trim();
      if (!name) {
        console.log('  用法: /mcp-remove <name>');
      } else {
        // 先断开连接
        try {
          await agent.getMCPAdapter().disconnect(name);
        } catch {
          // 未连接则忽略
        }
        // 从配置中移除
        const curConfig = await loadConfig();
        const idx = curConfig.mcp.servers.findIndex(s => s.name === name);
        if (idx === -1) {
          console.log(`  ❌ 配置中未找到 "${name}"`);
        } else {
          curConfig.mcp.servers.splice(idx, 1);
          await saveConfig(curConfig);
          console.log(`  ✅ 已从配置中移除: ${name}`);
        }
      }
      rl.prompt();
      return;
    }

    // /pool 命令 — 查看 ModelPool 状态
    if (input === '/pool') {
      const poolScheduler = agent.getLLM?.()?.getPoolScheduler?.();
      if (!poolScheduler) {
        console.log('\n  ⚠️  模型池未启用。在配置中添加 models.providers 字段启用。');
        console.log('  或运行 `npx tsx src/main.ts init` 重新配置。');
      } else {
        const ps = poolScheduler.getSummary();
        const pool = ps.pool;
        console.log(`\n🏊 模型池状态:\n`);
        console.log(`  节点: ${pool.available}/${pool.total} 可用`);
        console.log(`  策略: ${config.models?.strategy ?? 'task_match'}`);
        if (pool.circuitBroken.length > 0) {
          console.log(`  ⚠️ 熔断中: ${pool.circuitBroken.join(', ')}`);
        }
        console.log(`  决策记录: ${ps.recentDecisions} 条`);

        // 节点详情
        const allNodes = poolScheduler.getPool().getAllNodes();
        if (allNodes.length > 0) {
          console.log(`\n  节点列表:`);
          const tierEmoji: Record<string, string> = { premium: '🟡', standard: '🟢', budget: '🔵', free: '⚪' };
          for (const node of allNodes) {
            const te = tierEmoji[node.tier] ?? '⚪';
            const broken = pool.circuitBroken.includes(node.id) ? ' [熔断]' : '';
            const warm = node.warm ? '🔥' : '❄️';
            const sr = node.stats.totalCalls > 0
              ? `${(node.stats.successRate * 100).toFixed(0)}% 成功率`
              : '无数据';
            console.log(`    ${te} ${warm} ${node.id} (${node.type}) — ${sr}${broken}`);
          }
        }
      }
      console.log('');
      rl.prompt();
      return;
    }

    // /mcp-search 命令 — 搜索 Smithery MCP 市场
    if (input.startsWith('/mcp-search ')) {
      const query = input.slice(12).trim();
      console.log(`\n🔍 搜索 "${query}"...`);
      try {
        const { MCPRegistry } = await import('./tools/mcp-registry.js');
        const registry = new MCPRegistry();
        const results = await registry.search(query);
        if (results.length === 0) {
          console.log('  未找到匹配的 MCP Server');
        } else {
          console.log(`  找到 ${results.length} 个结果:\n`);
          for (const s of results) {
            const stars = s.stars > 0 ? ` ⭐${s.stars}` : '';
            const dl = s.downloads > 0 ? ` 📥${s.downloads}` : '';
            console.log(`  📦 ${s.name}${stars}${dl}`);
            console.log(`     ${s.description}`);
            console.log(`     包: ${s.packageName}`);
            console.log();
          }
        }
      } catch (err) {
        console.log(`  ❌ 搜索失败: ${(err as Error).message}`);
      }
      rl.prompt();
      return;
    }

    // /mcp-install 命令 — 从 Smithery 安装 MCP Server
    if (input.startsWith('/mcp-install ')) {
      const name = input.slice(13).trim();
      if (!name) {
        console.log('  用法: /mcp-install <name>');
      } else {
        console.log(`\n⏳ 正在安装 "${name}"...`);
        try {
          const { MCPRegistry } = await import('./tools/mcp-registry.js');
          const registry = new MCPRegistry();
          const entry = await registry.getServer(name);
          if (!entry) {
            console.log(`  ❌ 未找到 "${name}"，先用 /mcp-search 搜索`);
          } else {
            // 检查是否已存在
            const curConfig = await loadConfig();
            const exists = curConfig.mcp.servers.some(s => s.name === entry.name);
            if (exists) {
              console.log(`  ⚠️  "${entry.name}" 已存在于配置中`);
            } else {
              // 写入配置
              curConfig.mcp.servers.push({
                name: entry.name,
                command: entry.command,
                args: entry.args,
                description: entry.description,
              });
              await saveConfig(curConfig);
              console.log(`  ✅ 已添加到配置: ${entry.name}`);
            }
            // 尝试连接
            console.log(`  ⏳ 正在连接 ${entry.name}...`);
            try {
              const tools = await agent.getMCPAdapter().connect({
                name: entry.name,
                command: entry.command,
                args: entry.args,
              });
              const defs = agent.getMCPAdapter().registerAsToolDefs(entry.name);
              agent.getToolRegistry().registerMany(defs);
              console.log(`  ✅ ${entry.name} 已连接 — ${tools.length} 个工具已注册`);
            } catch (err) {
              console.log(`  ⚠️  连接失败（已保存到配置）: ${(err as Error).message}`);
            }
          }
        } catch (err) {
          console.log(`  ❌ 安装失败: ${(err as Error).message}`);
        }
      }
      rl.prompt();
      return;
    }

    // /backup 命令
    if (input === '/backup') {
      console.log('\n💾 正在备份数据库...');
      const dbm = agent.getDBManager();
      const result = await dbm.backup();
      if (result.success) {
        console.log(`  ✅ 备份完成: ${result.backupDir}`);
        console.log(`  📁 文件: ${result.files.join(', ')}`);
        console.log(`  📊 大小: ${(result.totalSizeBytes / 1024).toFixed(1)} KB`);
      } else {
        console.log(`  ❌ 备份失败: ${result.error}`);
      }
      rl.prompt();
      return;
    }

    // /backups 命令
    if (input === '/backups') {
      const dbm = agent.getDBManager();
      const backups = dbm.listBackups();
      console.log(`\n📦 备份列表 (${backups.length} 个):\n`);
      if (backups.length === 0) {
        console.log('  暂无备份，用 /backup 创建');
      } else {
        for (const b of backups) {
          console.log(`  📁 ${b.date.slice(0, 19)} | ${b.files} 文件 | ${(b.sizeBytes / 1024).toFixed(1)} KB`);
          console.log(`     ${b.dir}`);
        }
      }
      console.log('');
      rl.prompt();
      return;
    }

    // /dbinfo 命令
    if (input === '/dbinfo') {
      const dbm = agent.getDBManager();
      const infos = dbm.getInfo();
      console.log(`\n🗄️ 数据库状态:\n`);
      for (const db of infos) {
        const size = db.sizeBytes < 1024
          ? `${db.sizeBytes} B`
          : `${(db.sizeBytes / 1024).toFixed(1)} KB`;
        const wal = db.walMode ? ' [WAL]' : '';
        const tables = db.tables.length > 0 ? ` | ${db.tables.length} 表` : '';
        console.log(`  📄 ${db.name} — ${size}${wal}${tables}`);
        if (db.tables.length > 0 && db.tables.length <= 10) {
          console.log(`     表: ${db.tables.join(', ')}`);
        }
      }
      console.log(`\n  📊 总大小: ${(dbm.getTotalSize() / 1024).toFixed(1)} KB\n`);
      rl.prompt();
      return;
    }

    // ── /workflow 命令系列 ──

    if (input === '/workflow' || input === '/workflow list') {
      const wfm = agent.getWorkflowManager();
      if (!wfm) { console.log('  ⚠️  工作流管理器未初始化'); rl.prompt(); return; }
      const workflows = wfm.list();
      console.log(`\n📋 DAG 工作流列表 (${workflows.length} 个):\n`);
      if (workflows.length === 0) {
        console.log('  暂无保存的工作流。用 /workflow create 创建。');
      } else {
        for (const w of workflows) {
          const taskCount = w.dag.tasks.length;
          const runs = w.runCount > 0 ? ` | 已运行 ${w.runCount} 次` : '';
          console.log(`  📦 ${w.id} — ${w.name} [${w.category}]`);
          console.log(`     ${w.description} (${taskCount} 步骤${runs})`);
        }
      }
      console.log('');
      rl.prompt();
      return;
    }

    if (input.startsWith('/workflow run ')) {
      const wfId = input.slice(14).trim();
      if (!wfId) { console.log('  用法: /workflow run <workflowId>'); rl.prompt(); return; }
      const wfm = agent.getWorkflowManager();
      if (!wfm) { console.log('  ⚠️  工作流管理器未初始化'); rl.prompt(); return; }

      console.log(`\n🚀 执行工作流: ${wfId}...\n`);
      try {
        const result = await wfm.run(wfId, (event: any) => {
          if (event.type === 'orch_task_start') {
            console.log(`  ⏳ [${event.taskId}] 开始执行...`);
          } else if (event.type === 'orch_task_done') {
            console.log(`  ✅ [${event.taskId}] 完成`);
          } else if (event.type === 'orch_task_fail') {
            console.log(`  ❌ [${event.taskId}] 失败: ${event.error?.slice(0, 60)}`);
          } else if (event.type === 'orch_task_retry') {
            console.log(`  🔄 [${event.taskId}] 重试 ${event.attempt}/${event.maxRetry}...`);
          }
        });
        console.log(`\n${result.summary}\n`);
      } catch (err) {
        console.log(`  ❌ 执行失败: ${(err as Error).message}`);
      }
      rl.prompt();
      return;
    }

    if (input === '/workflow create') {
      console.log('  用法: /workflow create <名称> <工具1:参数> <工具2:参数> ...');
      console.log('  示例: /workflow create "检查系统" exec:df exec:free exec:uptime');
      rl.prompt();
      return;
    }

    if (input.startsWith('/workflow create ')) {
      const parts = input.slice(16).trim().split(/\s+/);
      const name = parts[0] || '未命名工作流';
      const stepDefs = parts.slice(1);

      if (stepDefs.length === 0) {
        console.log('  至少需要一个步骤：工具名:参数');
        rl.prompt();
        return;
      }

      const wfm = agent.getWorkflowManager();
      if (!wfm) { console.log('  ⚠️  工作流管理器未初始化'); rl.prompt(); return; }

      const tasksArray = stepDefs.map((sd: string, i: number) => {
        const [tool, ...argParts] = sd.split(':');
        const argStr = argParts.join(':');
        let args: Record<string, unknown> = {};
        if (argStr) {
          // 简单解析：如果包含 = 则解析为 key=value，否则作为 command
          if (argStr.includes('=')) {
            for (const pair of argStr.split(',')) {
              const [k, ...v] = pair.split('=');
              args[k.trim()] = v.join('=').trim();
            }
          } else {
            args = { command: argStr, path: argStr, content: argStr };
            // 只保留工具可能需要的参数
            const toolDef = agent.getToolRegistry().get(tool);
            if (toolDef) {
              try {
                const shape = (toolDef.parameters as any)?._def?.shape?.();
                if (shape) {
                  const firstKey = Object.keys(shape)[0];
                  args = { [firstKey]: argStr };
                }
              } catch { /* keep defaults */ }
            }
          }
        }
        return {
          id: `t${i + 1}`,
          name: `${tool}(${argStr || '无参数'})`,
          tool,
          args,
          deps: i > 0 ? [`t${i}`] : [],
          status: 'pending' as const,
        };
      });

      // TODO: createFromDAG 期望完整的 TaskDAG，需要补充 id/edges/parallelGroups 等字段
      const tasksMap = new Map(tasksArray.map(t => [t.id, t]));
      const def = await wfm.createFromDAG(
        { tasks: tasksMap, description: name } as any,
        name,
        `自定义工作流: ${name}`,
        'custom' as const,
      );
      console.log(`  ✅ 已创建: ${def.id} — ${def.name} (${tasksArray.length} 步骤)`);
      rl.prompt();
      return;
    }

    if (input.startsWith('/workflow remove ')) {
      const wfId = input.slice(17).trim();
      const wfm = agent.getWorkflowManager();
      if (!wfm) { console.log('  ⚠️  工作流管理器未初始化'); rl.prompt(); return; }
      const removed = await wfm.remove(wfId);
      console.log(removed ? `  ✅ 已删除: ${wfId}` : `  ❌ 未找到: ${wfId}`);
      rl.prompt();
      return;
    }

    if (input.startsWith('/workflow history')) {
      const wfId = input.slice(17).trim() || undefined;
      const wfm = agent.getWorkflowManager();
      if (!wfm) { console.log('  ⚠️  工作流管理器未初始化'); rl.prompt(); return; }
      const history = wfm.getHistory(wfId, 10);
      console.log(`\n📜 执行历史 (${history.length} 条):\n`);
      if (history.length === 0) {
        console.log('  暂无执行记录');
      } else {
        for (const h of history) {
          const status = h.success ? '✅' : '❌';
          const time = new Date(h.startedAt).toLocaleString('zh-CN');
          const duration = (h.totalMs / 1000).toFixed(1);
          console.log(`  ${status} ${h.workflowId} — ${time} (${duration}s)`);
          console.log(`     ${h.summary.slice(0, 80)}`);
        }
      }
      console.log('');
      rl.prompt();
      return;
    }

    if (input === '/workflow stats') {
      const orchMod = await import('./orchestrate/index.js');
      const wfm = agent.getWorkflowManager();
      if (!wfm) { console.log('  ⚠️  工作流管理器未初始化'); rl.prompt(); return; }
      const workflows = wfm.list();
      const totalRuns = workflows.reduce((s: number, w: any) => s + w.runCount, 0);
      console.log(`\n📊 DAG 编排引擎统计:\n`);
      console.log(`  工作流总数: ${workflows.length}`);
      console.log(`  总执行次数: ${totalRuns}`);
      console.log(`  DAG 类型: Task, TaskDAG, ConditionEdge, RetryConfig`);
      console.log(`  支持特性: 条件分支 / 重试 / 超时 / 并行`);
      console.log('');
      rl.prompt();
      return;
    }

    // ── /project 命令系列 ──

    if (input.startsWith('/project ')) {
      const parts = input.slice(9).trim().split(/\s+/);
      const subCmd = parts[0];
      const projectPath = parts[1] || '.';

      try {
        const { ProjectIndex } = await import('./tools/project-index.js');
        const index = new ProjectIndex({ rootPath: path.resolve(projectPath) });

        if (subCmd === 'index' || subCmd === 'scan') {
          console.log(`\n🔍 构建索引: ${path.resolve(projectPath)}...`);
          const stats = await index.buildIndex();
          console.log(`\n✅ 索引完成 (${stats.indexTimeMs}ms):\n`);
          console.log(`  📄 ${stats.totalFiles} 文件`);
          console.log(`  📝 ${stats.totalLoc.toLocaleString()} 行`);
          console.log(`  🔧 ${stats.totalSymbols} 符号`);
          console.log(`  🔗 ${stats.dependencyCount} 依赖关系`);
          console.log(`  🔤 ${Object.entries(stats.languages).map(([l, c]) => `${l}: ${c}`).join(', ')}`);
          if (stats.topSymbols.length > 0) {
            console.log(`\n  ⭐ 高频符号:`);
            for (const s of stats.topSymbols.slice(0, 5)) {
              console.log(`    ${s.kind} ${s.name} — ${s.file}`);
            }
          }
        } else if (subCmd === 'context') {
          const focus = parts.slice(2).join(' ') || '项目结构';
          console.log(`\n📋 生成上下文: "${focus}"...`);
          await index.buildIndex();
          const result = await index.generateContext(focus);
          console.log(`\n${result.context}`);
          console.log(`\n  📊 涵盖 ${result.files.length} 文件, ~${result.tokenEstimate} tokens`);
        } else if (subCmd === 'search') {
          const query = parts.slice(2).join(' ');
          if (!query) { console.log('  用法: /project search <关键词> [路径]'); rl.prompt(); return; }
          await index.buildIndex();
          const results = index.searchSymbol(query);
          console.log(`\n🔍 搜索 "${query}": ${results.length} 结果\n`);
          for (const r of results.slice(0, 15)) {
            const exp = r.symbol.exported ? '📤' : '  ';
            console.log(`  ${exp} ${r.symbol.kind} ${r.symbol.name} — ${r.file}:${r.symbol.line}`);
          }
        } else {
          console.log('  用法:');
          console.log('  /project index [路径]    构建项目索引');
          console.log('  /project context <关键词> [路径]  生成聚焦上下文');
          console.log('  /project search <关键词> [路径]  搜索符号');
        }
      } catch (err) {
        console.log(`  ❌ ${(err as Error).message}`);
      }
      console.log('');
      rl.prompt();
      return;
    }

    // ── /beliefs 命令 ──
    if (input === '/beliefs' || input.startsWith('/beliefs ')) {
      const query = input.slice(8).trim();
      const store = agent.getBeliefStore();
      if (query) {
        const results = store.retrieve(query);
        console.log(`\n🔮 信念搜索 "${query}": ${results.length} 条\n`);
        for (const b of results) {
          console.log(`  ${b.confidence > 0.6 ? '✅' : '❓'} ${b.statement}`);
          console.log(`     置信度: ${(b.confidence * 100).toFixed(0)}% | 来源: ${b.source} | 证据: ${b.evidence.length} 条`);
        }
      } else {
        console.log(`\n🔮 信念存储: ${store.size} 条\n`);
        const all = (Array.from((store as any).beliefs?.values?.() ?? []) as any[]).slice(0, 10);
        for (const b of all) {
          console.log(`  ${b.confidence > 0.6 ? '✅' : '❓'} ${b.statement} (${(b.confidence * 100).toFixed(0)}%)`);
        }
        if (store.size > 10) console.log(`  ... 及其他 ${store.size - 10} 条`);
      }
      console.log('');
      rl.prompt();
      return;
    }

    // ── /entities 命令 ──
    if (input === '/entities' || input.startsWith('/entities ')) {
      const query = input.slice(9).trim();
      const store = agent.getEntityStore();
      const entities = query ? store.search(query) : store.getAll(20);
      console.log(`\n📦 实体${query ? `搜索 "${query}"` : '存储'}: ${entities.length} 个\n`);
      for (const e of entities) {
        const facts = e.facts.slice(0, 2).join('; ');
        console.log(`  ${e.type === 'technology' ? '⚙️' : e.type === 'person' ? '👤' : '📌'} ${e.name} (${e.type}) — 提及 ${e.mentionCount} 次`);
        if (facts) console.log(`     ${facts}`);
      }
      console.log('');
      rl.prompt();
      return;
    }

    // ── /privacy 命令 ──
    if (input === '/privacy') {
      const pm = agent.getPrivacyManager();
      console.log(`\n🔒 隐私权限状态:\n`);
      console.log(`  隐私模式: ${pm.isPrivacyMode() ? '🔴 开启' : '🟢 关闭'}`);
      const indicators = pm.getActiveIndicators();
      if (indicators.length > 0) {
        console.log(`\n  活跃硬件:`);
        for (const ind of indicators) {
          console.log(`    ${ind.icon} ${ind.label}`);
        }
      }
      const audit = pm.getAuditLog(10);
      if (audit.length > 0) {
        console.log(`\n  最近审计 (${audit.length} 条):`);
        for (const a of audit) {
          console.log(`    ${new Date(a.timestamp).toLocaleString('zh-CN')} ${a.action} → ${a.target}`);
        }
      }
      console.log('');
      rl.prompt();
      return;
    }

    // ── /privacy-toggle 命令 ──
    if (input === '/privacy-toggle') {
      const pm = agent.getPrivacyManager();
      const newState = pm.togglePrivacyMode();
      console.log(`  🔒 隐私模式: ${newState ? '🔴 已开启' : '🟢 已关闭'}`);
      rl.prompt();
      return;
    }

    // ── /perception 命令 ──
    if (input === '/perception') {
      const bus = agent.getPerceptionBus();
      const stats = bus.getStats();
      const events = bus.getRecent(10);
      console.log(`\n📡 感知事件: ${stats.total} 条\n`);
      console.log(`  按类别: ${JSON.stringify(stats.byCategory)}`);
      console.log(`  按来源: ${JSON.stringify(stats.bySource)}`);
      if (events.length > 0) {
        console.log(`\n  最近事件:`);
        for (const e of events) {
          console.log(`    ${new Date(e.timestamp).toLocaleTimeString('zh-CN')} [${e.category}/${e.source}] ${JSON.stringify(e.data).slice(0, 60)}`);
        }
      }
      console.log('');
      rl.prompt();
      return;
    }

    // ── /knowledge-export 命令 ──
    if (input === '/knowledge-export' || input.startsWith('/knowledge-export ')) {
      const domain = input.slice(17).trim();
      const exporter = agent.getKnowledgeExporter();
      if (domain) {
        const pack = exporter.exportDomainPack(domain);
        if (pack) {
          console.log(`\n📦 知识包: ${pack.domain}\n`);
          console.log(`  经验数: ${pack.experiences.length}`);
          console.log(`  领域类型: ${pack.domainProfile.domainType}`);
          console.log(`  成长阶段: ${pack.domainProfile.growthStage}`);
          console.log(`  深度评分: ${pack.domainProfile.depthScore.toFixed(2)}`);
          console.log(`  导出时间: ${new Date(pack.extractedAt).toLocaleString('zh-CN')}`);
        } else {
          console.log(`  ❌ 领域 "${domain}" 无可用知识包（数据不足或未成熟）`);
        }
      } else {
        const packs = exporter.exportAllMature();
        console.log(`\n📦 成熟领域知识包: ${packs.length} 个\n`);
        for (const p of packs) {
          console.log(`  ${p.domain} — ${p.experiences.length} 条经验 | ${p.domainProfile.growthStage}`);
        }
        if (packs.length === 0) console.log('  暂无成熟领域');
      }
      console.log('');
      rl.prompt();
      return;
    }

    // ── /growth 命令 ──
    if (input === '/growth' || input.startsWith('/growth ')) {
      const domain = input.slice(7).trim();
      const growth = agent.getTernaryGrowth();
      const router = agent.getTernaryRouter();
      const experts = router.listExperts();

      if (domain) {
        const expert = experts.find(e => e.domain === domain);
        if (expert) {
          const model = { meta: { ...expert, growthStage: expert.growthStage as any, trainSteps: expert.trainSteps, lastUpdated: Date.now(), totalParams: 0 } } as any;
          const report = growth.getReport(model, 0, 0);
          console.log(`\n🌱 成长报告: ${domain}\n`);
          console.log(`  阶段: ${report.characteristics.emoji} ${report.characteristics.label} — ${report.characteristics.description}`);
          console.log(`  进度: ${report.progressPercent}%`);
          console.log(`  训练步数: ${report.stats.trainSteps}`);
          console.log(`\n  下一阶段要求:`);
          for (const req of report.nextStageRequirements) {
            console.log(`    • ${req}`);
          }
          console.log(`\n  建议:`);
          for (const rec of report.recommendations) {
            console.log(`    • ${rec}`);
          }
        } else {
          console.log(`  ❌ 未找到领域 "${domain}"`);
        }
      } else {
        console.log(`\n🌱 三进制模型成长概览 (${experts.length} 个):\n`);
        for (const e of experts) {
          const model = { meta: { ...e, growthStage: e.growthStage as any, trainSteps: e.trainSteps, lastUpdated: Date.now(), totalParams: 0 } } as any;
          const report = growth.getReport(model, 0, 0);
          console.log(`  ${report.characteristics.emoji} ${e.domain} — ${report.characteristics.label} (${report.progressPercent}%) — ${e.trainSteps} 步`);
        }
        if (experts.length === 0) console.log('  暂无模型');
      }
      console.log('');
      rl.prompt();
      return;
    }

    // ── /env 命令 ──
    if (input === '/env') {
      const { detectEnvironment } = await import('./env/detect.js');
      const checks = await detectEnvironment();
      console.log(`\n🔍 环境检测:\n`);
      for (const c of checks) {
        const icon = c.ok ? '✅' : '❌';
        console.log(`  ${icon} ${c.name}: ${c.value}`);
        if (c.suggestion) console.log(`     💡 ${c.suggestion}`);
      }
      const allOk = checks.every(c => c.ok);
      console.log(allOk ? '\n  ✅ 所有检查通过\n' : '\n  ⚠️ 部分检查未通过\n');
      rl.prompt();
      return;
    }

    // ── /chain 命令 ──
    if (input.startsWith('/chain ')) {
      const chainJson = input.slice(7).trim();
      try {
        const { executeChain } = await import('./tools/tool-chain.js');
        const chainDef = JSON.parse(chainJson);
        const chain = {
          id: chainDef.id ?? `chain-${Date.now()}`,
          name: chainDef.name ?? 'cli-chain',
          steps: chainDef.steps ?? [],
        };
        console.log(`\n⛓️ 执行工具链: ${chain.name} (${chain.steps.length} 步)\n`);
        const result = await executeChain(chain, agent.getToolRegistry());
        for (const sr of result.stepResults) {
          const icon = sr.error ? '❌' : '✅';
          console.log(`  ${icon} [${sr.step}] ${sr.tool}: ${(sr.result ?? sr.error ?? '').slice(0, 80)}`);
        }
        console.log(`\n  ${result.success ? '✅ 成功' : '❌ 失败'} | ${result.totalMs}ms`);
      } catch (err) {
        console.log(`  ❌ ${(err as Error).message}`);
        console.log(`  用法: /chain {"name":"my-chain","steps":[{"tool":"exec","args":{"command":"ls"}}]}`);
      }
      console.log('');
      rl.prompt();
      return;
    }

    // ── /orch 命令（直接编排）──
    if (input.startsWith('/orch ')) {
      const content = input.slice(6).trim();
      console.log(`\n🧠 编排: ${content}...\n`);
      try {
        const dag = await agent.getDAGPlanner().plan(content);
        console.log(`  📋 规划了 ${dag.tasks.size} 个任务:`);
        for (const task of dag.tasks.values()) {
          const deps = task.deps.length > 0 ? ` (依赖: ${task.deps.join(', ')})` : '';
          console.log(`    ${task.id}: ${task.name} [${task.tool}]${deps}`);
        }
        if (dag.edges.length > 0) {
          console.log(`  🔀 条件边: ${dag.edges.length} 条`);
        }
        if (dag.parallelGroups.length > 0) {
          console.log(`  ⚡ 并行组: ${dag.parallelGroups.map((g: string[]) => `[${g.join(', ')}]`).join(', ')}`);
        }
        console.log('');
      } catch (err) {
        console.log(`  ❌ 规划失败: ${(err as Error).message}`);
      }
      rl.prompt();
      return;
    }

    try {
      process.stdout.write(`\n${config.name} > `);
      const response = await agent.handleCLIMessage(input);
      console.log(response);
    } catch (err: unknown) {
      const e = err as Error;
      if (verbose) logger.error('main', 'CLI 消息处理错误', e);
      else console.log(`\n❌ 出了点问题: ${e.message}`);
    }

    console.log('');
    rl.prompt();
  });

  rl.on('close', () => {
    console.log(`\n👋 再见！`);
    process.exit(0);
  });
}

main().catch(console.error);
