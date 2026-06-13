/**
 * TaskQueue — 并发任务队列，替代 isProcessing 布尔锁
 *
 * 核心改进：
 * - 支持多条消息并发处理（maxConcurrent 可配）
 * - 超过并发上限时排队等待（priority 排序）
 * - 超时自动释放，防止永久阻塞
 * - 每条消息有独立 taskId，便于追踪
 */

export interface TaskSlot {
  id: string;
  priority: number;
  status: 'running' | 'pending';
  startedAt: number;
}

export interface TaskQueueConfig {
  /** 最大并发任务数（默认 3） */
  maxConcurrent: number;
  /** 最大等待时间（ms，默认 60s） */
  maxWaitMs: number;
}

const DEFAULT_CONFIG: TaskQueueConfig = {
  maxConcurrent: 3,
  maxWaitMs: 60_000,
};

export class TaskQueue {
  private running = new Map<string, TaskSlot>();
  private pending: Array<{
    id: string;
    resolve: () => void;
    reject: (err: Error) => void;
    priority: number;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  private readonly config: TaskQueueConfig;

  constructor(config?: Partial<TaskQueueConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 获取任务槽位，超过上限时排队等待
   * @param id 任务 ID（通常为消息 ID）
   * @param priority 优先级（越高越先执行，默认 0）
   * @returns 当任务获得执行权时 resolve；超时或队列满时 reject
   */
  async acquire(id: string, priority = 0): Promise<void> {
    // 快速路径：有空闲槽位
    if (this.running.size < this.config.maxConcurrent) {
      this.running.set(id, {
        id,
        priority,
        status: 'running',
        startedAt: Date.now(),
      });
      return;
    }

    // 慢速路径：排队等待
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = this.pending.filter(p => p.id !== id);
        reject(new Error(`TaskQueue 等待超时（${this.config.maxWaitMs}ms），当前运行中: ${this.running.size}/${this.config.maxConcurrent}`));
      }, this.config.maxWaitMs);

      this.pending.push({ id, resolve, reject, priority, timer });

      // 按优先级降序排列（高优先级先执行）
      this.pending.sort((a, b) => b.priority - a.priority);
    });
  }

  /**
   * 释放任务槽位，自动唤醒下一个排队任务
   */
  release(id: string): void {
    this.running.delete(id);

    // 唤醒下一个排队任务
    const next = this.pending.shift();
    if (next) {
      clearTimeout(next.timer);
      this.running.set(next.id, {
        id: next.id,
        priority: next.priority,
        status: 'running',
        startedAt: Date.now(),
      });
      next.resolve();
    }
  }

  /**
   * 检查是否可以立即接受新任务（不排队）
   */
  canAccept(): boolean {
    return this.running.size < this.config.maxConcurrent;
  }

  /**
   * 获取当前运行中的任务列表
   */
  getRunning(): TaskSlot[] {
    return [...this.running.values()];
  }

  /**
   * 获取排队中的任务数量
   */
  getPendingCount(): number {
    return this.pending.length;
  }

  /**
   * 强制释放超时任务（安全机制）
   * @param timeoutMs 超时阈值（ms），超过此时间的运行中任务将被释放
   * @returns 被强制释放的任务 ID 列表
   */
  releaseExpired(timeoutMs: number): string[] {
    const now = Date.now();
    const released: string[] = [];

    for (const [id, slot] of this.running) {
      if (now - slot.startedAt > timeoutMs) {
        console.warn(`[TaskQueue] 任务 ${id} 超时 (${((now - slot.startedAt) / 1000).toFixed(0)}s)，强制释放`);
        this.release(id);
        released.push(id);
      }
    }

    return released;
  }

  /**
   * 获取队列状态摘要
   */
  getStatus(): {
    running: number;
    pending: number;
    maxConcurrent: number;
    tasks: TaskSlot[];
  } {
    return {
      running: this.running.size,
      pending: this.pending.length,
      maxConcurrent: this.config.maxConcurrent,
      tasks: this.getRunning(),
    };
  }

  /**
   * 动态更新最大并发数（自适应控制用）
   */
  updateMaxConcurrent(newMax: number): void {
    this.config.maxConcurrent = Math.max(1, Math.min(100, newMax));
  }

  /**
   * 清空队列（用于关闭/重置）
   */
  clear(): void {
    for (const p of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('TaskQueue 已清空'));
    }
    this.pending = [];
    this.running.clear();
  }
}

