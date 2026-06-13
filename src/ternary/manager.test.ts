/**
 * manager.ts 测试 — 本地模型管理器
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { TernaryModelManager } from './manager.js';
import { createModelMeta } from './format.js';
import type { TernaryModel, TernaryLayer } from './format.js';

// ── 工具函数 ──

function randomTernary(len: number): Int8Array {
  const arr = new Int8Array(len);
  for (let i = 0; i < len; i++) arr[i] = (Math.floor(Math.random() * 3) - 1) as -1 | 0 | 1;
  return arr;
}

function createTestModel(domain = 'test'): TernaryModel {
  const inF = 16, rank = 4, outF = 16, numLayers = 2;
  const meta = createModelMeta(domain, {
    inFeatures: inF, rank, outFeatures: outF, numLayers,
    totalParams: (inF * rank + rank * outF) * numLayers,
  });
  const layers: TernaryLayer[] = Array.from({ length: numLayers }, (_, i) => ({
    layerIndex: i,
    A: randomTernary(inF * rank),
    B: randomTernary(rank * outF),
  }));
  return { meta, layers };
}

// ═══════════════════════════════════════════════════════

describe('TernaryModelManager', () => {
  let tmpDir: string;
  let manager: TernaryModelManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ternary-mgr-'));
    manager = new TernaryModelManager(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('init 创建目录和索引', async () => {
    await manager.init();

    const indexExists = await fs.access(path.join(tmpDir, 'index.json')).then(() => true).catch(() => false);
    expect(indexExists).toBe(true);
  });

  it('list 初始为空', async () => {
    await manager.init();
    expect(manager.list()).toEqual([]);
  });

  it('save + list 保存并列出模型', async () => {
    await manager.init();
    const model = createTestModel('Go开发');
    await manager.save(model);

    const list = manager.list();
    expect(list.length).toBe(1);
    expect(list[0].domain).toBe('Go开发');
  });

  it('get 获取指定模型元数据', async () => {
    await manager.init();
    const model = createTestModel('法务');
    await manager.save(model);

    const meta = manager.get('法务');
    expect(meta).not.toBeNull();
    expect(meta!.domain).toBe('法务');
  });

  it('get 不存在返回 null', async () => {
    await manager.init();
    expect(manager.get('不存在')).toBeNull();
  });

  it('load 加载完整模型', async () => {
    await manager.init();
    const model = createTestModel('test-load');
    await manager.save(model);

    const loaded = await manager.load('test-load');
    expect(loaded).not.toBeNull();
    expect(loaded!.meta.domain).toBe('test-load');
    expect(loaded!.layers.length).toBe(2);
  });

  it('load 不存在返回 null', async () => {
    await manager.init();
    const loaded = await manager.load('nonexistent');
    expect(loaded).toBeNull();
  });

  it('save + load roundtrip 保留权重', async () => {
    await manager.init();
    const model = createTestModel('roundtrip');
    await manager.save(model);

    const loaded = await manager.load('roundtrip');
    expect(loaded).not.toBeNull();

    for (let i = 0; i < model.layers.length; i++) {
      expect(Array.from(loaded!.layers[i].A)).toEqual(Array.from(model.layers[i].A));
      expect(Array.from(loaded!.layers[i].B)).toEqual(Array.from(model.layers[i].B));
    }
  });

  it('delete 删除模型', async () => {
    await manager.init();
    const model = createTestModel('to-delete');
    await manager.save(model);

    expect(manager.get('to-delete')).not.toBeNull();

    const deleted = await manager.delete('to-delete');
    expect(deleted).toBe(true);
    expect(manager.get('to-delete')).toBeNull();
  });

  it('delete 不存在返回 false', async () => {
    await manager.init();
    const deleted = await manager.delete('nonexistent');
    expect(deleted).toBe(false);
  });

  it('getInfo 包含文件信息', async () => {
    await manager.init();
    const model = createTestModel('info-test');
    await manager.save(model);

    const info = await manager.getInfo('info-test');
    expect(info).not.toBeNull();
    expect(info!.exists).toBe(true);
    expect(info!.fileSize).toBeGreaterThan(0);
    expect(info!.filePath).toContain('info-test');
  });

  it('getInfo 不存在的模型', async () => {
    await manager.init();
    const info = await manager.getInfo('nonexistent');
    expect(info).toBeNull();
  });

  it('updateMeta 更新元数据', async () => {
    await manager.init();
    const model = createTestModel('update-test');
    await manager.save(model);

    await manager.updateMeta('update-test', { trainSteps: 42 });

    const meta = manager.get('update-test');
    expect(meta!.trainSteps).toBe(42);
  });

  it('updateMeta 不存在抛出错误', async () => {
    await manager.init();
    await expect(manager.updateMeta('nonexistent', { trainSteps: 1 })).rejects.toThrow('not found');
  });

  it('setGrowthStage 更新阶段', async () => {
    await manager.init();
    const model = createTestModel('stage-test');
    await manager.save(model);

    await manager.setGrowthStage('stage-test', 'growing');

    const meta = manager.get('stage-test');
    expect(meta!.growthStage).toBe('growing');
  });

  it('create 创建空模型', async () => {
    await manager.init();
    const model = await manager.create('new-model', 'ternary-transformer-100m');

    expect(model.meta.domain).toBe('new-model');
    expect(model.layers.length).toBeGreaterThan(0);

    // 验证已保存到磁盘
    const loaded = await manager.load('new-model');
    expect(loaded).not.toBeNull();
  });

  it('getModelSizeEstimate 返回体积字符串', async () => {
    await manager.init();
    const model = createTestModel('size-est');
    await manager.save(model);

    const estimate = manager.getModelSizeEstimate('size-est');
    expect(estimate).not.toBe('N/A');
    expect(estimate).toMatch(/\d+(\.\d+)?\s(B|KB|MB|GB)/);
  });

  it('getModelSizeEstimate 不存在返回 N/A', async () => {
    await manager.init();
    expect(manager.getModelSizeEstimate('nonexistent')).toBe('N/A');
  });

  it('未初始化调用抛出错误', () => {
    expect(() => manager.list()).toThrow('not initialized');
  });

  it('多个模型共存', async () => {
    await manager.init();
    await manager.save(createTestModel('model-a'));
    await manager.save(createTestModel('model-b'));
    await manager.save(createTestModel('model-c'));

    expect(manager.list().length).toBe(3);

    const loadedA = await manager.load('model-a');
    const loadedB = await manager.load('model-b');
    expect(loadedA!.meta.domain).toBe('model-a');
    expect(loadedB!.meta.domain).toBe('model-b');
  });
});
