/**
 * 能力包质量雷达
 * 生成多维度质量评估数据（雷达图用）
 */

import type { SkillPackage, KnowledgeNode } from './package.js';

export interface RadarDimension {
  name: string;
  score: number;       // 0-100
  weight: number;      // 权重
  details: string;
}

export interface RadarReport {
  packageId: string;
  domain: string;
  overallScore: number;
  dimensions: RadarDimension[];
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  comparedToAverage: number;  // 与同领域平均分的差距
  timestamp: number;
}

// 领域平均分基准（模拟）
const DOMAIN_BASELINES: Record<string, number> = {
  '骨科': 72,
  '编程': 68,
  '烹饪': 75,
  '法律': 65,
  '金融': 70,
  '_default': 60,
};

export class QualityRadar {

  /** 生成雷达报告 */
  generateReport(pkg: SkillPackage): RadarReport {
    const dimensions: RadarDimension[] = [
      this._dimensionCoverage(pkg),
      this._dimensionConsistency(pkg),
      this._dimensionDepth(pkg),
      this._dimensionFreshness(pkg),
      this._dimensionDiversity(pkg),
      this._dimensionConfidence(pkg),
    ];

    const overallScore = this._weightedAverage(dimensions);

    const strengths = dimensions
      .filter(d => d.score >= 80)
      .map(d => `${d.name}表现优秀 (${d.score}分)`);

    const weaknesses = dimensions
      .filter(d => d.score < 60)
      .map(d => `${d.name}需要提升 (${d.score}分)`);

    const recommendations = this._generateRecommendations(dimensions, pkg);

    const baseline = DOMAIN_BASELINES[pkg.domain] ?? DOMAIN_BASELINES._default;

    return {
      packageId: pkg.id,
      domain: pkg.domain,
      overallScore,
      dimensions,
      strengths,
      weaknesses,
      recommendations,
      comparedToAverage: overallScore - baseline,
      timestamp: Date.now(),
    };
  }

  /** 对比两个包 */
  compareReports(reportA: RadarReport, reportB: RadarReport): {
    dimension: string;
    scoreA: number;
    scoreB: number;
    diff: number;
  }[] {
    const results: { dimension: string; scoreA: number; scoreB: number; diff: number }[] = [];

    const dimMapB = new Map(reportB.dimensions.map(d => [d.name, d.score]));

    for (const dimA of reportA.dimensions) {
      const scoreB = dimMapB.get(dimA.name) ?? 0;
      results.push({
        dimension: dimA.name,
        scoreA: dimA.score,
        scoreB,
        diff: dimA.score - scoreB,
      });
    }

    return results;
  }

  /** 生成雷达图 JSON 数据 */
  toChartData(report: RadarReport): {
    labels: string[];
    data: number[];
    average: number;
  } {
    return {
      labels: report.dimensions.map(d => d.name),
      data: report.dimensions.map(d => d.score),
      average: report.overallScore,
    };
  }

  // ==================== 各维度评估 ====================

  private _dimensionCoverage(pkg: SkillPackage): RadarDimension {
    const types = new Set(pkg.knowledge.map(k => k.type));
    const score = Math.round((types.size / 6) * 60 + Math.min(pkg.knowledgeCount / 100, 1) * 40);

    return {
      name: '知识覆盖',
      score: Math.min(100, score),
      weight: 0.2,
      details: `${types.size}/6 类知识，${pkg.knowledgeCount} 条节点`,
    };
  }

  private _dimensionConsistency(pkg: SkillPackage): RadarDimension {
    if (pkg.knowledgeCount === 0) {
      return { name: '知识一致', score: 0, weight: 0.15, details: '无知识节点' };
    }

    const highConf = pkg.knowledge.filter(k => k.confidence >= 0.8).length;
    const ratio = highConf / pkg.knowledgeCount;
    const score = Math.round(ratio * 100);

    return {
      name: '知识一致',
      score,
      weight: 0.15,
      details: `${highConf}/${pkg.knowledgeCount} 高置信度 (${(ratio * 100).toFixed(0)}%)`,
    };
  }

