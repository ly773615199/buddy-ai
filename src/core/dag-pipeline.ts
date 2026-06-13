/**
 * DAG 管线 — planSkeleton → Gate-1 → SkillResolver → Gate-2
 *
 * 从 agent.ts 提取。
 * 职责：当 useDAG=true 时，生成 DAG 骨架 → 门控 → 工具绑定 → 验证
 */

import type { TaskSignal, ResourceState } from './agent-types.js';
import type { Subsystems } from './subsystems.js';
import type { DAGSkeleton, TaskDAG, ResolveResult } from '../orchestrate/types.js';
import { logger } from '../audit/structured-logger.js';

const log = logger.child('DAGPipeline');

export interface DAGPipelineResult {
  resolvedDAG: TaskDAG | null;
  dagSkeleton: DAGSkeleton | null;
  reason: string;
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

  return { resolvedDAG: resolved.dag, dagSkeleton: skeleton, reason: 'DAG 管线完成' };
}
