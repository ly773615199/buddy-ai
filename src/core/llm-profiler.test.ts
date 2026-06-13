/**
 * LLM 能力实时探测器测试
 *
 * 覆盖：
 * - 基础记录与画像更新
 * - 能力等级判定（strong/weak/unstable/unavailable）
 * - 滑动窗口行为
 * - canUseFor 场景判断
 * - getInputStrategy 输入策略
 * - 连续失败与恢复
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LLMProfiler } from './llm-profiler.js';

describe('LLMProfiler', () => {
  let profiler: LLMProfiler;

  beforeEach(() => {
    profiler = new LLMProfiler();
  });

  // ==================== 初始状态 ====================

  describe('初始状态', () => {
    it('默认能力等级为 strong', () => {
      expect(profiler.getProfile().capabilityLevel).toBe('strong');
    });

    it('默认 qualityScore 为 1', () => {
      expect(profiler.getProfile().qualityScore).toBe(1);
    });

    it('默认 failureRate 为 0', () => {
      expect(profiler.getProfile().failureRate).toBe(0);
    });

    it('默认 consecutiveFailures 为 0', () => {
      expect(profiler.getProfile().consecutiveFailures).toBe(0);
    });

    it('默认 totalCalls 为 0', () => {
      expect(profiler.getProfile().totalCalls).toBe(0);
    });
  });

  // ==================== 记录 ====================

  describe('record()', () => {
    it('记录成功调用后 totalCalls 递增', () => {
      profiler.record({ latencyMs: 100, success: true });
      expect(profiler.getProfile().totalCalls).toBe(1);
    });

    it('记录失败调用后 totalCalls 递增', () => {
      profiler.record({ latencyMs: 100, success: false });
      expect(profiler.getProfile().totalCalls).toBe(1);
    });

    it('成功调用重置 consecutiveFailures', () => {
      profiler.record({ latencyMs: 100, success: false });
      profiler.record({ latencyMs: 100, success: false });
      expect(profiler.getProfile().consecutiveFailures).toBe(2);
      profiler.record({ latencyMs: 100, success: true });
      expect(profiler.getProfile().consecutiveFailures).toBe(0);
    });

    it('失败调用递增 consecutiveFailures', () => {
      profiler.record({ latencyMs: 100, success: false });
      profiler.record({ latencyMs: 100, success: false });
      profiler.record({ latencyMs: 100, success: false });
      expect(profiler.getProfile().consecutiveFailures).toBe(3);
    });

    it('记录质量评分后更新 qualityScore', () => {
      profiler.record({ latencyMs: 100, success: true, qualityScore: 0.8 });
      expect(profiler.getProfile().qualityScore).toBeCloseTo(0.8, 2);
    });

    it('记录延迟后更新 avgLatency', () => {
      profiler.record({ latencyMs: 100, success: true });
      profiler.record({ latencyMs: 200, success: true });
      expect(profiler.getProfile().avgLatency).toBeCloseTo(150, 0);
    });
  });

  // ==================== 能力等级判定 ====================

  describe('能力等级判定', () => {
    it('连续 3 次失败 → unavailable', () => {
      profiler.record({ latencyMs: 100, success: false });
      profiler.record({ latencyMs: 100, success: false });
      profiler.record({ latencyMs: 100, success: false });
      expect(profiler.getProfile().capabilityLevel).toBe('unavailable');
    });

    it('失败率 >= 30% → unstable（无连续 3 次失败）', () => {
      // 交替成功/失败，避免连续 3 次失败触发 unavailable
      for (let i = 0; i < 20; i++) {
        profiler.record({ latencyMs: 100, success: i % 3 !== 0 }); // 每 3 次有 1 次失败 = 33%
      }
      expect(profiler.getProfile().capabilityLevel).toBe('unstable');
    });

    it('平均延迟 > 10s → weak', () => {
      for (let i = 0; i < 5; i++) profiler.record({ latencyMs: 12000, success: true });
      expect(profiler.getProfile().capabilityLevel).toBe('weak');
    });

    it('质量评分 < 0.4 → weak', () => {
      for (let i = 0; i < 5; i++) profiler.record({ latencyMs: 100, success: true, qualityScore: 0.3 });
      expect(profiler.getProfile().capabilityLevel).toBe('weak');
    });

    it('正常指标 → strong', () => {
      for (let i = 0; i < 10; i++) profiler.record({ latencyMs: 500, success: true, qualityScore: 0.8 });
      expect(profiler.getProfile().capabilityLevel).toBe('strong');
    });

    it('unavailable 优先于 unstable', () => {
      // 先制造高失败率
      for (let i = 0; i < 10; i++) profiler.record({ latencyMs: 100, success: false });
      // 连续 3 次失败应触发 unavailable
      expect(profiler.getProfile().capabilityLevel).toBe('unavailable');
    });
  });

  // ==================== 滑动窗口 ====================

  describe('滑动窗口', () => {
    it('窗口大小限制在 20 条以内', () => {
      // 录入 50 条记录
      for (let i = 0; i < 50; i++) {
        profiler.record({ latencyMs: 100, success: true });
      }
      expect(profiler.getProfile().totalCalls).toBe(50);
      // 画像应该基于最近的窗口计算
      expect(profiler.getProfile().avgLatency).toBeCloseTo(100, 0);
    });

    it('新记录覆盖旧记录的影响', () => {
      // 先录入高延迟（每 4 次成功后 1 次失败，避免 unavailable）
      for (let i = 0; i < 25; i++) {
        profiler.record({ latencyMs: 10000, success: i % 5 !== 0, qualityScore: 0.3 });
      }
      expect(profiler.getProfile().capabilityLevel).toBe('weak');

      // 录入足够多的正常记录覆盖窗口
      for (let i = 0; i < 30; i++) profiler.record({ latencyMs: 200, success: true, qualityScore: 0.9 });
      expect(profiler.getProfile().capabilityLevel).toBe('strong');
    });
  });

  // ==================== canUseFor ====================

  describe('canUseFor()', () => {
    it('strong 模式下所有场景可用', () => {
      for (let i = 0; i < 5; i++) profiler.record({ latencyMs: 200, success: true, qualityScore: 0.9 });
      expect(profiler.canUseFor('realtime')).toBe(true);
      expect(profiler.canUseFor('batch')).toBe(true);
      expect(profiler.canUseFor('critical')).toBe(true);
    });

    it('weak 模式下只支持 batch', () => {
      for (let i = 0; i < 5; i++) profiler.record({ latencyMs: 12000, success: true });
      expect(profiler.canUseFor('realtime')).toBe(false);
      expect(profiler.canUseFor('batch')).toBe(true);
      expect(profiler.canUseFor('critical')).toBe(false);
    });

    it('unstable 模式下不支持 realtime/critical', () => {
      // 交替失败，避免连续 3 次触发 unavailable
      for (let i = 0; i < 20; i++) {
        profiler.record({ latencyMs: 100, success: i % 3 !== 0 });
      }
      expect(profiler.canUseFor('realtime')).toBe(false);
      expect(profiler.canUseFor('critical')).toBe(false);
    });

    it('unavailable 模式下不支持任何场景', () => {
      for (let i = 0; i < 5; i++) profiler.record({ latencyMs: 100, success: false });
      expect(profiler.canUseFor('realtime')).toBe(false);
      expect(profiler.canUseFor('batch')).toBe(false);
      expect(profiler.canUseFor('critical')).toBe(false);
    });
  });

  // ==================== getInputStrategy ====================

  describe('getInputStrategy()', () => {
    it('strong → full', () => {
      for (let i = 0; i < 5; i++) profiler.record({ latencyMs: 200, success: true, qualityScore: 0.9 });
      expect(profiler.getInputStrategy()).toBe('full');
    });

    it('weak → condensed', () => {
      for (let i = 0; i < 5; i++) profiler.record({ latencyMs: 12000, success: true });
      expect(profiler.getInputStrategy()).toBe('condensed');
    });

    it('unstable → minimal', () => {
      // 交替失败，避免连续 3 次触发 unavailable
      for (let i = 0; i < 20; i++) {
        profiler.record({ latencyMs: 100, success: i % 3 !== 0 });
      }
      expect(profiler.getInputStrategy()).toBe('minimal');
    });

    it('unavailable → none', () => {
      for (let i = 0; i < 5; i++) profiler.record({ latencyMs: 100, success: false });
      expect(profiler.getInputStrategy()).toBe('none');
    });
  });

  // ==================== 恢复场景 ====================

  describe('恢复场景', () => {
    it('从 unavailable 恢复到 strong', () => {
      // 先变成 unavailable
      for (let i = 0; i < 5; i++) profiler.record({ latencyMs: 100, success: false });
      expect(profiler.getProfile().capabilityLevel).toBe('unavailable');

      // 恢复：录入大量成功记录
      for (let i = 0; i < 25; i++) profiler.record({ latencyMs: 200, success: true, qualityScore: 0.9 });
      expect(profiler.getProfile().capabilityLevel).toBe('strong');
    });

    it('从 weak 恢复到 strong', () => {
      // 先变成 weak
      for (let i = 0; i < 10; i++) profiler.record({ latencyMs: 15000, success: true });
      expect(profiler.getProfile().capabilityLevel).toBe('weak');

      // 恢复
      for (let i = 0; i < 25; i++) profiler.record({ latencyMs: 200, success: true, qualityScore: 0.9 });
      expect(profiler.getProfile().capabilityLevel).toBe('strong');
    });
  });

  // ==================== getProfile 不可变 ====================

  describe('getProfile() 返回副本', () => {
    it('修改返回值不影响内部状态', () => {
      const p1 = profiler.getProfile();
      p1.avgLatency = 99999;
      const p2 = profiler.getProfile();
      expect(p2.avgLatency).not.toBe(99999);
    });
  });
});
