/**
 * 能力包调度器
 * 基于成熟度选择策略 / 跨领域协作
 */

import type { SkillPackage, GrowthStage } from './package.js';

export interface SchedulingResult {
  /** 是否使用了能力包 */
  hasPackage: boolean;
  /** 注入的 Prompt 片段 */
  promptInjection: string;
  /** 使用的包信息 */
  packages: { id: string; domain: string; stage: GrowthStage; weight: number }[];
  /** 调度策略 */
  strategy: SchedulingStrategy;
}

export type SchedulingStrategy =
  | 'none'           // 无包可用
  | 'stmp_only'      // seed/sprout 阶段，包不够好
  | 'hybrid'         // growing 阶段，混合模式
  | 'package_lead';  // mature 阶段，包主导

export interface DomainMatch {
  domain: string;
  confidence: number;  // 0-1
  keywords: string[];
}

/**
 * 根据包成熟度选择调度策略：
 * - seed/sprout → 普通 STMP 检索（包还不够好）
 * - growing → 混合模式（STMP + 包知识，各 50%）
 * - mature → 包主导（80% 包知识 + 20% STMP 关联）
 */
export class ExperienceScheduler {
  private packages: Map<string, SkillPackage>;

  constructor(packages: Map<string, SkillPackage>) {
    this.packages = packages;
  }

  /**
   * 调度：根据用户输入的领域匹配，选择合适的包
   * @param detectedDomains 从用户消息中检测到的领域
   * @param message 用户当前消息（用于提取上下文）
   */
  schedule(detectedDomains: DomainMatch[], _message?: string): SchedulingResult {
    if (detectedDomains.length === 0) {
      return {
        hasPackage: false,
        promptInjection: '',
        packages: [],
        strategy: 'none',
      };
    }

    // 匹配可用包
    const matchedPkgs: { pkg: SkillPackage; match: DomainMatch; weight: number }[] = [];

    for (const domainMatch of detectedDomains) {
      const pkg = this._findBestPackage(domainMatch.domain);
      if (!pkg) continue;

      const weight = this._calculateWeight(pkg, domainMatch.confidence);
      matchedPkgs.push({ pkg, match: domainMatch, weight });
    }

    if (matchedPkgs.length === 0) {
      return {
        hasPackage: false,
        promptInjection: '',
        packages: [],
        strategy: 'none',
      };
    }

    // 按权重排序
    matchedPkgs.sort((a, b) => b.weight - a.weight);

    // 取权重最高的策略
    const topPkg = matchedPkgs[0];
    const strategy = this._selectStrategy(topPkg.pkg.growthStage);

    // 构建 Prompt 注入
    const promptInjection = this._buildPromptInjection(matchedPkgs, strategy);

    return {
      hasPackage: true,
      promptInjection,
      packages: matchedPkgs.map(m => ({
        id: m.pkg.id,
        domain: m.pkg.domain,
        stage: m.pkg.growthStage,
        weight: m.weight,
      })),
      strategy,
    };
  }

  /** 检查某个领域是否有成熟包 */
  hasMaturePackage(domain: string): boolean {
    const pkg = this._findBestPackage(domain);
    return pkg?.growthStage === 'mature';
  }

  /** 获取所有可用领域 */
  getAvailableDomains(): { domain: string; stage: GrowthStage; quality: number }[] {
    const result: { domain: string; stage: GrowthStage; quality: number }[] = [];
    for (const pkg of this.packages.values()) {
      result.push({ domain: pkg.domain, stage: pkg.growthStage, quality: pkg.qualityScore });
    }
    return result;
  }

  // ==================== 内部方法 ====================

  private _findBestPackage(domain: string): SkillPackage | null {
    // 精确匹配
    for (const pkg of this.packages.values()) {
      if (pkg.domain === domain && pkg.knowledgeCount > 0) return pkg;
    }

    // 模糊匹配：领域包含关系
    for (const pkg of this.packages.values()) {
      if (pkg.knowledgeCount > 0 && (
        pkg.domain.includes(domain) || domain.includes(pkg.domain)
      )) {
        return pkg;
      }
    }

    return null;
  }

  private _calculateWeight(pkg: SkillPackage, matchConfidence: number): number {
    // 权重 = 成熟度系数 × 匹配置信度 × 质量系数
    const stageMultiplier: Record<GrowthStage, number> = {
      seed: 0.1,
      sprout: 0.3,
      growing: 0.6,
      mature: 1.0,
    };

    return stageMultiplier[pkg.growthStage] * matchConfidence * (pkg.qualityScore / 100);
  }

  private _selectStrategy(stage: GrowthStage): SchedulingStrategy {
    switch (stage) {
      case 'seed':
      case 'sprout':
        return 'stmp_only';
      case 'growing':
        return 'hybrid';
      case 'mature':
        return 'package_lead';
    }
  }

  private _buildPromptInjection(
    matchedPkgs: { pkg: SkillPackage; match: DomainMatch; weight: number }[],
    strategy: SchedulingStrategy,
  ): string {
    if (strategy === 'none' || strategy === 'stmp_only') {
      return '';
    }

    let injection = '\n\n=== 专业知识注入 ===\n\n';

    for (const { pkg, weight } of matchedPkgs) {
      if (weight < 0.1) continue;

      injection += `【${pkg.domain}】(成熟度: ${pkg.growthStage}, 质量: ${pkg.qualityScore}%)\n`;

      // 根据策略决定注入多少知识
      const maxNodes = strategy === 'package_lead' ? 30 : 15;
      const topKnowledge = pkg.knowledge
        .sort((a, b) => b.importance - a.importance)
        .slice(0, maxNodes);

      for (const k of topKnowledge) {
        injection += `- ${k.content}\n`;
      }
      injection += '\n';
    }

    if (strategy === 'hybrid') {
      injection += '（混合模式：专业知识仅供参考，结合 STMP 记忆综合判断）\n';
    } else {
      injection += '（包主导模式：优先使用专业知识回答）\n';
    }

    return injection;
  }
}
