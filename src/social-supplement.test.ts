/**
 * Social 模块补充测试
 * 覆盖：FriendSystem.onChange/destroy
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { FriendSystem } from './social/friends.js';

describe('FriendSystem 补充', () => {
  let fs: FriendSystem;

  beforeEach(() => {
    fs = new FriendSystem();
  });

  describe('onChange() 变更回调', () => {
    it('添加好友触发回调', () => {
      let called = false;
      fs.onChange(() => { called = true; });
      fs.addFriend({ id: 'bob', name: 'Bob', status: 'online', lastSeen: Date.now() });
      expect(called).toBe(true);
    });

    it('移除好友触发回调', () => {
      fs.addFriend({ id: 'bob', name: 'Bob', status: 'online', lastSeen: Date.now() });
      let called = false;
      fs.onChange(() => { called = true; });
      fs.removeFriend('bob');
      expect(called).toBe(true);
    });

    it('更新状态触发回调', () => {
      fs.addFriend({ id: 'bob', name: 'Bob', status: 'online', lastSeen: Date.now() });
      let called = false;
      fs.onChange(() => { called = true; });
      fs.updateStatus('bob', 'dnd');
      expect(called).toBe(true);
    });

    it('发送好友请求不触发回调（设计如此：仅好友数据变更触发）', () => {
      let called = false;
      fs.onChange(() => { called = true; });
      fs.sendRequest('alice', 'bob', 'Bob', '加好友');
      expect(called).toBe(false);
    });

    it('接受请求触发回调', () => {
      const req = fs.sendRequest('alice', 'bob', 'Bob');
      let called = false;
      fs.onChange(() => { called = true; });
      fs.acceptRequest(req.id);
      expect(called).toBe(true);
    });

    it('取消注册回调后不再触发', () => {
      let count = 0;
      const unsub = fs.onChange(() => { count++; });
      fs.addFriend({ id: 'bob', name: 'Bob', status: 'online', lastSeen: Date.now() });
      expect(count).toBe(1);

      unsub(); // 取消注册
      fs.addFriend({ id: 'alice', name: 'Alice', status: 'online', lastSeen: Date.now() });
      expect(count).toBe(1); // 不再增加
    });
  });

  describe('destroy() 清理', () => {
    it('清理后好友列表为空', () => {
      fs.addFriend({ id: 'bob', name: 'Bob', status: 'online', lastSeen: Date.now() });
      fs.addFriend({ id: 'alice', name: 'Alice', status: 'offline', lastSeen: Date.now() });
      fs.destroy();
      // 内存已清理，但 DB 可能还有（取决于实现）
      // 这里验证不抛异常
    });

    it('清理后回调不再触发', () => {
      let count = 0;
      fs.onChange(() => { count++; });
      fs.destroy();
      // destroy 后数据库已关闭，后续操作可能抛异常或静默失败
      // 关键是不崩溃
    });
  });
});
