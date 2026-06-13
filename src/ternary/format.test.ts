/**
 * Phase C1 测试 — 三进制格式 + 编解码 + 模型管理
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import {
  createModelMeta, layerParamCount, modelParamCount,
  TA_FORMAT_VERSION, ARCHITECTURE_PRESETS,
} from './format.js';
import type { TernaryModel, TernaryLayer } from './format.js';
import {
  pack, unpack, encode, decode,
  estimateLayerSize, estimateModelSize, estimateSizeFromParams, formatSize,
} from './codec.js';
import { TernaryModelManager } from './manager.js';

const TEST_DIR = path.join('/tmp', `buddy-test-ternary-${Date.now()}`);

// ── 工具函数 ──

/** 生成随机三进制数组 */
function randomTernary(length: number): Int8Array {
  const arr = new Int8Array(length);
  for (let i = 0; i < length; i++) {
    arr[i] = (Math.floor(Math.random() * 3) - 1) as -1 | 0 | 1; // -1, 0, 1
  }
  return arr;
}

/** 创建测试模型 */
function createTestModel(domain = '测试领域', inF = 64, rank = 8, outF = 64, layers = 2): TernaryModel {
  const meta = createModelMeta(domain, {
    inFeatures: inF,
    rank,
    outFeatures: outF,
    numLayers: layers,
    totalParams: modelParamCount(inF, rank, outF, layers),
    growthStage: 'sprout',
    trainSteps: 42,
  });

  const layerArr: TernaryLayer[] = Array.from({ length: layers }, (_, i) => ({
    layerIndex: i,
    A: randomTernary(inF * rank),
    B: randomTernary(rank * outF),
  }));

  return { meta, layers: layerArr };
}

// ═══════════════════════════════════════════════════════

describe('三进制格式定义', () => {
  it('createModelMeta 返回完整元数据', () => {
    const meta = createModelMeta('Go开发');
    expect(meta.version).toBe(TA_FORMAT_VERSION);
    expect(meta.domain).toBe('Go开发');
    expect(meta.inFeatures).toBe(768);
    expect(meta.rank).toBe(16);
    expect(meta.growthStage).toBe('seed');
  });

  it('createModelMeta 支持覆盖', () => {
    const meta = createModelMeta('前端', { rank: 32, growthStage: 'mature' });
    expect(meta.rank).toBe(32);
    expect(meta.growthStage).toBe('mature');
  });

  it('layerParamCount 计算正确', () => {
    // A: 64×8 = 512, B: 8×64 = 512, total = 1024
    expect(layerParamCount(64, 8, 64)).toBe(1024);
  });

  it('modelParamCount 考虑层数', () => {
    expect(modelParamCount(64, 8, 64, 4)).toBe(4096);
  });

  it('预设架构存在', () => {
    expect(ARCHITECTURE_PRESETS['ternary-transformer-100m']).toBeDefined();
    expect(ARCHITECTURE_PRESETS['ternary-transformer-1b'].totalParams).toBe(1_000_000_000);
  });
});

// ═══════════════════════════════════════════════════════

describe('2-bit 打包/解包', () => {
  it('roundtrip: {-1,0,1} → pack → unpack == 原始', () => {
    const original = new Int8Array([1, 0, -1, 1, -1, 0, 0, 1]);
    const packed = pack(original);
    expect(packed.length).toBe(2); // 8 values / 4 = 2 bytes
    const restored = unpack(packed, original.length);
    expect(restored).toEqual(original);
  });

  it('单个值正确编码', () => {
    expect(unpack(pack(new Int8Array([0])), 1)).toEqual(new Int8Array([0]));
    expect(unpack(pack(new Int8Array([1])), 1)).toEqual(new Int8Array([1]));
    expect(unpack(pack(new Int8Array([-1])), 1)).toEqual(new Int8Array([-1]));
  });

  it('奇数长度正确处理', () => {
    const original = new Int8Array([1, -1, 0]);
    const packed = pack(original);
    expect(packed.length).toBe(1); // ceil(3/4) = 1
    const restored = unpack(packed, 3);
    expect(restored).toEqual(original);
  });

  it('大矩阵 roundtrip 正确', () => {
    const size = 4096;
    const original = randomTernary(size);
    const packed = pack(original);
    expect(packed.length).toBe(size / 4);
    const restored = unpack(packed, size);
    expect(restored).toEqual(original);
  });

  it('体积减小 4 倍', () => {
    const original = new Int8Array(1000);
    for (let i = 0; i < 1000; i++) original[i] = 1;
    const packed = pack(original);
    expect(packed.length).toBe(250);
  });
});

