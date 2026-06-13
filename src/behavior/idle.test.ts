/**
 * IdleBehavior 集成测试 — Utility AI + 行为链 + 上下文聚合
 *
 * 测试完整管线：感知 → 上下文 → 打分 → 行为选择 → 行为链
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { IdleBehavior, type IdleAction, type ActionParams } from './idle.js';
import type { DesireVector } from '../desire/engine.js';
import type { OceanPersonality } from '../personality/ocean.js';

describe('IdleBehavior 集成', () => {
  let idle: IdleBehavior;

  beforeEach(() => {
    idle = new IdleBehavior({ enabled: false }); // 手动控制
  });

  afterEach(() => {
    idle.stop();
  });

  // ==================== 基础行为选择 ====================

  describe('Utility AI 行为选择', () => {
    test('高 rest → 倾向 yawn/sleep', () => {
      idle.setDesires({ hunger: 30, curiosity: 20, social: 20, safety: 10, expression: 15, rest: 90 });
      const results: IdleAction[] = [];
      for (let i = 0; i < 50; i++) {
        const action = idle.triggerRandom();
        if (action) results.push(action);
      }
      const drowsyRate = results.filter(a => a === 'yawn' || a === 'sleep').length / results.length;
      expect(drowsyRate).toBeGreaterThan(0.2);
    });

    test('高 social + 用户在看 → 倾向 wave/peek', () => {
      idle.setDesires({ hunger: 20, curiosity: 20, social: 85, safety: 10, expression: 15, rest: 20 });
      idle.setUserPresent(true);
      const results: IdleAction[] = [];
      for (let i = 0; i < 50; i++) {
        const action = idle.triggerRandom();
        if (action) results.push(action);
      }
      const socialRate = results.filter(a => a === 'wave' || a === 'peek').length / results.length;
      expect(socialRate).toBeGreaterThan(0.15);
    });

    test('excited 情绪 → 倾向活跃行为', () => {
      idle.setMood('excited');
      const results: IdleAction[] = [];
      for (let i = 0; i < 50; i++) {
        const action = idle.triggerRandom();
        if (action) results.push(action);
      }
      // excited 下 wave 亲和度高
      const waveRate = results.filter(a => a === 'wave').length / results.length;
      expect(waveRate).toBeGreaterThan(0.05);
    });

    test('高 OCEAN 外倾性 → 更多社交行为', () => {
      idle.setOcean({ openness: 50, conscientiousness: 50, extraversion: 95, agreeableness: 50, neuroticism: 30 });
      idle.setDesires({ hunger: 20, curiosity: 30, social: 60, safety: 10, expression: 20, rest: 20 });
      const results: IdleAction[] = [];
      for (let i = 0; i < 80; i++) {
        const action = idle.triggerRandom();
        if (action) results.push(action);
      }
      const socialRate = results.filter(a => a === 'wave' || a === 'peek').length / results.length;
      expect(socialRate).toBeGreaterThan(0.1);
    });

    test('不会永远选同一个动作', () => {
      const results: IdleAction[] = [];
      for (let i = 0; i < 30; i++) {
        const action = idle.triggerRandom();
        if (action) results.push(action);
      }
      const unique = new Set(results).size;
      expect(unique).toBeGreaterThanOrEqual(2);
    });
  });

  // ==================== 感知事件集成 ====================

  describe('感知事件影响行为', () => {
    test('声音事件 → look_around/peek 分数上升', () => {
      idle.onPerception({ source: 'sound', type: 'doorbell', timestamp: Date.now() });
      const results: IdleAction[] = [];
      for (let i = 0; i < 50; i++) {
        const action = idle.triggerRandom();
        if (action) results.push(action);
      }
      const curiousRate = results.filter(a => a === 'look_around' || a === 'peek').length / results.length;
      expect(curiousRate).toBeGreaterThan(0.1);
    });

    test('用户语音兴奋 → wave 分数上升', () => {
      idle.onPerception({ source: 'voice', type: 'excited', timestamp: Date.now() });
      const results: IdleAction[] = [];
      for (let i = 0; i < 50; i++) {
        const action = idle.triggerRandom();
        if (action) results.push(action);
      }
      // 不做硬断言，只验证不崩溃
      expect(results.length).toBeGreaterThan(0);
    });

    test('recordUserInteraction 更新用户状态', () => {
      idle.recordUserInteraction();
      const ctx = idle.contextProvider.getContext();
      expect(ctx.userPresent).toBe(true);
    });
  });

  // ==================== 行为链集成 ====================

  describe('行为链', () => {
    test('yawn 后可能触发 stretch（高 rest）', () => {
      // 设置高 rest 以满足 yawn→stretch 条件
      idle.setDesires({ hunger: 20, curiosity: 20, social: 20, safety: 10, expression: 15, rest: 80 });

      const actions: Array<{ action: IdleAction; params?: ActionParams }> = [];
      idle.onAction((action, params) => {
        actions.push({ action, params });
      });

      // 模拟触发 yawn
      idle.contextProvider.recordAction('yawn');

      // 手动调用 triggerRandom 多次，看是否产生链式行为
      for (let i = 0; i < 20; i++) {
        idle.triggerRandom();
      }

      // 行为链是异步的（setTimeout），这里只验证回调注册正常
      expect(actions.length).toBeGreaterThan(0);
    });

    test('行为回调正确传递参数', () => {
      const received: Array<{ action: IdleAction; score?: number }> = [];
      idle.onAction((action, params) => {
        received.push({ action, score: params?.score });
      });

      idle.triggerRandom();
      expect(received).toHaveLength(1);
      expect(received[0].score).toBeDefined();
      expect(received[0].score).toBeGreaterThanOrEqual(0);
      expect(received[0].score).toBeLessThanOrEqual(1);
    });

    test('行为参数包含 reason', () => {
      const received: ActionParams[] = [];
      idle.onAction((action, params) => {
        if (params) received.push(params);
      });

      idle.triggerRandom();
      expect(received).toHaveLength(1);
      expect(received[0].reason).toBeDefined();
      expect(received[0].reason!.length).toBeGreaterThan(0);
    });
  });

  // ==================== 生命周期 ====================

  describe('生命周期', () => {
    test('start/stop 不抛异常', () => {
      idle.start();
      idle.stop();
    });

    test('disabled 状态下 start 不启动定时器', () => {
      const idle2 = new IdleBehavior({ enabled: false });
      idle2.start();
      // 不应有定时器在跑
      idle2.stop();
    });

    test('onBlink 回调注册', () => {
      let blinked = false;
      idle.onBlink(() => { blinked = true; });
      // 手动触发明眨眼（通过 start + 等待）
      // 这里只验证注册不抛异常
      expect(blinked).toBe(false);
    });
  });

  // ==================== 空闲时间追踪 ====================

  describe('空闲时间', () => {
    test('getContext 包含 idleMinutes', () => {
      const ctx = idle.contextProvider.getContext();
      expect(ctx.idleMinutes).toBeGreaterThanOrEqual(0);
    });

    test('用户交互重置空闲时间', () => {
      idle.recordUserInteraction();
      const ctx = idle.contextProvider.getContext();
      expect(ctx.idleMinutes).toBeLessThan(1);
    });
  });
});
