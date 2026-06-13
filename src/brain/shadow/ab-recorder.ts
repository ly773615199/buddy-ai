/**
 * A/B 对比数据记录器
 *
 * 分组记录影子版本和线上版本的决策结果
 * 提供统计分析：成功率/延迟/成本对比
 */

import type { ABTestResult, ABTestGroup } from './types.js';

export class ABTestRecorder {
  private results: ABTestResult[] = [];
  private readonly maxResults: number;

  constructor(maxResults: number = 10000) {
    this.maxResults = maxResults;
  }

  /**
   * 记录一条 A/B 测试结果
   */
  record(result: ABTestResult): void {
    this.results.push(result);
    if (this.results.length > this.maxResults) {
      this.results = this.results.slice(-this.maxResults);
    }
  }

  /**
   * 批量记录
   */
  recordBatch(results: ABTestResult[]): void {
    for (const r of results) this.record(r);
  }

  /**
   * 分析 A/B 对比结果
   */
  analyze(): {
    shadow: GroupStats;
    production: GroupStats;
    comparison: {
      successRateDiff: number;
      latencyDiff: number;
      costDiff: number;
      winner: ABTestGroup | 'tie';
    };
    sampleCount: number;
  } | null {
    const shadowResults = this.results.filter(r => r.group === 'shadow');
    const prodResults = this.results.filter(r => r.group === 'production');

    if (shadowResults.length < 10 || prodResults.length < 10) return null;

    const shadow = this.calcGroupStats(shadowResults);
    const prod = this.calcGroupStats(prodResults);

    const successRateDiff = shadow.successRate - prod.successRate;
    const latencyDiff = shadow.avgLatency - prod.avgLatency;
    const costDiff = shadow.avgCost - prod.avgCost;

    let winner: ABTestGroup | 'tie' = 'tie';
    if (successRateDiff > 0.05 && latencyDiff < prod.avgLatency * 0.2) winner = 'shadow';
    else if (successRateDiff < -0.05) winner = 'production';

    return {
      shadow,
      production: prod,
      comparison: { successRateDiff, latencyDiff, costDiff, winner },
      sampleCount: this.results.length,
    };
  }

  /**
   * 获取指定分组的结果
   */
  getResults(group?: ABTestGroup): ABTestResult[] {
    return group ? this.results.filter(r => r.group === group) : [...this.results];
  }

  /**
   * 获取样本数
   */
  get count(): number {
    return this.results.length;
  }

  /**
   * 清空历史数据
   */
  clear(): void {
    this.results = [];
  }

  // ── 内部 ──

  private calcGroupStats(results: ABTestResult[]): GroupStats {
    const successes = results.filter(r => r.success).length;
    return {
      count: results.length,
      successRate: successes / results.length,
      avgLatency: results.reduce((s, r) => s + r.latencyMs, 0) / results.length,
      avgCost: results.reduce((s, r) => s + (r.cost ?? 0), 0) / results.length,
    };
  }
}

interface GroupStats {
  count: number;
  successRate: number;
  avgLatency: number;
  avgCost: number;
}
