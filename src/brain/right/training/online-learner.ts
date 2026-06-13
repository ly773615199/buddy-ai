/**
 * 在线学习器 — 每次交互后收集样本并更新权重
 *
 * 流程：
 * 1. 收集样本 (input, label, outcome)
 * 2. 存入 ReplayBuffer
 * 3. 采样 batch
 * 4. 用 backwardPass 计算梯度（输出头手动 + encoder autograd）
 * 5. LPR 近端项（防遗忘）
 * 6. SGD 优化器更新权重
 */

import type { TrainingSample, OnlineLearnConfig } from '../../types.js';
import { IntuitionNet } from '../nn/model.js';
import { encodeFeatures } from '../features/encoder.js';
import { ReplayBuffer } from './replay-buffer.js';
import { type SpanLossWeights } from './loss.js';
import { backwardPass } from './backward.js';
import { SGD, type OptimizerConfig } from './optimizer.js';
import type { TaskSignal, ResourceState, BodyState, DecisionOutcome } from '../../types.js';

export class OnlineLearner {
  private model: IntuitionNet;
  private buffer: ReplayBuffer;
  private config: OnlineLearnConfig;
  private lossWeights: SpanLossWeights;
  private optimizer: SGD;
  private verbose: boolean;

  // 学习率调度
  private baseLr: number;
  private step = 0;
  private lrDecayFactor = 0.9999;

  // LPR 快照
  private snapshot: Float32Array | null = null;
  private stepsSinceSnapshot = 0;

  // 统计
  private totalSamples = 0;
  private totalUpdates = 0;
  private recentLosses: number[] = [];

  // 安全阀状态
  private observeOnly: boolean;
  private observeRounds: number;
  private convergenceThreshold: number;
  private convergencePatience: number;
  private observeRoundCount = 0;
  private convergenceStreak = 0;
  private safetyValveTriggered = false; // true = 已从 observe 切换到 update

  constructor(
    model: IntuitionNet,
    config: OnlineLearnConfig,
    lossWeights?: Partial<SpanLossWeights>,
    verbose = false,
  ) {
    this.model = model;
    this.config = config;
    this.baseLr = config.learningRate;
    this.buffer = new ReplayBuffer(config.replayBufferSize);
    this.lossWeights = {
      alpha: lossWeights?.alpha ?? 0.3,
      beta: lossWeights?.beta ?? 0.3,
      gamma: lossWeights?.gamma ?? 0.1,
      delta: lossWeights?.delta ?? 0.15,
      epsilon: lossWeights?.epsilon ?? 0.15,
    };
    this.verbose = verbose;

    // 安全阀初始化
    this.observeOnly = config.observeOnly ?? false;
    this.observeRounds = config.observeRounds ?? 0;
    this.convergenceThreshold = config.convergenceThreshold ?? 0.01;
    this.convergencePatience = config.convergencePatience ?? 10;

    // 初始化 SGD 优化器
    this.optimizer = new SGD({
      learningRate: config.learningRate,
      momentum: 0.9,
      weightDecay: 0,
      maxGradNorm: 1.0,
      schedule: 'exponential',
      scheduleParams: { decayRate: 0.9999, minLr: 1e-5 },
    });

    // 初始快照
    this.takeSnapshot();
  }

  /**
   * 收集训练样本
   *
   * 从一次交互的结果中提取样本
   */
  collectSample(
    input: string,
    signal: TaskSignal,
    resources: ResourceState,
    intentLabel: number,
    toolLabels: number[],
    qualityLabel: number,
    outcome: DecisionOutcome,
    body?: BodyState,
  ): void {
    // 编码特征
    const tokenIds = encodeFeatures({ signal, resources, body });

    // 简化：将 token IDs 转为 Float32Array 作为 features
    // 实际训练时使用 embedding 输出
    const features = new Float32Array(tokenIds.length);
    for (let i = 0; i < tokenIds.length; i++) features[i] = tokenIds[i];

    // Decision-Attention 权重：成功=1.0，失败=0.3，最近=更高
    const baseWeight = outcome.success ? 1.0 : 0.3;
    const recencyWeight = 1.0; // 最近的样本权重更高（由时间衰减实现）

    const sample: TrainingSample = {
      features,
      labelIntent: intentLabel,
      labelTools: toolLabels,
      labelQuality: qualityLabel,
      outcome: outcome.success,
      timestamp: Date.now(),
      weight: baseWeight * recencyWeight,
    };

    this.buffer.push(sample);
    this.totalSamples++;
  }

