/**
 * Phase B 测试 — 训练数据质量提升
 * 1. TrainingExporter 多维质量评估
 * 2. TrainingExporter judgment/correction 样本支持
 * 3. DataAugmentor 扩增器
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { TrainingExporter, type TrainingSample, type QualityMetrics } from './training-exporter.js';
import { DataAugmentor } from './data-augmentor.js';
import { STMPStore } from '../memory/stmp.js';
import { CognitiveEngine } from '../cognitive/engine.js';

const TEST_DIR = path.join('/tmp', `buddy-test-phaseb-${Date.now()}`);

describe('Phase B: 训练数据质量提升', () => {
  let stmp: STMPStore;
  let cognitive: CognitiveEngine;
  let exporter: TrainingExporter;

  beforeAll(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    stmp = new STMPStore(path.join(TEST_DIR, 'stmp.db'));
    cognitive = new CognitiveEngine(path.join(TEST_DIR, 'cognitive.db'));

    // 添加一些种子领域
    cognitive.updateDomainProfile('前端开发', {
      knowledgeCount: 120,
      growthStage: 'trainable',
      depthScore: 0.6,
      expertiseSignals: 15,
      lastActiveAt: Date.now(),
    });

    // 插入种子知识节点
    const roomId = stmp.createRoom('frontend', '前端开发', ['前端', '开发'], false);
    for (let i = 0; i < 10; i++) {
      stmp.insertNode({
        id: `seed-${i}`,
        content: `[决策规则] 前端开发知识节点 ${i}: 使用 React Hooks 时应避免在循环中调用`,
        room: roomId.id,
        timestamp: Date.now(),
        temporalContext: { before: [], after: [] },
        concepts: ['React', 'Hooks', '前端'],
        relations: [{ target: 'React', type: 'relates_to', strength: 0.8 }],
        emotional: { valence: 0.2, importance: 7 },
        lifecycle: {
          createdAt: Date.now(), lastAccessed: Date.now(),
          accessCount: 1, decay: 1.0, compressed: false, hibernated: false,
        },
        source: 'extracted',
      });
    }

    exporter = new TrainingExporter(stmp, cognitive, { outputDir: TEST_DIR }, true);
  });

  afterAll(() => {
    stmp.close();
    cognitive.close();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('TrainingExporter — 多维质量评估', () => {
    it('computeQualityMetrics 返回完整指标', async () => {
      const result = await exporter.exportDomain('前端开发');
      expect(result.qualityMetrics).toBeDefined();
      expect(result.qualityMetrics).toHaveProperty('overall');
      expect(result.qualityMetrics).toHaveProperty('diversity');
      expect(result.qualityMetrics).toHaveProperty('reasoning');
      expect(result.qualityMetrics).toHaveProperty('coverage');
      expect(result.qualityMetrics).toHaveProperty('freshness');
      expect(result.qualityMetrics).toHaveProperty('sampleTypeBreakdown');

      expect(result.qualityMetrics.overall).toBeGreaterThanOrEqual(0);
      expect(result.qualityMetrics.overall).toBeLessThanOrEqual(1);
    });

    it('纯 stmp 样本 diversity 为 0', async () => {
      const result = await exporter.exportDomain('前端开发');
      // 所有样本都是 stmp 类型且只有 1 种类型 → diversity = 0
      expect(result.qualityMetrics.diversity).toBe(0);
    });
  });

  describe('TrainingExporter — 外部样本合并', () => {
    it('addExternalSamples 合并 judgment 样本', async () => {
      // 添加外部 judgment 样本
      exporter.addExternalSamples('前端开发', [
        {
          instruction: '分析以下技术选型决策',
          input: 'React vs Vue',
          output: 'React 适合大型项目，因为类型系统完善，生态丰富',
          domain: '前端开发',
          confidence: 0.85,
          sourceType: 'judgment',
        },
        {
          instruction: '以下方案有误，请给出正确方案',
          input: '之前方案：直接修改 state',
          output: 'React 中应使用 setState 或 hooks 更新状态，直接修改不会触发重渲染',
          domain: '前端开发',
          confidence: 0.9,
          sourceType: 'correction',
        },
      ]);

      const result = await exporter.exportDomain('前端开发');
      // STMP 可能返回 1 条 + 外部 2 条 = 至少 3 条
      expect(result.exportedSamples).toBeGreaterThanOrEqual(3);
      expect(result.qualityMetrics.sampleTypeBreakdown['judgment']).toBeGreaterThanOrEqual(1);
      expect(result.qualityMetrics.sampleTypeBreakdown['correction']).toBeGreaterThanOrEqual(1);
      expect(result.qualityMetrics.reasoning).toBeGreaterThan(0);
      // 多类型 → diversity 应提高
      expect(result.qualityMetrics.diversity).toBeGreaterThan(0);
    });
  });

  describe('DataAugmentor', () => {
    it('无 LLM 时返回空结果', async () => {
      const augmentor = new DataAugmentor();
      const result = await augmentor.augment(
        [{ instruction: '测试', input: '', output: '测试输出', domain: '测试', confidence: 0.8, sourceType: 'stmp' }],
        '测试',
      );
      expect(result.generatedCount).toBe(0);
      expect(result.samples).toEqual([]);
    });

    it('空种子返回空结果', async () => {
      const augmentor = new DataAugmentor();
      const mockLLM = vi.fn();
      augmentor.setLLMCaller(mockLLM);
      const result = await augmentor.augment([], '测试');
      expect(result.generatedCount).toBe(0);
      expect(mockLLM).not.toHaveBeenCalled();
    });

    it('LLM 扩增生成样本', async () => {
      const augmentor = new DataAugmentor({ expansionRatio: 3, maxOutput: 20 }, true);
      const mockLLM = vi.fn().mockResolvedValue(JSON.stringify([
        {
          instruction: 'React 中如何优化列表渲染？',
          input: '1000 条数据的列表',
          output: '使用虚拟滚动（react-window 或 react-virtualized），只渲染可视区域内的元素。关键在于计算可视区域的起始索引和结束索引。',
          domain: '前端开发',
        },
        {
          instruction: '解释 React 的 reconciliation 算法',
          input: '',
          output: 'React 使用 diff 算法比较新旧虚拟 DOM 树。关键策略：同层比较（不跨层级）、类型不同则重建、key 属性标识列表元素。',
          domain: '前端开发',
        },
      ]));
      augmentor.setLLMCaller(mockLLM);

      const seeds: TrainingSample[] = [{
        instruction: 'React Hooks 最佳实践',
        input: '',
        output: 'useState 用于管理组件状态，useEffect 用于副作用处理。关键是依赖数组的正确设置。',
        domain: '前端开发',
        confidence: 0.8,
        sourceType: 'stmp',
      }];

      const result = await augmentor.augment(seeds, '前端开发');
      expect(result.seedCount).toBe(1);
      expect(result.generatedCount).toBeGreaterThan(0);
      expect(result.samples.length).toBeGreaterThan(0);
      expect(result.samples[0].sourceType).toBe('augmented');
    });

    it('质量过滤移除低质量样本', async () => {
      const augmentor = new DataAugmentor({ minQuality: 0.6 }, true);
      const mockLLM = vi.fn().mockResolvedValue(JSON.stringify([
        {
          instruction: '好的',
          input: '',
          output: '嗯',
          domain: '前端开发',
        },
        {
          instruction: 'React 如何处理事件？',
          input: '',
          output: 'React 使用合成事件系统（SyntheticEvent），统一了浏览器差异。事件委托到根节点，减少事件监听器数量。',
          domain: '前端开发',
        },
      ]));
      augmentor.setLLMCaller(mockLLM);

      const result = await augmentor.augment(
        [{ instruction: 's', input: '', output: 'seed output for dedup', domain: '前端开发', confidence: 0.8, sourceType: 'stmp' }],
        '前端开发',
      );
      // 第一条应被过滤（太短 + 泛泛而谈）
      expect(result.filteredCount).toBeGreaterThan(0);
      expect(result.samples.length).toBeLessThan(2);
    });
  });
});
