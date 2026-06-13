/**
 * 场景世界模型训练数据构建器
 *
 * 三种数据来源：
 * 1. 合成数据 — 随机图 + 规则变换（冷启动）
 * 2. 运行时快照 — 每次交互前后拍快照（最准确）
 * 3. 知识库信号 — 从 KnowledgeSink 接入（通用规律）
 */

import type { SceneGraph, SceneNode, SceneEdge } from '../features/scene-encoder.js';
import type { SceneAction } from './scene-world-model.js';
import type { TrainingSample } from '../../types.js';
import {
  EntityRegistry, type Entity, type Edge, type EntitySnapshot,
  createFileEntity, createFunctionEntity, createToolEntity, createClassEntity,
  createDependencyEdge, createCallEdge, createContainsEdge,
} from './entity-registry.js';

// ==================== 训练样本类型 ====================

export interface WorldModelTrainingSample {
  scene_before: SceneGraph;
  action: SceneAction;
  scene_after: SceneGraph;
  completion: boolean;
  risk_label: number;      // 0-1
  timestamp: number;
  source: 'synthetic' | 'runtime' | 'knowledge' | 'replay';
}

// ==================== 合成数据生成 ====================

/**
 * 生成合成训练数据（冷启动用）
 *
 * 随机生成 scene_graph + action → 用规则模拟 next_scene_graph
 */
export function generateSyntheticSamples(n: number): WorldModelTrainingSample[] {
  const samples: WorldModelTrainingSample[] = [];

  for (let i = 0; i < n; i++) {
    const scene = randomSceneGraph();
    const action = randomAction(scene);
    const nextScene = applyActionRules(scene, action);
    const completion = Math.random() > 0.2;

    samples.push({
      scene_before: scene,
      action,
      scene_after: nextScene,
      completion,
      risk_label: computeSyntheticRisk(scene, action),
      timestamp: Date.now(),
      source: 'synthetic',
    });
  }

  return samples;
}

/** 随机生成场景图 */
function randomSceneGraph(): SceneGraph {
  const numNodes = 3 + Math.floor(Math.random() * 12);
  const nodes: SceneNode[] = [];
  const edges: SceneEdge[] = [];

  const categories = ['file', 'function', 'class', 'module', 'tool', 'memory'];

  for (let i = 0; i < numNodes; i++) {
    const cat = categories[Math.floor(Math.random() * categories.length)];
    nodes.push({
      id: `${cat}_${i}`,
      category: cat,
      attributes: {
        size: Math.random(),
        complexity: Math.random(),
        importance: Math.random(),
      },
      importance: Math.random(),
    });
  }

  // 随机边（30% 密度）
  for (let i = 0; i < numNodes; i++) {
    for (let j = i + 1; j < numNodes; j++) {
      if (Math.random() < 0.3) {
        const relations = ['depends_on', 'calls', 'contains', 'imports', 'similar_to'];
        edges.push({
          source: nodes[i].id,
          target: nodes[j].id,
          relation: relations[Math.floor(Math.random() * relations.length)],
          confidence: 0.5 + Math.random() * 0.5,
        });
      }
    }
  }

  return { nodes, edges };
}

/** 随机生成动作 */
function randomAction(scene: SceneGraph): SceneAction {
  const types = ['read', 'write', 'exec', 'search', 'analyze', 'test'];
  const type = types[Math.floor(Math.random() * types.length)];
  const target = scene.nodes.length > 0
    ? scene.nodes[Math.floor(Math.random() * scene.nodes.length)].id
    : undefined;

  const params = new Float32Array(16);
  params[0] = types.indexOf(type);
  if (target) params[1] = hashTo01(target);

  return { type, target_entity: target, params };
}

