/**
 * 统一工具执行中间件
 *
 * 将 4 条独立的工具执行路径统一为单一入口：
 * - LLM 直接调用
 * - DAG 编排执行
 * - 工具链执行
 * - 经验执行器
 *
 * 统一提供：权限检查、参数校验、结果截断、超时控制
 */

import type { ToolRegistry } from './registry.js';
import { TimeoutError } from '../orchestrate/executor.js';
import { TOOL_RESULT_LIMITS } from '../core/constants.js';
import { friendlyError } from './error-messages.js';

export interface ToolExecutionContext {
  toolName: string;
  args: Record<string, unknown>;
  source: 'llm' | 'dag' | 'chain' | 'experience';
  timeoutMs?: number;
  /** 匹配到的执行单元资源 ID（由 DAG 能力匹配层注入，工具可选用特定模型） */
  executorResourceId?: string;
}

export interface ToolExecutionResult {
  success: boolean;
  result: string;
  durationMs: number;
  error?: string;
}

export type BeforeToolExecute = (name: string, args: Record<string, unknown>) => Promise<{ allowed: boolean; reason?: string }>;

/** 模型切换接口 — 由上层注入，中间件在执行前/后调用 */
export interface ModelSwitcher {
  /** 切换到指定资源 ID 对应的模型 */
  setModel(resourceId: string): void;
  /** 恢复到切换前的模型 */
  restore(): void;
}

export class ToolExecutionMiddleware {
  constructor(
    private registry: ToolRegistry,
    private options?: {
      beforeExecute?: BeforeToolExecute;
      maxResultLength?: number;
      defaultTimeoutMs?: number;
      /** 模型切换器 — 当 executorResourceId 为 model/ 前缀时自动切换 */
      modelSwitcher?: ModelSwitcher;
    },
  ) {}

  async execute(ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
    const startMs = Date.now();

    // 1. 权限检查
    if (this.options?.beforeExecute) {
      const check = await this.options.beforeExecute(ctx.toolName, ctx.args);
      if (!check.allowed) {
        return {
          success: false,
          result: `[已拦截: ${check.reason ?? '操作被拒绝'}]`,
          durationMs: Date.now() - startMs,
          error: check.reason,
        };
      }
    }

    // 2. 工具查找
    const tool = this.registry.get(ctx.toolName);
    if (!tool) {
      return {
        success: false,
        result: `[工具不存在: ${ctx.toolName}]`,
        durationMs: Date.now() - startMs,
        error: 'tool_not_found',
      };
    }

    // 3. 参数校验
    try {
      const schema = tool.parameters as { safeParse?: (data: unknown) => { success: boolean; error?: { message: string } } };
      if (schema?.safeParse) {
        const validation = schema.safeParse(ctx.args);
        if (!validation.success) {
          return {
            success: false,
            result: `[参数错误: ${validation.error?.message}]`,
            durationMs: Date.now() - startMs,
            error: 'validation_failed',
          };
        }
      }
    } catch {
      // schema 解析异常，降级兼容继续执行
    }

    // 4. Per-step 模型切换（V1-改动3）
    const resourceId = ctx.executorResourceId;
    const needsSwitch = resourceId?.startsWith('model/') && this.options?.modelSwitcher;
    if (needsSwitch) {
      this.options!.modelSwitcher!.setModel(resourceId!);
    }

    // 5. 带超时的执行
    const timeoutMs = ctx.timeoutMs ?? this.options?.defaultTimeoutMs ?? 30000;
    try {
      const result = await this.withTimeout(tool.execute(ctx.args), timeoutMs);

      // 恢复模型
      if (needsSwitch) {
        this.options!.modelSwitcher!.restore();
      }
      let resultStr = typeof result === 'string' ? result : JSON.stringify(result);

      // 6. 结果截断
      const maxLen = this.options?.maxResultLength ?? TOOL_RESULT_LIMITS.maxRaw;
      if (resultStr.length > maxLen) {
        resultStr = resultStr.slice(0, maxLen) + `\n... [已截断, 原长 ${resultStr.length} 字符]`;
      }

      return { success: true, result: resultStr, durationMs: Date.now() - startMs };
    } catch (err) {
      // 恢复模型（即使执行失败）
      if (needsSwitch) {
        this.options!.modelSwitcher!.restore();
      }
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = err instanceof TimeoutError;
      const rawError = `[${isTimeout ? '超时' : '执行错误'}: ${msg}]`;
      return {
        success: false,
        result: `${rawError}\n💡 ${friendlyError(rawError)}`,
        durationMs: Date.now() - startMs,
        error: msg,
      };
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    if (ms <= 0) return promise;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
      promise.then(
        (val) => { clearTimeout(timer); resolve(val); },
        (err) => { clearTimeout(timer); reject(err); },
      );
    });
  }
}
