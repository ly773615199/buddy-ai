/**
 * CostumeRenderer — 服饰渲染器
 *
 * v4.0 §6.10：服饰是独立于身体 mesh 的附加层
 * 程序化 mesh 生成 + 模板加载 + 挂载到骨骼
 */

import * as THREE from 'three';
import type { BuddyGenome } from '../../pet/genome';
import { ATTACH_POINTS, type AttachPoint, type CostumeSlot } from './attach-points';
import { loadTemplateCostume, TemplateCostume, type TemplateCostumeConfig } from './template-loader';

/** 服饰定义（对应商城数据） */
export interface CostumeDef {
  id: string;
  slot: CostumeSlot;
  attachPoints: string[];
  meshType: 'procedural' | 'template';

  // procedural
  procedural?: {
    shape: 'box' | 'sphere' | 'cylinder' | 'torus';
    params: Record<string, number>;
    material: {
      color: string;
      roughness: number;
      metalness: number;
      emissive?: string;
    };
  };

  // template（glb/fbx）
  template?: TemplateCostumeConfig;
}

/** 默认基础款（成形时自动装备，不可卸下） */
export const DEFAULT_COSTUMES: CostumeDef[] = [
  {
    id: 'default_basic',
    slot: 'upper',
    attachPoints: ['chest'],
    meshType: 'procedural',
    procedural: {
      shape: 'sphere',
      params: { radius: 0.02 },
      material: {
        color: '#58a6ff',
        roughness: 0.6,
        metalness: 0.0,
      },
    },
  },
];

/** formProgress 阈值：成形阶段开始自动装备 */
const AUTO_EQUIP_PROGRESS = 70;

// ==================== 商城 → 服饰槽位映射 ====================

/** 商城 catalog.ts 的 type → CostumeSlot 映射 */
export const SHOP_TYPE_TO_SLOT: Record<string, CostumeSlot> = {
  costume: 'upper',
  accessory: 'accessory',
  hat: 'head',
  mask: 'face',
  cape: 'back',
  gloves: 'hands',
  shoes: 'feet',
  pet_skin: 'upper',
};

/**
 * 从商城商品数据创建 CostumeDef
 * 对接 src/shop/catalog.ts
 */
export function shopItemToCostumeDef(item: {
  id: string;
  name: string;
  type: string;
  rarity?: string;
  color?: string;
  emissive?: string;
  meshUrl?: string;
  textureUrl?: string;
}): CostumeDef | null {
  const slot = SHOP_TYPE_TO_SLOT[item.type];
  if (!slot) return null;

  const attachPoints = slot === 'upper' ? ['chest'] :
    slot === 'lower' ? ['spine'] :
    slot === 'head' ? ['head_top'] :
    slot === 'face' ? ['head_front'] :
    slot === 'back' ? ['back_upper'] :
    slot === 'hands' ? ['hand_l', 'hand_r'] :
    slot === 'feet' ? ['foot_l', 'foot_r'] :
    ['chest'];

  // 如果有 meshUrl，用 template 模式
  if (item.meshUrl) {
    return {
      id: item.id,
      slot,
      attachPoints,
      meshType: 'template',
      template: {
        meshUrl: item.meshUrl,
        textureUrl: item.textureUrl,
        scaleCorrection: 1.0,
      },
    };
  }

  // 默认 procedural
  return {
    id: item.id,
    slot,
    attachPoints,
    meshType: 'procedural',
    procedural: {
      shape: slot === 'head' ? 'sphere' : 'box',
      params: { radius: 0.05, width: 0.1, height: 0.1, depth: 0.05 },
      material: {
        color: item.color || '#58a6ff',
        roughness: 0.5,
        metalness: 0.1,
        emissive: item.rarity === 'legendary' ? (item.emissive || '#ffaa00') : undefined,
      },
    },
  };
}

// ==================== 已装备条目 ====================

interface EquippedCostume {
  def: CostumeDef;
  proceduralMeshes?: Map<string, THREE.Mesh>;
  templateCostume?: TemplateCostume;
}

export class CostumeRenderer {
  private equipped: Map<string, EquippedCostume> = new Map();
  private defaultsEquipped = false;

  /**
   * 装备服饰
   */
  equip(def: CostumeDef, skeleton: Map<string, THREE.Bone>, genome: BuddyGenome): void {
    // 先卸下同槽位旧装备
    this.unequip(def.id);

    if (def.meshType === 'template' && def.template) {
      this.equipTemplate(def, skeleton, genome);
    } else if (def.meshType === 'procedural' && def.procedural) {
      this.equipProcedural(def, skeleton, genome);
    }
  }

