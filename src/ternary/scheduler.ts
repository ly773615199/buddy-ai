/**
 * 三进制训练调度器
 *
 * 集成到 Buddy 心跳系统，自动触发夜间增量训练。
 *
 * 策略：
 * - 夜间 (22:00-06:00) 空闲时自动训练
 * - 新知识积累超过阈值时触发
 * - 模型成长阶段变化时触发
 * - 手动触发支持
 */

import type { TernaryModel, TernaryModelMeta, GrowthStage } from './format.js';
import { TernaryTrainer, type TrainingDataset, type TrainingSample, type TrainResult } from './trainer.js';
import type { TernaryModelManager } from './manager.js';

// ── 调度配置 ──

export interface SchedulerConfig {
  /** 自动训练的最低样本积累数 */
  minSamplesToTrain: number;
  /** 夜间训练窗口 (24h) */
  nightWindow: { start: number; end: number };
  /** 最大训练频率 (ms) — 两次训练的最小间隔 */
  minInterval: number;
  /** 是否启用夜间自动训练 */
  enableNightly: boolean;
  /** 是否启用知识驱动训练 */
  enableKnowledgeDriven: boolean;
  /** 训练完成回调 */
  onTrainComplete?: (domain: string, result: TrainResult) => void | Promise<void>;
}

const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  minSamplesToTrain: 10,
  nightWindow: { start: 22, end: 6 },
  minInterval: 4 * 60 * 60 * 1000, // 4 小时
  enableNightly: true,
  enableKnowledgeDriven: true,
};

// ── 待训练队列 ──

export interface PendingTraining {
  domain: string;
  samples: TrainingSample[];
  priority: number;
  addedAt: number;
}

// ── 调度状态 ──

export interface SchedulerState {
  /** 上次训练时间 (ms since epoch) */
  lastTrainTime: number;
  /** 累计未训练样本数 */
  pendingSampleCount: number;
  /** 待训练队列 */
  queue: PendingTraining[];
  /** 是否正在训练 */
  isTraining: boolean;
  /** 上次训练结果 */
  lastResult: TrainResult | null;
}

// ════════════════════════════════════════════════════════
// 训练调度器
// ════════════════════════════════════════════════════════

export class TernaryScheduler {
  private config: SchedulerConfig;
  private trainer: TernaryTrainer;
  private manager: TernaryModelManager | null = null;
  private state: SchedulerState = {
    lastTrainTime: 0,
    pendingSampleCount: 0,
    queue: [],
    isTraining: false,
    lastResult: null,
  };

  constructor(config?: Partial<SchedulerConfig>) {
    this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config };
    this.trainer = new TernaryTrainer();
  }

  /**
   * 绑定模型管理器
   */
  setManager(manager: TernaryModelManager): void {
    this.manager = manager;
  }

  /**
   * 添加待训练数据
   *
   * 知识采集模块调用此方法注入新数据。
   */
  addSamples(domain: string, samples: TrainingSample[], priority = 0): void {
    // 查找或创建队列条目
    let entry = this.state.queue.find(q => q.domain === domain);
    if (entry) {
      entry.samples.push(...samples);
      entry.priority = Math.max(entry.priority, priority);
    } else {
      this.state.queue.push({
        domain,
        samples,
        priority,
        addedAt: Date.now(),
      });
    }

    this.state.pendingSampleCount += samples.length;
  }

  /**
   * 心跳检查 — 每次心跳调用
   *
   * 判断是否需要训练，需要则触发。
   */
  async checkAndTrain(): Promise<TrainResult | null> {
    // 正在训练则跳过
    if (this.state.isTraining) return null;

    // 没有待训练数据
    if (this.state.queue.length === 0) return null;

    // 检查是否满足训练条件
    if (!this.shouldTrain()) return null;

    // 取优先级最高的队列条目
    this.state.queue.sort((a, b) => b.priority - a.priority || b.addedAt - a.addedAt);
    const entry = this.state.queue.shift()!;

    // 执行训练
    return this.executeTraining(entry);
  }

  /**
   * 手动触发训练
   */
  async forceTrain(domain: string): Promise<TrainResult | null> {
    const entry = this.state.queue.find(q => q.domain === domain);
    if (!entry) return null;

    this.state.queue = this.state.queue.filter(q => q.domain !== domain);
    return this.executeTraining(entry);
  }

  /**
   * 获取当前状态
   */
  getState(): SchedulerState {
    return { ...this.state };
  }

  /**
   * 获取待训练摘要
   */
  getPendingSummary(): { domain: string; sampleCount: number; priority: number }[] {
    return this.state.queue.map(q => ({
      domain: q.domain,
      sampleCount: q.samples.length,
      priority: q.priority,
    }));
  }

  // ── 内部方法 ──

  /**
   * 判断是否应该训练
   */
  private shouldTrain(): boolean {
    // 1. 检查样本数是否足够
    const totalSamples = this.state.queue.reduce((sum, q) => sum + q.samples.length, 0);
    if (totalSamples < this.config.minSamplesToTrain) return false;

    // 2. 检查训练间隔
    const elapsed = Date.now() - this.state.lastTrainTime;
    if (elapsed < this.config.minInterval) return false;

    // 3. 检查是否在训练窗口内
    const hour = new Date().getHours();
    const { start, end } = this.config.nightWindow;

    if (this.config.enableNightly) {
      // 夜间窗口：22:00 - 06:00（跨午夜）
      if (start > end) {
        // 跨午夜 (如 22-6)
        if (hour >= start || hour < end) return true;
      } else {
        if (hour >= start && hour < end) return true;
      }
    }

    // 4. 知识驱动：样本积累太多也触发
    if (this.config.enableKnowledgeDriven && totalSamples >= this.config.minSamplesToTrain * 5) {
      return true;
    }

    return false;
  }

  /**
   * 执行训练
   */
  private async executeTraining(entry: PendingTraining): Promise<TrainResult> {
    this.state.isTraining = true;

    try {
      if (!this.manager) {
        throw new Error('TernaryScheduler: model manager not set. Call setManager() first.');
      }

      // 加载模型
      const model = await this.manager.load(entry.domain);
      if (!model) {
        throw new Error(`Model not found: ${entry.domain}`);
      }

      // 构建训练集
      const dataset: TrainingDataset = {
        samples: entry.samples,
        domain: entry.domain,
        version: '1.0.0',
      };

      // 训练
      const result = this.trainer.train(model, dataset);

      // 保存（如果成功且未回滚）
      if (result.success && !result.rolledBack) {
        await this.manager.save(model);
      }

      // 更新状态
      this.state.lastTrainTime = Date.now();
      this.state.pendingSampleCount -= entry.samples.length;
      this.state.lastResult = result;

      // 回调
      if (this.config.onTrainComplete) {
        await this.config.onTrainComplete(entry.domain, result);
      }

      return result;
    } finally {
      this.state.isTraining = false;
    }
  }
}
