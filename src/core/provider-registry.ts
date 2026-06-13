/**
 * Provider 注册表 v2
 *
 * 基于 AdapterRegistry + CapabilityProber 的统一 Provider 管理
 *
 * 变更：
 *   - 移除旧的 wrapModelRoleCompat（由 MessagePreprocessor 替代）
 *   - 所有 OpenAI 兼容 provider 使用 systemMessageMode: 'system'
 *   - ProviderFactory 委托给 AdapterRegistry
 *   - 支持运行时能力探测（CapabilityProber）
 */

import type { LanguageModel } from 'ai';
import { adapterRegistry, type ProviderAdapter, type AdapterConfig, type ProviderCapabilities } from './provider-adapter.js';
import { CapabilityProber, type ProbeResult } from './capability-prober.js';
import { lookupModelKnowledge } from './model-knowledge.js';

// ==================== 向后兼容导出 ====================

export type { ProviderCapabilities, ProviderAdapter } from './provider-adapter.js';
export { adapterRegistry } from './provider-adapter.js';
export { getPreprocessor, registerPreprocessor } from './message-preprocessor.js';
export type { InternalMessage, MessagePreprocessor, ProcessedMessage } from './message-preprocessor.js';

// ==================== ProviderDef（向后兼容） ====================

export interface ProviderDef {
  name: string;
  capabilities: ProviderCapabilities;
  createModel: (config: { apiKey: string; baseUrl?: string; model: string }) => LanguageModel | Promise<LanguageModel>;
  detectToolSupport?: (model: string) => boolean;
}

// ==================== 工厂 ====================

export class ProviderFactory {
  private static prober = new CapabilityProber();

  /**
   * 创建 LLM model 实例
   * 委托给 AdapterRegistry，自动处理消息预处理和能力
   */
  static async create(config: {
    provider: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
  }): Promise<{ model: LanguageModel; capabilities: ProviderCapabilities; adapter: ProviderAdapter }> {
    const adapter = adapterRegistry.getOrFallback(config.provider, config.baseUrl);

    // 检查依赖
    const dep = await adapterRegistry.checkDependencies(config.provider);
    if (!dep.ok) {
      throw new Error(dep.install ? `需要安装依赖: ${dep.install}` : `Provider ${config.provider} 不可用`);
    }

    const model = await adapter.createModel({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
    });

    const capabilities = adapter.getStaticCapabilities(config.model);

    // Task 8.2: 从 model-knowledge 查询 contextWindow，覆盖硬编码值
    const knowledge = lookupModelKnowledge(`${config.provider}/${config.model}`);
    if (knowledge?.contextWindow) {
      capabilities.maxContextTokens = knowledge.contextWindow;
    }

    return { model, capabilities, adapter };
  }

  /**
   * 异步创建 — 带能力探测
   * 首次连接新 provider 时自动探测，结果缓存到磁盘
   */
  static async createWithProbe(
    config: { provider: string; model: string; apiKey?: string; baseUrl?: string },
    dataDir?: string,
  ): Promise<{ model: LanguageModel; capabilities: ProviderCapabilities; adapter: ProviderAdapter }> {
    const adapter = adapterRegistry.getOrFallback(config.provider, config.baseUrl);

    const model = await adapter.createModel({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
    });

    // 尝试从缓存获取或重新探测
    let capabilities = adapter.getStaticCapabilities(config.model);
    // Task 8.2: 从 model-knowledge 查询 contextWindow
    const knowledge = lookupModelKnowledge(`${config.provider}/${config.model}`);
    if (knowledge?.contextWindow) {
      capabilities.maxContextTokens = knowledge.contextWindow;
    }
    if (dataDir) {
      try {
        const probed = await this.prober.probeOrCache(model, dataDir, config.provider, config.model);
        capabilities = this.mergeCapabilities(capabilities, probed);
      } catch (e: any) {
        console.warn(`[Provider] 能力探测失败，使用静态标记: ${e.message}`);
      }
    }

    return { model, capabilities, adapter };
  }

  /**
   * 列出所有可用 Provider
   */
  static listProviders(): Array<{ id: string; name: string; capabilities: ProviderCapabilities }> {
    return adapterRegistry.list().map(({ id }) => {
      const adapter = adapterRegistry.get(id)!;
      return {
        id,
        name: adapter.name,
        capabilities: adapter.getStaticCapabilities(),
      };
    });
  }

  /**
   * 检查 Provider 是否需要额外安装
   */
  static async checkDependencies(provider: string): Promise<{ ok: boolean; install?: string }> {
    return adapterRegistry.checkDependencies(provider);
  }

  // ==================== 内部 ====================

  private static mergeCapabilities(
    static_: ProviderCapabilities,
    probed: ProbeResult,
  ): ProviderCapabilities {
    return {
      ...static_,
      // 探测结果优先（如果探测成功的话）
      supportsDeveloperRole: probed.reachable ? probed.supportsDeveloperRole : static_.supportsDeveloperRole,
      toolCalling: probed.reachable ? probed.toolCalling : static_.toolCalling,
    };
  }
}
