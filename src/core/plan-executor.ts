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

// ==================== 资源反馈辅助 ====================

/**
 * 将执行结果反馈到统一资源系统
 */
function recordResourceOutcome(
  sys: Subsystems,
  resourceId: string,
  success: boolean,
  latencyMs: number,
  cost?: number,
  taskType?: string,
  domain?: string,
): void {
  const rs = sys.resourceSystem;
  if (!rs) return;
  try {
    rs.hub.recordOutcome(resourceId, { success, latencyMs, cost, taskType, domain });
  } catch { /* 静默失败，不阻塞主流程 */ }
}

/**
 * P1-2: 从执行错误中更新能力画像
 * 根据错误类型推断模型能力，写入 UnifiedResourceHub
 */
function updateCapabilityFromError(
  sys: Subsystems,
  resourceId: string,
  error: Error,
  taskType: string,
): void {
  const rs = sys.resourceSystem;
  if (!rs) return;
  try {
    const msg = error.message;
    const hub = rs.hub;

    // 400 + tools → toolCalling 不支持
    if (msg.includes('400') && taskType === 'tools') {
      hub.updateCapability(resourceId, 'toolCalling', {
        value: false,
        verified: true,
        lastVerifiedAt: Date.now(),
        sourcePriority: 4, // runtime > static
      });
    }

    // 401/403 → 认证失败，标记不可达
    if (msg.includes('401') || msg.includes('403')) {
      hub.updateCapability(resourceId, 'reachable', {
        value: false,
        verified: true,
        lastVerifiedAt: Date.now(),
        sourcePriority: 4,
      });
    }

    // token limit → 触发漂移检测
    if (msg.includes('too long') || msg.includes('maximum context length') || msg.includes('token')) {
      hub.onProbeResult(resourceId, {
        timestamp: Date.now(),
        source: 'runtime',
        capabilities: {
          maxContextTokens: { value: 0, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 4 },
        },
        confidence: 0.8,
        latencyMs: 0,
        error: msg,
      });
    }
  } catch { /* 静默失败 */ }
}

/**
 * 从 OrchestrationNode 构造资源 ID
 */
