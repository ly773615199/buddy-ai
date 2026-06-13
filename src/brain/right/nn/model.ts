/**
 * IntuitionNet — 完整 NN 模型
 *
 * Embedding → Encoder Block × N → 池化 → 5 个输出头
 * ~300K 参数（方案 B ~2.5M），int8 量化后 ~300KB/~2.5MB，CPU 推理 < 5ms/< 20ms
 *
 * 支持 batch > 1：
 * - forward(tokenIds) — batch=1，单条推理（向后兼容）
 * - forwardBatch(batchTokenIds) — batch>1，批量推理
 */

import {
  Tensor, zeros, randn, reshape, matmul, batchMatmul,
  enterInferenceMode, exitInferenceMode, releaseToPool,
} from './tensor.js';
import { globalPool } from './pool.js';
import { Embedding } from './embedding.js';
import { EncoderBlock } from './encoder.js';
import { OutputHeads } from './output-heads.js';
import type { NNConfig } from '../../types.js';

/** sigmoid: 将原始 logit 映射到 (0, 1)，用于 quality_head 推理输出 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export interface ModelOutput {
  intentProbs: Float32Array;   // [numIntents]
  toolProbs: Float32Array;     // [numTools]
  qualityScore: number;        // 0-1
  spatialProbs: Float32Array;  // [numSpatialBins]
  sceneProbs: Float32Array;    // [numSceneNodes]
  latencyMs: number;
  /** backbone 输出的 hidden 向量（供 PrototypeMemory 使用） */
  _hidden?: Float32Array;
}

/** 批量推理输出 */
export interface BatchModelOutput {
  outputs: ModelOutput[];
  batchSize: number;
  latencyMs: number;
}

export class IntuitionNet {
  embedding: Embedding;
  encoderBlocks: EncoderBlock[];
  heads: OutputHeads;
  config: NNConfig;

  /** TextEncoder 融合门控参数 */
  private gateW: Tensor;  // [hiddenDim, hiddenDim]
  private gateB: Tensor;  // [hiddenDim]

  /** Early Exit 置信度阈值（默认 0.85） */
  exitThreshold = 0.85;

  /** 反向传播缓存 */
  _cachedTokenIds: number[] | null = null;
  _cachedEncoderOut: Tensor | null = null;
  /** 批量推理时的 token IDs 缓存 */
  _cachedBatchTokenIds: number[][] | null = null;

  constructor(config: NNConfig) {
    this.config = config;
    this.embedding = new Embedding(config.vocabSize, config.embedDim);
    this.encoderBlocks = [];
    for (let i = 0; i < config.numLayers; i++) {
      this.encoderBlocks.push(new EncoderBlock(config.hiddenDim, config.numHeads, config.ffnDim));
    }
    if (this.config.embedDim !== this.config.hiddenDim) {
      // 确保 projWeight 在构造时就创建，这样 parameters() 始终包含它
      // 修复: 之前是 forward() 中惰性创建，导致 loadModel 时参数数量不匹配
      this._projWeight = randn([this.config.embedDim, this.config.hiddenDim],
        Math.sqrt(2 / (this.config.embedDim + this.config.hiddenDim)));
    }

    this.heads = new OutputHeads(config.hiddenDim, config.hiddenDim, config.numIntents, config.numTools);

    // TextEncoder 融合门控: gate = sigmoid(pooled @ gateW + gateB)
    this.gateW = randn([config.hiddenDim, config.hiddenDim],
      Math.sqrt(2 / (config.hiddenDim + config.hiddenDim)));
    this.gateB = zeros([config.hiddenDim]);
  }

