/**
 * 稳态调节器 — MAPE-K + PID 负反馈
 *
 * 四条调节回路：能量、情绪、认知、负载
 * 目标 < 1ms 纯数值计算
 */

import type { BodyState, HomeostasisAction } from '../types.js';

export interface PIDGains { kp: number; ki: number; kd: number; }

export interface HomeostasisConfig {
  energyPid: PIDGains;
  emotionPid: PIDGains;
  cognitivePid: PIDGains;
  loadPid: PIDGains;
  maxActionsPerHour: number;
}

export const DEFAULT_HOMEOSTASIS_CONFIG: HomeostasisConfig = {
  energyPid: { kp: 0.5, ki: 0.1, kd: 0.2 },
  emotionPid: { kp: 0.3, ki: 0.05, kd: 0.1 },
  cognitivePid: { kp: 0.4, ki: 0.1, kd: 0.15 },
  loadPid: { kp: 0.6, ki: 0.1, kd: 0.3 },
  maxActionsPerHour: 5,
};

interface PIDState {
  integral: number;
  prevError: number;
}

export class HomeostasisRegulator {
  private config: HomeostasisConfig;
  private pidStates: Record<string, PIDState> = {
    energy: { integral: 0, prevError: 0 },
    emotion: { integral: 0, prevError: 0 },
    cognitive: { integral: 0, prevError: 0 },
    load: { integral: 0, prevError: 0 },
  };
  private actionHistory: Array<{ action: HomeostasisAction; timestamp: number }> = [];

  constructor(config?: Partial<HomeostasisConfig>) {
    this.config = { ...DEFAULT_HOMEOSTASIS_CONFIG, ...config };
  }

  /**
   * MAPE-K 循环：Analyze → Plan → Execute
   *
   * 输入 BodyState，输出调节动作列表
   */
  regulate(state: BodyState): HomeostasisAction[] {
    // Analyze: 计算偏差
    const errors = this.computeErrors(state);

    // Plan: PID 调节
    const actions = this.pidRegulate(errors, state);

    // Execute: 过滤 + 限频
    return this.filterActions(actions);
  }

  /** 获取调节历史 */
  getActionHistory(limit = 10): Array<{ action: HomeostasisAction; timestamp: number }> {
    return this.actionHistory.slice(-limit);
  }

  /** 清空历史 */
  clearHistory(): void {
    this.actionHistory = [];
  }

  // ── 内部实现 ──

  private computeErrors(state: BodyState) {
    return {
      energy: 60 - state.energy,
      emotion: 0 - this.emotionValence(state),
      cognitive: 50 - state.confusionLevel,
      load: 60 - state.load,
    };
  }

  private emotionValence(state: BodyState): number {
    const e = state.emotion;
    return (e.joy + e.trust + e.anticipation) - (e.sadness + e.anger + e.fear);
  }

  private pidRegulate(
    errors: { energy: number; emotion: number; cognitive: number; load: number },
    state: BodyState,
  ): HomeostasisAction[] {
    const actions: HomeostasisAction[] = [];
    const dt = 1;

    const energyOut = this.pid('energy', errors.energy, this.config.energyPid, dt);
    if (energyOut < -50) actions.push({ type: 'trigger_dream', reason: `精力极低(${state.energy})`, priority: 9 });
    else if (energyOut < -20) actions.push({ type: 'adjust_model', reason: '精力偏低', priority: 5, params: { tier: 'budget' } });

    const emotionOut = this.pid('emotion', errors.emotion, this.config.emotionPid, dt);
    if (emotionOut < -40) actions.push({ type: 'inject_mood', reason: '情绪偏负面', priority: 6, params: { mood: 'positive' } });

    const cognitiveOut = this.pid('cognitive', errors.cognitive, this.config.cognitivePid, dt);
    if (cognitiveOut < -30) actions.push({ type: 'request_clarify', reason: '困惑度过高', priority: 8 });
    if (cognitiveOut < -50) actions.push({ type: 'reduce_tools', reason: '困惑时减少工具', priority: 5 });

    const loadOut = this.pid('load', errors.load, this.config.loadPid, dt);
    if (loadOut < -40) actions.push({ type: 'adjust_model', reason: '系统高负载', priority: 7, params: { tier: 'budget' } });

    return actions;
  }

  private pid(loop: string, error: number, gains: PIDGains, dt: number): number {
    const state = this.pidStates[loop];
    if (!state) return 0;
    state.integral += error * dt;
    const derivative = (error - state.prevError) / dt;
    state.prevError = error;
    return gains.kp * error + gains.ki * state.integral + gains.kd * derivative;
  }

  private filterActions(actions: HomeostasisAction[]): HomeostasisAction[] {
    const oneHourAgo = Date.now() - 3600_000;
    const recentCount = this.actionHistory.filter(a => a.timestamp > oneHourAgo).length;
    if (recentCount >= this.config.maxActionsPerHour) return [];

    const sorted = actions.sort((a, b) => b.priority - a.priority).slice(0, 3);
    for (const action of sorted) {
      this.actionHistory.push({ action, timestamp: Date.now() });
    }
    return sorted;
  }
}
