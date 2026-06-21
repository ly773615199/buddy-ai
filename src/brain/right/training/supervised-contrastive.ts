/**
 * 监督对比学习训练器
 *
 * 与 SimCSE 的区别：
 * - SimCSE: 同一文本两次 forward（靠 dropout 产生不同表示）
 * - 监督对比: 代码 ↔ 文本描述 作为正样本对（有明确标注信号）
 *
 * 训练流程：
 * 1. 对 batch 中每个样本，分别编码 code 和 text
 * 2. code[i] ↔ text[i] 为正样本对
 * 3. code[i] ↔ text[j] (j≠i) 为负样本对（in-batch negatives）
 * 4. 计算 InfoNCE 损失 + 反向传播
 *
 * 优势：信号更强，不依赖 dropout 随机性，对小模型更友好
 */

import { TextEncoder, type TextEncoderConfig, type TextEncoderCache } from '../features/text-encoder.js';
import type { Tensor } from '../nn/tensor.js';
import { AdamW, type AdamWConfig } from './adamw.js';
import { cosineSimilarity } from './contrastive-loss.js';
import { PairedDataset, type PairedSample } from './paired-dataset.js';

// ==================== 配置 ====================

export interface SupervisedContrastiveConfig {
  encoder: Partial<TextEncoderConfig>;
  optimizer: Partial<AdamWConfig>;
  training: {
    batchSize: number;
    epochs: number;
    temperature: number;       // InfoNCE 温度，默认 0.07
    logInterval: number;       // 每 N 步打印
    saveInterval: number;      // 每 N 步保存
    evalInterval: number;      // 每 N 步评估
    gradClip: number;          // 梯度裁剪，默认 1.0
    maxInputLen: number;       // 最大输入长度（字节），默认 256
  };
}

const DEFAULT_CONFIG: SupervisedContrastiveConfig = {
  encoder: {
    byteEmbedDim: 64,
    outputDim: 384,
    numLayers: 4,
    numHeads: 6,
    ffnDim: 768,
  },
  optimizer: {
    learningRate: 2e-4,
    beta1: 0.9,
    beta2: 0.999,
    weightDecay: 0.01,
    schedule: 'cosine',
    scheduleParams: {
      warmupSteps: 500,
      totalSteps: 50000,
      minLr: 1e-6,
    },
  },
  training: {
    batchSize: 32,
    epochs: 20,
    temperature: 0.07,
    logInterval: 5,
    saveInterval: 200,
    evalInterval: 50,
    gradClip: 1.0,
    maxInputLen: 256,
  },
};

// ==================== 结果类型 ====================

export interface TrainStepResult {
  step: number;
  loss: number;
  lr: number;
  gradNorm: number;
  /** 正样本对的平均余弦相似度 */
  posSim: number;
  /** 负样本对的平均余弦相似度 */
  negSim: number;
}

export interface TrainEpochResult {
  epoch: number;
  avgLoss: number;
  avgPosSim: number;
  avgNegSim: number;
  steps: number;
  duration: number;
}

// ==================== 工具函数 ====================

/** L2 归一化 */
function l2Norm(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm < 1e-8) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/** 梯度裁剪 */
function clipGradient(grads: Float32Array[], maxNorm: number): number {
  let totalNorm = 0;
  for (const g of grads) {
    for (let i = 0; i < g.length; i++) {
      totalNorm += g[i] * g[i];
    }
  }
  totalNorm = Math.sqrt(totalNorm);

  if (totalNorm > maxNorm) {
    const scale = maxNorm / totalNorm;
    for (const g of grads) {
      for (let i = 0; i < g.length; i++) {
        g[i] *= scale;
      }
    }
  }
  return totalNorm;
}

/**
 * L2 归一化的反向传播
 *
 * z = h / ||h||
 * ∂L/∂h = (I - zz^T) / ||h|| * ∂L/∂z
 *
 * @param gradZ 归一化后的梯度 ∂L/∂z
 * @param z 归一化后的向量 z = h/||h||
 * @param h 原始向量
 * @returns ∂L/∂h
 */