  /**
   * 前向推理（batch=1，向后兼容）
   *
   * @param tokenIds 输入 token ID 序列
   * @returns 分类结果
   */
  forward(tokenIds: number[]): ModelOutput {
    const t0 = performance.now();

    // 缓存 token IDs 用于反向传播
    this._cachedTokenIds = tokenIds;
    this._cachedBatchTokenIds = null;

    // Embedding: [S] → [S, embedDim]
    let h = this.embedding.forward(tokenIds);

    // 如果 embedDim != hiddenDim，投影到 hiddenDim
    if (this.config.embedDim !== this.config.hiddenDim) {
      if (!this._projWeight) {
        this._projWeight = randn([this.config.embedDim, this.config.hiddenDim],
          Math.sqrt(2 / (this.config.embedDim + this.config.hiddenDim)));
      }
      h = matmul(h, this._projWeight);
    }

    // Encoder Blocks × N
    for (const block of this.encoderBlocks) {
      h = block.forward(h, true);
    }

    // 缓存 encoder 输出用于反向传播
    this._cachedEncoderOut = h;

    // 池化：取最后一个 token 的表示
    const lastToken = this._poolLast(h);

    // 输出头
    const { intent, tools, quality, spatial, scene } = this.heads.forward(lastToken);

    const latencyMs = performance.now() - t0;

    return {
      intentProbs: new Float32Array(intent.data),
      toolProbs: new Float32Array(tools.data),
      qualityScore: sigmoid(quality.data[0]),
      spatialProbs: new Float32Array(spatial.data),
      sceneProbs: new Float32Array(scene.data),
      latencyMs,
      _hidden: new Float32Array(lastToken.data),
    };
  }

  /**
   * 高性能推理（推理模式 + 对象池 + Early Exit）
   *
   * 与 forward() 输出一致，但：
   * 1. 跳过所有 _ctx 缓存（不需要反向传播）
   * 2. 使用对象池复用 Float32Array（减少 GC）
   * 3. Early Exit：简单任务在浅层就退出
   *
   * 注意：调用后中间 Tensor 的 buffer 已归还池，不要访问其 .data
   */
  forwardInference(tokenIds: number[]): ModelOutput {
    const t0 = performance.now();
    enterInferenceMode();

    try {
      // Embedding: [S] → [S, embedDim]
      let h = this.embedding.forward(tokenIds);

      // 投影到 hiddenDim
      if (this.config.embedDim !== this.config.hiddenDim) {
        h = matmul(h, this._projWeight!);
      }

      // Encoder Blocks × N（Early Exit）
      let exitedEarly = false;
      for (let i = 0; i < this.encoderBlocks.length; i++) {
        h = this.encoderBlocks[i].forward(h, true);

        // Early Exit：至少走 2 层，置信度足够高时提前退出
        if (i >= 1 && this.encoderBlocks.length > 2) {
          const pooled = this._poolLast(h);
          const intentOut = this.heads.intentHead.forward(pooled);
          const maxProb = Math.max(...intentOut.data);
          if (maxProb > this.exitThreshold) {
            exitedEarly = true;
            // 直接用这个 pooled 跑完剩余 heads
            const tools = this.heads.toolHead.forward(pooled);
            const quality = this.heads.qualityHead.forward(pooled);
            const spatial = this.heads.spatialHead.forward(pooled);
            const scene = this.heads.sceneHead.forward(pooled);

            return {
              intentProbs: new Float32Array(intentOut.data),
              toolProbs: new Float32Array(tools.data),
              qualityScore: sigmoid(quality.data[0]),
              spatialProbs: new Float32Array(spatial.data),
              sceneProbs: new Float32Array(scene.data),
              latencyMs: performance.now() - t0,
              _hidden: new Float32Array(pooled.data),
            };
          }
        }
      }

      // 完整路径：池化 → 5 个输出头
      const lastToken = this._poolLast(h);
      const { intent, tools, quality, spatial, scene } = this.heads.forward(lastToken);

      return {
        intentProbs: new Float32Array(intent.data),
        toolProbs: new Float32Array(tools.data),
        qualityScore: sigmoid(quality.data[0]),
        spatialProbs: new Float32Array(spatial.data),
        sceneProbs: new Float32Array(scene.data),
        latencyMs: performance.now() - t0,
        _hidden: new Float32Array(lastToken.data),
      };
    } finally {
      exitInferenceMode();
    }
  }

