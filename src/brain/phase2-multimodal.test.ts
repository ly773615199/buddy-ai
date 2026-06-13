/**
 * Phase 2 多模态感知测试
 *
 * 覆盖：
 * 1. buildMultimodalContext 从实体构建 SceneGraph
 * 2. buildMultimodalContext 从路径构建 SpatialEncodeInput
 * 3. 无数据时返回 undefined（零开销退化）
 * 4. 路径关系推断（同目录/父子目录）
 * 5. decide() 集成 — 多模态注入不崩溃
 */

import { describe, it, expect } from 'vitest';
import { ThreeBrain } from './brain.js';
import { EntityRegistry, createFileEntity, createFunctionEntity } from './right/scene/entity-registry.js';
import type { TaskSignal, ResourceState, BodyState } from './types.js';

function makeSignal(overrides?: Partial<TaskSignal>): TaskSignal {
  return {
    domains: ['file'],
    complexity: 'medium',
    taskType: 'tools',
    shouldUseDAG: false,
    dagReason: '',
    intentConfidence: 0.7,
    content: '分析 src/brain/brain.ts 和 src/core/agent.ts 的关系',
    ...overrides,
  };
}

function makeResources(): ResourceState {
  return {
    budgetRemaining: 100,
    availableNodeCount: 5,
    localCoverageRatio: 0.5,
    localConfidence: 0.6,
    userCorrectionCount: 0,
    experienceHit: null,
  };
}

describe('Phase 2: 多模态感知', () => {

  describe('buildMultimodalContext', () => {
    it('无实体、无路径时返回 undefined', () => {
      const brain = new ThreeBrain({ verbose: false });
      // buildMultimodalContext 是 private，通过 decide 间接测试
      // 空输入不应崩溃
      const result = (brain as any).buildMultimodalContext('你好');
      expect(result).toBeUndefined();
    });

    it('有路径时构建 SpatialEncodeInput', () => {
      const brain = new ThreeBrain({ verbose: false });
      const result = (brain as any).buildMultimodalContext('读取 src/brain/brain.ts 和 src/core/agent.ts');

      expect(result).toBeDefined();
      expect(result.spatial).toBeDefined();
      expect(result.spatial.objects.length).toBe(2);
      expect(result.spatial.objects[0].id).toBe('src/brain/brain.ts');
      expect(result.spatial.objects[1].id).toBe('src/core/agent.ts');
      // 同目录？不同目录 → 应该有关系
      // brain.ts 在 src/brain/，agent.ts 在 src/core/ → 不同目录
    });

    it('同目录文件生成并列关系', () => {
      const brain = new ThreeBrain({ verbose: false });
      const result = (brain as any).buildMultimodalContext('对比 src/brain/brain.ts 和 src/brain/types.ts');

      expect(result).toBeDefined();
      expect(result.spatial).toBeDefined();
      expect(result.spatial.objects.length).toBe(2);
      // 同目录 → should have relation
      expect(result.spatial.relations.length).toBeGreaterThanOrEqual(1);
      expect(result.spatial.relations[0].direction).toBe('right');
    });

    it('父子目录文件生成包含关系', () => {
      const brain = new ThreeBrain({ verbose: false });
      const result = (brain as any).buildMultimodalContext('对比 src/brain/brain.ts 和 src/brain/nn/model.ts');

      expect(result).toBeDefined();
      expect(result.spatial).toBeDefined();
      // src/brain/ vs src/brain/nn/ → 父子关系
      expect(result.spatial.relations.length).toBeGreaterThanOrEqual(1);
      expect(result.spatial.relations[0].direction).toBe('below');
    });

    it('有实体时构建 SceneGraph', () => {
      const brain = new ThreeBrain({ verbose: false });
      // 手动注入实体
      const registry = brain.right.entityRegistry;
      registry.addEntity(createFileEntity('src/brain/brain.ts', 1000, 'typescript'));
      registry.addEntity(createFileEntity('src/core/agent.ts', 2000, 'typescript'));
      registry.addEdge({
        source: 'file:src/brain/brain.ts',
        target: 'file:src/core/agent.ts',
        relation: 'imports',
        weight: 0.8,
        confidence: 0.9,
        created_at: Date.now(),
      });

      const result = (brain as any).buildMultimodalContext('分析这两个文件');

      expect(result).toBeDefined();
      expect(result.sceneGraph).toBeDefined();
      expect(result.sceneGraph.nodes.length).toBe(2);
      expect(result.sceneGraph.edges.length).toBe(1);
      expect(result.sceneGraph.edges[0].relation).toBe('imports');
    });

    it('路径数限制在 8 个以内', () => {
      const brain = new ThreeBrain({ verbose: false });
      const manyPaths = Array.from({ length: 15 }, (_, i) => `src/file${i}.ts`).join(' ');
      const result = (brain as any).buildMultimodalContext(manyPaths);

      expect(result).toBeDefined();
      expect(result.spatial).toBeDefined();
      expect(result.spatial.objects.length).toBeLessThanOrEqual(8);
    });

    it('单个路径不构建空间关系（需要 ≥2）', () => {
      const brain = new ThreeBrain({ verbose: false });
      const result = (brain as any).buildMultimodalContext('读取 src/brain/brain.ts');

      // 单路径 → 不构建 spatial（需要 ≥2 个路径）
      expect(result).toBeUndefined();
    });
  });

  describe('decide() 集成', () => {
    it('有实体时 decide 不崩溃', async () => {
      const brain = new ThreeBrain({ verbose: false });
      // 注入实体
      brain.right.entityRegistry.addEntity(createFileEntity('src/brain/brain.ts', 1000));

      const signal = makeSignal();
      const resources = makeResources();

      // 不应抛错
      const result = await brain.decide('分析 src/brain/brain.ts', signal, resources);
      expect(result).toBeDefined();
      expect(result.plan).toBeDefined();
      expect(result.bodyState).toBeDefined();
    });

    it('有路径时 decide 不崩溃', async () => {
      const brain = new ThreeBrain({ verbose: false });
      const signal = makeSignal();
      const resources = makeResources();

      const result = await brain.decide('对比 src/brain/brain.ts 和 src/core/agent.ts', signal, resources);
      expect(result).toBeDefined();
      expect(result.plan).toBeDefined();
    });

    it('无多模态数据时 decide 正常工作', async () => {
      const brain = new ThreeBrain({ verbose: false });
      const signal = makeSignal({ content: '你好' });
      const resources = makeResources();

      const result = await brain.decide('你好', signal, resources);
      expect(result).toBeDefined();
      expect(result.plan).toBeDefined();
    });
  });
});