// ═══════════════════════════════════════════════════════

describe('.ta 文件编码/解码', () => {
  it('完整模型 encode/decode 无损', () => {
    const model = createTestModel('Go开发', 32, 4, 32, 2);
    const buffer = encode(model);
    const restored = decode(buffer);

    expect(restored.meta.domain).toBe('Go开发');
    expect(restored.meta.inFeatures).toBe(32);
    expect(restored.meta.rank).toBe(4);
    expect(restored.layers.length).toBe(2);

    // 权重完全一致
    for (let i = 0; i < 2; i++) {
      expect(restored.layers[i].A).toEqual(model.layers[i].A);
      expect(restored.layers[i].B).toEqual(model.layers[i].B);
    }
  });

  it('encode 生成有效的二进制数据', () => {
    const model = createTestModel();
    const buffer = encode(model);
    expect(buffer.byteLength).toBeGreaterThan(100);
  });

  it('无效数据抛出校验错误', () => {
    const model = createTestModel();
    const buffer = encode(model);

    // 损坏 checksum
    const bytes = new Uint8Array(buffer);
    bytes[bytes.length - 1] ^= 0xFF;

    expect(() => decode(bytes.buffer)).toThrow('Checksum mismatch');
  });

  it('全零权重正确编解码', () => {
    const meta = createModelMeta('零模型', { inFeatures: 16, rank: 4, outFeatures: 16, numLayers: 1 });
    const model: TernaryModel = {
      meta,
      layers: [{ layerIndex: 0, A: new Int8Array(64), B: new Int8Array(64) }],
    };

    const buffer = encode(model);
    const restored = decode(buffer);
    expect(restored.layers[0].A.every(v => v === 0)).toBe(true);
    expect(restored.layers[0].B.every(v => v === 0)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════

describe('体积估算', () => {
  it('estimateLayerSize 正确', () => {
    // 64*8=512 values × 2bit = 1024bit = 128bytes per matrix, 两个矩阵 + 8 header
    expect(estimateLayerSize(64, 8, 64)).toBe(264);
  });

  it('estimateModelSize 包含层数', () => {
    const singleLayer = estimateLayerSize(64, 8, 64);
    const full = estimateModelSize(64, 8, 64, 4);
    expect(full).toBe(512 + singleLayer * 4 + 32); // header + layers + checksum
  });

  it('estimateSizeFromParams: 1B ≈ 190MB', () => {
    const size = estimateSizeFromParams(1_000_000_000);
    const mb = size / (1024 * 1024);
    expect(mb).toBeGreaterThan(200);   // ~250MB with overhead
    expect(mb).toBeLessThan(400);
  });

  it('formatSize 人类可读', () => {
    expect(formatSize(500)).toBe('500 B');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(formatSize(20 * 1024 * 1024)).toBe('20.0 MB');
  });
});

// ═══════════════════════════════════════════════════════

describe('性能', () => {
  it('4096×4096 矩阵打包 < 500ms (纯 JS)', () => {
    const size = 4096 * 4096;
    const arr = randomTernary(size);

    const start = performance.now();
    const packed = pack(arr);
    const elapsed = performance.now() - start;

    expect(packed.length).toBe(size / 4);
    expect(elapsed).toBeLessThan(500);
  });

  it('4096×4096 矩阵解包 < 500ms (纯 JS)', () => {
    const size = 4096 * 4096;
    const arr = randomTernary(size);
    const packed = pack(arr);

    const start = performance.now();
    const restored = unpack(packed, size);
    const elapsed = performance.now() - start;

    expect(restored.length).toBe(size);
    expect(elapsed).toBeLessThan(500);
  });

  it('完整模型 encode < 200ms', () => {
    const model = createTestModel('性能测试', 768, 16, 768, 12);

    const start = performance.now();
    const buffer = encode(model);
    const elapsed = performance.now() - start;

    expect(buffer.byteLength).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(200);
  });
});

// ═══════════════════════════════════════════════════════

describe('TernaryModelManager', () => {
  let manager: TernaryModelManager;

  beforeAll(async () => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    manager = new TernaryModelManager(TEST_DIR);
    await manager.init();
  });

  afterAll(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('init 创建目录和索引', () => {
    expect(fs.existsSync(path.join(TEST_DIR, 'index.json'))).toBe(true);
  });

  it('初始时模型列表为空', () => {
    expect(manager.list()).toEqual([]);
  });

  it('create 创建空模型', async () => {
    const model = await manager.create('测试领域', 'ternary-transformer-100m');
    expect(model.meta.domain).toBe('测试领域');
    expect(model.meta.architecture).toBe('ternary-transformer-100m');
    expect(model.layers.length).toBe(12);
    expect(fs.existsSync(path.join(TEST_DIR, '测试领域.ta'))).toBe(true);
  });

  it('list 返回已创建的模型', () => {
    const list = manager.list();
    expect(list.length).toBe(1);
    expect(list[0].domain).toBe('测试领域');
  });

  it('get 返回指定模型元数据', () => {
    const meta = manager.get('测试领域');
    expect(meta).not.toBeNull();
    expect(meta!.domain).toBe('测试领域');
  });

  it('get 不存在的领域返回 null', () => {
    expect(manager.get('不存在')).toBeNull();
  });

  it('getInfo 返回文件信息', async () => {
    const info = await manager.getInfo('测试领域');
    expect(info).not.toBeNull();
    expect(info!.exists).toBe(true);
    expect(info!.fileSize).toBeGreaterThan(0);
    expect(info!.fileSizeFormatted).toBeTruthy();
  });

  it('load 加载完整模型', async () => {
    const model = await manager.load('测试领域');
    expect(model).not.toBeNull();
    expect(model!.meta.domain).toBe('测试领域');
    expect(model!.layers.length).toBe(12);
  });

  it('save 保存随机权重模型', async () => {
    const model = createTestModel('Go开发', 128, 8, 128, 4);
    await manager.save(model);

    const loaded = await manager.load('Go开发');
    expect(loaded).not.toBeNull();
    expect(loaded!.layers[0].A).toEqual(model.layers[0].A);
  });

  it('updateMeta 更新元数据', async () => {
    await manager.updateMeta('Go开发', { growthStage: 'growing', trainSteps: 100 });
    const meta = manager.get('Go开发');
    expect(meta!.growthStage).toBe('growing');
    expect(meta!.trainSteps).toBe(100);
  });

  it('setGrowthStage 快捷方法', async () => {
    await manager.setGrowthStage('Go开发', 'mature');
    expect(manager.get('Go开发')!.growthStage).toBe('mature');
  });

  it('getModelSizeEstimate 返回可读体积', () => {
    const size = manager.getModelSizeEstimate('Go开发');
    expect(size).not.toBe('N/A');
    expect(size).toMatch(/[BKMG]/);
  });

  it('delete 删除模型', async () => {
    const deleted = await manager.delete('Go开发');
    expect(deleted).toBe(true);
    expect(manager.get('Go开发')).toBeNull();
    expect(fs.existsSync(path.join(TEST_DIR, 'Go开发.ta'))).toBe(false);
  });

  it('delete 不存在的模型返回 false', async () => {
    expect(await manager.delete('不存在')).toBe(false);
  });
});
