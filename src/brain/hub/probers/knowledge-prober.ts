/**
 * KnowledgeSourceProber — 知识源探测器
 *
 * 探测知识源是否可达、数据是否新鲜。
 */

import type { ResourceProber, UnifiedResource, CapabilitySnapshot } from '../types.js';

export class KnowledgeSourceProber implements ResourceProber {
  resourceType = 'knowledge_source' as const;
  probeIntervalMs = 60 * 60 * 1000; // 1 小时
  probeTimeoutMs = 10_000;

  async probe(resource: UnifiedResource): Promise<CapabilitySnapshot> {
    const sourceType = resource.metadata.sourceType as string; // 'local' | 'web' | 'feishu'
    const caps: CapabilitySnapshot['capabilities'] = {};

    switch (sourceType) {
      case 'local': {
        // 本地知识源：检查 watchFolders 是否存在
        const folders = resource.metadata.watchFolders as string[] ?? [];
        const fs = await import('fs/promises');
        let accessible = 0;
        for (const folder of folders) {
          try {
            await fs.access(folder);
            accessible++;
          } catch { /* 不可达 */ }
        }
        caps.reachable = { value: accessible > 0, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
        caps.dataFresh = { value: true, verified: false, lastVerifiedAt: Date.now(), sourcePriority: 1 };
        break;
      }
      case 'web': {
        // 网络搜索源：发送测试查询
        const searchUrl = resource.metadata.searchUrl as string;
        if (searchUrl) {
          try {
            const resp = await fetch(searchUrl, { method: 'HEAD', signal: AbortSignal.timeout(this.probeTimeoutMs) });
            caps.reachable = { value: resp.ok, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
          } catch {
            caps.reachable = { value: false, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
          }
        }
        break;
      }
      case 'feishu': {
        // 飞书知识源：检查 token 有效性
        const appId = resource.metadata.appId as string;
        const appSecret = resource.metadata.appSecret as string;
        caps.reachable = { value: !!(appId && appSecret), verified: false, lastVerifiedAt: Date.now(), sourcePriority: 1 };
        caps.tokenValid = { value: true, verified: false, lastVerifiedAt: Date.now(), sourcePriority: 1 };
        break;
      }
    }

    return {
      timestamp: Date.now(),
      source: 'probe',
      capabilities: caps,
      confidence: 0.7,
      latencyMs: 0,
    };
  }
}
