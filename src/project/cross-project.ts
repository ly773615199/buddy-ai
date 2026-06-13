/**
 * CrossProjectManager — 跨项目管理器
 *
 * 职责：
 * - 查找相似项目（基于 category/tags/requirements/technology）
 * - 注入历史教训到新项目
 * - 跨项目经验摘要
 */

import type { ProjectStore } from './store.js';
import type { Project, Lesson, SimilarProject } from './types.js';

export class CrossProjectManager {
  constructor(private store: ProjectStore) {}

  /**
   * 查找相似项目
   */
  findSimilarProjects(
    projectId: string,
    options?: { limit?: number; minSimilarity?: number },
  ): SimilarProject[] {
    const project = this.store.getProject(projectId);
    if (!project) return [];

    const allProjects = this.store.listProjects();
    const limit = options?.limit ?? 5;
    const minSimilarity = options?.minSimilarity ?? 0.1;

    const results: SimilarProject[] = [];

    for (const other of allProjects) {
      if (other.id === projectId) continue;

      const similarity = calcProjectSimilarity(project, other);
      if (similarity < minSimilarity) continue;

      // 获取相关教训
      const relevantLessons = this.store.getLessons(other.id);

      results.push({
        project: other,
        similarity,
        matchedBy: this.getMatchType(project, other),
        relevantLessons,
      });
    }

    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * 注入历史教训到项目
   */
  injectLessons(
    projectId: string,
    options?: {
      categories?: string[];
      minImpact?: Lesson['impact'];
      limit?: number;
    },
  ): {
    injected: Lesson[];
    sourceProjects: string[];
  } {
    const similar = this.findSimilarProjects(projectId, { limit: 5 });
    const limit = options?.limit ?? 10;
    const impactOrder: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
    const minImpactLevel = impactOrder[options?.minImpact ?? 'low'] ?? 0;

    const injected: Lesson[] = [];
    const sourceProjects = new Set<string>();

    for (const sp of similar) {
      for (const lesson of sp.relevantLessons) {
        if (injected.length >= limit) break;

        // 过滤类别
        if (options?.categories && !options.categories.includes(lesson.category)) continue;

        // 过滤影响
        if (impactOrder[lesson.impact] < minImpactLevel) continue;

        // 创建教训副本关联到目标项目
        const copy: Lesson = {
          ...lesson,
          id: `les_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          projectId,
          createdAt: Date.now(),
          verified: false,
        };

        this.store.createLesson(copy);
        injected.push(copy);
        sourceProjects.add(sp.project.id);
      }
    }

    return {
      injected,
      sourceProjects: Array.from(sourceProjects),
    };
  }

  /**
   * 获取跨项目经验摘要（用于 LLM prompt 注入）
   */
  getCrossProjectContext(projectId: string, focus?: string): string {
    const similar = this.findSimilarProjects(projectId, { limit: 3 });
    if (similar.length === 0) return '';

    const lines = ['[跨项目经验参考]\n'];

    for (const sp of similar) {
      const matchInfo = `匹配度 ${(sp.similarity * 100).toFixed(0)}% (${sp.matchedBy})`;
      lines.push(`项目: ${sp.project.name} [${sp.project.category}] - ${matchInfo}`);

      if (sp.relevantLessons.length > 0) {
        lines.push('相关教训:');
        for (const l of sp.relevantLessons.slice(0, 3)) {
          lines.push(`  - [${l.category}/${l.impact}] ${l.title}: ${l.description}`);
          if (l.correction) lines.push(`    修正: ${l.correction}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 按行业分类统计教训
   */
  getLessonsByCategory(): Record<string, Lesson[]> {
    const allProjects = this.store.listProjects();
    const result: Record<string, Lesson[]> = {};

    for (const project of allProjects) {
      const lessons = this.store.getLessons(project.id);
      if (lessons.length === 0) continue;

      const category = project.category;
      if (!result[category]) result[category] = [];
      result[category].push(...lessons);
    }

    return result;
  }

  private getMatchType(a: Project, b: Project): SimilarProject['matchedBy'] {
    if (a.category === b.category) return 'category';
    const tagsA = new Set(a.tags);
    if (b.tags.some(t => tagsA.has(t))) return 'tags';
    return 'requirements';
  }
}

// ==================== 相似度算法 ====================

function calcProjectSimilarity(a: Project, b: Project): number {
  let score = 0;

  // 1. category 匹配 (权重 0.3)
  if (a.category === b.category) score += 0.3;

  // 2. tags 重叠 (权重 0.3)
  const tagsA = new Set(a.tags);
  const tagsB = new Set(b.tags);
  const tagOverlap = [...tagsA].filter(t => tagsB.has(t)).length;
  const tagUnion = new Set([...tagsA, ...tagsB]).size;
  score += tagUnion > 0 ? (tagOverlap / tagUnion) * 0.3 : 0;

  // 3. requirements 关键词重叠 (权重 0.3)
  const kwA = extractKeywords(a.requirements.map(r => r.title + ' ' + r.description));
  const kwB = extractKeywords(b.requirements.map(r => r.title + ' ' + r.description));
  const kwOverlap = [...kwA].filter(k => kwB.has(k)).length;
  const kwUnion = new Set([...kwA, ...kwB]).size;
  score += kwUnion > 0 ? (kwOverlap / kwUnion) * 0.3 : 0;

  // 4. metadata 中的 technology 匹配 (权重 0.1)
  const techA = (a.metadata.technologies as string[]) ?? [];
  const techB = (b.metadata.technologies as string[]) ?? [];
  const techOverlap = techA.filter(t => techB.includes(t)).length;
  score += techA.length > 0 ? (techOverlap / Math.max(techA.length, techB.length)) * 0.1 : 0;

  return Math.min(1, score);
}

function extractKeywords(texts: string[]): Set<string> {
  const stopWords = new Set(['的', '是', '在', '了', '和', '与', 'a', 'an', 'the', 'is', 'are', 'to', 'for', 'of']);
  const words = new Set<string>();

  for (const text of texts) {
    const tokens = text.toLowerCase().split(/[\s,.\-_/]+/).filter(t => t.length > 1 && !stopWords.has(t));
    for (const t of tokens) words.add(t);
  }

  return words;
}