  /**
   * 装备 procedural 服饰
   */
  private equipProcedural(def: CostumeDef, skeleton: Map<string, THREE.Bone>, genome: BuddyGenome): void {
    const meshes = new Map<string, THREE.Mesh>();

    for (const pointName of def.attachPoints) {
      const point = ATTACH_POINTS[pointName];
      if (!point) continue;

      const bone = skeleton.get(point.boneName);
      if (!bone) continue;

      const mesh = this.createProceduralMesh(def.procedural!, genome);
      mesh.position.set(...point.offset);
      mesh.rotation.set(...point.rotation);
      mesh.scale.setScalar(point.scale * this.getGeneScale(genome));
      bone.add(mesh);

      meshes.set(pointName, mesh);
    }

    this.equipped.set(def.id, { def, proceduralMeshes: meshes });
  }

  /**
   * 装备 template 服饰（glb/fbx）
   */
  private async equipTemplate(def: CostumeDef, skeleton: Map<string, THREE.Bone>, genome: BuddyGenome): Promise<void> {
    if (!def.template) return;

    try {
      const costume = await loadTemplateCostume(def.template, genome);

      // 挂载到第一个挂载点的骨骼
      const firstPoint = def.attachPoints[0];
      const point = ATTACH_POINTS[firstPoint];
      if (point) {
        const bone = skeleton.get(point.boneName);
        if (bone) {
          costume.attachTo(bone);
        }
      }

      this.equipped.set(def.id, { def, templateCostume: costume });
    } catch (err) {
      console.warn(`[CostumeRenderer] Failed to load template for ${def.id}:`, err);
    }
  }

  /**
   * 卸下服饰
   */
  unequip(costumeId: string): void {
    const entry = this.equipped.get(costumeId);
    if (!entry) return;

    // 卸下 procedural meshes
    if (entry.proceduralMeshes) {
      for (const [, mesh] of entry.proceduralMeshes) {
        mesh.parent?.remove(mesh);
        mesh.geometry.dispose();
        if (mesh.material instanceof THREE.Material) {
          mesh.material.dispose();
        }
      }
    }

    // 卸下 template costume
    if (entry.templateCostume) {
      entry.templateCostume.dispose();
    }

    this.equipped.delete(costumeId);
  }

  /**
   * formProgress >= 70% 时自动装备默认基础款
   */
  autoEquipDefaults(
    skeleton: Map<string, THREE.Bone>,
    genome: BuddyGenome,
    primaryColor: string,
  ): void {
    if (this.defaultsEquipped) return;
    this.defaultsEquipped = true;

    for (const def of DEFAULT_COSTUMES) {
      const colored: CostumeDef = {
        ...def,
        procedural: def.procedural ? {
          ...def.procedural,
          material: { ...def.procedural.material, color: primaryColor },
        } : undefined,
      };
      this.equip(colored, skeleton, genome);
    }
  }

  /**
   * formProgress < 70% 时卸下默认服饰
   */
  unequipDefaults(): void {
    if (!this.defaultsEquipped) return;
    for (const def of DEFAULT_COSTUMES) {
      this.unequip(def.id);
    }
    this.defaultsEquipped = false;
  }

  /**
   * 获取所有装备的 ID 列表
   */
  getEquippedIds(): string[] {
    return Array.from(this.equipped.keys());
  }

  /**
   * 判断是否为默认服饰
   */
  isDefaultCostume(id: string): boolean {
    return DEFAULT_COSTUMES.some(d => d.id === id);
  }

  dispose(): void {
    for (const id of this.equipped.keys()) {
      this.unequip(id);
    }
    this.defaultsEquipped = false;
  }

  // ── 内部方法 ──

  private createProceduralMesh(
    proc: NonNullable<CostumeDef['procedural']>,
    _genome: BuddyGenome,
  ): THREE.Mesh {
    let geometry: THREE.BufferGeometry;
    const p = proc.params;

    switch (proc.shape) {
      case 'box':
        geometry = new THREE.BoxGeometry(p.width ?? 0.1, p.height ?? 0.1, p.depth ?? 0.1);
        break;
      case 'sphere':
        geometry = new THREE.SphereGeometry(p.radius ?? 0.05, 16, 16);
        break;
      case 'cylinder':
        geometry = new THREE.CylinderGeometry(p.radiusTop ?? 0.03, p.radiusBottom ?? 0.05, p.height ?? 0.1, 16);
        break;
      case 'torus':
        geometry = new THREE.TorusGeometry(p.radius ?? 0.06, p.tube ?? 0.015, 8, 24);
        break;
      default:
        geometry = new THREE.SphereGeometry(0.05, 8, 8);
    }

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(proc.material.color),
      roughness: proc.material.roughness,
      metalness: proc.material.metalness,
      emissive: proc.material.emissive ? new THREE.Color(proc.material.emissive) : undefined,
    });

    return new THREE.Mesh(geometry, material);
  }

  private getGeneScale(genome: BuddyGenome): number {
    return (genome.bodyHeight + genome.bodyWidth) / 2;
  }
}