function nodeId(node: OrchestrationNode): string | null {
  if (node.type === 'cloud_node' && node.provider && node.model) {
    return `model/${node.provider}/${node.model}`;
  }
  if (node.type === 'experience' && node.skillId) {
    return `skill/${node.skillId}`;
  }
  if (node.type === 'local_expert' && node.domain) {
    return `expert/${node.domain}`;
  }
  return null;
}
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
  // Step 11: 资源可行性检查 — 预算耗尽或无可用资源时降级
  const hub = ctx.sys.resourceHub;
  if (hub) {
    const health = hub.getHealthSummary();
    if (health.active === 0 && health.degraded === 0) {
      if (ctx.verbose) console.log(`  [PlanExecutor] 资源检查: 无可用资源，降级`);
      return { text: '⚠️ 当前无可用资源，请稍后重试', source: 'resource_check', toolCalls: [] };
    }
    // 检查预算
    if (plan.meta?.budgetRemaining !== undefined && plan.meta.budgetRemaining < 0) {
      if (ctx.verbose) console.log(`  [PlanExecutor] 资源检查: 预算耗尽，降级到本地`);
      // 降级到本地执行
      plan = { ...plan, mode: 'local_only', reason: `${plan.reason} → 预算耗尽降级` };
    }
  }

  // Phase 2: DAG 执行路径 — 有 resolvedDAG 时走 TaskExecutor
  if (plan.useDAG && plan.resolvedDAG) {
    return executeDAG(ctx, plan);
  }

  // Phase 1: 经验路由命中 → 优先执行经验
  const firstNode = plan.selectedNodes[0];
  if (firstNode?.type === 'experience' && firstNode.skillId) {
    // Step 11: 检查工具健康度
    if (hub) {
      const toolHealth = hub.getById(`tool/${firstNode.skillId}`);
      if (toolHealth && toolHealth.healthScore < 30) {
        if (ctx.verbose) console.log(`  [PlanExecutor] 工具 ${firstNode.skillId} 健康度过低 (${toolHealth.healthScore})，降级到 LLM`);
        return executeSingle(ctx, { ...plan, reason: `工具不健康降级: ${plan.reason}` });
      }
    }

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
    return executeWithHint(ctx, firstNode.skillId, plan.content, plan.taskType);
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

  // 新增: 包装执行，捕获结果回调状态机
  try {
    let result: ExecutionResult;

    switch (plan.mode) {
      case 'local_only':
        result = await executeLocal(ctx, plan);
        break;
      case 'single':
        result = await executeSingle(ctx, plan);
        break;
      case 'parallel':
        result = await executeParallel(ctx, plan);
        break;
      case 'cascade':
        result = await executeCascade(ctx, plan);
        break;
      case 'sequential':
        result = await executeSequential(ctx, plan);
        break;
      case 'debate':
        result = await executeDebate(ctx, plan);
        break;
      case 'deliberate':
        result = await executeSingle(ctx, plan);
        break;
      case 'clarify':
        result = { text: plan.reason, source: 'deliberation', toolCalls: [] };
        break;
      case 'brainstorm':
        result = { text: plan.reason, source: 'deliberation', toolCalls: [] };
        break;
      case 'direct':
        result = await executeDirect(ctx, plan);
        break;
      default:
        result = await executeSingle(ctx, plan);
    }

    // 新增: 执行成功回调状态机
    if (ctx.sys.conversationSM) {
      ctx.sys.conversationSM.onExecutionResult(true);
    }

    return result;
  } catch (err) {
    // 新增: 执行失败回调状态机
    if (ctx.sys.conversationSM) {
      ctx.sys.conversationSM.onExecutionResult(false, (err as Error).message);
    }
    throw err;
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
      // P1-1: 回写成功到资源画像
      recordResourceOutcome(ctx.sys, `skill/${skillId}`, true, durationMs);

      const text = result.reply || `经验 ${skill.name} 执行完成`;

      if (!verifyExperienceOutput(text, content)) {
        if (ctx.verbose) console.log(`  [Experience] sanity check 失败，降级到 LLM`);
        ctx.sys.intelligence.evolver.onFailure(skillId, 'sanity_check_failed');
        // P1-1: 回写 sanity check 失败
        recordResourceOutcome(ctx.sys, `skill/${skillId}`, false, durationMs);
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
      // P1-1: 回写经验执行失败
      recordResourceOutcome(ctx.sys, `skill/${skillId}`, false, durationMs);
      return executeSingle(ctx, fallbackPlan(content));
    }
  } catch (err) {
    const durationMs = Date.now() - startTime;
    ctx.sys.intelligence.evolver.onFailure(skillId, (err as Error).message);
    // P1-1: 回写经验执行异常
    recordResourceOutcome(ctx.sys, `skill/${skillId}`, false, durationMs);
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
  taskType?: string,
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
    taskType: taskType as any,
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

  const startTime = Date.now();
  try {
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
      // 反馈到统一资源系统
      recordResourceOutcome(ctx.sys, `model/${node.provider}/${node.model}`, true, elapsed, undefined, 'chat');
    }

    return { text: result.text ?? '', source: `unified_pool/${node.provider}/${node.model}`, toolCalls: result.toolCalls ?? [] };
  } catch (err) {
    // 反馈失败到统一资源系统
    recordResourceOutcome(ctx.sys, `model/${node.provider}/${node.model}`, false, Date.now() - startTime, undefined, 'chat');
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
      const start = Date.now();
      const result = await ctx.sys.ternaryRouter.query(node.domain, plan.content);
      const elapsed = Date.now() - start;
      if (result.answer && result.answer.length > 10) {
        recordResourceOutcome(ctx.sys, `expert/${node.domain}`, true, elapsed, undefined, 'chat', node.domain);
        return { text: result.answer, source: `local/${node.domain}`, toolCalls: [] };
      }
      recordResourceOutcome(ctx.sys, `expert/${node.domain}`, false, elapsed, undefined, 'chat', node.domain);
    } catch {
      recordResourceOutcome(ctx.sys, `expert/${node.domain}`, false, 0, undefined, 'chat', node.domain);
    }
  }
  return executeSingle(ctx, plan);
}

