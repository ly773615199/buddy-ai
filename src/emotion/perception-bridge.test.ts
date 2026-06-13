/**
 * 感知→情绪映射管线测试
 */

import { describe, test, expect, vi } from 'vitest';
import { PerceptionBridge, type PerceptionEvent } from './perception-bridge.js';

// Mock Cerebellum
function createMockCerebellum() {
  const appliedBuffs: string[] = [];
  return {
    bodyState: {
      applyBuff: (key: string) => { appliedBuffs.push(key); },
    },
    appliedBuffs,
  };
}

describe('PerceptionBridge', () => {
  describe('语音情绪映射', () => {
    test.each([
      ['excited', 'user_voice_excited'],
      ['happy', 'user_voice_happy'],
      ['sad', 'user_voice_sad'],
      ['angry', 'user_voice_angry'],
      ['anxious', 'user_voice_anxious'],
      ['tired', 'user_voice_tired'],
      ['neutral', 'user_voice_neutral'],
      ['calm', 'user_voice_neutral'],
    ])('语音情绪 %s → buff %s', (voiceType, expectedBuff) => {
      const mock = createMockCerebellum();
      const bridge = new PerceptionBridge(mock as any);
      bridge.onPerception({ source: 'voice', type: voiceType, timestamp: Date.now() });
      expect(mock.appliedBuffs).toContain(expectedBuff);
    });
  });

  describe('环境声音映射', () => {
    test.each([
      ['doorbell', 'sound_doorbell'],
      ['knock', 'sound_doorbell'],
      ['alarm', 'sound_alarm'],
      ['music', 'sound_music'],
      ['speech', 'sound_speech'],
      ['pet', 'sound_pet'],
      ['glass_break', 'sound_glass_break'],
      ['silence', 'sound_silence'],
    ])('声音事件 %s → buff %s', (soundType, expectedBuff) => {
      const mock = createMockCerebellum();
      const bridge = new PerceptionBridge(mock as any);
      bridge.onPerception({ source: 'sound', type: soundType, timestamp: Date.now() });
      expect(mock.appliedBuffs).toContain(expectedBuff);
    });
  });

  describe('环境数据映射', () => {
    test.each([
      ['dark', 'env_dark'],
      ['bright', 'env_bright'],
      ['noisy', 'env_noisy'],
      ['quiet', 'env_quiet'],
    ])('环境 %s → buff %s', (envType, expectedBuff) => {
      const mock = createMockCerebellum();
      const bridge = new PerceptionBridge(mock as any);
      bridge.onPerception({ source: 'environment', type: envType, timestamp: Date.now() });
      expect(mock.appliedBuffs).toContain(expectedBuff);
    });
  });

  describe('用户交互映射', () => {
    test.each([
      ['praise', 'user_praise'],
      ['message', 'user_message'],
    ])('用户 %s → buff %s', (userType, expectedBuff) => {
      const mock = createMockCerebellum();
      const bridge = new PerceptionBridge(mock as any);
      bridge.onPerception({ source: 'user', type: userType, timestamp: Date.now() });
      expect(mock.appliedBuffs).toContain(expectedBuff);
    });
  });

  describe('时钟事件映射', () => {
    test('late_night → late_night buff', () => {
      const mock = createMockCerebellum();
      const bridge = new PerceptionBridge(mock as any);
      bridge.onPerception({ source: 'clock', type: 'late_night', timestamp: Date.now() });
      expect(mock.appliedBuffs).toContain('late_night');
    });

    test('morning → morning buff', () => {
      const mock = createMockCerebellum();
      const bridge = new PerceptionBridge(mock as any);
      bridge.onPerception({ source: 'clock', type: 'morning', timestamp: Date.now() });
      expect(mock.appliedBuffs).toContain('morning');
    });
  });

  test('未知事件类型不注入 buff', () => {
    const mock = createMockCerebellum();
    const bridge = new PerceptionBridge(mock as any);
    bridge.onPerception({ source: 'voice', type: 'unknown_emotion', timestamp: Date.now() });
    expect(mock.appliedBuffs).toHaveLength(0);
  });

  test('最近事件历史记录', () => {
    const mock = createMockCerebellum();
    const bridge = new PerceptionBridge(mock as any);
    bridge.onPerception({ source: 'voice', type: 'happy', timestamp: Date.now() });
    bridge.onPerception({ source: 'sound', type: 'doorbell', timestamp: Date.now() });
    const events = bridge.getRecentEvents();
    expect(events).toHaveLength(2);
    expect(events[0].source).toBe('voice');
    expect(events[1].source).toBe('sound');
  });

  test('事件历史最多 50 条', () => {
    const mock = createMockCerebellum();
    const bridge = new PerceptionBridge(mock as any);
    for (let i = 0; i < 60; i++) {
      bridge.onPerception({ source: 'voice', type: 'neutral', timestamp: Date.now() });
    }
    expect(bridge.getRecentEvents()).toHaveLength(50);
  });

  describe('tick 自动检查', () => {
    test('用户长时间不在 → continuous_work buff', () => {
      const mock = createMockCerebellum();
      const bridge = new PerceptionBridge(mock as any);
      // 设置用户上次交互为 31 分钟前
      bridge.setUserLastInteraction(Date.now() - 31 * 60_000);
      bridge.tick();
      expect(mock.appliedBuffs).toContain('continuous_work');
    });

    test('用户最近有交互 → 不注入 continuous_work', () => {
      const mock = createMockCerebellum();
      const bridge = new PerceptionBridge(mock as any);
      bridge.setUserLastInteraction(Date.now() - 5 * 60_000);
      bridge.tick();
      expect(mock.appliedBuffs).not.toContain('continuous_work');
    });
  });

  describe('生命周期', () => {
    test('start/stop 控制定时 tick', () => {
      const mock = createMockCerebellum();
      const bridge = new PerceptionBridge(mock as any);
      bridge.start();
      bridge.stop();
      // 不抛异常即通过
    });

    test('重复 start 不创建多个定时器', () => {
      const mock = createMockCerebellum();
      const bridge = new PerceptionBridge(mock as any);
      bridge.start();
      bridge.start(); // 第二次不应创建新定时器
      bridge.stop();
    });
  });
});
