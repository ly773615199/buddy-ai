/**
 * 经验执行器 — 按步骤序列执行经验
 *
 * 接收 ExperienceUnit，按 steps 顺序调用工具，
 * 收集输出，填充回复模板，返回执行结果。
 */

import type {
  ExperienceUnit,
  ExperienceExecutionResult,
  ExperienceStep,
  ReplyTemplate,
  RoutePath,
} from './types.js';

// ── 工具执行接口 ──

export type ToolExecutor = (toolName: string, args: Record<string, unknown>) => Promise<string>;

// ── 性格键 ──

export type PersonalityKey = 'sharp' | 'warm' | 'chaotic';

// ── P6: 反思结果 ──

export interface ReflectionOutcome {
  quality: 'good' | 'acceptable' | 'poor';
  issues: string[];
  shouldRequery: boolean;
}

export interface ExecutorConfig {
  defaultPersonality: PersonalityKey;
  stepTimeoutMs: number;
}

// ── I2: 失败记忆 ──

export interface FailureMemory {
  experienceId: string;
  failureContext: string;
  rootCause: string;
  timestamp: number;
  failCount: number;
}

const DEFAULT_CONFIG: ExecutorConfig = {
  defaultPersonality: 'warm',
  stepTimeoutMs: 10000,
};

export class ExperienceExecutor {
  private toolExecutor: ToolExecutor;
  private config: ExecutorConfig;
  private failureMemories = new Map<string, FailureMemory>();

