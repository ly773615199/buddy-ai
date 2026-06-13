/**
 * 好友系统
 * 添加/删除/在线状态/关系管理
 * SQLite 持久化
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { runMigrations, type Migration } from '../core/migration.js';

const FRIENDS_MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: '初始化好友系统表',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS friends (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          avatar TEXT,
          status TEXT NOT NULL DEFAULT 'offline',
          lastSeen INTEGER NOT NULL DEFAULT 0,
          buddySpecies TEXT,
          buddyLevel INTEGER,
          addedAt INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS friend_requests (
          id TEXT PRIMARY KEY,
          fromUserId TEXT NOT NULL,
          fromName TEXT NOT NULL,
          toUserId TEXT NOT NULL,
          message TEXT,
          createdAt INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'pending'
        );
      `);
    },
  },
];

export type FriendStatus = 'online' | 'idle' | 'offline' | 'dnd';

export interface Friend {
  id: string;
  name: string;
  avatar?: string;
  status: FriendStatus;
  lastSeen: number;
  buddySpecies?: string;
  buddyLevel?: number;
  addedAt: number;
}

export interface FriendRequest {
  id: string;
  fromUserId: string;
  fromName: string;
  toUserId: string;
  message?: string;
  createdAt: number;
  status: 'pending' | 'accepted' | 'rejected';
}

export class FriendSystem {
  private db: Database.Database;
  private friends = new Map<string, Friend>();
  private requests = new Map<string, FriendRequest>();
  private changeCallback: (() => void) | null = null;

  constructor(dbPath?: string) {
    if (dbPath) {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL');
      runMigrations(this.db, 'friends', FRIENDS_MIGRATIONS);
      this._loadAll();
    } else {
      // 内存模式（测试/向后兼容）
      this.db = new Database(':memory:');
      this.db.pragma('journal_mode = WAL');
      runMigrations(this.db, 'friends', FRIENDS_MIGRATIONS);
    }
  }

  private _loadAll(): void {
    const friendRows = this.db.prepare('SELECT * FROM friends').all() as Friend[];
    for (const f of friendRows) {
      this.friends.set(f.id, f);
    }
    const reqRows = this.db.prepare("SELECT * FROM friend_requests WHERE status = 'pending'").all() as FriendRequest[];
    for (const r of reqRows) {
      this.requests.set(r.id, r);
    }
  }

  /** 添加好友 */
  addFriend(friend: Omit<Friend, 'addedAt'>): Friend {
    const f: Friend = { ...friend, addedAt: Date.now() };
    this.friends.set(friend.id, f);
    this.db.prepare(`INSERT OR REPLACE INTO friends (id, name, avatar, status, lastSeen, buddySpecies, buddyLevel, addedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(f.id, f.name, f.avatar ?? null, f.status, f.lastSeen, f.buddySpecies ?? null, f.buddyLevel ?? null, f.addedAt);
    this._notify();
    return f;
  }

  /** 移除好友 */
  removeFriend(id: string): boolean {
    const result = this.friends.delete(id);
    if (result) {
      this.db.prepare('DELETE FROM friends WHERE id = ?').run(id);
      this._notify();
    }
    return result;
  }

  /** 获取好友 */
  getFriend(id: string): Friend | undefined {
    return this.friends.get(id);
  }

  /** 列出所有好友 */
  listFriends(statusFilter?: FriendStatus): Friend[] {
    const list = Array.from(this.friends.values());
    if (statusFilter) return list.filter(f => f.status === statusFilter);
    return list.sort((a, b) => {
      const order: Record<FriendStatus, number> = { online: 0, idle: 1, dnd: 2, offline: 3 };
      return order[a.status] - order[b.status] || b.lastSeen - a.lastSeen;
    });
  }

  /** 更新好友状态 */
  updateStatus(id: string, status: FriendStatus): void {
    const f = this.friends.get(id);
    if (f) {
      f.status = status;
      if (status === 'offline') f.lastSeen = Date.now();
      this.db.prepare('UPDATE friends SET status = ?, lastSeen = ? WHERE id = ?').run(f.status, f.lastSeen, id);
      this._notify();
    }
  }

  /** 在线好友数 */
  getOnlineCount(): number {
    return Array.from(this.friends.values()).filter(f => f.status === 'online').length;
  }

  // ==================== 好友请求 ====================

  /** 发送好友请求 */
  sendRequest(toUserId: string, fromUserId: string, fromName: string, message?: string): FriendRequest {
    const req: FriendRequest = {
      id: `freq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fromUserId,
      fromName,
      toUserId,
      message,
      createdAt: Date.now(),
      status: 'pending',
    };
    this.requests.set(req.id, req);
    this.db.prepare(`INSERT INTO friend_requests (id, fromUserId, fromName, toUserId, message, createdAt, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(req.id, req.fromUserId, req.fromName, req.toUserId, req.message ?? null, req.createdAt, req.status);
    return req;
  }

  /** 接受请求 */
  acceptRequest(requestId: string): Friend | null {
    const req = this.requests.get(requestId);
    if (!req || req.status !== 'pending') return null;
    req.status = 'accepted';
    this.db.prepare("UPDATE friend_requests SET status = 'accepted' WHERE id = ?").run(requestId);
    return this.addFriend({
      id: req.fromUserId,
      name: req.fromName,
      status: 'offline',
      lastSeen: Date.now(),
    });
  }

  /** 拒绝请求 */
  rejectRequest(requestId: string): boolean {
    const req = this.requests.get(requestId);
    if (!req || req.status !== 'pending') return false;
    req.status = 'rejected';
    this.db.prepare("UPDATE friend_requests SET status = 'rejected' WHERE id = ?").run(requestId);
    return true;
  }

  /** 获取待处理请求 */
  getPendingRequests(): FriendRequest[] {
    return Array.from(this.requests.values()).filter(r => r.status === 'pending');
  }

  /** 变更回调 */
  onChange(callback: () => void): () => void {
    this.changeCallback = callback;
    return () => { this.changeCallback = null; };
  }

  /** 清理 */
  destroy(): void {
    this.friends.clear();
    this.requests.clear();
    this.changeCallback = null;
    this.db.close();
  }

  private _notify(): void {
    this.changeCallback?.();
  }
}
