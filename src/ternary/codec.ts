/**
 * 三进制编解码器 — 2-bit 打包/解包 + .ta 文件读写
 *
 * 编码规则:
 *   0  → 00
 *   +1 → 01
 *   -1 → 10
 *   11 → 保留
 *
 * 4 个三进制值打包为 1 字节（高位在前）。
 */

import * as crypto from 'crypto';
import type {
  TernaryModel, TernaryModelMeta, TernaryLayer,
} from './format.js';
import {
  TA_FORMAT_VERSION, TERNARY_ENCODE, TERNARY_DECODE,
} from './format.js';

// ────────────────────────────────────────────
// 2-bit 打包/解包
// ────────────────────────────────────────────

/**
 * 将 Int8Array ({-1,0,1}) 打包为 2-bit Uint8Array
 * 4 个值 → 1 字节，高位在前
 *
 * 优化：批量处理，每 4 个值一次位运算
 */
export function pack(ternary: Int8Array): Uint8Array {
  const len = ternary.length;
  const packedLen = (len + 3) >>> 2;
  const packed = new Uint8Array(packedLen);

  // 预计算编码查找（避免重复对象访问）
  // encode[0]=0, encode[1]=1, encode[-1]=2
  // 直接用: val === 0 ? 0 : val === 1 ? 1 : 2

  let i = 0;
  const end = len - 3;

  // 每次处理 4 个值 → 1 字节
  for (; i < end; i += 4) {
    const v0 = ternary[i] === 0 ? 0 : ternary[i] === 1 ? 1 : 2;
    const v1 = ternary[i + 1] === 0 ? 0 : ternary[i + 1] === 1 ? 1 : 2;
    const v2 = ternary[i + 2] === 0 ? 0 : ternary[i + 2] === 1 ? 1 : 2;
    const v3 = ternary[i + 3] === 0 ? 0 : ternary[i + 3] === 1 ? 1 : 2;
    packed[i >>> 2] = (v0 << 6) | (v1 << 4) | (v2 << 2) | v3;
  }

  // 处理剩余
  if (i < len) {
    let byte = 0;
    for (let j = 0; i < len; i++, j++) {
      const v = ternary[i] === 0 ? 0 : ternary[i] === 1 ? 1 : 2;
      byte |= v << ((3 - j) * 2);
    }
    packed[packedLen - 1] = byte;
  }

  return packed;
}

/**
 * 将 2-bit 打包数据解包为 Int8Array ({-1,0,1})
 *
 * 优化：用 Uint8Array 直接构建（避免 Int8Array 的负数开销），再转换
 */

// ────────────────────────────────────────────
// .ta 文件编码/解码
// ────────────────────────────────────────────

/** Header JSON 后面紧跟的二进制 marker，用于校验对齐 */
const TA_MAGIC = new Uint8Array([0x54, 0x41, 0x01, 0x00]); // "TA\1\0"

/**
 * 将 TernaryModel 编码为 .ta 二进制 ArrayBuffer
 */
export function encode(model: TernaryModel): ArrayBuffer {
  const meta = { ...model.meta, version: TA_FORMAT_VERSION, lastUpdated: Date.now() };
  const headerJson = JSON.stringify(meta);
  const headerBytes = new TextEncoder().encode(headerJson);

  // 先计算总大小
  let totalSize = 4; // headerLen (uint32)
  totalSize += headerBytes.length;
  totalSize += TA_MAGIC.length;

  for (const layer of model.layers) {
    const aPacked = pack(layer.A);
    const bPacked = pack(layer.B);
    totalSize += 4 + aPacked.length;  // aLen + aData
    totalSize += 4 + bPacked.length;  // bLen + bData
    totalSize += 4;                   // flags (hasScales, hasOffsets)

    if (layer.scales) {
      totalSize += 4 + layer.scales.length * 4; // scaleLen + float32 data
    }
    if (layer.offsets) {
      totalSize += 4 + layer.offsets.length * 4;
    }
  }

  totalSize += 32; // SHA-256 checksum

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;

  // 1. Header length
  view.setUint32(offset, headerBytes.length, true);
  offset += 4;

  // 2. Header JSON
  bytes.set(headerBytes, offset);
  offset += headerBytes.length;

  // 3. Magic marker
  bytes.set(TA_MAGIC, offset);
  offset += TA_MAGIC.length;

  // 4. Layers
  for (const layer of model.layers) {
    const aPacked = pack(layer.A);
    const bPacked = pack(layer.B);

    // A packed data
    view.setUint32(offset, aPacked.length, true);
    offset += 4;
    bytes.set(aPacked, offset);
    offset += aPacked.length;

    // B packed data
    view.setUint32(offset, bPacked.length, true);
    offset += 4;
    bytes.set(bPacked, offset);
    offset += bPacked.length;

    // Flags: bit 0 = hasScales, bit 1 = hasOffsets
    let flags = 0;
    if (layer.scales) flags |= 0x01;
    if (layer.offsets) flags |= 0x02;
    view.setUint32(offset, flags, true);
    offset += 4;

    // Scales (fp32)
    if (layer.scales) {
      view.setUint32(offset, layer.scales.length, true);
      offset += 4;
      const f32View = new Float32Array(buffer, offset, layer.scales.length);
      f32View.set(layer.scales);
      offset += layer.scales.length * 4;
    }

    // Offsets (fp32)
    if (layer.offsets) {
      view.setUint32(offset, layer.offsets.length, true);
      offset += 4;
      const f32View = new Float32Array(buffer, offset, layer.offsets.length);
      f32View.set(layer.offsets);
      offset += layer.offsets.length * 4;
    }
  }

  // 5. Checksum (SHA-256 of everything before this point)
  const dataForHash = bytes.subarray(0, offset);
  const hash = crypto.createHash('sha256').update(dataForHash).digest();
  bytes.set(hash, offset);

  return buffer;
}

