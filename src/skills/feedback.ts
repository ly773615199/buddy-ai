/**
 * 能力包反馈学习器
 * 用户满意度评分 / 纠正信号 / 知识权重更新
 */

import type { SkillPackage, KnowledgeNode } from './package.js';

export interface FeedbackEntry {
  id: string;
  packageId: string;
  query: string;
  answer: string;
  rating: number;            // 1-5 星
  correctedAnswer?: string;  // 用户纠正
  helpfulKnowledge: string[];// 有用的知识节点 ID
  unhelpfulKnowledge: string[]; // 无用的知识节点 ID
  timestamp: number;
}

export interface FeedbackStats {
  totalFeedback: number;
  averageRating: number;
  ratingDistribution: number[]; // [1星数, 2星数, 3星数, 4星数, 5星数]
  correctionCount: number;
  topHelpedKnowledge: { id: string; helpCount: number }[];
  topHurtKnowledge: { id: string; hurtCount: number }[];
}

export class FeedbackLearner {
  private feedbacks: Map<string, FeedbackEntry[]> = new Map(); // packageId → entries
  private knowledgeScores: Map<string, { helped: number; hurted: number }> = new Map();

  /** 记录反馈 */
  recordFeedback(feedback: Omit<FeedbackEntry, 'id' | 'timestamp'>): FeedbackEntry {
    const entry: FeedbackEntry = {
      ...feedback,
      id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
    };

    const list = this.feedbacks.get(feedback.packageId) ?? [];
    list.push(entry);
    this.feedbacks.set(feedback.packageId, list);

    // 更新知识节点分数
    for (const kid of feedback.helpfulKnowledge) {
      const score = this.knowledgeScores.get(kid) ?? { helped: 0, hurted: 0 };
      score.helped++;
      this.knowledgeScores.set(kid, score);
    }
    for (const kid of feedback.unhelpfulKnowledge) {
      const score = this.knowledgeScores.get(kid) ?? { helped: 0, hurted: 0 };
      score.hurted++;
      this.knowledgeScores.set(kid, score);
    }

    return entry;
  }

  /** 根据反馈更新包中知识节点的权重 */
  applyFeedbackToPackage(pkg: SkillPackage): SkillPackage {
    for (const node of pkg.knowledge) {
      const score = this.knowledgeScores.get(node.id);
      if (!score) continue;

      const total = score.helped + score.hurted;
      if (total === 0) continue;

      // 根据反馈比例调整 importance
      const ratio = score.helped / total;
      node.importance = node.importance * 0.7 + ratio * 0.3;
      node.importance = Math.max(0.05, Math.min(1, node.importance));
    }

    return pkg;
  }

  /** 获取包的反馈统计 */
  getStats(packageId: string): FeedbackStats {
    const list = this.feedbacks.get(packageId) ?? [];

    const distribution = [0, 0, 0, 0, 0];
    let totalRating = 0;
    let corrections = 0;

    for (const fb of list) {
      distribution[fb.rating - 1]++;
      totalRating += fb.rating;
      if (fb.correctedAnswer) corrections++;
    }

    // 排序知识节点
    const helped = new Map<string, number>();
    const hurted = new Map<string, number>();

    for (const fb of list) {
      for (const kid of fb.helpfulKnowledge) {
        helped.set(kid, (helped.get(kid) ?? 0) + 1);
      }
      for (const kid of fb.unhelpfulKnowledge) {
        hurted.set(kid, (hurted.get(kid) ?? 0) + 1);
      }
    }

    const topHelped = Array.from(helped.entries())
      .map(([id, count]) => ({ id, helpCount: count }))
      .sort((a, b) => b.helpCount - a.helpCount)
      .slice(0, 10);

    const topHurt = Array.from(hurted.entries())
      .map(([id, count]) => ({ id, hurtCount: count }))
      .sort((a, b) => b.hurtCount - a.hurtCount)
      .slice(0, 10);

    return {
      totalFeedback: list.length,
      averageRating: list.length > 0 ? totalRating / list.length : 0,
      ratingDistribution: distribution,
      correctionCount: corrections,
      topHelpedKnowledge: topHelped,
      topHurtKnowledge: topHurt,
    };
  }

  /** 获取低评分反馈（用于改进） */
  getLowRatings(packageId: string, maxRating = 2): FeedbackEntry[] {
    const list = this.feedbacks.get(packageId) ?? [];
    return list.filter(fb => fb.rating <= maxRating);
  }

  /** 获取纠正记录 */
  getCorrections(packageId: string): FeedbackEntry[] {
    const list = this.feedbacks.get(packageId) ?? [];
    return list.filter(fb => !!fb.correctedAnswer);
  }

  /** 生成改进建议 */
  generateSuggestions(packageId: string): string[] {
    const stats = this.getStats(packageId);
    const suggestions: string[] = [];

    if (stats.averageRating < 3) {
      suggestions.push(`平均评分 ${stats.averageRating.toFixed(1)}/5，低于 3 分需要重点关注`);
    }

    if (stats.correctionCount > stats.totalFeedback * 0.2) {
      suggestions.push(`纠正率 ${((stats.correctionCount / stats.totalFeedback) * 100).toFixed(0)}%，知识准确性需要提升`);
    }

    for (const k of stats.topHurtKnowledge.slice(0, 3)) {
      suggestions.push(`知识节点 ${k.id} 被标记为无用 ${k.hurtCount} 次，建议审查或移除`);
    }

    if (stats.totalFeedback < 10) {
      suggestions.push('反馈数据不足（<10条），建议积累更多用户反馈');
    }

    return suggestions;
  }

  /** 导出反馈数据 */
  exportFeedback(packageId: string): string {
    const list = this.feedbacks.get(packageId) ?? [];
    return JSON.stringify(list, null, 2);
  }

  /** 获取所有包的反馈数 */
  getFeedbackCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const [pid, list] of this.feedbacks) {
      counts.set(pid, list.length);
    }
    return counts;
  }

  /** 清除包的反馈 */
  clearFeedback(packageId: string): void {
    this.feedbacks.delete(packageId);
  }

  /** 序列化所有反馈数据为 JSON 字符串（用于持久化） */
  serialize(): string {
    return JSON.stringify({
      feedbacks: [...this.feedbacks.entries()],
      knowledgeScores: [...this.knowledgeScores.entries()],
    });
  }

  /** 从 JSON 字符串恢复反馈数据 */
  deserialize(json: string): { feedbackCount: number; scoreCount: number } {
    try {
      const data = JSON.parse(json) as {
        feedbacks: [string, FeedbackEntry[]][];
        knowledgeScores: [string, { helped: number; hurted: number }][];
      };
      if (Array.isArray(data.feedbacks)) {
        for (const [pid, entries] of data.feedbacks) {
          this.feedbacks.set(pid, entries);
        }
      }
      if (Array.isArray(data.knowledgeScores)) {
        for (const [kid, score] of data.knowledgeScores) {
          this.knowledgeScores.set(kid, score);
        }
      }
      return {
        feedbackCount: data.feedbacks?.length ?? 0,
        scoreCount: data.knowledgeScores?.length ?? 0,
      };
    } catch {
      return { feedbackCount: 0, scoreCount: 0 };
    }
  }
}
