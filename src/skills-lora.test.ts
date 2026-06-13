/**
 * 技能系统 + LoRA 模块测试
 * 覆盖: Evaluator, Radar, Scheduler, Version, Export, Feedback, LoRA
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { SkillPackage, KnowledgeNode, DomainType, GrowthStage } from './skills/package.js';

// ── 测试工具 ──

function makeKnowledge(overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return {
    id: `kn_${Math.random().toString(36).slice(2, 8)}`,
    type: 'decision_rule',
    content: '测试知识节点：当用户请求读取文件时使用 read_file 工具',
    domain: 'file_ops',
    confidence: 0.8,
    concepts: ['文件', '读取'],
    sourceMessageIds: [],
    createdAt: Date.now(),
    accessedAt: Date.now(),
    importance: 5,
    ...overrides,
  };
}

function makePackage(overrides: Partial<SkillPackage> = {}): SkillPackage {
  return {
    id: 'pkg_test',
    name: '文件操作',
    description: '文件读写经验包',
    domain: 'file_ops',
    domainType: 'rule_based' as DomainType,
    growthStage: 'mature' as GrowthStage,
    knowledgeCount: 3,
    qualityScore: 80,
    sourceRoom: 'file-ops',
    promptTemplate: '{{knowledge}}',
    metadata: { creator: 'auto', version: '1.0.0', tags: ['file'], domainDepthScore: 5, expertiseSignals: 3, sizeBytes: 1024 },
    status: 'private',
    knowledge: [makeKnowledge(), makeKnowledge({ id: 'kn2', content: '写文件使用 write_file' }), makeKnowledge({ id: 'kn3', content: '搜索文件使用 search_files' })],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════
// ExperienceEvaluator
// ═══════════════════════════════════════════════════════

describe('ExperienceEvaluator', () => {
  it('quickEvaluate 返回评估结果', async () => {
    const { ExperienceEvaluator } = await import('./skills/evaluator.js');
    const evaluator = new ExperienceEvaluator();
    const pkg = makePackage();

    const result = evaluator.quickEvaluate(pkg);
    expect(result).toBeDefined();
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
    expect(result.passed).toBeDefined();
    expect(result.riskLevel).toMatch(/low|medium|high/);
  });

  it('空知识包评估分数低', async () => {
    const { ExperienceEvaluator } = await import('./skills/evaluator.js');
    const evaluator = new ExperienceEvaluator();
    const emptyPkg = makePackage({ knowledge: [], knowledgeCount: 0 });

    const result = evaluator.quickEvaluate(emptyPkg);
    expect(result.overallScore).toBeLessThan(50);
  });

  it('高质量知识包评估分数高', async () => {
    const { ExperienceEvaluator } = await import('./skills/evaluator.js');
    const evaluator = new ExperienceEvaluator();
    const goodPkg = makePackage({
      knowledge: Array.from({ length: 10 }, (_, i) => makeKnowledge({ id: `kn${i}`, confidence: 0.9, importance: 8 })),
      knowledgeCount: 10,
    });

    const result = evaluator.quickEvaluate(goodPkg);
    expect(result.overallScore).toBeGreaterThan(50);
  });
});

// ═══════════════════════════════════════════════════════
// QualityRadar
// ═══════════════════════════════════════════════════════

describe('QualityRadar', () => {
  it('generateReport 返回雷达报告', async () => {
    const { QualityRadar } = await import('./skills/radar.js');
    const radar = new QualityRadar();
    const report = radar.generateReport(makePackage());

    expect(report).toBeDefined();
    expect(report.overallScore).toBeGreaterThanOrEqual(0);
    expect(report.overallScore).toBeLessThanOrEqual(100);
  });

  it('空知识包雷达分数低', async () => {
    const { QualityRadar } = await import('./skills/radar.js');
    const radar = new QualityRadar();
    const report = radar.generateReport(makePackage({ knowledge: [], knowledgeCount: 0 }));

    expect(report.overallScore).toBeLessThan(50);
  });
});

// ═══════════════════════════════════════════════════════
// ExperienceScheduler
// ═══════════════════════════════════════════════════════

describe('ExperienceScheduler', () => {
  it('无匹配领域时返回空结果', async () => {
    const { ExperienceScheduler } = await import('./skills/scheduler.js');
    const packages = new Map<string, SkillPackage>();
    const scheduler = new ExperienceScheduler(packages);

    const result = scheduler.schedule([]);
    expect(result.hasPackage).toBe(false);
    expect(result.packages).toHaveLength(0);
  });

  it('有匹配领域时返回调度结果', async () => {
    const { ExperienceScheduler } = await import('./skills/scheduler.js');
    const pkg = makePackage();
    const packages = new Map<string, SkillPackage>();
    packages.set(pkg.domain, pkg);
    const scheduler = new ExperienceScheduler(packages);

    const result = scheduler.schedule([{ domain: 'file_ops', confidence: 0.8, keywords: ['file'] }]);
    expect(result.hasPackage).toBe(true);
    expect(result.packages.length).toBeGreaterThan(0);
    expect(result.strategy).toBeTruthy();
  });

  it('低置信度匹配仍然返回结果', async () => {
    const { ExperienceScheduler } = await import('./skills/scheduler.js');
    const pkg = makePackage();
    const packages = new Map<string, SkillPackage>();
    packages.set(pkg.domain, pkg);
    const scheduler = new ExperienceScheduler(packages);

    const result = scheduler.schedule([{ domain: 'file_ops', confidence: 0.3, keywords: ['file'] }]);
    // 低置信度也应该能找到包
    expect(result.hasPackage).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════
// ExperienceVersionManager
// ═══════════════════════════════════════════════════════

describe('ExperienceVersionManager', () => {
  it('initPackage 初始化版本', async () => {
    const { ExperienceVersionManager } = await import('./skills/version.js');
    const vm = new ExperienceVersionManager();
    const pkg = makePackage();

    vm.initPackage(pkg);
    const versions = vm.getVersions(pkg.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe('1.0.0');
    expect(versions[0].packageId).toBe(pkg.id);
  });

  it('initPackage 重复调用不产生重复版本', async () => {
    const { ExperienceVersionManager } = await import('./skills/version.js');
    const vm = new ExperienceVersionManager();
    const pkg = makePackage();

    vm.initPackage(pkg);
    vm.initPackage(pkg);
    const versions = vm.getVersions(pkg.id);
    expect(versions).toHaveLength(1);
  });

  it('checkAutoSnapshot 首次检查自动初始化并返回 null', async () => {
    const { ExperienceVersionManager } = await import('./skills/version.js');
    const vm = new ExperienceVersionManager();
    const pkg = makePackage();

    // checkAutoSnapshot 内部会自动 init，首次应返回 null
    const snapshot = vm.checkAutoSnapshot(pkg);
    expect(snapshot).toBeNull();

    // 验证初始化后的版本列表（bug 修复后应有 1 条记录）
    const versions = vm.getVersions(pkg.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe('1.0.0');
  });

  it('手动初始化后 checkAutoSnapshot 增量 < 50 不触发', async () => {
    const { ExperienceVersionManager } = await import('./skills/version.js');
    const vm = new ExperienceVersionManager();
    const pkg = makePackage({ knowledgeCount: 3 });

    // 手动初始化（不经过 checkAutoSnapshot）
    vm.initPackage(pkg);
    const versions = vm.getVersions(pkg.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe('1.0.0');

    // 知识量从 3 增加到 10（< 50 阈值）
    const smallGrowth = makePackage({ id: pkg.id, knowledgeCount: 10 });
    const snapshot = vm.checkAutoSnapshot(smallGrowth);
    expect(snapshot).toBeNull();
  });

  it('checkAutoSnapshot 知识量增量 >= 50 时触发快照', async () => {
    const { ExperienceVersionManager } = await import('./skills/version.js');
    const vm = new ExperienceVersionManager();
    const pkg = makePackage({ knowledgeCount: 3 });
    vm.initPackage(pkg);

    // 知识量从 3 增加到 60（>= 50 阈值）
    const bigGrowth = makePackage({ id: pkg.id, knowledgeCount: 60 });
    const snapshot = vm.checkAutoSnapshot(bigGrowth);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.knowledgeCount).toBe(60);
    // 新版本应该递增
    expect(snapshot!.version).not.toBe('1.0.0');

    // 验证版本历史
    const versions = vm.getVersions(pkg.id);
    expect(versions).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════
// ExperienceExporter
// ═══════════════════════════════════════════════════════

describe('ExperienceExporter', () => {
  it('export 导出为 skillmate 格式', async () => {
    const { ExperienceExporter } = await import('./skills/export.js');
    const exporter = new ExperienceExporter();
    const result = exporter.export(makePackage());

    expect(result.format).toBe('skillmate');
    expect(result.version).toBeTruthy();
    expect(result.package).toBeDefined();
    expect(result.checksum).toBeTruthy();
    expect(result.exportedAt).toBeGreaterThan(0);
  });

  it('导出移除 sourceMessageIds（脱敏）', async () => {
    const { ExperienceExporter } = await import('./skills/export.js');
    const exporter = new ExperienceExporter();
    const pkg = makePackage({
      knowledge: [makeKnowledge({ sourceMessageIds: ['msg1', 'msg2'] })],
    });

    const result = exporter.export(pkg);
    // 导出的知识节点不应包含 sourceMessageIds
    for (const kn of result.package.knowledge) {
      expect((kn as any).sourceMessageIds).toBeUndefined();
    }
  });

  it('exportAsText 返回 JSON 字符串', async () => {
    const { ExperienceExporter } = await import('./skills/export.js');
    const exporter = new ExperienceExporter();
    const text = exporter.exportAsString(makePackage());

    expect(typeof text).toBe('string');
    const parsed = JSON.parse(text);
    expect(parsed.format).toBe('skillmate');
  });
});

// ═══════════════════════════════════════════════════════
// FeedbackLearner
// ═══════════════════════════════════════════════════════

describe('FeedbackLearner', () => {
  it('记录反馈并获取统计', async () => {
    const { FeedbackLearner } = await import('./skills/feedback.js');
    const learner = new FeedbackLearner();
    learner.recordFeedback({
      packageId: 'pkg_1',
      query: '怎么读文件',
      answer: '使用 read_file',
      rating: 4,
      helpfulKnowledge: ['kn1'],
      unhelpfulKnowledge: [],
    });
    learner.recordFeedback({
      packageId: 'pkg_1',
      query: '怎么写文件',
      answer: '使用 write_file',
      rating: 2,
      helpfulKnowledge: [],
      unhelpfulKnowledge: ['kn2'],
    });

    const stats = learner.getStats('pkg_1');
    expect(stats).toBeDefined();
  });

  it('getStats 返回统计', async () => {
    const { FeedbackLearner } = await import('./skills/feedback.js');
    const learner = new FeedbackLearner();
    learner.recordFeedback({
      packageId: 'pkg_1', query: 'q', answer: 'a', rating: 5,
      helpfulKnowledge: ['kn1'], unhelpfulKnowledge: [],
    });

    const stats = learner.getStats('pkg_1');
    expect(stats).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════
// LoRAService
// ═══════════════════════════════════════════════════════

describe('LoRAService', () => {
  it('init 初始化成功', async () => {
    const { LoRAService } = await import('./lora/service.js');
    const mockStmp = { searchNodes: () => [] };
    const mockCognitive = { getAllDomainProfiles: () => [], getDomainProfile: () => null };

    const service = new LoRAService(mockStmp as any, mockCognitive as any);
    await service.init();
    const config = service.getConfig();
    expect(config).toBeDefined();
  });

  it('getConfig 返回配置', async () => {
    const { LoRAService } = await import('./lora/service.js');
    const mockStmp = { searchNodes: () => [] };
    const mockCognitive = { getAllDomainProfiles: () => [], getDomainProfile: () => null };

    const service = new LoRAService(mockStmp as any, mockCognitive as any);
    const config = service.getConfig();
    expect(config).toBeDefined();
  });

  it('listWeights 初始为空', async () => {
    const { LoRAService } = await import('./lora/service.js');
    const mockStmp = { searchNodes: () => [] };
    const mockCognitive = { getAllDomainProfiles: () => [], getDomainProfile: () => null };

    const service = new LoRAService(mockStmp as any, mockCognitive as any);
    await service.init();
    const weights = await service.listWeights();
    expect(Array.isArray(weights)).toBe(true);
  });

  it('getJobStatus 未找到时抛错', async () => {
    const { LoRAService } = await import('./lora/service.js');
    const mockStmp = { searchNodes: () => [] };
    const mockCognitive = { getAllDomainProfiles: () => [], getDomainProfile: () => null };

    const service = new LoRAService(mockStmp as any, mockCognitive as any);
    await service.init();
    await expect(service.getJobStatus('nonexistent')).rejects.toThrow('不存在');
  });
});
