/**
 * 计划执行器 — 根据 OrchestrationPlan 执行并返回结果
 *
 * 从 agent.ts 提取。
 * 职责：OrchestrationPlan → ExecutionResult（7 种执行模式 + 经验路由）
 */

import type { OrchestrationPlan, OrchestrationNode, ExecutionResult, Message } from '../types.js';
import type { TaskSignal } from './agent-types.js';
import type { Subsystems } from './subsystems.js';
import type { MessageProcessor } from './message-processor.js';
import type { WSHandler } from './ws-handler.js';
import type { BuddyConfig } from '../types.js';
import { logger } from '../audit/structured-logger.js';
import { CerebellumExecutionMonitor } from '../orchestrate/executor.js';
import { CapabilityScheduler, type SubTask, type CapabilityState } from './capability-scheduler.js';
import { LLMProfiler } from './llm-profiler.js';
import { GenerationCache } from './generation-cache.js';
import { MultiPathExecutor } from './multi-path-executor.js';

const log = logger.child('PlanExecutor');

// ==================== 能力状态构建 ====================

/** 从当前子系统状态构建能力状态 */
function buildCapabilityState(ctx: ExecutionContext): CapabilityState {
  const llmAvailable = ctx.sys.llm?.available ?? false;
  const llmProfile = ctx.llmProfiler?.getProfile();

  return {
    retrieval: {
      available: true, // 本地检索始终可用
      quality: 0.7,
      latency: 50,
    },
    reasoning: {
      available: llmAvailable,
      quality: llmProfile?.qualityScore ?? 0.5,
      latency: llmProfile?.avgLatency ?? 2000,
    },
    execution: {
      available: true, // 工具执行始终可用
      quality: 0.8,
      latency: 100,
    },
    knowledge: {
      available: true, // 知识库始终可用
      quality: 0.6,
      latency: 100,
    },
    expression: {
      available: llmAvailable,
      quality: llmProfile?.qualityScore ?? 0.5,
      latency: llmProfile?.avgLatency ?? 2000,
    },
  };
}

// ==================== 类型：执行上下文 ====================

export interface ExecutionContext {
  sys: Subsystems;
  processor: MessageProcessor;
  ws: WSHandler;
  config: BuddyConfig;
  verbose: boolean;
  /** Phase 4: 能力协同调度器 */
  scheduler?: CapabilityScheduler;
  /** Phase 4: LLM 能力探测器 */
  llmProfiler?: LLMProfiler;
  /** Phase 4: 生成缓存 */
  generationCache?: GenerationCache;
  /** Phase 4: 多路执行器 */
  multiPathExecutor?: MultiPathExecutor;
}

// ==================== 入口 ====================

/**
 * executeByPlan — 根据 orchestrate() 的决策执行
 *
 * 7 种模式：local_only / single / parallel / cascade / sequential / debate
 * Phase 1: 经验路由命中时优先走经验执行器
 */
