/**
 * Buddy 类型常量完整性测试
 * 验证各常量表的一致性和完整性
 */
import { describe, it, expect } from 'vitest';
import {
  TEXTURE_OPTIONS,
  TEMPERAMENT_OPTIONS,
  COLOR_PRESETS,
  EVOLUTION_STAGES,
  RARITY_COLORS,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  PERSONALITY_LABELS,
  PERSONALITY_COLORS,
} from '../types/buddy.js';
import type { TextureType, TemperamentType, Rarity, EvolutionStage, FeatureCategory } from '../types/buddy.js';

describe('视觉形象常量', () => {
  it('TEXTURE_OPTIONS 包含全部 4 种质感', () => {
    const ids = TEXTURE_OPTIONS.map(t => t.id);
    const expected: TextureType[] = ['soft', 'transparent', 'sharp', 'warm'];
    expect(ids).toEqual(expect.arrayContaining(expected));
    expect(ids).toHaveLength(4);
  });

  it('每个质感选项都有 label 和 desc', () => {
    for (const opt of TEXTURE_OPTIONS) {
      expect(opt.label).toBeTruthy();
      expect(opt.desc).toBeTruthy();
    }
  });

  it('TEMPERAMENT_OPTIONS 包含全部 4 种气质', () => {
    const ids = TEMPERAMENT_OPTIONS.map(t => t.id);
    const expected: TemperamentType[] = ['warm', 'calm', 'lively', 'mysterious'];
    expect(ids).toEqual(expect.arrayContaining(expected));
    expect(ids).toHaveLength(4);
  });

  it('COLOR_PRESETS 有 8 个颜色', () => {
    expect(COLOR_PRESETS).toHaveLength(8);
  });

  it('所有颜色值是合法 hex', () => {
    const hexRegex = /^#[0-9a-fA-F]{6}$/;
    for (const preset of COLOR_PRESETS) {
      expect(preset.hex).toMatch(hexRegex);
    }
  });
});

describe('进化阶段常量', () => {
  it('EVOLUTION_STAGES 包含全部 7 个阶段', () => {
    const stages = EVOLUTION_STAGES.map(s => s.stage);
    const expected: EvolutionStage[] = [
      'egg', 'hatching', 'growing', 'formed', 'mature', 'complete', 'legendary',
    ];
    expect(stages).toEqual(expected);
  });

  it('每个阶段都有 name、emoji、description', () => {
    for (const stage of EVOLUTION_STAGES) {
      expect(stage.name).toBeTruthy();
      expect(stage.emoji).toBeTruthy();
      expect(stage.description).toBeTruthy();
    }
  });
});

describe('稀有度常量', () => {
  it('RARITY_COLORS 包含全部 5 种稀有度', () => {
    const rarities: Rarity[] = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
    for (const r of rarities) {
      expect(RARITY_COLORS[r]).toBeTruthy();
      expect(RARITY_COLORS[r]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe('功能分类常量', () => {
  it('CATEGORY_LABELS 和 CATEGORY_COLORS 包含全部 4 种分类', () => {
    const categories: FeatureCategory[] = ['basic', 'advanced', 'expert', 'hidden'];
    for (const c of categories) {
      expect(CATEGORY_LABELS[c]).toBeTruthy();
      expect(CATEGORY_COLORS[c]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe('5维属性常量', () => {
  it('PERSONALITY_LABELS 包含 5 个维度', () => {
    const keys = ['snark', 'wisdom', 'chaos', 'patience', 'debugging'];
    for (const k of keys) {
      expect(PERSONALITY_LABELS[k]).toBeTruthy();
    }
  });

  it('PERSONALITY_COLORS 包含对应的 5 种颜色', () => {
    const keys = ['snark', 'wisdom', 'chaos', 'patience', 'debugging'];
    for (const k of keys) {
      expect(PERSONALITY_COLORS[k]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});
