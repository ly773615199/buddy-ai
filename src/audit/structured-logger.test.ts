import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logger, LogLevel } from './structured-logger.js';

describe('StructuredLogger 结构化日志', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  // ==================== 基础日志 ====================

  describe('日志级别', () => {
    it('debug 输出', () => {
      logger.debug('test', 'debug message');
      // 在 dev 模式下会调用 console.log
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('info 输出', () => {
      logger.info('test', 'info message');
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('warn 输出', () => {
      logger.warn('test', 'warn message');
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('error 输出含 Error 对象', () => {
      logger.error('test', 'error message', new Error('test error'));
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('fatal 输出', () => {
      logger.fatal('test', 'fatal message', new Error('fatal'));
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  // ==================== child logger ====================

  describe('child() 子 logger', () => {
    it('子 logger 绑定模块名', () => {
      const child = logger.child('my-module');
      child.info('hello');
      expect(consoleSpy).toHaveBeenCalled();
      const call = consoleSpy.mock.calls[0];
      expect(call[0]).toContain('my-module');
    });
  });

  // ==================== 性能计时 ====================

  describe('startTimer() 性能计时', () => {
    it('返回计时结束函数', () => {
      const end = logger.startTimer('test-op');
      // 模拟一些工作
      const duration = end();
      expect(duration).toBeGreaterThanOrEqual(0);
      expect(typeof duration).toBe('number');
    });

    it('计时结果为正整数', () => {
      const end = logger.startTimer('test');
      const duration = end();
      expect(duration).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(duration)).toBe(true);
    });
  });

  // ==================== LogLevel 枚举 ====================

  describe('LogLevel 枚举', () => {
    it('有 5 个级别', () => {
      expect(LogLevel.DEBUG).toBe(0);
      expect(LogLevel.INFO).toBe(1);
      expect(LogLevel.WARN).toBe(2);
      expect(LogLevel.ERROR).toBe(3);
      expect(LogLevel.FATAL).toBe(4);
    });
  });
});
