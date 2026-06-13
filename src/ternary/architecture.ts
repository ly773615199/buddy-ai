/**
 * 三进制模型架构定义
 *
 * 定义从教师模型蒸馏到三进制小模型的网络结构。
 *
 * 架构：简化 Transformer
 * ┌────────────────────────────────────┐
 * │  Token Embedding (fp16)            │
 * │  ┌──────────────────────────────┐  │
 * │  │  Transformer Block × N       │  │
 * │  │  ├─ Multi-Head Attention     │  │
 * │  │  │  └─ Q/K/V 三进制投影      │  │
 * │  │  ├─ LayerNorm                │  │
 * │  │  ├─ FeedForward (LoRA)       │  │
- * │  │  │  └─ A@B 三进制分解       │  │
- * │  │  └─ LayerNorm               │  │
- * │  └──────────────────────────────┘  │
- │  Output Projection (fp16)           │
- │  Softmax                            │
- └────────────────────────────────────┘
 */

import type { TernaryModel, TernaryLayer, TernaryModelMeta } from './format.js';
import { createModelMeta, ARCHITECTURE_PRESETS } from './format.js';

// ── 架构配置 ──

export interface ArchitectureConfig {
  /** 预设名称 */
  name: string;
  /** 隐藏层维度 */
  hiddenSize: number;
  /** 注意力头数 */
  numHeads: number;
  /** Transformer 层数 */
  numLayers: number;
  /** FFN 中间维度 */
  ffnIntermediateSize: number;
  /** LoRA 秩 */
  rank: number;
  /** 最大序列长度 */
  maxSeqLen: number;
  /** 词表大小 */
  vocabSize: number;
  /** 目标参数量 */
  totalParams: number;
}

export const ARCHITECTURE_CONFIGS: Record<string, ArchitectureConfig> = {
  'tiny': {
    name: 'tiny',
    hiddenSize: 128,
    numHeads: 4,
    numLayers: 4,
    ffnIntermediateSize: 512,
    rank: 8,
    maxSeqLen: 512,
    vocabSize: 32000,
    totalParams: 10_000_000,
  },
  '100m': {
    name: '100m',
    hiddenSize: 768,
    numHeads: 12,
    numLayers: 12,
    ffnIntermediateSize: 3072,
    rank: 16,
    maxSeqLen: 2048,
    vocabSize: 32000,
    totalParams: 100_000_000,
  },
  '300m': {
    name: '300m',
    hiddenSize: 1024,
    numHeads: 16,
    numLayers: 16,
    ffnIntermediateSize: 4096,
    rank: 32,
    maxSeqLen: 2048,
    vocabSize: 32000,
    totalParams: 300_000_000,
  },
};

// ── 权重矩阵标识 ──

export interface WeightSpec {
  /** 权重名称 (如 "layer0.attn.q", "layer0.ffn.A") */
  name: string;
  /** 维度 */
  shape: [number, number];
  /** 类型 */
  type: 'ternary' | 'fp16';
  /** 所属层索引 (-1 = 全局) */
  layerIndex: number;
}

// ── 层配置 ──

export interface LayerConfig {
  /** 层索引 */
  index: number;
  /** 注意力 Q/K/V 三进制权重 */
  attnQ: WeightSpec;
  attnK: WeightSpec;
  attnV: WeightSpec;
  /** FFN LoRA 分解 */
  ffnA: WeightSpec;
  ffnB: WeightSpec;
  /** LayerNorm 参数 */
  ln1Gamma: WeightSpec;
  ln1Beta: WeightSpec;
  ln2Gamma: WeightSpec;
  ln2Beta: WeightSpec;
}

// ════════════════════════════════════════════════════════
// 三进制模型架构
// ════════════════════════════════════════════════════════

export class TernaryArchitecture {
  private config: ArchitectureConfig;

