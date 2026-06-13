/**
 * .ta (Ternary Archive) 格式规范
 *
 * 三进制模型的二进制存储格式。
 * 权重取值 {-1, 0, 1}，用 2-bit 编码存储。
 *
 * 文件布局:
 * ┌──────────────────────────────────────────┐
 * │  HeaderLen: 4 bytes (uint32 LE)          │
 * │  HeaderJSON: HeaderLen bytes (UTF-8)     │
 * │  Layer0 A matrix: packed 2-bit           │
 * │  Layer0 B matrix: packed 2-bit           │
 * │  Layer0 offsets: fp16 (optional)         │
 * │  Layer1 ...                              │
 * │  SHA-256 checksum: 32 bytes              │
 * └──────────────────────────────────────────┘
 */

// ── 模型元数据 ──

export type GrowthStage = 'seed' | 'sprout' | 'growing' | 'trainable' | 'mature';

export interface TernaryModelMeta {
  /** 格式版本 */
  version: string;
  /** 领域名 (如 "Go开发", "法务") */
  domain: string;
  /** 蒸馏来源的大模型标识 */
  baseModel: string;
  /** 模型架构标识 */
  architecture: string;
  /** 输入特征维度 */
  inFeatures: number;
  /** 输出特征维度 */
  outFeatures: number;
  /** LoRA 秩 */
  rank: number;
  /** Transformer 层数 */
  numLayers: number;
  /** 基座量化位宽 */
  quantBits: number;
  /** 三值化阈值 */
  threshold: number;
  /** 总参数量 */
  totalParams: number;
  /** 成长阶段 */
  growthStage: GrowthStage;
  /** 累计训练步数 */
  trainSteps: number;
  /** 上次更新时间 (ms since epoch) */
  lastUpdated: number;
  /** 文件 SHA-256 校验和 (写入时可为空) */
  checksum: string;
}

// ── 单层权重 ──

export interface TernaryLayer {
  /** 层索引 */
  layerIndex: number;
  /** A 矩阵: 三进制 {-1,0,1}，维度 inFeatures × rank */
  A: Int8Array;
  /** B 矩阵: 三进制 {-1,0,1}，维度 rank × outFeatures */
  B: Int8Array;
  /** 缩放因子 (fp16)，可选 */
  scales?: Float32Array;
  /** 偏移因子 (fp16)，维度 numGroups × outFeatures，可选 */
  offsets?: Float32Array;
}

// ── 完整模型 ──

export interface TernaryModel {
  meta: TernaryModelMeta;
  layers: TernaryLayer[];
}

// ── 常量 ──

/** 格式版本 */
export const TA_FORMAT_VERSION = '1.0.0';

/** 2-bit 编码映射 */
export const TERNARY_DECODE: Record<number, number> = {
  0b00: 0,
  0b01: 1,
  0b10: -1,
  // 0b11 保留
};

export const TERNARY_ENCODE: Record<number, number> = {
  0: 0b00,
  1: 0b01,
  [-1]: 0b10,
};

/** 预设架构 */
export const ARCHITECTURE_PRESETS: Record<string, {
  hiddenSize: number;
  numLayers: number;
  totalParams: number;
}> = {
  'ternary-transformer-100m': { hiddenSize: 768, numLayers: 12, totalParams: 100_000_000 },
  'ternary-transformer-300m': { hiddenSize: 1024, numLayers: 16, totalParams: 300_000_000 },
  'ternary-transformer-1b':   { hiddenSize: 2048, numLayers: 24, totalParams: 1_000_000_000 },
};

// ── 工厂函数 ──

/**
 * 创建空的模型元数据
 */
export function createModelMeta(domain: string, overrides?: Partial<TernaryModelMeta>): TernaryModelMeta {
  return {
    version: TA_FORMAT_VERSION,
    domain,
    baseModel: '',
    architecture: 'ternary-transformer-100m',
    inFeatures: 768,
    outFeatures: 768,
    rank: 16,
    numLayers: 12,
    quantBits: 4,
    threshold: 0.05,
    totalParams: 100_000_000,
    growthStage: 'seed',
    trainSteps: 0,
    lastUpdated: Date.now(),
    checksum: '',
    ...overrides,
  };
}

/**
 * 计算单层参数量
 */
export function layerParamCount(inFeatures: number, rank: number, outFeatures: number): number {
  return inFeatures * rank + rank * outFeatures;
}

/**
 * 计算模型总参数量（LoRA 分解）
 */
export function modelParamCount(
  inFeatures: number, rank: number, outFeatures: number, numLayers: number
): number {
  return layerParamCount(inFeatures, rank, outFeatures) * numLayers;
}
