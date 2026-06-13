/**
 * vision/scene-analyze.ts + voice/tts.ts 测试
 * 覆盖：SceneAnalyzer 类结构、TTSManager 类结构
 */
import { describe, it, expect } from 'vitest';
import { SceneAnalyzer } from '../vision/scene-analyze.js';
import { TTSManager } from '../voice/tts.js';

describe('vision/scene-analyze', () => {
  describe('SceneAnalyzer', () => {
    it('类存在', () => {
      expect(SceneAnalyzer).toBeDefined();
      expect(typeof SceneAnalyzer).toBe('function');
    });

    it('类有 analyze 方法', () => {
      expect(typeof SceneAnalyzer.prototype.analyze).toBe('function');
    });
  });
});

describe('voice/tts', () => {
  describe('TTSManager', () => {
    it('类存在', () => {
      expect(TTSManager).toBeDefined();
      expect(typeof TTSManager).toBe('function');
    });

    it('类有 speak 方法', () => {
      expect(typeof TTSManager.prototype.speak).toBe('function');
    });

    it('类有 stop 方法', () => {
      expect(typeof TTSManager.prototype.stop).toBe('function');
    });
  });
});
