import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { STMPStore, type MemoryNode } from './stmp.js';
import * as fs from 'fs';

const TEST_DB = `/tmp/buddy-test-stmp-${Date.now()}.db`;
let store: STMPStore;

function makeNode(id: string, content: string, overrides: Partial<MemoryNode> = {}): MemoryNode {
  const now = Date.now();
  return {
    id,
    content,
    room: 'default',
    timestamp: now,
    temporalContext: { before: [], after: [] },
    concepts: [],
    relations: [],
    emotional: { valence: 0, importance: 5 },
    lifecycle: {
      createdAt: now,
      lastAccessed: now,
      accessCount: 0,
      decay: 1.0,
      compressed: false,
      hibernated: false,
    },
    source: 'conversation',
    ...overrides,
  };
}

beforeAll(() => {
  store = new STMPStore(TEST_DB);
});

afterAll(() => {
  store.close();
  try { fs.unlinkSync(TEST_DB); } catch { /* ignore */ }
  try { fs.unlinkSync(TEST_DB + '-wal'); } catch { /* ignore */ }
  try { fs.unlinkSync(TEST_DB + '-shm'); } catch { /* ignore */ }
});

// ==================== Room Management ====================

describe('Room management', () => {
  it('createRoom 创建房间并返回正确字段', () => {
    const room = store.createRoom('test-room', '测试房间', ['test', 'demo'], false);
    expect(room.id).toBe('test-room');
    expect(room.name).toBe('测试房间');
    expect(room.tags).toEqual(['test', 'demo']);
    expect(room.isDefault).toBe(false);
    expect(room.memoryCount).toBe(0);
    expect(room.createdAt).toBeGreaterThan(0);
  });

  it('createRoom 创建默认房间', () => {
    const room = store.createRoom('default-room', '默认', ['general'], true);
    expect(room.isDefault).toBe(true);
  });

  it('getRoom 返回房间', () => {
    const room = store.getRoom('test-room');
    expect(room).not.toBeNull();
    expect(room!.id).toBe('test-room');
    expect(room!.name).toBe('测试房间');
    expect(room!.tags).toEqual(['test', 'demo']);
  });

  it('getRoom 不存在返回 null', () => {
    expect(store.getRoom('nonexistent-room')).toBeNull();
  });

  it('listRooms 返回所有房间，按 last_accessed DESC 排序', () => {
    // 创建两个房间
    store.createRoom('room-a', 'Room A', ['alpha']);
    store.createRoom('room-b', 'Room B', ['beta']);
    const rooms = store.listRooms();
    expect(rooms.length).toBeGreaterThanOrEqual(2);
    // 验证排序：后面房间的 last_accessed 不大于前面的
    for (let i = 1; i < rooms.length; i++) {
      expect(rooms[i].lastAccessed).toBeLessThanOrEqual(rooms[i - 1].lastAccessed);
    }
    // 验证 room-a 和 room-b 都存在
    expect(rooms.some(r => r.id === 'room-a')).toBe(true);
    expect(rooms.some(r => r.id === 'room-b')).toBe(true);
  });

  it('touchRoom 更新 last_accessed 并递增 memory_count', () => {
    const before = store.getRoom('test-room')!;
    const countBefore = before.memoryCount;
    store.touchRoom('test-room');
    const after = store.getRoom('test-room')!;
    expect(after.memoryCount).toBe(countBefore + 1);
    expect(after.lastAccessed).toBeGreaterThanOrEqual(before.lastAccessed);
  });

  describe('locateRoom', () => {
    it('精确标签匹配', () => {
      // test-room 有标签 'test'
      const room = store.locateRoom('this is a test query');
      expect(room).not.toBeNull();
      expect(room!.id).toBe('test-room');
    });

    it('名称匹配', () => {
      const room = store.locateRoom('请查看Room A的情况');
      expect(room).not.toBeNull();
      expect(room!.id).toBe('room-a');
    });

    it('无匹配返回 null', () => {
      const room = store.locateRoom('zzzzz_nonexistent_xyz_999');
      expect(room).toBeNull();
    });

    it('emoji 和特殊字符不崩溃 (Task 2.1)', () => {
      // 含 emoji 的查询应安全处理，不抛 FTS5 错误
      expect(() => store.locateRoom('📝 文件管理 📁')).not.toThrow();
      const room = store.locateRoom('📝 文件管理 📁');
      // 可能返回 null（无匹配），但不应抛异常
      expect(room === null || typeof room === 'object').toBe(true);
    });

    it('纯 emoji 查询安全返回 null', () => {
      expect(() => store.locateRoom('🎉🚀💡')).not.toThrow();
      expect(store.locateRoom('🎉🚀💡')).toBeNull();
    });

    it('空字符串和空白安全处理', () => {
      expect(store.locateRoom('')).toBeNull();
      expect(store.locateRoom('   ')).toBeNull();
    });
  });
});

