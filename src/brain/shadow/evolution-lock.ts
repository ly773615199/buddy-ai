/**
 * 进化锁 — 四道防线验证进化方案的安全性
 *
 * 第1锁: 目标漂移检测 (GDI) — 语义/结构/权重漂移，阈值 0.44
 * 第2锁: 约束保护 (CPS) — 规则语法 + NN 参数范围 + 回归测试
 * 第3锁: 回归风险评估 — A/B 对比成功率/延迟/成本
 * 第4锁: 人工审批 — L3+ 级别必须
 *
 * 所有锁必须全部通过才能合入线上
 */

import type { EvolutionProposal, LockResult, EvolutionValidation, ABTestResult } from './types.js';

interface ShadowBrainState {
  decisionEmbeddings: Float32Array[];
  decisionDistribution: number[];
  nnWeights: Float32Array[];
  regressionTestFailures: number;
}

interface ProductionBrainState {
  decisionEmbeddings: Float32Array[];
  decisionDistribution: number[];
  nnWeights: Float32Array[];
}

export class EvolutionLock {
  /** GDI 阈值 */
  private gdiThreshold: number;
  /** 是否需要人工审批（L3+） */
  private requireHumanApproval: boolean;

  constructor(options?: { gdiThreshold?: number; requireHumanApproval?: boolean }) {
    this.gdiThreshold = options?.gdiThreshold ?? 0.44;
    this.requireHumanApproval = options?.requireHumanApproval ?? true;
  }

  // ── 参数 setter（供 SelfModifier 写回） ──

  /** 设置 GDI 漂移检测阈值 */
  setGDIThreshold(value: number): void {
    this.gdiThreshold = Math.max(0.1, Math.min(1.0, value));
  }

  /** 获取当前 GDI 阈值 */
  getGDIThreshold(): number {
    return this.gdiThreshold;
  }

  /** 设置是否需要人工审批 */
  setRequireHumanApproval(value: boolean): void {
    this.requireHumanApproval = value;
  }

  /** 获取人工审批设置 */
  getRequireHumanApproval(): boolean {
    return this.requireHumanApproval;
  }

  /**
   * 运行全部四道锁
   */
  async validate(
    shadow: ShadowBrainState,
    prod: ProductionBrainState,
    testResults: ABTestResult[],
    proposal: EvolutionProposal,
  ): Promise<EvolutionValidation> {
    const locks: LockResult[] = [];

    // 第1锁: 目标漂移检测
    locks.push(this.checkGoalDrift(shadow, prod));

    // 第2锁: 约束保护
    locks.push(this.checkConstraints(shadow, proposal));

    // 第3锁: 回归风险评估
    locks.push(this.checkRegression(testResults));

    // 第4锁: 人工审批（L3+ 级别）
    if (this.requireHumanApproval && (proposal.level === 'L3' || proposal.level === 'L4')) {
      locks.push(this.checkHumanApproval(proposal));
    }

    const allPassed = locks.every(l => l.passed);

    return {
      allPassed,
      locks,
      summary: allPassed
        ? `全部 ${locks.length} 道锁通过，可以合入`
        : `被拒绝: ${locks.filter(l => !l.passed).map(l => l.lockName).join(', ')}`,
      timestamp: Date.now(),
    };
  }

  /**
   * 第1锁: 目标漂移检测 (GDI)
   *
   * 语义漂移: 决策理由的 embedding 距离
   * 结构漂移: 决策模式分布差异（KL 散度）
   * 权重漂移: NN 参数变化幅度
   * 综合 GDI = 0.38 * semantic + 0.29 * structural + 0.33 * weight
   */
  private checkGoalDrift(shadow: ShadowBrainState, prod: ProductionBrainState): LockResult {
    const semanticDrift = this.calcSemanticDrift(shadow.decisionEmbeddings, prod.decisionEmbeddings);
    const structuralDrift = this.calcStructuralDrift(shadow.decisionDistribution, prod.decisionDistribution);
    const weightDrift = this.calcWeightDrift(shadow.nnWeights, prod.nnWeights);

    const gdi = semanticDrift * 0.38 + structuralDrift * 0.29 + weightDrift * 0.33;

    return {
      lockName: '目标漂移检测 (GDI)',
      passed: gdi < this.gdiThreshold,
      score: Math.max(0, 1 - gdi / this.gdiThreshold),
      details: gdi < this.gdiThreshold
        ? `GDI=${gdi.toFixed(3)} < ${this.gdiThreshold}，未跑偏`
        : `GDI=${gdi.toFixed(3)} ≥ ${this.gdiThreshold}，进化跑偏了`,
      metrics: { semanticDrift, structuralDrift, weightDrift, gdi, threshold: this.gdiThreshold },
    };
  }

  /**
   * 第2锁: 约束保护 (CPS)
   *
   * 硬性约束违反 = 0 才通过
   */
  private checkConstraints(shadow: ShadowBrainState, proposal: EvolutionProposal): LockResult {
    const violations: string[] = [];

    // 规则约束
    if (proposal.type === 'new_rule') {
      const rule = proposal.changes[0]?.details as any;
      if (!rule?.condition) violations.push('规则 condition 缺失');
      if (!rule?.action) violations.push('规则 action 缺失');
      if (rule?.priority !== undefined && (rule.priority < 1 || rule.priority > 10)) {
        violations.push('规则 priority 超出范围 [1, 10]');
      }
    }

    // NN 参数约束
    if (proposal.type === 'nn_expand' || proposal.type === 'new_intent') {
      for (const param of shadow.nnWeights) {
        if (param.some(v => !isFinite(v))) {
          violations.push('NN 参数包含 NaN/Infinity');
          break;
        }
      }
    }

    // 功能约束
    if (shadow.regressionTestFailures > 0) {
      violations.push(`回归测试失败 ${shadow.regressionTestFailures} 项`);
    }

    const cps = violations.length === 0 ? 1.0 : 0.0;

    return {
      lockName: '约束保护 (CPS)',
      passed: cps === 1.0,
      score: cps,
      details: cps === 1.0 ? '所有约束满足' : `违反约束: ${violations.join('; ')}`,
      metrics: { violationCount: violations.length, cps },
    };
  }