  /**
   * 在线更新：从 buffer 采样 batch 并更新权重
   *
   * 安全阀机制：
   * - observeOnly=true 时：只计算 loss，不更新权重（log-only 模式）
   * - 观察轮数达到 observeRounds 后，检查 loss 收敛情况
   * - loss 连续 convergencePatience 轮变化 < convergenceThreshold → 自动切换到真实更新
   *
   * 采样策略（v3.1 增强）：
   * - 前 100 步：全量随机采样（热身）
   * - 100 步后：课程学习（从易到难）
   *
   * 返回平均 loss
   */
  async update(): Promise<{ loss: number; lr: number; samples: number; observeOnly?: boolean; converged?: boolean }> {
    if (this.buffer.size < this.config.batchSize) {
      return { loss: 0, lr: this.optimizer.lr, samples: 0, observeOnly: this.observeOnly };
    }

    // 采样策略选择
    let batch: TrainingSample[];
    if (this.totalUpdates < 100) {
      batch = this.buffer.sampleWeighted(this.config.batchSize);
    } else {
      const progress = Math.min(1, (this.totalUpdates - 100) / 900);
      batch = this.buffer.sampleCurriculum(this.config.batchSize, progress);
    }

    const params = this.model.parameters();
    let totalLoss = 0;

    // 前向 + 反向（始终执行，用于计算 loss）
    for (const p of params) p.zeroGrad();

    for (const sample of batch) {
      const tokenIds = Array.from(sample.features).map(v => Math.round(v));
      const output = this.model.forward(tokenIds);

      const lossResult = backwardPass(
        this.model,
        output,
        sample.labelIntent,
        sample.labelTools,
        sample.labelQuality,
        this.lossWeights,
      );

      if (sample.weight !== 1) {
        for (const p of params) {
          if (!p.grad) continue;
          for (let i = 0; i < p.size; i++) {
            p.grad[i] *= sample.weight;
          }
        }
      }

      totalLoss += lossResult.total;
    }

    const avgLoss = totalLoss / batch.length;
    this.recentLosses.push(avgLoss);
    if (this.recentLosses.length > 100) this.recentLosses.shift();

    // ── 安全阀：observeOnly 模式 ──
    if (this.observeOnly) {
      this.observeRoundCount++;
      this.step++;
      this.totalUpdates++;

      // 检查是否应该切换到真实更新
      if (this.observeRounds > 0 && this.observeRoundCount >= this.observeRounds) {
        if (this.checkConvergence()) {
          this.observeOnly = false;
          this.safetyValveTriggered = true;
          if (this.verbose) {
            console.log(`[OnlineLearner] 安全阀: 观察 ${this.observeRoundCount} 轮后 loss 已收敛，切换到真实更新`);
          }
        }
      }

      // LPR 快照仍然更新（保持防遗忘基线）
      this.stepsSinceSnapshot++;
      if (this.stepsSinceSnapshot >= this.config.lprSnapshotInterval) {
        this.takeSnapshot();
        this.stepsSinceSnapshot = 0;
      }

      return { loss: avgLoss, lr: this.optimizer.lr, samples: batch.length, observeOnly: true, converged: !this.observeOnly };
    }

    // ── 真实更新 ──

    // LPR 近端项：防止遗忘
    if (this.snapshot) {
      const lambda = this.config.lprLambda;
      for (const p of params) {
        if (!p.grad) continue;
        for (let i = 0; i < p.size; i++) {
          p.grad[i] += lambda * (p.data[i] - (this.snapshot[i] || 0));
        }
      }
    }

    // SGD 优化器更新权重
    this.optimizer.step_update(params);

    this.step++;
    this.totalUpdates++;

    // 定期更新快照
    this.stepsSinceSnapshot++;
    if (this.stepsSinceSnapshot >= this.config.lprSnapshotInterval) {
      this.takeSnapshot();
      this.stepsSinceSnapshot = 0;
    }

    return { loss: avgLoss, lr: this.optimizer.lr, samples: batch.length, observeOnly: false };
  }