/** 用规则模拟动作执行后的场景变化 */
function applyActionRules(scene: SceneGraph, action: SceneAction): SceneGraph {
  const nextNodes: SceneNode[] = scene.nodes.map(n => ({ ...n, attributes: { ...n.attributes } }));
  const nextEdges: SceneEdge[] = [...scene.edges];

  switch (action.type) {
    case 'write': {
      // 写操作：目标文件的 size 增加，可能新增依赖
      const target = nextNodes.find(n => n.id === action.target_entity);
      if (target && target.attributes) {
        target.attributes.size = (target.attributes.size as number ?? 0) + Math.random() * 0.2;
        target.importance = Math.min(1, (target.importance ?? 0.5) + 0.1);
      }
      // 30% 概率新增边
      if (Math.random() < 0.3 && nextNodes.length > 1) {
        const src = nextNodes[Math.floor(Math.random() * nextNodes.length)];
        const tgt = nextNodes[Math.floor(Math.random() * nextNodes.length)];
        if (src.id !== tgt.id) {
          nextEdges.push({
            source: src.id,
            target: tgt.id,
            relation: 'depends_on',
            confidence: 0.6,
          });
        }
      }
      break;
    }
    case 'read': {
      // 读操作：目标文件的访问频率增加
      const target = nextNodes.find(n => n.id === action.target_entity);
      if (target && target.attributes) {
        target.importance = Math.min(1, (target.importance ?? 0.5) + 0.05);
      }
      break;
    }
    case 'exec': {
      // 执行：可能新增工具实体，状态变化
      if (Math.random() < 0.2) {
        nextNodes.push({
          id: `tool_exec_${Date.now()}`,
          category: 'tool',
          attributes: { usage: 1, success_rate: Math.random() },
          importance: 0.3,
        });
      }
      break;
    }
    case 'analyze': {
      // 分析：可能发现新依赖关系
      if (nextNodes.length > 2 && Math.random() < 0.4) {
        const i = Math.floor(Math.random() * nextNodes.length);
        const j = Math.floor(Math.random() * nextNodes.length);
        if (i !== j) {
          nextEdges.push({
            source: nextNodes[i].id,
            target: nextNodes[j].id,
            relation: 'similar_to',
            confidence: 0.7,
          });
        }
      }
      break;
    }
  }

  return { nodes: nextNodes, edges: nextEdges };
}

/** 计算合成风险分数 */
function computeSyntheticRisk(scene: SceneGraph, action: SceneAction): number {
  let risk = 0.2;

  // 高扇出节点的风险更高
  const targetEdges = scene.edges.filter(e =>
    e.source === action.target_entity || e.target === action.target_entity,
  );
  risk += targetEdges.length * 0.05;

  // 写操作比读操作风险高
  if (action.type === 'write' || action.type === 'exec') risk += 0.2;

  // 复杂场景风险更高
  risk += scene.nodes.length * 0.01;

  return Math.min(1, risk);
}

// ==================== 运行时快照构建 ====================

/**
 * 从运行时数据构建训练样本
 *
 * 在 agent.ts 的工具执行前后调用：
 *   const before = registry.snapshot();
 *   await executeTool(action);
 *   const after = registry.snapshot();
 *   const sample = buildRuntimeSample(before, after, action, outcome);
 */
export function buildRuntimeSample(
  before: EntitySnapshot,
  after: EntitySnapshot,
  action: SceneAction,
  outcome: { success: boolean; latencyMs: number },
  registry: EntityRegistry,
): WorldModelTrainingSample {
  const sceneBefore = snapshotToSceneGraph(before);
  const sceneAfter = snapshotToSceneGraph(after);

  return {
    scene_before: sceneBefore,
    action,
    scene_after: sceneAfter,
    completion: outcome.success,
    risk_label: computeRuntimeRisk(before, after, outcome),
    timestamp: Date.now(),
    source: 'runtime',
  };
}

/** EntitySnapshot → SceneGraph */
function snapshotToSceneGraph(snapshot: EntitySnapshot): SceneGraph {
  const nodes: SceneNode[] = [];
  const edges: SceneEdge[] = [];

  for (const entity of snapshot.entities.values()) {
    nodes.push({
      id: entity.id,
      category: entity.type,
      attributes: {
        ...entity.attributes,
        pos_x: entity.position[0],
        pos_y: entity.position[1],
        pos_z: entity.position[2],
      },
      importance: computeEntityImportance(entity, snapshot.edges),
    });
  }

  for (const edge of snapshot.edges) {
    edges.push({
      source: edge.source,
      target: edge.target,
      relation: edge.relation,
      confidence: edge.confidence,
    });
  }

  return { nodes, edges };
}

function computeEntityImportance(entity: Entity, edges: Edge[]): number {
  const edgeCount = edges.filter(e => e.source === entity.id || e.target === entity.id).length;
  return Math.min(1, 0.3 + edgeCount * 0.1);
}

function computeRuntimeRisk(before: EntitySnapshot, after: EntitySnapshot, outcome: { success: boolean }): number {
  if (!outcome.success) return 0.8;

  const beforeSize = before.entities.size;
  const afterSize = after.entities.size;
  const change = Math.abs(afterSize - beforeSize) / Math.max(1, beforeSize);

  return Math.min(1, 0.1 + change * 0.5);
}

