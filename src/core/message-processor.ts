import type { BuddyConfig, Message, Attributes, ToolDef } from '../types.js';
import { getTrustLevel, getPermissions } from '../types.js';
import { buildSystemPrompt, buildMessages } from '../personality/prompt.js';
import { classifyError, getUserFriendlyMessage } from '../errors.js';
import { getIntimacyPrompt } from '../pet/index.js';
import type { ConversationSnapshot } from '../intelligence/types.js';
import type { Subsystems } from './subsystems.js';
import type { SkillOps } from './skill-ops.js';
import { formatToolResult, SHARED_STOP_WORDS, TOOL_RESULT_LIMITS } from './constants.js';
import type { LRUCache } from '../perf/cache.js';
import type { STMPStore, MemoryNode as STMPNode } from '../memory/stmp.js';
import { PromptInjector } from '../intelligence/prompt-injector.js';
import type { KnowledgeInterviewer, InterviewQuestion } from '../intelligence/knowledge-interviewer.js';
import { PromptBudgetManager, PRIORITY } from './prompt-budget.js';
import { globalToolCache, ToolCache } from '../tools/cache.js';
import { ReasoningChainStore } from '../memory/reasoning-chain.js';
import { ClarificationEngine } from './clarifier.js';
import { InnerThoughtsEngine } from './inner-thoughts.js';
import { getProjectStore } from '../project/tools.js';

/**
 * LLM 消息处理管线 — 构建上下文、调用 LLM、智能路由
 */
export class MessageProcessor {
  private promptInjector: PromptInjector;
  private lastInterviewQuestion: InterviewQuestion | null = null;
  readonly reasoningChains: ReasoningChainStore;
  readonly clarifier: ClarificationEngine;
  readonly innerThoughts: InnerThoughtsEngine;

