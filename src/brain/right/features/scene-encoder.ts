/**
 * 场景编码器 — Scene Encoder
 *
 * 基于 Slot Attention (NeurIPS 2020) + Scene Representation Networks 思路：
 * - Scene Graph 编码：物体节点 + 空间关系边 → token IDs
 * - Slot Attention 轻量版：输入 token → K 个 object slots
 * - 结构化场景表征
 *
 * Token ID 范围：550-699
 * - 550-599: scene graph node types（物体类别）
 * - 600-649: scene graph edge types（空间关系）
 * - 650-699: slot IDs（object slots）
 */

// ==================== 常量 ====================

const SCENE_TOKEN_START = 550;
const NODE_TOKEN_START = 550;
const NODE_TOKEN_END = 599;
const EDGE_TOKEN_START = 600;
const EDGE_TOKEN_END = 649;
const SLOT_TOKEN_START = 650;
const SLOT_TOKEN_END = 699;
const MAX_SLOTS = 8;
const MAX_OBJECTS = 16;
const MAX_RELATIONS = 24;

/** 常见物体类别 → node token 偏移 */
const OBJECT_CATEGORIES: Record<string, number> = {
  'person': 0, 'car': 1, 'building': 2, 'tree': 3, 'road': 4,
  'sky': 5, 'ground': 6, 'wall': 7, 'door': 8, 'window': 9,
  'table': 10, 'chair': 11, 'screen': 12, 'keyboard': 13, 'mouse': 14,
  'book': 15, 'cup': 16, 'phone': 17, 'light': 18, 'box': 19,
  'text': 20, 'button': 21, 'icon': 22, 'image': 23, 'line': 24,
  'circle': 25, 'rectangle': 26, 'arrow': 27, 'unknown': 28,
};

/** 空间关系 → edge token 偏移 */
const SPATIAL_RELATIONS: Record<string, number> = {
  'left_of': 0, 'right_of': 1, 'above': 2, 'below': 3,
  'inside': 4, 'contains': 5, 'touching': 6, 'near': 7,
  'far_from': 8, 'aligned_h': 9, 'aligned_v': 10, 'overlapping': 11,
  'connected_to': 12, 'points_to': 13, 'part_of': 14, 'same_as': 15,
};

// ==================== 类型 ====================

/** 场景物体节点 */
export interface SceneNode {
  id: string;
  category: string;
  attributes?: Record<string, string | number>;
  importance?: number; // 0-1
}

/** 场景关系边 */
export interface SceneEdge {
  source: string;
  target: string;
  relation: string;
  confidence?: number;
}

/** 场景图 */
export interface SceneGraph {
  nodes: SceneNode[];
  edges: SceneEdge[];
}

/** Slot Attention 配置 */
export interface SlotAttentionConfig {
  /** slot 数量 */
  numSlots: number;
  /** 迭代次数 */
  numIterations: number;
  /** slot 维度 */
  slotDim: number;
  /** 温度参数 */
  temperature: number;
}

const DEFAULT_SLOT_CONFIG: SlotAttentionConfig = {
  numSlots: MAX_SLOTS,
  numIterations: 3,
  slotDim: 32,
  temperature: 1.0,
};

// ==================== Scene Graph 编码 ====================

/**
 * 将 Scene Graph 编码为 token ID 序列
 *
 * 编码结构：
 * [node_0_category] [node_0_attr_1] [node_0_attr_2] ...
 * [SEP]
 * [edge_0_source] [edge_0_relation] [edge_0_target] ...
 * [SEP]
 */
export function encodeSceneGraph(graph: SceneGraph): number[] {
  const tokens: number[] = [];

  // 编码节点（最多 MAX_OBJECTS 个）
  const nodes = graph.nodes.slice(0, MAX_OBJECTS);
  for (const node of nodes) {
    // 类别 token
    tokens.push(nodeToToken(node.category));

    // 属性 token（取前 3 个数值属性）
    if (node.attributes) {
      const numAttrs = Object.values(node.attributes)
        .filter(v => typeof v === 'number')
        .slice(0, 3);
      for (const attr of numAttrs) {
        tokens.push(attributeToToken(attr as number));
      }
    }
  }
  tokens.push(3); // SEP

  // 编码边（最多 MAX_RELATIONS 个）
  const edges = graph.edges.slice(0, MAX_RELATIONS);
  for (const edge of edges) {
    tokens.push(nodeIdToToken(edge.source, nodes));
    tokens.push(edgeToToken(edge.relation));
    tokens.push(nodeIdToToken(edge.target, nodes));
  }
  tokens.push(3); // SEP

  return tokens;
}

// ==================== Slot Attention（轻量版）====================

/**
 * 轻量 Slot Attention
 *
 * 输入：token 序列（来自其他编码器的输出）
 * 输出：K 个 slot 向量（object-centric 表征）
 *
 * 简化实现：
 * - 不用可学习参数，用确定性聚类代替
 * - 基于 token 位置的软分配
 * - 纯 CPU，< 1ms
 */
