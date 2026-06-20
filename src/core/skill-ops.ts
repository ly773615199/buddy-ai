import type { Subsystems } from './subsystems.js';
import type { SkillPackage, KnowledgeNode, DomainType } from '../skills/index.js';

// ── 持久化 key 常量 ──
const PERSIST_CATEGORY = 'skill_persist';
const KEY_PACKAGES = 'packages';
const KEY_VERSIONS = 'versions';
const KEY_FEEDBACK = 'feedback';

/**
 * 能力包操作 — 从 STMP 重建、创建、评估、版本管理、持久化
 */
export class SkillOps {
  constructor(private sys: Subsystems, private verbose: boolean) {}

  /** 启动时恢复能力包：先从持久化加载，再补充重建缺失的 */
  async rebuildSkillPackages(): Promise<void> {
    try {
      // 1. 尝试从 STMP 记忆恢复已持久化的包
      const restored = this.loadPersisted();
      if (this.verbose && restored > 0) {
        console.log(`  [Skills] 从持久化恢复了 ${restored} 个能力包`);
      }

      // 2. 对于 mature 但未恢复的域，从 STMP 知识重建
      const profiles = this.sys.cognitive.getAllDomainProfiles();
      for (const profile of profiles) {
        if (profile.growthStage !== 'mature') continue;
        if (this.sys.experiencePackageManager.findByDomain(profile.domain)) continue;

        const knowledge = this.gatherDomainKnowledge(profile.domain);
        if (knowledge.length < 3) continue;

        const pkg = this.sys.experiencePackageManager.createPackage({
          name: profile.domain,
          domain: profile.domain,
          domainType: profile.domainType as DomainType,
          sourceRoom: profile.domain.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '-'),
          knowledge,
          creator: 'auto',
        });

        this.evaluateAndVersion(pkg);

        if (this.verbose) {
          console.log(`  [Skills] 从 STMP 重建能力包: ${profile.domain} (${knowledge.length} 条知识)`);
        }
      }
    } catch (err) {
      if (this.verbose) console.warn('[Skills] 重建能力包失败:', (err as Error).message);
    }
  }

  /** 从 STMP 记忆加载持久化的包/版本/反馈数据 */
  private loadPersisted(): number {
    const memory = this.sys.memory;

    // 恢复能力包
    const packagesJson = memory.getMemory(PERSIST_CATEGORY, KEY_PACKAGES);
    if (packagesJson) {
      const count = this.sys.experiencePackageManager.deserialize(packagesJson);
      if (this.verbose) console.log(`  [Skills] 恢复了 ${count} 个能力包`);
    }

    // 恢复版本历史
    const versionsJson = memory.getMemory(PERSIST_CATEGORY, KEY_VERSIONS);
    if (versionsJson) {
      const vCount = this.sys.skillVersionManager.deserialize(versionsJson);
      if (this.verbose) console.log(`  [Skills] 恢复了 ${vCount} 条版本记录`);
    }

    // 恢复反馈数据
    const feedbackJson = memory.getMemory(PERSIST_CATEGORY, KEY_FEEDBACK);
    if (feedbackJson) {
      const fb = this.sys.skillFeedback.deserialize(feedbackJson);
      if (this.verbose) console.log(`  [Skills] 恢复了 ${fb.feedbackCount} 条反馈`);
    }

    return this.sys.experiencePackageManager.size;
  }

  /** 保存所有能力包状态到 STMP 记忆（进程退出前调用） */
  savePersisted(): void {
    try {
      const memory = this.sys.memory;

      // 保存能力包
      const packagesJson = this.sys.experiencePackageManager.serialize();
      memory.setMemory(PERSIST_CATEGORY, KEY_PACKAGES, packagesJson, 10);

      // 保存版本历史
      const versionsJson = this.sys.skillVersionManager.serialize();
      memory.setMemory(PERSIST_CATEGORY, KEY_VERSIONS, versionsJson, 8);

      // 保存反馈数据
      const feedbackJson = this.sys.skillFeedback.serialize();
      memory.setMemory(PERSIST_CATEGORY, KEY_FEEDBACK, feedbackJson, 8);

      if (this.verbose) {
        const pkgCount = this.sys.experiencePackageManager.size;
        console.log(`  [Skills] 已持久化: ${pkgCount} 个能力包`);
      }
    } catch (err) {
      if (this.verbose) console.warn('[Skills] 持久化失败:', (err as Error).message);
    }
  }

  /** 从 STMP 收集某个领域的知识节点 */
  gatherDomainKnowledge(domain: string): KnowledgeNode[] {
    const roomId = domain.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '-');
    const nodes = this.sys.stmp.searchNodes(domain, 20);

    return nodes
      .filter(n => n.room === roomId || n.concepts.includes(domain))
      .map(n => ({
        id: n.id,
        type: this.inferKnowledgeType(n.content),
        content: n.content,
        domain,
        confidence: n.emotional.importance / 10,
        concepts: n.concepts,
        sourceMessageIds: [],
        createdAt: n.timestamp,
        accessedAt: n.lifecycle.lastAccessed,
        importance: n.emotional.importance,
      }));
  }

  /** 从内容推断知识类型 */
  inferKnowledgeType(content: string): KnowledgeNode['type'] {
    if (/异常|例外|特殊情况|edge case/i.test(content)) return 'exception';
    if (/风险|危险|注意|warning/i.test(content)) return 'risk';
    if (/失败|错误|教训/i.test(content)) return 'failure';
    if (/模式|规律|pattern/i.test(content)) return 'pattern';
    if (/偏好|风格|喜欢/i.test(content)) return 'human_factor';
    return 'decision_rule';
  }

  /** 尝试为成熟领域创建能力包 */
  tryCreatePackage(domain: string, profile: { growthStage: string; domainType: string }): void {
    if (profile.growthStage !== 'mature') return;
    if (this.sys.experiencePackageManager.findByDomain(domain)) return;

    // 能力包不限数量

    const knowledge = this.gatherDomainKnowledge(domain);
    if (knowledge.length < 3) return;

    const pkg = this.sys.experiencePackageManager.createPackage({
      name: domain,
      domain,
      domainType: profile.domainType as DomainType,
      sourceRoom: domain.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '-'),
      knowledge,
      creator: 'auto',
    });

    this.sys.pet.trackFeature('package_create');
    this.sys.memory.addDiaryEntry(`📦 自动创建能力包「${pkg.name}」，包含 ${pkg.knowledgeCount} 条知识`);

    this.evaluateAndVersion(pkg);

    try {
      const exportData = this.sys.skillExporter.export(pkg);
      this.sys.memory.setMemory('skill_export', pkg.domain, JSON.stringify(exportData), 1);
      if (this.verbose) console.log(`  [Skills] 已导出: ${pkg.domain}.skillmate`);
    } catch (err) { if (this.verbose) console.warn('[Skills] 导出失败:', (err as Error).message); }

    // 持久化到 STMP 记忆
    this.savePersisted();

    if (this.verbose) {
      console.log(`  [Skills] 创建能力包: ${domain} (${knowledge.length} 条知识)`);
    }
  }

  /** 评估能力包、初始化版本、生成雷达报告 */
  evaluateAndVersion(pkg: SkillPackage): void {
    try {
      const evalResult = this.sys.experienceEvaluator.quickEvaluate(pkg);
      if (this.verbose) {
        console.log(`  [Skills] 评估: ${pkg.domain} 综合 ${evalResult.overallScore}% (${evalResult.riskLevel} 风险, ${evalResult.passed ? '通过' : '未通过'})`);
      }
      pkg.qualityScore = evalResult.overallScore;
    } catch (err) { if (this.verbose) console.warn('[Skills] 评估失败:', (err as Error).message); }

    try { this.sys.skillVersionManager.initPackage(pkg); }
    catch (err) { if (this.verbose) console.warn('[Skills] 版本初始化失败:', (err as Error).message); }

    try {
      const report = this.sys.qualityRadar.generateReport(pkg);
      if (this.verbose) console.log(`  [Skills] 雷达: ${pkg.domain} 综合 ${report.overallScore} 分`);
    } catch (err) { if (this.verbose) console.warn('[Skills] 雷达报告失败:', (err as Error).message); }
  }

  /** 获取匹配用户消息的能力包 Prompt 注入 */
  getPromptInjection(content: string): string {
    try {
      const profiles = this.sys.cognitive.getAllDomainProfiles()
        .filter(p => p.growthStage !== 'seed');

      const matched: { domain: string; confidence: number; keywords: string[] }[] = [];
      for (const profile of profiles) {
        if (content.includes(profile.domain)) {
          matched.push({ domain: profile.domain, confidence: 0.9, keywords: [profile.domain] });
        }
      }

      if (matched.length === 0) return '';

      const result = this.sys.experienceScheduler.schedule(matched, content);
      if (result.hasPackage && result.promptInjection) {
        this.sys.pet.trackFeature('experience_compile');
        if (this.verbose) {
          console.log(`  [Skills] 注入: ${result.packages.map(p => p.domain).join(', ')} (策略: ${result.strategy})`);
        }
        return result.promptInjection;
      }
      return '';
    } catch (err) {
      if (this.verbose) console.warn('[Skills] 能力包调度失败:', (err as Error).message);
      return '';
    }
  }

  /** 检查所有能力包是否需要自动版本快照 */
  checkAutoSnapshots(): void {
    try {
      const allPkgs = this.sys.experiencePackageManager.listPackages();
      let hasSnapshot = false;
      for (const pkg of allPkgs) {
        const snapshot = this.sys.skillVersionManager.checkAutoSnapshot(pkg);
        if (snapshot) {
          hasSnapshot = true;
          if (this.verbose) {
            console.log(`  [Skills] 自动快照: ${pkg.domain} → v${snapshot.version}`);
          }
        }
      }
      // 有新快照时持久化
      if (hasSnapshot) this.savePersisted();
    } catch (err) { if (this.verbose) console.warn('[Skills] 快照检查失败:', (err as Error).message); }
  }
}