// ==================== Node Operations ====================

describe('Node operations', () => {
  it('insertNode 插入节点，getNode 可读取', () => {
    const node = makeNode('node-1', 'first memory entry', {
      room: 'test-room',
      concepts: ['memory', 'test'],
      emotional: { valence: 0.5, importance: 7 },
      source: 'conversation',
      sessionId: 'sess-1',
    });
    store.insertNode(node);

    const retrieved = store.getNode('node-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe('node-1');
    expect(retrieved!.content).toBe('first memory entry');
    expect(retrieved!.room).toBe('test-room');
    expect(retrieved!.concepts).toEqual(['memory', 'test']);
    expect(retrieved!.emotional.valence).toBe(0.5);
    expect(retrieved!.emotional.importance).toBe(7);
    expect(retrieved!.source).toBe('conversation');
    expect(retrieved!.sessionId).toBe('sess-1');
  });

  it('getNode 不存在返回 null', () => {
    expect(store.getNode('nonexistent-node')).toBeNull();
  });

  it('insertNode 更新 FTS 索引', () => {
    store.insertNode(makeNode('node-fts', 'discussion about artificial intelligence and machine learning'));
    const results = store.searchNodes('artificial');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(n => n.id === 'node-fts')).toBe(true);
  });

  it('insertNode 链接时间关联（temporal）', () => {
    // 使用独立房间避免干扰
    store.createRoom('temporal-room', 'temporal', []);
    const now = Date.now();
    store.insertNode(makeNode('node-t1', 'timeline node 1', {
      room: 'temporal-room',
      timestamp: now - 5000,
    }));
    store.insertNode(makeNode('node-t2', 'timeline node 2', {
      room: 'temporal-room',
      timestamp: now,
    }));
    // node-t2 应该有 node-t1 在 before 中
    const t2 = store.getNode('node-t2')!;
    expect(t2.temporalContext.before).toContain('node-t1');
    // node-t1 应该有 node-t2 在 after 中
    const t1 = store.getNode('node-t1')!;
    expect(t1.temporalContext.after).toContain('node-t2');
  });

  it('getRecentInRoom 按 timestamp DESC 排序', () => {
    store.createRoom('recent-room', 'recent', []);
    const now = Date.now();
    store.insertNode(makeNode('recent-1', 'earlier', { room: 'recent-room', timestamp: now - 2000 }));
    store.insertNode(makeNode('recent-2', 'later', { room: 'recent-room', timestamp: now }));
    const nodes = store.getRecentInRoom('recent-room', 10);
    expect(nodes.length).toBe(2);
    expect(nodes[0].id).toBe('recent-2');
    expect(nodes[1].id).toBe('recent-1');
  });

  it('getRecentInRoom 排除 hibernated 节点', () => {
    store.insertNode(makeNode('hib-node', 'hibernated memory', { room: 'recent-room' }));
    store.hibernateNode('hib-node');
    const nodes = store.getRecentInRoom('recent-room', 100);
    expect(nodes.some(n => n.id === 'hib-node')).toBe(false);
  });

  it('getRecentInRoom 限制数量', () => {
    const nodes = store.getRecentInRoom('recent-room', 1);
    expect(nodes.length).toBe(1);
  });

  it('findByConcept 通过 JSON LIKE 搜索', () => {
    store.insertNode(makeNode('concept-node', 'concept test', {
      room: 'test-room',
      concepts: ['machine-learning', 'deep-learning'],
      emotional: { valence: 0, importance: 8 },
    }));
    const results = store.findByConcept('machine-learning');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(n => n.id === 'concept-node')).toBe(true);
  });

  it('findByConcept 按 importance DESC 排序', () => {
    store.insertNode(makeNode('imp-low', 'low importance', {
      concepts: ['imp-test'], emotional: { valence: 0, importance: 2 },
    }));
    store.insertNode(makeNode('imp-high', 'high importance', {
      concepts: ['imp-test'], emotional: { valence: 0, importance: 9 },
    }));
    const results = store.findByConcept('imp-test');
    const idxHigh = results.findIndex(n => n.id === 'imp-high');
    const idxLow = results.findIndex(n => n.id === 'imp-low');
    if (idxHigh >= 0 && idxLow >= 0) {
      expect(idxHigh).toBeLessThan(idxLow);
    }
  });

  it('searchNodes FTS5 全文搜索', () => {
    store.insertNode(makeNode('search-node', 'quantum computing is the future of technology'));
    const results = store.searchNodes('quantum');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('searchNodes 无匹配返回空数组', () => {
    const results = store.searchNodes('zzzznonexistent999xyz');
    expect(results).toEqual([]);
  });

  it('touchNode 更新 last_accessed, access_count++, 重置 decay', () => {
    store.insertNode(makeNode('touch-node', 'touch test', {
      room: 'test-room',
      lifecycle: {
        createdAt: Date.now(),
        lastAccessed: Date.now() - 100000,
        accessCount: 3,
        decay: 0.5,
        compressed: false,
        hibernated: false,
      },
    }));
    store.touchNode('touch-node');
    const node = store.getNode('touch-node')!;
    expect(node.lifecycle.accessCount).toBe(4);
    expect(node.lifecycle.decay).toBe(1.0);
  });

  it('hibernateNode 设置 hibernated=1', () => {
    store.insertNode(makeNode('hib-test', 'hibernation test'));
    store.hibernateNode('hib-test');
    const node = store.getNode('hib-test')!;
    expect(node.lifecycle.hibernated).toBe(true);
  });

  it('countNodes 全局计数', () => {
    const count = store.countNodes();
    expect(count).toBeGreaterThan(0);
  });

  it('countNodes 按房间计数', () => {
    const count = store.countNodes('test-room');
    expect(count).toBeGreaterThan(0);
  });

  it('countNodesBySource 按来源计数', () => {
    const count = store.countNodesBySource('conversation');
    expect(count).toBeGreaterThan(0);
  });

  it('countExtractedInRoom 计数 extracted 来源', () => {
    store.insertNode(makeNode('extracted-node', 'extracted knowledge', {
      room: 'test-room',
      source: 'extracted',
    }));
    const count = store.countExtractedInRoom('test-room');
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('getDomainStats 返回非默认房间的统计', () => {
    const stats = store.getDomainStats();
    expect(Array.isArray(stats)).toBe(true);
    // 至少有 test-room（非默认）
    const testRoomStat = stats.find(s => s.roomId === 'test-room');
    expect(testRoomStat).toBeDefined();
    expect(testRoomStat!.totalNodes).toBeGreaterThan(0);
  });

  it('hasSimilarContent 检测相似内容', () => {
    store.insertNode(makeNode('similar-node', 'this is a very long test content for verifying similar content detection'));
    expect(store.hasSimilarContent('this is a very long test content for verifying')).toBe(true);
    expect(store.hasSimilarContent('completely unrelated content xyz999')).toBe(false);
  });

  it('hasSimilarContent 可限定房间', () => {
    store.insertNode(makeNode('similar-room-node', 'room scoped similar content check for testing', {
      room: 'test-room',
    }));
    expect(store.hasSimilarContent('room scoped similar content', 'test-room')).toBe(true);
    expect(store.hasSimilarContent('room scoped similar content', 'nonexistent-room')).toBe(false);
  });
});

// ==================== Edge Operations ====================

describe('Edge operations', () => {
  it('upsertEdge 插入新边', () => {
    store.upsertEdge('conceptA', 'conceptB', 0.5, ['room-a']);
    const related = store.getRelatedConcepts('conceptA');
    expect(related.length).toBeGreaterThanOrEqual(1);
    expect(related.some(r => r.concept === 'conceptB')).toBe(true);
    expect(related.find(r => r.concept === 'conceptB')!.weight).toBe(0.5);
    expect(related.find(r => r.concept === 'conceptB')!.rooms).toContain('room-a');
  });

  it('upsertEdge 更新已有边（weight += weight*0.1, 上限 1）', () => {
    store.upsertEdge('conceptC', 'conceptD', 0.8, ['room-a']);
    store.upsertEdge('conceptC', 'conceptD', 0.8, ['room-b']);
    const related = store.getRelatedConcepts('conceptC');
    const edge = related.find(r => r.concept === 'conceptD');
    expect(edge).toBeDefined();
    // 0.8 + 0.8 * 0.1 = 0.88
    expect(edge!.weight).toBeCloseTo(0.88, 2);
  });

  it('upsertEdge weight 上限为 1', () => {
    store.upsertEdge('conceptE', 'conceptF', 0.95, []);
    // 多次更新以突破 1
    for (let i = 0; i < 5; i++) {
      store.upsertEdge('conceptE', 'conceptF', 0.95, []);
    }
    const related = store.getRelatedConcepts('conceptE');
    const edge = related.find(r => r.concept === 'conceptF');
    expect(edge!.weight).toBeLessThanOrEqual(1);
  });

  it('getRelatedConcepts 双向查找', () => {
    store.upsertEdge('bidirA', 'bidirB', 0.6, []);
    // 从 A 找
    const fromA = store.getRelatedConcepts('bidirA');
    expect(fromA.some(r => r.concept === 'bidirB')).toBe(true);
    // 从 B 找
    const fromB = store.getRelatedConcepts('bidirB');
    expect(fromB.some(r => r.concept === 'bidirA')).toBe(true);
  });

  it('getRelatedConcepts 按 weight DESC 排序', () => {
    store.upsertEdge('sortTest', 'weakLink', 0.1, []);
    store.upsertEdge('sortTest', 'strongLink', 0.9, []);
    const related = store.getRelatedConcepts('sortTest');
    const weakIdx = related.findIndex(r => r.concept === 'weakLink');
    const strongIdx = related.findIndex(r => r.concept === 'strongLink');
    if (weakIdx >= 0 && strongIdx >= 0) {
      expect(strongIdx).toBeLessThan(weakIdx);
    }
  });

  it('getRelatedConcepts limit 参数', () => {
    const related = store.getRelatedConcepts('sortTest', 1);
    expect(related.length).toBeLessThanOrEqual(1);
  });
});

// ==================== Retrieve (4-step) ====================

describe('retrieve', () => {
  it('有房间匹配时返回结果', async () => {
    store.insertNode(makeNode('ret-1', 'discussion about testing', {
      room: 'test-room',
      concepts: ['testing'],
    }));
    const result = await store.retrieve('testing', { maxPrimary: 3, maxAssociative: 2 });
    expect(result).toHaveProperty('primary');
    expect(result).toHaveProperty('associative');
    expect(result).toHaveProperty('narrative');
    expect(result).toHaveProperty('room');
    expect(Array.isArray(result.primary)).toBe(true);
    expect(Array.isArray(result.associative)).toBe(true);
    expect(typeof result.narrative).toBe('string');
  });

  it('无房间匹配时 fallback 到全局搜索', async () => {
    const result = await store.retrieve('zzz_nonexistent_room_xyz_999');
    expect(result.room).toBeNull();
    expect(result.narrative.length).toBeGreaterThan(0);
  });

  it('有 LLM caller 时使用 LLM 组装叙事', async () => {
    const llmDb = `/tmp/buddy-test-stmp-llm-${Date.now()}.db`;
    const stmpWithLLM = new STMPStore(llmDb);
    stmpWithLLM.setLLMCaller(async () => 'LLM generated narrative');
    stmpWithLLM.insertNode(makeNode('llm-node', 'test content', { room: 'default' }));
    const result = await stmpWithLLM.retrieve('test content');
    expect(result.narrative).toBe('LLM generated narrative');
    stmpWithLLM.close();
    try { fs.unlinkSync(llmDb); } catch { /* */ }
    try { fs.unlinkSync(llmDb + '-wal'); } catch { /* */ }
    try { fs.unlinkSync(llmDb + '-shm'); } catch { /* */ }
  });

  it('LLM caller 抛异常时 fallback 到字符串拼接', async () => {
    const failDb = `/tmp/buddy-test-stmp-fail-${Date.now()}.db`;
    const stmpFail = new STMPStore(failDb);
    stmpFail.setLLMCaller(async () => { throw new Error('LLM failed'); });
    stmpFail.insertNode(makeNode('fail-node', 'failure test', { room: 'default' }));
    const result = await stmpFail.retrieve('failure test');
    expect(result.narrative.length).toBeGreaterThan(0);
    expect(result.narrative).toContain('failure test');
    stmpFail.close();
    try { fs.unlinkSync(failDb); } catch { /* */ }
    try { fs.unlinkSync(failDb + '-wal'); } catch { /* */ }
    try { fs.unlinkSync(failDb + '-shm'); } catch { /* */ }
  });

  it('retrieve 刷新访问记录（touchNode）', async () => {
    store.insertNode(makeNode('ret-touch', 'access refresh test', {
      room: 'test-room',
      lifecycle: {
        createdAt: Date.now(),
        lastAccessed: Date.now() - 100000,
        accessCount: 0,
        decay: 0.8,
        compressed: false,
        hibernated: false,
      },
    }));
    await store.retrieve('access refresh test', { maxPrimary: 5 });
    const node = store.getNode('ret-touch');
    if (node) {
      expect(node.lifecycle.accessCount).toBeGreaterThan(0);
      expect(node.lifecycle.decay).toBe(1.0);
    }
  });
});

// ==================== Lifecycle ====================

describe('Lifecycle', () => {
  it('calculateDecay 返回 0-1 之间的值', () => {
    const node = makeNode('decay-test', 'decay test', {
      lifecycle: {
        createdAt: Date.now(),
        lastAccessed: Date.now() - 3600000, // 1 hour ago
        accessCount: 2,
        decay: 1.0,
        compressed: false,
        hibernated: false,
      },
      emotional: { valence: 0, importance: 5 },
    });
    const decay = store.calculateDecay(node);
    expect(decay).toBeGreaterThanOrEqual(0);
    expect(decay).toBeLessThanOrEqual(1);
  });

  it('刚访问的记忆衰减接近 1', () => {
    const node = makeNode('fresh-decay', 'fresh memory', {
      lifecycle: {
        createdAt: Date.now(),
        lastAccessed: Date.now(),
        accessCount: 1,
        decay: 1.0,
        compressed: false,
        hibernated: false,
      },
      emotional: { valence: 0, importance: 5 },
    });
    const decay = store.calculateDecay(node);
    expect(decay).toBeGreaterThan(0.8);
  });

  it('很久没访问的记忆衰减更低', () => {
    const oldNode = makeNode('old-decay', 'old memory', {
      lifecycle: {
        createdAt: Date.now() - 86400000 * 30,
        lastAccessed: Date.now() - 86400000 * 30,
        accessCount: 0,
        decay: 1.0,
        compressed: false,
        hibernated: false,
      },
      emotional: { valence: 0, importance: 1 },
    });
    const decay = store.calculateDecay(oldNode);
    expect(decay).toBeLessThan(0.5);
  });

  it('applyDecay 批量更新衰减', () => {
    store.createRoom('decay-room', 'decay', []);
    store.insertNode(makeNode('decay-batch-1', 'batch decay 1', {
      room: 'decay-room',
      lifecycle: {
        createdAt: Date.now() - 86400000 * 60,
        lastAccessed: Date.now() - 86400000 * 60,
        accessCount: 0,
        decay: 1.0,
        compressed: false,
        hibernated: false,
      },
      emotional: { valence: 0, importance: 1 },
    }));
    store.insertNode(makeNode('decay-batch-2', 'batch decay 2', {
      room: 'decay-room',
      lifecycle: {
        createdAt: Date.now() - 86400000 * 60,
        lastAccessed: Date.now() - 86400000 * 60,
        accessCount: 0,
        decay: 1.0,
        compressed: false,
        hibernated: false,
      },
      emotional: { valence: 0, importance: 1 },
    }));
    const result = store.applyDecay();
    expect(result).toHaveProperty('decayed');
    expect(result).toHaveProperty('hibernated');
    expect(typeof result.decayed).toBe('number');
    expect(typeof result.hibernated).toBe('number');
  });

  it('compress 合并同一天低重要性节点', () => {
    const roomId = 'compress-room';
    store.createRoom(roomId, 'compress room', ['compress']);
    const baseTime = new Date('2025-03-15T10:00:00Z').getTime();
    // 插入 3 个同一天、低重要性的节点
    for (let i = 0; i < 3; i++) {
      store.insertNode(makeNode(`comp-${i}`, `fragment ${i}`, {
        room: roomId,
        timestamp: baseTime + i * 1000,
        emotional: { valence: 0, importance: 2 },
      }));
    }
    const compressed = store.compress(roomId, 3);
    expect(compressed).toBeGreaterThanOrEqual(3);

    // 原始节点应被标记为 compressed
    const n0 = store.getNode('comp-0');
    expect(n0?.lifecycle.compressed).toBe(true);
  });

  it('compress 节点不足 minGroupSize 时不压缩', () => {
    const roomId = 'no-compress-room';
    store.createRoom(roomId, 'no compress', []);
    store.insertNode(makeNode('nc-1', 'not enough', {
      room: roomId,
      emotional: { valence: 0, importance: 2 },
    }));
    const compressed = store.compress(roomId, 3);
    expect(compressed).toBe(0);
  });
});

// ==================== Stats ====================

describe('getStats', () => {
  it('返回正确的统计结构', () => {
    const stats = store.getStats();
    expect(stats).toHaveProperty('rooms');
    expect(stats).toHaveProperty('nodes');
    expect(stats).toHaveProperty('edges');
    expect(stats).toHaveProperty('activeNodes');
    expect(stats).toHaveProperty('hibernatedNodes');
    expect(typeof stats.rooms).toBe('number');
    expect(typeof stats.nodes).toBe('number');
    expect(typeof stats.edges).toBe('number');
    expect(typeof stats.activeNodes).toBe('number');
    expect(typeof stats.hibernatedNodes).toBe('number');
  });

  it('统计数据大于 0', () => {
    const stats = store.getStats();
    expect(stats.rooms).toBeGreaterThan(0);
    expect(stats.nodes).toBeGreaterThan(0);
    expect(stats.edges).toBeGreaterThan(0);
    expect(stats.activeNodes).toBeGreaterThan(0);
  });
});

// ==================== Close ====================

describe('close', () => {
  it('关闭数据库后操作会报错', () => {
    const tmpStore = new STMPStore(`/tmp/buddy-test-stmp-close-${Date.now()}.db`);
    tmpStore.close();
    expect(() => tmpStore.getNode('any')).toThrow();
  });
});
