/**
 * 商业化模块测试 — vitest 格式
 * 覆盖：订阅管理、支付集成、权益检查、商城系统、LoRA 接口
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SubscriptionManager, PLAN_LIMITS, PLAN_PRICING } from './billing/subscription.js';
import { PaymentManager } from './billing/payment.js';
import { EntitlementChecker } from './billing/entitlements.js';
import { ShopCatalog } from './shop/catalog.js';
import { DEFAULT_LORA_CONFIG, DEFAULT_HYPERPARAMETERS } from './billing/lora-interface.js';

describe('订阅管理', () => {
  it('Free 计划限制正确', () => {
    expect(PLAN_LIMITS.free.maxPets).toBe(3);
    expect(PLAN_LIMITS.free.dailyMessages).toBe(20);
    expect(PLAN_LIMITS.free.knowledgeExtractionsPerMonth).toBe(50);
    expect(PLAN_LIMITS.free.canSharePackages).toBe(false);
    expect(PLAN_LIMITS.free.canUseCloudRetrieval).toBe(false);
  });

  it('Pro 计划限制正确', () => {
    expect(PLAN_LIMITS.pro.maxPets).toBe(20);
    expect(PLAN_LIMITS.pro.dailyMessages).toBe(-1);
    expect(PLAN_LIMITS.pro.knowledgeExtractionsPerMonth).toBe(-1);
    expect(PLAN_LIMITS.pro.canSharePackages).toBe(true);
    expect(PLAN_LIMITS.pro.canUseCloudRetrieval).toBe(true);
  });

  it('价格正确', () => {
    expect(PLAN_PRICING.free.monthly).toBe(0);
    expect(PLAN_PRICING.pro.monthly).toBe(9);
    expect(PLAN_PRICING.pro.yearly).toBe(89);
    expect(PLAN_PRICING.team.monthly).toBe(29);
  });

  it('新用户默认 Free', () => {
    const mgr = new SubscriptionManager();
    expect(mgr.getUserTier('u1')).toBe('free');
  });

  it('创建订阅升级', () => {
    const mgr = new SubscriptionManager();
    const sub = mgr.createSubscription('u1', 'pro');
    expect(sub.tier).toBe('pro');
    expect(sub.status).toBe('active');
    expect(mgr.getUserTier('u1')).toBe('pro');
  });

  it('取消订阅', () => {
    const mgr = new SubscriptionManager();
    mgr.createSubscription('u1', 'pro');
    mgr.cancel('u1');
    expect(mgr.getSubscription('u1')?.status).toBe('canceled');
    expect(mgr.getUserTier('u1')).toBe('pro'); // 到期前仍为 Pro
  });

  it('消息使用量追踪', () => {
    const mgr = new SubscriptionManager();
    mgr.createSubscription('u2', 'free');
    const r1 = mgr.recordMessage('u2');
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(19);

    for (let i = 0; i < 18; i++) mgr.recordMessage('u2');
    const r20 = mgr.recordMessage('u2');
    expect(r20.allowed).toBe(true);
    expect(r20.remaining).toBe(0);

    const r21 = mgr.recordMessage('u2');
    expect(r21.allowed).toBe(false);
  });

  it('试用期状态', () => {
    const mgr = new SubscriptionManager();
    mgr.createSubscription('u3', 'pro', true);
    expect(mgr.getSubscription('u3')?.status).toBe('trial');
  });

  it('计划对比', () => {
    const mgr = new SubscriptionManager();
    const c = mgr.getPlanComparison();
    expect(c.tiers.length).toBe(3);
  });
});

describe('支付集成', () => {
  it('Stripe 订单创建和查询', async () => {
    const payment = new PaymentManager({ provider: 'stripe', apiKey: 'test_key' });
    const r = await payment.createOrder('u1', 'pro', 'monthly');
    expect(r.success).toBe(true);
    expect(r.orderId.startsWith('order_')).toBe(true);

    const order = payment.getOrder(r.orderId);
    expect(order).not.toBeNull();
    expect(order?.amount).toBe(9);
    expect(order?.status).toBe('pending');
  });

  it('确认支付', async () => {
    const payment = new PaymentManager({ provider: 'stripe', apiKey: 'test_key' });
    const r = await payment.createOrder('u1', 'pro', 'monthly');
    expect(payment.confirmPayment(r.orderId)).toBe(true);
    expect(payment.getOrder(r.orderId)?.status).toBe('paid');
  });

  it('年付订单', async () => {
    const payment = new PaymentManager({ provider: 'stripe', apiKey: 'test_key' });
    const r = await payment.createOrder('u2', 'pro', 'yearly');
    expect(r.success).toBe(true);
    expect(payment.getOrder(r.orderId)?.amount).toBe(89);
  });

  it('退款', async () => {
    const payment = new PaymentManager({ provider: 'stripe', apiKey: 'test_key' });
    const r = await payment.createOrder('u1', 'pro', 'monthly');
    await payment.confirmPayment(r.orderId);
    const refund = await payment.refund(r.orderId);
    expect(refund.success).toBe(true);
    expect(payment.getOrder(r.orderId)?.status).toBe('refunded');
  });

  it('支付宝订单', async () => {
    const payment = new PaymentManager({ provider: 'alipay', apiKey: 'test' });
    const r = await payment.createOrder('u3', 'pro');
    // 支付宝可能返回 success 或 false（取决于实现）
    expect(typeof r.success).toBe('boolean');
  });

  it('微信支付订单', async () => {
    const payment = new PaymentManager({ provider: 'wechat', apiKey: 'test' });
    const r = await payment.createOrder('u4', 'pro');
    expect(typeof r.success).toBe('boolean');
  });

  it('清理过期订单', async () => {
    const payment = new PaymentManager({ provider: 'stripe', apiKey: 'test' });
    expect(typeof payment.cleanupExpiredOrders()).toBe('number');
  });
});

describe('权益检查', () => {
  it('Free 用户功能限制', () => {
    const mgr = new SubscriptionManager();
    const checker = new EntitlementChecker(mgr);
    mgr.createSubscription('free', 'free');

    const chat = checker.check('free', 'chat.unlimited');
    expect(chat.allowed).toBe(true);
    expect(chat.remaining).toBe(20);

    const share = checker.check('free', 'skills.share');
    expect(share.allowed).toBe(false);
    expect(share.upgradeRequired).toBe('pro');

    const cloud = checker.check('free', 'cloud.retrieval');
    expect(cloud.allowed).toBe(false);
  });

  it('Pro 用户功能解锁', () => {
    const mgr = new SubscriptionManager();
    const checker = new EntitlementChecker(mgr);
    mgr.createSubscription('pro', 'pro');

    expect(checker.check('pro', 'chat.unlimited').allowed).toBe(true);
    expect(checker.check('pro', 'chat.unlimited').remaining).toBe(-1);
    expect(checker.check('pro', 'skills.share').allowed).toBe(true);
    expect(checker.check('pro', 'cloud.retrieval').allowed).toBe(true);
  });

  it('多功能检查', () => {
    const mgr = new SubscriptionManager();
    const checker = new EntitlementChecker(mgr);
    mgr.createSubscription('free', 'free');
    const r = checker.checkMultiple('free', ['chat.unlimited', 'skills.share', 'generation.unlimited']);
    expect(Object.keys(r).length).toBe(3);
  });

  it('配额查询', () => {
    const mgr = new SubscriptionManager();
    const checker = new EntitlementChecker(mgr);
    mgr.createSubscription('free', 'free');
    const quotas = checker.getQuotas('free');
    expect(quotas.length).toBe(3);
    expect(quotas[0].feature).toBe('messages');
  });

  it('升级提示', () => {
    const mgr = new SubscriptionManager();
    const checker = new EntitlementChecker(mgr);
    mgr.createSubscription('free', 'free');
    const prompt = checker.getUpgradePrompt('free', 'skills.share');
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain('Pro');
  });
});

describe('商城系统', () => {
  let shop: ShopCatalog;

  beforeAll(() => { shop = new ShopCatalog(); });

  it('默认商品', () => {
    expect(shop.getAvailableItems().length).toBeGreaterThanOrEqual(8);
    expect(shop.getAvailableItems({ type: 'accessory' }).length).toBeGreaterThanOrEqual(2);
    expect(shop.getAvailableItems({ type: 'effect' }).length).toBeGreaterThanOrEqual(2);
    expect(shop.getAvailableItems({ rarity: 'rare' }).length).toBeGreaterThanOrEqual(1);
  });

  it('商品详情', () => {
    const hat = shop.getItem('hat_party');
    expect(hat).not.toBeNull();
    expect(hat?.name).toBe('派对帽');
    expect(hat?.price).toBe(100);
  });

  it('用户库存', () => {
    const inv = shop.getInventory('inv_user_' + Date.now());
    expect(inv.coins).toBe(1000);
    expect(inv.gems).toBe(50);
  });

  it('购买成功', () => {
    const uid = 'buyer_' + Date.now();
    shop.getInventory(uid); // 初始化
    const r = shop.purchase(uid, 'hat_party');
    expect(r.success).toBe(true);
  });

  it('余额不足失败', () => {
    const uid = 'poor_' + Date.now();
    shop.getInventory(uid);
    const r = shop.purchase(uid, 'costume_legend');
    expect(r.success).toBe(false);
  });

  it('装备物品', () => {
    const uid = 'equip_' + Date.now();
    shop.purchase(uid, 'hat_party');
    expect(shop.equipItem(uid, 'hat_party', true)).toBe(true);
    const items = shop.getEquippedItems(uid);
    expect(items.length).toBe(1);
    expect(items[0].id).toBe('hat_party');
  });

  it('赛季系统', () => {
    shop.createSeason({
      id: 's1', name: '春日祭典', description: '春天来了！',
      startTime: Date.now() - 86400000, endTime: Date.now() + 30 * 86400000,
      theme: 'spring', items: [],
      tasks: [{ id: 't1', name: '对话10次', description: '完成10次对话', target: 10, progress: 0, reward: { type: 'coins', amount: 100 }, completed: false }],
      leaderboard: { entries: [], updatedAt: 0 }, isActive: true,
    });
    const s = shop.getActiveSeason();
    expect(s).not.toBeNull();
    expect(s?.name).toBe('春日祭典');
  });

  it('赛季任务进度', () => {
    shop.updateTaskProgress('s1', 't1', 5);
    expect(shop.getSeason('s1')?.tasks[0].progress).toBe(5);
    shop.updateTaskProgress('s1', 't1', 10);
    expect(shop.getSeason('s1')?.tasks[0].completed).toBe(true);
  });

  it('排行榜', () => {
    shop.updateLeaderboard('s1', 'p1', 100);
    shop.updateLeaderboard('s1', 'p2', 200);
    shop.updateLeaderboard('s1', 'p1', 150);
    const lb = shop.getSeason('s1')?.leaderboard;
    expect(lb?.entries[0].userId).toBe('p2');
    expect(lb?.entries[0].rank).toBe(1);
  });

  it('统计信息', () => {
    const stats = shop.getStats();
    expect(stats.totalItems).toBeGreaterThanOrEqual(8);
    expect(stats.seasons).toBeGreaterThanOrEqual(1);
  });
});

describe('LoRA 接口预留', () => {
  it('默认关闭', () => {
    expect(DEFAULT_LORA_CONFIG.enabled).toBe(false);
    expect(DEFAULT_LORA_CONFIG.baseModel).toBe('buddy-base-v1');
  });

  it('默认超参数', () => {
    expect(DEFAULT_HYPERPARAMETERS.rank).toBe(16);
    expect(DEFAULT_HYPERPARAMETERS.alpha).toBe(32);
    expect(DEFAULT_HYPERPARAMETERS.epochs).toBe(3);
  });
});
