/**
 * 能力包版本管理
 * 自动版本 / 快照 / 回滚
 */

import type { SkillPackage, KnowledgeNode } from './package.js';

export interface PackageVersion {
  version: string;          // 语义化版本，如 1.0.0
  packageId: string;
  knowledgeCount: number;
  qualityScore: number;
  snapshot: string;         // 包的 JSON 快照（压缩后）
  changeDescription: string;
  createdAt: number;
}

export interface VersionDiff {
  added: number;
  removed: number;
  modified: number;
  qualityDelta: number;
}

/**
 * 基于知识量变化的自动版本管理
 * 每增加 50+ 条知识自动创建版本
 */
export class ExperienceVersionManager {
  private versions: Map<string, PackageVersion[]> = new Map(); // packageId → versions
  private autoSnapshotThreshold = 50; // 每增加 50 条自动快照

  /** 初始化包的版本管理 */
  initPackage(pkg: SkillPackage): void {
    const existing = this._getVersions(pkg.id);
    if (existing.length > 0) return; // 已有版本记录则跳过

    const initialVersion: PackageVersion = {
      version: '1.0.0',
      packageId: pkg.id,
      knowledgeCount: pkg.knowledgeCount,
      qualityScore: pkg.qualityScore,
      snapshot: JSON.stringify(pkg),
      changeDescription: '初始版本',
      createdAt: pkg.createdAt,
    };

    this.versions.set(pkg.id, [initialVersion]);
  }

  /** 检查是否需要自动创建版本 */
  checkAutoSnapshot(pkg: SkillPackage): PackageVersion | null {
    const versions = this._getVersions(pkg.id);
    const lastVersion = versions[versions.length - 1];

    if (!lastVersion) {
      this.initPackage(pkg);
      return null;
    }

    const knowledgeDelta = pkg.knowledgeCount - lastVersion.knowledgeCount;

    if (knowledgeDelta >= this.autoSnapshotThreshold) {
      return this.createSnapshot(pkg, `自动快照：新增 ${knowledgeDelta} 条知识`);
    }

    return null;
  }

  /** 手动创建版本快照 */
  createSnapshot(pkg: SkillPackage, description: string): PackageVersion {
    const versions = this._getVersions(pkg.id);
    const lastVersion = versions[versions.length - 1];
    const newVersionStr = this._bumpVersion(
      lastVersion?.version ?? '1.0.0',
      pkg.knowledgeCount - (lastVersion?.knowledgeCount ?? 0),
    );

    const version: PackageVersion = {
      version: newVersionStr,
      packageId: pkg.id,
      knowledgeCount: pkg.knowledgeCount,
      qualityScore: pkg.qualityScore,
      snapshot: JSON.stringify(pkg),
      changeDescription: description,
      createdAt: Date.now(),
    };

    versions.push(version);
    return version;
  }

  /** 获取包的所有版本 */
  getVersions(packageId: string): PackageVersion[] {
    return [...this._getVersions(packageId)];
  }

  /** 获取指定版本 */
  getVersion(packageId: string, version: string): PackageVersion | undefined {
    return this._getVersions(packageId).find(v => v.version === version);
  }

  /** 获取最新版本 */
  getLatestVersion(packageId: string): PackageVersion | undefined {
    const versions = this._getVersions(packageId);
    return versions[versions.length - 1];
  }

  /** 回滚到指定版本 */
  rollback(packageId: string, version: string): SkillPackage {
    const target = this.getVersion(packageId, version);
    if (!target) throw new Error(`版本 "${version}" 不存在`);

    const pkg = JSON.parse(target.snapshot) as SkillPackage;
    pkg.updatedAt = Date.now();

    // 记录回滚操作
    this.createSnapshot(pkg, `回滚到版本 ${version}`);

    return pkg;
  }

  /** 对比两个版本的差异 */
  diff(packageId: string, versionA: string, versionB: string): VersionDiff {
    const a = this.getVersion(packageId, versionA);
    const b = this.getVersion(packageId, versionB);

    if (!a || !b) throw new Error('版本不存在');

    const pkgA = JSON.parse(a.snapshot) as SkillPackage;
    const pkgB = JSON.parse(b.snapshot) as SkillPackage;

    const idsA = new Set(pkgA.knowledge.map(k => k.id));
    const idsB = new Set(pkgB.knowledge.map(k => k.id));

    let added = 0;
    let removed = 0;
    let modified = 0;

    for (const id of idsB) {
      if (!idsA.has(id)) added++;
    }
    for (const id of idsA) {
      if (!idsB.has(id)) removed++;
    }
    // 简化：同时存在的算 modified
    for (const id of idsA) {
      if (idsB.has(id)) modified++;
    }

    return {
      added,
      removed,
      modified,
      qualityDelta: pkgB.qualityScore - pkgA.qualityScore,
    };
  }

  /** 获取版本历史摘要 */
  getHistorySummary(packageId: string): string {
    const versions = this._getVersions(packageId);
    if (versions.length === 0) return '无版本记录';

    let summary = `📦 ${packageId} — ${versions.length} 个版本\n\n`;

    for (const v of versions) {
      const date = new Date(v.createdAt).toLocaleString('zh-CN');
      summary += `  v${v.version} — ${date}\n`;
      summary += `    ${v.changeDescription}\n`;
      summary += `    知识: ${v.knowledgeCount} 条 | 质量: ${v.qualityScore}%\n\n`;
    }

    return summary;
  }

  /** 清除包的所有版本 */
  clearVersions(packageId: string): void {
    this.versions.delete(packageId);
  }

  /** 序列化所有版本数据为 JSON 字符串（用于持久化） */
  serialize(): string {
    const data: Record<string, PackageVersion[]> = {};
    for (const [id, vers] of this.versions) {
      data[id] = vers;
    }
    return JSON.stringify(data);
  }

  /** 从 JSON 字符串恢复版本数据 */
  deserialize(json: string): number {
    try {
      const data = JSON.parse(json) as Record<string, PackageVersion[]>;
      let count = 0;
      for (const [id, vers] of Object.entries(data)) {
        if (Array.isArray(vers)) {
          this.versions.set(id, vers);
          count += vers.length;
        }
      }
      return count;
    } catch {
      return 0;
    }
  }

  // ==================== 内部方法 ====================

  private _getVersions(packageId: string): PackageVersion[] {
    if (!this.versions.has(packageId)) {
      this.versions.set(packageId, []);
    }
    return this.versions.get(packageId)!;
  }

  private _bumpVersion(currentVersion: string, knowledgeDelta: number): string {
    const parts = currentVersion.split('.').map(Number);
    const [major, minor, patch] = parts;

    // >200 条知识升 major，>50 升 minor，其余升 patch
    if (knowledgeDelta > 200) return `${major + 1}.0.0`;
    if (knowledgeDelta > 50) return `${major}.${minor + 1}.0`;
    return `${major}.${minor}.${patch + 1}`;
  }
}
