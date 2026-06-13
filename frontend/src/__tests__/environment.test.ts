/**
 * sensors/environment.ts 测试
 * 覆盖：EnvironmentMonitor 构造、getData、start/stop、onChange
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EnvironmentMonitor } from '../sensors/environment.js';

// Mock setInterval/clearInterval
vi.stubGlobal('setInterval', vi.fn((fn: Function, ms: number) => {
  // 不实际执行定时器
  return 42;
}));
vi.stubGlobal('clearInterval', vi.fn());

describe('EnvironmentMonitor', () => {
  let monitor: EnvironmentMonitor;

  beforeEach(() => {
    monitor = new EnvironmentMonitor();
  });

  afterEach(() => {
    monitor.stop();
  });

  describe('getData', () => {
    it('返回默认空数据', () => {
      const data = monitor.getData();
      expect(data.ambientLight).toBeNull();
      expect(data.noiseLevel).toBeNull();
      expect(data.networkType).toBe('unknown');
      expect(data.batteryLevel).toBeNull();
      expect(data.batteryCharging).toBeNull();
      expect(data.timestamp).toBeGreaterThan(0);
    });

    it('返回副本（不共享引用）', () => {
      const d1 = monitor.getData();
      const d2 = monitor.getData();
      expect(d1).not.toBe(d2);
      expect(d1).toEqual(d2);
    });
  });

  describe('start/stop', () => {
    it('start 启动监控', () => {
      monitor.start();
      // 不应抛错
    });

    it('重复 start 不会重复启动', () => {
      monitor.start();
      monitor.start();
      // 不应抛错
    });

    it('stop 停止监控', () => {
      monitor.start();
      monitor.stop();
      // 不应抛错
    });

    it('未 start 就 stop 不抛错', () => {
      monitor.stop();
    });
  });

  describe('onChange', () => {
    it('注册回调', () => {
      const cb = vi.fn();
      monitor.onChange(cb);
      // 不应抛错
    });

    it('取消注册', () => {
      const cb = vi.fn();
      const unsub = monitor.onChange(cb);
      unsub();
    });
  });

  describe('getDescription', () => {
    it('返回默认摘要', () => {
      const summary = monitor.getDescription();
      expect(summary).toContain('网络');
    });
  });
});