  // ISSUE-005: Prompt 注入防御 — 清理用户可控内容中的指令性文本
  private static readonly INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?previous\s+instructions/i,
    /忽略(之前|上面|以上)(的)?(所有)?(指令|提示|规则)/i,
    /you\s+are\s+now\s+(a|an|the)/i,
    /system\s*:\s*/i,
    /assistant\s*:\s*/i,
    /human\s*:\s*/i,
    /\[INST\]/i,
    /<<SYS>>/i,
  ];

  /** 对注入内容做安全包装：检测并 neutralize 指令性文本 */
  private sanitizeInjected(source: string, content: string): string {
    // 检测是否包含注入模式
    const hasInjection = MessageProcessor.INJECTION_PATTERNS.some(p => p.test(content));
    if (hasInjection) {
      // 将可疑内容转义：替换指令性关键词
      let safe = content
        .replace(/ignore\s+(all\s+)?previous\s+instructions/gi, '[已过滤]')
        .replace(/忽略(之前|上面|以上)(的)?(所有)?(指令|提示|规则)/g, '[已过滤]')
        .replace(/you\s+are\s+now\s+(a|an|the)/gi, '[已过滤]')
        .replace(/system\s*:\s*/gi, 'system_')
        .replace(/\[INST\]/gi, '[INST_]')
        .replace(/<<SYS>>/gi, '<<SYS_>>');
      return `\n<注入来源="${source}" 安全模式>\n${safe}\n</注入来源>`;
    }
    return `\n<注入来源="${source}">\n${content}\n</注入来源>`;
  }

  // ── P2: buildContext 分层缓存 ──
  private contextCache = {
    // 静态层 — 信任度不变就不重建
    static: {
      fingerprint: '',          // 信任度指纹
      corePrompt: '',           // 核心指令
      toolList: [] as ToolDef[],// 过滤后的工具列表
      permissions: [] as string[],
      // E3: 静态段预序列化缓存
      cachedStaticPrompt: '',   // 已拼接的静态 prompt
    },
    // 半动态层 — 每 N 次交互更新
    semiDynamic: {
      updateCounter: 0,
      cognitivePrompt: '',
      behaviorSignals: null as ReturnType<Subsystems['pet']['getBehaviorSignals']> | null,
      intimacyLevel: '',
      ocean: undefined as ReturnType<Subsystems['pet']['getOcean']> | undefined,
      personalityStrength: 1,
    },
  };
  private static readonly SEMI_DYNAMIC_INTERVAL = 5; // ISSUE-014: 缩短到 5 次交互更新一次

  // ── P0: 投机预执行白名单（只读工具，无副作用）───
  private static readonly READONLY_TOOLS = new Set([
    'read_file', 'list_files', 'git_status', 'git_log', 'git_diff',
    'get_time', 'search_files', 'scan_project', 'project_context',
    'project_symbols', 'project_deps', 'project_index_stats',
    'analyze_file', 'find_references', 'tts_status', 'tts_voices',
  ]);

  constructor(
    private sys: Subsystems,
    private skillOps: SkillOps,
    private config: BuddyConfig,
    private memoryCache: LRUCache<string>,
    private verbose: boolean,
  ) {
    this.promptInjector = new PromptInjector(sys.stmp, sys.cognitive, undefined, verbose);
    this.reasoningChains = new ReasoningChainStore();
    this.clarifier = new ClarificationEngine();
    this.innerThoughts = new InnerThoughtsEngine();
  }

  /** 获取主动提问引擎（供外部调用） */
  get interviewer(): KnowledgeInterviewer {
    return this.sys.interviewer;
  }

  /** 构建对话处理的共享上下文（P0+P2: 投机预取 + 分层缓存优化） */
  async buildContext(content: string): Promise<{
    availableTools: ToolDef[];
    finalPrompt: string;
    messages: Message[];
    recentMessages: Array<{ role: string; content: string; timestamp: number }>;
  }> {
    // P0: 投机预执行 — 不等 LLM 决策，立即预取高置信度经验中的只读工具
    this.speculativePrefetch(content).catch((err) => { if (this.verbose) console.debug('[DEBUG] 静默错误:', err?.message ?? err); });

    const trust = this.sys.pet.getIntimacy();
    const trustLevel = getTrustLevel(trust);
    const trustFingerprint = `${trustLevel}_${Math.floor(trust / 5)}`;

    // ─── 静态层：信任度变化才重建（~50x 减少重建频率）───
    if (this.contextCache.static.fingerprint !== trustFingerprint) {
      const permissions = getPermissions(trustLevel);
      const allAvailableTools = this.sys.tools.listForPermissions(permissions);

      // 工具检索：意图分类（零延迟）→ 语义检索（兜底）
      let availableTools = allAvailableTools;
      try {
        // 右脑分类（NN + 关键词规则）
        const intentResult = this.sys.threeBrain!.right.classifyFromText(content);
        if (intentResult.confidence >= 0.5 && intentResult.category !== 'complex_task') {
          const intentFiltered = this.filterToolsByCategory(allAvailableTools, intentResult.category);
          if (intentFiltered.length >= 2 && intentFiltered.length < allAvailableTools.length) {
            availableTools = intentFiltered;
            if (this.verbose) console.log(`  [Intent] ${intentResult.category} (${(intentResult.confidence * 100).toFixed(0)}%) → ${availableTools.length} 工具`);
          }
        } else {
          // 第二层：语义检索（意图分类不确定时）
          this.sys.toolRetriever.indexTools(allAvailableTools);
          const relevantTools = this.sys.toolRetriever.getToolsForPrompt(content);
          if (relevantTools.length > 0 && relevantTools.length < allAvailableTools.length) {
            availableTools = relevantTools;
          }
        }
      } catch { /* 检索失败用全量 */ }

      // 养成系统数据（信任度变化才需要刷新）
      const behaviorSignals = this.sys.pet.getBehaviorSignals();
      const dynamicPersonality: Attributes = {
        snark: behaviorSignals.snark,
        wisdom: behaviorSignals.wisdom,
        chaos: behaviorSignals.chaos,
        patience: behaviorSignals.patience,
        debugging: behaviorSignals.debugging,
      };
      const intimacyLevel = getIntimacyPrompt(trust);
      const ocean = this.sys.pet.getOcean?.() ?? undefined;
      const personalityStrength = this.sys.pet.getPersonalityStrength?.() ?? 1;

      const corePrompt = buildSystemPrompt(
        this.config,
        availableTools.map(t => t.name),
        dynamicPersonality,
        intimacyLevel,
        ocean,
        personalityStrength,
      );

      // E3: 预序列化静态 prompt（信任度不变时直接复用）
      const staticBudget = new PromptBudgetManager(this.estimateContextWindow());
      staticBudget.add({ id: 'core-instruction', source: 'system', priority: PRIORITY.CORE_INSTRUCTION, content: corePrompt, required: true });
      staticBudget.add({ id: 'trust-permissions', source: 'trust', priority: PRIORITY.TRUST_PERMISSIONS, content: `\n## 权限级别: ${trustLevel} (信任度: ${trust.toFixed(1)})`, required: true });
      const cachedStaticPrompt = staticBudget.assemble();

      this.contextCache.static = {
        fingerprint: trustFingerprint,
        corePrompt,
        toolList: availableTools,
        permissions,
        cachedStaticPrompt,
      };
      this.contextCache.semiDynamic.behaviorSignals = behaviorSignals;
      this.contextCache.semiDynamic.intimacyLevel = intimacyLevel;
      this.contextCache.semiDynamic.ocean = ocean;
      this.contextCache.semiDynamic.personalityStrength = personalityStrength;

      if (this.verbose) {
        console.log(`  [Cache] 静态层重建: trust=${trust.toFixed(1)} tools=${availableTools.length}`);
      }
    }

    // ─── 半动态层：每 N 次交互更新 ───
    this.contextCache.semiDynamic.updateCounter++;
    if (this.contextCache.semiDynamic.updateCounter >= MessageProcessor.SEMI_DYNAMIC_INTERVAL) {
      this.contextCache.semiDynamic.cognitivePrompt =
        this.sanitizeInjected('cognitive',
          '\n## 你对用户的了解\n' + this.sys.cognitive.getUserPromptFragment()
          + '\n\n## 你对自己的认知\n' + this.sys.cognitive.getSelfPromptFragment());
      this.contextCache.semiDynamic.updateCounter = 0;
      if (this.verbose) console.log('  [Cache] 半动态层更新（认知画像）');
    }

    // ─── 动态层：每次请求必须更新 ───
    const availableTools = this.contextCache.static.toolList;

    // E1: 并行获取动态上下文（记忆检索与情绪/欲望/认知无依赖关系）
    const [relevantMemories, emotionPrompt, desirePrompt] = await Promise.all([
      this.retrieveMemories(content),
      Promise.resolve(this.sys.cerebellum?.getPromptInjection() ?? ''),
      Promise.resolve(this.sys.cerebellum?.getDesirePrompt() ?? null),
    ]);

    // ─── Prompt 预算管理 ───
    const contextWindow = this.estimateContextWindow();
    const promptBudget = Math.floor(contextWindow / 2);
    const budget = new PromptBudgetManager(promptBudget);

    // E3: 静态段使用预序列化缓存（信任度不变时直接复用）
    budget.add({ id: 'static-cached', source: 'cache', priority: PRIORITY.CORE_INSTRUCTION, content: this.contextCache.static.cachedStaticPrompt, required: true });

    // 3. 情绪状态（动态层，优先级 60）
    if (emotionPrompt) {
      budget.add({ id: 'emotion', source: 'emotion', priority: PRIORITY.EMOTION, content: emotionPrompt, required: false });
    }

    // 3.5 欲望状态（动态层，优先级 55）
    if (desirePrompt) {
      budget.add({ id: 'desire', source: 'desire', priority: 55, content: desirePrompt, required: false });
    }

    // 4. 认知画像（半动态层，优先级 50）— ISSUE-005: 注入防御
    const cognitivePrompt = this.contextCache.semiDynamic.cognitivePrompt ||
      this.sanitizeInjected('cognitive',
        '\n## 你对用户的了解\n' + this.sys.cognitive.getUserPromptFragment()
        + '\n\n## 你对自己的认知\n' + this.sys.cognitive.getSelfPromptFragment());
    budget.add({ id: 'cognitive', source: 'cognitive', priority: PRIORITY.COGNITIVE, content: cognitivePrompt, required: false });

    // 5. 记忆检索（E1: 已并行获取）— ISSUE-005: 注入防御
    if (relevantMemories.length > 0) {
      const memoryPrompt = relevantMemories.map(m => `[${m.key}] ${m.value}`).join('\n');
      budget.add({ id: 'memories', source: 'memory', priority: PRIORITY.MEMORY, content: this.sanitizeInjected('memory', memoryPrompt), required: false });
    }

    // 5.1 Phase 1.2: 待恢复任务注入（优先级 65，高于记忆低于情绪）
    try {
      const store = getProjectStore();
      const pendingTasks = store.getPendingExecutionCheckpoints(3);
      if (pendingTasks.length > 0) {
        const pendingPrompt = pendingTasks.map(cp => {
          const completed = cp.completedSteps.length;
          const failed = cp.failedSteps.length;
          const pending = cp.pendingSteps.length;
          return `- 「${cp.goal.slice(0, 80)}」: 完成${completed}步, 失败${failed}步, 待执行${pending}步 (ID: ${cp.id})`;
        }).join('\n');
        budget.add({
          id: 'pending-tasks',
          source: 'memory',
          priority: 65,
          content: `\n## 待恢复的任务\n用户之前未完成的任务，如果相关可以主动询问是否继续：\n${pendingPrompt}`,
          required: false,
        });
        if (this.verbose) console.log(`  [Checkpoint] 注入 ${pendingTasks.length} 个待恢复任务`);
      }
    } catch (err) {
      if (this.verbose) console.debug('[Checkpoint] 查询待恢复任务失败:', (err as Error).message);
    }

    // I3: 推理链注入（优先级略低于记忆）
    const relevantChains = this.reasoningChains.retrieve(content);
    if (relevantChains.length > 0) {
      const chainPrompt = this.reasoningChains.buildPromptInjection(relevantChains);
      if (chainPrompt) {
        budget.add({ id: 'reasoning-chains', source: 'reasoning-chain', priority: PRIORITY.MEMORY - 5, content: chainPrompt, required: false });
      }
    }

    // 6. 领域知识（动态层，优先级 30）
    try {
      const injectionResult = await this.promptInjector.buildInjection(content);
      if (!injectionResult.skipped) {
        budget.add({ id: 'domain-knowledge', source: 'prompt-injector', priority: PRIORITY.DOMAIN_KNOWLEDGE, content: injectionResult.prompt, required: false });
        if (this.verbose) {
          console.log(`  [PromptInjector] 注入领域: ${injectionResult.domains.join(', ')} (${injectionResult.nodeCount} 节点)`);
        }
      }
    } catch (err) {
      if (this.verbose) console.warn('[PromptInjector] 注入失败:', (err as Error).message);
    }

    // 6.1 三层知识管线（采集→碰撞→组装，优先级 29）
    try {
      const brain = this.sys.threeBrain;
      if (brain) {
        const intent = this.inferOutputIntent(content);
        const { knowledgePrompt, conflicts } = await brain.processWithKnowledgePipeline(content, { intent });
        if (knowledgePrompt) {
          budget.add({
            id: 'knowledge-pipeline',
            source: 'pipeline',
            priority: PRIORITY.DOMAIN_KNOWLEDGE + 1,
            content: knowledgePrompt + conflicts,
            required: false,
          });
          if (this.verbose) console.log(`  [Pipeline] 知识管线注入: ${knowledgePrompt.length} chars`);
        }
      }
    } catch (err) {
      if (this.verbose) console.warn('[Pipeline] 知识管线处理失败:', (err as Error).message);
    }

    // 6.5 知识源检索（本地 → 飞书 → 网络，优先级 28）
    // Step 15: 根据内容推断领域，精准选择知识源
    if (this.sys.knowledgeSourceManager.getStats().totalSources > 0) {
      try {
        const inferredDomain = this.inferDomainFromContent(content);
        const knowledgeResults = await this.sys.knowledgeSourceManager.query(content, {
          limit: 5,
          domain: inferredDomain,
        });
        if (knowledgeResults.length > 0) {
          const knowledgePrompt = knowledgeResults
            .map(n => `[${n.sourceType}:${n.title}] ${n.summary}`)
            .join('\n');
          budget.add({
            id: 'knowledge-sources',
            source: 'knowledge-source',
            priority: PRIORITY.DOMAIN_KNOWLEDGE - 2,
            content: this.sanitizeInjected('knowledge-source', knowledgePrompt),
            required: false,
          });
          if (this.verbose) {
            console.log(`  [KnowledgeSource] 注入 ${knowledgeResults.length} 条知识 (${knowledgeResults.map(n => n.sourceType).join('+')})`);
          }
        }
      } catch (err) {
        if (this.verbose) console.warn('[KnowledgeSource] 查询失败:', (err as Error).message);
      }
    }

    // 7. Skill 注入（动态层，优先级 20）— ISSUE-005: 注入防御
    const skillInjection = this.skillOps.getPromptInjection(content);
    if (skillInjection) {
      budget.add({ id: 'skill-injection', source: 'skill-ops', priority: PRIORITY.SKILLS, content: this.sanitizeInjected('skill', skillInjection), required: false });
    }
    const dynamicSkillList = this.buildDynamicSkillPrompt();
    if (dynamicSkillList) {
      budget.add({ id: 'dynamic-skills', source: 'skill-manager', priority: PRIORITY.SKILLS, content: dynamicSkillList, required: false });
    }

    // ─── 组装最终 Prompt ───
    const finalPrompt = budget.assemble();

    if (this.verbose) {
      const report = budget.getReport();
      console.log(`  [DEBUG] 信任: ${trust} (${trustLevel}) | 情绪: ${this.sys.cerebellum?.inferMood() ?? 'calm'} | 可用工具: ${availableTools.map(t=>t.name).join(', ')} | 进化: ${this.sys.pet.getData().evolutionStage}`);
      console.log(`  [Budget] ${report.estimatedTokens}/${report.budgetTokens} tokens (${(report.utilization * 100).toFixed(1)}%) | 包含: ${report.includedSegments.join(', ')}${report.droppedSegments.length ? ' | 丢弃: ' + report.droppedSegments.join(', ') : ''}`);
    }

    const recentMessages = this.sys.memory.getRecentMessages(20);
    const compressed = MessageProcessor.compressMessages(recentMessages, 5, content);
    const messages = buildMessages(finalPrompt, compressed, relevantMemories);

    return { availableTools, finalPrompt, messages, recentMessages };
  }

  // ──────────────────────────────────────────────────────────
  // P7: 消息历史压缩 — 早期对话和工具结果截断
  // ──────────────────────────────────────────────────────────

  /**
   * 压缩消息历史：最近 keepRecent 条保持原样，早期消息截断
   * 减少传给 LLM 的 token 数，推理更快
   * ISSUE-009: 根据内容复杂度动态调整保留条数
   */
  private static compressMessages(
    messages: Array<{ role: string; content: string; timestamp: number }>,
    keepRecent = 5,
    contentHint?: string,
  ): Array<{ role: string; content: string; timestamp: number }> {
    // 推理/代码任务保留更多上下文
    const isComplexTask = contentHint && (
      contentHint.length > 200 ||
      /代码|code|审查|review|分析|analyze|调试|debug|重构|refactor|架构|architecture/.test(contentHint)
    );
    const effectiveKeep = isComplexTask ? Math.min(keepRecent * 3, 15) : keepRecent;

    return messages.map((m, i) => {
      const isRecent = i >= messages.length - effectiveKeep;
      if (isRecent) return m;

      // 工具结果消息：只保留摘要
      if (m.role === 'user' && m.content.startsWith('工具 ') && m.content.length > 500) {
        return { ...m, content: m.content.slice(0, TOOL_RESULT_LIMITS.maxCompressed) + '\n... [已压缩]' };
      }

      // 长消息：截断（推理任务保留更多）
      const truncateAt = isComplexTask ? 500 : 300;
      const keepAt = isComplexTask ? 300 : 150;
      if (m.content.length > truncateAt) {
        return { ...m, content: m.content.slice(0, keepAt) + '... [已截断]' };
      }

      return m;
    });
  }

  /** 估算模型上下文窗口大小 */
  private estimateContextWindow(): number {
    const windows: Record<string, number> = {
      openai: 128000, anthropic: 200000, google: 1000000,
      deepseek: 64000, ollama: 32000, mimo: 32000, custom: 32000,
    };
    const primaryType = this.config.models?.providers?.[0]?.type;
    return windows[primaryType ?? ''] ?? 32000;
  }

  // ──────────────────────────────────────────────────────────
  // P0: 投机预执行 — 经验驱动的只读工具预取
  // ──────────────────────────────────────────────────────────

  /**
   * 投机预执行：高置信度经验匹配到的只读工具立即预取，结果写入全局缓存。
   * LLM 真正调用时命中 ToolCache，省去执行等待。
   */
  private async speculativePrefetch(content: string): Promise<number> {
    try {
      const candidates = this.sys.intelligence.graph.match(content);
      const highConf = candidates.filter(c =>
        c.stats.confidence > 0.8 &&
        c.stats.successCount >= 3 &&
        c.abstractionLevel === 'concrete'
      );
      if (highConf.length === 0) return 0;

      const tasks = highConf.flatMap(exp =>
        exp.steps
          .filter(step => MessageProcessor.READONLY_TOOLS.has(step.tool))
          .map(step => {
            const key = ToolCache.makeKey(step.tool, step.args as Record<string, unknown>);
            if (globalToolCache.get(key)) return null;
            const toolDef = this.sys.tools.get(step.tool);
            if (!toolDef) return null;
            return toolDef
              .execute(step.args as Record<string, unknown>)
              .then(r => globalToolCache.set(key, String(r), 30))
              .catch((err) => { if (this.verbose) console.debug('[DEBUG] 静默错误:', err?.message ?? err); });
          })
          .filter(Boolean)
      );

      if (tasks.length === 0) return 0;
      // H3: 限制并发预取数量，防止资源耗尽
      const MAX_PREFETCH = 5;
      await Promise.allSettled(tasks.slice(0, MAX_PREFETCH));
      if (this.verbose) console.log(`  [P0] 投机预取 ${tasks.length} 个只读工具`);
      return tasks.length;
    } catch (err) {
      if (this.verbose) console.warn('[P0] 投机预取失败:', (err as Error).message);
      return 0;
    }
  }

  // ──────────────────────────────────────────────────────────
  // P1: 自动 DAG 检测 — 复杂请求自动走图规划
  // ──────────────────────────────────────────────────────────

  /** 复杂度检测：多步骤请求自动启用 DAG 编排 */
  private assessComplexity(content: string): { shouldUseDAG: boolean; reason: string } {
    const lower = content.toLowerCase();

    // 短消息直接跳过（避免"然后"等普通词误命中）
    if (content.length < 20) {
      return { shouldUseDAG: false, reason: '' };
    }

    // 多步骤标记词
    const stepMarkers = ['然后', '接着', '同时', '并且', '先', '再', '最后',
                          'and then', 'also', 'after that', 'first', 'next', 'finally'];
    const markerCount = stepMarkers.filter(m => lower.includes(m)).length;

    // 并行标记
    const parallelMarkers = ['同时', '并行', '一起', 'along with', 'together'];
    const hasParallel = parallelMarkers.some(m => lower.includes(m));

    // 多个独立动作（逗号/分号分隔的动词短语）
    const clauses = content.split(/[,，;；、]/).filter(c => c.trim().length > 2);

    // E2: 多实体引用（多个文件名/路径）
    const pathMatches = content.match(/[\w/\\.-]+\.\w+/g) ?? [];
    const hasMultiplePaths = new Set(pathMatches).size >= 2;

    // E2: 条件语句
    const hasCondition = /如果|假如|unless|if\s/i.test(content);

    // E2: 批量指示
    const hasQuantity = /所有|每个|全部|批量|all|every|batch/i.test(content);

    // E3: 复合分析请求（"分析X并对比Y"、"列出X并分类"）
    const hasCompoundAnalysis = /分析.{2,}并|列出.{2,}并|对比.{2,}并|统计.{2,}并|检查.{2,}并/i.test(content);
    // E3: 多动作动词（同一句中出现 2+ 个动作动词）
    const actionVerbs = ['分析', '对比', '列出', '统计', '生成', '创建', '修改', '删除', '检查', '优化',
                          '排序', '过滤', '分组', '汇总', '计算', '编写', '实现', '设计', '重构'];
    const verbCount = actionVerbs.filter(v => lower.includes(v)).length;
    const hasMultipleVerbs = verbCount >= 2;

    // 阈值：markerCount >= 2（原 3），clauses >= 3（原 4），新增复合分析和多动词
    const shouldUseDAG = markerCount >= 2 || hasParallel || clauses.length >= 3
      || hasMultiplePaths || (hasCondition && clauses.length >= 2) || hasQuantity
      || hasCompoundAnalysis || hasMultipleVerbs;
    const reason = shouldUseDAG
      ? `markers=${markerCount} parallel=${hasParallel} clauses=${clauses.length}${hasMultiplePaths ? ' multiPath' : ''}${hasCondition ? ' conditional' : ''}${hasQuantity ? ' batch' : ''}${hasCompoundAnalysis ? ' compound' : ''}${hasMultipleVerbs ? ` verbs=${verbCount}` : ''}`
      : '';

    return { shouldUseDAG, reason };
  }

  /** 自产智能路由 */
  async tryIntelligenceRoute(
    content: string,
    messages: Message[],
    recentMessages: Array<{ role: string; content: string; timestamp: number }>,
    onChunk?: (chunk: string) => void,
  ): Promise<{ skipped: false } | { skipped: true; text: string }> {
    try {
      const routeContext = recentMessages.slice(-5).map(m => m.content);
      const intelResult = await this.sys.intelligence.process(content, routeContext);

      if (intelResult.decision.path === 'exp_direct' && intelResult.result?.success) {
        if (this.verbose) {
          const conf = intelResult.decision.confidence?.toFixed(2);
          console.log(`  [Intelligence] 直接执行: ${intelResult.decision.skill?.name} (置信度: ${conf})`);
        }
        if (onChunk) onChunk(intelResult.result.reply);
        this.sys.pet.trackFeature('experience_compile');
        return { skipped: true, text: intelResult.result.reply };
      }

      if (intelResult.decision.path === 'exp_verified' && intelResult.result?.success) {
        if (this.verbose) {
          const conf = intelResult.decision.confidence?.toFixed(2);
          console.log(`  [Intelligence] 验证执行: ${intelResult.decision.skill?.name} (置信度: ${conf})`);
        }
        const hintPrefix = `[技能参考: ${intelResult.decision.skill?.name}]\n${intelResult.result.reply}\n\n`;
        messages.push({ role: 'user', content: hintPrefix + content, timestamp: Date.now() });
      }

      if (intelResult.decision.path === 'llm_only' && this.verbose) {
        const novelty = intelResult.decision.novelty?.toFixed(2);
        console.log(`  [Intelligence] 纯LLM（新颖度: ${novelty}）— 强制学习模式`);
      }
    } catch (err) {
      if (this.verbose) console.warn('[Intelligence] 路由失败:', (err as Error).message);
    }
    return { skipped: false };
  }

  /**
   * 验证 LLM 返回的工具调用 — 工具是否存在、参数是否合法
   * 不存在的工具尝试重选，参数错误尝试修复
   */
  private validateToolCalls(
    toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }>,
    availableTools: ToolDef[],
    maxRetries: number = 1,
  ): Array<{ name: string; args: Record<string, unknown>; result: string }> {
    const toolMap = new Map(availableTools.map(t => [t.name, t]));
    const validated: typeof toolCalls = [];

    for (const tc of toolCalls) {
      const tool = toolMap.get(tc.name);

      if (!tool) {
        // 工具不存在 → 尝试找相似工具
        const similar = availableTools.find(t =>
          t.name.includes(tc.name) || tc.name.includes(t.name) ||
          t.description.toLowerCase().includes(tc.name.toLowerCase()),
        );
        if (similar && maxRetries > 0) {
          if (this.verbose) console.log(`  [验证] 工具 "${tc.name}" 不存在，降级到 "${similar.name}"`);
          validated.push({ ...tc, name: similar.name, result: `[自动修正: 原工具 "${tc.name}" 不存在]` });
        } else {
          if (this.verbose) console.warn(`  [验证] 工具 "${tc.name}" 不存在且无相似替代，跳过`);
        }
        continue;
      }

      // 参数 schema 验证
      if (tool.parameters && tc.args) {
        try {
          tool.parameters.parse(tc.args);
          validated.push(tc);
        } catch (e) {
          // 参数不合法 → 尝试修复（补全缺失字段）
          const fixed = this.tryFixArgs(tc.args, tool.parameters);
          if (fixed) {
            if (this.verbose) console.log(`  [验证] 工具 "${tc.name}" 参数修复成功`);
            validated.push({ ...tc, args: fixed });
          } else {
            if (this.verbose) console.warn(`  [验证] 工具 "${tc.name}" 参数不合法且无法修复，跳过`);
          }
        }
      } else {
        validated.push(tc);
      }
    }

    return validated;
  }

  /** 尝试修复工具参数（补全缺失的可选字段，修正类型） */
  private tryFixArgs(args: Record<string, unknown>, schema: any): Record<string, unknown> | null {
    try {
      // 直接尝试 parse，可能只是多了额外字段
      const result = schema.parse(args);
      return result;
    } catch {
      // 尝试 strip 多余字段
      try {
        const result = schema.strip().parse(args);
        return result;
      } catch {
        return null;
      }
    }
  }

  /** 批量处理（WS 模式） */
  async processBatch(content: string, eventBus: { emit: (e: any) => void } | null, options?: { skipDAG?: boolean; taskType?: import('../core/model-router.js').TaskType }): Promise<{
    text: string;
    steps: number;
    toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }>;
    /** 估算的 prompt token 数（用于自适应并发控制的延迟归一化） */
    promptTokens: number;
  }> {
    const { availableTools, finalPrompt, messages, recentMessages } = await this.buildContext(content);
    eventBus?.emit({ type: 'thinking' });

    // 估算 prompt token 数（粗略：2 字符 ≈ 1 token）
    const promptTokens = Math.ceil(
      messages.reduce((sum, m) => sum + m.content.length, 0) / 2
    );

    const route = await this.tryIntelligenceRoute(content, messages, recentMessages);
    if (route.skipped) return { text: route.text, steps: 1, toolCalls: [], promptTokens: 0 };

    // P1: 自动 DAG 检测 — 复杂请求走并行编排
    // skipDAG=true 时跳过（外部 orchestrate 已决策）
    if (!options?.skipDAG) {
      const complexity = this.assessComplexity(content);
      if (complexity.shouldUseDAG) {
        try {
          const dag = await this.sys.dagPlanner.plan(content);
          if (dag.tasks.size >= 2) {
            if (this.verbose) console.log(`  [P1] DAG 检测命中 (${complexity.reason}), ${dag.tasks.size} 个任务`);
            const dagResult = await this.sys.taskExecutor.execute(dag, () => {});
            this.sys.pet.trackFeature('dag_orchestrate');
            return {
              text: dagResult.summary,
              steps: 1,
              toolCalls: dagResult.taskResults.map(r => ({
                name: r.id, args: {} as Record<string, unknown>, result: r.result,
              })),
              promptTokens,
            };
          }
        } catch (err) {
          if (this.verbose) console.warn('[P1] DAG 规划失败，降级到 ReAct:', (err as Error).message);
        }
      }
    }

    let result;
    try {
      result = await this.sys.llm.chat(messages, availableTools, 5, { taskType: options?.taskType });
    } catch (err: unknown) {
      const classified = classifyError(err);
      console.error(`⚠️ LLM 调用失败 [${classified.category}]: ${classified.original}`);

      if (classified.recoverable) {
        if (this.verbose) console.log('  [DEBUG] 尝试降级重试...');
        try {
          const simpleMessages: Message[] = [
            { role: 'system', content: finalPrompt, timestamp: Date.now() },
            { role: 'user', content, timestamp: Date.now() },
          ];
          result = await this.sys.llm.chat(simpleMessages, availableTools, 3, { taskType: options?.taskType });
        } catch (retryErr) {
          if (this.verbose) console.warn('[LLM] 降级重试失败:', (retryErr as Error).message);
          throw new Error(getUserFriendlyMessage(classified));
        }
      } else {
        throw new Error(getUserFriendlyMessage(classified));
      }
    }

    // 工具验证：检查工具是否存在、参数是否合法
    result.toolCalls = this.validateToolCalls(result.toolCalls, availableTools);

    result.toolCalls = result.toolCalls.map(tc => ({
      ...tc,
      result: formatToolResult(tc.result),
    }));

    if (result.toolCalls.length > 0) {
      const toolsUsed = result.toolCalls.map(t => t.name).join(', ');
      this.sys.memory.addDiaryEntry(`帮用户处理了请求，使用了: ${toolsUsed}`);
    }

    return { ...result, promptTokens };
  }

  /** 流式处理（CLI 模式） */
  async processStream(
    content: string,
    onChunk: (chunk: string) => void,
    eventBus: { emit: (e: any) => void } | null,
    options?: { skipDAG?: boolean; systemHint?: string; taskType?: import('../core/model-router.js').TaskType },
  ): Promise<{
    text: string;
    toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }>;
  }> {
    const { availableTools, finalPrompt, messages, recentMessages } = await this.buildContext(content);
    eventBus?.emit({ type: 'thinking' });

    // Module 8: 能力覆盖度检查 — 模型池能否处理此请求
    try {
      const pool = this.sys.router?.getPool?.();
      if (pool && pool.isInitialized) {
        const { CapabilityCoverageChecker } = await import('./capability-checker.js');
        const checker = new CapabilityCoverageChecker(pool);
        const coverage = checker.check(content);
        if (coverage.recommendation === 'reject') {
          if (this.verbose) console.log(`  [Capability] 拒绝: ${coverage.gaps.join(', ')}`);
          return { text: coverage.message ?? '当前模型池缺少所需能力', toolCalls: [] };
        }
        if (coverage.recommendation === 'degrade' && this.verbose) {
          console.log(`  [Capability] 降级: ${coverage.gaps.join(', ')}`);
        }
      }
    } catch (err) {
      if (this.verbose) console.warn('[Capability] 检查失败:', (err as Error).message);
    }

    // Module 2: 用户状态推断 — 影响回复风格
    try {
      const brain = this.sys.threeBrain;
      if (brain) {
        const stateSignal = brain.userStateInferrer.infer({
          content,
          recentMessages,
          recentToolCalls: this.countRecentToolCalls(recentMessages),
          now: Date.now(),
        });
        if (this.verbose) console.log(`  [UserState] ${stateSignal.state} (${(stateSignal.confidence * 100).toFixed(0)}%) → ${stateSignal.recommendAction}`);

        // 赶时间 → 注入简短回复提示
        if (stateSignal.recommendAction === 'brief') {
          const systemMsg = messages.find(m => m.role === 'system');
          if (systemMsg) {
            systemMsg.content += '\n\n## 用户状态\n用户似乎赶时间，请简洁回复，避免冗长解释。';
          }
        }
        // 详细模式 → 注入详细回复提示
        if (stateSignal.recommendAction === 'detailed') {
          const systemMsg = messages.find(m => m.role === 'system');
          if (systemMsg) {
            systemMsg.content += '\n\n## 用户状态\n用户正在学习/探索，请详细解释，提供示例。';
          }
        }
      }
    } catch (err) {
      if (this.verbose) console.warn('[UserState] 推断失败:', (err as Error).message);
    }

    // I5: 澄清检测 — 模糊写操作、目标冲突、资源不足、理解偏差主动确认
    const clarification = this.clarifier.assess(content, { recentMessages: recentMessages.map(m => m.content) });
    if (clarification.shouldClarify) {
      if (this.verbose) console.log(`  [I5] 澄清触发 (${clarification.issueType}): ${clarification.ambiguousAspects.join(', ')}`);

      // 根据问题类型采用不同策略
      switch (clarification.issueType) {
        case 'conflict':
          // 目标冲突 → 通过 eventBus 发送确认请求（不阻塞）
          eventBus?.emit({ type: 'clarify', question: clarification.clarificationQuestion });
          return { text: clarification.clarificationQuestion, toolCalls: [] };

        case 'resource':
          // 资源不足 → 提示用户补充信息
          eventBus?.emit({ type: 'bubble', text: `⚠️ ${clarification.clarificationQuestion}` });
          return { text: clarification.clarificationQuestion, toolCalls: [] };

        case 'deviation':
          // 理解偏差 → 确认意图
          eventBus?.emit({ type: 'clarify', question: clarification.clarificationQuestion });
          return { text: clarification.clarificationQuestion, toolCalls: [] };

        case 'ambiguity':
        default:
          // 模糊操作 → 直接返回澄清问题
          return { text: clarification.clarificationQuestion, toolCalls: [] };
      }
    }

    // I4: 内心独白分析（异步，不阻塞）
    this.innerThoughts.onUserMessage(content, recentMessages);

    const route = await this.tryIntelligenceRoute(content, messages, recentMessages, onChunk);
    if (route.skipped) return { text: route.text, toolCalls: [] };

    // P1: 自动 DAG 检测 — 复杂请求走并行编排
    // skipDAG=true 时跳过（外部 orchestrate 已决策）
    if (!options?.skipDAG) {
      const complexity = this.assessComplexity(content);
      if (complexity.shouldUseDAG) {
        try {
          const dag = await this.sys.dagPlanner.plan(content);
          if (dag.tasks.size >= 2) {
            if (this.verbose) console.log(`  [P1] DAG 检测命中 (${complexity.reason}), ${dag.tasks.size} 个任务`);
            const dagResult = await this.sys.taskExecutor.execute(dag, (event) => {
              if (event.type === 'orch_task_done') {
                onChunk(`✅ [${(event as any).taskId}] 完成\n`);
              }
            });
            onChunk(dagResult.summary);
            this.sys.pet.trackFeature('dag_orchestrate');
            return {
              text: dagResult.summary,
              toolCalls: dagResult.taskResults.map(r => ({
                name: r.id, args: {} as Record<string, unknown>, result: r.result,
              })),
            };
          }
        } catch (err) {
          if (this.verbose) console.warn('[P1] DAG 规划失败，降级到 ReAct:', (err as Error).message);
        }
      }
    }

    // I1: 能力边界感知 — seed 阶段领域自动加限定语
    const capabilityPrefix = this.assessCapability(content);

    // Phase 1: 注入经验 hint（systemHint）到消息系统 prompt
    if (options?.systemHint) {
      const systemMsg = messages.find(m => m.role === 'system');
      if (systemMsg) {
        systemMsg.content += `\n\n## 经验参考\n${options.systemHint}`;
      } else {
        messages.unshift({ role: 'system', content: options.systemHint, timestamp: Date.now() });
      }
    }

    let result;
    try {
      // 如果有能力前缀，注入到第一条消息前
      if (capabilityPrefix) {
        onChunk(capabilityPrefix);
      }
      result = await this.sys.llm.streamChat(messages, availableTools, 5, onChunk, {
        taskType: options?.taskType,
      });
    } catch (err: unknown) {
      const classified = classifyError(err);
      console.error(`⚠️ LLM 流式调用失败 [${classified.category}]: ${classified.original}`);

      if (classified.recoverable) {
        console.log('  [降级] 流式失败，切换到批量模式...');
        const fallbackResult = await this.sys.llm.chat(messages, availableTools, 5, { taskType: options?.taskType });
        onChunk(fallbackResult.text);
        return {
          text: fallbackResult.text,
          toolCalls: fallbackResult.toolCalls.map(tc => ({ ...tc, result: formatToolResult(tc.result) })),
        };
      } else {
        throw new Error(getUserFriendlyMessage(classified));
      }
    }

    result.toolCalls = result.toolCalls.map(tc => ({
      ...tc,
      result: formatToolResult(tc.result),
    }));

    if (result.toolCalls.length > 0) {
      const toolsUsed = result.toolCalls.map(t => t.name).join(', ');
      this.sys.memory.addDiaryEntry(`帮用户处理了请求，使用了: ${toolsUsed}`);
    }

    // I4: 插入高紧急度内心独白
    const interjection = this.innerThoughts.getInterjection();
    if (interjection) {
      result.text += interjection;
    }

    // I3: 从对话中提取推理结论
    this.extractReasoningFromResult(content, result);

    // I6: 意图预测 + 预加载后续经验工具
    this.predictNextIntent(content).catch((err) => { if (this.verbose) console.debug('[DEBUG] 静默错误:', err?.message ?? err); });

    return result;
  }

  /** STMP 智能记忆检索 */
  async retrieveMemories(query: string): Promise<Array<{ key: string; value: string }>> {
    const cacheKey = `mem:${query.slice(0, 100)}`;
    const cached = this.memoryCache.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch (e) { if (this.verbose) console.warn('[Cache] 缓存数据损坏:', (e as Error).message); }
    }

    try {
      const stmpResult = await this.sys.stmp.retrieve(query, { maxPrimary: 3, maxAssociative: 2 });
      const results: Array<{ key: string; value: string }> = [];

      for (const node of stmpResult.primary) {
        results.push({ key: `[${stmpResult.room?.name ?? '记忆'}]`, value: node.content.slice(0, 200) });
      }
      for (const node of stmpResult.associative) {
        results.push({ key: '[关联]', value: node.content.slice(0, 150) });
      }

      // Phase 1.3: STMP 结果不足时，用混合检索（FTS5 + 语义）补充
      if (results.length < 3) {
        const hybrid = this.sys.memory.searchMemoriesHybrid(query, 3 - results.length);
        results.push(...hybrid.map(r => ({ key: r.key, value: r.value })));
      }

      const final = results.slice(0, 5);
      this.memoryCache.set(cacheKey, JSON.stringify(final));
      return final;
    } catch (err) {
      if (this.verbose) console.warn('[STMP] 检索异常，回退到混合检索:', (err as Error).message);
      // Phase 1.3: 异常时用混合检索替代纯 FTS5
      const fallback = this.sys.memory.searchMemoriesHybrid(query, 3);
      this.memoryCache.set(cacheKey, JSON.stringify(fallback));
      return fallback;
    }
  }

  /** 将对话自动存入 STMP */
  storeToSTMP(role: string, content: string): void {
    if (role !== 'assistant' || content.length < 10) return;

    try {
      const concepts = this.extractConcepts(content);
      const node: STMPNode = {
        id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        content: content.slice(0, 1000),
        room: this.sys.stmp.locateRoom(content)?.id ?? 'default',
        timestamp: Date.now(),
        temporalContext: { before: [], after: [] },
        concepts,
        relations: concepts.map(c => ({ target: c, type: 'relates_to' as const, strength: 0.5 })),
        emotional: {
          valence: (this.sys.cerebellum?.bodyState.getSatisfaction() ?? 50) > 50 ? 0.3 : -0.1,
          importance: 3,
        },
        lifecycle: {
          createdAt: Date.now(),
          lastAccessed: Date.now(),
          accessCount: 1,
          decay: 1.0,
          compressed: false,
          hibernated: false,
        },
        source: 'conversation',
      };
      this.sys.stmp.insertNode(node);

      for (let i = 0; i < concepts.length; i++) {
        for (let j = i + 1; j < concepts.length; j++) {
          this.sys.stmp.upsertEdge(concepts[i], concepts[j], 0.3);
        }
      }
    } catch (err) {
      if (this.verbose) console.warn('[STMP] 写入失败:', (err as Error).message);
    }
  }

  /** 简单概念提取 */
  extractConcepts(text: string): string[] {
    return [...new Set(
      text.replace(/[，。！？、；：""''（）\[\]{}<>,.!?;:()\[\]{}<>]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length >= 2 && !SHARED_STOP_WORDS.has(t.toLowerCase()))
    )].slice(0, 8);
  }

  /** 异步知识提取 — 即时触发版（Phase 3: 返回提取的知识供 KnowledgeBridge 桥接） */
  async extractKnowledgeAsync(): Promise<import('../knowledge/extractor.js').ExtractedKnowledge[]> {
    try {
      const messages = this.sys.memory.getRecentMessages(15) as Message[];
      if (messages.length < 3) return [];

      // 频率限制：至少间隔 60 秒（防止高并发时频繁提取）
      const lastExtractionTime = this.sys.memory.getRelation('last_extraction_time') || 0;
      if (Date.now() - lastExtractionTime < 60_000) return [];

      const lastExtraction = this.sys.memory.getRelation('last_extraction_at') || 0;
      const interactionCount = this.sys.memory.getRelation('total_interactions') || 0;
      if (interactionCount <= lastExtraction) return [];

      const extractQuota = this.sys.subscriptionManager.recordExtraction('local');
      if (!extractQuota.allowed) return [];

      const result = await this.sys.extractor.extract(messages, 10);

      if (result.stmpInserted > 0) {
        this.sys.pet.trackFeature('knowledge_extract');

        this.sys.memory.addDiaryEntry(
          `📚 知识提取：从对话中提取了 ${result.stmpInserted} 条专业知识（${result.domainUpdates.join(', ')}）`
        );

        for (const domain of result.domainUpdates) {
          const profile = this.sys.cognitive.getDomainProfile(domain);
          if (profile.growthStage === 'mature') {
            this.sys.memory.addDiaryEntry(
              `🎯 领域「${domain}」已达到成熟阶段，可以创建能力包了！`
            );
            this.skillOps.tryCreatePackage(domain, {
              growthStage: profile.growthStage,
              domainType: profile.domainType,
            });
          }
        }

        this.sys.memory.setRelation('last_extraction_at', interactionCount);
        this.sys.memory.setRelation('last_extraction_time', Date.now());
        this.skillOps.checkAutoSnapshots();
      }

      return result.extracted ?? [];
    } catch (err) {
      if (this.verbose) console.warn('[Knowledge] 提取失败:', (err as Error).message);
      return [];
    }
  }

  /** 从成功对话学习新技能 */
  learnFromConversation(content: string, result: { text: string; toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }> }): void {
    if (result.toolCalls.length === 0) return;

    // 停滞检测：如果检测到停滞，跳过自动编译
    if (!this.sys.intelligence.evolver.canCompile()) {
      if (this.verbose) console.log('  [Intelligence] 停滞检测阻止自动编译');
      return;
    }

    try {
      const conv: ConversationSnapshot = {
        id: `conv-${Date.now()}`,
        userMessage: content,
        assistantReply: result.text,
        toolCalls: result.toolCalls.map(tc => ({
          name: tc.name,
          args: tc.args,
          result: tc.result,
        })),
        timestamp: Date.now(),
        wasSuccessful: true,
      };
      this.sys.intelligence.learn(conv).catch(err => {
        if (this.verbose) console.warn('[Intelligence] 技能学习失败:', err.message);
      });
    } catch (err) {
      if (this.verbose) console.warn('[Intelligence] 技能学习失败:', (err as Error).message);
    }
  }

  // ──────────────────────────────────────────────────────────
  // Phase A: 主动提问集成
  // ──────────────────────────────────────────────────────────

  /**
   * 对话后分析 — 决定是否追问专业知识
   * 在每次 assistant 回复后异步调用
   */
  async analyzeAndAsk(): Promise<string | null> {
    try {
      const question = await this.sys.interviewer.analyzeAndDecide();
      if (!question) return null;

      this.lastInterviewQuestion = question;

      // 构建自然的追问消息
      return `\n\n---\n💬 顺便问一下：${question.question}`;
    } catch (err) {
      if (this.verbose) console.warn('[Interviewer] 分析失败:', (err as Error).message);
      return null;
    }
  }

  /**
   * 检查用户是否在回答上一次追问
   * 如果是，记录回答事件
   */
  checkInterviewAnswer(userContent: string): void {
    if (!this.lastInterviewQuestion) return;

    if (this.sys.interviewer.isAnswerToInterview(userContent, this.lastInterviewQuestion)) {
      this.sys.interviewer.recordAnswered(this.lastInterviewQuestion.domain);

      if (this.verbose) {
        console.log(`  [Interviewer] 用户回答了关于 ${this.lastInterviewQuestion.domain} 的追问`);
      }
    }

    // 无论是否匹配，都清空上一次追问
    this.lastInterviewQuestion = null;
  }

  /** 重置会话追问状态 */
  resetInterviewSession(): void {
    this.sys.interviewer.resetSession();
    this.lastInterviewQuestion = null;
  }

  /** 构建动态 Skill 列表注入 Prompt */
  private buildDynamicSkillPrompt(): string {
    const skills = this.sys.skillManager.listSkills();
    if (skills.length === 0) return '';

    let prompt = '\n\n## 可用的动态工具 Skill\n';
    prompt += '以下工具是通过 .skillmate 文件动态加载的，你可以通过 exec 或 skill_* 工具调用：\n\n';
    for (const s of skills) {
      prompt += `- **${s.name}**: ${s.description} (v${s.version})\n`;
    }
    return prompt;
  }

  // ── I1: 实时能力边界感知 ──

  /** 统计最近消息中的工具调用次数 */
  private countRecentToolCalls(messages: Array<{ role: string; content: string; timestamp: number }>): number {
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    return messages.filter(m =>
      m.role === 'user' &&
      m.timestamp > tenMinAgo &&
      m.content.startsWith('工具 ')
    ).length;
  }

  /**
   * 检测用户请求所属领域，seed 阶段自动加限定语
   */
  private assessCapability(content: string): string {
    try {
      // 检测领域关键词
      const domainKeywords: Record<string, string[]> = {
        '机器学习': ['训练', '模型', 'loss', 'epoch', '神经网络', '深度学习', '梯度', 'backprop', 'machine learning', 'ML', 'deep learning'],
        '区块链': ['区块链', 'bitcoin', 'ethereum', 'smart contract', 'web3', 'NFT', 'DeFi'],
        '量子计算': ['量子', 'qubit', 'quantum', '叠加态', '纠缠'],
        '金融': ['股票', '基金', '期货', 'K线', '收益率', '投资组合'],
        '医学': ['诊断', '处方', '临床', '病理', '药物相互作用'],
      };

      const contentLower = content.toLowerCase();
      for (const [domain, keywords] of Object.entries(domainKeywords)) {
        const hits = keywords.filter(k => contentLower.includes(k.toLowerCase()));
        if (hits.length >= 2) {
          const profile = this.sys.cognitive.getDomainProfile(domain);
          if (profile.growthStage === 'seed' || profile.depthScore < 0.3) {
            return `⚠️ 我对「${domain}」了解有限，以下建议仅供参考：\n\n`;
          }
        }
      }
    } catch {
      // 静默失败
    }
    return '';
  }

  // ── I3: 推理链提取 ──

  /**
   * 从对话结果中提取推理结论写入推理链
   */
  private extractReasoningFromResult(
    content: string,
    result: { text: string; toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }> },
  ): void {
    try {
      // 提取主题（用户问题的核心）
      const topic = content.slice(0, 60).replace(/[？?！!。，,\s]+$/g, '');
      if (topic.length < 3) return;

      // 从回复中提取结论句
      const conclusionSentences = result.text
        .split(/[。！？.!?\n]+/)
        .filter(s => s.trim().length > 10 && s.trim().length < 100)
        .slice(0, 2);

      for (const sentence of conclusionSentences) {
        // 只提取有信息量的句子（排除问候/废话）
        if (/因此|所以|总结|结论|建议|应该|需要|可以/.test(sentence)) {
          this.reasoningChains.conclude(topic, sentence.trim(), 0.5);
        }
      }

      // 检测未解决的问题
      const questions = result.text.match(/[^。！？]*[？?][^。！？]*/g) ?? [];
      for (const q of questions.slice(0, 2)) {
        if (q.includes('需要') || q.includes('请问') || q.includes('能否')) {
          this.reasoningChains.addOpenQuestion(topic, q.trim().slice(0, 100));
        }
      }
    } catch {
      // 静默失败
    }
  }

  // ── I6: 意图预测 + 预加载 ──

  /**
   * 基于经验图谱预测下一步意图并预加载工具
   */
  private async predictNextIntent(content: string): Promise<void> {
    try {
      const matched = this.sys.intelligence.graph.match(content);
      if (matched.length === 0) return;

      const lastExp = matched[0];
      const successors = this.sys.intelligence.graph.getSuccessors(lastExp.id);

      for (const { node } of successors.slice(0, 3)) {
        for (const step of node.steps) {
          if (MessageProcessor.READONLY_TOOLS.has(step.tool)) {
            const key = ToolCache.makeKey(step.tool, step.args);
            if (!globalToolCache.get(key)) {
              // 异步预加载，不阻塞
              this.sys.tools.get(step.tool)
                ?.execute(step.args)
                .then(r => globalToolCache.set(key, String(r), 60))
                .catch((err) => { if (this.verbose) console.debug('[DEBUG] 静默错误:', err?.message ?? err); });
            }
          }
        }
      }
    } catch {
      // 静默失败
    }
  }

  /** 按意图类别过滤工具（右脑 NN 分类后使用） */
  private filterToolsByCategory<T extends { name: string }>(allTools: T[], category: string): T[] {
    const CATEGORY_TOOLS: Record<string, string[]> = {
      file_operations: ['read', 'write', 'list_files', 'exec', 'file_ops'],
      code_operations: ['read', 'write', 'exec', 'search_files', 'code_intel'],
      git_operations: ['exec'],
      web_operations: ['web_fetch', 'exec'],
      system_operations: ['exec'],
      knowledge_query: ['web_fetch'],
      conversation: [],
    };
    const toolNames = CATEGORY_TOOLS[category];
    if (!toolNames || toolNames.length === 0) return allTools;
    return allTools.filter(t => toolNames.some(n => t.name.includes(n)));
  }

  /**
   * Step 15: 从内容推断领域，用于知识源精准路由
   */
  private inferDomainFromContent(content: string): string {
    const lower = content.toLowerCase();
    const domainKeywords: Record<string, string[]> = {
      code: ['代码', 'code', '函数', 'function', 'bug', 'debug', '编译', 'build', 'npm', 'pip'],
      git: ['git', 'commit', 'push', 'merge', 'branch', 'diff', 'log'],
      web: ['网页', 'web', 'url', '搜索', 'search', 'fetch', '天气', 'weather'],
      file: ['文件', 'file', '目录', 'folder', '读取', '写入', '创建', '删除'],
      system: ['系统', 'system', '进程', 'process', '端口', 'port', 'docker', '服务'],
      data: ['数据', 'data', '分析', 'analyze', 'csv', 'sql', '图表', '统计'],
      knowledge: ['是什么', '什么是', '为什么', '怎么', '如何', '区别', '原理', 'explain'],
    };

    for (const [domain, keywords] of Object.entries(domainKeywords)) {
      if (keywords.some(k => lower.includes(k))) return domain;
    }
    return 'general';
  }

  /**
   * 推断输出意图（供三层知识管线使用）
   */
  private inferOutputIntent(content: string): import('../intelligence/knowledge-assembler.js').OutputIntent {
    const lower = content.toLowerCase();
    if (/对比|比较|vs|versus|区别|差异/.test(lower)) return 'compare';
    if (/怎么|如何|执行|运行|操作|步骤/.test(lower)) return 'execute';
    if (/什么是|解释|原理|为什么|概念|定义/.test(lower)) return 'explain';
    if (/报告|总结|汇总|状态|进展/.test(lower)) return 'report';
    if (/你好|hi|hello|嗯|哦|哈哈|谢谢/.test(lower)) return 'chat';
    return 'report';
  }
}
