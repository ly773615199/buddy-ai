/**
 * 能力包核心
 * 创建/数据结构/STMP导出
 */

export type GrowthStage = 'seed' | 'sprout' | 'growing' | 'mature';
export type PackageStatus = 'private' | 'shared' | 'published';
export type DomainType = 'rule_based' | 'pattern_recognition' | 'creative' | 'relational' | 'unknown';

export interface KnowledgeNode {
  id: string;
  type: 'decision_rule' | 'exception' | 'pattern' | 'risk' | 'human_factor' | 'failure';
  content: string;
  domain: string;
  confidence: number;
  concepts: string[];
  sourceMessageIds: string[];
  createdAt: number;
  accessedAt: number;
  importance: number;
}

export interface SkillPackage {
  id: string;
  name: string;
  description: string;
  domain: string;
  domainType: DomainType;
  growthStage: GrowthStage;
  knowledgeCount: number;
  qualityScore: number;        // 0-100
  sourceRoom: string;          // STMP 房间 ID
  promptTemplate: string;      // 领域 Prompt 模板
  metadata: PackageMetadata;
  status: PackageStatus;
  knowledge: KnowledgeNode[];  // 打包的知识节点
  createdAt: number;
  updatedAt: number;
}

export interface PackageMetadata {
  creator: string;
  version: string;
  tags: string[];
  domainDepthScore: number;
  expertiseSignals: number;
  sizeBytes: number;
}

export interface CreatePackageOptions {
  name: string;
  description?: string;
  domain: string;
  domainType?: DomainType;
  sourceRoom: string;
  knowledge: KnowledgeNode[];
  tags?: string[];
  creator?: string;
  minConfidence?: number;       // 最低置信度，默认 0.5
}

// ==================== 阈值常量 ====================

export const GROWTH_THRESHOLDS: Record<GrowthStage, { minKnowledge: number; minQuality: number }> = {
  seed:   { minKnowledge: 0,   minQuality: 0  },
  sprout: { minKnowledge: 20,  minQuality: 30 },
  growing:{ minKnowledge: 100, minQuality: 60 },
  mature: { minKnowledge: 500, minQuality: 85 },
};

export const KNOWLEDGE_TYPE_LABELS: Record<KnowledgeNode['type'], string> = {
  decision_rule: '决策规则',
  exception: '例外边界',
  pattern: '模式识别',
  risk: '风险判断',
  human_factor: '人的因素',
  failure: '失败经验',
};

// ==================== 能力包管理器 ====================

export class ExperiencePackageManager {
  private packages: Map<string, SkillPackage> = new Map();

  /** 创建能力包 */
  createPackage(options: CreatePackageOptions): SkillPackage {
    const now = Date.now();
    const id = `pkg_${options.domain.replace(/\W+/g, '_')}_${now}`;

    // 过滤低置信度知识
    const minConf = options.minConfidence ?? 0.5;
    const filteredKnowledge = options.knowledge.filter(k => k.confidence >= minConf);

    // 评估成长阶段
    const stage = this._evaluateGrowthStage(filteredKnowledge.length, 0);

    // 生成 Prompt 模板
    const promptTemplate = this._generatePromptTemplate(options.domain, filteredKnowledge);

    const pkg: SkillPackage = {
      id,
      name: options.name,
      description: options.description ?? `${options.domain} 领域专业知识包`,
      domain: options.domain,
      domainType: options.domainType ?? 'unknown',
      growthStage: stage,
      knowledgeCount: filteredKnowledge.length,
      qualityScore: 0, // 待评估
      sourceRoom: options.sourceRoom,
      promptTemplate,
      metadata: {
        creator: options.creator ?? 'user',
        version: '1.0.0',
        tags: options.tags ?? [],
        domainDepthScore: 0,
        expertiseSignals: 0,
        sizeBytes: 0,
      },
      status: 'private',
      knowledge: filteredKnowledge,
      createdAt: now,
      updatedAt: now,
    };

    pkg.metadata.sizeBytes = JSON.stringify(pkg).length;
    this.packages.set(id, pkg);
    return pkg;
  }

  /** 获取能力包 */
  getPackage(id: string): SkillPackage | undefined {
    return this.packages.get(id);
  }

  /** 获取内部包 Map（供 ExperienceScheduler 引用同步） */
  getPackagesMap(): Map<string, SkillPackage> {
    return this.packages;
  }

  /** 列出所有包 */
  listPackages(): SkillPackage[] {
    return Array.from(this.packages.values());
  }

  /** 按领域查找 */
  findByDomain(domain: string): SkillPackage | undefined {
    for (const pkg of this.packages.values()) {
      if (pkg.domain === domain) return pkg;
    }
    return undefined;
  }

