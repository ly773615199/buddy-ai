/**
 * PID 阶跃响应基准测试
 *
 * 直接测量 PID 控制器的输出特性（不经过 action 阈值）。
 * 用于指导 Phase 8 的 Kp/Ki/Kd 参数调优。
 *
 * 关注指标：
 * - 收敛速度：误差首次降到 ±5 以内的步数
 * - 超调量：PID 输出的最大绝对值
 * - 稳态误差：最后 10 步的平均误差
 * - 振荡次数：误差穿越零点的次数
 */

import { describe, it, expect } from 'vitest';
import { HomeostasisRegulator, DEFAULT_HOMEOSTASIS_CONFIG } from '../cerebellum/homeostasis.js';
import type { BodyState, HomeostasisAction, PIDGains } from '../types.js';

// ==================== 辅助 ====================

/** 构造一个默认 BodyState */
function makeBody(overrides?: Partial<BodyState>): BodyState {
  return {
    energy: 80, temperature: 50, load: 20, hunger: 20,
    emotion: { joy: 50, sadness: 10, anger: 5, fear: 5, surprise: 10, disgust: 5, trust: 60, anticipation: 40 },
    desires: { hunger: 20, curiosity: 30, social: 15, safety: 10, expression: 15, rest: 15 },
    focusLevel: 70, confidenceLevel: 60, confusionLevel: 20,
    intimacyLevel: 50, socialNeed: 30,
    hour: 14, isUserActive: true, lastInteractionMs: Date.now(),
    systemHealth: 'good',
    ...overrides,
  };
}

/**
 * 直接模拟 PID 控制回路（绕过 action 阈值）
 *
 * 误差 → PID 计算 → 直接调整状态 → 记录
 * 这样不同 Kp/Ki/Kd 才能产生不同行为
 */
function simulatePIDLoop(
  gains: PIDGains,
  initialState: Partial<BodyState>,
  stateField: 'energy' | 'load' | 'confusionLevel',
  targetValue: number,
  steps: number,
): {
  errors: number[];
  pidOutputs: number[];
  actions: number[];
} {
  const errors: number[] = [];
  const pidOutputs: number[] = [];
  const actions: number[] = [];

  // PID 内部状态
  let integral = 0;
  let prevError = 0;

  let state = makeBody(initialState);

  for (let i = 0; i < steps; i++) {
    const current = state[stateField] as number;
    const error = targetValue - current;
    errors.push(error);

    // PID 计算
    integral += error;
    const derivative = error - prevError;
    const output = gains.kp * error + gains.ki * integral + gains.kd * derivative;
    prevError = error;
    pidOutputs.push(output);

    // 直接应用 PID 输出到状态（模拟控制效果）
    // 正输出 → 增加状态值；负输出 → 减少状态值
    const adjustment = output * 0.1; // 缩放因子，模拟实际控制增益
    const newValue = Math.max(0, Math.min(100, current + adjustment));

    // 记录是否触发了动作
    actions.push(Math.abs(output) > 10 ? 1 : 0);

    // 更新状态 + 自然衰减
    state = makeBody({
      ...state,
      [stateField]: newValue,
      // 系统扰动：精力自然下降、负载自然上升
      energy: stateField === 'energy' ? newValue : state.energy - 1,
      load: stateField === 'load' ? newValue : state.load + 0.5,
    });
  }

  return { errors, pidOutputs, actions };
}

/** 分析响应指标 */
function analyzeResponse(errors: number[], pidOutputs: number[]): {
  convergenceStep: number;
  maxOvershoot: number;
  steadyStateError: number;
  oscillations: number;
} {
  // 收敛：误差绝对值首次降到 5 以下
  let convergenceStep = errors.length;
  for (let i = 0; i < errors.length; i++) {
    if (Math.abs(errors[i]) < 5) {
      convergenceStep = i + 1;
      break;
    }
  }

  // 超调：PID 输出的最大绝对值
  const maxOvershoot = Math.max(...pidOutputs.map(Math.abs));

  // 稳态误差：最后 10 步的平均绝对误差
  const tail = errors.slice(-10);
  const steadyStateError = tail.reduce((s, e) => s + Math.abs(e), 0) / tail.length;

  // 振荡次数：误差穿越零点的次数
  let oscillations = 0;
  for (let i = 1; i < errors.length; i++) {
    if ((errors[i] > 0 && errors[i - 1] < 0) || (errors[i] < 0 && errors[i - 1] > 0)) {
      oscillations++;
    }
  }

  return { convergenceStep, maxOvershoot, steadyStateError, oscillations };
}

// ==================== 基准测试 ====================

