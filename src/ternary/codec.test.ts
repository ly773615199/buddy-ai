/**
 * codec.ts 测试 — 2-bit 打包/解包 + .ta 文件编解码
 */

import { describe, it, expect } from 'vitest';
import { pack, unpack, encode, decode, estimateLayerSize, estimateModelSize, estimateSizeFromParams, formatSize } from './codec.js';
import { createModelMeta } from './format.js';
import type { TernaryModel, TernaryLayer } from './format.js';

// ── 工具函数 ──

function randomTernary(len: number): Int8Array {
  const arr = new Int8Array(len);
  for (let i = 0; i < len; i++) arr[i] = (Math.floor(Math.random() * 3) - 1) as -1 | 0 | 1;
  return arr;
}

function createTestModel(layers = 2, inF = 16, rank = 4, outF = 16): TernaryModel {
  const meta = createModelMeta('test-domain', {
    inFeatures: inF,
    rank,
    outFeatures: outF,
    numLayers: layers,
    totalParams: (inF * rank + rank * outF) * layers,
  });

  const ls: TernaryLayer[] = Array.from({ length: layers }, (_, i) => ({
    layerIndex: i,
    A: randomTernary(inF * rank),
    B: randomTernary(rank * outF),
  }));

  return { meta, layers: ls };
}

// ═══════════════════════════════════════════════════════

describe('pack / unpack', () => {
  it('pack 基本打包', () => {
    const data = new Int8Array([0, 1, -1, 1]);
    const packed = pack(data);

    expect(packed.length).toBe(1);
    // 0→00, 1→01, -1→10, 1→01
    // 00 01 10 01 = 0x69
    expect(packed[0]).toBe(0b00011001);
  });

  it('unpack 基本解包', () => {
    const packed = new Uint8Array([0b00011001]);
    const result = unpack(packed, 4);

    expect(Array.from(result)).toEqual([0, 1, -1, 1]);
  });

  it('pack/unpack roundtrip 随机数据', () => {
    const original = randomTernary(100);
    const packed = pack(original);
    const restored = unpack(packed, original.length);

    expect(Array.from(restored)).toEqual(Array.from(original));
  });

  it('pack/unpack roundtrip 非 4 对齐长度', () => {
    const original = randomTernary(7);
    const packed = pack(original);
    const restored = unpack(packed, original.length);

    expect(Array.from(restored)).toEqual(Array.from(original));
  });

  it('pack/unpack 全零', () => {
    const original = new Int8Array(8); // 全 0
    const packed = pack(original);
    const restored = unpack(packed, 8);

    expect(Array.from(restored)).toEqual(Array.from(original));
  });

  it('pack/unpack 全 1', () => {
    const original = new Int8Array([1, 1, 1, 1]);
    const packed = pack(original);
    const restored = unpack(packed, 4);

    expect(Array.from(restored)).toEqual([1, 1, 1, 1]);
  });

  it('pack/unpack 全 -1', () => {
    const original = new Int8Array([-1, -1, -1, -1]);
    const packed = pack(original);
    const restored = unpack(packed, 4);

    expect(Array.from(restored)).toEqual([-1, -1, -1, -1]);
  });

  it('pack 长度为 0', () => {
    const packed = pack(new Int8Array(0));
    expect(packed.length).toBe(0);
  });

  it('pack/unpack 长度 1', () => {
    const original = new Int8Array([1]);
    const packed = pack(original);
    const restored = unpack(packed, 1);

    expect(restored.length).toBe(1);
    expect(restored[0]).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════

describe('encode / decode (.ta 格式)', () => {
  it('encode 生成有效 buffer', () => {
    const model = createTestModel();
    const buffer = encode(model);

    expect(buffer.byteLength).toBeGreaterThan(0);
    expect(buffer).toBeInstanceOf(ArrayBuffer);
  });

  it('decode roundtrip 保留元数据', () => {
    const model = createTestModel();
    const buffer = encode(model);
    const decoded = decode(buffer);

    expect(decoded.meta.domain).toBe('test-domain');
    expect(decoded.meta.inFeatures).toBe(16);
    expect(decoded.meta.rank).toBe(4);
    expect(decoded.meta.outFeatures).toBe(16);
  });

  it('decode roundtrip 保留权重', () => {
    const model = createTestModel(1, 8, 4, 8);
    const buffer = encode(model);
    const decoded = decode(buffer);

    expect(decoded.layers.length).toBe(1);
    expect(Array.from(decoded.layers[0].A)).toEqual(Array.from(model.layers[0].A));
    expect(Array.from(decoded.layers[0].B)).toEqual(Array.from(model.layers[0].B));
  });

  it('decode roundtrip 多层', () => {
    const model = createTestModel(4, 16, 4, 16);
    const buffer = encode(model);
    const decoded = decode(buffer);

    expect(decoded.layers.length).toBe(4);
    for (let i = 0; i < 4; i++) {
      expect(Array.from(decoded.layers[i].A)).toEqual(Array.from(model.layers[i].A));
      expect(Array.from(decoded.layers[i].B)).toEqual(Array.from(model.layers[i].B));
    }
  });

  it('decode 检测到损坏数据', () => {
    const model = createTestModel();
    const buffer = encode(model);

    // 篡改最后一个字节（checksum 区域）
    const bytes = new Uint8Array(buffer);
    bytes[bytes.length - 1] ^= 0xFF;

    expect(() => decode(buffer)).toThrow('Checksum mismatch');
  });

  it('decode 检测到无效 magic', () => {
    // 构造一个假 buffer，header 后 magic 不对
    const header = JSON.stringify({ domain: 'x', inFeatures: 1, rank: 1, outFeatures: 1, numLayers: 0 });
    const headerBytes = new TextEncoder().encode(header);
    const fake = new ArrayBuffer(4 + headerBytes.length + 4 + 32);
    const view = new DataView(fake);
    const bytes = new Uint8Array(fake);
    let off = 0;
    view.setUint32(off, headerBytes.length, true); off += 4;
    bytes.set(headerBytes, off); off += headerBytes.length;
    // 写入错误 magic
    bytes[off] = 0xFF; bytes[off + 1] = 0xFF; bytes[off + 2] = 0xFF; bytes[off + 3] = 0xFF;

    expect(() => decode(fake)).toThrow('Invalid .ta file');
  });
});

// ═══════════════════════════════════════════════════════

describe('体积估算', () => {
  it('estimateLayerSize 返回正数', () => {
    const size = estimateLayerSize(128, 16, 128);
    expect(size).toBeGreaterThan(0);
  });

  it('estimateModelSize 随层数增长', () => {
    const size1 = estimateModelSize(128, 16, 128, 1);
    const size4 = estimateModelSize(128, 16, 128, 4);
    expect(size4).toBeGreaterThan(size1);
  });

  it('estimateSizeFromParams 估算合理', () => {
    // 100M 参数，2-bit → 约 25MB
    const size = estimateSizeFromParams(100_000_000);
    expect(size).toBeGreaterThan(20_000_000);
    expect(size).toBeLessThan(30_000_000);
  });

  it('formatSize 各种单位', () => {
    expect(formatSize(500)).toBe('500 B');
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatSize(1024 * 1024 * 1024)).toBe('1.00 GB');
  });
});
