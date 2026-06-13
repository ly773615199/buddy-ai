/**
 * 能力包质量评估器
 * LLM-as-Judge / 差异化安全标准
 */

import type { SkillPackage, KnowledgeNode, GrowthStage } from './package.js';

export interface EvaluationResult {
  packageId: string;
  domain: string;
  overallScore: number;       // 0-100
  dimensions: DimensionScore[];
  riskLevel: RiskLevel;
  passed: boolean;
  recommendations: string[];
  testedAt: number;
}

export interface DimensionScore {
  dimension: string;
  score: number;              // 0-100
  details: string;
}

export type RiskLevel = 'high' | 'medium' | 'low';

export interface TestCase {
  question: string;
  expectedKnowledge: string[]; // 期望涉及的知识点
  domain: string;
}

// ==================== 风险等级阈值 ====================

const RISK_THRESHOLDS: Record<RiskLevel, number> = {
  high: 90,    // 医疗/法律/金融
  medium: 80,  // 工程/教育/咨询
  low: 70,     // 烹饪/摄影/健身
};

// ==================== 高风险领域关键词 ====================

const HIGH_RISK_KEYWORDS = [
  '医疗', '医学', '诊断', '治疗', '药物', '手术', '骨科', '心内科',
  '法律', '律师', '合同', '诉讼', '法规',
  '金融', '投资', '理财', '股票', '基金', '保险',
];

const MEDIUM_RISK_KEYWORDS = [
  '工程', '建筑', '设计', '教育', '培训', '咨询',
  '安全', '合规', '审计', '管理',
];

export class ExperienceEvaluator {

  /**
   * 评估能力包质量
   * @param pkg 待评估的包
   * @param generateAnswer 用于测试的回调（传入问题，返回回答）
   */
  async evaluate(
    pkg: SkillPackage,
    generateAnswer?: (question: string, context: string) => Promise<string>,
  ): Promise<EvaluationResult> {
    const riskLevel = this._assessRisk(pkg.domain);
    const threshold = RISK_THRESHOLDS[riskLevel];
    const dimensions: DimensionScore[] = [];

    // 1. 知识覆盖度
    const coverage = this._evaluateCoverage(pkg);
    dimensions.push(coverage);

    // 2. 知识一致性（知识之间不矛盾）
    const consistency = this._evaluateConsistency(pkg);
    dimensions.push(consistency);

    // 3. 专业深度
    const depth = this._evaluateDepth(pkg);
    dimensions.push(depth);

    // 4. 知识新鲜度
    const freshness = this._evaluateFreshness(pkg);
    dimensions.push(freshness);

    // 5. 如有回调，进行 LLM-as-Judge 测试
    if (generateAnswer) {
      const llmScore = await this._evaluateWithLLM(pkg, generateAnswer);
      dimensions.push(llmScore);
    }

    // 综合评分
    const overallScore = Math.round(
      dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length,
    );

    const passed = overallScore >= threshold;
    const recommendations = this._generateRecommendations(pkg, dimensions, riskLevel, threshold);

    return {
      packageId: pkg.id,
      domain: pkg.domain,
      overallScore,
      dimensions,
      riskLevel,
      passed,
      recommendations,
      testedAt: Date.now(),
    };
  }

  /** 快速评估（不调用 LLM） */
  quickEvaluate(pkg: SkillPackage): EvaluationResult {
    const riskLevel = this._assessRisk(pkg.domain);
    const threshold = RISK_THRESHOLDS[riskLevel];

    const dimensions: DimensionScore[] = [
      this._evaluateCoverage(pkg),
      this._evaluateConsistency(pkg),
      this._evaluateDepth(pkg),
      this._evaluateFreshness(pkg),
    ];

    const overallScore = Math.round(
      dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length,
    );

    return {
      packageId: pkg.id,
      domain: pkg.domain,
      overallScore,
      dimensions,
      riskLevel,
      passed: overallScore >= threshold,
      recommendations: this._generateRecommendations(pkg, dimensions, riskLevel, threshold),
      testedAt: Date.now(),
    };
  }

  /** 自动从知识库生成测试题 */
  generateTestCases(pkg: SkillPackage, count = 10): TestCase[] {
    const cases: TestCase[] = [];
    const usedConcepts = new Set<string>();

    // 从高重要度知识中提取测试题
    const sortedKnowledge = [...pkg.knowledge].sort((a, b) => b.importance - a.importance);

    for (const k of sortedKnowledge) {
      if (cases.length >= count) break;

      // 跳过重复概念
      const newConcepts = k.concepts.filter(c => !usedConcepts.has(c));
      if (newConcepts.length === 0) continue;

      newConcepts.forEach(c => usedConcepts.add(c));

      cases.push({
        question: `关于 ${k.concepts.join('、')}，请说明你的专业判断。`,
        expectedKnowledge: [k.content.slice(0, 50)],
        domain: k.domain,
      });
    }

    return cases;
  }

