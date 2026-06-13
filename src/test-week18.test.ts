/**
 * Phase C Week 18 测试 — 商业化模块 (vitest)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { SubscriptionManager, PLAN_LIMITS, PLAN_PRICING } from './billing/subscription.js';
import type { PlanTier } from './billing/subscription.js';
import { PaymentManager } from './billing/payment.js';
import { EntitlementChecker } from './billing/entitlements.js';
import { ShopCatalog } from './shop/catalog.js';
import { DEFAULT_LORA_CONFIG, DEFAULT_HYPERPARAMETERS } from './billing/lora-interface.js';

describe('Phase C Week 18 — 商业化模块', () => {
  // ══════════════════════════════════════════
  // 1. SubscriptionManager — 订阅管理
  // ══════════════════════════════════════════

  describe('订阅管理 SubscriptionManager', () => {
    it('计划限制定义正确', () => {
      expect(PLAN_LIMITS.free.maxPets).toBe(3);
      expect(PLAN_LIMITS.pro.maxPets).toBe(20);
      expect(PLAN_LIMITS.free.dailyMessages).toBe(20);
      expect(PLAN_LIMITS.pro.dailyMessages).toBe(-1);
      expect(PLAN_LIMITS.free.knowledgeExtractionsPerMonth).toBe(50);
      expect(PLAN_LIMITS.pro.knowledgeExtractionsPerMonth).toBe(-1);
      expect(PLAN_LIMITS.free.canSharePackages).toBe(false);
      expect(PLAN_LIMITS.pro.canSharePackages).toBe(true);
      expect(PLAN_LIMITS.free.canUseCloudRetrieval).toBe(false);
      expect(PLAN_LIMITS.pro.canUseCloudRetrieval).toBe(true);
    });

    it('价格定义正确', () => {
      expect(PLAN_PRICING.free.monthly).toBe(0);
      expect(PLAN_PRICING.pro.monthly).toBe(9);
      expect(PLAN_PRICING.pro.yearly).toBe(89);
      expect(PLAN_PRICING.team.monthly).toBe(29);
    });

    it('新用户默认 Free', () => {
      const subMgr = new SubscriptionManager();
      expect(subMgr.getUserTier('user1')).toBe('free');
    });

    it('创建订阅升级为 Pro', () => {
      const subMgr = new SubscriptionManager();
      const sub = subMgr.createSubscription('user1', 'pro');
      expect(sub.tier).toBe('pro');
      expect(sub.status).toBe('active');
      expect(subMgr.getUserTier('user1')).toBe('pro');
    });

    it('Pro 用户限制正确', () => {
      const subMgr = new SubscriptionManager();
      subMgr.createSubscription('user1', 'pro');
      const limits = subMgr.getUserLimits('user1');
      expect(limits.maxPets).toBe(20);
      expect(limits.dailyMessages).toBe(-1);
    });

    it('取消订阅后状态为 canceled', () => {
      const subMgr = new SubscriptionManager();
      subMgr.createSubscription('user1', 'pro');
      subMgr.cancel('user1');
      expect(subMgr.getSubscription('user1')?.status).toBe('canceled');
      expect(subMgr.getUserTier('user1')).toBe('pro'); // 到期前仍为 Pro
    });

    it('使用量追踪 — 消息限制', () => {
      const subMgr = new SubscriptionManager();
      subMgr.createSubscription('user2', 'free');

      const r1 = subMgr.recordMessage('user2');
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(19);

      for (let i = 0; i < 18; i++) subMgr.recordMessage('user2');
      const r20 = subMgr.recordMessage('user2');
      expect(r20.allowed).toBe(true);
      expect(r20.remaining).toBe(0);

      const r21 = subMgr.recordMessage('user2');
      expect(r21.allowed).toBe(false);
    });

    it('使用量追踪 — 生成限制', () => {
      const subMgr = new SubscriptionManager();
      subMgr.createSubscription('user2', 'free');

      const gen1 = subMgr.recordGeneration('user2');
      expect(gen1.allowed).toBe(true);
      for (let i = 0; i < 2; i++) subMgr.recordGeneration('user2');
      const gen4 = subMgr.recordGeneration('user2');
      expect(gen4.allowed).toBe(false);
    });

    it('试用期状态为 trial', () => {
      const subMgr = new SubscriptionManager();
      subMgr.createSubscription('user3', 'pro', true);
      const sub3 = subMgr.getSubscription('user3');
      expect(sub3?.status).toBe('trial');
    });

    it('计划对比返回 3 个等级', () => {
      const subMgr = new SubscriptionManager();
      const comparison = subMgr.getPlanComparison();
      expect(comparison.tiers.length).toBe(3);
    });
  });

  // ══════════════════════════════════════════
  // 2. PaymentManager — 支付集成
  // ══════════════════════════════════════════

  describe('支付集成 PaymentManager', () => {
    it('Stripe 订单创建和查询', async () => {
      const payment = new PaymentManager({ provider: 'stripe', apiKey: 'test_key' });
      const orderResult = await payment.createOrder('user1', 'pro', 'monthly');
      expect(orderResult.success).toBe(true);
      expect(orderResult.orderId.startsWith('order_')).toBe(true);

      const order = payment.getOrder(orderResult.orderId);
      expect(order).not.toBeNull();
      expect(order?.amount).toBe(9);
      expect(order?.status).toBe('pending');
    });

    it('确认支付', async () => {
      const payment = new PaymentManager({ provider: 'stripe', apiKey: 'test_key' });
      const orderResult = await payment.createOrder('user1', 'pro', 'monthly');
      const confirmed = payment.confirmPayment(orderResult.orderId);
      expect(confirmed).toBe(true);
      expect(payment.getOrder(orderResult.orderId)?.status).toBe('paid');
    });

    it('年付订单金额正确', async () => {
      const payment = new PaymentManager({ provider: 'stripe', apiKey: 'test_key' });
      const yearlyOrder = await payment.createOrder('user2', 'pro', 'yearly');
      expect(yearlyOrder.success).toBe(true);
      const yearlyOrderData = payment.getOrder(yearlyOrder.orderId);
      expect(yearlyOrderData?.amount).toBe(89);
    });

    it('退款成功', async () => {
      const payment = new PaymentManager({ provider: 'stripe', apiKey: 'test_key' });
      const orderResult = await payment.createOrder('user1', 'pro', 'monthly');
      payment.confirmPayment(orderResult.orderId);
      const refund = await payment.refund(orderResult.orderId);
      expect(refund.success).toBe(true);
      expect(refund.amount).toBe(9);
    });

    it('用户订单历史', async () => {
      const payment = new PaymentManager({ provider: 'stripe', apiKey: 'test_key' });
      await payment.createOrder('user1', 'pro', 'monthly');
      const userOrders = payment.getUserOrders('user1');
      expect(userOrders.length).toBeGreaterThanOrEqual(1);
    });

    it('支付宝订单创建（预留接口）', async () => {
      const alipay = new PaymentManager({ provider: 'alipay', apiKey: 'test' });
      const aliOrder = await alipay.createOrder('user3', 'pro');
      // 支付宝尚未接入，返回 success: false
      expect(aliOrder.orderId).toBeDefined();
    });

    it('微信订单创建（预留接口）', async () => {
      const wechat = new PaymentManager({ provider: 'wechat', apiKey: 'test' });
      const wxOrder = await wechat.createOrder('user4', 'pro');
      // 微信尚未接入，返回 success: false
      expect(wxOrder.orderId).toBeDefined();
    });

    it('过期订单清理返回数字', async () => {
      const payment = new PaymentManager({ provider: 'stripe', apiKey: 'test_key' });
      const cleaned = payment.cleanupExpiredOrders();
      expect(typeof cleaned).toBe('number');
    });
  });

  // ══════════════════════════════════════════
  // 3. EntitlementChecker — 权益检查
  // ══════════════════════════════════════════

  describe('权益检查 EntitlementChecker', () => {
    let subMgr: SubscriptionManager;
    let checker: EntitlementChecker;

    beforeAll(() => {
      subMgr = new SubscriptionManager();
      checker = new EntitlementChecker(subMgr);
      subMgr.createSubscription('free_user', 'free');
      subMgr.createSubscription('pro_user', 'pro');
    });

    it('Free 用户消息检查', () => {
      const chatCheck = checker.check('free_user', 'chat.unlimited');
      expect(chatCheck.allowed).toBe(true);
      expect(chatCheck.remaining).toBe(20);
    });

    it('Free 用户不能分享能力包', () => {
      const shareCheck = checker.check('free_user', 'skills.share');
      expect(shareCheck.allowed).toBe(false);
      expect(shareCheck.upgradeRequired).toBe('pro');
    });

    it('Free 用户无云端检索', () => {
      const cloudCheck = checker.check('free_user', 'cloud.retrieval');
      expect(cloudCheck.allowed).toBe(false);
    });

    it('Pro 用户消息检查通过，无限消息', () => {
      const proChat = checker.check('pro_user', 'chat.unlimited');
      expect(proChat.allowed).toBe(true);
      expect(proChat.remaining).toBe(-1);
    });

    it('Pro 用户可分享能力包', () => {
      const proShare = checker.check('pro_user', 'skills.share');
      expect(proShare.allowed).toBe(true);
    });

    it('Pro 用户有云端检索', () => {
      const proCloud = checker.check('pro_user', 'cloud.retrieval');
      expect(proCloud.allowed).toBe(true);
    });

    it('多功能检查返回 3 项', () => {
      const multiCheck = checker.checkMultiple('free_user', ['chat.unlimited', 'skills.share', 'generation.unlimited']);
      expect(Object.keys(multiCheck).length).toBe(3);
    });

    it('配额返回 3 种', () => {
      const quotas = checker.getQuotas('free_user');
      expect(quotas.length).toBe(3);
      expect(quotas[0].feature).toBe('messages');
      expect(quotas[1].feature).toBe('generations');
      expect(quotas[2].feature).toBe('extractions');
    });

    it('升级提示包含 Pro', () => {
      const prompt = checker.getUpgradePrompt('free_user', 'skills.share');
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain('Pro');
    });
  });

  // ══════════════════════════════════════════
  // 4. ShopCatalog — 商城系统
  // ══════════════════════════════════════════

  describe('商城系统 ShopCatalog', () => {
    let shop: ShopCatalog;

    beforeAll(() => {
      shop = new ShopCatalog();
    });

    it('默认商品数≥8', () => {
      const allItems = shop.getAvailableItems();
      expect(allItems.length).toBeGreaterThanOrEqual(8);
    });

    it('配饰类≥2', () => {
      const hats = shop.getAvailableItems({ type: 'accessory' });
      expect(hats.length).toBeGreaterThanOrEqual(2);
    });

    it('特效类≥2', () => {
      const effects = shop.getAvailableItems({ type: 'effect' });
      expect(effects.length).toBeGreaterThanOrEqual(2);
    });

    it('稀有≥1', () => {
      const rareItems = shop.getAvailableItems({ rarity: 'rare' });
      expect(rareItems.length).toBeGreaterThanOrEqual(1);
    });

    it('商品详情 — 派对帽', () => {
      const hat = shop.getItem('hat_party');
      expect(hat).not.toBeNull();
      expect(hat?.name).toBe('派对帽');
      expect(hat?.price).toBe(100);
    });

    it('用户库存初始值', () => {
      const inv = shop.getInventory('buyer1');
      expect(inv.coins).toBeGreaterThan(0);
      expect(inv.gems).toBeGreaterThanOrEqual(0);
    });

    it('购买成功', () => {
      const before = shop.getInventory('buyer1').coins;
      const buy1 = shop.purchase('buyer1', 'hat_party');
      expect(buy1.success).toBe(true);
      expect(shop.getInventory('buyer1').coins).toBe(before - 100);
    });

    it('余额不足购买失败', () => {
      const buy2 = shop.purchase('buyer1', 'costume_legend');
      expect(buy2.success).toBe(false);
      expect(buy2.error).toContain('余额不足');
    });

    it('装备成功', () => {
      const equipped = shop.equipItem('buyer1', 'hat_party', true);
      expect(equipped).toBe(true);
      const equippedItems = shop.getEquippedItems('buyer1');
      expect(equippedItems.length).toBe(1);
      expect(equippedItems[0].id).toBe('hat_party');
    });

    it('赛季创建和查询', () => {
      shop.createSeason({
        id: 'season1',
        name: '春日祭典',
        description: '春天来了！',
        startTime: Date.now() - 86400000,
        endTime: Date.now() + 30 * 86400000,
        theme: 'spring',
        items: [],
        tasks: [
          { id: 't1', name: '对话10次', description: '完成10次对话', target: 10, progress: 0, reward: { type: 'coins', amount: 100 }, completed: false },
        ],
        leaderboard: { entries: [], updatedAt: 0 },
        isActive: true,
      });

      const activeSeason = shop.getActiveSeason();
      expect(activeSeason).not.toBeNull();
      expect(activeSeason?.name).toBe('春日祭典');
    });

    it('任务进度更新', () => {
      shop.updateTaskProgress('season1', 't1', 5);
      const season = shop.getSeason('season1');
      expect(season?.tasks[0].progress).toBe(5);

      shop.updateTaskProgress('season1', 't1', 10);
      const season2 = shop.getSeason('season1');
      expect(season2?.tasks[0].completed).toBe(true);
    });

    it('排行榜', () => {
      shop.updateLeaderboard('season1', 'player1', 100);
      shop.updateLeaderboard('season1', 'player2', 200);
      shop.updateLeaderboard('season1', 'player1', 150);
      const lb = shop.getSeason('season1')?.leaderboard;
      expect(lb?.entries[0].userId).toBe('player2');
      expect(lb?.entries[0].rank).toBe(1);
      expect(lb?.entries[1].userId).toBe('player1');
    });

    it('统计', () => {
      const stats = shop.getStats();
      expect(stats.totalItems).toBeGreaterThanOrEqual(8);
      expect(stats.seasons).toBeGreaterThanOrEqual(1);
    });
  });

  // ══════════════════════════════════════════
  // 5. LoRA 接口预留
  // ══════════════════════════════════════════

  describe('LoRA 接口预留', () => {
    it('LoRA 默认关闭', () => {
      expect(DEFAULT_LORA_CONFIG.enabled).toBe(false);
      expect(DEFAULT_LORA_CONFIG.baseModel).toBe('buddy-base-v1');
      expect(typeof DEFAULT_LORA_CONFIG.apiEndpoint).toBe('string');
    });

    it('默认超参数', () => {
      expect(DEFAULT_HYPERPARAMETERS.rank).toBe(16);
      expect(DEFAULT_HYPERPARAMETERS.alpha).toBe(32);
      expect(DEFAULT_HYPERPARAMETERS.epochs).toBe(3);
    });
  });
});
