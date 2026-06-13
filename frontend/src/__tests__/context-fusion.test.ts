/**
 * sensors/context-fusion.ts 测试
 * 覆盖：PhysicalContextFusion 数据源注册、聚合刷新、智能分析、状态判断
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PhysicalContextFusion } from '../sensors/context-fusion.js';

// Mock setInterval/clearInterval
vi.stubGlobal('setInterval', vi.fn(() => 42));
vi.stubGlobal('clearInterval', vi.fn());

describe('PhysicalContextFusion', () => {
  let fusion: PhysicalContextFusion;

  beforeEach(() => {
    fusion = new PhysicalContextFusion({ autoRefresh: false });
  });

  afterEach(() => {
    fusion.destroy();
  });

  // ==================== 基本功能 ====================

  describe('getContext', () => {
    it('返回默认上下文', () => {
      const ctx = fusion.getContext();
      expect(ctx.motion).toBe('unknown');
      expect(ctx.location).toBeNull();
      expect(ctx.ambientLight).toBeNull();
    });

    it('返回副本（不共享引用）', () => {
      const ctx1 = fusion.getContext();
      const ctx2 = fusion.getContext();
      expect(ctx1).not.toBe(ctx2);
      expect(ctx1).toEqual(ctx2);
    });
  });

  describe('updateLocation', () => {
    it('更新位置信息', () => {
      fusion.updateLocation(39.9, 116.4, 10);
      const ctx = fusion.getContext();
      expect(ctx.location).toEqual({ lat: 39.9, lng: 116.4, accuracy: 10 });
    });

    it('触发变更回调', () => {
      const cb = vi.fn();
      fusion.onChange(cb);
      fusion.updateLocation(39.9, 116.4, 10);
      expect(cb).toHaveBeenCalled();
    });
  });

  describe('updateMotion', () => {
    it('更新运动状态', () => {
      fusion.updateMotion('walking');
      expect(fusion.getContext().motion).toBe('walking');
    });
  });

  // ==================== 数据源聚合 ====================

  describe('refresh', () => {
    it('聚合位置数据源', () => {
      fusion.registerLocation(() => ({ lat: 31.2, lng: 121.5, accuracy: 5, altitude: null, heading: null, speed: null, timestamp: Date.now() }));
      fusion.refresh();
      expect(fusion.getContext().location).toEqual({ lat: 31.2, lng: 121.5, accuracy: 5 });
    });

    it('聚合运动数据源', () => {
      fusion.registerMotion(() => 'running');
      fusion.refresh();
      expect(fusion.getContext().motion).toBe('running');
    });

    it('聚合环境数据源', () => {
      fusion.registerEnvironment(() => ({
        ambientLight: 500,
        noiseLevel: 40,
        networkType: 'wifi',
        batteryLevel: 0.8,
        batteryCharging: false,
      }));
      fusion.refresh();
      const ctx = fusion.getContext();
      expect(ctx.ambientLight).toBe(500);
      expect(ctx.noiseLevel).toBe(40);
      expect(ctx.networkType).toBe('wifi');
      expect(ctx.batteryLevel).toBe(0.8);
    });

    it('数据源返回 null 时不覆盖', () => {
      fusion.updateLocation(39.9, 116.4, 10);
      fusion.registerLocation(() => null);
      fusion.refresh();
      // 位置应保留之前的值
      expect(fusion.getContext().location).toEqual({ lat: 39.9, lng: 116.4, accuracy: 10 });
    });
  });

  // ==================== 智能分析 ====================

  describe('getSummary', () => {
    it('默认返回有限信息', () => {
      const summary = fusion.getSummary();
      expect(summary.description).toContain('有限');
      expect(summary.confidence).toBeLessThan(1);
    });

    it('走路状态生成建议', () => {
      fusion.updateMotion('walking');
      const summary = fusion.getSummary();
      expect(summary.description).toContain('走路');
      expect(summary.suggestions.some(s => s.includes('简短'))).toBe(true);
    });

    it('开车状态建议语音', () => {
      fusion.updateMotion('driving');
      const summary = fusion.getSummary();
      expect(summary.description).toContain('开车');
      expect(summary.suggestions.some(s => s.includes('语音'))).toBe(true);
    });

    it('暗环境生成关怀建议', () => {
      fusion.registerEnvironment(() => ({
        ambientLight: 5,
        noiseLevel: 0,
        networkType: 'wifi',
        batteryLevel: 0.8,
        batteryCharging: false,
      }));
      fusion.refresh();
      const summary = fusion.getSummary();
      expect(summary.description).toContain('暗');
      expect(summary.suggestions.some(s => s.includes('夜间'))).toBe(true);
    });

    it('低电量生成省电建议', () => {
      fusion.registerEnvironment(() => ({
        ambientLight: 100,
        noiseLevel: 0,
        networkType: 'wifi',
        batteryLevel: 0.15,
        batteryCharging: false,
      }));
      fusion.refresh();
      const summary = fusion.getSummary();
      expect(summary.description).toContain('电量低');
      expect(summary.suggestions.some(s => s.includes('电量'))).toBe(true);
    });

    it('移动网络建议节省流量', () => {
      fusion.registerEnvironment(() => ({
        ambientLight: 100,
        noiseLevel: 0,
        networkType: 'cellular',
        batteryLevel: 0.8,
        batteryCharging: false,
      }));
      fusion.refresh();
      const summary = fusion.getSummary();
      expect(summary.description).toContain('移动网络');
      expect(summary.suggestions.some(s => s.includes('流量'))).toBe(true);
    });

    it('置信度随数据源可用性增加', () => {
      const s1 = fusion.getSummary();
      fusion.updateLocation(39.9, 116.4, 10);
      const s2 = fusion.getSummary();
      expect(s2.confidence).toBeGreaterThan(s1.confidence);
    });
  });

  // ==================== Agent 上下文 ====================

  describe('toAgentContext', () => {
    it('生成 Agent 注入文本', () => {
      fusion.updateMotion('walking');
      const text = fusion.toAgentContext();
      expect(text).toContain('[物理环境]');
      expect(text).toContain('走路');
    });

    it('有建议时包含建议', () => {
      fusion.updateMotion('driving');
      const text = fusion.toAgentContext();
      expect(text).toContain('[环境建议]');
    });
  });

  // ==================== 状态判断 ====================

  describe('shouldReduceInteraction', () => {
    it('跑步时应减少交互', () => {
      fusion.updateMotion('running');
      expect(fusion.shouldReduceInteraction()).toBe(true);
    });

    it('开车时应减少交互', () => {
      fusion.updateMotion('driving');
      expect(fusion.shouldReduceInteraction()).toBe(true);
    });

    it('静止时不应减少', () => {
      fusion.updateMotion('stationary');
      expect(fusion.shouldReduceInteraction()).toBe(false);
    });

    it('极低电量应减少交互', () => {
      fusion.registerEnvironment(() => ({
        ambientLight: 100,
        noiseLevel: 0,
        networkType: 'wifi',
        batteryLevel: 0.05,
        batteryCharging: false,
      }));
      fusion.refresh();
      expect(fusion.shouldReduceInteraction()).toBe(true);
    });

    it('充电中不因电量减少', () => {
      fusion.registerEnvironment(() => ({
        ambientLight: 100,
        noiseLevel: 0,
        networkType: 'wifi',
        batteryLevel: 0.05,
        batteryCharging: true,
      }));
      fusion.refresh();
      expect(fusion.shouldReduceInteraction()).toBe(false);
    });
  });

  describe('shouldUseVoice', () => {
    it('走路时应用语音', () => {
      fusion.updateMotion('walking');
      expect(fusion.shouldUseVoice()).toBe(true);
    });

    it('跑步时应用语音', () => {
      fusion.updateMotion('running');
      expect(fusion.shouldUseVoice()).toBe(true);
    });

    it('静止时不用语音', () => {
      fusion.updateMotion('stationary');
      expect(fusion.shouldUseVoice()).toBe(false);
    });
  });

  // ==================== 回调 ====================

  describe('onChange', () => {
    it('注册和触发回调', () => {
      const cb = vi.fn();
      fusion.onChange(cb);
      fusion.updateMotion('walking');
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('取消注册后不再触发', () => {
      const cb = vi.fn();
      const unsub = fusion.onChange(cb);
      unsub();
      fusion.updateMotion('walking');
      expect(cb).not.toHaveBeenCalled();
    });
  });

  // ==================== 清理 ====================

  describe('destroy', () => {
    it('清理后不再有回调', () => {
      const cb = vi.fn();
      fusion.onChange(cb);
      fusion.destroy();
      // 不能直接验证，但不应抛错
    });
  });
});
