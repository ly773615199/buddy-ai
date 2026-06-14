/**
 * ModelProber — LLM 模型能力探测器
 *
 * 扩展已有的 CapabilityProber，新增 vision / streaming / embedding 探测。
 * 探测结果统一为 CapabilitySnapshot 格式。
 */

import type { ResourceProber, UnifiedResource, CapabilitySnapshot } from '../types.js';

/** 探测配置 */
export interface ModelProberConfig {
  timeoutMs: number;
  /** 是否探测 vision 能力 */
  probeVision: boolean;
  /** 是否探测 embedding 能力 */
  probeEmbedding: boolean;
}

const DEFAULT_CONFIG: ModelProberConfig = {
  timeoutMs: 10_000,
  probeVision: true,
  probeEmbedding: true,
};

export class ModelProber implements ResourceProber {
  resourceType = 'model' as const;
  probeIntervalMs = 7 * 24 * 60 * 60 * 1000; // 7 天
  probeTimeoutMs = 10_000;

  private config: ModelProberConfig;

  constructor(config?: Partial<ModelProberConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.probeTimeoutMs = this.config.timeoutMs;
  }

  async probe(resource: UnifiedResource): Promise<CapabilitySnapshot> {
    const caps: CapabilitySnapshot['capabilities'] = {};
    const errors: string[] = [];
    let latencyMs = 0;

    // 从 metadata 获取 provider 信息
    const provider = resource.metadata.provider as string;
    const model = resource.metadata.model as string;
    const apiKey = resource.metadata.apiKey as string | undefined;
    const baseUrl = resource.metadata.baseUrl as string | undefined;

    if (!provider || !model) {
      return {
        timestamp: Date.now(),
        source: 'probe',
        capabilities: {},
        confidence: 0,
        latencyMs: 0,
        error: '缺少 provider/model 元数据',
      };
    }

    try {
      // 动态导入避免循环依赖
      const { ProviderFactory } = await import('../../../core/provider-registry.js');

      const start = Date.now();
      const { model: llmModel, capabilities } = await ProviderFactory.create({
        provider, model, apiKey, baseUrl,
      });
      latencyMs = Date.now() - start;

      // 基础连通性 — 用 create 的结果判断
      caps.reachable = { value: true, verified: true, lastVerifiedAt: Date.now() };

      // 从静态能力导入
      caps.toolCalling = { value: capabilities.toolCalling, verified: false, lastVerifiedAt: Date.now() };
      caps.streaming = { value: capabilities.streaming ?? true, verified: false, lastVerifiedAt: Date.now() };
      caps.maxContextTokens = { value: capabilities.maxContextTokens, verified: false, lastVerifiedAt: Date.now() };

      // 探测 tool calling（发送带 tools 的请求验证）
      try {
        const { generateText, tool, stepCountIs } = await import('ai');
        const { z } = await import('zod');

        await this.withTimeout(
          generateText({
            model: llmModel,
            messages: [{ role: 'user', content: 'What is 1+1?' }],
            tools: {
              calculator: tool({
                description: 'A calculator',
                inputSchema: z.object({ expression: z.string() }),
                execute: async () => '2',
              }),
            },
            stopWhen: stepCountIs(1),
            maxOutputTokens: 50,
          }),
          this.config.timeoutMs,
        );
        caps.toolCalling = { value: true, verified: true, lastVerifiedAt: Date.now() };
      } catch {
        // tool calling 不支持 — 标记为已验证的 false
        caps.toolCalling = { value: false, verified: true, lastVerifiedAt: Date.now() };
      }

      // 探测 vision
      if (this.config.probeVision) {
        try {
          const { generateText } = await import('ai');
          const testImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

          await this.withTimeout(
            generateText({
              model: llmModel,
              messages: [{
                role: 'user',
                content: [
                  { type: 'image' as any, image: testImage },
                  { type: 'text' as any, text: 'What color is this?' },
                ],
              }],
              maxOutputTokens: 20,
            }),
            this.config.timeoutMs,
          );
          caps.vision = { value: true, verified: true, lastVerifiedAt: Date.now() };
        } catch {
          caps.vision = { value: false, verified: true, lastVerifiedAt: Date.now() };
        }
      }

      // 探测 embedding
      if (this.config.probeEmbedding && baseUrl) {
        try {
          const resp = await this.withTimeout(
            fetch(`${baseUrl.replace(/\/$/, '')}/embeddings`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ model, input: 'test' }),
            }),
            this.config.timeoutMs,
          );
          caps.embedding = { value: resp.ok, verified: true, lastVerifiedAt: Date.now() };
        } catch {
          caps.embedding = { value: false, verified: true, lastVerifiedAt: Date.now() };
        }
      }

    } catch (e: any) {
      errors.push(e.message);
      caps.reachable = { value: false, verified: true, lastVerifiedAt: Date.now() };
    }

    return {
      timestamp: Date.now(),
      source: 'probe',
      capabilities: caps,
      confidence: errors.length === 0 ? 1 : 0.5,
      latencyMs,
      error: errors.length > 0 ? errors.join('; ') : undefined,
    };
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`探测超时 (${ms}ms)`)), ms),
      ),
    ]);
  }
}
