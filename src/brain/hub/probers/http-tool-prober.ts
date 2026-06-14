/**
 * HTTPToolProber — HTTP 自定义工具探测器
 *
 * 探测 HTTP 端点是否可达、响应是否有效。
 */

import type { ResourceProber, UnifiedResource, CapabilitySnapshot } from '../types.js';

export class HTTPToolProber implements ResourceProber {
  resourceType = 'tool' as const;
  probeIntervalMs = 15 * 60 * 1000; // 15 分钟
  probeTimeoutMs = 5_000;

  async probe(resource: UnifiedResource): Promise<CapabilitySnapshot> {
    const endpoint = resource.metadata.endpoint as string;
    const method = (resource.metadata.method as string) ?? 'POST';
    const headers = (resource.metadata.headers as Record<string, string>) ?? {};
    const timeoutMs = (resource.metadata.timeoutMs as number) ?? this.probeTimeoutMs;

    if (!endpoint) {
      return {
        timestamp: Date.now(),
        source: 'probe',
        capabilities: {},
        confidence: 0,
        latencyMs: 0,
        error: '缺少 endpoint 元数据',
      };
    }

    const caps: CapabilitySnapshot['capabilities'] = {};
    const start = Date.now();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      // 对于 GET 方法直接探测；POST 只检查连通性（不发送实际请求体）
      const resp = await fetch(endpoint, {
        method: method === 'GET' ? 'GET' : 'HEAD',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timer);

      caps.reachable = { value: resp.ok || resp.status < 500, verified: true, lastVerifiedAt: Date.now() };
      caps.responseValid = { value: resp.ok, verified: true, lastVerifiedAt: Date.now() };

      if (!resp.ok) {
        return {
          timestamp: Date.now(),
          source: 'probe',
          capabilities: caps,
          confidence: 1,
          latencyMs: Date.now() - start,
          error: `HTTP ${resp.status}`,
        };
      }
    } catch (e: any) {
      caps.reachable = { value: false, verified: true, lastVerifiedAt: Date.now() };
      return {
        timestamp: Date.now(),
        source: 'probe',
        capabilities: caps,
        confidence: 1,
        latencyMs: Date.now() - start,
        error: e.message,
      };
    }

    return {
      timestamp: Date.now(),
      source: 'probe',
      capabilities: caps,
      confidence: 1,
      latencyMs: Date.now() - start,
    };
  }
}
