/**
 * SkillResolver — 步骤 → 工具+参数 的解析器
 *
 * 职责：为 DAG 骨架的每个 step 匹配最佳工具 + 填充参数
 *
 * 解析优先级（从高到低）：
 * 1. 经验图谱：已验证的工具+参数组合（置信度 > 0.7）
 * 2. 能力包：领域知识中的工具推荐
 * 3. SkillManager：匹配 suggestedCategory 的可用工具
 * 4. 以上都没有 → LLM 生成（降级）
 *
 * Phase 2: 编排-执行分离的核心桥梁
 */

import type { DAGSkeleton, SkeletonStep, TaskDAG, Task, ResolvedTask, ResolveResult } from '../orchestrate/types.js';
import { createDAG, createTask, addTask, addEdge } from '../orchestrate/dag.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolRetriever } from '../tools/tool-retriever.js';
import type { ExperienceEngine } from '../intelligence/index.js';
import type { SkillManager } from './skill-manager.js';

/** LLM 调用接口 */
export type ResolverLLMCaller = (messages: Array<{ role: string; content: string }>) => Promise<string>;

/** SkillResolver 配置 */
export interface SkillResolverConfig {
  /** 经验匹配最低置信度 */
  minExpConfidence: number;
  /** 工具语义检索最低分数 */
  minToolScore: number;
  /** 默认超时 */
  defaultTimeoutMs: number;
}

const DEFAULT_CONFIG: SkillResolverConfig = {
  minExpConfidence: 0.7,
  minToolScore: 0.2,
  defaultTimeoutMs: 30000,
};

/** 工具类别 → 工具名映射（领域围栏） */
const CATEGORY_TOOLS: Record<string, string[]> = {
  code_analysis: ['analyze_file', 'find_references', 'project_symbols', 'project_context', 'project_deps', 'exec'],
  file_ops: ['read_file', 'write_file', 'list_files', 'search_files', 'scan_project', 'project_index_rebuild'],
  web_search: ['search_web', 'fetch_url', 'browser'],
  git: ['git_status', 'git_log', 'git_diff', 'exec'],
  voice: ['tts_speak'],
  chat: ['exec'],
  system: ['exec', 'detect_env', 'project_index_stats'],
};

/** 工具名 → 类别反向映射 */
const TOOL_TO_CATEGORY: Record<string, string> = {};
for (const [cat, tools] of Object.entries(CATEGORY_TOOLS)) {
  for (const t of tools) {
    if (!TOOL_TO_CATEGORY[t]) TOOL_TO_CATEGORY[t] = cat;
  }
}

export class SkillResolver {
  private config: SkillResolverConfig;
  private experience: ExperienceEngine | null;
  private toolRegistry: ToolRegistry;
  private toolRetriever: ToolRetriever | null;
  private skillManager: SkillManager | null;
  private llmCaller: ResolverLLMCaller | null;

  constructor(
    toolRegistry: ToolRegistry,
    options?: {
      experience?: ExperienceEngine;
      toolRetriever?: ToolRetriever;
      skillManager?: SkillManager;
      llmCaller?: ResolverLLMCaller;
      config?: Partial<SkillResolverConfig>;
    },
  ) {
    this.toolRegistry = toolRegistry;
    this.experience = options?.experience ?? null;
    this.toolRetriever = options?.toolRetriever ?? null;
    this.skillManager = options?.skillManager ?? null;
    this.llmCaller = options?.llmCaller ?? null;
    this.config = { ...DEFAULT_CONFIG, ...options?.config };
  }

  /**
   * 注入资源中心 — 供 matchExecutors 使用
   */
  private resourceHub: import('../brain/hub/unified-resource-hub.js').UnifiedResourceHub | null = null;

  setResourceHub(hub: import('../brain/hub/unified-resource-hub.js').UnifiedResourceHub): void {
    this.resourceHub = hub;
  }

