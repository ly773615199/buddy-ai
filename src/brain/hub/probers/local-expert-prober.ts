/**
 * LocalExpertProber — 本地专家（三进制模型）探测器
 *
 * 探测本地专家是否能正常推理。
 */

import type { ResourceProber, UnifiedResource, CapabilitySnapshot } from '../types.js';

export class LocalExpertProber implements ResourceProber {
  resourceType = 'local_expert' as const;
  probeIntervalMs = 60 * 60 * 1000; // 1 小时
  probeTimeoutMs = 15_000;

  async probe(resource: UnifiedResource): Promise<CapabilitySnapshot> {
    const domain = resource.metadata.domain as string;
    const caps: CapabilitySnapshot['capabilities'] = {};

    // 检查三进制模型文件是否存在
    const modelPath = resource.metadata.modelPath as string;
    if (modelPath) {
      try {
        const fs = await import('fs/promises');
        await fs.access(modelPath);
        caps.reachable = { value: true, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
      } catch {
        caps.reachable = { value: false, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
        return {
          timestamp: Date.now(),
          source: 'probe',
          capabilities: caps,
          confidence: 1,
          latencyMs: 0,
          error: `模型文件不存在: ${modelPath}`,
        };
      }
    }

    // 尝试推理测试
    try {
      const router = resource.metadata.router as any;
      if (router && typeof router.infer === 'function') {
        const start = Date.now();
        const result = await router.infer(domain, 'test input');
        caps.inferenceWorking = { value: !!result, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
        caps.latencyMs = { value: Date.now() - start, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
      }
    } catch {
      caps.inferenceWorking = { value: false, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
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
