/**
 * Check Function — 工作流完整性检查
 *
 * 基于 AgentRR 论文的 Check Function 概念：
 * 在回放经验前/后检查工作流完整性，防止执行破损的经验链。
 *
 * 三层检查：
 * 1. Pre-check：执行前验证参数和前置条件
 * 2. Step-check：每步执行后验证结果
 * 3. Post-check：执行完后验证整体完成度
 */

import type { ExperienceUnit, ExperienceStep } from './types.js';

export interface CheckResult {
  passed: boolean;
  stage: 'pre' | 'step' | 'post';
  message: string;
  failedStep?: number;
  details?: Record<string, unknown>;
}

export interface CheckContext {
  inputArgs: Record<string, unknown>;
  stepResults: Array<{ stepIndex: number; success: boolean; result: string }>;
  toolNames: Set<string>;
}

export class CheckFunction {

  /**
   * Pre-check：执行前验证
   *
   * 检查：
   * - 经验是否有步骤
   * - 步骤中引用的工具是否都存在
   * - 必需参数是否已提供
   * - 抽象层级是否与当前场景匹配
   */
  preCheck(exp: ExperienceUnit, ctx: CheckContext): CheckResult {
    // 1. 必须有步骤
    if (exp.steps.length === 0) {
      return { passed: false, stage: 'pre', message: '经验没有可执行的步骤' };
    }

    // 2. 检查工具是否存在
    for (let i = 0; i < exp.steps.length; i++) {
      const step = exp.steps[i];
      if (!ctx.toolNames.has(step.tool)) {
        return {
          passed: false,
          stage: 'pre',
          message: `步骤 ${i + 1} 引用的工具 "${step.tool}" 不可用`,
          failedStep: i,
        };
      }
    }

    // 3. 检查必需参数
    for (let i = 0; i < exp.steps.length; i++) {
      const step = exp.steps[i];
      for (const [key, value] of Object.entries(step.args)) {
        // 如果参数值是模板变量（如 {{path}}），检查输入中是否有对应值
        if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
          const varName = value.slice(2, -2);
          if (!(varName in ctx.inputArgs)) {
            return {
              passed: false,
              stage: 'pre',
              message: `步骤 ${i + 1} 需要参数 "${varName}"，但输入中未提供`,
              failedStep: i,
            };
          }
        }
      }
    }

    // 4. strategy 级别经验需要有 reasoning
    if (exp.abstractionLevel === 'strategy' && !exp.reasoning) {
      return {
        passed: false,
        stage: 'pre',
        message: 'strategy 级别经验缺少 reasoning，无法安全执行',
      };
    }

    return { passed: true, stage: 'pre', message: 'Pre-check 通过' };
  }

  /**
   * Step-check：单步执行后验证
   *
   * 检查：
   * - 执行是否成功
   * - 结果是否为空或异常
   * - 结果是否包含错误标记
   */
  stepCheck(step: ExperienceStep, stepIndex: number, result: string): CheckResult {
    // 空结果检查
    if (!result || result.trim().length === 0) {
      return {
        passed: false,
        stage: 'step',
        message: `步骤 ${stepIndex + 1} 返回空结果`,
        failedStep: stepIndex,
      };
    }

    // 错误标记检查
    const errorPatterns = [
      /\[工具执行错误/,
      /\[已拦截/,
      /Error:/i,
      /EACCES/,
      /ENOENT/,
      /permission denied/i,
    ];

    for (const pattern of errorPatterns) {
      if (pattern.test(result)) {
        return {
          passed: false,
          stage: 'step',
          message: `步骤 ${stepIndex + 1} 返回错误: ${result.slice(0, 100)}`,
          failedStep: stepIndex,
          details: { errorPattern: pattern.source, result: result.slice(0, 200) },
        };
      }
    }

    return { passed: true, stage: 'step', message: `步骤 ${stepIndex + 1} 检查通过` };
  }

  /**
   * Post-check：执行后整体验证
   *
   * 检查：
   * - 所有步骤是否都执行了
   * - 成功率是否在可接受范围
   * - workflow/strategy 级别经验的结果是否合理
   */
  postCheck(exp: ExperienceUnit, ctx: CheckContext): CheckResult {
    const totalSteps = exp.steps.length;
    const completedSteps = ctx.stepResults.length;
    const failedSteps = ctx.stepResults.filter(r => !r.success);

    // 步骤完成度检查
    if (completedSteps < totalSteps) {
      return {
        passed: false,
        stage: 'post',
        message: `预期 ${totalSteps} 步，实际完成 ${completedSteps} 步`,
        details: { totalSteps, completedSteps, failedCount: failedSteps.length },
      };
    }

    // 失败率检查（允许 1 步失败，其余必须成功）
    if (failedSteps.length > 1) {
      return {
        passed: false,
        stage: 'post',
        message: `${failedSteps.length} 个步骤失败，超过容忍阈值`,
        details: { failedSteps: failedSteps.map(f => f.stepIndex) },
      };
    }

    // workflow 级别：至少 2 步
    if (exp.abstractionLevel === 'workflow' && totalSteps < 2) {
      return {
        passed: false,
        stage: 'post',
        message: 'workflow 级别经验应至少包含 2 个步骤',
      };
    }

    return {
      passed: true,
      stage: 'post',
      message: `Post-check 通过 (${completedSteps}/${totalSteps} 步成功)`,
      details: { totalSteps, completedSteps, failedCount: failedSteps.length },
    };
  }

  /**
   * 完整检查流程
   */
  runAll(exp: ExperienceUnit, ctx: CheckContext): CheckResult[] {
    const results: CheckResult[] = [];

    const preResult = this.preCheck(exp, ctx);
    results.push(preResult);
    if (!preResult.passed) return results; // pre-check 失败则跳过后续

    // step-check 在实际执行时逐个调用

    return results;
  }
}