  /**
   * 为 DAG 中每个任务匹配执行单元（模型）
   *
   * 逻辑：
   * 1. 有 capabilityRequirement → 用 UnifiedResourceHub.recommend() 匹配
   * 2. reusePreviousModel=true → 复用前序步骤的匹配结果
   * 3. 无需求 → 跳过（使用默认模型）
   *
   * @param dag 解析后的完整 DAG
   * @param skeleton 原始骨架（携带 capabilityRequirement）
   * @returns stepId → resourceId 的映射
   */
  matchExecutors(
    dag: import('../orchestrate/types.js').TaskDAG,
    skeleton: import('../orchestrate/types.js').DAGSkeleton,
  ): Map<string, import('../orchestrate/types.js').ExecutorMatch> {
    const matches = new Map<string, import('../orchestrate/types.js').ExecutorMatch>();
    if (!this.resourceHub) return matches;

    const stepMap = new Map(skeleton.steps.map(s => [s.id, s]));

    for (const task of dag.tasks.values()) {
      const step = stepMap.get(task.id);
      const req = step?.capabilityRequirement;
      if (!req) continue;

      // 检查是否复用前序模型
      if (req.reusePreviousModel && task.deps.length > 0) {
        const depMatch = matches.get(task.deps[0]);
        if (depMatch) {
          matches.set(task.id, {
            taskId: task.id,
            resourceId: depMatch.resourceId,
            resourceName: depMatch.resourceName,
            score: depMatch.score,
            source: 'reuse',
          });
          continue;
        }
      }

      // 通过 UnifiedResourceHub.recommend() 匹配
      const candidates = this.resourceHub.recommend(
        req.taskType,
        undefined,
        undefined,
        {
          requiresToolCalling: req.requiresToolCalling,
          requiresVision: req.requiresVision,
          maxCostPer1k: req.maxCostPer1k,
          latencyTolerance: req.latencyTolerance,
        },
      );

      if (candidates.length > 0) {
        const best = candidates[0];
        matches.set(task.id, {
          taskId: task.id,
          resourceId: best.id,
          resourceName: best.name,
          score: 0,
          source: 'capability',
        });
      }
    }

    return matches;
  }

  /**
   * 将 DAG 骨架解析为完整可执行的 TaskDAG
   */
  async resolve(
    skeleton: DAGSkeleton,
    originalIntent: string,
  ): Promise<ResolveResult> {
    const resolutionLog: ResolveResult['resolutionLog'] = [];
    const unresolvedSteps: string[] = [];
    const resolvedTasks = new Map<string, Task>();

    for (const step of skeleton.steps) {
      const resolved = await this.resolveStep(step, originalIntent, skeleton.detectedDomains);

      const task = createTask(step.name, resolved.tool, resolved.args, step.deps, {
        retry: step.retry,
        timeoutMs: step.timeoutMs ?? this.config.defaultTimeoutMs,
      });
      resolvedTasks.set(step.id, task);

      resolutionLog.push({
        stepId: step.id,
        stepName: step.name,
        resolvedTool: resolved.tool,
        source: resolved.source,
        confidence: resolved.confidence,
      });

      if (resolved.source === 'llm') {
        unresolvedSteps.push(step.id);
      }
    }

    // 构建 TaskDAG
    const dag = createDAG(skeleton.description, {
      defaultTimeoutMs: this.config.defaultTimeoutMs,
    });

    // 添加任务到 DAG
    for (const task of resolvedTasks.values()) {
      addTask(dag, task);
    }

    // 添加条件边
    for (const edge of skeleton.edges) {
      addEdge(dag, edge);
    }

    // 并行组
    for (const group of skeleton.parallelGroups) {
      dag.parallelGroups.push(group);
    }

    return { dag, resolutionLog, unresolvedSteps };
  }

  /**
   * 解析单个步骤
   */
  private async resolveStep(
    step: SkeletonStep,
    intent: string,
    domains: string[],
  ): Promise<ResolvedTask> {
    // ── 优先级 1: 经验图谱匹配 ──
    const expMatch = this.findExperienceMatch(step, domains);
    if (expMatch) return expMatch;

    // ── 优先级 2: 工具语义检索 ──
    const toolMatch = this.findToolMatch(step);
    if (toolMatch) return toolMatch;

    // ── 优先级 3: 类别映射兜底 ──
    const catMatch = this.findCategoryMatch(step);
    if (catMatch) return catMatch;

    // ── 优先级 4: LLM 降级生成 ──
    if (this.llmCaller) {
      return this.llmResolveStep(step, intent, domains);
    }

    // ── 兜底: exec 工具 ──
    return {
      tool: 'exec',
      args: { command: `echo "无法解析步骤: ${step.name}"` },
      source: 'builtin',
      confidence: 0.1,
    };
  }

  /**
   * 优先级 1: 从经验图谱中匹配已验证的工具+参数
   */
  private findExperienceMatch(
    step: SkeletonStep,
    domains: string[],
  ): ResolvedTask | null {
    if (!this.experience) return null;

    try {
      const graph = this.experience.getExperiences?.() ?? [];
      if (!Array.isArray(graph) || graph.length === 0) return null;

      const stepLower = `${step.name} ${step.intent}`.toLowerCase();

      // 在经验中找匹配的
      for (const exp of graph) {
        if (!exp.stats || exp.stats.confidence < this.config.minExpConfidence) continue;

        // 关键词匹配
        const triggerKw = exp.trigger?.keywords ?? [];
        const matched = triggerKw.some((kw: string) => stepLower.includes(kw.toLowerCase()));
        if (!matched) continue;

        // 找到匹配经验，取其步骤中的工具
        if (exp.steps && exp.steps.length > 0) {
          // 取第一个步骤的工具（简单策略）
          const firstStep = exp.steps[0];
          if (firstStep.tool) {
            // 类别围栏检查
            const stepCat = step.suggestedCategory;
            const toolCat = TOOL_TO_CATEGORY[firstStep.tool];
            if (stepCat && toolCat && stepCat !== toolCat) continue;

            return {
              tool: firstStep.tool,
              args: (firstStep.args as Record<string, unknown>) ?? {},
              source: 'experience',
              confidence: exp.stats.confidence,
            };
          }
        }
      }
    } catch {
      // 经验匹配失败，继续下一优先级
    }
    return null;
  }