function l2NormBackward(gradZ: Float32Array, z: Float32Array, h: Float32Array): Float32Array {
  const D = h.length;
  let hNorm = 0;
  for (let i = 0; i < D; i++) hNorm += h[i] * h[i];
  hNorm = Math.sqrt(hNorm);

  if (hNorm < 1e-8) return new Float32Array(D);

  // gradH = (gradZ - z * (z · gradZ)) / ||h||
  let dotZG = 0;
  for (let i = 0; i < D; i++) dotZG += z[i] * gradZ[i];

  const gradH = new Float32Array(D);
  for (let i = 0; i < D; i++) {
    gradH[i] = (gradZ[i] - z[i] * dotZG) / hNorm;
  }
  return gradH;
}

// ==================== InfoNCE（监督版） ====================

/**
 * 监督 InfoNCE 损失
 *
 * anchor[i] = code 编码
 * positive[i] = text 编码（正样本）
 * 负样本 = batch 内其他样本的 text 编码
 *
 * L = -log(exp(sim(a_i, p_i)/τ) / (exp(sim(a_i, p_i)/τ) + Σ_{j≠i} exp(sim(a_i, p_j)/τ)))
 */
function supervisedInfoNCELoss(
  anchors: Float32Array[],
  positives: Float32Array[],
  temperature: number,
): number {
  const N = anchors.length;
  if (N === 0) return 0;

  let totalLoss = 0;
  for (let i = 0; i < N; i++) {
    const posSim = cosineSimilarity(anchors[i], positives[i]) / temperature;

    // 所有负样本 + 正样本
    let logSumExp = 0;
    for (let j = 0; j < N; j++) {
      const sim = cosineSimilarity(anchors[i], positives[j]) / temperature;
      logSumExp += Math.exp(sim);
    }

    totalLoss += -posSim + Math.log(logSumExp);
  }

  return totalLoss / N;
}

/**
 * 监督 InfoNCE 梯度
 *
 * ∂L/∂anchor[i] = (1/τ) * (Σ_j softmax_j * positive[j] - positive[i])
 * ∂L/∂positive[j] = (1/τ) * Σ_i softmax_j(i) * (anchor[i] - weighted_anchor)
 */
function supervisedInfoNECGradient(
  anchors: Float32Array[],
  positives: Float32Array[],
  temperature: number,
): [Float32Array[], Float32Array[]] {
  const N = anchors.length;
  const D = anchors[0].length;

  const gradAnchors: Float32Array[] = [];
  const gradPositives: Float32Array[] = [];

  // 初始化
  for (let i = 0; i < N; i++) {
    gradAnchors.push(new Float32Array(D));
    gradPositives.push(new Float32Array(D));
  }

  for (let i = 0; i < N; i++) {
    // 计算 softmax 权重
    const sims: number[] = [];
    for (let j = 0; j < N; j++) {
      sims.push(cosineSimilarity(anchors[i], positives[j]) / temperature);
    }
    const maxSim = Math.max(...sims);
    let sumExp = 0;
    for (let j = 0; j < N; j++) {
      sims[j] = Math.exp(sims[j] - maxSim);
      sumExp += sims[j];
    }
    for (let j = 0; j < N; j++) {
      sims[j] /= sumExp;
    }

    // anchor[i] 的梯度: Σ_j w_j * positive[j] - positive[i]
    for (let j = 0; j < N; j++) {
      const w = sims[j] / (temperature * N);
      for (let d = 0; d < D; d++) {
        gradAnchors[i][d] += w * positives[j][d];
      }
    }
    // 减去正样本的贡献
    for (let d = 0; d < D; d++) {
      gradAnchors[i][d] -= positives[i][d] / (temperature * N);
    }

    // positive[j] 的梯度（累积所有 anchor 对它的贡献）
    // ∂L/∂p_j = (1/(N*τ)) * Σ_i [(w_{ij} - δ_{ij}) * a_i]
    for (let j = 0; j < N; j++) {
      const w = sims[j]; // softmax 权重
      const sign = (j === i) ? (sims[j] - 1) : sims[j];
      for (let d = 0; d < D; d++) {
        gradPositives[j][d] += sign * anchors[i][d] / (temperature * N);
      }
    }
  }

  return [gradAnchors, gradPositives];
}

// ==================== 训练器 ====================

/**
 * 监督对比学习训练器
 */
export class SupervisedContrastiveTrainer {
  private encoder: TextEncoder;
  private optimizer: AdamW;
  private config: SupervisedContrastiveConfig;
  private step = 0;
  private losses: number[] = [];

