/**
 * 空间编码器 — Spatial Encoder
 *
 * 基于 CoordConv (NeurIPS 2018) 思路：
 * 将空间坐标离散化为 token IDs，追加到输入序列
 *
 * 支持：
 * - 2D/3D 坐标编码
 * - 相对位置关系（上/下/左/右/内/外）
 * - 尺寸编码（宽/高/深度）
 *
 * Token ID 范围：400-449（空间坐标 bins）
 */

import type { TaskSignal, ResourceState, BodyState } from '../../types.js';

// ==================== 常量 ====================

/** Token ID 起始位置 */
const SPATIAL_TOKEN_START = 400;
const SPATIAL_TOKEN_END = 449;

/** 坐标 bin 数量 */
const NUM_BINS = 50;

/** 方向 token */
const DIRECTION_TOKENS: Record<string, number> = {
  'left': 440,
  'right': 441,
  'above': 442,
  'below': 443,
  'inside': 444,
  'outside': 445,
  'near': 446,
  'far': 447,
  'center': 448,
  'overlapping': 449,
};

// ==================== 类型 ====================

/** 2D 坐标 */
export interface Point2D {
  x: number; // 0-1 归一化
  y: number;
}

/** 3D 坐标 */
export interface Point3D {
  x: number;
  y: number;
  z: number;
}

/** 边界框 */
export interface BoundingBox {
  x: number;      // 中心 x (0-1)
  y: number;      // 中心 y (0-1)
  w: number;      // 宽度 (0-1)
  h: number;      // 高度 (0-1)
  z?: number;     // 深度 (0-1)
  d?: number;     // 深度尺寸
}

/** 空间物体 */
export interface SpatialObject {
  id: string;
  label: string;
  bbox: BoundingBox;
  confidence: number;
}

/** 空间关系 */
export interface SpatialRelation {
  source: string;
  target: string;
  direction: string; // DIRECTION_TOKENS 的 key
}

/** 编码输入 */
export interface SpatialEncodeInput {
  /** 物体列表 */
  objects?: SpatialObject[];
  /** 空间关系 */
  relations?: SpatialRelation[];
  /** 关注区域（归一化坐标） */
  focusArea?: BoundingBox;
  /** 画布/屏幕尺寸（用于归一化） */
  canvasWidth?: number;
  canvasHeight?: number;
}

// ==================== 编码函数 ====================

/**
 * 将空间信息编码为 token ID 序列
 *
 * 编码结构：
 * [objects...] [SEP] [relations...] [SEP] [focus_area]
 *
 * 每个物体：[label_id] [x_bin] [y_bin] [w_bin] [h_bin]
 * 每个关系：[source_id] [direction] [target_id]
 */
export function encodeSpatial(input: SpatialEncodeInput): number[] {
  const tokens: number[] = [];

  // 编码物体
  if (input.objects) {
    for (const obj of input.objects.slice(0, 8)) { // 最多 8 个物体
      // 标签 token（用 1 作为 UNK，实际应查标签表）
      tokens.push(labelToToken(obj.label));
      // 位置 + 尺寸
      tokens.push(coordToToken(obj.bbox.x));
      tokens.push(coordToToken(obj.bbox.y));
      tokens.push(sizeToToken(obj.bbox.w));
      tokens.push(sizeToToken(obj.bbox.h));
      if (obj.bbox.z !== undefined) {
        tokens.push(coordToToken(obj.bbox.z));
      }
    }
  }
  tokens.push(3); // SEP

  // 编码空间关系
  if (input.relations) {
    for (const rel of input.relations.slice(0, 12)) { // 最多 12 个关系
      tokens.push(labelToToken(rel.source));
      tokens.push(DIRECTION_TOKENS[rel.direction] ?? DIRECTION_TOKENS.near);
      tokens.push(labelToToken(rel.target));
    }
  }
  tokens.push(3); // SEP

  // 编码关注区域
  if (input.focusArea) {
    tokens.push(coordToToken(input.focusArea.x));
    tokens.push(coordToToken(input.focusArea.y));
    tokens.push(sizeToToken(input.focusArea.w));
    tokens.push(sizeToToken(input.focusArea.h));
  }
  tokens.push(3); // SEP

  return tokens;
}

/**
 * 编码单个坐标点（2D）
 */
export function encodePoint2D(point: Point2D): number[] {
  return [coordToToken(point.x), coordToToken(point.y)];
}

/**
 * 编码单个坐标点（3D）
 */
export function encodePoint3D(point: Point3D): number[] {
  return [coordToToken(point.x), coordToToken(point.y), coordToToken(point.z)];
}

/**
 * 编码边界框
 */
export function encodeBBox(bbox: BoundingBox): number[] {
  const tokens = [
    coordToToken(bbox.x),
    coordToToken(bbox.y),
    sizeToToken(bbox.w),
    sizeToToken(bbox.h),
  ];
  if (bbox.z !== undefined) tokens.push(coordToToken(bbox.z));
  if (bbox.d !== undefined) tokens.push(sizeToToken(bbox.d));
  return tokens;
}

/**
 * 计算两个物体的空间关系
 */
export function computeRelation(a: BoundingBox, b: BoundingBox): string {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // 重叠检测
  const overlapX = Math.max(0, Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2));
  const overlapY = Math.max(0, Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2));
  if (overlapX > 0 && overlapY > 0) return 'overlapping';

  // 方向判断
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? 'right' : 'left';
  } else {
    return dy > 0 ? 'below' : 'above';
  }
}

// ==================== 内部 ====================

/**
 * 坐标 (0-1) → token ID (400-439)
 * 40 个 bins，每 bin 覆盖 0.025
 */
function coordToToken(value: number): number {
  const bin = Math.floor(Math.max(0, Math.min(1, value)) * 40);
  return SPATIAL_TOKEN_START + Math.min(bin, 39);
}

/**
 * 尺寸 (0-1) → token ID (400-439)
 * 与坐标共用同一范围，语义由上下文区分
 */
function sizeToToken(value: number): number {
  const bin = Math.floor(Math.max(0, Math.min(1, value)) * 40);
  return SPATIAL_TOKEN_START + Math.min(bin, 39);
}

/**
 * 标签 → token ID
 * 简单哈希映射到 1-39 范围（避开 PAD=0, UNK=1, CLS=2, SEP=3）
 */
function labelToToken(label: string): number {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = ((hash << 5) - hash) + label.charCodeAt(i);
    hash = hash & hash;
  }
  return 4 + (Math.abs(hash) % 36); // 4-39
}

// ==================== 工具函数 ====================

/**
 * 获取空间 token 范围
 */
export function getSpatialTokenRange(): { start: number; end: number } {
  return { start: SPATIAL_TOKEN_START, end: SPATIAL_TOKEN_END };
}

/**
 * 获取方向 token 映射
 */
export function getDirectionTokens(): Record<string, number> {
  return { ...DIRECTION_TOKENS };
}
