/**
 * 实体注册中心 — 统一管理所有实体的提取和图构建
 *
 * 从各子系统提取实体：
 * - project.ts → 文件/函数/类/模块
 * - stmp.ts → 记忆/概念
 * - experience-graph.ts → 经验节点
 * - knowledge/extractor.ts → 知识实体
 * - tools → 工具实体
 *
 * 输出统一的 SceneGraph，供 GNN World Model 使用
 */

import type { SceneGraph, SceneNode, SceneEdge } from '../features/scene-encoder.js';

// ==================== 实体类型 ====================

export type EntityType =
  | 'file' | 'function' | 'class' | 'module' | 'variable'
  | 'tool' | 'memory' | 'concept' | 'experience' | 'knowledge'
  | 'user_intent' | 'task' | 'dependency' | 'config';

export type EdgeRelation =
  | 'depends_on' | 'calls' | 'contains' | 'imports'
  | 'similar_to' | 'conflicts_with' | 'derived_from'
  | 'uses' | 'creates' | 'modifies' | 'reads'
  | 'triggers' | 'requires' | 'produces' | 'relates_to';

// ==================== 实体定义 ====================

export interface Entity {
  id: string;
  type: EntityType;
  label: string;
  position: [number, number, number];  // 语义空间坐标 (归一化 0-1)
  state_vector: Float32Array;          // 状态特征向量
  attributes: Record<string, number>;
  created_at: number;
  updated_at: number;
}

export interface Edge {
  source: string;          // 源实体 ID
  target: string;          // 目标实体 ID
  relation: EdgeRelation;
  weight: number;          // 关系强度 0-1
  confidence: number;      // 置信度 0-1
  created_at: number;
}

export interface EntitySnapshot {
  entities: Map<string, Entity>;
  edges: Edge[];
  timestamp: number;
}

// ==================== 配置 ====================

export interface EntityRegistryConfig {
  /** 状态向量维度 */
  stateDim: number;
  /** 最大实体数 */
  maxEntities: number;
  /** 最大边数 */
  maxEdges: number;
  /** 实体过期时间 (ms) */
  entityTtlMs: number;
}

const DEFAULT_CONFIG: EntityRegistryConfig = {
  stateDim: 8,
  maxEntities: 64,
  maxEdges: 128,
  entityTtlMs: 3600_000, // 1小时
};

// ==================== EntityRegistry ====================

export class EntityRegistry {
  private config: EntityRegistryConfig;
  private entities: Map<string, Entity> = new Map();
  private edges: Edge[] = [];
  private verbose: boolean;