  /**
   * 检查 loss 是否收敛
   * 连续 convergencePatience 轮 loss 变化 < convergenceThreshold → 收敛
   */
  private checkConvergence(): boolean {
    if (this.recentLosses.length < 2) return false;

    const recent = this.recentLosses.slice(-this.convergencePatience - 1);
    if (recent.length < 2) return false;

    let converged = true;
    for (let i = 1; i < recent.length; i++) {
      const delta = Math.abs(recent[i] - recent[i - 1]);
      if (delta >= this.convergenceThreshold) {
        converged = false;
        break;
      }
    }

    if (converged) {
      this.convergenceStreak++;
    } else {
      this.convergenceStreak = 0;
    }

    return this.convergenceStreak >= this.convergencePatience;
  }

  /** 获取安全阀状态 */
  get safetyValveStatus() {
    return {
      observeOnly: this.observeOnly,
      observeRoundCount: this.observeRoundCount,
      safetyValveTriggered: this.safetyValveTriggered,
      convergenceStreak: this.convergenceStreak,
      recentAvgLoss: this.recentLosses.length > 0
        ? this.recentLosses.reduce((a, b) => a + b, 0) / this.recentLosses.length
        : 0,
    };
  }

  /** 获取最近的 loss 历史（供影子大脑时机控制器） */
  getRecentLosses(): number[] {
    return [...this.recentLosses];
  }

  /** 从交互结果中构造训练标签并收集 */
  collectFromOutcome(
    signal: TaskSignal,
    resources: ResourceState,
    body: BodyState | undefined,
    actualIntent: string,
    actualTools: string[],
    outcome: DecisionOutcome,
  ): void {
    // 意图标签
    const INTENT_LABELS = [
      'file_operations', 'code_operations', 'git_operations', 'web_operations',
      'system_operations', 'knowledge_query', 'conversation', 'complex_task',
    ];
    const intentIdx = INTENT_LABELS.indexOf(actualIntent);
    if (intentIdx < 0) return;

    // 工具标签
    const TOOL_IDS: Record<string, number> = {
      'read_file': 0, 'write_file': 1, 'list_files': 2, 'search_files': 3,
      'exec': 4, 'git_status': 5, 'git_log': 6, 'git_diff': 7,
      'git_commit': 8, 'git_branch': 9, 'git_merge': 10, 'git_push': 11,
      'search_web': 12, 'fetch_url': 13, 'analyze_file': 14, 'find_references': 15,
      'browser_screenshot': 16, 'browser_extract': 17, 'browser_pdf': 18,
      'screen_capture': 19, 'screen_ocr': 20, 'screen_describe': 21,
      'tts_speak': 22, 'tts_voices': 23, 'tts_status': 24,
      'scan_project': 25, 'project_context': 26, 'get_time': 27,
    };
    const toolLabels = new Array(32).fill(0);
    for (const t of actualTools) {
      const idx = TOOL_IDS[t];
      if (idx !== undefined) toolLabels[idx] = 1;
    }

    // 质量标签（从 outcome 推断）
    const qualityLabel = outcome.success ? 0.8 : 0.2;

    this.collectSample('', signal, resources, intentIdx, toolLabels, qualityLabel, outcome, body);
  }

  /**
   * 外部样本写入（仅入 Buffer，不触发权重更新）
   * 供信号汇聚层等外部通道使用
   */
  ingestSample(sample: TrainingSample): void {
    this.buffer.push(sample);
    this.totalSamples++;
  }

  get stats() {
    return {
      totalSamples: this.totalSamples,
      totalUpdates: this.totalUpdates,
      bufferSize: this.buffer.size,
      avgLoss: this.recentLosses.length > 0
        ? this.recentLosses.reduce((a, b) => a + b, 0) / this.recentLosses.length
        : 0,
      currentLr: this.optimizer.lr,
      optimizerSteps: this.optimizer.totalSteps,
    };
  }

  private takeSnapshot(): void {
    const params = this.model.parameters();
    const totalSize = params.reduce((s, p) => s + p.size, 0);
    this.snapshot = new Float32Array(totalSize);
    let offset = 0;
    for (const p of params) {
      this.snapshot.set(p.data, offset);
      offset += p.size;
    }
  }
}
