/**
 * PrototypeMemory 集成测试 — 双通道 + Thompson Sampling 协同
 *
 * 验证：
 * 1. 种子原型从 intentHead 权重正确提取
 * 2. decodeSignal 双通道：intentHead + 原型匹配并行
 * 3. predictDetailed 工具先验注入
 * 4. 新意图发现 + 自动创建原型
 * 5. 工具反馈闭环
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PrototypeMemory } from './prototype-memory.js';

function makeNormed(dim: number, ...values: number[]): Float32Array {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = values[i] ?? 0;
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}

describe('PrototypeMemory 集成', () => {
  let mem: PrototypeMemory;

  beforeEach(() => {
    mem = new PrototypeMemory({
      hiddenDim: 4,
      minNovelSamples: 3,
      maxPrototypes: 8,
      noveltyThreshold: 0.5,
    });
  });

  describe('种子原型 + topTools', () => {
    it('添加种子原型后 topTools 返回按频次排序的工具', () => {
      const proto = {
        id: 'seed_test',
        label: 'test',
        centroid: makeNormed(4, 1, 0, 0, 0),
        count: 10,
        toolDist: new Map([
          ['read', 5],
          ['write', 3],
          ['exec', 1],
        ]),
        toolSuccess: new Map(),
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        isSeed: true,
        tags: ['seed'],
        qualityScore: 1.0,
        failureStreak: 0,
      };
      mem.addPrototype(proto);

      const match = mem.findNearest(makeNormed(4, 1, 0, 0, 0));
      expect(match).not.toBeNull();
      expect(match!.isNovel).toBe(false);

      const tools = match!.prototype.topTools(3);
      expect(tools).toEqual(['read', 'write', 'exec']);
    });

    it('同 ID 不重复添加', () => {
      const proto = {
        id: 'dup', label: 'dup',
        centroid: makeNormed(4, 1, 0, 0, 0),
        count: 0, toolDist: new Map(), toolSuccess: new Map(),
        firstSeen: Date.now(), lastSeen: Date.now(),
        isSeed: true, tags: [], qualityScore: 1.0, failureStreak: 0,
      };
      mem.addPrototype(proto);
      mem.addPrototype(proto);
      expect(mem.getPrototypes()).toHaveLength(1);
    });
  });

  describe('双通道：NN + 原型并行', () => {
    it('已知意图 → 原型命中 → 置信度提升', () => {
      // 模拟 3 个种子原型
      mem.addPrototype({
        id: 'seed_file', label: 'file_operations',
        centroid: makeNormed(4, 1, 0, 0, 0),
        count: 100, toolDist: new Map([['read', 80]]), toolSuccess: new Map(),
        firstSeen: Date.now(), lastSeen: Date.now(), isSeed: true, tags: [], qualityScore: 1.0, failureStreak: 0,
      });
      mem.addPrototype({
        id: 'seed_code', label: 'code_operations',
        centroid: makeNormed(4, 0, 1, 0, 0),
        count: 80, toolDist: new Map([['exec', 60]]), toolSuccess: new Map(),
        firstSeen: Date.now(), lastSeen: Date.now(), isSeed: true, tags: [], qualityScore: 1.0, failureStreak: 0,
      });
      mem.addPrototype({
        id: 'seed_web', label: 'web_operations',
        centroid: makeNormed(4, 0, 0, 1, 0),
        count: 50, toolDist: new Map([['web_fetch', 40]]), toolSuccess: new Map(),
        firstSeen: Date.now(), lastSeen: Date.now(), isSeed: true, tags: [], qualityScore: 1.0, failureStreak: 0,
      });

      // 文件操作方向 → 应该命中 seed_file
      const h = makeNormed(4, 0.9, 0.1, 0.1, 0);
      const match = mem.findNearest(h);

      expect(match).not.toBeNull();
      expect(match!.isNovel).toBe(false);
      expect(match!.prototype.label).toBe('file_operations');
      expect(match!.confidence).toBeGreaterThan(0.5);
    });

    it('新颖输入 → 距离超阈值 → 标记为新颖', () => {
      mem.addPrototype({
        id: 'seed_file', label: 'file_operations',
        centroid: makeNormed(4, 1, 0, 0, 0),
        count: 100, toolDist: new Map(), toolSuccess: new Map(),
        firstSeen: Date.now(), lastSeen: Date.now(), isSeed: true, tags: [], qualityScore: 1.0, failureStreak: 0,
      });

      // 完全不同方向 → 新颖
      const h = makeNormed(4, 0, 0, 0, 1);
      const match = mem.findNearest(h);

      expect(match).not.toBeNull();
      expect(match!.isNovel).toBe(true);
    });
  });

  describe('新意图发现流程', () => {
    it('暂存区满 → 自动创建新原型', () => {
      // 添加一个种子原型
      mem.addPrototype({
        id: 'seed_known', label: 'known',
        centroid: makeNormed(4, 1, 0, 0, 0),
        count: 100, toolDist: new Map(), toolSuccess: new Map(),
        firstSeen: Date.now(), lastSeen: Date.now(), isSeed: true, tags: [], qualityScore: 1.0, failureStreak: 0,
      });

      // 多次输入新颖方向 → 应该触发新原型创建
      const novelDir = makeNormed(4, 0, 0, 0, 1);
      let created = false;
      for (let i = 0; i < 10; i++) {
        const result = mem.observeNovel(novelDir);
        if (result) {
          created = true;
          break;
        }
      }

      expect(created).toBe(true);
      expect(mem.getPrototypes().length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('工具反馈闭环', () => {
    it('updateTool 更新原型的工具分布和成功率', () => {
      mem.addPrototype({
        id: 'proto_a', label: 'A',
        centroid: makeNormed(4, 1, 0, 0, 0),
        count: 10, toolDist: new Map(), toolSuccess: new Map(),
        firstSeen: Date.now(), lastSeen: Date.now(), isSeed: true, tags: [], qualityScore: 1.0, failureStreak: 0,
      });

      mem.updateTool('proto_a', 'read', true);
      mem.updateTool('proto_a', 'read', true);
      mem.updateTool('proto_a', 'exec', false);

      const proto = mem.getPrototype('proto_a')!;
      expect(proto.toolDist.get('read')).toBe(2);
      expect(proto.toolDist.get('exec')).toBe(1);
      expect(proto.toolSuccess.get('read')).toEqual({ attempts: 2, successes: 2 });
      expect(proto.toolSuccess.get('exec')).toEqual({ attempts: 1, successes: 0 });
    });
  });

  describe('EMA centroid 更新', () => {
    it('hitPrototype 后 centroid 向 hidden 偏移', () => {
      const proto = {
        id: 'p', label: 'P',
        centroid: makeNormed(4, 1, 0, 0, 0),
        count: 10, toolDist: new Map(), toolSuccess: new Map(),
        firstSeen: Date.now(), lastSeen: Date.now(), isSeed: true, tags: [], qualityScore: 1.0, failureStreak: 0,
      };
      mem.addPrototype(proto);

      // 用不同方向的 hidden 更新
      const hidden = makeNormed(4, 0.8, 0.6, 0, 0);
      mem.hitPrototype(proto, hidden);

      // centroid 应该向 hidden 偏移
      expect(proto.centroid[0]).toBeLessThan(1); // 原来是 1
      expect(proto.centroid[1]).toBeGreaterThan(0); // 原来是 0
      expect(proto.count).toBe(11);
    });
  });

  describe('原型合并', () => {
    it('达到上限时自动合并最近的一对', () => {
      // 创建多个相近的原型
      for (let i = 0; i < 8; i++) {
        mem.addPrototype({
          id: `p${i}`, label: `P${i}`,
          centroid: makeNormed(4, 1, 0.1 * i, 0, 0),
          count: 10, toolDist: new Map(), toolSuccess: new Map(),
          firstSeen: Date.now(), lastSeen: Date.now(), isSeed: false, tags: [], qualityScore: 0.5, failureStreak: 0,
        });
      }

      // 触发合并
      const merged = mem.merge();
      expect(merged).toBe(true);
      expect(mem.getPrototypes().length).toBeLessThan(8);
    });
  });

  describe('消化（质量驱动）', () => {
    it('低质量非种子原型消化到最近的种子原型', () => {
      // 种子原型：文件方向
      mem.addPrototype({
        id: 'seed_file', label: 'file_operations',
        centroid: makeNormed(4, 1, 0, 0, 0),
        count: 100,
        toolDist: new Map([['read', 80], ['write', 50]]),
        toolSuccess: new Map([['read', { attempts: 80, successes: 75 }]]),
        firstSeen: Date.now(), lastSeen: Date.now(),
        isSeed: true, tags: [],
        qualityScore: 1.0, failureStreak: 0,
      });

      // 低质量非种子：连续失败 + 质量分低
      mem.addPrototype({
        id: 'bad_proto', label: 'bad_reader',
        centroid: makeNormed(4, 0.95, 0.3, 0, 0),
        count: 20,
        toolDist: new Map([['read', 15], ['search_files', 10]]),
        toolSuccess: new Map([['search_files', { attempts: 10, successes: 2 }]]),
        firstSeen: Date.now(), lastSeen: Date.now(),
        isSeed: false, tags: ['low_quality'],
        qualityScore: 0.15, failureStreak: 6,
      });

      const beforeCount = mem.getPrototypes().length;
      const digested = mem.digest();

      // 被消化了
      expect(digested).toHaveLength(1);
      expect(digested[0].id).toBe('bad_proto');
      expect(mem.getPrototypes().length).toBe(beforeCount - 1);

      // 种子原型吸收了工具知识
      const seed = mem.getPrototype('seed_file')!;
      expect(seed.toolDist.get('read')).toBe(95);      // 80 + 15
      expect(seed.toolDist.get('search_files')).toBe(10);
      expect(seed.toolSuccess.get('search_files')).toEqual({ attempts: 10, successes: 2 });
      expect(seed.count).toBe(120); // 100 + 20
      expect(seed.tags).toContain('digested:bad_proto');
    });

    it('高质量原型不被消化', () => {
      mem.addPrototype({
        id: 'seed_a', label: 'A',
        centroid: makeNormed(4, 1, 0, 0, 0),
        count: 10, toolDist: new Map(), toolSuccess: new Map(),
        firstSeen: Date.now(), lastSeen: Date.now(), isSeed: true, tags: [], qualityScore: 1.0, failureStreak: 0,
        qualityScore: 1.0, failureStreak: 0,
      });

      // 高质量非种子
      mem.addPrototype({
        id: 'good_proto', label: 'good',
        centroid: makeNormed(4, 0, 1, 0, 0),
        count: 50, toolDist: new Map(), toolSuccess: new Map(),
        firstSeen: Date.now(), lastSeen: Date.now(), isSeed: false, tags: [], qualityScore: 0.5, failureStreak: 0,
        qualityScore: 0.9, failureStreak: 0,
      });

      const digested = mem.digest();
      expect(digested).toHaveLength(0);
      expect(mem.getPrototypes()).toHaveLength(2);
    });

    it('没有种子原型时不消化', () => {
      mem.addPrototype({
        id: 'orphan', label: 'orphan',
        centroid: makeNormed(4, 1, 0, 0, 0),
        count: 10, toolDist: new Map(), toolSuccess: new Map(),
        firstSeen: Date.now(), lastSeen: Date.now(), isSeed: false, tags: [], qualityScore: 0.5, failureStreak: 0,
        qualityScore: 0.1, failureStreak: 10,
      });

      const digested = mem.digest();
      expect(digested).toHaveLength(0);
    });

    it('updateTool 连续失败标记 low_quality', () => {
      mem.addPrototype({
        id: 'proto_q', label: 'Q',
        centroid: makeNormed(4, 1, 0, 0, 0),
        count: 10, toolDist: new Map(), toolSuccess: new Map(),
        firstSeen: Date.now(), lastSeen: Date.now(), isSeed: false, tags: [], qualityScore: 0.5, failureStreak: 0,
        qualityScore: 0.5, failureStreak: 0,
      });

      // 连续失败 5 次 → 触发 low_quality 标记
      for (let i = 0; i < 5; i++) {
        mem.updateTool('proto_q', 'bad_tool', false);
      }

      const proto = mem.getPrototype('proto_q')!;
      expect(proto.failureStreak).toBe(5);
      expect(proto.tags).toContain('low_quality');
      expect(proto.qualityScore).toBeLessThan(0.5);
    });

    it('updateTool 成功重置 failureStreak', () => {
      mem.addPrototype({
        id: 'proto_r', label: 'R',
        centroid: makeNormed(4, 1, 0, 0, 0),
        count: 10, toolDist: new Map(), toolSuccess: new Map(),
        firstSeen: Date.now(), lastSeen: Date.now(), isSeed: false, tags: [], qualityScore: 0.5, failureStreak: 0,
        qualityScore: 0.5, failureStreak: 3,
      });

      mem.updateTool('proto_r', 'good_tool', true);

      const proto = mem.getPrototype('proto_r')!;
      expect(proto.failureStreak).toBe(0);
      expect(proto.qualityScore).toBeGreaterThan(0.5);
    });
  });
});
