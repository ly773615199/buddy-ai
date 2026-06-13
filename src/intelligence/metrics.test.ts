import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector } from './metrics.js';

describe('MetricsCollector 经验效果量化', () => {
  let mc: MetricsCollector;

  beforeEach(() => {
    mc = new MetricsCollector();
  });

  // ==================== 计数器 ====================

  describe('recordInteraction() 计数', () => {
    it('exp_direct 增加零LLM计数', () => {
      mc.recordInteraction('exp_direct');
      mc.recordInteraction('exp_direct');
      const c = mc.getCounters();
      expect(c.totalInteractions).toBe(2);
      expect(c.expDirectCount).toBe(2);
      expect(c.estimatedTokenSavings).toBe(3000); // 1500 * 2
    });

    it('exp_verified 增加验证计数', () => {
      mc.recordInteraction('exp_verified');
      const c = mc.getCounters();
      expect(c.expVerifiedCount).toBe(1);
      expect(c.estimatedTokenSavings).toBe(450); // 1500 * 0.3
    });

    it('llm_only 增加纯LLM计数', () => {
      mc.recordInteraction('llm_only');
      mc.recordInteraction('llm');
      mc.recordInteraction('llm_with_hint');
      const c = mc.getCounters();
      expect(c.llmOnlyCount).toBe(3);
    });
  });

  describe('recordExpExecution() 经验执行', () => {
    it('成功执行增加计数', () => {
      mc.recordExpExecution(true, 100);
      mc.recordExpExecution(true, 200);
      mc.recordExpExecution(false, 50);
      const c = mc.getCounters();
      expect(c.totalExpExecutions).toBe(3);
      expect(c.successfulExpExecutions).toBe(2);
      expect(c.totalExpMs).toBe(350);
    });
  });

  describe('recordLlmCall() LLM调用', () => {
    it('记录调用次数和耗时', () => {
      mc.recordLlmCall(1000);
      mc.recordLlmCall(2000);
      const c = mc.getCounters();
      expect(c.llmCallCount).toBe(2);
      expect(c.totalLlmMs).toBe(3000);
    });
  });

  // ==================== 快照 ====================

  describe('takeSnapshot() 快照', () => {
    it('空状态返回零快照', () => {
      const s = mc.takeSnapshot();
      expect(s.totalInteractions).toBe(0);
      expect(s.llmSavingsRate).toBe(0);
      expect(s.expSuccessRate).toBe(0);
      expect(s.estimatedTokenSavings).toBe(0);
    });

    it('有数据时计算正确', () => {
      mc.recordInteraction('exp_direct');
      mc.recordInteraction('exp_direct');
      mc.recordInteraction('llm_only');
      mc.recordExpExecution(true, 100);
      mc.recordExpExecution(true, 200);
      mc.recordLlmCall(500);

      const s = mc.takeSnapshot();
      expect(s.totalInteractions).toBe(3);
      expect(s.expDirectCount).toBe(2);
      expect(s.llmOnlyCount).toBe(1);
      expect(s.llmSavingsRate).toBeCloseTo(2 / 3, 2);
      expect(s.expSuccessRate).toBe(1);
      expect(s.avgExpExecutionMs).toBe(150);
      expect(s.avgLlmResponseMs).toBe(500);
    });

    it('快照历史不超过 MAX_SNAPSHOTS', () => {
      for (let i = 0; i < 1100; i++) {
        mc.recordInteraction('llm_only');
        mc.takeSnapshot();
      }
      const snapshots = mc.getSnapshots(2000);
      expect(snapshots.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('getLatestSnapshot() / getSnapshots()', () => {
    it('无快照返回 null', () => {
      expect(mc.getLatestSnapshot()).toBeNull();
    });

    it('返回最新快照', () => {
      mc.recordInteraction('exp_direct');
      mc.takeSnapshot();
      mc.recordInteraction('llm_only');
      mc.takeSnapshot();
      const latest = mc.getLatestSnapshot();
      expect(latest!.totalInteractions).toBe(2);
    });

    it('getSnapshots 返回指定数量', () => {
      for (let i = 0; i < 5; i++) mc.takeSnapshot();
      expect(mc.getSnapshots(3)).toHaveLength(3);
    });
  });

  // ==================== 分析 ====================

  describe('analyzeExperiences() 经验分析', () => {
    it('返回按置信度排序的经验指标', () => {
      const experiences = [
        {
          id: 'exp1', name: 'test1', abstractionLevel: 'tool',
          stats: { confidence: 0.5, successCount: 3, failCount: 2, avgExecutionMs: 100, lastUsed: Date.now(), createdAt: Date.now() - 3600000 },
        },
        {
          id: 'exp2', name: 'test2', abstractionLevel: 'workflow',
          stats: { confidence: 0.9, successCount: 10, failCount: 0, avgExecutionMs: 50, lastUsed: Date.now(), createdAt: Date.now() - 7200000 },
        },
      ] as any[];

      const result = mc.analyzeExperiences(experiences);
      expect(result).toHaveLength(2);
      expect(result[0].expId).toBe('exp2'); // 更高置信度排前面
      expect(result[0].successRate).toBe(1);
      expect(result[1].successRate).toBeCloseTo(0.6, 1);
      expect(result[1].age).toBeCloseTo(1, 0); // ~1 小时
    });
  });

  // ==================== 报告 ====================

  describe('generateReport() 报告', () => {
    it('生成非空文字报告', () => {
      mc.recordInteraction('exp_direct');
      mc.recordInteraction('llm_only');
      const report = mc.generateReport();
      expect(report).toContain('📊');
      expect(report).toContain('总交互: 2');
      expect(report).toContain('LLM节省率');
    });
  });

  // ==================== 重置 ====================

  describe('reset() 重置', () => {
    it('清空所有计数器和快照', () => {
      mc.recordInteraction('exp_direct');
      mc.recordExpExecution(true, 100);
      mc.recordLlmCall(500);
      mc.takeSnapshot();
      mc.reset();
      const c = mc.getCounters();
      expect(c.totalInteractions).toBe(0);
      expect(c.expDirectCount).toBe(0);
      expect(mc.getLatestSnapshot()).toBeNull();
    });
  });
});
