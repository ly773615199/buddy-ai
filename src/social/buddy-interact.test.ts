/**
 * BuddyInteractionSystem 单元测试
 * 覆盖：串门系统、精灵对话、合影、排行榜
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { BuddyInteractionSystem, type BuddyProfile } from './buddy-interact.js';

// ── 测试用精灵数据 ──

const makeBuddy = (overrides: Partial<BuddyProfile> = {}): BuddyProfile => ({
  id: `buddy_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  name: '小灵',
  species: '光灵',
  level: 5,
  stage: '成长',
  attributes: { attack: 30, defense: 25, speed: 40, intelligence: 50, charm: 35 },
  ownerId: 'owner_1',
  ownerName: 'Alice',
  ...overrides,
});

const buddyA = makeBuddy({ id: 'buddy_a', name: '小灵', ownerId: 'owner_1', ownerName: 'Alice' });
const buddyB = makeBuddy({ id: 'buddy_b', name: '小火', species: '火灵', level: 8, ownerId: 'owner_2', ownerName: 'Bob' });
const buddyC = makeBuddy({ id: 'buddy_c', name: '小水', species: '水灵', level: 12, ownerId: 'owner_3', ownerName: 'Charlie' });

// ==================== 串门系统 ====================

describe('串门系统', () => {
  let sys: BuddyInteractionSystem;

  beforeEach(() => {
    sys = new BuddyInteractionSystem();
  });

  it('开始串门自动添加 greet 互动', () => {
    const visit = sys.startVisit(buddyA, buddyB);

    expect(visit.id).toBeTruthy();
    expect(visit.guest.id).toBe('buddy_a');
    expect(visit.host.id).toBe('buddy_b');
    expect(visit.startTime).toBeGreaterThan(0);
    expect(visit.endTime).toBeUndefined();
    expect(visit.interactions).toHaveLength(1);
    expect(visit.interactions[0].type).toBe('greet');
    expect(visit.interactions[0].content).toContain('小灵');
    expect(visit.interactions[0].content).toContain('小火');
  });

  it('串门互动添加成功', () => {
    const visit = sys.startVisit(buddyA, buddyB);
    const result = sys.interact(visit.id, 'play', '一起玩耍');

    expect(result).not.toBeNull();
    expect(result!.type).toBe('play');
    expect(result!.content).toBe('一起玩耍');
    expect(result!.timestamp).toBeGreaterThan(0);

    // 1 greet + 1 play
    expect(visit.interactions).toHaveLength(2);
  });

  it('支持所有互动类型', () => {
    const visit = sys.startVisit(buddyA, buddyB);
    const types = ['greet', 'play', 'chat', 'gift', 'photo'] as const;

    // greet 已自动添加，从第二个开始
    for (const type of types.slice(1)) {
      const r = sys.interact(visit.id, type, `${type} 内容`);
      expect(r).not.toBeNull();
      expect(r!.type).toBe(type);
    }

    // 1 greet + 4 others
    expect(visit.interactions).toHaveLength(5);
  });

  it('已结束的串门不能再互动', () => {
    const visit = sys.startVisit(buddyA, buddyB);
    sys.endVisit(visit.id);

    const result = sys.interact(visit.id, 'chat', '还在线吗？');
    expect(result).toBeNull();
  });

  it('不存在的串门 ID 返回 null', () => {
    expect(sys.interact('nonexistent', 'chat', 'hi')).toBeNull();
  });

  it('结束串门设置 endTime', () => {
    const visit = sys.startVisit(buddyA, buddyB);
    const ended = sys.endVisit(visit.id);

    expect(ended).not.toBeNull();
    expect(ended!.endTime).toBeGreaterThan(0);
    expect(ended!.endTime!).toBeGreaterThanOrEqual(ended!.startTime);
  });

  it('结束不存在的串门返回 null', () => {
    expect(sys.endVisit('nonexistent')).toBeNull();
  });

  it('获取活跃串门', () => {
    sys.startVisit(buddyA, buddyB);
    sys.startVisit(buddyC, buddyA);
    expect(sys.getActiveVisits()).toHaveLength(2);

    // 结束一个
    const all = sys.getActiveVisits();
    sys.endVisit(all[0].id);
    expect(sys.getActiveVisits()).toHaveLength(1);
  });

  it('结束后不计入活跃串门', () => {
    const visit = sys.startVisit(buddyA, buddyB);
    expect(sys.getActiveVisits()).toHaveLength(1);

    sys.endVisit(visit.id);
    expect(sys.getActiveVisits()).toHaveLength(0);
  });
});

// ==================== 精灵对话 ====================

describe('精灵对话', () => {
  let sys: BuddyInteractionSystem;

  beforeEach(() => {
    sys = new BuddyInteractionSystem();
  });

  it('开始对话返回正确结构', () => {
    const conv = sys.startConversation(buddyA, buddyB, '天气');

    expect(conv.id).toBeTruthy();
    expect(conv.buddyA.id).toBe('buddy_a');
    expect(conv.buddyB.id).toBe('buddy_b');
    expect(conv.topic).toBe('天气');
    expect(conv.messages).toHaveLength(0);
    expect(conv.startTime).toBeGreaterThan(0);
    expect(conv.endTime).toBeUndefined();
  });

  it('不指定 topic 也能创建对话', () => {
    const conv = sys.startConversation(buddyA, buddyB);
    expect(conv.topic).toBeUndefined();
  });

  it('添加消息', () => {
    const conv = sys.startConversation(buddyA, buddyB);
    sys.addMessage(conv.id, 'buddy_a', '你好呀');
    sys.addMessage(conv.id, 'buddy_b', '你好！');

    expect(conv.messages).toHaveLength(2);
    expect(conv.messages[0].from).toBe('buddy_a');
    expect(conv.messages[0].content).toBe('你好呀');
    expect(conv.messages[1].from).toBe('buddy_b');
    expect(conv.messages[1].content).toBe('你好！');
  });

  it('已结束的对话不能再添加消息', () => {
    const conv = sys.startConversation(buddyA, buddyB);
    sys.endConversation(conv.id);
    sys.addMessage(conv.id, 'buddy_a', '还在吗？');

    expect(conv.messages).toHaveLength(0);
  });

  it('不存在的对话 ID 不报错', () => {
    // 不应抛异常
    sys.addMessage('nonexistent', 'buddy_a', 'hi');
  });

  it('结束对话设置 endTime', () => {
    const conv = sys.startConversation(buddyA, buddyB);
    const ended = sys.endConversation(conv.id);

    expect(ended).not.toBeNull();
    expect(ended!.endTime).toBeGreaterThan(0);
  });

  it('结束不存在的对话返回 null', () => {
    expect(sys.endConversation('nonexistent')).toBeNull();
  });

  it('获取对话历史', () => {
    const conv = sys.startConversation(buddyA, buddyB, '测试');
    sys.addMessage(conv.id, 'buddy_a', '消息1');

    const retrieved = sys.getConversation(conv.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(conv.id);
    expect(retrieved!.messages).toHaveLength(1);
  });

  it('获取不存在的对话返回 undefined', () => {
    expect(sys.getConversation('nonexistent')).toBeUndefined();
  });
});

// ==================== 合影 ====================

describe('合影系统', () => {
  let sys: BuddyInteractionSystem;

  beforeEach(() => {
    sys = new BuddyInteractionSystem();
  });

  it('两个精灵合影', () => {
    const photo = sys.generatePhotoData([buddyA, buddyB]);

    expect(photo.participants).toEqual(['小灵', '小火']);
    expect(photo.timestamp).toBeGreaterThan(0);
    expect(photo.caption).toContain('小灵');
    expect(photo.caption).toContain('小火');
    expect(photo.caption).toContain('📸');
  });

  it('多个精灵合影', () => {
    const photo = sys.generatePhotoData([buddyA, buddyB, buddyC]);

    expect(photo.participants).toHaveLength(3);
    expect(photo.caption).toContain('小灵');
    expect(photo.caption).toContain('小火');
    expect(photo.caption).toContain('小水');
  });

  it('单个精灵合影（自拍）', () => {
    const photo = sys.generatePhotoData([buddyA]);

    expect(photo.participants).toEqual(['小灵']);
    expect(photo.caption).toContain('小灵');
  });
});

// ==================== 排行榜 ====================

describe('排行榜系统', () => {
  let sys: BuddyInteractionSystem;

  beforeEach(() => {
    sys = new BuddyInteractionSystem();
  });

  it('更新排行榜并按分数降序排列', () => {
    sys.updateLeaderboard('level', [
      { buddyId: 'buddy_a', buddyName: '小灵', ownerName: 'Alice', score: 5 },
      { buddyId: 'buddy_b', buddyName: '小火', ownerName: 'Bob', score: 8 },
      { buddyId: 'buddy_c', buddyName: '小水', ownerName: 'Charlie', score: 12 },
    ]);

    const board = sys.getLeaderboard('level');
    expect(board).toHaveLength(3);
    expect(board[0].buddyId).toBe('buddy_c');
    expect(board[0].rank).toBe(1);
    expect(board[0].score).toBe(12);
    expect(board[1].rank).toBe(2);
    expect(board[2].rank).toBe(3);
  });

  it('获取排行榜支持 limit', () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({
      buddyId: `buddy_${i}`,
      buddyName: `精灵${i}`,
      ownerName: `owner_${i}`,
      score: 100 - i,
    }));

    sys.updateLeaderboard('level', entries);

    expect(sys.getLeaderboard('level')).toHaveLength(20); // 默认 limit=20
    expect(sys.getLeaderboard('level', 5)).toHaveLength(5);
    expect(sys.getLeaderboard('level', 50)).toHaveLength(30);
  });

  it('获取用户排名', () => {
    sys.updateLeaderboard('level', [
      { buddyId: 'buddy_a', buddyName: '小灵', ownerName: 'Alice', score: 5 },
      { buddyId: 'buddy_b', buddyName: '小火', ownerName: 'Bob', score: 8 },
      { buddyId: 'buddy_c', buddyName: '小水', ownerName: 'Charlie', score: 12 },
    ]);

    expect(sys.getRank('level', 'buddy_c')).toBe(1);
    expect(sys.getRank('level', 'buddy_b')).toBe(2);
    expect(sys.getRank('level', 'buddy_a')).toBe(3);
  });

  it('不存在的用户排名返回 -1', () => {
    sys.updateLeaderboard('level', [
      { buddyId: 'buddy_a', buddyName: '小灵', ownerName: 'Alice', score: 5 },
    ]);

    expect(sys.getRank('level', 'ghost')).toBe(-1);
  });

  it('空排行榜返回空数组', () => {
    expect(sys.getLeaderboard('level')).toEqual([]);
    expect(sys.getLeaderboard('interactions')).toEqual([]);
  });

  it('获取所有可用指标', () => {
    const metrics = sys.getAvailableMetrics();
    expect(metrics).toContain('level');
    expect(metrics).toContain('interactions');
    expect(metrics).toContain('achievements');
    expect(metrics).toContain('knowledge_packages');
    expect(metrics).toHaveLength(4);
  });

  it('不同指标独立维护', () => {
    sys.updateLeaderboard('level', [
      { buddyId: 'buddy_a', buddyName: '小灵', ownerName: 'Alice', score: 5 },
    ]);
    sys.updateLeaderboard('interactions', [
      { buddyId: 'buddy_b', buddyName: '小火', ownerName: 'Bob', score: 100 },
    ]);

    expect(sys.getLeaderboard('level')).toHaveLength(1);
    expect(sys.getLeaderboard('interactions')).toHaveLength(1);
    expect(sys.getRank('level', 'buddy_a')).toBe(1);
    expect(sys.getRank('level', 'buddy_b')).toBe(-1);
  });
});

// ==================== 销毁 ====================

describe('destroy 清理', () => {
  it('清理所有数据', () => {
    const sys = new BuddyInteractionSystem();

    sys.startVisit(buddyA, buddyB);
    sys.startConversation(buddyA, buddyB);
    sys.updateLeaderboard('level', [
      { buddyId: 'buddy_a', buddyName: '小灵', ownerName: 'Alice', score: 5 },
    ]);

    sys.destroy();

    expect(sys.getActiveVisits()).toHaveLength(0);
    expect(sys.getConversation('any')).toBeUndefined();
    expect(sys.getLeaderboard('level')).toEqual([]);
  });
});
