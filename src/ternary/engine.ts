/**
 * 三进制推理引擎
 *
 * 加载 .ta 模型，执行 Transformer 前向传播，流式生成文本。
 * 纯 CPU 整数运算，无需 GPU。
 */

import type { TernaryModel, TernaryLayer, TernaryModelMeta } from './format.js';
import {
  matVecMul, loraForward, softmax, layerNorm, gelu,
  argmax, topPSample,
} from './compute.js';
import { TernaryTokenizer } from './tokenizer.js';
import { decode as decodeTA } from './codec.js';

// ── KV Cache ──

interface KVCacheEntry {
  key: Float32Array;
  value: Float32Array;
}

interface KVCache {
  entries: Map<number, KVCacheEntry[]>; // layerIndex → entries
  maxLen: number;
}

function createKVCache(maxLen: number): KVCache {
  return { entries: new Map(), maxLen };
}

// ── 推理统计 ──

export interface EngineStats {
  /** 生成速度 (tokens/sec) */
  tokPerSec: number;
  /** 内存占用 (MB) */
  memoryMB: number;
  /** 首 token 延迟 (ms) */
  firstTokenMs: number;
  /** 总生成 token 数 */
  totalTokens: number;
  /** 模型参数量 */
  totalParams: number;
}

// ── 生成配置 ──

export interface GenerateConfig {
  maxTokens: number;
  temperature: number;
  topP: number;
  stopSequences: string[];
}

const DEFAULT_GENERATE: GenerateConfig = {
  maxTokens: 256,
  temperature: 0.7,
  topP: 0.9,
  stopSequences: [],
};

// ════════════════════════════════════════════════════════
// 推理引擎
// ════════════════════════════════════════════════════════

export class TernaryEngine {
  private model: TernaryModel | null = null;
  private tokenizer: TernaryTokenizer;
  private kvCache: KVCache | null = null;
  private stats: EngineStats = {
    tokPerSec: 0,
    memoryMB: 0,
    firstTokenMs: 0,
    totalTokens: 0,
    totalParams: 0,
  };

  constructor() {
    this.tokenizer = new TernaryTokenizer();
  }

  /**
   * 加载模型（从 .ta 文件）
   */
  async load(modelPath: string): Promise<void> {
    const fs = await import('fs/promises');
    const buffer = await fs.readFile(modelPath);
    this.model = decodeTA(buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ));

    this.kvCache = createKVCache(2048);
    this.stats.totalParams = this.model.meta.totalParams;

    // 内存估算
    let memBytes = buffer.length;
    for (const layer of this.model.layers) {
      memBytes += layer.A.length * 4; // Float32 working memory
      memBytes += layer.B.length * 4;
    }
    this.stats.memoryMB = Math.round(memBytes / (1024 * 1024));

