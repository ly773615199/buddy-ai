/**
 * 运行时快照收集器 — 在工具执行前后采集 SceneGraph 快照
 *
 * 接入点：agent.ts 的工具执行流程
 *
 * 使用方式：
 *   const collector = new RuntimeCollector(registry);
 *   const before = collector.captureBefore(action);
 *   await executeTool(action);
 *   collector.captureAfter(before, action, result);
 *
 * 收集的样本自动写入训练缓冲区
 */

import {
  EntityRegistry,
  type EntitySnapshot,
} from './entity-registry.js';
import {
  buildRuntimeSample,
  type WorldModelTrainingSample,
} from './scene-training.js';
import type { SceneAction } from './scene-world-model.js';

// ==================== 类型 ====================

export interface RuntimeCollectorConfig {
  /** 最大缓冲样本数 */
  maxBufferSize: number;
  /** 自动刷新阈值（缓冲区满时自动调用回调） */
  autoFlushThreshold: number;
  /** 是否收集失败的执行 */
  collectFailures: boolean;
  /** 最小执行时间 (ms) — 太快的跳过 */
  minExecutionMs: number;
}

const DEFAULT_CONFIG: RuntimeCollectorConfig = {
  maxBufferSize: 200,
  autoFlushThreshold: 100,
  collectFailures: true,
  minExecutionMs: 5,
};

export interface PendingSnapshot {
  snapshot: EntitySnapshot;
  action: SceneAction;
  timestamp: number;
}

export interface ToolExecutionResult {
  success: boolean;
  latencyMs: number;
  error?: string;
  output?: string;
}

export interface CollectedSample {
  sample: WorldModelTrainingSample;
  executionResult: ToolExecutionResult;
}

// ==================== RuntimeCollector ====================

export class RuntimeCollector {
  private registry: EntityRegistry;
  private config: RuntimeCollectorConfig;
  private buffer: CollectedSample[] = [];
  private onFlush?: (samples: CollectedSample[]) => void;
  private stats = {
    captured: 0,
    skipped: 0,
    flushed: 0,
  };

  constructor(
    registry: EntityRegistry,
    config?: Partial<RuntimeCollectorConfig>,
    onFlush?: (samples: CollectedSample[]) => void,
  ) {
    this.registry = registry;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.onFlush = onFlush;
  }

  /**
   * 工具执行前 — 拍快照
   */
  captureBefore(action: SceneAction): PendingSnapshot {
    return {
      snapshot: this.registry.snapshot(),
      action,
      timestamp: Date.now(),
    };
  }

  /**
   * 工具执行后 — 构建训练样本
   */
  captureAfter(
    pending: PendingSnapshot,
    result: ToolExecutionResult,
  ): CollectedSample | null {
    // 跳过太快的执行
    const execMs = Date.now() - pending.timestamp;
    if (execMs < this.config.minExecutionMs) {
      this.stats.skipped++;
      return null;
    }

    // 跳过失败（如果配置不允许）
    if (!result.success && !this.config.collectFailures) {
      this.stats.skipped++;
      return null;
    }

    // 拍摄执行后快照
    const afterSnapshot = this.registry.snapshot();

    // 构建训练样本
    const sample = buildRuntimeSample(
      pending.snapshot,
      afterSnapshot,
      pending.action,
      { success: result.success, latencyMs: result.latencyMs },
      this.registry,
    );

    const collected: CollectedSample = { sample, executionResult: result };
    this.buffer.push(collected);
    this.stats.captured++;

    // 自动刷新
    if (this.buffer.length >= this.config.autoFlushThreshold) {
      this.flush();
    }

    return collected;
  }

  /**
   * 快捷方法：包裹一个异步工具执行
   */
  async wrapExecution<T>(
    action: SceneAction,
    fn: () => Promise<T>,
    extractResult?: (result: T) => Partial<ToolExecutionResult>,
  ): Promise<{ result: T; sample: CollectedSample | null }> {
    const pending = this.captureBefore(action);
    const start = performance.now();

    let toolResult: ToolExecutionResult = { success: false, latencyMs: 0 };
    let result: T;

    try {
      result = await fn();
      const latencyMs = performance.now() - start;
      const extracted = extractResult?.(result);
      toolResult = {
        success: true,
        latencyMs,
        ...extracted,
      };
    } catch (err) {
      const latencyMs = performance.now() - start;
      toolResult = {
        success: false,
        latencyMs,
        error: err instanceof Error ? err.message : String(err),
      };
      throw err; // 重新抛出，不吞异常
    } finally {
      // 无论成功失败都收集（如果配置允许）
      this.captureAfter(pending, toolResult);
    }

    return { result, sample: null }; // sample 已在 captureAfter 中入缓冲
  }

  /**
   * 刷新缓冲区（调用回调）
   */
  flush(): void {
    if (this.buffer.length === 0) return;
    const samples = [...this.buffer];
    this.buffer = [];
    this.stats.flushed += samples.length;
    this.onFlush?.(samples);
  }

  /**
   * 获取缓冲区中的样本
   */
  getBuffer(): CollectedSample[] {
    return [...this.buffer];
  }

  /**
   * 清空缓冲区
   */
  clear(): void {
    this.buffer = [];
  }

  /**
   * 获取统计
   */
  getStats() {
    return {
      ...this.stats,
      bufferSize: this.buffer.length,
    };
  }

  /**
   * 更新 EntityRegistry（用于热替换）
   */
  setRegistry(registry: EntityRegistry): void {
    this.registry = registry;
  }
}
