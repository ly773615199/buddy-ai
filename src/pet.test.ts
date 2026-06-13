import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PetManager, calcMastery, getEvolutionStage, countByCategory, FEATURE_DEFS, GUIDANCE_DEFS, SPECIES_TABLE } from './pet/index.js';
import * as fs from 'fs';

const TEST_DB = '/tmp/buddy-pet-vitest.db';

describe('养成系统 v2', () => {
  let pet: PetManager;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    pet = new PetManager(TEST_DB);
  });

  afterEach(() => {
    pet.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
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
      expect(features).toHaveLength(FEATURE_DEFS.length);
      expect(features.every(f => !f.discovered)).toBe(true);
      expect(features.filter(f => f.category === 'basic')).toHaveLength(6);
      expect(features.filter(f => f.category === 'advanced')).toHaveLength(10);
      expect(features.filter(f => f.category === 'expert')).toHaveLength(6);
      expect(features.filter(f => f.category === 'hidden')).toHaveLength(5);
    });
  });

  describe('追踪功能', () => {
    it('首次使用 = 新发现', () => {
      const r1 = pet.trackFeature('chat');
      expect(r1.isNewDiscovery).toBe(true);
      expect(r1.intimacyChange).toBe(6);
    });

    it('第二次不是新发现', () => {
      pet.trackFeature('chat');
      const r2 = pet.trackFeature('chat');
      expect(r2.isNewDiscovery).toBe(false);
      expect(r2.intimacyChange).toBe(0);
    });

    it('使用次数和熟练度递增', () => {
      pet.trackFeature('chat');
      pet.trackFeature('chat');
      const chatFeature = pet.getFeatures().find(f => f.id === 'chat')!;
      expect(chatFeature.useCount).toBe(2);
      expect(chatFeature.discovered).toBe(true);
      expect(chatFeature.mastery).toBeGreaterThan(0);
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
      pet.trackFeature('chat');
      pet.trackFeature('read_file');
      pet.trackFeature('list_files');
      const summary = pet.getSummary();
      expect(summary.evolutionStage).toBe('hatching');
    });

    it('6 basic + 2 advanced → 成长', () => {
      ['chat', 'read_file', 'list_files', 'exec', 'git_status', 'get_time', 'search_web', 'fetch_url']
        .forEach(f => pet.trackFeature(f));
      const summary = pet.getSummary();
      expect(summary.evolutionStage).toBe('growing');
    });

    it('6 basic + 6 advanced + 1 expert → 成熟', () => {
      ['chat', 'read_file', 'list_files', 'exec', 'git_status', 'get_time',
        'search_web', 'fetch_url', 'write_file', 'search_files', 'analyze_file', 'find_references',
        'stmp_retrieve']
        .forEach(f => pet.trackFeature(f));
      const summary = pet.getSummary();
      expect(summary.evolutionStage).toBe('mature');
    });
  });

  describe('亲密度系统', () => {
    it('亲密度随使用增长', () => {
      pet.trackFeature('chat');
      const intimacy = pet.getIntimacy();
      expect(intimacy).toBeGreaterThan(10);
    });

    it('大量使用同一功能增加深度', () => {
      for (let i = 0; i < 10; i++) pet.trackFeature('exec');
      const execFeature = pet.getFeatures().find(f => f.id === 'exec')!;
      expect(execFeature.useCount).toBeGreaterThanOrEqual(10);
    });
  });

  describe('引导系统', () => {
    it('引导任务定义完整', () => {
      expect(GUIDANCE_DEFS.length).toBeGreaterThanOrEqual(15);
      const targets = new Set(GUIDANCE_DEFS.map(g => g.targetFeature));
      expect(targets.size).toBe(GUIDANCE_DEFS.length);

      const featureIds = new Set(FEATURE_DEFS.map(f => f.id));
      for (const t of targets) {
        expect(featureIds.has(t)).toBe(true);
      }
    });
  });

  describe('行为信号计算', () => {
    it('信号涌现正确', () => {
      const signals = pet.computeBehaviorSignals({
        toolCategories: { basic: 10, advanced: 15, expert: 5, exec: 8, search_files: 3, analyze_file: 2, find_references: 1 },
        correctionCount: 2,
        encourageCount: 5,
        negationCount: 1,
        repeatQuestionCount: 3,
        uniqueToolsUsed: 10,
        totalInteractions: 30,
      });
      expect(signals.snark).toBeGreaterThan(40);
      expect(signals.wisdom).toBeGreaterThan(40);
      expect(signals.debugging).toBeGreaterThan(40);
      expect(signals.chaos).toBeGreaterThan(40);
    });
  });

  describe('摘要输出', () => {
    it('摘要字段完整', () => {
      pet.trackFeature('chat');
      const summary = pet.getSummary();
      expect(summary.name).toBe('Buddy');
      expect(summary.stageEmoji.length).toBeGreaterThan(0);
      expect(summary.exploration.discovered).toBeGreaterThan(0);
      expect(summary.intimacyDescription.length).toBeGreaterThan(0);
      expect(summary.features).toHaveLength(FEATURE_DEFS.length);
    });
  });

  describe('物种系统', () => {
    it('有 10 个物种', () => {
      expect(SPECIES_TABLE).toHaveLength(10);
    });
  });

  describe('稳定性', () => {
    it('50次调用后数据一致', () => {
      for (let i = 0; i < 50; i++) pet.trackFeature('chat');
      const chatF = pet.getFeatures().find(f => f.id === 'chat')!;
      expect(chatF.useCount).toBe(50);
      expect(chatF.mastery).toBeGreaterThan(80);
    });
  });
});
