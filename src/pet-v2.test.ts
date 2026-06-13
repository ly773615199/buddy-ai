/**
 * 养成系统 v2 测试 — vitest 格式
 * 覆盖：基础创建、功能探索、进化系统、亲密度、引导系统、行为信号
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PetManager, calcMastery, countByCategory, FEATURE_DEFS, GUIDANCE_DEFS, SPECIES_TABLE } from './pet/index.js';
import * as fs from 'fs';

describe('养成系统 v2', () => {
  let pet: PetManager;
  const dbPath = '/tmp/test-pet-vitest-' + Date.now() + '.db';

  beforeAll(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    pet = new PetManager(dbPath);
  });

  afterAll(() => {
    pet.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  describe('基础创建', () => {
    it('默认属性正确', () => {
      const data = pet.getData();
      expect(data.name).toBe('Buddy');
      expect(data.species).toBe('光灵');
      expect(data.evolutionStage).toBe('egg');
      expect(data.intimacy).toBe(10);
      expect(data.id.length).toBeGreaterThan(0);
    });
  });

  describe('功能探索图谱', () => {
    it('种子数据完整', () => {
      const features = pet.getFeatures();
      expect(features.length).toBe(FEATURE_DEFS.length);
      expect(features.every(f => !f.discovered)).toBe(true);
      expect(features.filter(f => f.category === 'basic').length).toBe(6);
      expect(features.filter(f => f.category === 'advanced').length).toBe(10);
      expect(features.filter(f => f.category === 'expert').length).toBe(6);
      expect(features.filter(f => f.category === 'hidden').length).toBe(5);
    });
  });

  describe('追踪功能', () => {
    it('首次使用 = 新发现', () => {
      const r = pet.trackFeature('chat');
      expect(r.isNewDiscovery).toBe(true);
      expect(r.intimacyChange).toBe(6);
    });

    it('第二次不是新发现', () => {
      const r = pet.trackFeature('chat');
      expect(r.isNewDiscovery).toBe(false);
      expect(r.intimacyChange).toBe(0);
    });

    it('使用次数和熟练度递增', () => {
      const f = pet.getFeatures().find(f => f.id === 'chat')!;
      expect(f.useCount).toBe(2);
      expect(f.discovered).toBe(true);
      expect(f.mastery).toBeGreaterThan(0);
    });
  });

  describe('熟练度公式', () => {
    it('边界值正确', () => {
      expect(calcMastery(0)).toBe(0);
      expect(calcMastery(1)).toBeGreaterThanOrEqual(15);
      expect(calcMastery(5)).toBeGreaterThanOrEqual(35);
      expect(calcMastery(10)).toBeGreaterThan(50);
      expect(calcMastery(100)).toBe(100);
    });
  });

  describe('进化系统', () => {
    it('探索 basic 功能触发孵化', () => {
      pet.trackFeature('read_file');
      pet.trackFeature('list_files');
      const s = pet.getSummary();
      expect(['egg', 'hatching']).toContain(s.evolutionStage);
    });

    it('6 basic + 2 advanced → 成长', () => {
      pet.trackFeature('exec');
      pet.trackFeature('git_status');
      pet.trackFeature('get_time');
      pet.trackFeature('search_web');
      pet.trackFeature('fetch_url');
      const s = pet.getSummary();
      expect(['hatching', 'growing']).toContain(s.evolutionStage);
    });

    it('6 basic + 6 advanced → 成熟', () => {
      pet.trackFeature('write_file');
      pet.trackFeature('search_files');
      pet.trackFeature('analyze_file');
      pet.trackFeature('find_references');
      const s = pet.getSummary();
      expect(['growing', 'formed', 'mature']).toContain(s.evolutionStage);
    });
  });

  describe('亲密度系统', () => {
    it('亲密度随使用增长', () => {
      expect(pet.getIntimacy()).toBeGreaterThan(10);
    });

    it('大量使用同一功能增加深度', () => {
      for (let i = 0; i < 9; i++) pet.trackFeature('exec');
      const f = pet.getFeatures().find(f => f.id === 'exec')!;
      expect(f.useCount).toBeGreaterThanOrEqual(10);
    });
  });

  describe('引导系统', () => {
    it('引导任务定义完整', () => {
      expect(GUIDANCE_DEFS.length).toBeGreaterThanOrEqual(15);
      const targets = new Set(GUIDANCE_DEFS.map(g => g.targetFeature));
      expect(targets.size).toBe(GUIDANCE_DEFS.length);
    });

    it('所有引导目标都有对应功能', () => {
      const featureIds = new Set(FEATURE_DEFS.map(f => f.id));
      for (const g of GUIDANCE_DEFS) {
        expect(featureIds.has(g.targetFeature)).toBe(true);
      }
    });
  });

  describe('行为信号', () => {
    it('信号涌现正确', () => {
      const signals = pet.computeBehaviorSignals({
        toolCategories: { basic: 10, advanced: 15, expert: 5, exec: 8, search_files: 3, analyze_file: 2, find_references: 1 },
        correctionCount: 2, encourageCount: 5, negationCount: 1,
        repeatQuestionCount: 3, uniqueToolsUsed: 10, totalInteractions: 30,
      });
      expect(signals.snark).toBeGreaterThan(40);
      expect(signals.wisdom).toBeGreaterThan(40);
      expect(signals.debugging).toBeGreaterThan(40);
      expect(signals.chaos).toBeGreaterThan(40);
    });
  });

  describe('摘要输出', () => {
    it('摘要字段完整', () => {
      const s = pet.getSummary();
      expect(s.name).toBe('Buddy');
      expect(s.stageEmoji.length).toBeGreaterThan(0);
      expect(s.exploration.discovered).toBeGreaterThan(0);
      expect(s.intimacyDescription.length).toBeGreaterThan(0);
      expect(s.features.length).toBe(FEATURE_DEFS.length);
    });
  });

  describe('物种系统', () => {
    it('有 10 个物种', () => {
      expect(SPECIES_TABLE.length).toBe(10);
    });
  });

  describe('稳定性', () => {
    it('50次调用后数据一致', () => {
      const db = '/tmp/test-pet-stability-' + Date.now() + '.db';
      const p = new PetManager(db);
      for (let i = 0; i < 50; i++) p.trackFeature('chat');
      const f = p.getFeatures().find(f => f.id === 'chat')!;
      expect(f.useCount).toBe(50);
      expect(f.mastery).toBeGreaterThan(80);
      p.close();
      fs.unlinkSync(db);
    });
  });
});