  constructor(config?: Partial<EntityRegistryConfig>, verbose = false) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.verbose = verbose;
  }

  // ── 实体管理 ──

  /** 添加或更新实体 */
  addEntity(entity: Entity): void {
    const existing = this.entities.get(entity.id);
    if (existing) {
      // 合并：保留旧的 position 作为历史，更新 state_vector
      existing.state_vector = entity.state_vector;
      existing.attributes = { ...existing.attributes, ...entity.attributes };
      existing.updated_at = Date.now();
    } else {
      // 新实体
      if (this.entities.size >= this.config.maxEntities) {
        this.evictOldest();
      }
      this.entities.set(entity.id, { ...entity, created_at: entity.created_at ?? Date.now(), updated_at: Date.now() });
    }
  }

  /** 批量添加实体 */
  addEntities(entities: Entity[]): void {
    for (const e of entities) this.addEntity(e);
  }

  /** 添加边 */
  addEdge(edge: Edge): void {
    // 去重：同一 (source, target, relation) 只保留一条
    const existing = this.edges.find(
      e => e.source === edge.source && e.target === edge.target && e.relation === edge.relation,
    );
    if (existing) {
      existing.weight = edge.weight;
      existing.confidence = edge.confidence;
    } else {
      if (this.edges.length >= this.config.maxEdges) {
        this.evictOldestEdge();
      }
      this.edges.push({ ...edge, created_at: edge.created_at ?? Date.now() });
    }
  }

  /** 批量添加边 */
  addEdges(edges: Edge[]): void {
    for (const e of edges) this.addEdge(e);
  }

  /** 获取实体 */
  getEntity(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  /** 获取所有实体 */
  getAllEntities(): Entity[] {
    return [...this.entities.values()];
  }

  /** 获取所有边 */
  getAllEdges(): Edge[] {
    return [...this.edges];
  }

  /** 获取实体数量 */
  get entityCount(): number {
    return this.entities.size;
  }

  /** 获取边数量 */
  get edgeCount(): number {
    return this.edges.length;
  }

  // ── 图构建 ──

  /** 构建 SceneGraph（供 SceneEncoder 和 GNN 使用） */
  toSceneGraph(): SceneGraph {
    const nodes: SceneNode[] = [];
    const edges: SceneEdge[] = [];

    for (const entity of this.entities.values()) {
      nodes.push({
        id: entity.id,
        category: entity.type,
        attributes: {
          ...entity.attributes,
          pos_x: entity.position[0],
          pos_y: entity.position[1],
          pos_z: entity.position[2],
        },
        importance: this.computeImportance(entity),
      });
    }

    for (const edge of this.edges) {
      // 只包含两端都存在的边
      if (this.entities.has(edge.source) && this.entities.has(edge.target)) {
        edges.push({
          source: edge.source,
          target: edge.target,
          relation: edge.relation,
          confidence: edge.confidence,
        });
      }
    }

    return { nodes, edges };
  }

  /** 构建快照（用于训练数据） */
  snapshot(): EntitySnapshot {
    return {
      entities: new Map(this.entities),
      edges: [...this.edges],
      timestamp: Date.now(),
    };
  }

  /** 计算两个快照之间的差异 */
  diff(before: EntitySnapshot, after: EntitySnapshot): SceneDiff {
    const addedEntities: Entity[] = [];
    const removedEntities: string[] = [];
    const changedEntities: Array<{ id: string; before: Entity; after: Entity }> = [];

    // 新增/变化的实体
    for (const [id, afterEntity] of after.entities) {
      const beforeEntity = before.entities.get(id);
      if (!beforeEntity) {
        addedEntities.push(afterEntity);
      } else if (this.entitiesChanged(beforeEntity, afterEntity)) {
        changedEntities.push({ id, before: beforeEntity, after: afterEntity });
      }
    }

    // 删除的实体
    for (const [id] of before.entities) {
      if (!after.entities.has(id)) {
        removedEntities.push(id);
      }
    }

    // 边的变化
    const addedEdges = after.edges.filter(
      e => !before.edges.some(be => be.source === e.source && be.target === e.target && be.relation === e.relation),
    );
    const removedEdges = before.edges.filter(
      e => !after.edges.some(ae => ae.source === e.source && ae.target === e.target && ae.relation === e.relation),
    );

    return {
      addedEntities,
      removedEntities,
      changedEntities,
      addedEdges,
      removedEdges,
      totalChangeScore: this.computeChangeScore(addedEntities, removedEntities, changedEntities, addedEdges, removedEdges),
    };
  }

  // ── 快照差异计算 ──

  /** 计算实体重要性 */
  private computeImportance(entity: Entity): number {
    // 基于：边的数量 + 最近更新时间 + 状态向量能量
    const edgeCount = this.edges.filter(e => e.source === entity.id || e.target === entity.id).length;
    const recency = Math.min(1, (Date.now() - entity.updated_at) / this.config.entityTtlMs);
    let energy = 0;
    for (let i = 0; i < entity.state_vector.length; i++) {
      energy += entity.state_vector[i] * entity.state_vector[i];
    }
    energy = Math.sqrt(energy) / entity.state_vector.length;

    return Math.min(1, edgeCount * 0.1 + (1 - recency) * 0.3 + energy * 0.6);
  }

  /** 判断实体是否变化 */
  private entitiesChanged(a: Entity, b: Entity): boolean {
    if (a.type !== b.type) return true;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(a.position[i] - b.position[i]) > 0.01) return true;
    }
    for (let i = 0; i < Math.min(a.state_vector.length, b.state_vector.length); i++) {
      if (Math.abs(a.state_vector[i] - b.state_vector[i]) > 0.05) return true;
    }
    return false;
  }

  /** 计算变化分数 */
  private computeChangeScore(
    added: Entity[], removed: string[], changed: Array<{ id: string }>,
    addedEdges: Edge[], removedEdges: Edge[],
  ): number {
    const total = this.entities.size || 1;
    return Math.min(1,
      (added.length + removed.length + changed.length) / total * 0.5 +
      (addedEdges.length + removedEdges.length) / Math.max(1, this.edges.length) * 0.5,
    );
  }

  /** 淘汰最旧的实体 */
  private evictOldest(): void {
    let oldestId = '';
    let oldestTime = Infinity;
    for (const [id, entity] of this.entities) {
      if (entity.updated_at < oldestTime) {
        oldestTime = entity.updated_at;
        oldestId = id;
      }
    }
    if (oldestId) {
      this.entities.delete(oldestId);
      this.edges = this.edges.filter(e => e.source !== oldestId && e.target !== oldestId);
    }
  }

  /** 淘汰最旧的边 */
  private evictOldestEdge(): void {
    if (this.edges.length > 0) {
      this.edges.sort((a, b) => a.created_at - b.created_at);
      this.edges.shift();
    }
  }

  // ── 清理 ──

  /** 清理过期实体 */
  cleanup(): number {
    const now = Date.now();
    const expired: string[] = [];
    for (const [id, entity] of this.entities) {
      if (now - entity.updated_at > this.config.entityTtlMs) {
        expired.push(id);
      }
    }
    for (const id of expired) {
      this.entities.delete(id);
      this.edges = this.edges.filter(e => e.source !== id && e.target !== id);
    }
    return expired.length;
  }

  /** 清空所有 */
  clear(): void {
    this.entities.clear();
    this.edges = [];
  }
}

