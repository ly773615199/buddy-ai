/**
 * Phase C Week 17 — 社交 + 多平台测试 (vitest)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FriendSystem, type FriendStatus } from './social/friends.js';
import { BuddyInteractionSystem, type BuddyProfile } from './social/buddy-interact.js';
import { PlatformManager, CLIAdapter, TelegramAdapter, DiscordAdapter } from './social/platform.js';

describe('Phase C Week 17 — 社交 + 多平台', () => {
  // ==================== 好友系统测试 ====================

  describe('好友系统', () => {
    let friends: FriendSystem;

    beforeAll(() => {
      friends = new FriendSystem();
      friends.addFriend({ id: 'bob', name: 'Bob', status: 'online', lastSeen: Date.now() });
      friends.addFriend({ id: 'alice', name: 'Alice', status: 'offline', lastSeen: Date.now() - 3600000 });
      friends.addFriend({ id: 'charlie', name: 'Charlie', status: 'idle', lastSeen: Date.now() });
    });

    afterAll(() => {
      friends.destroy();
    });

    it('添加好友 — ID、名称、添加时间正确', () => {
      const f = friends.getFriend('bob');
      expect(f).toBeDefined();
      expect(f!.name).toBe('Bob');
      expect(f!.addedAt).toBeGreaterThan(0);
    });

    it('通过 ID 获取好友', () => {
      expect(friends.getFriend('bob')?.name).toBe('Bob');
      expect(friends.getFriend('nobody')).toBeUndefined();
    });

    it('列出好友按状态排序', () => {
      const all = friends.listFriends();
      expect(all.length).toBe(3);
      expect(all[0].status).toBe('online');
      expect(all[all.length - 1].status).toBe('offline');
    });

    it('按状态过滤', () => {
      const onlineOnly = friends.listFriends('online');
      expect(onlineOnly.length).toBe(1);
      expect(onlineOnly[0].id).toBe('bob');
    });

    it('在线人数', () => {
      expect(friends.getOnlineCount()).toBe(1);
    });

    it('更新状态', () => {
      friends.updateStatus('bob', 'dnd');
      expect(friends.getFriend('bob')?.status).toBe('dnd');
      expect(friends.getOnlineCount()).toBe(0);

      friends.updateStatus('bob', 'offline');
      expect((friends.getFriend('bob')?.lastSeen ?? 0)).toBeGreaterThan(0);
    });

    it('移除好友', () => {
      expect(friends.removeFriend('charlie')).toBe(true);
      expect(friends.listFriends().length).toBe(2);
      expect(friends.removeFriend('nobody')).toBe(false);
    });

    it('好友请求 — 发送、接受', () => {
      const req = friends.sendRequest('dave', 'bob', 'Bob', '加个好友呗');
      expect(req.id.startsWith('freq_')).toBe(true);
      expect(req.fromUserId).toBe('bob');
      expect(req.status).toBe('pending');
      expect(friends.getPendingRequests().length).toBe(1);

      const newFriend = friends.acceptRequest(req.id);
      expect(newFriend).not.toBeNull();
      expect(req.status).toBe('accepted');
    });

    it('好友请求 — 拒绝', () => {
      friends.updateStatus('bob', 'online');
      const req2 = friends.sendRequest('eve', 'bob', 'Bob');
      expect(friends.rejectRequest(req2.id)).toBe(true);
      expect(req2.status).toBe('rejected');
    });

    it('变更回调触发', () => {
      let changed = false;
      const unsub = friends.onChange(() => { changed = true; });
      friends.addFriend({ id: 'frank', name: 'Frank', status: 'online', lastSeen: Date.now() });
      expect(changed).toBe(true);
      unsub();
    });
  });

  // ==================== 精灵互动系统测试 ====================

  describe('精灵互动系统', () => {
    let interact: BuddyInteractionSystem;
    const buddyA: BuddyProfile = {
      id: 'buddy_1', name: '小光', species: '光灵', level: 15,
      stage: '成长', attributes: { snark: 60, wisdom: 70 }, ownerId: 'user1', ownerName: 'Alice',
    };
    const buddyB: BuddyProfile = {
      id: 'buddy_2', name: '大鹅', species: '大鹅', level: 22,
      stage: '成熟', attributes: { snark: 30, wisdom: 85 }, ownerId: 'user2', ownerName: 'Bob',
    };

    beforeAll(() => {
      interact = new BuddyInteractionSystem();
    });

    afterAll(() => {
      interact.destroy();
    });

    it('串门 — ID 正确，访客/主人正确，有打招呼记录', () => {
      const visit = interact.startVisit(buddyA, buddyB);
      expect(visit.id.startsWith('visit_')).toBe(true);
      expect(visit.guest.name).toBe('小光');
      expect(visit.host.name).toBe('大鹅');
      expect(visit.interactions.length).toBe(1);
      expect(visit.interactions[0].type).toBe('greet');
      expect(visit.interactions[0].content).toContain('小光');
      expect(visit.endTime).toBeUndefined();
    });

    it('串门互动 — play 和 chat', () => {
      const visits = interact.getActiveVisits();
      const visitId = visits[0].id;

      const play = interact.interact(visitId, 'play', '小狐和大鹅玩起了捉迷藏');
      expect(play).not.toBeNull();
      expect(play!.type).toBe('play');

      const chat = interact.interact(visitId, 'chat', '大鹅说：你跑太快了！');
      expect(chat).not.toBeNull();

      expect(visits[0].interactions.length).toBe(3);
    });

    it('结束串门', () => {
      const visits = interact.getActiveVisits();
      const visitId = visits[0].id;
      const ended = interact.endVisit(visitId);
      expect(ended).not.toBeNull();
      expect(ended!.endTime!).toBeGreaterThanOrEqual(ended!.startTime);
      expect(interact.getActiveVisits().length).toBe(0);
    });

    it('结束不存在的串门返回 null', () => {
      expect(interact.endVisit('nonexistent')).toBeNull();
    });

    it('精灵对话 — 开始、添加消息、结束', () => {
      const conv = interact.startConversation(buddyA, buddyB, '关于编程');
      expect(conv.id.startsWith('conv_')).toBe(true);
      expect(conv.topic).toBe('关于编程');
      expect(conv.endTime).toBeUndefined();

      interact.addMessage(conv.id, 'buddy_1', '你最近在学什么？');
      interact.addMessage(conv.id, 'buddy_2', '在学 Rust！');
      interact.addMessage(conv.id, 'buddy_1', '厉害！我也想学');

      const endedConv = interact.endConversation(conv.id);
      expect(endedConv).not.toBeNull();
      expect(endedConv!.messages.length).toBe(3);

      const history = interact.getConversation(conv.id);
      expect(history?.messages[1].content).toBe('在学 Rust！');
    });

    it('合影', () => {
      const photo = interact.generatePhotoData([buddyA, buddyB]);
      expect(photo.participants.length).toBe(2);
      expect(photo.participants).toContain('小光');
      expect(photo.caption).toContain('合影');
    });

    it('排行榜', () => {
      interact.updateLeaderboard('level', [
        { buddyId: 'buddy_2', buddyName: '大鹅', ownerName: 'Bob', score: 22 },
        { buddyId: 'buddy_1', buddyName: '小狐', ownerName: 'Alice', score: 15 },
        { buddyId: 'buddy_3', buddyName: '龙龙', ownerName: 'Charlie', score: 30 },
      ]);

      const board = interact.getLeaderboard('level');
      expect(board.length).toBe(3);
      expect(board[0].buddyName).toBe('龙龙');
      expect(board[0].rank).toBe(1);
      expect(board[2].buddyName).toBe('小狐');

      expect(interact.getRank('level', 'buddy_1')).toBe(3);
      expect(interact.getRank('level', 'nonexistent')).toBe(-1);
    });

    it('排行指标', () => {
      const metrics = interact.getAvailableMetrics();
      expect(metrics.length).toBe(4);
      expect(metrics).toContain('level');
      expect(metrics).toContain('knowledge_packages');
    });
  });

  // ==================== 多平台适配器测试 ====================

  describe('多平台适配器', () => {
    let platformMgr: PlatformManager;

    beforeAll(() => {
      platformMgr = new PlatformManager();
      platformMgr.register(new CLIAdapter());
      platformMgr.register(new TelegramAdapter('fake-token'));
      platformMgr.register(new DiscordAdapter('fake-token'));
    });

    afterAll(() => {
      platformMgr.destroy();
    });

    it('注册 3 个平台', () => {
      expect(platformMgr.list().length).toBe(3);
      expect(platformMgr.list()).toContain('cli');
      expect(platformMgr.list()).toContain('telegram');
      expect(platformMgr.list()).toContain('discord');
    });

    it('CLI 能力', () => {
      const cliCaps = platformMgr.getCapabilities('cli');
      expect(cliCaps?.files).toBe(true);
      expect(cliCaps?.markdown).toBe(true);
      expect(cliCaps?.voice).toBe(false);
    });

    it('Telegram 能力', () => {
      const tgCaps = platformMgr.getCapabilities('telegram');
      expect(tgCaps?.markdown).toBe(true);
      expect(tgCaps?.reactions).toBe(true);
      expect(tgCaps?.images).toBe(true);
      expect(tgCaps?.threads).toBe(false);
    });

    it('Discord 能力', () => {
      const dcCaps = platformMgr.getCapabilities('discord');
      expect(dcCaps?.threads).toBe(true);
      expect(dcCaps?.reactions).toBe(true);
      expect(dcCaps?.buttons).toBe(true);
    });

    it('初始无活跃平台', () => {
      expect(platformMgr.getActive()).toBeNull();
    });

    it('未注册平台返回 null', () => {
      expect(platformMgr.getCapabilities('web')).toBeNull();
    });
  });
});