export function slotAttention(
  tokens: number[],
  config?: Partial<SlotAttentionConfig>,
): number[][] {
  const cfg = { ...DEFAULT_SLOT_CONFIG, ...config };
  const n = tokens.length;
  if (n === 0) return Array.from({ length: cfg.numSlots }, () => new Array(cfg.slotDim).fill(0));

  // 初始化 slots：均匀分布在 token 空间
  const slots: number[][] = [];
  for (let s = 0; s < cfg.numSlots; s++) {
    const centerIdx = Math.floor((s / cfg.numSlots) * n);
    const slot = new Array(cfg.slotDim).fill(0);
    // slot 初始化为对应位置的 token 值 + 位置编码
    slot[0] = tokens[centerIdx] ?? 0;
    slot[1] = centerIdx;
    slot[2] = n; // 序列长度
    slots.push(slot);
  }

  // 迭代更新（简化的 soft assignment）
  for (let iter = 0; iter < cfg.numIterations; iter++) {
    const assignments = computeAssignments(tokens, slots, cfg.temperature);

    // 更新每个 slot
    for (let s = 0; s < cfg.numSlots; s++) {
      const newSlot = new Array(cfg.slotDim).fill(0);
      let totalWeight = 0;

      for (let i = 0; i < n; i++) {
        const w = assignments[i * cfg.numSlots + s];
        totalWeight += w;
        // 加权聚合 token 信息
        newSlot[0] += w * tokens[i];
        newSlot[1] += w * i;
        // 更高维度存储统计信息
        if (cfg.slotDim > 3) newSlot[3] += w * tokens[i] * tokens[i]; // E[x^2]
      }

      if (totalWeight > 0) {
        for (let d = 0; d < cfg.slotDim; d++) {
          newSlot[d] /= totalWeight;
        }
      }

      // 残差更新
      for (let d = 0; d < cfg.slotDim; d++) {
        slots[s][d] = slots[s][d] * 0.5 + newSlot[d] * 0.5;
      }
    }
  }

  return slots;
}

/**
 * 将 slots 编码为 token IDs
 */
export function encodeSlots(slots: number[][]): number[] {
  const tokens: number[] = [];
  for (let s = 0; s < slots.length; s++) {
    // slot ID token
    tokens.push(SLOT_TOKEN_START + s);
    // slot 特征（量化为 token）
    const slot = slots[s];
    if (slot.length > 0) {
      tokens.push(SLOT_TOKEN_START + 8 + quantizeSlotValue(slot[0], 2048, 8)); // slot 特征
    }
    if (slot.length > 1) {
      tokens.push(SLOT_TOKEN_START + 16 + quantizeSlotValue(slot[1], 100, 8)); // 位置
    }
  }
  return tokens;
}

/**
 * 从 Scene Graph 提取 slots（简化版：每个物体一个 slot）
 */
export function graphToSlots(graph: SceneGraph, slotDim = 32): number[][] {
  const slots: number[][] = [];

  for (let i = 0; i < Math.min(graph.nodes.length, MAX_SLOTS); i++) {
    const node = graph.nodes[i];
    const slot = new Array(slotDim).fill(0);
    slot[0] = nodeToToken(node.category);
    slot[1] = node.importance ?? 0.5;
    // 从边中提取关系信息
    const outEdges = graph.edges.filter(e => e.source === node.id);
    slot[2] = outEdges.length;
    slots.push(slot);
  }

  // 补齐到 numSlots
  while (slots.length < MAX_SLOTS) {
    slots.push(new Array(slotDim).fill(0));
  }

  return slots;
}

// ==================== 内部 ====================

function nodeToToken(category: string): number {
  const offset = OBJECT_CATEGORIES[category] ?? OBJECT_CATEGORIES.unknown;
  return NODE_TOKEN_START + offset;
}

function edgeToToken(relation: string): number {
  const offset = SPATIAL_RELATIONS[relation] ?? SPATIAL_RELATIONS.near;
  return EDGE_TOKEN_START + offset;
}

function nodeIdToToken(id: string, nodes: SceneNode[]): number {
  const idx = nodes.findIndex(n => n.id === id);
  if (idx < 0) return NODE_TOKEN_START + OBJECT_CATEGORIES.unknown;
  return NODE_TOKEN_START + (OBJECT_CATEGORIES[nodes[idx].category] ?? OBJECT_CATEGORIES.unknown);
}

function attributeToToken(value: number): number {
  // 数值属性量化为 550-559
  return NODE_TOKEN_START + Math.min(9, Math.floor(Math.max(0, Math.min(1, value)) * 10));
}

function computeAssignments(tokens: number[], slots: number[][], temperature: number): Float32Array {
  const n = tokens.length;
  const k = slots.length;
  const assignments = new Float32Array(n * k);

  for (let i = 0; i < n; i++) {
    let maxLogit = -Infinity;
    for (let s = 0; s < k; s++) {
      // 简化相似度：token 值与 slot 首元素的距离
      const logit = -Math.abs(tokens[i] - slots[s][0]) / temperature;
      assignments[i * k + s] = logit;
      if (logit > maxLogit) maxLogit = logit;
    }

    // softmax
    let sum = 0;
    for (let s = 0; s < k; s++) {
      assignments[i * k + s] = Math.exp(assignments[i * k + s] - maxLogit);
      sum += assignments[i * k + s];
    }
    for (let s = 0; s < k; s++) {
      assignments[i * k + s] /= sum;
    }
  }

  return assignments;
}

function quantizeSlotValue(value: number, max: number, bins: number): number {
  const normalized = Math.max(0, Math.min(max, Math.abs(value))) / max;
  return Math.min(bins - 1, Math.floor(normalized * bins));
}

// ==================== 工具函数 ====================

export function getSceneTokenRange(): { node: [number, number]; edge: [number, number]; slot: [number, number] } {
  return {
    node: [NODE_TOKEN_START, NODE_TOKEN_END],
    edge: [EDGE_TOKEN_START, EDGE_TOKEN_END],
    slot: [SLOT_TOKEN_START, SLOT_TOKEN_END],
  };
}
