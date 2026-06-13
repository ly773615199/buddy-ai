/**
 * 经验编译器 — 从成功对话中提取经验单元
 *
 * 核心思路：如果一次对话成功完成了任务（工具调用全部成功），
 * 那么这次的"用户意图 → 工具序列 → 结果"就可以编译成可复用经验。
 */

import type { ConversationSnapshot, ExperienceUnit, ExperienceStep, ReplyTemplate, DAGPattern } from './types.js';
import { randomUUID } from 'crypto';

// ── LLM 调用接口（可注入）──

export type LLMCaller = (messages: Array<{ role: string; content: string }>) => Promise<string>;

// ── 意图分类关键词 ──

const INTENT_KEYWORDS: Record<string, string[]> = {
  file_read:    ['读', '看', '打开', '查看', 'read', 'show', 'cat', '内容'],
  file_write:   ['写', '创建', '新建', '保存', 'write', 'create', 'save'],
  file_search:  ['搜', '找', '查找', 'grep', 'search', 'find'],
  list_files:   ['目录', '文件', 'ls', '列表', 'list', 'dir'],
  exec:         ['运行', '执行', '跑', 'run', 'exec', '测试', 'test', 'build'],
  git_status:   ['git', '提交', 'commit', '分支', 'branch', '状态', 'status'],
  git_diff:     ['diff', '改动', '变更', '修改了什么'],
  search_web:   ['搜', '查', '百度', 'google', 'search', '搜索'],
  fetch_url:    ['打开', '访问', '抓取', 'fetch', 'url', '网页'],
  get_time:     ['时间', '几点', '日期', 'time', 'date'],
  error_fix:    ['报错', 'error', 'bug', '问题', 'fix', '修复', '解决', '挂了'],
  code_analyze: ['分析', '结构', '看看', 'analyze', '什么框架', '用了什么'],
  dag_workflow: ['编排', '并行', '批量', '流水线', 'pipeline', 'workflow', '同时', '一起'],
};

export class ExperienceCompiler {
  private llmCaller: LLMCaller | null = null;
  private verbose = false;

  /**
   * 注入 LLM 调用器（Phase 6: 增强编译）
   */
  setLLMCaller(caller: LLMCaller, verbose?: boolean): void {
    this.llmCaller = caller;
    this.verbose = verbose ?? false;
  }

  /**
   * 判断对话是否可以编译为技能
   */
  canCompile(conv: ConversationSnapshot): boolean {
    // 必须有工具调用
    if (conv.toolCalls.length === 0) return false;
    // 工具调用必须全部成功
    if (!conv.wasSuccessful) return false;
    // 必须有用户消息
    if (!conv.userMessage || conv.userMessage.length < 3) return false;
    // 排除纯闲聊
    if (this.isPureChat(conv.userMessage)) return false;
    return true;
  }

  /**
   * 编译对话为技能函数
   */
  compile(conv: ConversationSnapshot): ExperienceUnit | null {
    if (!this.canCompile(conv)) return null;

    const intent = this.classifyIntent(conv.userMessage);
    const keywords = this.extractKeywords(conv.userMessage);
    const contextTags = this.inferContextTags(conv);
    const steps = this.extractSteps(conv.toolCalls);
    const patterns = this.buildPatterns(keywords, intent);

    if (steps.length === 0) return null;

    const id = `exp_${randomUUID().slice(0, 8)}`;
    const name = this.generateName(intent, keywords);
    const description = this.generateDescription(conv.userMessage, steps);
    const replyTemplate = this.buildReplyTemplate(conv.assistantReply);
    const dagPattern = this.extractDAGPattern(conv) ?? undefined;

    return {
      id,
      name,
      description,
      abstractionLevel: this.determineAbstractionLevel(steps, conv),
      trigger: {
        intent,
        keywords,
        contextTags,
        patterns,
      },
      steps,
      replyTemplate,
      dagPattern,
      stats: {
        successCount: 1,
        failCount: 0,
        confidence: 0.6, // 初始置信度
        avgExecutionMs: 0,
        lastUsed: 0,
        createdAt: Date.now(),
        extractedFrom: [conv.id],
        consolidatedAt: 0,
        evolved: false,
      },
    };
  }

  /**
   * 批量编译
   */
  compileMany(convs: ConversationSnapshot[]): ExperienceUnit[] {
    const units: ExperienceUnit[] = [];
    for (const conv of convs) {
      const unit = this.compile(conv);
      if (unit) units.push(unit);
    }
    return units;
  }

  // ── 私有方法 ──

