/**
 * Phase C Week 15 — 传感器 + 物理上下文融合测试 (vitest)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LocationManager } from '../frontend/src/sensors/location.js';
import { MotionManager } from '../frontend/src/sensors/motion.js';
import { EnvironmentMonitor } from '../frontend/src/sensors/environment.js';
import { PhysicalContextFusion } from '../frontend/src/sensors/context-fusion.js';
import { DEFAULT_PHYSICAL_CONTEXT } from './perception/types.js';

describe('Phase C Week 15 — 传感器 + 物理上下文融合', () => {
  // ==================== GPS 定位 + 地理围栏测试 ====================

  describe('GPS 定位 + 地理围栏', () => {
    let loc: LocationManager;

    beforeAll(() => {
      loc = new LocationManager();
    });

    afterAll(() => {
      loc.destroy();
    });

    it('初始无位置', () => {
      expect(loc.getLastPosition()).toBeNull();
    });

    it('添加 2 个围栏', () => {
      loc.addGeofence({ id: 'home', name: '家', lat: 39.9, lng: 116.4, radius: 500 });
      loc.addGeofence({ id: 'office', name: '公司', lat: 39.91, lng: 116.41, radius: 300 });
      expect(loc.getGeofences().length).toBe(2);
      expect(loc.getGeofences()[0].name).toBe('家');
    });

    it('移除后剩 1 个围栏', () => {
      loc.removeGeofence('home');
      expect(loc.getGeofences().length).toBe(1);
    });

    it('围栏事件回调注册成功', () => {
      let fenceEvent: any = null;
      loc.onGeofenceEvent((event) => { fenceEvent = event; });
      expect(true).toBe(true); // callback registered without error
    });

    it('销毁后围栏清空', () => {
      // We need a fresh instance since destroy is called here
      const tempLoc = new LocationManager();
      tempLoc.addGeofence({ id: 'test', name: 'test', lat: 0, lng: 0, radius: 100 });
      tempLoc.destroy();
      expect(tempLoc.getGeofences().length).toBe(0);
    });
  });

  // ==================== 运动感知测试 ====================

  describe('运动感知 + 跌倒检测', () => {
    it('初始状态为 unknown，步数为 0', () => {
      const motion = new MotionManager({
        walkThreshold: 0.3,
        runThreshold: 0.8,
        fallThreshold: 2.5,
      });
      expect(motion.getState()).toBe('unknown');
      expect(motion.getStepCount()).toBe(0);
      motion.destroy();
    });

    it('回调注册返回函数', () => {
      const motion = new MotionManager({
        walkThreshold: 0.3,
        runThreshold: 0.8,
        fallThreshold: 2.5,
      });
      const unsubMotion = motion.onMotion(() => {});
      const unsubFall = motion.onFall(() => {});
      expect(typeof unsubMotion).toBe('function');
      expect(typeof unsubFall).toBe('function');
      unsubMotion();
      unsubFall();
      motion.destroy();
    });

    it('步数重置成功', () => {
      const motion = new MotionManager({
        walkThreshold: 0.3,
        runThreshold: 0.8,
        fallThreshold: 2.5,
      });
      motion.resetStepCount();
      expect(motion.getStepCount()).toBe(0);
      motion.destroy();
    });

    it('默认初始状态', () => {
      const defaultMotion = new MotionManager();
      expect(defaultMotion.getState()).toBe('unknown');
      defaultMotion.destroy();
    });
  });

  // ==================== 环境监控测试 ====================

  describe('环境监控', () => {
    let env: EnvironmentMonitor;

    beforeAll(() => {
      env = new EnvironmentMonitor();
    });

    afterAll(() => {
      env.destroy();
    });

    it('初始未监控', () => {
      expect(env.isMonitoring).toBe(false);
    });

    it('初始数据默认值', () => {
      const data = env.getData();
      expect(data.networkType).toBe('unknown');
      expect(data.batteryLevel).toBeNull();
      expect(data.timestamp).toBeGreaterThan(0);
    });

    it('变更回调注册成功', () => {
      let changeEvent: any = null;
      const unsubEnv = env.onChange((event) => { changeEvent = event; });
      expect(typeof unsubEnv).toBe('function');
      unsubEnv();
    });

    it('环境描述为非空字符串', () => {
      const desc = env.getDescription();
      expect(typeof desc).toBe('string');
      expect(desc.length).toBeGreaterThan(0);
    });
  });

  // ==================== 物理上下文融合测试 ====================

  describe('物理上下文融合', () => {
    let fusion: PhysicalContextFusion;

    beforeAll(() => {
      fusion = new PhysicalContextFusion({ autoRefresh: false });
    });

    afterAll(() => {
      fusion.destroy();
    });

    it('初始上下文默认值', () => {
      const ctx = fusion.getContext();
      expect(ctx.location).toBeNull();
      expect(ctx.motion).toBe('unknown');
      expect(ctx.ambientLight).toBeNull();
      expect(ctx.timestamp).toBeGreaterThanOrEqual(0);
    });

    it('手动更新位置', () => {
      fusion.updateLocation(39.9, 116.4, 10);
      expect(fusion.getContext().location?.lat).toBe(39.9);
    });

    it('手动更新运动状态', () => {
      fusion.updateMotion('walking');
      expect(fusion.getContext().motion).toBe('walking');
      fusion.updateMotion('stationary');
      expect(fusion.getContext().motion).toBe('stationary');
    });

    it('聚合刷新来自 provider', () => {
      fusion.registerLocation(() => ({ lat: 40.0, lng: 117.0, accuracy: 5, timestamp: Date.now() }));
      fusion.registerMotion(() => 'running');
      fusion.registerEnvironment(() => ({
        ambientLight: 500,
        noiseLevel: 0.3,
        networkType: 'wifi',
        networkDownlink: 50,
        networkRtt: 20,
        batteryLevel: 0.8,
        batteryCharging: false,
        timestamp: Date.now(),
      }));

      const refreshed = fusion.refresh();
      expect(refreshed.location?.lat).toBe(40.0);
      expect(refreshed.motion).toBe('running');
      expect(refreshed.ambientLight).toBe(500);
      expect(refreshed.networkType).toBe('wifi');
      expect(refreshed.batteryLevel).toBe(0.8);
    });

    it('上下文摘要包含运动状态和建议', () => {
      const summary = fusion.getSummary();
      expect(summary.description).toContain('跑步');
      expect(summary.suggestions.length).toBeGreaterThan(0);
      expect(summary.confidence).toBeGreaterThan(0);
      expect(summary.availability.location).toBe(true);
      expect(summary.availability.motion).toBe(true);
      expect(summary.availability.environment).toBe(true);
    });

    it('Agent 上下文注入文本', () => {
      const agentCtx = fusion.toAgentContext();
      expect(agentCtx).toContain('[物理环境]');
      expect(agentCtx).toContain('[环境建议]');
      expect(agentCtx).toContain('跑步');
    });

    it('跑步时应减少交互，建议语音', () => {
      expect(fusion.shouldReduceInteraction()).toBe(true);
      expect(fusion.shouldUseVoice()).toBe(true);
    });

    it('静止时不需减少交互', () => {
      fusion.updateMotion('stationary');
      expect(fusion.shouldReduceInteraction()).toBe(false);
    });

    it('离线时应减少交互', () => {
      fusion.registerEnvironment(() => ({
        ambientLight: null,
        noiseLevel: null,
        networkType: 'offline',
        networkDownlink: null,
        networkRtt: null,
        batteryLevel: null,
        batteryCharging: null,
        timestamp: Date.now(),
      }));
      fusion.refresh();
      expect(fusion.shouldReduceInteraction()).toBe(true);
    });

    it('电量 5% 且未充电时应减少交互', () => {
      fusion.registerEnvironment(() => ({
        ambientLight: 100,
        noiseLevel: 0.2,
        networkType: 'wifi',
        networkDownlink: 10,
        networkRtt: 50,
        batteryLevel: 0.05,
        batteryCharging: false,
        timestamp: Date.now(),
      }));
      fusion.refresh();
      expect(fusion.shouldReduceInteraction()).toBe(true);
    });

    it('位置变更触发回调', () => {
      let contextChanged = false;
      const unsubFusion = fusion.onChange(() => { contextChanged = true; });
      fusion.updateLocation(41.0, 118.0, 15);
      expect(contextChanged).toBe(true);
      unsubFusion();
    });
  });

  // ==================== DEFAULT_PHYSICAL_CONTEXT 验证 ====================

  describe('DEFAULT_PHYSICAL_CONTEXT', () => {
    it('默认值正确', () => {
      expect(DEFAULT_PHYSICAL_CONTEXT.motion).toBe('unknown');
      expect(DEFAULT_PHYSICAL_CONTEXT.location).toBeNull();
      expect(DEFAULT_PHYSICAL_CONTEXT.timestamp).toBe(0);
    });
  });
});