// ─────────────────────────────────────────────
// AdaptiveTaskQueue — 自适应并发控制包装类
// ─────────────────────────────────────────────

import { ConcurrencyLimiter, type TaskSample, type AdaptiveConfig } from './concurrency-limiter.js';

export interface AdaptiveTaskQueueConfig {
  /** 初始并发数 */
  initialLimit: number;
  /** 最小并发数（默认 1） */
  minLimit?: number;
  /** 最大并发数（默认 10） */
  maxLimit?: number;
  /** 最大等待时间 ms（默认 60s） */
  maxWaitMs?: number;
  /** 采样窗口大小（默认 10） */
  sampleWindow?: number;
  /** 加速阈值（默认 2） */
  alpha?: number;
  /** 减速阈值（默认 5） */
  beta?: number;
  /** 是否启用自适应（默认 true） */
  enabled?: boolean;
  /** 详细日志 */
  verbose?: boolean;
}

/**
 * AdaptiveTaskQueue — 在 TaskQueue 上叠加自适应并发控制
 *
 * - acquire 接口与 TaskQueue 完全一致
 * - release 需要额外传入 TaskSample 用于决策
 * - 不传 sample 时退化为普通 release
 */
export class AdaptiveTaskQueue {
  private queue: TaskQueue;
  private limiter: ConcurrencyLimiter | null;
  private enabled: boolean;

  constructor(config: AdaptiveTaskQueueConfig) {
    this.enabled = config.enabled !== false;
    this.queue = new TaskQueue({
      maxConcurrent: config.initialLimit,
      maxWaitMs: config.maxWaitMs ?? 60_000,
    });

    if (this.enabled) {
      this.limiter = new ConcurrencyLimiter({
        initialLimit: config.initialLimit,
        minLimit: config.minLimit ?? 1,
        maxLimit: config.maxLimit ?? 10,
        sampleWindow: config.sampleWindow ?? 10,
        alpha: config.alpha ?? 2,
        beta: config.beta ?? 5,
      }, config.verbose ?? false);
    } else {
      this.limiter = null;
    }
  }

  async acquire(id: string, priority = 0): Promise<void> {
    return this.queue.acquire(id, priority);
  }

  /**
   * 释放任务槽位并记录采样
   * @param id 任务 ID
   * @param sample 任务采样数据（可选，不传则只释放不调整）
   */
  release(id: string, sample?: TaskSample): void {
    this.queue.release(id);

    if (this.limiter && sample) {
      const newLimit = this.limiter.onSample(sample);
      this.queue.updateMaxConcurrent(newLimit);
    }
  }

  releaseExpired(timeoutMs: number): string[] {
    return this.queue.releaseExpired(timeoutMs);
  }

  canAccept(): boolean {
    return this.queue.canAccept();
  }

  getRunning() {
    return this.queue.getRunning();
  }

  getPendingCount(): number {
    return this.queue.getPendingCount();
  }

  /** 获取内部 ConcurrencyLimiter（用于运行时 RPM 估算等高级操作） */
  getLimiter(): ConcurrencyLimiter | null {
    return this.limiter;
  }

  /** 动态更新 maxLimit（由运行时 RPM 估算驱动） */
  updateMaxLimit(newMaxLimit: number): void {
    if (this.limiter) {
      const clamped = Math.max(1, Math.min(100, newMaxLimit));
      this.limiter.setMaxLimit(clamped);
      this.queue.updateMaxConcurrent(clamped);
    }
  }

  getStatus() {
    const queueStatus = this.queue.getStatus();
    const limiterStatus = this.limiter?.getStatus() ?? null;
    return {
      ...queueStatus,
      adaptive: this.enabled,
      limiter: limiterStatus,
    };
  }

  clear(): void {
    this.queue.clear();
    this.limiter?.reset();
  }
}
