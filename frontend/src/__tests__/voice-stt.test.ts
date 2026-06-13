/**
 * voice/stt.ts 测试
 * 覆盖：STTManager 类导出、STT 后端结构
 */
import { describe, it, expect } from 'vitest';
import { STTManager, WebSpeechSTT, WhisperSTT } from '../voice/stt.js';

describe('voice/stt', () => {
  describe('STTManager', () => {
    it('类存在', () => {
      expect(STTManager).toBeDefined();
      expect(typeof STTManager).toBe('function');
    });
  });

  describe('WebSpeechSTT', () => {
    it('类存在', () => {
      expect(WebSpeechSTT).toBeDefined();
      expect(typeof WebSpeechSTT).toBe('function');
    });
  });

  describe('WhisperSTT', () => {
    it('类存在', () => {
      expect(WhisperSTT).toBeDefined();
      expect(typeof WhisperSTT).toBe('function');
    });
  });
});