  // ==================== 内部评估方法 ====================

  private _evaluateCoverage(pkg: SkillPackage): DimensionScore {
    // 覆盖度 = 知识类型分布 × 数量
    const types = new Set(pkg.knowledge.map(k => k.type));
    const typeCoverage = types.size / 6; // 6 类知识

    const quantityScore = Math.min(pkg.knowledgeCount / 100, 1);
    const score = Math.round((typeCoverage * 0.4 + quantityScore * 0.6) * 100);

    return {
      dimension: '知识覆盖度',
      score,
      details: `${types.size}/6 类知识覆盖，共 ${pkg.knowledgeCount} 条知识`,
    };
  }

  private _evaluateConsistency(pkg: SkillPackage): DimensionScore {
    // 简化：检查高置信度知识占比
    const highConf = pkg.knowledge.filter(k => k.confidence >= 0.8).length;
    const ratio = pkg.knowledgeCount > 0 ? highConf / pkg.knowledgeCount : 0;
    const score = Math.round(ratio * 100);

    return {
      dimension: '知识一致性',
      score,
      details: `${highConf}/${pkg.knowledgeCount} 条知识置信度 ≥0.8`,
    };
  }

  private _evaluateDepth(pkg: SkillPackage): DimensionScore {
    // 深度 = 平均 importance × 概念密度
    if (pkg.knowledgeCount === 0) {
      return { dimension: '专业深度', score: 0, details: '无知识节点' };
    }

    const avgImportance = pkg.knowledge.reduce((s, k) => s + k.importance, 0) / pkg.knowledgeCount;
    const avgConcepts = pkg.knowledge.reduce((s, k) => s + k.concepts.length, 0) / pkg.knowledgeCount;
    const score = Math.round(Math.min((avgImportance * 50 + avgConcepts * 10), 100));

    return {
      dimension: '专业深度',
      score,
      details: `平均重要度 ${avgImportance.toFixed(2)}，平均概念数 ${avgConcepts.toFixed(1)}`,
    };
  }

  private _evaluateFreshness(pkg: SkillPackage): DimensionScore {
    const now = Date.now();
    const avgAge = pkg.knowledge.reduce((s, k) => s + (now - k.createdAt), 0) / (pkg.knowledgeCount || 1);
    const avgAgeDays = avgAge / (1000 * 60 * 60 * 24);

    // 7天内满分，30天80分，90天50分，180天20分
    let score = 100;
    if (avgAgeDays > 7) score = Math.max(20, 100 - (avgAgeDays - 7) * 1.5);
    score = Math.round(score);

    return {
      dimension: '知识新鲜度',
      score,
      details: `平均知识年龄 ${avgAgeDays.toFixed(0)} 天`,
    };
  }

  private async _evaluateWithLLM(
    pkg: SkillPackage,
    generateAnswer: (question: string, context: string) => Promise<string>,
  ): Promise<DimensionScore> {
    const testCases = this.generateTestCases(pkg, 5);
    let passCount = 0;

    for (const tc of testCases) {
      try {
        const answer = await generateAnswer(tc.question, pkg.promptTemplate);
        // 简单检查：回答是否包含期望的知识点
        const matched = tc.expectedKnowledge.some(ek =>
          answer.toLowerCase().includes(ek.toLowerCase().slice(0, 20)),
        );
        if (matched) passCount++;
      } catch {
        // LLM 调用失败，跳过
      }
    }

    const score = testCases.length > 0 ? Math.round((passCount / testCases.length) * 100) : 50;

    return {
      dimension: 'LLM 回答质量',
      score,
      details: `${passCount}/${testCases.length} 测试通过`,
    };
  }

  private _assessRisk(domain: string): RiskLevel {
    const lower = domain.toLowerCase();
    if (HIGH_RISK_KEYWORDS.some(k => lower.includes(k))) return 'high';
    if (MEDIUM_RISK_KEYWORDS.some(k => lower.includes(k))) return 'medium';
    return 'low';
  }

  private _generateRecommendations(
    pkg: SkillPackage,
    dimensions: DimensionScore[],
    riskLevel: RiskLevel,
    threshold: number,
  ): string[] {
    const recs: string[] = [];

    for (const d of dimensions) {
      if (d.score < 60) {
        recs.push(`"${d.dimension}" 得分 ${d.score}，建议改进：${d.details}`);
      }
    }

    if (riskLevel === 'high') {
      recs.push('高风险领域：建议添加免责声明，检测到高风险问题时建议咨询真人专家');
    }

    if (pkg.knowledgeCount < 50) {
      recs.push(`知识量不足（${pkg.knowledgeCount} 条），建议继续积累至 50+ 条`);
    }

    if (pkg.qualityScore < threshold) {
      recs.push(`当前质量 ${pkg.qualityScore}% 未达阈值 ${threshold}%，暂不适合包主导模式`);
    }

    return recs;
  }
}
