/**
 * ModelKnowledgeUpdater — 后台模型知识自动更新器
 *
 * 定期从各平台 API 拉取最新模型列表和定价，持久化到本地。
 * 下次冷启动时直接加载，无需等待 API 响应。
 *
 * 优先级链：运行时学习 > 平台 API > 本地缓存 > 静态知识表
 */

import {
  discoverAll, clearDiscoveryCache,
  type PlatformConfig, type DiscoveryResult,
} from './model-discovery.js';
import type { ModelProfile } from './model-pool.js';
import * as fs from 'fs';
import * as path from 'path';

// ==================== 配置 ====================

export interface UpdaterConfig {
  /** 刷新间隔（毫秒），默认 30 分钟 */
  refreshIntervalMs: number;
  /** 是否在启动时立即刷新 */
  refreshOnStart: boolean;
  /** 最大重试次数 */
  maxRetries: number;
  /** 是否启用 */
  enabled: boolean;
}

const DEFAULT_CONFIG: UpdaterConfig = {
  refreshIntervalMs: 30 * 60 * 1000, // 30 分钟
  refreshOnStart: true,
  maxRetries: 2,
  enabled: true,
};

// ==================== 持久化数据 ====================

interface PersistedKnowledge {
  /** 模型画像（按 id 索引） */
  profiles: Record<string, ModelProfile>;
  /** 各平台最后成功刷新时间 */
  lastRefresh: Record<string, number>;
  /** 整体最后刷新时间 */
  lastFullRefresh: number;
  /** 刷新次数 */
  refreshCount: number;
  /** 各平台最后错误 */
  lastErrors: Record<string, string>;
}

// ==================== ModelKnowledgeUpdater ====================

export class ModelKnowledgeUpdater {
  private config: UpdaterConfig;
  private dataFile: string;
  private persisted: PersistedKnowledge;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRefreshing = false;

  /** 外部回调：刷新完成后通知调用方 */
  private onRefreshComplete: ((profiles: Map<string, ModelProfile>) => void) | null = null;

  constructor(dataDir: string, config?: Partial<UpdaterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.dataFile = path.join(dataDir, 'model-knowledge-cache.json');
    this.persisted = this.loadPersisted();
  }

  // ==================== 生命周期 ====================

  /**
   * 启动后台更新器
   * @param providers 平台配置列表
   */
  start(providers: PlatformConfig[]): void {
    if (!this.config.enabled) {
      console.log('[KnowledgeUpdater] 已禁用，跳过');
      return;
    }

    // 立即刷新一次（异步，不阻塞启动）
    if (this.config.refreshOnStart) {
      this.refresh(providers).catch((err) => {
        console.warn('[KnowledgeUpdater] 启动刷新失败:', (err as Error).message);
      });
    }

    // 定时刷新
    this.timer = setInterval(() => {
      this.refresh(providers).catch((err) => {
        console.warn('[KnowledgeUpdater] 定时刷新失败:', (err as Error).message);
      });
    }, this.config.refreshIntervalMs);

    console.log(`[KnowledgeUpdater] 已启动，间隔 ${this.config.refreshIntervalMs / 60000} 分钟`);
  }

  /**
   * 停止后台更新器
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[KnowledgeUpdater] 已停止');
  }

  /**
   * 设置刷新完成回调
   */
  setOnRefreshComplete(cb: (profiles: Map<string, ModelProfile>) => void): void {
    this.onRefreshComplete = cb;
  }

  // ==================== 刷新逻辑 ====================

