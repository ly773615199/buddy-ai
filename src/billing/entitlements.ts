/**
 * 权益检查器
 * 功能门控 + 使用量限制 + Pro/Free 差异化
 */

import type { PlanTier, PlanLimits } from './subscription.js';
import { PLAN_LIMITS, SubscriptionManager } from './subscription.js';

// ── 类型定义 ──

export type FeatureKey =
  | 'pets.create'
  | 'pets.limit'
  | 'chat.unlimited'
  | 'generation.unlimited'
  | 'skills.share'
  | 'skills.unlimited'
  | 'knowledge.unlimited'
  | 'cloud.retrieval'
  | 'styles.all'
  | 'voice.custom'
  | 'desktop.app';

export interface EntitlementCheck {
  allowed: boolean;
  reason?: string;
  upgradeRequired?: PlanTier;
  remaining?: number;
}

export interface UsageQuota {
  feature: string;
  used: number;
  limit: number;      // -1 = unlimited
  remaining: number;  // -1 = unlimited
  resetsAt: number;   // timestamp
}

// ── 主类 ──

export class EntitlementChecker {
  private subManager: SubscriptionManager;

  constructor(subManager: SubscriptionManager) {
    this.subManager = subManager;
  }

  /** 检查功能权限 */
  check(userId: string, feature: FeatureKey): EntitlementCheck {
    const tier = this.subManager.getUserTier(userId);
    const limits = this.subManager.getUserLimits(userId);

    switch (feature) {
      case 'pets.create':
        return this.checkPetCreate(userId, limits, tier);
      case 'chat.unlimited':
        return this.checkChat(userId, limits, tier);
      case 'generation.unlimited':
        return this.checkGeneration(userId, limits, tier);
      case 'skills.share':
        return { allowed: limits.canSharePackages, reason: limits.canSharePackages ? undefined : 'Pro 订阅可分享能力包', upgradeRequired: 'pro' };
      case 'skills.unlimited':
        return this.checkSkillPackages(userId, limits, tier);
      case 'knowledge.unlimited':
        return this.checkExtraction(userId, limits, tier);
      case 'cloud.retrieval':
        return { allowed: limits.canUseCloudRetrieval, reason: limits.canUseCloudRetrieval ? undefined : 'Pro 订阅可用云端增强检索', upgradeRequired: 'pro' };
      case 'styles.all':
        return { allowed: limits.availableStyles.includes('*'), reason: 'Pro 订阅解锁全部风格', upgradeRequired: 'pro' };
      case 'voice.custom':
        return { allowed: limits.customVoices, reason: limits.customVoices ? undefined : 'Pro 订阅可自定义音色', upgradeRequired: 'pro' };
      default:
        return { allowed: true };
    }
  }

  /** 检查多个功能 */
  checkMultiple(userId: string, features: FeatureKey[]): Record<string, EntitlementCheck> {
    const result: Record<string, EntitlementCheck> = {};
    for (const f of features) {
      result[f] = this.check(userId, f);
    }
    return result;
  }

  /** 获取用户所有配额 */
  getQuotas(userId: string): UsageQuota[] {
    const limits = this.subManager.getUserLimits(userId);
    const usage = this.subManager.getTodayUsage(userId);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const resetsAt = tomorrow.getTime();

    return [
      {
        feature: 'messages',
        used: usage.messages,
        limit: limits.dailyMessages,
        remaining: limits.dailyMessages === -1 ? -1 : Math.max(0, limits.dailyMessages - usage.messages),
        resetsAt,
      },
      {
        feature: 'generations',
        used: usage.generations,
        limit: limits.dailyGenerations,
        remaining: limits.dailyGenerations === -1 ? -1 : Math.max(0, limits.dailyGenerations - usage.generations),
        resetsAt,
      },
      {
        feature: 'extractions',
        used: usage.extractions,
        limit: limits.knowledgeExtractionsPerMonth,
        remaining: limits.knowledgeExtractionsPerMonth === -1 ? -1 : Math.max(0, limits.knowledgeExtractionsPerMonth - usage.extractions),
        resetsAt,
      },
    ];
  }

