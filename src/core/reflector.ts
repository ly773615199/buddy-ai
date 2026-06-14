/**
 * 反思器 — 执行完成后的闭环学习
 *
 * 从 agent.ts 提取。
 * 职责：质量自评 + 经验编译 + 教训提取 + 幻觉检测 + 三脑反馈
 */

import type { OrchestrationPlan, ExecutionResult } from '../types.js';
import type { TaskSignal, FailureAnalysis, FailureCategory, RetryStrategy } from './agent-types.js';
import type { Subsystems } from './subsystems.js';
import { logger } from '../audit/structured-logger.js';

const log = logger.child('Reflector');

// ==================== 反思主流程 ====================

/**
 * reflect — 执行完成后的闭环学习 + 实时质量评估
 *
 * 1. 质量自评（四维：完整/准确/简洁/可用）
 * 2. 经验编译（成功路径 → ExperienceUnit）
 * 3. 教训提取（失败路径 → Lesson）
 * 4. 幻觉检测（工具成功但结果无关）
 * 5. 三脑反馈
 * 6. 返回质量评估，供调用方决定是否重新决策
 */
export interface ReflectResult {
  quality: number;
  shouldRetry: boolean;
  reason: string;
  failedTools: string[];
  hallucinations: string[];
  /** Phase 1.1: 结构化失败分析，供重决策时注入上下文 */
  failureAnalysis?: FailureAnalysis;
}

export async function reflect(
  sys: Subsystems,
  plan: OrchestrationPlan,
  result: { text: string; toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }> },
  signal: TaskSignal,
  verbose: boolean,
): Promise<ReflectResult> {
  try {
    // ① 质量自评
    const quality = assessQuality(result.text, plan.content, result.toolCalls);

    // ② 经验编译（成功路径 → ExperienceUnit）
    const allSuccess = result.toolCalls.length > 0 && result.toolCalls.every(tc => !tc.result.startsWith('['));
    if (allSuccess) {
      try {
        const snapshot = {
          id: `reflect-${Date.now()}`,
          userMessage: plan.content,
          assistantReply: result.text,
          toolCalls: result.toolCalls.map(tc => ({
            name: tc.name,
            args: tc.args,
            result: tc.result,
          })),
          timestamp: Date.now(),
          wasSuccessful: true,
        };
        await sys.intelligence?.learn?.(snapshot);
        if (verbose) console.log(`  [Reflect] 经验编译: ${result.toolCalls.length} 个工具调用`);
      } catch (err) {
        if (verbose) console.warn('[Reflect] 经验编译失败:', (err as Error).message);
      }

      // Phase 4: DAG 执行路径编译
      if (result.toolCalls.length > 1) {
        try {
          sys.intelligence?.evolver?.onSuccess?.(
            `dag_${signal.domains.join('_')}_${result.toolCalls.length}_steps`,
            result.toolCalls.length * 1000,
          );
        } catch { /* 静默降级 */ }
      }
    }

    // ③ 教训提取（失败路径）
    const failedCalls = result.toolCalls.filter(tc => tc.result.startsWith('['));
    if (failedCalls.length > 0) {
      for (const failed of failedCalls) {
        try {
          sys.cognitive.inferFromMessage(
            `[失败] ${failed.name}: ${failed.result.slice(0, 100)}`,
            [failed.name],
          );
          sys.intelligence?.evolver?.onFailure?.(
            `${failed.name}_failed`,
            `工具 ${failed.name} 执行失败: ${failed.result.slice(0, 80)}`,
          );
        } catch { /* 教训提取失败不影响主流程 */ }
      }
      if (verbose) console.log(`  [Reflect] 教训提取: ${failedCalls.length} 个失败工具`);
    }

    // ④ 幻觉检测
    const hallucinations = detectHallucinations(sys, result.toolCalls, signal);
    if (hallucinations.length > 0) {
      if (verbose) console.log(`  [Reflect] 幻觉检测: ${hallucinations.join(', ')}`);
      try {
        for (const h of hallucinations) {
          sys.intelligence?.evolver?.onFailure?.(h, 'hallucination_detected');
        }
      } catch { /* 注入失败不影响主流程 */ }
    }

    // ⑤ 三脑反馈
    try {
      const feedbackPlan = {
        mode: plan.mode,
        reason: plan.reason,
        selectedNodes: plan.selectedNodes,
        confidence: 0.5,
        source: 'reflection',
      };
      await sys.threeBrain?.feedback?.(
        signal,
        { experienceHit: null } as any,
        feedbackPlan as any,
        { success: allSuccess, latencyMs: 0, costEstimate: 0, toolsUsed: result.toolCalls.map(tc => tc.name) },
        signal.domains.join(','),
        result.toolCalls.map(tc => tc.name),
        undefined,
        undefined,
        result.text, // Phase 1-A1: 透传真实输出到 QualityAssessor
      );
    } catch { /* 反馈失败不影响主流程 */ }

    // 返回质量评估结果
    const failedTools = result.toolCalls.filter(tc => tc.result.startsWith('[')).map(tc => tc.name);
    const retryHallucinations = detectHallucinations(sys, result.toolCalls, signal);
    const shouldRetry = quality < 0.4 || failedTools.length > 0 || retryHallucinations.length > 0;
    const reason = shouldRetry
      ? `quality=${quality.toFixed(2)}${failedTools.length ? ` failed=[${failedTools}]` : ''}${retryHallucinations.length ? ` hallucination=[${retryHallucinations}]` : ''}`
      : `quality=${quality.toFixed(2)} OK`;

    // Phase 1.1: 生成结构化失败分析
    let failureAnalysis: FailureAnalysis | undefined;
    if (shouldRetry) {
      failureAnalysis = analyzeFailure(quality, failedTools, retryHallucinations, result, signal, plan);
    }

    if (verbose && shouldRetry) {
      console.log(`  [Reflect] 质量不足，建议重试: ${reason} → 策略: ${failureAnalysis?.suggestedStrategy ?? 'unknown'}`);
    }

    return { quality, shouldRetry, reason, failedTools, hallucinations, failureAnalysis };

  } catch (err) {
    if (verbose) console.warn('[Reflect] 反思失败:', (err as Error).message);
    return { quality: 0, shouldRetry: false, reason: 'reflect_error', failedTools: [], hallucinations: [] };
  }
}