  /**
   * 快速推理 — 简单任务专用（Phase 4 深度优化）
   *
   * 在 forwardInference 基础上进一步压榨：
   * 1. 降低 Early Exit 阈值（0.60 vs 0.85）→ 更容易提前退出
   * 2. 跳过 spatial/scene 输出头 → 节省 2 个 MLP 前向
   * 3. 池化零拷贝 → 推理模式下直接切片，不分配新 Tensor
   *
   * 适用条件：complexity === 'simple' || input.length < 30
   * 收益：~40-60% 延迟降低（含 early exit 概率提升）
   */
  forwardInferenceFast(tokenIds: number[]): ModelOutput {
    const t0 = performance.now();
    enterInferenceMode();
    const FAST_EXIT_THRESHOLD = 0.60;

    try {
      // Embedding
      let h = this.embedding.forward(tokenIds);
      if (this.config.embedDim !== this.config.hiddenDim) {
        h = matmul(h, this._projWeight!);
      }

      const dModel = this.config.hiddenDim;
      const numBlocks = this.encoderBlocks.length;

      // Encoder Blocks（Early Exit，低阈值）
      let pooled: Float32Array | null = null;
      for (let i = 0; i < numBlocks; i++) {
        h = this.encoderBlocks[i].forward(h, true);

        // 至少走 2 层，且 blocks > 2 时才检查 early exit
        if (i >= 1 && numBlocks > 2) {
          // 零拷贝池化：直接切片最后一个 token，不分配新 Tensor
          const seqLen = h.shape[0];
          const off = (seqLen - 1) * dModel;
          const intentOut = this.heads.intentHead.forward(
            new Tensor(h.data.subarray(off, off + dModel), [1, dModel]),
          );
          const maxProb = Math.max(...intentOut.data);

          if (maxProb > FAST_EXIT_THRESHOLD) {
            // Early Exit：只跑 intent + tool + quality 三个 head，跳过 spatial/scene
            pooled = h.data.subarray(off, off + dModel);
            const pooledTensor = new Tensor(pooled, [1, dModel]);
            const tools = this.heads.toolHead.forward(pooledTensor);
            const quality = this.heads.qualityHead.forward(pooledTensor);

            return {
              intentProbs: new Float32Array(intentOut.data),
              toolProbs: new Float32Array(tools.data),
              qualityScore: sigmoid(quality.data[0]),
              spatialProbs: new Float32Array(this.config.numSpatialBins ?? 6), // 零填充
              sceneProbs: new Float32Array(this.config.numSceneNodes ?? 32),   // 零填充
              latencyMs: performance.now() - t0,
              _hidden: pooled ? new Float32Array(pooled) : undefined,
            };
          }
        }
      }

      // 完整路径（未 early exit）：跳过 spatial/scene heads
      const seqLen = h.shape[0];
      const off = (seqLen - 1) * dModel;
      const pooledTensor = new Tensor(h.data.subarray(off, off + dModel), [1, dModel]);
      const intent = this.heads.intentHead.forward(pooledTensor);
      const tools = this.heads.toolHead.forward(pooledTensor);
      const quality = this.heads.qualityHead.forward(pooledTensor);

      return {
        intentProbs: new Float32Array(intent.data),
        toolProbs: new Float32Array(tools.data),
        qualityScore: sigmoid(quality.data[0]),
        spatialProbs: new Float32Array(this.config.numSpatialBins ?? 6),
        sceneProbs: new Float32Array(this.config.numSceneNodes ?? 32),
        latencyMs: performance.now() - t0,
        _hidden: new Float32Array(h.data.subarray(off, off + dModel)),
      };
    } finally {
      exitInferenceMode();
    }
  }