export async function executeByPlan(
  ctx: ExecutionContext,
  plan: OrchestrationPlan,
): Promise<ExecutionResult> {
  // Phase 2: DAG 执行路径 — 有 resolvedDAG 时走 TaskExecutor
  if (plan.useDAG && plan.resolvedDAG) {
    return executeDAG(ctx, plan);
  }

  // Phase 1: 经验路由命中 → 优先执行经验
  const firstNode = plan.selectedNodes[0];
  if (firstNode?.type === 'experience' && firstNode.skillId) {
    const routePath = firstNode.routePath;
    if (routePath === 'exp_direct') {
      return executeExperience(ctx, firstNode.skillId, plan.content);
    }
    if (routePath === 'exp_verified') {
      return executeExperienceVerified(ctx, firstNode.skillId, plan.content);
    }
  }
  // llm_with_hint: 经验作为 hint 注入 LLM prompt
  if (firstNode?.routePath === 'llm_with_hint' && firstNode.skillId) {
    return executeWithHint(ctx, firstNode.skillId, plan.content);
  }

  // Phase 1: 统一模型池 — 如果节点携带具体模型信息，直接用 chatWithNode
  if (firstNode?.type === 'cloud_node' && firstNode.provider && firstNode.model) {
    return executeWithConcreteNode(ctx, firstNode, plan.content);
  }

  // Phase 4: 能力协同调度 — 评估最优执行策略
  if (ctx.scheduler && ctx.llmProfiler && ctx.generationCache) {
    const subtask: SubTask = {
      type: plan.mode === 'local_only' ? 'execution' : 'mixed',
      content: plan.content,
      domains: plan.domains ?? plan.selectedNodes.flatMap(n => n.domain ? [n.domain] : []),
      complexity: plan.selectedNodes.length > 2 ? 'complex' : plan.selectedNodes.length > 1 ? 'medium' : 'simple',
    };
    const capabilityState = buildCapabilityState(ctx);
    const allocation = ctx.scheduler.allocate(subtask, capabilityState, ctx.llmProfiler, ctx.generationCache);

    // 缓存命中 → 直接返回
    if (allocation.strategy === 'cache_only') {
      const cached = ctx.generationCache.get(subtask.type, subtask.content);
      if (cached) {
        if (ctx.verbose) console.log(`  [Scheduler] 缓存命中: quality=${cached.qualityScore.toFixed(2)}`);
        return { text: cached.output, source: 'cache', toolCalls: [] };
      }
    }

    // 记录调度决策（供后续学习）
    if (ctx.verbose) console.log(`  [Scheduler] ${allocation.reason}`);
  }

  switch (plan.mode) {
    case 'local_only':
      return executeLocal(ctx, plan);
    case 'single':
      return executeSingle(ctx, plan);
    case 'parallel':
      return executeParallel(ctx, plan);
    case 'cascade':
      return executeCascade(ctx, plan);
    case 'sequential':
      return executeSequential(ctx, plan);
    case 'debate':
      return executeDebate(ctx, plan);
    case 'deliberate':
      return executeSingle(ctx, plan);
    case 'clarify':
      return { text: plan.reason, source: 'deliberation', toolCalls: [] };
    case 'brainstorm':
      return { text: plan.reason, source: 'deliberation', toolCalls: [] };
    case 'direct':
      return executeDirect(ctx, plan);
    default:
      return executeSingle(ctx, plan);
  }
}

// ==================== Step 14: 直接执行 ====================

/**
 * 直接执行 — 跳过 LLM，直接调用工具
 * 用于规则引擎命中的确定性命令（git status, npm install 等）
 */