// ==================== 质量自评 ====================

/**
 * 质量自评 — 四维启发式评估
 */
export function assessQuality(
  output: string,
  input: string,
  toolCalls: Array<{ name: string; result: string }>,
): number {
  let score = 0.5;

  // 完整性：输出长度
  if (output.length < 20) score -= 0.3;
  else if (output.length > 100) score += 0.1;

  // 准确性：工具成功率
  if (toolCalls.length > 0) {
    const successRate = toolCalls.filter(tc => !tc.result.startsWith('[')).length / toolCalls.length;
    score += (successRate - 0.5) * 0.3;
  }

  // 相关性
  const inputWords = input.replace(/[^\w\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(w => w.length > 1);
  const matchedWords = inputWords.filter(w => output.includes(w));
  const relevance = inputWords.length > 0 ? matchedWords.length / inputWords.length : 0;
  score += relevance * 0.2;

  // 简洁性：过长扣分
  if (output.length > input.length * 5) score -= 0.05;

  return Math.max(0, Math.min(1, score));
}

// ==================== 幻觉检测 ====================

/**
 * 幻觉检测 — 语义化判断，减少误判
 */
export function detectHallucinations(
  sys: Subsystems,
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }>,
  signal: TaskSignal,
): string[] {
  const hallucinations: string[] = [];

  for (const call of toolCalls) {
    // 跳过已知错误（以 [ 开头的结果）
    if (call.result.startsWith('[')) continue;

    // 检测 1: exec 返回 command not found
    if (call.name === 'exec' && call.result.includes('command not found')) {
      hallucinations.push(call.name);
      continue;
    }

    // 检测 2: read_file 返回空但任务需要内容
    if (call.name === 'read_file' && call.result.trim() === '' && signal.taskType === 'chat') {
      hallucinations.push(call.name);
      continue;
    }

    // 检测 3: write_file 但任务不涉及文件操作
    if (call.name === 'write_file' && !signal.domains.includes('file_ops') && signal.taskType === 'chat') {
      const intentLower = signal.content?.toLowerCase() ?? '';
      if (!intentLower.includes('文件') && !intentLower.includes('写入') && !intentLower.includes('创建')) {
        hallucinations.push(call.name);
        continue;
      }
    }

    // 不再用结果长度判断 — 短结果 (如 ls 单文件) 不应被误判
  }

  return [...new Set(hallucinations)];
}

/** 获取领域允许的工具名集合 */
function getAllowedToolNames(domains: string[]): Set<string> {
  const categoryMap: Record<string, string[]> = {
    code: ['analyze_file', 'find_references', 'exec', 'read_file', 'list_files', 'search_files', 'project_symbols', 'project_context', 'project_deps'],
    web: ['search_web', 'fetch_url', 'browser'],
    git: ['git_status', 'git_log', 'git_diff', 'exec'],
    voice: ['tts_speak'],
    data: ['search_web', 'fetch_url'],
  };
  const result = new Set<string>();
  for (const d of domains) {
    for (const name of (categoryMap[d] ?? [])) result.add(name);
  }
  for (const name of ['read_file', 'exec', 'project_index_stats']) result.add(name);
  return result;
}

// ==================== 失败分析（Phase 1.1） ====================

/**
 * 结构化失败分析 — 从执行结果中推断失败原因和建议策略
 *
 * 供重决策时注入上下文，让 scheduler 换路走而非重跑同样流程
 */
function analyzeFailure(
  quality: number,
  failedTools: string[],
  hallucinations: string[],
  result: { text: string; toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }> },
  signal: TaskSignal,
  plan: OrchestrationPlan,
): FailureAnalysis {
  const allFailedResults = result.toolCalls
    .filter(tc => tc.result.startsWith('['))
    .map(tc => tc.result);

  // 分类 1: 工具执行失败
  if (failedTools.length > 0) {
    // 检查是否是模型生成了错误的工具调用（模型弱点）
    const hasCommandNotFound = allFailedResults.some(r => r.includes('command not found'));
    const hasPermissionDenied = allFailedResults.some(r => r.includes('permission') || r.includes('EACCES'));
    const hasTimeout = allFailedResults.some(r => r.includes('timeout') || r.includes('ETIMEDOUT'));

    if (hasCommandNotFound) {
      return {
        category: 'model_weakness',
        detail: `模型生成了不存在的命令: ${failedTools.join(', ')}`,
        suggestedStrategy: 'switch_model',
        failedTools,
        qualityScore: quality,
      };
    }

    if (hasTimeout) {
      return {
        category: 'resource_mismatch',
        detail: `工具执行超时: ${failedTools.join(', ')}`,
        suggestedStrategy: 'switch_tools',
        failedTools,
        qualityScore: quality,
      };
    }

    return {
      category: 'tool_failure',
      detail: `工具执行失败: ${failedTools.join(', ')}`,
      suggestedStrategy: 'switch_tools',
      failedTools,
      qualityScore: quality,
    };
  }

  // 分类 2: 幻觉（工具成功但结果无关）
  if (hallucinations.length > 0) {
    return {
      category: 'model_weakness',
      detail: `幻觉检测: ${hallucinations.join(', ')}`,
      suggestedStrategy: 'inject_knowledge',
      failedTools: hallucinations,
      qualityScore: quality,
    };
  }

  // 分类 3: 质量不足（输出太短或不相关）
  if (quality < 0.3) {
    return {
      category: 'prompt_issue',
      detail: `输出质量极低 (${quality.toFixed(2)})`,
      suggestedStrategy: 'simplify',
      qualityScore: quality,
    };
  }

  // 分类 4: 中等质量 — 可能是模型能力边界
  const selectedModel = plan.selectedNodes[0]?.id;
  return {
    category: 'model_weakness',
    detail: `质量不足 (${quality.toFixed(2)})，当前模型可能不适合此任务`,
    suggestedStrategy: 'switch_model',
    failedModelId: selectedModel,
    qualityScore: quality,
  };
}
