/**
 * 递归自改进 — 改改进器
 *
 * 来源: Gödel Agent (ACL 2025) — 自引用框架递归自改进
 *
 * 核心思想: 影子脑不只改三脑，还能改自己的组件参数和逻辑。
 * 进化引擎的 prompt、进化锁的阈值、时机控制器的参数都可以被优化。
 */

import type { EvolutionLogEntry } from '../types.js';

// ── 类型定义 ──

export type SelfModTarget =
  | 'evolution_engine'
  | 'timing_controller'
  | 'evolution_lock'
  | 'gap_detector'
  | 'meta_learner';

export interface SelfModification {
  id: string;
  target: SelfModTarget;
  parameter: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
  evidence: Array<{ metric: string; before: number; after: number }>;
  createdAt: number;
  appliedAt: number | null;
  revertedAt: number | null;
  status: 'pending' | 'applied' | 'rejected' | 'reverted';
}

export interface ComponentPerformance {
  target: SelfModTarget;
  metrics: {
    rejectionRate: number;
    avgEvolutionTime: number;
    successRate: number;
    falsePositiveRate: number;
    falseNegativeRate: number;
  };
  sampleCount: number;
  timestamp: number;
}

export interface SelfModifierConfig {
  /** 最少进化日志数才触发自评估 */
  minLogForEvaluation: number;
  /** GDI 拒绝率超过此阈值 → 建议放宽 */
  gdiRejectionThreshold: number;
  /** 时机拒绝率超过此阈值 → 建议调整 */
  timingRejectionThreshold: number;
  /** 自修改后观察期（进化次数） */
  observationPeriod: number;
  /** 自修改回滚阈值：观察期内成功率下降 > 此值 → 回滚 */
  rollbackThreshold: number;
}

const DEFAULT_CONFIG: SelfModifierConfig = {
  minLogForEvaluation: 10,
  gdiRejectionThreshold: 0.6,
  timingRejectionThreshold: 0.5,
  observationPeriod: 5,
  rollbackThreshold: 0.15,
};

// ── 组件引用注册 ──

export type ComponentSetter = (value: unknown) => void;

export interface ComponentRef {
  target: SelfModTarget;
  parameter: string;
  getter: () => unknown;
  setter: ComponentSetter;
}

// ── SelfModifier 核心 ──

export class SelfModifier {
  private modifications: SelfModification[] = [];
  private config: SelfModifierConfig;
  private componentState: Map<SelfModTarget, Record<string, unknown>> = new Map();
  private componentRefs: Map<string, ComponentRef> = new Map();

