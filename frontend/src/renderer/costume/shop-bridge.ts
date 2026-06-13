/**
 * ShopCostumeBridge — 商城 ↔ 3D 服饰系统桥接
 *
 * 职责：
 * - 从后端 ShopItem 数据创建前端 CostumeDef
 * - 处理装备/卸下状态同步
 * - 管理特效（effect 类型）和背景的映射
 */

import type { CostumeDef, CostumeSlot } from './CostumeRenderer';
import { shopItemToCostumeDef, SHOP_TYPE_TO_SLOT } from './CostumeRenderer';
import type { TemplateCostumeConfig } from './template-loader';

/** 商城商品原始数据（来自后端 ShopItem） */
export interface ShopItemData {
  id: string;
  name: string;
  description: string;
  type: string;
  rarity: string;
  price: number;
  currency: string;
  previewUrl?: string;
  tags: string[];
  meshUrl?: string;
  textureUrl?: string;
  color?: string;
  emissive?: string;
}

/** 特效配置（effect 类型商品） */
export interface EffectConfig {
  id: string;
  particleColor?: string;
  particleRate?: number;
  trailEnabled?: boolean;
  glowIntensity?: number;
  soundId?: string;
}

/** 背景配置（background 类型商品） */
export interface BackgroundConfig {
  id: string;
  type: 'color' | 'gradient' | 'cubemap' | 'hdri';
  value: string;   // hex color / URL
  value2?: string;  // gradient 第二色
}

/**
 * 将商城商品转为 3D 服饰定义
 * 自动处理不同类型（costume/accessory/effect/background/pet_skin）
 */
export function mapShopItem(item: ShopItemData): {
  costume?: CostumeDef;
  effect?: EffectConfig;
  background?: BackgroundConfig;
} {
  const result: ReturnType<typeof mapShopItem> = {};

  // 服饰类（costume/accessory/pet_skin）→ CostumeDef
  if (item.type === 'costume' || item.type === 'accessory' || item.type === 'pet_skin') {
    result.costume = shopItemToCostumeDef({
      id: item.id,
      name: item.name,
      type: item.type,
      rarity: item.rarity,
      color: item.color,
      emissive: item.emissive,
      meshUrl: item.meshUrl,
      textureUrl: item.textureUrl,
    }) ?? undefined;
  }

  // 特效类 → EffectConfig
  if (item.type === 'effect') {
    result.effect = {
      id: item.id,
      particleColor: item.color,
      glowIntensity: item.rarity === 'legendary' ? 2.0 : item.rarity === 'epic' ? 1.5 : 1.0,
      trailEnabled: item.rarity === 'legendary' || item.rarity === 'epic',
    };
  }

  // 背景类 → BackgroundConfig
  if (item.type === 'background') {
    result.background = {
      id: item.id,
      type: 'color',
      value: item.color || '#0d1117',
    };
  }

  return result;
}

/**
 * 批量映射商城商品
 */
export function mapShopItems(items: ShopItemData[]): {
  costumes: CostumeDef[];
  effects: EffectConfig[];
  backgrounds: BackgroundConfig[];
} {
  const costumes: CostumeDef[] = [];
  const effects: EffectConfig[] = [];
  const backgrounds: BackgroundConfig[] = [];

  for (const item of items) {
    const mapped = mapShopItem(item);
    if (mapped.costume) costumes.push(mapped.costume);
    if (mapped.effect) effects.push(mapped.effect);
    if (mapped.background) backgrounds.push(mapped.background);
  }

  return { costumes, effects, backgrounds };
}

/**
 * 装备状态变更事件
 */
export interface EquipChangeEvent {
  itemId: string;
  action: 'equip' | 'unequip';
  slot: CostumeSlot;
  timestamp: number;
}

/**
 * 装备状态管理器
 * 维护当前装备列表，处理槽位冲突
 */
export class EquipStateManager {
  private equipped: Map<CostumeSlot, string> = new Map();
  private listeners: Array<(event: EquipChangeEvent) => void> = [];

  /**
   * 尝试装备商品
   * @returns 是否成功装备
   */
  tryEquip(itemId: string, slot: CostumeSlot): boolean {
    // 同一件已装备
    if (this.equipped.get(slot) === itemId) return false;

    // 卸下同槽位旧装备
    const oldId = this.equipped.get(slot);
    if (oldId) {
      this.emit({ itemId: oldId, action: 'unequip', slot, timestamp: Date.now() });
    }

    // 装备新商品
    this.equipped.set(slot, itemId);
    this.emit({ itemId, action: 'equip', slot, timestamp: Date.now() });
    return true;
  }

  /**
   * 卸下指定槽位
   */
  unequip(slot: CostumeSlot): boolean {
    const itemId = this.equipped.get(slot);
    if (!itemId) return false;
    this.equipped.delete(slot);
    this.emit({ itemId, action: 'unequip', slot, timestamp: Date.now() });
    return true;
  }

  /**
   * 卸下指定商品
   */
  unequipById(itemId: string): boolean {
    for (const [slot, id] of this.equipped) {
      if (id === itemId) {
        this.equipped.delete(slot);
        this.emit({ itemId, action: 'unequip', slot, timestamp: Date.now() });
        return true;
      }
    }
    return false;
  }

  /**
   * 获取指定槽位装备的商品 ID
   */
  getEquipped(slot: CostumeSlot): string | undefined {
    return this.equipped.get(slot);
  }

  /**
   * 获取所有装备
   */
  getAllEquipped(): Map<CostumeSlot, string> {
    return new Map(this.equipped);
  }

  /**
   * 监听装备变更
   */
  onChange(listener: (event: EquipChangeEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private emit(event: EquipChangeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