  constructor(toolExecutor: ToolExecutor, config?: Partial<ExecutorConfig>) {
    this.toolExecutor = toolExecutor;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 执行技能
   */
  async execute(
    skill: ExperienceUnit,
    personality?: PersonalityKey,
  ): Promise<ExperienceExecutionResult> {
    const startTime = Date.now();
    const outputs: Record<string, string> = {};
    const pk = personality ?? this.config.defaultPersonality;

    // I2: 检查失败记忆，注入提示
    const failureHint = this.getFailureHint(skill.id);

    try {
      for (let i = 0; i < skill.steps.length; i++) {
        const step = skill.steps[i];

        // 检查前置条件
        if (step.condition && !outputs[step.condition]) {
          return {
            success: false,
            outputs,
            reply: `步骤 ${i + 1} 的前置条件不满足: ${step.condition}`,
            skillId: skill.id,
            executionMs: Date.now() - startTime,
            failedStep: i,
            error: `condition_not_met: ${step.condition}`,
          };
        }

        // 准备参数（替换变量引用）
        const resolvedArgs = this.resolveArgs(step.args, outputs);

        // 执行工具
        try {
          const result = await this.withTimeout(
            this.toolExecutor(step.tool, resolvedArgs),
            this.config.stepTimeoutMs,
          );

          // 存储输出
          if (step.outputVar) {
            outputs[step.outputVar] = result;
          }
          outputs[`_step_${i}`] = result;
        } catch (err) {
          return {
            success: false,
            outputs,
            reply: `步骤 ${i + 1} (${step.tool}) 执行失败: ${(err as Error).message}`,
            skillId: skill.id,
            executionMs: Date.now() - startTime,
            failedStep: i,
            error: (err as Error).message,
          };
        }
      }

      // 全部步骤成功，生成回复
      const reply = this.buildReply(skill.replyTemplate, pk, outputs);

      // P6: 执行反思门 — 快速评估输出质量
      const reflection = this.reflect(skill, outputs, reply);
      if (reflection.shouldRequery) {
        // I2: 记录失败经验
        this.recordFailure(skill.id, outputs, reflection.issues.join('; '));

        return {
          success: false,
          outputs,
          reply: `反思不通过: ${reflection.issues.join(', ')}${failureHint ? '\n\n' + failureHint : ''}`,
          skillId: skill.id,
          executionMs: Date.now() - startTime,
          error: `reflection_failed: ${reflection.issues.join(', ')}`,
          needsLLMFallback: true,
        } as ExperienceExecutionResult & { needsLLMFallback: boolean };
      }

      return {
        success: true,
        outputs,
        reply,
        skillId: skill.id,
        executionMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        success: false,
        outputs,
        reply: `技能执行异常: ${(err as Error).message}`,
        skillId: skill.id,
        executionMs: Date.now() - startTime,
        error: (err as Error).message,
      };
    }
  }

  /**
   * 验证执行结果
   */
  verify(skill: ExperienceUnit, result: ExperienceExecutionResult): boolean {
    if (!skill.verifier) return result.success;
    if (!result.success) return false;

    const v = skill.verifier;
    switch (v.type) {
      case 'output_contains': {
        const target = v.target ? result.outputs[v.target] : Object.values(result.outputs).join(' ');
        return target.includes(v.criteria);
      }
      case 'file_exists':
        // 由外部验证
        return true;
      case 'command_success':
        return result.success;
      default:
        return result.success;
    }
  }

  // ── P6: 执行反思门 ──

  /**
   * 快速评估执行输出质量
   * 检查：输出长度、错误标记、意图相关性
   */
  private reflect(
    skill: ExperienceUnit,
    outputs: Record<string, string>,
    reply: string,
  ): ReflectionOutcome {
    const issues: string[] = [];
    const allOutput = Object.values(outputs).join(' ');

    // 输出过短（模板替换后仍有变量残留说明数据不足）
    if (reply.length < 10) issues.push('输出过短');

    // 包含错误标记
    if (/\[拒绝|失败|error|denied|timeout|异常/i.test(allOutput)) issues.push('包含错误');

    // 模板变量未替换（说明步骤输出缺失）
    if (/\{[a-zA-Z_]+\}/.test(reply.replace(/\{\{.*?\}\}/g, ''))) issues.push('模板变量未替换');

    return {
      quality: issues.length === 0 ? 'good' : issues.length <= 1 ? 'acceptable' : 'poor',
      issues,
      shouldRequery: issues.length >= 2,
    };
  }

  // ── 私有方法 ──

  private resolveArgs(
    args: Record<string, unknown>,
    outputs: Record<string, string>,
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
        const varName = value.slice(2, -1);
        resolved[key] = outputs[varName] ?? value;
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  private buildReply(template: ReplyTemplate, pk: PersonalityKey, outputs: Record<string, string>): string {
    let reply = template[pk] ?? template.default;

    // 替换输出变量
    for (const [key, value] of Object.entries(outputs)) {
      const short = value.length > 200 ? value.slice(0, 200) + '...' : value;
      reply = reply.replace(new RegExp(`\\{${key}\\}`, 'g'), short);
    }

    return reply;
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
      ),
    ]);
  }

  // ── I2: 失败经验回写 ──

  /**
   * 记录失败经验
   */
  private recordFailure(skillId: string, outputs: Record<string, string>, rootCause: string): void {
    const existing = this.failureMemories.get(skillId);
    if (existing) {
      existing.failCount++;
      existing.failureContext = JSON.stringify(outputs).slice(0, 500);
      existing.rootCause = rootCause;
      existing.timestamp = Date.now();
    } else {
      this.failureMemories.set(skillId, {
        experienceId: skillId,
        failureContext: JSON.stringify(outputs).slice(0, 500),
        rootCause,
        timestamp: Date.now(),
        failCount: 1,
      });
    }
  }

  /**
   * 获取失败提示（仅 2 次以上失败才返回）
   */
  private getFailureHint(skillId: string): string | null {
    const mem = this.failureMemories.get(skillId);
    if (!mem || mem.failCount < 2) return null;
    // 超过 24h 清除
    if (Date.now() - mem.timestamp > 24 * 60 * 60 * 1000) {
      this.failureMemories.delete(skillId);
      return null;
    }
    return `⚠️ 这个经验上次执行失败了（${mem.failCount}次），原因: ${mem.rootCause}。请考虑替代方案。`;
  }

  /**
   * 获取失败记忆（供外部查询）
   */
  getFailureMemories(): FailureMemory[] {
    return Array.from(this.failureMemories.values());
  }
}