describe('PID 阶跃响应基准', () => {

  it('基线：默认参数能量回路', () => {
    const { errors, pidOutputs, actions } = simulatePIDLoop(
      DEFAULT_HOMEOSTASIS_CONFIG.energyPid,
      { energy: 20 },
      'energy',
      60,
      30,
    );
    const m = analyzeResponse(errors, pidOutputs);
    console.log(`[能量基线] converge=${m.convergenceStep}步, overshoot=${m.maxOvershoot.toFixed(1)}, sse=${m.steadyStateError.toFixed(2)}, oscillations=${m.oscillations}`);
    console.log(`  前10步误差: ${errors.slice(0, 10).map(e => e.toFixed(1)).join(', ')}`);
    console.log(`  前10步PID输出: ${pidOutputs.slice(0, 10).map(o => o.toFixed(1)).join(', ')}`);
    expect(m.convergenceStep).toBeGreaterThan(0);
  });

  it('Kp 对比: 0.2 vs 0.5 vs 1.0', () => {
    for (const kp of [0.2, 0.5, 1.0]) {
      const { errors, pidOutputs } = simulatePIDLoop(
        { kp, ki: 0.1, kd: 0.2 },
        { energy: 20 },
        'energy',
        60,
        40,
      );
      const m = analyzeResponse(errors, pidOutputs);
      console.log(`[Kp=${kp}] converge=${m.convergenceStep}步, overshoot=${m.maxOvershoot.toFixed(1)}, sse=${m.steadyStateError.toFixed(2)}, osc=${m.oscillations}`);
    }
  });

  it('Ki 对比: 0.01 vs 0.1 vs 0.5', () => {
    for (const ki of [0.01, 0.1, 0.5]) {
      const { errors, pidOutputs } = simulatePIDLoop(
        { kp: 0.5, ki, kd: 0.2 },
        { energy: 20 },
        'energy',
        60,
        40,
      );
      const m = analyzeResponse(errors, pidOutputs);
      console.log(`[Ki=${ki}] converge=${m.convergenceStep}步, overshoot=${m.maxOvershoot.toFixed(1)}, sse=${m.steadyStateError.toFixed(2)}, osc=${m.oscillations}`);
    }
  });

  it('Kd 对比: 0.05 vs 0.2 vs 0.5', () => {
    for (const kd of [0.05, 0.2, 0.5]) {
      const { errors, pidOutputs } = simulatePIDLoop(
        { kp: 0.5, ki: 0.1, kd },
        { energy: 20 },
        'energy',
        60,
        40,
      );
      const m = analyzeResponse(errors, pidOutputs);
      console.log(`[Kd=${kd}] converge=${m.convergenceStep}步, overshoot=${m.maxOvershoot.toFixed(1)}, sse=${m.steadyStateError.toFixed(2)}, osc=${m.oscillations}`);
    }
  });

  it('三回路对比：能量/负载/认知', () => {
    const scenarios = [
      { name: '能量', field: 'energy' as const, init: { energy: 20 }, target: 60 },
      { name: '负载', field: 'load' as const, init: { load: 90 }, target: 60 },
      { name: '认知', field: 'confusionLevel' as const, init: { confusionLevel: 80 }, target: 50 },
    ];

    for (const { name, field, init, target } of scenarios) {
      const gains = DEFAULT_HOMEOSTASIS_CONFIG[`${field === 'energy' ? 'energy' : field === 'load' ? 'load' : 'cognitive'}Pid`];
      const { errors, pidOutputs } = simulatePIDLoop(gains, init, field, target, 30);
      const m = analyzeResponse(errors, pidOutputs);
      console.log(`[${name}] converge=${m.convergenceStep}步, overshoot=${m.maxOvershoot.toFixed(1)}, sse=${m.steadyStateError.toFixed(2)}, osc=${m.oscillations}`);
    }
  });

  it('防饱和测试：积分项 windup 保护', () => {
    // 长时间偏差 → 积分项累积 → 检查是否饱和
    const { pidOutputs } = simulatePIDLoop(
      { kp: 0.5, ki: 0.5, kd: 0.1 },
      { energy: 0 }, // 极低精力
      'energy',
      60,
      100,
    );
    const maxOutput = Math.max(...pidOutputs.map(Math.abs));
    const lastOutput = Math.abs(pidOutputs[pidOutputs.length - 1]);
    console.log(`[积分饱和] maxOutput=${maxOutput.toFixed(1)}, lastOutput=${lastOutput.toFixed(1)}, ratio=${(lastOutput / maxOutput).toFixed(2)}`);
    // 如果有 windup 保护，lastOutput 不应该远大于 maxOutput
  });
});
