/**
 * RoutineLearner — 从对话历史中学习主人的日常规律
 *
 * 不是硬编码规则，而是统计发现模式。
 * 算法：
 *   1. 按小时统计对话频率 → 发现活跃时段
 *   2. 按星期统计 → 发现工作日/周末差异
 *   3. 时段聚类 → 合并相邻活跃小时为时段
 *   4. 增量更新 → 新对话后微调，不需要重算全部
 */

import type { UserRoutine } from '../types.js';
import type { MemoryStore } from '../memory/store.js';
import * as fs from 'fs';
import * as path from 'path';

// ==================== 类型 ====================

interface HourlyBucket {
  hour: number;
  count: number;
  weekdays: Map<number, number>;  // weekday → count
  topics: string[];
  channels: Map<string, number>;  // channel → count
}

interface ActivePeriod {
  start: number;
  end: number;
  confidence: number;
  weekdays: number[];
  totalMessages: number;
}

// ==================== 工具函数 ====================

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** 从消息内容粗略提取话题关键词 */
function extractTopics(content: string): string[] {
  const topics: string[] = [];
  // 编程语言 / 框架
  const techWords = content.match(/\b(typescript|javascript|python|rust|react|vue|node|docker|git|sql|api|bug|fix|deploy|test|code|refactor)\b/gi);
  if (techWords) topics.push(...techWords.map(w => w.toLowerCase()));
  // 日常
  const lifeWords = content.match(/\b(早|晚安|吃饭|休息|加班|开会|面试|周报|日报|健身|跑步|睡觉|咖啡|外卖)\b/g);
  if (lifeWords) topics.push(...lifeWords);
  return [...new Set(topics)].slice(0, 8);
}

/** 根据时段和话题猜测规律名称 */
function guessRoutineName(period: ActivePeriod, topics: string[]): string {
  const hour = period.start;
  const topicStr = topics.join(' ');
  if (hour >= 6 && hour < 9) return 'morning_routine';
  if (hour >= 9 && hour < 12) return 'morning_work';
  if (hour >= 12 && hour < 14) return 'lunch_break';
  if (hour >= 14 && hour < 18) return 'afternoon_work';
  if (hour >= 18 && hour < 20) return 'evening_transition';
  if (hour >= 20 && hour < 23) return 'evening_coding';
  if (hour >= 23 || hour < 6) return 'late_night';
  if (topicStr.includes('开会')) return 'meeting_time';
  if (topicStr.includes('周报')) return 'weekly_report';
  return `routine_${hour}`;
}

// ==================== RoutineLearner ====================

export class RoutineLearner {
  private memory: MemoryStore;
  private routines: UserRoutine[] = [];
  private persistPath: string;

  constructor(memory: MemoryStore, dataDir: string) {
    this.memory = memory;
    this.persistPath = path.join(dataDir, 'routines.json');
    this._load();
  }

  /**
   * 分析最近 N 天的对话，提取日常模式
   */
  analyzeHistory(days = 14): UserRoutine[] {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    // MemoryStore.getRecentMessages 最多取最近的，我们多取一些
    const messages = this.memory.getRecentMessages(5000)
      .filter(m => m.timestamp > cutoff && m.role === 'user');

    if (messages.length < 10) {
      // 数据太少，不生成规律
      return this.routines;
    }

    // 1. 按小时填充 bucket
    const buckets: HourlyBucket[] = Array.from({ length: 24 }, (_, i) => ({
      hour: i, count: 0, weekdays: new Map(), topics: [], channels: new Map(),
    }));

    for (const msg of messages) {
      const d = new Date(msg.timestamp);
      const hour = d.getHours();
      const weekday = d.getDay();
      const bucket = buckets[hour];

      bucket.count++;
      bucket.weekdays.set(weekday, (bucket.weekdays.get(weekday) ?? 0) + 1);
      bucket.topics.push(...extractTopics(msg.content));
    }

    // 2. 计算平均活跃度，找出高活跃时段
    const totalCount = messages.length;
    const avgPerHour = totalCount / 24;
    const threshold = Math.max(avgPerHour * 1.2, 3); // 至少高于均值 20%，且绝对值 >= 3

    const activeHours = buckets.filter(b => b.count >= threshold);

    // 3. 合并相邻活跃小时为时段
    const periods = this._mergeAdjacentHours(activeHours, buckets);

    // 4. 生成 UserRoutine
    this.routines = periods.map((period, i) => {
      // 收集该时段内所有话题
      const periodTopics: string[] = [];
      const weekdayCounts = new Map<number, number>();
      for (let h = period.start; h !== period.end; h = (h + 1) % 24) {
        periodTopics.push(...buckets[h].topics);
        for (const [wd, c] of buckets[h].weekdays) {
          weekdayCounts.set(wd, (weekdayCounts.get(wd) ?? 0) + c);
        }
      }

      // 找出最常见的工作日（出现次数 > 时段总消息的 30%）
      const commonWeekdays = [...weekdayCounts.entries()]
        .filter(([, c]) => c > period.totalMessages * 0.3)
        .map(([wd]) => wd)
        .sort();

      const topicCounts = new Map<string, number>();
      for (const t of periodTopics) {
        topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1);
      }
      const topTopics = [...topicCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([t]) => t);

      return {
        id: `routine_${i}_${period.start}_${period.end}`,
        name: guessRoutineName(period, topTopics),
        typicalStart: { hour: period.start, minute: 0, confidence: period.confidence },
        typicalEnd: { hour: period.end, minute: 0, confidence: period.confidence },
        weekdays: commonWeekdays,
        commonTopics: topTopics,
        preferredChannel: 'auto',
        moodTrend: 'neutral',
        observations: period.totalMessages,
        lastSeen: Date.now(),
      };
    });

