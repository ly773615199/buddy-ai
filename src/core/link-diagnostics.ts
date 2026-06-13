/**
 * 通信层自诊断系统
 * 
 * 功能：
 * - 连接质量监控（延迟、丢包、重连频率）
 * - 自动诊断（检测常见问题并给出建议）
 * - 自修复建议（根据诊断结果给出修复建议）
 */

import { EventEmitter } from 'events';

interface ConnectionMetrics {
  connectTime: number;
  disconnectCount: number;
  lastDisconnect: number;
  reconnectCount: number;
  avgLatency: number;
  maxLatency: number;
  messageCount: number;
  errorCount: number;
  lastError?: string;
  lastErrorTime?: number;
}

interface DiagnosticResult {
  component: string;
  status: 'healthy' | 'warning' | 'critical';
  message: string;
  suggestion?: string;
}

export class LinkDiagnostics extends EventEmitter {
  private metrics: ConnectionMetrics = {
    connectTime: 0,
    disconnectCount: 0,
    lastDisconnect: 0,
    reconnectCount: 0,
    avgLatency: 0,
    maxLatency: 0,
    messageCount: 0,
    errorCount: 0,
  };
  
  private latencyHistory: number[] = [];
  private readonly maxHistory = 100;
  private readonly disconnectThresholdMs = 60000; // 1 分钟内多次断连为异常

  recordConnect(): void {
    this.metrics.connectTime = Date.now();
    this.metrics.reconnectCount++;
  }

  recordDisconnect(): void {
    this.metrics.disconnectCount++;
    this.metrics.lastDisconnect = Date.now();
  }

  recordLatency(ms: number): void {
    this.latencyHistory.push(ms);
    if (this.latencyHistory.length > this.maxHistory) {
      this.latencyHistory.shift();
    }
    this.metrics.avgLatency = Math.round(
      this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length
    );
    this.metrics.maxLatency = Math.max(this.metrics.maxLatency, ms);
  }

  recordMessage(): void {
    this.metrics.messageCount++;
  }

  recordError(error: string): void {
    this.metrics.errorCount++;
    this.metrics.lastError = error;
    this.metrics.lastErrorTime = Date.now();
  }

  /** 运行诊断 */
  diagnose(): DiagnosticResult[] {
    const results: DiagnosticResult[] = [];
    const now = Date.now();

    // 频繁断连检测
    if (this.metrics.disconnectCount > 5 && 
        now - this.metrics.lastDisconnect < this.disconnectThresholdMs) {
      results.push({
        component: 'connection',
        status: 'critical',
        message: `频繁断连: ${this.metrics.disconnectCount} 次`,
        suggestion: '检查网络稳定性，或降低心跳频率',
      });
    }

    // 高延迟检测
    if (this.metrics.avgLatency > 2000) {
      results.push({
        component: 'latency',
        status: 'warning',
        message: `平均延迟过高: ${this.metrics.avgLatency}ms`,
        suggestion: '考虑使用就近节点或降低消息频率',
      });
    }

    // 错误率检测
    const errorRate = this.metrics.messageCount > 0 
      ? this.metrics.errorCount / this.metrics.messageCount 
      : 0;
    if (errorRate > 0.1) {
      results.push({
        component: 'error_rate',
        status: 'critical',
        message: `错误率过高: ${(errorRate * 100).toFixed(1)}%`,
        suggestion: '检查 API Key 有效性和模型可用性',
      });
    }

    // 内存泄漏检测（延迟持续增长）
    if (this.latencyHistory.length >= 20) {
      const recent = this.latencyHistory.slice(-10);
      const older = this.latencyHistory.slice(-20, -10);
      const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
      if (recentAvg > olderAvg * 1.5 && recentAvg > 500) {
        results.push({
          component: 'latency_trend',
          status: 'warning',
          message: `延迟持续增长: ${Math.round(olderAvg)}ms → ${Math.round(recentAvg)}ms`,
          suggestion: '可能存在内存泄漏，建议重启服务',
        });
      }
    }

    // 如果一切正常
    if (results.length === 0) {
      results.push({
        component: 'overall',
        status: 'healthy',
        message: '通信层运行正常',
      });
    }

    return results;
  }

  /** 获取指标快照 */
  getMetrics(): ConnectionMetrics & { latencyHistory: number[] } {
    return { ...this.metrics, latencyHistory: [...this.latencyHistory] };
  }

  /** 重置指标 */
  reset(): void {
    this.metrics = {
      connectTime: 0,
      disconnectCount: 0,
      lastDisconnect: 0,
      reconnectCount: 0,
      avgLatency: 0,
      maxLatency: 0,
      messageCount: 0,
      errorCount: 0,
    };
    this.latencyHistory = [];
  }
}
