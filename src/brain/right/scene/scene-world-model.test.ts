/**
 * Scene World Model 测试
 *
 * 覆盖：
 * 1. EntityRegistry CRUD
 * 2. SceneGraph 构建
 * 3. GNN Layer 前向传播
 * 4. SceneWorldModel.predict 单步预测
 * 5. SceneWorldModel.imagine 多步想象
 * 6. SceneWorldModel.bestAction 多方案对比
 * 7. 兼容旧 WorldModel 接口
 * 8. 合成数据生成
 * 9. 性能 < 5ms
 */

import { describe, it, expect } from 'vitest';
import { EntityRegistry, createFileEntity, createFunctionEntity, createDependencyEdge, createCallEdge, createContainsEdge } from './entity-registry.js';
import { GNNLayer } from './gnn-layer.js';
import { SceneWorldModel } from './scene-world-model.js';
import { generateSyntheticSamples, toNNSample } from './scene-training.js';
import type { SceneGraph, SceneNode, SceneEdge } from '../features/scene-encoder.js';

// ==================== 辅助 ====================

function makeSimpleScene(): SceneGraph {
  return {
    nodes: [
      { id: 'file_a', category: 'file', attributes: { size: 0.5 }, importance: 0.8 },
      { id: 'func_b', category: 'function', attributes: { complexity: 0.3 }, importance: 0.6 },
      { id: 'class_c', category: 'class', attributes: { methods: 0.4 }, importance: 0.7 },
      { id: 'tool_d', category: 'tool', attributes: { usage: 0.9 }, importance: 0.5 },
    ],
    edges: [
      { source: 'file_a', target: 'func_b', relation: 'contains', confidence: 0.9 },
      { source: 'func_b', target: 'class_c', relation: 'calls', confidence: 0.8 },
      { source: 'file_a', target: 'class_c', relation: 'imports', confidence: 0.7 },
    ],
  };
}

function makeSimpleAction() {
  return {
    type: 'write',
    target_entity: 'file_a',
    params: new Float32Array([1, 0.5, 0.3]),
  };
}

// ==================== 测试 ====================

describe('EntityRegistry', () => {
  it('添加和获取实体', () => {
    const registry = new EntityRegistry();
    const entity = createFileEntity('/src/test.ts', 1000, 'typescript');
    registry.addEntity(entity);

    expect(registry.entityCount).toBe(1);
    expect(registry.getEntity('file:/src/test.ts')).toBeDefined();
    expect(registry.getEntity('file:/src/test.ts')?.type).toBe('file');
  });

  it('添加边', () => {
    const registry = new EntityRegistry();
    registry.addEntity(createFileEntity('/src/a.ts', 500));
    registry.addEntity(createFileEntity('/src/b.ts', 300));
    registry.addEdge(createDependencyEdge('file:/src/a.ts', 'file:/src/b.ts'));

    expect(registry.edgeCount).toBe(1);
  });

  it('toSceneGraph', () => {
    const registry = new EntityRegistry();
    registry.addEntity(createFileEntity('/src/a.ts', 500));
    registry.addEntity(createFunctionEntity('foo', '/src/a.ts', 10, 3));
    registry.addEdge(createContainsEdge('file:/src/a.ts', 'func:/src/a.ts:foo'));

    const graph = registry.toSceneGraph();
    expect(graph.nodes.length).toBe(2);
    expect(graph.edges.length).toBe(1);
    expect(graph.nodes[0].category).toBe('file');
    expect(graph.nodes[1].category).toBe('function');
  });

  it('快照和差异', () => {
    const registry = new EntityRegistry();
    registry.addEntity(createFileEntity('/src/a.ts', 500));
    const snap1 = registry.snapshot();

    registry.addEntity(createFileEntity('/src/b.ts', 300));
    const snap2 = registry.snapshot();

    const diff = registry.diff(snap1, snap2);
    expect(diff.addedEntities.length).toBe(1);
    expect(diff.removedEntities.length).toBe(0);
  });

  it('淘汰最旧实体', () => {
    const registry = new EntityRegistry({ maxEntities: 3 });
    registry.addEntity(createFileEntity('/a.ts', 100));
    registry.addEntity(createFileEntity('/b.ts', 200));
    registry.addEntity(createFileEntity('/c.ts', 300));
    registry.addEntity(createFileEntity('/d.ts', 400)); // 应该淘汰 /a.ts

    expect(registry.entityCount).toBe(3);
    expect(registry.getEntity('file:/a.ts')).toBeUndefined();
  });
});