/** single — 单资源调用（按节点类型分发） */
async function executeSingle(ctx: ExecutionContext, plan: OrchestrationPlan): Promise<ExecutionResult> {
  const startTime = Date.now();
  const node = plan.selectedNodes[0];

  // ── 按节点类型分发（决策层从资源画像选出的具体资源） ──

  // local_expert → 本地三进制模型推理
  if (node?.type === 'local_expert' && node.domain) {
    try {
      const start = Date.now();
      const result = await ctx.sys.ternaryRouter.query(node.domain, plan.content);
      const elapsed = Date.now() - start;
      if (result.answer && result.answer.length > 10) {
        recordResourceOutcome(ctx.sys, node.id, true, elapsed, undefined, plan.taskType, node.domain);
        return { text: result.answer, source: `local/${node.domain}`, toolCalls: [] };
      }
      recordResourceOutcome(ctx.sys, node.id, false, elapsed, undefined, plan.taskType, node.domain);
    } catch (err) {
      recordResourceOutcome(ctx.sys, node.id, false, 0, undefined, plan.taskType, node.domain);
      if (ctx.verbose) {
        console.warn(`[PlanExecutor] 本地专家 ${node.domain} 推理失败: ${(err as Error).message}`);
      }
    }
    // 本地推理无结果 → 记录 outcome 更新画像，继续走 LLM
  }

  // cloud_node 且有具体模型 → 直接调用
  if (node?.type === 'cloud_node' && node.provider && node.model) {
    try {
      return await executeWithConcreteNode(ctx, node, plan.content);
    } catch (err) {
      if (ctx.verbose) {
        console.warn(`[PlanExecutor] 三脑选定的模型 ${node.provider}/${node.model} 执行失败: ${(err as Error).message}`);
      }
    }
  }

  // experience → 经验执行
  if (node?.type === 'experience' && node.skillId) {
    try {
      return await executeExperience(ctx, node.skillId, plan.content);
    } catch (err) {
      if (ctx.verbose) {
        console.warn(`[PlanExecutor] 经验 ${node.skillId} 执行失败: ${(err as Error).message}`);
      }
    }
  }

  // 默认：processStream
  try {
    const result = await ctx.processor.processStream(plan.content, () => {}, null, { skipDAG: true, taskType: plan.taskType });
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
      // 反馈到统一资源系统
      recordResourceOutcome(ctx.sys, `model/${selection.profile.id}`, true, elapsed, undefined, 'chat');
    }

    return { text: result.text, source: 'single', toolCalls: result.toolCalls ?? [] };
  } catch (err) {
    const elapsed = Date.now() - startTime;
    // 尝试从 consumeLastUnifiedSelection 获取模型 ID 用于回写
    const selection = ctx.sys.llm.consumeLastUnifiedSelection();
    const modelId = selection ? `model/${selection.profile.id}` : undefined;
    if (modelId) {
      recordResourceOutcome(ctx.sys, modelId, false, elapsed, undefined, 'chat');
    }
    // P1-2: 从执行错误中更新能力画像
    if (modelId) {
      updateCapabilityFromError(ctx.sys, modelId, err as Error, plan.taskType ?? 'chat');
    }
    throw err; // 向上抛出，由调用方处理 fallback
  }
}

/** parallel — 多专家并行调用 + 质量加权融合 */
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

  // 反馈每个专家/模型的执行结果到统一资源系统
  for (const er of expertResults) {
    const node = plan.selectedNodes.find(n => n.id === er.nodeId);
    if (node) {
      const rid = nodeId(node);
      if (rid) recordResourceOutcome(ctx.sys, rid, er.success, er.latencyMs);
    }
  }

  const fused = fuseResults(expertResults, plan.content);
  return { text: fused, source: 'parallel', toolCalls: [], expertResults };
}