  /**
   * 优先级 2: 工具语义检索
   */
  private findToolMatch(step: SkeletonStep): ResolvedTask | null {
    if (!this.toolRetriever) return null;

    try {
      const query = `${step.name} ${step.intent} ${step.suggestedCategory ?? ''}`;
      const scored = this.toolRetriever.retrieve(query, [step.suggestedCategory ?? '']);

      if (scored.length === 0 || scored[0].score < this.config.minToolScore) return null;

      const bestTool = scored[0];
      const tool = this.toolRegistry.get(bestTool.name);
      if (!tool) return null;

      // 类别围栏检查
      const stepCat = step.suggestedCategory;
      const toolCat = TOOL_TO_CATEGORY[bestTool.name];
      if (stepCat && toolCat && stepCat !== toolCat) return null;

      return {
        tool: bestTool.name,
        args: {},
        source: 'skill',
        confidence: bestTool.score,
      };
    } catch {
      return null;
    }
  }

  /**
   * 优先级 3: 类别映射兜底
   */
  private findCategoryMatch(step: SkeletonStep): ResolvedTask | null {
    const category = step.suggestedCategory;
    if (!category) return null;

    const tools = CATEGORY_TOOLS[category];
    if (!tools || tools.length === 0) return null;

    // 找第一个注册了的工具
    for (const toolName of tools) {
      const tool = this.toolRegistry.get(toolName);
      if (tool) {
        const args = this.inferDefaultArgs(toolName, step);
        return {
          tool: toolName,
          args,
          source: 'skill',
          confidence: 0.4,
        };
      }
    }
    return null;
  }

  /** 根据工具名和步骤意图推断默认参数 */
  private inferDefaultArgs(toolName: string, step: SkeletonStep): Record<string, unknown> {
    const intent = `${step.name} ${step.intent}`.toLowerCase();

    switch (toolName) {
      case 'read_file':
        return { path: this.inferFilePath(step, intent) };
      case 'list_files':
        return { path: '.' };
      case 'write_file':
        return { path: this.inferFilePath(step, intent), content: `// ${step.intent}` };
      case 'exec':
        return { command: `echo "TODO: ${step.name}"` };
      case 'search_files':
        return { pattern: step.intent.slice(0, 20), path: '.' };
      case 'scan_project':
        return { path: '.' };
      case 'fetch_url':
        return { url: intent.match(/https?:\/\/\S+/)?.[0] ?? '' };
      default:
        return {};
    }
  }

  /**
   * 优先级 4: LLM 降级 — 在约束下生成工具+参数
   */
  private async llmResolveStep(
    step: SkeletonStep,
    intent: string,
    domains: string[],
  ): Promise<ResolvedTask> {
    // 只提供该领域允许的工具子集
    const allowedTools = this.getAllowedTools(domains);
    const toolList = allowedTools
      .map(t => `- ${t.name}: ${t.description}`)
      .join('\n');

    // 构建参数 schema 说明，标注必填字段
    const paramDetails = allowedTools.map(t => {
      const toolDef = this.toolRegistry.get(t.name);
      if (!toolDef) return `${t.name}: (无参数信息)`;
      const fields = this.describeSchema(toolDef.parameters);
      return `${t.name}: ${fields}`;
    }).join('\n');

    const prompt = `你需要为以下执行步骤选择工具并填充参数。

步骤: ${step.name}
意图: ${step.intent}
建议类别: ${step.suggestedCategory ?? '无'}

可用工具（只能从这些中选）:
${toolList}

各工具参数说明:
${paramDetails}

**重要规则**:
- 必填参数必须提供，不能省略
- 对于 write_file，path 和 content 都是必填
- path 必须是有效的文件路径字符串
- 输出严格 JSON，不要省略任何必填参数

输出严格 JSON:
{"tool": "工具名", "args": {"参数名": "参数值"}}`;

    try {
      const raw = await this.llmCaller!([{ role: 'user', content: prompt }]);
      const cleaned = raw.trim().replace(/```json?\s*([\s\S]*?)```/, '$1').trim();
      const parsed = JSON.parse(cleaned);

      // 验证工具存在
      const toolDef = this.toolRegistry.get(parsed.tool);
      if (!toolDef) {
        return {
          tool: allowedTools[0]?.name ?? 'exec',
          args: {},
          source: 'llm',
          confidence: 0.2,
        };
      }

      // 校验必填参数，缺失时尝试从 intent 推断
      const args = parsed.args ?? {};
      const repaired = this.repairRequiredArgs(toolDef, args, step, intent);

      return {
        tool: parsed.tool,
        args: repaired,
        source: 'llm',
        confidence: 0.5,
      };
    } catch {
      return {
        tool: allowedTools[0]?.name ?? 'exec',
        args: {},
        source: 'llm',
        confidence: 0.2,
      };
    }
  }