// ==================== 差异类型 ====================

export interface SceneDiff {
  addedEntities: Entity[];
  removedEntities: string[];
  changedEntities: Array<{ id: string; before: Entity; after: Entity }>;
  addedEdges: Edge[];
  removedEdges: Edge[];
  totalChangeScore: number; // 0-1
}

// ==================== 实体工厂函数 ====================

/** 创建文件实体 */
export function createFileEntity(path: string, size: number, language?: string): Entity {
  return {
    id: `file:${path}`,
    type: 'file',
    label: path.split('/').pop() ?? path,
    position: [hashTo01(path), size / 10000, 0.5],
    state_vector: createStateVector([size / 10000, language ? 1 : 0, 0, 0, 0, 0, 0, 0]),
    attributes: { size, lines: 0 },
    created_at: Date.now(),
    updated_at: Date.now(),
  };
}

/** 创建函数实体 */
export function createFunctionEntity(name: string, file: string, line: number, complexity: number): Entity {
  return {
    id: `func:${file}:${name}`,
    type: 'function',
    label: name,
    position: [hashTo01(file), line / 1000, complexity / 10],
    state_vector: createStateVector([complexity / 10, line / 1000, 0, 0, 0, 0, 0, 0]),
    attributes: { line, complexity },
    created_at: Date.now(),
    updated_at: Date.now(),
  };
}

/** 创建类实体 */
export function createClassEntity(name: string, file: string, methodCount: number): Entity {
  return {
    id: `class:${file}:${name}`,
    type: 'class',
    label: name,
    position: [hashTo01(file), methodCount / 20, 0.5],
    state_vector: createStateVector([methodCount / 20, 0, 0, 0, 0, 0, 0, 0]),
    attributes: { methods: methodCount },
    created_at: Date.now(),
    updated_at: Date.now(),
  };
}

/** 创建工具实体 */
export function createToolEntity(name: string, usageCount: number, successRate: number): Entity {
  return {
    id: `tool:${name}`,
    type: 'tool',
    label: name,
    position: [hashTo01(name), successRate, usageCount / 100],
    state_vector: createStateVector([usageCount / 100, successRate, 0, 0, 0, 0, 0, 0]),
    attributes: { usage: usageCount, success_rate: successRate },
    created_at: Date.now(),
    updated_at: Date.now(),
  };
}

/** 创建记忆实体 */
export function createMemoryEntity(id: string, content: string, importance: number): Entity {
  return {
    id: `memory:${id}`,
    type: 'memory',
    label: content.slice(0, 30),
    position: [hashTo01(id), importance, 0.5],
    state_vector: createStateVector([importance, content.length / 1000, 0, 0, 0, 0, 0, 0]),
    attributes: { importance, length: content.length },
    created_at: Date.now(),
    updated_at: Date.now(),
  };
}

/** 创建依赖边 */
export function createDependencyEdge(from: string, to: string, weight = 0.8): Edge {
  return {
    source: from,
    target: to,
    relation: 'depends_on',
    weight,
    confidence: 0.9,
    created_at: Date.now(),
  };
}

/** 创建调用边 */
export function createCallEdge(caller: string, callee: string, weight = 0.7): Edge {
  return {
    source: caller,
    target: callee,
    relation: 'calls',
    weight,
    confidence: 0.85,
    created_at: Date.now(),
  };
}

/** 创建包含边 */
export function createContainsEdge(container: string, contained: string): Edge {
  return {
    source: container,
    target: contained,
    relation: 'contains',
    weight: 1.0,
    confidence: 1.0,
    created_at: Date.now(),
  };
}

// ==================== 工具函数 ====================

/** 字符串哈希映射到 0-1 */
function hashTo01(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash = hash & hash;
  }
  return (Math.abs(hash) % 1000) / 1000;
}

/** 创建状态向量 */
function createStateVector(values: number[]): Float32Array {
  const dim = 8;
  const vec = new Float32Array(dim);
  for (let i = 0; i < Math.min(values.length, dim); i++) {
    vec[i] = Math.max(0, Math.min(1, values[i]));
  }
  return vec;
}
