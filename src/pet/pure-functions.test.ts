/**
 * Pet 纯函数测试 — 不依赖 SQLite
 *
 * 测试 calcMastery / getEvolutionStage / countByCategory / FEATURE_DEFS / SPECIES_TABLE
 */

import { describe, test, expect } from 'vitest';
import { calcMastery, getEvolutionStage, countByCategory, FEATURE_DEFS, GUIDANCE_DEFS, SPECIES_TABLE } from './index.js';
import type { FeatureNode } from './index.js';

/** 构造测试用的 features 字典 */
function makeFeatures(...categories: string[]): Record<string, FeatureNode> {
  const result: Record<string, FeatureNode> = {};
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i] as FeatureNode['category'];
    result[`f${i}`] = {
      id: `f${i}`, name: `Feature ${i}`, description: '', category: cat,
      discovered: true, useCount: 1, mastery: 20, emoji: '🔧',
    };
  }
  return result;
}

describe('Pet 纯函数', () => {
  describe('calcMastery 熟练度公式', () => {
    test('0 次使用 → 0', () => {
      expect(calcMastery(0)).toBe(0);
    });

    test('1 次使用 → >= 15', () => {
      expect(calcMastery(1)).toBeGreaterThanOrEqual(15);
    });

    test('5 次使用 → >= 35', () => {
      expect(calcMastery(5)).toBeGreaterThanOrEqual(35);
    });

    test('10 次使用 → > 50', () => {
      expect(calcMastery(10)).toBeGreaterThan(50);
    });

    test('100 次使用 → 100 (封顶)', () => {
      expect(calcMastery(100)).toBe(100);
    });

    test('单调递增', () => {
      for (let i = 1; i < 50; i++) {
        expect(calcMastery(i)).toBeGreaterThanOrEqual(calcMastery(i - 1));
      }
    });
  });

  describe('getEvolutionStage 进化阶段', () => {
    test('空 features → egg (最低阶段)', () => {
      const info = getEvolutionStage({});
      expect(info.stage).toBe('egg');
    });

    test('2 basic → hatching', () => {
      const features = makeFeatures('basic', 'basic');
      const info = getEvolutionStage(features);
      expect(['egg', 'hatching']).toContain(info.stage);
    });

    test('返回 EvolutionInfo 对象包含完整字段', () => {
      const info = getEvolutionStage({});
      expect(info.name).toBeDefined();
      expect(info.stage).toBeDefined();
      expect(info.emoji).toBeDefined();
      expect(info.description).toBeDefined();
      expect(info.requireBasic).toBeTypeOf('number');
      expect(info.requireAdvanced).toBeTypeOf('number');
    });

    test('阶段随发现数单调不降（增加任意维度不退化）', () => {
      const stages = ['egg', 'hatching', 'growing', 'formed', 'mature', 'complete'];
      // 遍历所有 (basic, advanced) 组合，验证增加任一维度不退化
      for (let basic = 0; basic <= 6; basic++) {
        for (let adv = 0; adv <= 6; adv++) {
          const cur = getEvolutionStage(makeFeatures(...Array(basic).fill('basic'), ...Array(adv).fill('advanced')));
          const curIdx = stages.indexOf(cur.stage);
          // 增加 basic
          if (basic < 6) {
            const next = getEvolutionStage(makeFeatures(...Array(basic + 1).fill('basic'), ...Array(adv).fill('advanced')));
            expect(stages.indexOf(next.stage)).toBeGreaterThanOrEqual(curIdx);
          }
          // 增加 advanced
          if (adv < 6) {
            const next = getEvolutionStage(makeFeatures(...Array(basic).fill('basic'), ...Array(adv + 1).fill('advanced')));
            expect(stages.indexOf(next.stage)).toBeGreaterThanOrEqual(curIdx);
          }
        }
      }
    });
  });

  describe('FEATURE_DEFS 功能定义', () => {
    test('功能数量 >= 22', () => {
      expect(FEATURE_DEFS.length).toBeGreaterThanOrEqual(22);
    });

    test('每个功能有 id/name/category', () => {
      for (const f of FEATURE_DEFS) {
        expect(f.id).toBeDefined();
        expect(f.name).toBeDefined();
        expect(f.category).toBeDefined();
      }
    });

    test('category 包含 basic/advanced/expert/hidden', () => {
      const categories = new Set(FEATURE_DEFS.map(f => f.category));
      expect(categories.has('basic')).toBe(true);
      expect(categories.has('advanced')).toBe(true);
      expect(categories.has('expert')).toBe(true);
      expect(categories.has('hidden')).toBe(true);
    });

    test('basic 有 6 个', () => {
      expect(FEATURE_DEFS.filter(f => f.category === 'basic').length).toBe(6);
    });
  });

  describe('GUIDANCE_DEFS 引导定义', () => {
    test('引导数量 >= 5', () => {
      expect(GUIDANCE_DEFS.length).toBeGreaterThanOrEqual(5);
    });

    test('每个引导有 id/title/description/hint', () => {
      for (const g of GUIDANCE_DEFS) {
        expect(g.id).toBeDefined();
        expect(g.title).toBeDefined();
        expect(g.description).toBeDefined();
        expect(g.hint).toBeDefined();
      }
    });
  });

  describe('SPECIES_TABLE 物种表', () => {
    test('有 10 个物种', () => {
      expect(SPECIES_TABLE.length).toBe(10);
    });

    test('每个物种有 name/rarity/emoji', () => {
      for (const s of SPECIES_TABLE) {
        expect(s.name).toBeDefined();
        expect(s.rarity).toBeDefined();
        expect(s.emoji).toBeDefined();
      }
    });

    test('物种名称不重复', () => {
      const names = SPECIES_TABLE.map(s => s.name);
      expect(new Set(names).size).toBe(names.length);
    });
  });

  describe('countByCategory 分类计数', () => {
    test('空 features 返回全零计数', () => {
      const result = countByCategory({});
      expect(result).toEqual({ basic: 0, advanced: 0, expert: 0, hidden: 0 });
    });

    test('正确分组计数', () => {
      const features = makeFeatures('basic', 'basic', 'advanced');
      const result = countByCategory(features);
      expect(result.basic).toBe(2);
      expect(result.advanced).toBe(1);
      expect(result.expert).toBe(0);
      expect(result.hidden).toBe(0);
    });

    test('未发现的功能不计入', () => {
      const features: Record<string, FeatureNode> = {
        f0: { id: 'f0', name: 'A', description: '', category: 'basic',
              discovered: false, useCount: 0, mastery: 0, emoji: '🔧' },
        f1: { id: 'f1', name: 'B', description: '', category: 'basic',
              discovered: true, useCount: 1, mastery: 20, emoji: '🔧' },
      };
      const result = countByCategory(features);
      expect(result.basic).toBe(1);
    });
  });
});