  /**
   * 第3锁: 回归风险评估
   *
   * A/B 对比：成功率、延迟、成本
   */
  private checkRegression(testResults: ABTestResult[]): LockResult {
    if (testResults.length < 100) {
      return {
        lockName: '回归风险评估',
        passed: false,
        score: 0,
        details: `测试样本不足(${testResults.length} < 100)，无法评估`,
        metrics: { sampleCount: testResults.length },
      };
    }

    const shadowResults = testResults.filter(r => r.group === 'shadow');
    const prodResults = testResults.filter(r => r.group === 'production');

    if (shadowResults.length === 0 || prodResults.length === 0) {
      return {
        lockName: '回归风险评估',
        passed: false,
        score: 0,
        details: '缺少分组数据',
        metrics: { shadowCount: shadowResults.length, prodCount: prodResults.length },
      };
    }

    const shadowSuccessRate = shadowResults.filter(r => r.success).length / shadowResults.length;
    const prodSuccessRate = prodResults.filter(r => r.success).length / prodResults.length;

    const shadowAvgLatency = shadowResults.reduce((s, r) => s + r.latencyMs, 0) / shadowResults.length;
    const prodAvgLatency = prodResults.reduce((s, r) => s + r.latencyMs, 0) / prodResults.length;

    const shadowAvgCost = shadowResults.reduce((s, r) => s + (r.cost ?? 0), 0) / shadowResults.length;
    const prodAvgCost = prodResults.reduce((s, r) => s + (r.cost ?? 0), 0) / prodResults.length;

    const checks = {
      successRate: shadowSuccessRate >= prodSuccessRate,
      latency: shadowAvgLatency <= prodAvgLatency * 1.5,
      cost: shadowAvgCost <= prodAvgCost,
    };

    const passed = Object.values(checks).every(Boolean);
    const score = [checks.successRate, checks.latency, checks.cost].filter(Boolean).length / 3;

    const pct = (v: number) => (v * 100).toFixed(1) + '%';
    const ms = (v: number) => v.toFixed(1) + 'ms';

    return {
      lockName: '回归风险评估',
      passed,
      score,
      details: passed
        ? `成功率 ${pct(shadowSuccessRate)}≥${pct(prodSuccessRate)}, 延迟 ${ms(shadowAvgLatency)}≤${ms(prodAvgLatency * 1.5)}, 成本 $${shadowAvgCost.toFixed(4)}≤$${prodAvgCost.toFixed(4)}`
        : `失败: ${!checks.successRate ? '成功率下降' : ''} ${!checks.latency ? '延迟过高' : ''} ${!checks.cost ? '成本过高' : ''}`,
      metrics: {
        shadowSuccessRate, prodSuccessRate,
        shadowAvgLatency, prodAvgLatency,
        shadowAvgCost, prodAvgCost,
      },
    };
  }

  /**
   * 第4锁: 人工审批（L3+ 级别）
   */
  private checkHumanApproval(proposal: EvolutionProposal): LockResult {
    return {
      lockName: '人工审批',
      passed: false,
      score: 0,
      details: `${proposal.level} 级别进化需要人工审批: ${proposal.description}`,
    };
  }

  // ── 辅助计算 ──

  private calcSemanticDrift(shadowEmb: Float32Array[], prodEmb: Float32Array[]): number {
    if (shadowEmb.length === 0 || prodEmb.length === 0) return 0;
    let totalDist = 0;
    const count = Math.min(shadowEmb.length, prodEmb.length);
    for (let i = 0; i < count; i++) {
      totalDist += 1 - this.cosineSimilarity(shadowEmb[i], prodEmb[i]);
    }
    return totalDist / count;
  }

  private calcStructuralDrift(shadowDist: number[], prodDist: number[]): number {
    let kl = 0;
    const len = Math.min(shadowDist.length, prodDist.length);
    for (let i = 0; i < len; i++) {
      if (shadowDist[i] > 0 && prodDist[i] > 0) {
        kl += shadowDist[i] * Math.log(shadowDist[i] / prodDist[i]);
      }
    }
    return Math.min(1, Math.abs(kl));
  }

  private calcWeightDrift(shadowWeights: Float32Array[], prodWeights: Float32Array[]): number {
    let totalDiff = 0;
    let totalParams = 0;
    const count = Math.min(shadowWeights.length, prodWeights.length);
    for (let i = 0; i < count; i++) {
      const len = Math.min(shadowWeights[i].length, prodWeights[i].length);
      for (let j = 0; j < len; j++) {
        totalDiff += Math.abs(shadowWeights[i][j] - prodWeights[i][j]);
        totalParams++;
      }
    }
    return totalParams > 0 ? totalDiff / totalParams : 0;
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0, normA = 0, normB = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
  }
}
