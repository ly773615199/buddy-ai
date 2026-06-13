import { describe, it, expect } from 'vitest';
import { FriendSystem } from './social/friends.js';
import { PlatformManager, CLIAdapter, TelegramAdapter, DiscordAdapter } from './social/platform.js';

describe('好友系统', () => {
  it('添加和获取好友', () => {
    const friends = new FriendSystem();
    const f1 = friends.addFriend({ id: 'bob', name: 'Bob', status: 'online', lastSeen: Date.now() });
    expect(f1.id).toBe('bob');
    expect(f1.name).toBe('Bob');
    expect(f1.addedAt).toBeGreaterThan(0);
    expect(friends.getFriend('bob')?.name).toBe('Bob');
    expect(friends.getFriend('nobody')).toBeUndefined();
  });

  it('列出好友按状态排序', () => {
    const friends = new FriendSystem();
    friends.addFriend({ id: 'bob', name: 'Bob', status: 'online', lastSeen: Date.now() });
    friends.addFriend({ id: 'alice', name: 'Alice', status: 'offline', lastSeen: Date.now() });
    friends.addFriend({ id: 'charlie', name: 'Charlie', status: 'idle', lastSeen: Date.now() });

    const all = friends.listFriends();
    expect(all).toHaveLength(3);
    expect(all[0].status).toBe('online');
    expect(all[all.length - 1].status).toBe('offline');

    expect(friends.listFriends('online')).toHaveLength(1);
    expect(friends.getOnlineCount()).toBe(1);
  });

  it('更新状态', () => {
    const friends = new FriendSystem();
    friends.addFriend({ id: 'bob', name: 'Bob', status: 'online', lastSeen: Date.now() });
    friends.updateStatus('bob', 'dnd');
    expect(friends.getFriend('bob')?.status).toBe('dnd');
  });

  it('移除好友', () => {
    const friends = new FriendSystem();
    friends.addFriend({ id: 'bob', name: 'Bob', status: 'online', lastSeen: Date.now() });
    expect(friends.removeFriend('bob')).toBe(true);
    expect(friends.listFriends()).toHaveLength(0);
    expect(friends.removeFriend('nobody')).toBe(false);
  });

  it('好友请求流程', () => {
    const friends = new FriendSystem();
    const req = friends.sendRequest('dave', 'bob', 'Bob', '加个好友呗');
    expect(req.id.startsWith('freq_')).toBe(true);
    expect(req.fromUserId).toBe('bob');
    expect(req.status).toBe('pending');
    expect(friends.getPendingRequests()).toHaveLength(1);

    const newFriend = friends.acceptRequest(req.id);
    expect(newFriend).not.toBeNull();
    expect(req.status).toBe('accepted');

    const req2 = friends.sendRequest('eve', 'bob', 'Bob');
    expect(friends.rejectRequest(req2.id)).toBe(true);
    expect(req2.status).toBe('rejected');
  });
});

describe('平台适配器', () => {
  it('CLI 适配器基本功能', () => {
    const platformMgr = new PlatformManager();
    platformMgr.register(new CLIAdapter());
    expect(platformMgr.list()).toContain('cli');

    const caps = platformMgr.getCapabilities('cli');
    expect(caps?.markdown).toBe(true);
  });

  it('Telegram 适配器注册和能力', () => {
    const platformMgr = new PlatformManager();
    platformMgr.register(new TelegramAdapter('fake-token'));
    expect(platformMgr.list()).toContain('telegram');

    const caps = platformMgr.getCapabilities('telegram');
    expect(caps?.markdown).toBe(true);
    expect(caps?.reactions).toBe(true);
    expect(caps?.images).toBe(true);
    expect(caps?.threads).toBe(false);
  });

  it('Discord 适配器注册和能力', () => {
    const platformMgr = new PlatformManager();
    platformMgr.register(new DiscordAdapter('fake-token'));
    expect(platformMgr.list()).toContain('discord');

    const caps = platformMgr.getCapabilities('discord');
    expect(caps?.threads).toBe(true);
    expect(caps?.reactions).toBe(true);
    expect(caps?.buttons).toBe(true);
  });

  it('多平台管理', () => {
    const platformMgr = new PlatformManager();
    platformMgr.register(new CLIAdapter());
    platformMgr.register(new TelegramAdapter('fake-token'));
    platformMgr.register(new DiscordAdapter('fake-token'));
    expect(platformMgr.list()).toHaveLength(3);
  });
});
