import { describe, it, expect, beforeEach } from 'vitest';
import { SubscriptionManager, PLAN_LIMITS, PLAN_PRICING } from './billing/subscription.js';
import { PaymentManager } from './billing/payment.js';
import { EntitlementChecker } from './billing/entitlements.js';

describe('订阅管理', () => {
  it('所有计划核心能力全开（不限制）', () => {
    for (const tier of ['free', 'pro', 'team'] as const) {
      expect(PLAN_LIMITS[tier].maxPets).toBe(-1);
      expect(PLAN_LIMITS[tier].dailyMessages).toBe(-1);
      expect(PLAN_LIMITS[tier].dailyGenerations).toBe(-1);
      expect(PLAN_LIMITS[tier].maxSkillPackages).toBe(-1);
      expect(PLAN_LIMITS[tier].knowledgeExtractionsPerMonth).toBe(-1);
      expect(PLAN_LIMITS[tier].canSharePackages).toBe(true);
      expect(PLAN_LIMITS[tier].canUseCloudRetrieval).toBe(true);
      expect(PLAN_LIMITS[tier].availableStyles).toContain('*');
      expect(PLAN_LIMITS[tier].customVoices).toBe(true);
    }
  });
});

describe('支付集成', () => {
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

    const order = payment.getOrder(orderResult.orderId);
    expect(order?.status).toBe('paid');
  });

  it('退款', async () => {
    const payment = new PaymentManager({ provider: 'stripe', apiKey: 'test_key' });
    const orderResult = await payment.createOrder('user1', 'pro', 'monthly');
    await payment.confirmPayment(orderResult.orderId);

    const refund = await payment.refund(orderResult.orderId);
    expect(refund.success).toBe(true);

    const order = payment.getOrder(orderResult.orderId);
    expect(order?.status).toBe('refunded');
  });

  it('查询不存在的订单返回 null', () => {
    const payment = new PaymentManager({ provider: 'stripe', apiKey: 'test_key' });
    expect(payment.getOrder('nonexistent_order')).toBeNull();
  });

  it('重复确认同一订单返回 false（非幂等）', async () => {
    const payment = new PaymentManager({ provider: 'stripe', apiKey: 'test_key' });
    const orderResult = await payment.createOrder('user2', 'pro', 'monthly');
    const first = payment.confirmPayment(orderResult.orderId);
    const second = payment.confirmPayment(orderResult.orderId);
    expect(first).toBe(true);
    expect(second).toBe(false); // 已 paid 状态不可重复确认
  });
});

describe('权益检查', () => {
  let subManager: SubscriptionManager;
  let checker: EntitlementChecker;

  beforeEach(() => {
    // 每个测试用独立实例，避免状态耦合
    subManager = new SubscriptionManager();
    checker = new EntitlementChecker(subManager);
  });

  it('所有用户均可使用云检索（不限制）', () => {
    const result = checker.check('any-user', 'cloud.retrieval');
    expect(result.allowed).toBe(true);
  });

  it('所有用户均可使用技能分享（不限制）', () => {
    const result = checker.check('any-user', 'skills.share');
    expect(result.allowed).toBe(true);
  });

  it('所有功能检查均放行', () => {
    const features = ['pets.create', 'chat.unlimited', 'generation.unlimited',
      'skills.share', 'skills.unlimited', 'knowledge.unlimited',
      'cloud.retrieval', 'styles.all', 'voice.custom'] as const;
    for (const f of features) {
      expect(checker.check('any-user', f).allowed).toBe(true);
    }
  });
});

describe('订阅生命周期', () => {
  let sm: SubscriptionManager;

  beforeEach(() => {
    sm = new SubscriptionManager();
  });

  it('Free → Pro 升级后权限变更', () => {
    sm.createSubscription('u1', 'free');
    expect(sm.getUserTier('u1')).toBe('free');

    sm.upgrade('u1', 'pro');
    expect(sm.getUserTier('u1')).toBe('pro');

    const limits = sm.getUserLimits('u1');
    expect(limits.canUseCloudRetrieval).toBe(true);
    expect(limits.canSharePackages).toBe(true);
  });

  it('取消订阅后状态变为 canceled', () => {
    sm.createSubscription('u2', 'pro');
    expect(sm.getSubscription('u2')?.status).toBe('active');

    const canceled = sm.cancel('u2');
    expect(canceled).toBe(true);
    expect(sm.getSubscription('u2')?.status).toBe('canceled');
  });

  it('取消不存在的订阅返回 false', () => {
    expect(sm.cancel('ghost-user')).toBe(false);
  });

  it('续费已取消的订阅恢复 active', () => {
    sm.createSubscription('u3', 'pro');
    sm.cancel('u3');
    expect(sm.getSubscription('u3')?.status).toBe('canceled');

    sm.renew('u3');
    expect(sm.getSubscription('u3')?.status).toBe('active');
  });

  it('续费不存在的订阅返回 null', () => {
    expect(sm.renew('ghost-user')).toBeNull();
  });

  it('过期订阅降级为 free 权限', () => {
    sm.createSubscription('u4', 'pro');

    // 手动篡改 endDate 使其过期
    const sub = sm.getSubscription('u4')!;
    (sub as any).endDate = Date.now() - 1000;

    // getSubscription 会检测过期并更新状态
    const refreshed = sm.getSubscription('u4');
    expect(refreshed?.status).toBe('expired');
    expect(sm.getUserTier('u4')).toBe('free');
  });

  it('新订阅默认 30 天有效期', () => {
    const sub = sm.createSubscription('u5', 'pro');
    const durationDays = (sub.endDate - sub.startDate) / (24 * 3600 * 1000);
    expect(durationDays).toBeCloseTo(30, 0);
  });

  it('创建订阅返回正确状态', () => {
    const active = sm.createSubscription('u6', 'pro');
    expect(active.status).toBe('active');

    const trial = sm.createSubscription('u7', 'pro', true);
    expect(trial.status).toBe('trial');
  });

  it('trial 订阅有 trialEndsAt', () => {
    const sub = sm.createSubscription('u8', 'pro', true);
    expect(sub.trialEndsAt).toBeDefined();
    expect(sub.trialEndsAt!).toBeGreaterThan(sub.startDate);
  });

  it('不存在的用户返回 free tier', () => {
    expect(sm.getUserTier('no-such-user')).toBe('free');
    expect(sm.getSubscription('no-such-user')).toBeNull();
  });

  it('消息计数器追踪（无限制）', () => {
    sm.createSubscription('u9', 'free');
    const r1 = sm.recordMessage('u9');
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(-1);
  });

  it('Free 用户消息无限制', () => {
    sm.createSubscription('u10', 'free');
    for (let i = 0; i < 25; i++) {
      sm.recordMessage('u10');
    }
    const over = sm.recordMessage('u10');
    expect(over.allowed).toBe(true);
    expect(over.remaining).toBe(-1);
  });

  it('Pro 用户消息无限制', () => {
    sm.createSubscription('u11', 'pro');
    for (let i = 0; i < 25; i++) {
      sm.recordMessage('u11');
    }
    const r = sm.recordMessage('u11');
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(-1);
  });
});