  /** 获取升级提示文案 */
  getUpgradePrompt(userId: string, feature: FeatureKey): string {
    const check = this.check(userId, feature);
    if (check.allowed) return '';

    const prompts: Record<string, string> = {
      'pets.create': '精灵数量已满！升级 Pro 解锁最多 20 只精灵 🐾',
      'chat.unlimited': '今日消息数已用完！升级 Pro 畅聊无限 💬',
      'generation.unlimited': '今日生成次数已用完！升级 Pro 无限生成 ✨',
      'skills.share': '分享能力包需要 Pro 订阅，让你的专业知识帮助更多人 📦',
      'skills.unlimited': '能力包数量已达上限！升级 Pro 无限制 📚',
      'knowledge.unlimited': '本月知识提取已用完！升级 Pro 无限提取 🧠',
      'cloud.retrieval': '云端增强检索仅限 Pro 用户，让回答更精准 🔍',
      'styles.all': '解锁全部风格，让你的 Buddy 与众不同 🎨',
      'voice.custom': '自定义音色仅限 Pro，让你的 Buddy 更有个性 🎤',
    };

    return prompts[feature] || '升级 Pro 解锁更多功能';
  }

  // ── 私有方法 ──

  private checkPetCreate(_userId: string, limits: PlanLimits, tier: PlanTier): EntitlementCheck {
    // 实际需要查询用户当前精灵数，这里简化
    return {
      allowed: true, // 由调用方检查具体数量
      remaining: limits.maxPets,
      upgradeRequired: tier === 'free' ? 'pro' : undefined,
    };
  }

  private checkChat(userId: string, limits: PlanLimits, tier: PlanTier): EntitlementCheck {
    const usage = this.subManager.getTodayUsage(userId);
    if (limits.dailyMessages === -1) return { allowed: true, remaining: -1 };

    return {
      allowed: usage.messages < limits.dailyMessages,
      remaining: Math.max(0, limits.dailyMessages - usage.messages),
      reason: usage.messages >= limits.dailyMessages ? '今日消息数已用完' : undefined,
      upgradeRequired: tier === 'free' ? 'pro' : undefined,
    };
  }

  private checkGeneration(userId: string, limits: PlanLimits, tier: PlanTier): EntitlementCheck {
    const usage = this.subManager.getTodayUsage(userId);
    if (limits.dailyGenerations === -1) return { allowed: true, remaining: -1 };

    return {
      allowed: usage.generations < limits.dailyGenerations,
      remaining: Math.max(0, limits.dailyGenerations - usage.generations),
      reason: usage.generations >= limits.dailyGenerations ? '今日生成次数已用完' : undefined,
      upgradeRequired: tier === 'free' ? 'pro' : undefined,
    };
  }

  private checkSkillPackages(userId: string, limits: PlanLimits, tier: PlanTier): EntitlementCheck {
    if (limits.maxSkillPackages === -1) return { allowed: true, remaining: -1 };
    // 实际需要查询用户当前能力包数
    return {
      allowed: true,
      remaining: limits.maxSkillPackages,
      upgradeRequired: tier === 'free' ? 'pro' : undefined,
    };
  }

  private checkExtraction(userId: string, limits: PlanLimits, tier: PlanTier): EntitlementCheck {
    const usage = this.subManager.getTodayUsage(userId);
    if (limits.knowledgeExtractionsPerMonth === -1) return { allowed: true, remaining: -1 };

    return {
      allowed: usage.extractions < limits.knowledgeExtractionsPerMonth,
      remaining: Math.max(0, limits.knowledgeExtractionsPerMonth - usage.extractions),
      reason: usage.extractions >= limits.knowledgeExtractionsPerMonth ? '本月知识提取已用完' : undefined,
      upgradeRequired: tier === 'free' ? 'pro' : undefined,
    };
  }
}
