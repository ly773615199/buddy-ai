/**
 * PrototypeMemory 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PrototypeMemory, type Prototype } from './prototype-memory.js';

function makeHidden(dim: number, ...values: number[]): Float32Array {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = values[i] ?? 0;
  return v;
}

function makeNormedHidden(dim: number, ...values: number[]): Float32Array {
  const v = makeHidden(dim, ...values);
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}

describe('PrototypeMemory', () => {
  let mem: PrototypeMemory;

  beforeEach(() => {
    mem = new PrototypeMemory({ hiddenDim: 4, minNovelSamples: 3, maxPrototypes: 8 });
  });

  describe('findNearest', () => {
    it('返回 null 当没有原型时', () => {
      const h = makeHidden(4, 1, 0, 0, 0);
      expect(mem.findNearest(h)).toBeNull();
    });

    it('找到最近原型', () => {
      // 手动添加两个种子原型
      const proto1: Prototype = {
        id: 'a', label: 'A',
        centroid: makeNormedHidden(4, 1, 0, 0, 0),
        count: 10, toolDist: new Map(), toolSuccess: new Map(),
        firstSeen: Date.now(), lastSeen: Date.now(),
        isSeed: true, tags: [], qualityScore: 1.0, failureStreak: 0,
      };
      const proto2: Prototype = {
        id: 'b', label: 'B',
        centroid: makeNormedHidden(4, 0, 1, 0, 0),
        count: 10, toolDist: new Map(), toolSuccess: new Map(),
        firstSeen: Date.now(), lastSeen: Date.now(),
        isSeed: true, tags: [], qualityScore: 1.0, failureStreak: 0,
      };
      // @ts-ignore 访问私有成员
      mem.prototypes = [proto1, proto2];

      // 查询更接近 A 的向量
      const h = makeHidden(4, 0.9, 0.1, 0, 0);
      const result = mem.findNearest(h);

      expect(result).not.toBeNull();
      expect(result!.prototype.id).toBe('a');
      expect(result!.isNovel).toBe(false);
      expect(result!.confidence).toBeGreaterThan(0.5);
    });

    it('新颖样本距离超过阈值', () => {
      const proto1: Prototype = {
        id: 'a', label: 'A',
        centroid: makeNormedHidden(4, 1, 0, 0, 0),
        count: 10, toolDist: new Map(), toolSuccess: new Map(),
        firstSeen: Date.now(), lastSeen: Date.now(),
        isSeed: true, tags: [], qualityScore: 1.0, failureStreak: 0,
      };
      // @ts-ignore
      mem.prototypes = [proto1];

      // 查询远离 A 的向量
      const h = makeHidden(4, 0, 0, 1, 0);
      const result = mem.findNearest(h);

      expect(result).not.toBeNull();
      expect(result!.isNovel).toBe(true);
      expect(result!.distance).toBeGreaterThan(mem.config.noveltyThreshold);
    });
  });

  describe('hitPrototype', () => {
    it('EMA 更新 centroid', () => {
      const proto: Prototype = {
        id: 'a', label: 'A',
        centroid: makeNormedHidden(4, 1, 0, 0, 0),
        count: 1, toolDist: new Map(), toolSuccess: new Map(),
        firstSeen: Date.now(), lastSeen: Date.now(),
        isSeed: true, tags: [], qualityScore: 1.0, failureStreak: 0,
      };
      // @ts-ignore
      mem.prototypes = [proto];

      const hidden = makeHidden(4, 0, 1, 0, 0);
      mem.hitPrototype(proto, hidden);

      expect(proto.count).toBe(2);
      // centroid 应该向 hidden 方向偏移
      expect(proto.centroid[1]).toBeGreaterThan(0);
    });
  });

  describe('updateTool', () => {
    it('记录工具使用', () => {
      const proto: Prototype = {
        id: 'a', label: 'A',
        centroid: makeNormedHidden(4, 1, 0, 0, 0),
        count: 10, toolDist: new Map(), toolSuccess: new Map(),
        firstSeen: Date.now(), lastSeen: Date.now(),
        isSeed: true, tags: [], qualityScore: 1.0, failureStreak: 0,
      };
      // @ts-ignore
      mem.prototypes = [proto];

      mem.updateTool('a', 'read', true);
      mem.updateTool('a', 'read', true);
      mem.updateTool('a', 'write', false);

      expect(proto.toolDist.get('read')).toBe(2);
      expect(proto.toolDist.get('write')).toBe(1);
      expect(proto.toolSuccess.get('read')).toEqual({ attempts: 2, successes: 2 });
      expect(proto.toolSuccess.get('write')).toEqual({ attempts: 1, successes: 0 });
    });
  });

  describe('observeNovel', () => {
    it('暂存区累积后创建新原型', () => {
      // 添加一个种子原型（暂存区需要已知原型来分桶）
      const proto: Prototype = {
        id: 'a', label: 'A',
        centroid: makeNormedHidden(4, 1, 0, 0, 0),
        count: 10, toolDist: new Map(), toolSuccess: new Map(),
        firstSeen: Date.now(), lastSeen: Date.now(),
        isSeed: true, tags: [], qualityScore: 1.0, failureStreak: 0,
      };
      // @ts-ignore
      mem.prototypes = [proto];

      // 观察 3 个相似的新颖样本（都远离 A）
      const h1 = makeHidden(4, 0, 0, 1, 0);
      const h2 = makeHidden(4, 0, 0, 0.9, 0.1);
      const h3 = makeHidden(4, 0, 0, 0.8, 0.2);

      const r1 = mem.observeNovel(h1);
      expect(r1).toBeNull();  // 还不够

      const r2 = mem.observeNovel(h2);
      expect(r2).toBeNull();  // 还不够

      const r3 = mem.observeNovel(h3);
      expect(r3).not.toBeNull();  // 满足条件，创建新原型
      expect(r3!.label).toMatch(/^auto_/);
      expect(r3!.isSeed).toBe(false);
    });
  });

  describe('digest', () => {
    it('消化低质量非种子原型到种子', () => {
      const badProto: Prototype = {
        id: 'bad', label: 'Bad',
        centroid: makeNormedHidden(4, 0, 1, 0, 0),
        count: 5, toolDist: new Map([['tool_a', 3]]), toolSuccess: new Map(),
        firstSeen: Date.now(), lastSeen: Date.now(),
        isSeed: false, tags: ['low_quality'], qualityScore: 0.1, failureStreak: 6,
      };
      const seedProto: Prototype = {
        id: 'seed', label: 'Seed',
        centroid: makeNormedHidden(4, 1, 0, 0, 0),
        count: 100, toolDist: new Map([['read', 80]]), toolSuccess: new Map(),
        firstSeen: Date.now(), lastSeen: Date.now(),
        isSeed: true, tags: [], qualityScore: 1.0, failureStreak: 0,
      };
      // @ts-ignore
      mem.prototypes = [badProto, seedProto];

      const digested = mem.digest();

      expect(digested).toHaveLength(1);
      expect(digested[0].id).toBe('bad');
      // @ts-ignore
      expect(mem.prototypes).toHaveLength(1);
      // @ts-ignore
      expect(mem.prototypes[0].id).toBe('seed');  // 种子吸收了知识
      expect(seedProto.toolDist.get('tool_a')).toBe(3); // 工具知识保留
      expect(seedProto.count).toBe(105); // 计数合并
    });
  });

  describe('merge', () => {
    it('合并最相似的原型对', () => {
      // 添加多个相似原型，使总数达到 maxPrototypes
      const now = Date.now();
      for (let i = 0; i < 8; i++) {
        const proto: Prototype = {
          id: `p${i}`, label: `P${i}`,
          centroid: makeNormedHidden(4, 1, 0, 0, 0),  // 都很接近
          count: 5, toolDist: new Map(), toolSuccess: new Map(),
          firstSeen: now, lastSeen: now,
          isSeed: false, tags: [], qualityScore: 0.5, failureStreak: 0,
        };
        // @ts-ignore
        mem.prototypes.push(proto);
      }

      const result = mem.merge();

      expect(result).toBe(true);
      // @ts-ignore
      expect(mem.prototypes).toHaveLength(7);  // 8 - 2 + 1 = 7
    });

    it('不合并当数量未达上限', () => {
      // @ts-ignore
      mem.prototypes = [];
      expect(mem.merge()).toBe(false);
    });
  });

  describe('序列化', () => {
    it('toJSON + fromJSON 往返', () => {
      const proto: Prototype = {
        id: 'a', label: 'A',
        centroid: makeNormedHidden(4, 1, 0, 0, 0),
        count: 10,
        toolDist: new Map([['read', 5], ['write', 3]]),
        toolSuccess: new Map([['read', { attempts: 5, successes: 4 }]]),
        firstSeen: Date.now(), lastSeen: Date.now(),
        isSeed: true, tags: ['seed'],
      };
      // @ts-ignore
      mem.prototypes = [proto];

      const json = mem.toJSON();
      const restored = PrototypeMemory.fromJSON(json);

      const rProto = restored.getPrototype('a')!;
      expect(rProto.label).toBe('A');
      expect(rProto.centroid).toBeInstanceOf(Float32Array);
      expect(rProto.toolDist.get('read')).toBe(5);
      expect(rProto.toolSuccess.get('read')!.successes).toBe(4);
      expect(rProto.isSeed).toBe(true);
    });
  });
});
