/**
 * I9: 跨会话知识迁移 — 领域知识包导出/导入
 *
 * 基于 Agent Memory 综述 — 记忆碎片化问题：
 * 梦境巩固时，将高频领域的经验导出为可迁移的知识包。
 */

import type { ExperienceUnit } from './types.js';
import type { CognitiveEngine } from '../cognitive/engine.js';

export interface KnowledgePack {
  domain: string;
  version: number;
  experiences: ExperienceUnit[];
  domainProfile: {
    domainType: string;
    depthScore: number;
    growthStage: string;
    knowledgeCount: number;
  };
  extractedAt: number;
  source: string;
}

export class KnowledgeExporter {
  private cognitive: CognitiveEngine;
  private getExperiences: () => ExperienceUnit[];

  constructor(cognitive: CognitiveEngine, getExperiences: () => ExperienceUnit[]) {
    this.cognitive = cognitive;
    this.getExperiences = getExperiences;
  }

  /**
   * 导出某领域的知识包
   */
  exportDomainPack(domain: string): KnowledgePack | null {
    const profile = this.cognitive.getDomainProfile(domain);
    if (profile.growthStage === 'seed' || profile.knowledgeCount < 3) {
      return null; // 太少不值得导出
    }

    // 筛选该领域相关的经验
    const allExp = this.getExperiences();
    const domainExp = allExp.filter(exp =>
      exp.trigger.contextTags.includes(domain) ||
      exp.trigger.keywords.some(k => k.toLowerCase().includes(domain.toLowerCase())) ||
      exp.trigger.intent.toLowerCase().includes(domain.toLowerCase())
    );

    if (domainExp.length === 0) return null;

    return {
      domain,
      version: 1,
      experiences: domainExp,
      domainProfile: {
        domainType: profile.domainType,
        depthScore: profile.depthScore,
        growthStage: profile.growthStage,
        knowledgeCount: profile.knowledgeCount,
      },
      extractedAt: Date.now(),
      source: 'buddy-auto-export',
    };
  }

  /**
   * 导出所有成熟领域的知识包
   */
  exportAllMature(): KnowledgePack[] {
    const profiles = this.cognitive.getAllDomainProfiles();
    const packs: KnowledgePack[] = [];

    for (const p of profiles) {
      if (p.growthStage === 'mature' || p.growthStage === 'trainable') {
        const pack = this.exportDomainPack(p.domain);
        if (pack) packs.push(pack);
      }
    }

    return packs;
  }

  /**
   * 导入知识包
   */
  importDomainPack(pack: KnowledgePack): { imported: number; skipped: number } {
    let imported = 0;
    let skipped = 0;

    // 检查版本兼容
    if (pack.version > 1) {
      console.warn(`[KnowledgeExporter] 知识包版本 ${pack.version} 不兼容，当前支持 v1`);
      return { imported: 0, skipped: pack.experiences.length };
    }

    // 导入经验（不覆盖已有的）
    const existing = this.getExperiences();
    const existingIds = new Set(existing.map(e => e.id));

    for (const exp of pack.experiences) {
      if (existingIds.has(exp.id)) {
        skipped++;
      } else {
        // 降低初始置信度（跨项目迁移的经验需要重新验证）
        exp.stats.confidence = Math.min(exp.stats.confidence, 0.4);
        imported++;
      }
    }

    return { imported, skipped };
  }

  /**
   * 序列化为 JSON（用于文件存储/传输）
   */
  serialize(pack: KnowledgePack): string {
    return JSON.stringify(pack, null, 2);
  }

  /**
   * 从 JSON 反序列化
   */
  deserialize(json: string): KnowledgePack | null {
    try {
      const pack = JSON.parse(json) as KnowledgePack;
      if (!pack.domain || !pack.experiences || !pack.version) return null;
      return pack;
    } catch {
      return null;
    }
  }
}
