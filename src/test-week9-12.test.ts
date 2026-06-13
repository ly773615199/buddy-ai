/**
 * Week 9-10 + Week 11-12 新模块测试 — vitest 格式
 * STT / MicManager / AudioStream / FileWatcher / Skills系统
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { STTManager, WebSpeechSTT, WhisperSTT } from '../frontend/src/voice/stt.js';
import { MicrophoneManager } from '../frontend/src/voice/mic-manager.js';
import { AudioStreamManager } from '../frontend/src/voice/audio-stream.js';
import { FileWatcher } from './perception/fs-watcher.js';
import { ExperiencePackageManager } from './skills/package.js';
import { ExperienceScheduler } from './skills/scheduler.js';
import { ExperienceEvaluator } from './skills/evaluator.js';
import { ExperienceExporter } from './skills/export.js';
import { ExperienceVersionManager } from './skills/version.js';
import type { KnowledgeNode } from './skills/package.js';
import * as fs from 'fs';
import * as path from 'path';

// ==================== STT 测试 ====================

describe('STT 语音识别适配层', () => {
  let stt: InstanceType<typeof STTManager>;

  beforeAll(() => {
    stt = new STTManager();
    stt.registerBackend(new WebSpeechSTT());
    stt.registerBackend(new WhisperSTT('test-key'));
  });

  it('注册 2 个 STT 后端', () => {
    expect(stt.listBackends().length).toBe(2);
  });

  it('web-speech 后端已注册', () => {
    expect(stt.listBackends()).toContain('web-speech');
  });

  it('whisper 后端已注册', () => {
    expect(stt.listBackends()).toContain('whisper');
  });

  it('获取 whisper 后端成功', () => {
    stt.setActiveBackend('whisper');
    expect(() => stt.getBackend()).not.toThrow();
  });

  it('禁用后识别返回失败', async () => {
    stt.setEnabled(false);
    const result = await stt.recognize('dGVzdA==');
    expect(result.success).toBe(false);
    expect(result.error).toBe('STT 已禁用');
    stt.setEnabled(true);
  });
});

// ==================== 麦克风管理器测试 ====================

describe('麦克风管理器', () => {
  let mic: InstanceType<typeof MicrophoneManager>;

  beforeAll(() => {
    mic = new MicrophoneManager();
  });

  afterAll(() => {
    mic.destroy();
  });

  it('初始状态为 inactive', () => {
    expect(mic.getStatus().state).toBe('inactive');
  });

  it('未在录音状态', () => {
    expect(mic.isActive).toBe(false);
  });

  it('未连接时音量为 0', () => {
    expect(mic.getVolumeLevel()).toBe(0);
  });

  it('音量订阅返回取消函数', () => {
    const unsub = mic.onVolumeChange(() => {});
    expect(typeof unsub).toBe('function');
    unsub();
  });
});

// ==================== 音频流管理器测试 ====================

describe('音频流管理器', () => {
  let audioStream: InstanceType<typeof AudioStreamManager>;

  beforeAll(() => {
    audioStream = new AudioStreamManager({
      chunkMs: 2000,
      vadEnabled: true,
      vadThreshold: 0.03,
    });
  });

  afterAll(() => {
    audioStream.destroy();
  });

  it('初始状态为 inactive', () => {
    expect(audioStream.getStatus().state).toBe('inactive');
  });

  it('未激活', () => {
    expect(audioStream.isActive).toBe(false);
  });

  it('未检测到说话', () => {
    expect(audioStream.speaking).toBe(false);
  });

  it('音频块订阅成功', () => {
    const unsubChunk = audioStream.onChunk(() => {});
    expect(typeof unsubChunk).toBe('function');
    unsubChunk();
  });

  it('VAD 订阅成功', () => {
    const unsubVAD = audioStream.onVADChange(() => {});
    expect(typeof unsubVAD).toBe('function');
    unsubVAD();
  });
});

// ==================== 文件监听器测试 ====================

describe('文件变更监听器', () => {
  const testDir = '/tmp/buddy-test-watcher';
  let watcher: InstanceType<typeof FileWatcher>;

  beforeAll(() => {
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { watcher?.destroy(); } catch {}
  });

  afterAll(() => {
    try { fs.rmSync(testDir, { recursive: true }); } catch {}
  });

  it('初始未监听', () => {
    watcher = new FileWatcher({
      rootPath: testDir,
      debounceMs: 100,
      maxDepth: 2,
    });
    expect(watcher.isWatching).toBe(false);
    expect(watcher.watchedCount).toBe(0);
  });

  it('开始监听后 isWatching=true, watchedCount>0', () => {
    watcher = new FileWatcher({
      rootPath: testDir,
      debounceMs: 100,
      maxDepth: 2,
    });
    watcher.start();
    expect(watcher.isWatching).toBe(true);
    expect(watcher.watchedCount).toBeGreaterThan(0);
  });

  it('文件变更触发事件', async () => {
    vi.useFakeTimers();

    watcher = new FileWatcher({
      rootPath: testDir,
      debounceMs: 100,
      maxDepth: 2,
    });
    watcher.start();

    let changeEvent: any = null;
    watcher.onChange((event) => {
      changeEvent = event;
    });

    // 写入文件
    fs.writeFileSync(path.join(testDir, 'test.txt'), 'hello');

    // 推进 50ms 让文件系统事件到达
    await vi.advanceTimersByTimeAsync(50);
    // 推进 100ms 让防抖触发
    await vi.advanceTimersByTimeAsync(150);

    expect(changeEvent).not.toBeNull();
    expect(['add', 'change']).toContain(changeEvent.type);
    expect(changeEvent.relativePath).toBe('test.txt');

    vi.useRealTimers();
  });
});

// ==================== 能力包系统测试 ====================

describe('能力包管理器', () => {
  let pkgManager: InstanceType<typeof ExperiencePackageManager>;

  beforeAll(() => {
    pkgManager = new ExperiencePackageManager();
  });

  it('创建包成功', () => {
    const testKnowledge: KnowledgeNode[] = Array.from({ length: 25 }, (_, i) => ({
      id: `k_${i}`,
      type: (['decision_rule', 'exception', 'pattern', 'risk', 'human_factor', 'failure'] as const)[i % 6],
      content: `骨科知识 #${i}: 骨折分型第${i}种情况的处理方案`,
      domain: '骨科',
      confidence: 0.7 + Math.random() * 0.3,
      concepts: ['骨折', '骨科', `概念${i}`],
      sourceMessageIds: [`msg_${i}`],
      createdAt: Date.now() - i * 86400000,
      accessedAt: Date.now(),
      importance: 0.5 + Math.random() * 0.5,
    }));

    const pkg = pkgManager.createPackage({
      name: '骨科专业知识包',
      domain: '骨科',
      sourceRoom: 'room_orthopedics',
      knowledge: testKnowledge,
      tags: ['医疗', '骨科'],
    });

    expect(pkg.id.startsWith('pkg_')).toBe(true);
    expect(pkg.domain).toBe('骨科');
    expect(pkg.knowledgeCount).toBe(25);
    expect(pkg.growthStage).toBe('seed');
    expect(pkg.promptTemplate).toContain('骨科');
  });

  it('质量≥30后升级为 sprout', () => {
    const list = pkgManager.listPackages();
    const pkgId = list[0].id;
    pkgManager.updateQuality(pkgId, 35);
    expect(pkgManager.getPackage(pkgId)!.growthStage).toBe('sprout');
  });

  it('通过 ID 获取包成功', () => {
    const pkgId = pkgManager.listPackages()[0].id;
    const found = pkgManager.getPackage(pkgId);
    expect(found).toBeDefined();
  });

  it('按领域查找成功', () => {
    const byDomain = pkgManager.findByDomain('骨科');
    expect(byDomain).toBeDefined();
  });

  it('添加知识后数量正确，升级为 growing', () => {
    const pkgId = pkgManager.listPackages()[0].id;
    const moreKnowledge: KnowledgeNode[] = Array.from({ length: 80 }, (_, i) => ({
      id: `k_new_${i}`,
      type: 'pattern' as const,
      content: `新增骨科知识 #${i}`,
      domain: '骨科',
      confidence: 0.8,
      concepts: ['骨折'],
      sourceMessageIds: [],
      createdAt: Date.now(),
      accessedAt: Date.now(),
      importance: 0.6,
    }));

    pkgManager.addKnowledge(pkgId, moreKnowledge);
    const updated = pkgManager.getPackage(pkgId)!;
    expect(updated.knowledgeCount).toBe(105);
    expect(updated.growthStage).toBe('sprout'); // quality 35 < 60

    pkgManager.updateQuality(pkgId, 65);
    expect(pkgManager.getPackage(pkgId)!.growthStage).toBe('growing');
  });

  it('质量评分更新成功', () => {
    const pkgId = pkgManager.listPackages()[0].id;
    pkgManager.updateQuality(pkgId, 75);
    expect(pkgManager.getPackage(pkgId)!.qualityScore).toBe(75);
  });

  it('列出包数量正确', () => {
    expect(pkgManager.listPackages().length).toBe(1);
  });

  it('导出成功', () => {
    const pkgId = pkgManager.listPackages()[0].id;
    const exported = pkgManager.exportPackage(pkgId);
    expect(exported.length).toBeGreaterThan(0);
  });

  it('领域统计正确', () => {
    const stats = pkgManager.getDomainStats();
    expect(stats.length).toBe(1);
    expect(stats[0].domain).toBe('骨科');
  });
});

describe('能力包调度器', () => {
  let pkgManager: InstanceType<typeof ExperiencePackageManager>;
  let scheduler: InstanceType<typeof ExperienceScheduler>;

  beforeAll(() => {
    pkgManager = new ExperiencePackageManager();
    const testKnowledge: KnowledgeNode[] = Array.from({ length: 25 }, (_, i) => ({
      id: `k_${i}`,
      type: (['decision_rule', 'exception', 'pattern', 'risk', 'human_factor', 'failure'] as const)[i % 6],
      content: `骨科知识 #${i}: 骨折分型第${i}种情况的处理方案`,
      domain: '骨科',
      confidence: 0.7 + Math.random() * 0.3,
      concepts: ['骨折', '骨科', `概念${i}`],
      sourceMessageIds: [`msg_${i}`],
      createdAt: Date.now() - i * 86400000,
      accessedAt: Date.now(),
      importance: 0.5 + Math.random() * 0.5,
    }));

    const pkg = pkgManager.createPackage({
      name: '骨科专业知识包',
      domain: '骨科',
      sourceRoom: 'room_orthopedics',
      knowledge: testKnowledge,
      tags: ['医疗', '骨科'],
    });
    pkgManager.updateQuality(pkg.id, 65);
    scheduler = new ExperienceScheduler(pkgManager.getPackagesMap());
  });

  it('无领域时不使用包', () => {
    const noMatch = scheduler.schedule([]);
    expect(noMatch.hasPackage).toBe(false);
    expect(noMatch.strategy).toBe('none');
  });

  it('有领域匹配时返回策略', () => {
    const matched = scheduler.schedule([
      { domain: '骨科', confidence: 0.9, keywords: ['骨折', '骨科'] },
    ]);
    expect(matched.hasPackage).toBe(true);
    expect(['stmp_only', 'hybrid', 'package_lead']).toContain(matched.strategy);
    // stmp_only 阶段不生成 prompt injection
    if (matched.strategy !== 'stmp_only') {
      expect(matched.promptInjection.length).toBeGreaterThan(0);
      expect(matched.promptInjection).toContain('骨科');
    }
  });

  it('骨科包未成熟', () => {
    expect(scheduler.hasMaturePackage('骨科')).toBe(false);
  });

  it('可用领域列表正确', () => {
    const availableDomains = scheduler.getAvailableDomains();
    expect(availableDomains.length).toBe(1);
  });
});

describe('能力包评估器', () => {
  let pkgManager: InstanceType<typeof ExperiencePackageManager>;
  let evaluator: InstanceType<typeof ExperienceEvaluator>;

  beforeAll(() => {
    pkgManager = new ExperiencePackageManager();
    const testKnowledge: KnowledgeNode[] = Array.from({ length: 25 }, (_, i) => ({
      id: `k_${i}`,
      type: (['decision_rule', 'exception', 'pattern', 'risk', 'human_factor', 'failure'] as const)[i % 6],
      content: `骨科知识 #${i}: 骨折分型第${i}种情况的处理方案`,
      domain: '骨科',
      confidence: 0.7 + Math.random() * 0.3,
      concepts: ['骨折', '骨科', `概念${i}`],
      sourceMessageIds: [`msg_${i}`],
      createdAt: Date.now() - i * 86400000,
      accessedAt: Date.now(),
      importance: 0.5 + Math.random() * 0.5,
    }));

    pkgManager.createPackage({
      name: '骨科专业知识包',
      domain: '骨科',
      sourceRoom: 'room_orthopedics',
      knowledge: testKnowledge,
      tags: ['医疗', '骨科'],
    });
    evaluator = new ExperienceEvaluator();
  });

  it('快速评估返回正确结果', () => {
    const evalPkg = pkgManager.listPackages()[0] as any;
    const quickResult = evaluator.quickEvaluate(evalPkg);
    expect(quickResult.packageId).toBe(evalPkg.id);
    expect(quickResult.domain).toBe('骨科');
    expect(quickResult.dimensions.length).toBe(4);
    expect(quickResult.riskLevel).toBe('high');
    expect(typeof quickResult.overallScore).toBe('number');
    expect(typeof quickResult.passed).toBe('boolean');
    expect(Array.isArray(quickResult.recommendations)).toBe(true);
  });

  it('高风险通过阈值为 90', () => {
    const evalPkg = pkgManager.listPackages()[0] as any;
    const quickResult = evaluator.quickEvaluate(evalPkg);
    expect(!quickResult.passed || quickResult.overallScore >= 90).toBe(true);
  });

  it('生成测试用例数量正确', () => {
    const evalPkg = pkgManager.listPackages()[0] as any;
    const testCases = evaluator.generateTestCases(evalPkg, 5);
    expect(testCases.length).toBeLessThanOrEqual(5);
    if (testCases.length > 0) {
      expect(testCases[0].domain).toBe('骨科');
    }
  });
});

describe('能力包导出器', () => {
  let pkgManager: InstanceType<typeof ExperiencePackageManager>;
  let exporter: InstanceType<typeof ExperienceExporter>;

  beforeAll(() => {
    pkgManager = new ExperiencePackageManager();
    const testKnowledge: KnowledgeNode[] = Array.from({ length: 25 }, (_, i) => ({
      id: `k_${i}`,
      type: (['decision_rule', 'exception', 'pattern', 'risk', 'human_factor', 'failure'] as const)[i % 6],
      content: `骨科知识 #${i}: 骨折分型第${i}种情况的处理方案`,
      domain: '骨科',
      confidence: 0.7 + Math.random() * 0.3,
      concepts: ['骨折', '骨科', `概念${i}`],
      sourceMessageIds: [`msg_${i}`],
      createdAt: Date.now() - i * 86400000,
      accessedAt: Date.now(),
      importance: 0.5 + Math.random() * 0.5,
    }));

    pkgManager.createPackage({
      name: '骨科专业知识包',
      domain: '骨科',
      sourceRoom: 'room_orthopedics',
      knowledge: testKnowledge,
      tags: ['医疗', '骨科'],
    });
    exporter = new ExperienceExporter();
  });

  it('导出格式和版本正确', () => {
    const evalPkg = pkgManager.listPackages()[0] as any;
    const exportData = exporter.export(evalPkg);
    expect(exportData.format).toBe('skillmate');
    expect(exportData.version).toBe('1.0.0');
    expect(exportData.checksum.length).toBeGreaterThan(0);
    expect(exportData.package.knowledge.length).toBeGreaterThan(0);
  });

  it('sourceMessageIds 已脱敏', () => {
    const evalPkg = pkgManager.listPackages()[0] as any;
    const exportData = exporter.export(evalPkg);
    for (const k of exportData.package.knowledge) {
      expect(Object.keys(k)).not.toContain('sourceMessageIds');
    }
  });

  it('导入成功', () => {
    const evalPkg = pkgManager.listPackages()[0] as any;
    const importStr = exporter.exportAsString(evalPkg);
    const importResult = exporter.import(importStr);
    expect(importResult.success).toBe(true);
    expect(importResult.package).toBeDefined();
  });

  it('验证通过', () => {
    const evalPkg = pkgManager.listPackages()[0] as any;
    const importStr = exporter.exportAsString(evalPkg);
    const validation = exporter.validate(importStr);
    expect(validation.valid).toBe(true);
    expect(validation.errors.length).toBe(0);
  });

  it('摘要包含领域和成长阶段', () => {
    const evalPkg = pkgManager.listPackages()[0] as any;
    const summary = exporter.generateSummary(evalPkg);
    expect(summary).toContain('骨科');
    expect(summary).toContain(evalPkg.growthStage);
  });
});

describe('能力包版本管理', () => {
  let pkgManager: InstanceType<typeof ExperiencePackageManager>;
  let versionMgr: InstanceType<typeof ExperienceVersionManager>;

  beforeAll(() => {
    pkgManager = new ExperiencePackageManager();
    const testKnowledge: KnowledgeNode[] = Array.from({ length: 25 }, (_, i) => ({
      id: `k_${i}`,
      type: (['decision_rule', 'exception', 'pattern', 'risk', 'human_factor', 'failure'] as const)[i % 6],
      content: `骨科知识 #${i}: 骨折分型第${i}种情况的处理方案`,
      domain: '骨科',
      confidence: 0.7 + Math.random() * 0.3,
      concepts: ['骨折', '骨科', `概念${i}`],
      sourceMessageIds: [`msg_${i}`],
      createdAt: Date.now() - i * 86400000,
      accessedAt: Date.now(),
      importance: 0.5 + Math.random() * 0.5,
    }));

    pkgManager.createPackage({
      name: '骨科专业知识包',
      domain: '骨科',
      sourceRoom: 'room_orthopedics',
      knowledge: testKnowledge,
      tags: ['医疗', '骨科'],
    });
    versionMgr = new ExperienceVersionManager();
  });

  it('初始化后有一个版本', () => {
    const evalPkg = pkgManager.listPackages()[0] as any;
    versionMgr.initPackage(evalPkg);
    const versions = versionMgr.getVersions(evalPkg.id);
    expect(versions.length).toBe(1);
    expect(versions[0].version).toBe('1.0.0');
  });

  it('创建快照版本号递增', () => {
    const evalPkg = pkgManager.listPackages()[0] as any;
    const snapshot = versionMgr.createSnapshot(evalPkg, '手动快照测试');
    expect(snapshot.version).not.toBe('1.0.0');
    expect(snapshot.knowledgeCount).toBe(evalPkg.knowledgeCount);
  });

  it('获取最新版本成功', () => {
    const evalPkg = pkgManager.listPackages()[0] as any;
    const snapshot = versionMgr.createSnapshot(evalPkg, 'test');
    const latest = versionMgr.getLatestVersion(evalPkg.id);
    expect(latest).toBeDefined();
    expect(latest!.version).toBe(snapshot.version);
  });

  it('版本历史包含所有版本', () => {
    const evalPkg = pkgManager.listPackages()[0] as any;
    const history = versionMgr.getHistorySummary(evalPkg.id);
    expect(history).toContain('1.0.0');
  });

  it('回滚后知识数量不变', () => {
    const evalPkg = pkgManager.listPackages()[0] as any;
    const rolledBack = versionMgr.rollback(evalPkg.id, '1.0.0');
    expect(rolledBack.knowledgeCount).toBe(evalPkg.knowledgeCount);
  });

  it('差异对比返回 added 和 qualityDelta', () => {
    const evalPkg = pkgManager.listPackages()[0] as any;
    const latestVersion = versionMgr.getLatestVersion(evalPkg.id)!;
    const diff = versionMgr.diff(evalPkg.id, '1.0.0', latestVersion.version);
    expect(typeof diff.added).toBe('number');
    expect(typeof diff.qualityDelta).toBe('number');
  });

  it('删除包成功', () => {
    const evalPkg = pkgManager.listPackages()[0] as any;
    pkgManager.deletePackage(evalPkg.id);
    expect(pkgManager.listPackages().length).toBe(0);
  });
});