    // 初始化 tokenizer
    this.tokenizer.initBuiltin();
  }

  /**
   * 从内存加载模型
   */
  loadFromModel(model: TernaryModel): void {
    this.model = model;
    this.kvCache = createKVCache(2048);
    this.stats.totalParams = model.meta.totalParams;
    this.tokenizer.initBuiltin();
  }

  /**
   * 卸载模型
   */
  unload(): void {
    this.model = null;
    this.kvCache = null;
  }

  /**
   * 是否已加载
   */
  get isLoaded(): boolean {
    return this.model !== null;
  }

  /**
   * 模型元数据
   */
  get meta(): TernaryModelMeta | null {
    return this.model?.meta ?? null;
  }

  /**
   * 单步解码：token ID → logits → 下一个 token ID
   */
  decode(tokenId: number): { logits: Float32Array; nextToken: number } {
    this.ensureLoaded();
    const model = this.model!;

    // 将 token ID 转为 one-hot-like 输入向量
    const hiddenSize = model.meta.inFeatures;
    let hidden: Float32Array<ArrayBufferLike> = new Float32Array(hiddenSize);

    // 简化：token embedding (实际应有 embedding 矩阵)
    // 这里用 token ID 的哈希作为嵌入的近似
    this.tokenEmbed(tokenId, hidden);

    // Transformer 层
    for (let l = 0; l < model.layers.length; l++) {
      hidden = this.forwardLayer(hidden, model.layers[l], l);
    }

    // 输出投影到词表（简化：取前 vocabSize 个维度）
    const logits = new Float32Array(Math.min(hiddenSize, 32000));
    logits.set(hidden.subarray(0, logits.length));

    const nextToken = topPSample(logits, 0.9, 0.7);
    return { logits, nextToken };
  }

  /**
   * 流式生成
   */
  async *generate(
    prompt: string,
    config?: Partial<GenerateConfig>,
  ): AsyncIterable<string> {
    const cfg = { ...DEFAULT_GENERATE, ...config };
    this.ensureLoaded();

    const startTime = performance.now();
    let firstTokenTime = 0;
    let tokenCount = 0;

    // 编码 prompt
    const inputIds = this.tokenizer.encode(prompt);
    let currentToken = inputIds[inputIds.length - 1];

    // 生成循环
    for (let step = 0; step < cfg.maxTokens; step++) {
      const { nextToken } = this.decode(currentToken);

      if (step === 0) {
        firstTokenTime = performance.now() - startTime;
      }

      // 解码为文本
      const text = this.tokenizer.decode([nextToken]);

      // 检查停止条件
      if (nextToken === this.tokenizer.vocabSize - 1) break; // EOS-like
      if (cfg.stopSequences.some(s => text.includes(s))) break;

      yield text;

      currentToken = nextToken;
      tokenCount++;
    }

    // 更新统计
    const elapsed = (performance.now() - startTime) / 1000;
    this.stats.firstTokenMs = Math.round(firstTokenTime);
    this.stats.tokPerSec = elapsed > 0 ? Math.round(tokenCount / elapsed) : 0;
    this.stats.totalTokens += tokenCount;
  }

  /**
   * 非流式生成（完整结果）
   */
  async complete(
    prompt: string,
    config?: Partial<GenerateConfig>,
  ): Promise<string> {
    const parts: string[] = [];
    for await (const chunk of this.generate(prompt, config)) {
      parts.push(chunk);
    }
    return parts.join('');
  }

  /**
   * 带统计信息的推理：返回生成文本 + 置信度
   * 置信度 = 所有生成 token 的 softmax 概率均值
   */
  async completeWithStats(
    prompt: string,
    config?: Partial<GenerateConfig>,
  ): Promise<{ text: string; confidence: number }> {
    const cfg = { ...DEFAULT_GENERATE, ...config };
    this.ensureLoaded();

    const inputIds = this.tokenizer.encode(prompt);
    let currentToken = inputIds[inputIds.length - 1];

    const parts: string[] = [];
    let confidenceSum = 0;
    let tokenCount = 0;

    for (let step = 0; step < cfg.maxTokens; step++) {
      const { logits, nextToken } = this.decode(currentToken);

      // 计算置信度: softmax 后选中 token 的概率
      const probs = softmax(logits);
      confidenceSum += probs[nextToken];
      tokenCount++;

      const text = this.tokenizer.decode([nextToken]);
      if (nextToken === this.tokenizer.vocabSize - 1) break;
      if (cfg.stopSequences.some(s => text.includes(s))) break;

      parts.push(text);
      currentToken = nextToken;
    }

    return {
      text: parts.join(''),
      confidence: tokenCount > 0 ? confidenceSum / tokenCount : 0,
    };
  }

  /**
   * 获取统计信息
   */
  getStats(): EngineStats {
    return { ...this.stats };
  }

  // ── 内部方法 ──

  /**
   * 单个 Transformer 层的前向传播
   *
   * 简化流程: LayerNorm → Attention → Residual → LayerNorm → FFN → Residual
   */
  private forwardLayer(
    hidden: Float32Array,
    layer: TernaryLayer,
    layerIndex: number,
  ): Float32Array {
    const size = hidden.length;
    const rank = this.model!.meta.rank;

    // 简化：用 LoRA 分解代替完整注意力 + FFN
    // LoRA: output = hidden + scale * A @ B @ hidden

    const loraOut = loraForward(
      layer.A, layer.B, hidden,
      size, rank, size,
    );

    // 残差连接
    const result = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      result[i] = hidden[i] + loraOut[i] * 0.1; // 缩放因子
    }

    // 简化 LayerNorm（避免 NaN）
    let mean = 0;
    for (let i = 0; i < size; i++) mean += result[i];
    mean /= size;
    let var_ = 0;
    for (let i = 0; i < size; i++) {
      const d = result[i] - mean;
      var_ += d * d;
    }
    var_ /= size;
    const invStd = 1 / Math.sqrt(var_ + 1e-5);
    for (let i = 0; i < size; i++) {
      result[i] = (result[i] - mean) * invStd;
    }

    return result;
  }

  /**
   * Token 嵌入（简化实现）
   *
   * ⚠️ 当前使用哈希生成伪嵌入，仅用于流程验证。
   * 生产环境必须由蒸馏流程生成真正的 embedding 矩阵。
   * 使用伪嵌入时，推理输出无实际语义意义。
   */
  private tokenEmbed(tokenId: number, output: Float32Array): void {
    // 使用简单的伪随机填充，保证相同 token 产生相同嵌入
    let seed = tokenId * 2654435761; // Knuth multiplicative hash
    for (let i = 0; i < output.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      output[i] = ((seed / 0x7fffffff) - 0.5) * 0.02; // 小随机值
    }
  }

  private ensureLoaded(): void {
    if (!this.model) {
      throw new Error('TernaryEngine: model not loaded. Call load() first.');
    }
  }
}
