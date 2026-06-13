/**
 * Phase E 测试 — 知识蒸馏
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DistillDataPrep, type TeacherOutput, type JudgmentSample, type CorrectionSample } from './distill-prep.js';
import { KnowledgeDistiller } from './distill.js';
import { TernaryArchitecture, ARCHITECTURE_CONFIGS } from './architecture.js';
import { TernaryEvaluator, type EvalDataset, type EvalSample } from './eval.js';
import { CloudTrainer, HttpCloudProvider, type CloudJob, type CloudJobStatus } from './cloud-trainer.js';
import { createModelMeta } from './format.js';
import type { TernaryModel, TernaryLayer } from './format.js';

// ── 工具函数 ──

function randomTernary(len: number): Int8Array {
  const arr = new Int8Array(len);
  for (let i = 0; i < len; i++) arr[i] = (Math.floor(Math.random() * 3) - 1) as -1 | 0 | 1;
  return arr;
}

function createTinyModel(domain = 'Go开发'): TernaryModel {
  const inF = 32, rank = 4, outF = 32, numLayers = 2;
  const meta = createModelMeta(domain, {
    inFeatures: inF, rank, outFeatures: outF, numLayers,
    totalParams: (inF * rank + rank * outF) * numLayers,
  });
  const layers: TernaryLayer[] = Array.from({ length: numLayers }, (_, i) => ({
    layerIndex: i,
    A: randomTernary(inF * rank),
    B: randomTernary(rank * outF),
  }));
  return { meta, layers };
}

function createTeacherOutputs(count: number, domain = 'Go开发'): TeacherOutput[] {
  return Array.from({ length: count }, (_, i) => ({
    prompt: `问题${i}: Go语言中如何处理并发错误?`,
    response: `回答${i}: 使用 errgroup 或 channel 收集错误。具体做法是...`,
    reasoning: `分析1: Go的并发模型。分析2: 错误传播方式。结论: errgroup最佳。`,
    domain,
    teacherModel: 'deepseek-v3',
    confidence: 0.7 + Math.random() * 0.3,
    timestamp: Date.now(),
  }));
}

// ═══════════════════════════════════════════════════════

describe('DistillDataPrep', () => {
  let prep: DistillDataPrep;

  beforeEach(() => {
    prep = new DistillDataPrep();
  });

  it('prepareFromQA 生成训练样本', () => {
    const outputs = createTeacherOutputs(5);
    const samples = prep.prepareFromQA(outputs);

    expect(samples.length).toBeGreaterThan(0);
    // 每个 QA 至少生成 1 个样本
    expect(samples.length).toBeGreaterThanOrEqual(5);
  });

  it('prepareFromQA 验证输出质量', () => {
    const bad: TeacherOutput = {
      prompt: '短',  // 太短
      response: '也短',
      domain: '测试',
      teacherModel: 'test',
      timestamp: Date.now(),
    };
    const good = createTeacherOutputs(1)[0];
    const samples = prep.prepareFromQA([bad, good]);

    // 坏样本被过滤，好样本保留
    expect(samples.length).toBeGreaterThanOrEqual(1);
  });

  it('prepareFromQA 包含反向 QA', () => {
    const outputs = createTeacherOutputs(3);
    const samples = prep.prepareFromQA(outputs);

    const reverseSamples = samples.filter(s => s.type === 'qa');
    // 基础 QA + 反向 QA
    expect(reverseSamples.length).toBeGreaterThanOrEqual(3);
  });

  it('prepareFromJudgments 生成判断力样本', () => {
    const judgments: JudgmentSample[] = [
      {
        scenario: '选择 Go 并发方案',
        options: ['goroutine+channel', '线程池', '回调'],
        teacherChoice: 0,
        explanation: 'goroutine 是 Go 的原生并发方案',
        domain: 'Go开发',
        quality: 0.9,
      },
    ];

    const samples = prep.prepareFromJudgments(judgments);
    expect(samples.length).toBe(1);
    expect(samples[0].type).toBe('judgment');
  });

  it('prepareFromJudgments 过滤低质量', () => {
    const judgments: JudgmentSample[] = [
      { scenario: 's', options: ['a', 'b'], teacherChoice: 0, domain: 'test', quality: 0.1 },
    ];

    const samples = prep.prepareFromJudgments(judgments);
    expect(samples.length).toBe(0);
  });

  it('prepareFromCorrections 生成纠错样本', () => {
    const corrections: CorrectionSample[] = [
      {
        wrongAnswer: 'Go 没有泛型',
        correctAnswer: 'Go 1.18 引入了泛型',
        errorReason: '信息过时',
        domain: 'Go开发',
        quality: 0.8,
      },
    ];

    const samples = prep.prepareFromCorrections(corrections);
    expect(samples.length).toBe(1);
    expect(samples[0].type).toBe('correction');
  });

  it('prepareFromMixed 混合来源', () => {
    const result = prep.prepareFromMixed({
      qa: createTeacherOutputs(5),
      judgments: [{ scenario: 's', options: ['a', 'b'], teacherChoice: 0, domain: 'Go开发', quality: 0.9 }],
      corrections: [{ wrongAnswer: 'x', correctAnswer: 'y', errorReason: 'z', domain: 'Go开发', quality: 0.8 }],
    });

    expect(result.samples.length).toBeGreaterThan(5);
    expect(result.stats.rawQACount).toBe(7); // 5 + 1 + 1
    expect(result.stats.generatedSamples).toBeGreaterThan(0);
    expect(result.stats.typeDistribution).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════

describe('TernaryArchitecture', () => {
  it('列出可用架构', () => {
    const archs = TernaryArchitecture.listArchitectures();
    expect(archs).toContain('100m');
    expect(archs).toContain('tiny');
  });

  it('创建架构配置', () => {
    const arch = new TernaryArchitecture('tiny');
    const config = arch.getConfig();

    expect(config.hiddenSize).toBe(128);
    expect(config.numLayers).toBe(4);
    expect(config.vocabSize).toBe(32000);
  });

  it('未知架构抛出错误', () => {
    expect(() => new TernaryArchitecture('nonexistent')).toThrow('Unknown architecture');
  });

  it('weightSpecs 返回权重规格', () => {
    const arch = new TernaryArchitecture('tiny');
    const specs = arch.weightSpecs();

    expect(specs.length).toBeGreaterThan(0);
    expect(specs.some(s => s.name === 'embedding')).toBe(true);
    expect(specs.some(s => s.type === 'ternary')).toBe(true);
    expect(specs.some(s => s.type === 'fp16')).toBe(true);
  });

  it('totalParams 计算正确', () => {
    const arch = new TernaryArchitecture('tiny');
    const params = arch.totalParams();
    expect(params).toBeGreaterThan(0);
  });

  it('ternaryRatio 返回 0-1 之间', () => {
    const arch = new TernaryArchitecture('100m');
    const ratio = arch.ternaryRatio();
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThanOrEqual(1);
  });

  it('createModel 创建空模型', () => {
    const arch = new TernaryArchitecture('tiny');
    const model = arch.createModel('测试');

    expect(model.meta.domain).toBe('测试');
    expect(model.meta.architecture).toContain('tiny');
    expect(model.layers.length).toBe(4);
  });

  it('fromPreset 工厂方法', () => {
    const arch = TernaryArchitecture.fromPreset('100m');
    expect(arch.getConfig().totalParams).toBe(100_000_000);
  });
});

// ═══════════════════════════════════════════════════════

describe('KnowledgeDistiller', () => {
  it('distill 完整流程', () => {
    const distiller = new KnowledgeDistiller({ maxEpochs: 1, batchSize: 4 });
    const student = createTinyModel();
    const teacherOutputs = createTeacherOutputs(15);

    const result = distiller.distill(student, teacherOutputs, 'Go开发');

    expect(result.stage).toBe('complete');
    expect(result.dataStats.teacherSamples).toBe(15);
    expect(result.dataStats.generatedSamples).toBeGreaterThan(0);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.evaluation).toBeDefined();
  });

  it('distill 空数据返回失败', () => {
    const distiller = new KnowledgeDistiller();
    const student = createTinyModel();

    const result = distiller.distill(student, [], 'Go开发');

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('distill 不匹配领域返回失败', () => {
    const distiller = new KnowledgeDistiller();
    const student = createTinyModel('法务');
    const teacherOutputs = createTeacherOutputs(5, 'Go开发');

    const result = distiller.distill(student, teacherOutputs, '法务');

    expect(result.success).toBe(false);
  });

  it('distill 通配领域 *', () => {
    const distiller = new KnowledgeDistiller({ maxEpochs: 1 });
    const student = createTinyModel();
    const teacherOutputs = createTeacherOutputs(10, '任意领域');

    const result = distiller.distill(student, teacherOutputs, '*');

    expect(result.dataStats.trainingSamples).toBeGreaterThan(0);
  });

  it('distillProgressive 渐进蒸馏', () => {
    const distiller = new KnowledgeDistiller({ maxEpochs: 1 });
    const student = createTinyModel();
    const teacherOutputs = createTeacherOutputs(10);

    const results = distiller.distillProgressive(student, teacherOutputs, 'Go开发');

    expect(results.length).toBeGreaterThan(1);
    // 最后一个结果应是完整蒸馏
    expect(results[results.length - 1].stage).toBe('complete');
  });
});

// ═══════════════════════════════════════════════════════

describe('TernaryEvaluator', () => {
  let evaluator: TernaryEvaluator;

  beforeEach(() => {
    evaluator = new TernaryEvaluator();
  });

  it('quickEval 返回基本指标', () => {
    const model = createTinyModel();
    const result = evaluator.quickEval(model);

    expect(result.loaded).toBe(true);
    expect(result.canGenerate).toBe(true);
    expect(result.tokPerSec).toBeGreaterThanOrEqual(0);
  });

  it('evaluate 完整评估', async () => {
    const model = createTinyModel();
    const dataset: EvalDataset = {
      name: '测试集',
      domain: 'Go开发',
      samples: [
        { prompt: '什么是 goroutine?', reference: 'goroutine 是 Go 的轻量级线程', difficulty: 0.3, category: 'concurrency' },
        { prompt: 'channel 如何工作?', reference: 'channel 用于 goroutine 间通信', difficulty: 0.5, category: 'concurrency' },
        { prompt: 'errgroup 用法?', reference: 'errgroup 管理一组 goroutine 的错误', difficulty: 0.7, category: 'error' },
      ],
    };

    const result = await evaluator.evaluate(model, dataset);

    expect(result.datasetName).toBe('测试集');
    expect(result.domainAccuracy).toBeGreaterThanOrEqual(0);
    expect(result.consistency).toBeGreaterThanOrEqual(0);
    expect(result.diversity).toBeGreaterThanOrEqual(0);
    expect(result.coverage).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.details.totalSamples).toBe(3);
    expect(result.categoryScores).toBeDefined();
    expect(result.difficultyScores).toBeDefined();
  });

  it('getHistory 返回评估历史', async () => {
    const model = createTinyModel();
    const dataset: EvalDataset = {
      name: '测试', domain: 'Go开发',
      samples: [{ prompt: 'test', reference: 'ref', difficulty: 0.5, category: 'cat' }],
    };

    await evaluator.evaluate(model, dataset);
    await evaluator.evaluate(model, dataset);

    const history = evaluator.getHistory('Go开发');
    expect(history.length).toBe(2);
  });

  it('compare 比较两次评估', async () => {
    const model = createTinyModel();
    const dataset: EvalDataset = {
      name: '测试', domain: 'Go开发',
      samples: [{ prompt: 'test', reference: 'ref', difficulty: 0.5, category: 'cat' }],
    };

    await evaluator.evaluate(model, dataset);
    const current = await evaluator.evaluate(model, dataset);

    const comparison = evaluator.compare(current);
    expect(comparison).not.toBeNull();
    expect(comparison!.changes).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════

describe('CloudTrainer', () => {
  it('registerProvider 注册 provider', () => {
    const trainer = new CloudTrainer();
    const provider = new HttpCloudProvider('https://example.com', 'key');
    trainer.registerProvider(provider);

    expect(trainer.getActiveJobs().length).toBe(0);
  });

  it('submitTraining 无 provider 时抛出错误', async () => {
    const trainer = new CloudTrainer();
    const job: CloudJob = {
      type: 'distill',
      domain: 'test',
      modelId: 'test-1',
      dataset: { samples: [{ inputIds: [1, 2], targetIds: [3], type: 'qa', quality: 0.8 }], domain: 'test', version: '1.0' },
      config: { epochs: 1, batchSize: 1, learningRate: 0.01, architecture: 'tiny' },
      priority: 'normal',
    };

    await expect(trainer.submitTraining(job)).rejects.toThrow('not found');
  });

  it('submitTraining 空数据拒绝', async () => {
    const trainer = new CloudTrainer({ defaultProvider: 'http' });
    const provider = new HttpCloudProvider('https://example.com', 'key');
    trainer.registerProvider(provider);

    const job: CloudJob = {
      type: 'distill',
      domain: 'test',
      modelId: 'test-1',
      dataset: { samples: [], domain: 'test', version: '1.0' },
      config: { epochs: 1, batchSize: 1, learningRate: 0.01, architecture: 'tiny' },
      priority: 'normal',
    };

    await expect(trainer.submitTraining(job)).rejects.toThrow('Empty dataset');
  });

  it('数据上传禁用时拒绝', async () => {
    const trainer = new CloudTrainer({ allowDataUpload: false });
    const provider = new HttpCloudProvider('https://example.com', 'key');
    trainer.registerProvider(provider);

    const job: CloudJob = {
      type: 'distill',
      domain: 'test',
      modelId: 'test-1',
      dataset: { samples: [{ inputIds: [1], targetIds: [2], type: 'qa', quality: 0.8 }], domain: 'test', version: '1.0' },
      config: { epochs: 1, batchSize: 1, learningRate: 0.01, architecture: 'tiny' },
      priority: 'normal',
    };

    await expect(trainer.submitTraining(job)).rejects.toThrow('Data upload is disabled');
  });
});