  /**
   * 带 TextEncoder 的前向推理 — 门控加法融合
   *
   * 流程：
   * 1. 正常 forward 得到 pooled [1, hiddenDim]
   * 2. textEmbedding (来自 TextEncoder) 池化到 [1, hiddenDim]
   * 3. gate = sigmoid(pooled @ gateW + gateB)
   * 4. fused = pooled + gate * textPooled
   * 5. 输出头在 fused 上推理
   *
   * 零破坏：无 TextEncoder 时 fallback 到普通 forward
   */
  forwardWithText(
    tokenIds: number[],
    textEmbedding: Tensor,  // [S', outputDim] 来自 TextEncoder
  ): ModelOutput {
    const t0 = performance.now();

    // 1. 正常路径得到 pooled
    this._cachedTokenIds = tokenIds;
    let h = this.embedding.forward(tokenIds);
    if (this.config.embedDim !== this.config.hiddenDim) {
      if (!this._projWeight) {
        this._projWeight = randn([this.config.embedDim, this.config.hiddenDim],
          Math.sqrt(2 / (this.config.embedDim + this.config.hiddenDim)));
      }
      h = matmul(h, this._projWeight);
    }
    for (const block of this.encoderBlocks) {
      h = block.forward(h, true);
    }
    this._cachedEncoderOut = h;
    const pooled = this._poolLast(h); // [1, hiddenDim]

    // 2. TextEncoder 输出池化
    const textSeq = textEmbedding.shape[0];
    const textDim = textEmbedding.shape[1];
    const hiddenDim = this.config.hiddenDim;

    const textPooled = zeros([1, hiddenDim]);
    if (textDim === hiddenDim) {
      for (let s = 0; s < textSeq; s++) {
        const off = s * hiddenDim;
        for (let d = 0; d < hiddenDim; d++) {
          textPooled.data[d] += textEmbedding.data[off + d];
        }
      }
      for (let d = 0; d < hiddenDim; d++) textPooled.data[d] /= textSeq || 1;
    } else {
      const ratio = textDim / hiddenDim;
      for (let s = 0; s < textSeq; s++) {
        const off = s * textDim;
        for (let d = 0; d < hiddenDim; d++) {
          const start = Math.floor(d * ratio);
          const end = Math.floor((d + 1) * ratio);
          let sum = 0;
          for (let j = start; j < end && j < textDim; j++) {
            sum += textEmbedding.data[off + j];
          }
          textPooled.data[d] += sum / (end - start || 1);
        }
      }
      for (let d = 0; d < hiddenDim; d++) textPooled.data[d] /= textSeq || 1;
    }

    // 3. 门控: gate = sigmoid(pooled @ gateW + gateB)
    const gate = zeros([1, hiddenDim]);
    for (let d = 0; d < hiddenDim; d++) {
      let sum = this.gateB.data[d];
      for (let k = 0; k < hiddenDim; k++) {
        sum += pooled.data[k] * this.gateW.data[k * hiddenDim + d];
      }
      gate.data[d] = 1 / (1 + Math.exp(-sum));
    }

    // 4. 融合: fused = pooled + gate * textPooled
    const fused = zeros([1, hiddenDim]);
    for (let d = 0; d < hiddenDim; d++) {
      fused.data[d] = pooled.data[d] + gate.data[d] * textPooled.data[d];
    }

    // 5. 输出头
    const { intent, tools, quality, spatial, scene } = this.heads.forward(fused);

    return {
      intentProbs: new Float32Array(intent.data),
      toolProbs: new Float32Array(tools.data),
      qualityScore: sigmoid(quality.data[0]),
      spatialProbs: new Float32Array(spatial.data),
      sceneProbs: new Float32Array(scene.data),
      latencyMs: performance.now() - t0,
      _hidden: new Float32Array(fused.data),
    };
  }

