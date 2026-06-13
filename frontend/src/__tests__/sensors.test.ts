/**
 * sensors/motion.ts + location.ts 测试
 * 覆盖：MotionManager 类结构、MotionState 类型、LocationManager 类结构
 */
import { describe, it, expect } from 'vitest';
import { MotionManager } from '../sensors/motion.js';
import { LocationManager } from '../sensors/location.js';

describe('sensors/motion', () => {
  describe('MotionManager', () => {
    it('类存在', () => {
      expect(MotionManager).toBeDefined();
      expect(typeof MotionManager).toBe('function');
    });

    it('类有 start 方法', () => {
      expect(typeof MotionManager.prototype.start).toBe('function');
    });

    it('类有 stop 方法', () => {
      expect(typeof MotionManager.prototype.stop).toBe('function');
    });

    it('类有 getState 方法', () => {
      expect(typeof MotionManager.prototype.getState).toBe('function');
    });

    it('类有 isAvailable 方法', () => {
      expect(typeof MotionManager.prototype.isAvailable).toBe('function');
    });
  });
});

describe('sensors/location', () => {
  describe('LocationManager', () => {
    it('类存在', () => {
      expect(LocationManager).toBeDefined();
      expect(typeof LocationManager).toBe('function');
    });

    it('类有 watchPosition 方法', () => {
      expect(typeof LocationManager.prototype.watchPosition).toBe('function');
    });

    it('类有 getLastPosition 方法', () => {
      expect(typeof LocationManager.prototype.getLastPosition).toBe('function');
    });

    it('类有 destroy 方法', () => {
      expect(typeof LocationManager.prototype.destroy).toBe('function');
    });
  });
});
