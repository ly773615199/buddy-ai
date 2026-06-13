/**
 * DAG 规划器 — 将用户意图转化为可执行的 DAG
 *
 * 核心流程：
 * 1. 语义检索可用工具
 * 2. 调用 LLM 生成任务计划
 * 3. 解析为 TaskDAG
 *
 * Phase 4: 支持领域知识包注入（ExperienceScheduler）
 */

import type { TaskDAG, Task, PlanOutput, ConditionEdge, RetryConfig, DAGSkeleton, SkeletonStep } from './types.js';
import { createDAG, createTask, addTask, addEdge } from './dag.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolRetriever } from '../tools/tool-retriever.js';
import type { ExperienceScheduler } from '../skills/scheduler.js';

/** LLM 调用接口 */
export type LLMCaller = (messages: Array<{ role: string; content: string }>) => Promise<string>;

export interface PlannerConfig {
  /** 最大工具数注入 prompt */
  maxToolsForPrompt: number;
  /** 最大任务数 */
  maxTasks: number;
  /** 默认重试 */
  defaultRetry?: RetryConfig;
  /** 全局超时 */
  defaultTimeoutMs: number;
}

const DEFAULT_CONFIG: PlannerConfig = {
  maxToolsForPrompt: 12,
  maxTasks: 10,
  defaultRetry: { max: 2, delayMs: 1000, backoff: 'exponential' },
  defaultTimeoutMs: 30000,
};

export class DAGPlanner {
  private llm: LLMCaller;
  private registry: ToolRegistry;
  private retriever: ToolRetriever | null;
  private config: PlannerConfig;
  /** Phase 4: 领域知识包调度器 */
  private scheduler: ExperienceScheduler | null = null;

