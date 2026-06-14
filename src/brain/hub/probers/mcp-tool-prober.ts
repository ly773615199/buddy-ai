/**
 * MCPToolProber — MCP 工具探测器
 *
 * 检测 MCP Server 是否可达、工具列表是否可用、schema 是否有效。
 */

import type { ResourceProber, UnifiedResource, CapabilitySnapshot } from '../types.js';

export class MCPToolProber implements ResourceProber {
  resourceType = 'tool' as const;
  probeIntervalMs = 30 * 60 * 1000; // 30 分钟
  probeTimeoutMs = 5_000;

  async probe(resource: UnifiedResource): Promise<CapabilitySnapshot> {
    const caps: CapabilitySnapshot['capabilities'] = {};
    const serverName = resource.metadata.serverName as string;
    const connected = resource.metadata.connected as boolean;
    const toolCount = resource.metadata.toolCount as number ?? 0;

    // 如果有连接状态信息，直接使用
    if (typeof connected === 'boolean') {
      caps.reachable = { value: connected, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
    }

    // 检查工具数量
    caps.toolCount = { value: toolCount, verified: false, lastVerifiedAt: Date.now(), sourcePriority: 1 };

    // 尝试通过 MCPAdapter 查询状态
    try {
      const adapter = resource.metadata.adapter as any;
      if (adapter && typeof adapter.listTools === 'function') {
        const tools = adapter.listTools();
        caps.reachable = { value: true, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
        caps.toolCount = { value: tools.length, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
        caps.schemaValid = { value: tools.every((t: any) => t.name && t.description), verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
      }
    } catch (e: any) {
      caps.reachable = { value: false, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
      return {
        timestamp: Date.now(),
        source: 'probe',
        capabilities: caps,
        confidence: 1,
        latencyMs: 0,
        error: e.message,
      };
    }

    return {
      timestamp: Date.now(),
      source: 'probe',
      capabilities: caps,
      confidence: 0.8,
      latencyMs: 0,
    };
  }
}
