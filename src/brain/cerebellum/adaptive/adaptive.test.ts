import { describe, it, expect } from 'vitest';
import { RhythmAdaptor } from './rhythm.js';
import { HabitMemory } from './habit.js';
import { ErrorTuner } from './error-tuner.js';

describe('Adaptive Layer — 小脑自适应层', () => {

  describe('RhythmAdaptor', () => {
    it('空采样返回默认中等负载', () => {
      const rhythm = new RhythmAdaptor();
      const adj = rhythm.regulate();
      // 无采样时默认负载 50，在正常区间内
      expect(adj.heartbeatIntervalMs).toBeGreaterThanOrEqual(180_000);
      expect(adj.heartbeatIntervalMs).toBeLessThanOrEqual(600_000);
      expect(adj.dreamDensity).toBeGreaterThanOrEqual(0.3);
      expect(adj.dreamDensity).toBeLessThanOrEqual(1.5);
    });

    it('高峰负载压低梦境密度', () => {
      const rhythm = new RhythmAdaptor();
      for (let i = 0; i < 60; i++) rhythm.addLoadSample(85);
      const adj = rhythm.regulate();
      expect(adj.dreamDensity).toBeLessThan(1.0); // 低于默认值
      expect(adj.heartbeatIntervalMs).toBeGreaterThan(300_000);
    });

    it('空闲负载提升自检频率', () => {
      const rhythm = new RhythmAdaptor();
      for (let i = 0; i < 60; i++) rhythm.addLoadSample(15);
      const adj = rhythm.regulate();
      expect(adj.maintenanceFrequency).toBeGreaterThanOrEqual(1.5);
      expect(adj.heartbeatIntervalMs).toBeLessThan(300_000);
    });

    it('性能 < 1ms', () => {
      const rhythm = new RhythmAdaptor();
      for (let i = 0; i < 60; i++) rhythm.addLoadSample(50);
      const t0 = performance.now();
      for (let i = 0; i < 1000; i++) rhythm.regulate();
      const elapsed = performance.now() - t0;
      expect(elapsed).toBeLessThan(10); // 1000 次 < 10ms → 每次 < 0.01ms
    });
  });

  describe('HabitMemory', () => {
    it('未固化条目不命中', () => {
      const habit = new HabitMemory();
      const signal = { domains: ['code'], complexity: 'simple' as const, taskType: 'chat' as const,
        shouldUseDAG: false, dagReason: '', intentConfidence: 0.8 };
      const plan = { mode: 'single' as const, reason: 'test', selectedNodes: [],
        confidence: 0.8, source: 'rule' };
      habit.record(signal, plan, true);
      expect(habit.lookup(signal)).toBeNull();
    });

    it('固化后命中', () => {
      const habit = new HabitMemory();
      const signal = { domains: ['code'], complexity: 'simple' as const, taskType: 'chat' as const,
        shouldUseDAG: false, dagReason: '', intentConfidence: 0.8 };
      const plan = { mode: 'single' as const, reason: 'test', selectedNodes: [],
        confidence: 0.8, source: 'rule' };
      for (let i = 0; i < 6; i++) habit.record(signal, plan, true);
      expect(habit.lookup(signal)).not.toBeNull();
    });

    it('成功率下降后淘汰', () => {
      const habit = new HabitMemory({ minSuccessRate: 0.7 });
      const signal = { domains: ['git'], complexity: 'complex' as const, taskType: 'tools' as const,
        shouldUseDAG: false, dagReason: '', intentConfidence: 0.5 };
      const plan = { mode: 'single' as const, reason: 'test', selectedNodes: [],
        confidence: 0.5, source: 'scheduler' };
      // 先固化
      for (let i = 0; i < 6; i++) habit.record(signal, plan, true);
      expect(habit.lookup(signal)).not.toBeNull();
      // 然后连续失败
      for (let i = 0; i < 20; i++) habit.record(signal, plan, false);
      habit.prune();
      expect(habit.lookup(signal)).toBeNull();
    });

    it('性能 < 0.1ms', () => {
      const habit = new HabitMemory();
      const signal = { domains: ['code'], complexity: 'simple' as const, taskType: 'chat' as const,
        shouldUseDAG: false, dagReason: '', intentConfidence: 0.8 };
      const plan = { mode: 'single' as const, reason: 'test', selectedNodes: [],
        confidence: 0.8, source: 'rule' };
      for (let i = 0; i < 10; i++) habit.record(signal, plan, true);
      const t0 = performance.now();
      for (let i = 0; i < 10000; i++) habit.lookup(signal);
      const elapsed = performance.now() - t0;
      expect(elapsed).toBeLessThan(50); // 10000 次 < 50ms → 每次 < 0.005ms
    });
  });

  describe('ErrorTuner', () => {
    it('高频低严重度错误被弱化', () => {
      const tuner = new ErrorTuner();
      for (let i = 0; i < 20; i++) tuner.observe('timeout', 'low');
      expect(tuner.getAlertWeight('timeout')).toBeLessThan(0.5);
    });

    it('致命错误被强化', () => {
      const tuner = new ErrorTuner();
      tuner.observe('crash', 'critical');
      expect(tuner.getAlertWeight('crash')).toBeGreaterThan(1.0);
    });

    it('致命错误永远不被过度弱化', () => {
      const tuner = new ErrorTuner();
      // 先弱化
      for (let i = 0; i < 100; i++) tuner.observe('crash', 'low');
      // 再触发致命
      tuner.observe('crash', 'critical');
      expect(tuner.getAlertWeight('crash')).toBeGreaterThanOrEqual(0.5);
    });

    it('decay 恢复到中性', () => {
      const tuner = new ErrorTuner();
      for (let i = 0; i < 20; i++) tuner.observe('err', 'low');
      const before = tuner.getAlertWeight('err');
      for (let i = 0; i < 50; i++) tuner.decay();
      const after = tuner.getAlertWeight('err');
      expect(after).toBeGreaterThan(before);
    });

    it('性能 < 1ms', () => {
      const tuner = new ErrorTuner();
      const t0 = performance.now();
      for (let i = 0; i < 1000; i++) tuner.observe('test', 'medium');
      for (let i = 0; i < 1000; i++) tuner.getAlertWeight('test');
      const elapsed = performance.now() - t0;
      expect(elapsed).toBeLessThan(50);
    });
  });
});
