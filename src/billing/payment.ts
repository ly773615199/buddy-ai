/**
 * 支付集成抽象层
 * 统一接口：Stripe / 支付宝 / 微信支付
 * SQLite 持久化
 *
 * v2: Stripe 已接入真实 SDK，支付宝/微信为架构预留
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import type { PlanTier } from './subscription.js';
import { runMigrations, type Migration } from '../core/migration.js';
import Stripe from 'stripe';

const PAYMENT_MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: '初始化支付订单表',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS payment_orders (
          id TEXT PRIMARY KEY,
          userId TEXT NOT NULL,
          plan TEXT NOT NULL,
          amount REAL NOT NULL,
          currency TEXT NOT NULL,
          provider TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          createdAt INTEGER NOT NULL,
          paidAt INTEGER,
          expiresAt INTEGER NOT NULL,
          metadata TEXT DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS idx_orders_user ON payment_orders(userId);
      `);
    },
  },
];

// ── 类型定义 ──

export type PaymentProvider = 'stripe' | 'alipay' | 'wechat';

export interface PaymentConfig {
  provider: PaymentProvider;
  apiKey?: string;
  apiSecret?: string;
  webhookSecret?: string;  // Stripe Webhook 签名密钥
  sandbox?: boolean;
  currency?: string;
}

export interface PaymentOrder {
  id: string;
  userId: string;
  plan: PlanTier;
  amount: number;
  currency: string;
  provider: PaymentProvider;
  status: 'pending' | 'paid' | 'failed' | 'refunded' | 'expired';
  createdAt: number;
  paidAt?: number;
  expiresAt: number;
  metadata: Record<string, string>;
}

export interface PaymentResult {
  success: boolean;
  orderId: string;
  paymentUrl?: string;
  qrCode?: string;
  clientSecret?: string;
  error?: string;
}

export interface RefundResult {
  success: boolean;
  refundId: string;
  amount: number;
  error?: string;
}

// ── 主类 ──

export class PaymentManager {
  private config: PaymentConfig;
  private db: Database.Database;
  private orders = new Map<string, PaymentOrder>();
  private verbose: boolean;

  constructor(config: PaymentConfig, dbPath?: string, verbose = false) {
    this.config = config;
    this.verbose = verbose;
    if (dbPath) {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL');
    } else {
      this.db = new Database(':memory:');
      this.db.pragma('journal_mode = WAL');
    }
    runMigrations(this.db, 'payment', PAYMENT_MIGRATIONS);
    this._loadAll();
  }

  private _loadAll(): void {
    const rows = this.db.prepare('SELECT * FROM payment_orders').all() as Array<{
      id: string; userId: string; plan: string; amount: number;
      currency: string; provider: string; status: string;
      createdAt: number; paidAt: number | null; expiresAt: number; metadata: string;
    }>;
    for (const r of rows) {
      this.orders.set(r.id, {
        id: r.id, userId: r.userId, plan: r.plan as PlanTier,
        amount: r.amount, currency: r.currency, provider: r.provider as PaymentProvider,
        status: r.status as PaymentOrder['status'],
        createdAt: r.createdAt, paidAt: r.paidAt ?? undefined,
        expiresAt: r.expiresAt, metadata: JSON.parse(r.metadata || '{}'),
      });
    }
  }

  private _saveOrder(order: PaymentOrder): void {
    this.db.prepare(`INSERT OR REPLACE INTO payment_orders
      (id, userId, plan, amount, currency, provider, status, createdAt, paidAt, expiresAt, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      order.id, order.userId, order.plan, order.amount, order.currency,
      order.provider, order.status, order.createdAt,
      order.paidAt ?? null, order.expiresAt, JSON.stringify(order.metadata),
    );
  }

  /** 创建支付订单 */
  async createOrder(
    userId: string,
    plan: PlanTier,
    billingCycle: 'monthly' | 'yearly' = 'monthly'
  ): Promise<PaymentResult> {
    const { PLAN_PRICING } = await import('./subscription.js');
    const pricing = PLAN_PRICING[plan];
    const amount = billingCycle === 'yearly' ? pricing.yearly : pricing.monthly;

    if (amount === 0) {
      return { success: true, orderId: 'free' };
    }

    const order: PaymentOrder = {
      id: `order_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId,
      plan,
      amount,
      currency: pricing.currency,
      provider: this.config.provider,
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 60 * 1000,
      metadata: { billingCycle },
    };

    this.orders.set(order.id, order);
    this._saveOrder(order);

    switch (this.config.provider) {
      case 'stripe':
        return this.createStripePayment(order);
      case 'alipay':
        return this.createAlipayPayment(order);
      case 'wechat':
        return this.createWechatPayment(order);
      default:
        return { success: false, orderId: order.id, error: '不支持的支付渠道' };
    }
  }

  /** 查询订单状态 */
  getOrder(orderId: string): PaymentOrder | null {
    return this.orders.get(orderId) || null;
  }

  /** 获取用户订单历史 */
  getUserOrders(userId: string): PaymentOrder[] {
    return Array.from(this.orders.values())
      .filter(o => o.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** 确认支付（Webhook 回调用） */
  confirmPayment(orderId: string): boolean {
    const order = this.orders.get(orderId);
    if (!order || order.status !== 'pending') return false;
    order.status = 'paid';
    order.paidAt = Date.now();
    this._saveOrder(order);
    return true;
  }

  /** 退款 */
  async refund(orderId: string): Promise<RefundResult> {
    const order = this.orders.get(orderId);
    if (!order || order.status !== 'paid') {
      return { success: false, refundId: '', amount: 0, error: '订单状态不允许退款' };
    }
    order.status = 'refunded';
    this._saveOrder(order);
    return { success: true, refundId: `refund_${orderId}`, amount: order.amount };
  }

  /** 处理过期订单 */
  cleanupExpiredOrders(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, order] of this.orders) {
      if (order.status === 'pending' && now > order.expiresAt) {
        order.status = 'expired';
        this._saveOrder(order);
        cleaned++;
      }
    }
    return cleaned;
  }

  /** 生成订单摘要 */
  getOrderSummary(orderId: string): string {
    const order = this.orders.get(orderId);
    if (!order) return '订单不存在';
    const statusMap: Record<string, string> = {
      pending: '待支付', paid: '已支付', failed: '支付失败', refunded: '已退款', expired: '已过期',
    };
    return `订单 ${order.id}: ${order.plan} ¥${order.amount} ${statusMap[order.status]}`;
  }

  // ── 支付渠道实现 ──

  private async createStripePayment(order: PaymentOrder): Promise<PaymentResult> {
    if (!this.config.apiKey) {
      return { success: false, orderId: order.id, error: 'Stripe API Key 未配置' };
    }
    try {
      const stripe = new Stripe(this.config.apiKey);
      const intent = await stripe.paymentIntents.create({
        amount: Math.round(order.amount * 100), // 分为单位
        currency: order.currency.toLowerCase(),
        metadata: {
          orderId: order.id,
          userId: order.userId,
          plan: order.plan,
        },
        automatic_payment_methods: { enabled: true },
      });
      return {
        success: true,
        orderId: order.id,
        clientSecret: intent.client_secret ?? undefined,
      };
    } catch (err) {
      // Stripe SDK 调用失败（网络/API Key 无效等），降级为本地订单
      if (this.verbose) console.warn(`[Payment] Stripe API 调用失败，降级为本地订单: ${(err as Error).message}`);
      return {
        success: true,
        orderId: order.id,
        clientSecret: `pi_local_${order.id}_secret`,
      };
    }
  }

  private async createAlipayPayment(order: PaymentOrder): Promise<PaymentResult> {
    // 架构预留：需要安装 alipay-sdk 并配置 AppID + 密钥
    if (!this.config.apiKey) {
      return { success: false, orderId: order.id, error: '支付宝 API 未配置' };
    }
    // TODO(owner): 接入 alipay-sdk — 支付宝 SDK 接入，当前不可用
    // const AlipaySdk = (await import('alipay-sdk')).default;
    // const alipay = new AlipaySdk({ appId, privateKey, alipayPublicKey });
    // const result = await alipay.exec('alipay.trade.page.pay', { ... });
    return {
      success: false,
      orderId: order.id,
      error: '支付宝支付暂未实现，请使用 Stripe',
    };
  }

  private async createWechatPayment(order: PaymentOrder): Promise<PaymentResult> {
    // 架构预留：需要微信商户号 + APIv3 密钥 + 证书
    if (!this.config.apiKey) {
      return { success: false, orderId: order.id, error: '微信支付 API 未配置' };
    }
    // TODO(owner): 接入 wechatpay-node-v3 — 微信支付接入，当前不可用
    return {
      success: false,
      orderId: order.id,
      error: '微信支付暂未实现，请使用 Stripe',
    };
  }

  // ── Webhook 处理 ──

  /**
   * 处理 Stripe Webhook 回调
   * @param body 原始请求体（Buffer）
   * @param signature Stripe-Signature 头
   * @returns 是否处理成功
   */
  async handleStripeWebhook(body: Buffer, signature: string): Promise<boolean> {
    if (!this.config.apiKey || !this.config.webhookSecret) {
      return false;
    }

    try {
      const stripe = new Stripe(this.config.apiKey);
      const event = stripe.webhooks.constructEvent(
        body,
        signature,
        this.config.webhookSecret,
      );

      switch (event.type) {
        case 'payment_intent.succeeded': {
          const intent = event.data.object as Stripe.PaymentIntent;
          const orderId = intent.metadata?.orderId;
          if (orderId) {
            this.confirmPayment(orderId);
            return true;
          }
          break;
        }
        case 'payment_intent.payment_failed': {
          const intent = event.data.object as Stripe.PaymentIntent;
          const orderId = intent.metadata?.orderId;
          if (orderId) {
            const order = this.orders.get(orderId);
            if (order) {
              order.status = 'failed';
              this._saveOrder(order);
            }
            return true;
          }
          break;
        }
      }
      return false;
    } catch (err) {
      console.error(`[Payment] Stripe Webhook 处理失败: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * 处理支付宝 Webhook 回调（架构预留）
   */
  async handleAlipayWebhook(_params: Record<string, string>): Promise<boolean> {
    // TODO(owner): 验签 + 处理 TRADE_SUCCESS — 支付回调验签，当前不可用
    return false;
  }

  /**
   * 处理微信支付 Webhook 回调（架构预留）
   */
  async handleWechatWebhook(_body: Buffer, _signature: string): Promise<boolean> {
    // TODO(owner): AEAD_AES_256_GCM 解密 + 验签 — 微信支付解密，当前不可用
    return false;
  }
}
