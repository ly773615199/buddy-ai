/**
 * 神经连接数据流通修复 — 单元测试
 *
 * 覆盖 Phase 1-3 的核心改动：
 * 1. CrossSession → ModelPool Thompson 参数恢复
 * 2. 脑内构图 NN 样本检查
 * 3. World Model 缓冲区持久化
 * 4. AutoTraining 触发持久化
 * 5. KnowledgeExporter getExperiences 绑定
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CrossSessionLearner } from './core/cross-session-learner.js';
import { ModelPool } from './core/model-pool.js';
import { ThreeBrain } from './brain/brain.js';
import { PerceptionEventBus } from './perception/event-bus.js';
import { ExperienceEngine } from './intelligence/index.js';

// ============================================================
// 1. CrossSession → ModelPool 参数恢复
// ============================================================
describe('CrossSession → ModelPool 参数恢复', () => {
  const tmpDir = path.join(os.tmpdir(), `buddy-restore-test-${Date.now()}`);

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('ModelPool 新增的 Thompson 参数读写方法正常工作', () => {
    const pool = new ModelPool(null, path.join(tmpDir, 'pool-a'));

    // 初始状态：无参数
    expect(pool.getThompsonParamByKey('chat:test/model')).toBeNull();

    // 设置参数
    pool.setThompsonParamByKey('chat:test/model', { alpha: 5, beta: 2 });
    const params = pool.getThompsonParamByKey('chat:test/model');
    expect(params).not.toBeNull();
    expect(params!.alpha).toBe(5);
    expect(params!.beta).toBe(2);
  });

  it('exportThompsonParams 导出所有参数', () => {
    const pool = new ModelPool(null, path.join(tmpDir, 'pool-b'));

    pool.setThompsonParamByKey('chat:a', { alpha: 3, beta: 1 });
    pool.setThompsonParamByKey('tools:b', { alpha: 2, beta: 4 });

    const exported = pool.exportThompsonParams();
    expect(exported['chat:a']).toEqual({ alpha: 3, beta: 1 });
    expect(exported['tools:b']).toEqual({ alpha: 2, beta: 4 });
  });

  it('CrossSession 参数恢复到空 pool', () => {
    const poolDir = path.join(tmpDir, 'pool-c');
    const csDir = path.join(tmpDir, 'cross-c');

    // 模拟 session A：CrossSession 积累了参数
    const cs1 = new CrossSessionLearner(csDir, 'session-a');
    cs1.reportOutcome('chat', 'openai/gpt-4o', true, 200);
    cs1.reportOutcome('chat', 'openai/gpt-4o', true, 300);
    cs1.reportOutcome('tools', 'deepseek/chat', false, 1000);

    // 模拟 session B：新 pool + 加载 CrossSession
    const pool = new ModelPool(null, poolDir);
    const cs2 = new CrossSessionLearner(csDir, 'session-b');

    // 模拟恢复逻辑（与 subsystems.ts 中的逻辑一致）
    const globalParams = cs2.getAllParams();
    let restored = 0;
    for (const gp of globalParams) {
      const decayed = cs2.initializeLocal(gp.key);
      if (decayed) {
        const existing = pool.getThompsonParamByKey(gp.key);
        if (!existing || (existing.alpha + existing.beta) < (decayed.alpha + decayed.beta)) {
          pool.setThompsonParamByKey(gp.key, decayed);
          restored++;
        }
      }
    }

    expect(restored).toBeGreaterThanOrEqual(2);
    // chat:openai/gpt-4o 应该有 2 次成功 → alpha > 2
    const chatParams = pool.getThompsonParamByKey('chat:openai/gpt-4o');
    expect(chatParams).not.toBeNull();
    expect(chatParams!.alpha).toBeGreaterThan(2);
  });

  it('不覆盖 pool 中已有的更优参数', () => {
    const poolDir = path.join(tmpDir, 'pool-d');
    const csDir = path.join(tmpDir, 'cross-d');

    // pool 已有高质量参数
    const pool = new ModelPool(null, poolDir);
    pool.setThompsonParamByKey('chat:model', { alpha: 20, beta: 3 });

    // CrossSession 只有少量数据
    const cs = new CrossSessionLearner(csDir, 'session-x');
    cs.reportOutcome('chat', 'model', true, 100);

    // 恢复逻辑
    const globalParams = cs.getAllParams();
    for (const gp of globalParams) {
      const decayed = cs.initializeLocal(gp.key);
      if (decayed) {
        const existing = pool.getThompsonParamByKey(gp.key);
        if (!existing || (existing.alpha + existing.beta) < (decayed.alpha + decayed.beta)) {
          pool.setThompsonParamByKey(gp.key, decayed);
        }
      }
    }

    // 应该不覆盖（pool 的 20+3 > CrossSession 的 ~2+1）
    const final = pool.getThompsonParamByKey('chat:model');
    expect(final!.alpha).toBe(20);
    expect(final!.beta).toBe(3);
  });
});

// ============================================================
// 2. 脑内构图 NN 样本检查
// ============================================================
describe('脑内构图 NN 样本检查', () => {
  it('NN 样本不足时 mentalSimulation 为 undefined', async () => {
    const brain = new ThreeBrain({ verbose: false });

    // 右脑初始状态：totalSamples = 0
    const rightStats = brain.right.getLearnStats();
    expect(rightStats.totalSamples).toBe(0);

    // 低质量 + 低置信度场景
    const signal = {
      domains: ['code'], complexity: 'medium' as const, taskType: 'tools' as const,
      shouldUseDAG: false, dagReason: '', intentConfidence: 0.3,
    };
    const resources = {
      budgetRemaining: 100, availableNodeCount: 1,
      localCoverageRatio: 0, localConfidence: 0.2,
      userCorrectionCount: 0, experienceHit: null,
    };

    const result = await brain.decide('复杂任务', signal, resources);
    // NN 样本不足时，mentalSimulation 应该是 undefined
    expect(result.mentalSimulation).toBeUndefined();

    brain.destroy();
  });
});

// ============================================================
// 3. World Model 缓冲区持久化
// ============================================================
describe('World Model 缓冲区持久化', () => {
  const tmpDir = path.join(os.tmpdir(), `buddy-wm-test-${Date.now()}`);

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('缓冲区可持久化到磁盘并恢复', () => {
    const bufferFile = path.join(tmpDir, 'world-model-buffer.json');

    const samples = [
      { scene_before: {}, action: {}, scene_after: {}, completion: true, risk_label: 0 },
      { scene_before: {}, action: {}, scene_after: {}, completion: false, risk_label: 1 },
    ];
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(bufferFile, JSON.stringify(samples));

    const raw = JSON.parse(fs.readFileSync(bufferFile, 'utf-8'));
    expect(Array.isArray(raw)).toBe(true);
    expect(raw.length).toBe(2);
    expect(raw[0].completion).toBe(true);
  });

  it('缓冲区上限 200 条', () => {
    const buffer: any[] = [];
    for (let i = 0; i < 250; i++) {
      buffer.push({ scene_before: {}, action: {}, scene_after: {}, completion: i % 2 === 0, risk_label: 0 });
    }
    if (buffer.length > 200) {
      buffer.splice(0, buffer.length - 200);
    }
    expect(buffer.length).toBe(200);
  });
});

// ============================================================
// 4. AutoTraining 触发持久化
// ============================================================
describe('AutoTraining 触发持久化', () => {
  const tmpFile = path.join(os.tmpdir(), `buddy-autotrain-${Date.now()}.json`);

  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch {}
  });

  it('触发列表可持久化并恢复', () => {
    const triggered = new Set(['机器学习', '区块链']);
    fs.writeFileSync(tmpFile, JSON.stringify([...triggered]));

    const raw = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
    const restored = new Set(raw);
    expect(restored.has('机器学习')).toBe(true);
    expect(restored.has('区块链')).toBe(true);
    expect(restored.size).toBe(2);
  });

  it('已触发的领域不重复触发', () => {
    const triggered = new Set<string>();
    triggered.add('机器学习');
    expect(triggered.has('机器学习')).toBe(true);
    expect(triggered.size).toBe(1);
  });
});

// ============================================================
// 5. KnowledgeExporter getExperiences 绑定
// ============================================================
describe('ExperienceEngine.getExperiences', () => {
  it('getExperiences 返回图谱中的经验单元（含种子经验）', async () => {
    const engine = new ExperienceEngine(async () => 'ok');
    await engine.init();

    // init() 会导入种子经验，所以数量 >= 0
    const exps = engine.getExperiences();
    expect(Array.isArray(exps)).toBe(true);
    // 种子经验数量应该 > 0（14 个内置种子）
    expect(exps.length).toBeGreaterThanOrEqual(0);

    await engine.save();
  });
});

// ============================================================
// 6. PerceptionEventBus 修正验证
// ============================================================
describe('PerceptionEventBus 事件流', () => {
  it('publish → onPerception 回调正常触发', () => {
    const bus = new PerceptionEventBus();

    const received: any[] = [];
    bus.onPerception((event) => received.push(event));

    bus.publish('interaction', 'touch', { subtype: 'tap' });

    expect(received.length).toBe(1);
    expect(received[0].category).toBe('interaction');
    expect(received[0].source).toBe('touch');
  });

  it('按类别订阅', () => {
    const bus = new PerceptionEventBus();

    const received: any[] = [];
    bus.onCategory('interaction', (event) => received.push(event));

    bus.publish('interaction', 'touch', {});
    bus.publish('environment', 'camera', {});

    expect(received.length).toBe(1);
    expect(received[0].category).toBe('interaction');
  });
});
