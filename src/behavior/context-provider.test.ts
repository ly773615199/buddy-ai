/**
 * ContextProvider 测试 — 上下文聚合 + 感知事件
 */

import { describe, test, expect } from 'vitest';
import { ContextProvider, type PerceptionEvent } from './context-provider.js';

describe('ContextProvider', () => {
  test('getContext 返回默认状态', () => {
    const cp = new ContextProvider();
    const ctx = cp.getContext();
    expect(ctx.desires.hunger).toBeGreaterThan(0);
    expect(ctx.emotion.joy).toBeGreaterThan(0);
    expect(ctx.mood).toBe('calm');
    expect(ctx.ocean.openness).toBe(50);
    expect(ctx.userPresent).toBe(false);
    expect(ctx.recentActions).toEqual([]);
  });

  test('updateEmotion 更新情绪和心情', () => {
    const cp = new ContextProvider();
    const newEmotion = { joy: 80, sadness: 5, anger: 0, fear: 0, surprise: 10, disgust: 0, trust: 50, anticipation: 40 };
    cp.updateEmotion(newEmotion, 'happy');
    const ctx = cp.getContext();
    expect(ctx.emotion.joy).toBe(80);
    expect(ctx.mood).toBe('happy');
  });

  test('updateDesires 更新欲望', () => {
    const cp = new ContextProvider();
    cp.updateDesires({ hunger: 90, curiosity: 10, social: 80, safety: 5, expression: 50, rest: 95 });
    const ctx = cp.getContext();
    expect(ctx.desires.hunger).toBe(90);
    expect(ctx.desires.rest).toBe(95);
  });

  test('updateOcean 更新人格', () => {
    const cp = new ContextProvider();
    cp.updateOcean({ openness: 90, conscientiousness: 30, extraversion: 80, agreeableness: 60, neuroticism: 20 });
    const ctx = cp.getContext();
    expect(ctx.ocean.openness).toBe(90);
    expect(ctx.ocean.neuroticism).toBe(20);
  });

  test('recordAction 记录行为历史', () => {
    const cp = new ContextProvider();
    cp.recordAction('yawn');
    cp.recordAction('wave');
    cp.recordAction('think');
    const ctx = cp.getContext();
    expect(ctx.recentActions).toEqual(['yawn', 'wave', 'think']);
    expect(ctx.lastAction).toBe('think');
    expect(ctx.lastActionAge).toBeGreaterThanOrEqual(0);
  });

  test('行为历史最多保留 10 个', () => {
    const cp = new ContextProvider();
    for (let i = 0; i < 15; i++) {
      cp.recordAction('blink');
    }
    const ctx = cp.getContext();
    expect(ctx.recentActions.length).toBe(10);
  });

  test('setUserPresent 更新用户在场状态', () => {
    const cp = new ContextProvider();
    cp.setUserPresent(true);
    expect(cp.getContext().userPresent).toBe(true);
    cp.setUserPresent(false);
    expect(cp.getContext().userPresent).toBe(false);
  });

  test('recordUserInteraction 更新用户交互时间', () => {
    const cp = new ContextProvider();
    const before = cp.getContext().userLastInteraction;
    // 等一小段时间确保时间戳不同
    cp.recordUserInteraction();
    const after = cp.getContext().userLastInteraction;
    expect(after).toBeGreaterThanOrEqual(before);
    expect(cp.getContext().userPresent).toBe(true);
  });

  describe('onPerception', () => {
    test('声音事件 30 秒内有效', () => {
      const cp = new ContextProvider();
      cp.onPerception({ source: 'sound', type: 'doorbell', timestamp: Date.now() });
      const ctx = cp.getContext();
      expect(ctx.soundEvent).toBe('doorbell');
    });

    test('声音事件超过 30 秒后过期', () => {
      const cp = new ContextProvider();
      cp.onPerception({ source: 'sound', type: 'doorbell', timestamp: Date.now() - 31_000 });
      const ctx = cp.getContext();
      expect(ctx.soundEvent).toBeUndefined();
    });

    test('语音情绪事件 30 秒内有效', () => {
      const cp = new ContextProvider();
      cp.onPerception({ source: 'voice', type: 'excited', timestamp: Date.now() });
      const ctx = cp.getContext();
      expect(ctx.voiceEmotion).toBe('excited');
    });

    test('环境光照事件更新', () => {
      const cp = new ContextProvider();
      cp.onPerception({ source: 'environment', type: 'light', data: 0.2, timestamp: Date.now() });
      const ctx = cp.getContext();
      expect(ctx.ambientLight).toBe(0.2);
    });

    test('用户事件记录交互', () => {
      const cp = new ContextProvider();
      cp.onPerception({ source: 'user', type: 'message', timestamp: Date.now() });
      const ctx = cp.getContext();
      expect(ctx.userPresent).toBe(true);
    });
  });

  test('reset 重置所有状态', () => {
    const cp = new ContextProvider();
    cp.recordAction('yawn');
    cp.setUserPresent(true);
    cp.updateEmotion({ joy: 80, sadness: 0, anger: 0, fear: 0, surprise: 0, disgust: 0, trust: 50, anticipation: 30 }, 'happy');
    cp.reset();
    const ctx = cp.getContext();
    expect(ctx.recentActions).toEqual([]);
    expect(ctx.lastAction).toBeNull();
  });

  test('getIdleMinutes 返回空闲时间', () => {
    const cp = new ContextProvider();
    expect(cp.getIdleMinutes()).toBeGreaterThanOrEqual(0);
  });
});