  constructor(config?: Partial<SelfModifierConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── 组件引用注册 ──

  /**
   * 注册组件参数的读写引用
   *
   * 注册后，apply() 和 revert() 会自动调用 setter 写入组件
   */
  register(target: SelfModTarget, parameter: string, setter: ComponentSetter, getter: () => unknown): void {
    const key = `${target}:${parameter}`;
    this.componentRefs.set(key, { target, parameter, getter, setter });
  }

  /**
   * 获取注册的组件引用
   */
  getRegisteredRefs(): ComponentRef[] {
    return [...this.componentRefs.values()];
  }

  // ── 组件评估 ──

  /**
   * 评估所有影子脑组件的效果，生成自修改建议
   */
  evaluateComponents(history: EvolutionLogEntry[]): SelfModification[] {
    if (history.length < this.config.minLogForEvaluation) {
      return [];
    }

    const modifications: SelfModification[] = [];

    // 评估进化锁
    modifications.push(...this.evaluateEvolutionLock(history));

    // 评估时机控制器
    modifications.push(...this.evaluateTimingController(history));

    // 评估进化引擎
    modifications.push(...this.evaluateEvolutionEngine(history));

    // 评估缺口检测器
    modifications.push(...this.evaluateGapDetector(history));

    this.modifications.push(...modifications);
    return modifications;
  }

  /**
   * 评估单个组件的性能指标
   */
  getComponentPerformance(target: SelfModTarget, history: EvolutionLogEntry[]): ComponentPerformance {
    const relevant = history.filter(e => {
      // 根据 target 过滤相关的日志
      return true; // 简化：所有日志都相关
    });

    const rejected = relevant.filter(e => e.result === 'rejected');
    const applied = relevant.filter(e => e.result === 'applied');
    const rolledBack = relevant.filter(e => e.result === 'rolled_back');

    // 计算各锁的拒绝率
    const gdiRejected = rejected.filter(e =>
      e.validation.locks.some(l => l.lockName.includes('GDI') && !l.passed)
    );

    return {
      target,
      metrics: {
        rejectionRate: relevant.length > 0 ? rejected.length / relevant.length : 0,
        avgEvolutionTime: relevant.length > 0
          ? relevant.reduce((s, e) => s + e.durationMs, 0) / relevant.length
          : 0,
        successRate: relevant.length > 0 ? applied.length / relevant.length : 0,
        falsePositiveRate: 0, // 需要后续指标
        falseNegativeRate: gdiRejected.length / Math.max(1, relevant.length),
      },
      sampleCount: relevant.length,
      timestamp: Date.now(),
    };
  }

  // ── 自修改应用 ──

  /**
   * 应用自修改到组件
   *
   * 如果组件注册了 setter，自动调用写入新值
   */
  apply(mod: SelfModification): boolean {
    if (mod.status !== 'pending') return false;

    // 记录旧值（从 getter 获取，如果没有注册则用 mod.oldValue）
    const key = `${mod.target}:${mod.parameter}`;
    const ref = this.componentRefs.get(key);
    if (ref) {
      mod.oldValue = ref.getter();
    }

    mod.appliedAt = Date.now();
    mod.status = 'applied';

    // 记录到修改历史
    if (!this.modifications.find(m => m.id === mod.id)) {
      this.modifications.push(mod);
    }

    // 记录组件状态
    const state = this.componentState.get(mod.target) ?? {};
    state[mod.parameter] = mod.newValue;
    this.componentState.set(mod.target, state);

    // 调用组件 setter 写入新值
    if (ref) {
      try {
        ref.setter(mod.newValue);
      } catch (e) {
        // setter 调用失败，回滚状态
        mod.status = 'pending';
        mod.appliedAt = null;
        return false;
      }
    }

    return true;
  }

  /**
   * 回滚自修改
   *
   * 如果组件注册了 setter，自动调用写回旧值
   */
  revert(modId: string): boolean {
    const mod = this.modifications.find(m => m.id === modId);
    if (!mod || mod.status !== 'applied') return false;

    mod.revertedAt = Date.now();
    mod.status = 'reverted';

    // 恢复旧值到组件状态
    const state = this.componentState.get(mod.target) ?? {};
    state[mod.parameter] = mod.oldValue;
    this.componentState.set(mod.target, state);

    // 调用组件 setter 写回旧值
    const key = `${mod.target}:${mod.parameter}`;
    const ref = this.componentRefs.get(key);
    if (ref) {
      try {
        ref.setter(mod.oldValue);
      } catch {
        // setter 失败不影响回滚记录
      }
    }

    return true;
  }

  /**
   * 检查已应用的自修改是否需要回滚
   *
   * 基于观察期内的性能变化判断
   */
  checkRollback(history: EvolutionLogEntry[]): SelfModification[] {
    const toRevert: SelfModification[] = [];
    const applied = this.modifications.filter(m => m.status === 'applied');

    for (const mod of applied) {
      if (!mod.appliedAt) continue;

      // 获取应用后的进化日志
      const afterLogs = history.filter(e => e.timestamp > mod.appliedAt!);
      if (afterLogs.length < this.config.observationPeriod) continue;

      // 计算应用前后的成功率
      const beforeLogs = history.filter(e => e.timestamp <= mod.appliedAt!);
      const beforeSuccess = beforeLogs.length > 0
        ? beforeLogs.filter(e => e.result === 'applied').length / beforeLogs.length
        : 0;
      const afterSuccess = afterLogs.length > 0
        ? afterLogs.filter(e => e.result === 'applied').length / afterLogs.length
        : 0;

      // 成功率下降超过阈值 → 回滚
      if (beforeSuccess - afterSuccess > this.config.rollbackThreshold) {
        toRevert.push(mod);
      }
    }

    return toRevert;
  }

  /**
   * 获取当前组件参数状态
   */
  getComponentState(target: SelfModTarget): Record<string, unknown> {
    return { ...(this.componentState.get(target) ?? {}) };
  }

  /**
   * 获取所有自修改历史
   */
  getModifications(): SelfModification[] {
    return [...this.modifications];
  }

  /**
   * 获取待应用的修改
   */
  getPendingModifications(): SelfModification[] {
    return this.modifications.filter(m => m.status === 'pending');
  }

  // ── 组件评估实现 ──

  private evaluateEvolutionLock(history: EvolutionLogEntry[]): SelfModification[] {
    const mods: SelfModification[] = [];
    const rejected = history.filter(e => e.result === 'rejected');

    // 检查 GDI 拒绝率
    const gdiRejected = rejected.filter(e =>
      e.validation.locks.some(l => l.lockName.includes('GDI') && !l.passed)
    );
    const gdiRate = rejected.length > 0 ? gdiRejected.length / rejected.length : 0;

    if (gdiRate > this.config.gdiRejectionThreshold) {
      // GDI 阈值太严，建议放宽 — 从组件读取实际值
      const key = 'evolution_lock:gdiThreshold';
      const ref = this.componentRefs.get(key);
      const currentThreshold = ref ? (ref.getter() as number) : 0.44;
      const suggestedThreshold = Math.min(0.6, currentThreshold * 1.15);

      mods.push(this.createModification({
        target: 'evolution_lock',
        parameter: 'gdiThreshold',
        oldValue: currentThreshold,
        newValue: suggestedThreshold,
        reason: `${(gdiRate * 100).toFixed(0)}% 方案被 GDI 拒绝（阈值 ${(this.config.gdiRejectionThreshold * 100).toFixed(0)}%），阈值可能太严`,
        evidence: [{ metric: 'gdiRejectionRate', before: gdiRate, after: 0 }],
      }));
    }

    // 检查 CPS 拒绝率
    const cpsRejected = rejected.filter(e =>
      e.validation.locks.some(l => l.lockName.includes('CPS') && !l.passed)
    );
    const cpsRate = rejected.length > 0 ? cpsRejected.length / rejected.length : 0;

    if (cpsRate > 0.3) {
      // CPS 拒绝率高，可能约束定义太严格
      mods.push(this.createModification({
        target: 'evolution_lock',
        parameter: 'cpsStrictness',
        oldValue: 'strict',
        newValue: 'moderate',
        reason: `${(cpsRate * 100).toFixed(0)}% 方案被 CPS 拒绝，约束可能太严格`,
        evidence: [{ metric: 'cpsRejectionRate', before: cpsRate, after: 0 }],
      }));
    }

    return mods;
  }

  private evaluateTimingController(history: EvolutionLogEntry[]): SelfModification[] {
    const mods: SelfModification[] = [];

    // 分析进化间隔分布
    const timestamps = history.map(e => e.timestamp).sort((a, b) => a - b);
    if (timestamps.length < 3) return mods;

    const intervals = timestamps.slice(1).map((t, i) => t - timestamps[i]);
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const minInterval = Math.min(...intervals);

    // 如果平均间隔远大于最小间隔，说明时机控制器太严
    if (avgInterval > minInterval * 3 && avgInterval > 3600000 * 12) { // > 12h
      const key = 'timing_controller:maxLoad';
      const ref = this.componentRefs.get(key);
      const currentMaxLoad = ref ? (ref.getter() as number) : 50;
      const newMaxLoad = Math.min(80, currentMaxLoad + 10);

      mods.push(this.createModification({
        target: 'timing_controller',
        parameter: 'maxLoad',
        oldValue: currentMaxLoad,
        newValue: newMaxLoad,
        reason: `平均进化间隔 ${(avgInterval / 3600000).toFixed(1)}h，远大于最小间隔，负载阈值可放宽`,
        evidence: [{ metric: 'avgIntervalHours', before: avgInterval / 3600000, after: 0 }],
      }));
    }

    return mods;
  }

  private evaluateEvolutionEngine(history: EvolutionLogEntry[]): SelfModification[] {
    const mods: SelfModification[] = [];

    // 分析 L1/L2/L3 方案的质量分布
    const byLevel = { L1: [] as EvolutionLogEntry[], L2: [] as EvolutionLogEntry[], L3: [] as EvolutionLogEntry[] };
    for (const entry of history) {
      const level = entry.proposal.level;
      if (level in byLevel) {
        byLevel[level as keyof typeof byLevel].push(entry);
      }
    }

    // 找出成功率最高的级别
    const levelSuccess: Record<string, number> = {};
    for (const [level, entries] of Object.entries(byLevel)) {
      if (entries.length > 0) {
        levelSuccess[level] = entries.filter(e => e.result === 'applied').length / entries.length;
      }
    }

    // 如果 L2/L3 成功率显著高于 L1，建议调整生成策略
    if (levelSuccess.L2 && levelSuccess.L1 && levelSuccess.L2 > levelSuccess.L1 * 1.5) {
      mods.push(this.createModification({
        target: 'evolution_engine',
        parameter: 'levelPreference',
        oldValue: 'L1_first',
        newValue: 'L2_first',
        reason: `L2 成功率 ${(levelSuccess.L2 * 100).toFixed(0)}% 远高于 L1 ${(levelSuccess.L1 * 100).toFixed(0)}%，建议优先尝试 L2`,
        evidence: [{
          metric: 'L1_successRate', before: levelSuccess.L1, after: levelSuccess.L2,
        }],
      }));
    }

    return mods;
  }

  private evaluateGapDetector(history: EvolutionLogEntry[]): SelfModification[] {
    const mods: SelfModification[] = [];

    // 分析缺口检测的准确性
    // 如果大部分进化都成功了，说明缺口检测太松（把不是缺口的当缺口了）
    // 如果大部分进化都失败了，说明缺口检测太严或方案质量差
    const successRate = history.length > 0
      ? history.filter(e => e.result === 'applied').length / history.length
      : 0;

    if (successRate > 0.9 && history.length > 20) {
      const key = 'gap_detector:minFailures';
      const ref = this.componentRefs.get(key);
      const currentMinFailures = ref ? (ref.getter() as number) : 3;

      mods.push(this.createModification({
        target: 'gap_detector',
        parameter: 'minFailures',
        oldValue: currentMinFailures,
        newValue: currentMinFailures + 1,
        reason: `进化成功率 ${(successRate * 100).toFixed(0)}% 过高，缺口检测可能太松`,
        evidence: [{ metric: 'evolutionSuccessRate', before: successRate, after: 0 }],
      }));
    }

    if (successRate < 0.2 && history.length > 20) {
      const key = 'gap_detector:maxConfidence';
      const ref = this.componentRefs.get(key);
      const currentMaxConfidence = ref ? (ref.getter() as number) : 0.3;

      mods.push(this.createModification({
        target: 'gap_detector',
        parameter: 'maxConfidence',
        oldValue: currentMaxConfidence,
        newValue: Math.min(0.6, currentMaxConfidence + 0.1),
        reason: `进化成功率 ${(successRate * 100).toFixed(0)}% 过低，缺口定义可能太严格`,
        evidence: [{ metric: 'evolutionSuccessRate', before: successRate, after: 0 }],
      }));
    }

    return mods;
  }

  private createModification(partial: Omit<SelfModification, 'id' | 'createdAt' | 'appliedAt' | 'revertedAt' | 'status'>): SelfModification {
    return {
      ...partial,
      id: `selfmod-${partial.target}-${partial.parameter}-${Date.now()}`,
      createdAt: Date.now(),
      appliedAt: null,
      revertedAt: null,
      status: 'pending',
    };
  }
}