  /**
   * 批量前向推理（batch > 1）
   *
   * @param batchTokenIds 批量输入 token ID 序列
   * @returns 批量分类结果
   */
  forwardBatch(batchTokenIds: number[][]): BatchModelOutput {
    const t0 = performance.now();
    const B = batchTokenIds.length;

    // 缓存用于反向传播
    this._cachedBatchTokenIds = batchTokenIds;
    this._cachedTokenIds = null;

    // 找最大序列长度，pad 到相同长度
    const maxLen = Math.max(...batchTokenIds.map(ids => ids.length));
    const padded: number[][] = batchTokenIds.map(ids => {
      const padded = new Array(maxLen).fill(0); // PAD=0
      for (let i = 0; i < ids.length; i++) padded[i] = ids[i];
      return padded;
    });

    // Embedding: [B, S] → [B, S, embedDim]
    let h = this.embedding.forwardBatch(padded);

    // 投影到 hiddenDim
    if (this.config.embedDim !== this.config.hiddenDim) {
      if (!this._projWeight) {
        this._projWeight = randn([this.config.embedDim, this.config.hiddenDim],
          Math.sqrt(2 / (this.config.embedDim + this.config.hiddenDim)));
      }
      // [B, S, embedDim] × [embedDim, hiddenDim] → [B, S, hiddenDim]
      h = batchMatmul(h, this._projWeight);
    }

    // Encoder Blocks × N（batch 路径）
    for (const block of this.encoderBlocks) {
      h = block.forward(h, true);
    }

    // 缓存 encoder 输出
    this._cachedEncoderOut = h;

    // 池化：每个 batch 取最后一个有效 token
    const lastTokens = this._poolLastBatch(h, batchTokenIds.map(ids => ids.length));

    // 逐条输出（因为输出头是 per-sample 的）
    const outputs: ModelOutput[] = [];
    for (let b = 0; b < B; b++) {
      const singleToken = this._extractSingle(lastTokens, b);
      const { intent, tools, quality, spatial, scene } = this.heads.forward(singleToken);
      outputs.push({
        intentProbs: new Float32Array(intent.data),
        toolProbs: new Float32Array(tools.data),
        qualityScore: sigmoid(quality.data[0]),
        spatialProbs: new Float32Array(spatial.data),
        sceneProbs: new Float32Array(scene.data),
        latencyMs: 0,
      });
    }

    const latencyMs = performance.now() - t0;
    for (const o of outputs) o.latencyMs = latencyMs / B;

    return { outputs, batchSize: B, latencyMs };
  }

  /** 获取所有可训练参数 */
  parameters(): Tensor[] {
    const params = [...this.embedding.parameters()];
    for (const block of this.encoderBlocks) {
      params.push(...block.parameters());
    }
    params.push(...this.heads.parameters());
    if (this._projWeight) params.push(this._projWeight);
    // TextEncoder 融合门控参数
    params.push(this.gateW, this.gateB);
    return params;
  }

  /** 统计参数量 */
  countParams(): number {
    let count = 0;
    for (const p of this.parameters()) count += p.size;
    return count;
  }

  /** 获取模型配置 */
  getConfig(): NNConfig {
    return { ...this.config };
  }

  /**
   * 扩展意图分类头 — L2 写回入口
   * 保留已有权重，新增类别用 Xavier 初始化
   */
  expandIntentHead(newNumIntents: number): void {
    if (newNumIntents <= this.config.numIntents) return;
    this.heads.expandIntentHead(newNumIntents);
    this.config.numIntents = newNumIntents;
  }

  // 内部
  private _projWeight: Tensor | null = null;

  /**
   * 池化：取最后一个 token 的表示
   * [S, dModel] → [1, dModel]
   */
  private _poolLast(h: Tensor): Tensor {
    const seqLen = h.shape[0];
    const dModel = h.shape[1];
    const out = zeros([1, dModel]);
    const off = (seqLen - 1) * dModel;
    for (let i = 0; i < dModel; i++) {
      out.data[i] = h.data[off + i];
    }
    out._ctx = { op: 'poolLast', saved: [seqLen], parents: [h] };
    return out;
  }

  /**
   * 批量池化：每个 batch 取最后一个有效 token
   * [B, S, dModel] → [B, dModel]
   */
  private _poolLastBatch(h: Tensor, seqLens: number[]): Tensor {
    const [B, S, dModel] = h.shape;
    const out = zeros([B, dModel]);
    for (let b = 0; b < B; b++) {
      const lastPos = Math.min(seqLens[b], S) - 1;
      const off = (b * S + lastPos) * dModel;
      const oOff = b * dModel;
      for (let i = 0; i < dModel; i++) {
        out.data[oOff + i] = h.data[off + i];
      }
    }
    out._ctx = { op: 'poolLast', saved: [B, S], parents: [h] };
    return out;
  }

  /**
   * 从 [B, dModel] 中提取第 b 个 batch → [1, dModel]
   */
  private _extractSingle(t: Tensor, b: number): Tensor {
    const [B, dModel] = t.shape;
    const out = zeros([1, dModel]);
    const off = b * dModel;
    for (let i = 0; i < dModel; i++) {
      out.data[i] = t.data[off + i];
    }
    return out;
  }
}