/** cascade — 统一池按任务类型选择，质量不够升级（Phase 4.1: 质量感知） */
async function executeCascade(ctx: ExecutionContext, plan: OrchestrationPlan): Promise<ExecutionResult> {
  const criticality = plan.meta?.criticality ?? 'normal';
  const nnQuality = plan.meta?.nnQualityScore;

  // NN 预判质量很低 → 直接用最强模型，不浪费一轮弱模型
  if (nnQuality != null && nnQuality < 0.3) {
    const reasoningStart = Date.now();
    try {
      const reasoningResult = await ctx.sys.llm.chat(
        [{ role: 'user', content: plan.content, timestamp: Date.now() }],
        [], 1, { taskType: 'reasoning' }
      );
      const reasoningElapsed = Date.now() - reasoningStart;
      const reasoningSelection = ctx.sys.llm.consumeLastUnifiedSelection();
      if (reasoningSelection) {
        recordResourceOutcome(ctx.sys, `model/${reasoningSelection.profile.id}`, true, reasoningElapsed, undefined, 'reasoning');
      }
      return { text: reasoningResult.text ?? '', source: 'cascade/reasoning/nn-direct', toolCalls: [], cascadeQuality: 0.9 };
    } catch (err) {
      const reasoningElapsed = Date.now() - reasoningStart;
      const reasoningSelection = ctx.sys.llm.consumeLastUnifiedSelection();
      if (reasoningSelection) {
        recordResourceOutcome(ctx.sys, `model/${reasoningSelection.profile.id}`, false, reasoningElapsed, undefined, 'reasoning');
      }
      throw err;
    }
  }

  // 高关键性任务 → 直接用 reasoning 模型
  if (criticality === 'high') {
    const reasoningStart = Date.now();
    try {
      const reasoningResult = await ctx.sys.llm.chat(
        [{ role: 'user', content: plan.content, timestamp: Date.now() }],
        [], 1, { taskType: 'reasoning' }
      );
      const reasoningElapsed = Date.now() - reasoningStart;
      const reasoningSelection = ctx.sys.llm.consumeLastUnifiedSelection();
      if (reasoningSelection) {
        recordResourceOutcome(ctx.sys, `model/${reasoningSelection.profile.id}`, true, reasoningElapsed, undefined, 'reasoning');
      }
      return { text: reasoningResult.text ?? '', source: 'cascade/reasoning/critical', toolCalls: [], cascadeQuality: 0.9 };
    } catch (err) {
      const reasoningElapsed = Date.now() - reasoningStart;
      const reasoningSelection = ctx.sys.llm.consumeLastUnifiedSelection();
      if (reasoningSelection) {
        recordResourceOutcome(ctx.sys, `model/${reasoningSelection.profile.id}`, false, reasoningElapsed, undefined, 'reasoning');
      }
      throw err;
    }
  }

  // 标准 cascade：先 chat 后 reasoning
  const chatStart = Date.now();
  try {
    const chatResult = await ctx.sys.llm.chat(
      [{ role: 'user', content: plan.content, timestamp: Date.now() }],
      [], 1, { taskType: 'chat' }
    );
    const chatElapsed = Date.now() - chatStart;
    const quality = evaluateQuality(chatResult.text ?? '', plan.content);

    const chatSelection = ctx.sys.llm.consumeLastUnifiedSelection();
    if (chatSelection) {
      recordResourceOutcome(ctx.sys, `model/${chatSelection.profile.id}`, true, chatElapsed, undefined, 'chat');
    }

    if (quality >= 0.6) {
      return { text: chatResult.text ?? '', source: 'cascade/chat', toolCalls: [], cascadeQuality: quality };
    }
    if (quality >= 0.3) {
      const reasoningStart = Date.now();
      try {
        const reasoningResult = await ctx.sys.llm.chat(
          [{ role: 'user', content: plan.content, timestamp: Date.now() }],
          [], 1, { taskType: 'reasoning' }
        );
        const reasoningElapsed = Date.now() - reasoningStart;
        const reasonQuality = evaluateQuality(reasoningResult.text ?? '', plan.content);

        const reasoningSelection = ctx.sys.llm.consumeLastUnifiedSelection();
        if (reasoningSelection) {
          recordResourceOutcome(ctx.sys, `model/${reasoningSelection.profile.id}`, true, reasoningElapsed, undefined, 'reasoning');
        }

        if (reasonQuality > quality) {
          return { text: reasoningResult.text ?? '', source: 'cascade/reasoning', toolCalls: [], cascadeQuality: reasonQuality };
        }
      } catch { /* reasoning 失败 */ }
    }
  } catch {
    const chatElapsed = Date.now() - chatStart;
    const chatSelection = ctx.sys.llm.consumeLastUnifiedSelection();
    if (chatSelection) {
      recordResourceOutcome(ctx.sys, `model/${chatSelection.profile.id}`, false, chatElapsed, undefined, 'chat');
    }
  }

  // 最终 fallback：reasoning 模型
  const reasoningStart = Date.now();
  try {
    const reasoningResult = await ctx.sys.llm.chat(
      [{ role: 'user', content: plan.content, timestamp: Date.now() }],
      [], 1, { taskType: 'reasoning' }
    );
    const reasoningElapsed = Date.now() - reasoningStart;
    const reasoningSelection = ctx.sys.llm.consumeLastUnifiedSelection();
    if (reasoningSelection) {
      recordResourceOutcome(ctx.sys, `model/${reasoningSelection.profile.id}`, true, reasoningElapsed, undefined, 'reasoning');
    }
    return { text: reasoningResult.text ?? '', source: 'cascade/reasoning', toolCalls: [] };
  } catch (err) {
    const reasoningElapsed = Date.now() - reasoningStart;
    const reasoningSelection = ctx.sys.llm.consumeLastUnifiedSelection();
    if (reasoningSelection) {
      recordResourceOutcome(ctx.sys, `model/${reasoningSelection.profile.id}`, false, reasoningElapsed, undefined, 'reasoning');
    }
    throw err;
  }
}

