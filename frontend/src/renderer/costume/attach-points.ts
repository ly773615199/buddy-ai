/**
 * 挂载点系统 — 服饰附着位置
 *
 * v4.0 §6.10.2：标准挂载点表
 * 服饰 mesh 绑定到对应骨骼
 */

import type * as THREE from 'three';

export interface AttachPoint {
  boneName: string;
  offset: [number, number, number];
  rotation: [number, number, number];
  scale: number;
}

/** 标准挂载点表 */
export const ATTACH_POINTS: Record<string, AttachPoint> = {
  // 头部
  head_top:   { boneName: 'head',  offset: [0, 0.12, 0],     rotation: [0, 0, 0], scale: 1.0 },
  head_front: { boneName: 'head',  offset: [0, 0.04, 0.08],  rotation: [0, 0, 0], scale: 1.0 },
  ear_l:      { boneName: 'ear_l', offset: [0, 0, 0],        rotation: [0, 0, 0], scale: 1.0 },
  ear_r:      { boneName: 'ear_r', offset: [0, 0, 0],        rotation: [0, 0, 0], scale: 1.0 },

  // 躯干
  chest:      { boneName: 'chest', offset: [0, 0, 0],        rotation: [0, 0, 0], scale: 1.0 },
  spine:      { boneName: 'spine', offset: [0, 0, 0],        rotation: [0, 0, 0], scale: 1.0 },
  neck:       { boneName: 'neck',  offset: [0, 0, 0],        rotation: [0, 0, 0], scale: 1.0 },

  // 四肢
  shoulder_l: { boneName: 'shoulder_l', offset: [0, 0, 0], rotation: [0, 0, 0], scale: 1.0 },
  shoulder_r: { boneName: 'shoulder_r', offset: [0, 0, 0], rotation: [0, 0, 0], scale: 1.0 },
  hand_l:     { boneName: 'hand_l',     offset: [0, 0, 0], rotation: [0, 0, 0], scale: 1.0 },
  hand_r:     { boneName: 'hand_r',     offset: [0, 0, 0], rotation: [0, 0, 0], scale: 1.0 },
  foot_l:     { boneName: 'foot_l',     offset: [0, 0, 0], rotation: [0, 0, 0], scale: 1.0 },
  foot_r:     { boneName: 'foot_r',     offset: [0, 0, 0], rotation: [0, 0, 0], scale: 1.0 },

  // 背部
  back_upper: { boneName: 'chest', offset: [0, 0, -0.08], rotation: [0, 0, 0], scale: 1.0 },
  back_lower: { boneName: 'spine', offset: [0, 0, -0.06], rotation: [0, 0, 0], scale: 1.0 },

  // 附属物
  tail:       { boneName: 'tail',   offset: [0, 0, 0], rotation: [0, 0, 0], scale: 1.0 },
  wing_l:     { boneName: 'wing_l', offset: [0, 0, 0], rotation: [0, 0, 0], scale: 1.0 },
  wing_r:     { boneName: 'wing_r', offset: [0, 0, 0], rotation: [0, 0, 0], scale: 1.0 },
};

/** 槽位类型 */
export type CostumeSlot = 'head' | 'face' | 'upper' | 'lower' | 'back' | 'hands' | 'feet' | 'accessory';

/** 槽位规则 */
export const SLOT_RULES: Record<CostumeSlot, { maxEquipped: number }> = {
  head:      { maxEquipped: 1 },
  face:      { maxEquipped: 1 },
  upper:     { maxEquipped: 1 },
  lower:     { maxEquipped: 1 },
  back:      { maxEquipped: 1 },
  hands:     { maxEquipped: 2 },
  feet:      { maxEquipped: 2 },
  accessory: { maxEquipped: 3 },
};
