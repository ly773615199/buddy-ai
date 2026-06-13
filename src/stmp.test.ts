import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { STMPStore } from './memory/stmp.js';
import * as fs from 'fs';

const TEST_DB = '/tmp/buddy-stmp-test.db';

describe('STMP 时空记忆宫殿', () => {
  let stmp: STMPStore;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    stmp = new STMPStore(TEST_DB);
  });

  afterEach(() => {
    stmp.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  describe('房间管理', () => {
    it('创建和获取房间', () => {
      stmp.createRoom('coding', '编程', ['code', 'dev']);
      const room = stmp.getRoom('coding');
      expect(room).not.toBeNull();
      expect(room!.name).toBe('编程');
      expect(room!.tags).toEqual(['code', 'dev']);
    });

    it('获取所有房间', () => {
      stmp.createRoom('r1', '房间1', []);
      stmp.createRoom('r2', '房间2', []);
      const rooms = stmp.listRooms();
      expect(rooms.length).toBeGreaterThanOrEqual(2);
    });

    it('默认房间存在', () => {
      const defaultRoom = stmp.getRoom('default');
      expect(defaultRoom).not.toBeNull();
    });
  });

  describe('节点插入和查询', () => {
    it('插入节点并按 ID 查询', () => {
      stmp.createRoom('test-room', '测试', []);
      const now = Date.now();
      stmp.insertNode({
        id: 'node-1',
        content: '测试记忆内容',
        room: 'test-room',
        timestamp: now,
        temporalContext: { before: [], after: [] },
        concepts: ['测试', '记忆'],
        relations: [],
        emotional: { valence: 0.5, importance: 7 },
        lifecycle: {
          createdAt: now, lastAccessed: now, accessCount: 0,
          decay: 1, compressed: false, hibernated: false,
        },
        source: 'conversation',
      });

      const node = stmp.getNode('node-1');
      expect(node).not.toBeNull();
      expect(node!.content).toBe('测试记忆内容');
      expect(node!.concepts).toContain('测试');
    });

    it('按概念搜索节点', () => {
      stmp.createRoom('r', 'R', []);
      const now = Date.now();
      stmp.insertNode({
        id: 'n1', content: 'TypeScript 泛型', room: 'r', timestamp: now,
        temporalContext: { before: [], after: [] },
        concepts: ['TypeScript', '泛型'], relations: [],
        emotional: { valence: 0, importance: 5 },
        lifecycle: { createdAt: now, lastAccessed: now, accessCount: 0, decay: 1, compressed: false, hibernated: false },
        source: 'conversation',
      });
      stmp.insertNode({
        id: 'n2', content: 'Python 装饰器', room: 'r', timestamp: now,
        temporalContext: { before: [], after: [] },
        concepts: ['Python', '装饰器'], relations: [],
        emotional: { valence: 0, importance: 5 },
        lifecycle: { createdAt: now, lastAccessed: now, accessCount: 0, decay: 1, compressed: false, hibernated: false },
        source: 'conversation',
      });

      const ts = stmp.findByConcept('TypeScript');
      expect(ts).toHaveLength(1);
      expect(ts[0].id).toBe('n1');

      const py = stmp.findByConcept('Python');
      expect(py).toHaveLength(1);
    });

    it('不存在的节点返回 null', () => {
      expect(stmp.getNode('nonexistent')).toBeNull();
    });
  });

  describe('检索功能', () => {
    it('语义检索返回结果', async () => {
      stmp.createRoom('r', 'R', []);
      const now = Date.now();
      stmp.insertNode({
        id: 'n1', content: 'CORS 跨域配置方法', room: 'r', timestamp: now,
        temporalContext: { before: [], after: [] },
        concepts: ['CORS', '跨域', 'HTTP'], relations: [],
        emotional: { valence: 0, importance: 6 },
        lifecycle: { createdAt: now, lastAccessed: now, accessCount: 0, decay: 1, compressed: false, hibernated: false },
        source: 'learned',
      });

      const result = await stmp.retrieve('跨域');
      expect(result.primary.length + result.associative.length).toBeGreaterThan(0);
      expect(typeof result.narrative).toBe('string');
    });

    it('无匹配时返回空', async () => {
      stmp.createRoom('r', 'R', []);
      const result = await stmp.retrieve('xyznonexistent12345');
      expect(result.primary).toHaveLength(0);
    });
  });

  describe('统计信息', () => {
    it('统计节点和房间数', () => {
      stmp.createRoom('s1', 'S1', []);
      const now = Date.now();
      stmp.insertNode({
        id: 'n1', content: 'test', room: 's1', timestamp: now,
        temporalContext: { before: [], after: [] },
        concepts: ['test'], relations: [],
        emotional: { valence: 0, importance: 5 },
        lifecycle: { createdAt: now, lastAccessed: now, accessCount: 0, decay: 1, compressed: false, hibernated: false },
        source: 'conversation',
      });

      const stats = stmp.getStats();
      expect(stats.nodes).toBeGreaterThanOrEqual(1);
      expect(stats.rooms).toBeGreaterThanOrEqual(1);
    });
  });

  describe('生命周期', () => {
    it('节点创建后 decay 为 1', () => {
      stmp.createRoom('r', 'R', []);
      const now = Date.now();
      stmp.insertNode({
        id: 'n1', content: 'test', room: 'r', timestamp: now,
        temporalContext: { before: [], after: [] },
        concepts: [], relations: [],
        emotional: { valence: 0, importance: 5 },
        lifecycle: { createdAt: now, lastAccessed: now, accessCount: 0, decay: 1, compressed: false, hibernated: false },
        source: 'conversation',
      });

      const node = stmp.getNode('n1');
      expect(node!.lifecycle.decay).toBe(1);
      expect(node!.lifecycle.compressed).toBe(false);
      expect(node!.lifecycle.hibernated).toBe(false);
    });
  });

  describe('时间上下文', () => {
    it('节点可设置前后关联', () => {
      stmp.createRoom('r', 'R', []);
      const now = Date.now();
      stmp.insertNode({
        id: 'n1', content: 'first', room: 'r', timestamp: now,
        temporalContext: { before: [], after: ['n2'] },
        concepts: [], relations: [],
        emotional: { valence: 0, importance: 5 },
        lifecycle: { createdAt: now, lastAccessed: now, accessCount: 0, decay: 1, compressed: false, hibernated: false },
        source: 'conversation',
      });
      stmp.insertNode({
        id: 'n2', content: 'second', room: 'r', timestamp: now + 1000,
        temporalContext: { before: ['n1'], after: [] },
        concepts: [], relations: [],
        emotional: { valence: 0, importance: 5 },
        lifecycle: { createdAt: now + 1000, lastAccessed: now + 1000, accessCount: 0, decay: 1, compressed: false, hibernated: false },
        source: 'conversation',
      });

      const n1 = stmp.getNode('n1');
      expect(n1!.temporalContext.after).toContain('n2');
      const n2 = stmp.getNode('n2');
      expect(n2!.temporalContext.before).toContain('n1');
    });
  });

  describe('情绪标记', () => {
    it('节点可标记重要性', () => {
      stmp.createRoom('r', 'R', []);
      const now = Date.now();
      stmp.insertNode({
        id: 'n1', content: 'important', room: 'r', timestamp: now,
        temporalContext: { before: [], after: [] },
        concepts: [], relations: [],
        emotional: { valence: 0.8, importance: 10, userMarked: 'important' },
        lifecycle: { createdAt: now, lastAccessed: now, accessCount: 0, decay: 1, compressed: false, hibernated: false },
        source: 'conversation',
      });

      const node = stmp.getNode('n1');
      expect(node!.emotional.importance).toBe(10);
      expect(node!.emotional.userMarked).toBe('important');
    });
  });
});
