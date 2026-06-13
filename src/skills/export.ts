/**
 * 能力包导出/分享
 * .skillmate 格式 / P2P 分享
 */

import type { SkillPackage, KnowledgeNode } from './package.js';
import type { GEPExportData, GEPExperienceGene, GEPCapsule } from '../intelligence/types.js';
import { createHash } from 'crypto';

export interface ExportedPackage {
  format: 'skillmate';
  version: string;
  package: Omit<SkillPackage, 'knowledge'> & {
    knowledge: Omit<KnowledgeNode, 'sourceMessageIds'>[];
  };
  checksum: string;
  exportedAt: number;
}

export interface ImportResult {
  success: boolean;
  package?: SkillPackage;
  error?: string;
  merged?: boolean;     // 是否与已有包合并
}

const FORMAT_VERSION = '1.0.0';

export class ExperienceExporter {

  /** 导出为 .skillmate JSON 格式 */
  export(pkg: SkillPackage): ExportedPackage {
    // 脱敏：移除 sourceMessageIds
    const sanitizedKnowledge = pkg.knowledge.map(k => {
      const { sourceMessageIds: _, ...rest } = k;
      return rest;
    });

    const exportData: ExportedPackage = {
      format: 'skillmate',
      version: FORMAT_VERSION,
      package: {
        ...pkg,
        knowledge: sanitizedKnowledge,
      },
      checksum: '',
      exportedAt: Date.now(),
    };

    // 生成校验和
    exportData.checksum = this._computeChecksum(JSON.stringify(exportData.package));

    return exportData;
  }

  /** 导出为字符串 */
  exportAsString(pkg: SkillPackage): string {
    return JSON.stringify(this.export(pkg), null, 2);
  }

  /** 导出为 Buffer（用于文件下载） */
  exportAsBuffer(pkg: SkillPackage): Buffer {
    return Buffer.from(this.exportAsString(pkg), 'utf-8');
  }

  /** 从字符串导入 */
  import(json: string): ImportResult {
    try {
      const data = JSON.parse(json) as ExportedPackage;

      // 格式验证
      if (data.format !== 'skillmate') {
        return { success: false, error: `不支持的格式: ${data.format}` };
      }

      // 校验和验证
      const expectedChecksum = this._computeChecksum(JSON.stringify(data.package));
      if (data.checksum !== expectedChecksum) {
        return { success: false, error: '数据校验失败，文件可能被篡改' };
      }

      // 恢复知识节点
      const knowledge: KnowledgeNode[] = data.package.knowledge.map(k => ({
        ...k,
        sourceMessageIds: [], // 导入的不带来源
      }));

      const pkg: SkillPackage = {
        ...data.package,
        id: `pkg_imported_${Date.now()}`,
        knowledge,
        updatedAt: Date.now(),
      };

      return { success: true, package: pkg };
    } catch (err) {
      return { success: false, error: `导入失败: ${(err as Error).message}` };
    }
  }

  /** 从 Buffer 导入 */
  importFromBuffer(buffer: Buffer): ImportResult {
    return this.import(buffer.toString('utf-8'));
  }

  /** 生成分享摘要（用于预览） */
  generateSummary(pkg: SkillPackage): string {
    const typeCounts = new Map<string, number>();
    for (const k of pkg.knowledge) {
      typeCounts.set(k.type, (typeCounts.get(k.type) ?? 0) + 1);
    }

    let summary = `📦 ${pkg.name}\n`;
    summary += `   领域: ${pkg.domain} (${pkg.domainType})\n`;
    summary += `   阶段: ${pkg.growthStage} | 质量: ${pkg.qualityScore}% | 知识: ${pkg.knowledgeCount} 条\n`;
    summary += `   类型分布: `;

    const parts: string[] = [];
    for (const [type, count] of typeCounts) {
      parts.push(`${type}(${count})`);
    }
    summary += parts.join(', ');

    return summary;
  }

  /** 验证导入文件完整性 */
  validate(json: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    try {
      const data = JSON.parse(json) as Partial<ExportedPackage>;

      if (data.format !== 'skillmate') errors.push('格式不是 skillmate');
      if (!data.version) errors.push('缺少版本号');
      if (!data.package) errors.push('缺少包数据');
      if (!data.checksum) errors.push('缺少校验和');

      if (data.package) {
        if (!data.package.domain) errors.push('缺少领域标识');
        if (!data.package.knowledge || data.package.knowledge.length === 0) {
          errors.push('知识列表为空');
        }

        const expectedChecksum = this._computeChecksum(JSON.stringify(data.package));
        if (data.checksum !== expectedChecksum) errors.push('校验和不匹配');
      }
    } catch (err) {
      errors.push(`JSON 解析失败: ${(err as Error).message}`);
    }

    return { valid: errors.length === 0, errors };
  }

  private _computeChecksum(content: string): string {
    return `sha256:${createHash('sha256').update(content, 'utf-8').digest('hex')}`;
  }

  // ── GEP 兼容导出 ──

  /** 将 SkillPackage 导出为 GEP 格式 */
  exportAsGEP(pkg: SkillPackage): GEPExportData {
    // 转换知识节点为 GEP Gene
    const genes: GEPExperienceGene[] = pkg.knowledge.map((k, idx) => ({
      id: `${pkg.id}_gene_${idx}`,
      name: `${pkg.domain}_${k.type}_${idx}`,
      description: k.content.slice(0, 200),
      trigger: {
        intent: pkg.domain,
        keywords: k.concepts ?? [],
        patterns: [],
      },
      steps: [{
        tool: pkg.domain,
        args: { query: k.content.slice(0, 100) },
        description: k.content.slice(0, 80),
      }],
      confidence: k.confidence,
      metadata: {
        successCount: Math.round(k.confidence * 10),
        failCount: Math.round((1 - k.confidence) * 10),
        avgExecutionMs: 0,
        createdAt: k.createdAt,
        lastUsed: k.accessedAt,
      },
    }));

    // 构建 capsule（整个包作为一个 capsule）
    const capsule: GEPCapsule = {
      id: `${pkg.id}_capsule`,
      name: pkg.name,
      genes: genes.map(g => g.id),
      strategy: 'sequential',
      description: `${pkg.domain} 领域能力包 (${pkg.growthStage})`,
    };

    return {
      format: 'gep',
      version: '1.0.0',
      genes,
      capsules: [capsule],
      events: [],       // 事件由 evolver 单独导出
      exportedAt: Date.now(),
      source: `buddy:${pkg.id}`,
    };
  }

  /** 将 GEP 数据导出为 JSON 字符串 */
  exportAsGEPString(pkg: SkillPackage): string {
    return JSON.stringify(this.exportAsGEP(pkg), null, 2);
  }

  /** 批量导出多个包为 GEP 格式 */
  exportMultipleAsGEP(packages: SkillPackage[]): GEPExportData {
    const allGenes: GEPExperienceGene[] = [];
    const allCapsules: GEPCapsule[] = [];

    for (const pkg of packages) {
      const gep = this.exportAsGEP(pkg);
      allGenes.push(...gep.genes);
      allCapsules.push(...gep.capsules);
    }

    return {
      format: 'gep',
      version: '1.0.0',
      genes: allGenes,
      capsules: allCapsules,
      events: [],
      exportedAt: Date.now(),
      source: `buddy:batch_${Date.now()}`,
    };
  }
}