describe('GNNLayer', () => {
  it('前向传播', () => {
    const layer = new GNNLayer({ nodeDim: 8, edgeDim: 4, actionDim: 4, hiddenDim: 16, outputDim: 8 });

    const nodes = [
      new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]),
      new Float32Array([0, 1, 0, 0, 0, 0, 0, 0]),
      new Float32Array([0, 0, 1, 0, 0, 0, 0, 0]),
    ];
    const edgeIndex: [number[], number[]] = [[0, 1], [1, 2]];
    const edgeFeatures = [new Float32Array([1, 0, 0, 0]), new Float32Array([0, 1, 0, 0])];
    const action = new Float32Array([1, 0, 0, 0]);

    const output = layer.forward(nodes, edgeIndex, edgeFeatures, action);

    expect(output.length).toBe(3);
    expect(output[0].length).toBe(8);
    // 每个节点应该有不同的特征（因为邻居不同）
    let diff = 0;
    for (let i = 0; i < 8; i++) diff += Math.abs(output[0][i] - output[1][i]);
    expect(diff).toBeGreaterThan(0);
  });

  it('无边时输出不全为零', () => {
    const layer = new GNNLayer({ nodeDim: 4, edgeDim: 2, actionDim: 2, hiddenDim: 8, outputDim: 4 });
    const nodes = [new Float32Array([10, 20, 30, 40])];
    const edgeIndex: [number[], number[]] = [[], []];
    const action = new Float32Array([0, 0]);

    const output = layer.forward(nodes, edgeIndex, [], action);

    // 残差连接：即使无邻居，输出也不全为零
    let nonzero = 0;
    for (let i = 0; i < 4; i++) {
      if (Math.abs(output[0][i]) > 0.01) nonzero++;
    }
    expect(nonzero).toBeGreaterThan(0);
  });
});