  /**
   * 从 Zod schema 中提取参数描述（含必填标记）
   */
  private describeSchema(schema: unknown): string {
    try {
      const zodSchema = schema as { _def?: { shape?: () => Record<string, unknown> } };
      if (!zodSchema?._def?.shape) return '(未知)';
      const shape = zodSchema._def.shape();
      const fields: string[] = [];
      for (const [key, val] of Object.entries(shape)) {
        const field = val as { _def?: { typeName?: string; description?: string }; isOptional?: () => boolean };
        const typeName = field._def?.typeName ?? 'unknown';
        const desc = field._def?.description ?? '';
        const optional = field.isOptional?.() ?? false;
        fields.push(`${key}${optional ? '(可选)' : '(必填)'}: ${desc || typeName}`);
      }
      return fields.join(', ');
    } catch {
      return '(解析失败)';
    }
  }

  /**
   * 校验并补全必填参数
   */
  private repairRequiredArgs(
    toolDef: { name: string; parameters: unknown },
    args: Record<string, unknown>,
    step: SkeletonStep,
    intent: string,
  ): Record<string, unknown> {
    const repaired = { ...args };

    // Zod safeParse 校验
    try {
      const schema = toolDef.parameters as { safeParse?: (data: unknown) => { success: boolean } };
      if (schema?.safeParse) {
        const result = schema.safeParse(repaired);
        if (result.success) return repaired;
      }
    } catch { /* 继续修复 */ }

    // 对已知工具做参数推断
    if (toolDef.name === 'write_file') {
      if (!repaired.path || typeof repaired.path !== 'string') {
        // 从 intent/step.name 中推断文件名
        repaired.path = this.inferFilePath(step, intent);
      }
      if (!repaired.content || typeof repaired.content !== 'string') {
        repaired.content = `// ${step.intent}\n// TODO: 由 ${step.name} 生成`;
      }
    }

    if (toolDef.name === 'read_file' || toolDef.name === 'list_files') {
      if (!repaired.path || typeof repaired.path !== 'string') {
        repaired.path = '.';
      }
    }

    if (toolDef.name === 'exec') {
      if (!repaired.command || typeof repaired.command !== 'string') {
        repaired.command = `echo "未解析的步骤: ${step.name}"`;
      }
    }

    return repaired;
  }

  /**
   * 从步骤描述中推断文件路径
   */
  private inferFilePath(step: SkeletonStep, intent: string): string {
    const combined = `${step.name} ${intent}`.toLowerCase();

    // 尝试从描述中提取文件名
    const extPatterns = [
      { pattern: /\.html/i, defaultExt: '.html' },
      { pattern: /\.css/i, defaultExt: '.css' },
      { pattern: /\.js/i, defaultExt: '.js' },
      { pattern: /\.ts/i, defaultExt: '.ts' },
      { pattern: /\.json/i, defaultExt: '.json' },
      { pattern: /\.py/i, defaultExt: '.py' },
      { pattern: /\.md/i, defaultExt: '.md' },
    ];

    // 检查是否提到具体文件名
    const fileMatch = combined.match(/[\w.-]+\.\w{1,5}/);
    if (fileMatch) return fileMatch[0];

    // 根据扩展名模式推断
    for (const { pattern, defaultExt } of extPatterns) {
      if (pattern.test(combined)) {
        // 尝试提取有意义的文件名
        const nameMatch = combined.match(/(?:创建|生成|写入|编写)\s*[「"]?([\w-]+)/);
        const baseName = nameMatch?.[1] ?? 'output';
        return `${baseName}${defaultExt}`;
      }
    }

    // 默认
    return 'output.txt';
  }

  /** 获取领域允许的工具子集 */
  private getAllowedTools(domains: string[]): Array<{ name: string; description: string }> {
    const allowedNames = new Set<string>();
    for (const d of domains) {
      const tools = CATEGORY_TOOLS[d];
      if (tools) {
        for (const name of tools) allowedNames.add(name);
      }
    }
    // 总是允许基础工具
    for (const name of ['read_file', 'exec']) allowedNames.add(name);

    return this.toolRegistry.list()
      .filter(t => allowedNames.has(t.name))
      .map(t => ({ name: t.name, description: t.description }));
  }
}
