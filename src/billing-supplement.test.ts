/**
 * Billing 模块补充测试
 * 覆盖：recordExtraction、checkFeature、getTodayUsage、getUserOrders、getOrderSummary
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SubscriptionManager, PLAN_LIMITS } from './billing/subscription.js';
import { PaymentManager } from './billing/payment.js';

describe('SubscriptionManager 补充', () => {
  let sm: SubscriptionManager;

  beforeEach(() => {
    sm = new SubscriptionManager();
  });

  describe('recordExtraction() 知识提取计数', () => {
    it('所有用户提取无限制', () => {
      sm.createSubscription('u1', 'free');
      const r = sm.recordExtraction('u1');
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(-1);
    });

    it('Free 用户提取永不限制', () => {
      sm.createSubscription('u2', 'free');
      for (let i = 0; i < 100; i++) sm.recordExtraction('u2');
      const over = sm.recordExtraction('u2');
      expect(over.allowed).toBe(true);
      expect(over.remaining).toBe(-1);
    });

    it('Pro 用户提取无限制', () => {
      sm.createSubscription('u3', 'pro');
      const r = sm.recordExtraction('u3');
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(-1);
    });
  });

  describe('checkFeature() 功能权限检查', () => {
    it('布尔类型功能：Free canSharePackages = true（全开）', () => {
      sm.createSubscription('u1', 'free');
      expect(sm.checkFeature('u1', 'canSharePackages')).toBe(true);
    });

    it('布尔类型功能：Pro canSharePackages = true', () => {
      sm.createSubscription('u2', 'pro');
      expect(sm.checkFeature('u2', 'canSharePackages')).toBe(true);
    });

    it('数值类型功能：dailyMessages 非零 = true', () => {
      sm.createSubscription('u3', 'free');
      expect(sm.checkFeature('u3', 'dailyMessages')).toBe(true);
    });

    it('数值类型功能：Pro dailyMessages = -1 仍为 true', () => {
      sm.createSubscription('u4', 'pro');
      expect(sm.checkFeature('u4', 'dailyMessages')).toBe(true);
    });

    it('不存在的用户也全开', () => {
      expect(sm.checkFeature('ghost', 'canSharePackages')).toBe(true);
    });
  });

  describe('getTodayUsage() 今日使用统计', () => {
    it('新用户返回零计数', () => {
      sm.createSubscription('u1', 'free');
      const usage = sm.getTodayUsage('u1');
      expect(usage.messages).toBe(0);
      expect(usage.generations).toBe(0);
      expect(usage.extractions).toBe(0);
    });

    it('发送消息后计数更新', () => {
      sm.createSubscription('u2', 'free');
      sm.recordMessage('u2');
      sm.recordMessage('u2');
      const usage = sm.getTodayUsage('u2');
      expect(usage.messages).toBe(2);
    });

    it('提取后计数更新', () => {
      sm.createSubscription('u3', 'free');
      sm.recordExtraction('u3');
      sm.recordExtraction('u3');
      sm.recordExtraction('u3');
      const usage = sm.getTodayUsage('u3');
      expect(usage.extractions).toBe(3);
    });
  });
});

describe('PaymentManager 补充', () => {
  it('getUserOrders 返回用户所有订单（按时间倒序）', async () => {
    const pm = new PaymentManager({ provider: 'stripe', apiKey: 'test' });
    await pm.createOrder('user1', 'pro', 'monthly');
    await pm.createOrder('user1', 'pro', 'yearly');
    await pm.createOrder('user2', 'free');

    const orders = pm.getUserOrders('user1');
    expect(orders).toHaveLength(2);
    expect(orders[0].userId).toBe('user1');
    expect(orders[1].userId).toBe('user1');
    // 按 createdAt 降序
    expect(orders[0].createdAt).toBeGreaterThanOrEqual(orders[1].createdAt);
  });

  it('getUserOrders 无订单返回空数组', () => {
    const pm = new PaymentManager({ provider: 'stripe', apiKey: 'test' });
    expect(pm.getUserOrders('nobody')).toEqual([]);
  });

  it('getOrderSummary 返回订单摘要', async () => {
    const pm = new PaymentManager({ provider: 'stripe', apiKey: 'test' });
    const r = await pm.createOrder('user1', 'pro', 'monthly');
    const summary = pm.getOrderSummary(r.orderId);

    expect(summary).toContain('pro');
    expect(summary).toContain('9'); // ¥9
    expect(summary).toContain('待支付');
  });

  it('getOrderSummary 已支付订单', async () => {
    const pm = new PaymentManager({ provider: 'stripe', apiKey: 'test' });
    const r = await pm.createOrder('user1', 'pro', 'monthly');
    pm.confirmPayment(r.orderId);
    const summary = pm.getOrderSummary(r.orderId);

    expect(summary).toContain('已支付');
  });

  it('getOrderSummary 不存在的订单', () => {
    const pm = new PaymentManager({ provider: 'stripe', apiKey: 'test' });
    expect(pm.getOrderSummary('ghost')).toBe('订单不存在');
  });

  it('cleanupExpiredOrders 清理过期 pending 订单', async () => {
    const pm = new PaymentManager({ provider: 'stripe', apiKey: 'test' });
    const r = await pm.createOrder('user1', 'pro', 'monthly');

    // 手动篡改 expiresAt 使其过期
    const order = pm.getOrder(r.orderId)!;
    (order as any).expiresAt = Date.now() - 1000;

    const cleaned = pm.cleanupExpiredOrders();
    expect(cleaned).toBe(1);
    expect(pm.getOrder(r.orderId)?.status).toBe('expired');
  });
});
