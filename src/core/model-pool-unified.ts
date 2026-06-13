/**
 * @deprecated 统一模型池 — 已合并到 ModelPool
 *
 * 此类保留仅为向后兼容。所有功能已迁移到 ModelPool。
 * 新代码应直接使用 ModelPool。
 *
 * MAJ-01 类型 B 修复: 消除所有 any，使用 ModelPool 的真实类型。
 */

import type { PoolNodeConfig, ModelPoolConfig } from '../types.js';
import { ModelPool, type ModelProfile, type UserPoolPreferences, type ModelRequirement, type ModelSelection } from './model-pool.js';
import type { DecisionRecorder } from './decision-recorder.js';
import type { TaskType } from './model-router.js';
import type { CapabilityKey } from './model-knowledge.js';
import type { PlatformConfig, DiscoveryResult } from './model-discovery.js';
import type { UpdaterConfig } from './model-knowledge-updater.js';
import type { ThompsonParams } from './model-pool.js';

// 重新导出类型（向后兼容）
export type { ModelProfile, UserPoolPreferences, ModelRequirement, ModelSelection } from './model-pool.js';
export type { PricingSource } from './model-discovery.js';
export type { UpdaterConfig } from './model-knowledge-updater.js';

/** @deprecated 使用 ModelPool */
export class ModelPoolUnified {
  private pool: ModelPool;

  constructor(dataDir: string, _preferences?: UserPoolPreferences, decisionRecorder?: DecisionRecorder) {
    this.pool = new ModelPool(null, dataDir, decisionRecorder);
  }

  get isInitialized(): boolean {
    return this.pool.isUnifiedInitialized;
  }

  get size(): number {
    return this.pool.profileCount;
  }

  async initialize(providers: PlatformConfig[]): Promise<void> {
    return this.pool.initializeFromProviders(providers);
  }

  initializeFromLegacy(poolConfig: ModelPoolConfig): void {
    return this.pool.initializeFromLegacyConfig(poolConfig);
  }

  select(requirement: ModelRequirement): ModelSelection | null {
    return this.pool.selectFromUnified(requirement);
  }

  recordFeedback(modelId: string, taskType: TaskType, success: boolean, latencyMs: number, costEstimate: number): void {
    return this.pool.recordFeedback(modelId, taskType, success, latencyMs, costEstimate);
  }

  addExclusion(pattern: string): void { this.pool.addExclusion(pattern); }
  removeExclusion(pattern: string): void { this.pool.removeExclusion(pattern); }
  setTaskPreference(taskType: string, prefer: string[], avoid: string[]): void { this.pool.setTaskPreference(taskType, prefer, avoid); }
  updatePreferences(updates: Partial<UserPoolPreferences>): void { this.pool.updatePreferences(updates); }
  getPreferences(): UserPoolPreferences { return this.pool.getPreferences(); }

  getAllProfiles(): ModelProfile[] { return this.pool.getAllProfiles(); }
  getProfile(id: string): ModelProfile | undefined { return this.pool.getProfile(id) ?? undefined; }
  getProfilesByPlatform(platform: string): ModelProfile[] { return this.pool.getProfilesByPlatform(platform); }
  getProfilesByTier(tier: string): ModelProfile[] { return this.pool.getProfilesByTier(tier as 'free' | 'budget' | 'standard' | 'premium'); }
  getThompsonParams(): Record<string, ThompsonParams> { return this.pool.getThompsonParams(); }

  addProfile(profile: ModelProfile): void { this.pool.addProfile(profile); }
  removeProfile(id: string): void { this.pool.removeProfile(id); }
  refreshPlatform(config: PlatformConfig): Promise<DiscoveryResult> { return this.pool.refreshPlatform(config); }
  getUpdater() { return this.pool.getUpdater(); }
  shutdown(): void { this.pool.shutdown(); }
}
