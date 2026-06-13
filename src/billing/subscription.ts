/**
 * 订阅管理
 * Free / Pro / Team 三级订阅 + 状态管理
 * SQLite 持久化
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { runMigrations, type Migration } from '../core/migration.js';

const SUBSCRIPTION_MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: '初始化订阅表结构',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS subscriptions (
          id TEXT PRIMARY KEY,
          userId TEXT UNIQUE NOT NULL,
          tier TEXT NOT NULL,
          status TEXT NOT NULL,
          startDate INTEGER NOT NULL,
          endDate INTEGER NOT NULL,
          trialEndsAt INTEGER,
          autoRenew INTEGER NOT NULL DEFAULT 1,
          paymentMethod TEXT,
          metadata TEXT DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS usage_counters (
          userId TEXT NOT NULL,
          date TEXT NOT NULL,
          messages INTEGER NOT NULL DEFAULT 0,
          generations INTEGER NOT NULL DEFAULT 0,
          extractions INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (userId, date)
        );
      `);
    },
  },
];

// ── 类型定义 ──

export type PlanTier = 'free' | 'pro' | 'team';
export type SubscriptionStatus = 'active' | 'canceled' | 'expired' | 'trial' | 'past_due';

export interface PlanLimits {
  maxPets: number;
  dailyMessages: number;
  dailyGenerations: number;
  maxSkillPackages: number;
  knowledgeExtractionsPerMonth: number;
  canSharePackages: boolean;
  canUseCloudRetrieval: boolean;
  availableStyles: string[];
  customVoices: boolean;
}

export interface Subscription {
  id: string;
  userId: string;
  tier: PlanTier;
  status: SubscriptionStatus;
  startDate: number;
  endDate: number;
  trialEndsAt?: number;
  autoRenew: boolean;
  paymentMethod?: PaymentMethodInfo;
  metadata: Record<string, unknown>;
}

export interface PaymentMethodInfo {
  type: 'stripe' | 'alipay' | 'wechat' | 'none';
  last4?: string;
  expiryMonth?: number;
  expiryYear?: number;
}

// ── 计划定义 ──

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    maxPets: 3,
    dailyMessages: 20,
    dailyGenerations: 3,
    maxSkillPackages: 3,
    knowledgeExtractionsPerMonth: 50,
    canSharePackages: false,
    canUseCloudRetrieval: false,
    availableStyles: ['pixel', 'cartoon', 'watercolor', 'chibi'],
    customVoices: false,
  },
  pro: {
    maxPets: 20,
    dailyMessages: -1,
    dailyGenerations: -1,
    maxSkillPackages: -1,
    knowledgeExtractionsPerMonth: -1,
    canSharePackages: true,
    canUseCloudRetrieval: true,
    availableStyles: ['*'],
    customVoices: true,
  },
  team: {
    maxPets: 50,
    dailyMessages: -1,
    dailyGenerations: -1,
    maxSkillPackages: -1,
    knowledgeExtractionsPerMonth: -1,
    canSharePackages: true,
    canUseCloudRetrieval: true,
    availableStyles: ['*'],
    customVoices: true,
  },
};

export const PLAN_PRICING: Record<PlanTier, { monthly: number; yearly: number; currency: string }> = {
  free: { monthly: 0, yearly: 0, currency: 'CNY' },
  pro: { monthly: 9, yearly: 89, currency: 'CNY' },
  team: { monthly: 29, yearly: 279, currency: 'CNY' },
};

// ── 主类 ──

export class SubscriptionManager {
  private db: Database.Database;
  private subscriptions = new Map<string, Subscription>();
  private usageCounters = new Map<string, { date: string; messages: number; generations: number; extractions: number }>();

  constructor(dbPath?: string) {
    if (dbPath) {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL');
    } else {
      this.db = new Database(':memory:');
      this.db.pragma('journal_mode = WAL');
    }
    runMigrations(this.db, 'subscription', SUBSCRIPTION_MIGRATIONS);
    this._loadAll();
  }

  private _loadAll(): void {
    const rows = this.db.prepare('SELECT * FROM subscriptions').all() as Array<{
      id: string; userId: string; tier: string; status: string;
      startDate: number; endDate: number; trialEndsAt: number | null;
      autoRenew: number; paymentMethod: string | null; metadata: string;
    }>;
    for (const r of rows) {
      const sub: Subscription = {
        id: r.id,
        userId: r.userId,
        tier: r.tier as PlanTier,
        status: r.status as SubscriptionStatus,
        startDate: r.startDate,
        endDate: r.endDate,
        trialEndsAt: r.trialEndsAt ?? undefined,
        autoRenew: !!r.autoRenew,
        paymentMethod: r.paymentMethod ? JSON.parse(r.paymentMethod) : undefined,
        metadata: JSON.parse(r.metadata || '{}'),
      };
      this.subscriptions.set(r.userId, sub);
    }
  }

  private _saveSub(sub: Subscription): void {
    this.db.prepare(`INSERT OR REPLACE INTO subscriptions
      (id, userId, tier, status, startDate, endDate, trialEndsAt, autoRenew, paymentMethod, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      sub.id, sub.userId, sub.tier, sub.status, sub.startDate, sub.endDate,
      sub.trialEndsAt ?? null, sub.autoRenew ? 1 : 0,
      sub.paymentMethod ? JSON.stringify(sub.paymentMethod) : null,
      JSON.stringify(sub.metadata),
    );
  }

  /** 创建订阅 */
  createSubscription(userId: string, tier: PlanTier, trial = false): Subscription {
    const now = Date.now();
    const sub: Subscription = {
      id: `sub_${userId}_${now}`,
      userId,
      tier,
      status: trial ? 'trial' : 'active',
      startDate: now,
      endDate: now + 30 * 24 * 3600 * 1000,
      trialEndsAt: trial ? now + 7 * 24 * 3600 * 1000 : undefined,
      autoRenew: true,
      metadata: {},
    };
    this.subscriptions.set(userId, sub);
    this._saveSub(sub);
    return sub;
  }

  /** 获取用户订阅 */
  getSubscription(userId: string): Subscription | null {
    const sub = this.subscriptions.get(userId);
    if (!sub) return null;

    if (sub.status === 'active' && Date.now() > sub.endDate) {
      sub.status = 'expired';
      this._saveSub(sub);
    }
    if (sub.status === 'trial' && sub.trialEndsAt && Date.now() > sub.trialEndsAt) {
      sub.status = 'expired';
      this._saveSub(sub);
    }
    return sub;
  }

  /** 获取用户计划等级 */
  getUserTier(userId: string): PlanTier {
    const sub = this.getSubscription(userId);
    if (!sub || sub.status === 'expired') return 'free';
    return sub.tier;
  }

  /** 获取用户限制 */
  getUserLimits(userId: string): PlanLimits {
    const tier = this.getUserTier(userId);
    return PLAN_LIMITS[tier];
  }

  /** 升级订阅 */
  upgrade(userId: string, tier: PlanTier): Subscription {
    const existing = this.getSubscription(userId);
    const now = Date.now();

    const sub: Subscription = {
      id: existing?.id || `sub_${userId}_${now}`,
      userId,
      tier,
      status: 'active',
      startDate: now,
      endDate: now + 30 * 24 * 3600 * 1000,
      autoRenew: true,
      paymentMethod: existing?.paymentMethod,
      metadata: existing?.metadata || {},
    };

    this.subscriptions.set(userId, sub);
    this._saveSub(sub);
    return sub;
  }

  /** 取消订阅 */
  cancel(userId: string): boolean {
    const sub = this.subscriptions.get(userId);
    if (!sub) return false;
    sub.status = 'canceled';
    sub.autoRenew = false;
    this._saveSub(sub);
    return true;
  }

  /** 续费 */
  renew(userId: string): Subscription | null {
    const sub = this.subscriptions.get(userId);
    if (!sub) return null;
    sub.status = 'active';
    sub.endDate = Date.now() + 30 * 24 * 3600 * 1000;
    this._saveSub(sub);
    return sub;
  }

  // ── 使用量追踪 ──

  /** 记录消息使用 */
  recordMessage(userId: string): { allowed: boolean; remaining: number } {
    // E2E 测试：跳过订阅配额限制
    if (process.env.BUDDY_SKIP_SUBSCRIPTION === '1') {
      return { allowed: true, remaining: -1 };
    }
    const limits = this.getUserLimits(userId);
    const counter = this.getTodayCounter(userId);
    counter.messages++;
    this._saveCounter(userId, counter);
    if (limits.dailyMessages === -1) return { allowed: true, remaining: -1 };
    return {
      allowed: counter.messages <= limits.dailyMessages,
      remaining: Math.max(0, limits.dailyMessages - counter.messages),
    };
  }

  /** 记录生成使用 */
  recordGeneration(userId: string): { allowed: boolean; remaining: number } {
    const limits = this.getUserLimits(userId);
    const counter = this.getTodayCounter(userId);
    counter.generations++;
    this._saveCounter(userId, counter);
    if (limits.dailyGenerations === -1) return { allowed: true, remaining: -1 };
    return {
      allowed: counter.generations <= limits.dailyGenerations,
      remaining: Math.max(0, limits.dailyGenerations - counter.generations),
    };
  }

  /** 记录知识提取 */
  recordExtraction(userId: string): { allowed: boolean; remaining: number } {
    const limits = this.getUserLimits(userId);
    const counter = this.getTodayCounter(userId);
    counter.extractions++;
    this._saveCounter(userId, counter);
    if (limits.knowledgeExtractionsPerMonth === -1) return { allowed: true, remaining: -1 };
    return {
      allowed: counter.extractions <= limits.knowledgeExtractionsPerMonth,
      remaining: Math.max(0, limits.knowledgeExtractionsPerMonth - counter.extractions),
    };
  }

  /** 检查功能权限 */
  checkFeature(userId: string, feature: keyof PlanLimits): boolean {
    const limits = this.getUserLimits(userId);
    const value = limits[feature];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (Array.isArray(value)) return value.length > 0;
    return false;
  }

  /** 获取今日使用统计 */
  getTodayUsage(userId: string) {
    return this.getTodayCounter(userId);
  }

  /** 获取所有计划对比 */
  getPlanComparison() {
    return {
      tiers: ['free', 'pro', 'team'] as PlanTier[],
      limits: PLAN_LIMITS,
      pricing: PLAN_PRICING,
    };
  }

  private getTodayCounter(userId: string) {
    const today = new Date().toISOString().slice(0, 10);
    let counter = this.usageCounters.get(userId);
    if (!counter || counter.date !== today) {
      // 从 DB 加载
      const row = this.db.prepare('SELECT * FROM usage_counters WHERE userId = ? AND date = ?').get(userId, today) as { messages: number; generations: number; extractions: number } | undefined;
      counter = {
        date: today,
        messages: row?.messages ?? 0,
        generations: row?.generations ?? 0,
        extractions: row?.extractions ?? 0,
      };
      this.usageCounters.set(userId, counter);
    }
    return counter;
  }

  private _saveCounter(userId: string, counter: { date: string; messages: number; generations: number; extractions: number }): void {
    this.db.prepare(`INSERT OR REPLACE INTO usage_counters (userId, date, messages, generations, extractions)
      VALUES (?, ?, ?, ?, ?)`).run(userId, counter.date, counter.messages, counter.generations, counter.extractions);
  }
}
