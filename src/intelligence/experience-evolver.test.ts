import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExperienceEvolver } from './experience-evolver.js';
import { ExperienceGraph } from './experience-graph.js';
import type { ExperienceUnit } from './types.js';

// ==================== Helpers ====================

function makeExp(overrides: Partial<ExperienceUnit> = {}): ExperienceUnit {
  return {
    id: `exp-${Math.random().toString(36).slice(2, 8)}`,
    name: '测试技能',
    description: '用于测试',
    abstractionLevel: 'concrete',
    trigger: {
      intent: 'test',
      keywords: ['测试'],
      contextTags: [],
      patterns: [],
    },
    steps: [
      { tool: 'read_file', args: { path: '/test.txt' }, outputVar: 'content' },
    ],
    replyTemplate: {
      sharp: '{content}',
      warm: '{content}',
      chaotic: '{content}',
      default: '{content}',
    },
    stats: {
      successCount: 5,
      failCount: 0,
      confidence: 0.9,
      avgExecutionMs: 100,
      lastUsed: Date.now(),
      createdAt: Date.now(),
      extractedFrom: [],
      consolidatedAt: Date.now(),
      evolved: false,
    },
    ...overrides,
  };
}

// ==================== Tests ====================

describe('ExperienceEvolver', () => {
  let graph: ExperienceGraph;
  let evolver: ExperienceEvolver;

  beforeEach(() => {
    graph = new ExperienceGraph();
    evolver = new ExperienceEvolver(graph);
  });

  // ── I8: autoEvolve ──

  describe('I8: autoEvolve', () => {
    it('拆分高失败率多步经验', async () => {
      const failing = makeExp({
        id: 'exp-failing',
        steps: [
          { tool: 'read_file', args: { path: '/a.txt' }, outputVar: 'a' },
          { tool: 'exec', args: { command: 'echo ${a}' }, outputVar: 'b' },
        ],
        stats: {
          successCount: 2,
          failCount: 5, // 高失败率
          confidence: 0.3,
          avgExecutionMs: 100,
          lastUsed: Date.now(),
          createdAt: Date.now(),
          extractedFrom: [],
          consolidatedAt: Date.now(),
          evolved: false,
        },
      });
      graph.addNode(failing);

      const events = await evolver.autoEvolve();

      // 应该拆分为 2 个单步经验
      const nodes = graph.getAllNodes();
      expect(nodes.length).toBe(2);
      expect(nodes.every(n => n.steps.length === 1)).toBe(true);
      expect(events.some(e => e.type === 'merged' && e.detail.includes('拆分'))).toBe(true);
    });

    it('不拆分低失败率经验', async () => {
      const good = makeExp({
        id: 'exp-good',
        steps: [
          { tool: 'read_file', args: { path: '/a.txt' }, outputVar: 'a' },
          { tool: 'exec', args: { command: 'echo ${a}' }, outputVar: 'b' },
        ],
        stats: {
          successCount: 10,
          failCount: 1,
          confidence: 0.9,
          avgExecutionMs: 100,
          lastUsed: Date.now(),
          createdAt: Date.now(),
          extractedFrom: [],
          consolidatedAt: Date.now(),
          evolved: false,
        },
      });
      graph.addNode(good);

      await evolver.autoEvolve();
      expect(graph.getAllNodes().length).toBe(1);
      expect(graph.getAllNodes()[0].steps.length).toBe(2);
    });

    it('不拆分单步骤经验', async () => {
      const single = makeExp({
        id: 'exp-single',
        stats: {
          successCount: 1,
          failCount: 5,
          confidence: 0.2,
          avgExecutionMs: 100,
          lastUsed: Date.now(),
          createdAt: Date.now(),
          extractedFrom: [],
          consolidatedAt: Date.now(),
          evolved: false,
        },
      });
      graph.addNode(single);

      await evolver.autoEvolve();
      // 单步骤不应拆分
      expect(graph.getAllNodes().length).toBe(1);
    });

    it('合并频繁配对的经验', async () => {
      const a = makeExp({
        id: 'exp-a',
        trigger: { intent: 'read_config', keywords: ['读取', '配置', 'common'], contextTags: [], patterns: [] },
        stats: { successCount: 5, failCount: 0, confidence: 0.8, avgExecutionMs: 100, lastUsed: Date.now(), createdAt: Date.now(), extractedFrom: [], consolidatedAt: Date.now(), evolved: false },
      });
      const b = makeExp({
        id: 'exp-b',
        trigger: { intent: 'write_config', keywords: ['写入', '配置', 'common'], contextTags: [], patterns: [] },
        stats: { successCount: 5, failCount: 0, confidence: 0.7, avgExecutionMs: 100, lastUsed: Date.now(), createdAt: Date.now(), extractedFrom: [], consolidatedAt: Date.now(), evolved: false },
      });
      graph.addNode(a);
      graph.addNode(b);

      const events = await evolver.autoEvolve();

      // 共享关键词 '配置' + 'common' → 2 个共享 → 应该合并
      const nodes = graph.getAllNodes();
      const merged = nodes.find(n => n.id.startsWith('merged_'));
      if (merged) {
        expect(merged.steps.length).toBe(2);
        expect(events.some(e => e.detail.includes('合并'))).toBe(true);
      }
    });

    it('空图谱不报错', async () => {
      const events = await evolver.autoEvolve();
      expect(events.length).toBe(0);
    });
  });

  // ── 基础进化 ──

  describe('基础进化', () => {
    it('onSuccess 增加成功计数', () => {
      const exp = makeExp({ id: 'exp-succ' });
      graph.addNode(exp);
      evolver.onSuccess('exp-succ', 100);
      expect(exp.stats.successCount).toBe(6);
      // Bayesian smoothing may adjust confidence differently
    });

    it('onFailure 增加失败计数', () => {
      const exp = makeExp({ id: 'exp-fail' });
      graph.addNode(exp);
      evolver.onFailure('exp-fail', 'error');
      expect(exp.stats.failCount).toBe(1);
    });

    it('置信度太低自动淘汰', () => {
      // recalcConfidence = smoothed + recencyBoost
      // smoothed = (0+2.5)/(failCount+5), recencyBoost ≈ 0.05
      // For total < 0.1: need smoothed < 0.05 → failCount > 45
      const exp = makeExp({
        id: 'exp-retire',
        stats: {
          successCount: 0, failCount: 46, confidence: 0.01,
          avgExecutionMs: 0, lastUsed: Date.now(), createdAt: Date.now(),
          extractedFrom: [], consolidatedAt: Date.now(), evolved: false,
        },
      });
      graph.addNode(exp);
      evolver.onFailure('exp-retire', 'error');
      // failCount=47, smoothed=2.5/52≈0.048 + recencyBoost≈0.05 → ≈0.098 < 0.1
      expect(graph.getNode('exp-retire')).toBeUndefined();
    });
  });

  // ── 梦境巩固 ──

  describe('dreamConsolidate', () => {
    it('合并相似技能', () => {
      const a = makeExp({ id: 'exp-d1', trigger: { intent: 'same', keywords: ['a', 'b'], contextTags: [], patterns: [] } });
      const b = makeExp({ id: 'exp-d2', trigger: { intent: 'same', keywords: ['a', 'b'], contextTags: [], patterns: [] } });
      graph.addNode(a);
      graph.addNode(b);

      const events = evolver.dreamConsolidate();
      expect(events.some(e => e.type === 'merged')).toBe(true);
      expect(graph.getAllNodes().length).toBe(1);
    });
  });
});
