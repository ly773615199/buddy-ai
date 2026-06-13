/**
 * ProjectSearch — 全文搜索封装
 *
 * 基于 FTS5 的跨项目/决策/教训/产出物全文搜索。
 * 底层已由 ProjectStore 的 search/indexForSearch 实现，
 * 此模块提供高级搜索功能。
 */

import type { ProjectStore } from './store.js';
import type { SearchResult } from './types.js';

export class ProjectSearch {
  constructor(private store: ProjectStore) {}

  /**
   * 全文搜索
   */
  search(query: string, options?: {
    entityTypes?: string[];
    projectId?: string;
    limit?: number;
  }): SearchResult[] {
    return this.store.search(query, options);
  }

  /**
   * 搜索并格式化为可读文本
   */
  searchFormatted(query: string, options?: {
    entityTypes?: string[];
    projectId?: string;
    limit?: number;
  }): string {
    const results = this.search(query, options);

    if (results.length === 0) return `🔍 未找到 "${query}" 的相关结果`;

    const lines = [`🔍 搜索 "${query}" (${results.length} 条结果):\n`];

    const typeIcon: Record<string, string> = {
      project: '📁',
      plan: '📋',
      decision: '💡',
      lesson: '📝',
      artifact: '📦',
    };

    for (const r of results) {
      const icon = typeIcon[r.entityType] ?? '📄';
      lines.push(`${icon} [${r.entityType}] ${r.title}`);
      if (r.snippet) lines.push(`   ${r.snippet.replace(/<[^>]+>/g, '')}`);
      lines.push(`   ID: ${r.entityId} | 项目: ${r.projectId}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 重建所有索引
   */
  rebuildIndex(): void {
    // 清空 FTS 索引
    this.store.clearFTSIndex();

    // 重建项目索引
    const projects = this.store.listProjects();
    for (const p of projects) {
      this.store.indexForSearch('project', p.id, p.name, p.description, p.tags, p.id);

      // 重建方案索引
      const plans = this.store.getPlanVersions(p.id);
      for (const plan of plans) {
        this.store.indexForSearch('plan', plan.id, plan.title, plan.description, [], p.id);
      }

      // 重建教训索引
      const lessons = this.store.getLessons(p.id);
      for (const lesson of lessons) {
        this.store.indexForSearch('lesson', lesson.id, lesson.title, lesson.description, lesson.applicableCategories, p.id);
      }

      // 重建产出物索引
      const artifacts = this.store.listArtifacts(p.id);
      for (const art of artifacts) {
        this.store.indexForSearch('artifact', art.id, art.name, art.content ?? '', [], p.id);
      }
    }
  }
}