  private classifyIntent(input: string): string {
    const inputLower = input.toLowerCase();
    let bestIntent = 'unknown';
    let bestScore = 0;

    for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
      let score = 0;
      for (const kw of keywords) {
        if (inputLower.includes(kw.toLowerCase())) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent;
      }
    }
    return bestIntent;
  }

  private extractKeywords(input: string): string[] {
    // 提取有意义的词：中文词组 + 英文单词 + 文件名
    const keywords = new Set<string>();

    // 英文单词（过滤短词）
    const words = input.match(/[a-zA-Z_]{3,}/g) ?? [];
    words.forEach(w => keywords.add(w.toLowerCase()));

    // 文件路径
    const files = input.match(/[\w/.-]+\.\w{1,5}/g) ?? [];
    files.forEach(f => keywords.add(f));

    // 中文关键词（2-6字的连续中文）
    const cn = input.match(/[\u4e00-\u9fa5]{2,6}/g) ?? [];
    cn.forEach(c => keywords.add(c));

    // 过滤停用词
    const stopwords = ['帮我', '一下', '这个', '那个', '什么', '怎么', '可以', '请'];
    stopwords.forEach(s => keywords.delete(s));

    return Array.from(keywords).slice(0, 10);
  }

  private inferContextTags(conv: ConversationSnapshot): string[] {
    const tags: string[] = [];
    const allText = conv.userMessage + ' ' + conv.assistantReply;

    if (/\.tsx|\.jsx|react|vue|angular/i.test(allText)) tags.push('前端');
    if (/\.py|python|pip|django|flask/i.test(allText)) tags.push('Python');
    if (/\.go|golang/i.test(allText)) tags.push('Go');
    if (/docker|k8s|kubernetes|容器/i.test(allText)) tags.push('容器化');
    if (/package\.json|npm|yarn|pnpm|node/i.test(allText)) tags.push('Node.js');
    if (/git|commit|branch|merge/i.test(allText)) tags.push('Git');
    if (/test|jest|vitest|mocha/i.test(allText)) tags.push('测试');
    if (/deploy|部署|上线|发布/i.test(allText)) tags.push('部署');
    if (/error|报错|bug|fail/i.test(allText)) tags.push('错误');

    return tags;
  }

  private extractSteps(toolCalls: ConversationSnapshot['toolCalls']): ExperienceStep[] {
    return toolCalls.map((tc, i) => {
      const step: ExperienceStep = {
        tool: tc.name,
        args: { ...tc.args },
        description: `${tc.name}(${JSON.stringify(tc.args)})`,
      };
      // 如果结果可以作为后续步骤的条件
      if (i < toolCalls.length - 1 && tc.result.length < 500) {
        step.outputVar = `step_${i}_output`;
      }
      return step;
    });
  }

  private buildPatterns(keywords: string[], intent: string): string[] {
    const patterns: string[] = [];
    // 为关键词构建简单的正则
    for (const kw of keywords) {
      if (/[\u4e00-\u9fa5]/.test(kw)) {
        patterns.push(kw); // 中文直接匹配
      } else if (/^[a-zA-Z_]+$/.test(kw)) {
        patterns.push(`\\b${kw}\\b`); // 英文词边界匹配
      }
    }
    return patterns.slice(0, 5);
  }

  private generateName(intent: string, keywords: string[]): string {
    const kw = keywords.slice(0, 2).join('_').replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '');
    return `${intent}_${kw || 'auto'}`;
  }

  private generateDescription(userMessage: string, steps: ExperienceStep[]): string {
    const tools = [...new Set(steps.map(s => s.tool))];
    return `从 "${userMessage.slice(0, 40)}" 编译，执行 ${tools.join(' → ')}`;
  }

  private buildReplyTemplate(assistantReply: string): ReplyTemplate {
    const short = assistantReply.slice(0, 100);
    return {
      sharp: short || '搞定了。',
      warm: short || '做好了～',
      chaotic: (short || '搞定！') + ' 💥',
      default: short || '已完成。',
    };
  }

  /**
   * Phase 6: 用 LLM 增强经验单元 — 提取推理逻辑
   * 
   * 在基础编译完成后，调用 LLM 理解"为什么这么做"，
   * 而不只是记录工具序列。
   */
  async enhanceWithReasoning(unit: ExperienceUnit, conv: ConversationSnapshot): Promise<ExperienceUnit> {
    if (!this.llmCaller) return unit;

    try {
      const prompt = `分析以下成功完成任务的对话，总结为什么这些步骤能解决问题。
用一句话说明核心推理逻辑（不超过 100 字）。

用户请求: "${conv.userMessage}"
执行步骤: ${unit.steps.map((s, i) => `${i + 1}. ${s.tool}(${JSON.stringify(s.args)})`).join('\n')}
回复: "${conv.assistantReply.slice(0, 200)}"

只输出推理逻辑，不要其他内容。`;

      const reasoning = await this.llmCaller([
        { role: 'system', content: '你是一个经验分析器，从成功对话中提取核心推理逻辑。' },
        { role: 'user', content: prompt },
      ]);

      if (reasoning && reasoning.length > 5 && reasoning.length < 500) {
        return { ...unit, reasoning: reasoning.trim() };
      }
    } catch {
      // LLM 增强失败，返回原始单元
    }

    return unit;
  }

  /**
   * 判断经验的抽象层级
   *
   * - concrete（具体）：1-2 步的简单任务，直接执行
   * - workflow（工作流）：3+ 步的有序执行序列
   * - strategy（策略）：包含条件分支/多路径/上下文判断的高层模式
   *
   * strategy 层需要 LLM 推理逻辑增强（reasoning）才生效，
   * 或者检测到多组工具交替使用时自动升级。
   */
  private determineAbstractionLevel(
    steps: ExperienceStep[],
    conv: ConversationSnapshot,
  ): 'concrete' | 'workflow' | 'strategy' {
    // 1-2 步 → concrete
    if (steps.length <= 2) return 'concrete';

    // 检测策略特征
    const toolSequence = steps.map(s => s.tool);
    const uniqueTools = new Set(toolSequence);

    // 4+ 步 且 使用 3+ 种不同工具 → strategy
    if (steps.length >= 4 && uniqueTools.size >= 3) {
      return 'strategy';
    }

    // 检测条件分支：步骤间有 outputVar → inputVar 引用
    const hasOutputVars = steps.some(s => s.outputVar);
    const laterStepsReferenceOutput = steps.slice(1).some((s, i) => {
      const prevOutputVars = steps.slice(0, i + 1).map(p => p.outputVar).filter(Boolean);
      return prevOutputVars.some(v =>
        JSON.stringify(s.args).includes(v!) || (s.condition?.includes(v!) ?? false)
      );
    });

    if (hasOutputVars && laterStepsReferenceOutput) {
      return 'strategy';
    }

    // 3+ 步 → workflow
    return 'workflow';
  }

  private isPureChat(input: string): boolean {
    const chatPatterns = [
      /^(hi|hello|你好|嗨|嘿|在吗|在不在)/i,
      /^(谢谢|感谢|thanks|thank)/i,
      /^(好的|ok|行|嗯|对|是的|不是)/i,
      /^(再见|拜拜|bye|晚安)/i,
      /^.{0,3}$/,
    ];
    return chatPatterns.some(p => p.test(input.trim()));
  }

  // ── DAG 模式提取（从 dag-compiler.ts 合并） ──

  /**
   * 从对话中提取 DAG 模式 — 检测并行机会、重试模式、条件分支
   *
   * 编译时调用，将结果存入 ExperienceUnit.dagPattern
   * 后续执行时可直接走 DAG 路径，跳过 LLM 规划
   */
  extractDAGPattern(conv: ConversationSnapshot): DAGPattern | null {
    if (conv.toolCalls.length < 2) return null;

    const parallelCandidates = this.detectParallelism(conv.toolCalls);
    const retryPatterns = this.detectRetryPatterns(conv.toolCalls);

    // 无并行且无重试 → 线性序列，不需要 DAG
    if (parallelCandidates.length === 0 && retryPatterns.length === 0) return null;

    const tasks = conv.toolCalls.map((tc, i) => ({
      id: `t${i + 1}`,
      name: tc.name,
      tool: tc.name,
      args: { ...tc.args },
      deps: [] as string[],
      retry: retryPatterns.some(p => p.tool === tc.name && p.indices.length >= 2)
        ? { max: 2, delayMs: 1000, backoff: 'exponential' as const }
        : undefined,
    }));

    // 设置依赖：非并行步骤依赖前一步
    for (let i = 1; i < tasks.length; i++) {
      const isParallel = parallelCandidates.some(
        ([a, b]) => (a === i - 1 && b === i) || (a === i && b === i - 1),
      );
      if (!isParallel) {
        tasks[i].deps = [tasks[i - 1].id];
      }
    }

    // 提取并行组
    const parallelGroups: string[][] = [];
    if (parallelCandidates.length > 0) {
      const group = new Set<string>();
      for (const [a, b] of parallelCandidates) {
        group.add(tasks[a].id);
        group.add(tasks[b].id);
      }
      parallelGroups.push(Array.from(group));
    }

    return { tasks, parallelGroups };
  }

  /**
   * LLM 深度 DAG 分析 — 超越静态文件依赖检测
   *
   * 当静态分析检测到并行/重试候选时，调用 LLM 判断：
   * 1. 是否有更优的并行分组（语义级，不只是文件级）
   * 2. 是否存在条件分支（if/else 路径）
   * 3. 是否有隐式依赖（静态分析遗漏的）
   *
   * 失败时降级到静态分析结果。
   */
  async enhanceDAGWithLLM(
    conv: ConversationSnapshot,
    staticDAG: DAGPattern,
  ): Promise<DAGPattern> {
    if (!this.llmCaller) return staticDAG;

    try {
      const toolSummary = conv.toolCalls.map((tc, i) =>
        `${i + 1}. ${tc.name}(${JSON.stringify(tc.args).slice(0, 100)})${tc.result ? ` → ${tc.result.slice(0, 80)}` : ''}`,
      ).join('\n');

      const prompt = `分析以下工具调用序列，判断是否存在 DAG（有向无环图）模式。

工具调用序列:
${toolSummary}

当前静态分析结果:
- 并行组: ${JSON.stringify(staticDAG.parallelGroups ?? [])}
- 重试任务: ${staticDAG.tasks.filter(t => t.retry).map(t => t.id).join(', ') || '无'}

请判断:
1. 是否有更优的并行分组？（语义上独立的任务可以并行）
2. 是否存在条件分支？（某个工具的结果决定后续路径）
3. 是否有静态分析遗漏的依赖？

以 JSON 格式输出:
{
  "parallelGroups": [["t1", "t2"], ...],  // 优化后的并行组
  "edges": [{"from": "t1", "to": "t3", "condition": "..."}],  // 条件边
  "reasoning": "简要说明"
}

如果静态分析已经最优，输出 {"parallelGroups": ${JSON.stringify(staticDAG.parallelGroups ?? [])}, "edges": [], "reasoning": "静态分析已最优"}`;

      const result = await this.llmCaller([
        { role: 'system', content: '你是一个 DAG 分析器，从工具调用序列中发现并行和条件分支模式。只输出 JSON，不要其他内容。' },
        { role: 'user', content: prompt },
      ]);

      if (!result) return staticDAG;

      // 解析 LLM 输出
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return staticDAG;

      const parsed = JSON.parse(jsonMatch[0]) as {
        parallelGroups?: string[][];
        edges?: Array<{ from: string; to: string; condition?: string }>;
        reasoning?: string;
      };

      // 合并 LLM 结果到静态 DAG
      const enhanced: DAGPattern = {
        ...staticDAG,
        parallelGroups: parsed.parallelGroups?.length
          ? parsed.parallelGroups
          : staticDAG.parallelGroups,
        edges: parsed.edges?.length
          ? parsed.edges
          : staticDAG.edges,
      };

      if (this.verbose && parsed.reasoning) {
        console.log(`  [DAG-LLM] ${parsed.reasoning}`);
      }

      return enhanced;
    } catch {
      // LLM 失败，降级到静态分析
      return staticDAG;
    }
  }

  /**
   * 检测并行机会 — 工具调用之间无输出→输入依赖
   */
  private detectParallelism(toolCalls: ConversationSnapshot['toolCalls']): Array<[number, number]> {
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < toolCalls.length; i++) {
      for (let j = i + 1; j < toolCalls.length; j++) {
        const argsStr = JSON.stringify(toolCalls[j].args);
        const iArgs = JSON.stringify(toolCalls[i].args);

        // 如果两个调用涉及不同文件/不同资源，可能可以并行
        const iFiles: string[] = iArgs.match(/[\w/.-]+\.\w+/g) || [];
        const jFiles: string[] = argsStr.match(/[\w/.-]+\.\w+/g) || [];
        const sharedFiles = iFiles.filter((f: string) => jFiles.includes(f));

        if (sharedFiles.length === 0 && !argsStr.includes(toolCalls[i].result?.slice(0, 50) || '___')) {
          pairs.push([i, j]);
        }
      }
    }
    return pairs;
  }

  /**
   * 检测重试模式 — 同一工具被多次调用
   */
  private detectRetryPatterns(toolCalls: ConversationSnapshot['toolCalls']): Array<{ tool: string; indices: number[] }> {
    const toolIndices = new Map<string, number[]>();
    for (let i = 0; i < toolCalls.length; i++) {
      const name = toolCalls[i].name;
      if (!toolIndices.has(name)) toolIndices.set(name, []);
      toolIndices.get(name)!.push(i);
    }

    const patterns: Array<{ tool: string; indices: number[] }> = [];
    for (const [tool, indices] of toolIndices) {
      if (indices.length >= 2) {
        patterns.push({ tool, indices });
      }
    }
    return patterns;
  }
}