describe('SceneWorldModel', () => {
  it('构造成功', () => {
    const wm = new SceneWorldModel();
    expect(wm).toBeDefined();
    expect(wm.countParams()).toBeGreaterThan(0);
  });

  it('predict 返回完整结果', () => {
    const wm = new SceneWorldModel({ gnn: { nodeDim: 16, edgeDim: 8, actionDim: 8, hiddenDim: 32, outputDim: 16 } });
    const scene = makeSimpleScene();
    const action = makeSimpleAction();

    const result = wm.predict(scene, action);

    expect(result.nextScene).toBeDefined();
    expect(result.nextScene.nodes.length).toBe(scene.nodes.length);
    expect(result.entityChanges.length).toBe(scene.nodes.length);
    expect(result.completionProb).toBeGreaterThanOrEqual(0);
    expect(result.completionProb).toBeLessThanOrEqual(1);
    expect(result.riskScore).toBeGreaterThanOrEqual(0);
    expect(result.riskScore).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.latencyMs).toBeGreaterThan(0);
  });

  it('imagine 返回多步预测', () => {
    const wm = new SceneWorldModel({ gnn: { nodeDim: 16, edgeDim: 8, actionDim: 8, hiddenDim: 32, outputDim: 16 } });
    const scene = makeSimpleScene();
    const actions = [
      makeSimpleAction(),
      { type: 'read', target_entity: 'func_b', params: new Float32Array(8) },
      { type: 'exec', params: new Float32Array(8) },
    ];

    const results = wm.imagine(scene, actions);

    expect(results.length).toBe(3);
    // 每步的场景应该不同
    for (let i = 1; i < results.length; i++) {
      expect(results[i].nextScene).toBeDefined();
    }
  });

  it('bestAction 返回最优方案', () => {
    const wm = new SceneWorldModel({ gnn: { nodeDim: 16, edgeDim: 8, actionDim: 8, hiddenDim: 32, outputDim: 16 } });
    const scene = makeSimpleScene();
    const candidates = [
      { action: { type: 'read', params: new Float32Array(8) }, label: 'read' },
      { action: { type: 'write', target_entity: 'file_a', params: new Float32Array(8) }, label: 'write' },
      { action: { type: 'exec', params: new Float32Array(8) }, label: 'exec' },
    ];

    const best = wm.bestAction(scene, candidates);

    expect(best).not.toBeNull();
    expect(best!.label).toBeTruthy();
    expect(best!.prediction).toBeDefined();
  });

  it('兼容旧接口 predictLegacy', () => {
    const wm = new SceneWorldModel();
    const latent = new Float32Array(64);
    for (let i = 0; i < 64; i++) latent[i] = Math.sin(i * 0.1);
    const action = wm.encodeActionLegacy(1, [0.5, 0.3]);

    const result = wm.predictLegacy(latent, action);

    expect(result.nextLatent.length).toBe(64);
    expect(result.spatialDelta.length).toBe(6);
    expect(result.topologyChangeProb).toBeGreaterThanOrEqual(0);
    expect(result.topologyChangeProb).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('兼容旧接口 imagineLegacy', () => {
    const wm = new SceneWorldModel();
    const latent = new Float32Array(64);
    const actions = [
      wm.encodeActionLegacy(0),
      wm.encodeActionLegacy(1),
      wm.encodeActionLegacy(2),
    ];

    const results = wm.imagineLegacy(latent, actions);

    expect(results.length).toBe(3);
    for (const r of results) {
      expect(r.nextLatent.length).toBe(64);
    }
  });
});

describe('合成数据', () => {
  it('生成指定数量的样本', () => {
    const samples = generateSyntheticSamples(10);
    expect(samples.length).toBe(10);
  });

  it('样本包含完整字段', () => {
    const samples = generateSyntheticSamples(1);
    const s = samples[0];
    expect(s.scene_before).toBeDefined();
    expect(s.action).toBeDefined();
    expect(s.scene_after).toBeDefined();
    expect(typeof s.completion).toBe('boolean');
    expect(s.risk_label).toBeGreaterThanOrEqual(0);
    expect(s.risk_label).toBeLessThanOrEqual(1);
    expect(s.source).toBe('synthetic');
  });

  it('转换为 NN 样本', () => {
    const samples = generateSyntheticSamples(1);
    const nn = toNNSample(samples[0]);
    expect(nn.features.length).toBe(64);
    expect(typeof nn.outcome).toBe('boolean');
    expect(nn.weight).toBeGreaterThan(0);
  });
});

describe('性能', () => {
  it('单步 predict < 5ms', () => {
    const wm = new SceneWorldModel({ gnn: { nodeDim: 16, edgeDim: 8, actionDim: 8, hiddenDim: 32, outputDim: 16 } });
    const scene = makeSimpleScene();
    const action = makeSimpleAction();

    // warmup
    wm.predict(scene, action);

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      wm.predict(scene, action);
    }
    const avg = (performance.now() - start) / 100;

    expect(avg).toBeLessThan(5);
  });

  it('3步 imagine < 15ms', () => {
    const wm = new SceneWorldModel({ gnn: { nodeDim: 16, edgeDim: 8, actionDim: 8, hiddenDim: 32, outputDim: 16 } });
    const scene = makeSimpleScene();
    const actions = [
      makeSimpleAction(),
      makeSimpleAction(),
      makeSimpleAction(),
    ];

    const start = performance.now();
    wm.imagine(scene, actions);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(15);
  });
});
