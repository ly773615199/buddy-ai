/**
 * BatchProbeScheduler — 统一探测调度器
 *
 * 调度所有资源的探测，支持：
 * - 并发控制（避免打爆 API）
 * - 优先级排序（degraded > discovered > active 刷新）
 * - 超时保护
 * - 事件驱动探测（失败后立即重试）
 * - 定期全量刷新
 */

import type { ResourceType, UnifiedResource, ResourceProber, CapabilitySnapshot } from './types.js';
import { UnifiedResourceHub } from './unified-resource-hub.js';

export interface SchedulerConfig {
  /** 最大并发探测数 */
  concurrency: number;
  /** 探测间隔（ms） */
  delayBetweenMs: number;
  /** 定期刷新间隔（ms），默认 24 小时 */
  refreshIntervalMs: number;
  /** 是否启用定期刷新 */
  autoRefresh: boolean;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  concurrency: 3,
  delayBetweenMs: 500,
  refreshIntervalMs: 24 * 60 * 60 * 1000,
  autoRefresh: true,
};

export class BatchProbeScheduler {
  private hub: UnifiedResourceHub;
  private probers: Map<ResourceType, ResourceProber>;
  private config: SchedulerConfig;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private probing: Set<string> = new Set(); // 正在探测的资源 ID

  constructor(
    hub: UnifiedResourceHub,
    probers: Map<ResourceType, ResourceProber>,
    config?: Partial<SchedulerConfig>,
  ) {
    this.hub = hub;
    this.probers = probers;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ==================== 生命周期 ====================

  /** 启动定期刷新 */
  start(): void {
    if (!this.config.autoRefresh) return;
    if (this.refreshTimer) return;

    this.refreshTimer = setInterval(() => {
      this.probeAll('periodic').catch(() => {});
    }, this.config.refreshIntervalMs);

    // 首次探测延迟 30 秒
    setTimeout(() => {
      this.probeAll('startup').catch(() => {});
    }, 30_000);
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  // ==================== 调度 ====================

  /**
   * 探测所有资源
   */
  async probeAll(trigger: 'startup' | 'periodic' | 'manual' = 'manual'): Promise<void> {
    const resources = this.hub.getAll();
    const sorted = this.prioritize(resources);

    const batches = this.chunk(sorted, this.config.concurrency);
    for (const batch of batches) {
      await Promise.allSettled(batch.map(r => this.probeOne(r)));
      if (batches.indexOf(batch) < batches.length - 1) {
        await this.sleep(this.config.delayBetweenMs);
      }
    }
  }

  /**
   * 探测单个资源
   */
  async probeOne(resource: UnifiedResource): Promise<CapabilitySnapshot | null> {
    // 防止重复探测
    if (this.probing.has(resource.id)) return null;
    this.probing.add(resource.id);

    try {
      const prober = this.probers.get(resource.type);
      if (!prober) return null;

      const snapshot = await Promise.race([
        prober.probe(resource),
        new Promise<CapabilitySnapshot>((_, reject) =>
          setTimeout(() => reject(new Error('探测超时')), prober.probeTimeoutMs),
        ),
      ]);

      // 将探测结果反馈给 Hub
      this.hub.onProbeResult(resource.id, snapshot);
      return snapshot;
    } catch (e: any) {
      const errorSnapshot: CapabilitySnapshot = {
        timestamp: Date.now(),
        source: 'probe',
        capabilities: {},
        confidence: 0,
        latencyMs: 0,
        error: e.message,
      };
      this.hub.onProbeResult(resource.id, errorSnapshot);
      return null;
    } finally {
      this.probing.delete(resource.id);
    }
  }

  /**
   * 触发单个资源的即时探测（事件驱动）
   */
  async probeImmediate(resourceId: string): Promise<CapabilitySnapshot | null> {
    const resource = this.hub.get(resourceId);
    if (!resource) return null;
    return this.probeOne(resource);
  }

  /**
   * 按类型探测
   */
  async probeByType(type: ResourceType): Promise<void> {
    const resources = this.hub.getActive(type);
    for (const r of resources) {
      await this.probeOne(r);
      await this.sleep(this.config.delayBetweenMs);
    }
  }

  // ==================== 优先级排序 ====================

  /**
   * 优先级：degraded > discovered > active（定期刷新）
   */
  private prioritize(resources: UnifiedResource[]): UnifiedResource[] {
    const priority: Record<string, number> = {
      degraded: 0,
      discovered: 1,
      active: 2,
      deprecated: 3,
      rejected: 4,
      deceased: 5,
    };

    return [...resources].sort((a, b) => {
      const pa = priority[a.state] ?? 99;
      const pb = priority[b.state] ?? 99;
      return pa - pb;
    });
  }

  // ==================== 工具 ====================

  private chunk<T>(arr: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size));
    }
    return result;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