    this._save();
    return this.routines;
  }

  /**
   * 增量更新：每次新对话后微调规律
   */
  updateWithNewConversation(timestamp: number, content: string): void {
    const hour = new Date(timestamp).getHours();
    const matched = this.routines.find(r => {
      if (r.typicalStart.hour <= r.typicalEnd.hour) {
        return hour >= r.typicalStart.hour && hour < r.typicalEnd.hour;
      }
      // 跨午夜
      return hour >= r.typicalStart.hour || hour < r.typicalEnd.hour;
    });

    if (matched) {
      matched.observations++;
      matched.lastSeen = timestamp;
      // 贝叶斯更新置信度
      matched.typicalStart.confidence = clamp(matched.typicalStart.confidence + 0.01, 0, 1);
      matched.typicalEnd.confidence = clamp(matched.typicalEnd.confidence + 0.01, 0, 1);

      // 更新话题
      const newTopics = extractTopics(content);
      for (const t of newTopics) {
        if (!matched.commonTopics.includes(t)) {
          matched.commonTopics.push(t);
          if (matched.commonTopics.length > 8) matched.commonTopics.shift();
        }
      }
      this._save();
    }
  }

  /**
   * 获取当前时间匹配的规律
   */
  getCurrentMatch(now = Date.now()): UserRoutine | null {
    const hour = new Date(now).getHours();
    const weekday = new Date(now).getDay();

    return this.routines.find(r => {
      const hourMatch = r.typicalStart.hour <= r.typicalEnd.hour
        ? (hour >= r.typicalStart.hour && hour < r.typicalEnd.hour)
        : (hour >= r.typicalStart.hour || hour < r.typicalEnd.hour);
      const weekdayMatch = r.weekdays.length === 0 || r.weekdays.includes(weekday);
      return hourMatch && weekdayMatch;
    }) ?? null;
  }

  /** 获取所有已学习的规律 */
  getRoutines(): UserRoutine[] {
    return [...this.routines];
  }

  /** 获取规律数量 */
  get count(): number {
    return this.routines.length;
  }

  // ==================== 内部方法 ====================

  /** 合并相邻活跃小时为连续时段 */
  private _mergeAdjacentHours(activeHours: HourlyBucket[], allBuckets: HourlyBucket[]): ActivePeriod[] {
    if (activeHours.length === 0) return [];

    const activeSet = new Set(activeHours.map(b => b.hour));
    const periods: ActivePeriod[] = [];
    const visited = new Set<number>();

    for (const bucket of activeHours) {
      if (visited.has(bucket.hour)) continue;

      // 向后扩展
      let start = bucket.hour;
      let end = (bucket.hour + 1) % 24;
      let totalMessages = bucket.count;
      visited.add(bucket.hour);

      while (activeSet.has(end) && !visited.has(end)) {
        totalMessages += allBuckets[end].count;
        visited.add(end);
        end = (end + 1) % 24;
        if (end === start) break; // 全天活跃
      }

      // 计算置信度（基于消息密度）
      const spanHours = start <= end ? (end - start) : (24 - start + end);
      const density = totalMessages / Math.max(spanHours, 1);
      const confidence = clamp(density / 10, 0.3, 0.95);

      periods.push({ start, end, confidence, weekdays: [], totalMessages });
    }

    return periods.sort((a, b) => a.start - b.start);
  }

  /** 持久化 */
  private _save(): void {
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.persistPath, JSON.stringify(this.routines, null, 2), 'utf-8');
    } catch {
      // 静默失败
    }
  }

  /** 加载 */
  private _load(): void {
    try {
      if (fs.existsSync(this.persistPath)) {
        const data = fs.readFileSync(this.persistPath, 'utf-8');
        this.routines = JSON.parse(data) as UserRoutine[];
      }
    } catch {
      this.routines = [];
    }
  }
}
