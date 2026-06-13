/**
 * A/B 对比测试 — SceneWorldModel vs 旧 WorldModel
 *
 * 在相同场景+动作下，对比新旧世界模型的：
 * 1. 预测质量（置信度、拓扑变化预测）
 * 2. 推理延迟
 * 3. 多步想象稳定性
 * 4. 动作选择一致性（bestAction 是否选同一动作）
 * 5. 结构化预测能力（SceneWorldModel 独有的 entity/edge change）
 *
 * 使用 ABTestRecorder 记录结果并生成统计报告
 */

import { describe, it, expect } from 'vitest';
import { WorldModel, type ActionEncoding } from '../nn/world-model.js';
import { SceneWorldModel, type SceneAction } from './scene-world-model.js';
import { ABTestRecorder } from '../../shadow/ab-recorder.js';
import type { SceneGraph, SceneNode, SceneEdge } from '../features/scene-encoder.js';

// ==================== 辅助 ====================

/** 构建中等复杂度的场景图（8 节点 10 边，属性归一化到 0-1） */
function makeMediumScene(): SceneGraph {
  return {
    nodes: [
      { id: 'file_agent', category: 'file', attributes: { size: 0.5, complexity: 0.6 }, importance: 0.9 },
      { id: 'file_tools', category: 'file', attributes: { size: 0.3, complexity: 0.4 }, importance: 0.7 },
      { id: 'fn_handle', category: 'function', attributes: { complexity: 0.5, loc: 0.3 }, importance: 0.8 },
      { id: 'fn_search', category: 'function', attributes: { complexity: 0.2, loc: 0.1 }, importance: 0.5 },
      { id: 'cls_agent', category: 'class', attributes: { methods: 0.4, depth: 0.3 }, importance: 0.85 },
      { id: 'tool_web', category: 'tool', attributes: { usage: 0.9, latency: 0.3 }, importance: 0.6 },
      { id: 'tool_fs', category: 'tool', attributes: { usage: 0.7, latency: 0.1 }, importance: 0.55 },
      { id: 'fn_process', category: 'function', attributes: { complexity: 0.35, loc: 0.2 }, importance: 0.65 },
    ],
    edges: [
      { source: 'file_agent', target: 'fn_handle', relation: 'contains', confidence: 0.95 },
      { source: 'file_agent', target: 'cls_agent', relation: 'contains', confidence: 0.9 },
      { source: 'file_agent', target: 'fn_process', relation: 'contains', confidence: 0.85 },
      { source: 'file_tools', target: 'fn_search', relation: 'contains', confidence: 0.9 },
      { source: 'fn_handle', target: 'fn_search', relation: 'calls', confidence: 0.75 },
      { source: 'fn_handle', target: 'tool_web', relation: 'uses', confidence: 0.8 },
      { source: 'fn_handle', target: 'tool_fs', relation: 'uses', confidence: 0.6 },
      { source: 'file_agent', target: 'file_tools', relation: 'imports', confidence: 0.7 },
      { source: 'cls_agent', target: 'fn_handle', relation: 'calls', confidence: 0.85 },
      { source: 'fn_process', target: 'fn_handle', relation: 'calls', confidence: 0.7 },
    ],
  };
}

/** 构建简单场景图（4 节点 3 边，属性归一化到 0-1） */
function makeSimpleScene(): SceneGraph {
  return {
    nodes: [
      { id: 'main_ts', category: 'file', attributes: { size: 0.4, complexity: 0.3 }, importance: 0.8 },
      { id: 'fn_main', category: 'function', attributes: { complexity: 0.2, loc: 0.1 }, importance: 0.7 },
      { id: 'tool_exec', category: 'tool', attributes: { usage: 0.85, latency: 0.2 }, importance: 0.6 },
      { id: 'utils_ts', category: 'file', attributes: { size: 0.2, complexity: 0.15 }, importance: 0.5 },
    ],
    edges: [
      { source: 'main_ts', target: 'fn_main', relation: 'contains', confidence: 0.95 },
      { source: 'fn_main', target: 'tool_exec', relation: 'uses', confidence: 0.8 },
      { source: 'main_ts', target: 'utils_ts', relation: 'imports', confidence: 0.7 },
    ],
  };
}

