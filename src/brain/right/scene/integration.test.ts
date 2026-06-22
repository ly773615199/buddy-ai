/**
 * 场景世界模型集成测试
 *
 * 覆盖：
 * 1. Entity Adapters — 从各数据源提取实体
 * 2. RuntimeCollector — 运行时快照采集
 * 3. KnowledgeBridge — 知识→训练样本
 * 4. 端到端管线 — 数据源 → Registry → GNN → 训练
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EntityRegistry, createFileEntity, createFunctionEntity, createDependencyEdge } from './entity-registry.js';
import { SceneWorldModel } from './scene-world-model.js';
import { extractFromProject, extractFromSTMP, extractFromExperience, extractFromKnowledge, syncAllSources } from './entity-adapters.js';
import { RuntimeCollector } from './runtime-collector.js';
import { KnowledgeBridge } from './knowledge-bridge.js';
import type { ExtractedKnowledgeLite } from './knowledge-bridge.js';
import { generateSyntheticSamples, toNNSample } from './scene-training.js';
import type { ProjectIndexSource, STMPSource, ExperienceSource, KnowledgeItem } from './entity-adapters.js';
import type { SceneGraph } from '../features/scene-encoder.js';

// ==================== Mock 数据源 ====================

function makeMockProject(): ProjectIndexSource {
  return {
    getFiles: () => [
      {
        path: '/src/main.ts',
        absPath: '/project/src/main.ts',
        language: 'typescript',
        loc: 120,
        symbols: [
          { name: 'main', kind: 'function', line: 10, exported: true, signature: '(args: string[]) => void' },
          { name: 'App', kind: 'class', line: 30, exported: true },
          { name: 'render', kind: 'method', line: 35, exported: false, signature: '() => void' },
        ],
        imports: [
          { source: './utils', specifiers: ['helper'], resolvedPath: '/src/utils.ts' },
          { source: 'react', specifiers: ['useState'] },
        ],
      },
      {
        path: '/src/utils.ts',
        absPath: '/project/src/utils.ts',
        language: 'typescript',
        loc: 80,
        symbols: [
          { name: 'helper', kind: 'function', line: 5, exported: true, signature: '(x: number) => number' },
        ],
        imports: [],
      },
    ],
    getStats: () => ({ totalFiles: 2, totalLoc: 200, totalSymbols: 4, dependencyCount: 1 }),
  };
}

function makeMockSTMP(): STMPSource {
  return {
    getRooms: () => [
      { id: 'room-1', name: '开发', tags: ['code', 'debug'], memoryCount: 3 },
    ],
    getMemoriesInRoom: () => [
      {
        id: 'mem-1', content: '修复了 GNN 梯度爆炸问题', room: 'room-1',
        concepts: ['GNN', '梯度', '调试'], importance: 8, timestamp: Date.now() - 60000, accessCount: 3, decay: 0.1,
      },
      {
        id: 'mem-2', content: 'SceneWorldModel 集成完成', room: 'room-1',
        concepts: ['SceneWorldModel', '集成'], importance: 7, timestamp: Date.now() - 30000, accessCount: 1, decay: 0.05,
      },
      {
        id: 'mem-3', content: '性能优化: 推理延迟降到 3ms', room: 'room-1',
        concepts: ['性能', '优化', 'GNN'], importance: 9, timestamp: Date.now(), accessCount: 5, decay: 0,
      },
    ],
    searchMemories: () => [],
  };
}

function makeMockExperience(): ExperienceSource {
  return {
    getAllNodes: () => [
      {
        id: 'exp-1', name: 'TypeScript 调试', description: '调试 TS 类型错误',
        trigger: { keywords: ['typescript', 'debug', '类型'], contextTags: ['coding'] },
        stats: { successCount: 5, failCount: 1, confidence: 0.8 },
      },
      {
        id: 'exp-2', name: 'GNN 优化', description: '优化图神经网络性能',
        trigger: { keywords: ['GNN', '优化', '性能'], contextTags: ['ml'] },
        stats: { successCount: 3, failCount: 0, confidence: 0.9 },
      },
    ],
    getAllEdges: () => [
      { from: 'exp-1', to: 'exp-2', type: 'enhances', weight: 0.7 },
    ],
  };
}

function makeMockKnowledge(): KnowledgeItem[] {
  return [
    {
      type: 'decision_rule', content: '高复杂度函数应拆分',
      domain: 'code', confidence: 0.85, concepts: ['函数', '复杂度', '重构'],
    },
    {
      type: 'failure_experience', content: '直接修改生产数据库导致数据丢失',
      domain: 'ops', confidence: 0.95, concepts: ['数据库', '安全', '生产'],
    },
  ];
}

// ==================== Entity Adapters 测试 ====================

describe('EntityAdapters — extractFromProject', () => {
  it('提取文件和符号实体', () => {
    const registry = new EntityRegistry();
    const result = extractFromProject(registry, makeMockProject());

    expect(result.entityCount).toBeGreaterThan(0);
    // 应有 2 个文件 + 函数 + 类
    expect(registry.entityCount).toBeGreaterThanOrEqual(4);

    // 文件实体存在
    const mainFile = registry.getEntity('file:/src/main.ts');
    expect(mainFile).toBeDefined();
    expect(mainFile?.type).toBe('file');

    // 函数实体存在
    const mainFunc = registry.getEntity('func:/src/main.ts:main');
    expect(mainFunc).toBeDefined();
    expect(mainFunc?.type).toBe('function');
  });

  it('创建包含边和依赖边', () => {
    const registry = new EntityRegistry();
    const result = extractFromProject(registry, makeMockProject());

    expect(result.edgeCount).toBeGreaterThan(0);

    const graph = registry.toSceneGraph();
    // 应有 contains 关系
    const containsEdges = graph.edges.filter(e => e.relation === 'contains');
    expect(containsEdges.length).toBeGreaterThan(0);
  });
});

describe('EntityAdapters — extractFromSTMP', () => {
  it('提取记忆和概念实体', () => {
    const registry = new EntityRegistry();
    const result = extractFromSTMP(registry, makeMockSTMP());

    expect(result.entityCount).toBeGreaterThan(0);
    // 记忆实体
    const mem1 = registry.getEntity('memory:mem-1');
    expect(mem1).toBeDefined();
    expect(mem1?.type).toBe('memory');

    // 概念实体
    const gnnConcept = registry.getEntity('concept:GNN');
    expect(gnnConcept).toBeDefined();
    expect(gnnConcept?.type).toBe('concept');
  });

  it('创建记忆→概念关联边', () => {
    const registry = new EntityRegistry();
    const result = extractFromSTMP(registry, makeMockSTMP());

    expect(result.edgeCount).toBeGreaterThan(0);

    const graph = registry.toSceneGraph();
    const relatesEdges = graph.edges.filter(e => e.relation === 'relates_to');
    expect(relatesEdges.length).toBeGreaterThan(0);
  });
});

describe('EntityAdapters — extractFromExperience', () => {
  it('提取经验实体', () => {
    const registry = new EntityRegistry();
    const result = extractFromExperience(registry, makeMockExperience());

    expect(result.entityCount).toBeGreaterThan(0);
    const exp1 = registry.getEntity('experience:exp-1');
    expect(exp1).toBeDefined();
    expect(exp1?.type).toBe('experience');
  });
});

describe('EntityAdapters — extractFromKnowledge', () => {
  it('提取知识实体', () => {
    const registry = new EntityRegistry();
    const result = extractFromKnowledge(registry, makeMockKnowledge());

    expect(result.entityCount).toBe(2);
    const entities = registry.getAllEntities();
    const knowledgeEntities = entities.filter(e => e.type === 'knowledge');
    expect(knowledgeEntities.length).toBe(2);
  });
});

describe('EntityAdapters — syncAllSources', () => {
  it('全量同步所有数据源', () => {
    const registry = new EntityRegistry({ maxEntities: 128, maxEdges: 256 });
    const result = syncAllSources(registry, {
      project: makeMockProject(),
      stmp: makeMockSTMP(),
      experience: makeMockExperience(),
      knowledge: makeMockKnowledge(),
    });

    expect(result.totalEntities).toBeGreaterThan(10);
    expect(result.totalEdges).toBeGreaterThan(5);
    expect(result.project.entityCount).toBeGreaterThan(0);
    expect(result.stmp.entityCount).toBeGreaterThan(0);
    expect(result.experience.entityCount).toBeGreaterThan(0);
    expect(result.knowledge.entityCount).toBeGreaterThan(0);
  });

  it('部分数据源缺失时仍正常工作', () => {
    const registry = new EntityRegistry();
    const result = syncAllSources(registry, {
      project: makeMockProject(),
      // stmp, experience, knowledge 缺失
    });

    expect(result.project.entityCount).toBeGreaterThan(0);
    expect(result.stmp.entityCount).toBe(0);
    expect(result.totalEntities).toBeGreaterThan(0);
  });
});

// ==================== RuntimeCollector 测试 ====================

describe('RuntimeCollector', () => {
  let registry: EntityRegistry;
  let collector: RuntimeCollector;

  beforeEach(() => {
    registry = new EntityRegistry();
    // 预填充一些实体
    registry.addEntity(createFileEntity('/src/a.ts', 100));
    registry.addEntity(createFunctionEntity('foo', '/src/a.ts', 10, 3));
    registry.addEdge(createDependencyEdge('file:/src/a.ts', 'func:/src/a.ts:foo'));
  });

  it('captureBefore 返回快照', () => {
    collector = new RuntimeCollector(registry);
    const pending = collector.captureBefore({ type: 'read', params: new Float32Array(4) });

    expect(pending.snapshot).toBeDefined();
    expect(pending.snapshot.entities.size).toBe(2);
    expect(pending.action.type).toBe('read');
  });

  it('captureAfter 构建训练样本', () => {
    collector = new RuntimeCollector(registry, { minExecutionMs: 0 });
    const pending = collector.captureBefore({ type: 'write', target_entity: 'file:/src/a.ts', params: new Float32Array(4) });

    // 模拟工具执行后 registry 发生变化
    registry.addEntity(createFileEntity('/src/b.ts', 200));

    const sample = collector.captureAfter(pending, { success: true, latencyMs: 50 });

    expect(sample).not.toBeNull();
    expect(sample!.sample.source).toBe('runtime');
    expect(sample!.sample.completion).toBe(true);
    expect(sample!.executionResult.success).toBe(true);
  });

  it('跳过太快的执行', () => {
    collector = new RuntimeCollector(registry, { minExecutionMs: 100 });
    const pending = collector.captureBefore({ type: 'read', params: new Float32Array(4) });

    // 立即返回（< 100ms）
    const sample = collector.captureAfter(pending, { success: true, latencyMs: 1 });

    expect(sample).toBeNull();
    expect(collector.getStats().skipped).toBe(1);
  });

  it('自动刷新缓冲区', () => {
    const flushed: any[] = [];
    collector = new RuntimeCollector(
      registry,
      { maxBufferSize: 50, autoFlushThreshold: 3, minExecutionMs: 0 },
      (samples) => flushed.push(...samples),
    );

    for (let i = 0; i < 4; i++) {
      const pending = collector.captureBefore({ type: 'read', params: new Float32Array(4) });
      collector.captureAfter(pending, { success: true, latencyMs: 10 });
    }

    // 应该自动刷新了一次（第 3 个样本时触发）
    expect(flushed.length).toBeGreaterThanOrEqual(3);
  });

  it('wrapExecution 捕获成功执行', async () => {
    collector = new RuntimeCollector(registry, { minExecutionMs: 0 });

    const { result } = await collector.wrapExecution(
      { type: 'exec', params: new Float32Array(4) },
      async () => 'done',
    );

    expect(result).toBe('done');
    expect(collector.getStats().captured).toBe(1);
  });

  it('wrapExecution 捕获失败执行', async () => {
    collector = new RuntimeCollector(registry, { collectFailures: true, minExecutionMs: 0 });

    await expect(
      collector.wrapExecution(
        { type: 'exec', params: new Float32Array(4) },
        async () => { throw new Error('boom'); },
      ),
    ).rejects.toThrow('boom');

    expect(collector.getStats().captured).toBe(1);
  });
});

// ==================== KnowledgeBridge 测试 ====================

describe('KnowledgeBridge', () => {
  it('转换知识为训练样本', () => {
    const bridge = new KnowledgeBridge();
    const knowledge: ExtractedKnowledgeLite[] = [
      { type: 'decision_rule', content: '高复杂度函数应拆分', domain: 'code', confidence: 0.85, concepts: ['函数', '复杂度'] },
    ];

    const samples = bridge.convert(knowledge);

    expect(samples.length).toBe(1);
    expect(samples[0].source).toBe('knowledge');
    expect(samples[0].scene_before.nodes.length).toBe(2);
  });

  it('过滤低置信度', () => {
    const bridge = new KnowledgeBridge({ minConfidence: 0.5 });
    const knowledge: ExtractedKnowledgeLite[] = [
      { type: 'decision_rule', content: '低置信度知识', domain: 'code', confidence: 0.2, concepts: ['x'] },
    ];

    const samples = bridge.convert(knowledge);

    expect(samples.length).toBe(0);
    expect(bridge.getStats().skippedLowConfidence).toBe(1);
  });

  it('去重', () => {
    const bridge = new KnowledgeBridge();
    const knowledge: ExtractedKnowledgeLite[] = [
      { type: 'decision_rule', content: '相同内容', domain: 'code', confidence: 0.8, concepts: ['x'] },
      { type: 'decision_rule', content: '相同内容', domain: 'code', confidence: 0.9, concepts: ['y'] },
    ];

    const samples = bridge.convert(knowledge);

    expect(samples.length).toBe(1);
    expect(bridge.getStats().skippedDuplicate).toBe(1);
  });

  it('失败经验标签为 bad', () => {
    const bridge = new KnowledgeBridge();
    const knowledge: ExtractedKnowledgeLite[] = [
      { type: 'failure_experience', content: '操作失败教训', domain: 'ops', confidence: 0.9, concepts: ['安全'] },
    ];

    const samples = bridge.convert(knowledge);

    expect(samples.length).toBe(1);
    expect(samples[0].risk_label).toBeGreaterThan(0.5);
  });
});

// ==================== 端到端管线测试 ====================

describe('端到端管线', () => {
  it('数据源 → Registry → SceneGraph → GNN → 预测', () => {
    // 1. 从数据源填充 Registry
    const registry = new EntityRegistry({ maxEntities: 64, maxEdges: 128 });
    syncAllSources(registry, {
      project: makeMockProject(),
      stmp: makeMockSTMP(),
      experience: makeMockExperience(),
    });

    expect(registry.entityCount).toBeGreaterThan(5);

    // 2. 构建 SceneGraph
    const scene = registry.toSceneGraph();
    expect(scene.nodes.length).toBeGreaterThan(0);
    expect(scene.edges.length).toBeGreaterThan(0);

    // 3. GNN 预测
    const wm = new SceneWorldModel({
      gnn: { nodeDim: 16, edgeDim: 8, actionDim: 8, hiddenDim: 32, outputDim: 16 },
      maxEntities: 32,
    });

    const result = wm.predict(scene, {
      type: 'write',
      target_entity: scene.nodes[0].id,
      params: new Float32Array(8),
    });

    expect(result.nextScene).toBeDefined();
    expect(result.completionProb).toBeGreaterThanOrEqual(0);
    expect(result.completionProb).toBeLessThanOrEqual(1);
    expect(result.latencyMs).toBeLessThan(50); // LayerNorm 后合理阈值
  });

  it('合成数据 → 训练样本 → NN 样本', () => {
    const samples = generateSyntheticSamples(20);
    expect(samples.length).toBe(20);

    for (const sample of samples) {
      const nn = toNNSample(sample);
      expect(nn.features.length).toBe(64);
      expect(nn.weight).toBeGreaterThan(0);
    }
  });

  it('全量同步 + 快照 + 差异检测', () => {
    const registry = new EntityRegistry({ maxEntities: 128, maxEdges: 256 });

    // 第一次同步
    syncAllSources(registry, {
      project: makeMockProject(),
      stmp: makeMockSTMP(),
    });
    const snap1 = registry.snapshot();

    // 新增实体
    registry.addEntity(createFileEntity('/src/new.ts', 50));
    const snap2 = registry.snapshot();

    // 差异检测
    const diff = registry.diff(snap1, snap2);
    expect(diff.addedEntities.length).toBe(1);
    expect(diff.totalChangeScore).toBeGreaterThan(0);
  });

  it('RuntimeCollector + SceneWorldModel 联动', async () => {
    const registry = new EntityRegistry();
    registry.addEntity(createFileEntity('/src/a.ts', 100));

    const wm = new SceneWorldModel({
      gnn: { nodeDim: 16, edgeDim: 8, actionDim: 8, hiddenDim: 32, outputDim: 16 },
    });

    const collected: any[] = [];
    const collector = new RuntimeCollector(
      registry,
      { minExecutionMs: 0 },
      (samples) => collected.push(...samples),
    );

    // 模拟工具执行
    await collector.wrapExecution(
      { type: 'write', target_entity: 'file:/src/a.ts', params: new Float32Array(8) },
      async () => {
        // 模拟写操作后新增实体
        registry.addEntity(createFileEntity('/src/b.ts', 200));
      },
    );

    // 验证收集到了样本
    expect(collector.getStats().captured).toBe(1);

    // 用收集的场景做预测
    const buffer = collector.getBuffer();
    expect(buffer.length).toBe(1);

    const scene = buffer[0].sample.scene_before;
    const prediction = wm.predict(scene, buffer[0].sample.action);
    expect(prediction.nextScene).toBeDefined();
  });
});
