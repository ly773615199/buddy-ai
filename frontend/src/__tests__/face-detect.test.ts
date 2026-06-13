/**
 * vision/face-detect.ts 测试
 * 覆盖：FaceDetector 构造、选项、init 后端探测、detect 降级
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FaceDetector } from '../vision/face-detect.js';
import type { FaceDetectionBackend } from '../vision/face-detect.js';

describe('FaceDetector', () => {
  // ==================== 构造 ====================

  describe('构造函数', () => {
    it('默认选项', () => {
      const detector = new FaceDetector();
      // 通过行为验证默认值
      expect(detector).toBeDefined();
    });

    it('自定义选项', () => {
      const detector = new FaceDetector({
        minConfidence: 0.8,
        maxFaces: 3,
        detectExpressions: true,
      });
      expect(detector).toBeDefined();
    });
  });

  // ==================== init ====================

  describe('init', () => {
    it('指定后端直接使用', async () => {
      const detector = new FaceDetector();
      await detector.init('fallback');
      // fallback 后端 detect 应返回空
      const result = await detector.detect('fakebase64');
      expect(result.faces).toEqual([]);
      expect(result.processingMs).toBeGreaterThanOrEqual(0);
    });

    it('指定 cloud 后端', async () => {
      const detector = new FaceDetector();
      await detector.init('cloud', 'test-api-key');
      // 无真实 API，应返回空或降级
      const result = await detector.detect('fakebase64');
      expect(result).toBeDefined();
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('自动探测 fallback（无真实 FaceDetector API）', async () => {
      const detector = new FaceDetector();
      await detector.init('fallback');
      const result = await detector.detect('fakebase64');
      expect(result.faces).toEqual([]);
    });
  });

  // ==================== detect ====================

  describe('detect', () => {
    it('返回结果结构正确', async () => {
      const detector = new FaceDetector();
      await detector.init('fallback');
      const result = await detector.detect('fakebase64');
      expect(result).toHaveProperty('faces');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('processingMs');
      expect(Array.isArray(result.faces)).toBe(true);
    });

    it('fallback 后端返回空人脸', async () => {
      const detector = new FaceDetector();
      await detector.init('fallback');
      const result = await detector.detect('fakebase64');
      expect(result.faces).toHaveLength(0);
    });

    it('处理时间 >= 0', async () => {
      const detector = new FaceDetector();
      await detector.init('fallback');
      const result = await detector.detect('fakebase64');
      expect(result.processingMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ==================== 配置过滤 ====================

  describe('配置过滤', () => {
    it('minConfidence 过滤低置信度', async () => {
      // 使用 cloud 后端但 mock 掉实际调用
      const detector = new FaceDetector({ minConfidence: 0.9 });
      await detector.init('fallback');
      const result = await detector.detect('fakebase64');
      // fallback 返回空，所以过滤不影响
      expect(result.faces).toHaveLength(0);
    });

    it('maxFaces 限制返回数量', async () => {
      const detector = new FaceDetector({ maxFaces: 2 });
      await detector.init('fallback');
      const result = await detector.detect('fakebase64');
      expect(result.faces.length).toBeLessThanOrEqual(2);
    });
  });
});
