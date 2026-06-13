/**
 * 信号汇聚层测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SignalConvergenceLayer } from './index.js';
import type { TrainingSample } from '../types.js';

describe('SignalConvergenceLayer', () => {
  let layer: SignalConvergenceLayer;
  let collected: TrainingSample[];

  beforeEach(() => {
    layer = new SignalConvergenceLayer({ verbose: false });
    collected = [];
    layer.setOnSample(s => collected.push(s));
  });

  describe('ingestFeedback', () => {
    it('should convert negative correction to training sample with weight ×3', () => {
      layer.ingestFeedback({
        type: 'correction',
        content: '不对，你应该用 git commit 而不是 git push',
        importance: 7,
        negative: true,
        currentIntent: 2,
        currentTools: [11],
      });

      expect(collected).toHaveLength(1);
      expect(collected[0].weight).toBe(3.0);
      expect(collected[0].outcome).toBe(false);
      expect(collected[0].labelQuality).toBe(0.1);
    });

    it('should convert positive correction to training sample with inferred intent', () => {
      layer.ingestFeedback({
        type: 'correction',
        content: '你应该用文件读取来处理这个',
        importance: 7,
        negative: false,
      });

      expect(collected).toHaveLength(1);
      expect(collected[0].weight).toBe(3.0);
      expect(collected[0].outcome).toBe(true);
      expect(collected[0].labelIntent).toBe(0); // file_operations
    });

    it('should handle encouragement with lower weight', () => {
      layer.ingestFeedback({
        type: 'encouragement',
        content: '不错，这样很好',
        importance: 3,
      });

      expect(collected).toHaveLength(1);
      expect(collected[0].weight).toBe(1.5);
      expect(collected[0].outcome).toBe(true);
    });

    it('should handle remember signals', () => {
      layer.ingestFeedback({
        type: 'remember',
        content: '记住，Python 的 GIL 限制了多线程',
        importance: 9,
      });

      expect(collected).toHaveLength(1);
      expect(collected[0].weight).toBe(3.0);
    });
  });

  describe('ingestKnowledge', () => {
    it('should convert code knowledge to code_operations intent', () => {
      layer.ingestKnowledge({
        content: 'function hello() { return "world"; }',
        sourceType: 'text',
        source: 'user_input',
      });

      expect(collected).toHaveLength(1);
      expect(collected[0].weight).toBe(2.0);
      expect(collected[0].labelIntent).toBe(1); // code_operations
      expect(collected[0].labelQuality).toBe(0.7);
    });

    it('should convert git knowledge to git_operations intent', () => {
      layer.ingestKnowledge({
        content: 'git rebase -i HEAD~3 可以交互式变基',
        sourceType: 'text',
        source: 'user_input',
      });

      expect(collected).toHaveLength(1);
      expect(collected[0].labelIntent).toBe(2); // git_operations
    });

    it('should use provided domain when available', () => {
      layer.ingestKnowledge({
        content: '一些内容',
        sourceType: 'text',
        source: 'user_input',
        domain: 'system',
      });

      expect(collected).toHaveLength(1);
      expect(collected[0].labelIntent).toBe(4); // system_operations
    });
  });

  describe('ingestReasoning', () => {
    it('should convert high-confidence reasoning to sample', () => {
      layer.ingestReasoning({
        topic: '代码重构方案',
        conclusions: ['应该用策略模式', '先提取接口'],
        confidence: 0.8,
      });

      expect(collected).toHaveLength(1);
      expect(collected[0].weight).toBe(1.5);
      expect(collected[0].labelIntent).toBe(1); // code_operations
    });

    it('should skip low-confidence reasoning', () => {
      layer.ingestReasoning({
        topic: '不确定的推理',
        conclusions: ['可能是这样'],
        confidence: 0.3,
      });

      expect(collected).toHaveLength(0);
    });
  });

  describe('ingestEvolution', () => {
    it('should convert success event to positive sample', () => {
      layer.ingestEvolution({
        eventType: 'success',
        skillId: 'exp-1',
        detail: '成功执行',
        intent: 1,
        tools: [0, 4],
      });

      expect(collected).toHaveLength(1);
      expect(collected[0].outcome).toBe(true);
      expect(collected[0].weight).toBe(1.0);
    });

    it('should convert failure event to negative sample', () => {
      layer.ingestEvolution({
        eventType: 'failure',
        skillId: 'exp-1',
        detail: '执行失败',
      });

      expect(collected).toHaveLength(1);
      expect(collected[0].outcome).toBe(false);
    });

    it('should skip merged/retired events', () => {
      layer.ingestEvolution({
        eventType: 'merged',
        skillId: 'exp-1',
        detail: '合并',
      });

      expect(collected).toHaveLength(0);
    });
  });

  describe('priority ordering', () => {
    it('should apply different priority multipliers to different sources', () => {
      // 各来源的基础权重都是 1.0，乘以各自的优先级乘数
      layer.ingestEvolution({ eventType: 'success', skillId: 'e1', detail: '' });
      layer.ingestReasoning({ topic: 'test', conclusions: ['c1'], confidence: 0.8 });
      layer.ingestKnowledge({ content: 'code test', sourceType: 'text', source: 'test' });
      layer.ingestFeedback({ type: 'correction', content: '不对', importance: 7, negative: true });

      expect(collected).toHaveLength(4);
      // evolution: 1.0 × 1.0 = 1.0
      // reasoning: 1.0 × 1.5 = 1.5
      // knowledge: 1.0 × 2.0 = 2.0
      // feedback:  1.0 × 3.0 = 3.0
      // 各来源的最终权重应符合优先级乘数
      const weights = collected.map(s => s.weight);
      expect(weights).toContain(1.0);  // evolution
      expect(weights).toContain(1.5);  // reasoning
      expect(weights).toContain(2.0);  // knowledge
      expect(weights).toContain(3.0);  // feedback
    });
  });

  describe('stats', () => {
    it('should track ingestion stats', () => {
      layer.ingestFeedback({ type: 'correction', content: 'test', importance: 7, negative: true });
      layer.ingestKnowledge({ content: 'test code', sourceType: 'text', source: 'test' });

      const stats = layer.getStats();
      expect(stats.totalIngested).toBe(2);
      expect(stats.bySource.feedback).toBe(1);
      expect(stats.bySource.knowledge).toBe(1);
    });
  });

  describe('disabled state', () => {
    it('should not ingest when disabled', () => {
      layer.setEnabled(false);
      layer.ingestFeedback({ type: 'correction', content: 'test', importance: 7, negative: true });
      expect(collected).toHaveLength(0);
    });
  });
});