  constructor(config?: Partial<SupervisedContrastiveConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      training: { ...DEFAULT_CONFIG.training, ...config?.training },
      encoder: { ...DEFAULT_CONFIG.encoder, ...config?.encoder },
      optimizer: { ...DEFAULT_CONFIG.optimizer, ...config?.optimizer },
    };
    this.encoder = new TextEncoder(this.config.encoder);
    this.optimizer = new AdamW(this.config.optimizer);
  }

  getEncoder(): TextEncoder {
    return this.encoder;
  }

  getStep(): number {
    return this.step;
  }

  /**
   * 单步训练
   *
   * 1. 对 batch 中每个样本，分别编码 code 和 text
   * 2. 计算监督 InfoNCE 损失
   * 3. 反向传播 + AdamW 更新
   */
  trainStep(batch: PairedSample[]): TrainStepResult {
    const N = batch.length;
    const tau = this.config.training.temperature;
    const maxLen = this.config.training.maxInputLen;

    // ---- 前向传播 ----
    // 保存原始 (未归一化) 的池化输出，用于 L2 归一化的反向传播
    const anchorRaw: Float32Array[] = [];
    const positiveRaw: Float32Array[] = [];
    const anchorEmbeds: Float32Array[] = [];  // code 归一化后编码
    const positiveEmbeds: Float32Array[] = []; // text 归一化后编码
    const anchorCaches: Array<{ seq: Tensor; cache: TextEncoderCache }> = [];
    const positiveCaches: Array<{ seq: Tensor; cache: TextEncoderCache }> = [];

    for (const sample of batch) {
      // 截断长输入
      const code = maxLen > 0 ? sample.code.slice(0, maxLen) : sample.code;
      const text = maxLen > 0 ? sample.text.slice(0, maxLen) : sample.text;

      // 编码代码（anchor）
      const { result: aSeq, cache: aCache } = this.encoder.forwardWithCache(code);
      const aPooled = this.encoder.attentionPoolingForward(aSeq);
      const aRaw = new Float32Array(aPooled.data);
      anchorRaw.push(aRaw);
      anchorEmbeds.push(l2Norm(aRaw));
      anchorCaches.push({ seq: aSeq, cache: aCache });

      // 编码文本（positive）
      const { result: pSeq, cache: pCache } = this.encoder.forwardWithCache(text);
      const pPooled = this.encoder.attentionPoolingForward(pSeq);
      const pRaw = new Float32Array(pPooled.data);
      positiveRaw.push(pRaw);
      positiveEmbeds.push(l2Norm(pRaw));
      positiveCaches.push({ seq: pSeq, cache: pCache });
    }

    // ---- 计算损失 ----
    const loss = supervisedInfoNCELoss(anchorEmbeds, positiveEmbeds, tau);

    // ---- 计算归一化空间中的梯度 ----
    const [gradAnchorsNorm, gradPositivesNorm] = supervisedInfoNECGradient(
      anchorEmbeds, positiveEmbeds, tau,
    );

    // ---- 通过 L2 归一化的反向传播，将梯度投影到原始空间 ----
    // ∂L/∂h = (I - zz^T)/||h|| * ∂L/∂z
    const gradAnchorsRaw: Float32Array[] = [];
    const gradPositivesRaw: Float32Array[] = [];

    for (let i = 0; i < N; i++) {
      gradAnchorsRaw.push(
        l2NormBackward(gradAnchorsNorm[i], anchorEmbeds[i], anchorRaw[i])
      );
      gradPositivesRaw.push(
        l2NormBackward(gradPositivesNorm[i], positiveEmbeds[i], positiveRaw[i])
      );
    }

    // 梯度裁剪
    const allGrads = [...gradAnchorsRaw, ...gradPositivesRaw];
    const gradNorm = clipGradient(allGrads, this.config.training.gradClip);

    // ---- 反向传播 ----
    // anchor 路径
    for (let i = 0; i < N; i++) {
      this.encoder.backward(gradAnchorsRaw[i], anchorCaches[i].seq, anchorCaches[i].cache);
    }
    // positive 路径
    for (let i = 0; i < N; i++) {
      this.encoder.backward(gradPositivesRaw[i], positiveCaches[i].seq, positiveCaches[i].cache);
    }

    // ---- 参数更新 ----
    const params = this.encoder.parameters();
    this.optimizer.step_(params);

    // 清零梯度
    for (const param of params) {
      if (param.grad) param.grad.fill(0);
    }

    this.step++;
    this.losses.push(loss);

    // 计算正/负样本相似度
    let posSim = 0, negSim = 0;
    let negCount = 0;
    for (let i = 0; i < N; i++) {
      posSim += cosineSimilarity(anchorEmbeds[i], positiveEmbeds[i]);
      for (let j = 0; j < N; j++) {
        if (j !== i) {
          negSim += cosineSimilarity(anchorEmbeds[i], positiveEmbeds[j]);
          negCount++;
        }
      }
    }
    posSim /= N;
    negSim = negCount > 0 ? negSim / negCount : 0;

    return {
      step: this.step,
      loss,
      lr: this.getCurrentLr(),
      gradNorm,
      posSim,
      negSim,
    };
  }

  /**
   * 训练一个 epoch
   */
  trainEpoch(dataset: PairedDataset, onStep?: (result: TrainStepResult) => void): TrainEpochResult {
    const startTime = Date.now();
    let epochLoss = 0;
    let epochPosSim = 0;
    let epochNegSim = 0;
    let steps = 0;

    for (const batch of dataset.batches(this.config.training.batchSize, true)) {
      const result = this.trainStep(batch);
      epochLoss += result.loss;
      epochPosSim += result.posSim;
      epochNegSim += result.negSim;
      steps++;

      if (onStep) onStep(result);
    }

    return {
      epoch: 0,
      avgLoss: steps > 0 ? epochLoss / steps : 0,
      avgPosSim: steps > 0 ? epochPosSim / steps : 0,
      avgNegSim: steps > 0 ? epochNegSim / steps : 0,
      steps,
      duration: Date.now() - startTime,
    };
  }

  /**
   * 完整训练循环
   */
  async train(
    trainSet: PairedDataset,
    valSet?: PairedDataset,
    callbacks?: {
      onEpoch?: (result: TrainEpochResult) => void;
      onStep?: (result: TrainStepResult) => void;
      onSave?: (encoder: TextEncoder, step: number) => void;
      onEval?: (metrics: EvalMetrics, step: number) => void;
    },
  ): Promise<void> {
    const { epochs, logInterval, saveInterval, evalInterval } = this.config.training;

    for (let epoch = 0; epoch < epochs; epoch++) {
      trainSet.shuffle();

      const result = this.trainEpoch(trainSet, (stepResult) => {
        if (stepResult.step % logInterval === 0) {
          console.log(
            `[SupCon] Step ${stepResult.step} | Loss: ${stepResult.loss.toFixed(4)} | ` +
            `PosSim: ${stepResult.posSim.toFixed(3)} | NegSim: ${stepResult.negSim.toFixed(3)} | ` +
            `LR: ${stepResult.lr.toExponential(2)} | GradNorm: ${stepResult.gradNorm.toFixed(3)}`
          );
        }

        if (callbacks?.onStep) callbacks.onStep(stepResult);

        if (stepResult.step % saveInterval === 0 && callbacks?.onSave) {
          callbacks.onSave(this.encoder, stepResult.step);
        }

        if (stepResult.step % evalInterval === 0 && valSet && callbacks?.onEval) {
          const metrics = this.evaluate(valSet);
          callbacks.onEval(metrics, stepResult.step);
        }
      });

      console.log(
        `[SupCon] Epoch ${epoch + 1}/${epochs} | Loss: ${result.avgLoss.toFixed(4)} | ` +
        `PosSim: ${result.avgPosSim.toFixed(3)} | NegSim: ${result.avgNegSim.toFixed(3)} | ` +
        `Steps: ${result.steps} | ${(result.duration / 1000).toFixed(1)}s`
      );

      if (callbacks?.onEpoch) callbacks.onEpoch(result);
    }
  }

  /**
   * 评估：在验证集上计算检索指标
   *
   * Code→Text 检索：用 code 查最相似的 text，看是否命中
   * Text→Code 检索：反向
   */
  evaluate(dataset: PairedDataset, maxSamples = 100): EvalMetrics {
    const allPairs = dataset.getPairs();
    if (allPairs.length === 0) return { codeToTextR1: 0, textToCodeR1: 0, avgPosSim: 0, avgNegSim: 0 };

    // 限制评估样本数（避免 O(n²) 太慢）
    const pairs = allPairs.length > maxSamples
      ? allPairs.slice(0, maxSamples)
      : allPairs;
    const n = pairs.length;

    // 编码所有样本（截断长输入）
    const codeEmbeds: Float32Array[] = [];
    const textEmbeds: Float32Array[] = [];
    const maxLen = this.config.training.maxInputLen;

    for (const pair of pairs) {
      const code = maxLen > 0 ? pair.code.slice(0, maxLen) : pair.code;
      const text = maxLen > 0 ? pair.text.slice(0, maxLen) : pair.text;

      const cPooled = this.encoder.forwardPooled(code);
      codeEmbeds.push(l2Norm(new Float32Array(cPooled.data)));

      const tPooled = this.encoder.forwardPooled(text);
      textEmbeds.push(l2Norm(new Float32Array(tPooled.data)));
    }

    // Code → Text 检索：用 code[i] 查最相似的 text，看 rank
    let codeToTextR1 = 0;
    let textToCodeR1 = 0;
    let posSim = 0;
    let negSim = 0;
    let negCount = 0;

    for (let i = 0; i < n; i++) {
      // code[i] → text 检索
      let bestJ = 0, bestSim = -Infinity;
      for (let j = 0; j < n; j++) {
        const sim = cosineSimilarity(codeEmbeds[i], textEmbeds[j]);
        if (sim > bestSim) { bestSim = sim; bestJ = j; }
      }
      if (bestJ === i) codeToTextR1++;

      // text[i] → code 检索
      bestJ = 0; bestSim = -Infinity;
      for (let j = 0; j < n; j++) {
        const sim = cosineSimilarity(textEmbeds[i], codeEmbeds[j]);
        if (sim > bestSim) { bestSim = sim; bestJ = j; }
      }
      if (bestJ === i) textToCodeR1++;

      // 相似度统计
      posSim += cosineSimilarity(codeEmbeds[i], textEmbeds[i]);
      for (let j = 0; j < n; j++) {
        if (j !== i) {
          negSim += cosineSimilarity(codeEmbeds[i], textEmbeds[j]);
          negCount++;
        }
      }
    }

    return {
      codeToTextR1: codeToTextR1 / n,
      textToCodeR1: textToCodeR1 / n,
      avgPosSim: posSim / n,
      avgNegSim: negCount > 0 ? negSim / negCount : 0,
    };
  }

  /**
   * 保存模型
   */
  saveModel(dir: string, fsMod?: typeof import('fs'), pathMod?: typeof import('path')): void {
    // 使用传入的模块或全局 require
    let fs = fsMod;
    let path = pathMod;
    if (!fs || !path) {
      try {
        // @ts-ignore
        fs = fs || require('fs');
        // @ts-ignore
        path = path || require('path');
      } catch {
        throw new Error('saveModel requires Node.js fs module');
      }
    }

    const _fs = fs!;
    const _path = path!;

    if (!_fs.existsSync(dir)) _fs.mkdirSync(dir, { recursive: true });

    // 保存参数
    const params = this.encoder.parameters();
    for (let i = 0; i < params.length; i++) {
      const buf = Buffer.from(params[i].data.buffer);
      _fs.writeFileSync(_path.join(dir, `param_${i}.bin`), buf);
    }

    // 保存元信息
    const meta = {
      step: this.step,
      config: this.config,
      paramShapes: params.map(p => p.shape),
    };
    _fs.writeFileSync(_path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));

    console.log(`[SupCon] Model saved to ${dir} (${params.length} params, step ${this.step})`);
  }

  private getCurrentLr(): number {
    const { learningRate, schedule, scheduleParams } = this.config.optimizer;
    const { warmupSteps = 0, totalSteps = 100000, minLr = 1e-6 } = scheduleParams ?? {};

    if (this.step <= (warmupSteps ?? 0)) {
      return (learningRate ?? 2e-4) * (this.step / Math.max(warmupSteps ?? 1, 1));
    }

    if (schedule === 'cosine') {
      const progress = (this.step - (warmupSteps ?? 0)) /
        Math.max((totalSteps ?? 100000) - (warmupSteps ?? 0), 1);
      return (minLr ?? 1e-6) +
        ((learningRate ?? 2e-4) - (minLr ?? 1e-6)) * 0.5 * (1 + Math.cos(Math.PI * Math.min(progress, 1)));
    }

    return learningRate ?? 2e-4;
  }
}

export interface EvalMetrics {
  codeToTextR1: number;   // Code→Text Recall@1
  textToCodeR1: number;   // Text→Code Recall@1
  avgPosSim: number;      // 正样本对平均相似度
  avgNegSim: number;      // 负样本对平均相似度
}