async function executeDirect(ctx: ExecutionContext, plan: OrchestrationPlan): Promise<ExecutionResult> {
  const directTool = plan.directTool;
  if (!directTool) {
    // fallback: 没有 directTool 时走 single
    return executeSingle(ctx, plan);
  }

  const startTime = Date.now();
  try {
    if (ctx.verbose) console.log(`  [Direct] 执行 ${directTool.name}: ${JSON.stringify(directTool.args).slice(0, 100)}`);
    const toolResult = await ctx.sys.tools.executeWithCache(directTool.name, directTool.args);
    const text = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
    const durationMs = Date.now() - startTime;

    if (ctx.verbose) console.log(`  [Direct] 完成 ${directTool.name} (${durationMs}ms)`);

    return {
      text,
      source: `direct/${directTool.name}`,
      toolCalls: [{ name: directTool.name, args: directTool.args, result: text }],
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    if (ctx.verbose) console.warn(`  [Direct] 失败 ${directTool.name} (${durationMs}ms): ${(err as Error).message}`);
    // 降级到 LLM
    return executeSingle(ctx, plan);
  }
}

// ==================== 经验路由执行 ====================

/** 经验直连执行 — 零 LLM，直接执行已学经验 */
export async function executeExperience(
  ctx: ExecutionContext,
  skillId: string,
  content: string,
): Promise<ExecutionResult> {
  const skill = ctx.sys.intelligence.graph.getNode(skillId);
  if (!skill) {
    return executeSingle(ctx, fallbackPlan(content));
  }

  const startTime = Date.now();
  try {
    const result = await ctx.sys.intelligence.executor.execute(skill);
    const durationMs = Date.now() - startTime;

    if (result.success) {
      ctx.sys.intelligence.evolver.onSuccess(skillId, durationMs);

      const text = result.reply || `经验 ${skill.name} 执行完成`;

      if (!verifyExperienceOutput(text, content)) {
        if (ctx.verbose) console.log(`  [Experience] sanity check 失败，降级到 LLM`);
        ctx.sys.intelligence.evolver.onFailure(skillId, 'sanity_check_failed');
        return executeSingle(ctx, fallbackPlan(content));
      }

      return {
        text,
        source: `exp/${skillId}`,
        toolCalls: Object.entries(result.outputs).map(([k, v]) => ({
          name: k, args: {}, result: v,
        })),
      };
    } else {
      ctx.sys.intelligence.evolver.onFailure(skillId, result.error ?? '执行失败');
      return executeSingle(ctx, fallbackPlan(content));
    }
  } catch (err) {
    ctx.sys.intelligence.evolver.onFailure(skillId, (err as Error).message);
    return executeSingle(ctx, fallbackPlan(content));
  }
}

/** 经验输出轻量验证 */
function verifyExperienceOutput(output: string, originalInput: string): boolean {
  if (!output || output.length < 10) return false;
  const errorSignals = ['错误', 'error', 'failed', '失败', '无法', 'cannot', 'exception'];
  const lower = output.toLowerCase();
  if (errorSignals.some(s => lower.includes(s)) && output.length < 50) return false;
  if (output.trim() === originalInput.trim()) return false;
  return true;
}

/** 经验执行 + LLM 质检 */
export async function executeExperienceVerified(
  ctx: ExecutionContext,
  skillId: string,
  content: string,
): Promise<ExecutionResult> {
  const expResult = await executeExperience(ctx, skillId, content);

  if (expResult.source !== `exp/${skillId}`) return expResult;

  try {
    const verifyMessages: Message[] = [
      { role: 'system', content: '你是质检员。检查以下执行结果是否正确回答了用户问题。如果正确，输出结果即可。如果不正确或不完整，补充修正。', timestamp: Date.now() },
      { role: 'user', content: `用户问题: ${content}\n\n执行结果:\n${expResult.text}\n\n请检查并输出最终回答：`, timestamp: Date.now() },
    ];
    const verifyResult = await ctx.sys.llm.chat(verifyMessages, [], 1, { taskType: 'chat' });
    if (verifyResult.text && verifyResult.text.length > 10) {
      return { text: verifyResult.text, source: `exp_verified/${skillId}`, toolCalls: expResult.toolCalls };
    }
  } catch { /* 质检失败，用原始结果 */ }
  return expResult;
}

/** LLM + 经验 hint */
export async function executeWithHint(
  ctx: ExecutionContext,
  skillId: string,
  content: string,
): Promise<ExecutionResult> {
  const skill = ctx.sys.intelligence.graph.getNode(skillId);
  if (!skill) {
    return executeSingle(ctx, fallbackPlan(content));
  }

  const hint = [
    `[经验参考: ${skill.name}]`,
    skill.reasoning ? `推理: ${skill.reasoning}` : null,
    `步骤: ${skill.steps.map(s => `${s.tool}(${JSON.stringify(s.args).slice(0, 50)})`).join(' → ')}`,
    `置信度: ${(skill.stats.confidence * 100).toFixed(0)}%`,
  ].filter(Boolean).join('\n');

  const result = await ctx.processor.processStream(content, () => {}, null, {
    skipDAG: true,
    systemHint: hint,
  });
  return { text: result.text, source: `llm_hint/${skillId}`, toolCalls: result.toolCalls ?? [] };
}

// ==================== 统一模型池执行 ====================

async function executeWithConcreteNode(
  ctx: ExecutionContext,
  node: OrchestrationNode,
  content: string,
): Promise<ExecutionResult> {
  const messages: Message[] = [
    { role: 'user', content, timestamp: Date.now() },
  ];

  try {
    const startTime = Date.now();
    const providerConfig = node.apiKey
      ? { apiKey: node.apiKey, baseUrl: node.baseUrl }
      : ctx.config.models?.providers?.find((p: any) => p.id === node.provider);
    const result = await ctx.sys.llm.chatWithNode(
      { provider: node.provider!, model: node.model!, apiKey: providerConfig?.apiKey, baseUrl: providerConfig?.baseUrl, capabilities: node.capabilities },
      messages,
      ctx.sys.tools.list(),
      5,
    );
    const elapsed = Date.now() - startTime;

    const selection = ctx.sys.llm.consumeLastUnifiedSelection();
    if (selection && ctx.ws.getEventBus()) {
      ctx.ws.getEventBus()!.emit({
        type: 'model_decision',
        modelId: selection.profile.id,
        displayName: selection.profile.displayName,
        tier: selection.profile.tier,
        reason: selection.reason,
        layer: selection.layer,
        candidateCount: selection.candidateCount,
        tsSample: selection.tsSample,
        taskType: 'chat',
        timestamp: Date.now(),
      });

      const pool = ctx.sys.router.getPool();
      if (pool) {
        pool.recordFeedback(
          selection.profile.id,
          'chat',
          true,
          elapsed,
          selection.profile.costPer1kInput * (result.text?.length ?? 0) / 1000,
        );
      }
    }

    return { text: result.text ?? '', source: `unified_pool/${node.provider}/${node.model}`, toolCalls: result.toolCalls ?? [] };
  } catch (err) {
    console.warn(`[PlanExecutor] 统一池执行失败，退回默认: ${(err as Error).message}`);
    log.warn('统一池执行失败，退回默认');
    return executeSingle(ctx, fallbackPlan(content));
  }
}

// ==================== 7 种执行模式 ====================

/** fallback 构造 */
export function fallbackPlan(content: string, reason = '经验降级'): OrchestrationPlan {
  return {
    content,
    mode: 'single',
    reason,
    domains: [],
    complexity: 'simple',
    selectedNodes: [{ id: 'fallback', type: 'cloud_node' }],
    useDAG: false,
    meta: {
      localCoverageRatio: 0,
      localConfidence: 0,
      budgetRemaining: 0,
      availableNodeCount: 0,
      userCorrectionCount: 0,
    },
  };
}

/** local_only — 本地专家直接回答 */
async function executeLocal(ctx: ExecutionContext, plan: OrchestrationPlan): Promise<ExecutionResult> {
  const node = plan.selectedNodes[0];
  if (node?.domain) {
    try {
      const result = await ctx.sys.ternaryRouter.query(node.domain, plan.content);
      if (result.answer && result.answer.length > 10) {
        return { text: result.answer, source: `local/${node.domain}`, toolCalls: [] };
      }
    } catch { /* fallback */ }
  }
  return executeSingle(ctx, plan);
}

/** single — 单 LLM 调用 */
async function executeSingle(ctx: ExecutionContext, plan: OrchestrationPlan): Promise<ExecutionResult> {
  const startTime = Date.now();
  const result = await ctx.processor.processStream(plan.content, () => {}, null, { skipDAG: true });
  const elapsed = Date.now() - startTime;

  const selection = ctx.sys.llm.consumeLastUnifiedSelection();
  if (selection && ctx.ws.getEventBus()) {
    ctx.ws.getEventBus()!.emit({
      type: 'model_decision',
      modelId: selection.profile.id,
      displayName: selection.profile.displayName,
      tier: selection.profile.tier,
      reason: selection.reason,
      layer: selection.layer,
      candidateCount: selection.candidateCount,
      tsSample: selection.tsSample,
      taskType: 'chat',
      timestamp: Date.now(),
    });

    const pool = ctx.sys.router.getPool();
    if (pool) {
      pool.recordFeedback(
        selection.profile.id,
        'chat',
        true,
        elapsed,
        selection.profile.costPer1kInput * (result.text?.length ?? 0) / 1000,
      );
    }
  }

  return { text: result.text, source: 'single', toolCalls: result.toolCalls ?? [] };
}

/** parallel — 多专家并行调用 + 融合 */
async function executeParallel(ctx: ExecutionContext, plan: OrchestrationPlan): Promise<ExecutionResult> {
  const nodes = plan.selectedNodes;

  const results = await Promise.allSettled(
    nodes.map(async (node) => {
      const start = Date.now();
      try {
        if (node.type === 'local_expert' && node.domain) {
          const r = await ctx.sys.ternaryRouter.query(node.domain, plan.content);
          return { nodeId: node.id, text: r.answer, success: true, latencyMs: Date.now() - start };
        }
        if (node.type === 'cloud_node' && node.provider && node.model) {
          const providerConfig = node.apiKey
            ? { apiKey: node.apiKey, baseUrl: node.baseUrl }
            : ctx.config.models?.providers?.find((p: any) => p.id === node.provider);
          const r = await ctx.sys.llm.chatWithNode(
            { provider: node.provider, model: node.model, apiKey: providerConfig?.apiKey, baseUrl: providerConfig?.baseUrl, capabilities: node.capabilities },
            [{ role: 'user', content: plan.content, timestamp: Date.now() }],
            [],
            1,
          );
          return { nodeId: node.id, text: r.text ?? '', success: true, latencyMs: Date.now() - start };
        }
        const r = await ctx.sys.llm.chat(
          [{ role: 'user', content: plan.content, timestamp: Date.now() }],
          [], 1, { taskType: 'chat', userOverride: node.model }
        );
        return { nodeId: node.id, text: r.text ?? '', success: true, latencyMs: Date.now() - start };
      } catch (err) {
        return { nodeId: node.id, text: '', success: false, latencyMs: Date.now() - start };
      }
    })
  );

  const expertResults = results
    .map(r => r.status === 'fulfilled' ? r.value : null)
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const fused = fuseResults(expertResults, plan.content);
  return { text: fused, source: 'parallel', toolCalls: [], expertResults };
}

/** cascade — 统一池按任务类型选择，质量不够升级 */
async function executeCascade(ctx: ExecutionContext, plan: OrchestrationPlan): Promise<ExecutionResult> {
  try {
    const chatResult = await ctx.sys.llm.chat(
      [{ role: 'user', content: plan.content, timestamp: Date.now() }],
      [], 1, { taskType: 'chat' }
    );
    const quality = evaluateQuality(chatResult.text ?? '', plan.content);
    if (quality >= 0.6) {
      return { text: chatResult.text ?? '', source: 'cascade/chat', toolCalls: [] };
    }
  } catch { /* 继续到 reasoning */ }

  const reasoningResult = await ctx.sys.llm.chat(
    [{ role: 'user', content: plan.content, timestamp: Date.now() }],
    [], 1, { taskType: 'reasoning' }
  );
  return { text: reasoningResult.text ?? '', source: 'cascade/reasoning', toolCalls: [] };
}

/** sequential — 接力传递上下文 */
async function executeSequential(ctx: ExecutionContext, plan: OrchestrationPlan): Promise<ExecutionResult> {
  let context = plan.content;
  const steps: string[] = [];

  for (const node of plan.selectedNodes) {
    try {
      if (node.type === 'local_expert' && node.domain) {
        const r = await ctx.sys.ternaryRouter.query(node.domain, context);
        steps.push(r.answer);
        context = r.answer;
      } else if (node.type === 'cloud_node' && node.provider && node.model) {
        const providerConfig = node.apiKey
          ? { apiKey: node.apiKey, baseUrl: node.baseUrl }
          : ctx.config.models?.providers?.find((p: any) => p.id === node.provider);
        const r = await ctx.sys.llm.chatWithNode(
          { provider: node.provider, model: node.model, apiKey: providerConfig?.apiKey, baseUrl: providerConfig?.baseUrl, capabilities: node.capabilities },
          [{ role: 'user', content: context, timestamp: Date.now() }],
          [],
          1,
        );
        steps.push(r.text ?? '');
        context = r.text ?? '';
      } else {
        const r = await ctx.sys.llm.chat(
          [{ role: 'user', content: context, timestamp: Date.now() }],
          [], 1, { taskType: 'chat', userOverride: node.model }
        );
        steps.push(r.text ?? '');
        context = r.text ?? '';
      }
    } catch { /* 跳过失败的节点 */ }
  }

  return { text: steps[steps.length - 1] ?? '', source: 'sequential', toolCalls: [] };
}

/** debate — 多方论证 + 裁决 */
async function executeDebate(ctx: ExecutionContext, plan: OrchestrationPlan): Promise<ExecutionResult> {
  const arguments_ = await Promise.allSettled(
    plan.selectedNodes.map(async (node) => {
      const start = Date.now();
      if (node.type === 'local_expert' && node.domain) {
        const r = await ctx.sys.ternaryRouter.query(node.domain, plan.content);
        return { nodeId: node.id, text: r.answer, success: true, latencyMs: Date.now() - start };
      }
      if (node.type === 'cloud_node' && node.provider && node.model) {
        const providerConfig = node.apiKey
          ? { apiKey: node.apiKey, baseUrl: node.baseUrl }
          : ctx.config.models?.providers?.find((p: any) => p.id === node.provider);
        const r = await ctx.sys.llm.chatWithNode(
          { provider: node.provider, model: node.model, apiKey: providerConfig?.apiKey, baseUrl: providerConfig?.baseUrl, capabilities: node.capabilities },
          [{ role: 'user', content: plan.content, timestamp: Date.now() }],
          [],
          1,
        );
        return { nodeId: node.id, text: r.text ?? '', success: true, latencyMs: Date.now() - start };
      }
      const r = await ctx.sys.llm.chat(
        [{ role: 'user', content: plan.content, timestamp: Date.now() }],
        [], 1, { taskType: 'chat', userOverride: node.model }
      );
      return { nodeId: node.id, text: r.text ?? '', success: true, latencyMs: Date.now() - start };
    })
  );

  const args = arguments_
    .map(r => r.status === 'fulfilled' ? r.value : null)
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (args.length === 0) {
    return { text: '所有专家均未返回有效结果。', source: 'debate', toolCalls: [] };
  }
  if (args.length === 1) {
    return { text: args[0].text, source: 'debate', toolCalls: [] };
  }

  const judgePrompt = [
    '你是裁决者。以下是多个专家对同一问题的回答，请综合判断，给出最终结论。',
    '',
    ...args.map((a, i) => `专家 ${i + 1} (${a.nodeId}):\n${a.text}`),
    '',
    '请给出你的最终结论：',
  ].join('\n');

  const judgeResult = await ctx.sys.llm.chat(
    [{ role: 'user', content: judgePrompt, timestamp: Date.now() }],
    [], 1, { taskType: 'reasoning' }
  );

  return { text: judgeResult.text ?? '', source: 'debate', toolCalls: [], expertResults: args };
}

// ==================== DAG 执行 ====================

/** DAG 执行 — 使用 TaskExecutor 执行完整的 DAG */
async function executeDAG(ctx: ExecutionContext, plan: OrchestrationPlan): Promise<ExecutionResult> {
  const dag = plan.resolvedDAG!;

  // Phase 3: 小脑执行监控 — 连续失败熔断 + 系统过载中止
  const monitor = ctx.sys.cerebellum
    ? new CerebellumExecutionMonitor(ctx.sys.cerebellum as any, ctx.verbose)
    : undefined;

  try {
    const result = await ctx.sys.taskExecutor.execute(
      dag,
      (event) => {
        // 推送编排事件到前端
        ctx.ws.getEventBus()?.emit(event as any);
      },
      4, // maxParallel
      monitor,
    );

    // 将 DAG 结果合并为文本
    const summary = result.summary || result.taskResults
      .filter(r => r.success)
      .map(r => r.result)
      .join('\n\n');

    return {
      text: summary,
      source: `dag/${dag.id}`,
      toolCalls: result.taskResults.map(r => ({
        name: r.name,
        args: {},
        result: r.result,
      })),
    };
  } catch (err) {
    // DAG 执行失败，降级到 single
    console.warn(`[PlanExecutor] DAG 执行失败，降级 single: ${(err as Error).message}`);
    return executeSingle(ctx, fallbackPlan(plan.content, `DAG 执行失败: ${(err as Error).message}`));
  }
}

// ==================== 融合与质量评估 ====================

/** 结果融合 — 拼接+去重 */
export function fuseResults(
  results: Array<{ nodeId?: string; text: string; success: boolean }>,
  _originalQuestion: string,
): string {
  const successful = results.filter(r => r.success && r.text.length > 0);
  if (successful.length === 0) return '所有专家均未返回有效结果。';
  if (successful.length === 1) return successful[0].text;

  const parts = successful.map((r, i) => `**[${r.nodeId ?? `专家 ${i + 1}`}]**\n${r.text}`);
  return parts.join('\n\n---\n\n');
}

/** 质量评估 — 多维度启发式评估 */
export function evaluateQuality(answer: string, question: string): number {
  let score = 0.5;

  if (answer.length < 20) score -= 0.3;
  else if (answer.length < 50) score -= 0.1;
  else if (answer.length > question.length * 0.5) score += 0.1;

  const questionWords = question.replace(/[^\w\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(w => w.length > 1);
  const matchedWords = questionWords.filter(w => answer.includes(w));
  const relevance = questionWords.length > 0 ? matchedWords.length / questionWords.length : 0;
  score += relevance * 0.2;

  const honestSignals = ['不确定', '不知道', '无法确认', '需要更多信息', '不确定', 'cannot confirm'];
  const hasHonesty = honestSignals.some(s => answer.includes(s));
  if (hasHonesty && answer.length > 100) score += 0.1;

  const errorSignals = ['错误', 'error', 'failed', '失败', 'exception', '无法'];
  const hasErrors = errorSignals.some(s => answer.toLowerCase().includes(s));
  if (hasErrors && answer.length < 50) score -= 0.2;

  if (/\d+[.、)）]/.test(answer) || /[•\-]/.test(answer)) score += 0.05;

  return Math.max(0, Math.min(1, score));
}
