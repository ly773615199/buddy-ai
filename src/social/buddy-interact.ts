/**
 * 精灵互动系统
 * 串门 / 对话 / 合影 / 排行榜
 */

export interface BuddyProfile {
  id: string;
  name: string;
  species: string;
  level: number;
  stage: string;           // 进化阶段
  attributes: Record<string, number>;
  ownerId: string;
  ownerName: string;
}

export interface BuddyVisit {
  id: string;
  guest: BuddyProfile;
  host: BuddyProfile;
  startTime: number;
  endTime?: number;
  interactions: VisitInteraction[];
}

export interface VisitInteraction {
  type: 'greet' | 'play' | 'chat' | 'gift' | 'photo';
  content: string;
  timestamp: number;
}

export interface BuddyConversation {
  id: string;
  buddyA: BuddyProfile;
  buddyB: BuddyProfile;
  messages: { from: string; content: string; timestamp: number }[];
  topic?: string;
  startTime: number;
  endTime?: number;
}

export interface LeaderboardEntry {
  rank: number;
  buddyId: string;
  buddyName: string;
  ownerName: string;
  score: number;
  metric: string;
}

export type LeaderboardMetric = 'level' | 'interactions' | 'achievements' | 'knowledge_packages';

export class BuddyInteractionSystem {
  private visits: Map<string, BuddyVisit> = new Map();
  private conversations: Map<string, BuddyConversation> = new Map();
  private leaderboard: Map<LeaderboardMetric, LeaderboardEntry[]> = new Map();

  // ==================== 串门系统 ====================

  /** 开始串门 */
  startVisit(guest: BuddyProfile, host: BuddyProfile): BuddyVisit {
    const visit: BuddyVisit = {
      id: `visit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      guest,
      host,
      startTime: Date.now(),
      interactions: [],
    };

    visit.interactions.push({
      type: 'greet',
      content: `${guest.name} 来到了 ${host.name} 的屏幕前！`,
      timestamp: Date.now(),
    });

    this.visits.set(visit.id, visit);
    return visit;
  }

  /** 串门互动 */
  interact(visitId: string, type: VisitInteraction['type'], content: string): VisitInteraction | null {
    const visit = this.visits.get(visitId);
    if (!visit || visit.endTime) return null;

    const interaction: VisitInteraction = { type, content, timestamp: Date.now() };
    visit.interactions.push(interaction);
    return interaction;
  }

  /** 结束串门 */
  endVisit(visitId: string): BuddyVisit | null {
    const visit = this.visits.get(visitId);
    if (!visit) return null;
    visit.endTime = Date.now();
    return visit;
  }

  /** 获取活跃串门 */
  getActiveVisits(): BuddyVisit[] {
    return Array.from(this.visits.values()).filter(v => !v.endTime);
  }

  // ==================== 精灵对话 ====================

  /** 开始精灵对话 */
  startConversation(buddyA: BuddyProfile, buddyB: BuddyProfile, topic?: string): BuddyConversation {
    const conv: BuddyConversation = {
      id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      buddyA,
      buddyB,
      messages: [],
      topic,
      startTime: Date.now(),
    };

    this.conversations.set(conv.id, conv);
    return conv;
  }

  /** 添加对话消息 */
  addMessage(conversationId: string, fromBuddyId: string, content: string): void {
    const conv = this.conversations.get(conversationId);
    if (!conv || conv.endTime) return;

    conv.messages.push({ from: fromBuddyId, content, timestamp: Date.now() });
  }

  /** 结束对话 */
  endConversation(conversationId: string): BuddyConversation | null {
    const conv = this.conversations.get(conversationId);
    if (!conv) return null;
    conv.endTime = Date.now();
    return conv;
  }

  /** 获取对话历史 */
  getConversation(conversationId: string): BuddyConversation | undefined {
    return this.conversations.get(conversationId);
  }

  // ==================== 合影 ====================

  /** 生成合影数据 */
  generatePhotoData(buddies: BuddyProfile[]): {
    participants: string[];
    timestamp: number;
    caption: string;
  } {
    const names = buddies.map(b => b.name);
    return {
      participants: names,
      timestamp: Date.now(),
      caption: `${names.join(' 和 ')} 的合影 📸`,
    };
  }

  // ==================== 排行榜 ====================

  /** 更新排行榜 */
  updateLeaderboard(metric: LeaderboardMetric, entries: Omit<LeaderboardEntry, 'rank' | 'metric'>[]): void {
    const sorted = entries
      .sort((a, b) => b.score - a.score)
      .map((e, i) => ({ ...e, rank: i + 1, metric }));

    this.leaderboard.set(metric, sorted);
  }

  /** 获取排行榜 */
  getLeaderboard(metric: LeaderboardMetric, limit = 20): LeaderboardEntry[] {
    return (this.leaderboard.get(metric) ?? []).slice(0, limit);
  }

  /** 获取用户排名 */
  getRank(metric: LeaderboardMetric, buddyId: string): number {
    const board = this.leaderboard.get(metric) ?? [];
    const entry = board.find(e => e.buddyId === buddyId);
    return entry?.rank ?? -1;
  }

  /** 获取所有排行榜指标 */
  getAvailableMetrics(): LeaderboardMetric[] {
    return ['level', 'interactions', 'achievements', 'knowledge_packages'];
  }

  /** 清理 */
  destroy(): void {
    this.visits.clear();
    this.conversations.clear();
    this.leaderboard.clear();
  }
}
