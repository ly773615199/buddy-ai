/**
 * 商城系统 — SQLite 持久化版
 * 商品目录 + 购买 + 库存 + 赛季活动
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { runMigrations, type Migration } from '../core/migration.js';
import { ModelRepository, type RepositoryConfig } from './repository.js';

// ── 类型定义 ──

export type ItemType = 'costume' | 'accessory' | 'effect' | 'background' | 'pet_skin' | 'bundle' | 'expert_model';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type CurrencyType = 'coins' | 'gems' | 'real';

export interface ShopItem {
  id: string;
  name: string;
  description: string;
  type: ItemType;
  rarity: Rarity;
  price: number;
  currency: CurrencyType;
  previewUrl?: string;
  tags: string[];
  seasonId?: string;
  limitedQuantity?: number;
  soldCount: number;
  available: boolean;
  createdAt: number;
}

export interface Season {
  id: string;
  name: string;
  description: string;
  startTime: number;
  endTime: number;
  theme: string;
  items: string[];
  tasks: SeasonTask[];
  leaderboard: SeasonLeaderboard;
  isActive: boolean;
}

export interface SeasonTask {
  id: string;
  name: string;
  description: string;
  target: number;
  progress: number;
  reward: { type: CurrencyType; amount: number };
  completed: boolean;
}

export interface SeasonLeaderboard {
  entries: Array<{ userId: string; score: number; rank: number }>;
  updatedAt: number;
}

export interface UserInventory {
  userId: string;
  items: Array<{ itemId: string; acquiredAt: number; equipped: boolean }>;
  coins: number;
  gems: number;
}

// SQLite 行类型
interface ItemRow {
  id: string; name: string; description: string; type: string; rarity: string;
  price: number; currency: string; preview_url: string | null; tags: string;
  season_id: string | null; limited_quantity: number; sold_count: number;
  available: number; created_at: number;
}
interface InventorySlotRow { user_id: string; item_id: string; acquired_at: number; equipped: number }
interface SeasonRow {
  id: string; name: string; description: string; start_time: number; end_time: number;
  theme: string; items: string; is_active: number;
}
interface TaskRow {
  id: string; season_id: string; name: string; description: string;
  target: number; progress: number; reward_type: string; reward_amount: number; completed: number;
}
interface LeaderboardRow { user_id: string; score: number; rank: number; updated_at?: number }
interface CountRow { c: number }

// ── Migrations ──

const SHOP_MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: '初始化商城表结构',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS shop_items (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          type TEXT NOT NULL,
          rarity TEXT NOT NULL,
          price INTEGER NOT NULL,
          currency TEXT NOT NULL,
          preview_url TEXT,
          tags TEXT NOT NULL DEFAULT '[]',
          season_id TEXT,
          limited_quantity INTEGER DEFAULT -1,
          sold_count INTEGER NOT NULL DEFAULT 0,
          available INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS user_inventory (
          user_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          acquired_at INTEGER NOT NULL,
          equipped INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, item_id)
        );

        CREATE TABLE IF NOT EXISTS user_wallet (
          user_id TEXT PRIMARY KEY,
          coins INTEGER NOT NULL DEFAULT 1000,
          gems INTEGER NOT NULL DEFAULT 50
        );

        CREATE TABLE IF NOT EXISTS seasons (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          start_time INTEGER NOT NULL,
          end_time INTEGER NOT NULL,
          theme TEXT NOT NULL,
          items TEXT NOT NULL DEFAULT '[]',
          is_active INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS season_tasks (
          id TEXT PRIMARY KEY,
          season_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          target INTEGER NOT NULL,
          progress INTEGER NOT NULL DEFAULT 0,
          reward_type TEXT NOT NULL,
          reward_amount INTEGER NOT NULL,
          completed INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (season_id) REFERENCES seasons(id)
        );

        CREATE TABLE IF NOT EXISTS season_leaderboard (
          season_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          score INTEGER NOT NULL DEFAULT 0,
          rank INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (season_id, user_id)
        );
      `);
    },
  },
];

// ── 主类 ──

export class ShopCatalog {
  private db: Database.Database;
  readonly repository: ModelRepository;

  constructor(dbDir?: string) {
    const dir = dbDir ?? path.join(process.env.HOME ?? '/tmp', '.buddy');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const dbPath = path.join(dir, 'shop.db');

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    runMigrations(this.db, 'shop', SHOP_MIGRATIONS);
    this.seedDefaults();

    // 初始化模型仓库
    this.repository = new ModelRepository({
      localDir: path.join(dir, 'registry'),
    });
    this.repository.init().catch(() => {});
  }

  private seedDefaults(): void {
    const count = this.db.prepare('SELECT COUNT(*) as c FROM shop_items').get() as CountRow;
    if (count.c > 0) return;

    const defaults: ShopItem[] = [
      { id: 'hat_party', name: '派对帽', description: '五彩缤纷的派对帽子', type: 'accessory', rarity: 'common', price: 100, currency: 'coins', tags: ['fun', 'colorful'], soldCount: 0, available: true, createdAt: Date.now() },
      { id: 'hat_crown', name: '小皇冠', description: '闪闪发光的小皇冠', type: 'accessory', rarity: 'rare', price: 500, currency: 'coins', tags: ['royal', 'shiny'], soldCount: 0, available: true, createdAt: Date.now() },
      { id: 'effect_sparkle', name: '星光特效', description: '身边环绕着星星点点', type: 'effect', rarity: 'uncommon', price: 200, currency: 'coins', tags: ['sparkle', 'dreamy'], soldCount: 0, available: true, createdAt: Date.now() },
      { id: 'effect_fire', name: '火焰特效', description: '脚下燃起烈焰', type: 'effect', rarity: 'epic', price: 30, currency: 'gems', tags: ['fire', 'cool'], soldCount: 0, available: true, createdAt: Date.now() },
      { id: 'bg_stars', name: '星空背景', description: '深邃的星空背景', type: 'background', rarity: 'uncommon', price: 150, currency: 'coins', tags: ['space', 'calm'], soldCount: 0, available: true, createdAt: Date.now() },
      { id: 'bg_sakura', name: '樱花背景', description: '飘落的樱花瓣', type: 'background', rarity: 'rare', price: 300, currency: 'coins', tags: ['japan', 'spring'], soldCount: 0, available: true, createdAt: Date.now() },
      { id: 'costume_wizard', name: '巫师袍', description: '神秘的巫师长袍', type: 'costume', rarity: 'epic', price: 50, currency: 'gems', tags: ['magic', 'mystery'], soldCount: 0, available: true, createdAt: Date.now() },
      { id: 'costume_legend', name: '传说战甲', description: '闪耀着远古力量的战甲', type: 'costume', rarity: 'legendary', price: 100, currency: 'gems', tags: ['legendary', 'power'], soldCount: 0, available: true, createdAt: Date.now() },
    ];

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO shop_items (id, name, description, type, rarity, price, currency, tags, sold_count, available, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((items: ShopItem[]) => {
      for (const item of items) {
        stmt.run(item.id, item.name, item.description, item.type, item.rarity,
          item.price, item.currency, JSON.stringify(item.tags), item.soldCount,
          item.available ? 1 : 0, item.createdAt);
      }
    });
    insertMany(defaults);
  }

  // ── 行转换 ──

  private rowToItem(row: ItemRow): ShopItem {
    return {
      id: row.id, name: row.name, description: row.description,
      type: row.type as ItemType, rarity: row.rarity as Rarity, price: row.price,
      currency: row.currency as CurrencyType, previewUrl: row.preview_url || undefined,
      tags: JSON.parse(row.tags || '[]'),
      seasonId: row.season_id || undefined,
      limitedQuantity: row.limited_quantity ?? undefined,
      soldCount: row.sold_count, available: !!row.available,
      createdAt: row.created_at,
    };
  }

  // ── 商品管理 ──

  getAvailableItems(filters?: {
    type?: ItemType; rarity?: Rarity; seasonId?: string;
    maxPrice?: number; currency?: CurrencyType;
  }): ShopItem[] {
    let sql = 'SELECT * FROM shop_items WHERE available = 1';
    const params: any[] = [];

    if (filters?.type) { sql += ' AND type = ?'; params.push(filters.type); }
    if (filters?.rarity) { sql += ' AND rarity = ?'; params.push(filters.rarity); }
    if (filters?.seasonId) { sql += ' AND season_id = ?'; params.push(filters.seasonId); }
    if (filters?.maxPrice !== undefined) { sql += ' AND price <= ?'; params.push(filters.maxPrice); }
    if (filters?.currency) { sql += ' AND currency = ?'; params.push(filters.currency); }

    const rarityOrder: Record<string, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
    sql += ' ORDER BY sold_count DESC';

    const rows = this.db.prepare(sql).all(...params) as ItemRow[];
    return rows.map(r => this.rowToItem(r))
      .sort((a, b) => rarityOrder[b.rarity] - rarityOrder[a.rarity] || a.price - b.price);
  }

  getItem(itemId: string): ShopItem | null {
    const row = this.db.prepare('SELECT * FROM shop_items WHERE id = ?').get(itemId) as ItemRow | undefined;
    return row ? this.rowToItem(row) : null;
  }

  addItem(item: ShopItem): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO shop_items (id, name, description, type, rarity, price, currency, preview_url, tags, season_id, limited_quantity, sold_count, available, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(item.id, item.name, item.description, item.type, item.rarity,
      item.price, item.currency, item.previewUrl ?? null, JSON.stringify(item.tags),
      item.seasonId ?? null, item.limitedQuantity ?? -1, item.soldCount,
      item.available ? 1 : 0, item.createdAt);
  }

  purchase(userId: string, itemId: string): { success: boolean; error?: string } {
    const item = this.getItem(itemId);
    if (!item || !item.available) return { success: false, error: '商品不可购买' };

    // 检查限量
    if (item.limitedQuantity && item.limitedQuantity > 0 && item.soldCount >= item.limitedQuantity) {
      this.db.prepare('UPDATE shop_items SET available = 0 WHERE id = ?').run(itemId);
      return { success: false, error: '商品已售罄' };
    }

    // 检查用户余额
    const wallet = this.getWallet(userId);
    const balance = item.currency === 'coins' ? wallet.coins : item.currency === 'gems' ? wallet.gems : 0;
    if (item.currency !== 'real' && balance < item.price) {
      return { success: false, error: `余额不足，需要 ${item.price} ${item.currency}` };
    }

    // 事务：扣款 + 加库存 + 更新售出数
    const txn = this.db.transaction(() => {
      if (item.currency === 'coins') {
        this.db.prepare('UPDATE user_wallet SET coins = coins - ? WHERE user_id = ?').run(item.price, userId);
      } else if (item.currency === 'gems') {
        this.db.prepare('UPDATE user_wallet SET gems = gems - ? WHERE user_id = ?').run(item.price, userId);
      }

      this.db.prepare(`
        INSERT OR REPLACE INTO user_inventory (user_id, item_id, acquired_at, equipped)
        VALUES (?, ?, ?, 0)
      `).run(userId, itemId, Date.now());

      this.db.prepare('UPDATE shop_items SET sold_count = sold_count + 1 WHERE id = ?').run(itemId);
    });

    txn();
    return { success: true };
  }

  // ── 库存管理 ──

  private getWallet(userId: string): { coins: number; gems: number } {
    let row = this.db.prepare('SELECT coins, gems FROM user_wallet WHERE user_id = ?').get(userId) as { coins: number; gems: number } | undefined;
    if (!row) {
      this.db.prepare('INSERT INTO user_wallet (user_id, coins, gems) VALUES (?, 1000, 50)').run(userId);
      row = { coins: 1000, gems: 50 };
    }
    return row;
  }

  getInventory(userId: string): UserInventory {
    const wallet = this.getWallet(userId);
    const rows = this.db.prepare('SELECT item_id, acquired_at, equipped FROM user_inventory WHERE user_id = ?').all(userId) as InventorySlotRow[];
    return {
      userId,
      items: rows.map(r => ({ itemId: r.item_id, acquiredAt: r.acquired_at, equipped: !!r.equipped })),
      coins: wallet.coins,
      gems: wallet.gems,
    };
  }

  equipItem(userId: string, itemId: string, equip: boolean): boolean {
    const slot = this.db.prepare('SELECT * FROM user_inventory WHERE user_id = ? AND item_id = ?').get(userId, itemId) as InventorySlotRow | undefined;
    if (!slot) return false;

    if (equip) {
      // 卸下同类型其他物品
      const item = this.getItem(itemId);
      if (item) {
        const sameType = this.db.prepare(`
          SELECT ui.item_id FROM user_inventory ui
          JOIN shop_items si ON ui.item_id = si.id
          WHERE ui.user_id = ? AND si.type = ? AND ui.item_id != ?
        `).all(userId, item.type, itemId) as { item_id: string }[];
        for (const s of sameType) {
          this.db.prepare('UPDATE user_inventory SET equipped = 0 WHERE user_id = ? AND item_id = ?').run(userId, s.item_id);
        }
      }
    }

    this.db.prepare('UPDATE user_inventory SET equipped = ? WHERE user_id = ? AND item_id = ?').run(equip ? 1 : 0, userId, itemId);
    return true;
  }

  getEquippedItems(userId: string): ShopItem[] {
    const rows = this.db.prepare(`
      SELECT si.* FROM user_inventory ui
      JOIN shop_items si ON ui.item_id = si.id
      WHERE ui.user_id = ? AND ui.equipped = 1
    `).all(userId) as ItemRow[];
    return rows.map(r => this.rowToItem(r));
  }

  // ── 赛季系统 ──

  createSeason(season: Season): void {
    const txn = this.db.transaction(() => {
      this.db.prepare(`
        INSERT OR REPLACE INTO seasons (id, name, description, start_time, end_time, theme, items, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(season.id, season.name, season.description, season.startTime, season.endTime,
        season.theme, JSON.stringify(season.items), season.isActive ? 1 : 0);

      for (const task of season.tasks) {
        this.db.prepare(`
          INSERT OR REPLACE INTO season_tasks (id, season_id, name, description, target, progress, reward_type, reward_amount, completed)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(task.id, season.id, task.name, task.description, task.target,
          task.progress, task.reward.type, task.reward.amount, task.completed ? 1 : 0);
      }
    });
    txn();
  }

  getActiveSeason(): Season | null {
    const now = Date.now();
    const row = this.db.prepare('SELECT * FROM seasons WHERE is_active = 1 AND start_time <= ? AND end_time >= ?').get(now, now) as SeasonRow | undefined;
    return row ? this.rowToSeason(row) : null;
  }

  getSeason(seasonId: string): Season | null {
    const row = this.db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId) as SeasonRow | undefined;
    return row ? this.rowToSeason(row) : null;
  }

  private rowToSeason(row: SeasonRow): Season {
    const tasks = this.db.prepare('SELECT * FROM season_tasks WHERE season_id = ?').all(row.id) as TaskRow[];
    const lbRows = this.db.prepare('SELECT user_id, score, rank FROM season_leaderboard WHERE season_id = ? ORDER BY rank').all(row.id) as LeaderboardRow[];
    return {
      id: row.id, name: row.name, description: row.description,
      startTime: row.start_time, endTime: row.end_time, theme: row.theme,
      items: JSON.parse(row.items || '[]'),
      tasks: tasks.map(t => ({
        id: t.id, name: t.name, description: t.description,
        target: t.target, progress: t.progress,
        reward: { type: t.reward_type as CurrencyType, amount: t.reward_amount },
        completed: !!t.completed,
      })),
      leaderboard: {
        entries: lbRows.map(r => ({ userId: r.user_id, score: r.score, rank: r.rank })),
        updatedAt: lbRows[0]?.updated_at ?? 0,
      },
      isActive: !!row.is_active,
    };
  }

  updateTaskProgress(seasonId: string, taskId: string, progress: number): boolean {
    const result = this.db.prepare(`
      UPDATE season_tasks SET progress = MIN(?, target), completed = CASE WHEN ? >= target THEN 1 ELSE completed END
      WHERE id = ? AND season_id = ?
    `).run(progress, progress, taskId, seasonId);
    return result.changes > 0;
  }

  updateLeaderboard(seasonId: string, userId: string, score: number): void {
    this.db.prepare(`
      INSERT INTO season_leaderboard (season_id, user_id, score, rank, updated_at)
      VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(season_id, user_id) DO UPDATE SET score = MAX(score, ?), updated_at = ?
    `).run(seasonId, userId, score, Date.now(), score, Date.now());

    // 重新排名
    const entries = this.db.prepare('SELECT user_id, score FROM season_leaderboard WHERE season_id = ? ORDER BY score DESC').all(seasonId) as LeaderboardRow[];
    const updateRank = this.db.prepare('UPDATE season_leaderboard SET rank = ? WHERE season_id = ? AND user_id = ?');
    entries.forEach((e, i) => updateRank.run(i + 1, seasonId, e.user_id));
  }

  getStats() {
    const items = this.db.prepare('SELECT * FROM shop_items').all() as ItemRow[];
    const byType: Record<string, number> = {};
    const byRarity: Record<string, number> = {};
    let totalSold = 0;
    for (const row of items) {
      byType[row.type] = (byType[row.type] || 0) + 1;
      byRarity[row.rarity] = (byRarity[row.rarity] || 0) + 1;
      totalSold += row.sold_count;
    }
    const seasons = this.db.prepare('SELECT COUNT(*) as c FROM seasons').get() as CountRow;
    const active = this.getActiveSeason();
    return { totalItems: items.length, byType, byRarity, totalSold, seasons: seasons.c, activeSeason: active?.name || null };
  }

  close(): void {
    this.db.close();
  }
}
