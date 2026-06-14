/**
 * PlatformProber — 平台适配器探测器
 *
 * 探测平台 token 有效性、webhook 存活、消息可达性。
 */

import type { ResourceProber, UnifiedResource, CapabilitySnapshot } from '../types.js';

export class PlatformProber implements ResourceProber {
  resourceType = 'platform' as const;
  probeIntervalMs = 30 * 60 * 1000; // 30 分钟
  probeTimeoutMs = 10_000;

  async probe(resource: UnifiedResource): Promise<CapabilitySnapshot> {
    const platform = resource.metadata.platform as string; // 'telegram' | 'discord' | 'feishu' | ...
    const caps: CapabilitySnapshot['capabilities'] = {};

    // 基本配置完整性检查
    const hasConfig = !!(resource.metadata.enabled);
    caps.reachable = { value: hasConfig, verified: false, lastVerifiedAt: Date.now(), sourcePriority: 1 };

    // 平台特定探测
    switch (platform) {
      case 'telegram': {
        const token = resource.metadata.token as string;
        if (token) {
          try {
            const resp = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
              signal: AbortSignal.timeout(this.probeTimeoutMs),
            });
            const data = await resp.json() as any;
            caps.tokenValid = { value: data.ok === true, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
            caps.reachable = { value: data.ok === true, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
          } catch {
            caps.tokenValid = { value: false, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
            caps.reachable = { value: false, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
          }
        }
        break;
      }
      case 'discord': {
        const token = resource.metadata.token as string;
        if (token) {
          try {
            const resp = await fetch('https://discord.com/api/v10/users/@me', {
              headers: { Authorization: `Bot ${token}` },
              signal: AbortSignal.timeout(this.probeTimeoutMs),
            });
            caps.tokenValid = { value: resp.ok, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
            caps.reachable = { value: resp.ok, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
          } catch {
            caps.tokenValid = { value: false, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
          }
        }
        break;
      }
      default:
        // 未知平台：只做配置检查
        caps.tokenValid = { value: hasConfig, verified: false, lastVerifiedAt: Date.now(), sourcePriority: 1 };
    }

    return {
      timestamp: Date.now(),
      source: 'probe',
      capabilities: caps,
      confidence: caps.tokenValid?.verified ? 1 : 0.5,
      latencyMs: 0,
    };
  }
}