  constructor(archName: string = '100m') {
    const cfg = ARCHITECTURE_CONFIGS[archName];
    if (!cfg) {
      throw new Error(`Unknown architecture: ${archName}. Available: ${Object.keys(ARCHITECTURE_CONFIGS).join(', ')}`);
    }
    this.config = { ...cfg };
  }

  /**
   * 获取架构配置
   */
  getConfig(): ArchitectureConfig {
    return { ...this.config };
  }

  /**
   * 生成所有权重矩阵的规格
   */
  weightSpecs(): WeightSpec[] {
    const specs: WeightSpec[] = [];
    const { hiddenSize, numLayers, rank, ffnIntermediateSize, vocabSize } = this.config;

    // Embedding
    specs.push({
      name: 'embedding',
      shape: [vocabSize, hiddenSize],
      type: 'fp16',
      layerIndex: -1,
    });

    // 每层
    for (let l = 0; l < numLayers; l++) {
      // Attention Q/K/V
      for (const proj of ['q', 'k', 'v']) {
        specs.push({
          name: `layer${l}.attn.${proj}`,
          shape: [hiddenSize, hiddenSize],
          type: 'ternary',
          layerIndex: l,
        });
      }

      // FFN LoRA
      specs.push({
        name: `layer${l}.ffn.A`,
        shape: [hiddenSize, rank],
        type: 'ternary',
        layerIndex: l,
      });
      specs.push({
        name: `layer${l}.ffn.B`,
        shape: [rank, ffnIntermediateSize],
        type: 'ternary',
        layerIndex: l,
      });

      // LayerNorm
      for (const ln of ['ln1', 'ln2']) {
        specs.push({
          name: `layer${l}.${ln}.gamma`,
          shape: [1, hiddenSize],
          type: 'fp16',
          layerIndex: l,
        });
        specs.push({
          name: `layer${l}.${ln}.beta`,
          shape: [1, hiddenSize],
          type: 'fp16',
          layerIndex: l,
        });
      }
    }

    // Output projection
    specs.push({
      name: 'output_proj',
      shape: [hiddenSize, vocabSize],
      type: 'fp16',
      layerIndex: -1,
    });

    return specs;
  }

  /**
   * 计算总参数量
   */
  totalParams(): number {
    let total = 0;
    for (const spec of this.weightSpecs()) {
      total += spec.shape[0] * spec.shape[1];
    }
    return total;
  }

  /**
   * 计算三进制参数量
   */
  ternaryParams(): number {
    let total = 0;
    for (const spec of this.weightSpecs()) {
      if (spec.type === 'ternary') {
        total += spec.shape[0] * spec.shape[1];
      }
    }
    return total;
  }

  /**
   * 三进制权重占比
   */
  ternaryRatio(): number {
    const total = this.totalParams();
    return total > 0 ? this.ternaryParams() / total : 0;
  }

  /**
   * 创建空模型实例
   */
  createModel(domain: string): TernaryModel {
    const meta = createModelMeta(domain, {
      architecture: `ternary-transformer-${this.config.name}`,
      inFeatures: this.config.hiddenSize,
      outFeatures: this.config.hiddenSize,
      rank: this.config.rank,
      numLayers: this.config.numLayers,
      totalParams: this.totalParams(),
    });

    const layers: TernaryLayer[] = [];
    for (let l = 0; l < this.config.numLayers; l++) {
      // 简化：合并 Attention + FFN 为 LoRA 分解
      layers.push({
        layerIndex: l,
        A: new Int8Array(this.config.hiddenSize * this.config.rank),
        B: new Int8Array(this.config.rank * this.config.hiddenSize),
      });
    }

    return { meta, layers };
  }

  /**
   * 从预设创建
   */
  static fromPreset(presetName: string): TernaryArchitecture {
    return new TernaryArchitecture(presetName);
  }

  /**
   * 列出可用架构
   */
  static listArchitectures(): string[] {
    return Object.keys(ARCHITECTURE_CONFIGS);
  }
}