  /**
   * 从所有平台刷新模型数据
   */
  async refresh(providers: PlatformConfig[]): Promise<void> {
    if (this.isRefreshing) {
      console.log('[KnowledgeUpdater] 刷新中，跳过');
      return;
    }

    this.isRefreshing = true;
    const startTime = Date.now();

    try {
      console.log(`[KnowledgeUpdater] 开始刷新 ${providers.length} 个平台...`);

      const results = await discoverAll(providers);

      let newModels = 0;
      let updatedModels = 0;
      let totalModels = 0;

      for (const result of results) {
        if (result.error) {
          this.persisted.lastErrors[result.platform] = result.error;
          console.warn(`[KnowledgeUpdater] ${result.platform} 失败: ${result.error}`);
          continue;
        }

        // 清除该平台旧错误
        delete this.persisted.lastErrors[result.platform];
        this.persisted.lastRefresh[result.platform] = Date.now();

        for (const profile of result.models) {
          totalModels++;
          const existing = this.persisted.profiles[profile.id];

          if (!existing) {
            newModels++;
          } else if (this.hasChanged(existing, profile)) {
            updatedModels++;
          }

          // 合并：API 数据 + 运行时统计
          this.persisted.profiles[profile.id] = this.mergeProfile(existing, profile);
        }
      }

      this.persisted.lastFullRefresh = Date.now();
      this.persisted.refreshCount++;

      // 持久化
      this.savePersisted();

      const elapsed = Date.now() - startTime;
      console.log(
        `[KnowledgeUpdater] 刷新完成: ${totalModels} 模型, ` +
        `+${newModels} 新增, ~${updatedModels} 更新, ` +
        `耗时 ${elapsed}ms`,
      );

      // 通知回调
      if (this.onRefreshComplete) {
        const profileMap = new Map(
          Object.entries(this.persisted.profiles),
        );
        this.onRefreshComplete(profileMap);
      }
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * 手动触发单个平台刷新
   */
  async refreshPlatform(config: PlatformConfig): Promise<DiscoveryResult> {
    const { discoverModels, clearPlatformCache } = await import('./model-discovery.js');
    clearPlatformCache(config.id);

    const result = await discoverModels(config);

    if (!result.error) {
      this.persisted.lastRefresh[config.id] = Date.now();
      delete this.persisted.lastErrors[config.id];

      for (const profile of result.models) {
        const existing = this.persisted.profiles[profile.id];
        this.persisted.profiles[profile.id] = this.mergeProfile(existing, profile);
      }

      this.savePersisted();
    }

    return result;
  }

  // ==================== 查询接口 ====================

  /**
   * 获取已缓存的所有模型画像
   */
  getAllProfiles(): ModelProfile[] {
    return Object.values(this.persisted.profiles);
  }

  /**
   * 获取指定模型的缓存画像
   */
  getProfile(id: string): ModelProfile | null {
    return this.persisted.profiles[id] ?? null;
  }

  /**
   * 获取平台刷新状态
   */
  getStatus(): {
    lastFullRefresh: number;
    refreshCount: number;
    platformStatus: Array<{
      platform: string;
      lastRefresh: number;
      modelCount: number;
      error?: string;
    }>;
    totalCachedModels: number;
  } {
    const platformStatus: Array<{
      platform: string;
      lastRefresh: number;
      modelCount: number;
      error?: string;
    }> = [];

    const platforms = new Set<string>();
    for (const profile of Object.values(this.persisted.profiles)) {
      platforms.add(profile.platform);
    }

    for (const platform of platforms) {
      const models = Object.values(this.persisted.profiles)
        .filter((p) => p.platform === platform);
      platformStatus.push({
        platform,
        lastRefresh: this.persisted.lastRefresh[platform] ?? 0,
        modelCount: models.length,
        error: this.persisted.lastErrors[platform],
      });
    }

    return {
      lastFullRefresh: this.persisted.lastFullRefresh,
      refreshCount: this.persisted.refreshCount,
      platformStatus,
      totalCachedModels: Object.keys(this.persisted.profiles).length,
    };
  }

  /**
   * 获取本地缓存的最后刷新时间
   */
  getLastRefreshTime(): number {
    return this.persisted.lastFullRefresh;
  }

  /**
   * 缓存是否过期
   */
  isStale(maxAgeMs?: number): boolean {
    const age = maxAgeMs ?? this.config.refreshIntervalMs * 2;
    return Date.now() - this.persisted.lastFullRefresh > age;
  }

  // ==================== 合并策略 ====================

  /**
   * 合并新旧画像
   * - API 数据覆盖静态知识的定价和上下文长度
   * - 运行时统计保留（不被 API 数据覆盖）
   * - 能力评分：API > 静态知识（但运行时学习的修正另计）
   */
  private mergeProfile(
    existing: ModelProfile | undefined,
    incoming: ModelProfile,
  ): ModelProfile {
    if (!existing) return incoming;

    return {
      ...incoming,
      // 保留运行时统计
      stats: existing.stats.totalCalls > 0 ? existing.stats : incoming.stats,
      // 如果 API 没有定价数据，保留旧数据
      costPer1kInput: incoming.costPer1kInput > 0
        ? incoming.costPer1kInput
        : existing.costPer1kInput,
      costPer1kOutput: incoming.costPer1kOutput > 0
        ? incoming.costPer1kOutput
        : existing.costPer1kOutput,
      // 如果 API 没有上下文长度，保留旧数据
      maxContextTokens: incoming.maxContextTokens > 4096
        ? incoming.maxContextTokens
        : existing.maxContextTokens,
      maxOutputTokens: incoming.maxOutputTokens > 4096
        ? incoming.maxOutputTokens
        : existing.maxOutputTokens,
      // enrichment 字段：优先用新数据，fallback 到旧数据
      category: incoming.category ?? existing.category,
      parameters: incoming.parameters ?? existing.parameters,
      contextLength: incoming.contextLength ?? existing.contextLength,
      realMaxOutput: incoming.realMaxOutput ?? existing.realMaxOutput,
      modelType: incoming.modelType ?? existing.modelType,
      license: incoming.license ?? existing.license,
      pipelineTag: incoming.pipelineTag ?? existing.pipelineTag,
      hfId: incoming.hfId ?? existing.hfId,
      enrichmentSource: incoming.enrichmentSource ?? existing.enrichmentSource,
      // 更新时间戳
      discoveredAt: Date.now(),
    };
  }

  /**
   * 检查画像是否有实质性变化
   */
  private hasChanged(existing: ModelProfile, incoming: ModelProfile): boolean {
    return (
      existing.costPer1kInput !== incoming.costPer1kInput ||
      existing.costPer1kOutput !== incoming.costPer1kOutput ||
      existing.maxContextTokens !== incoming.maxContextTokens ||
      existing.maxOutputTokens !== incoming.maxOutputTokens ||
      existing.tier !== incoming.tier ||
      existing.capabilities.reasoning !== incoming.capabilities.reasoning ||
      existing.capabilities.code !== incoming.capabilities.code
    );
  }

  // ==================== 持久化 ====================

  private savePersisted(): void {
    try {
      const dir = path.dirname(this.dataFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.dataFile, JSON.stringify(this.persisted, null, 2));
    } catch {
      // 持久化失败不影响运行
    }
  }

  private loadPersisted(): PersistedKnowledge {
    try {
      if (fs.existsSync(this.dataFile)) {
        const raw = JSON.parse(fs.readFileSync(this.dataFile, 'utf-8'));
        return {
          profiles: raw.profiles ?? {},
          lastRefresh: raw.lastRefresh ?? {},
          lastFullRefresh: raw.lastFullRefresh ?? 0,
          refreshCount: raw.refreshCount ?? 0,
          lastErrors: raw.lastErrors ?? {},
        };
      }
    } catch {
      // 加载失败不影响运行
    }
    return {
      profiles: {},
      lastRefresh: {},
      lastFullRefresh: 0,
      refreshCount: 0,
      lastErrors: {},
    };
  }
}
