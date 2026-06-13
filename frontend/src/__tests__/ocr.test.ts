/**
 * vision/ocr.ts 测试
 * 覆盖：OCRProcessor 类结构、OCRBackend 类型
 */
import { describe, it, expect } from 'vitest';
import { OCRProcessor } from '../vision/ocr.js';

describe('vision/ocr', () => {
  describe('OCRProcessor', () => {
    it('类存在', () => {
      expect(OCRProcessor).toBeDefined();
      expect(typeof OCRProcessor).toBe('function');
    });

    it('类有 recognize 方法', () => {
      expect(typeof OCRProcessor.prototype.recognize).toBe('function');
    });

    it('类有 extractText 方法', () => {
      expect(typeof OCRProcessor.prototype.extractText).toBe('function');
    });
  });
});
