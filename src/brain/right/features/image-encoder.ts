/**
 * 图像编码器 — Image Encoder
 *
 * 基于 ViT (ICLR 2021) 的 Patch Embedding 思路：
 * 将图片分割为 patches → 每个 patch 映射为 token ID
 *
 * 纯 CPU 实现，不依赖任何图像处理库
 * 输入：像素数组（RGBA）或灰度值
 * 输出：token ID 序列
 *
 * Token ID 范围：450-549（image patch IDs）
 */

// ==================== 常量 ====================

const IMAGE_TOKEN_START = 450;
const IMAGE_TOKEN_END = 549;
const MAX_PATCHES = 100; // 10×10 网格

/** 2D Position Encoding（sinusoidal） */
const POSITION_ENCODE_DIM = 16;

// ==================== 类型 ====================

/** 原始图片数据 */
export interface RawImage {
  /** 像素数据（RGBA 或 灰度） */
  data: Uint8Array | Uint8ClampedArray;
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
  /** 通道数（1=灰度, 3=RGB, 4=RGBA） */
  channels: number;
}

/** Patch 数据 */
export interface Patch {
  /** patch 索引 */
  index: number;
  /** 行 */
  row: number;
  /** 列 */
  col: number;
  /** 平均颜色（灰度值 0-255 或 RGB 均值） */
  avgColor: number;
  /** 颜色方差（纹理复杂度） */
  variance: number;
  /** 边缘强度 */
  edgeStrength: number;
}

/** 图像编码配置 */
export interface ImageEncoderConfig {
  /** patch 网格大小（gridSize × gridSize） */
  gridSize: number;
  /** 是否使用位置编码 */
  usePositionEncoding: boolean;
  /** 颜色量化 bins */
  colorBins: number;
  /** 方差量化 bins */
  varianceBins: number;
  /** 边缘量化 bins */
  edgeBins: number;
}

const DEFAULT_CONFIG: ImageEncoderConfig = {
  gridSize: 10,
  usePositionEncoding: true,
  colorBins: 16,
  varianceBins: 8,
  edgeBins: 8,
};

// ==================== 编码函数 ====================

/**
 * 将图片编码为 token ID 序列
 *
 * 编码结构：
 * [patch_0_color] [patch_0_var] [patch_0_edge] [patch_0_pos_x] [patch_0_pos_y]
 * [patch_1_color] [patch_1_var] [patch_1_edge] [patch_1_pos_x] [patch_1_pos_y]
 * ...
 *
 * 每个 patch 产生 5 个 token
 */
export function encodeImage(image: RawImage, config?: Partial<ImageEncoderConfig>): number[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const patches = extractPatches(image, cfg.gridSize);
  const tokens: number[] = [];

  for (const patch of patches) {
    // 颜色 token (450-465)
    tokens.push(IMAGE_TOKEN_START + quantize(patch.avgColor, 256, cfg.colorBins));
    // 方差 token (466-473)
    tokens.push(IMAGE_TOKEN_START + cfg.colorBins + quantize(patch.variance, 256, cfg.varianceBins));
    // 边缘 token (474-481)
    tokens.push(IMAGE_TOKEN_START + cfg.colorBins + cfg.varianceBins + quantize(patch.edgeStrength, 256, cfg.edgeBins));

    // 位置编码（可选）
    if (cfg.usePositionEncoding) {
      const posTokens = encodePosition(patch.row, patch.col, cfg.gridSize);
      tokens.push(...posTokens);
    }
  }

  return tokens;
}

/**
 * 提取图片 patches
 */
export function extractPatches(image: RawImage, gridSize: number): Patch[] {
  const patches: Patch[] = [];
  const patchW = Math.floor(image.width / gridSize);
  const patchH = Math.floor(image.height / gridSize);

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const patch = analyzePatch(image, col * patchW, row * patchH, patchW, patchH);
      patches.push({
        index: row * gridSize + col,
        row,
        col,
        ...patch,
      });
    }
  }

  return patches;
}

/**
 * 分析单个 patch 的特征
 */
function analyzePatch(
  image: RawImage,
  startX: number,
  startY: number,
  width: number,
  height: number,
): { avgColor: number; variance: number; edgeStrength: number } {
  const { data, channels } = image;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  let edgeSum = 0;

  for (let y = startY; y < startY + height && y < image.height; y++) {
    for (let x = startX; x < startX + width && x < image.width; x++) {
      const idx = (y * image.width + x) * channels;
      // 灰度值（RGB 取均值，灰度直接用）
      let gray: number;
      if (channels >= 3) {
        gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      } else {
        gray = data[idx];
      }

      sum += gray;
      sumSq += gray * gray;
      count++;

      // 简单边缘检测（与右邻像素差）
      if (x < startX + width - 1) {
        const nextIdx = (y * image.width + x + 1) * channels;
        let nextGray: number;
        if (channels >= 3) {
          nextGray = (data[nextIdx] + data[nextIdx + 1] + data[nextIdx + 2]) / 3;
        } else {
          nextGray = data[nextIdx];
        }
        edgeSum += Math.abs(gray - nextGray);
      }
    }
  }

  const avgColor = count > 0 ? sum / count : 0;
  const variance = count > 0 ? (sumSq / count) - (avgColor * avgColor) : 0;
  const edgeStrength = count > 0 ? edgeSum / count : 0;

  return {
    avgColor: Math.max(0, Math.min(255, avgColor)),
    variance: Math.max(0, Math.min(255, Math.sqrt(Math.max(0, variance)))),
    edgeStrength: Math.max(0, Math.min(255, edgeStrength)),
  };
}

/**
 * 2D 位置编码（sinusoidal）
 *
 * 将 (row, col) 编码为 token IDs
 * 使用离散化的 sin/cos 值
 */
function encodePosition(row: number, col: number, gridSize: number): number[] {
  const tokens: number[] = [];

  // 行编码：sin(row / gridSize * π) → 离散化为 token
  const rowSin = Math.sin(row / gridSize * Math.PI);
  const rowCos = Math.cos(row / gridSize * Math.PI);
  tokens.push(IMAGE_TOKEN_START + 82 + quantize((rowSin + 1) / 2, 1, 8)); // 482-489
  tokens.push(IMAGE_TOKEN_START + 90 + quantize((rowCos + 1) / 2, 1, 8)); // 490-497

  // 列编码
  const colSin = Math.sin(col / gridSize * Math.PI);
  const colCos = Math.cos(col / gridSize * Math.PI);
  tokens.push(IMAGE_TOKEN_START + 98 + quantize((colSin + 1) / 2, 1, 2)); // 498-499

  return tokens;
}

/**
 * 量化：将 [0, max] 范围的值离散化为 [0, bins-1]
 */
function quantize(value: number, max: number, bins: number): number {
  const normalized = Math.max(0, Math.min(max, value)) / max;
  return Math.min(bins - 1, Math.floor(normalized * bins));
}

// ==================== 工具函数 ====================

/**
 * 获取图像 token 范围
 */
export function getImageTokenRange(): { start: number; end: number } {
  return { start: IMAGE_TOKEN_START, end: IMAGE_TOKEN_END };
}

/**
 * 从文件路径加载图片（简化版，仅支持 PGM 灰度格式）
 * 实际使用时应通过外部工具获取像素数据
 */
export function createImageFromGrayscale(
  pixels: number[][],
): RawImage {
  const height = pixels.length;
  const width = pixels[0]?.length ?? 0;
  const data = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[y * width + x] = Math.max(0, Math.min(255, pixels[y][x]));
    }
  }

  return { data, width, height, channels: 1 };
}