/** sequential — 接力传递上下文（Phase 4.1: 增加审核步骤） */
async function executeSequential(ctx: ExecutionContext, plan: OrchestrationPlan): Promise<ExecutionResult> {
  let context = plan.content;
  const steps: string[] = [];

  for (let i = 0; i < plan.selectedNodes.length; i++) {
    const node = plan.selectedNodes[i];
    const nodeStart = Date.now();
    try {
      let result: string;

      if (node.type === 'local_expert' && node.domain) {
        const r = await ctx.sys.ternaryRouter.query(node.domain, context);
        result = r.answer;
        // P1-1: 回写本地专家结果
        recordResourceOutcome(ctx.sys, `expert/${node.domain}`, true, Date.now() - nodeStart, undefined, 'chat', node.domain);
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
        result = r.text ?? '';
        // P1-1: 回写模型结果
        recordResourceOutcome(ctx.sys, `model/${node.provider}/${node.model}`, true, Date.now() - nodeStart, undefined, 'chat');
      } else {
        const r = await ctx.sys.llm.chat(
          [{ role: 'user', content: context, timestamp: Date.now() }],
          [], 1, { taskType: 'chat', userOverride: node.model }
        );
        result = r.text ?? '';
      }

      // Phase 4.1: 审核步骤 — 下一个节点审核上一个节点的输出
      if (i > 0 && result.length > 50) {
        const quality = evaluateQuality(result, context);
        if (quality < 0.3) {
          // 质量太低，跳过此步骤
          steps.push(result);
          continue;
        }
      }

      steps.push(result);
      context = result;
    } catch (err) {
      // P1-1: 回写失败
      const rid = nodeId(node);
      if (rid) recordResourceOutcome(ctx.sys, rid, false, Date.now() - nodeStart);
      /* 跳过失败的节点 */
    }
  }

  return { text: steps[steps.length - 1] ?? '', source: 'sequential', toolCalls: [] };
}

/** debate — 多方论证 + 质量加权裁决 */
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

  // Phase 4.1: 质量评估 — 为每个专家的回答打分
  const scored = args.map(a => ({
    ...a,
    quality: evaluateQuality(a.text, plan.content),
  }));

  // 按质量排序
  scored.sort((a, b) => b.quality - a.quality);

  // 裁决 prompt — 注入质量分数，让裁决者加权参考
  const judgePrompt = [
    '你是裁决者。以下是多个专家对同一问题的回答，请综合判断，给出最终结论。',
    '每个回答附带质量评分（0-1），请优先参考高质量回答。',
    '',
    ...scored.map((a, i) =>
      `专家 ${i + 1} (${a.nodeId}) [质量: ${a.quality.toFixed(2)}]:\n${a.text}`
    ),
    '',
    '请给出你的最终结论（综合高质量回答的要点）：',
  ].join('\n');

  const judgeResult = await ctx.sys.llm.chat(
    [{ role: 'user', content: judgePrompt, timestamp: Date.now() }],
    [], 1, { taskType: 'reasoning' }
  );

  return { text: judgeResult.text ?? '', source: 'debate', toolCalls: [], expertResults: scored };
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

    // P1-1: 回写 DAG 中每个任务的结果
    // V2-缺口6: 从 skeleton capabilityRequirement 提取精确 taskType
    const stepMap = plan.dagSkeleton?.steps
      ? new Map(plan.dagSkeleton.steps.map(s => [s.id, s]))
      : null;

    if (dag.tasks) {
      for (const tr of result.taskResults) {
        const task = dag.tasks.get(tr.id);
        if (task) {
          // V2-缺口6: 优先从 capabilityRequirement 取 taskType，否则 fallback
          const step = stepMap?.get(tr.id);
          const taskType = step?.capabilityRequirement?.taskType ?? task.tool;

          // DAG 任务使用工具，资源 ID 为 tool/{toolName}
          recordResourceOutcome(ctx.sys, `tool/${task.tool}`, tr.success, tr.durationMs, undefined, taskType);

          // Phase 3.2: 如果任务有匹配的执行单元，也回写到该资源
          if (task.executorResourceId) {
            recordResourceOutcome(ctx.sys, task.executorResourceId, tr.success, tr.durationMs, undefined, taskType);
          }
        }
      }
    }

    // Phase 3.3: MarginalAuditor DAG 组合审计
    const auditor = ctx.sys.resourceSystem?.auditor;
    if (auditor && plan.dagSkeleton) {
      const auditSteps = result.taskResults.map(tr => {
        const task = dag.tasks.get(tr.id);
        const step = stepMap?.get(tr.id);
        return {
          stepId: tr.id,
          resourceId: task?.executorResourceId ?? `tool/${task?.tool ?? 'unknown'}`,
          taskType: step?.capabilityRequirement?.taskType ?? task?.tool ?? 'unknown',
          success: tr.success,
          latencyMs: tr.durationMs,
        };
      });
      auditor.auditDAGCombination(dag.id, auditSteps);
    }

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