// ==================== 知识库信号转换 ====================

/**
 * 将知识库信号转换为世界模型训练样本
 *
 * 知识条目格式：
 * { pattern: "循环依赖", entities: [A, B], relation: "depends_on", label: "bad" }
 */
export function knowledgeToTrainingSample(
  knowledge: {
    pattern: string;
    entities: string[];
    relations?: Array<{ from: string; to: string; type: string }>;
    label: 'good' | 'bad' | 'neutral';
    suggestion?: string;
  },
): WorldModelTrainingSample {
  const nodes: SceneNode[] = knowledge.entities.map((e, i) => ({
    id: e,
    category: inferCategory(e),
    attributes: { index: i },
    importance: 0.5,
  }));

  const edges: SceneEdge[] = (knowledge.relations ?? []).map(r => ({
    source: r.from,
    target: r.to,
    relation: r.type,
    confidence: 0.8,
  }));

  const sceneBefore: SceneGraph = { nodes, edges };

  // 根据标签构建"理想"的下一场景
  const sceneAfter: SceneGraph = knowledge.label === 'bad'
    ? fixBadPattern(sceneBefore, knowledge.pattern)
    : { ...sceneBefore };

  return {
    scene_before: sceneBefore,
    action: { type: 'analyze', params: new Float32Array(16) },
    scene_after: sceneAfter,
    completion: knowledge.label !== 'bad',
    risk_label: knowledge.label === 'bad' ? 0.8 : knowledge.label === 'good' ? 0.1 : 0.4,
    timestamp: Date.now(),
    source: 'knowledge',
  };
}

function inferCategory(entity: string): string {
  if (entity.endsWith('.ts') || entity.endsWith('.js')) return 'file';
  if (entity[0] === entity[0].toUpperCase()) return 'class';
  return 'function';
}

function fixBadPattern(scene: SceneGraph, pattern: string): SceneGraph {
  const fixed = { nodes: [...scene.nodes], edges: [...scene.edges] };

  if (pattern.includes('循环依赖') || pattern.includes('circular')) {
    // 移除循环边
    for (let i = 0; i < fixed.edges.length; i++) {
      const edge = fixed.edges[i];
      const reverse = fixed.edges.find(e => e.source === edge.target && e.target === edge.source);
      if (reverse) {
        fixed.edges.splice(i, 1);
        i--;
      }
    }
  }

  return fixed;
}

// ==================== 转换为 NN 训练样本 ====================

/**
 * 将 WorldModelTrainingSample 转换为 NN TrainingSample
 * （接入 ReplayBuffer 的标准格式）
 */
export function toNNSample(sample: WorldModelTrainingSample): TrainingSample {
  // 简化：将 scene_before 编码为特征向量
  const features = new Float32Array(64);
  const scene = sample.scene_before;

  // 编码场景统计
  features[0] = scene.nodes.length / 32;
  features[1] = scene.edges.length / 64;
  features[2] = sample.completion ? 1 : 0;
  features[3] = sample.risk_label;

  // 编码节点类型分布
  const typeCount = new Float32Array(6);
  for (const node of scene.nodes) {
    const idx = ['file', 'function', 'class', 'module', 'tool', 'memory'].indexOf(node.category);
    if (idx >= 0) typeCount[idx]++;
  }
  for (let i = 0; i < 6; i++) features[4 + i] = typeCount[i] / Math.max(1, scene.nodes.length);

  // 编码动作
  features[10] = actionTypeId(sample.action.type) / 14;

  return {
    features,
    labelIntent: 0,
    labelTools: [],
    labelQuality: sample.completion ? 0.8 : 0.2,
    outcome: sample.completion,
    timestamp: sample.timestamp,
    weight: sample.source === 'knowledge' ? 2.0 : sample.source === 'runtime' ? 1.5 : 1.0,
    difficulty: sample.risk_label,
  };
}

function actionTypeId(type: string): number {
  const map: Record<string, number> = {
    read: 0, write: 1, exec: 2, search: 3, commit: 4,
    analyze: 5, test: 6, deploy: 7, refactor: 8, debug: 9,
  };
  return map[type] ?? 0;
}

function hashTo01(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash = hash & hash;
  }
  return (Math.abs(hash) % 1000) / 1000;
}
