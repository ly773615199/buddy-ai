/**
 * DAG 管线 — planSkeleton → Gate-1 → SkillResolver → Gate-2
 *
 * 从 agent.ts 提取。
 * 职责：当 useDAG=true 时，生成 DAG 骨架 → 门控 → 工具绑定 → 验证
 */

import type { TaskSignal, ResourceState } from './agent-types.js';
import type { Subsystems } from './subsystems.js';
import type { DAGSkeleton, SkeletonStep, TaskDAG, ResolveResult } from '../orchestrate/types.js';
import { logger } from '../audit/structured-logger.js';

const log = logger.child('DAGPipeline');

/** 从 suggestedCategory 推断 fallback taskType */
function inferFallbackTaskType(step: SkeletonStep | undefined): string {
  const cat = step?.suggestedCategory;
  const map: Record<string, string> = {
    code_analysis: 'tools', file_ops: 'tools', web_search: 'tools', git: 'tools', system: 'tools',
    voice: 'chat', chat: 'chat',
  };
  return map[cat ?? ''] ?? 'tools';
}

export interface DAGPipelineResult {
  resolvedDAG: TaskDAG | null;
  dagSkeleton: DAGSkeleton | null;
  reason: string;
  /** Step 3.5 的执行单元匹配结果（供反馈闭环使用） */
  executorMatches?: Map<string, import('../orchestrate/types.js').ExecutorMatch>;
}

/**
 * resolveDAGPipeline — 4 步 DAG 构建管线
 *
 * Step 1: planSkeleton() — LLM 生成步骤骨架
 * Step 2: Gate-1 — 左脑规划门控（步骤合理性验证）
 * Step 3: SkillResolver.resolve() — 步骤→工具+参数
 * Step 4: Gate-2 — 工具-意图验证
 */
export async function resolveDAGPipeline(
  sys: Subsystems,
  content: string,
  signal: TaskSignal,
  resources: ResourceState,
  verbose: boolean,
): Promise<DAGPipelineResult> {
  const ruleEngine = sys.threeBrain?.left?.getRuleEngine();

  // ── Step 1: 生成 DAG 骨架 ──
  let skeleton: DAGSkeleton;
  try {
    skeleton = await sys.dagPlanner.planSkeleton(content, signal.domains);
    if (verbose) {
      console.log(`  [DAG] 骨架生成: ${skeleton.steps.length} 步, 复杂度=${skeleton.complexity}`);
    }
  } catch (err) {
    if (verbose) console.warn('[DAG] 骨架生成失败:', (err as Error).message);
    return { resolvedDAG: null, dagSkeleton: null, reason: `骨架生成失败: ${(err as Error).message}` };
  }

  // ── Step 2: Gate-1 — 左脑规划门控 ──
  if (ruleEngine) {
    const gate1 = ruleEngine.validateDAGSkeleton(skeleton, signal, resources);
    if (!gate1.passed) {
      const violations = gate1.violations.filter(v => v.severity === 'block');
      if (verbose) {
        console.log(`  [Gate-1] 未通过: ${violations.map(v => v.rule).join(', ')}`);
      }
      if (violations.some(v => v.action === 'downgrade_to_single')) {
        return { resolvedDAG: null, dagSkeleton: skeleton, reason: `Gate-1 拦截: ${violations[0].description}，降级 single` };
      }
      return { resolvedDAG: null, dagSkeleton: skeleton, reason: `Gate-1 拦截: ${violations[0]?.description}` };
    }
    if (verbose && gate1.violations.length > 0) {
      console.log(`  [Gate-1] 通过（有 ${gate1.violations.length} 个 warn）`);
    }
  }

  // ── Step 3: SkillResolver — 步骤→工具+参数 ──
  let resolved: ResolveResult;
  try {
    resolved = await sys.skillResolver.resolve(skeleton, content);
    if (verbose) {
      console.log(`  [SkillResolver] 解析完成: ${resolved.resolutionLog.length} 步, 未解析=${resolved.unresolvedSteps.length}`);
    }
  } catch (err) {
    if (verbose) console.warn('[SkillResolver] 解析失败:', (err as Error).message);
    return { resolvedDAG: null, dagSkeleton: skeleton, reason: `SkillResolver 失败: ${(err as Error).message}` };
  }

  // ── Step 3.5: 能力匹配 — 为每个任务匹配执行单元（模型） ──
  let executorMatches: Map<string, import('../orchestrate/types.js').ExecutorMatch> | undefined;
  // 等待 resourceSystem 异步初始化完成（最多 3s）
  if (!sys.resourceSystem?.hub) {
    await sys.waitForResourceSystem(3000);
  }
  const unifiedHub = sys.resourceSystem?.hub;
  if (sys.skillResolver && unifiedHub) {
    sys.skillResolver.setResourceHub(unifiedHub);
    executorMatches = sys.skillResolver.matchExecutors(resolved.dag, skeleton);

    // V2-缺口2: 对未匹配到执行单元的步骤降级重试
    for (const task of resolved.dag.tasks.values()) {
      if (executorMatches.has(task.id)) continue;
      // 降级匹配：从 skeleton step 推断 taskType，放宽约束重试
      const step = skeleton.steps.find(s => s.id === task.id);
      const inferredTaskType = step?.capabilityRequirement?.taskType
        ?? inferFallbackTaskType(step);
      const fallbackCandidates = unifiedHub.recommend(inferredTaskType);
      if (fallbackCandidates.length > 0) {
        const best = fallbackCandidates[0];
        executorMatches.set(task.id, {
          taskId: task.id,
          resourceId: best.id,
          resourceName: best.name,
          score: 0,
          source: 'fallback',
        });
      }
    }

    // 将匹配结果注入到 Task.executorResourceId
    for (const [taskId, match] of executorMatches) {
      const task = resolved.dag.tasks.get(taskId);
      if (task) {
        task.executorResourceId = match.resourceId;
      }
    }

    if (verbose) {
      const matched = [...executorMatches.values()].filter(m => m.source === 'capability').length;
      const reused = [...executorMatches.values()].filter(m => m.source === 'reuse').length;
      const fallback = [...executorMatches.values()].filter(m => m.source === 'fallback').length;
      console.log(`  [能力匹配] ${matched} 步匹配, ${reused} 步复用, ${fallback} 步降级`);
    }
  }

  // ── Step 4: Gate-2 — 工具-意图验证 ──
  if (ruleEngine) {
    const gate2 = ruleEngine.validateResolvedDAG(resolved.dag, signal, sys.tools);
    if (!gate2.passed) {
      const blocks = gate2.violations.filter(v => v.severity === 'block');
      if (verbose) {
        console.log(`  [Gate-2] 未通过: ${blocks.map(v => v.rule).join(', ')}`);
      }
      return { resolvedDAG: null, dagSkeleton: skeleton, reason: `Gate-2 拦截: ${blocks[0]?.description}` };
    }
    if (verbose && gate2.violations.length > 0) {
      console.log(`  [Gate-2] 通过（有 ${gate2.violations.length} 个 warn）`);
    }
  }

  return { resolvedDAG: resolved.dag, dagSkeleton: skeleton, reason: 'DAG 管线完成', executorMatches };
}
