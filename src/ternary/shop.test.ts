/**
 * Phase F 测试 — 商城 + 生态
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ShopCatalog } from '../shop/catalog.js';
import { ModelInstaller, type ModelManifest } from '../shop/installer.js';
import { TernaryModelManager } from '../ternary/manager.js';
import { createModelMeta } from '../ternary/format.js';
import type { TernaryModel, TernaryLayer } from '../ternary/format.js';

// ── 工具函数 ──

function randomTernary(len: number): Int8Array {
  const arr = new Int8Array(len);
  for (let i = 0; i < len; i++) arr[i] = (Math.floor(Math.random() * 3) - 1) as -1 | 0 | 1;
  return arr;
}

function createTinyModel(domain = '测试领域'): TernaryModel {
  const inF = 32, rank = 4, outF = 32, numLayers = 2;
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

describe('ShopCatalog', () => {
  let catalog: ShopCatalog;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `buddy-test-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    catalog = new ShopCatalog(tmpDir);
  });

  afterEach(() => {
    catalog.close();
  });

  it('getAvailableItems 返回默认商品', () => {
    const items = catalog.getAvailableItems();
    expect(items.length).toBeGreaterThan(0);
  });

  it('getAvailableItems 按类型过滤', () => {
    const accessories = catalog.getAvailableItems({ type: 'accessory' });
    expect(accessories.every(i => i.type === 'accessory')).toBe(true);
  });

  it('getAvailableItems 按稀有度过滤', () => {
    const epics = catalog.getAvailableItems({ rarity: 'epic' });
    expect(epics.every(i => i.rarity === 'epic')).toBe(true);
  });

  it('getItem 获取单个商品', () => {
    const item = catalog.getItem('hat_crown');
    expect(item).not.toBeNull();
    expect(item!.name).toBe('小皇冠');
  });

  it('getItem 不存在返回 null', () => {
    expect(catalog.getItem('nonexistent')).toBeNull();
  });

  it('addItem 添加新商品', () => {
    catalog.addItem({
      id: 'test_item', name: '测试物品', description: '测试用',
      type: 'effect', rarity: 'common', price: 10, currency: 'coins',
      tags: ['test'], soldCount: 0, available: true, createdAt: Date.now(),
    });

    const item = catalog.getItem('test_item');
    expect(item).not.toBeNull();
    expect(item!.name).toBe('测试物品');
  });

  it('purchase 购买成功', () => {
    const result = catalog.purchase('user1', 'hat_party');
    expect(result.success).toBe(true);
  });

  it('purchase 余额不足失败', () => {
    // 先花光金币
    for (let i = 0; i < 20; i++) {
      catalog.purchase('user_poor', 'hat_party');
    }
    const result = catalog.purchase('user_poor', 'costume_legend'); // 100 gems
    expect(result.success).toBe(false);
  });

  it('purchase 不存在的商品失败', () => {
    const result = catalog.purchase('user1', 'nonexistent');
    expect(result.success).toBe(false);
  });

  it('getInventory 返回用户库存', () => {
    catalog.purchase('user_inv', 'hat_party');
    const inv = catalog.getInventory('user_inv');

    expect(inv.items.length).toBe(1);
    expect(inv.items[0].itemId).toBe('hat_party');
    expect(inv.coins).toBeLessThan(1000);
  });

  it('equipItem 装备物品', () => {
    catalog.purchase('user_equip', 'hat_party');
    const result = catalog.equipItem('user_equip', 'hat_party', true);
    expect(result).toBe(true);

    const equipped = catalog.getEquippedItems('user_equip');
    expect(equipped.some(i => i.id === 'hat_party')).toBe(true);
  });

  it('equipItem 同类型互斥', () => {
    catalog.purchase('user_mutex', 'hat_party');
    catalog.purchase('user_mutex', 'hat_crown');

    catalog.equipItem('user_mutex', 'hat_party', true);
    catalog.equipItem('user_mutex', 'hat_crown', true);

    const equipped = catalog.getEquippedItems('user_mutex');
    expect(equipped.length).toBe(1);
    expect(equipped[0].id).toBe('hat_crown');
  });

  it('赛季系统创建+查询', () => {
    catalog.createSeason({
      id: 's1', name: '测试赛季', description: '测试',
      startTime: Date.now() - 1000, endTime: Date.now() + 86400000,
      theme: '测试', items: [], isActive: true,
      tasks: [{
        id: 't1', name: '任务1', description: '测试',
        target: 10, progress: 0,
        reward: { type: 'coins', amount: 100 },
        completed: false,
      }],
      leaderboard: { entries: [], updatedAt: 0 },
    });

    const season = catalog.getActiveSeason();
    expect(season).not.toBeNull();
    expect(season!.name).toBe('测试赛季');
    expect(season!.tasks.length).toBe(1);
  });

  it('赛季任务进度更新', () => {
    catalog.createSeason({
      id: 's2', name: '赛季2', description: '',
      startTime: Date.now() - 1000, endTime: Date.now() + 86400000,
      theme: '', items: [], isActive: true,
      tasks: [{ id: 't2', name: '任务', description: '', target: 5, progress: 0, reward: { type: 'coins', amount: 50 }, completed: false }],
      leaderboard: { entries: [], updatedAt: 0 },
    });

    catalog.updateTaskProgress('s2', 't2', 3);
    let season = catalog.getSeason('s2');
    expect(season!.tasks[0].progress).toBe(3);
    expect(season!.tasks[0].completed).toBe(false);

    catalog.updateTaskProgress('s2', 't2', 5);
    season = catalog.getSeason('s2');
    expect(season!.tasks[0].completed).toBe(true);
  });

  it('排行榜更新+排名', () => {
    catalog.createSeason({
      id: 's3', name: '赛季3', description: '',
      startTime: Date.now() - 1000, endTime: Date.now() + 86400000,
      theme: '', items: [], isActive: true, tasks: [],
      leaderboard: { entries: [], updatedAt: 0 },
    });

    catalog.updateLeaderboard('s3', 'alice', 100);
    catalog.updateLeaderboard('s3', 'bob', 200);
    catalog.updateLeaderboard('s3', 'charlie', 150);

    const season = catalog.getSeason('s3');
    expect(season!.leaderboard.entries[0].userId).toBe('bob');
    expect(season!.leaderboard.entries[0].rank).toBe(1);
    expect(season!.leaderboard.entries[1].userId).toBe('charlie');
  });

  it('getStats 返回统计信息', () => {
    const stats = catalog.getStats();
    expect(stats.totalItems).toBeGreaterThan(0);
    expect(stats.byType).toBeDefined();
    expect(stats.byRarity).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════

describe('ModelInstaller', () => {
  let installer: ModelInstaller;
  let manager: TernaryModelManager;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `buddy-installer-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    manager = new TernaryModelManager(path.join(tmpDir, 'models'));
    await manager.init();

    installer = new ModelInstaller({
      installDir: path.join(tmpDir, 'experts'),
      cacheDir: path.join(tmpDir, 'cache'),
    });
    installer.setManager(manager);
    await installer.init();
  });

  it('installFromModel 安装模型', async () => {
    const model = createTinyModel('Go专家');
    const result = await installer.installFromModel(model, { name: 'Go专家 v1' });

    expect(result.success).toBe(true);
    expect(result.modelId).toBe('Go专家');
    expect(installer.isInstalled('Go专家')).toBe(true);
  });

  it('installFromModel 无 manager 报错', async () => {
    const installer2 = new ModelInstaller({ installDir: path.join(tmpDir, 'exp2') });
    await installer2.init();
    const model = createTinyModel('test');

    const result = await installer2.installFromModel(model);
    expect(result.success).toBe(false);
    expect(result.error).toContain('manager');
  });

  it('uninstall 卸载模型', async () => {
    const model = createTinyModel('卸载测试');
    await installer.installFromModel(model);

    const result = await installer.uninstall('卸载测试');
    expect(result.success).toBe(true);
    expect(installer.isInstalled('卸载测试')).toBe(false);
  });

  it('listInstalled 列出已安装', async () => {
    await installer.installFromModel(createTinyModel('模型A'));
    await installer.installFromModel(createTinyModel('模型B'));

    const list = installer.listInstalled();
    expect(list.length).toBe(2);
  });

  it('setEnabled 启用/禁用', async () => {
    await installer.installFromModel(createTinyModel('开关测试'));

    expect(installer.setEnabled('开关测试', false)).toBe(true);
    const info = installer.getInstalled('开关测试');
    expect(info!.enabled).toBe(false);

    expect(installer.setEnabled('开关测试', true)).toBe(true);
    expect(installer.getInstalled('开关测试')!.enabled).toBe(true);
  });

  it('setEnabled 未安装返回 false', () => {
    expect(installer.setEnabled('不存在', true)).toBe(false);
  });

  it('getInstalledCount 正确计数', async () => {
    expect(installer.installedCount).toBe(0);

    await installer.installFromModel(createTinyModel('计数1'));
    await installer.installFromModel(createTinyModel('计数2'));

    expect(installer.installedCount).toBe(2);
  });
});