  private _dimensionDepth(pkg: SkillPackage): RadarDimension {
    if (pkg.knowledgeCount === 0) {
      return { name: '专业深度', score: 0, weight: 0.2, details: '无知识节点' };
    }

    const avgImportance = pkg.knowledge.reduce((s, k) => s + k.importance, 0) / pkg.knowledgeCount;
    const avgConcepts = pkg.knowledge.reduce((s, k) => s + k.concepts.length, 0) / pkg.knowledgeCount;
    const score = Math.round(Math.min(avgImportance * 50 + avgConcepts * 10, 100));

    return {
      name: '专业深度',
      score,
      weight: 0.2,
      details: `平均重要度 ${avgImportance.toFixed(2)}，平均概念 ${avgConcepts.toFixed(1)}`,
    };
  }

  private _dimensionFreshness(pkg: SkillPackage): RadarDimension {
    if (pkg.knowledgeCount === 0) {
      return { name: '知识新鲜', score: 0, weight: 0.15, details: '无知识节点' };
    }

    const now = Date.now();
    const avgAgeDays = pkg.knowledge.reduce((s, k) => s + (now - k.createdAt), 0)
      / pkg.knowledgeCount / (1000 * 60 * 60 * 24);

    let score = 100;
    if (avgAgeDays > 7) score = Math.max(20, 100 - (avgAgeDays - 7) * 1.5);

    return {
      name: '知识新鲜',
      score: Math.round(score),
      weight: 0.15,
      details: `平均年龄 ${avgAgeDays.toFixed(0)} 天`,
    };
  }

  private _dimensionDiversity(pkg: SkillPackage): RadarDimension {
    // 概念多样性：独特概念数 / 总知识数
    const allConcepts = new Set<string>();
    for (const k of pkg.knowledge) {
      k.concepts.forEach(c => allConcepts.add(c));
    }

    const ratio = pkg.knowledgeCount > 0 ? allConcepts.size / pkg.knowledgeCount : 0;
    const score = Math.round(Math.min(ratio * 150, 100));

    return {
      name: '概念多样',
      score,
      weight: 0.15,
      details: `${allConcepts.size} 个独特概念 / ${pkg.knowledgeCount} 条知识`,
    };
  }

  private _dimensionConfidence(pkg: SkillPackage): RadarDimension {
    if (pkg.knowledgeCount === 0) {
      return { name: '置信水平', score: 0, weight: 0.15, details: '无知识节点' };
    }

    const avgConf = pkg.knowledge.reduce((s, k) => s + k.confidence, 0) / pkg.knowledgeCount;
    const score = Math.round(avgConf * 100);

    return {
      name: '置信水平',
      score,
      weight: 0.15,
      details: `平均置信度 ${(avgConf * 100).toFixed(1)}%`,
    };
  }

  private _weightedAverage(dimensions: RadarDimension[]): number {
    let totalWeight = 0;
    let weightedSum = 0;

    for (const d of dimensions) {
      weightedSum += d.score * d.weight;
      totalWeight += d.weight;
    }

    return Math.round(totalWeight > 0 ? weightedSum / totalWeight : 0);
  }

  private _generateRecommendations(dimensions: RadarDimension[], pkg: SkillPackage): string[] {
    const recs: string[] = [];

    for (const d of dimensions) {
      if (d.score < 50) {
        recs.push(`${d.name}偏低 (${d.score}分): ${d.details}，建议重点改进`);
      }
    }

    if (pkg.knowledgeCount < 50) {
      recs.push(`知识量不足 (${pkg.knowledgeCount}条)，建议继续积累至 50+`);
    }

    // 检查类型覆盖
    const types = new Set(pkg.knowledge.map(k => k.type));
    const missingTypes = ['decision_rule', 'exception', 'pattern', 'risk', 'human_factor', 'failure']
      .filter(t => !types.has(t as any));

    if (missingTypes.length > 0) {
      recs.push(`缺少 ${missingTypes.length} 类知识: ${missingTypes.join(', ')}`);
    }

    return recs;
  }
}