  constructor(
    llm: LLMCaller,
    registry: ToolRegistry,
    retriever: ToolRetriever | null,
    config?: Partial<PlannerConfig>,
  ) {
    this.llm = llm;
    this.registry = registry;
    this.retriever = retriever;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Phase 4: 注入领域知识包调度器 */
  setScheduler(scheduler: ExperienceScheduler): void {
    this.scheduler = scheduler;
  }

  /**
   * 将用户意图规划为 DAG
   *
   * Phase 4: 注入领域知识包（ExperienceScheduler）到 planner prompt
   */
  async plan(
    userIntent: string,
    contextTags: string[] = [],
  ): Promise<TaskDAG> {
    // 1. 选择相关工具
    const relevantTools = this.selectTools(userIntent, contextTags);

    // 2. Phase 4: 获取领域知识注入
    let domainKnowledge = '';
    if (this.scheduler && contextTags.length > 0) {
      const domainMatches = contextTags.map(tag => ({
        domain: tag,
        confidence: 0.7,
        keywords: [tag],
      }));
      const scheduling = this.scheduler.schedule(domainMatches, userIntent);
      if (scheduling.hasPackage) {
        domainKnowledge = scheduling.promptInjection;
      }
    }

    // 3. 构建 prompt
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(userIntent, relevantTools, domainKnowledge);

    // 4. 调用 LLM
    const rawResponse = await this.llm([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);

    // 5. 解析为 PlanOutput
    const planOutput = this.parsePlanOutput(rawResponse);

    // 6. 转换为 TaskDAG
    return this.planToDAG(userIntent, planOutput);
  }

  // ==================== Phase 2: 骨架规划（编排/执行分离） ====================

  /**
   * planSkeleton — 只规划步骤拓扑，不管工具细节
   *
   * 与 plan() 的区别：
   * - plan(): LLM 同时选工具+填参数 → PlanOutput → TaskDAG
   * - planSkeleton(): LLM 只拆步骤+描述意图 → DAGSkeleton → 交给 SkillResolver
   *
   * Phase 2: 编排-执行分离的核心入口
   */
  async planSkeleton(
    userIntent: string,
    contextTags: string[] = [],
  ): Promise<DAGSkeleton> {
    // 1. Phase 4: 获取领域知识注入
    let domainKnowledge = '';
    if (this.scheduler && contextTags.length > 0) {
      const domainMatches = contextTags.map(tag => ({
        domain: tag,
        confidence: 0.7,
        keywords: [tag],
      }));
      const scheduling = this.scheduler.schedule(domainMatches, userIntent);
      if (scheduling.hasPackage) {
        domainKnowledge = scheduling.promptInjection;
      }
    }

    // 2. 构建骨架规划 prompt
    const systemPrompt = this.buildSkeletonSystemPrompt();
    const userPrompt = this.buildSkeletonUserPrompt(userIntent, contextTags, domainKnowledge);

    // 3. 调用 LLM
    const rawResponse = await this.llm([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);

    // 4. 解析为 DAGSkeleton
    return this.parseSkeletonOutput(rawResponse, userIntent, contextTags);
  }

  /** 骨架规划 system prompt — 只拆步骤，不选工具 */
  private buildSkeletonSystemPrompt(): string {
    return `你是一个任务步骤规划器。用户会给你一个任务描述，你需要将其分解为执行步骤。

**你的职责**：
- 拆解步骤，定义依赖关系
- 标注每个步骤的意图（intent）和建议工具类别（suggestedCategory）
- 不要指定具体工具名和参数（那是执行层的事）

**输出格式（严格 JSON）**：
\`\`\`json
{
  "steps": [
    {
      "id": "s1",
      "name": "人类可读的步骤名",
      "intent": "这一步要达成什么",
      "suggestedCategory": "code_analysis",
      "deps": [],
      "retry": {"max": 2, "delayMs": 1000},
      "timeoutMs": 15000
    }
  ],
  "edges": [
    {"from": "s1", "to": "s3", "condition": "success"}
  ],
  "parallelGroups": [["s2", "s3"]]
}
\`\`\`

**步骤数上限（严格遵守）**：
- 简单任务（< 30字、无并行标记）→ 1 步即可，不要拆分
- 中等任务 → 最多 3 步
- 复杂任务 → 最多 5 步
- 如果任务可以用 1 次工具调用完成，就不要拆成多步

**suggestedCategory 可选值**（选择与步骤意图最匹配的类别）：
- code_analysis：代码分析、文件扫描、符号搜索
- file_ops：文件读写、目录操作
- web_search：网络搜索、URL 抓取
- git：Git 操作、版本控制
- voice：语音合成、TTS
- chat：对话、消息处理
- system：系统命令、环境检测

**规则**：
1. 每个步骤的 intent 必须清晰、可执行
2. deps 引用其他步骤的 id，空数组 [] 表示无依赖
3. 同时无依赖的步骤可自动并行
4. 不要编造步骤，每一步都必须对完成任务有直接贡献
5. suggestedCategory 用于约束后续工具选择，必须准确`;
  }

  /** 骨架规划 user prompt */
  private buildSkeletonUserPrompt(
    intent: string,
    contextTags: string[],
    domainKnowledge: string = '',
  ): string {
    let prompt = `## 用户意图
${intent}`;

    if (contextTags.length > 0) {
      prompt += `\n\n## 检测到的领域
${contextTags.join(', ')}`;
    }

    if (domainKnowledge) {
      prompt += `\n\n## 领域知识${domainKnowledge}`;
    }

    prompt += `\n\n请规划执行步骤，输出严格 JSON（不要 markdown 代码块包裹）。`;
    return prompt;
  }

  /** 解析 LLM 输出为 DAGSkeleton */
  private parseSkeletonOutput(
    raw: string,
    userIntent: string,
    contextTags: string[],
  ): DAGSkeleton {
    let jsonStr = raw.trim();

    // 去掉 markdown 代码块
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    // 找到第一个 { 到最后一个 }
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }

    try {
      const parsed = JSON.parse(jsonStr);

      if (!Array.isArray(parsed.steps)) {
        throw new Error('steps 不是数组');
      }

      const steps: SkeletonStep[] = parsed.steps
        .slice(0, this.config.maxTasks)
        .map((s: any, i: number) => ({
          id: s.id || `s${i + 1}`,
          name: s.name || `步骤 ${i + 1}`,
          intent: s.intent || s.name || `执行步骤 ${i + 1}`,
          deps: Array.isArray(s.deps) ? s.deps : [],
          suggestedCategory: s.suggestedCategory ?? undefined,
          retry: s.retry ?? this.config.defaultRetry,
          timeoutMs: s.timeoutMs ?? this.config.defaultTimeoutMs,
        }));

      const edges: ConditionEdge[] = Array.isArray(parsed.edges)
        ? parsed.edges.map((e: any) => ({
            from: e.from,
            to: e.to,
            condition: e.condition || 'success',
            targetValue: e.targetValue,
          }))
        : [];

      const parallelGroups: string[][] = Array.isArray(parsed.parallelGroups)
        ? parsed.parallelGroups
        : [];

      // 推断复杂度
      const complexity: DAGSkeleton['complexity'] =
        steps.length <= 1 ? 'simple' : steps.length <= 3 ? 'medium' : 'complex';

      return {
        id: `skeleton-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        description: userIntent,
        steps,
        edges,
        parallelGroups,
        complexity,
        detectedDomains: contextTags,
      };
    } catch (err) {
      // 解析失败，降级为单步骨架
      return {
        id: `skeleton-fallback-${Date.now()}`,
        description: userIntent,
        steps: [{
          id: 's1',
          name: '执行任务',
          intent: userIntent.slice(0, 200),
          deps: [],
        }],
        edges: [],
        parallelGroups: [],
        complexity: 'simple',
        detectedDomains: contextTags,
      };
    }
  }

  /**
   * 选择相关工具
   */
  private selectTools(query: string, contextTags: string[]): Array<{ name: string; description: string; parameters: string }> {
    // 优先用语义检索
    if (this.retriever) {
      this.retriever.indexTools(this.registry.list());
      const scored = this.retriever.retrieve(query, contextTags);
      return scored
        .slice(0, this.config.maxToolsForPrompt)
        .map(s => {
          const tool = this.registry.get(s.name);
          if (!tool) return null;
          return {
            name: tool.name,
            description: tool.description,
            parameters: this.schemaToText(tool),
          };
        })
        .filter((t): t is { name: string; description: string; parameters: string } => t !== null);
    }

    // 降级：返回所有工具
    return this.registry.list()
      .slice(0, this.config.maxToolsForPrompt)
      .map(t => ({
        name: t.name,
        description: t.description,
        parameters: this.schemaToText(t),
      }));
  }

  private schemaToText(tool: { parameters: any }): string {
    try {
      // Zod schema → 简化文本
      if (tool.parameters && typeof tool.parameters === 'object') {
        const shape = (tool.parameters as any)._def?.shape?.();
        if (shape) {
          return Object.entries(shape)
            .map(([k, v]: [string, any]) => {
              const desc = v.description || v._def?.description || '';
              const type = v._def?.typeName?.replace('Zod', '').toLowerCase() || 'any';
              const required = !v.isOptional?.() ? '(必填)' : '(可选)';
              return `  ${k}: ${type} ${required} ${desc}`;
            })
            .join('\n');
        }
      }
    } catch { /* ignore */ }
    return '  (参数见工具描述)';
  }

  private buildSystemPrompt(): string {
    return `你是一个任务规划器。用户会给你一个任务描述和可用工具列表，你需要将其分解为可并行执行的任务 DAG。

**输出格式（严格 JSON）**：
\`\`\`json
{
  "tasks": [
    {
      "id": "t1",
      "name": "人类可读的任务名",
      "tool": "工具名",
      "args": {"参数名": "参数值"},
      "deps": ["t0"],
      "retry": {"max": 2, "delayMs": 1000, "backoff": "exponential"},
      "timeoutMs": 15000
    }
  ],
  "edges": [
    {"from": "t1", "to": "t3", "condition": "success"},
    {"from": "t1", "to": "t4", "condition": "failure"}
  ],
  "parallelGroups": [["t2", "t3"]]
}
\`\`\`

**步骤数上限（严格遵守）**：
- 简单任务（< 30字、无并行标记）→ 1 步即可，不要拆分
- 中等任务 → 最多 3 步
- 复杂任务 → 最多 5 步
- 如果任务可以用 1 次工具调用完成，就不要拆成多步

**领域围栏（suggestedCategory）**：
每个任务必须属于以下类别之一，选择与任务意图最匹配的类别：
- code_analysis：代码分析、文件扫描、符号搜索
- file_ops：文件读写、目录操作
- web_search：网络搜索、URL 抓取
- git：Git 操作、版本控制
- voice：语音合成、TTS
- chat：对话、消息处理
- system：系统命令、环境检测
不要将不同领域的工具混用在同一个任务中。

**规则**：
1. deps 为空数组 [] 表示无依赖，可立即执行
2. 同时无依赖的任务可自动并行
3. 如果某个步骤失败后有替代方案，用 edges 定义 failure 条件分支
4. 每个任务尽量简短明确，不要把多个操作塞进一个任务
5. 不要编造工具名，只用提供的工具
6. args 中的值直接写，不需要引用其他任务结果（那是执行时的事情）
7. 如果任务有自然的并行机会，用 parallelGroups 标注`;
  }

  private buildUserPrompt(
    intent: string,
    tools: Array<{ name: string; description: string; parameters: string }>,
    domainKnowledge: string = '',
  ): string {
    const toolList = tools
      .map(t => `### ${t.name}\n描述: ${t.description}\n参数:\n${t.parameters}`)
      .join('\n\n');

    let prompt = `## 用户意图
${intent}

## 可用工具
${toolList}`;

    // Phase 4: 注入领域知识
    if (domainKnowledge) {
      prompt += domainKnowledge;
    }

    prompt += `\n\n请规划任务 DAG，输出严格 JSON（不要 markdown 代码块包裹）。`;
    return prompt;
  }

  /**
   * 解析 LLM 输出为 PlanOutput
   */
  private parsePlanOutput(raw: string): PlanOutput {
    // 尝试提取 JSON
    let jsonStr = raw.trim();

    // 去掉 markdown 代码块
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    // 找到第一个 { 到最后一个 }
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }

    try {
      const parsed = JSON.parse(jsonStr);

      if (!Array.isArray(parsed.tasks)) {
        throw new Error('tasks 不是数组');
      }

      // 验证并标准化
      const tasks = parsed.tasks.slice(0, this.config.maxTasks).map((t: any, i: number) => ({
        id: t.id || `t${i + 1}`,
        name: t.name || `任务 ${i + 1}`,
        tool: t.tool || 'exec',
        args: t.args || {},
        deps: Array.isArray(t.deps) ? t.deps : [],
        retry: t.retry,
        timeoutMs: t.timeoutMs,
      }));

      const edges: ConditionEdge[] = Array.isArray(parsed.edges)
        ? parsed.edges.map((e: any) => ({
            from: e.from,
            to: e.to,
            condition: e.condition || 'success',
          }))
        : [];

      const parallelGroups: string[][] = Array.isArray(parsed.parallelGroups)
        ? parsed.parallelGroups
        : [];

      return { tasks, edges, parallelGroups };
    } catch (err) {
      // 解析失败，创建最简 plan
      return {
        tasks: [{
          id: 't1',
          name: '执行任务',
          tool: 'exec',
          args: { command: intent_fallback(raw) },
          deps: [],
        }],
      };
    }
  }

  /**
   * 将 PlanOutput 转为 TaskDAG
   */
  private planToDAG(description: string, plan: PlanOutput): TaskDAG {
    const dag = createDAG(description, {
      defaultTimeoutMs: this.config.defaultTimeoutMs,
      defaultRetry: this.config.defaultRetry,
    });

    // 创建任务
    const taskIdMap = new Map<string, string>(); // plan id → dag id
    for (const pt of plan.tasks) {
      const task = createTask(pt.name, pt.tool, pt.args, [], {
        retry: pt.retry,
        timeoutMs: pt.timeoutMs,
      });
      addTask(dag, task);
      taskIdMap.set(pt.id, task.id);
    }

    // 设置依赖（映射 plan id → dag id）
    for (const pt of plan.tasks) {
      const dagTaskId = taskIdMap.get(pt.id)!;
      const dagTask = dag.tasks.get(dagTaskId)!;
      for (const depId of pt.deps) {
        const mappedDep = taskIdMap.get(depId);
        if (mappedDep) {
          dagTask.deps.push(mappedDep);
        }
      }
    }

    // 添加条件边
    for (const edge of (plan.edges ?? [])) {
      const fromId = taskIdMap.get(edge.from);
      const toId = taskIdMap.get(edge.to);
      if (fromId && toId) {
        addEdge(dag, { from: fromId, to: toId, condition: edge.condition });
      }
    }

    // 并行组
    for (const group of (plan.parallelGroups ?? [])) {
      const mappedGroup = group
        .map(id => taskIdMap.get(id))
        .filter((id): id is string => !!id);
      if (mappedGroup.length > 1) {
        dag.parallelGroups.push(mappedGroup);
      }
    }

    return dag;
  }
}

/** 降级：当 LLM 输出无法解析时，把原始输入作为 exec 命令 */
function intent_fallback(raw: string): string {
  return raw.slice(0, 200).replace(/[`$]/g, '');
}