  /** 向包中添加知识 */
  addKnowledge(packageId: string, nodes: KnowledgeNode[]): SkillPackage {
    const pkg = this.packages.get(packageId);
    if (!pkg) throw new Error(`能力包 "${packageId}" 不存在`);

    const existingIds = new Set(pkg.knowledge.map(k => k.id));
    const newNodes = nodes.filter(k => k.confidence >= 0.5 && !existingIds.has(k.id));

    pkg.knowledge.push(...newNodes);
    pkg.knowledgeCount = pkg.knowledge.length;
    pkg.updatedAt = Date.now();
    pkg.metadata.sizeBytes = JSON.stringify(pkg).length;

    // 重新评估成长阶段
    pkg.growthStage = this._evaluateGrowthStage(pkg.knowledgeCount, pkg.qualityScore);

    return pkg;
  }

  /** 更新质量评分 */
  updateQuality(packageId: string, score: number): SkillPackage {
    const pkg = this.packages.get(packageId);
    if (!pkg) throw new Error(`能力包 "${packageId}" 不存在`);

    pkg.qualityScore = Math.max(0, Math.min(100, score));
    pkg.growthStage = this._evaluateGrowthStage(pkg.knowledgeCount, pkg.qualityScore);
    pkg.updatedAt = Date.now();

    return pkg;
  }

  /** 更新包状态 */
  updateStatus(packageId: string, status: PackageStatus): SkillPackage {
    const pkg = this.packages.get(packageId);
    if (!pkg) throw new Error(`能力包 "${packageId}" 不存在`);
    pkg.status = status;
    pkg.updatedAt = Date.now();
    return pkg;
  }

  /** 删除能力包 */
  deletePackage(packageId: string): boolean {
    return this.packages.delete(packageId);
  }

  /** 导出为可分享 JSON */
  exportPackage(packageId: string): string {
    const pkg = this.packages.get(packageId);
    if (!pkg) throw new Error(`能力包 "${packageId}" 不存在`);

    // 脱敏：移除 sourceMessageIds
    const sanitized = {
      ...pkg,
      knowledge: pkg.knowledge.map(k => {
        const { sourceMessageIds: _, ...rest } = k;
        return rest;
      }),
    };

    return JSON.stringify(sanitized, null, 2);
  }

  /** 从 JSON 导入 */
  importPackage(json: string): SkillPackage {
    const data = JSON.parse(json) as SkillPackage;

    // 检查是否已有同领域包
    const existing = this.findByDomain(data.domain);
    if (existing) {
      // 合并知识
      return this.addKnowledge(existing.id, data.knowledge);
    }

    data.id = `pkg_imported_${Date.now()}`;
    data.updatedAt = Date.now();
    this.packages.set(data.id, data);
    return data;
  }

  /** 获取领域统计 */
  getDomainStats(): { domain: string; count: number; stage: GrowthStage; quality: number }[] {
    const stats: { domain: string; count: number; stage: GrowthStage; quality: number }[] = [];
    for (const pkg of this.packages.values()) {
      stats.push({
        domain: pkg.domain,
        count: pkg.knowledgeCount,
        stage: pkg.growthStage,
        quality: pkg.qualityScore,
      });
    }
    return stats.sort((a, b) => b.count - a.count);
  }

  /** 序列化所有包为 JSON 字符串（用于持久化） */
  serialize(): string {
    return JSON.stringify([...this.packages.values()]);
  }

  /** 从 JSON 字符串恢复所有包 */
  deserialize(json: string): number {
    try {
      const list = JSON.parse(json) as SkillPackage[];
      for (const pkg of list) {
        // 基本完整性校验
        if (!pkg.id || !pkg.domain || !Array.isArray(pkg.knowledge)) continue;
        this.packages.set(pkg.id, pkg);
      }
      return list.length;
    } catch {
      return 0;
    }
  }

  /** 获取包数量 */
  get size(): number {
    return this.packages.size;
  }

  // ==================== 内部方法 ====================

  private _evaluateGrowthStage(knowledgeCount: number, qualityScore: number): GrowthStage {
    if (knowledgeCount >= 500 && qualityScore >= 85) return 'mature';
    if (knowledgeCount >= 100 && qualityScore >= 60) return 'growing';
    if (knowledgeCount >= 20 && qualityScore >= 30) return 'sprout';
    return 'seed';
  }

  private _generatePromptTemplate(domain: string, knowledge: KnowledgeNode[]): string {
    const byType = new Map<string, KnowledgeNode[]>();
    for (const k of knowledge) {
      const arr = byType.get(k.type) ?? [];
      arr.push(k);
      byType.set(k.type, arr);
    }

    let template = `你是一个 ${domain} 领域的专业顾问。以下是你的专业知识库：\n\n`;

    for (const [type, nodes] of byType) {
      const label = KNOWLEDGE_TYPE_LABELS[type as KnowledgeNode['type']] ?? type;
      template += `## ${label}\n`;
      for (const node of nodes.slice(0, 20)) { // 每类最多 20 条
        template += `- ${node.content}\n`;
      }
      template += '\n';
    }

    template += `请基于以上专业知识回答用户问题。如果超出专业范围，诚实说明。`;
    return template;
  }
}
