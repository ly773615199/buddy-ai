/**
 * 工具链组合 — 将工具输出传递给下一个工具
 *
 * 支持 ${prev} / ${prev.field} 引用前一步输出
 */

import type { ToolDef } from '../types.js';
import type { ToolRegistry } from './registry.js';
import { friendlyError } from './error-messages.js';
import { ToolExecutionMiddleware, type BeforeToolExecute } from './execution-middleware.js';

/** 单步定义 */
export interface ChainStep {
  name?: string;
  tool: string;
  args: Record<string, unknown>;
}

/** 工具链定义 */
export interface ToolChain {
  id: string;
  name: string;
  description?: string;
  steps: ChainStep[];
  /** 步骤失败时是否继续（默认 false） */
  continueOnError?: boolean;
}

/** 工具链执行结果 */
export interface ChainResult {
  chainId: string;
  success: boolean;
  stepResults: Array<{ step: number; tool: string; result: string; error?: string }>;
  totalMs: number;
}

/**
 * 解析参数中的 prev 引用
 * ${prev}        → 上一步完整输出
 * ${step.N}      → 第 N 步的输出（0-based）
 * ${step.N.field}→ 第 N 步 JSON 输出的某个字段
 */
function resolveRefs(
  value: string,
  stepOutputs: string[],
  currentStep: number,
): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
    if (expr === 'prev') {
      return stepOutputs[currentStep - 1] ?? '';
    }
    // step.N 或 step.N.field
    const stepMatch = expr.match(/^step\.(\d+)(?:\.(.+))?$/);
    if (stepMatch) {
      const idx = parseInt(stepMatch[1], 10);
      const field = stepMatch[2];
      const output = stepOutputs[idx] ?? '';
      if (field) {
        try {
          const parsed = JSON.parse(output);
          return String(parsed[field] ?? '');
        } catch {
          return '';
        }
      }
      return output;
    }
    return expr; // 无法解析，原样返回
  });
}

/**
 * 深度解析 args 中的所有引用
 */
function resolveArgs(
  args: Record<string, unknown>,
  stepOutputs: string[],
  currentStep: number,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      resolved[key] = resolveRefs(value, stepOutputs, currentStep);
    } else if (Array.isArray(value)) {
      resolved[key] = value.map(v =>
        typeof v === 'string' ? resolveRefs(v, stepOutputs, currentStep) : v,
      );
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

/**
 * 执行工具链 — 通过统一中间件
 */
export async function executeChain(
  chain: ToolChain,
  registry: ToolRegistry,
  input?: Record<string, unknown>,
  options?: {
    beforeToolExecute?: BeforeToolExecute;
  },
): Promise<ChainResult> {
  const startMs = Date.now();
  const stepOutputs: string[] = [];
  const stepResults: ChainResult['stepResults'] = [];
  let success = true;

  // Task 6.1: 使用统一中间件
  const middleware = new ToolExecutionMiddleware(registry, {
    beforeExecute: options?.beforeToolExecute,
    defaultTimeoutMs: 30000,
  });

  for (let i = 0; i < chain.steps.length; i++) {
    const step = chain.steps[i];

    try {
      // 第一步如果有 input，先合并 input 到 args
      let resolvedArgs: Record<string, unknown>;
      if (i === 0 && input) {
        resolvedArgs = { ...input, ...resolveArgs(step.args, stepOutputs, i) };
      } else {
        resolvedArgs = resolveArgs(step.args, stepOutputs, i);
      }

      // Task 6.1: 通过中间件执行（权限检查 + 参数校验 + 超时 + 结果截断）
      const result = await middleware.execute({
        toolName: step.tool,
        args: resolvedArgs,
        source: 'chain',
      });

      const output = result.result;
      stepOutputs.push(output);
      stepResults.push({ step: i, tool: step.tool, result: output, error: result.error });

      if (!result.success) {
        success = false;
        if (!chain.continueOnError) break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const friendly = friendlyError(msg);
      stepOutputs.push('');
      stepResults.push({ step: i, tool: step.tool, result: '', error: friendly !== msg ? `${msg} (💡 ${friendly})` : msg });
      success = false;
      if (!chain.continueOnError) break;
    }
  }

  return {
    chainId: chain.id,
    success,
    stepResults,
    totalMs: Date.now() - startMs,
  };
}
