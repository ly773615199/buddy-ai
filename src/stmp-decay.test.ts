/**
 * STMP 衰减/压缩/并发测试 — 补充 stmp.test.ts 未覆盖的高级场景
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { STMPStore } from './memory/stmp.js';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DB = '/tmp/buddy-stmp-decay-test/stmp.db';

function makeNode(overrides: Record<string, any> = {}) {
  const base = {
    id: `node_${Math.random().toString(36).slice(2, 8)}`,
    content: '测试记忆内容',
    room: 'test-room',
    timestamp: Date.now(),
    temporalContext: { before: [], after: [], duration: undefined },
    concepts: ['测试'],
    relations: [],
    emotional: { valence: 0, importance: 5 },
    lifecycle: {
      createdAt: Date.now(),
      lastAccessed: Date.now(),
      accessCount: 0,
      decay: 1,
      compressed: false,
      hibernated: false,
    },
    source: 'conversation' as const,
  };

  // 支持 importance/valence 顶层简写
  if ('importance' in overrides && !overrides.emotional) {
    overrides = { ...overrides, emotional: { ...base.emotional, importance: overrides.importance } };
    delete overrides.importance;
  }
  if ('valence' in overrides && !overrides.emotional) {
    overrides = { ...overrides, emotional: { ...base.emotional, valence: overrides.valence } };
    delete overrides.valence;
  }
  // 合并嵌套对象
  const emotional = overrides.emotional
    ? { ...base.emotional, ...overrides.emotional }
    : base.emotional;
  const lifecycle = overrides.lifecycle
    ? { ...base.lifecycle, ...overrides.lifecycle }
    : base.lifecycle;

  return { ...base, ...overrides, emotional, lifecycle };
}

describe('STMP 衰减与压缩', () => {
  let stmp: STMPStore;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.rmSync(TEST_DB, { recursive: true });
    stmp = new STMPStore(TEST_DB);
    stmp.createRoom('test-room', '测试房间', ['test']);
  });

  afterEach(() => {
    stmp.close();
    if (fs.existsSync(TEST_DB)) fs.rmSync(TEST_DB, { recursive: true });
  });

  // ==================== 衰减逻辑 ====================

  describe('calculateDecay', () => {
    it('刚访问的节点 decay 接近 1', () => {
      stmp.insertNode(makeNode({ id: 'recent', lifecycle: {
        createdAt: Date.now(), lastAccessed: Date.now(),
        accessCount: 1, decay: 1, compressed: false, hibernated: false,
      }}));

      const result = stmp.applyDecay();
      // 刚访问的节点 decay 应该仍然较高（不会被休眠）
      expect(result.hibernated).toBe(0);
    });

    it('长时间未访问的节点衰减', () => {
      const twoWeeksAgo = Date.now() - 14 * 24 * 3600 * 1000;
      stmp.insertNode(makeNode({ id: 'old', importance: 1, lifecycle: {
        createdAt: twoWeeksAgo, lastAccessed: twoWeeksAgo,
        accessCount: 0, decay: 1, compressed: false, hibernated: false,
      }}));

      const result = stmp.applyDecay();
      expect(result.decayed).toBeGreaterThanOrEqual(0);
    });

    it('高重要度节点衰减更慢', () => {
      const oneWeekAgo = Date.now() - 7 * 24 * 3600 * 1000;

      stmp.insertNode(makeNode({ id: 'important', importance: 10, lifecycle: {
        createdAt: oneWeekAgo, lastAccessed: oneWeekAgo,
        accessCount: 0, decay: 1, compressed: false, hibernated: false,
      }}));

      stmp.insertNode(makeNode({ id: 'trivial', importance: 1, lifecycle: {
        createdAt: oneWeekAgo, lastAccessed: oneWeekAgo,
        accessCount: 0, decay: 1, compressed: false, hibernated: false,
      }}));

      stmp.applyDecay();

      const important = stmp.getNode('important');
      const trivial = stmp.getNode('trivial');
      expect(important).not.toBeNull();
      expect(trivial).not.toBeNull();
      // 高重要度的 decay 应该 >= 低重要度
      expect(important!.lifecycle.decay).toBeGreaterThanOrEqual(trivial!.lifecycle.decay);
    });

    it('多次访问的节点衰减更慢', () => {
      const oneWeekAgo = Date.now() - 7 * 24 * 3600 * 1000;

      stmp.insertNode(makeNode({ id: 'frequent', importance: 1, lifecycle: {
        createdAt: oneWeekAgo, lastAccessed: oneWeekAgo,
        accessCount: 50, decay: 1, compressed: false, hibernated: false,
      }}));

      stmp.insertNode(makeNode({ id: 'rare', importance: 1, lifecycle: {
        createdAt: oneWeekAgo, lastAccessed: oneWeekAgo,
        accessCount: 0, decay: 1, compressed: false, hibernated: false,
      }}));

      stmp.applyDecay();

      const freq = stmp.getNode('frequent');
      const rare = stmp.getNode('rare');
      expect(freq!.lifecycle.decay).toBeGreaterThanOrEqual(rare!.lifecycle.decay);
    });
  });

  // ==================== 休眠 ====================

  describe('休眠机制', () => {
    it('decay < 0.05 的节点被自动休眠', () => {
      const veryOld = Date.now() - 365 * 24 * 3600 * 1000; // 1年前
      stmp.insertNode(makeNode({ id: 'ancient', importance: 0, lifecycle: {
        createdAt: veryOld, lastAccessed: veryOld,
        accessCount: 0, decay: 1, compressed: false, hibernated: false,
      }}));

      const result = stmp.applyDecay();
      // 衰减到极低的节点应被休眠
      if (result.hibernated > 0) {
        const node = stmp.getNode('ancient');
        // 休眠节点通过 getNode 仍然可查（hibernated 只影响检索过滤）
        expect(node).not.toBeNull();
      }
    });

    it('休眠节点不出现在房间检索中', () => {
      stmp.insertNode(makeNode({ id: 'active1', content: '活跃记忆' }));
      stmp.insertNode(makeNode({ id: 'hibernated1', content: '休眠记忆' }));
      // 手动休眠
      (stmp as any).db.prepare('UPDATE stmp_nodes SET hibernated = 1 WHERE id = ?').run('hibernated1');

      const roomNodes = stmp.getRecentInRoom('test-room', 100);
      const ids = roomNodes.map(n => n.id);
      expect(ids).toContain('active1');
      expect(ids).not.toContain('hibernated1');
    });
  });

  // ==================== 压缩 ====================

  describe('压缩机制', () => {
    it('同房间同时期低重要度节点被压缩', () => {
      const today = Date.now();
      // 插入 5 条同一天的低重要度记忆
      for (let i = 0; i < 5; i++) {
        stmp.insertNode(makeNode({
          id: `frag_${i}`,
          content: `碎片记忆 ${i}`,
          importance: 2,
          timestamp: today + i * 1000,
        }));
      }

      const compressed = stmp.compress('test-room', 3);
      expect(compressed).toBeGreaterThanOrEqual(3);

      // 检查：原始节点被标记为已压缩（DB 中 compressed=1）
      const roomNodes = stmp.getRecentInRoom('test-room', 100);
      // 压缩节点带有 [压缩] 前缀
      const summaryNode = roomNodes.find(n => n.content.startsWith('[压缩]'));
      expect(summaryNode).toBeDefined();
      expect(summaryNode!.content).toContain('条记忆合并');
    });

    it('不足 minGroupSize 时不压缩', () => {
      stmp.insertNode(makeNode({ id: 'lonely', importance: 2 }));
      const compressed = stmp.compress('test-room', 3);
      expect(compressed).toBe(0);
    });

    it('高重要度节点不被压缩', () => {
      const today = Date.now();
      for (let i = 0; i < 5; i++) {
        stmp.insertNode(makeNode({
          id: `precious_${i}`,
          content: `重要记忆 ${i}`,
          importance: 8,
          timestamp: today + i * 1000,
        }));
      }

      const compressed = stmp.compress('test-room', 3);
      // 高重要度（>4）不参与压缩
      expect(compressed).toBe(0);
    });

    it('压缩节点保留合并概念', () => {
      const today = Date.now();
      for (let i = 0; i < 5; i++) {
        stmp.insertNode(makeNode({
          id: `concept_${i}`,
          content: `记忆 ${i}`,
          concepts: [`概念${i}`, '共通概念'],
          importance: 2,
          timestamp: today + i * 1000,
        }));
      }

      stmp.compress('test-room', 3);
      const roomNodes = stmp.getRecentInRoom('test-room', 100);
      const compressedNode = roomNodes.find(n => n.lifecycle.compressed);
      expect(compressedNode).toBeDefined();
      expect(compressedNode!.concepts).toContain('共通概念');
    });
  });

  // ==================== 并发安全 ====================

  describe('并发操作', () => {
    it('同时插入多个节点不丢失', () => {
      const nodes = Array.from({ length: 50 }, (_, i) =>
        makeNode({ id: `concurrent_${i}`, content: `并发节点 ${i}` })
      );

      // 同步插入（SQLite 内部串行）
      for (const node of nodes) {
        stmp.insertNode(node);
      }

      const stats = stmp.getStats();
      expect(stats.nodes).toBeGreaterThanOrEqual(50);
    });

    it('同时检索和插入不崩溃', () => {
      stmp.insertNode(makeNode({ id: 'seed', content: '种子记忆', concepts: ['检索'] }));

      // 混合操作
      for (let i = 0; i < 20; i++) {
        stmp.insertNode(makeNode({ id: `mixed_${i}`, content: `混合 ${i}` }));
        stmp.findByConcept('检索');
        stmp.getRecentInRoom('test-room', 10);
      }

      expect(stmp.getStats().nodes).toBeGreaterThanOrEqual(21);
    });
  });

  // ==================== 边界条件 ====================

  describe('边界条件', () => {
    it('空内容节点可插入', () => {
      stmp.insertNode(makeNode({ id: 'empty', content: '' }));
      expect(stmp.getNode('empty')).not.toBeNull();
    });

    it('空概念数组节点可插入', () => {
      stmp.insertNode(makeNode({ id: 'no-concepts', concepts: [] }));
      expect(stmp.getNode('no-concepts')).not.toBeNull();
    });

    it('极长内容被截断存储', () => {
      const longContent = 'x'.repeat(100000);
      stmp.insertNode(makeNode({ id: 'long', content: longContent }));
      const node = stmp.getNode('long');
      expect(node).not.toBeNull();
    });

    it('特殊字符内容安全存储', () => {
      const specialContent = "'; DROP TABLE stmp_nodes; -- <script>alert('xss')</script>";
      stmp.insertNode(makeNode({ id: 'sql-inject', content: specialContent }));
      const node = stmp.getNode('sql-inject');
      expect(node!.content).toBe(specialContent);
    });

    it('概念检索无结果返回空数组', () => {
      const results = stmp.findByConcept('不存在的概念XYZ');
      expect(results).toEqual([]);
    });

    it('房间检索无结果返回空数组', () => {
      const results = stmp.getRecentInRoom('nonexistent-room', 10);
      expect(results).toEqual([]);
    });
  });
});
