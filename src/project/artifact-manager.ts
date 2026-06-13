/**
 * ArtifactManager — 产出物管理器
 *
 * 职责：
 * - 创建产出物
 * - 更新产出物（自动创建新版本）
 * - 版本管理（版本链 + diff）
 * - 列出产出物（每个 name 只返回最新版本）
 */

import { randomUUID } from 'crypto';
import type { ProjectStore } from './store.js';
import type { Artifact } from './types.js';

export class ArtifactManager {
  constructor(private store: ProjectStore) {}

  /**
   * 创建产出物
   */
  create(params: {
    projectId: string;
    planId?: string;
    name: string;
    type: Artifact['type'];
    path?: string;
    content?: string;
    createdBy?: string;
    metadata?: Record<string, unknown>;
  }): Artifact {
    const now = Date.now();
    const artifact: Artifact = {
      id: `art_${randomUUID().slice(0, 8)}`,
      projectId: params.projectId,
      planId: params.planId,
      name: params.name,
      type: params.type,
      path: params.path,
      content: params.content,
      version: 1,
      createdBy: params.createdBy ?? 'agent',
      createdAt: now,
      metadata: params.metadata ?? {},
    };

    this.store.createArtifact(artifact);
    return artifact;
  }

  /**
   * 更新产出物（自动创建新版本）
   */
  update(
    artifactId: string,
    changes: {
      content?: string;
      path?: string;
      metadata?: Record<string, unknown>;
    },
  ): Artifact {
    const existing = this.store.getArtifact(artifactId);
    if (!existing) throw new Error(`Artifact not found: ${artifactId}`);

    // 获取最新版本号
    const versions = this.store.getArtifactVersions(existing.projectId, existing.name);
    const latestVersion = versions.length > 0 ? Math.max(...versions.map(v => v.version)) : 0;

    const newArtifact: Artifact = {
      id: `art_${randomUUID().slice(0, 8)}`,
      projectId: existing.projectId,
      planId: existing.planId,
      name: existing.name,
      type: existing.type,
      path: changes.path ?? existing.path,
      content: changes.content ?? existing.content,
      version: latestVersion + 1,
      parentVersionId: existing.id,
      createdBy: existing.createdBy,
      createdAt: Date.now(),
      metadata: changes.metadata ?? existing.metadata,
    };

    this.store.createArtifact(newArtifact);
    return newArtifact;
  }

  /**
   * 获取产出物的所有版本
   */
  getVersions(projectId: string, name: string): Artifact[] {
    return this.store.getArtifactVersions(projectId, name);
  }

  /**
   * 获取最新版本
   */
  getLatest(projectId: string, name: string): Artifact | null {
    const versions = this.store.getArtifactVersions(projectId, name);
    return versions.length > 0 ? versions[versions.length - 1] : null;
  }

  /**
   * 按项目列出所有产出物（每个 name 只返回最新版本）
   */
  listLatest(projectId: string, type?: string): Artifact[] {
    const all = this.store.listArtifacts(projectId, type);

    // 按 name 分组，取最新版本
    const byName = new Map<string, Artifact>();
    for (const art of all) {
      const existing = byName.get(art.name);
      if (!existing || art.version > existing.version) {
        byName.set(art.name, art);
      }
    }

    return Array.from(byName.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 版本间 diff（文本类产出物）
   */
  diff(artifactIdA: string, artifactIdB: string): {
    nameA: string;
    versionA: number;
    nameB: string;
    versionB: number;
    contentChanged: boolean;
    pathChanged: boolean;
    metadataChanged: boolean;
    summary: string;
  } {
    const a = this.store.getArtifact(artifactIdA);
    const b = this.store.getArtifact(artifactIdB);
    if (!a) throw new Error(`Artifact not found: ${artifactIdA}`);
    if (!b) throw new Error(`Artifact not found: ${artifactIdB}`);

    const contentChanged = a.content !== b.content;
    const pathChanged = a.path !== b.path;
    const metadataChanged = JSON.stringify(a.metadata) !== JSON.stringify(b.metadata);

    const parts: string[] = [];
    if (contentChanged) parts.push('内容已变更');
    if (pathChanged) parts.push(`路径: ${a.path ?? '(无)'} → ${b.path ?? '(无)'}`);
    if (metadataChanged) parts.push('元数据已变更');

    return {
      nameA: a.name,
      versionA: a.version,
      nameB: b.name,
      versionB: b.version,
      contentChanged,
      pathChanged,
      metadataChanged,
      summary: parts.length > 0 ? parts.join(' | ') : '无变更',
    };
  }

  /**
   * 删除产出物（所有版本）
   */
  deleteAll(projectId: string, name: string): number {
    const versions = this.store.getArtifactVersions(projectId, name);
    for (const v of versions) {
      this.store.deleteArtifact(v.id);
    }
    return versions.length;
  }
}