/** 预定义的动作集 */
const ACTIONS = {
  read: { type: 'read', params: new Float32Array(16) },
  write: { type: 'write', target_entity: 'file:/src/core/agent.ts', params: new Float32Array(16).fill(0.5) },
  exec: { type: 'exec', params: new Float32Array(16).fill(0.3) },
  search: { type: 'search', params: new Float32Array(16).fill(0.1) },
  commit: { type: 'commit', params: new Float32Array(16).fill(0.8) },
};

function makeSceneAction(key: keyof typeof ACTIONS): SceneAction {
  const a = ACTIONS[key];
  return {
    type: a.type,
    target_entity: (a as any).target_entity,
    params: new Float32Array(a.params),
  };
}

function makeLegacyAction(key: keyof typeof ACTIONS): ActionEncoding {
  const typeMap: Record<string, number> = { read: 0, write: 1, exec: 2, search: 3, commit: 4 };
  return {
    actionType: typeMap[key] ?? 0,
    params: new Float32Array(ACTIONS[key].params),
  };
}

// ==================== A/B 测试 ====================

describe('A/B — SceneWorldModel vs 旧 WorldModel', () => {
  const recorder = new ABTestRecorder(5000);

  /** 共享配置：确保参数量可比 */
  const SCENE_CONFIG = {
    gnn: { nodeDim: 32, edgeDim: 16, actionDim: 16, hiddenDim: 64, outputDim: 32 },
    numGNNLayers: 2,
    maxEntities: 32,
    maxEdges: 64,
    latentDim: 64,
    actionDim: 16,
  };

  const LEGACY_CONFIG = {
    latentDim: 64,
    actionDim: 16,
    hiddenDim: 128,
    predictionSteps: 3,
  };

  // ── 1. 延迟对比 ──

  it('延迟对比：单步 predict', () => {
    const sceneWm = new SceneWorldModel(SCENE_CONFIG);
    const legacyWm = new WorldModel(LEGACY_CONFIG);
    const scene = makeSimpleScene();
    const iterations = 200;

    // warmup
    for (let i = 0; i < 10; i++) {
      sceneWm.predict(scene, makeSceneAction('read'));
      legacyWm.predict(new Float32Array(64), makeLegacyAction('read'));
    }

    // SceneWorldModel
    const sceneStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      sceneWm.predict(scene, makeSceneAction('read'));
    }
    const sceneAvg = (performance.now() - sceneStart) / iterations;

    // Legacy WorldModel
    const legacyStart = performance.now();
    const latent = new Float32Array(64);
    for (let i = 0; i < iterations; i++) {
      legacyWm.predict(latent, makeLegacyAction('read'));
    }
    const legacyAvg = (performance.now() - legacyStart) / iterations;

    console.log(`[延迟] SceneWorldModel: ${sceneAvg.toFixed(3)}ms | Legacy: ${legacyAvg.toFixed(3)}ms | 比率: ${(sceneAvg / legacyAvg).toFixed(2)}x`);

    // 记录 A/B 结果
    recorder.record({ group: 'shadow', success: true, latencyMs: sceneAvg, cost: 0 });
    recorder.record({ group: 'production', success: true, latencyMs: legacyAvg, cost: 0 });

    // SceneWorldModel 做更多工作（图遍历），延迟可以更高但应 < 5ms
    expect(sceneAvg).toBeLessThan(5);
    expect(legacyAvg).toBeLessThan(5);
  });

  // ── 2. 多步想象延迟对比 ──

  it('延迟对比：3步 imagine', () => {
    const sceneWm = new SceneWorldModel(SCENE_CONFIG);
    const legacyWm = new WorldModel(LEGACY_CONFIG);
    const scene = makeSimpleScene();
    const iterations = 100;

    const sceneActions = [makeSceneAction('read'), makeSceneAction('write'), makeSceneAction('exec')];
    const legacyActions = [makeLegacyAction('read'), makeLegacyAction('write'), makeLegacyAction('exec')];

    // warmup
    sceneWm.imagine(scene, sceneActions);
    legacyWm.imagine(new Float32Array(64), legacyActions);

    const sceneStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      sceneWm.imagine(scene, sceneActions);
    }
    const sceneAvg = (performance.now() - sceneStart) / iterations;

    const legacyStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      legacyWm.imagine(new Float32Array(64), legacyActions);
    }
    const legacyAvg = (performance.now() - legacyStart) / iterations;

    console.log(`[3步想象] SceneWorldModel: ${sceneAvg.toFixed(3)}ms | Legacy: ${legacyAvg.toFixed(3)}ms`);

    recorder.record({ group: 'shadow', success: true, latencyMs: sceneAvg, cost: 0 });
    recorder.record({ group: 'production', success: true, latencyMs: legacyAvg, cost: 0 });

    expect(sceneAvg).toBeLessThan(15);
    expect(legacyAvg).toBeLessThan(15);
  });

  // ── 3. 预测置信度对比 ──

  it('预测置信度：两个模型在不同动作下均有输出', () => {
    const sceneWm = new SceneWorldModel(SCENE_CONFIG);
    const legacyWm = new WorldModel(LEGACY_CONFIG);
    const scene = makeMediumScene();

    let sceneConfValid = 0;
    let legacyConfValid = 0;
    const n = 50;

    for (let i = 0; i < n; i++) {
      const actionKey: keyof typeof ACTIONS = (['read', 'write', 'exec', 'search', 'commit'] as const)[i % 5];

      const sceneResult = sceneWm.predict(scene, makeSceneAction(actionKey));
      if (isFinite(sceneResult.confidence) && !isNaN(sceneResult.confidence)) sceneConfValid++;

      const latent = new Float32Array(64).fill(0);
      for (let j = 0; j < Math.min(scene.nodes.length, 64); j++) {
        latent[j] = scene.nodes[j].importance ?? 0.5;
      }
      const legacyResult = legacyWm.predict(latent, makeLegacyAction(actionKey));
      if (isFinite(legacyResult.confidence) && !isNaN(legacyResult.confidence)) legacyConfValid++;
    }

    console.log(`[置信度] SceneWorldModel 有效: ${sceneConfValid}/${n} | Legacy 有效: ${legacyConfValid}/${n}`);

    recorder.record({ group: 'shadow', success: sceneConfValid > n * 0.8, latencyMs: 0, cost: 0 });
    recorder.record({ group: 'production', success: legacyConfValid > n * 0.8, latencyMs: 0, cost: 0 });

    // 两者都应有合理的有效置信度比例
    expect(sceneConfValid).toBeGreaterThan(n * 0.5);
    expect(legacyConfValid).toBeGreaterThan(n * 0.5);
  });

  // ── 4. 多步想象稳定性 ──

  it('多步想象稳定性：核心指标不崩溃（confidence/risk/completionProb）', () => {
    const sceneWm = new SceneWorldModel(SCENE_CONFIG);
    const legacyWm = new WorldModel(LEGACY_CONFIG);
    const scene = makeSimpleScene();
    const steps = 10;

    const sceneActions = Array.from({ length: steps }, (_, i) =>
      makeSceneAction((['read', 'write', 'exec', 'search', 'commit'] as const)[i % 5]),
    );
    const legacyActions = Array.from({ length: steps }, (_, i) =>
      makeLegacyAction((['read', 'write', 'exec', 'search', 'commit'] as const)[i % 5]),
    );

    const sceneResults = sceneWm.imagine(scene, sceneActions);
    const legacyResults = legacyWm.imagine(new Float32Array(64), legacyActions, steps);

    // 检查核心指标没有 NaN/Inf（场景图属性可能因 GNN 缺归一化而累积，但核心指标应稳定）
    let sceneCoreNan = 0;
    let legacyCoreNan = 0;

    for (const r of sceneResults) {
      if (isNaN(r.confidence) || !isFinite(r.confidence)) sceneCoreNan++;
      if (isNaN(r.riskScore) || !isFinite(r.riskScore)) sceneCoreNan++;
      if (isNaN(r.completionProb) || !isFinite(r.completionProb)) sceneCoreNan++;
      if (isNaN(r.latencyMs) || !isFinite(r.latencyMs)) sceneCoreNan++;
    }

    for (const r of legacyResults) {
      if (isNaN(r.confidence) || !isFinite(r.confidence)) legacyCoreNan++;
      if (isNaN(r.topologyChangeProb) || !isFinite(r.topologyChangeProb)) legacyCoreNan++;
      if (isNaN(r.latencyMs) || !isFinite(r.latencyMs)) legacyCoreNan++;
      for (let i = 0; i < r.nextLatent.length; i++) {
        if (isNaN(r.nextLatent[i]) || !isFinite(r.nextLatent[i])) legacyCoreNan++;
      }
    }

    console.log(`[稳定性 ${steps}步] SceneWorldModel 核心指标 NaN/Inf: ${sceneCoreNan} | Legacy: ${legacyCoreNan}`);

    recorder.record({ group: 'shadow', success: sceneCoreNan === 0, latencyMs: 0, cost: 0 });
    recorder.record({ group: 'production', success: legacyCoreNan === 0, latencyMs: 0, cost: 0 });

    expect(sceneCoreNan).toBe(0);
    expect(legacyCoreNan).toBe(0);
    expect(sceneResults.length).toBe(steps);
    expect(legacyResults.length).toBe(steps);
  });

  // ── 5. 动作选择一致性 ──

  it('bestAction：两个模型的动作排序相关性', () => {
    const sceneWm = new SceneWorldModel(SCENE_CONFIG);
    const legacyWm = new WorldModel(LEGACY_CONFIG);
    const scene = makeMediumScene();

    // SceneWorldModel: 用 bestAction 排序
    const sceneCandidates = Object.keys(ACTIONS).map(key => ({
      action: makeSceneAction(key as keyof typeof ACTIONS),
      label: key,
    }));
    const sceneBest = sceneWm.bestAction(scene, sceneCandidates);

    // Legacy: 用 predict 的 confidence 排序
    const legacyScores: { key: string; confidence: number }[] = [];
    const latent = new Float32Array(64);
    for (let i = 0; i < Math.min(scene.nodes.length, 64); i++) {
      latent[i] = scene.nodes[i].importance ?? 0.5;
    }
    for (const key of Object.keys(ACTIONS)) {
      const result = legacyWm.predict(latent, makeLegacyAction(key as keyof typeof ACTIONS));
      legacyScores.push({ key, confidence: result.confidence });
    }
    legacyScores.sort((a, b) => b.confidence - a.confidence);

    const sceneBestKey = sceneBest?.label ?? 'none';
    const legacyBestKey = legacyScores[0]?.key ?? 'none';

    console.log(`[动作选择] SceneWorldModel: ${sceneBestKey} | Legacy: ${legacyBestKey}`);
    console.log(`  Legacy 排序: ${legacyScores.map(s => `${s.key}(${s.confidence.toFixed(3)})`).join(' > ')}`);

    // 不要求完全一致（模型结构不同），但记录对比
    recorder.record({ group: 'shadow', success: true, latencyMs: 0, cost: 0 });
    recorder.record({ group: 'production', success: true, latencyMs: 0, cost: 0 });

    expect(sceneBest).not.toBeNull();
    expect(legacyScores.length).toBe(5);
  });

  // ── 6. 结构化预测能力（SceneWorldModel 独有）──

  it('结构化预测：SceneWorldModel 能输出 entity/edge 变化', () => {
    const sceneWm = new SceneWorldModel(SCENE_CONFIG);
    const scene = makeMediumScene();
    const action = makeSceneAction('write');

    const result = sceneWm.predict(scene, action);

    // entityChanges 应与输入节点数一致
    expect(result.entityChanges.length).toBe(scene.nodes.length);

    // 每个 entityChange 应有完整的属性
    for (const change of result.entityChanges) {
      expect(change.entityId).toBeTruthy();
      expect(change.attributeChanges).toBeDefined();
      expect(change.positionDelta).toBeDefined();
      expect(change.positionDelta.length).toBe(3);
    }

    // edgeChanges 应存在
    expect(result.edgeChanges).toBeDefined();
    expect(Array.isArray(result.edgeChanges)).toBe(true);

    // 旧 WorldModel 没有这些结构化输出
    const legacyWm = new WorldModel(LEGACY_CONFIG);
    const legacyResult = legacyWm.predict(new Float32Array(64), makeLegacyAction('write'));

    // 旧模型只有 spatialDelta 和 topologyChangeProb
    expect(legacyResult.spatialDelta.length).toBe(6);
    expect(typeof legacyResult.topologyChangeProb).toBe('number');

    console.log(`[结构化] SceneWorldModel: ${result.entityChanges.length} entity changes, ${result.edgeChanges.length} edge changes`);
    console.log(`[结构化] Legacy: spatialDelta(6) + topologyChangeProb(1) — 无实体级预测`);

    recorder.record({ group: 'shadow', success: result.entityChanges.length > 0, latencyMs: 0, cost: 0 });
    recorder.record({ group: 'production', success: true, latencyMs: 0, cost: 0 });
  });

  // ── 7. 中等复杂度场景下的延迟 ──

  it('中等复杂度场景（8节点10边）延迟 < 5ms', () => {
    const sceneWm = new SceneWorldModel(SCENE_CONFIG);
    const scene = makeMediumScene();
    const iterations = 100;

    // warmup
    for (let i = 0; i < 10; i++) {
      sceneWm.predict(scene, makeSceneAction('read'));
    }

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      sceneWm.predict(scene, makeSceneAction('read'));
    }
    const avgMs = (performance.now() - start) / iterations;

    console.log(`[中等场景] SceneWorldModel: ${avgMs.toFixed(3)}ms/step`);

    recorder.record({ group: 'shadow', success: avgMs < 5, latencyMs: avgMs, cost: 0 });

    expect(avgMs).toBeLessThan(5);
  });

  // ── 8. 非归一化属性稳定性（LayerNorm 修复验证）──

  it('非归一化属性（size:2000）不产生 NaN', () => {
    const wm = new SceneWorldModel(SCENE_CONFIG);
    // 使用原始值属性（修复前会 NaN）
    const scene: SceneGraph = {
      nodes: [
        { id: 'f1', category: 'file', attributes: { size: 2000, lines: 150 }, importance: 0.8 },
        { id: 'f2', category: 'file', attributes: { size: 800, lines: 60 }, importance: 0.6 },
        { id: 'fn1', category: 'function', attributes: { complexity: 12, loc: 45 }, importance: 0.7 },
        { id: 't1', category: 'tool', attributes: { usage: 0.9, latency: 300 }, importance: 0.5 },
      ],
      edges: [
        { source: 'f1', target: 'fn1', relation: 'contains', confidence: 0.9 },
        { source: 'fn1', target: 't1', relation: 'uses', confidence: 0.8 },
        { source: 'f1', target: 'f2', relation: 'imports', confidence: 0.7 },
      ],
    };

    // 10 步 imagine，修复前必现 NaN
    const actions = Array.from({ length: 10 }, (_, i) =>
      makeSceneAction((['read', 'write', 'exec', 'search', 'commit'] as const)[i % 5]),
    );
    const results = wm.imagine(scene, actions);

    let nanCount = 0;
    for (const r of results) {
      if (isNaN(r.confidence) || !isFinite(r.confidence)) nanCount++;
      if (isNaN(r.riskScore) || !isFinite(r.riskScore)) nanCount++;
      if (isNaN(r.completionProb) || !isFinite(r.completionProb)) nanCount++;
    }

    console.log(`[非归一化属性] 10步 NaN/Inf: ${nanCount}（修复前为 30+）`);

    recorder.record({ group: 'shadow', success: nanCount === 0, latencyMs: 0, cost: 0 });

    expect(nanCount).toBe(0);
    expect(results.length).toBe(10);
  });

  // ── 9. 参数量对比 ──

  it('参数量对比', () => {
    const sceneWm = new SceneWorldModel(SCENE_CONFIG);
    const legacyWm = new WorldModel(LEGACY_CONFIG);

    const sceneParams = sceneWm.countParams();
    const legacyParams = countLegacyParams(legacyWm);

    console.log(`[参数量] SceneWorldModel: ${sceneParams.toLocaleString()} | Legacy: ${legacyParams.toLocaleString()} | 比率: ${(sceneParams / legacyParams).toFixed(2)}x`);

    // SceneWorldModel 参数更多（GNN 层），但不应过度膨胀
    expect(sceneParams).toBeGreaterThan(legacyParams);
    expect(sceneParams).toBeLessThan(legacyParams * 20); // 不超过 20 倍
  });

  // ── 10. A/B 统计报告 ──

  it('A/B 统计汇总', () => {
    const analysis = recorder.analyze();
    if (!analysis) {
      console.log('[A/B] 样本不足，跳过统计分析');
      return;
    }

    console.log('\n========== A/B 对比报告 ==========');
    console.log(`样本数: ${analysis.sampleCount}`);
    console.log(`\n[SceneWorldModel (shadow)]`);
    console.log(`  成功率: ${(analysis.shadow.successRate * 100).toFixed(1)}%`);
    console.log(`  平均延迟: ${analysis.shadow.avgLatency.toFixed(3)}ms`);
    console.log(`\n[Legacy WorldModel (production)]`);
    console.log(`  成功率: ${(analysis.production.successRate * 100).toFixed(1)}%`);
    console.log(`  平均延迟: ${analysis.production.avgLatency.toFixed(3)}ms`);
    console.log(`\n[差异]`);
    console.log(`  成功率差: ${(analysis.comparison.successRateDiff * 100).toFixed(1)}%`);
    console.log(`  延迟差: ${analysis.comparison.latencyDiff.toFixed(3)}ms`);
    console.log(`  胜出: ${analysis.comparison.winner}`);
    console.log('====================================\n');

    // 两者都应有合理的成功率
    expect(analysis.shadow.successRate).toBeGreaterThan(0.5);
    expect(analysis.production.successRate).toBeGreaterThan(0.5);
  });
});

// ==================== 工具函数 ====================

/** 估算旧 WorldModel 的参数量 */
function countLegacyParams(wm: WorldModel): number {
  // wTransition1: (latentDim + actionDim) * hiddenDim
  // wTransition2: hiddenDim * latentDim
  // wSpatial: latentDim * 6
  // wTopology: latentDim * 1
  // biases: hiddenDim + latentDim + 6 + 1
  const latentDim = 64, actionDim = 16, hiddenDim = 128;
  return (latentDim + actionDim) * hiddenDim
    + hiddenDim * latentDim
    + latentDim * 6
    + latentDim * 1
    + hiddenDim + latentDim + 6 + 1;
}
