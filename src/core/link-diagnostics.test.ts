import { describe, it, expect, beforeEach } from 'vitest';
import { LinkDiagnostics } from './link-diagnostics.js';

describe('LinkDiagnostics 通信层自诊断', () => {
  let diag: LinkDiagnostics;

  beforeEach(() => {
    diag = new LinkDiagnostics();
  });

  // ==================== 基础记录 ====================

  describe('基础指标记录', () => {
    it('recordConnect 增加重连计数', () => {
      diag.recordConnect();
      diag.recordConnect();
      const m = diag.getMetrics();
      expect(m.reconnectCount).toBe(2);
      expect(m.connectTime).toBeGreaterThan(0);
    });

    it('recordDisconnect 增加断连计数', () => {
      diag.recordDisconnect();
      diag.recordDisconnect();
      diag.recordDisconnect();
      const m = diag.getMetrics();
      expect(m.disconnectCount).toBe(3);
      expect(m.lastDisconnect).toBeGreaterThan(0);
    });

    it('recordMessage 增加消息计数', () => {
      diag.recordMessage();
      diag.recordMessage();
      expect(diag.getMetrics().messageCount).toBe(2);
    });

    it('recordError 记录错误', () => {
      diag.recordError('timeout');
      diag.recordError('network');
      const m = diag.getMetrics();
      expect(m.errorCount).toBe(2);
      expect(m.lastError).toBe('network');
      expect(m.lastErrorTime).toBeGreaterThan(0);
    });
  });

  // ==================== 延迟追踪 ====================

  describe('延迟追踪', () => {
    it('recordLatency 计算平均和最大延迟', () => {
      diag.recordLatency(100);
      diag.recordLatency(200);
      diag.recordLatency(300);
      const m = diag.getMetrics();
      expect(m.avgLatency).toBe(200);
      expect(m.maxLatency).toBe(300);
    });

    it('延迟历史不超过 maxHistory', () => {
      for (let i = 0; i < 150; i++) {
        diag.recordLatency(i);
      }
      const m = diag.getMetrics();
      expect(m.latencyHistory.length).toBeLessThanOrEqual(100);
      // 最早的被丢弃
      expect(m.latencyHistory[0]).toBe(50);
    });
  });

  // ==================== 诊断 ====================

  describe('diagnose() 诊断逻辑', () => {
    it('正常状态返回 healthy', () => {
      const results = diag.diagnose();
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('healthy');
      expect(results[0].component).toBe('overall');
    });

    it('频繁断连返回 critical', () => {
      // 模拟频繁断连
      for (let i = 0; i < 6; i++) {
        diag.recordDisconnect();
      }
      // 最近一次断连在 1 分钟内（默认 now）
      const results = diag.diagnose();
      const conn = results.find(r => r.component === 'connection');
      expect(conn).toBeDefined();
      expect(conn!.status).toBe('critical');
      expect(conn!.suggestion).toContain('网络');
    });

    it('高延迟返回 warning', () => {
      // 记录高延迟
      for (let i = 0; i < 10; i++) {
        diag.recordLatency(3000);
      }
      const results = diag.diagnose();
      const latency = results.find(r => r.component === 'latency');
      expect(latency).toBeDefined();
      expect(latency!.status).toBe('warning');
    });

    it('高错误率返回 critical', () => {
      // 10 条消息 5 个错误 = 50% 错误率
      for (let i = 0; i < 10; i++) diag.recordMessage();
      for (let i = 0; i < 5; i++) diag.recordError('err');
      const results = diag.diagnose();
      const errRate = results.find(r => r.component === 'error_rate');
      expect(errRate).toBeDefined();
      expect(errRate!.status).toBe('critical');
    });

    it('延迟持续增长返回 warning', () => {
      // 20+ 条记录，后 10 条比前 10 条高 50%+，且 recentAvg > 500
      for (let i = 0; i < 10; i++) diag.recordLatency(200);
      for (let i = 0; i < 10; i++) diag.recordLatency(600);
      const results = diag.diagnose();
      const trend = results.find(r => r.component === 'latency_trend');
      expect(trend).toBeDefined();
      expect(trend!.status).toBe('warning');
    });
  });

  // ==================== 重置 ====================

  describe('reset()', () => {
    it('清空所有指标', () => {
      diag.recordConnect();
      diag.recordDisconnect();
      diag.recordMessage();
      diag.recordError('test');
      diag.recordLatency(100);
      diag.reset();
      const m = diag.getMetrics();
      expect(m.connectTime).toBe(0);
      expect(m.disconnectCount).toBe(0);
      expect(m.messageCount).toBe(0);
      expect(m.errorCount).toBe(0);
      expect(m.avgLatency).toBe(0);
      expect(m.latencyHistory).toHaveLength(0);
    });
  });
});
