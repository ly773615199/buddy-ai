/**
 * TTSProber — TTS 语音服务探测器
 *
 * 探测 TTS 服务是否可达、音色是否可用。
 */

import type { ResourceProber, UnifiedResource, CapabilitySnapshot } from '../types.js';

export class TTSProber implements ResourceProber {
  resourceType = 'tts' as const;
  probeIntervalMs = 60 * 60 * 1000; // 1 小时
  probeTimeoutMs = 10_000;

  async probe(resource: UnifiedResource): Promise<CapabilitySnapshot> {
    const backend = resource.metadata.backend as string; // 'edge' | 'openai' | 'disabled'
    const caps: CapabilitySnapshot['capabilities'] = {};

    if (backend === 'disabled') {
      caps.reachable = { value: false, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
      return {
        timestamp: Date.now(),
        source: 'probe',
        capabilities: caps,
        confidence: 1,
        latencyMs: 0,
      };
    }

    if (backend === 'edge') {
      // Edge TTS：检查 edge-tts 命令是否可用
      try {
        const { execSync } = await import('child_process');
        execSync('edge-tts --list-voices', { timeout: 5000, stdio: 'pipe' });
        caps.reachable = { value: true, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
        caps.serviceAlive = { value: true, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
      } catch {
        caps.reachable = { value: false, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
      }
    }

    if (backend === 'openai') {
      // OpenAI TTS：检查 API Key 和端点
      const apiKey = resource.metadata.openaiApiKey as string;
      const baseUrl = resource.metadata.baseUrl as string ?? 'https://api.openai.com/v1';

      if (apiKey) {
        try {
          const resp = await fetch(`${baseUrl}/models`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(this.probeTimeoutMs),
          });
          caps.reachable = { value: resp.ok, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
          caps.tokenValid = { value: resp.ok, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
        } catch {
          caps.reachable = { value: false, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
        }
      } else {
        caps.reachable = { value: false, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
        caps.tokenValid = { value: false, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 1 };
      }
    }

    return {
      timestamp: Date.now(),
      source: 'probe',
      capabilities: caps,
      confidence: 0.9,
      latencyMs: 0,
    };
  }
}
