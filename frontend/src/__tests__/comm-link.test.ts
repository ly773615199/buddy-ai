/**
 * comm/link.ts 测试
 * 覆盖：BuddyLink 类导出、Priority 枚举、模块结构
 */
import { describe, it, expect } from 'vitest';
import { BuddyLink } from '../comm/link.js';
import { Priority } from '../comm/types.js';

describe('comm/link', () => {
  describe('Priority 枚举', () => {
    it('定义优先级级别', () => {
      expect(Priority).toBeDefined();
      expect(typeof Priority).toBe('object');
    });
  });

  describe('BuddyLink 类', () => {
    it('类存在', () => {
      expect(BuddyLink).toBeDefined();
      expect(typeof BuddyLink).toBe('function');
    });

    it('类有 connect 方法', () => {
      expect(typeof BuddyLink.prototype.connect).toBe('function');
    });

    it('类有 disconnect 方法', () => {
      expect(typeof BuddyLink.prototype.disconnect).toBe('function');
    });

    it('类有 send 方法', () => {
      expect(typeof BuddyLink.prototype.send).toBe('function');
    });

    it('类有 onMessage 方法', () => {
      expect(typeof BuddyLink.prototype.onMessage).toBe('function');
    });

    it('类有 getStateSnapshot 方法', () => {
      const instance = new BuddyLink();
      expect(typeof instance.getStateSnapshot).toBe('function');
    });
  });
});