/**
 * 从 .ta 二进制数据解码为 TernaryModel
 */
export function decode(buffer: ArrayBuffer): TernaryModel {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;

  // 1. Header length
  const headerLen = view.getUint32(offset, true);
  offset += 4;

  // 2. Header JSON
  const headerBytes = bytes.subarray(offset, offset + headerLen);
  const meta = JSON.parse(new TextDecoder().decode(headerBytes)) as TernaryModelMeta;
  offset += headerLen;

  // 3. Magic marker
  const magic = bytes.subarray(offset, offset + TA_MAGIC.length);
  if (magic[0] !== 0x54 || magic[1] !== 0x41) {
    throw new Error('Invalid .ta file: bad magic marker');
  }
  offset += TA_MAGIC.length;

  // 4. Layers
  const layers: TernaryLayer[] = [];
  const checksumOffset = buffer.byteLength - 32;

  while (offset < checksumOffset) {
    const layerIndex = layers.length;

    // A packed
    const aLen = view.getUint32(offset, true);
    offset += 4;
    const aPacked = bytes.subarray(offset, offset + aLen);
    offset += aLen;

    // B packed
    const bLen = view.getUint32(offset, true);
    offset += 4;
    const bPacked = bytes.subarray(offset, offset + bLen);
    offset += bLen;

    // Flags
    const flags = view.getUint32(offset, true);
    offset += 4;

    const aLenValues = meta.inFeatures * meta.rank;
    const bLenValues = meta.rank * meta.outFeatures;

    const layer: TernaryLayer = {
      layerIndex,
      A: unpack(aPacked, aLenValues),
      B: unpack(bPacked, bLenValues),
    };

    // Scales
    if (flags & 0x01) {
      const scaleCount = view.getUint32(offset, true);
      offset += 4;
      layer.scales = new Float32Array(
        new Float32Array(buffer.slice(offset, offset + scaleCount * 4))
      );
      offset += scaleCount * 4;
    }

    // Offsets
    if (flags & 0x02) {
      const offsetCount = view.getUint32(offset, true);
      offset += 4;
      layer.offsets = new Float32Array(
        new Float32Array(buffer.slice(offset, offset + offsetCount * 4))
      );
      offset += offsetCount * 4;
    }

    layers.push(layer);
  }

  // 5. Verify checksum
  const storedChecksum = bytes.subarray(checksumOffset, checksumOffset + 32);
  const dataForHash = bytes.subarray(0, checksumOffset);
  const computedHash = crypto.createHash('sha256').update(dataForHash).digest();

  for (let i = 0; i < 32; i++) {
    if (storedChecksum[i] !== computedHash[i]) {
      throw new Error('Checksum mismatch: file may be corrupted');
    }
  }

  return { meta, layers };
}

// ────────────────────────────────────────────
// 体积估算
// ────────────────────────────────────────────

/**
 * 从总参数量估算模型体积
 * 2-bit per param + 约 10% 开销
 */
export function estimateSizeFromParams(totalParams: number): number {
  const rawBytes = Math.ceil(totalParams * 2 / 8);
  return Math.ceil(rawBytes * 1.1); // 10% 开销
}

/**
 * 人类可读的体积字符串
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
